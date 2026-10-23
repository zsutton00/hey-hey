import type {
  OpenItemRef,
  PromoteGroupToGoalRequest,
} from '../../../generated';
import type { OrganizationId, ProjectId, UserId } from '../../../types';
import type { TaskService } from '../../tasks/task.service';
import type { GoalTracksService } from '../../tasks/goal-tracks.service';
import type { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { OpenItemsGoalPromotionService } from '../open-items-goal-promotion.service';
import type {
  OpenItemsRepository,
  OpenItemsIdempotencyRecord,
} from '../open-items.repository';
import type { OpenItemsChangeSet } from '../open-items.domain';
import { env, group, item, ref, state, uuid } from './open-items.fixtures';
import {
  activateOpenItem,
  publishGroupPromotion,
  setOpenItemGoalDisclosure,
  setOpenItemGoalFilter,
} from '../open-items.domain';
import { parseOpenItemsRequest } from '../open-items.boundary';

const scope = {
  organizationId: uuid(10) as OrganizationId,
  projectId: uuid(11) as ProjectId,
  userId: uuid(12) as UserId,
};
const request: PromoteGroupToGoalRequest = {
  groupId: uuid(90),
  goalName: 'Outcome',
  idempotencyKey: 'promotion-key',
};

function setup() {
  let stored = state(
    4,
    [
      item(1, { groupId: request.groupId }),
      item(2, { groupId: request.groupId }),
    ],
    [group(request.groupId)],
  );
  let record: OpenItemsIdempotencyRecord | null = null;
  let createdGoals: string[] = [];
  let inTransaction = false;
  let failPublication = false;
  const repository = {
    transaction: async <T>(work: (tx: object) => Promise<T>) => {
      const previous = structuredClone({ stored, record, createdGoals });
      inTransaction = true;
      try {
        return await work({});
      } catch (error) {
        ({ stored, record, createdGoals } = previous);
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    lockCollection: async () => ({
      id: 'collection',
      revision: stored.revision,
      created: false,
    }),
    loadState: async () => structuredClone(stored),
    findIdempotencyRecord: async () => record,
    recordIdempotencyResult: async (
      _tx: object,
      _id: string,
      _key: string,
      next: OpenItemsIdempotencyRecord,
    ) => {
      record = next;
    },
    replaceIdempotencyResult: async (
      _tx: object,
      _id: string,
      _key: string,
      next: unknown,
    ) => {
      record = { ...record!, result: next };
    },
    applyChanges: async (
      _tx: object,
      _id: string,
      changes: OpenItemsChangeSet,
    ) => {
      if (failPublication) throw new Error('database publication failed');
      for (const row of changes.items.values()) {
        stored.items = [
          ...stored.items.filter((item) => item.id !== row.id),
          row,
        ];
      }
      stored.groups = stored.groups.filter(
        (group) => !changes.deletedGroupIds.includes(group.id),
      );
    },
    advanceRevision: async (_tx: object, _id: string, revision: number) => {
      stored.revision = revision;
    },
  };
  const tasks = {
    createInTransaction: jest.fn(async () => {
      createdGoals.push(uuid(80));
      return { id: uuid(80), name: 'Outcome' };
    }),
  };
  const attached = new Set<string>();
  const tracks = {
    eligibleGoalMembers: jest.fn(
      async (_org: string, _project: string, members: OpenItemRef[]) =>
        members.filter((m) => m.entityId === uuid(1)),
    ),
    attachToGoal: jest.fn(
      async (
        _org: string,
        _project: string,
        _goal: string,
        target: { targetEntityId: string },
      ) => {
        expect(inTransaction).toBe(false);
        attached.add(target.targetEntityId);
      },
    ),
  };
  const gateway = {
    publishOpenItemsChanged: jest.fn(() => {
      expect(inTransaction).toBe(false);
    }),
  };
  const service = new OpenItemsGoalPromotionService(
    repository as unknown as OpenItemsRepository,
    tasks as unknown as TaskService,
    tracks as unknown as GoalTracksService,
    gateway as unknown as WebsocketGateway,
  );
  return {
    service,
    tasks,
    tracks,
    gateway,
    attached,
    current: () => stored,
    goals: () => createdGoals,
    failPublication: (value: boolean) => {
      failPublication = value;
    },
    removeGroup: () => {
      stored.groups = [];
    },
  };
}

describe('ordered group promotion', () => {
  it('rejects a missing group before creating a Goal', async () => {
    const h = setup();
    h.removeGroup();
    await expect(
      h.service.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toMatchObject({ body: { code: 'GROUP_NOT_FOUND' } });
    expect(h.tasks.createInTransaction).not.toHaveBeenCalled();
    expect(h.gateway.publishOpenItemsChanged).not.toHaveBeenCalled();
  });

  it('publishes once, leaves ineligible members ungrouped and replays without duplicates', async () => {
    const h = setup();
    const result = await h.service.promoteGroupToGoal(scope, request, 'token');
    expect(result.collection.revision).toBe(5);
    expect(result.collection.groups).toEqual([]);
    expect(result.collection.items).toHaveLength(2);
    expect(
      result.collection.items.find((row) => row.entityId === uuid(2)),
    ).toMatchObject({ groupId: null });
    expect(
      result.collection.items.find((row) => row.entityId === uuid(80)),
    ).toMatchObject({
      pinned: true,
      goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
      goalCollapsed: true,
    });
    expect(result.untrackedMembers).toEqual([ref(2)]);
    expect(await h.service.promoteGroupToGoal(scope, request, 'token')).toEqual(
      { ...result, replayed: true },
    );
    expect(h.tasks.createInTransaction).toHaveBeenCalledTimes(1);
    expect(h.tracks.attachToGoal).toHaveBeenCalledTimes(1);
    expect(h.gateway.publishOpenItemsChanged).toHaveBeenCalledTimes(1);
    expect(h.gateway.publishOpenItemsChanged).toHaveBeenCalledWith(
      scope.userId,
      scope.projectId,
      5,
    );
    await expect(
      h.service.promoteGroupToGoal(
        scope,
        { ...request, goalName: 'Different' },
        'token',
      ),
    ).rejects.toMatchObject({ body: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('retains the Goal after graph failure and retries using that Goal', async () => {
    const h = setup();
    h.tracks.attachToGoal.mockRejectedValueOnce(new Error('graph unavailable'));
    const before = structuredClone(h.current());
    await expect(
      h.service.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('graph unavailable');
    expect(h.goals()).toEqual([uuid(80)]);
    expect(h.current()).toEqual(before);
    expect(h.gateway.publishOpenItemsChanged).not.toHaveBeenCalled();
    await h.service.promoteGroupToGoal(scope, request, 'token');
    expect(h.tasks.createInTransaction).toHaveBeenCalledTimes(1);
  });

  it('retains Goal/TRACKS after database failure with no collection publication', async () => {
    const h = setup();
    h.failPublication(true);
    const before = structuredClone(h.current());
    await expect(
      h.service.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('database publication failed');
    expect(h.goals()).toHaveLength(1);
    expect(h.attached).toEqual(new Set([uuid(1)]));
    expect(h.current()).toEqual(before);
    expect(h.gateway.publishOpenItemsChanged).not.toHaveBeenCalled();
    h.failPublication(false);
    await h.service.promoteGroupToGoal(scope, request, 'token');
    expect(h.goals()).toHaveLength(1);
    expect(h.attached.size).toBe(1);
  });

  it('leaves no Goal or collection changes when Goal creation fails', async () => {
    const h = setup();
    h.tasks.createInTransaction.mockRejectedValueOnce(
      new Error('Goal create failed'),
    );
    const before = structuredClone(h.current());
    await expect(
      h.service.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('Goal create failed');
    expect(h.current()).toEqual(before);
    expect(h.goals()).toEqual([]);
    expect(h.tracks.attachToGoal).not.toHaveBeenCalled();
  });
});

describe('Goal row preferences and boundary', () => {
  it.each(['ACTIVE_AND_BACKLOG', 'ACTIVE', 'ALL', 'NONE'] as const)(
    'persists %s and disclosure while activation refreshes preserve them',
    (filter) => {
      const initial = state(1, [item(1)]);
      const filtered = setOpenItemGoalFilter(initial, env(2), ref(1), {
        idempotencyKey: 'filter-key',
        filter,
      });
      const row = [...filtered.changes.items.values()][0]!;
      const disclosed = setOpenItemGoalDisclosure(
        state(2, [row]),
        env(3),
        ref(1),
        { idempotencyKey: 'disclosure-key', collapsed: false },
      );
      const current = [...disclosed.changes.items.values()][0]!;
      const refresh = activateOpenItem(state(3, [current]), env(4), {
        idempotencyKey: 'activation-key',
        item: ref(1),
        lineage: [],
        presentation: { label: 'Updated title' },
      });
      expect([...refresh.changes.items.values()][0]).toMatchObject({
        goalTrackedWorkFilter: filter,
        goalCollapsed: false,
        revision: 4,
      });
    },
  );

  it('rejects obsolete revisions and unknown filters at the generated boundary', () => {
    expect(parseOpenItemsRequest('PromoteGroupToGoalRequest', request)).toEqual(
      request,
    );
    expect(() =>
      parseOpenItemsRequest('PromoteGroupToGoalRequest', {
        ...request,
        expectedRevision: 4,
      }),
    ).toThrow();
    expect(() =>
      parseOpenItemsRequest('SetOpenItemGoalFilterRequest', {
        idempotencyKey: 'filter-key',
        filter: 'UNSUPPORTED',
      }),
    ).toThrow();
  });

  it('preserves current-state manual no-ops and rejects a removed group on publication', () => {
    expect(
      setOpenItemGoalFilter(state(2), env(3), ref(1), {
        idempotencyKey: 'filter-key',
        filter: 'ALL',
      }).kind,
    ).toBe('unchanged');
    expect(() =>
      publishGroupPromotion(
        state(2),
        env(3),
        request.groupId,
        ref(80),
        'Outcome',
        [],
      ),
    ).toThrow();
  });
});
