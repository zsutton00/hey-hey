import { ProposalReconciliationGroupService } from '../proposal-reconciliation-group.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { mockProposalAdmission } from './mock-proposal-admission';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalService } from '../proposal.service';
import {
  createDefaultProjectApprovalPolicy,
  ProjectApprovalPolicyService,
} from '../project-approval-policy.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { ProposalApprovalService } from '../proposal-approval.service';
import { PendingEdgeService } from '../pending-edge.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import * as TestUtils from '../../../utils/testUtils';
import { UserId } from '../../../types';
import type { RequestorContext } from '../../../mcp/tools/requestor-context';
import * as permissionEvaluation from '../permission-evaluation';
import { deriveChangedFields } from '../entity-context-resolver';
import type { AnyTransactionClient } from '../../../prisma/prisma.service';
import type { ProposalWithApprovals } from '../proposal.types';
import {
  ProposalAction,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
} from '../../../generated';
import { ProjectAccessService } from 'src/auth/services/project-access.service';

jest.mock('../proposal-response-policy', () => {
  const actual = jest.requireActual('../proposal-response-policy');
  const { toProposalResponseDto } = jest.requireActual('../proposal.types');
  return {
    ...actual,
    mapProposalResponse: async (
      _tx: AnyTransactionClient,
      proposal: ProposalWithApprovals,
      projectPolicy?: { requiredApprovals: number },
    ) =>
      toProposalResponseDto(
        proposal,
        (proposal.requestorContext as { toolName?: string } | null)
          ?.toolName === 'shared-generate-features'
          ? 1
          : (projectPolicy?.requiredApprovals ?? 1),
      ),
    mapProposalResponses: async (
      _tx: AnyTransactionClient,
      proposals: ProposalWithApprovals[],
      projectPolicy?: { requiredApprovals: number },
    ) =>
      proposals.map((proposal) =>
        toProposalResponseDto(proposal, projectPolicy?.requiredApprovals ?? 1),
      ),
  };
});

const { testIds } = TestUtils;

const proposalId = '123e4567-e89b-42d3-a456-426614174099';
const approvingUserId = testIds.user;

function makeStoredProposal(overrides?: Record<string, unknown>) {
  return {
    id: proposalId,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'New task', initiativeId: testIds.initiative },
    requestorId: testIds.user,
    requestorContext: null,
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    createdAt: new Date('2026-03-18T00:00:00Z'),
    updatedAt: new Date('2026-03-18T00:00:00Z'),
    ...overrides,
  };
}

function mockTransaction(mockPrisma: any, txMock: any) {
  txMock.entityRegistry ??= { findMany: jest.fn().mockResolvedValue([]) };
  txMock.task ??= { findMany: jest.fn().mockResolvedValue([]) };
  txMock.task.findMany ??= jest.fn().mockResolvedValue([]);

  jest
    .spyOn(mockPrisma.db as any, '$transaction')
    .mockImplementation(async (fn: any) => fn(txMock));
}

function createMockValidationEngine() {
  return {
    validate: jest.fn().mockResolvedValue({
      valid: true,
      proposals: [{ index: 0, valid: true, errors: [], warnings: [] }],
    }),
    assertTrackingAttachmentValid: jest.fn().mockResolvedValue(undefined),
    assertAuthoringCandidatesValid: jest
      .fn()
      .mockImplementation(mockProposalAdmission),
    assertTaskMutationAuthoringValid: jest.fn().mockResolvedValue(undefined),
    assertPlanStageProposalTopologyValid: jest
      .fn()
      .mockResolvedValue(undefined),
  };
}

function createMockWorkItemTypeRegistry() {
  return {
    getDefinitions: jest.fn().mockReturnValue([]),
  };
}

describe('ProposalService.update', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).task.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).proposal = {
      findFirst: jest.fn(),
      update: jest.fn(),
    };

    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalService,
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        ProjectApprovalPolicyService,
        {
          provide: WorkItemTypeRegistryService,
          useValue: createMockWorkItemTypeRegistry(),
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: createMockValidationEngine(),
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        {
          provide: ProposalApprovalService,
          useValue: {
            approve: jest.fn(),
            applyInTransaction: jest.fn(),
            genericChangeSetRequest: jest.fn().mockReturnValue(null),
            projectGenericPreparation: jest.fn(),
            assertPreparedChangeSetCurrent: jest.fn(
              (_id, _request, prepared) => prepared,
            ),
            queueGenericWorkItemChangeSetInTransaction: jest
              .fn()
              .mockImplementation(async (_tx, proposal) => ({ proposal })),
            materializeGenericWorkItemChangeSet: jest.fn(),
            retryApprovedGenericProposal: jest.fn(),
          },
        },
        {
          provide: PendingEdgeService,
          useValue: {
            materializeEdges: jest.fn(),
            rollbackMaterializedEdges: jest.fn(),
            processDeclaredEdges: jest.fn().mockResolvedValue([]),
            cleanupForProposal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
    jest.clearAllMocks();
  });

  it('rejects the legacy PLAN proposal target after the Work Items cutover', async () => {
    await expect(
      (service as any).validateTargetEntity(
        testIds.plan,
        'PLAN',
        testIds.organization,
        testIds.project,
      ),
    ).rejects.toThrow('Unsupported target entity type: PLAN');

    expect(mockPrisma.db.plan.findFirst).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException for non-existent proposal', async () => {
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { generatedWithVersion: 'test' },
        approvingUserId,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('should reject updates to a REJECTED proposal', async () => {
    const existing = makeStoredProposal({ status: 'REJECTED' });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { generatedWithVersion: 'test' },
        approvingUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('should reject updates to an APPROVED proposal', async () => {
    const existing = makeStoredProposal({ status: 'APPROVED' });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { generatedWithVersion: 'test' },
        approvingUserId,
      ),
    ).rejects.toThrow('Cannot update a proposal with terminal status');

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('should reject edits to a proposal after its group becomes reviewable', async () => {
    const existing = makeStoredProposal({
      groupMembership: { group: { status: 'REVIEWABLE' } },
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { generatedWithVersion: 'test' },
        approvingUserId,
      ),
    ).rejects.toThrow(ConflictException);

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects moving a Message-owned proposal to another Conversation', async () => {
    const existing = makeStoredProposal({
      conversationId: testIds.conversation,
      messageId: '123e4567-e89b-42d3-a456-426614174200',
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { conversationId: '123e4567-e89b-42d3-a456-426614174201' },
        approvingUserId,
      ),
    ).rejects.toThrow(
      'A Message-owned Proposal cannot be moved to another Conversation',
    );

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects an explicit null ELI5 on a draft without clearing its stored explanation', async () => {
    const existing = makeStoredProposal({
      eli5: 'Explains the proposed change.',
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { eli5: null } as never,
        approvingUserId,
      ),
    ).rejects.toThrow('An ELI5 explanation is required');

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('accepts a valid replacement ELI5 on a draft', async () => {
    const existing = makeStoredProposal({ eli5: 'Explains the old change.' });
    const replacement = 'Explains the revised change.';
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue({ ...existing, eli5: replacement }),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { eli5: replacement },
      approvingUserId,
    );

    expect(txMock.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eli5: replacement }),
      }),
    );
  });

  it('should reject deleting a proposal that belongs to a group', async () => {
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue({
          ...makeStoredProposal(),
          groupMembership: { groupId: 'group-1' },
        }),
        delete: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.delete(proposalId, testIds.organization, testIds.project),
    ).rejects.toThrow(ConflictException);

    expect(txMock.proposal.delete).not.toHaveBeenCalled();
  });

  it('routes a DELETE proposal to the approval service when approved', async () => {
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue({
      status: 'DRAFT',
      action: 'DELETE',
    });
    const approvedProposal = makeStoredProposal({
      action: 'DELETE',
      status: 'APPROVED',
    });
    const approveMock = (service as any).approvalService.approve as jest.Mock;
    approveMock.mockResolvedValue({ proposal: approvedProposal });

    const result = await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { status: 'APPROVED' },
      approvingUserId,
    );

    // DELETE proposals must reach the approval service rather than being
    // rejected by the generic update path.
    expect(approveMock).toHaveBeenCalledWith(
      proposalId,
      testIds.organization,
      testIds.project,
      approvingUserId,
      null,
      undefined,
      undefined,
    );
    expect(result.status).toBe('APPROVED');
  });

  it('routes repeat approval of an approved generic proposal to explicit retry', async () => {
    const approvedProposal = makeStoredProposal({ status: 'APPROVED' });
    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue({
      status: 'APPROVED',
      action: 'UPDATE',
      groupMembership: null,
    });
    const retry = (service as any).approvalService
      .retryApprovedGenericProposal as jest.Mock;
    retry.mockResolvedValue({ proposal: approvedProposal });

    const result = await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { status: 'APPROVED' },
      approvingUserId,
    );

    expect(retry).toHaveBeenCalledWith({
      proposalId,
      organizationId: testIds.organization,
      projectId: testIds.project,
    });
    expect(result.status).toBe('APPROVED');
  });

  it('should merge partial updates with existing updates rather than replacing', async () => {
    const edges = [
      {
        endpointMode: 'PROPOSAL',
        targetEntityType: 'PROPOSAL',
        targetEntityId: '99999999-9999-4999-8999-999999999999',
        edgeType: 'EVOLVES',
      },
    ];
    const existing = makeStoredProposal({
      edges,
      updates: { name: 'Original name', priority: 'HIGH' },
    });
    const merged = makeStoredProposal({
      edges,
      updates: {
        name: 'Original name',
        priority: 'HIGH',
        parentTaskId: testIds.task,
      },
    });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(merged),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: edges[0]!.targetEntityId, title: 'Target proposal' },
          ]),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: testIds.task }),
      },
    };

    mockTransaction(mockPrisma, txMock);

    const result = await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { updates: { parentTaskId: testIds.task } },
      approvingUserId,
    );
    expect(result.edges).toEqual(edges);
    expect(txMock.proposal.update.mock.calls[0][0].data).not.toHaveProperty(
      'edges',
    );

    expect(txMock.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          updates: {
            name: 'Original name',
            priority: 'HIGH',
            parentTaskId: testIds.task,
          },
        }),
      }),
    );
  });

  it('rejects a merged parentTaskId update before persisting when the parent does not resolve to a materialized work item', async () => {
    const missingParentId = '123e4567-e89b-42d3-a456-426614174099';
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException(
        `Parent work item ${missingParentId} was not found as an existing, non-archived materialized work item.`,
      ),
    );
    const existing = makeStoredProposal({
      action: 'CREATE',
      updates: { name: 'Original name', initiativeId: testIds.initiative },
    });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        {
          updates: {
            parentTaskId: missingParentId,
          },
        },
        approvingUserId,
      ),
    ).rejects.toThrow(/Parent work item/);

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          action: 'CREATE',
          targetEntityType: 'TASK',
          updates: expect.objectContaining({
            name: 'Original name',
            initiativeId: testIds.initiative,
            parentTaskId: missingParentId,
          }),
        }),
      }),
      testIds.organization,
      testIds.project,
      txMock,
      { validatePlanStageTopology: false },
    );
    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects a DRAFT TASK CREATE that remains untyped after merging updates', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException('Proposal contains invalid work-item updates'),
    );
    const existing = makeStoredProposal({
      action: 'CREATE',
      updates: { name: 'Untyped task' },
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        { updates: { priority: 'HIGH' } },
        approvingUserId,
      ),
    ).rejects.toThrow('invalid work-item updates');

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          action: 'CREATE',
          targetEntityType: 'TASK',
          updates: { name: 'Untyped task', priority: 'HIGH' },
        }),
      }),
      testIds.organization,
      testIds.project,
      txMock,
      { validatePlanStageTopology: false },
    );
    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects invalid merged TASK sections before updating the proposal row', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException('Proposal contains invalid work-item updates'),
    );
    const existing = makeStoredProposal({
      action: 'UPDATE',
      updates: { name: 'Original name' },
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        {
          updates: {
            sections: [{ key: 'undeclared', content: 'Invalid' }],
          },
        },
        approvingUserId,
      ),
    ).rejects.toThrow('invalid work-item updates');

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          updates: {
            name: 'Original name',
            sections: [{ key: 'undeclared', content: 'Invalid' }],
          },
        }),
      }),
      testIds.organization,
      testIds.project,
      txMock,
      { validatePlanStageTopology: false },
    );
    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('merges and persists the complete typed HTML/CSS section payload', async () => {
    const existingContent = {
      html: '<button data-hh-id="submit">Submit</button>',
      css: 'button { color: blue; }',
      sizeKey: 'panel',
    };
    const updatedContent = {
      html: '<button data-hh-id="submit">Submit</button>',
      css: 'button { color: rebeccapurple; }',
      sizeKey: 'panel',
    };
    const existing = makeStoredProposal({
      action: 'UPDATE',
      updates: {
        name: 'Button mockup',
        type: 'CUSTOM_HTML_CSS',
        sections: [{ key: 'preview', content: existingContent, order: 0 }],
      },
    });
    const updated = makeStoredProposal({
      ...existing,
      updates: {
        name: 'Button mockup',
        type: 'CUSTOM_HTML_CSS',
        sections: [{ key: 'preview', content: updatedContent, order: 0 }],
      },
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      {
        updates: {
          sections: [{ key: 'preview', content: updatedContent, order: 0 }],
        },
      },
      approvingUserId,
    );

    expect(txMock.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          updates: {
            name: 'Button mockup',
            type: 'CUSTOM_HTML_CSS',
            sections: [{ key: 'preview', content: updatedContent, order: 0 }],
          },
        }),
      }),
    );
    expect(
      (service as any).validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: expect.objectContaining({
          updates: {
            name: 'Button mockup',
            type: 'CUSTOM_HTML_CSS',
            sections: [{ key: 'preview', content: updatedContent, order: 0 }],
          },
        }),
      }),
      testIds.organization,
      testIds.project,
      txMock,
      { validatePlanStageTopology: false },
    );
  });

  it('appends new influences to the existing influences array', async () => {
    const existingOriginInfluence = {
      entityId: testIds.task,
      entityType: 'TASK',
      entityTitle: 'Origin task',
      reasoning: 'host conversation workflow-about',
      reasonType: 'origin',
    };
    const existing = makeStoredProposal({
      influences: [existingOriginInfluence],
      messageId: '123e4567-e89b-42d3-a456-426614174200',
    });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
      entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
      task: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: testIds.designDoc, type: 'customer_request' },
          ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: testIds.user, name: 'Alice' }]),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      {
        influences: [
          {
            entityId: testIds.user,
            entityType: 'USER',
            reasoning: 'user-supplied edit reason',
            reasonType: 'user_reason',
          },
          {
            entityId: testIds.designDoc,
            entityType: 'TASK',
            reasoning: 'task referenced during the edit',
            reasonType: 'explicit_mention',
          },
        ],
      },
      approvingUserId,
    );

    const writtenInfluences = (
      txMock.proposal.update.mock.calls[0]![0] as {
        data: { influences: Array<Record<string, unknown>> };
      }
    ).data.influences;

    expect(writtenInfluences).toHaveLength(3);
    expect(writtenInfluences[0]).toMatchObject({
      entityId: testIds.task,
      reasonType: 'origin',
    });
    expect(writtenInfluences[1]).toMatchObject({
      entityId: testIds.user,
      entityType: 'USER',
      reasonType: 'user_reason',
      entityTitle: 'Alice',
    });
    expect(writtenInfluences[2]).toMatchObject({
      entityId: testIds.designDoc,
      entityType: 'TASK',
      taskType: 'customer_request',
    });
  });

  it('admits the complete merged update candidate with the current requestor stamp', async () => {
    const existingInfluence = {
      entityId: testIds.task,
      entityType: 'TASK',
      entityTitle: 'Origin task',
      reasoning: 'host conversation workflow-about',
      reasonType: 'origin',
    };
    const appendedInfluence = {
      entityId: testIds.user,
      entityType: 'USER' as const,
      reasoning: 'User requested the revision.',
      reasonType: 'user_reason',
    };
    const requestorContext = {
      source: 'agent',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'update_proposal',
      timestamp: '2026-09-14T00:00:00.000Z',
    };
    const existing = makeStoredProposal({
      requestorContext: { source: 'user' },
      influences: [existingInfluence],
    });
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
      entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: testIds.user, name: 'Alice' }]),
      },
    };
    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      {
        updates: { priority: 'HIGH' },
        requestorContext,
        influences: [appendedInfluence],
      },
      approvingUserId,
    );

    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    expect(
      validationEngine.assertAuthoringCandidatesValid,
    ).toHaveBeenCalledWith({
      proposals: [
        expect.objectContaining({
          requestorContext,
          influences: [existingInfluence, appendedInfluence],
          updates: expect.objectContaining({ priority: 'HIGH' }),
        }),
      ],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        db: txMock,
      },
    });
  });

  it('leaves existing influences untouched when the update carries no influences', async () => {
    const existingOriginInfluence = {
      entityId: testIds.task,
      entityType: 'TASK',
      entityTitle: 'Origin task',
      reasoning: 'host conversation workflow-about',
      reasonType: 'origin',
    };
    const existing = makeStoredProposal({
      influences: [existingOriginInfluence],
    });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { generatedWithVersion: 'test' },
      approvingUserId,
    );

    const writeArgs = txMock.proposal.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(writeArgs.data).not.toHaveProperty('influences');
    expect(writeArgs.data).not.toHaveProperty('message');
  });

  it('treats an empty influences array as no-op (append-of-nothing)', async () => {
    const existing = makeStoredProposal({ influences: [] });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { influences: [], generatedWithVersion: 'test' },
      approvingUserId,
    );

    const writeArgs = txMock.proposal.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(writeArgs.data).not.toHaveProperty('influences');
  });

  it('rejects malformed influence entries with BadRequestException', async () => {
    const existing = makeStoredProposal({ influences: [] });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        {
          influences: [
            {
              entityId: testIds.user,
              // entityType intentionally missing
              reasoning: 'broken',
              reasonType: 'user_reason',
            } as unknown as Parameters<
              typeof service.update
            >[3]['influences'] extends (infer U)[] | undefined
              ? U
              : never,
          ],
        },
        approvingUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects unknown reasonType values with BadRequestException', async () => {
    const existing = makeStoredProposal({ influences: [] });

    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        {
          influences: [
            {
              entityId: testIds.user,
              entityType: 'USER',
              reasoning: 'made up',
              reasonType: 'not_a_real_reason',
            },
          ],
        },
        approvingUserId,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(txMock.proposal.update).not.toHaveBeenCalled();
  });

  it('does not persist the influence append when the write throws inside the transaction', async () => {
    const existingOriginInfluence = {
      entityId: testIds.task,
      entityType: 'TASK',
      entityTitle: 'Origin task',
      reasoning: 'host conversation workflow-about',
      reasonType: 'origin',
    };
    const existing = makeStoredProposal({
      influences: [existingOriginInfluence],
    });

    const writeError = new Error('simulated write failure inside tx');
    const txMock = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockRejectedValue(writeError),
      },
      entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: testIds.user, name: 'Alice' }]),
      },
    };

    mockTransaction(mockPrisma, txMock);

    await expect(
      service.update(
        proposalId,
        testIds.organization,
        testIds.project,
        {
          influences: [
            {
              entityId: testIds.user,
              entityType: 'USER',
              reasoning: 'user-supplied edit reason',
              reasonType: 'user_reason',
            },
          ],
        },
        approvingUserId,
      ),
    ).rejects.toThrow(writeError);

    // The append happens *as part of* tx.proposal.update — when the write
    // throws, the transaction rolls back and no influence row is observable
    // beyond the single rejected update call.
    expect(txMock.proposal.update).toHaveBeenCalledTimes(1);
  });
});

describe('ProposalService.create — origin influence stamping', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let validationEngine: ReturnType<typeof createMockValidationEngine>;

  const baseDto = {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Creates a new task for review.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'New task' },
    title: 'New task',
    conversationId: testIds.conversation,
    requestorContext: {
      source: 'agent',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'mcp.create_task',
      timestamp: '2026-03-18T00:00:00.000Z',
    },
  } as const;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).task.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).task.findUnique.mockResolvedValue({
      lastAppliedProposalId: null,
    });
    (mockPrisma.db as any).proposal = {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    (mockPrisma.db as any).project.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.project });
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([
      { userId: approvingUserId },
      { userId: 'other-project-member-id' },
    ]);
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);
    validationEngine = createMockValidationEngine();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalService,
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        ProjectApprovalPolicyService,
        {
          provide: WorkItemTypeRegistryService,
          useValue: createMockWorkItemTypeRegistry(),
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: validationEngine,
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        {
          provide: ProposalApprovalService,
          useValue: {
            approve: jest.fn(),
            applyInTransaction: jest.fn(),
            genericChangeSetRequest: jest.fn().mockReturnValue(null),
            projectGenericPreparation: jest.fn(),
            assertPreparedChangeSetCurrent: jest.fn(
              (_id, _request, prepared) => prepared,
            ),
            materializeGenericWorkItemChangeSet: jest.fn(),
          },
        },
        {
          provide: PendingEdgeService,
          useValue: {
            materializeEdges: jest.fn(),
            rollbackMaterializedEdges: jest.fn(),
            processDeclaredEdges: jest.fn().mockResolvedValue([]),
            cleanupForProposal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
  });

  function captureCreateInfluences(): unknown {
    const call = (mockPrisma.db as any).proposal.create.mock.calls[0]?.[0];
    return call?.data?.influences;
  }

  it('persists proposal-owned ELI5 and returns the stored snapshot without changing provenance', async () => {
    const eli5 = 'Makes the task easier to review.';
    const stored = makeStoredProposal({
      title: 'New task',
      eli5,
      requestorContext: baseDto.requestorContext,
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(stored);

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...baseDto, conversationId: undefined, eli5 } as never,
    );

    expect((mockPrisma.db as any).proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eli5,
          requestorContext: baseDto.requestorContext,
        }),
      }),
    );
    expect(result.eli5).toBe(eli5);
    expect(result.requestorContext).toEqual(baseDto.requestorContext);
  });

  it('rolls back all proposal side effects when admission returns multiple issues', async () => {
    const errors = [
      {
        field: 'proposals[0].updates.name',
        code: 'required',
        reason: 'name is required',
        layer: 'structural',
      },
      {
        field: 'proposals[0].updates.parentTaskId',
        code: 'entity_not_found',
        reason: 'parent was not found',
        layer: 'referential',
        suggestion: 'Choose an existing parent.',
        metadata: { parentId: testIds.task },
      },
    ];
    validationEngine.assertAuthoringCandidatesValid.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Proposal authoring validation failed',
        errors,
      }),
    );

    await expect(
      service.create(
        testIds.organization,
        testIds.project,
        testIds.user,
        baseDto,
      ),
    ).rejects.toMatchObject({ response: { errors } });

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
    expect((mockPrisma.db as any).message.create).not.toHaveBeenCalled();
    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).not.toHaveBeenCalled();
  });

  it('rejects a VERSIONED_UPDATE field error before persisting a proposal or carrier message', async () => {
    const errors = [
      {
        field: 'proposals[0].updates',
        code: 'invalid_future_revision',
        reason: 'Future revisions cannot change status.',
        layer: 'referential',
      },
    ];
    validationEngine.assertAuthoringCandidatesValid.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Proposal authoring validation failed',
        errors,
      }),
    );
    const versionedUpdate = {
      ...baseDto,
      action: 'VERSIONED_UPDATE',
      conversationId: undefined,
      updates: {
        operation: 'REVISE',
        futureId: '20000000-0000-4000-8000-000000000010',
        expectedRevision: 0,
        baseline: {
          kind: 'LIVE',
          revision: 'live-revision-1',
          content: {
            id: testIds.task,
            organizationId: testIds.organization,
            projectId: testIds.project,
            name: 'Current task',
            type: 'FEATURE',
            status: 'BACKLOG',
            source: 'user',
            sections: [],
          },
        },
        result: {
          id: testIds.task,
          organizationId: testIds.organization,
          projectId: testIds.project,
          name: 'Future task',
          type: 'FEATURE',
          status: 'ACTIVE',
          source: 'user',
          sections: [],
        },
        dependencies: [],
      },
    };

    await expect(
      service.create(
        testIds.organization,
        testIds.project,
        approvingUserId,
        versionedUpdate as never,
      ),
    ).rejects.toMatchObject({
      response: {
        errors: [
          expect.objectContaining({
            reason: expect.stringContaining('status'),
          }),
        ],
      },
    });

    expect(
      validationEngine.assertAuthoringCandidatesValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: [
          expect.objectContaining({
            action: 'VERSIONED_UPDATE',
            targetEntityType: 'TASK',
            updates: expect.objectContaining({
              result: expect.objectContaining({ status: 'ACTIVE' }),
            }),
          }),
        ],
      }),
    );
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
    expect((mockPrisma.db as any).message.create).not.toHaveBeenCalled();
  });

  it('captures the task marker once when authoring an UPDATE proposal', async () => {
    (mockPrisma.db as any).task.findMany.mockResolvedValue([
      {
        id: testIds.task,
        projectId: testIds.project,
      },
    ]);
    (mockPrisma.db as any).task.findFirst.mockResolvedValue({
      id: testIds.task,
    });
    (mockPrisma.db as any).task.findUnique.mockResolvedValue({
      lastAppliedProposalId: 'last-applied-proposal-id',
    });
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);
    (mockPrisma.db as any).proposal.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeStoredProposal(data)),
    );

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        action: 'UPDATE',
        conversationId: undefined,
        updates: { name: 'Updated task' },
      },
    );

    expect((mockPrisma.db as any).proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetLastAppliedProposalId: 'last-applied-proposal-id',
        }),
      }),
    );
  });

  it('rejects a CONDITIONAL workflow link without a predicate before persistence', async () => {
    const malformedDto = JSON.parse(
      JSON.stringify({
        ...baseDto,
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowLinks: [
            {
              sourceStepTempId: 'decision',
              targetStepTempId: 'done',
              type: 'CONDITIONAL',
              direction: 'forward',
            },
          ],
        },
      }),
    );

    await expect(
      service.create(
        testIds.organization,
        testIds.project,
        approvingUserId,
        malformedDto,
      ),
    ).rejects.toThrow('Workflow proposal links violate the OpenAPI contract');

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('persists a workflow LOOP link with a portable predicate', async () => {
    const updates = {
      name: 'Retry workflow',
      initiativeId: testIds.initiative,
      type: 'workflow',
      workflowSteps: [{ tempId: 'retry', name: 'Retry' }],
      workflowLinks: [
        {
          sourceStepTempId: 'retry',
          type: 'LOOP',
          predicate: 'retryCount < 3',
        },
      ],
    };
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal({ updates }),
    );

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        conversationId: undefined,
        updates,
      } as never,
    );

    expect((mockPrisma.db as any).proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updates }),
      }),
    );
  });

  it('rejects a malformed generic CONDITIONAL operation before persistence', async () => {
    const targetId = '20000000-0000-4000-8000-000000000001';
    const malformedDto = {
      ...baseDto,
      action: 'UPDATE' as const,
      targetEntityId: targetId,
      updates: {
        root: { refType: 'existing', id: targetId },
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'branch' },
            source: {
              refType: 'existing',
              id: '20000000-0000-4000-8000-000000000002',
            },
            target: {
              refType: 'existing',
              id: '20000000-0000-4000-8000-000000000003',
            },
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: 'forward',
          },
        ],
      },
    };

    await expect(
      service.create(
        testIds.organization,
        testIds.project,
        approvingUserId,
        malformedDto as never,
      ),
    ).rejects.toThrow('Proposal graph operations violate the OpenAPI contract');

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed graph-shaped CREATE before reserving or persisting anything', async () => {
    const malformedDto = {
      ...baseDto,
      action: 'CREATE' as const,
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      title: 'New Diagram',
      updates: {
        root: { refType: 'temporary', tempId: 'diagram-root' },
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'branch' },
            source: { refType: 'temporary', tempId: 'first' },
            target: { refType: 'temporary', tempId: 'second' },
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: 'forward',
          },
        ],
      },
    };

    await expect(
      service.create(
        testIds.organization,
        testIds.project,
        approvingUserId,
        malformedDto as never,
      ),
    ).rejects.toThrow('Proposal graph operations violate the OpenAPI contract');
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid compound TRACKS attachment before creating a proposal row', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertAuthoringCandidatesValid.mockRejectedValue(
      new BadRequestException(
        'Work-item type STANDARD is not configured as a tracking source.',
      ),
    );

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        conversationId: undefined,
        updates: { name: 'Tracked task', type: 'STANDARD' },
        tracks: { sourceEntityId: testIds.task },
      }),
    ).rejects.toThrow('not configured as a tracking source');

    expect(validationEngine.assertAuthoringCandidatesValid).toHaveBeenCalled();
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('rejects invalid TASK sections before creating a proposal row', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException('Proposal contains invalid work-item updates'),
    );

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        conversationId: undefined,
        updates: {
          name: 'Invalid task',
          sections: [{ key: 'undeclared', content: 'Invalid' }],
        },
      }),
    ).rejects.toThrow('invalid work-item updates');

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalled();
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('rejects an untyped TASK CREATE before creating a proposal row', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException('Proposal contains invalid work-item updates'),
    );

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        conversationId: undefined,
        updates: { name: 'Untyped task' },
      }),
    ).rejects.toThrow('invalid work-item updates');

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalled();
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('rejects a proposal ID used as parentTaskId before creating a proposal row', async () => {
    const draftProposalId = '123e4567-e89b-42d3-a456-426614174099';
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    validationEngine.assertTaskMutationAuthoringValid.mockRejectedValue(
      new BadRequestException(
        `Parent work item ${draftProposalId} was not found as an existing, non-archived materialized work item. Use an already-created parent work-item ID; draft proposal IDs are only valid in structured edge declarations, not parentTaskId.`,
      ),
    );
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        conversationId: undefined,
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          parentTaskId: draftProposalId,
        },
      }),
    ).rejects.toThrow(/draft proposal IDs are only valid/);

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalled();
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('preserves a valid existing parentTaskId when proposal validation passes', async () => {
    const validationEngine = (service as any).validationEngine as ReturnType<
      typeof createMockValidationEngine
    >;
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal({
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          parentTaskId: testIds.task,
        },
      }),
    );

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        conversationId: undefined,
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          parentTaskId: testIds.task,
        },
      },
    );

    expect(
      validationEngine.assertTaskMutationAuthoringValid,
    ).toHaveBeenCalled();
    expect((mockPrisma.db as any).proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          updates: expect.objectContaining({ parentTaskId: testIds.task }),
        }),
      }),
    );
  });

  it('stamps an origin influence pointing at the conversation workflow-about entity', async () => {
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue({
        workflowAboutId: testIds.task,
        workflowAboutType: 'task',
      });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal(),
    );

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...baseDto },
    );

    const influences = captureCreateInfluences() as Array<
      Record<string, unknown>
    >;
    expect(influences).toHaveLength(1);
    expect(influences[0]).toMatchObject({
      entityId: testIds.task,
      entityType: 'TASK',
      reasonType: 'origin',
    });
  });

  it('stamps no origin when the conversation has no workflowAboutId', async () => {
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue({
        workflowAboutId: null,
        workflowAboutType: 'task',
      });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal(),
    );

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...baseDto },
    );

    const influences = captureCreateInfluences();
    expect(influences).toEqual([]);
  });

  it('drops agent-supplied origin entries and replaces with the server-stamped one', async () => {
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue({
        workflowAboutId: testIds.task,
        workflowAboutType: 'task',
      });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal(),
    );

    const forgedOrigin = {
      entityId: testIds.initiative,
      entityType: 'INITIATIVE' as const,
      reasoning: 'forged by agent',
      reasonType: 'origin',
    };
    const legitInfluence = {
      entityId: testIds.designDoc,
      entityType: 'DESIGN_DOC' as const,
      reasoning: 'reviewed during planning',
      reasonType: 'explicit_mention',
    };

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...baseDto, influences: [forgedOrigin, legitInfluence] },
    );

    const influences = captureCreateInfluences() as Array<
      Record<string, unknown>
    >;
    expect(influences).toHaveLength(2);
    const originEntries = influences.filter((i) => i.reasonType === 'origin');
    expect(originEntries).toHaveLength(1);
    expect(originEntries[0]).toMatchObject({
      entityId: testIds.task,
      entityType: 'TASK',
      reasonType: 'origin',
    });
    expect(influences).toEqual(
      expect.arrayContaining([expect.objectContaining(legitInfluence)]),
    );
  });

  it('passes through existing explicit_mention/implied/derived influences unchanged', async () => {
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);
    (mockPrisma.db as any).proposal.create.mockResolvedValue(
      makeStoredProposal(),
    );

    const incoming = [
      {
        entityId: testIds.designDoc,
        entityType: 'DESIGN_DOC' as const,
        reasoning: 'mentioned',
        reasonType: 'explicit_mention',
      },
      {
        entityId: testIds.initiative,
        entityType: 'INITIATIVE' as const,
        reasoning: 'inferred',
        reasonType: 'derived',
      },
    ];

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...baseDto, conversationId: undefined, influences: incoming },
    );

    expect(captureCreateInfluences()).toEqual(
      incoming.map((i) => ({ ...i, entityTitle: null })),
    );
  });
});

describe('ProposalService.create — apply-on-create', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let projectApprovalPolicyService: { resolve: jest.Mock };
  let validationEngine: ReturnType<typeof createMockValidationEngine>;
  let approvalService: {
    approve: jest.Mock;
    applyInTransaction: jest.Mock;
    genericChangeSetRequest: jest.Mock;
    projectGenericPreparation: jest.Mock;
    assertPreparedChangeSetCurrent: jest.Mock;
    queueGenericWorkItemChangeSetInTransaction: jest.Mock;
    materializeGenericWorkItemChangeSet: jest.Mock;
  };

  const updateBaseDto = {
    type: 'SINGLE',
    action: 'UPDATE',
    eli5: 'Updates the task for review.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'Updated name' },
  } as const;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).task.findMany.mockResolvedValue([
      {
        id: testIds.task,
        type: 'STANDARD',
        projectId: testIds.project,
      },
    ]);
    (mockPrisma.db as any).task.findUnique.mockResolvedValue({
      lastAppliedProposalId: null,
    });
    (mockPrisma.db as any).proposal = {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    (mockPrisma.db as any).proposalApprovalRecord = {
      create: jest.fn().mockResolvedValue({
        id: 'proposal-approval-id',
        proposalId,
        userId: approvingUserId,
        type: 'APPROVAL',
        reason: null,
        createdAt: new Date('2026-03-18T00:00:00Z'),
      }),
    };
    (mockPrisma.db as any).project.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.project });
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([
      { userId: approvingUserId },
      { userId: 'other-project-member-id' },
    ]);
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);

    approvalService = {
      approve: jest.fn(),
      applyInTransaction: jest.fn(),
      genericChangeSetRequest: jest.fn().mockReturnValue(null),
      projectGenericPreparation: jest.fn(),
      assertPreparedChangeSetCurrent: jest.fn(
        (_id, _request, prepared) => prepared,
      ),
      queueGenericWorkItemChangeSetInTransaction: jest
        .fn()
        .mockImplementation(async (_tx, proposal) => ({ proposal })),
      materializeGenericWorkItemChangeSet: jest.fn(),
    };
    validationEngine = createMockValidationEngine();
    projectApprovalPolicyService = {
      resolve: jest
        .fn()
        .mockResolvedValue(createDefaultProjectApprovalPolicy()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalService,
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        {
          provide: WorkItemTypeRegistryService,
          useValue: createMockWorkItemTypeRegistry(),
        },
        {
          provide: ProjectApprovalPolicyService,
          useValue: projectApprovalPolicyService,
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: validationEngine,
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        { provide: ProposalApprovalService, useValue: approvalService },
        {
          provide: PendingEdgeService,
          useValue: {
            materializeEdges: jest.fn(),
            rollbackMaterializedEdges: jest.fn(),
            processDeclaredEdges: jest.fn().mockResolvedValue([]),
            cleanupForProposal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
  });

  function makeUserRequestorContext(): RequestorContext {
    return {
      source: 'user',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'POST /proposals',
      timestamp: '2026-04-29T00:00:00.000Z',
    };
  }

  function makeAgentRequestorContext(): RequestorContext {
    return {
      source: 'agent',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'mcp.edit_task',
      timestamp: '2026-04-29T00:00:00.000Z',
    };
  }

  function workflowGraphChangeSet() {
    return {
      root: { refType: 'existing' as const, id: testIds.task },
      operations: [
        {
          op: 'relationship.create' as const,
          ref: { refType: 'temporary' as const, tempId: 'new-link' },
          source: { refType: 'existing' as const, id: testIds.task },
          target: { refType: 'existing' as const, id: testIds.designDoc },
          edgeType: 'STANDARD',
          category: 'flow',
          direction: 'forward',
        },
        {
          op: 'layout.replace' as const,
          root: { refType: 'existing' as const, id: testIds.task },
          sectionKey: 'graphLayout',
          entries: [
            {
              node: { refType: 'existing' as const, id: testIds.task },
              position: { x: 0, y: 0 },
            },
            {
              node: { refType: 'existing' as const, id: testIds.designDoc },
              position: { x: 200, y: 0 },
            },
          ],
        },
      ],
    };
  }

  it('materializes an auto-approved workflow graph change set only after the create transaction commits', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 0,
      allowsProposerApproval: false,
    });
    const updates = workflowGraphChangeSet();
    const draftProposal = makeStoredProposal({
      type: 'BATCH',
      action: 'UPDATE',
      status: 'DRAFT',
      updates,
      requestorContext: makeUserRequestorContext(),
    });
    const approvedProposal = {
      ...draftProposal,
      status: 'APPROVED',
    };
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'workflow',
      parentTaskId: null,
    });
    approvalService.genericChangeSetRequest.mockReturnValue(updates);
    const prepared = { validationRevision: 'revision', operationSet: updates };
    let transactionStarted = false;
    const projectedBeforeTransaction: boolean[] = [];
    approvalService.projectGenericPreparation.mockImplementation(async () => {
      projectedBeforeTransaction.push(!transactionStarted);
      return prepared;
    });
    approvalService.materializeGenericWorkItemChangeSet.mockResolvedValue({
      proposal: approvedProposal,
      rootWorkItemId: testIds.task,
    });

    let transactionCommitted = false;
    (mockPrisma.db as any).$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        transactionStarted = true;
        const result = await callback(mockPrisma.db);
        transactionCommitted = true;
        return result;
      },
    );
    approvalService.materializeGenericWorkItemChangeSet.mockImplementation(
      async () => {
        expect(transactionCommitted).toBe(true);
        return {
          proposal: approvedProposal,
          rootWorkItemId: testIds.task,
        };
      },
    );

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...updateBaseDto,
        type: 'BATCH',
        updates,
        requestorContext: makeUserRequestorContext(),
      } as never,
    );

    expect(projectedBeforeTransaction).toEqual([true]);
    expect(
      approvalService.queueGenericWorkItemChangeSetInTransaction,
    ).toHaveBeenCalledWith(
      mockPrisma.db,
      draftProposal,
      testIds.organization,
      testIds.project,
      prepared,
    );
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
    expect(
      approvalService.materializeGenericWorkItemChangeSet,
    ).toHaveBeenCalledWith({
      proposalId,
      organizationId: testIds.organization,
      projectId: testIds.project,
    });
    expect(result.status).toBe('APPROVED');
  });

  it('derives the same changed fields from raw and prepared FEATURE requirement authoring', async () => {
    const raw = {
      targetEntityType: 'TASK',
      action: 'CREATE',
      targetEntityId: 'new',
      updates: {
        name: 'Billing',
        type: 'FEATURE',
        initialRequirements: [{ statement: 'Invoices are emailed' }],
      },
    };
    const prepared = {
      ...raw,
      updates: {
        name: 'Billing',
        type: 'FEATURE',
        sections: [{ key: 'requirements', content: { records: [] } }],
      },
    };
    expect(await deriveChangedFields({} as never, raw)).toEqual(
      await deriveChangedFields({} as never, prepared),
    );
    expect(
      await deriveChangedFields({} as never, {
        ...raw,
        action: 'UPDATE',
        updates: { requirementOps: [{ op: 'add', statement: 'x' }] },
      }),
    ).toEqual(['sections.requirements']);
  });

  it('projects a FEATURE create with initialRequirements once before the transaction and replays its minted requirement IDs', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: true,
    });
    type TaskPayload = Record<string, unknown>;
    type ProposalPayload = { updates: TaskPayload };
    const prepareTaskMutationRequirements = jest.fn(
      (
        dto: ProposalPayload,
        _org: string,
        _project: string,
        _db: unknown,
        mint: () => string,
      ): Promise<ProposalPayload> => {
        const { initialRequirements: _initial, ...rest } = dto.updates;
        void _initial;
        return Promise.resolve({
          ...dto,
          updates: {
            ...rest,
            sections: [
              { key: 'requirements', content: { records: [{ id: mint() }] } },
            ],
          },
        });
      },
    );
    Object.assign(validationEngine, { prepareTaskMutationRequirements });
    const storedUpdates: TaskPayload[] = [];
    const proposalCreate = jest.fn(
      ({ data }: { data: { updates: TaskPayload } }) => {
        storedUpdates.push(data.updates);
        return Promise.resolve(
          makeStoredProposal({
            action: 'CREATE',
            status: 'DRAFT',
            updates: data.updates,
            requestorContext: makeUserRequestorContext(),
          }),
        );
      },
    );
    Object.assign(mockPrisma.db, {
      proposal: { create: proposalCreate, findFirst: jest.fn() },
    });
    approvalService.genericChangeSetRequest.mockImplementation(
      (proposal: ProposalPayload) => ({
        root: 'root',
        operations: [proposal.updates],
      }),
    );
    let transactionStarted = false;
    const projected: Array<{
      beforeTransaction: boolean;
      request: { operations: TaskPayload[] };
    }> = [];
    approvalService.projectGenericPreparation.mockImplementation(
      (
        _org: string,
        _project: string,
        request: { operations: TaskPayload[] },
      ) => {
        projected.push({ beforeTransaction: !transactionStarted, request });
        return Promise.resolve({
          validationRevision: 'revision',
          operationSet: request,
        });
      },
    );
    approvalService.materializeGenericWorkItemChangeSet.mockImplementation(
      ({ proposalId: id }: { proposalId: string }) =>
        Promise.resolve({
          proposal: makeStoredProposal({ id, status: 'APPROVED' }),
          rootWorkItemId: testIds.task,
        }),
    );
    (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => {
        transactionStarted = true;
        return callback(mockPrisma.db);
      },
    );

    const dto = {
      type: 'SINGLE',
      action: 'CREATE',
      eli5: 'Creates the billing feature.',
      title: 'Billing',
      targetEntityId: '00000000-0000-4000-8000-000000000000',
      targetEntityType: 'TASK',
      updates: {
        name: 'Billing',
        type: 'FEATURE',
        initialRequirements: [{ statement: 'Invoices are emailed' }],
      },
      requestorContext: makeUserRequestorContext(),
    };

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      dto as never,
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]!.beforeTransaction).toBe(true);
    expect(projected[0]!.request.operations[0]).toEqual(storedUpdates[0]);
    expect(prepareTaskMutationRequirements).toHaveBeenCalledTimes(2);
    expect(
      approvalService.queueGenericWorkItemChangeSetInTransaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('never projects a create whose proposer approval stays below the threshold', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 2,
      allowsProposerApproval: true,
    });
    (mockPrisma.db.proposal.create as jest.Mock).mockResolvedValue(
      makeStoredProposal({
        action: 'UPDATE',
        status: 'DRAFT',
        requestorContext: makeUserRequestorContext(),
      }),
    );
    Object.assign(mockPrisma.db.task, {
      findFirst: jest.fn().mockResolvedValue({
        type: 'STANDARD',
        parentTaskId: testIds.task,
      }),
    });
    approvalService.genericChangeSetRequest.mockReturnValue({
      root: 'root',
      operations: [],
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...updateBaseDto,
        requestorContext: makeUserRequestorContext(),
      } as never,
    );

    expect(approvalService.projectGenericPreparation).not.toHaveBeenCalled();
    expect(
      approvalService.queueGenericWorkItemChangeSetInTransaction,
    ).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe('DRAFT');
  });

  it('prepares below-threshold FEATURE requirements only inside the create transaction', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 2,
      allowsProposerApproval: true,
    });
    let transactionStarted = false;
    const preparationCalls: boolean[] = [];
    const section = { key: 'requirements', content: { records: [] } };
    Object.assign(validationEngine, {
      prepareTaskMutationRequirements: jest.fn(
        (dto: { updates: Record<string, unknown> }) => {
          preparationCalls.push(transactionStarted);
          const { initialRequirements: _initial, ...rest } = dto.updates;
          void _initial;
          return Promise.resolve({
            ...dto,
            updates: { ...rest, sections: [section] },
          });
        },
      ),
    });
    (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => {
        transactionStarted = true;
        return callback(mockPrisma.db);
      },
    );
    (mockPrisma.db.proposal.create as jest.Mock).mockImplementation(
      ({ data }: { data: { updates: unknown } }) =>
        Promise.resolve(
          makeStoredProposal({
            action: 'CREATE',
            status: 'DRAFT',
            updates: data.updates,
            requestorContext: makeUserRequestorContext(),
          }),
        ),
    );
    const dto = {
      type: 'SINGLE',
      action: 'CREATE',
      title: 'Billing',
      eli5: 'Creates billing.',
      targetEntityType: 'TASK',
      targetEntityId: testIds.task,
      updates: {
        name: 'Billing',
        type: 'FEATURE',
        tag: 'product',
        initialRequirements: [],
      },
      requestorContext: makeUserRequestorContext(),
    };
    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      dto as never,
    );
    expect(preparationCalls).toEqual([true]);
    expect(approvalService.projectGenericPreparation).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe('DRAFT');
    expect(result.updates).toEqual({
      name: 'Billing',
      type: 'FEATURE',
      tag: 'product',
      sections: [section],
    });
  });

  describe('early apply-on-create failures', () => {
    const preparerCalls: boolean[] = [];
    let transactionStarted: boolean;

    const failPreparation = (error: (inTransaction: boolean) => Error) => {
      Object.assign(validationEngine, {
        prepareTaskMutationRequirements: jest.fn(() => {
          preparerCalls.push(transactionStarted);
          return Promise.reject(error(transactionStarted));
        }),
      });
    };

    const createEligibleUpdate = () =>
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...updateBaseDto,
        requestorContext: makeUserRequestorContext(),
      } as never);

    beforeEach(() => {
      preparerCalls.length = 0;
      transactionStarted = false;
      jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
        requiresProposal: true,
        threshold: 1,
        allowsProposerApproval: true,
      });
      Object.assign(mockPrisma.db.task, {
        findFirst: jest.fn().mockResolvedValue({
          type: 'STANDARD',
          parentTaskId: testIds.task,
        }),
      });
      (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
        (callback: (tx: unknown) => Promise<unknown>) => {
          transactionStarted = true;
          return callback(mockPrisma.db);
        },
      );
    });

    it('defers an invalid-input rejection so the transaction raises it unchanged', async () => {
      const rejection = new BadRequestException(
        'initialRequirements cannot be prepared',
      );
      failPreparation(() => rejection);

      const result = createEligibleUpdate();

      await expect(result).rejects.toBe(rejection);
      expect(preparerCalls).toEqual([false, true]);
      expect(approvalService.projectGenericPreparation).not.toHaveBeenCalled();
    });

    it('fails with the retry conflict when the transaction needs more requirement IDs than were minted', async () => {
      Object.assign(validationEngine, {
        prepareTaskMutationRequirements: jest.fn(
          (
            dto: { updates: Record<string, unknown> },
            _org: string,
            _project: string,
            _db: unknown,
            mint: () => string,
          ) => {
            const records = (transactionStarted ? [1, 2] : [1]).map(() => ({
              id: mint(),
            }));
            return Promise.resolve({
              ...dto,
              updates: {
                ...dto.updates,
                sections: [{ key: 'requirements', content: { records } }],
              },
            });
          },
        ),
      });
      approvalService.genericChangeSetRequest.mockReturnValue({
        root: 'root',
        operations: [],
      });
      approvalService.projectGenericPreparation.mockResolvedValue({
        validationRevision: 'revision',
      });

      const result = createEligibleUpdate();

      await expect(result).rejects.toThrow(
        new ConflictException(
          'Proposal requirements changed while it was being created; retry the request.',
        ),
      );
      expect(approvalService.projectGenericPreparation).toHaveBeenCalledTimes(
        1,
      );
      expect(mockPrisma.db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('surfaces a projection rejection as-is without opening the transaction', async () => {
      const rejection = new BadRequestException('Change set is invalid');
      approvalService.genericChangeSetRequest.mockReturnValue({
        root: 'root',
        operations: [],
      });
      approvalService.projectGenericPreparation.mockRejectedValue(rejection);

      const result = createEligibleUpdate();

      await expect(result).rejects.toBe(rejection);
      expect(mockPrisma.db.$transaction).not.toHaveBeenCalled();
    });

    it('propagates an infrastructure failure from the early step as-is', async () => {
      const failure = new Error('Connection terminated unexpectedly');
      failPreparation(() => failure);

      const result = createEligibleUpdate();

      await expect(result).rejects.toBe(failure);
      expect(preparerCalls).toEqual([false]);
      expect(mockPrisma.db.$transaction).not.toHaveBeenCalled();
      expect(approvalService.projectGenericPreparation).not.toHaveBeenCalled();
    });
  });

  it('applies a user-source non-top-level UPDATE proposal in the same transaction', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
    expect(approvalService.applyInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: draftProposal.id }),
      testIds.organization,
      testIds.project,
      { onImmediateEdgeCreated: expect.any(Function) },
    );
    expect(result.status).toBe('APPROVED');
    expect(result.approvals).toEqual([
      expect.objectContaining({
        userId: approvingUserId,
        type: 'APPROVAL',
      }),
    ]);
  });

  it('enacts a user-authored GOAL update with the live single-member rule', async () => {
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([
      { userId: approvingUserId },
    ]);
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(result.status).toBe('APPROVED');
    expect(result.approvals).toHaveLength(1);
    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
  });

  it('enacts a user-authored GOAL status update in a multi-member project', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      updates: { status: 'COMPLETED' },
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...updateBaseDto,
        updates: { status: 'COMPLETED' },
        requestorContext: makeUserRequestorContext(),
      },
    );

    expect(result.status).toBe('APPROVED');
    expect(result.approvals).toHaveLength(1);
    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves an agent-authored GOAL update pending in a single-member project', async () => {
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([
      { userId: approvingUserId },
    ]);
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeAgentRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeAgentRequestorContext() },
    );

    expect(result.status).toBe('DRAFT');
    expect(result.approvals).toEqual([]);
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('resolves one project policy and reuses it for creation evaluation and response mapping', async () => {
    const projectPolicy = createDefaultProjectApprovalPolicy(3);
    projectApprovalPolicyService.resolve.mockResolvedValue(projectPolicy);
    const evaluateSpy = jest.spyOn(permissionEvaluation, 'evaluatePermissions');
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeAgentRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeAgentRequestorContext() },
    );

    expect(projectApprovalPolicyService.resolve).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      projectPolicy,
    );
    expect(result.status).toBe('DRAFT');
    expect(result.requiredApprovals).toBe(3);
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('keeps the onboarding feature rule fixed at one when project policy is higher', async () => {
    projectApprovalPolicyService.resolve.mockResolvedValue(
      createDefaultProjectApprovalPolicy(3),
    );
    const requestorContext = {
      ...makeAgentRequestorContext(),
      toolName: 'shared-generate-features',
    };
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      updates: { name: 'Generated feature' },
      requestorContext,
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'FEATURE',
      parentTaskId: null,
      initiativeId: null,
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...updateBaseDto,
        updates: { name: 'Generated feature' },
        requestorContext,
      },
    );

    expect(projectApprovalPolicyService.resolve).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('DRAFT');
    expect(result.requiredApprovals).toBe(1);
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('enacts a user-authored GOAL content update in a multi-member project', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(result.status).toBe('APPROVED');
    expect(result.approvals).toHaveLength(1);
    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
  });

  it('fails proposal creation when no eligible membership context exists', async () => {
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([]);
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'GOAL',
      parentTaskId: null,
      initiativeId: null,
    });

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...updateBaseDto,
        requestorContext: makeUserRequestorContext(),
      }),
    ).rejects.toThrow(
      'Permission evaluation requires at least one active project member',
    );

    expect(
      (mockPrisma.db as any).proposalApprovalRecord.create,
    ).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('counts an eligible user author once and leaves the proposal DRAFT below threshold', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 3,
      allowsProposerApproval: true,
    });
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(result.status).toBe('DRAFT');
    expect(result.approvals).toEqual([
      expect.objectContaining({
        userId: approvingUserId,
        type: 'APPROVAL',
      }),
    ]);
    expect(
      (mockPrisma.db as any).proposalApprovalRecord.create,
    ).toHaveBeenCalledTimes(1);
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('does not count a user author when proposer approval is prohibited', async () => {
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: false,
    });
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(result.status).toBe('DRAFT');
    expect(result.approvals).toEqual([]);
    expect(
      (mockPrisma.db as any).proposalApprovalRecord.create,
    ).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('leaves an agent-source non-top-level UPDATE proposal as DRAFT (does not auto-apply)', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeAgentRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeAgentRequestorContext() },
    );

    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
    expect(
      (mockPrisma.db as any).proposalApprovalRecord.create,
    ).not.toHaveBeenCalled();
    expect(result.status).toBe('DRAFT');
  });

  it('auto-applies a user-source top-level FEATURE UPDATE proposal when content fields change (single approver can sign off their own edit)', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'FEATURE',
      parentTaskId: null,
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('APPROVED');
  });

  it('auto-applies a user-source top-level FEATURE UPDATE proposal when only non-content fields change', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      updates: { status: 'IN_PROGRESS', priority: 'HIGH' },
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'FEATURE',
      parentTaskId: null,
    });
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit: jest.fn(),
    });

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...updateBaseDto,
        updates: { status: 'IN_PROGRESS', priority: 'HIGH' } as never,
        requestorContext: makeUserRequestorContext(),
      },
    );

    expect(approvalService.applyInTransaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('APPROVED');
  });

  it('rejects a proposal whose requestorContext has no source', async () => {
    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...updateBaseDto,
        requestorContext: {
          userId: testIds.user,
          organizationId: testIds.organization,
          toolName: 'foo',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      } as any),
    ).rejects.toThrow(BadRequestException);

    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a proposal whose requestorContext.source is an unknown value', async () => {
    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...updateBaseDto,
        requestorContext: { source: 'system' },
      } as any),
    ).rejects.toThrow(BadRequestException);

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
  });

  it('finalizes pending edges via PendingEdgeService after the apply-on-create transaction commits', async () => {
    const pendingEdgeService = (
      service as unknown as {
        pendingEdgeService: { materializeEdges: jest.Mock };
      }
    ).pendingEdgeService;

    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
      conversationId: testIds.conversation,
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });

    const edge = {
      sourceEntityId: testIds.task,
      targetEntityId: testIds.designDoc,
      edgeType: 'RELATED_TO',
    };
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [edge],
      runPostCommit: jest.fn(),
    });

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(pendingEdgeService.materializeEdges).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      [edge],
      testIds.conversation,
    );
  });

  it('invokes runPostCommit exactly once after the apply-on-create transaction commits', async () => {
    const draftProposal = makeStoredProposal({
      action: 'UPDATE',
      status: 'DRAFT',
      requestorContext: makeUserRequestorContext(),
    });
    (mockPrisma.db as any).proposal.create.mockResolvedValue(draftProposal);
    (mockPrisma.db as any).task.findFirst = jest.fn().mockResolvedValue({
      type: 'TASK',
      parentTaskId: 'parent-task-id',
    });

    const runPostCommit = jest.fn();
    approvalService.applyInTransaction.mockResolvedValue({
      proposal: { ...draftProposal, status: 'APPROVED' },
      resultingEntityId: testIds.task,
      materializableEdges: [],
      runPostCommit,
    });

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      { ...updateBaseDto, requestorContext: makeUserRequestorContext() },
    );

    expect(runPostCommit).toHaveBeenCalledTimes(1);
  });
});

describe('ProposalService.create — entity title snapshotting', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  const baseDto = {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Creates a new task for review.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'New task' },
    title: 'New task',
    conversationId: testIds.conversation,
    requestorContext: {
      source: 'agent',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'mcp.create_task',
      timestamp: '2026-03-18T00:00:00.000Z',
    },
  } as const;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).task.findMany.mockResolvedValue([
      {
        id: testIds.task,
        type: 'STANDARD',
        projectId: testIds.project,
      },
    ]);
    (mockPrisma.db as any).task.findUnique.mockResolvedValue({
      lastAppliedProposalId: null,
    });
    (mockPrisma.db as any).proposal = {
      create: jest.fn().mockResolvedValue(makeStoredProposal()),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    (mockPrisma.db as any).designDoc.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).project.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.project });
    (mockPrisma.db as any).projectMember.findMany.mockResolvedValue([
      { userId: approvingUserId },
      { userId: 'other-project-member-id' },
    ]);
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue({
        workflowAboutId: testIds.task,
        workflowAboutType: 'task',
      });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalService,
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        ProjectApprovalPolicyService,
        {
          provide: WorkItemTypeRegistryService,
          useValue: createMockWorkItemTypeRegistry(),
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: createMockValidationEngine(),
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        {
          provide: ProposalApprovalService,
          useValue: {
            approve: jest.fn(),
            applyInTransaction: jest.fn(),
            genericChangeSetRequest: jest.fn().mockReturnValue(null),
            projectGenericPreparation: jest.fn(),
            assertPreparedChangeSetCurrent: jest.fn(
              (_id, _request, prepared) => prepared,
            ),
            materializeGenericWorkItemChangeSet: jest.fn(),
          },
        },
        {
          provide: PendingEdgeService,
          useValue: {
            materializeEdges: jest.fn(),
            rollbackMaterializedEdges: jest.fn(),
            processDeclaredEdges: jest.fn().mockResolvedValue([]),
            cleanupForProposal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
  });

  it('rejects typed relationship fields on influences before persistence', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);
    const typedInfluence = {
      entityId: testIds.designDoc,
      entityType: 'DESIGN_DOC',
      reasoning: 'typed topology must use proposal edges',
      reasonType: 'explicit_mention',
      edgeType: 'DEPENDS_ON',
    } as unknown as NonNullable<
      Parameters<typeof service.create>[3]['influences']
    >[number];

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        influences: [typedInfluence],
      }),
    ).rejects.toThrow(
      'unsupported field "edgeType"; declare typed relationships through edges',
    );

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('stamps entityTitle on every persisted influence, including the origin row', async () => {
    (mockPrisma.db as any).task.findMany.mockResolvedValue([
      { id: testIds.task, type: 'BUG' },
    ]);
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([
      {
        entityId: testIds.task,
        entityType: 'TASK',
        entityName: 'Origin task title',
        deletedAt: null,
      },
      {
        entityId: testIds.designDoc,
        entityType: 'DESIGN_DOC',
        entityName: 'Resolved doc title',
        deletedAt: null,
      },
    ]);
    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        influences: [
          {
            entityId: testIds.designDoc,
            entityType: 'DESIGN_DOC',
            reasoning: 'mentioned',
            reasonType: 'explicit_mention',
          },
        ],
      },
    );

    const influences = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data.influences as Array<Record<string, unknown>>;

    expect(influences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: testIds.designDoc,
          entityTitle: 'Resolved doc title',
        }),
        expect.objectContaining({
          entityId: testIds.task,
          reasonType: 'origin',
          entityTitle: 'Origin task title',
          taskType: 'BUG',
        }),
      ]),
    );
  });

  it('preserves caller-supplied entityTitle and stores null when the registry has no row', async () => {
    (mockPrisma.db as any).conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        influences: [
          {
            entityId: testIds.designDoc,
            entityType: 'DESIGN_DOC',
            entityTitle: 'Caller knew this',
            reasoning: 'mentioned',
            reasonType: 'explicit_mention',
          },
          {
            entityId: testIds.initiative,
            entityType: 'INITIATIVE',
            reasoning: 'inferred',
            reasonType: 'derived',
          },
        ],
      },
    );

    const influences = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data.influences as Array<Record<string, unknown>>;

    expect(influences).toEqual([
      expect.objectContaining({
        entityId: testIds.designDoc,
        entityTitle: 'Caller knew this',
      }),
      expect.objectContaining({
        entityId: testIds.initiative,
        entityTitle: null,
      }),
    ]);
  });

  it('snapshots durable proposal and entity titles while preserving legacy deferred declarations', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([
      {
        entityId: testIds.task,
        entityType: 'TASK',
        entityName: 'Origin task title',
        deletedAt: null,
      },
      {
        entityId: testIds.designDoc,
        entityType: 'DESIGN_DOC',
        entityName: 'Linked doc',
        deletedAt: null,
      },
    ]);
    (mockPrisma.db as any).designDoc.findMany.mockResolvedValue([
      { id: testIds.designDoc, projectId: testIds.project },
    ]);
    (mockPrisma.db as any).proposal.findMany.mockResolvedValue([
      { id: '99999999-9999-9999-9999-999999999999', title: 'Target proposal' },
    ]);

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        edges: [
          {
            targetEntityId: testIds.designDoc,
            targetEntityType: 'DESIGN_DOC' as any,
            edgeType: 'RELATED_TO' as any,
          },
          {
            targetEntityId: '99999999-9999-9999-9999-999999999999',
            targetEntityType: 'PROPOSAL' as any,
            edgeType: 'DEPENDS_ON' as any,
            endpointMode: 'PROPOSAL',
          },
          {
            targetEntityId: '99999999-9999-9999-9999-999999999999',
            targetEntityType: 'PROPOSAL',
            edgeType: 'EVOLVES',
          },
        ],
      },
    );

    const edges = (mockPrisma.db as any).proposal.create.mock.calls[0][0].data
      .edges as Array<Record<string, unknown>>;

    expect(edges).toEqual([
      expect.objectContaining({
        targetEntityId: testIds.designDoc,
        targetEntityTitle: 'Linked doc',
      }),
      expect.objectContaining({
        endpointMode: 'PROPOSAL',
        targetEntityType: 'PROPOSAL',
        targetEntityTitle: 'Target proposal',
      }),
      expect.objectContaining({
        targetEntityType: 'PROPOSAL',
        targetEntityTitle: null,
      }),
    ]);
  });

  it('rejects an unresolved edge before a supplied title can bypass validation or create a message', async () => {
    const missingTaskId = '99999999-9999-4999-8999-999999999998';
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).task.findMany.mockResolvedValue([]);

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        edges: [
          {
            targetEntityId: missingTaskId,
            targetEntityType: 'TASK' as any,
            targetEntityTitle: 'Caller-supplied but unverified',
            edgeType: 'RELATED_TO' as any,
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        errors: [
          expect.objectContaining({
            field: 'edges[0].targetEntityId',
            code: 'unresolved_reference',
          }),
        ],
      },
    });

    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
    expect((mockPrisma.db as any).message.create).not.toHaveBeenCalled();
  });

  it('persists a canonical CREATE proposal with server-owned null Message ownership', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);

    const result = await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        title: 'Caller-known new task',
        messageId: '123e4567-e89b-42d3-a456-426614174200',
      } as any,
    );

    const persisted = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data as { title: string | null };
    expect(persisted.title).toBe('Caller-known new task');
    expect(persisted).toHaveProperty('messageId', null);
    expect((mockPrisma.db as any).message.create).not.toHaveBeenCalled();
    expect(result.id).toBe(proposalId);
  });

  it('rejects a CREATE proposal authored without a title', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);

    await expect(
      service.create(testIds.organization, testIds.project, approvingUserId, {
        ...baseDto,
        title: undefined,
      }),
    ).rejects.toThrow(/CREATE proposals must include a non-empty `title`/);
    expect((mockPrisma.db as any).proposal.create).not.toHaveBeenCalled();
  });

  it('reuses one metadata pass when an UPDATE target is also a TASK influence', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([
      {
        entityId: testIds.task,
        entityType: 'TASK',
        entityName: 'Prior task name',
        deletedAt: null,
      },
    ]);
    (mockPrisma.db as any).task.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.task });

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        action: 'UPDATE',
        title: undefined,
        updates: { name: 'Renamed in this diff' },
        influences: [
          {
            entityId: testIds.task,
            entityType: 'TASK',
            reasoning: 'the target also informed the update',
            reasonType: 'explicit_mention',
          },
        ],
      },
    );

    const persisted = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data as {
      title: string | null;
      influences: Array<Record<string, unknown>>;
    };
    expect(persisted.title).toBe('Prior task name');
    expect(persisted.influences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: testIds.task,
          entityTitle: 'Prior task name',
          taskType: 'STANDARD',
        }),
      ]),
    );
    expect(
      (mockPrisma.db as any).entityRegistry.findMany,
    ).toHaveBeenCalledTimes(1);
    expect((mockPrisma.db as any).task.findMany).toHaveBeenCalledTimes(1);
    expect((mockPrisma.db as any).task.findFirst).not.toHaveBeenCalledWith({
      where: {
        id: testIds.task,
        organizationId: testIds.organization,
        archivedAt: null,
        projectId: testIds.project,
      },
      select: { id: true },
    });
  });

  it('caller-supplied title wins over the EntityRegistry on UPDATE', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([
      {
        entityId: testIds.task,
        entityType: 'TASK',
        entityName: 'Registry-resolved name',
        deletedAt: null,
      },
    ]);
    (mockPrisma.db as any).task.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.task });

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        action: 'UPDATE',
        title: 'Caller-known name',
        updates: { name: 'Renamed in this diff' },
      },
    );

    const persisted = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data as { title: string | null };
    expect(persisted.title).toBe('Caller-known name');
  });

  it('falls back to the EntityRegistry title for a DELETE without a caller-supplied title', async () => {
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([
      {
        entityId: testIds.task,
        entityType: 'TASK',
        entityName: 'About to be deleted',
        deletedAt: null,
      },
    ]);
    (mockPrisma.db as any).task.findFirst = jest
      .fn()
      .mockResolvedValue({ id: testIds.task });

    await service.create(
      testIds.organization,
      testIds.project,
      approvingUserId,
      {
        ...baseDto,
        action: 'DELETE',
        title: undefined,
        updates: {},
      },
    );

    const persisted = (mockPrisma.db as any).proposal.create.mock.calls[0][0]
      .data as { title: string | null };
    expect(persisted.title).toBe('About to be deleted');
  });
});

describe('ProposalService.findMany — work-item role population', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let workItemTypeRegistry: { getDefinitions: jest.Mock };

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    const proposalFindMany = jest.fn().mockResolvedValue([
      makeStoredProposal({
        action: 'CREATE',
        targetEntityId: testIds.task,
        updates: { name: 'Project info item' },
      }),
    ]);
    const proposalCount = jest.fn().mockResolvedValue(7);
    (mockPrisma.db as any).proposal = {
      findMany: proposalFindMany,
      count: proposalCount,
    };
    (mockPrisma.db as any).task.findMany.mockResolvedValue([
      { id: testIds.task, type: 'FEATURE' },
      { id: testIds.plan, type: 'PLAN' },
      { id: 'custom-project-info-task', type: 'CUSTOM_PROJECT_INFO' },
    ]);

    workItemTypeRegistry = {
      getDefinitions: jest.fn().mockReturnValue([
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: { key: 'FEATURE', role: WorkItemTypeRole.ProjectInfo },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: {
            key: 'CUSTOM_PROJECT_INFO',
            role: WorkItemTypeRole.ProjectInfo,
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: { key: 'STANDARD', role: WorkItemTypeRole.WorkItem },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: { key: 'TASK_MONITOR', role: WorkItemTypeRole.Monitor },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: {
            key: 'SCHEDULED_REPORT',
            role: WorkItemTypeRole.Scheduled,
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          definition: { key: 'TRIGGERED', role: WorkItemTypeRole.Trigger },
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        ProposalService,
        {
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        {
          provide: ProjectApprovalPolicyService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({ requiredApprovals: 1 }),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: createMockValidationEngine(),
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        {
          provide: ProposalApprovalService,
          useValue: {},
        },
        {
          provide: PendingEdgeService,
          useValue: {},
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: workItemTypeRegistry,
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
  });

  it('uses the active positive registry population plus PLAN and Design Docs for rows and totals', async () => {
    const query = {
      action: ProposalAction.Create,
      workItemRole: WorkItemTypeRole.ProjectInfo,
      windowStart: '2026-09-15T00:00:00.000Z',
      windowEnd: '2026-09-16T00:00:00.000Z',
      limit: 20,
      offset: 0,
    };

    const result = await service.findMany(
      testIds.organization,
      testIds.project,
      query,
    );

    const findManyArgs = (mockPrisma.db as any).proposal.findMany.mock
      .calls[0][0];
    const countArgs = (mockPrisma.db as any).proposal.count.mock.calls[0][0];
    const population = findManyArgs.where.OR as Array<Record<string, unknown>>;
    const populationText = JSON.stringify(population);

    expect(workItemTypeRegistry.getDefinitions).toHaveBeenCalledWith(
      testIds.project,
      WorkItemTypeLifecycleStatus.Active,
    );
    expect((mockPrisma.db as any).task.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        type: {
          in: ['CUSTOM_PROJECT_INFO', 'FEATURE', 'PLAN'],
        },
      },
      select: { id: true, type: true },
    });
    expect(populationText).toContain('CUSTOM_PROJECT_INFO');
    expect(populationText).toContain('FEATURE');
    expect(populationText).toContain('PLAN');
    expect(populationText).toContain('DESIGN_DOC');
    expect(populationText).not.toContain('STANDARD');
    expect(populationText).not.toContain('TASK_MONITOR');
    expect(populationText).not.toContain('SCHEDULED_REPORT');
    expect(populationText).not.toContain('TRIGGERED');
    expect(findManyArgs.where).toEqual(countArgs.where);
    expect(findManyArgs.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(result.total).toBe(7);
    expect(result.data).toHaveLength(1);
    expect(result.windowStart).toBe('2026-09-15T00:00:00.000Z');
    expect(result.windowEnd).toBe('2026-09-16T00:00:00.000Z');
  });

  it('finds dependent futures from persisted completion links and applies the same filter to rows and totals', async () => {
    const reviewedProposalId = randomUUID();
    const count = jest.fn().mockResolvedValue(1);
    Object.assign(mockPrisma.db.proposal, { count });
    const findFutures = jest
      .fn()
      .mockResolvedValue([{ latestProposalId: reviewedProposalId }]);
    const db = Object.assign(mockPrisma.db, {
      proposalFuture: { findMany: findFutures },
    });
    await service.findMany(testIds.organization, testIds.project, {
      completionDependencyId: testIds.task,
      limit: 20,
      offset: 0,
    });
    expect(findFutures).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        dependencies: { some: { targetEntityId: testIds.task } },
      },
      select: { latestProposalId: true },
    });
    const scope = expect.objectContaining({
      organizationId: testIds.organization,
      projectId: testIds.project,
      id: { in: [reviewedProposalId] },
    });
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: scope }),
    );
    expect(count).toHaveBeenCalledWith({ where: scope });
  });

  it('keeps the same scoped population for CREATE and UPDATE evidence', async () => {
    const window = {
      workItemRole: WorkItemTypeRole.ProjectInfo,
      windowStart: '2026-09-15T00:00:00.000Z',
      windowEnd: '2026-09-16T00:00:00.000Z',
    };

    await service.findMany(testIds.organization, testIds.project, {
      ...window,
      action: ProposalAction.Create,
    });
    await service.findMany(testIds.organization, testIds.project, {
      ...window,
      action: ProposalAction.Update,
    });

    const findManyCalls = (mockPrisma.db as any).proposal.findMany.mock.calls;
    const countCalls = (mockPrisma.db as any).proposal.count.mock.calls;
    expect(findManyCalls[0][0].where.OR).toEqual(findManyCalls[1][0].where.OR);
    expect(findManyCalls[0][0].where).toEqual(countCalls[0][0].where);
    expect(findManyCalls[1][0].where).toEqual(countCalls[1][0].where);
    expect(findManyCalls[0][0].where.action).toBe(ProposalAction.Create);
    expect(findManyCalls[1][0].where.action).toBe(ProposalAction.Update);
  });

  const postgresTest =
    process.env.RUN_PROPOSAL_ROLE_DB_TESTS === '1' ? it : it.skip;

  postgresTest(
    'includes a Feature UPDATE without updates.type in PostgreSQL rows and total',
    async () => {
      const databaseUrl = process.env.PROJECT_DATABASE_URL;
      if (
        !databaseUrl ||
        !['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(databaseUrl).hostname,
        )
      ) {
        throw new Error(
          'This regression requires a loopback PostgreSQL database.',
        );
      }

      const client = new PrismaClient();
      const rollback = new Error('Roll back proposal role regression fixtures');
      try {
        await expect(
          client.$transaction(async (tx) => {
            const organizationId = randomUUID() as typeof testIds.organization;
            const projectId = randomUUID() as typeof testIds.project;
            const userId = randomUUID();
            const featureId = randomUUID();
            const standardId = randomUUID();
            const matchingProposalId = randomUUID();

            await tx.organization.create({
              data: {
                id: organizationId,
                name: 'Proposal role regression',
                slug: randomUUID(),
              },
            });
            await tx.project.create({
              data: {
                id: projectId,
                organizationId,
                name: 'Proposal role regression',
              },
            });
            await tx.user.create({
              data: {
                id: userId,
                name: 'Proposal role regression',
                email: `${userId}@example.invalid`,
                passwordHash: 'unused-test-fixture',
              },
            });
            await tx.task.createMany({
              data: [
                {
                  id: featureId,
                  organizationId,
                  projectId,
                  name: 'Feature',
                  type: 'FEATURE',
                },
                {
                  id: standardId,
                  organizationId,
                  projectId,
                  name: 'Standard',
                  type: 'STANDARD',
                },
              ],
            });
            await tx.proposal.createMany({
              data: [
                {
                  id: matchingProposalId,
                  organizationId,
                  projectId,
                  requestorId: userId,
                  action: 'UPDATE',
                  targetEntityType: 'TASK',
                  targetEntityId: featureId,
                  updates: { name: 'Renamed feature' },
                  createdAt: new Date('2026-09-15T12:00:00.000Z'),
                },
                {
                  organizationId,
                  projectId,
                  requestorId: userId,
                  action: 'UPDATE',
                  targetEntityType: 'TASK',
                  targetEntityId: standardId,
                  updates: { name: 'Renamed standard' },
                  createdAt: new Date('2026-09-15T12:00:00.000Z'),
                },
                {
                  organizationId,
                  projectId,
                  requestorId: userId,
                  action: 'CREATE',
                  targetEntityType: 'TASK',
                  targetEntityId: randomUUID(),
                  updates: { name: 'New feature', type: 'FEATURE' },
                  createdAt: new Date('2026-09-15T12:00:00.000Z'),
                },
                {
                  organizationId,
                  projectId,
                  requestorId: userId,
                  action: 'UPDATE',
                  targetEntityType: 'TASK',
                  targetEntityId: featureId,
                  updates: { name: 'Outside window' },
                  createdAt: new Date('2026-09-16T12:00:00.000Z'),
                },
              ],
            });

            expect(
              await tx.proposal.count({
                where: {
                  id: matchingProposalId,
                  NOT: {
                    updates: { path: ['type'], string_contains: '' },
                  },
                },
              }),
            ).toBe(0);

            (mockPrisma.db as any).task.findMany.mockImplementation(
              (args: any) => tx.task.findMany(args),
            );
            (mockPrisma.db as any).proposal.findMany.mockImplementation(
              (args: any) => tx.proposal.findMany(args),
            );
            (mockPrisma.db as any).proposal.count.mockImplementation(
              (args: any) => tx.proposal.count(args),
            );

            const result = await service.findMany(organizationId, projectId, {
              action: ProposalAction.Update,
              workItemRole: WorkItemTypeRole.ProjectInfo,
              windowStart: '2026-09-15T00:00:00.000Z',
              windowEnd: '2026-09-16T00:00:00.000Z',
            });

            expect(result.data.map(({ id }) => id)).toEqual([
              matchingProposalId,
            ]);
            expect(result.total).toBe(1);
            throw rollback;
          }),
        ).rejects.toBe(rollback);
      } finally {
        await client.$disconnect();
      }
    },
  );
});
