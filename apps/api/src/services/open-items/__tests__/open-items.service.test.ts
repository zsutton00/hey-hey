import type { OrganizationId, ProjectId, UserId } from 'src/types';
import type {
  OpenItemGroupRow,
  OpenItemRow,
  OpenItemsChangeSet,
} from '../open-items.domain';
import { OpenItemsConflictException } from '../open-items.errors';
import type {
  LockedOpenItemsCollection,
  OpenItemsIdempotencyRecord,
  OpenItemsRepository,
  OpenItemsScope,
} from '../open-items.repository';
import { OpenItemsService } from '../open-items.service';
import { key, ref } from './open-items.fixtures';

interface StoredCollection {
  id: string;
  scopeKey: string;
  revision: number;
  items: Map<string, OpenItemRow>;
  groups: Map<string, OpenItemGroupRow>;
  idempotency: Map<string, OpenItemsIdempotencyRecord>;
}

/**
 * In-memory repository with all-or-nothing transactions: work runs against a
 * deep copy that replaces the committed store only when the work resolves.
 */
class InMemoryOpenItemsRepository {
  committed = new Map<string, StoredCollection>();
  private working = this.committed;
  cleanupCalls = 0;
  transactions = 0;

  private static copy(store: Map<string, StoredCollection>) {
    return new Map(
      [...store].map(([scopeKey, collection]) => [
        scopeKey,
        {
          ...collection,
          items: new Map(
            [...collection.items].map(([id, row]) => [
              id,
              structuredClone(row),
            ]),
          ),
          groups: new Map(
            [...collection.groups].map(([id, row]) => [id, { ...row }]),
          ),
          idempotency: new Map(collection.idempotency),
        },
      ]),
    );
  }

  private static scopeKey(scope: OpenItemsScope) {
    return `${scope.projectId}:${scope.userId}`;
  }

  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => this.runTransaction(work));
    this.tail = next.catch(() => {});
    return next;
  }
  private async runTransaction<T>(
    work: (tx: unknown) => Promise<T>,
  ): Promise<T> {
    this.transactions++;
    this.working = InMemoryOpenItemsRepository.copy(this.committed);
    try {
      const result = await work({});
      this.committed = this.working;
      return result;
    } finally {
      this.working = this.committed;
    }
  }

  async readState(scope: OpenItemsScope) {
    const stored = this.committed.get(
      InMemoryOpenItemsRepository.scopeKey(scope),
    );
    if (!stored) return null;
    return {
      revision: stored.revision,
      items: [...stored.items.values()]
        .filter((row) => row.removedAt === null)
        .map((row) => structuredClone(row)),
      groups: [...stored.groups.values()].map((row) => ({ ...row })),
    };
  }

  async lockCollection(
    _tx: unknown,
    scope: OpenItemsScope,
    createIfAbsent: boolean,
  ): Promise<LockedOpenItemsCollection | null> {
    const scopeKey = InMemoryOpenItemsRepository.scopeKey(scope);
    let stored = this.working.get(scopeKey);
    let created = false;
    if (!stored && createIfAbsent) {
      stored = {
        id: `collection-${scopeKey}`,
        scopeKey,
        revision: 0,
        items: new Map(),
        groups: new Map(),
        idempotency: new Map(),
      };
      this.working.set(scopeKey, stored);
      created = true;
    }
    return stored
      ? { id: stored.id, revision: stored.revision, created }
      : null;
  }

  private byId(collectionId: string) {
    const stored = [...this.working.values()].find(
      (row) => row.id === collectionId,
    );
    if (!stored) throw new Error(`unknown collection ${collectionId}`);
    return stored;
  }

  async loadState(_tx: unknown, collection: LockedOpenItemsCollection) {
    const stored = this.byId(collection.id);
    return {
      revision: stored.revision,
      items: [...stored.items.values()].map((row) => structuredClone(row)),
      groups: [...stored.groups.values()].map((row) => ({ ...row })),
    };
  }

  async findIdempotencyRecord(
    _tx: unknown,
    collectionId: string,
    idempotencyKey: string,
  ) {
    return this.byId(collectionId).idempotency.get(idempotencyKey) ?? null;
  }

  async recordIdempotencyResult(
    _tx: unknown,
    collectionId: string,
    idempotencyKey: string,
    record: OpenItemsIdempotencyRecord,
  ) {
    this.byId(collectionId).idempotency.set(
      idempotencyKey,
      structuredClone(record),
    );
  }

  async applyChanges(
    _tx: unknown,
    collectionId: string,
    changes: OpenItemsChangeSet,
  ) {
    const stored = this.byId(collectionId);
    if (changes.clearCollection) {
      stored.items.clear();
      stored.groups.clear();
    }
    for (const row of changes.groups.values())
      stored.groups.set(row.id, { ...row });
    for (const row of changes.items.values()) {
      if (row.groupId !== null && !stored.groups.has(row.groupId)) {
        throw new Error('foreign key violation: unknown group');
      }
      stored.items.set(row.id, structuredClone(row));
    }
    for (const id of changes.deletedGroupIds) {
      if ([...stored.items.values()].some((row) => row.groupId === id)) {
        throw new Error('foreign key violation: group has members');
      }
      stored.groups.delete(id);
    }
  }

  async advanceRevision(_tx: unknown, collectionId: string, revision: number) {
    this.byId(collectionId).revision = revision;
  }

  async cleanup() {
    this.cleanupCalls++;
    return { removedItems: 0, idempotencyRecords: 0 };
  }
}

const scope = (user = 'user-1', project = 'project-1'): OpenItemsScope => ({
  organizationId: 'org-1' as OrganizationId,
  projectId: project as ProjectId,
  userId: user as UserId,
});

async function conflictOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenItemsConflictException) return error.body;
    throw error;
  }
  throw new Error('expected a conflict');
}

describe('OpenItemsService', () => {
  let repository: InMemoryOpenItemsRepository;
  let service: OpenItemsService;

  const activate = (
    n: number,

    idem = key(n),
    s = scope(),
  ) =>
    service.activateOpenItem(s, {
      idempotencyKey: idem,
      item: { ...ref(n) },
      lineage: n > 1 ? [ref(1)] : [],
      presentation: { label: `Item ${n}` },
    });

  beforeEach(() => {
    repository = new InMemoryOpenItemsRepository();
    service = new OpenItemsService(
      repository as unknown as OpenItemsRepository,
      {
        publishOpenItemsChanged: jest.fn(),
      } as unknown as import('../../../core/websockets/websocket.gateway').WebsocketGateway,
    );
  });

  it('commits overlapping actions before publishing private revision signals', async () => {
    const publish = jest.fn((_user, _project, revision) => {
      expect(
        [...repository.committed.values()].some(
          (value) => value.revision === revision,
        ),
      ).toBe(true);
    });
    service = new OpenItemsService(
      repository as unknown as OpenItemsRepository,
      {
        publishOpenItemsChanged: publish,
      } as unknown as import('../../../core/websockets/websocket.gateway').WebsocketGateway,
    );
    await activate(1);
    await Promise.all([
      service.setOpenItemPin(scope(), ref(1), {
        idempotencyKey: key(91),
        pinned: true,
      }),
      service.setOpenItemNote(scope(), ref(1), {
        idempotencyKey: key(92),
        note: 'both apply',
      }),
    ]);
    const current = await service.getOpenItems(scope());
    expect(current).toMatchObject({
      revision: 3,
      items: [expect.objectContaining({ pinned: true, note: 'both apply' })],
    });
    expect(publish.mock.calls.map((call) => call[2])).toEqual([1, 2, 3]);
    await service.setOpenItemPin(scope(), ref(9), {
      idempotencyKey: key(93),
      pinned: true,
    });
    await activate(1);
    expect(publish).toHaveBeenCalledTimes(3);
    await expect(
      service.setOpenItemNote(scope(), ref(1), {
        idempotencyKey: key(92),
        note: 'different',
      }),
    ).rejects.toBeInstanceOf(OpenItemsConflictException);
    expect(publish).toHaveBeenCalledTimes(3);
    await service.resetOpenItems(scope(), { idempotencyKey: key(94) });
    await service.migrateOpenItems(scope('user-1', 'new-project'), {
      idempotencyKey: key(95),
      sourceSchemaVersion: 1,
      items: [],
      groups: [],
    });
    expect(publish.mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 4, 1]);
  });

  it('reads ABSENT before any collection exists', async () => {
    await expect(service.getOpenItems(scope())).resolves.toEqual({
      state: 'ABSENT',
    });
  });

  it('does not publish or persist inherited membership when its transaction fails', async () => {
    const publish = jest.fn();
    service = new OpenItemsService(
      repository as unknown as OpenItemsRepository,
      {
        publishOpenItemsChanged: publish,
      } as unknown as import('../../../core/websockets/websocket.gateway').WebsocketGateway,
    );
    await activate(1);
    await service.createOpenItemGroup(scope(), {
      idempotencyKey: key(120),
      name: 'Focus',
      assign: [ref(1)],
    });
    const before = await service.getOpenItems(scope());
    jest
      .spyOn(repository, 'applyChanges')
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(
      service.activateOpenItem(scope(), {
        idempotencyKey: key(121),
        item: ref(2, 'AGENT_SESSION'),
        lineage: [ref(1)],
        presentation: { label: 'Session' },
      }),
    ).rejects.toThrow('write failed');
    await expect(service.getOpenItems(scope())).resolves.toEqual(before);
    expect(publish).toHaveBeenCalledTimes(2);
    const retry = await service.activateOpenItem(scope(), {
      idempotencyKey: key(121),
      item: ref(2, 'AGENT_SESSION'),
      lineage: [ref(1)],
      presentation: { label: 'Session' },
    });
    expect(retry.replayed).toBe(false);
    expect(retry.collectionRevision).toBe(3);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('persists later-opened and reopened sessions, protected removal, and recorded retries', async () => {
    const publish = jest.fn((_user, _project, revision) => {
      expect([...repository.committed.values()][0]!.revision).toBe(revision);
    });
    service = new OpenItemsService(
      repository as unknown as OpenItemsRepository,
      {
        publishOpenItemsChanged: publish,
      } as unknown as import('../../../core/websockets/websocket.gateway').WebsocketGateway,
    );
    await activate(1);
    const created = await service.createOpenItemGroup(scope(), {
      idempotencyKey: key(100),
      name: 'Focus',
      assign: [ref(1)],
    });
    const groupId = created.groups[0]!.groupId;
    const sessionRequest = {
      idempotencyKey: key(101),
      item: ref(2, 'AGENT_SESSION'),
      lineage: [ref(1)],
      presentation: { label: 'Coding session' },
    };
    const opened = await service.activateOpenItem(scope(), sessionRequest);
    expect(opened.items[0]).toMatchObject({ groupId, lineage: [ref(1)] });
    expect(opened.items[0]!.memberPosition).not.toBeNull();
    await expect(service.getOpenItems(scope())).resolves.toMatchObject({
      revision: 3,
      items: expect.arrayContaining([
        expect.objectContaining({ ...ref(2, 'AGENT_SESSION'), groupId }),
      ]),
    });
    await service.removeOpenItem(scope(), ref(2, 'AGENT_SESSION'), {
      idempotencyKey: key(102),
      includeDescendants: false,
    });
    const reopened = await service.activateOpenItem(scope(), {
      ...sessionRequest,
      idempotencyKey: key(103),
    });
    expect(reopened.items[0]).toMatchObject({
      groupId,
      removedAt: null,
      revision: 5,
    });
    const second = await service.createOpenItemGroup(scope(), {
      idempotencyKey: key(104),
      name: 'Other',
    });
    const otherGroupId = second.groups[0]!.groupId;
    await service.assignOpenItemsToGroup(scope(), otherGroupId, {
      idempotencyKey: key(105),
      items: [ref(2, 'AGENT_SESSION')],
    });
    const refreshed = await service.activateOpenItem(scope(), {
      ...sessionRequest,
      idempotencyKey: key(106),
    });
    expect(refreshed.items[0]!.groupId).toBe(otherGroupId);
    await service.activateOpenItem(scope(), {
      ...sessionRequest,
      item: ref(3, 'AGENT_SESSION'),
      idempotencyKey: key(107),
    });
    await service.setOpenItemPin(scope(), ref(3, 'AGENT_SESSION'), {
      idempotencyKey: key(108),
      pinned: true,
    });
    await service.activateOpenItem(scope(), {
      ...sessionRequest,
      item: ref(4, 'AGENT_SESSION'),
      idempotencyKey: key(109),
    });
    await activate(5, key(110));
    await service.ungroupOpenItems(scope(), {
      idempotencyKey: key(111),
      items: [ref(5)],
    });
    await service.activateOpenItem(scope(), {
      ...sessionRequest,
      item: ref(6),
      lineage: [],
      idempotencyKey: key(112),
    });
    const removeRequest = {
      idempotencyKey: key(113),
      includeDescendants: true,
    };
    const removed = await service.removeOpenItem(
      scope(),
      ref(1),
      removeRequest,
    );
    expect(removed.items.map((row) => row.entityId).sort()).toEqual([
      ref(1).entityId,
      ref(4).entityId,
      ref(5).entityId,
    ]);
    expect(
      removed.items.every(
        (row) =>
          row.removedAt !== null &&
          row.groupId === null &&
          row.memberPosition === null,
      ),
    ).toBe(true);
    const current = await service.getOpenItems(scope());
    if (current.state !== 'PRESENT')
      throw new Error('expected persisted collection');
    expect(current.items.map((row) => row.entityId).sort()).toEqual([
      ref(2).entityId,
      ref(3).entityId,
      ref(6).entityId,
    ]);
    expect(
      current.items.find((row) => row.entityId === ref(2).entityId)!.groupId,
    ).toBe(otherGroupId);
    expect(
      current.items.find((row) => row.entityId === ref(3).entityId),
    ).toMatchObject({ groupId, pinned: true });
    const signals = publish.mock.calls.length;
    await expect(
      service.removeOpenItem(scope(), ref(1), removeRequest),
    ).resolves.toEqual({ ...removed, replayed: true });
    await expect(
      service.activateOpenItem(scope(), sessionRequest),
    ).resolves.toEqual({ ...opened, replayed: true });
    expect(publish).toHaveBeenCalledTimes(signals);
    await expect(service.getOpenItems(scope())).resolves.toEqual(current);
  });

  it('isolates collections by authenticated user and project', async () => {
    await activate(1);
    await activate(2, key(2), scope('user-2'));
    await activate(3, key(3), scope('user-1', 'project-2'));

    const mine = await service.getOpenItems(scope());
    expect(mine).toMatchObject({ state: 'PRESENT', revision: 1 });
    expect(
      mine.state === 'PRESENT' && mine.items.map((row) => row.entityId),
    ).toEqual([ref(1).entityId]);
    expect(repository.committed.size).toBe(3);
  });

  it('advances the collection revision with every successful mutation and cleans up in the same transaction', async () => {
    const first = await activate(1);
    expect(first.collectionRevision).toBe(1);
    const pinned = await service.setOpenItemPin(scope(), ref(1), {
      idempotencyKey: key(10),

      pinned: true,
    });
    expect(pinned.collectionRevision).toBe(2);
    expect(pinned.items[0]).toMatchObject({ pinned: true, revision: 2 });
    expect(repository.cleanupCalls).toBe(2);
  });

  it('replays a retry inside the window even when the collection holds over 500 records', async () => {
    const original = await activate(1);
    for (let n = 0; n < 600; n++) {
      await service.setOpenItemPin(scope(), ref(1), {
        idempotencyKey: `bulk-key-${n}`,

        pinned: n % 2 === 0,
      });
    }
    const stored = [...repository.committed.values()][0]!;
    expect(stored.idempotency.size).toBe(601);
    await expect(activate(1)).resolves.toEqual({ ...original, replayed: true });
  });

  it('keeps the collection revision when re-activation changes nothing', async () => {
    const first = await activate(1);
    const again = await activate(1, key(70));
    expect(again).toEqual({ ...first, replayed: false });
    await expect(service.getOpenItems(scope())).resolves.toMatchObject({
      revision: 1,
    });
    // The no-op is still recorded, so a retry of its key replays it.
    await expect(activate(1, key(70))).resolves.toEqual({
      ...again,
      replayed: true,
    });
  });

  it('replays a duplicate idempotency key without applying twice', async () => {
    const original = await activate(1);
    const replayed = await activate(1);
    expect(replayed).toEqual({ ...original, replayed: true });
    const present = await service.getOpenItems(scope());
    expect(present).toMatchObject({ revision: 1 });
  });

  it('rejects an idempotency key reused for a different request', async () => {
    await activate(1);
    const body = await conflictOf(activate(2, key(1)));
    expect(body).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      currentCollectionRevision: 1,
    });
  });

  it('treats key order differences in an identical request as the same request', async () => {
    await activate(1);
    const reordered = await service.activateOpenItem(scope(), {
      presentation: { label: 'Item 1' },
      lineage: [],
      item: {
        entityId: ref(1).entityId,
        entityType: 'TASK',
      },
      idempotencyKey: key(1),
    });
    expect(reordered.replayed).toBe(true);
  });

  it('rejects item and group operations on an absent collection', async () => {
    const body = await conflictOf(
      service.createOpenItemGroup(scope(), {
        idempotencyKey: key(1),
        name: 'G',
      }),
    );
    expect(body).toEqual({
      success: false,
      code: 'COLLECTION_ABSENT',
      message: expect.any(String),
      currentCollectionRevision: null,
    });
  });

  it('does not resurrect a removed item when a delayed edit retries', async () => {
    await activate(1);
    await service.removeOpenItem(scope(), ref(1), {
      idempotencyKey: key(30),

      includeDescendants: false,
    });
    const noop = await service.setOpenItemNote(scope(), ref(1), {
      idempotencyKey: key(31),
      note: 'late',
    });
    expect(noop.collectionRevision).toBe(2);
    const present = await service.getOpenItems(scope());
    expect(present.state === 'PRESENT' && present.items).toEqual([]);
  });

  it('applies group changes and descendant membership atomically', async () => {
    await activate(1);
    await activate(2);
    const created = await service.createOpenItemGroup(scope(), {
      idempotencyKey: key(40),
      name: 'Focus',
      assign: [{ ...ref(1) }],
    });
    expect(created.items.map((row) => row.entityId)).toEqual([
      ref(1).entityId,
      ref(2).entityId,
    ]);
    const groupId = created.groups[0]!.groupId;

    const deleted = await service.deleteOpenItemGroup(scope(), groupId, {
      idempotencyKey: key(41),
    });
    expect(deleted.deletedGroupIds).toEqual([groupId]);
    const present = await service.getOpenItems(scope());
    expect(present.state === 'PRESENT' && present.groups).toEqual([]);
    expect(
      present.state === 'PRESENT' &&
        present.items.every((row) => row.groupId === null),
    ).toBe(true);
  });

  describe('migration', () => {
    const request = {
      idempotencyKey: key(50),
      sourceSchemaVersion: 1,
      groups: [{ localGroupId: 'g', name: 'Imported', collapsed: true }],
      items: [
        {
          ...ref(1),
          note: 'n',
          pinned: true,
          localGroupId: 'g',
          lineage: [],
          presentation: { label: 'One' },
        },
      ],
    };

    it('imports only when the collection is absent', async () => {
      const result = await service.migrateOpenItems(scope(), request);
      expect(result).toMatchObject({ state: 'PRESENT', revision: 1 });
      expect(result.items[0]!.groupId).toBe(result.groups[0]!.groupId);
    });

    it('lets an existing collection win, including an intentionally empty one', async () => {
      await service.resetOpenItems(scope(), {
        idempotencyKey: key(51),
      });
      const body = await conflictOf(service.migrateOpenItems(scope(), request));
      expect(body).toMatchObject({
        code: 'COLLECTION_ALREADY_EXISTS',
        currentCollectionRevision: 1,
      });
      const present = await service.getOpenItems(scope());
      expect(present).toEqual({
        state: 'PRESENT',
        revision: 1,
        items: [],
        groups: [],
      });
    });

    it('returns the recorded collection when a migration is retried', async () => {
      const first = await service.migrateOpenItems(scope(), request);
      await expect(service.migrateOpenItems(scope(), request)).resolves.toEqual(
        first,
      );
    });
  });

  describe('reset', () => {
    it('clears items and every group and reports a retried reset from its record', async () => {
      await activate(1);
      await service.createOpenItemGroup(scope(), {
        idempotencyKey: key(60),
        name: 'G',
        assign: [{ ...ref(1) }],
      });
      const reset = await service.resetOpenItems(scope(), {
        idempotencyKey: key(61),
      });
      expect(reset).toEqual({
        state: 'PRESENT',
        revision: 3,
        items: [],
        groups: [],
      });
      await activate(5, key(62));
      await expect(
        service.resetOpenItems(scope(), {
          idempotencyKey: key(61),
        }),
      ).resolves.toEqual(reset);
      const present = await service.getOpenItems(scope());
      expect(present).toMatchObject({ revision: 4 });
    });
  });
});
