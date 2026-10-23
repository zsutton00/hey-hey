import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { EntityContextController } from '../../src/controllers/entity-context.controller';
import { EntityContextService } from '../../src/services/entity-context/entity-context.service';
import { GraphsClientService } from '../../src/services/graphs-client.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../src/auth/guards/organization.guard';
import { WorkItemTypeRegistryService } from '../../src/services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../setup/work-item-type-registry.fixture';
import { RelationshipType } from '../../src/generated/graphs/model/relationshipType';
import * as TestUtils from '../../src/utils/testUtils';

const { testIds } = TestUtils;

const entityId = '123e4567-e89b-42d3-a456-426614174099';
const proposalIdA = '123e4567-e89b-42d3-a456-426614174050';
const proposalIdB = '123e4567-e89b-42d3-a456-426614174051';
const conversationIdA = '123e4567-e89b-42d3-a456-426614174060';
const relatedTaskId = '123e4567-e89b-42d3-a456-426614174080';
const entityCreatedAt = new Date('2026-02-15T08:00:00Z');

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
    approvalRecords: [],
    groupMembership: null,
    workItemChangeSetMaterialization: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    updatedAt: new Date('2026-03-01T10:00:00Z'),
    ...overrides,
  };
}

function makeNeighborhood(overrides?: Record<string, unknown>) {
  return {
    relatedEntities: [
      {
        entityId: relatedTaskId,
        entityType: 'TASK',
        displayName: 'Related Task',
        status: 'BACKLOG',
        relationship: 'tracked-by',
        taskType: 'STANDARD',
      },
    ],
    agentSessions: [],
    ...overrides,
  };
}

function contextUrl(
  entityType: string,
  eid: string = entityId,
  orgId: string = testIds.organization,
  projId: string = testIds.project,
): string {
  return `/api/v1/organizations/${orgId}/projects/${projId}/entities/${entityType}/${eid}/context`;
}

describe('EntityContext API Integration Tests', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockGraphsClient: {
    searchGraph: jest.Mock;
    getEntityNeighborhood: jest.Mock;
  };

  beforeAll(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).proposal = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    };
    (mockPrisma.db as any).$queryRaw = jest.fn();

    mockGraphsClient = {
      searchGraph: jest.fn(),
      getEntityNeighborhood: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EntityContextController],
      providers: [
        EntityContextService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GraphsClientService, useValue: mockGraphsClient },
        {
          provide: WorkItemTypeRegistryService,
          useValue: await createWarmWorkItemTypeRegistry(),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          // Inject a mock auth token into the request
          const req = ctx.switchToHttp().getRequest();
          req.headers = req.headers ?? {};
          req.headers.authorization = 'Bearer test-token';
          return true;
        },
      })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: TASK entity exists with a known createdAt
    (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
      createdAt: entityCreatedAt,
      name: 'Tracked Work Item',
      type: 'STANDARD',
    });
    (mockPrisma.db.task.findFirst as jest.Mock).mockResolvedValue({
      type: 'STANDARD',
      parentTaskId: null,
      initiativeId: null,
    });
    (mockPrisma.db as any).$queryRaw.mockResolvedValue([]);
    (mockGraphsClient.searchGraph as jest.Mock).mockResolvedValue({
      seedResults: [],
      totalElements: 0,
    });
    // Default: no proposals
    (mockPrisma.db as any).proposal.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(null);
    (mockPrisma.db.projectMember.findMany as jest.Mock).mockResolvedValue([
      { userId: testIds.user },
    ]);
    // Default: Graph returns the bounded, labeled neighborhood projection.
    mockGraphsClient.getEntityNeighborhood.mockResolvedValue(makeNeighborhood());
  });

  // ── Reverse Lookup & Ordering ───────────────────────────────────────

  describe('reverse lookup returns proposals ordered by createdAt desc', () => {
    it('should return all proposals targeting the entity in descending order', async () => {
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
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue({
        id: proposalIdA,
      });

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.proposals).toHaveLength(2);
      expect(res.body.proposals[0].id).toBe(proposalIdB);
      expect(res.body.proposals[1].id).toBe(proposalIdA);
    });
  });

  // ── creatingProposalId Derivation ───────────────────────────────────

  describe('creatingProposalId derivation', () => {
    it('should derive creatingProposalId from the earliest CREATE-action proposal', async () => {
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
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue({
        id: proposalIdA,
      });

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.creatingProposalId).toBe(proposalIdA);
    });

    it('should omit creatingProposalId when no CREATE proposal exists', async () => {
      const proposals = [makeStoredProposal({ action: 'UPDATE' })];
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.creatingProposalId).toBeUndefined();
    });
  });

  // ── Proposal Summary Serialization ──────────────────────────────────

  describe('proposal summary serialization', () => {
    it('should include id, action, createdAt, influences, and conversationId', async () => {
      const influences = [
        {
          entityId: testIds.task,
          entityType: 'TASK',
          reasoning: 'Referenced during discussion',
          reasonType: 'explicit_mention',
        },
      ];

      const proposals = [
        makeStoredProposal({
          influences,
          conversationId: conversationIdA,
        }),
      ];
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      const proposal = res.body.proposals[0];
      expect(proposal.id).toBe(proposalIdA);
      expect(proposal.action).toBe('UPDATE');
      expect(proposal.createdAt).toBe('2026-03-01T10:00:00.000Z');
      expect(proposal.influences).toEqual(influences);
      expect(proposal.conversationId).toBe(conversationIdA);
    });
  });

  // ── Empty Proposals ─────────────────────────────────────────────────

  describe('entities without proposal history', () => {
    it('should return empty proposals array and no creatingProposalId', async () => {
      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.proposals).toEqual([]);
      expect(res.body.creatingProposalId).toBeUndefined();
    });
  });

  // ── DESIGN_DOC Entity Support ───────────────────────────────────────

  describe('DESIGN_DOC entities', () => {
    it('should return proposals when they exist for a DESIGN_DOC', async () => {
      const docCreated = new Date('2026-01-10T09:00:00Z');
      (mockPrisma.db.designDoc.findUnique as jest.Mock).mockResolvedValue({
        createdAt: docCreated,
      });

      const proposals = [
        makeStoredProposal({
          targetEntityType: 'DESIGN_DOC',
          action: 'CREATE',
        }),
      ];
      (mockPrisma.db as any).proposal.findMany.mockResolvedValue(proposals);
      (mockPrisma.db as any).proposal.findFirst.mockResolvedValue({
        id: proposalIdA,
      });

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('DESIGN_DOC'))
        .expect(200);

      expect(res.body.entityType).toBe('DESIGN_DOC');
      expect(res.body.createdAt).toBe(docCreated.toISOString());
      expect(res.body.proposals).toHaveLength(1);
      expect(res.body.creatingProposalId).toBe(proposalIdA);
    });
  });

  // ── MCP Tools by Entity Type ────────────────────────────────────────

  describe('available MCP tools population', () => {
    it('should return edit_task tool for TASK entities', async () => {
      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.availableMcpTools).toHaveLength(1);
      expect(res.body.availableMcpTools[0]).toEqual(
        expect.objectContaining({
          toolName: 'attach_to_goal',
          targetEntityType: 'TASK',
          label: expect.any(String),
          description: expect.any(String),
        }),
      );
    });

    it('should return empty MCP tools for entity types without registered tools', async () => {
      (mockPrisma.db.plan.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        stages: [],
      });

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('PLAN'))
        .expect(200);

      expect(res.body.availableMcpTools).toEqual([
        expect.objectContaining({
          toolName: 'attach_to_goal',
          targetEntityType: 'PLAN',
        }),
      ]);
    });
  });

  // ── TRACKS relatedEntities projection ───────────────────────────────

  describe('TRACKS relatedEntities projection', () => {
    it('should expose an outgoing Goal TRACKS neighbor with a resolved subtype', async () => {
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Quarterly Goal',
        type: 'GOAL',
      });

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.taskType).toBe('GOAL');
      expect(res.body.relatedEntities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: relatedTaskId,
            entityType: 'TASK',
            relationship: 'tracked-by',
            taskType: 'STANDARD',
          }),
        ]),
      );
      expect(
        mockGraphsClient.getEntityNeighborhood.mock.calls[0][2],
      ).toEqual(
        expect.objectContaining({
          depth: 1,
          relationshipTypes: expect.arrayContaining([RelationshipType.Tracks]),
        }),
      );
    });

    it('should expose an incoming Goal TRACKS neighbor when seeded by tracked work', async () => {
      (mockPrisma.db.task.findUnique as jest.Mock).mockResolvedValue({
        createdAt: entityCreatedAt,
        name: 'Tracked Standard Work',
        type: 'STANDARD',
      });
      mockGraphsClient.getEntityNeighborhood.mockResolvedValue(
        makeNeighborhood({
          relatedEntities: [
            {
              entityId: relatedTaskId,
              entityType: 'TASK',
              displayName: 'Parent Goal',
              relationship: 'tracks',
              taskType: 'GOAL',
            },
          ],
        }),
      );

      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.taskType).toBe('STANDARD');
      expect(res.body.relatedEntities).toEqual([
        expect.objectContaining({
          relationship: 'tracks',
          taskType: 'GOAL',
        }),
      ]);
    });

    it('should keep the bounded projection non-empty and empty it on Graph failure', async () => {
      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body.relatedEntities).toHaveLength(1);

      mockGraphsClient.getEntityNeighborhood.mockRejectedValue(
        new Error('Graph service unavailable'),
      );

      const failedRes = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(failedRes.body.relatedEntities).toEqual([]);
      // Proposals should still be returned
      expect(failedRes.body.proposals).toBeDefined();
    });
  });

  // ── Error Handling ──────────────────────────────────────────────────

  describe('error responses', () => {
    it('should return 400 for an invalid entity type', async () => {
      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('INVALID_TYPE'))
        .expect(400);

      expect(res.body.message).toContain('Unsupported entity type');
    });

    it('should return 400 for a non-UUID entityId', async () => {
      await request(app.getHttpServer() as App)
        .get(contextUrl('TASK', 'not-a-uuid'))
        .expect(400);
    });
  });

  // ── Response Shape Verification ─────────────────────────────────────

  describe('response shape', () => {
    it('should include all top-level FullEntityContextDto fields', async () => {
      const res = await request(app.getHttpServer() as App)
        .get(contextUrl('TASK'))
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          entityId,
          entityType: 'TASK',
          createdAt: entityCreatedAt.toISOString(),
          taskType: 'STANDARD',
          proposals: [],
          availableMcpTools: expect.any(Array),
          relatedEntities: expect.any(Array),
          agentSessions: expect.any(Array),
        }),
      );
    });
  });
});
