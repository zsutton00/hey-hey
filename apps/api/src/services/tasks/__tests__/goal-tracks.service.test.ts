import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WorkStatus } from '@prisma/client';

import {
  computeTrackingLinkKey,
  GoalTracksService,
} from '../goal-tracks.service';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import type { AgentEdge } from '../../../generated/graphs';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import {
  createWarmWorkItemTypeRegistry,
  createWarmWorkItemTypeRegistryWithCustomTypes,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { EntityType } from '../../../generated/model/entityType';
import {
  AgentSessionId,
  OrganizationId,
  ProjectId,
  TaskId,
} from '../../../types';

const ORG_ID = '00000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002' as ProjectId;
const SOURCE_PROJECT_ID = '00000000-0000-4000-8000-000000000099' as ProjectId;
const GOAL_ID = '00000000-0000-4000-8000-000000000010' as TaskId;
const TARGET_TASK_ID = '00000000-0000-4000-8000-000000000020';
const TARGET_PLAN_ID = '00000000-0000-4000-8000-000000000030';
const SESSION_ID = '00000000-0000-4000-8000-000000000040' as AgentSessionId;
const EDGE_ID = '00000000-0000-4000-8000-000000000050';
const USER_TOKEN = 'tok';

function makeGoal(overrides: Partial<{ type: WorkItemTypeKey }> = {}) {
  return {
    id: GOAL_ID,
    type: WORK_ITEM_TYPE_KEYS.Goal,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function makeFeatureTarget() {
  return {
    id: TARGET_TASK_ID,
    name: 'Build login UI',
    type: WORK_ITEM_TYPE_KEYS.Feature,
    projectId: PROJECT_ID,
    status: WorkStatus.ACTIVE,
    dueDate: new Date('2026-06-01T00:00:00Z'),
  };
}

function makePlanTarget() {
  return {
    id: TARGET_PLAN_ID,
    name: 'Q3 launch plan',
    type: 'PLAN',
    projectId: PROJECT_ID,
    status: WorkStatus.ACTIVE,
    dueDate: null,
  };
}

function makeAgentEdge(overrides: Partial<AgentEdge> = {}): AgentEdge {
  return {
    id: EDGE_ID,
    sourceNodeId: GOAL_ID,
    targetNodeId: TARGET_TASK_ID,
    type: 'TRACKS',
    reasoning: 'Goal tracks this entity',
    createdBySessionId: SESSION_ID,
    lastModifiedBySessionId: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GoalTracksService', () => {
  let service: GoalTracksService;
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let edgeClient: jest.Mocked<AgentEdgeClientService>;
  let registry: WorkItemTypeRegistryService;

  beforeEach(async () => {
    prisma = TestUtils.createMockPrismaService();
    edgeClient = {
      create: jest.fn(),
      list: jest.fn(),
      delete: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<AgentEdgeClientService>;
    registry = await createWarmWorkItemTypeRegistry();
    service = new GoalTracksService(
      prisma as unknown as PrismaService,
      edgeClient,
      registry,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('attachToGoal', () => {
    it('uses one graph relationship identity for repeated creates when list misses', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockImplementation(
        async ({ where }) =>
          where.id === GOAL_ID ? makeGoal() : makeFeatureTarget(),
      );
      edgeClient.list.mockResolvedValue({ content: [] });
      edgeClient.create.mockResolvedValue(makeAgentEdge());
      for (let attempt = 0; attempt < 2; attempt++) {
        await service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: EntityType.Task },
          null,
          USER_TOKEN,
        );
      }
      expect(edgeClient.create.mock.calls[0]![2].id).toBe(
        edgeClient.create.mock.calls[1]![2].id,
      );
      expect(edgeClient.create.mock.calls[0]![2].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('partitions promotion members using active target-owned tracking rules', async () => {
      (prisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: TARGET_TASK_ID, type: WORK_ITEM_TYPE_KEYS.Standard },
        { id: TARGET_PLAN_ID, type: WORK_ITEM_TYPE_KEYS.Goal },
      ]);
      const members = [
        { entityType: EntityType.Task, entityId: TARGET_TASK_ID },
        { entityType: EntityType.Task, entityId: TARGET_PLAN_ID },
        { entityType: EntityType.DesignDoc, entityId: EDGE_ID },
      ];
      expect(
        await service.eligibleGoalMembers(ORG_ID, PROJECT_ID, members),
      ).toEqual([members[0]]);
      expect(prisma.db.task.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          archivedAt: null,
          id: { in: [TARGET_TASK_ID, TARGET_PLAN_ID] },
        },
        select: { id: true, type: true },
      });
    });
    it('uses the source project snapshot when naming eligible tracking sources', async () => {
      const sourceProjectRegistry =
        await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'PROJECT_TRACKER',
            projectId: SOURCE_PROJECT_ID,
            tracking: {
              allowedSourceEntityTypes: [EntityType.Task],
              allowedSourceTaskTypes: ['PROJECT_TRACKER'],
            },
          },
        ]);
      const sourceProjectService = new GoalTracksService(
        prisma as unknown as PrismaService,
        edgeClient,
        sourceProjectRegistry,
      );
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Standard,
        projectId: SOURCE_PROJECT_ID,
      });

      await expect(
        sourceProjectService.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toThrow(/STANDARD.*PROJECT_TRACKER/);
    });

    it('rejects when the source task type is not a config-declared tracking source', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        projectId: PROJECT_ID,
      });

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names both the offending type and the eligible source types when the source is not tracking-eligible', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Standard,
        projectId: PROJECT_ID,
      });

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
        // Offending type named, and the config-driven eligible set (today
        // only GOAL) named as what the caller may use instead.
      ).rejects.toThrow(/STANDARD.*GOAL/);
    });

    it('rejects DESIGN_DOC targets', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'DESIGN_DOC' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects sibling-GOAL targets', async () => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce({
          id: TARGET_TASK_ID,
          name: 'Other goal',
          type: WORK_ITEM_TYPE_KEYS.Goal,
          projectId: PROJECT_ID,
          status: WorkStatus.ACTIVE,
          dueDate: null,
        });

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [WORK_ITEM_TYPE_KEYS.Feature],
      [WORK_ITEM_TYPE_KEYS.Standard],
      [WORK_ITEM_TYPE_KEYS.Bug],
    ])('accepts %s target tasks', async (type) => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce({ ...makeFeatureTarget(), type });
      edgeClient.list.mockResolvedValue({ content: [] });
      edgeClient.create.mockResolvedValue(makeAgentEdge());

      const result = await service.attachToGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        SESSION_ID,
        USER_TOKEN,
      );

      expect(result.created).toBe(true);
      expect(result.target.targetEntityType).toBe('TASK');
      expect(edgeClient.create).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.objectContaining({
          sourceNodeId: GOAL_ID,
          targetNodeId: TARGET_TASK_ID,
          type: 'TRACKS',
          createdBySessionId: SESSION_ID,
        }),
        USER_TOKEN,
      );
    });

    it('tracks canonical PLAN work items', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        makePlanTarget(),
      );
      edgeClient.list.mockResolvedValue({ content: [] });
      edgeClient.create.mockResolvedValue(
        makeAgentEdge({ targetNodeId: TARGET_PLAN_ID }),
      );

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_PLAN_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).resolves.toBeDefined();
    });

    it('throws NotFoundException when goal is missing', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when target task is missing', async () => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce(null);

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns created=false when edge already exists', async () => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce(makeFeatureTarget());
      const existing = makeAgentEdge();
      edgeClient.list.mockResolvedValue({ content: [existing] });

      const result = await service.attachToGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        SESSION_ID,
        USER_TOKEN,
      );

      expect(result.created).toBe(false);
      expect(result.edge.id).toBe(EDGE_ID);
      expect(edgeClient.create).not.toHaveBeenCalled();
    });

    it('creates the TRACKS edge without a session id when called from a user', async () => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce(makeFeatureTarget());
      edgeClient.list.mockResolvedValue({ content: [] });
      edgeClient.create.mockResolvedValue(makeAgentEdge());

      const result = await service.attachToGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        null,
        USER_TOKEN,
      );

      expect(result.created).toBe(true);
      expect(edgeClient.create).toHaveBeenCalledTimes(1);
      const firstCall = edgeClient.create.mock.calls[0];
      expect(firstCall).toBeDefined();
      const payload = firstCall![2];
      expect(payload).toEqual({
        id: expect.any(String),
        sourceNodeId: GOAL_ID,
        sourceEntityType: 'TASK',
        targetNodeId: TARGET_TASK_ID,
        targetEntityType: 'TASK',
        type: 'TRACKS',
        reasoning: 'Goal tracks this entity',
        createdBySessionId: null,
      });
    });

    it('rejects without a user token', async () => {
      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          null,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('detachFromGoal', () => {
    it('returns deleted=false when no edge matches', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());
      edgeClient.list.mockResolvedValue({ content: [] });

      const result = await service.detachFromGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        USER_TOKEN,
      );

      expect(result).toEqual({
        deleted: false,
        targetEntityId: TARGET_TASK_ID,
        targetEntityType: 'TASK',
      });
      expect(edgeClient.delete).not.toHaveBeenCalled();
    });

    it('deletes the matching edge', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());
      edgeClient.list.mockResolvedValue({ content: [makeAgentEdge()] });

      const result = await service.detachFromGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        USER_TOKEN,
      );

      expect(result.deleted).toBe(true);
      expect(edgeClient.delete).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        EDGE_ID,
        USER_TOKEN,
      );
    });

    it('rejects when the source task type is not a config-declared tracking source', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        projectId: PROJECT_ID,
      });

      await expect(
        service.detachFromGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          USER_TOKEN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names both the offending type and the eligible source types when the source is not tracking-eligible', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Standard,
        projectId: PROJECT_ID,
      });

      await expect(
        service.detachFromGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          USER_TOKEN,
        ),
        // Detach must surface the same config-driven message contract as
        // attach — offending type plus the eligible set named.
      ).rejects.toThrow(/STANDARD.*GOAL/);
    });
  });

  // The source allow-list is enforced from the central work-item-type config
  // rather than a hardcoded GOAL check. These cases drive the config to admit
  // a normally-ineligible type and to deny GOAL, asserting that source
  // eligibility flips with config — not with a literal type comparison.
  describe('source allow-list is read from the central config', () => {
    function pinSourceAllowList(eligibleTypes: WorkItemTypeKey[]): void {
      jest
        .spyOn(registry, 'isTrackingSource')
        .mockImplementation((t) =>
          eligibleTypes.includes(t as WorkItemTypeKey),
        );
      jest
        .spyOn(registry, 'getTrackingSourceTypes')
        .mockReturnValue([...eligibleTypes]);
    }

    function pinPermissiveTargetRules(): void {
      // When we admit a non-GOAL source type, that type's real target
      // rules are empty (NOT_A_TRACKING_SOURCE). Drive the target-side
      // accessors to permit the TASK target so the source-side gate is
      // what the test is isolating.
      jest.spyOn(registry, 'getTrackingRules').mockReturnValue({
        allowedSourceEntityTypes: [EntityType.Task, EntityType.DesignDoc],
        allowedSourceTaskTypes: [
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Bug,
        ],
      });
      jest.spyOn(registry, 'isTrackingSourceAllowed').mockReturnValue(true);
    }

    it('attach succeeds when the config admits a non-GOAL source type', async () => {
      pinSourceAllowList([WORK_ITEM_TYPE_KEYS.Standard]);
      pinPermissiveTargetRules();

      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: GOAL_ID,
          type: WORK_ITEM_TYPE_KEYS.Standard,
          projectId: PROJECT_ID,
        })
        .mockResolvedValueOnce(makeFeatureTarget());
      edgeClient.list.mockResolvedValue({ content: [] });
      edgeClient.create.mockResolvedValue(makeAgentEdge());

      const result = await service.attachToGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        SESSION_ID,
        USER_TOKEN,
      );

      expect(result.created).toBe(true);
      expect(edgeClient.create).toHaveBeenCalledTimes(1);
    });

    it('detach succeeds when the config admits a non-GOAL source type', async () => {
      pinSourceAllowList([WORK_ITEM_TYPE_KEYS.Standard]);

      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Standard,
        projectId: PROJECT_ID,
      });
      edgeClient.list.mockResolvedValue({
        content: [makeAgentEdge({ id: 'std-source-edge' })],
      });

      const result = await service.detachFromGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        USER_TOKEN,
      );

      expect(result.deleted).toBe(true);
      expect(edgeClient.delete).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'std-source-edge',
        USER_TOKEN,
      );
    });

    it('attach rejects a GOAL source when the config denies GOAL, naming the new eligible set', async () => {
      // Config drives GOAL out and STANDARD in. The refusal message must
      // name GOAL as offending and STANDARD as eligible — proving the
      // service reports the config's current allow-list, not the literal
      // GOAL string baked into the code.
      pinSourceAllowList([WORK_ITEM_TYPE_KEYS.Standard]);

      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());

      await expect(
        service.attachToGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          SESSION_ID,
          USER_TOKEN,
        ),
      ).rejects.toThrow(/GOAL.*STANDARD/);
    });

    it('detach rejects a GOAL source when the config denies GOAL, naming the new eligible set', async () => {
      pinSourceAllowList([WORK_ITEM_TYPE_KEYS.Standard]);

      (prisma.db.task.findFirst as jest.Mock).mockResolvedValueOnce(makeGoal());

      await expect(
        service.detachFromGoal(
          ORG_ID,
          PROJECT_ID,
          GOAL_ID,
          { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
          USER_TOKEN,
        ),
      ).rejects.toThrow(/GOAL.*STANDARD/);
    });
  });

  describe('tracking-link uniqueness key', () => {
    it('is computed from (sourceType, source, target)', () => {
      const goalKey = computeTrackingLinkKey({
        sourceType: WORK_ITEM_TYPE_KEYS.Goal,
        sourceNodeId: GOAL_ID,
        targetNodeId: TARGET_TASK_ID,
      });

      expect(goalKey).toBe(
        computeTrackingLinkKey({
          sourceType: WORK_ITEM_TYPE_KEYS.Goal,
          sourceNodeId: GOAL_ID,
          targetNodeId: TARGET_TASK_ID,
        }),
      );
      // The same (source, target) pair under a different source type is a
      // distinct link — the key records which kind of item is tracking.
      expect(goalKey).not.toBe(
        computeTrackingLinkKey({
          sourceType: WORK_ITEM_TYPE_KEYS.Standard,
          sourceNodeId: GOAL_ID,
          targetNodeId: TARGET_TASK_ID,
        }),
      );
      expect(goalKey).not.toBe(
        computeTrackingLinkKey({
          sourceType: WORK_ITEM_TYPE_KEYS.Goal,
          sourceNodeId: GOAL_ID,
          targetNodeId: TARGET_PLAN_ID,
        }),
      );
    });

    it('attach dedupes on the widened key for GOAL sources', async () => {
      (prisma.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(makeGoal())
        .mockResolvedValueOnce(makeFeatureTarget());
      // Edge list holds a TRACKS edge to a different target plus the
      // matching one; only the full-key match counts as existing.
      edgeClient.list.mockResolvedValue({
        content: [
          makeAgentEdge({ id: 'other-edge', targetNodeId: TARGET_PLAN_ID }),
          makeAgentEdge(),
        ],
      });

      const result = await service.attachToGoal(
        ORG_ID,
        PROJECT_ID,
        GOAL_ID,
        { targetEntityId: TARGET_TASK_ID, targetEntityType: 'TASK' },
        SESSION_ID,
        USER_TOKEN,
      );

      expect(result.created).toBe(false);
      expect(result.edge.id).toBe(EDGE_ID);
      expect(edgeClient.create).not.toHaveBeenCalled();
    });
  });

  describe('tracking revocation impact', () => {
    it('returns zero impact without requiring a graph token when no targets were revoked', async () => {
      await expect(
        service.countRevokedTrackingSourceImpact(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Goal,
          [],
          null,
        ),
      ).resolves.toEqual({ totalAffectedLinkCount: 0, sources: [] });
      await expect(
        service.clearRevokedTrackingSourceEdges(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Goal,
          [],
          null,
        ),
      ).resolves.toEqual({ clearedLinkCount: 0, clearedEdges: [] });
      expect(edgeClient.list).not.toHaveBeenCalled();
      expect(edgeClient.delete).not.toHaveBeenCalled();
    });

    it('counts only TRACKS edges from the edited source type to revoked target task types', async () => {
      jest.spyOn(registry, 'getTrackingRules').mockReturnValue({
        allowedSourceEntityTypes: [EntityType.Task],
        allowedSourceTaskTypes: [
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Bug,
        ],
      });
      jest
        .spyOn(registry, 'isTrackingTargetTaskTypeAllowed')
        .mockImplementation((_sourceType, targetType) =>
          (
            [
              WORK_ITEM_TYPE_KEYS.Feature,
              WORK_ITEM_TYPE_KEYS.Standard,
              WORK_ITEM_TYPE_KEYS.Bug,
            ] as readonly string[]
          ).includes(targetType),
        );
      edgeClient.list.mockResolvedValue({
        content: [
          makeAgentEdge({
            id: 'bug-edge',
            sourceNodeId: 'goal-1',
            targetNodeId: 'bug-1',
          }),
          makeAgentEdge({
            id: 'feature-edge',
            sourceNodeId: 'goal-1',
            targetNodeId: 'feature-1',
          }),
          makeAgentEdge({
            id: 'other-source-edge',
            sourceNodeId: 'standard-1',
            targetNodeId: 'bug-2',
          }),
        ],
      });
      (prisma.db.task.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'goal-1', type: WORK_ITEM_TYPE_KEYS.Goal },
        ])
        .mockResolvedValueOnce([
          { id: 'bug-1', type: WORK_ITEM_TYPE_KEYS.Bug },
          { id: 'bug-2', type: WORK_ITEM_TYPE_KEYS.Bug },
        ]);

      await expect(
        service.countRevokedTrackingSourceImpact(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Bug,
          [WORK_ITEM_TYPE_KEYS.Goal],
          USER_TOKEN,
        ),
      ).resolves.toEqual({
        totalAffectedLinkCount: 1,
        sources: [
          { sourceTypeKey: WORK_ITEM_TYPE_KEYS.Goal, affectedLinkCount: 1 },
        ],
      });
    });

    it('clears exactly invalid TRACKS edges in deterministic order', async () => {
      edgeClient.list.mockResolvedValue({
        content: [
          makeAgentEdge({
            id: 'edge-feature-still-valid',
            sourceNodeId: 'goal-1',
            targetNodeId: 'feature-1',
          }),
          makeAgentEdge({
            id: 'edge-bug-later',
            sourceNodeId: 'goal-2',
            targetNodeId: 'bug-2',
          }),
          makeAgentEdge({
            id: 'edge-other-source',
            sourceNodeId: 'standard-1',
            targetNodeId: 'bug-3',
          }),
          makeAgentEdge({
            id: 'edge-related',
            sourceNodeId: 'goal-1',
            targetNodeId: 'bug-1',
            type: 'RELATED_TO',
          }),
          makeAgentEdge({
            id: 'edge-bug-earlier',
            sourceNodeId: 'goal-1',
            targetNodeId: 'bug-1',
          }),
        ],
      });
      (prisma.db.task.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'goal-2', type: WORK_ITEM_TYPE_KEYS.Goal },
          { id: 'goal-1', type: WORK_ITEM_TYPE_KEYS.Goal },
        ])
        .mockResolvedValueOnce([
          { id: 'bug-2', type: WORK_ITEM_TYPE_KEYS.Bug },
          { id: 'bug-1', type: WORK_ITEM_TYPE_KEYS.Bug },
        ]);

      await expect(
        service.clearRevokedTrackingSourceEdges(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Bug,
          [WORK_ITEM_TYPE_KEYS.Goal],
          USER_TOKEN,
        ),
      ).resolves.toEqual({
        clearedLinkCount: 2,
        clearedEdges: [
          {
            edgeId: 'edge-bug-earlier',
            sourceNodeId: 'goal-1',
            targetNodeId: 'bug-1',
            sourceTypeKey: WORK_ITEM_TYPE_KEYS.Goal,
          },
          {
            edgeId: 'edge-bug-later',
            sourceNodeId: 'goal-2',
            targetNodeId: 'bug-2',
            sourceTypeKey: WORK_ITEM_TYPE_KEYS.Goal,
          },
        ],
      });
      expect(edgeClient.delete.mock.calls.map((call) => call[2])).toEqual([
        'edge-bug-earlier',
        'edge-bug-later',
      ]);
      expect(edgeClient.delete).not.toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'edge-feature-still-valid',
        USER_TOKEN,
        expect.any(String),
      );
      expect(edgeClient.delete).not.toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'edge-other-source',
        USER_TOKEN,
        expect.any(String),
      );
      expect(edgeClient.delete).not.toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'edge-related',
        USER_TOKEN,
        expect.any(String),
      );
    });

    it('treats delete misses as idempotent cleared state', async () => {
      edgeClient.list.mockResolvedValue({
        content: [
          makeAgentEdge({
            id: 'already-gone-edge',
            sourceNodeId: 'goal-1',
            targetNodeId: 'bug-1',
          }),
        ],
      });
      edgeClient.delete.mockRejectedValueOnce(new NotFoundException());
      (prisma.db.task.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'goal-1', type: WORK_ITEM_TYPE_KEYS.Goal },
        ])
        .mockResolvedValueOnce([
          { id: 'bug-1', type: WORK_ITEM_TYPE_KEYS.Bug },
        ]);

      await expect(
        service.clearRevokedTrackingSourceEdges(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Bug,
          [WORK_ITEM_TYPE_KEYS.Goal],
          USER_TOKEN,
        ),
      ).resolves.toMatchObject({ clearedLinkCount: 1 });
    });

    it('returns zero when cleanup is re-run after the invalid edge is gone', async () => {
      edgeClient.list.mockResolvedValue({ content: [] });

      await expect(
        service.clearRevokedTrackingSourceEdges(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Bug,
          [WORK_ITEM_TYPE_KEYS.Goal],
          USER_TOKEN,
        ),
      ).resolves.toEqual({ clearedLinkCount: 0, clearedEdges: [] });
      expect(edgeClient.delete).not.toHaveBeenCalled();
      expect(prisma.db.task.findMany).not.toHaveBeenCalled();
    });

    it('paginates TRACKS reads before enumerating revoked links', async () => {
      const firstPage = Array.from({ length: 100 }, (_value, index) =>
        makeAgentEdge({
          id: `feature-page-0-${index}`,
          sourceNodeId: `goal-page-0-${index}`,
          targetNodeId: `feature-page-0-${index}`,
        }),
      );
      edgeClient.list
        .mockResolvedValueOnce({ content: firstPage })
        .mockResolvedValueOnce({
          content: [
            makeAgentEdge({
              id: 'second-page-bug-edge',
              sourceNodeId: 'goal-second-page',
              targetNodeId: 'bug-second-page',
            }),
          ],
        });
      (prisma.db.task.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { id: 'goal-second-page', type: WORK_ITEM_TYPE_KEYS.Goal },
        ])
        .mockResolvedValueOnce([
          { id: 'bug-second-page', type: WORK_ITEM_TYPE_KEYS.Bug },
        ]);

      await expect(
        service.clearRevokedTrackingSourceEdges(
          ORG_ID,
          PROJECT_ID,
          WORK_ITEM_TYPE_KEYS.Bug,
          [WORK_ITEM_TYPE_KEYS.Goal],
          USER_TOKEN,
        ),
      ).resolves.toMatchObject({ clearedLinkCount: 1 });
      expect(edgeClient.list).toHaveBeenNthCalledWith(
        1,
        ORG_ID,
        PROJECT_ID,
        { type: 'TRACKS', page: 0, size: 100 },
        USER_TOKEN,
      );
      expect(edgeClient.list).toHaveBeenNthCalledWith(
        2,
        ORG_ID,
        PROJECT_ID,
        { type: 'TRACKS', page: 1, size: 100 },
        USER_TOKEN,
      );
      expect(edgeClient.delete).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        'second-page-bug-edge',
        USER_TOKEN,
        expect.any(String),
      );
    });
  });
});
