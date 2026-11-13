import { OpenItemsRepository } from '../open-items.repository';
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
  sessions = new Map<string, { id: string; title: string | null }>();
  async sessionConversations(
    _tx: unknown,
    _scope: OpenItemsScope,
    ids: string[],
  ) {
    return new Map(
      ids.flatMap((id) => {
        const conversation = this.sessions.get(id);
        return conversation ? [[id, conversation] as const] : [];
      }),
    );
  }
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

  it('backfills all legacy session kinds without changing labels or organization, then refreshes only the authoritative title', async () => {
    const publish = jest.fn();
    service = new OpenItemsService(
      repository as unknown as OpenItemsRepository,
      { publishOpenItemsChanged: publish } as never,
    );
    await activate(1);
    const group = await service.createOpenItemGroup(scope(), {
      idempotencyKey: key(70),
      name: 'Review',
    });
    const groupId = group.groups[0].groupId;
    const types = [
      'CODING',
      'ENTITY_CONVERSATION',
      'PROJECT_CONVERSATION',
      'OPEN_ITEMS_TRIAGE',
    ];
    for (const [index, type] of types.entries()) {
      await service.activateOpenItem(scope(), {
        idempotencyKey: key(80 + index),
        item: ref(10 + index, 'AGENT_SESSION'),
        lineage: [ref(1)],
        presentation: { label: `Old ${type}`, agentSessionType: type },
      });
      repository.sessions.set(ref(10 + index).entityId, {
        id: ref(100 + index).entityId,
        title: `Conversation ${type}`,
      });
    }
    await service.setOpenItemNote(scope(), ref(10, 'AGENT_SESSION'), {
      idempotencyKey: key(90),
      note: 'Keep this review context',
    });
    await service.setOpenItemPin(scope(), ref(10, 'AGENT_SESSION'), {
      idempotencyKey: key(91),
      pinned: true,
    });
    await service.assignOpenItemsToGroup(scope(), groupId, {
      idempotencyKey: key(92),
      items: [ref(10, 'AGENT_SESSION')],
    });
    const before = await repository.readState(scope());
    const enriched = await service.getOpenItems(scope());
    expect(enriched.state).toBe('PRESENT');
    if (enriched.state !== 'PRESENT') {
      throw new Error('missing collection');
    }
    expect(
      enriched.items
        .filter((item) => item.entityType === 'AGENT_SESSION')
        .map((item) => item.presentation.conversationId),
    ).toEqual(types.map((_type, index) => ref(100 + index).entityId));
    expect(enriched.items.map((item) => item.presentation.label)).toEqual(
      before!.items.map((item) => item.presentation.label),
    );
    const oldRow = enriched.items.find(
      (item) => item.entityId === ref(10).entityId,
    )!;
    const request = { idempotencyKey: key(93) };
    repository.sessions.set(ref(10).entityId, {
      id: ref(100).entityId,
      title: 'Latest renamed conversation',
    });
    const saved = await service.refreshOpenItemPresentation(
      scope(),
      ref(10, 'AGENT_SESSION'),
      request,
    );
    expect(saved.items[0]).toEqual({
      ...oldRow,
      revision: saved.collectionRevision,
      updatedAt: expect.any(String),
      presentation: {
        ...oldRow.presentation,
        label: 'Latest renamed conversation',
      },
    });
    const calls = publish.mock.calls.length;
    repository.sessions.set(ref(10).entityId, {
      id: ref(100).entityId,
      title: 'An even newer title',
    });
    const replay = await service.refreshOpenItemPresentation(
      scope(),
      ref(10, 'AGENT_SESSION'),
      request,
    );
    expect(replay).toMatchObject({ ...saved, replayed: true });
    expect(publish).toHaveBeenCalledTimes(calls);
    const latest = await service.refreshOpenItemPresentation(
      scope(),
      ref(10, 'AGENT_SESSION'),
      { idempotencyKey: key(94) },
    );
    expect(latest.items[0].presentation.label).toBe('An even newer title');
    expect(
      publish.mock.calls.every(
        (call) =>
          call.length === 3 &&
          call[0] === scope().userId &&
          call[1] === scope().projectId,
      ),
    ).toBe(true);
    await service.removeOpenItem(scope(), ref(10, 'AGENT_SESSION'), {
      idempotencyKey: key(95),
      includeDescendants: false,
    });
    const removed = await service.refreshOpenItemPresentation(
      scope(),
      ref(10, 'AGENT_SESSION'),
      { idempotencyKey: key(96) },
    );
    expect(removed.items).toEqual([]);
    const restored = await service.getOpenItems(scope());
    expect(
      restored.state === 'PRESENT' &&
        restored.items.some((item) => item.entityId === ref(10).entityId),
    ).toBe(false);
  });

  it('leaves sessions without a conversation ineligible and isolates working sets', async () => {
    await service.activateOpenItem(scope(), {
      idempotencyKey: key(97),
      item: ref(10, 'AGENT_SESSION'),
      lineage: [],
      presentation: { label: 'Untitled session', agentSessionType: 'CODING' },
    });
    await activate(1, key(98), scope('other-user'));
    const collection = await service.getOpenItems(scope());
    expect(collection).toMatchObject({
      items: [
        { presentation: { conversationId: null, label: 'Untitled session' } },
      ],
    });
    const other = await service.refreshOpenItemPresentation(
      scope('other-user'),
      ref(10, 'AGENT_SESSION'),
      { idempotencyKey: key(99) },
    );
    expect(other.items).toEqual([]);
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

  it('records another canonical visit while keeping retries idempotent', async () => {
    const first = await activate(1);
    const again = await activate(1, key(70));
    expect(again.items[0]!).toMatchObject({
      entityId: first.items[0]!.entityId,
      position: first.items[0]!.position,
    });
    expect(again.collectionRevision).toBe(2);
    await expect(service.getOpenItems(scope())).resolves.toMatchObject({
      revision: 2,
    });
    // A retry replays that visit, rather than recording another one.
    await expect(activate(1, key(70))).resolves.toEqual({
      ...again,
      replayed: true,
    });
  });

  it('commits coordinator insertion and protected eviction together in a populated working set', async () => {
    jest.useFakeTimers();
    try {
      for (let n = 1; n <= 100; n++) {
        jest.setSystemTime(new Date(Date.UTC(2026, 10, 13, 0, 0, n)));
        await activate(n);
      }
      await service.setOpenItemPin(scope(), ref(1), {
        idempotencyKey: 'protect-pin',
        pinned: true,
      });
      await service.setOpenItemNote(scope(), ref(2), {
        idempotencyKey: 'protect-note',
        note: 'Awaiting review',
      });
      await service.createOpenItemGroup(scope(), {
        idempotencyKey: 'protect-group',
        name: 'Review',
        assign: [ref(3)],
      });
      jest.setSystemTime(new Date('2026-11-13T01:00:00Z'));
      const revisited = await activate(4, 'revisit-four');
      const inserted = await service.activateOpenItem(scope(), {
        idempotencyKey: 'start-eval',
        item: ref(101, 'AGENT_SESSION'),
        lineage: [ref(4)],
        presentation: {
          label: 'Eval run',
          agentSessionType: 'PROJECT_CONVERSATION',
        },
      });
      expect(
        inserted.items.find((row) => row.removedAt !== null)?.entityId,
      ).toBe(ref(5).entityId);
      expect(
        inserted.items.find((row) => row.entityType === 'AGENT_SESSION'),
      ).toMatchObject({ lineage: [ref(4)], removedAt: null });
      const current = await service.getOpenItems(scope());
      if (current.state !== 'PRESENT') {
        throw new Error('Expected persisted collection');
      }
      expect(current.items).toHaveLength(100);
      expect(
        current.items.find((row) => row.entityId === ref(1).entityId)?.pinned,
      ).toBe(true);
      expect(
        current.items.find((row) => row.entityId === ref(2).entityId)?.note,
      ).toBe('Awaiting review');
      expect(
        current.items.find((row) => row.entityId === ref(3).entityId)?.groupId,
      ).not.toBeNull();
      expect(
        current.items.find((row) => row.entityId === ref(4).entityId)?.position,
      ).toBe(revisited.items[0]!.position);
      const revision = current.revision;
      await expect(
        service.activateOpenItem(scope(), {
          idempotencyKey: 'start-eval',
          item: ref(101, 'AGENT_SESSION'),
          lineage: [ref(4)],
          presentation: {
            label: 'Eval run',
            agentSessionType: 'PROJECT_CONVERSATION',
          },
        }),
      ).resolves.toMatchObject({
        replayed: true,
        collectionRevision: revision,
      });
      const replayedCollection = await service.getOpenItems(scope());
      expect(
        replayedCollection.state === 'PRESENT'
          ? replayedCollection.revision
          : null,
      ).toBe(revision);
    } finally {
      jest.useRealTimers();
    }
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

describe('authoritative session conversation lookup', () => {
  it('bounds the batch and scopes both session and conversation to the authorized project and organization', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: ref(1).entityId,
        conversation: {
          id: ref(2).entityId,
          title: 'Current conversation title',
        },
      },
    ]);
    const repository = new OpenItemsRepository({} as never);
    const conversations = await repository.sessionConversations(
      { agentSession: { findMany } } as never,
      scope(),
      [ref(1).entityId],
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [ref(1).entityId] },
        organizationId: scope().organizationId,
        projectId: scope().projectId,
        conversation: {
          organizationId: scope().organizationId,
          projectId: scope().projectId,
        },
      },
      select: { id: true, conversation: { select: { id: true, title: true } } },
      take: 100,
    });
    expect(conversations.get(ref(1).entityId)).toEqual({
      id: ref(2).entityId,
      title: 'Current conversation title',
    });
  });
});
