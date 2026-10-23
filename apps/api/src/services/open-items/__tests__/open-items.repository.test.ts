import { Prisma } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import {
  CLEANUP_BATCH_SIZE,
  IDEMPOTENCY_RETENTION_MS,
  OpenItemsRepository,
} from '../open-items.repository';
import {
  activateOpenItem,
  removeOpenItem,
  type OpenItemsChangeSet,
} from '../open-items.domain';
import {
  env,
  group,
  item,
  key,
  NOW,
  ref,
  state,
  T0,
  uuid,
} from './open-items.fixtures';

const scope = {
  organizationId: 'org-1' as OrganizationId,
  projectId: 'project-1' as ProjectId,
  userId: 'user-1' as UserId,
};

const sqlText = (call: unknown[]) =>
  (call[0] as TemplateStringsArray).join('?');

function makeTx() {
  const calls: string[] = [];
  const record = (name: string, value: unknown = {}) =>
    jest.fn(async () => {
      calls.push(name);
      return value;
    });
  return {
    calls,
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(async (..._args: unknown[]) => 0),
    openItem: {
      findMany: jest.fn(),
      create: record('item.create'),
      update: record('item.update'),
      deleteMany: record('item.deleteMany', { count: 2 }),
    },
    openItemGroup: {
      findMany: jest.fn(),
      create: record('group.create'),
      update: record('group.update'),
      deleteMany: record('group.deleteMany', { count: 1 }),
    },
    openItemIdempotencyRecord: {
      findUnique: jest.fn(),
      create: record('idempotency.create'),
    },
    openItemCollection: { update: record('collection.update') },
  };
}

function changeSet(overrides: Partial<OpenItemsChangeSet>): OpenItemsChangeSet {
  return {
    clearCollection: false,
    createdItemIds: new Set(),
    createdGroupIds: new Set(),
    items: new Map(),
    groups: new Map(),
    deletedGroupIds: [],
    ...overrides,
  };
}

describe('OpenItemsRepository', () => {
  const prisma = {
    db: {
      $transaction: jest.fn(),
      openItemCollection: { findUnique: jest.fn() },
    },
  };
  const repository = new OpenItemsRepository(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('runs mutations in a read-committed transaction', async () => {
    prisma.db.$transaction.mockImplementation(
      async (work: (tx: string) => Promise<string>) => work('tx'),
    );
    await expect(
      repository.transaction(async (tx: string) => Promise.resolve(tx)),
    ).resolves.toBe('tx');
    expect(prisma.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15_000,
    });
  });

  describe('lockCollection', () => {
    it('inserts when absent, reports creation, and locks the row', async () => {
      const tx = makeTx();
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'c1' }])
        .mockResolvedValueOnce([{ id: 'c1', revision: BigInt(0) }]);
      await expect(repository.lockCollection(tx, scope, true)).resolves.toEqual(
        {
          id: 'c1',
          revision: 0,
          created: true,
        },
      );
      expect(sqlText(tx.$queryRaw.mock.calls[0])).toContain(
        'ON CONFLICT ("project_id", "user_id") DO NOTHING',
      );
      expect(sqlText(tx.$queryRaw.mock.calls[1])).toContain('FOR UPDATE');
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toEqual([
        scope.projectId,
        scope.userId,
      ]);
    });

    it('locks an existing collection without claiming creation', async () => {
      const tx = makeTx();
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'c1', revision: BigInt(7) }]);
      await expect(repository.lockCollection(tx, scope, true)).resolves.toEqual(
        {
          id: 'c1',
          revision: 7,
          created: false,
        },
      );
    });

    it('returns null for an absent collection when creation is not allowed', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(
        repository.lockCollection(tx, scope, false),
      ).resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  it('maps stored rows, converting bigint revisions', async () => {
    const tx = makeTx();
    const row = item(1);
    tx.openItem.findMany.mockResolvedValue([
      { ...row, collectionId: 'c1', revision: BigInt(3), createdAt: T0 },
    ]);
    tx.openItemGroup.findMany.mockResolvedValue([
      {
        ...group('g1'),
        collectionId: 'c1',
        revision: BigInt(2),
        createdAt: T0,
      },
    ]);
    const state = await repository.loadState(
      tx,
      { id: 'c1', revision: 4, created: false },
      { includeRemoved: true },
    );
    expect(state).toEqual({
      revision: 4,
      items: [{ ...row, revision: 3 }],
      groups: [{ ...group('g1'), revision: 2 }],
    });
    expect(tx.openItem.findMany).toHaveBeenCalledWith({
      where: { collectionId: 'c1' },
    });
  });

  it('reads only open items for the canonical read', async () => {
    prisma.db.openItemCollection.findUnique.mockResolvedValue({
      id: 'c1',
      revision: BigInt(2),
    });
    const tx = makeTx();
    tx.openItem.findMany.mockResolvedValue([]);
    tx.openItemGroup.findMany.mockResolvedValue([]);
    Object.assign(prisma.db, {
      openItem: tx.openItem,
      openItemGroup: tx.openItemGroup,
    });
    await expect(repository.readState(scope)).resolves.toEqual({
      revision: 2,
      items: [],
      groups: [],
    });
    expect(tx.openItem.findMany).toHaveBeenCalledWith({
      where: { collectionId: 'c1', removedAt: null },
    });
  });

  it('writes changes in foreign-key-safe order', async () => {
    const tx = makeTx();
    const newGroup = group('g-new');
    const changed = item(1, { groupId: 'g-new', memberPosition: 'V' });
    const inserted = item(2);
    await repository.applyChanges(
      tx,
      'c1',
      changeSet({
        createdGroupIds: new Set(['g-new']),
        groups: new Map([['g-new', newGroup]]),
        createdItemIds: new Set([inserted.id]),
        items: new Map([
          [changed.id, changed],
          [inserted.id, inserted],
        ]),
        deletedGroupIds: ['g-old'],
      }),
    );
    expect(tx.calls).toEqual([
      'group.create',
      'item.update',
      'item.create',
      'group.deleteMany',
    ]);
    expect(tx.openItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: inserted.id,
        collectionId: 'c1',
        entityType: 'TASK',
        revision: BigInt(1),
      }),
    });
    expect(tx.openItemGroup.deleteMany).toHaveBeenCalledWith({
      where: { collectionId: 'c1', id: { in: ['g-old'] } },
    });
  });

  it('persists inherited respacing and removal tombstones from the domain change set', async () => {
    const groupId = uuid(901);
    const parent = item(1, { groupId, memberPosition: 'z'.repeat(64) });
    const activation = activateOpenItem(
      state(4, [parent], [group(groupId)]),
      env(5),
      {
        idempotencyKey: key(1),
        item: ref(2, 'AGENT_SESSION'),
        lineage: [ref(1)],
        presentation: { label: 'Session' },
      },
    );
    const tx = makeTx();
    await repository.applyChanges(tx, 'c1', activation.changes);
    expect(tx.openItem.update).toHaveBeenCalledWith({
      where: { id: parent.id },
      data: expect.objectContaining({
        groupId,
        memberPosition: expect.any(String),
        revision: BigInt(5),
      }),
    });
    expect(tx.openItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ...ref(2, 'AGENT_SESSION'),
        groupId,
        memberPosition: expect.any(String),
        lineage: [ref(1)],
        revision: BigInt(5),
      }),
    });
    const removal = removeOpenItem(
      state(5, [...activation.changes.items.values()], [group(groupId)]),
      env(6),
      ref(1),
      {
        idempotencyKey: key(2),
        includeDescendants: true,
      },
    );
    tx.openItem.update.mockClear();
    await repository.applyChanges(tx, 'c1', removal.changes);
    expect(tx.openItem.update).toHaveBeenCalledTimes(2);
    for (const call of tx.openItem.update.mock.calls) {
      expect(call).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            groupId: null,
            memberPosition: null,
            removedAt: NOW,
            revision: BigInt(6),
          }),
        }),
      ]);
    }
  });

  it('clears items before groups on reset', async () => {
    const tx = makeTx();
    await repository.applyChanges(
      tx,
      'c1',
      changeSet({ clearCollection: true }),
    );
    expect(tx.calls).toEqual(['item.deleteMany', 'group.deleteMany']);
  });

  it('advances the collection revision', async () => {
    const tx = makeTx();
    await repository.advanceRevision(tx, 'c1', 9, NOW);
    expect(tx.openItemCollection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { revision: BigInt(9), updatedAt: NOW },
    });
  });

  it('bounds cleanup of expired removals and idempotency records to one collection', async () => {
    const tx = makeTx();
    tx.$executeRaw.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    await expect(repository.cleanup(tx, 'c1', NOW)).resolves.toEqual({
      removedItems: 3,
      idempotencyRecords: 4,
    });
    const [removals = [], idempotency = []] = tx.$executeRaw.mock.calls;
    expect(sqlText(removals)).toContain('"removed_at" IS NOT NULL');
    expect(removals).toContain(CLEANUP_BATCH_SIZE);
    expect(removals).toContain('c1');
    expect(idempotency).toContain(CLEANUP_BATCH_SIZE);
  });

  it('never deletes an idempotency record inside the retention window, however many exist', async () => {
    const tx = makeTx();
    await repository.cleanup(tx, 'c1', NOW);
    const [, idempotency = []] = tx.$executeRaw.mock.calls;
    const sql = sqlText(idempotency);
    // The only row predicate is expiry; there is no count cap.
    expect(sql).toContain('"created_at" < ?');
    expect(sql).not.toMatch(/row_number|OFFSET|recency/i);
    const cutoff = idempotency.find((value) => value instanceof Date);
    expect(cutoff).toEqual(new Date(NOW.getTime() - IDEMPOTENCY_RETENTION_MS));
  });

  it('records idempotency results under the collection and key', async () => {
    const tx = makeTx();
    await repository.recordIdempotencyResult(
      tx,
      'c1',
      'idem-key-1',
      {
        operation: 'activateOpenItem',
        requestFingerprint: 'f',
        result: { a: 1 },
      },
      NOW,
    );
    expect(tx.openItemIdempotencyRecord.create).toHaveBeenCalledWith({
      data: {
        collectionId: 'c1',
        idempotencyKey: 'idem-key-1',
        operation: 'activateOpenItem',
        requestFingerprint: 'f',
        result: { a: 1 },
        createdAt: NOW,
      },
    });
  });
});
