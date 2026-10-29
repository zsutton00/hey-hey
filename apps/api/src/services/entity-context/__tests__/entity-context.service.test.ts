import { PlanDependenciesService } from '../../plan/plan-dependencies.service';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { GraphsClientService } from '../../graphs-client.service';
import { EntityContextService } from '../entity-context.service';

import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { TaskService } from '../../tasks/task.service';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import * as TestUtils from '../../../utils/testUtils';
import type { EntityType } from '../../../generated/model/entityType';
import type { ProposalId, ConversationId } from '../../../types';
import type { AnyTransactionClient } from '../../../prisma/prisma.service';
import type { ProposalWithApprovals } from '../../proposal/proposal.types';
import { RelationshipType } from '../../../generated/graphs/model/relationshipType';
import type { EntityNeighborhoodResponse } from '../../../generated/graphs/model/entityNeighborhoodResponse';

jest.mock('../../proposal/proposal-response-policy', () => {
  const actual = jest.requireActual('../../proposal/proposal-response-policy');
  const { toProposalResponseDto } = jest.requireActual(
    '../../proposal/proposal.types',
  );
  return {
    ...actual,
    mapProposalResponse: async (
      _tx: AnyTransactionClient,
      proposal: ProposalWithApprovals,
    ) => toProposalResponseDto(proposal, 1),
    mapProposalResponses: async (
      _tx: AnyTransactionClient,
      proposals: ProposalWithApprovals[],
    ) => proposals.map((proposal) => toProposalResponseDto(proposal, 1)),
  };
});

type AgentEdgeFixture = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  reasoning: string;
  createdBySessionId: string;
  createdAt: string;
  updatedAt: string;
  lastModifiedBySessionId?: string | null;
};

function buildAgentLinkedRelationship(edge: AgentEdgeFixture) {
  return {
    id: `neo4j-${edge.id}`,
    type: RelationshipType.AgentLinked,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    properties: {
      id: edge.id,
      type: edge.type,
      reasoning: edge.reasoning,
      createdBySessionId: edge.createdBySessionId,
      ...(edge.lastModifiedBySessionId !== undefined
        ? { lastModifiedBySessionId: edge.lastModifiedBySessionId }
        : {}),
    },
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  };
}

function makeAgentEdgeSearchResponse(
  seedEntityId: string,
  edges: AgentEdgeFixture[],
  overrides?: { totalElements?: number },
): import('src/generated/graphs').IncidentEdgesResponse {
  return {
    groups: [
      {
        seedEntityId,
        neighborTotal:
          overrides?.totalElements ??
          new Set(
            edges.map((edge) =>
              edge.sourceNodeId === seedEntityId
                ? edge.targetNodeId
                : edge.sourceNodeId,
            ),
          ).size,
        relationships: edges.map(buildAgentLinkedRelationship),
        endpoints: [],
      },
    ],
  };
}

const { testIds } = TestUtils;

const entityId = '123e4567-e89b-42d3-a456-426614174099';
const proposalIdA = '123e4567-e89b-42d3-a456-426614174050';
const proposalIdB = '123e4567-e89b-42d3-a456-426614174051';
const conversationIdA = '123e4567-e89b-42d3-a456-426614174060';
const entityCreatedAt = new Date('2026-02-15T08:00:00Z');
const emptyFeatureRequirements = '{"records":[]}';

function makeStoredProposal(overrides?: Record<string, unknown>) {
  return {
    id: proposalIdA,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'APPROVED',
    targetEntityId: entityId,
    targetEntityType: 'TASK',
    updates: { name: 'Updated name' },
    requestorId: testIds.user,
    requestorContext: null,
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    updatedAt: new Date('2026-03-01T10:00:00Z'),
    ...overrides,
  };
}

/**
 * Authorized TASK seed row as returned by
 * TaskService.findPersistedByOrganization (plain scalar fetch, no include).
 * Content and metadata reuse these scalars instead of re-reading the row.
 */
function makeSeedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: entityId,
    projectId: testIds.project,
    name: 'Test Task',
    type: WORK_ITEM_TYPE_KEYS.Standard,
    createdAt: entityCreatedAt,
    status: 'ACTIVE',
    priority: null,
    assigneeId: null,
    dueDate: null,
    ...overrides,
  };
}

const relatedTaskId = '123e4567-e89b-42d3-a456-426614174080';
const relatedPlanId = '123e4567-e89b-42d3-a456-426614174081';

/**
 * Default labeled neighborhood response for the getFullEntityContext
 * suite. Mirrors what the graph service's entity-neighborhood endpoint
 * would return after applying its labeling and exclusion rules.
 *
 * The rule-level coverage (which edges become which relationships,
 * which entities are excluded) lives in the graph-service Java test
 * suite. These tests only verify that the API surfaces what the
 * neighborhood endpoint returned, merging it with featureHierarchy,
 * planContext, and agent-edge entries correctly.
 *
 * The default fixture surfaces a single MENTIONS row to a related
 * PLAN — exercising the merge path without re-encoding labeling logic.
 */
function makeNeighborhood(
  overrides?: Partial<EntityNeighborhoodResponse>,
): EntityNeighborhoodResponse {
  return {
    relatedEntities: overrides?.relatedEntities ?? [
      {
        entityId: relatedPlanId,
        entityType: 'PLAN',
        displayName: 'Parent Plan',
        status: 'ACTIVE',
        relationship: 'mentions',
      },
    ],
    agentSessions: overrides?.agentSessions ?? [],
    nodeCatalog: overrides?.nodeCatalog ?? [],
  };
}

describe('EntityContextService', () => {
  let service: EntityContextService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockGraphsClient: {
    searchGraphAllPages: jest.Mock;
    searchGraph: jest.Mock;
    readIncidentEdges: jest.Mock;
    getEntityNeighborhood: jest.Mock;
  };
  let mockTaskService: {
    findPersistedByOrganization: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).proposal = {
      findMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    };

    // Default: entity lookup returns createdAt and name
    (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
      createdAt: entityCreatedAt,
      name: 'Test Task',
      type: WORK_ITEM_TYPE_KEYS.Standard,
    });
    (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([]);
    // Default: CTE queries return empty (no feature hierarchy)
    (mockPrisma.db as any).$queryRaw = jest.fn().mockResolvedValue([]);
    // Default: no description sections for feature hierarchy
    (mockPrisma.db as any).taskSection = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    (mockPrisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([]);

    mockGraphsClient = {
      searchGraphAllPages: jest.fn(),
      searchGraph: jest.fn(),
      readIncidentEdges: jest
        .fn()
        .mockResolvedValue(makeAgentEdgeSearchResponse(entityId, [])),
      getEntityNeighborhood: jest
        .fn()
        .mockResolvedValue({ relatedEntities: [], agentSessions: [] }),
    };
    mockTaskService = {
      findPersistedByOrganization: jest.fn().mockResolvedValue(makeSeedRow()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityContextService,
        {
          provide: PlanDependenciesService,
          useValue: { outgoing: jest.fn().mockResolvedValue([]) },
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: GraphsClientService,
          useValue: mockGraphsClient,
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: await createWarmWorkItemTypeRegistry(),
        },
        { provide: TaskService, useValue: mockTaskService },
      ],
    }).compile();

    service = module.get<EntityContextService>(EntityContextService);
    jest.clearAllMocks();

    // Re-apply defaults after clearAllMocks
    (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
      createdAt: entityCreatedAt,
      name: 'Test Task',
      type: WORK_ITEM_TYPE_KEYS.Standard,
    });
    (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.db as any).$queryRaw = jest.fn().mockResolvedValue([]);
    (mockPrisma.db as any).taskSection = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    mockTaskService.findPersistedByOrganization.mockResolvedValue(
      makeSeedRow(),
    );
  });

  describe('getEntityContext', () => {
    it('should return proposals for a TASK entity via reverse lookup', async () => {
      const proposals = [
        makeStoredProposal({
          id: proposalIdB,
          action: 'UPDATE',
          createdAt: new Date('2026-03-02T10:00:00Z'),
          updatedAt: new Date('2026-03-02T10:00:00Z'),
        }),
        makeStoredProposal({
          id: proposalIdA,
          action: 'CREATE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
          updatedAt: new Date('2026-03-01T10:00:00Z'),
        }),
      ];

      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(proposals[1]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.entityId).toBe(entityId);
      expect(result.entityType).toBe('TASK');
      expect(result.createdAt).toBe(entityCreatedAt.toISOString());
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals![0]!.id).toBe(proposalIdB);
      expect(result.proposals![1]!.id).toBe(proposalIdA);

      expect((mockPrisma.db as any).proposal.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: testIds.organization,
          targetEntityId: { in: [entityId] },
          NOT: expect.any(Object),
        }),
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { approvalRecords: true },
      });
    });

    it('returns four proposals while searching up to ten for same-path baselines', async () => {
      const proposals = Array.from({ length: 5 }, (_, index) =>
        makeStoredProposal({
          id: `123e4567-e89b-42d3-a456-4266141741${index}`,
          updates: { status: `STATUS_${index}` },
          createdAt: new Date(`2026-03-0${5 - index}T10:00:00Z`),
          updatedAt: new Date(`2026-03-0${5 - index}T10:00:00Z`),
        }),
      );
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.proposalDetail).toBe('summary');
      expect(result.olderProposalsOmitted).toBe(true);
      expect(result.proposals).toHaveLength(4);
      expect(result.proposals?.[3]).toMatchObject({
        changes: [
          {
            path: 'status',
            type: 'string',
            diff: '@@ -1,1 +1,1 @@\n-"STATUS_4"\n+"STATUS_3"',
          },
        ],
      });
    });

    it('keeps the originating CREATE alongside the four newest non-CREATE proposals', async () => {
      const updates = Array.from({ length: 5 }, (_, index) =>
        makeStoredProposal({
          id: `123e4567-e89b-42d3-a456-4266141742${index}`,
          action: 'UPDATE',
          updates: { status: `STATUS_${index}` },
          createdAt: new Date(`2026-03-0${5 - index}T10:00:00Z`),
        }),
      );
      const create = makeStoredProposal({
        id: proposalIdA,
        action: 'CREATE',
        updates: { name: 'Origin' },
        createdAt: new Date('2026-02-01T10:00:00Z'),
      });
      // The CREATE is older than the ten-row query window and only
      // reachable through the creating-proposal lookup.
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(updates);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(create);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.olderProposalsOmitted).toBe(true);
      expect(result.proposals?.map((proposal) => proposal.id)).toEqual([
        ...updates.slice(0, 4).map((proposal) => proposal.id),
        proposalIdA,
      ]);
    });

    it('does not duplicate the CREATE when it is already in the query window', async () => {
      const update = makeStoredProposal({
        id: proposalIdB,
        action: 'UPDATE',
        createdAt: new Date('2026-03-02T10:00:00Z'),
      });
      const create = makeStoredProposal({
        id: proposalIdA,
        action: 'CREATE',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      });
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
        update,
        create,
      ]);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(create);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.olderProposalsOmitted).toBe(false);
      expect(result.proposals?.map((proposal) => proposal.id)).toEqual([
        proposalIdB,
        proposalIdA,
      ]);
    });

    it('preserves complete proposal updates in explicit full detail', async () => {
      const proposals = [
        makeStoredProposal({ updates: { status: 'ACTIVE', nested: { a: 1 } } }),
      ];
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
        { proposalDetail: 'full' },
      );

      expect(result.proposalDetail).toBe('full');
      expect(result.olderProposalsOmitted).toBe(false);
      expect(result.proposals?.[0]).toMatchObject({
        updates: { status: 'ACTIVE', nested: { a: 1 } },
      });
      expect((mockPrisma.db as any).proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should derive creatingProposalId from first CREATE proposal', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
        makeStoredProposal({
          id: proposalIdB,
          action: 'UPDATE',
          createdAt: new Date('2026-03-02T10:00:00Z'),
        }),
        makeStoredProposal({
          id: proposalIdA,
          action: 'CREATE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        }),
      ]);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(
        makeStoredProposal({
          id: proposalIdA,
          action: 'CREATE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        }),
      );

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.creatingProposalId).toBe(proposalIdA);
    });

    it('should return undefined creatingProposalId when no CREATE proposal exists', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
        makeStoredProposal({ action: 'UPDATE' }),
      ]);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(null);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.creatingProposalId).toBeUndefined();
    });

    it('should return empty proposals array when no proposals exist', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.proposals).toEqual([]);
      expect(result.creatingProposalId).toBeUndefined();
    });

    it('should include influences and conversationId in proposal summaries', async () => {
      const influences = [
        {
          entityId: testIds.task,
          entityType: 'TASK',
          taskType: 'BUG',
          reasoning: 'Referenced during discussion',
          reasonType: 'explicit_mention',
        },
        {
          entityId: testIds.initiative,
          entityType: 'TASK',
          taskType: 'customer_request',
          reasoning: 'Project-defined work item',
          reasonType: 'derived',
        },
        {
          entityId: testIds.designDoc,
          entityType: 'DESIGN_DOC',
          reasoning: 'Non-task reference',
          reasonType: 'implied',
        },
        {
          entityId: testIds.plan,
          entityType: 'TASK',
          reasoning: 'Legacy task reference',
          reasonType: 'derived',
        },
      ];

      const proposals = [
        makeStoredProposal({
          influences,
          conversationId: conversationIdA,
        }),
      ];

      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.proposals![0]!.influences).toEqual(influences);
      expect(result.proposals![0]!.conversationId).toBe(
        conversationIdA as ConversationId,
      );
    });

    it('should return attach_to_goal tool when viewing a TASK', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.availableMcpTools).toHaveLength(1);
      expect(result.availableMcpTools![0]!.toolName).toBe('attach_to_goal');
      expect(result.availableMcpTools![0]!.targetEntityType).toBe('TASK');
      // The service advertises the constraint; the frontend filters.
      // GOAL is excluded so attaching a goal to a goal is impossible.
      expect(result.availableMcpTools![0]!.validTaskTypes).toEqual([
        'STANDARD',
        'BUG',
        'FEATURE',
      ]);
    });

    it('should return create_work_item when viewing an INITIATIVE', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
      (mockPrisma.db.initiative.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Test Initiative',
      });

      const result = await service.getEntityContext(
        testIds.organization,
        'INITIATIVE' as EntityType,
        entityId,
      );

      const toolNames = result.availableMcpTools!.map((t) => t.toolName);
      expect(toolNames).toContain('create_work_item');
      expect(toolNames).not.toContain('edit_work_item');
      expect(
        result.availableMcpTools!.every((t) => t.targetEntityType === 'TASK'),
      ).toBe(true);
    });

    it('should return empty MCP tools for entity types without tool mappings', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
      (mockPrisma.db.conversation.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        title: 'Test Conversation',
      });

      const result = await service.getEntityContext(
        testIds.organization,
        'CONVERSATION' as EntityType,
        entityId,
      );

      expect(result.availableMcpTools).toEqual([]);
    });

    it('should query proposals for all entity types', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
      (mockPrisma.db.initiative.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Test Initiative',
      });

      await service.getEntityContext(
        testIds.organization,
        'INITIATIVE' as EntityType,
        entityId,
      );

      expect((mockPrisma.db as any).proposal.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: testIds.organization,
          targetEntityId: { in: [entityId] },
          NOT: expect.any(Object),
        }),
        include: { approvalRecords: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('should resolve createdAt from entity table lookup', async () => {
      const taskCreated = new Date('2026-01-20T12:00:00Z');
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        createdAt: taskCreated,
      });
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.createdAt).toBe(taskCreated.toISOString());
      expect(mockPrisma.db.task.findUnique).toHaveBeenCalledWith({
        where: { id: entityId },
        select: { createdAt: true, name: true, type: true },
      });
    });

    it('returns the persisted task subtype on root context without inferring it', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
      (mockPrisma.db.task.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          createdAt: entityCreatedAt,
          name: 'Goal',
          type: 'GOAL',
        })
        .mockResolvedValueOnce({
          createdAt: entityCreatedAt,
          name: 'Standard Task',
          type: 'STANDARD',
        });

      const goalContext = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );
      const standardContext = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        relatedTaskId,
      );

      expect(goalContext.taskType).toBe('GOAL');
      expect(standardContext.taskType).toBe('STANDARD');
    });

    it('should resolve createdAt for DESIGN_DOC entity type', async () => {
      const docCreated = new Date('2026-01-10T09:00:00Z');
      (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue({
        createdAt: docCreated,
      });
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'DESIGN_DOC' as EntityType,
        entityId,
      );

      expect(result.createdAt).toBe(docCreated.toISOString());
    });

    it('should resolve createdAt for REPORT entity type', async () => {
      const reportCreated = new Date('2026-03-10T16:00:00Z');
      (mockPrisma.db.report.findUnique as jest.Mock).mockResolvedValue({
        createdAt: reportCreated,
      });
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'REPORT' as EntityType,
        entityId,
      );

      expect(result.createdAt).toBe(reportCreated.toISOString());
    });

    it('should throw NotFoundException for entity types without a metadata lookup', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      await expect(
        service.getEntityContext(
          testIds.organization,
          'ARTIFACT' as EntityType,
          entityId,
        ),
      ).rejects.toThrow(/No metadata lookup for entity type ARTIFACT/);
    });

    it('should throw NotFoundException when entity not found', async () => {
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      await expect(
        service.getEntityContext(
          testIds.organization,
          'TASK' as EntityType,
          entityId,
        ),
      ).rejects.toThrow(`TASK with id ${entityId} not found`);
    });

    it('should return displayName from entity name field', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.displayName).toBe('Test Task');
    });

    it('should omit proposals when includeProposals is false', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
        makeStoredProposal(),
      ]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
        { includeProposals: false },
      );

      expect(result.proposals).toBeUndefined();
      expect((mockPrisma.db as any).proposal.findMany).not.toHaveBeenCalled();
    });

    it('should still return creatingProposalId when includeProposals is false', async () => {
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(
        makeStoredProposal({
          id: proposalIdA,
          action: 'CREATE',
          createdAt: new Date('2026-03-01T10:00:00Z'),
        }),
      );

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
        { includeProposals: false },
      );

      expect(result.proposals).toBeUndefined();
      expect(result.creatingProposalId).toBe(proposalIdA);
    });

    it('should omit availableMcpTools when includeAvailableMcpTools is false', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
        { includeAvailableMcpTools: false },
      );

      expect(result.availableMcpTools).toBeUndefined();
    });

    it('should return all fields when no include flags specified', async () => {
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
        makeStoredProposal(),
      ]);

      const result = await service.getEntityContext(
        testIds.organization,
        'TASK' as EntityType,
        entityId,
      );

      expect(result.displayName).toBe('Test Task');
      expect(result.proposals).toBeDefined();
      expect(result.availableMcpTools).toBeDefined();
    });
  });

  describe('getFullEntityContext', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: Error) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it.each(['plan', 'edges'])(
      'overlaps reads and waits for %s before hierarchy',
      async (last) => {
        const authorization = deferred<{ projectId: string }>();
        const content = deferred<undefined>();
        const context =
          deferred<
            Awaited<ReturnType<EntityContextService['getEntityContext']>>
          >();
        const plan = deferred<null>();
        const edges = deferred<[]>();
        const hierarchy = deferred<[]>();
        const hierarchyStarted = deferred<void>();
        const neighborhoodStarted = deferred<void>();
        mockTaskService.findPersistedByOrganization.mockReturnValue(
          authorization.promise,
        );
        const contentSpy = jest
          .spyOn(service as any, 'loadEntityContent')
          .mockReturnValue(content.promise);
        const contextSpy = jest
          .spyOn(service, 'getEntityContext')
          .mockReturnValue(context.promise);
        const planSpy = jest
          .spyOn(service as any, 'buildPlanContext')
          .mockReturnValue(plan.promise);
        const edgesSpy = jest
          .spyOn(service as any, 'fetchAgentEdges')
          .mockReturnValue(edges.promise);
        const hierarchySpy = jest
          .spyOn(service as any, 'buildFeatureHierarchy')
          .mockImplementation(() => {
            hierarchyStarted.resolve();
            return hierarchy.promise;
          });
        const neighborhoodSpy = jest
          .spyOn(service as any, 'fetchEntityNeighborhood')
          .mockImplementation(() => {
            neighborhoodStarted.resolve();
            return Promise.resolve(makeNeighborhood());
          });
        const result = service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK',
          entityId,
          'test-token',
        );
        for (const spy of [
          contentSpy,
          contextSpy,
          planSpy,
          edgesSpy,
          hierarchySpy,
          neighborhoodSpy,
        ]) {
          expect(spy).not.toHaveBeenCalled();
        }
        authorization.resolve({ projectId: testIds.project });
        await authorization.promise;
        for (const spy of [contentSpy, contextSpy, planSpy, edgesSpy]) {
          expect(spy).toHaveBeenCalledTimes(1);
        }
        if (last === 'plan') edges.resolve([]);
        else plan.resolve(null);
        await Promise.resolve();
        expect(hierarchySpy).not.toHaveBeenCalled();
        expect(neighborhoodSpy).not.toHaveBeenCalled();
        if (last === 'plan') plan.resolve(null);
        else edges.resolve([]);
        await hierarchyStarted.promise;
        expect(neighborhoodSpy).not.toHaveBeenCalled();
        hierarchy.resolve([]);
        await neighborhoodStarted.promise;
        // Neither content nor proposal/meta completion gates the neighborhood.
        content.resolve(undefined);
        context.resolve({
          entityId,
          entityType: 'TASK',
          displayName: 'Test Task',
          createdAt: entityCreatedAt.toISOString(),
        });
        await expect(result).resolves.toMatchObject({
          entityId,
          featureHierarchy: [],
        });
      },
    );

    it('settles outstanding reads before propagating a failure', async () => {
      const content = deferred<undefined>();
      const context =
        deferred<
          Awaited<ReturnType<EntityContextService['getEntityContext']>>
        >();
      const started = deferred<void>();
      jest
        .spyOn(service as any, 'loadEntityContent')
        .mockReturnValue(content.promise);
      jest.spyOn(service, 'getEntityContext').mockImplementation(() => {
        started.resolve();
        return context.promise;
      });
      const failure = new Error('content read failed');
      let settled = false;
      const result = service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        null,
        {
          includeRelatedEntities: false,
          includeFeatureHierarchy: false,
        },
      );
      const checked = expect(result).rejects.toBe(failure);
      void result.catch(() => {
        settled = true;
      });
      await started.promise;
      content.reject(failure);
      await content.promise.catch(() => undefined);
      await Promise.resolve();
      expect(settled).toBe(false);
      context.reject(new Error('later metadata failure'));
      await checked;
    });

    beforeEach(() => {
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Test Task',
        type: WORK_ITEM_TYPE_KEYS.Standard,
      });
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
    });

    it.each([
      ['archived', null],
      ['wrong-organization', null],
      ['unknown', null],
      [
        'wrong-project',
        {
          id: entityId,
          projectId: '123e4567-e89b-42d3-a456-426614174098',
        },
      ],
    ])(
      'rejects a %s TASK seed before context assembly',
      async (_scenario, resolvedTask) => {
        mockTaskService.findPersistedByOrganization.mockResolvedValueOnce(
          resolvedTask,
        );

        await expect(
          service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          ),
        ).rejects.toThrow(`TASK with id ${entityId} not found`);

        expect(
          mockTaskService.findPersistedByOrganization,
        ).toHaveBeenCalledWith(testIds.organization, entityId);
        expect(mockGraphsClient.readIncidentEdges).not.toHaveBeenCalled();
        expect(mockGraphsClient.getEntityNeighborhood).not.toHaveBeenCalled();
        expect((mockPrisma.db as any).$queryRaw).not.toHaveBeenCalled();
        expect(mockPrisma.db.task.findUnique).not.toHaveBeenCalled();
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).not.toHaveBeenCalled();
        expect((mockPrisma.db as any).proposal.findMany).not.toHaveBeenCalled();
      },
    );

    it('preserves plan context for an authorized plan-resident STANDARD TASK', async () => {
      const planId = '123e4567-e89b-42d3-a456-426614174800';
      const stageId = '123e4567-e89b-42d3-a456-426614174801';
      const trackedTaskId = '123e4567-e89b-42d3-a456-426614174806';
      const taskRow = {
        id: trackedTaskId,
        name: 'Update checkout',
        createdAt: entityCreatedAt,
        status: 'BACKLOG',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
        type: WORK_ITEM_TYPE_KEYS.Standard,
        parentTaskId: stageId,
        sections: [],
        subTasks: [],
        parentTask: {
          id: stageId,
          name: 'Discovery',
          status: 'REFINING',
          type: 'PLAN_STAGE',
          parentTaskId: planId,
          parentTask: {
            id: planId,
            name: 'Pricing Revamp',
            status: 'ACTIVE',
            type: 'PLAN',
            parentTaskId: null,
          },
        },
      };
      mockTaskService.findPersistedByOrganization.mockResolvedValueOnce(
        makeSeedRow({ id: trackedTaskId, name: 'Update checkout' }),
      );
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue(taskRow);
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        {
          id: stageId,
          name: 'Discovery',
          status: 'REFINING',
          type: 'PLAN_STAGE',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        trackedTaskId,
        'test-token',
        {
          includeRelatedEntities: false,
          includeFeatureHierarchy: false,
        },
      );

      expect(result.planContext?.parentPlan).toMatchObject({
        id: planId,
        taskType: 'PLAN',
      });
      expect(result.planContext?.parentStage).toMatchObject({
        id: stageId,
        taskType: 'PLAN_STAGE',
      });
      expect(result.planContext?.siblingStages).toEqual([
        expect.objectContaining({ id: stageId, taskType: 'PLAN_STAGE' }),
      ]);

      const explicitlyIncludedResult = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        trackedTaskId,
        'test-token',
        {
          includeRelatedEntities: false,
          includeFeatureHierarchy: false,
          includePlan: true,
        },
      );
      expect(explicitlyIncludedResult.planContext).toEqual(result.planContext);
      expect(explicitlyIncludedResult.featureHierarchy).toBeUndefined();
    });

    it('omits Plan placement but keeps lightweight Plan pivots for other projections', async () => {
      const planId = '123e4567-e89b-42d3-a456-426614174800';
      const stageId = '123e4567-e89b-42d3-a456-426614174801';
      const siblingStageId = '123e4567-e89b-42d3-a456-426614174802';
      const trackedTaskId = '123e4567-e89b-42d3-a456-426614174806';
      const featureId = '123e4567-e89b-42d3-a456-426614174803';
      mockTaskService.findPersistedByOrganization.mockResolvedValueOnce(
        makeSeedRow({ id: trackedTaskId, name: 'Update checkout' }),
      );
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        id: trackedTaskId,
        createdAt: entityCreatedAt,
        name: 'Update checkout',
        type: WORK_ITEM_TYPE_KEYS.Standard,
        parentTaskId: stageId,
        parentTask: {
          id: stageId,
          type: 'PLAN_STAGE',
          parentTaskId: planId,
          parentTask: {
            id: planId,
            type: 'PLAN',
            parentTaskId: featureId,
          },
        },
      });
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: stageId },
        { id: siblingStageId },
      ]);
      const buildPlanContext = jest.spyOn(service as any, 'buildPlanContext');
      const buildFeatureHierarchy = jest
        .spyOn(service as any, 'buildFeatureHierarchy')
        .mockResolvedValue([]);

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        trackedTaskId,
        'test-token',
        { includePlan: false },
      );

      expect(result.planContext).toBeUndefined();
      expect(result.featureHierarchy).toEqual([]);
      expect(result.relatedEntities).toEqual([]);
      expect(result.agentSessions).toEqual([]);
      expect(buildPlanContext).not.toHaveBeenCalled();
      expect(buildFeatureHierarchy).toHaveBeenCalledWith(
        testIds.project,
        'TASK',
        trackedTaskId,
        expect.any(Array),
        featureId,
      );
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith({
        where: {
          parentTaskId: planId,
          type: 'PLAN_STAGE',
          archivedAt: null,
        },
        select: { id: true },
      });
      expect((service as any).planDependencies.outgoing).not.toHaveBeenCalled();
      expect(mockGraphsClient.getEntityNeighborhood).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          seedEntityId: trackedTaskId,
          planPivotEntityIds: expect.arrayContaining([
            planId,
            stageId,
            siblingStageId,
          ]),
        }),
        'test-token',
      );
    });

    it('omits Plan context for an ordinary Task without loading Plan stages', async () => {
      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
        {
          includePlan: false,
          includeRelatedEntities: false,
          includeFeatureHierarchy: false,
        },
      );

      expect(result.planContext).toBeUndefined();
      expect(result.displayName).toBe('Test Task');
      expect(mockPrisma.db.task.findMany).not.toHaveBeenCalled();
      expect(mockGraphsClient.getEntityNeighborhood).not.toHaveBeenCalled();
    });

    it('returns relatedEntities for direct semantic edges, dropping structural-only ones', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(result.entityId).toBe(entityId);
      expect(result.entityType).toBe('TASK');

      // The plan reached via MENTIONS surfaces; the related task with no
      // direct semantic edge (or pivot path) does not.
      expect(result.relatedEntities).toHaveLength(1);
      expect(result.relatedEntities![0]).toMatchObject({
        entityId: relatedPlanId,
        entityType: 'PLAN',
        displayName: 'Parent Plan',
        status: 'ACTIVE',
        relationship: 'mentions',
        source: 'system',
      });
      expect(result.relatedEntities![0]!.via).toBeUndefined();
      expect(result.relatedEntities![0]!.reasoning).toBeUndefined();
    });

    it('surfaces outbound Goal TRACKS neighbors as tracked-by with resolved subtypes', async () => {
      const goalId = '123e4567-e89b-42d3-a456-426614174091';
      const trackedTaskId = '123e4567-e89b-42d3-a456-426614174092';
      mockTaskService.findPersistedByOrganization.mockResolvedValueOnce(
        makeSeedRow({ id: goalId, name: 'Goal', type: 'GOAL' }),
      );
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: trackedTaskId,
              entityType: 'TASK',
              displayName: 'Tracked Standard Task',
              relationship: 'tracked-by',
              taskType: 'STANDARD',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        goalId,
        'test-token',
      );

      expect(result.taskType).toBe('GOAL');
      expect(result.relatedEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: trackedTaskId,
            relationship: 'tracked-by',
            taskType: 'STANDARD',
          }),
        ]),
      );
    });

    it('surfaces inbound Goal TRACKS neighbors as tracks with resolved subtypes', async () => {
      const goalId = '123e4567-e89b-42d3-a456-426614174093';
      const trackedTaskId = '123e4567-e89b-42d3-a456-426614174094';
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Tracked Standard Task',
        type: 'STANDARD',
      });
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: goalId,
              entityType: 'TASK',
              displayName: 'Tracking Goal',
              relationship: 'tracks',
              taskType: 'GOAL',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        trackedTaskId,
        'test-token',
      );

      expect(result.taskType).toBe('STANDARD');
      expect(result.relatedEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: goalId,
            relationship: 'tracks',
            taskType: 'GOAL',
          }),
        ]),
      );
    });

    it('encodes direction in the value for inbound MENTIONS', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: relatedTaskId,
              entityType: 'TASK',
              displayName: 'Mentioner',
              relationship: 'mentioned-by',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(result.relatedEntities).toHaveLength(1);
      expect(result.relatedEntities![0]!.relationship).toBe('mentioned-by');
    });

    it('maps CREATED_VIA, BLOCKS, and DERIVES_FROM to their relationship values', async () => {
      const blockerId = '123e4567-e89b-42d3-a456-426614174082';
      const sourceId = '123e4567-e89b-42d3-a456-426614174083';

      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: relatedPlanId,
              entityType: 'PLAN',
              displayName: 'Plan',
              relationship: 'created-via',
            },
            {
              entityId: blockerId,
              entityType: 'TASK',
              displayName: 'Blocker',
              relationship: 'blocks',
            },
            {
              entityId: sourceId,
              entityType: 'DESIGN_DOC',
              displayName: 'Source Doc',
              relationship: 'derives-from',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const byEntity = new Map(
        (result.relatedEntities ?? []).map((e) => [e.entityId, e.relationship]),
      );
      expect(byEntity.get(relatedPlanId)).toBe('created-via');
      expect(byEntity.get(blockerId)).toBe('blocks');
      expect(byEntity.get(sourceId)).toBe('derives-from');
    });

    it('drops entities that are only reachable via structural edges (no semantic content)', async () => {
      // The relatedTaskId in makeGraphResponse() has no edge to the seed
      // and no feature pivot — confirms it is not included.
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const ids = (result.relatedEntities ?? []).map((e) => e.entityId);
      expect(ids).not.toContain(entityId);
      expect(ids).not.toContain(relatedTaskId);
    });

    it('extracts displayName from title and name properties', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const planEntry = result.relatedEntities!.find(
        (e) => e.entityId === relatedPlanId,
      );
      expect(planEntry!.displayName).toBe('Parent Plan');
      expect(planEntry!.status).toBe('ACTIVE');
    });

    it('strips status from a FEATURE-typed relatedEntities entry but keeps it for non-feature entries', async () => {
      const featureAncestorId = '123e4567-e89b-42d3-a456-426614174075';

      // Ancestor CTE places featureAncestorId in the feature hierarchy, so it
      // lands in featureIds. The seed task itself sits beneath it.
      (mockPrisma.db as any).$queryRaw
        .mockResolvedValueOnce([
          {
            id: entityId,
            name: 'My Task',
            type: 'STANDARD',
            parent_task_id: featureAncestorId,
            distance: 0,
          },
          {
            id: featureAncestorId,
            name: 'Parent Feature',
            type: 'FEATURE',
            parent_task_id: null,
            distance: 1,
          },
        ])
        .mockResolvedValueOnce([]); // no descendants

      // The neighborhood surfaces both the feature (in featureIds) and a
      // sibling STANDARD task (not in featureIds), each carrying a status.
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: featureAncestorId,
              entityType: 'FEATURE',
              displayName: 'Parent Feature',
              status: 'ACTIVE',
              relationship: 'related-to',
            },
            {
              entityId: relatedTaskId,
              entityType: 'STANDARD',
              displayName: 'Sibling Task',
              status: 'IN_PROGRESS',
              relationship: 'mentions',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const featureEntry = result.relatedEntities!.find(
        (e) => e.entityId === featureAncestorId,
      );
      const siblingEntry = result.relatedEntities!.find(
        (e) => e.entityId === relatedTaskId,
      );

      // Feature entries carry no work status — it must be stripped.
      expect(featureEntry).toBeDefined();
      expect(featureEntry!.status).toBeUndefined();
      // Non-feature entries keep their status unchanged.
      expect(siblingEntry).toBeDefined();
      expect(siblingEntry!.status).toBe('IN_PROGRESS');
    });

    it('forwards taskType onto labeled-path TASK entries (STANDARD, BUG, custom MARKETING)', async () => {
      const standardTaskId = '123e4567-e89b-42d3-a456-426614174070';
      const bugTaskId = '123e4567-e89b-42d3-a456-426614174071';
      const marketingTaskId = '123e4567-e89b-42d3-a456-426614174072';

      // MARKETING is an opaque custom registry key — taskType is a plain
      // string on the wire, never narrowed to the WorkItemTypeKey enum, so a
      // registry-defined type rides through the mapper unchanged.
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: standardTaskId,
              entityType: 'TASK',
              displayName: 'Standard Task',
              status: 'ACTIVE',
              relationship: 'mentions',
              taskType: 'STANDARD',
            },
            {
              entityId: bugTaskId,
              entityType: 'TASK',
              displayName: 'Bug Task',
              status: 'ACTIVE',
              relationship: 'mentions',
              taskType: 'BUG',
            },
            {
              entityId: marketingTaskId,
              entityType: 'TASK',
              displayName: 'Marketing Task',
              status: 'ACTIVE',
              relationship: 'mentions',
              taskType: 'MARKETING',
            },
          ],
        }),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const byEntity = new Map(
        (result.relatedEntities ?? []).map((e) => [e.entityId, e.taskType]),
      );
      expect(byEntity.get(standardTaskId)).toBe('STANDARD');
      expect(byEntity.get(bugTaskId)).toBe('BUG');
      expect(byEntity.get(marketingTaskId)).toBe('MARKETING');
    });

    it('returns empty relatedEntities and agentSessions when graph traversal fails', async () => {
      mockGraphsClient.getEntityNeighborhood.mockRejectedValue(
        new Error('Graph service unavailable'),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(result.entityId).toBe(entityId);
      expect(result.proposals).toEqual([]);
      expect(result.relatedEntities).toEqual([]);
      expect(result.agentSessions).toEqual([]);
    });

    it('returns empty relatedEntities and agentSessions when userToken is null', async () => {
      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        null,
      );

      expect(result.relatedEntities).toEqual([]);
      expect(result.agentSessions).toEqual([]);
      expect(mockGraphsClient.getEntityNeighborhood).not.toHaveBeenCalled();
    });

    it('breaks AGENT_SESSION traversal nodes out into agentSessions[] (depth 1 only)', async () => {
      const agentSessionDepth1 = '123e4567-e89b-42d3-a456-426614174090';
      const agentSessionDepth2 = '123e4567-e89b-42d3-a456-426614174091';

      // The graph service is responsible for the depth-1 split — this test
      // simply asserts that whatever it returns in agentSessions[] vs
      // relatedEntities[] surfaces unchanged through the API.
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [],
          agentSessions: [
            {
              entityId: agentSessionDepth1,
              entityType: 'AGENT_SESSION',
              displayName: 'Session at depth 1',
            },
          ],
        }),
      );
      // Keep the unused symbol referenced so eslint doesn't flag it.
      void agentSessionDepth2;

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      const sessionIds = (result.agentSessions ?? []).map((e) => e.entityId);
      expect(sessionIds).toContain(agentSessionDepth1);
      expect(sessionIds).not.toContain(agentSessionDepth2);

      const relatedIds = (result.relatedEntities ?? []).map((e) => e.entityId);
      expect(relatedIds).not.toContain(agentSessionDepth1);
      expect(relatedIds).not.toContain(agentSessionDepth2);
    });

    it('orders attached sessions by persisted creation time with an identity tie-breaker', async () => {
      const older = '123e4567-e89b-42d3-a456-426614174090';
      const newestB = '123e4567-e89b-42d3-a456-426614174092';
      const newestA = '123e4567-e89b-42d3-a456-426614174091';
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [],
          agentSessions: [newestB, older, newestA].map((id) => ({
            entityId: id,
            entityType: 'AGENT_SESSION',
            displayName: id,
          })),
        }),
      );
      (mockPrisma.db.agentSession.findMany as jest.Mock).mockResolvedValue([
        { id: newestA },
        { id: newestB },
        { id: older },
      ]);

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(result.agentSessions?.map((entry) => entry.entityId)).toEqual([
        newestA,
        newestB,
        older,
      ]);
      expect(mockPrisma.db.agentSession.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          id: { in: [newestB, older, newestA] },
        },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    });

    it('throws when getEntityContext fails', async () => {
      (mockPrisma.db.task.findUnique as jest.Mock).mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        ),
      ).rejects.toThrow('DB connection lost');
    });

    it('defaults the graph neighborhood to one hop', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(mockGraphsClient.getEntityNeighborhood).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          seedEntityId: entityId,
          seedEntityType: 'TASK',
          depth: 1,
          relationshipTypes: expect.arrayContaining([RelationshipType.Tracks]),
        }),
        'test-token',
      );
    });

    it('passes an explicit two-hop neighborhood depth to graph service', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
        { relatedEntityDepth: 2 },
      );

      expect(mockGraphsClient.getEntityNeighborhood).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          seedEntityId: entityId,
          seedEntityType: 'TASK',
          depth: 2,
        }),
        'test-token',
      );
    });

    it('preserves Graph sibling labels, sessions and endpoint metadata in the same projection', async () => {
      const siblingId = '123e4567-e89b-42d3-a456-426614174082';
      const pivotId = '123e4567-e89b-42d3-a456-426614174083';
      const sessionId = '123e4567-e89b-42d3-a456-426614174084';
      const endpointId = '123e4567-e89b-42d3-a456-426614174085';
      const projection: EntityNeighborhoodResponse = makeNeighborhood({
        relatedEntities: [
          {
            entityId: siblingId,
            entityType: 'TASK',
            displayName: 'Sibling implementation',
            taskType: 'STANDARD',
            status: 'ACTIVE',
            relationship: 'sibling-via-parent',
            via: [
              {
                entityId: pivotId,
                entityType: 'TASK',
                displayName: 'Parent capability',
                relationship: 'sibling-via-parent',
              },
            ],
          },
        ],
        agentSessions: [
          {
            entityId: sessionId,
            entityType: 'AGENT_SESSION',
            displayName: 'Attached coding session',
            status: 'IN_PROGRESS',
          },
        ],
        nodeCatalog: [
          {
            entityId: endpointId,
            entityType: 'TASK',
            displayName: 'Linked dependency',
            taskType: 'BUG',
            status: 'BACKLOG',
          },
        ],
      });
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(projection);
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          {
            id: '123e4567-e89b-42d3-a456-426614174086',
            sourceNodeId: entityId,
            targetNodeId: endpointId,
            type: 'DEPENDS_ON',
            reasoning: 'Required before implementation',
            createdBySessionId: sessionId,
            createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
          },
        ]),
      );
      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        'test-token',
        { relatedEntityDepth: 2 },
      );
      expect(result.relatedEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ...projection.relatedEntities[0],
            source: 'system',
          }),
          expect.objectContaining({
            entityId: endpointId,
            displayName: 'Linked dependency',
            taskType: 'BUG',
            status: 'BACKLOG',
            relationship: 'depends-on',
            source: 'agent',
          }),
        ]),
      );
      expect(result.agentSessions).toEqual(projection.agentSessions);
      expect(mockGraphsClient.getEntityNeighborhood).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({ depth: 2 }),
        'test-token',
      );
    });

    // ── featureHierarchy ───────────────────────────────────────────────────────

    describe('featureHierarchy', () => {
      const parentId = '123e4567-e89b-42d3-a456-426614174070';
      const grandParentId = '123e4567-e89b-42d3-a456-426614174071';
      const siblingId = '123e4567-e89b-42d3-a456-426614174072';
      const childFeatureId = '123e4567-e89b-42d3-a456-426614174073';
      const grandChildFeatureId = '123e4567-e89b-42d3-a456-426614174074';

      // Helper: build an ancestor CTE result row
      function ancestorRow(
        id: string,
        name: string,
        type: string,
        parent_task_id: string | null,
        distance: number,
      ) {
        return { id, name, type, parent_task_id, distance };
      }

      beforeEach(() => {
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
        });
      });

      it('returns empty featureHierarchy for a TASK with no parent', async () => {
        // Ancestor CTE returns only the entity itself (distance 0, no parent)
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // ancestor CTE
            ancestorRow(entityId, 'My Task', 'STANDARD', null, 0),
          ])
          .mockResolvedValueOnce([]); // descendant CTE

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.featureHierarchy).toEqual([]);
      });

      it('returns empty featureHierarchy for a non-TASK entity', async () => {
        (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue({
          createdAt: entityCreatedAt,
        });

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'DESIGN_DOC' as EntityType,
          entityId,
          null,
        );

        expect(result.featureHierarchy).toEqual([]);
        // buildFeatureHierarchy short-circuits for non-TASK entities
        expect((mockPrisma.db as any).$queryRaw).not.toHaveBeenCalled();
      });

      it('returns ancestor FEATURE tasks in the parent chain with correct distances', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // ancestor CTE: entity + 2 FEATURE ancestors
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(
              parentId,
              'Parent Feature',
              'FEATURE',
              grandParentId,
              1,
            ),
            ancestorRow(
              grandParentId,
              'Grandparent Feature',
              'FEATURE',
              null,
              2,
            ),
          ])
          .mockResolvedValueOnce([]); // descendant CTE

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const ancestors = result.featureHierarchy!.filter(
          (e) => e.relationship === 'ancestor',
        );
        expect(ancestors).toHaveLength(2);
        expect(ancestors[0]).toMatchObject({
          id: parentId,
          name: 'Parent Feature',
          relationship: 'ancestor',
          distance: 1,
        });
        expect(ancestors[1]).toMatchObject({
          id: grandParentId,
          name: 'Grandparent Feature',
          relationship: 'ancestor',
          distance: 2,
        });
      });

      it('skips non-FEATURE tasks in the ancestor chain but includes FEATURE ones', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // STANDARD parent skipped; FEATURE grandparent included
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(
              parentId,
              'Standard Parent',
              'STANDARD',
              grandParentId,
              1,
            ),
            ancestorRow(
              grandParentId,
              'Grandparent Feature',
              'FEATURE',
              null,
              2,
            ),
          ])
          .mockResolvedValueOnce([]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const ancestors = result.featureHierarchy!.filter(
          (e) => e.relationship === 'ancestor',
        );
        expect(ancestors).toHaveLength(1);
        expect(ancestors[0]).toMatchObject({
          id: grandParentId,
          name: 'Grandparent Feature',
          relationship: 'ancestor',
          distance: 2,
        });
      });

      it('returns sibling FEATURE tasks with distance 1', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // entity has a parent → siblings will be queried
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([]); // no descendants
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([
          { id: siblingId, name: 'Sibling Feature' },
        ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const siblings = result.featureHierarchy!.filter(
          (e) => e.relationship === 'sibling',
        );
        expect(siblings).toHaveLength(1);
        expect(siblings[0]).toMatchObject({
          id: siblingId,
          name: 'Sibling Feature',
          relationship: 'sibling',
          distance: 1,
        });
      });

      it('omits a GOAL ancestor from the parent chain even when the CTE returns it', async () => {
        const goalAncestorId = '88888888-8888-4888-8888-888888888881';
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(
              parentId,
              'Parent Feature',
              'FEATURE',
              goalAncestorId,
              1,
            ),
            ancestorRow(goalAncestorId, 'Top Goal', 'GOAL', null, 2),
          ])
          .mockResolvedValueOnce([]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const ancestorIds = (result.featureHierarchy ?? [])
          .filter((e) => e.relationship === 'ancestor')
          .map((e) => e.id);
        expect(ancestorIds).toContain(parentId);
        expect(ancestorIds).not.toContain(goalAncestorId);
      });

      it('omits GOAL siblings via the prisma where-clause', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([]);
        const findManyMock = mockPrisma.db.task.findMany as jest.Mock;
        findManyMock.mockResolvedValueOnce([
          { id: siblingId, name: 'Sibling Feature' },
        ]);

        await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(findManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              parentTaskId: parentId,
              type: { in: [WORK_ITEM_TYPE_KEYS.Feature] },
            }),
          }),
        );
      });

      it('omits GOAL descendants from the subtree even when the CTE returns them', async () => {
        const goalDescendantId = '88888888-8888-4888-8888-888888888882';
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            ancestorRow(entityId, 'Root Feature', 'FEATURE', null, 0),
          ])
          .mockResolvedValueOnce([
            {
              id: childFeatureId,
              name: 'Child Feature',
              type: 'FEATURE',
              distance: 1,
            },
            {
              id: goalDescendantId,
              name: 'Goal Descendant',
              type: 'GOAL',
              distance: 1,
            },
          ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const descendantIds = (result.featureHierarchy ?? [])
          .filter((e) => e.relationship === 'descendant')
          .map((e) => e.id);
        expect(descendantIds).toContain(childFeatureId);
        expect(descendantIds).not.toContain(goalDescendantId);
      });

      it('returns descendant FEATURE tasks with correct distances', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // root FEATURE with no parent → no siblings
            ancestorRow(entityId, 'Root Feature', 'FEATURE', null, 0),
          ])
          .mockResolvedValueOnce([
            // descendant CTE: child + grandchild
            {
              id: childFeatureId,
              name: 'Child Feature',
              type: 'FEATURE',
              distance: 1,
            },
            {
              id: grandChildFeatureId,
              name: 'Grandchild Feature',
              type: 'FEATURE',
              distance: 2,
            },
          ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const descendants = result.featureHierarchy!.filter(
          (e) => e.relationship === 'descendant',
        );
        expect(descendants).toHaveLength(2);
        expect(descendants[0]).toMatchObject({
          id: childFeatureId,
          name: 'Child Feature',
          relationship: 'descendant',
          distance: 1,
        });
        expect(descendants[1]).toMatchObject({
          id: grandChildFeatureId,
          name: 'Grandchild Feature',
          relationship: 'descendant',
          distance: 2,
        });
      });

      it('returns short description untruncated with matching descriptionFullLength', async () => {
        const shortDesc = '# Parent Feature\n\nThis is the parent.';
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // ancestor CTE
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([]); // no descendants
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([
          { taskId: parentId, materializedMarkdown: shortDesc },
        ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.featureHierarchy).toHaveLength(1);
        expect(result.featureHierarchy![0]).toMatchObject({
          id: parentId,
          name: 'Parent Feature',
          description: shortDesc,
          descriptionFullLength: shortDesc.length,
        });
      });

      it('truncates description to 225 chars and sets descriptionFullLength to full length', async () => {
        const longDesc = 'A'.repeat(500);
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // ancestor CTE
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([]); // no descendants
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([
          { taskId: parentId, materializedMarkdown: longDesc },
        ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.featureHierarchy).toHaveLength(1);
        const entry = result.featureHierarchy![0]!;
        expect(entry.description).toHaveLength(225);
        expect(entry.description).toBe('A'.repeat(225));
        expect(entry.descriptionFullLength).toBe(500);
      });

      it('returns description and descriptionFullLength as null when no section exists', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // ancestor CTE
            ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([]); // no descendants
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.featureHierarchy).toHaveLength(1);
        expect(result.featureHierarchy![0]).toMatchObject({
          id: parentId,
          description: null,
          descriptionFullLength: null,
        });
      });

      it('includes all three relationship types together', async () => {
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            // entity + one FEATURE ancestor
            ancestorRow(entityId, 'My Feature', 'FEATURE', parentId, 0),
            ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
          ])
          .mockResolvedValueOnce([
            // one descendant
            {
              id: childFeatureId,
              name: 'Child Feature',
              type: 'FEATURE',
              distance: 1,
            },
          ]);
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([
          { id: siblingId, name: 'Sibling Feature' },
        ]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(
          result.featureHierarchy!.filter((e) => e.relationship === 'ancestor'),
        ).toHaveLength(1);
        expect(
          result.featureHierarchy!.filter((e) => e.relationship === 'sibling'),
        ).toHaveLength(1);
        expect(
          result.featureHierarchy!.filter(
            (e) => e.relationship === 'descendant',
          ),
        ).toHaveLength(1);
      });

      // ── Typed-edge entries between FEATURE tasks ────────────────────────────

      describe('typed-edge entries', () => {
        const connectedFeatureA = '123e4567-e89b-42d3-a456-426614174801';
        const connectedFeatureB = '123e4567-e89b-42d3-a456-426614174802';
        const otherSubtreeParentId = '123e4567-e89b-42d3-a456-426614174803';
        const nonFeatureTaskId = '123e4567-e89b-42d3-a456-426614174804';

        it('marks every entry relationshipType=structural and emits no typed entries when the feature seed has no typed edges', async () => {
          // Seed is a FEATURE with one ancestor feature; no typed edges.
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'My Feature', 'FEATURE', parentId, 0),
              ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
            ])
            .mockResolvedValueOnce([]); // no descendants

          // Siblings query returns nothing.
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          expect(result.featureHierarchy).toHaveLength(1);
          for (const entry of result.featureHierarchy!) {
            expect(entry.relationshipType).toBe('structural');
            expect(entry.direction).toBeUndefined();
            expect(entry.parentTaskId).toBeUndefined();
            expect(entry.reasoning).toBeUndefined();
          }
        });

        it('emits an outbound RELATED_TO entry with parentTaskId and reasoning for a feature-to-feature edge in a sibling subtree', async () => {
          // Seed is a FEATURE with no structural relatives.
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'My Feature', 'FEATURE', null, 0),
            ])
            .mockResolvedValueOnce([]); // no descendants
          // No siblings (no parent_task_id), so siblings.findMany is skipped;
          // the only task.findMany call is the typed-edge hydration.
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([
            {
              id: connectedFeatureA,
              name: 'Sibling Subtree Feature',
              type: 'FEATURE',
              parentTaskId: otherSubtreeParentId,
            },
          ]);

          mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
            makeAgentEdgeSearchResponse(entityId, [
              {
                id: '123e4567-e89b-42d3-a456-426614174900',
                sourceNodeId: entityId,
                targetNodeId: connectedFeatureA,
                type: 'RELATED_TO',
                reasoning: 'Two features share the same intent',
                createdBySessionId: '123e4567-e89b-42d3-a456-426614174901',
                createdAt: '2026-04-01T00:00:00Z',
                updatedAt: '2026-04-01T00:00:00Z',
              },
            ]),
          );

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          const typed = result.featureHierarchy!.filter(
            (e) => e.relationshipType !== 'structural',
          );
          expect(typed).toHaveLength(1);
          expect(typed[0]).toMatchObject({
            id: connectedFeatureA,
            name: 'Sibling Subtree Feature',
            relationshipType: 'RELATED_TO',
            direction: 'outbound',
            parentTaskId: otherSubtreeParentId,
            reasoning: 'Two features share the same intent',
          });
        });

        it('emits inbound DEPENDS_ON and outbound SUPERSEDES entries with the correct direction for each', async () => {
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'My Feature', 'FEATURE', null, 0),
            ])
            .mockResolvedValueOnce([]);
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([
            {
              id: connectedFeatureA,
              name: 'Depender Feature',
              type: 'FEATURE',
              parentTaskId: null,
            },
            {
              id: connectedFeatureB,
              name: 'Superseded Feature',
              type: 'FEATURE',
              parentTaskId: null,
            },
          ]);

          mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
            makeAgentEdgeSearchResponse(entityId, [
              // seed → connectedFeatureB (SUPERSEDES)
              {
                id: '123e4567-e89b-42d3-a456-426614174910',
                sourceNodeId: entityId,
                targetNodeId: connectedFeatureB,
                type: 'SUPERSEDES',
                reasoning: 'Seed supersedes B',
                createdBySessionId: '123e4567-e89b-42d3-a456-426614174911',
                createdAt: '2026-04-01T00:00:00Z',
                updatedAt: '2026-04-01T00:00:00Z',
              },
              // connectedFeatureA → seed (DEPENDS_ON)
              {
                id: '123e4567-e89b-42d3-a456-426614174912',
                sourceNodeId: connectedFeatureA,
                targetNodeId: entityId,
                type: 'DEPENDS_ON',
                reasoning: 'A depends on Seed',
                createdBySessionId: '123e4567-e89b-42d3-a456-426614174913',
                createdAt: '2026-04-01T00:00:00Z',
                updatedAt: '2026-04-01T00:00:00Z',
              },
            ]),
          );

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          const typed = result.featureHierarchy!.filter(
            (e) => e.relationshipType !== 'structural',
          );
          expect(typed).toHaveLength(2);
          const byId = new Map(typed.map((e) => [e.id, e]));
          expect(byId.get(connectedFeatureA)).toMatchObject({
            relationshipType: 'DEPENDS_ON',
            direction: 'inbound',
            parentTaskId: null,
            reasoning: 'A depends on Seed',
          });
          expect(byId.get(connectedFeatureB)).toMatchObject({
            relationshipType: 'SUPERSEDES',
            direction: 'outbound',
            parentTaskId: null,
            reasoning: 'Seed supersedes B',
          });
        });

        it('skips edges to non-FEATURE endpoints in featureHierarchy and lets them surface in relatedEntities', async () => {
          // Graph service traversal sees the non-feature endpoint
          // (AGENT_LINKED is in the topology whitelist) so it ships
          // in nodeCatalog for hydration, but doesn't label it — no
          // semantic edge, no pivot. The agent-edge merger picks it
          // up from nodeCatalog and surfaces it with reasoning.
          mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
            relatedEntities: [],
            agentSessions: [],
            nodeCatalog: [
              {
                entityId: nonFeatureTaskId,
                entityType: 'TASK',
                displayName: 'Non-feature Task',
                status: 'BACKLOG',
              },
            ],
          });

          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'Seed Feature', 'FEATURE', null, 0),
            ])
            .mockResolvedValueOnce([]);
          // Typed-edge hydration returns the connected task as a non-FEATURE.
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([
            {
              id: nonFeatureTaskId,
              name: 'Non-feature Task',
              type: 'STANDARD',
              parentTaskId: null,
            },
          ]);

          mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
            makeAgentEdgeSearchResponse(entityId, [
              {
                id: '123e4567-e89b-42d3-a456-426614174920',
                sourceNodeId: entityId,
                targetNodeId: nonFeatureTaskId,
                type: 'RELATED_TO',
                reasoning: 'Cross-type relation',
                createdBySessionId: '123e4567-e89b-42d3-a456-426614174921',
                createdAt: '2026-04-01T00:00:00Z',
                updatedAt: '2026-04-01T00:00:00Z',
              },
            ]),
          );

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          const featureHierarchyIds = (result.featureHierarchy ?? []).map(
            (e) => e.id,
          );
          expect(featureHierarchyIds).not.toContain(nonFeatureTaskId);

          const related = (result.relatedEntities ?? []).find(
            (e) => e.entityId === nonFeatureTaskId,
          );
          expect(related).toBeDefined();
          expect(related).toMatchObject({
            relationship: 'related-to',
            reasoning: 'Cross-type relation',
          });
        });
      });

      // ── Plan-walk pivot for plan-resident seeds ──────────────────────────
      //
      // When the seed is plan-resident (PLAN_STAGE, PLAN_STEP, or a
      // plan-tracked TASK/DESIGN_DOC), the feature hierarchy walks the plan's
      // parentTaskId chain instead of the seed's own (often empty) parent
      // chain. The pivot feature itself is the virtual seed — its ancestors
      // appear at distance 1, 2, ..., its siblings at distance 1, and its
      // descendants at distance 1, 2, ... — matching what a TASK seed rooted
      // at that feature would produce today.

      describe('plan-resident seeds (plan-walk pivot)', () => {
        const planResidentPlanId = '123e4567-e89b-42d3-a456-426614174a00';
        const planResidentStageId = '123e4567-e89b-42d3-a456-426614174a01';
        const planResidentStepId = '123e4567-e89b-42d3-a456-426614174a02';
        const planResidentDocId = '123e4567-e89b-42d3-a456-426614174a03';
        const planResidentTaskId = '123e4567-e89b-42d3-a456-426614174a04';
        const featureId = '123e4567-e89b-42d3-a456-426614174a05';
        const featureParentId = '123e4567-e89b-42d3-a456-426614174a06';
        const featureGrandparentId = '123e4567-e89b-42d3-a456-426614174a07';
        const featureSiblingId = '123e4567-e89b-42d3-a456-426614174a08';
        const featureChildId = '123e4567-e89b-42d3-a456-426614174a09';
        const explicitParentId = '123e4567-e89b-42d3-a456-426614174a0a';
        const explicitGrandparentId = '123e4567-e89b-42d3-a456-426614174a0b';

        // Stage / step / plan fixtures used by buildPlanContext.
        const stageFixture = {
          id: planResidentStageId,
          title: 'Discovery',
          status: 'IN_PROGRESS',
          sequenceOrder: 1,
        };
        const planFixtureWithFeature = {
          id: planResidentPlanId,
          title: 'Plan',
          status: 'ACTIVE',
          parentTaskId: featureId,
          stages: [stageFixture],
        };

        // Ancestor CTE rows rooted at featureId. Distance 0 is the feature
        // itself (skipped by the > 0 filter); distance 1 / 2 are its
        // ancestors. Returned without the parent_task_id field set on
        // distance > 0 rows to keep fixtures minimal.
        function ancestorChainRootedAtFeature() {
          return [
            {
              id: featureId,
              name: 'Pivot Feature',
              type: 'FEATURE',
              tag: null,
              parent_task_id: featureParentId,
              distance: 0,
            },
            {
              id: featureParentId,
              name: 'Parent Feature',
              type: 'FEATURE',
              tag: null,
              parent_task_id: featureGrandparentId,
              distance: 1,
            },
            {
              id: featureGrandparentId,
              name: 'Grandparent Feature',
              type: 'FEATURE',
              tag: null,
              parent_task_id: null,
              distance: 2,
            },
          ];
        }

        function expectFeatureAncestry(
          featureHierarchy: ReturnType<typeof Array.prototype.filter> | any,
        ) {
          const ancestors = (featureHierarchy ?? []).filter(
            (e: any) => e.relationship === 'ancestor',
          );
          expect(
            ancestors.map((a: any) => ({ id: a.id, distance: a.distance })),
          ).toEqual([
            { id: featureParentId, distance: 1 },
            { id: featureGrandparentId, distance: 2 },
          ]);
          // The pivot feature itself is the virtual seed and does not
          // surface as its own ancestor.
          expect(
            ancestors.find((a: any) => a.id === featureId),
          ).toBeUndefined();
        }

        it('plan-resident TASK with explicit parentTaskId: explicit parent wins, plan-walk does not fire', async () => {
          (mockPrisma.db.planStep.findFirst as jest.Mock).mockResolvedValue({
            stage: { plan: planFixtureWithFeature },
          });
          // Ancestor CTE rooted at the TASK returns it with its own parent.
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              {
                id: planResidentTaskId,
                name: 'Plan-tracked Task',
                type: 'STANDARD',
                tag: null,
                parent_task_id: explicitParentId,
                distance: 0,
              },
              {
                id: explicitParentId,
                name: 'Explicit Parent',
                type: 'FEATURE',
                tag: null,
                parent_task_id: explicitGrandparentId,
                distance: 1,
              },
              {
                id: explicitGrandparentId,
                name: 'Explicit Grandparent',
                type: 'FEATURE',
                tag: null,
                parent_task_id: null,
                distance: 2,
              },
            ])
            .mockResolvedValueOnce([]); // descendants
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            planResidentTaskId,
            'test-token',
          );

          const ancestors = (result.featureHierarchy ?? []).filter(
            (e) => e.relationship === 'ancestor',
          );
          expect(ancestors.map((a) => a.id)).toEqual([
            explicitParentId,
            explicitGrandparentId,
          ]);
          // The pivot feature from the plan must not leak into the result.
          expect(ancestors.find((a) => a.id === featureId)).toBeUndefined();
          // Plan-walk re-root was not fired → exactly two $queryRaw calls
          // (ancestor + descendant CTE, same as today's TASK path).
          expect(
            ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
          ).toBe(2);
        });
      });

      // ── Baseline: non-plan-resident seeds match today's query count ──────
      //
      // Guard against future plan-walk changes silently adding queries to
      // non-plan-resident paths. The query counts here are the snapshot of
      // pre-plan-walk behaviour.

      describe('baseline query count (non-plan-resident seeds)', () => {
        it('non-plan-resident TASK seed: fires exactly two $queryRaw calls and no plan-walk re-root', async () => {
          (mockPrisma.db.planStep.findFirst as jest.Mock).mockResolvedValue(
            null,
          );
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'My Task', 'STANDARD', parentId, 0),
              ancestorRow(parentId, 'Parent Feature', 'FEATURE', null, 1),
            ])
            .mockResolvedValueOnce([]); // descendants
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          // Snapshot today's behaviour: one ancestor CTE + one descendant CTE.
          expect(
            ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
          ).toBe(2);
          // The sibling query fires once (the entity has a parent).
          expect(mockPrisma.db.task.findMany).toHaveBeenCalledTimes(1);
          // planStep.findFirst is the only plan-context probe — no extras.
          expect(mockPrisma.db.planStep.findFirst).not.toHaveBeenCalled();
          // Result mirrors today's ancestor surface.
          expect((result.featureHierarchy ?? []).map((e) => e.id)).toEqual([
            parentId,
          ]);
        });

        it('FEATURE-typed TASK seed: fires exactly two $queryRaw calls and no plan-walk re-root', async () => {
          (mockPrisma.db.planStep.findFirst as jest.Mock).mockResolvedValue(
            null,
          );
          (mockPrisma.db as any).$queryRaw
            .mockResolvedValueOnce([
              ancestorRow(entityId, 'My Feature', 'FEATURE', null, 0),
            ])
            .mockResolvedValueOnce([]); // descendants
          (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

          await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            entityId,
            'test-token',
          );

          expect(
            ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
          ).toBe(2);
          // FEATURE seed with no parent → no sibling query.
          // task.findMany for typed-edge hydration runs only if edges exist;
          // here none do, so the count stays at 0.
          expect(mockPrisma.db.task.findMany).toHaveBeenCalledTimes(0);
        });
      });
    });

    it('omits relatedEntities and agentSessions when includeRelatedEntities is false', async () => {
      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
        { includeRelatedEntities: false },
      );

      expect(result.relatedEntities).toBeUndefined();
      expect(result.agentSessions).toBeUndefined();
      expect(mockGraphsClient.searchGraphAllPages).not.toHaveBeenCalled();
      expect(result.entityId).toBe(entityId);
      expect(result.displayName).toBe('Test Task');
    });

    it('omits featureHierarchy when includeFeatureHierarchy is false', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
        { includeFeatureHierarchy: false },
      );

      expect(result.featureHierarchy).toBeUndefined();
      expect(result.relatedEntities).toBeDefined();
      expect(result.agentSessions).toBeDefined();
    });

    it('returns featureHierarchy without relatedEntities when only hierarchy requested', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValue([
        {
          id: entityId,
          name: 'Test Task',
          type: 'STANDARD',
          parent_task_id: null,
          distance: BigInt(0),
        },
      ]);

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
        { includeRelatedEntities: false, includeFeatureHierarchy: true },
      );

      expect(result.relatedEntities).toBeUndefined();
      expect(result.agentSessions).toBeUndefined();
      expect(result.featureHierarchy).toBeDefined();
      expect(mockGraphsClient.searchGraphAllPages).not.toHaveBeenCalled();
    });

    it('should return displayName in full context response', async () => {
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood(),
      );

      const result = await service.getFullEntityContext(
        testIds.organization,
        testIds.project,
        'TASK' as EntityType,
        entityId,
        'test-token',
      );

      expect(result.displayName).toBe('Test Task');
    });

    // ── relatedEntities: agent edges ───────────────────────────────────────────

    describe('agent-edge entries in relatedEntities', () => {
      const dependedOnTaskId = '123e4567-e89b-42d3-a456-426614174401';

      it('emits a relatedEntities entry per agent edge with reasoning', async () => {
        // Graph service ships the agent-edge target in nodeCatalog (it
        // was reachable via the AGENT_LINKED whitelist hop) but does not
        // label it — the agent-edge merger in the API surfaces it with
        // reasoning.
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: dependedOnTaskId,
              entityType: 'TASK',
              displayName: 'Dependency Task',
              status: 'BACKLOG',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174500',
              sourceNodeId: entityId,
              targetNodeId: dependedOnTaskId,
              type: 'DEPENDS_ON',
              reasoning: 'Seed depends on this task',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174600',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const agentEntry = (result.relatedEntities ?? []).find(
          (e) => e.entityId === dependedOnTaskId,
        );
        expect(agentEntry).toBeDefined();
        expect(agentEntry).toMatchObject({
          entityType: 'TASK',
          displayName: 'Dependency Task',
          status: 'BACKLOG',
          relationship: 'depends-on',
          source: 'agent',
          reasoning: 'Seed depends on this task',
        });
      });

      it('stamps taskType from nodeCatalog onto agent-edge TASK entries (STANDARD, BUG, custom MARKETING)', async () => {
        const standardTaskId = '123e4567-e89b-42d3-a456-426614174420';
        const bugTaskId = '123e4567-e89b-42d3-a456-426614174421';
        const marketingTaskId = '123e4567-e89b-42d3-a456-426614174422';

        // The agent-edge hydration path reads endpoint metadata from
        // nodeCatalog. taskType rides along for TASK endpoints; a custom
        // registry key (MARKETING) stays an opaque string, not a WORK_ITEM_TYPE_KEYS.
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: standardTaskId,
              entityType: 'TASK',
              displayName: 'Standard Dep',
              status: 'BACKLOG',
              taskType: 'STANDARD',
            },
            {
              entityId: bugTaskId,
              entityType: 'TASK',
              displayName: 'Bug Dep',
              status: 'BACKLOG',
              taskType: 'BUG',
            },
            {
              entityId: marketingTaskId,
              entityType: 'TASK',
              displayName: 'Marketing Dep',
              status: 'BACKLOG',
              taskType: 'MARKETING',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174520',
              sourceNodeId: entityId,
              targetNodeId: standardTaskId,
              type: 'DEPENDS_ON',
              reasoning: 'Depends on standard',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174620',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174521',
              sourceNodeId: entityId,
              targetNodeId: bugTaskId,
              type: 'DEPENDS_ON',
              reasoning: 'Depends on bug',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174621',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174522',
              sourceNodeId: entityId,
              targetNodeId: marketingTaskId,
              type: 'DEPENDS_ON',
              reasoning: 'Depends on marketing',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174622',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const byEntity = new Map(
          (result.relatedEntities ?? []).map((e) => [e.entityId, e.taskType]),
        );
        expect(byEntity.get(standardTaskId)).toBe('STANDARD');
        expect(byEntity.get(bugTaskId)).toBe('BUG');
        expect(byEntity.get(marketingTaskId)).toBe('MARKETING');
      });

      it('encodes direction in the value for SUPERSEDES (outbound vs inbound)', async () => {
        const supersededTaskId = '123e4567-e89b-42d3-a456-426614174402';
        const supersedingTaskId = '123e4567-e89b-42d3-a456-426614174403';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: supersededTaskId,
              entityType: 'TASK',
              displayName: 'Old',
            },
            {
              entityId: supersedingTaskId,
              entityType: 'TASK',
              displayName: 'New',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174501',
              sourceNodeId: entityId,
              targetNodeId: supersededTaskId,
              type: 'SUPERSEDES',
              reasoning: 'Seed supersedes Old',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174601',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174502',
              sourceNodeId: supersedingTaskId,
              targetNodeId: entityId,
              type: 'SUPERSEDES',
              reasoning: 'New supersedes Seed',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174602',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const byEntity = new Map(
          (result.relatedEntities ?? []).map((e) => [
            e.entityId,
            e.relationship,
          ]),
        );
        expect(byEntity.get(supersededTaskId)).toBe('superseded-by');
        expect(byEntity.get(supersedingTaskId)).toBe('supersedes');
      });

      it('encodes direction in the value for BLOCKS (outbound → blocks, inbound → blocked-by)', async () => {
        const blockedById = '123e4567-e89b-42d3-a456-426614174410';
        const blockerOfId = '123e4567-e89b-42d3-a456-426614174411';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: blockedById,
              entityType: 'TASK',
              displayName: 'Blocked Task',
            },
            {
              entityId: blockerOfId,
              entityType: 'TASK',
              displayName: 'Blocker Task',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174510',
              sourceNodeId: entityId,
              targetNodeId: blockedById,
              type: 'BLOCKS',
              reasoning: 'Seed blocks this task',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174610',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174511',
              sourceNodeId: blockerOfId,
              targetNodeId: entityId,
              type: 'BLOCKS',
              reasoning: 'Blocker blocks seed',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174611',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const byEntity = new Map(
          (result.relatedEntities ?? []).map((e) => [
            e.entityId,
            e.relationship,
          ]),
        );
        expect(byEntity.get(blockedById)).toBe('blocks');
        expect(byEntity.get(blockerOfId)).toBe('blocked-by');
      });

      it('encodes direction in the value for DEPENDS_ON (outbound → depends-on, inbound → depended-on-by)', async () => {
        const dependsOnId = '123e4567-e89b-42d3-a456-426614174420';
        const dependedOnById = '123e4567-e89b-42d3-a456-426614174421';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: dependsOnId,
              entityType: 'TASK',
              displayName: 'Dependency',
            },
            {
              entityId: dependedOnById,
              entityType: 'TASK',
              displayName: 'Depender',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174520',
              sourceNodeId: entityId,
              targetNodeId: dependsOnId,
              type: 'DEPENDS_ON',
              reasoning: 'Seed depends on this',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174620',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174521',
              sourceNodeId: dependedOnById,
              targetNodeId: entityId,
              type: 'DEPENDS_ON',
              reasoning: 'Depender depends on seed',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174621',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const byEntity = new Map(
          (result.relatedEntities ?? []).map((e) => [
            e.entityId,
            e.relationship,
          ]),
        );
        expect(byEntity.get(dependsOnId)).toBe('depends-on');
        expect(byEntity.get(dependedOnById)).toBe('depended-on-by');
      });

      it('encodes direction in the value for DERIVES_FROM (outbound → derives-from, inbound → derived-from-by)', async () => {
        const derivesFromId = '123e4567-e89b-42d3-a456-426614174430';
        const derivedFromById = '123e4567-e89b-42d3-a456-426614174431';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: derivesFromId,
              entityType: 'DESIGN_DOC',
              displayName: 'Source Doc',
            },
            {
              entityId: derivedFromById,
              entityType: 'TASK',
              displayName: 'Derived Task',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174530',
              sourceNodeId: entityId,
              targetNodeId: derivesFromId,
              type: 'DERIVES_FROM',
              reasoning: 'Seed derives from this doc',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174630',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174531',
              sourceNodeId: derivedFromById,
              targetNodeId: entityId,
              type: 'DERIVES_FROM',
              reasoning: 'Derived task derives from seed',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174631',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const byEntity = new Map(
          (result.relatedEntities ?? []).map((e) => [
            e.entityId,
            e.relationship,
          ]),
        );
        expect(byEntity.get(derivesFromId)).toBe('derives-from');
        expect(byEntity.get(derivedFromById)).toBe('derived-from-by');
      });

      it('keeps FULFILLED_BY as meta while dropping workflow flow edges from relatedEntities', async () => {
        const fulfilledTaskId = '123e4567-e89b-42d3-a456-426614174432';
        const standardStepId = '123e4567-e89b-42d3-a456-426614174433';
        const conditionalStepId = '123e4567-e89b-42d3-a456-426614174434';
        const loopStepId = '123e4567-e89b-42d3-a456-426614174435';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [],
          agentSessions: [],
          nodeCatalog: [
            {
              entityId: fulfilledTaskId,
              entityType: 'TASK',
              displayName: 'Implementation Task',
              taskType: 'STANDARD',
            },
            {
              entityId: standardStepId,
              entityType: 'TASK',
              displayName: 'Next Step',
              taskType: 'WORKFLOW_STEP',
            },
            {
              entityId: conditionalStepId,
              entityType: 'TASK',
              displayName: 'Branch Step',
              taskType: 'WORKFLOW_STEP',
            },
            {
              entityId: loopStepId,
              entityType: 'TASK',
              displayName: 'Loop Step',
              taskType: 'WORKFLOW_STEP',
            },
          ],
        });

        mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
          makeAgentEdgeSearchResponse(entityId, [
            {
              id: '123e4567-e89b-42d3-a456-426614174532',
              sourceNodeId: entityId,
              targetNodeId: fulfilledTaskId,
              type: 'FULFILLED_BY',
              reasoning: 'Workflow step is implemented by this task',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174632',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174533',
              sourceNodeId: entityId,
              targetNodeId: standardStepId,
              type: 'STANDARD',
              reasoning: 'Ordinary workflow sequence',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174633',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174534',
              sourceNodeId: entityId,
              targetNodeId: conditionalStepId,
              type: 'CONDITIONAL',
              reasoning: 'Conditional workflow branch',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174634',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
            {
              id: '123e4567-e89b-42d3-a456-426614174535',
              sourceNodeId: entityId,
              targetNodeId: loopStepId,
              type: 'LOOP',
              reasoning: 'Loop workflow edge',
              createdBySessionId: '123e4567-e89b-42d3-a456-426614174635',
              createdAt: '2026-03-01T00:00:00Z',
              updatedAt: '2026-03-01T00:00:00Z',
            },
          ]),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.relatedEntities).toEqual([
          expect.objectContaining({
            entityId: fulfilledTaskId,
            relationship: 'related-to',
            source: 'agent',
            reasoning: 'Workflow step is implemented by this task',
          }),
        ]);
      });

      it('scopes fetchAgentEdges to the seed via a single per-type-label readIncidentEdges call', async () => {
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
          makeNeighborhood(),
        );

        await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledTimes(1);
        expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledWith(
          testIds.organization,
          testIds.project,
          expect.objectContaining({
            seedEntityIds: [entityId],
            relationshipTypes: expect.arrayContaining([
              'DEPENDS_ON',
              'DERIVES_FROM',
              'SUPERSEDES',
              'CONTRADICTS',
              'RELATED_TO',
              'AGENT_LINKED',
            ]),
          }),
          'test-token',
        );
      });
    });

    // ── relatedEntities: sibling-via-parent ────────────────────────────────────

    describe('sibling-via-parent', () => {
      const parentFeatureId = '123e4567-e89b-42d3-a456-426614174701';
      const siblingTaskId = '123e4567-e89b-42d3-a456-426614174702';

      it('surfaces a task reachable only through an excluded parent feature', async () => {
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [
            {
              entityId: siblingTaskId,
              entityType: 'TASK',
              displayName: 'Sibling Task',
              status: 'BACKLOG',
              relationship: 'sibling-via-parent',
              via: [
                {
                  entityId: parentFeatureId,
                  entityType: 'TASK',
                  displayName: 'Parent Feature',
                  relationship: 'sibling-via-parent',
                },
              ],
            },
          ],
          agentSessions: [],
        });

        // Parent feature is part of the entity's feature hierarchy, so it
        // appears in the featureIds set passed to the related-entities
        // builder and is excluded from relatedEntities.
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            {
              id: entityId,
              name: 'Seed',
              type: 'STANDARD',
              parent_task_id: parentFeatureId,
              distance: BigInt(0),
            },
            {
              id: parentFeatureId,
              name: 'Parent Feature',
              type: 'FEATURE',
              parent_task_id: null,
              distance: BigInt(1),
            },
          ])
          .mockResolvedValueOnce([]);
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const sibling = (result.relatedEntities ?? []).find(
          (e) => e.entityId === siblingTaskId,
        );
        expect(sibling).toBeDefined();
        expect(sibling).toMatchObject({
          entityType: 'TASK',
          displayName: 'Sibling Task',
          relationship: 'sibling-via-parent',
        });
        expect(sibling!.via).toEqual([
          {
            entityId: parentFeatureId,
            entityType: 'TASK',
            displayName: 'Parent Feature',
            relationship: 'sibling-via-parent',
          },
        ]);

        // The parent feature itself does not appear in relatedEntities — it
        // belongs to featureHierarchy.
        const ids = (result.relatedEntities ?? []).map((e) => e.entityId);
        expect(ids).not.toContain(parentFeatureId);
      });

      it('surfaces a non-FEATURE task parent as `parent` and its other children as sibling-via-parent', async () => {
        const parentTaskId = '123e4567-e89b-42d3-a456-426614174711';
        const siblingTaskAId = '123e4567-e89b-42d3-a456-426614174712';
        const siblingTaskBId = '123e4567-e89b-42d3-a456-426614174713';
        const grandparentFeatureId = '123e4567-e89b-42d3-a456-426614174714';

        mockGraphsClient.getEntityNeighborhood.mockResolvedValue({
          relatedEntities: [
            {
              entityId: parentTaskId,
              entityType: 'TASK',
              displayName: 'Parent Task',
              status: 'ACTIVE',
              relationship: 'parent',
            },
            {
              entityId: siblingTaskAId,
              entityType: 'TASK',
              displayName: 'Sibling A',
              status: 'BACKLOG',
              relationship: 'sibling-via-parent',
              via: [
                {
                  entityId: parentTaskId,
                  entityType: 'TASK',
                  displayName: 'Parent Task',
                  relationship: 'sibling-via-parent',
                },
              ],
            },
            {
              entityId: siblingTaskBId,
              entityType: 'TASK',
              displayName: 'Sibling B',
              status: 'COMPLETED',
              relationship: 'sibling-via-parent',
              via: [
                {
                  entityId: parentTaskId,
                  entityType: 'TASK',
                  displayName: 'Parent Task',
                  relationship: 'sibling-via-parent',
                },
              ],
            },
          ],
          agentSessions: [],
        });

        // Feature hierarchy: the seed sits under a STANDARD parent task that
        // itself sits under a FEATURE grandparent. Only the FEATURE shows up
        // as a featureId, so the STANDARD parent must be picked up by the
        // new HAS_TASK-based pivot rule.
        (mockPrisma.db as any).$queryRaw
          .mockResolvedValueOnce([
            {
              id: entityId,
              name: 'Seed',
              type: 'STANDARD',
              parent_task_id: parentTaskId,
              distance: BigInt(0),
            },
            {
              id: parentTaskId,
              name: 'Parent Task',
              type: 'STANDARD',
              parent_task_id: grandparentFeatureId,
              distance: BigInt(1),
            },
            {
              id: grandparentFeatureId,
              name: 'Grandparent Feature',
              type: 'FEATURE',
              parent_task_id: null,
              distance: BigInt(2),
            },
          ])
          .mockResolvedValueOnce([]);
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValueOnce([]);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        const parent = (result.relatedEntities ?? []).find(
          (e) => e.entityId === parentTaskId,
        );
        expect(parent).toBeDefined();
        expect(parent).toMatchObject({
          entityType: 'TASK',
          displayName: 'Parent Task',
          relationship: 'parent',
        });

        const siblingA = (result.relatedEntities ?? []).find(
          (e) => e.entityId === siblingTaskAId,
        );
        expect(siblingA).toBeDefined();
        expect(siblingA).toMatchObject({
          entityType: 'TASK',
          displayName: 'Sibling A',
          relationship: 'sibling-via-parent',
        });
        expect(siblingA!.via).toEqual([
          {
            entityId: parentTaskId,
            entityType: 'TASK',
            displayName: 'Parent Task',
            relationship: 'sibling-via-parent',
          },
        ]);

        const siblingB = (result.relatedEntities ?? []).find(
          (e) => e.entityId === siblingTaskBId,
        );
        expect(siblingB).toBeDefined();
        expect(siblingB!.relationship).toBe('sibling-via-parent');
      });
    });

    // ── planContext + plan/stage as structural pivots ─────────────────────────

    describe('planContext', () => {
      it('resolves a DesignDoc through its canonical Task owner', async () => {
        (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue({
          parentEntityType: 'TASK',
          parentEntityId: entityId,
        });
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          id: entityId,
          name: 'Canonical Plan',
          type: 'PLAN',
          status: 'ACTIVE',
          parentTaskId: null,
          subTasks: [],
        });
        const result = await (service as any).buildPlanContext(
          'DESIGN_DOC',
          entityId,
        );
        expect(result.planContext.siblingStages).toEqual([]);
        expect(mockPrisma.db.task.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: entityId } }),
        );
        expect(mockPrisma.db.planStep.findFirst).not.toHaveBeenCalled();
      });

      it('does not infer Plan ownership for an unowned DesignDoc', async () => {
        (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue({
          parentEntityType: null,
          parentEntityId: null,
        });
        expect(
          await (service as any).buildPlanContext('DESIGN_DOC', entityId),
        ).toBeNull();
        expect(mockPrisma.db.task.findUnique).not.toHaveBeenCalled();
      });

      const planId = '123e4567-e89b-42d3-a456-426614174800';
      const stageAId = '123e4567-e89b-42d3-a456-426614174801';
      const stageBId = '123e4567-e89b-42d3-a456-426614174802';
      const stepAId = '123e4567-e89b-42d3-a456-426614174803';
      const stepBId = '123e4567-e89b-42d3-a456-426614174804';
      const planDesignDocId = '123e4567-e89b-42d3-a456-426614174805';
      const trackedTaskId = '123e4567-e89b-42d3-a456-426614174806';

      it('does not load children for an ordinary non-plan Task', async () => {
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          id: entityId,
          name: 'Ordinary Feature',
          status: 'ACTIVE',
          type: 'FEATURE',
          parentTaskId: null,
          parentTask: null,
        });

        await expect(
          (service as any).buildPlanContext('TASK', entityId),
        ).resolves.toBeNull();

        expect(mockPrisma.db.task.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.db.task.findUnique).toHaveBeenCalledWith(
          expect.not.objectContaining({
            select: expect.objectContaining({ subTasks: expect.anything() }),
          }),
        );
      });

      it('uses canonical PLAN Task children even when a one-stage plan has no dependency edges', async () => {
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          id: planId,
          name: 'Pricing Revamp',
          status: 'ACTIVE',
          type: 'PLAN',
          parentTaskId: null,
          parentTask: null,
        });
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
          {
            id: stageAId,
            name: 'Discovery',
            status: 'REFINING',
            type: 'PLAN_STAGE',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ]);

        const result = await (service as any).buildPlanContext('TASK', planId);

        expect(result.planContext.siblingStages).toEqual([
          {
            id: stageAId,
            entityType: 'TASK',
            taskType: 'PLAN_STAGE',
            displayName: 'Discovery',
            status: 'REFINING',
          },
        ]);
        expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              parentTaskId: planId,
              type: 'PLAN_STAGE',
              archivedAt: null,
            },
          }),
        );
        expect(mockPrisma.db.taskDependency.findMany).not.toHaveBeenCalled();
      });

      it('dependency-orders canonical PLAN_STAGE Task children', async () => {
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          id: planId,
          name: 'Pricing Revamp',
          status: 'ACTIVE',
          type: 'PLAN',
          parentTaskId: null,
          parentTask: null,
        });
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
          {
            id: stageBId,
            name: 'Rollout',
            status: 'BACKLOG',
            type: 'PLAN_STAGE',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            id: stageAId,
            name: 'Discovery',
            status: 'REFINING',
            type: 'PLAN_STAGE',
            createdAt: new Date('2026-01-02T00:00:00Z'),
          },
        ]);
        (service as any).planDependencies.outgoing.mockResolvedValue([
          { sourceNodeId: stageBId, targetNodeId: stageAId },
        ]);

        const result = await (service as any).buildPlanContext('TASK', planId);

        expect(
          result.planContext.siblingStages.map(
            (stage: { id: string }) => stage.id,
          ),
        ).toEqual([stageAId, stageBId]);
      });

      it('places a canonical STANDARD Task under its PLAN_STAGE and PLAN ancestors', async () => {
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          id: trackedTaskId,
          name: 'Update checkout',
          status: 'BACKLOG',
          type: 'STANDARD',
          parentTaskId: stageAId,
          subTasks: [],
          parentTask: {
            id: stageAId,
            name: 'Discovery',
            status: 'REFINING',
            type: 'PLAN_STAGE',
            parentTaskId: planId,
            parentTask: {
              id: planId,
              name: 'Pricing Revamp',
              status: 'ACTIVE',
              type: 'PLAN',
              parentTaskId: null,
            },
          },
        });
        (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
          {
            id: stageAId,
            name: 'Discovery',
            status: 'REFINING',
            type: 'PLAN_STAGE',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ]);

        const result = await (service as any).buildPlanContext(
          'TASK',
          trackedTaskId,
        );

        expect(result.planContext.parentPlan).toMatchObject({
          id: planId,
          entityType: 'TASK',
          taskType: 'PLAN',
        });
        expect(result.planContext.parentStage).toMatchObject({
          id: stageAId,
          entityType: 'TASK',
          taskType: 'PLAN_STAGE',
        });
      });

      const planEntityFixture = {
        id: planId,
        title: 'Pricing Revamp',
        status: 'ACTIVE',
      };
      const stageAFixture = {
        id: stageAId,
        title: 'Discovery',
        status: 'IN_PROGRESS',
        sequenceOrder: 1,
      };
      const stageBFixture = {
        id: stageBId,
        title: 'Rollout',
        status: 'NOT_STARTED',
        sequenceOrder: 2,
      };

      /**
       * Fixtures the standard plan tree in the graph traversal: plan with
       * two stages, a sibling step under stage A, the plan's design doc,
       * and a plan-tracked task. Edges mirror the structural-only system
       * graph (HAS_PLAN_STAGE, HAS_PLAN_STEP, HAS_DESIGN_DOC,
       * PLAN_TRACKS / PLAN_STEP_TRACKS) — none of which by themselves
       * carry a semantic relationship.
       */
      /**
       * Labeled neighborhood for a plan-resident seed. Mirrors what the
       * graph service would emit after applying its pivot rules — the
       * caller-side assertions only verify that the API surfaces these
       * rows correctly. Rule-level coverage lives in the graph-service
       * Java suite.
       */
      function makePlanNeighborhood(seedNodeIdForSeed: string) {
        const planVia = {
          entityId: planId,
          entityType: 'PLAN',
          displayName: 'Pricing Revamp',
          relationship: 'sibling-via-parent' as const,
        };
        const stageAVia = {
          entityId: stageAId,
          entityType: 'PLAN_STAGE',
          displayName: 'Discovery',
          relationship: 'sibling-via-parent' as const,
        };

        // Common entities reachable through plan-tree pivots — included
        // in every plan-tree test scenario.
        const planDoc = {
          entityId: planDesignDocId,
          entityType: 'DESIGN_DOC',
          displayName: 'Plan Decisions',
          relationship: 'sibling-via-parent' as const,
          via: [planVia],
        };
        const trackedTask = {
          entityId: trackedTaskId,
          entityType: 'TASK',
          displayName: 'Update checkout',
          status: 'BACKLOG',
          relationship: 'sibling-via-parent' as const,
          via: [planVia],
        };
        const stepA = {
          entityId: stepAId,
          entityType: 'PLAN_STEP',
          displayName: 'Audit billing',
          status: 'REFINING',
          relationship: 'sibling-via-parent' as const,
          via: [stageAVia],
        };
        const stepB = {
          entityId: stepBId,
          entityType: 'PLAN_STEP',
          displayName: 'Draft tiers',
          status: 'REFINING',
          relationship: 'sibling-via-parent' as const,
          via: [stageAVia],
        };

        const relatedEntities: Array<Record<string, unknown>> = [];
        if (seedNodeIdForSeed === 'node-plan') {
          relatedEntities.push(planDoc, trackedTask, stepA, stepB);
        } else if (seedNodeIdForSeed === 'node-stage-a') {
          relatedEntities.push(planDoc, trackedTask, stepA, stepB);
        } else if (seedNodeIdForSeed === 'node-step-a') {
          relatedEntities.push(planDoc, trackedTask, stepB);
        } else if (seedNodeIdForSeed === 'node-task') {
          relatedEntities.push(planDoc, stepA, stepB);
        } else if (seedNodeIdForSeed === 'node-doc') {
          relatedEntities.push(trackedTask, stepA, stepB);
        }
        return {
          relatedEntities,
          agentSessions: [],
        };
      }

      it('omits planContext when the seed is not tracked by any plan', async () => {
        mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
          makeNeighborhood(),
        );
        (mockPrisma.db.planStep.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          entityId,
          'test-token',
        );

        expect(result.planContext).toBeUndefined();
      });
    });

    // ── content body + PLAN_STEP backing-content unification ──────────────
    //
    // Canonical Task and DesignDoc seeds carry their own content body.

    describe('canonical content body', () => {
      const stepId = '123e4567-e89b-42d3-a456-426614174c00';
      const backingTaskId = '123e4567-e89b-42d3-a456-426614174c01';
      const backingDocId = '123e4567-e89b-42d3-a456-426614174c02';
      const stepStageId = '123e4567-e89b-42d3-a456-426614174c03';
      const stepPlanId = '123e4567-e89b-42d3-a456-426614174c04';
      const directTaskId = '123e4567-e89b-42d3-a456-426614174c05';
      const directDocId = '123e4567-e89b-42d3-a456-426614174c06';
      const directStageId = '123e4567-e89b-42d3-a456-426614174c07';
      const assigneeUuid = '123e4567-e89b-42d3-a456-426614174c08';
      const stepPropId = '123e4567-e89b-42d3-a456-426614174c10';
      const backingPropId = '123e4567-e89b-42d3-a456-426614174c11';
      const sharedPropId = '123e4567-e89b-42d3-a456-426614174c12';
      const olderStepPropId = '123e4567-e89b-42d3-a456-426614174c13';
      const baselinePropId = '123e4567-e89b-42d3-a456-426614174c14';
      const otherTargetBaselinePropId = '123e4567-e89b-42d3-a456-426614174c15';
      const stepRelatedId = '123e4567-e89b-42d3-a456-426614174c20';
      const backingRelatedId = '123e4567-e89b-42d3-a456-426614174c21';
      const sharedRelatedId = '123e4567-e89b-42d3-a456-426614174c22';
      const stepSessionId = '123e4567-e89b-42d3-a456-426614174c30';
      const backingSessionId = '123e4567-e89b-42d3-a456-426614174c31';
      const taskDueDate = new Date('2026-06-01T00:00:00.000Z');

      // Backing TASK row: the authorized seed scalars plus its sections.
      function backingTaskRow(overrides?: Record<string, unknown>) {
        return {
          createdAt: entityCreatedAt,
          name: 'Audit billing task',
          type: WORK_ITEM_TYPE_KEYS.Standard,
          status: 'ACTIVE',
          priority: 'HIGH',
          assigneeId: assigneeUuid,
          dueDate: taskDueDate,
          sections: [
            {
              key: 'description',
              order: 0,
              materializedMarkdown: 'Backing description',
            },
            {
              key: 'acceptanceCriteria',
              order: 1,
              materializedMarkdown: 'Backing AC',
            },
          ],
          ...overrides,
        };
      }

      // Splits a backing row into the authorized seed (scalars, returned by
      // findPersistedByOrganization) and its sections (taskSection reads).
      function useAuthorizedSeed(row: Record<string, unknown>) {
        const { sections, ...scalars } = row;
        mockTaskService.findPersistedByOrganization.mockResolvedValue(
          makeSeedRow({ id: directTaskId, ...scalars }),
        );
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue(sections);
      }

      function backingDocRow(overrides?: Record<string, unknown>) {
        return {
          createdAt: entityCreatedAt,
          name: 'Billing ADR',
          status: 'ADR_ACCEPTED',
          sections: [
            {
              key: 'context',
              order: 0,
              materializedMarkdown: 'Doc context',
            },
            {
              key: 'decision',
              order: 1,
              materializedMarkdown: 'Doc decision',
            },
          ],
          ...overrides,
        };
      }

      it('TASK seed returns its own content body, no backedBy, single auxiliary load', async () => {
        useAuthorizedSeed(backingTaskRow({ name: 'Direct Task' }));

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          directTaskId,
          'test-token',
        );

        expect(result.content).toEqual({
          sections: {
            description: 'Backing description',
            acceptanceCriteria: 'Backing AC',
          },
          status: 'ACTIVE',
          priority: 'HIGH',
          assigneeId: assigneeUuid,
          dueDate: taskDueDate.toISOString(),
        });
        expect(result).not.toHaveProperty('backedBy');
        // Non-step seed: a single auxiliary load on its own ID.
        expect(mockGraphsClient.getEntityNeighborhood).toHaveBeenCalledTimes(1);
      });

      it('DESIGN_DOC seed returns its own content body and no backedBy', async () => {
        (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue(
          backingDocRow(),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'DESIGN_DOC' as EntityType,
          directDocId,
          'test-token',
        );

        expect(result.content?.sections).toEqual({
          context: 'Doc context',
          decision: 'Doc decision',
        });
        expect(result.content?.status).toBe('ADR_ACCEPTED');
        expect(result.content?.priority).toBeUndefined();
        expect(result).not.toHaveProperty('backedBy');
      });

      it('FEATURE seed omits lifecycle scalars from content but keeps sections', async () => {
        useAuthorizedSeed(
          backingTaskRow({
            name: 'Daily Session feature',
            type: WORK_ITEM_TYPE_KEYS.Feature,
            sections: [
              {
                key: 'description',
                order: 0,
                materializedMarkdown: 'Feature description',
              },
              {
                key: 'requirements',
                order: 1,
                materializedMarkdown: emptyFeatureRequirements,
              },
            ],
          }),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          directTaskId,
          'test-token',
        );

        // Sections are retained for a feature; the four task-shaped
        // lifecycle scalars are dropped because feature state is read
        // from links and tasks, not stored.
        expect(result.content).toEqual({
          sections: {
            description: 'Feature description',
            requirements: emptyFeatureRequirements,
          },
          requirementsSection: { records: [] },
        });
        expect(result.content?.status).toBeUndefined();
        expect(result.content?.priority).toBeUndefined();
        expect(result.content?.assigneeId).toBeUndefined();
        expect(result.content?.dueDate).toBeUndefined();
      });

      it('GOAL seed omits lifecycle scalars from content but keeps sections', async () => {
        useAuthorizedSeed(
          backingTaskRow({
            name: 'Ship billing by Q3 goal',
            type: WORK_ITEM_TYPE_KEYS.Goal,
            sections: [
              {
                key: 'description',
                order: 0,
                materializedMarkdown: 'Goal description',
              },
            ],
          }),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          directTaskId,
          'test-token',
        );

        expect(result.content).toEqual({
          sections: { description: 'Goal description' },
        });
        expect(result.content?.status).toBeUndefined();
        expect(result.content?.priority).toBeUndefined();
        expect(result.content?.assigneeId).toBeUndefined();
        expect(result.content?.dueDate).toBeUndefined();
      });

      it('STANDARD and BUG seeds still carry all four lifecycle scalars', async () => {
        for (const type of [
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Bug,
        ]) {
          useAuthorizedSeed(backingTaskRow({ name: `${type} task`, type }));

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            directTaskId,
            'test-token',
          );

          expect(result.content).toEqual({
            sections: {
              description: 'Backing description',
              acceptanceCriteria: 'Backing AC',
            },
            status: 'ACTIVE',
            priority: 'HIGH',
            assigneeId: assigneeUuid,
            dueDate: taskDueDate.toISOString(),
          });
        }
      });

      it('TASK seed reuses the authorized row for content and metadata without re-reading it', async () => {
        const row = backingTaskRow({ name: 'Direct Task' });
        useAuthorizedSeed(row);

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'TASK' as EntityType,
          directTaskId,
          'test-token',
          {
            includePlan: false,
            includeRelatedEntities: false,
            includeFeatureHierarchy: false,
          },
        );

        expect(
          mockTaskService.findPersistedByOrganization,
        ).toHaveBeenCalledTimes(1);
        expect(mockPrisma.db.task.findUnique).not.toHaveBeenCalled();
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).toHaveBeenCalledTimes(1);
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).toHaveBeenCalledWith({
          where: { taskId: directTaskId },
          select: { key: true, order: true, materializedMarkdown: true },
        });

        // Parity with the previous projection: the same row read through the
        // non-seed paths (resolveEntityMeta + loadTaskContent) projects the
        // same metadata and content.
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue(row);
        const standalone = await service.getEntityContext(
          testIds.organization,
          'TASK' as EntityType,
          directTaskId,
        );
        const unseededContent = await (service as any).loadTaskContent(
          testIds.project,
          directTaskId,
        );
        expect(result.displayName).toBe('Direct Task');
        expect(result.createdAt).toBe(entityCreatedAt.toISOString());
        expect(result.taskType).toBe(WORK_ITEM_TYPE_KEYS.Standard);
        expect({
          displayName: result.displayName,
          createdAt: result.createdAt,
          taskType: result.taskType,
        }).toEqual({
          displayName: standalone.displayName,
          createdAt: standalone.createdAt,
          taskType: standalone.taskType,
        });
        expect(result.content).toEqual(unseededContent);
      });

      it('FEATURE and GOAL seeds suppress lifecycle scalars on the seed path without re-reading the row', async () => {
        for (const type of [
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.Goal,
        ]) {
          (mockPrisma.db.task.findUnique as jest.Mock).mockClear();
          useAuthorizedSeed(
            backingTaskRow({
              type,
              sections: [
                {
                  key: 'description',
                  order: 0,
                  materializedMarkdown: 'Seed description',
                },
              ],
            }),
          );

          const result = await service.getFullEntityContext(
            testIds.organization,
            testIds.project,
            'TASK' as EntityType,
            directTaskId,
            'test-token',
            {
              includePlan: false,
              includeRelatedEntities: false,
              includeFeatureHierarchy: false,
            },
          );

          expect(result.taskType).toBe(type);
          expect(result.content).toEqual({
            sections: { description: 'Seed description' },
          });
          expect(mockPrisma.db.task.findUnique).not.toHaveBeenCalled();
        }
      });

      it('DESIGN_DOC seed keeps its own loaders and metadata lookup', async () => {
        (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue(
          backingDocRow(),
        );

        const result = await service.getFullEntityContext(
          testIds.organization,
          testIds.project,
          'DESIGN_DOC' as EntityType,
          directDocId,
          'test-token',
          {
            includePlan: false,
            includeRelatedEntities: false,
            includeFeatureHierarchy: false,
          },
        );

        expect(result.displayName).toBe('Billing ADR');
        expect(
          mockTaskService.findPersistedByOrganization,
        ).not.toHaveBeenCalled();
        // One content read plus one resolveEntityMeta read.
        expect(mockPrisma.db.designDoc.findUnique).toHaveBeenCalledTimes(2);
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).not.toHaveBeenCalled();
      });
    });
  });

  describe('exact incident projections', () => {
    const secondId = '123e4567-e89b-42d3-a456-426614174010';
    const emptyId = '123e4567-e89b-42d3-a456-426614174011';
    const time = '2026-10-13T19:00:00Z';

    function projection(
      total = 60,
    ): import('src/generated/graphs').IncidentEdgesResponse {
      const stored: import('src/generated/graphs').GraphRelationship = {
        id: '123e4567-e89b-42d3-a456-426614174012',
        type: RelationshipType.RelatedTo,
        sourceNodeId: entityId,
        targetNodeId: secondId,
        properties: { reasoning: 'Related', createdBySessionId: emptyId },
        createdAt: time,
        updatedAt: time,
      };
      const influence: import('src/generated/graphs').GraphRelationship = {
        ...stored,
        id: 'influence',
        type: RelationshipType.Influences,
        sourceNodeId: secondId,
        targetNodeId: entityId,
        properties: { reasonType: 'origin' },
      };
      const derived: import('src/generated/graphs').GraphRelationship = {
        ...stored,
        id: `derived:PROPOSED_TOGETHER:${entityId}:${secondId}`,
        type: RelationshipType.ProposedTogether,
        properties: { source: 'system' },
      };
      return {
        groups: [
          {
            seedEntityId: entityId,
            neighborTotal: total,
            relationships: [stored, stored, influence, derived],
            endpoints: [
              {
                entityId: secondId,
                entityType: 'TASK',
                displayName: 'Second',
                taskType: 'CONTRACT',
              },
            ],
          },
          {
            seedEntityId: secondId,
            neighborTotal: 60,
            relationships: [stored, influence, derived],
            endpoints: [
              {
                entityId,
                entityType: 'TASK',
                displayName: 'First',
                taskType: 'STANDARD',
              },
            ],
          },
          {
            seedEntityId: emptyId,
            neighborTotal: 0,
            relationships: [],
            endpoints: [],
          },
        ],
      };
    }

    it('maps mixed relationships and seed pairs while combined totals produce no false warning', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValue(projection());
      const warn = jest.spyOn((service as any).logger, 'warn');
      const result = await service.getEdges(
        testIds.organization,
        testIds.project,
        [entityId, secondId, emptyId].map((entityId) => ({
          entityId,
          entityType: 'TASK',
        })),
        'token',
      );
      expect(result[entityId]).toHaveLength(3);
      expect(result[secondId]).toHaveLength(3);
      expect(result[emptyId]).toEqual([]);
      expect(result[entityId]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            direction: 'out',
            edgeType: 'RELATED_TO',
            otherEndpoint: {
              entityId: secondId,
              entityType: 'TASK',
              displayName: 'Second',
              taskType: 'CONTRACT',
            },
          }),
          expect.objectContaining({
            direction: 'in',
            edgeType: 'INFLUENCES',
            reasonType: 'origin',
          }),
          expect.objectContaining({ edgeType: 'PROPOSED_TOGETHER' }),
        ]),
      );
      expect(warn).not.toHaveBeenCalled();
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });

    it('warns only for overflowing seeds using their own totals', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValue(projection(101));
      const warn = jest.spyOn((service as any).logger, 'warn');
      await service.getEdges(
        testIds.organization,
        testIds.project,
        [entityId, secondId].map((entityId) => ({
          entityId,
          entityType: 'TASK',
        })),
        'token',
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('getEdges: edges may be truncated', {
        seedEntityId: entityId,
        neighborTotal: 101,
        pageSize: 100,
      });
    });

    it('checks per-seed totals for Context agent edges and dependent tasks', async () => {
      const response = projection(101);
      response.groups[0]!.relationships = [];
      mockGraphsClient.readIncidentEdges.mockResolvedValue(response);
      const warn = jest.spyOn((service as any).logger, 'warn');
      await (service as any).fetchAgentEdges(
        testIds.organization,
        testIds.project,
        entityId,
        'token',
      );
      await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'token',
      );
      expect(warn).toHaveBeenCalledTimes(2);
      for (const call of warn.mock.calls) {
        expect(call[1]).toEqual({
          seedEntityId: entityId,
          neighborTotal: 101,
          pageSize: 100,
        });
      }
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });
  });

  describe('resolveDependentTasks', () => {
    const depTaskIdA = '123e4567-e89b-42d3-a456-426614174090';
    const depTaskIdB = '123e4567-e89b-42d3-a456-426614174091';

    function makeAgentEdge(
      overrides: Partial<AgentEdgeFixture> = {},
    ): AgentEdgeFixture {
      return {
        id: '123e4567-e89b-42d3-a456-426614174100',
        sourceNodeId: entityId,
        targetNodeId: depTaskIdA,
        type: 'DEPENDS_ON',
        reasoning: 'Task A blocks this task',
        createdBySessionId: '123e4567-e89b-42d3-a456-426614174200',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        ...overrides,
      };
    }

    beforeEach(() => {
      // Add taskSection mock to Prisma (not in the default mock utility)
      (mockPrisma.db as any).taskSection = {
        findMany: jest.fn().mockResolvedValue([]),
      };
    });

    it('returns empty array when no auth token', async () => {
      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        null,
      );

      expect(result).toEqual([]);
      expect(mockGraphsClient.readIncidentEdges).not.toHaveBeenCalled();
    });

    it('returns empty array when no agent edges exist', async () => {
      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toEqual([]);
      expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledTimes(1);
    });

    it('resolves outbound DEPENDS_ON edge with task content', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [makeAgentEdge()]),
      );

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        {
          id: depTaskIdA,
          name: 'Dep Task A',
          type: 'STANDARD',
          status: 'ACTIVE',
        },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([
        {
          taskId: depTaskIdA,
          key: 'description',
          materializedMarkdown: 'Desc A',
        },
        {
          taskId: depTaskIdA,
          key: 'acceptanceCriteria',
          materializedMarkdown: 'AC A',
        },
      ]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        entityId: depTaskIdA,
        entityType: 'TASK',
        displayName: 'Dep Task A',
        status: 'ACTIVE',
        relationshipType: 'DEPENDS_ON',
        direction: 'outbound',
        description: 'Desc A',
        acceptanceCriteria: 'AC A',
        edgeReasoning: 'Task A blocks this task',
      });
    });

    it('reads semantic type from relationship label for per-type-labelled edges', async () => {
      // Per-type-labelled edges have the semantic type as relationship.type
      // directly (not wrapped in AGENT_LINKED with props.type).
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce({
        groups: [
          {
            seedEntityId: entityId,
            neighborTotal: 1,
            endpoints: [],
            relationships: [
              {
                id: 'neo4j-per-type-edge',
                type: 'RELATED_TO',
                sourceNodeId: entityId,
                targetNodeId: depTaskIdA,
                properties: {
                  id: 'per-type-edge',
                  reasoning: 'Related via per-type label',
                  createdBySessionId: 'session-per-type',
                },
                createdAt: '2026-03-01T00:00:00Z',
                updatedAt: '2026-03-01T00:00:00Z',
              },
            ],
          },
        ],
      } satisfies import('src/generated/graphs').IncidentEdgesResponse);

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        {
          id: depTaskIdA,
          name: 'Per-type Task',
          type: 'STANDARD',
          status: 'ACTIVE',
        },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        entityId: depTaskIdA,
        relationshipType: 'RELATED_TO',
        direction: 'outbound',
        edgeReasoning: 'Related via per-type label',
      });
    });

    it('resolves inbound edges with correct direction', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          makeAgentEdge({
            sourceNodeId: depTaskIdB,
            targetNodeId: entityId,
            type: 'DERIVES_FROM',
            reasoning: 'Derived from this entity',
          }),
        ]),
      );

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        {
          id: depTaskIdB,
          name: 'Dep Task B',
          type: 'STANDARD',
          status: 'BACKLOG',
        },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([
        {
          taskId: depTaskIdB,
          key: 'description',
          materializedMarkdown: 'Desc B',
        },
      ]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        entityId: depTaskIdB,
        direction: 'inbound',
        relationshipType: 'DERIVES_FROM',
        description: 'Desc B',
        acceptanceCriteria: null,
      });
    });

    it('handles mixed edge types across outbound and inbound', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          makeAgentEdge({ type: 'SUPERSEDES', reasoning: 'Supersedes old' }),
          makeAgentEdge({
            id: '123e4567-e89b-42d3-a456-426614174104',
            sourceNodeId: depTaskIdB,
            targetNodeId: entityId,
            type: 'CONTRADICTS',
            reasoning: 'Contradicts this',
          }),
        ]),
      );

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: depTaskIdA, name: 'Task A', type: 'STANDARD', status: 'ACTIVE' },
        { id: depTaskIdB, name: 'Task B', type: 'STANDARD', status: 'ACTIVE' },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        entityId: depTaskIdA,
        direction: 'outbound',
        relationshipType: 'SUPERSEDES',
      });
      expect(result[1]).toMatchObject({
        entityId: depTaskIdB,
        direction: 'inbound',
        relationshipType: 'CONTRADICTS',
      });
    });

    it('skips edges pointing to non-existent tasks', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          makeAgentEdge({ targetNodeId: depTaskIdA }),
          makeAgentEdge({
            id: '123e4567-e89b-42d3-a456-426614174101',
            targetNodeId: depTaskIdB,
          }),
        ]),
      );

      // Only depTaskIdA exists
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: depTaskIdA, name: 'Task A', type: 'STANDARD', status: 'ACTIVE' },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.entityId).toBe(depTaskIdA);
    });

    it('filters out non-agent relationship types', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          makeAgentEdge({ type: 'HAS_TASK', reasoning: 'structural' }),
          makeAgentEdge({
            id: '123e4567-e89b-42d3-a456-426614174102',
            type: 'RELATED_TO',
            reasoning: 'related',
          }),
        ]),
      );

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: depTaskIdA, name: 'Task A', type: 'STANDARD', status: 'ACTIVE' },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      // Only RELATED_TO passes the filter; HAS_TASK is excluded
      expect(result).toHaveLength(1);
      expect(result[0]!.relationshipType).toBe('RELATED_TO');
    });

    it('returns empty array when readIncidentEdges fails', async () => {
      mockGraphsClient.readIncidentEdges.mockRejectedValue(
        new Error('Graph service unavailable'),
      );

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(result).toEqual([]);
    });

    it('returns separate entries when same task is connected by multiple edges', async () => {
      mockGraphsClient.readIncidentEdges.mockResolvedValueOnce(
        makeAgentEdgeSearchResponse(entityId, [
          makeAgentEdge({ type: 'DEPENDS_ON', reasoning: 'Depends on A' }),
          makeAgentEdge({
            id: '123e4567-e89b-42d3-a456-426614174103',
            type: 'RELATED_TO',
            reasoning: 'Related to A',
          }),
        ]),
      );

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: depTaskIdA, name: 'Task A', type: 'STANDARD', status: 'ACTIVE' },
      ]);
      (
        (mockPrisma.db as any).taskSection.findMany as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      // Same task, two different relationship edges → two entries
      expect(result).toHaveLength(2);
      expect(result[0]!.relationshipType).toBe('DEPENDS_ON');
      expect(result[1]!.relationshipType).toBe('RELATED_TO');
      expect(result[0]!.entityId).toBe(depTaskIdA);
      expect(result[1]!.entityId).toBe(depTaskIdA);
    });

    it('queries agent edges by per-type labels with AGENT_LINKED fallback', async () => {
      await service.resolveDependentTasks(
        testIds.organization,
        testIds.project,
        entityId,
        'test-token',
      );

      expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledTimes(1);
      expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          seedEntityIds: [entityId],
          relationshipTypes: expect.arrayContaining([
            'DEPENDS_ON',
            'DERIVES_FROM',
            'SUPERSEDES',
            'CONTRADICTS',
            'RELATED_TO',
            'AGENT_LINKED',
          ]),
        }),
        'test-token',
      );
    });
  });

  describe('getFeatureSyncContext', () => {
    const parentId = '123e4567-e89b-42d3-a456-426614174070';
    const grandParentId = '123e4567-e89b-42d3-a456-426614174071';

    function ancestorRow(
      id: string,
      name: string,
      type: string,
      distance: number,
    ) {
      return { id, name, type, distance };
    }

    it('returns ancestor FEATURE chain nearest-first with full content', async () => {
      const parentDesc = '# Parent Feature\n\nFull parent description.';
      const parentReqs = emptyFeatureRequirements;
      const grandDesc = '# Grandparent\n\nFull grandparent description.';
      const grandReqs = emptyFeatureRequirements;

      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'My Task', 'STANDARD', 0),
        ancestorRow(parentId, 'Parent Feature', 'FEATURE', 1),
        ancestorRow(grandParentId, 'Grandparent Feature', 'FEATURE', 2),
      ]);
      (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([
        {
          taskId: parentId,
          key: 'description',
          materializedMarkdown: parentDesc,
        },
        {
          taskId: parentId,
          key: 'requirements',
          materializedMarkdown: parentReqs,
        },
        {
          taskId: grandParentId,
          key: 'description',
          materializedMarkdown: grandDesc,
        },
        {
          taskId: grandParentId,
          key: 'requirements',
          materializedMarkdown: grandReqs,
        },
      ]);

      const result = await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      expect(result.taskId).toBe(entityId);
      expect(result.ancestorFeatures).toHaveLength(2);
      expect(result.ancestorFeatures[0]).toEqual({
        id: parentId,
        name: 'Parent Feature',
        description: parentDesc,
        requirements: parentReqs,
        distance: 1,
      });
      expect(result.ancestorFeatures[1]).toEqual({
        id: grandParentId,
        name: 'Grandparent Feature',
        description: grandDesc,
        requirements: grandReqs,
        distance: 2,
      });
    });

    it('filters non-FEATURE ancestors out of the chain', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'My Task', 'STANDARD', 0),
        ancestorRow(parentId, 'Standard Parent', 'STANDARD', 1),
        ancestorRow(grandParentId, 'Grandparent Feature', 'FEATURE', 2),
      ]);
      (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([]);

      const result = await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      expect(result.ancestorFeatures).toHaveLength(1);
      expect(result.ancestorFeatures[0]).toMatchObject({
        id: grandParentId,
        name: 'Grandparent Feature',
        distance: 2,
      });
    });

    it('returns null for missing description or requirements sections', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'My Task', 'STANDARD', 0),
        ancestorRow(parentId, 'Parent Feature', 'FEATURE', 1),
      ]);
      (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([
        {
          taskId: parentId,
          key: 'description',
          materializedMarkdown: 'Only description',
        },
      ]);

      const result = await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      expect(result.ancestorFeatures).toHaveLength(1);
      expect(result.ancestorFeatures[0]).toEqual({
        id: parentId,
        name: 'Parent Feature',
        description: 'Only description',
        requirements: null,
        distance: 1,
      });
    });

    it('returns empty chain when task has no FEATURE ancestors', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'Root Task', 'STANDARD', 0),
      ]);

      const result = await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      expect(result.taskId).toBe(entityId);
      expect(result.ancestorFeatures).toEqual([]);
      expect(
        (mockPrisma.db as any).taskSection.findMany,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the task does not exist', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.getFeatureSyncContext(
          testIds.organization,
          testIds.project,
          entityId as any,
        ),
      ).rejects.toThrow(`Task with id ${entityId} not found`);
    });

    it('only queries description and requirements section keys', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'My Task', 'STANDARD', 0),
        ancestorRow(parentId, 'Parent Feature', 'FEATURE', 1),
      ]);
      (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([]);

      await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      expect((mockPrisma.db as any).taskSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            taskId: { in: [parentId] },
            key: { in: ['description', 'requirements'] },
          }),
        }),
      );
    });

    it('scopes the ancestor CTE by organization, project, and depth', async () => {
      (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
        ancestorRow(entityId, 'My Task', 'STANDARD', 0),
      ]);

      await service.getFeatureSyncContext(
        testIds.organization,
        testIds.project,
        entityId as any,
      );

      // $queryRaw is a tagged template: first arg is the TemplateStringsArray,
      // subsequent args are the interpolated values in positional order.
      const [templateStrings, ...interpolations] = (mockPrisma.db as any)
        .$queryRaw.mock.calls[0];

      const sql = (templateStrings as string[]).join('?');
      expect(sql).toMatch(/organization_id\s*=/i);
      expect(sql).toMatch(/project_id\s*=/i);
      // Depth guard appears as a bound parameter; verify the shape.
      expect(sql).toMatch(/ac\.distance\s*<\s*\?/i);

      // Seed row: taskId, organizationId, projectId.
      // Recursive step: organizationId, projectId, depth limit (literal).
      expect(interpolations).toEqual([
        entityId,
        testIds.organization,
        testIds.project,
        testIds.organization,
        testIds.project,
        50,
      ]);
    });

    // ── Plan-resident pivot ─────────────────────────────────────────────
    //
    // A task with no structural feature ancestry of its own, but tracked by
    // a plan step, falls back to the plan's delivered feature (the plan's
    // parentTaskId) and that feature's ancestors — resolved via a second,
    // re-rooted ancestor CTE. An explicit structural parent always wins and
    // suppresses the pivot entirely.
    describe('plan-resident pivot', () => {
      const pivotFeatureId = '123e4567-e89b-42d3-a456-426614174080';
      const pivotGrandId = '123e4567-e89b-42d3-a456-426614174081';
      const pivotPlanId = '123e4567-e89b-42d3-a456-426614174090';

      it('plan-resident task (null parent) returns the plan feature chain via a second CTE', async () => {
        const fDesc = '# Delivered Feature\n\nWhat the plan ships.';
        const fReqs = emptyFeatureRequirements;
        const gDesc = '# Parent Feature';
        const gReqs = emptyFeatureRequirements;

        (mockPrisma.db as any).$queryRaw
          // First CTE: the seed task alone, no structural parent.
          .mockResolvedValueOnce([
            {
              id: entityId,
              name: 'Plan-tracked Task',
              type: 'STANDARD',
              tag: null,
              parent_task_id: null,
              distance: 0,
            },
          ])
          // Second CTE: ancestor chain rooted at the plan's delivered feature.
          .mockResolvedValueOnce([
            {
              id: pivotFeatureId,
              name: 'Delivered Feature',
              type: 'FEATURE',
              tag: 'backend',
              parent_task_id: pivotGrandId,
              distance: 0,
            },
            {
              id: pivotGrandId,
              name: 'Parent Feature',
              type: 'FEATURE',
              tag: 'product',
              parent_task_id: null,
              distance: 1,
            },
          ]);
        (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
          type: 'STANDARD',
          parentTask: {
            type: 'PLAN_STAGE',
            parentTask: { type: 'PLAN', parentTaskId: pivotFeatureId },
          },
        });
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([
          {
            taskId: pivotFeatureId,
            key: 'description',
            materializedMarkdown: fDesc,
          },
          {
            taskId: pivotFeatureId,
            key: 'requirements',
            materializedMarkdown: fReqs,
          },
          {
            taskId: pivotGrandId,
            key: 'description',
            materializedMarkdown: gDesc,
          },
          {
            taskId: pivotGrandId,
            key: 'requirements',
            materializedMarkdown: gReqs,
          },
        ]);

        const result = await service.getFeatureSyncContext(
          testIds.organization,
          testIds.project,
          entityId as any,
        );

        // The pivot resolves only through canonical Task ancestry.
        expect(mockPrisma.db.planStep.findFirst).not.toHaveBeenCalled();
        // Two CTE calls: the initial walk + the re-rooted pivot walk.
        expect(
          ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
        ).toBe(2);
        // Sections hydrated for the pivoted features only.
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              taskId: { in: [pivotFeatureId, pivotGrandId] },
              key: { in: ['description', 'requirements'] },
            }),
          }),
        );
        // Delivered feature reads as distance 1; its parent as distance 2.
        // Each pivoted ancestor carries description, requirements, tag, distance.
        expect(result.ancestorFeatures).toEqual([
          {
            id: pivotFeatureId,
            name: 'Delivered Feature',
            description: fDesc,
            requirements: fReqs,
            distance: 1,
            tag: 'backend',
          },
          {
            id: pivotGrandId,
            name: 'Parent Feature',
            description: gDesc,
            requirements: gReqs,
            distance: 2,
            tag: 'product',
          },
        ]);
      });

      it('structural feature parent wins: pivot never fires', async () => {
        (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
          {
            id: entityId,
            name: 'My Task',
            type: 'STANDARD',
            tag: null,
            parent_task_id: parentId,
            distance: 0,
          },
          {
            id: parentId,
            name: 'Parent Feature',
            type: 'FEATURE',
            tag: null,
            parent_task_id: null,
            distance: 1,
          },
        ]);
        (mockPrisma.db as any).taskSection.findMany.mockResolvedValue([]);

        const result = await service.getFeatureSyncContext(
          testIds.organization,
          testIds.project,
          entityId as any,
        );

        // Structural ancestry present → no plan probe, no second CTE.
        expect(mockPrisma.db.planStep.findFirst).not.toHaveBeenCalled();
        expect(
          ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
        ).toBe(1);
        expect(result.ancestorFeatures).toEqual([
          {
            id: parentId,
            name: 'Parent Feature',
            description: null,
            requirements: null,
            distance: 1,
          },
        ]);
      });

      it('neither plan-resident nor feature-parented: empty chain, no second CTE', async () => {
        (mockPrisma.db as any).$queryRaw.mockResolvedValueOnce([
          {
            id: entityId,
            name: 'Root Task',
            type: 'STANDARD',
            tag: null,
            parent_task_id: null,
            distance: 0,
          },
        ]);
        (mockPrisma.db.planStep.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await service.getFeatureSyncContext(
          testIds.organization,
          testIds.project,
          entityId as any,
        );

        // The pivot is attempted (no structural parent) but the task is not
        // plan-resident, so there is no re-rooted CTE and no hydration.
        expect(mockPrisma.db.planStep.findFirst).not.toHaveBeenCalled();
        expect(
          ((mockPrisma.db as any).$queryRaw as jest.Mock).mock.calls.length,
        ).toBe(1);
        expect(
          (mockPrisma.db as any).taskSection.findMany,
        ).not.toHaveBeenCalled();
        expect(result.ancestorFeatures).toEqual([]);
      });
    });
  });

  describe('listFeatures', () => {
    const featureRoot1 = '11111111-1111-1111-1111-111111111111';
    const featureRoot2 = '22222222-2222-2222-2222-222222222222';
    const featureChild1A = '33333333-3333-3333-3333-333333333333';
    const featureChild1B = '44444444-4444-4444-4444-444444444444';
    const featureGrandchild = '55555555-5555-5555-5555-555555555555';
    const orphanedFeature = '66666666-6666-6666-6666-666666666666';
    const nonFeatureParent = '77777777-7777-7777-7777-777777777777';

    function setFeatureRows(
      rows: Array<{
        id: string;
        name: string;
        parentTaskId: string | null;
        tag?: string | null;
      }>,
    ) {
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue(
        rows.map((r) => ({ tag: null, ...r })),
      );
    }

    it('returns features in pre-order DFS with depth and parentFeatureId', async () => {
      setFeatureRows([
        // Roots intentionally inserted out of name order to exercise sort.
        { id: featureRoot2, name: 'Beta Root', parentTaskId: null },
        { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
        { id: featureChild1B, name: 'B Child', parentTaskId: featureRoot1 },
        { id: featureChild1A, name: 'A Child', parentTaskId: featureRoot1 },
        {
          id: featureGrandchild,
          name: 'Grandchild',
          parentTaskId: featureChild1A,
        },
      ]);

      const result = await service.listFeatures(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      expect(result.items.map((i) => i.id)).toEqual([
        featureRoot1,
        featureChild1A,
        featureGrandchild,
        featureChild1B,
        featureRoot2,
      ]);
      expect(result.items.map((i) => i.depth)).toEqual([0, 1, 2, 1, 0]);
      expect(result.items.map((i) => i.parentFeatureId)).toEqual([
        null,
        featureRoot1,
        featureChild1A,
        featureRoot1,
        null,
      ]);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(false);
      expect(result.limit).toBe(200);
      expect(result.offset).toBe(0);
    });

    it('treats features whose parent is not a feature in this project as roots', async () => {
      setFeatureRows([
        // Parent ID is a non-FEATURE that the listFeatures query never sees.
        {
          id: orphanedFeature,
          name: 'Orphan',
          parentTaskId: nonFeatureParent,
        },
        { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
      ]);

      const result = await service.listFeatures(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      const orphan = result.items.find((i) => i.id === orphanedFeature);
      expect(orphan).toBeDefined();
      expect(orphan?.parentFeatureId).toBeNull();
      expect(orphan?.depth).toBe(0);
      // Both should be present in the listing.
      expect(result.total).toBe(2);
    });

    it('paginates correctly across the full DFS-ordered set', async () => {
      setFeatureRows([
        { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
        { id: featureChild1A, name: 'A Child', parentTaskId: featureRoot1 },
        { id: featureRoot2, name: 'Beta Root', parentTaskId: null },
      ]);

      const page1 = await service.listFeatures(
        testIds.organization,
        testIds.project,
        2,
        0,
      );
      const page2 = await service.listFeatures(
        testIds.organization,
        testIds.project,
        2,
        2,
      );

      expect(page1.items.map((i) => i.id)).toEqual([
        featureRoot1,
        featureChild1A,
      ]);
      expect(page1.total).toBe(3);
      expect(page1.hasMore).toBe(true);

      expect(page2.items.map((i) => i.id)).toEqual([featureRoot2]);
      expect(page2.total).toBe(3);
      expect(page2.hasMore).toBe(false);
    });

    it('returns an empty result when the project has no features', async () => {
      setFeatureRows([]);

      const result = await service.listFeatures(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      expect(result).toEqual({
        items: [],
        total: 0,
        hasMore: false,
        limit: 200,
        offset: 0,
      });
    });

    it('queries only FEATURE-typed, non-archived tasks scoped to org/project', async () => {
      setFeatureRows([]);

      await service.listFeatures(testIds.organization, testIds.project, 200, 0);

      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          type: { in: [WORK_ITEM_TYPE_KEYS.Feature] },
          archivedAt: null,
        },
        select: { id: true, name: true, parentTaskId: true, tag: true },
      });
    });

    it('surfaces tag on items for features that carry one and omits it otherwise', async () => {
      setFeatureRows([
        {
          id: featureRoot1,
          name: 'Alpha Root',
          parentTaskId: null,
          tag: 'product',
        },
        {
          id: featureRoot2,
          name: 'Beta Root',
          parentTaskId: null,
          tag: null,
        },
      ]);

      const result = await service.listFeatures(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      const tagged = result.items.find((i) => i.id === featureRoot1);
      const untagged = result.items.find((i) => i.id === featureRoot2);
      expect(tagged?.tag).toBe('product');
      expect(untagged?.tag).toBeUndefined();
      // The OpenAPI schema models tag as optional + non-null — never serialize null
      expect(Object.prototype.hasOwnProperty.call(untagged, 'tag')).toBe(false);
    });
  });

  describe('getProjectFeaturesSkeleton', () => {
    const featureRoot1 = '11111111-1111-1111-1111-111111111111';
    const featureRoot2 = '22222222-2222-2222-2222-222222222222';
    const featureChild1A = '33333333-3333-3333-3333-333333333333';
    const featureChild1B = '44444444-4444-4444-4444-444444444444';
    const featureGrandchild = '55555555-5555-5555-5555-555555555555';
    const orphanedFeature = '66666666-6666-6666-6666-666666666666';
    const nonFeatureParent = '77777777-7777-7777-7777-777777777777';

    type SkeletonFeatureRow = {
      id: string;
      name: string;
      parentTaskId: string | null;
      tag?: string | null;
      status?: string;
    };

    function setSkeletonData(
      features: SkeletonFeatureRow[],
      childCounts: Array<{ parentTaskId: string; count: number }> = [],
    ) {
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue(
        features.map((r) => ({ tag: null, status: 'BACKLOG', ...r })),
      );
      (mockPrisma.db.task.groupBy as jest.Mock).mockResolvedValue(
        childCounts.map((c) => ({
          parentTaskId: c.parentTaskId,
          _count: { _all: c.count },
        })),
      );
    }

    it('returns features as FeatureSkeletonNode[] in pre-order DFS', async () => {
      setSkeletonData([
        { id: featureRoot2, name: 'Beta Root', parentTaskId: null },
        { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
        { id: featureChild1B, name: 'B Child', parentTaskId: featureRoot1 },
        { id: featureChild1A, name: 'A Child', parentTaskId: featureRoot1 },
        {
          id: featureGrandchild,
          name: 'Grandchild',
          parentTaskId: featureChild1A,
        },
      ]);

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result.map((i) => i.id)).toEqual([
        featureRoot1,
        featureChild1A,
        featureGrandchild,
        featureChild1B,
        featureRoot2,
      ]);
      expect(result.map((i) => i.depth)).toEqual([0, 1, 2, 1, 0]);
      expect(result.map((i) => i.parentId)).toEqual([
        null,
        featureRoot1,
        featureChild1A,
        featureRoot1,
        null,
      ]);
    });

    it('emits status and tag (nullable) on every entry', async () => {
      setSkeletonData([
        {
          id: featureRoot1,
          name: 'Alpha Root',
          parentTaskId: null,
          tag: 'product',
          status: 'IN_PROGRESS',
        },
        {
          id: featureRoot2,
          name: 'Beta Root',
          parentTaskId: null,
          tag: null,
          status: 'BACKLOG',
        },
      ]);

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      const tagged = result.find((i) => i.id === featureRoot1);
      const untagged = result.find((i) => i.id === featureRoot2);
      expect(tagged?.tag).toBe('product');
      expect(tagged?.status).toBe('IN_PROGRESS');
      expect(untagged?.tag).toBeNull();
      expect(untagged?.status).toBe('BACKLOG');
    });

    it('attaches direct (non-recursive) taskCount per feature', async () => {
      setSkeletonData(
        [
          { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
          {
            id: featureChild1A,
            name: 'A Child',
            parentTaskId: featureRoot1,
          },
        ],
        [
          { parentTaskId: featureRoot1, count: 3 },
          { parentTaskId: featureChild1A, count: 7 },
        ],
      );

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      const root = result.find((i) => i.id === featureRoot1);
      const child = result.find((i) => i.id === featureChild1A);
      // taskCount on the root reflects only its direct non-FEATURE children;
      // the child's own taskCount does NOT roll up into the parent.
      expect(root?.taskCount).toBe(3);
      expect(child?.taskCount).toBe(7);
    });

    it('defaults taskCount to 0 for features with no non-FEATURE children', async () => {
      setSkeletonData(
        [{ id: featureRoot1, name: 'Alpha Root', parentTaskId: null }],
        [],
      );

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result[0]?.taskCount).toBe(0);
    });

    it('treats features whose parent is not a feature in this project as roots', async () => {
      setSkeletonData([
        {
          id: orphanedFeature,
          name: 'Orphan',
          parentTaskId: nonFeatureParent,
        },
        { id: featureRoot1, name: 'Alpha Root', parentTaskId: null },
      ]);

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      const orphan = result.find((i) => i.id === orphanedFeature);
      expect(orphan).toBeDefined();
      expect(orphan?.parentId).toBeNull();
      expect(orphan?.depth).toBe(0);
      expect(result).toHaveLength(2);
    });

    it('sorts roots and siblings case-insensitively by name', async () => {
      setSkeletonData([
        { id: featureRoot2, name: 'beta', parentTaskId: null },
        { id: featureRoot1, name: 'Alpha', parentTaskId: null },
        { id: featureChild1B, name: 'b child', parentTaskId: featureRoot1 },
        { id: featureChild1A, name: 'A child', parentTaskId: featureRoot1 },
      ]);

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result.map((i) => i.id)).toEqual([
        featureRoot1,
        featureChild1A,
        featureChild1B,
        featureRoot2,
      ]);
    });

    it('returns the entire tree in one call without pagination', async () => {
      const ids = Array.from(
        { length: 25 },
        (_, i) =>
          `${String(i + 1).padStart(8, '0')}-0000-0000-0000-000000000000`,
      );
      setSkeletonData(
        ids.map((id, i) => ({
          id,
          name: `Feature ${String(i).padStart(2, '0')}`,
          parentTaskId: null,
        })),
      );

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result).toHaveLength(25);
    });

    it('returns an empty array when the project has no features', async () => {
      setSkeletonData([]);

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result).toEqual([]);
    });

    it('queries only FEATURE-typed, non-archived tasks scoped to org/project', async () => {
      setSkeletonData([]);

      await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          type: { in: [WORK_ITEM_TYPE_KEYS.Feature] },
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          parentTaskId: true,
          tag: true,
          status: true,
        },
      });
    });

    it('counts only non-FEATURE, non-archived direct children', async () => {
      setSkeletonData([]);

      await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(mockPrisma.db.task.groupBy).toHaveBeenCalledWith({
        by: ['parentTaskId'],
        where: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          type: { notIn: [WORK_ITEM_TYPE_KEYS.Feature] },
          archivedAt: null,
          parentTaskId: { not: null },
        },
        _count: { _all: true },
      });
    });

    it('ignores groupBy rows whose parent is not a FEATURE in this project', async () => {
      setSkeletonData(
        [{ id: featureRoot1, name: 'Alpha Root', parentTaskId: null }],
        [
          { parentTaskId: featureRoot1, count: 4 },
          // Stale row pointing at a parent that is not a feature any more —
          // direct-taskCount must not pick it up.
          { parentTaskId: nonFeatureParent, count: 99 },
        ],
      );

      const result = await service.getProjectFeaturesSkeleton(
        testIds.organization,
        testIds.project,
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.taskCount).toBe(4);
    });
  });

  describe('listGoals', () => {
    const goalA = '11111111-1111-1111-1111-111111111111';
    const goalB = '22222222-2222-2222-2222-222222222222';
    const goalC = '33333333-3333-3333-3333-333333333333';

    function setGoals(
      rows: Array<{
        id: string;
        name: string;
        status: string;
        dueDate: Date | null;
      }>,
      total = rows.length,
    ) {
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue(rows);
      (mockPrisma.db.task.count as jest.Mock).mockResolvedValue(total);
    }

    it('returns goals as a flat list with id/name/status/dueDate', async () => {
      const due = new Date('2026-06-15T00:00:00.000Z');
      setGoals([
        { id: goalA, name: 'Ship widgets v1', status: 'ACTIVE', dueDate: due },
      ]);

      const result = await service.listGoals(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      expect(result.items).toEqual([
        {
          id: goalA,
          name: 'Ship widgets v1',
          status: 'ACTIVE',
          dueDate: due.toISOString(),
        },
      ]);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('serializes a missing dueDate as null', async () => {
      setGoals([
        { id: goalA, name: 'Legacy goal', status: 'ACTIVE', dueDate: null },
      ]);

      const result = await service.listGoals(
        testIds.organization,
        testIds.project,
        200,
        0,
      );

      expect(result.items[0]?.dueDate).toBeNull();
    });

    it('queries only GOAL-typed, non-archived tasks with DB-side pagination', async () => {
      setGoals([]);

      await service.listGoals(testIds.organization, testIds.project, 50, 100);

      const expectedWhere = {
        organizationId: testIds.organization,
        projectId: testIds.project,
        type: 'GOAL',
        archivedAt: null,
      };
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        select: { id: true, name: true, status: true, dueDate: true },
        orderBy: [{ dueDate: 'asc' }, { name: 'asc' }],
        take: 50,
        skip: 100,
      });
      expect(mockPrisma.db.task.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('passes statuses through as a Prisma `in` filter on both findMany and count', async () => {
      setGoals([]);

      await service.listGoals(testIds.organization, testIds.project, 200, 0, [
        'ACTIVE',
      ]);

      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE'] },
          }),
        }),
      );
      expect(mockPrisma.db.task.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE'] },
          }),
        }),
      );
    });

    it('reports hasMore based on count + window, not findMany length', async () => {
      const due1 = new Date('2026-06-15T00:00:00.000Z');
      const due2 = new Date('2026-09-30T00:00:00.000Z');
      // findMany already returned only the windowed rows (DB-side take/skip);
      // count reports the full total.
      setGoals(
        [
          { id: goalA, name: 'A', status: 'ACTIVE', dueDate: due1 },
          { id: goalB, name: 'B', status: 'ACTIVE', dueDate: due2 },
        ],
        3,
      );

      const page1 = await service.listGoals(
        testIds.organization,
        testIds.project,
        2,
        0,
      );

      expect(page1.items.map((i) => i.id)).toEqual([goalA, goalB]);
      expect(page1.total).toBe(3);
      expect(page1.hasMore).toBe(true);

      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: goalC, name: 'C', status: 'ACTIVE', dueDate: null },
      ]);
      (mockPrisma.db.task.count as jest.Mock).mockResolvedValue(3);

      const page2 = await service.listGoals(
        testIds.organization,
        testIds.project,
        2,
        2,
      );

      expect(page2.items.map((i) => i.id)).toEqual([goalC]);
      expect(page2.total).toBe(3);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe('getActiveGoals', () => {
    const goalA = '11111111-1111-1111-1111-111111111111';
    const goalB = '22222222-2222-2222-2222-222222222222';
    const goalC = '33333333-3333-3333-3333-333333333333';
    const callerUserId = '99999999-9999-9999-9999-999999999999';
    const fixedNow = new Date('2026-05-11T00:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function setActiveGoals(
      rows: Array<{
        id: string;
        name: string;
        dueDate: Date | null;
        goalMemberships?: Array<{ userId: string }>;
      }>,
    ) {
      (mockPrisma.db.task.findMany as jest.Mock).mockResolvedValue(
        rows.map((r) => ({ goalMemberships: [], ...r })),
      );
    }

    it('includes undated Goals, sorting them after dated Goals within membership partitions', async () => {
      setActiveGoals([
        { id: goalC, name: 'Zulu', dueDate: null },
        { id: goalB, name: 'Alpha', dueDate: null },
        { id: goalA, name: 'Dated', dueDate: new Date('2026-05-20T00:00:00Z') },
      ]);
      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );
      expect(result.items.map((item) => item.id)).toEqual([
        goalA,
        goalB,
        goalC,
      ]);
      expect(result.items[1]?.dueDate).toBeNull();
    });

    it('emits audience=PROJECT for goals with zero membership rows', async () => {
      const due = new Date('2026-05-20T00:00:00.000Z');
      setActiveGoals([{ id: goalA, name: 'Ship widgets v1', dueDate: due }]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(result.items).toEqual([
        {
          id: goalA,
          name: 'Ship widgets v1',
          dueDate: due.toISOString(),
          audience: 'PROJECT',
        },
      ]);
      expect(result.userId).toBe(callerUserId);
      expect(result.windowDays).toBe(30);
    });

    it('emits audience=MEMBERS for goals with at least one membership row', async () => {
      const due = new Date('2026-05-20T00:00:00.000Z');
      setActiveGoals([
        {
          id: goalA,
          name: 'Members-only goal',
          dueDate: due,
          goalMemberships: [{ userId: callerUserId }],
        },
      ]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(result.items[0]?.audience).toBe('MEMBERS');
    });

    it('emits audience=MEMBERS even when caller is not one of the members', async () => {
      const due = new Date('2026-05-20T00:00:00.000Z');
      const otherUserId = '88888888-8888-8888-8888-888888888888';
      setActiveGoals([
        {
          id: goalA,
          name: 'Other-team goal',
          dueDate: due,
          goalMemberships: [{ userId: otherUserId }],
        },
      ]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(result.items[0]?.audience).toBe('MEMBERS');
    });

    it('sorts goals the caller is a member of before non-member goals regardless of dueDate', async () => {
      const earlier = new Date('2026-05-15T00:00:00.000Z');
      const later = new Date('2026-05-25T00:00:00.000Z');
      setActiveGoals([
        { id: goalA, name: 'Project-wide soonest', dueDate: earlier },
        {
          id: goalB,
          name: 'Members-only later',
          dueDate: later,
          goalMemberships: [{ userId: callerUserId }],
        },
      ]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(result.items.map((i) => i.id)).toEqual([goalB, goalA]);
    });

    it('secondary-sorts by dueDate asc then name asc within the member-of partition', async () => {
      const dueEarly = new Date('2026-05-15T00:00:00.000Z');
      const dueLate = new Date('2026-05-20T00:00:00.000Z');
      setActiveGoals([
        { id: goalC, name: 'Bravo', dueDate: dueLate },
        { id: goalA, name: 'Alpha', dueDate: dueLate },
        { id: goalB, name: 'Charlie', dueDate: dueEarly },
      ]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      // goalB (dueEarly) first; within dueLate group, Alpha before Bravo by name.
      expect(result.items.map((i) => i.id)).toEqual([goalB, goalA, goalC]);
    });

    it('excludes COMPLETED, CANCELLED, and ARCHIVED goals via status.notIn', async () => {
      setActiveGoals([]);

      await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { notIn: ['COMPLETED', 'CANCELLED', 'ARCHIVED'] },
          }),
        }),
      );
    });

    it('applies the dueDate window using gte/lte from now and now + windowDays', async () => {
      setActiveGoals([]);

      await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      const expectedEnd = new Date(
        fixedNow.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { dueDate: null },
              { dueDate: { gte: fixedNow, lte: expectedEnd } },
            ],
          }),
        }),
      );
    });

    it('treats windowDays=30 as a 30-day look-ahead (default semantics)', async () => {
      const inWindow = new Date('2026-05-20T00:00:00.000Z');
      const atBoundary = new Date('2026-06-10T00:00:00.000Z');
      setActiveGoals([
        { id: goalA, name: 'A', dueDate: inWindow },
        { id: goalB, name: 'B', dueDate: atBoundary },
      ]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      expect(result.windowDays).toBe(30);
      expect(result.items.map((i) => i.id)).toEqual([goalA, goalB]);

      const callArgs = (mockPrisma.db.task.findMany as jest.Mock).mock
        .calls[0][0];
      const lte: Date = callArgs.where.OR[1].dueDate.lte;
      expect(lte.getTime() - fixedNow.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('echoes the caller userId back even though it does not appear in the where clause', async () => {
      setActiveGoals([{ id: goalC, name: 'Project-wide', dueDate: fixedNow }]);

      const result = await service.getActiveGoals(
        testIds.organization,
        testIds.project,
        callerUserId,
        30,
      );

      const callArgs = (mockPrisma.db.task.findMany as jest.Mock).mock
        .calls[0][0];
      expect(JSON.stringify(callArgs.where)).not.toContain(callerUserId);
      expect(result.userId).toBe(callerUserId);
    });
  });
});
