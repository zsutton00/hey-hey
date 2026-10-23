import * as domain from '../open-items.domain';
import {
  OpenItemsConflictException,
  OpenItemsValidationException,
} from '../open-items.errors';
import {
  env,
  group,
  item,
  key,
  NOW,
  ref,
  state,
  uuid,
} from './open-items.fixtures';

const G1 = uuid(901);
const G2 = uuid(902);

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (
      error instanceof OpenItemsConflictException ||
      error instanceof OpenItemsValidationException
    ) {
      return error.body;
    }
    throw error;
  }
  throw new Error('expected an Open Items error');
}

const mutation = (outcome: domain.OpenItemsOutcome) => {
  if (outcome.kind !== 'mutation') throw new Error('expected mutation');
  return outcome.result;
};
const collection = (outcome: domain.OpenItemsOutcome) => {
  if (outcome.kind !== 'collection') throw new Error('expected collection');
  return outcome.result;
};

describe('Open Items domain', () => {
  describe('activateOpenItem', () => {
    const presentation = { label: 'Fresh label' };

    it.each([false, true])(
      'inherits membership on activation (reopened=%s)',
      (reopened) => {
        const parent = item(1, { groupId: G1, memberPosition: 'V' });
        const rows = [parent];
        if (reopened)
          rows.push(item(2, { entityType: 'AGENT_SESSION', removedAt: NOW }));
        const outcome = domain.activateOpenItem(
          state(4, rows, [group(G1)]),
          env(5),
          {
            idempotencyKey: key(1),
            item: ref(2, 'AGENT_SESSION'),
            lineage: [ref(1)],
            presentation,
          },
        );
        const result = mutation(outcome);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          ...ref(2, 'AGENT_SESSION'),
          groupId: G1,
          lineage: [ref(1)],
          removedAt: null,
        });
        expect(result.items[0]!.memberPosition! > parent.memberPosition!).toBe(
          true,
        );
        expect(parent.revision).toBe(1);
      },
    );

    it.each([
      { nearer: item(2, { groupId: G2, memberPosition: 'V' }), expected: G2 },
      { nearer: item(2), expected: null },
      { nearer: item(2, { groupId: null, removedAt: NOW }), expected: G1 },
    ])(
      'uses only the nearest live ancestor ($expected)',
      ({ nearer, expected }) => {
        const result = mutation(
          domain.activateOpenItem(
            state(
              4,
              [item(1, { groupId: G1, memberPosition: 'V' }), nearer],
              [group(G1), group(G2)],
            ),
            env(5),
            {
              idempotencyKey: key(1),
              item: ref(3, 'AGENT_SESSION'),
              lineage: [ref(1), ref(2), ref(9)],
              presentation,
            },
          ),
        );
        expect(result.items[0]!.groupId).toBe(expected);
        expect(result.items[0]!.memberPosition === null).toBe(
          expected === null,
        );
      },
    );

    it('does not inherit from absent or removed ancestors', () => {
      const result = mutation(
        domain.activateOpenItem(
          state(4, [item(1, { removedAt: NOW })], [group(G1)]),
          env(5),
          {
            idempotencyKey: key(1),
            item: ref(2, 'AGENT_SESSION'),
            lineage: [ref(1), ref(9)],
            presentation,
          },
        ),
      );
      expect(result.items[0]).toMatchObject({
        groupId: null,
        memberPosition: null,
      });
    });

    it.each([null, G2])(
      'preserves live explicit membership %s beneath a grouped task',
      (groupId) => {
        const existing = item(2, {
          entityType: 'AGENT_SESSION',
          groupId,
          memberPosition: groupId ? 'W' : null,
        });
        const result = mutation(
          domain.activateOpenItem(
            state(
              4,
              [item(1, { groupId: G1, memberPosition: 'V' }), existing],
              [group(G1), group(G2)],
            ),
            env(5),
            {
              idempotencyKey: key(1),
              item: ref(2, 'AGENT_SESSION'),
              lineage: [ref(1)],
              presentation,
            },
          ),
        );
        expect(result.items[0]).toMatchObject({
          groupId,
          memberPosition: existing.memberPosition,
        });
      },
    );

    it('returns every respaced member when inherited ordering exhausts its bounded key', () => {
      const parent = item(1, { groupId: G1, memberPosition: 'z'.repeat(64) });
      const outcome = domain.activateOpenItem(
        state(4, [parent], [group(G1)]),
        env(5),
        {
          idempotencyKey: key(1),
          item: ref(2, 'AGENT_SESSION'),
          lineage: [ref(1)],
          presentation,
        },
      );
      const result = mutation(outcome);
      expect(result.items.map((row) => row.entityId).sort()).toEqual([
        uuid(1),
        uuid(2),
      ]);
      expect(outcome.changes.items.size).toBe(2);
      expect(
        result.items.every(
          (row) => row.revision === 5 && row.memberPosition!.length <= 64,
        ),
      ).toBe(true);
      const positions = new Map(
        result.items.map((row) => [row.entityId, row.memberPosition!]),
      );
      expect(positions.get(uuid(1))! < positions.get(uuid(2))!).toBe(true);
    });

    it('inserts an absent item at the end with server-minted revision', () => {
      const outcome = domain.activateOpenItem(state(4, [item(1)]), env(5), {
        idempotencyKey: key(1),
        item: { ...ref(2) },
        lineage: [ref(1)],
        presentation,
      });
      const result = mutation(outcome);
      expect(result.collectionRevision).toBe(5);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        ...ref(2),
        note: null,
        pinned: false,
        groupId: null,
        memberPosition: null,
        revision: 5,
        lineage: [ref(1)],
        presentation,
        removedAt: null,
      });
      expect(result.items[0]!.position > item(1).position).toBe(true);
      expect(outcome.changes.createdItemIds.size).toBe(1);
    });

    it('refreshes lineage and presentation without touching note, pin, order, or membership', () => {
      const existing = item(1, {
        note: 'why',
        pinned: true,
        groupId: G1,
        memberPosition: 'V',
        revision: 3,
      });
      const result = mutation(
        domain.activateOpenItem(state(4, [existing], [group(G1)]), env(5), {
          idempotencyKey: key(1),
          item: { ...ref(1) },
          lineage: [ref(7)],
          presentation,
        }),
      );
      expect(result.items[0]).toMatchObject({
        note: 'why',
        pinned: true,
        position: existing.position,
        groupId: G1,
        memberPosition: 'V',
        lineage: [ref(7)],
        presentation,
        revision: 5,
      });
    });

    it('reports an unchanged re-activation without advancing any revision', () => {
      const existing = item(1, { revision: 3 });
      const outcome = domain.activateOpenItem(state(4, [existing]), env(5), {
        idempotencyKey: key(1),
        item: { ...ref(1) },
        lineage: [],
        presentation: { label: 'Item 1' },
      });
      expect(outcome.kind).toBe('unchanged');
      expect(outcome.result).toMatchObject({
        collectionRevision: 4,
        items: [expect.objectContaining({ ...ref(1), revision: 3 })],
        replayed: false,
      });
      expect(outcome.changes.items.size).toBe(0);
    });

    it('revives a removed tombstone as a fresh row', () => {
      const tombstone = item(1, {
        note: null,
        removedAt: NOW,
        revision: 3,
        pinned: true,
      });
      const result = mutation(
        domain.activateOpenItem(state(4, [tombstone, item(2)]), env(5), {
          idempotencyKey: key(1),
          item: { ...ref(1) },
          lineage: [],
          presentation,
        }),
      );
      expect(result.items[0]).toMatchObject({
        removedAt: null,
        pinned: false,
        revision: 5,
      });
      expect(result.items[0]!.position > item(2).position).toBe(true);
    });

    it('enforces the open item limit', () => {
      const many = Array.from({ length: domain.MAX_OPEN_ITEMS }, (_, n) =>
        item(n + 10),
      );
      const body = captureError(() =>
        domain.activateOpenItem(state(4, many), env(5), {
          idempotencyKey: key(1),
          item: { ...ref(1) },
          lineage: [],
          presentation,
        }),
      );
      expect(body.code).toBe('COLLECTION_LIMIT_EXCEEDED');
    });
  });

  describe('item-addressed premises', () => {
    it('stores a single cleared-note value for both null and empty string', () => {
      for (const note of [null, '']) {
        const result = mutation(
          domain.setOpenItemNote(
            state(4, [item(1, { note: 'old', revision: 2 })]),
            env(5),
            ref(1),
            { idempotencyKey: key(1), note },
          ),
        );
        expect(result.items[0]!.note).toBeNull();
      }
    });
  });

  describe('removeOpenItem', () => {
    it('removes same-group and ungrouped descendants while retaining pinned, different-group, and unrelated rows', () => {
      const rows = [
        item(1, { groupId: G1, memberPosition: 'V', pinned: true }),
        item(2, { parents: [1], groupId: G1, memberPosition: 'W' }),
        item(3, { parents: [1, 2] }),
        item(4, {
          parents: [1],
          pinned: true,
          groupId: G1,
          memberPosition: 'X',
        }),
        item(5, { parents: [1, 2], groupId: G2, memberPosition: 'V' }),
        item(6, { groupId: G1, memberPosition: 'Y' }),
        item(7, { parents: [1], pinned: true }),
      ];
      const outcome = domain.removeOpenItem(
        state(4, rows, [group(G1), group(G2)]),
        env(5),
        ref(1),
        {
          idempotencyKey: key(1),
          includeDescendants: true,
        },
      );
      expect(mutation(outcome).items.map((row) => row.entityId)).toEqual([
        uuid(1),
        uuid(2),
        uuid(3),
      ]);
      expect(
        mutation(outcome).items.every(
          (row) =>
            row.removedAt === NOW.toISOString() &&
            row.groupId === null &&
            row.memberPosition === null,
        ),
      ).toBe(true);
      expect(rows.every((row) => row.removedAt === null)).toBe(true);
    });

    const parent = () => item(1, { revision: 2 });
    const child = () => item(2, { parents: [1] });
    const pinnedChild = () => item(3, { parents: [1], pinned: true });
    const groupedGrandchild = () =>
      item(4, { parents: [1, 2], groupId: G1, memberPosition: 'V' });
    const grandchild = () => item(5, { parents: [1, 2] });
    const unrelated = () => item(6);

    it('removes only the item without includeDescendants', () => {
      const result = mutation(
        domain.removeOpenItem(state(4, [parent(), child()]), env(5), ref(1), {
          idempotencyKey: key(1),

          includeDescendants: false,
        }),
      );
      expect(result.items.map((row) => row.entityId)).toEqual([uuid(1)]);
      expect(result.items[0]!.removedAt).toBe(NOW.toISOString());
    });

    it('removes open nested descendants from stored lineage, retaining pinned or grouped ones', () => {
      const result = mutation(
        domain.removeOpenItem(
          state(
            4,
            [
              parent(),
              child(),
              pinnedChild(),
              groupedGrandchild(),
              grandchild(),
              unrelated(),
            ],
            [group(G1)],
          ),
          env(5),
          ref(1),
          {
            idempotencyKey: key(1),

            includeDescendants: true,
          },
        ),
      );
      expect(result.items.map((row) => row.entityId).sort()).toEqual(
        [uuid(1), uuid(2), uuid(5)].sort(),
      );
      expect(result.items.every((row) => row.removedAt !== null)).toBe(true);
      expect(result.items.every((row) => row.revision === 5)).toBe(true);
    });

    it('ungroups a removed grouped item so the tombstone holds no membership', () => {
      const result = mutation(
        domain.removeOpenItem(
          state(
            4,
            [item(1, { groupId: G1, memberPosition: 'V' })],
            [group(G1)],
          ),
          env(5),
          ref(1),
          {
            idempotencyKey: key(1),

            includeDescendants: false,
          },
        ),
      );
      expect(result.items[0]).toMatchObject({
        groupId: null,
        memberPosition: null,
      });
    });
  });

  describe('ordering', () => {
    const rows = () => [item(1), item(2), item(3)];

    it('moves an item after another, rewriting only the moved row', () => {
      const outcome = domain.moveOpenItem(state(4, rows()), env(5), ref(3), {
        idempotencyKey: key(1),

        after: ref(1),
      });
      const result = mutation(outcome);
      expect(result.items).toHaveLength(1);
      const moved = result.items[0]!.position;
      expect(moved > item(1).position && moved < item(2).position).toBe(true);
    });

    it('moves an item first when after is null', () => {
      const result = mutation(
        domain.moveOpenItem(state(4, rows()), env(5), ref(3), {
          idempotencyKey: key(1),

          after: null,
        }),
      );
      expect(result.items[0]!.position < item(1).position).toBe(true);
    });

    it('rejects placing an item after itself', () => {
      const body = captureError(() =>
        domain.moveOpenItem(state(4, rows()), env(5), ref(3), {
          idempotencyKey: key(1),

          after: ref(3),
        }),
      );
      expect(body.code).toBe('INVALID_PLACEMENT');
    });

    it('respaces the sequence when a key would exceed the contract length', () => {
      const crowded = [
        item(1, { position: 'V' }),
        item(2, { position: `V${'0'.repeat(63)}1`.slice(0, 64) }),
        item(3, { position: 'W' }),
      ];
      const result = mutation(
        domain.moveOpenItem(state(4, crowded), env(5), ref(3), {
          idempotencyKey: key(1),

          after: ref(1),
        }),
      );
      const positions = new Map(
        result.items.map((row) => [row.entityId, row.position]),
      );
      expect(result.items.length).toBeGreaterThan(1);
      const order = [uuid(1), uuid(3), uuid(2)].map(
        (id) =>
          positions.get(id) ??
          crowded.find((row) => row.entityId === id)!.position,
      );
      expect([...order].sort()).toEqual(order);
      expect(result.items.every((row) => row.position.length <= 64)).toBe(true);
    });

    it('reorders groups relative to current neighbors', () => {
      const result = mutation(
        domain.moveOpenItemGroup(
          state(
            4,
            [],
            [group(G1, { position: 'V' }), group(G2, { position: 'W' })],
          ),
          env(5),
          G2,
          {
            idempotencyKey: key(1),

            afterGroupId: null,
          },
        ),
      );
      expect(result.groups[0]!.groupId).toBe(G2);
      expect(result.groups[0]!.position < 'V').toBe(true);
    });

    it('reorders members within their group only', () => {
      const members = [
        item(1, { groupId: G1, memberPosition: 'V' }),
        item(2, { groupId: G1, memberPosition: 'W' }),
        item(3, { groupId: G2, memberPosition: 'V' }),
      ];
      const result = mutation(
        domain.moveOpenItemGroupMember(
          state(4, members, [group(G1), group(G2)]),
          env(5),
          G1,
          ref(2),
          {
            idempotencyKey: key(1),

            after: null,
          },
        ),
      );
      expect(result.items[0]!.memberPosition! < 'V').toBe(true);
      expect(result.items[0]!.position).toBe(members[1]!.position);

      const noop = domain.moveOpenItemGroupMember(
        state(4, members, [group(G1), group(G2)]),
        env(5),
        G1,
        ref(2),
        { idempotencyKey: key(2), after: ref(3) },
      );
      expect(noop.kind).toBe('unchanged');
    });
  });

  describe('groups', () => {
    it('assignment still expands over all currently open nested descendants', () => {
      const result = mutation(
        domain.assignOpenItemsToGroup(
          state(
            4,
            [
              item(1),
              item(2, { parents: [1], pinned: true }),
              item(3, { parents: [1, 2], groupId: G2, memberPosition: 'V' }),
              item(4, { parents: [1], removedAt: NOW }),
              item(5),
            ],
            [group(G1), group(G2)],
          ),
          env(5),
          G1,
          { idempotencyKey: key(1), items: [ref(1)] },
        ),
      );
      expect(result.items.map((row) => row.entityId)).toEqual([
        uuid(1),
        uuid(2),
        uuid(3),
      ]);
      expect(
        result.items.every(
          (row) => row.groupId === G1 && row.memberPosition !== null,
        ),
      ).toBe(true);
    });

    it('creates a group and assigns selected items with their open descendants', () => {
      const outcome = domain.createOpenItemGroup(
        state(4, [item(1), item(2, { parents: [1] }), item(3)]),
        env(5),
        {
          idempotencyKey: key(1),
          name: '  Review  ',
          assign: [{ ...ref(1) }],
        },
      );
      const result = mutation(outcome);
      expect(result.groups).toHaveLength(1);
      const created = result.groups[0]!;
      expect(created).toMatchObject({
        name: 'Review',
        collapsed: false,
        revision: 5,
      });
      expect(result.items.map((row) => row.entityId)).toEqual([
        uuid(1),
        uuid(2),
      ]);
      expect(result.items.every((row) => row.groupId === created.groupId)).toBe(
        true,
      );
      expect(
        result.items[0]!.memberPosition! < result.items[1]!.memberPosition!,
      ).toBe(true);
    });

    it('rejects a blank group name', () => {
      const body = captureError(() =>
        domain.createOpenItemGroup(state(4), env(5), {
          idempotencyKey: key(1),
          name: '   ',
        }),
      );
      expect(body.code).toBe('INVALID_REQUEST');
    });

    it('enforces the group limit', () => {
      const groups = Array.from(
        { length: domain.MAX_OPEN_ITEM_GROUPS },
        (_, n) => group(uuid(5000 + n)),
      );
      const body = captureError(() =>
        domain.createOpenItemGroup(state(4, [], groups), env(5), {
          idempotencyKey: key(1),
          name: 'One more',
        }),
      );
      expect(body.code).toBe('COLLECTION_LIMIT_EXCEEDED');
    });

    it('assignment replaces prior membership so an item has at most one group', () => {
      const result = mutation(
        domain.assignOpenItemsToGroup(
          state(
            4,
            [item(1, { groupId: G1, memberPosition: 'V' })],
            [group(G1), group(G2)],
          ),
          env(5),
          G2,
          {
            idempotencyKey: key(1),
            items: [{ ...ref(1) }],
          },
        ),
      );
      expect(result.items[0]).toMatchObject({ groupId: G2, revision: 5 });
    });

    it('rename and disclosure apply to the current group', () => {
      const groups = [group(G1, { revision: 3 })];
      const renamed = mutation(
        domain.renameOpenItemGroup(state(4, [], groups), env(5), G1, {
          idempotencyKey: key(1),

          name: 'New',
        }),
      );
      expect(renamed.groups[0]).toMatchObject({ name: 'New', revision: 5 });

      const collapsed = mutation(
        domain.setOpenItemGroupDisclosure(state(4, [], groups), env(5), G1, {
          idempotencyKey: key(1),

          collapsed: true,
        }),
      );
      expect(collapsed.groups[0]!.collapsed).toBe(true);
    });

    it('deleting a group ungroups its members without removing them', () => {
      const outcome = domain.deleteOpenItemGroup(
        state(
          4,
          [item(1, { groupId: G1, memberPosition: 'V' }), item(2)],
          [group(G1, { revision: 2 })],
        ),
        env(5),
        G1,
        { idempotencyKey: key(1) },
      );
      const result = mutation(outcome);
      expect(result.deletedGroupIds).toEqual([G1]);
      expect(result.groups).toEqual([]);
      expect(result.items).toEqual([
        expect.objectContaining({
          ...ref(1),
          groupId: null,
          memberPosition: null,
          removedAt: null,
        }),
      ]);
    });

    it('ungroups selected items', () => {
      const result = mutation(
        domain.ungroupOpenItems(
          state(
            4,
            [item(1, { groupId: G1, memberPosition: 'V' })],
            [group(G1)],
          ),
          env(5),
          {
            idempotencyKey: key(1),
            items: [{ ...ref(1) }],
          },
        ),
      );
      expect(result.items[0]).toMatchObject({
        groupId: null,
        memberPosition: null,
      });
      expect(result.groups.map((row) => row.groupId)).toEqual([G1]);
    });
  });

  describe('migrateOpenItems', () => {
    const base = {
      idempotencyKey: key(1),
      sourceSchemaVersion: 2,
    };
    const migrated = (
      n: number,
      localGroupId: string | null,
      note: string | null = null,
    ) => ({
      ...ref(n),
      note,
      pinned: n === 2,
      localGroupId,
      lineage: [],
      presentation: { label: `Item ${n}` },
    });

    it('imports items and groups preserving order, membership, and minting revision 1', () => {
      const result = collection(
        domain.migrateOpenItems(state(0), env(1), {
          ...base,
          groups: [
            { localGroupId: 'b', name: 'Second', collapsed: true },
            { localGroupId: 'a', name: 'First', collapsed: false },
          ],
          items: [
            migrated(1, 'a', ''),
            migrated(2, null, 'keep'),
            migrated(3, 'a'),
            migrated(4, 'b'),
          ],
        }),
      );
      expect(result.revision).toBe(1);
      expect(result.items.map((row) => row.entityId)).toEqual(
        [1, 2, 3, 4].map(uuid),
      );
      expect(result.groups.map((row) => row.name)).toEqual(['Second', 'First']);
      const first = result.groups[1]!.groupId;
      const members = result.items.filter((row) => row.groupId === first);
      expect(members.map((row) => row.entityId)).toEqual([uuid(1), uuid(3)]);
      expect(members[0]!.memberPosition! < members[1]!.memberPosition!).toBe(
        true,
      );
      expect(result.items[0]!.note).toBeNull();
      expect(result.items[1]).toMatchObject({ note: 'keep', pinned: true });
      expect(result.items.every((row) => row.revision === 1)).toBe(true);
      expect(result.groups.every((row) => row.revision === 1)).toBe(true);
    });

    it('rejects membership that does not resolve within the payload', () => {
      const body = captureError(() =>
        domain.migrateOpenItems(state(0), env(1), {
          ...base,
          groups: [{ localGroupId: 'a', name: 'A', collapsed: false }],
          items: [migrated(1, 'missing')],
        }),
      );
      expect(body).toMatchObject({
        code: 'INVALID_MIGRATION_MEMBERSHIP',
        violations: [
          { path: '/items/0/localGroupId', message: expect.any(String) },
        ],
      });
    });

    it('rejects duplicate local group ids and duplicate item identities', () => {
      expect(
        captureError(() =>
          domain.migrateOpenItems(state(0), env(1), {
            ...base,
            groups: [
              { localGroupId: 'a', name: 'A', collapsed: false },
              { localGroupId: 'a', name: 'B', collapsed: false },
            ],
            items: [],
          }),
        ).code,
      ).toBe('INVALID_MIGRATION_MEMBERSHIP');
      expect(
        captureError(() =>
          domain.migrateOpenItems(state(0), env(1), {
            ...base,
            groups: [],
            items: [migrated(1, null), migrated(1, null)],
          }),
        ).code,
      ).toBe('INVALID_REQUEST');
    });
  });

  describe('resetOpenItems', () => {
    it('clears every item and group', () => {
      const outcome = domain.resetOpenItems(
        state(4, [item(1, { groupId: G1, memberPosition: 'V' })], [group(G1)]),
        env(5),
        { idempotencyKey: key(1) },
        false,
      );
      expect(collection(outcome)).toEqual({
        state: 'PRESENT',
        revision: 5,
        items: [],
        groups: [],
      });
      expect(outcome.changes.clearCollection).toBe(true);
    });

    it('creates an intentionally empty collection from an observed ABSENT', () => {
      const outcome = domain.resetOpenItems(
        state(0),
        env(1),
        { idempotencyKey: key(1) },
        true,
      );
      expect(collection(outcome).revision).toBe(1);
    });
  });

  it('applies overlapping pin and note intent to the current item', () => {
    const initial = state(4, [item(1)]);
    const pinned = domain.setOpenItemPin(initial, env(5), ref(1), {
      idempotencyKey: key(1),
      pinned: true,
    });
    const current = state(5, [...pinned.changes.items.values()]);
    const noted = mutation(
      domain.setOpenItemNote(current, env(6), ref(1), {
        idempotencyKey: key(2),
        note: 'keep',
      }),
    );
    expect(noted.items[0]).toMatchObject({
      pinned: true,
      note: 'keep',
      revision: 6,
    });
  });

  it('returns canonical no-ops for missing and removed item and group targets', () => {
    for (const current of [state(4), state(4, [item(1, { removedAt: NOW })])]) {
      for (const outcome of [
        domain.setOpenItemNote(current, env(5), ref(1), {
          idempotencyKey: key(1),
          note: 'x',
        }),
        domain.setOpenItemPin(current, env(5), ref(1), {
          idempotencyKey: key(2),
          pinned: true,
        }),
        domain.removeOpenItem(current, env(5), ref(1), {
          idempotencyKey: key(3),
          includeDescendants: true,
        }),
        domain.renameOpenItemGroup(current, env(5), G1, {
          idempotencyKey: key(4),
          name: 'New',
        }),
        domain.assignOpenItemsToGroup(current, env(5), G1, {
          idempotencyKey: key(5),
          items: [ref(1)],
        }),
      ]) {
        expect(outcome.kind).toBe('unchanged');
        expect(outcome.result).toMatchObject({ collectionRevision: 4 });
        expect(outcome.changes.items.size).toBe(0);
      }
    }
  });

  it('reads return open items only, in position order', () => {
    const present = domain.toPresentCollection(
      state(
        4,
        [item(3), item(1), item(2, { removedAt: NOW })],
        [group(G2, { position: 'W' }), group(G1)],
      ),
    );
    expect(present.items.map((row) => row.entityId)).toEqual([
      uuid(1),
      uuid(3),
    ]);
    expect(present.groups.map((row) => row.groupId)).toEqual([G1, G2]);
  });
});
