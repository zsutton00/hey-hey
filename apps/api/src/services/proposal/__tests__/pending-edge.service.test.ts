import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import {
  PendingEdgeService,
  SERVICE_TOKEN_FACTORY,
} from '../pending-edge.service';
import * as TestUtils from '../../../utils/testUtils';
import { TaskService } from '../../tasks/task.service';
import { AgentEdgeEndpointEntityType } from '../../../generated/graphs/model/agentEdgeEndpointEntityType';
import { toRequirementCitationEdgeDto } from '../../tasks/feature-requirement-citation-edges';

const { testIds } = TestUtils;

const proposalA = '00000000-0000-0000-0000-000000000001';
const proposalB = '00000000-0000-0000-0000-000000000002';
const proposalC = '00000000-0000-0000-0000-000000000003';
const entityA = '00000000-0000-0000-0000-0000000000a1';
const entityB = '00000000-0000-0000-0000-0000000000b1';
const entityC = '00000000-0000-0000-0000-0000000000c1';

function makeProposal(overrides?: Record<string, unknown>) {
  return {
    id: proposalA,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'APPROVED',
    targetEntityId: entityA,
    targetEntityType: 'TASK',
    updates: {},
    requestorId: testIds.user,
    requestorContext: null,
    influences: null,
    edges: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    createdAt: new Date('2026-04-07T00:00:00Z'),
    updatedAt: new Date('2026-04-07T00:00:00Z'),
    ...overrides,
  };
}

describe('PendingEdgeService', () => {
  let service: PendingEdgeService;
  let mockAgentEdgeClient: {
    createBatch: jest.Mock;
    delete: jest.Mock;
  };
  let mockTaskService: { updateInTransaction: jest.Mock };
  let mockTokenFactory: jest.Mock;
  let mockTx: {
    $queryRaw: jest.Mock;
    proposal: { findFirst: jest.Mock };
    task: { findFirst: jest.Mock };
    designDoc: { findFirst: jest.Mock };
    pendingProposalEdge: {
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).agentSession = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    mockAgentEdgeClient = {
      createBatch: jest.fn().mockImplementation((_org, _project, dtos) =>
        Promise.resolve(
          dtos.map((_dto: unknown, index: number) => ({
            index,
            success: true,
            edge: { id: `edge-${index + 1}` },
          })),
        ),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    mockTaskService = {
      updateInTransaction: jest.fn().mockResolvedValue({
        task: { id: entityB },
        postCommit: {
          statusChange: { previousStatus: 'ACTIVE', newStatus: 'SUPERSEDED' },
        },
      }),
    };
    mockTokenFactory = jest.fn().mockReturnValue('mock-token');

    mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ lockAcquired: '' }]),
      proposal: { findFirst: jest.fn() },
      task: { findFirst: jest.fn() },
      designDoc: { findFirst: jest.fn() },
      pendingProposalEdge: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PendingEdgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentEdgeClientService, useValue: mockAgentEdgeClient },
        { provide: TaskService, useValue: mockTaskService },
        { provide: SERVICE_TOKEN_FACTORY, useValue: mockTokenFactory },
      ],
    }).compile();

    service = module.get<PendingEdgeService>(PendingEdgeService);
    jest.clearAllMocks();
    // Re-set defaults after clearAllMocks
    mockTokenFactory.mockReturnValue('mock-token');
    mockTx.pendingProposalEdge.findMany.mockResolvedValue([]);
    mockTx.pendingProposalEdge.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('uses canonical citation DTOs and tracks partial success before propagating failure', async () => {
    const edges = [
      {
        id: proposalA,
        featureId: entityA,
        entityId: entityB,
        entityType: AgentEdgeEndpointEntityType.Task,
      },
      {
        id: proposalB,
        featureId: entityA,
        entityId: entityC,
        entityType: AgentEdgeEndpointEntityType.Task,
      },
    ];
    const onCreated = jest.fn();
    mockAgentEdgeClient.createBatch.mockResolvedValue([
      {
        index: 0,
        success: true,
        edge: toRequirementCitationEdgeDto(edges[0]!),
      },
      { index: 1, success: false, error: 'Graph unavailable' },
    ]);

    await expect(
      service.materializeRequirementCitationEdges(
        testIds.organization,
        testIds.project,
        edges,
        onCreated,
      ),
    ).rejects.toThrow('Failed to create 1 requirement citation edge(s)');

    expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      edges.map(toRequirementCitationEdgeDto),
      'mock-token',
    );
    expect(
      mockAgentEdgeClient.createBatch.mock.calls[0]![2][0],
    ).not.toHaveProperty('createdBySessionId');
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ edgeId: proposalA }),
    );
  });

  it('resolves an element-to-Diagram pending link and retains it after Graph failure', async () => {
    const pending = {
      id: '00000000-0000-0000-0000-0000000000e1',
      sourceProposalId: proposalA,
      sourceEntityId: entityA,
      targetProposalId: proposalB,
      edgeType: 'RELATED_TO',
      description: null,
    };
    const findMany = jest.fn().mockResolvedValue([pending]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const get = jest.fn().mockRejectedValue({ response: { status: 404 } });
    Object.assign(mockPrisma.db, {
      pendingProposalEdge: { findMany, deleteMany },
      proposal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          targetEntityType: 'TASK',
          conversationId: null,
        }),
      },
    });
    Object.assign(mockAgentEdgeClient, { get });
    mockAgentEdgeClient.createBatch.mockResolvedValueOnce([
      { index: 0, success: false, error: 'Graph unavailable' },
    ]);
    const diagram = makeProposal({ id: proposalB, targetEntityId: entityB });

    await expect(
      service.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal(
        diagram as any,
        entityB,
      ),
    ).rejects.toThrow('Failed to materialize 1 proposal edge');
    expect(deleteMany).not.toHaveBeenCalled();

    mockAgentEdgeClient.createBatch.mockResolvedValueOnce([
      { index: 0, success: true, edge: { id: pending.id } },
    ]);
    await service.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal(
      diagram as any,
      entityB,
    );
    expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      [
        expect.objectContaining({
          id: pending.id,
          sourceNodeId: entityA,
          targetNodeId: entityB,
        }),
      ],
      'mock-token',
    );
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: pending.id } });
  });

  describe('processDeclaredEdges', () => {
    it.each(['DRAFT', 'REJECTED', 'APPROVED'])(
      'preserves durable links through approval and repeated processing with a %s target',
      async (status) => {
        const durable = {
          endpointMode: 'PROPOSAL',
          targetEntityType: 'PROPOSAL',
          targetEntityId: proposalB,
          edgeType: 'DEPENDS_ON',
          targetEntityTitle: 'Target proposal',
        };
        const proposal = makeProposal({ edges: [durable] });
        mockTx.proposal.findFirst.mockResolvedValue({
          id: proposalB,
          status,
          targetEntityId: entityB,
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(
            await service.processDeclaredEdges(
              mockTx as any,
              proposal as any,
              entityA,
            ),
          ).toEqual([]);
        }
        expect(proposal.edges).toEqual([durable]);
        expect(mockTx.proposal.findFirst).not.toHaveBeenCalled();
        expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
        expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
      },
    );

    it('processes deferred declarations alongside durable links', async () => {
      const proposal = makeProposal({
        edges: [
          {
            endpointMode: 'PROPOSAL',
            targetEntityType: 'PROPOSAL',
            targetEntityId: proposalB,
            edgeType: 'EVOLVES',
          },
          {
            targetEntityType: 'PROPOSAL',
            targetEntityId: proposalC,
            edgeType: 'DEPENDS_ON',
          },
        ],
      });
      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalC,
        status: 'PENDING',
      });
      await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledTimes(1);
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ targetProposalId: proposalC }),
        }),
      );
    });
    it('returns empty when proposal has no edges', async () => {
      const proposal = makeProposal({ edges: null });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('materializes compound TRACKS intent from the existing source to the new item', async () => {
      const proposal = makeProposal({
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'TRACKS',
            description: 'Tracks the newly created work item',
          },
        ],
      });
      mockTx.task.findFirst.mockResolvedValue({ id: entityB });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityB,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityA,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'TRACKS',
          description: 'Tracks the newly created work item',
        },
      ]);
      expect(mockAgentEdgeClient.createBatch).not.toHaveBeenCalled();
    });

    it('immediately resolves PROPOSAL edge when target proposal is already approved', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: proposalB,
            targetEntityType: 'PROPOSAL',
            edgeType: 'DEPENDS_ON',
            description: 'A depends on B',
          },
        ],
      });

      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalB,
        status: 'APPROVED',
        targetEntityId: entityB,
        targetEntityType: 'TASK',
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on B',
        },
      ]);
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('stores pending edge when PROPOSAL target is not yet approved', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: proposalB,
            targetEntityType: 'PROPOSAL',
            edgeType: 'BLOCKS',
          },
        ],
      });

      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalB,
        status: 'DRAFT',
        targetEntityId: proposalB,
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceProposalId: proposalA,
          sourceEntityId: entityA,
          targetProposalId: proposalB,
          edgeType: 'BLOCKS',
          description: null,
        }),
      });
    });

    it('stores pending EVOLVES edge when PROPOSAL target is not yet approved', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: proposalB,
            targetEntityType: 'PROPOSAL',
            edgeType: 'EVOLVES',
            description: 'A evolves B',
          },
        ],
      });

      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalB,
        status: 'DRAFT',
        targetEntityId: proposalB,
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceProposalId: proposalA,
          sourceEntityId: entityA,
          targetProposalId: proposalB,
          edgeType: 'EVOLVES',
          description: 'A evolves B',
        }),
      });
    });

    it('skips PROPOSAL edge when target proposal does not exist', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: proposalB,
            targetEntityType: 'PROPOSAL',
            edgeType: 'RELATED_TO',
          },
        ],
      });

      mockTx.proposal.findFirst.mockResolvedValue(null);

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('immediately resolves TASK edge to an existing task', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'DEPENDS_ON',
            description: 'A depends on existing task B',
          },
        ],
      });

      mockTx.task.findFirst.mockResolvedValue({ id: entityB });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on existing task B',
        },
      ]);
      expect(mockTx.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: entityB,
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
        select: { id: true },
      });
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
      expect(mockTx.proposal.findFirst).not.toHaveBeenCalled();
    });

    it('materializes successor-authored SUPERSEDES by superseding the target task and inverting the edge', async () => {
      const proposal = makeProposal({
        id: proposalA,
        targetEntityType: 'TASK',
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
            description: 'A replaces B',
          },
        ],
      });
      const postCommits: unknown[] = [];

      mockTx.task.findFirst
        .mockResolvedValueOnce({
          id: entityB,
          name: 'Predecessor',
          status: 'ACTIVE',
          type: 'STANDARD',
          initiativeId: testIds.initiative,
        })
        .mockResolvedValueOnce({ id: entityA, name: 'Successor' });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
        {
          onTaskPostCommit: (postCommit) => postCommits.push(postCommit),
        },
      );

      expect(mockTaskService.updateInTransaction).toHaveBeenCalledWith(
        mockTx,
        testIds.organization,
        testIds.initiative,
        entityB,
        { status: 'SUPERSEDED' },
        testIds.user,
      );
      expect(postCommits).toEqual([
        {
          taskId: entityB,
          postCommit: {
            statusChange: {
              previousStatus: 'ACTIVE',
              newStatus: 'SUPERSEDED',
            },
          },
        },
      ]);
      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityB,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityA,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'SUPERSEDES',
          description: 'A replaces B',
        },
      ]);
      expect(mockAgentEdgeClient.createBatch).not.toHaveBeenCalled();
    });

    it('treats an already-superseded predecessor as an idempotent no-op', async () => {
      const proposal = makeProposal({
        id: proposalA,
        targetEntityType: 'TASK',
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
            description: 'A replaces B',
          },
        ],
      });

      mockTx.task.findFirst.mockResolvedValueOnce({
        id: entityB,
        name: 'Predecessor',
        status: 'SUPERSEDED',
        type: 'STANDARD',
        initiativeId: testIds.initiative,
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockAgentEdgeClient.createBatch).not.toHaveBeenCalled();
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
      expect(mockTx.task.findFirst).toHaveBeenCalledTimes(1);
    });

    it('does not call Graph when the predecessor status update fails', async () => {
      const proposal = makeProposal({
        id: proposalA,
        targetEntityType: 'TASK',
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
          },
        ],
      });

      mockTx.task.findFirst
        .mockResolvedValueOnce({
          id: entityB,
          name: 'Predecessor',
          status: 'ACTIVE',
          type: 'STANDARD',
          initiativeId: testIds.initiative,
        })
        .mockResolvedValueOnce({ id: entityA, name: 'Successor' });
      mockTaskService.updateInTransaction.mockRejectedValueOnce(
        new Error('status update failed'),
      );

      await expect(
        service.processDeclaredEdges(mockTx as any, proposal as any, entityA),
      ).rejects.toThrow('status update failed');

      expect(mockAgentEdgeClient.createBatch).not.toHaveBeenCalled();
      expect(mockAgentEdgeClient.delete).not.toHaveBeenCalled();
    });

    it('rejects successor-authored SUPERSEDES to a non-task target', async () => {
      const proposal = makeProposal({
        id: proposalA,
        targetEntityType: 'TASK',
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'DESIGN_DOC',
            edgeType: 'SUPERSEDES',
          },
        ],
      });

      await expect(
        service.processDeclaredEdges(mockTx as any, proposal as any, entityA),
      ).rejects.toThrow('predecessor work item');
    });

    it('immediately resolves DESIGN_DOC edge to an existing design doc', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'DESIGN_DOC',
            edgeType: 'RELATED_TO',
          },
        ],
      });

      mockTx.designDoc.findFirst.mockResolvedValue({ id: entityB });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.DesignDoc,
          edgeType: 'RELATED_TO',
          description: undefined,
        },
      ]);
      expect(mockTx.designDoc.findFirst).toHaveBeenCalledWith({
        where: { id: entityB, organizationId: testIds.organization },
        select: { id: true },
      });
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('normalizes feature/goal/bug aliases on declared edges to TASK and resolves against the task table', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'feature',
            edgeType: 'DEPENDS_ON',
            description: 'A depends on existing feature B',
          },
        ],
      });

      mockTx.task.findFirst.mockResolvedValue({ id: entityB });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on existing feature B',
        },
      ]);
      expect(mockTx.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: entityB,
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
        select: { id: true },
      });
      expect(mockTx.designDoc.findFirst).not.toHaveBeenCalled();
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('skips TASK edge when target task does not exist', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: entityB,
            targetEntityType: 'TASK',
            edgeType: 'BLOCKS',
          },
        ],
      });

      mockTx.task.findFirst.mockResolvedValue(null);

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toEqual([]);
      expect(mockTx.pendingProposalEdge.create).not.toHaveBeenCalled();
    });

    it('resolves existing pending edges targeting this proposal', async () => {
      const proposal = makeProposal({ id: proposalB, edges: null });

      // Simulate a pending edge from A→B that was stored earlier
      mockTx.pendingProposalEdge.findMany.mockResolvedValue([
        {
          id: 'pending-1',
          sourceProposalId: proposalA,
          sourceEntityId: entityA,
          targetProposalId: proposalB,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on B',
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
      ]);
      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalA,
        targetEntityType: 'TASK',
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityB,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on B',
        },
      ]);
      expect(mockTx.pendingProposalEdge.deleteMany).toHaveBeenCalledWith({
        where: { targetProposalId: proposalB },
      });
    });

    it('handles mixed immediate and pending PROPOSAL edges', async () => {
      const proposal = makeProposal({
        id: proposalA,
        edges: [
          {
            targetEntityId: proposalB,
            targetEntityType: 'PROPOSAL',
            edgeType: 'DEPENDS_ON',
            description: 'A depends on B',
          },
          {
            targetEntityId: proposalC,
            targetEntityType: 'PROPOSAL',
            edgeType: 'RELATED_TO',
          },
        ],
      });

      mockTx.proposal.findFirst
        .mockResolvedValueOnce({
          id: proposalB,
          status: 'APPROVED',
          targetEntityId: entityB,
          targetEntityType: 'TASK',
        })
        .mockResolvedValueOnce({
          id: proposalC,
          status: 'DRAFT',
          targetEntityId: proposalC,
          targetEntityType: 'TASK',
        });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityA,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: expect.any(String),
        sourceEntityId: entityA,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetEntityId: entityB,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        edgeType: 'DEPENDS_ON',
        description: 'A depends on B',
      });
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledTimes(1);
      expect(mockTx.pendingProposalEdge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetProposalId: proposalC,
          edgeType: 'RELATED_TO',
        }),
      });
    });

    it('handles chain topology: A→B→C resolves B→C when C is approved', async () => {
      // Scenario: C is approved, B had a pending edge B→C
      const proposal = makeProposal({ id: proposalC, edges: null });

      mockTx.pendingProposalEdge.findMany.mockResolvedValue([
        {
          id: 'pending-bc',
          sourceProposalId: proposalB,
          sourceEntityId: entityB,
          targetProposalId: proposalC,
          edgeType: 'DEPENDS_ON',
          description: null,
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
      ]);
      mockTx.proposal.findFirst.mockResolvedValue({
        id: proposalB,
        targetEntityType: 'TASK',
      });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityC,
      );

      expect(result).toEqual([
        {
          id: expect.any(String),
          sourceEntityId: entityB,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityC,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
          description: undefined,
        },
      ]);
    });

    it('handles star topology: multiple pending edges targeting same proposal', async () => {
      const proposal = makeProposal({ id: proposalC, edges: null });

      // Both A→C and B→C were pending
      mockTx.pendingProposalEdge.findMany.mockResolvedValue([
        {
          id: 'pending-ac',
          sourceProposalId: proposalA,
          sourceEntityId: entityA,
          targetProposalId: proposalC,
          edgeType: 'DEPENDS_ON',
          description: 'A depends on C',
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
        {
          id: 'pending-bc',
          sourceProposalId: proposalB,
          sourceEntityId: entityB,
          targetProposalId: proposalC,
          edgeType: 'RELATED_TO',
          description: null,
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
      ]);
      mockTx.proposal.findFirst
        .mockResolvedValueOnce({
          id: proposalA,
          targetEntityType: 'TASK',
        })
        .mockResolvedValueOnce({
          id: proposalB,
          targetEntityType: 'TASK',
        });

      const result = await service.processDeclaredEdges(
        mockTx as any,
        proposal as any,
        entityC,
      );

      expect(result).toHaveLength(2);
      expect(result[0]!.sourceEntityId).toBe(entityA);
      expect(result[1]!.sourceEntityId).toBe(entityB);
    });
  });

  describe('cleanupForProposal', () => {
    it('deletes pending edges referencing proposal as source or target', async () => {
      mockTx.pendingProposalEdge.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanupForProposal(mockTx as any, proposalA);

      expect(mockTx.pendingProposalEdge.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { sourceProposalId: proposalA },
            { targetProposalId: proposalA },
          ],
        },
      });
    });

    it('handles case where no pending edges exist', async () => {
      mockTx.pendingProposalEdge.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanupForProposal(mockTx as any, proposalA);

      expect(mockTx.pendingProposalEdge.deleteMany).toHaveBeenCalled();
    });
  });

  describe('materializeEdges', () => {
    const conversationId = '00000000-0000-0000-0000-00000000c001';
    const agentSessionId = '00000000-0000-0000-0000-0000000a9e01';

    it('resolves agent session from conversationId for provenance', async () => {
      (mockPrisma.db as any).agentSession.findFirst.mockResolvedValue({
        id: agentSessionId,
      });

      await service.materializeEdges(
        testIds.organization,
        testIds.project,
        [
          {
            sourceEntityId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetEntityId: entityB,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            edgeType: 'DEPENDS_ON',
            description: 'A depends on B',
          },
        ],
        conversationId,
      );

      expect(
        (mockPrisma.db as any).agentSession.findFirst,
      ).toHaveBeenCalledWith({
        where: { conversationId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          {
            sourceNodeId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetNodeId: entityB,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            type: 'DEPENDS_ON',
            reasoning: 'A depends on B',
            createdBySessionId: agentSessionId,
          },
        ],
        'mock-token',
      );
    });

    it('forwards a stable edge identity for retry-safe publication', async () => {
      const edgeId = '123e4567-e89b-42d3-a456-426614174370';

      await service.materializeEdges(testIds.organization, testIds.project, [
        {
          id: edgeId,
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'DEPENDS_ON',
        },
      ]);

      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [expect.objectContaining({ id: edgeId })],
        'mock-token',
      );
    });

    it('falls back to system UUID when no agent session found', async () => {
      (mockPrisma.db as any).agentSession.findFirst.mockResolvedValue(null);

      await service.materializeEdges(
        testIds.organization,
        testIds.project,
        [
          {
            sourceEntityId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetEntityId: entityB,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            edgeType: 'DEPENDS_ON',
          },
        ],
        conversationId,
      );

      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          expect.objectContaining({
            createdBySessionId: '00000000-0000-0000-0000-edgema7e1a1e',
          }),
        ],
        'mock-token',
      );
    });

    it('falls back to system UUID when conversationId is null', async () => {
      await service.materializeEdges(
        testIds.organization,
        testIds.project,
        [
          {
            sourceEntityId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetEntityId: entityB,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            edgeType: 'DEPENDS_ON',
          },
        ],
        null,
      );

      expect(
        (mockPrisma.db as any).agentSession.findFirst,
      ).not.toHaveBeenCalled();
      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          expect.objectContaining({
            createdBySessionId: '00000000-0000-0000-0000-edgema7e1a1e',
          }),
        ],
        'mock-token',
      );
    });

    it('does nothing when edges array is empty', async () => {
      await service.materializeEdges(testIds.organization, testIds.project, []);

      expect(mockAgentEdgeClient.createBatch).not.toHaveBeenCalled();
      expect(mockTokenFactory).not.toHaveBeenCalled();
    });

    it('attempts remaining edges and then fails when any edge fails', async () => {
      const timingLog = jest.spyOn((service as any).logger, 'log');
      mockAgentEdgeClient.createBatch.mockResolvedValueOnce([
        { index: 0, success: false, error: 'Graph service down' },
        { index: 1, success: true, edge: { id: 'edge-2' } },
      ]);

      await expect(
        service.materializeEdges(testIds.organization, testIds.project, [
          {
            sourceEntityId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetEntityId: entityB,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            edgeType: 'DEPENDS_ON',
          },
          {
            sourceEntityId: entityA,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetEntityId: entityC,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            edgeType: 'RELATED_TO',
          },
        ]),
      ).rejects.toThrow(
        'Failed to materialize 1 proposal edge(s) in graph service.',
      );

      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledTimes(1);
      expect(timingLog).toHaveBeenCalledWith(
        'Proposal edge materialization timing',
        expect.objectContaining({
          edgeCount: 2,
          failureCount: 1,
          outcome: 'mixed',
          graphRequestCount: 1,
          graphTransactionCount: 2,
          graphStatementCount: 4,
          graphRequestElapsedMs: expect.any(Number),
          totalElapsedMs: expect.any(Number),
        }),
      );
    });

    it('uses default reasoning when description is absent', async () => {
      await service.materializeEdges(testIds.organization, testIds.project, [
        {
          sourceEntityId: entityA,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: entityB,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: 'BLOCKS',
        },
      ]);

      expect(mockAgentEdgeClient.createBatch).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          expect.objectContaining({
            reasoning: 'Declared via proposal edge (BLOCKS)',
          }),
        ],
        'mock-token',
      );
    });
  });
});
