import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import type { CreateProposalDto } from 'src/generated';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { Test, TestingModule } from '@nestjs/testing';
import * as futureRevisions from '../future-revision';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, WorkItemChangeSetMaterializationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS,
  ProposalApprovalService,
} from '../proposal-approval.service';
import { TaskService } from '../../tasks/task.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { WorkItemTypeLifecycleService } from '../../tasks/work-item-type-lifecycle.service';
import { WorkItemTypeImpactService } from '../../tasks/work-item-type-impact.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { InfluenceService } from '../../influence/influence.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { ProposalApprovedEventPayload } from '../../../generated/model/proposalApprovedEventPayload';
import { WorkStatus } from '../../../generated/model/workStatus';
import {
  PendingEdgeService,
  SERVICE_TOKEN_FACTORY,
} from '../pending-edge.service';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import { PlanFromDesignDocLauncherService } from '../../plan/plan-from-design-doc-launcher.service';
import { MentionProcessingService } from '../../mentions/mention-processing.service';
import { TEMPORAL_CLIENT } from '../../../prisma/temporal.module';
import { MentionCreatedEventPayload } from '../../../generated/model/mentionCreatedEventPayload';
import { MentionRemovedEventPayload } from '../../../generated/model/mentionRemovedEventPayload';
import * as TestUtils from '../../../utils/testUtils';
import * as permissionEvaluation from '../permission-evaluation';
import type { AnyTransactionClient } from '../../../prisma/prisma.service';
import type { ProposalWithApprovals } from '../proposal.types';

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
import { UserId } from '../../../types';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';
import {
  createDefaultProjectApprovalPolicy,
  ProjectApprovalPolicyService,
} from '../project-approval-policy.service';
import { EntityPromptTemplateService } from '../../entity-prompt-template.service';
import { requirementCitationEdgeId } from '../../tasks/feature-requirement-citation-edges';
import { ProjectAccessService } from 'src/auth/services/project-access.service';

const { testIds } = TestUtils;

const proposalId = '123e4567-e89b-42d3-a456-426614174099';
const createdTaskId = '123e4567-e89b-42d3-a456-426614174100';
const createdDesignDocId = '123e4567-e89b-42d3-a456-426614174101';
const approvingUserId = 'approver-user-id' as UserId;

// Mirrors the Prisma `Proposal` row shape — camelCase field names, exactly
// what `tx.proposal.findFirst` returns. `findForUpdateInTx` re-loads through
// the typed API, so the fixture no longer needs the raw snake_case columns.
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
    updates: {
      name: 'New task',
      initiativeId: testIds.initiative,
    },
    requestorId: testIds.user,
    requestorContext: {
      source: 'agent',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'mcp.create_task',
      timestamp: '2026-03-18T00:00:00.000Z',
    },
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    targetLastAppliedProposalId: null,
    createdAt: new Date('2026-03-18T00:00:00Z'),
    updatedAt: new Date('2026-03-18T00:00:00Z'),
    ...overrides,
  };
}

describe('ProposalApprovalService', () => {
  let service: ProposalApprovalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let projectApprovalPolicyService: { resolve: jest.Mock };
  let mockProjectAccess: { assertProjectRole: jest.Mock };
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;
  let mockTaskService: {
    createInTransaction: jest.Mock;
    updateInTransaction: jest.Mock;
    replaceServiceAssignmentsInTransaction: jest.Mock;
    removeInTransaction: jest.Mock;
    hardDeleteByTypeInTransaction: jest.Mock;
    hardDeleteByIdsInTransaction: jest.Mock;
    runUpdatePostCommit: jest.Mock;
  };
  let mockDesignDocService: {
    createInTransaction: jest.Mock;
    updateInTransaction: jest.Mock;
    removeInTransaction: jest.Mock;
    runUpdatePostCommit: jest.Mock;
    runRemovePostCommit: jest.Mock;
  };
  let mockWorkItemTypeRegistry: {
    insertAcceptedDefinitionInTransaction: jest.Mock;
    getAcceptedCustomDefinitionInTransaction: jest.Mock;
    updateAcceptedDefinitionInTransaction: jest.Mock;
    archiveAcceptedDefinitionInTransaction: jest.Mock;
    materializeTemplateDefinition: jest.Mock;
    assertCustomDefinitionDeletableInTransaction: jest.Mock;
    deleteAcceptedCustomDefinitionInTransaction: jest.Mock;
    publishConfigChanged: jest.Mock;
    getSectionDefinitions: jest.Mock;
  };
  let mockWorkItemTypeLifecycle: {
    resolveInTransaction: jest.Mock;
    archiveInTransaction: jest.Mock;
    restoreInTransaction: jest.Mock;
  };
  let mockEntityPromptTemplateService: {
    provisionCustomWorkItemTypeTemplateInTransaction: jest.Mock;
  };
  let mockWorkItemTypeImpact: {
    enumerateCascadeWorkItemIdsInTransaction: jest.Mock;
    deleteCascadeIncidentEdges: jest.Mock;
    restoreCascadeIncidentEdges: jest.Mock;
  };
  const serviceTokenFactory = jest.fn(() => 'service-token');
  let mockInitiativeService: {
    createInTransaction: jest.Mock;
    updateInTransaction: jest.Mock;
    runUpdatePostCommit: jest.Mock;
  };
  let mockInfluenceService: {
    createMany: jest.Mock;
  };
  let mockConversationWorkflowService: {
    startWorkflowOnExistingConversation: jest.Mock;
  };
  let mockPlanFromDesignDocLauncher: {
    materializeRunInTransaction: jest.Mock;
  };
  let mockMentionProcessingService: {
    extractAndValidate: jest.Mock;
    extractMentionTokens: jest.Mock;
    validateMentions: jest.Mock;
    mapMentionEntityType: jest.Mock;
  };
  let mockPendingEdgeService: {
    processDeclaredEdges: jest.Mock;
    materializeEdges: jest.Mock;
    materializeRequirementCitationEdges: jest.Mock;
    rollbackMaterializedEdges: jest.Mock;
    cleanupForProposal: jest.Mock;
    deleteEdgesById: jest.Mock;
  };
  let mockWorkItemChangeSetProjector: { project: jest.Mock };
  let mockWorkItemChangeSetMaterializer: {
    isWorkItemChangeSetValidationRequest: jest.Mock;
    taskProposalChangeSet: jest.Mock;
    validationRevision: jest.Mock;
    hasNonterminalIntent: jest.Mock;
    enqueuePreparedIntent: jest.Mock;
    projectPreparation: jest.Mock;
    requestDrain: jest.Mock;
    materializeApprovedChangeSet: jest.Mock;
  };
  let mockPlanExecutionGuidanceService: {
    isStepAddRegenEligible: jest.Mock;
    requestUpdate: jest.Mock;
  };
  let mockTemporalClient: { workflow: { start: jest.Mock } };

  let txMock: Record<string, any>;

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();

    txMock = {
      proposalReconciliationSuggestion: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn(),
      proposalGroupMember: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      proposal: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      proposalApprovalRecord: {
        create: jest.fn().mockResolvedValue({ id: 'vote-1' }),
        count: jest.fn().mockResolvedValue(1),
      },
      projectMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { userId: approvingUserId },
            { userId: 'requestor-user-id' },
          ]),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          lastAppliedProposalId: null,
        }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      designDoc: {
        findUnique: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
      },
      workItemType: {
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
      workItemTypeTemplate: {
        findUnique: jest.fn(),
      },
      taskSection: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      designDocSection: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      plan: {
        findUnique: jest.fn(),
      },
      planStage: {
        // Default to NOT_STARTED so existing PLAN_STEP tests (which
        // never opted into REFINING) keep exercising the non-REFINING
        // materialization path. REFINING-specific tests override this.
        findUnique: jest.fn().mockResolvedValue({ status: 'NOT_STARTED' }),
      },
      planStep: {
        findUnique: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Only `updateMany` is invoked directly on the tx — the row creation
      // and event publishing route through the mocked AgentSessionService.
      agentSession: {
        updateMany: jest.fn(),
      },
      trackingCleanupOperation: {
        create: jest.fn().mockResolvedValue({ id: 'cleanup-operation-1' }),
      },
      workItemTypeCascadeExecution: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'cascade-execution-1',
          workItemIds: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    jest
      .spyOn(mockPrisma.db as any, '$transaction')
      .mockImplementation(async (fn: any) => fn(txMock));
    (mockPrisma.db as any).proposalGroupMember = {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    mockEventPublisher = TestUtils.createMockDomainEventPublisher();
    mockTaskService = {
      createInTransaction: jest.fn(),
      updateInTransaction: jest.fn(),
      replaceServiceAssignmentsInTransaction: jest.fn(),
      removeInTransaction: jest.fn().mockResolvedValue(undefined),
      hardDeleteByTypeInTransaction: jest.fn().mockResolvedValue(0),
      hardDeleteByIdsInTransaction: jest.fn().mockResolvedValue(0),
      runUpdatePostCommit: jest.fn().mockResolvedValue(undefined),
    };
    mockDesignDocService = {
      createInTransaction: jest.fn(),
      updateInTransaction: jest.fn(),
      removeInTransaction: jest.fn().mockResolvedValue({
        runPostCommit: jest.fn().mockResolvedValue(undefined),
      }),
      runUpdatePostCommit: jest.fn().mockResolvedValue(undefined),
      runRemovePostCommit: jest.fn().mockResolvedValue(undefined),
    };
    mockWorkItemTypeRegistry = {
      // The registry persists the row in-tx and hands back a post-commit
      // runner that publishes the cross-instance invalidation. The default
      // runner is a no-op spy; the publish-timing test overrides it.
      insertAcceptedDefinitionInTransaction: jest.fn(),
      getAcceptedCustomDefinitionInTransaction: jest.fn(),
      updateAcceptedDefinitionInTransaction: jest.fn(),
      archiveAcceptedDefinitionInTransaction: jest.fn(),
      materializeTemplateDefinition: jest.fn(),
      assertCustomDefinitionDeletableInTransaction: jest
        .fn()
        .mockResolvedValue(undefined),
      deleteAcceptedCustomDefinitionInTransaction: jest.fn(),
      publishConfigChanged: jest.fn().mockResolvedValue(undefined),
      getSectionDefinitions: jest.fn().mockReturnValue([]),
    };
    mockWorkItemTypeLifecycle = {
      resolveInTransaction: jest.fn().mockResolvedValue({
        row: { id: 'work-item-type-row-1', lifecycleStatus: 'active' },
        definition: {},
      }),
      archiveInTransaction: jest.fn(),
      restoreInTransaction: jest.fn(),
    };
    mockEntityPromptTemplateService = {
      provisionCustomWorkItemTypeTemplateInTransaction: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    mockWorkItemTypeImpact = {
      enumerateCascadeWorkItemIdsInTransaction: jest.fn().mockResolvedValue([]),
      deleteCascadeIncidentEdges: jest.fn().mockResolvedValue({
        deletedEdgeCount: 0,
        deletedEdges: [],
      }),
      restoreCascadeIncidentEdges: jest.fn().mockResolvedValue(undefined),
    };
    mockInitiativeService = {
      createInTransaction: jest.fn(),
      updateInTransaction: jest.fn().mockResolvedValue({
        initiative: { id: 'initiative-mock' },
        postCommit: {},
      }),
      runUpdatePostCommit: jest.fn().mockResolvedValue(undefined),
    };
    mockInfluenceService = {
      createMany: jest.fn().mockResolvedValue(1),
    };
    mockConversationWorkflowService = {
      startWorkflowOnExistingConversation: jest
        .fn()
        .mockResolvedValue({ workflowId: 'workflow-stub' }),
    };
    mockPlanFromDesignDocLauncher = {
      materializeRunInTransaction: jest.fn(),
    };
    mockMentionProcessingService = {
      extractAndValidate: jest.fn().mockResolvedValue([]),
      extractMentionTokens: jest.fn().mockReturnValue([]),
      validateMentions: jest.fn().mockResolvedValue([]),
      mapMentionEntityType: jest.fn().mockReturnValue(null),
    };
    mockPendingEdgeService = {
      processDeclaredEdges: jest.fn().mockResolvedValue([]),
      materializeEdges: jest.fn().mockResolvedValue(undefined),
      materializeRequirementCitationEdges: jest
        .fn()
        .mockResolvedValue(undefined),
      rollbackMaterializedEdges: jest.fn().mockResolvedValue(undefined),
      cleanupForProposal: jest.fn().mockResolvedValue(undefined),
      deleteEdgesById: jest.fn().mockResolvedValue(undefined),
    };
    mockWorkItemChangeSetProjector = {
      project: jest.fn().mockResolvedValue({
        valid: true,
        projectedRoot: {
          identity: { refType: 'temporary', tempId: 'root' },
          label: 'Root',
          type: 'STANDARD',
          name: 'Root',
          sections: [],
          deleted: false,
        },
        children: [],
        sections: [],
        incidentRelationships: [],
        identityLabels: {},
        issues: [],
      }),
    };
    mockWorkItemChangeSetMaterializer = {
      isWorkItemChangeSetValidationRequest: jest.fn(
        (value: unknown) =>
          value !== null &&
          typeof value === 'object' &&
          'root' in value &&
          Array.isArray((value as { operations?: unknown }).operations),
      ),
      taskProposalChangeSet: jest.fn().mockReturnValue(null),
      validationRevision: jest.fn().mockReturnValue('revision-1'),
      hasNonterminalIntent: jest.fn().mockResolvedValue(false),
      enqueuePreparedIntent: jest.fn().mockResolvedValue({
        id: 'materialization-1',
        rootWorkItemId: createdTaskId,
      }),
      // Delegates to the projector mock so tests can shape the projection
      // through `mockWorkItemChangeSetProjector.project`.
      projectPreparation: jest.fn(
        async (params: {
          organizationId: string;
          projectId: string;
          request: { root: unknown; operations: unknown[] };
        }) => {
          const target = await mockWorkItemChangeSetProjector.project(params);
          return {
            operationSet: params.request,
            validationRevision:
              mockWorkItemChangeSetMaterializer.validationRevision(
                params.request,
              ),
            snapshots: {
              unavailableWorkItemIds: new Set<string>(),
              workItemKeys: [],
              relationshipKeys: [],
              prior: target,
              target,
            },
          };
        },
      ),
      requestDrain: jest.fn(),
      materializeApprovedChangeSet: jest.fn().mockResolvedValue({
        proposal: {
          ...makeStoredProposal({
            updates: {
              root: { refType: 'temporary', tempId: 'root' },
              operations: [],
            },
          }),
          status: 'APPROVED',
          targetEntityId: createdTaskId,
        },
        rootWorkItemId: createdTaskId,
        status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
        enacted: true,
      }),
    };
    // Default: every step-add is eligible so the bulk/singular fixtures that
    // don't care about gating still exercise the workflow dispatch. The
    // step-add regen suite below overrides this per-case.
    mockPlanExecutionGuidanceService = {
      isStepAddRegenEligible: jest.fn().mockResolvedValue(true),
      requestUpdate: jest
        .fn()
        .mockResolvedValue({ shouldStart: true, requestSeq: 1 }),
    };
    mockTemporalClient = {
      workflow: { start: jest.fn().mockResolvedValue(undefined) },
    };
    projectApprovalPolicyService = {
      resolve: jest
        .fn()
        .mockResolvedValue(createDefaultProjectApprovalPolicy()),
    };

    mockProjectAccess = { assertProjectRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ProjectAccessService, useValue: mockProjectAccess },
        ProposalApprovalService,
        {
          provide: ProposalReconciliationService,
          useValue: {
            assertApplicable: jest.fn(),
            recordCreatedDelivery: jest.fn(),
          },
        },
        {
          provide: ProjectApprovalPolicyService,
          useValue: projectApprovalPolicyService,
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        { provide: TaskService, useValue: mockTaskService },
        {
          provide: WorkItemTypeRegistryService,
          useValue: mockWorkItemTypeRegistry,
        },
        {
          provide: WorkItemTypeLifecycleService,
          useValue: mockWorkItemTypeLifecycle,
        },
        {
          provide: EntityPromptTemplateService,
          useValue: mockEntityPromptTemplateService,
        },
        {
          provide: WorkItemTypeImpactService,
          useValue: mockWorkItemTypeImpact,
        },
        { provide: DesignDocService, useValue: mockDesignDocService },
        { provide: InitiativeService, useValue: mockInitiativeService },
        { provide: InfluenceService, useValue: mockInfluenceService },
        {
          provide: PendingEdgeService,
          useValue: mockPendingEdgeService,
        },
        {
          provide: WorkItemChangeSetMaterializerService,
          useValue: mockWorkItemChangeSetMaterializer,
        },
        {
          provide: ConversationWorkflowService,
          useValue: mockConversationWorkflowService,
        },
        {
          provide: PlanFromDesignDocLauncherService,
          useValue: mockPlanFromDesignDocLauncher,
        },
        {
          provide: MentionProcessingService,
          useValue: mockMentionProcessingService,
        },
        { provide: SERVICE_TOKEN_FACTORY, useValue: serviceTokenFactory },
        { provide: TEMPORAL_CLIENT, useValue: mockTemporalClient },
      ],
    }).compile();

    service = module.get<ProposalApprovalService>(ProposalApprovalService);
    jest.clearAllMocks();
  });

  // `beforeEach` only clears call records, not spied implementations, so any
  // `forceThreshold` spy must be restored between tests to avoid leaking its
  // forced return value into the next test.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Pin the approval threshold the evaluator returns, decoupled from the live
  // rule config. The default rule for a top-level FEATURE content change is
  // threshold 1 (verified in permission-evaluation.test.ts), so a test that
  // needs to exercise the service's "below threshold → stay DRAFT / at
  // threshold → enact" gate must force a higher threshold here.
  function forceThreshold(threshold: number) {
    return jest
      .spyOn(permissionEvaluation, 'evaluatePermissions')
      .mockReturnValue({
        requiresProposal: true,
        threshold,
        allowsProposerApproval: true,
      });
  }

  // `findForUpdateInTx` takes the row lock via `$queryRaw` (which only
  // selects `id`) and then re-loads the row through `proposal.findFirst`.
  // Stub both: a `null` proposal means the lock query finds nothing.
  function stubStoredProposal(
    proposal: ReturnType<typeof makeStoredProposal> | null,
  ) {
    txMock.$queryRaw.mockResolvedValue(proposal ? [{ id: proposal.id }] : []);
    txMock.proposal.findFirst.mockResolvedValue(proposal);
    // approve() reads the row unlocked to project before the transaction.
    (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue(proposal);
  }

  function setupForApproval(
    proposal: ReturnType<typeof makeStoredProposal>,
    overrides?: {
      approvalCount?: number;
      taskLookup?: Record<string, unknown> | null;
    },
  ) {
    const approved = { ...proposal, status: 'APPROVED' };
    stubStoredProposal(proposal);
    // Mirror Prisma's `update`: return the row with `data` merged in. CREATE
    // enactment issues a second `update` to rewrite the NIL_UUID placeholder
    // targetEntityId — the caller relies on that returned row.
    txMock.proposal.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...approved, ...data }),
    );
    txMock.proposalApprovalRecord.create.mockResolvedValue({ id: 'vote-1' });
    txMock.proposalApprovalRecord.count.mockResolvedValue(
      overrides?.approvalCount ?? 1,
    );
    if (overrides?.taskLookup !== undefined) {
      txMock.task.findFirst.mockResolvedValue(
        overrides.taskLookup === null
          ? null
          : { lastAppliedProposalId: null, ...overrides.taskLookup },
      );
    }
    return approved;
  }

  it('accepts repeat grouped approval after redispatching a contended READY member', async () => {
    const approved = makeStoredProposal({ status: 'APPROVED' });
    const approveGrouped = jest.fn().mockResolvedValue({
      result: {
        outcome: 'ALREADY_APPROVED',
        executionState: 'READY',
        memberId: 'member-1',
      },
      proposalId,
      recorded: false,
    });
    (service as any).proposalGroupDecisionService = {
      approve: approveGrouped,
    };
    (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue({
      groupMembership: { groupId: 'group-1' },
    });
    (mockPrisma.db.proposal as any).findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(approved);
    jest
      .spyOn(service as any, 'toResponseDto')
      .mockResolvedValue({ id: proposalId });

    await expect(
      service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      ),
    ).resolves.toMatchObject({ enacted: false });
    expect(approveGrouped).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId }),
      expect.anything(),
    );
  });

  describe('VERSIONED_UPDATE approval', () => {
    it.each(['TASK', 'DESIGN_DOC'] as const)(
      'applies an already reviewed %s future through the existing transaction without another approval event',
      async (targetEntityType) => {
        const proposal = makeStoredProposal({
          action: 'VERSIONED_UPDATE',
          status: 'APPROVED',
          targetEntityType,
        });
        setupForApproval(proposal);
        mockTaskService.updateInTransaction.mockResolvedValue({
          postCommit: {},
        });
        mockDesignDocService.updateInTransaction.mockResolvedValue({
          postCommit: {},
        });
        const content =
          targetEntityType === 'TASK'
            ? {
                type: 'FEATURE',
                name: 'Reviewed result',
                status: 'BACKLOG',
                sections: [],
              }
            : {
                template: 'DESIGN_DOC',
                name: 'Reviewed result',
                status: 'DRAFT',
                tags: [],
                sections: [],
              };
        const reviewedFuture = { result: content } as any;
        const stage = jest.spyOn(futureRevisions, 'stageFutureRevision');
        try {
          const result = await service.applyInTransaction(
            txMock as any,
            proposal as any,
            testIds.organization,
            testIds.project,
            { reviewedFuture },
          );
          const target =
            targetEntityType === 'TASK'
              ? mockTaskService
              : mockDesignDocService;
          expect(target.updateInTransaction).toHaveBeenCalled();
          expect(txMock.proposal.update).not.toHaveBeenCalled();
          expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
          expect(stage).not.toHaveBeenCalled();
          expect(
            mockEventPublisher.publishInTransaction,
          ).not.toHaveBeenCalled();
          expect(
            mockPendingEdgeService.processDeclaredEdges,
          ).toHaveBeenCalled();
          expect(result.resultingEntityId).toBe(proposal.targetEntityId);
        } finally {
          stage.mockRestore();
        }
      },
    );
    it.each(['standalone', 'transactional'] as const)(
      'stages without live side effects through %s approval',
      async (path) => {
        const baselineContent = {
          id: testIds.task,
          organizationId: testIds.organization,
          projectId: testIds.project,
          name: 'Current task',
          type: 'FEATURE',
          status: 'BACKLOG',
          source: 'user',
          sections: [],
        };
        const draft = makeStoredProposal({
          action: 'VERSIONED_UPDATE',
          updates: {
            operation: 'REVISE',
            futureId: proposalId,
            expectedRevision: 0,
            baseline: {
              kind: 'LIVE',
              revision: 'live-revision-1',
              content: baselineContent,
            },
            result: { ...baselineContent, name: 'Future task' },
            dependencies: [],
          },
        });
        const approved = setupForApproval(draft, {
          taskLookup: {
            type: 'FEATURE',
            parentTaskId: null,
            initiativeId: null,
          },
        });
        const stage = jest
          .spyOn(futureRevisions, 'stageFutureRevision')
          .mockResolvedValueOnce(undefined);
        try {
          if (path === 'standalone') {
            await service.approve(
              proposalId,
              testIds.organization,
              testIds.project,
              approvingUserId,
            );
          } else {
            await service.applyInTransaction(
              txMock as any,
              draft as any,
              testIds.organization,
              testIds.project,
            );
          }
          expect(stage).toHaveBeenCalledWith(
            txMock,
            mockWorkItemTypeRegistry,
            expect.objectContaining({
              action: 'VERSIONED_UPDATE',
              status: 'APPROVED',
            }),
          );
          expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
          expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
          expect(
            mockDesignDocService.updateInTransaction,
          ).not.toHaveBeenCalled();
          expect(
            mockPendingEdgeService.processDeclaredEdges,
          ).not.toHaveBeenCalled();
          expect(approved.targetEntityId).toBe(draft.targetEntityId);
        } finally {
          stage.mockRestore();
        }
      },
    );
  });

  describe('approve() with CREATE + TASK', () => {
    it('materializes a supplied complete service set in the approval transaction', async () => {
      const serviceIds = [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ];
      const draft = makeStoredProposal({
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
          serviceIds,
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockTaskService.createInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        testIds.initiative,
        expect.not.objectContaining({ serviceIds: expect.anything() }),
        testIds.project,
        undefined,
      );
      expect(
        mockTaskService.replaceServiceAssignmentsInTransaction,
      ).toHaveBeenCalledWith(expect.anything(), createdTaskId, serviceIds);
    });

    it('creates task and updates proposal status atomically', async () => {
      const config = {
        kind: 'INITIAL_WORKTREE',
        version: 'v1',
        initialWorktreeBranch: 'feature/launch-default',
      };
      const draft = makeStoredProposal({
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
          config,
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(createdTaskId);
      expect(result.proposal.status).toBe('APPROVED');
      expect(result.enacted).toBe(true);

      expect(txMock.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proposalId },
          data: { status: 'APPROVED' },
        }),
      );

      expect(mockTaskService.createInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        testIds.initiative,
        draft.updates,
        testIds.project,
        undefined,
      );
      expect(
        mockTaskService.createInTransaction.mock.calls[0]![3].config,
      ).toEqual(config);
      expect(mockPrisma.db.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS,
      );
    });

    it('materializes embedded workflow steps and resolved workflow links', async () => {
      const workflowId = '123e4567-e89b-42d3-a456-426614174201';
      const draftStepId = '123e4567-e89b-42d3-a456-426614174202';
      const approveStepId = '123e4567-e89b-42d3-a456-426614174203';
      const draft = makeStoredProposal({
        updates: {
          name: 'Review workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          sections: [{ key: 'description', content: 'Review steps.' }],
          workflowSteps: [
            {
              tempId: 'draft',
              name: 'Draft',
              sections: [{ key: 'description', content: 'Draft it.' }],
            },
            {
              tempId: 'approve',
              name: 'Approve',
              sections: [{ key: 'description', content: 'Approve it.' }],
            },
          ],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              targetStepTempId: 'approve',
              type: 'STANDARD',
              direction: 'forward',
              actionLabel: 'tap Continue',
              description: 'Draft moves to approval.',
            },
            {
              sourceStepTempId: 'approve',
              type: 'FULFILLED_BY',
              targetTaskId: testIds.task,
            },
          ],
        },
      });
      setupForApproval(draft);
      txMock.task.findMany.mockResolvedValue([{ id: testIds.task }]);
      mockTaskService.createInTransaction
        .mockResolvedValueOnce({ id: workflowId })
        .mockResolvedValueOnce({ id: draftStepId })
        .mockResolvedValueOnce({ id: approveStepId });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockTaskService.createInTransaction).toHaveBeenCalledTimes(3);
      expect(mockTaskService.createInTransaction.mock.calls[0]![3]).toEqual({
        name: 'Review workflow',
        initiativeId: testIds.initiative,
        type: 'workflow',
        sections: [{ key: 'description', content: 'Review steps.' }],
      });
      expect(mockTaskService.createInTransaction.mock.calls[1]![3]).toEqual({
        name: 'Draft',
        sections: [{ key: 'description', content: 'Draft it.' }],
        initiativeId: testIds.initiative,
        status: undefined,
        source: undefined,
        priority: undefined,
        dueDate: undefined,
        assigneeId: undefined,
        parentTaskId: workflowId,
        serviceId: undefined,
        type: 'workflow_step',
      });

      expect(mockPendingEdgeService.materializeEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          {
            sourceEntityId: draftStepId,
            sourceEntityType: 'TASK',
            targetEntityId: approveStepId,
            targetEntityType: 'TASK',
            edgeType: 'STANDARD',
            category: 'flow',
            direction: 'forward',
            predicate: undefined,
            actionLabel: 'tap Continue',
            description: 'Draft moves to approval.',
          },
          {
            sourceEntityId: approveStepId,
            sourceEntityType: 'TASK',
            targetEntityId: testIds.task,
            targetEntityType: 'TASK',
            edgeType: 'FULFILLED_BY',
            category: 'meta',
            description: undefined,
          },
        ],
        null,
      );
    });

    it('forwards a predicate-bearing legacy LOOP during approval materialization', async () => {
      const workflowId = '123e4567-e89b-42d3-a456-426614174204';
      const retryStepId = '123e4567-e89b-42d3-a456-426614174205';
      const draft = makeStoredProposal({
        updates: {
          name: 'Retry workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [{ tempId: 'retry', name: 'Retry' }],
          workflowLinks: [
            {
              sourceStepTempId: 'retry',
              type: 'LOOP',
              predicate: 'retryCount < 3',
              description: 'Retry while attempts remain.',
            },
          ],
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction
        .mockResolvedValueOnce({ id: workflowId })
        .mockResolvedValueOnce({ id: retryStepId });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockPendingEdgeService.materializeEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [
          {
            sourceEntityId: retryStepId,
            sourceEntityType: 'TASK',
            targetEntityId: retryStepId,
            targetEntityType: 'TASK',
            edgeType: 'LOOP',
            category: 'flow',
            predicate: 'retryCount < 3',
            description: 'Retry while attempts remain.',
          },
        ],
        null,
      );
    });

    it('rejects embedded workflow links that cannot resolve a proposed step', async () => {
      const workflowId = '123e4567-e89b-42d3-a456-426614174201';
      const draft = makeStoredProposal({
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [{ tempId: 'draft', name: 'Draft' }],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              targetStepTempId: 'missing',
              type: 'STANDARD',
              direction: 'forward',
            },
          ],
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction
        .mockResolvedValueOnce({ id: workflowId })
        .mockResolvedValueOnce({ id: '123e4567-e89b-42d3-a456-426614174202' });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(
        "Workflow proposal link references unknown proposed step 'missing'",
      );

      expect(mockPendingEdgeService.materializeEdges).not.toHaveBeenCalled();
    });

    it('rejects a stored CONDITIONAL workflow link without a predicate before approval enactment', async () => {
      const draft = makeStoredProposal({
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [
            { tempId: 'decision', name: 'Decision' },
            { tempId: 'done', name: 'Done' },
          ],
          workflowLinks: [
            {
              sourceStepTempId: 'decision',
              targetStepTempId: 'done',
              type: 'CONDITIONAL',
              direction: 'forward',
            },
          ],
        },
      });
      setupForApproval(draft);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Workflow proposal links violate the OpenAPI contract');

      expect(txMock.proposal.update).not.toHaveBeenCalled();
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
      expect(mockPendingEdgeService.materializeEdges).not.toHaveBeenCalled();
    });

    it('rejects FULFILLED_BY workflow links whose target task disappeared before approval', async () => {
      const draft = makeStoredProposal({
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [{ tempId: 'draft', name: 'Draft' }],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              type: 'FULFILLED_BY',
              targetTaskId: testIds.task,
            },
          ],
        },
      });
      setupForApproval(draft);
      txMock.task.findMany.mockResolvedValue([]);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(
        `FULFILLED_BY workflow link target task ${testIds.task} was not found in this project.`,
      );

      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
      expect(mockPendingEdgeService.materializeEdges).not.toHaveBeenCalled();
    });

    it('publishes proposal.approved event with resultingEntityId', async () => {
      const draft = makeStoredProposal();
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      const [, event] = mockEventPublisher.publishInTransaction.mock.calls[0]!;
      expect(event.type).toBe(EVENT_TYPES.PROPOSAL.APPROVED);
      expect(event.aggregateId).toBe(proposalId);

      const payload = event.payload as ProposalApprovedEventPayload;
      expect(payload.resultingEntityId).toBe(createdTaskId);
      expect(payload.proposalId).toBe(proposalId);
      expect(payload.organizationId).toBe(testIds.organization);
      expect(payload.targetEntityType).toBe('TASK');
      expect(payload.action).toBe('CREATE');
    });
  });

  describe('approve() with CREATE + DESIGN_DOC', () => {
    it('creates design doc and updates proposal status atomically', async () => {
      const draft = makeStoredProposal({
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
        updates: {
          name: 'New ADR',
          template: 'ADR',
          projectId: testIds.project,
        },
      });
      setupForApproval(draft);
      mockDesignDocService.createInTransaction.mockResolvedValue({
        id: createdDesignDocId,
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(createdDesignDocId);
      expect(mockDesignDocService.createInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'New ADR',
          template: 'ADR',
          organizationId: testIds.organization,
        }),
        undefined,
      );
    });
  });

  describe('approve() with CREATE + WORK_ITEM_TYPE', () => {
    const NIL_UUID = '00000000-0000-0000-0000-000000000000';
    const createdTypeRowId = '123e4567-e89b-42d3-a456-426614174222';

    function makeWorkItemTypeProposal(targetEntityId = NIL_UUID) {
      return makeStoredProposal({
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId,
        updates: {
          key: 'MARKETING',
          name: 'Marketing',
          description: 'Campaign work',
          sections: [{ key: 'brief', label: 'Brief' }],
          allowedStatuses: ['ACTIVE', 'COMPLETED'],
        },
      });
    }

    it('requires the work-item-types capability before approving a type proposal', async () => {
      const draft = makeWorkItemTypeProposal();
      setupForApproval(draft);
      mockProjectAccess.assertProjectRole.mockResolvedValue('OWNER');
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockResolvedValue(
        { id: createdTypeRowId, runPostCommit: jest.fn() },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockProjectAccess.assertProjectRole).toHaveBeenCalledWith(
        testIds.project,
        approvingUserId,
        'manageWorkItemTypes',
      );
    });

    it('denies a project member approving a type proposal without enacting it', async () => {
      const draft = makeWorkItemTypeProposal();
      setupForApproval(draft);
      mockProjectAccess.assertProjectRole.mockRejectedValue(
        new ForbiddenException('Insufficient permissions'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockPrisma.db.$transaction).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('does not apply the role gate to non-type proposals', async () => {
      setupForApproval(makeStoredProposal());
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      mockProjectAccess.assertProjectRole.mockRejectedValue(
        new ForbiddenException('Insufficient permissions'),
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockProjectAccess.assertProjectRole).not.toHaveBeenCalled();
    });

    it('persists the definition via the registry and anchors resultingEntityId on the new row', async () => {
      const draft = makeWorkItemTypeProposal();
      setupForApproval(draft);
      const runPostCommit = jest.fn().mockResolvedValue(undefined);
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockResolvedValue(
        { id: createdTypeRowId, runPostCommit },
      );

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe(createdTypeRowId);
      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        draft.updates,
        testIds.project,
        testIds.organization,
        undefined,
      );
      expect(
        mockEntityPromptTemplateService.provisionCustomWorkItemTypeTemplateInTransaction,
      ).toHaveBeenCalledWith(expect.anything(), testIds.project, 'MARKETING');
    });

    it('propagates template provisioning failure before post-commit invalidation', async () => {
      const draft = makeWorkItemTypeProposal();
      setupForApproval(draft);
      const runPostCommit = jest.fn().mockResolvedValue(undefined);
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockResolvedValue(
        { id: createdTypeRowId, runPostCommit },
      );
      mockEntityPromptTemplateService.provisionCustomWorkItemTypeTemplateInTransaction.mockRejectedValue(
        new Error('template validation failed'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('template validation failed');
      expect(runPostCommit).not.toHaveBeenCalled();
    });

    it('runs the registry post-commit runner only after the tx commits', async () => {
      const draft = makeWorkItemTypeProposal();
      setupForApproval(draft);
      const callOrder: string[] = [];
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockImplementation(
        async () => {
          callOrder.push('insert');
          return {
            id: createdTypeRowId,
            runPostCommit: async () => {
              callOrder.push('publish');
            },
          };
        },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      // The in-tx insert runs before the post-commit publish — the ordering
      // that keeps other instances from refreshing before the row is visible.
      expect(callOrder).toEqual(['insert', 'publish']);
    });

    it('restores a stable-key CREATE in place without inserting a replacement', async () => {
      const retainedDefinition = {
        key: 'MARKETING',
        name: 'Marketing',
        description: 'Campaign work',
        sections: [{ key: 'brief', label: 'Brief' }],
        allowedStatuses: ['ACTIVE', 'COMPLETED'],
      };
      const draft = makeStoredProposal({
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: 'MARKETING',
        updates: retainedDefinition,
      });
      setupForApproval(draft);
      const runPostCommit = jest.fn().mockResolvedValue(undefined);
      mockWorkItemTypeLifecycle.restoreInTransaction.mockResolvedValue({
        runPostCommit,
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe('MARKETING');
      expect(
        mockWorkItemTypeLifecycle.restoreInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        'MARKETING',
        retainedDefinition,
        testIds.project,
        testIds.organization,
      );
      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(txMock.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { targetEntityId: 'MARKETING' },
        }),
      );
    });
  });

  describe('approve() with work-item type lifecycle proposals', () => {
    const typeKey = 'MARKETING';

    function definition(sections: Array<{ key: string; label: string }> = []) {
      return {
        key: typeKey,
        name: 'Marketing',
        sections,
        allowedStatuses: [],
      };
    }

    function storedDefinition(
      sections: Array<{ key: string; label: string }> = [],
    ) {
      return {
        definition: definition(sections),
        isSystem: false,
        status: 'active',
        projectId: testIds.project,
      };
    }

    it('enacts an accepted edit through the registry', async () => {
      const editedDefinition = definition([{ key: 'brief', label: 'Brief' }]);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: editedDefinition },
      });
      setupForApproval(draft);
      mockWorkItemTypeRegistry.getAcceptedCustomDefinitionInTransaction.mockResolvedValue(
        storedDefinition(),
      );
      mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction.mockResolvedValue(
        {
          runPostCommit: jest.fn().mockResolvedValue(undefined),
        },
      );

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe(typeKey);
      expect(
        mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        typeKey,
        (draft.updates as unknown as { definition: unknown }).definition,
        testIds.project,
        testIds.organization,
      );
    });

    it('rejects an unacknowledged edit when its override was reset before approval', async () => {
      const editedDefinition = definition([{ key: 'brief', label: 'Brief' }]);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: editedDefinition },
      });
      setupForApproval(draft);
      mockWorkItemTypeLifecycle.resolveInTransaction.mockResolvedValue(null);
      txMock.workItemTypeTemplate.findUnique.mockResolvedValue({
        id: 'canonical-template',
        typeKey,
      });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Canonical customization acknowledgement is required.');
      expect(
        mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('resets a canonical override by deleting only its project row', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { resetToCanonical: 'RESET_TO_CANONICAL' },
      });
      setupForApproval(draft);
      txMock.workItemTypeTemplate.findUnique.mockResolvedValue({
        id: 'canonical-template',
      });
      txMock.workItemType.deleteMany.mockResolvedValue({ count: 1 });
      mockWorkItemTypeRegistry.publishConfigChanged.mockResolvedValue(
        undefined,
      );

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(txMock.workItemType.deleteMany).toHaveBeenCalledWith({
        where: { projectId: testIds.project, typeKey },
      });
      expect(
        mockWorkItemTypeRegistry.publishConfigChanged,
      ).toHaveBeenCalledWith(testIds.organization, typeKey, testIds.project);
    });

    it('reclassifies a section drop from stored state without touching item sections', async () => {
      const retainedSection = { key: 'brief', label: 'Brief' };
      const removedSection = { key: 'audience', label: 'Audience' };
      const editedDefinition = definition([retainedSection]);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: editedDefinition },
      });
      setupForApproval(draft);
      mockWorkItemTypeRegistry.getAcceptedCustomDefinitionInTransaction.mockResolvedValue(
        storedDefinition([retainedSection, removedSection]),
      );
      mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction.mockResolvedValue(
        {
          runPostCommit: jest.fn().mockResolvedValue(undefined),
        },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(
        mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        typeKey,
        editedDefinition,
        testIds.project,
        testIds.organization,
      );
      expect(txMock.taskSection).not.toHaveProperty('deleteMany');
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
      expect(txMock.trackingCleanupOperation.create).not.toHaveBeenCalled();
    });

    it('preserves existing TRACKS links when a source type is revoked', async () => {
      const existingDefinition = {
        ...definition(),
        tracking: {
          allowedSourceEntityTypes: ['TASK'],
          allowedSourceTaskTypes: ['BUG', 'FEATURE', 'STANDARD'],
        },
      };
      const editedDefinition = {
        ...definition(),
        tracking: {
          allowedSourceEntityTypes: ['TASK'],
          allowedSourceTaskTypes: ['FEATURE'],
        },
      };
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: editedDefinition },
      });
      setupForApproval(draft);
      mockWorkItemTypeRegistry.getAcceptedCustomDefinitionInTransaction.mockResolvedValue(
        {
          definition: existingDefinition,
          isSystem: false,
          status: 'active',
          projectId: testIds.project,
        },
      );
      mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction.mockResolvedValue(
        { runPostCommit: jest.fn().mockResolvedValue(undefined) },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(txMock.trackingCleanupOperation.create).not.toHaveBeenCalled();
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
    });

    it('runs edit invalidation only after the approval transaction completes', async () => {
      const callOrder: string[] = [];
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: definition() },
      });
      setupForApproval(draft);
      mockWorkItemTypeRegistry.getAcceptedCustomDefinitionInTransaction.mockResolvedValue(
        storedDefinition(),
      );
      mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction.mockImplementation(
        async () => {
          callOrder.push('update');
          return {
            runPostCommit: async () => {
              callOrder.push('invalidate');
            },
          };
        },
      );
      (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const result = await fn(txMock);
          callOrder.push('commit');
          return result;
        },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(callOrder).toEqual(['update', 'commit', 'invalidate']);
    });

    it('enacts an accepted archive through the lifecycle owner', async () => {
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { reason: 'No longer needed' },
      });
      setupForApproval(draft);
      mockWorkItemTypeLifecycle.archiveInTransaction.mockResolvedValue({
        runPostCommit: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe(typeKey);
      expect(
        mockWorkItemTypeLifecycle.archiveInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        typeKey,
        testIds.project,
        testIds.organization,
      );
      expect(
        mockWorkItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
    });

    it('materializes a complete override before archiving a canonical definition', async () => {
      const canonicalDefinition = definition();
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { acknowledgeCanonicalCustomization: true },
      });
      setupForApproval(draft);
      mockWorkItemTypeLifecycle.resolveInTransaction.mockResolvedValue(null);
      txMock.workItemTypeTemplate.findUnique.mockResolvedValue({
        id: 'canonical-template',
        typeKey,
      });
      mockWorkItemTypeRegistry.materializeTemplateDefinition.mockReturnValue(
        canonicalDefinition,
      );
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockResolvedValue(
        {
          id: 'canonical-override',
          runPostCommit: jest.fn().mockResolvedValue(undefined),
        },
      );
      mockWorkItemTypeLifecycle.archiveInTransaction.mockResolvedValue({
        runPostCommit: jest.fn().mockResolvedValue(undefined),
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        canonicalDefinition,
        testIds.project,
        testIds.organization,
      );
      expect(mockWorkItemTypeLifecycle.archiveInTransaction).toHaveBeenCalled();
    });

    it('rejects an unacknowledged archive when its override was reset before approval', async () => {
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { reason: 'No longer needed' },
      });
      setupForApproval(draft);
      mockWorkItemTypeLifecycle.resolveInTransaction.mockResolvedValue(null);
      txMock.workItemTypeTemplate.findUnique.mockResolvedValue({
        id: 'canonical-template',
        typeKey,
      });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Canonical customization acknowledgement is required.');
      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeLifecycle.archiveInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('keeps legacy UPDATE restoration proposals in-place', async () => {
      const retainedDefinition = definition([{ key: 'brief', label: 'Brief' }]);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: { definition: retainedDefinition },
      });
      setupForApproval(draft);
      mockWorkItemTypeLifecycle.resolveInTransaction.mockResolvedValue({
        row: { id: 'retained-row', lifecycleStatus: 'archived' },
        definition: retainedDefinition,
      });
      mockWorkItemTypeLifecycle.restoreInTransaction.mockResolvedValue({
        runPostCommit: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(
        mockWorkItemTypeLifecycle.restoreInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        typeKey,
        retainedDefinition,
        testIds.project,
        testIds.organization,
      );
      expect(
        mockWorkItemTypeRegistry.updateAcceptedDefinitionInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('persists a stable pending cascade execution for an archived custom row', async () => {
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: 2,
          edgeCount: 3,
        },
      });
      setupForApproval(draft);
      txMock.task.findMany.mockResolvedValue([
        { id: 'item-b' },
        { id: 'item-a' },
        { id: 'item-a' },
      ]);
      txMock.workItemTypeCascadeExecution.create.mockResolvedValue({
        id: 'cascade-execution-1',
        workItemIds: ['item-a', 'item-b'],
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(false);
      expect(result.resultingEntityId).toBeNull();
      expect(txMock.workItemTypeCascadeExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposalId,
            organizationId: testIds.organization,
            projectId: testIds.project,
            typeKey,
            workItemIds: ['item-a', 'item-b'],
          }),
        }),
      );
      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
      expect(
        mockTaskService.hardDeleteByTypeInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('does not call Graph while persisting a cascade execution', async () => {
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: 0,
          edgeCount: 0,
        },
      });
      setupForApproval(draft);
      txMock.task.findMany.mockResolvedValue([]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
        'user-token',
      );

      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: EVENT_TYPES.PROPOSAL.APPROVED }),
      );
    });

    it('finalizes captured work items, type, proposal, and execution atomically', async () => {
      const claimToken = 'cascade-claim-token';
      const execution = {
        id: 'cascade-execution-1',
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        typeKey,
        workItemIds: ['item-a', 'item-b'],
        state: 'GRAPH_CLEANED',
        claimToken,
        graphDeletedEdgeCount: 3,
      };
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: 2,
          edgeCount: 3,
        },
      });
      setupForApproval(draft);
      txMock.workItemTypeCascadeExecution.findFirst.mockResolvedValue(
        execution,
      );
      mockTaskService.hardDeleteByIdsInTransaction.mockResolvedValue(2);
      const invalidate = jest.fn().mockResolvedValue(undefined);
      mockWorkItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction.mockResolvedValue(
        { runPostCommit: invalidate },
      );

      await service.finalizeCascadeDeleteExecution(execution.id, claimToken);

      expect(mockTaskService.hardDeleteByIdsInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        testIds.project,
        typeKey,
        ['item-a', 'item-b'],
      );
      expect(txMock.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proposalId },
          data: { status: 'APPROVED' },
        }),
      );
      expect(
        txMock.workItemTypeCascadeExecution.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: execution.id,
            state: 'GRAPH_CLEANED',
            claimToken,
          }),
          data: expect.objectContaining({
            state: 'COMPLETED',
            claimToken: null,
          }),
        }),
      );
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
    });

    it('leaves Graph-cleaned execution durable when final API deletion rolls back', async () => {
      const claimToken = 'cascade-claim-token';
      const execution = {
        id: 'cascade-execution-1',
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        typeKey,
        workItemIds: ['item-a'],
        state: 'GRAPH_CLEANED',
        claimToken,
        graphDeletedEdgeCount: 1,
      };
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: 1,
          edgeCount: 1,
        },
      });
      setupForApproval(draft);
      txMock.workItemTypeCascadeExecution.findFirst.mockResolvedValue(
        execution,
      );
      mockTaskService.hardDeleteByIdsInTransaction.mockRejectedValue(
        new Error('final delete failed'),
      );

      await expect(
        service.finalizeCascadeDeleteExecution(execution.id, claimToken),
      ).rejects.toThrow('final delete failed');
      expect(
        txMock.workItemTypeCascadeExecution.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('rejects finalization when the draft target no longer matches the queued execution', async () => {
      const claimToken = 'cascade-claim-token';
      const execution = {
        id: 'cascade-execution-1',
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        typeKey,
        workItemIds: ['item-a'],
        state: 'GRAPH_CLEANED',
        claimToken,
        graphDeletedEdgeCount: 1,
      };
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: 'OTHER_TYPE',
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey: 'OTHER_TYPE',
          itemCount: 1,
          edgeCount: 1,
        },
      });
      setupForApproval(draft);
      txMock.workItemTypeCascadeExecution.findFirst.mockResolvedValue(
        execution,
      );

      await expect(
        service.finalizeCascadeDeleteExecution(execution.id, claimToken),
      ).rejects.toThrow('target no longer matches');
      expect(
        mockTaskService.hardDeleteByIdsInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('rejects malformed cascade payload before destructive work begins', async () => {
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: -1,
          edgeCount: 3,
        },
      });
      setupForApproval(draft);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'token',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockWorkItemTypeRegistry.assertCustomDefinitionDeletableInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
      expect(
        mockTaskService.hardDeleteByTypeInTransaction,
      ).not.toHaveBeenCalled();
    });

    it.each(['missing', 'system'])(
      'rejects a %s cascade target before graph or database deletes',
      async () => {
        const draft = makeStoredProposal({
          action: 'DELETE',
          targetEntityType: 'WORK_ITEM_TYPE',
          targetEntityId: typeKey,
          updates: {
            operation: 'CASCADE_DELETE',
            cascade: true,
            typeKey,
            itemCount: 2,
            edgeCount: 3,
          },
        });
        setupForApproval(draft);
        mockWorkItemTypeRegistry.assertCustomDefinitionDeletableInTransaction.mockRejectedValue(
          new BadRequestException('Custom type is unavailable'),
        );

        await expect(
          service.approve(
            proposalId,
            testIds.organization,
            testIds.project,
            approvingUserId,
            'token',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(
          mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
        ).not.toHaveBeenCalled();
        expect(
          mockTaskService.hardDeleteByTypeInTransaction,
        ).not.toHaveBeenCalled();
        expect(
          mockWorkItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction,
        ).not.toHaveBeenCalled();
      },
    );
  });

  describe('approve() with CREATE + CONVERSATION (plan-from-design-doc)', () => {
    const NIL_UUID = '00000000-0000-0000-0000-000000000000';
    const createdConversationId = '123e4567-e89b-42d3-a456-426614174777';
    const createdPlanId = '123e4567-e89b-42d3-a456-426614174555';
    const createdDesignDocId = '123e4567-e89b-42d3-a456-426614174666';
    const createdAgentSessionId = '123e4567-e89b-42d3-a456-426614174999';
    const parentFeatureId = '123e4567-e89b-42d3-a456-426614174888';

    function makeConversationProposal() {
      return makeStoredProposal({
        targetEntityType: 'CONVERSATION',
        targetEntityId: NIL_UUID,
        updates: {
          designDocMarkdown: '# Plan\n\nDoc body',
          planTitle: 'Ship the importer',
          parentFeatureId,
          workflowName: 'plan-from-design-doc',
        },
      });
    }

    function setupMaterializeMocks() {
      mockDesignDocService.createInTransaction.mockResolvedValue({
        id: createdDesignDocId,
      });
      // Plan + agent session + conversation birth + bind is delegated to the
      // launcher, which has its own unit test
      // (plan-from-design-doc-launcher.service.test.ts). Here we only assert
      // the enactor materializes the doc and hands the right seed to it.
      mockPlanFromDesignDocLauncher.materializeRunInTransaction.mockResolvedValue(
        {
          planId: createdPlanId,
          agentSessionId: createdAgentSessionId,
          conversationId: createdConversationId,
        },
      );
    }

    it('materializes the design doc and delegates run birth to the launcher, deferring autostart', async () => {
      const draft = makeConversationProposal();
      setupForApproval(draft);
      setupMaterializeMocks();

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(createdConversationId);
      expect(result.proposal.status).toBe('APPROVED');
      expect(result.enacted).toBe(true);

      // Design doc gets created in-tx with the markdown body and PLAN_DOCUMENT
      // template — same shape the deleted MATERIALIZE workflow node used. This
      // stays in the enactor: it is the one piece the relaunch path resolves
      // differently (it reuses a preserved doc instead of creating one).
      expect(mockDesignDocService.createInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Ship the importer',
          template: 'PLAN_DOCUMENT',
          status: 'READY',
          projectId: testIds.project,
          organizationId: testIds.organization,
          sections: [
            expect.objectContaining({
              key: 'content',
              content: '# Plan\n\nDoc body',
            }),
          ],
          parentEntityType: 'TASK',
          parentEntityId: parentFeatureId,
        }),
      );

      // Plan + agent session + NOT_STARTED conversation + bind are delegated to
      // the launcher with the just-created design doc id and the create_plan
      // seed. The detailed birth sequence is asserted in the launcher's own
      // test; here we only pin the seam contract.
      expect(
        mockPlanFromDesignDocLauncher.materializeRunInTransaction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          designDocId: createdDesignDocId,
          designDocMarkdown: '# Plan\n\nDoc body',
          planTitle: 'Ship the importer',
          parentFeatureId,
          requestorId: testIds.user,
          projectId: testIds.project,
          organizationId: testIds.organization,
        }),
      );

      // Workflow autostart is deferred: the launcher births the conversation in
      // NOT_STARTED and the enactor leaves it dormant. The consuming surface
      // (POST /conversations/{id}/start) starts it when the user is ready.
      expect(
        mockConversationWorkflowService.startWorkflowOnExistingConversation,
      ).not.toHaveBeenCalled();
    });

    it('publishes proposal.approved with the materialized conversation id as targetEntityId, not the NIL_UUID placeholder', async () => {
      const draft = makeConversationProposal();
      setupForApproval(draft);
      setupMaterializeMocks();

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      // The proposal is stored with targetEntityId = NIL_UUID because the
      // conversation does not exist at creation time. Enactment creates the
      // conversation and rewrites the column — the emitted event must carry
      // that real id so downstream consumers (e.g. the graph service) can
      // resolve the target entity instead of choking on the zero UUID.
      const approvedCall =
        mockEventPublisher.publishInTransaction.mock.calls.find(
          ([, e]) => e.type === EVENT_TYPES.PROPOSAL.APPROVED,
        )!;
      const payload = approvedCall[1].payload as ProposalApprovedEventPayload;
      expect(payload.targetEntityId).toBe(createdConversationId);
      expect(payload.targetEntityId).not.toBe(NIL_UUID);
      expect(payload.resultingEntityId).toBe(createdConversationId);
    });

    it('rejects a PlanFromDesignDoc proposal when parentFeatureId is not set', async () => {
      const draft = makeConversationProposal();
      delete (draft.updates as Record<string, unknown>).parentFeatureId;
      setupForApproval(draft);
      setupMaterializeMocks();

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(/parentFeatureId is required/);
      expect(mockDesignDocService.createInTransaction).not.toHaveBeenCalled();
      expect(
        mockPlanFromDesignDocLauncher.materializeRunInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('rejects unknown workflowName loudly without materializing anything', async () => {
      const draft = makeConversationProposal();
      (draft.updates as Record<string, unknown>).workflowName =
        'plan-generation';
      setupForApproval(draft);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(/Unsupported workflowName/);

      expect(mockDesignDocService.createInTransaction).not.toHaveBeenCalled();
      expect(
        mockPlanFromDesignDocLauncher.materializeRunInTransaction,
      ).not.toHaveBeenCalled();
      expect(
        mockConversationWorkflowService.startWorkflowOnExistingConversation,
      ).not.toHaveBeenCalled();
    });

    it('aborts enactment with no events or workflow start when the launcher throws', async () => {
      const draft = makeConversationProposal();
      setupForApproval(draft);
      mockDesignDocService.createInTransaction.mockResolvedValue({
        id: createdDesignDocId,
      });
      // The launcher owns plan/session/conversation birth + the concurrent-
      // attach ConflictException guard (asserted in its own test). From the
      // enactor's side, any launcher failure must roll back the whole approval:
      // no proposal.approved event escapes, no workflow autostart fires.
      mockPlanFromDesignDocLauncher.materializeRunInTransaction.mockRejectedValue(
        new ConflictException('agent session already has a conversation'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        mockConversationWorkflowService.startWorkflowOnExistingConversation,
      ).not.toHaveBeenCalled();
      const publishedTypes =
        mockEventPublisher.publishInTransaction.mock.calls.map(
          (call: unknown[]) => (call[1] as { type: string }).type,
        );
      expect(publishedTypes).not.toContain(EVENT_TYPES.PROPOSAL.APPROVED);
    });
  });

  describe('approve() with UPDATE + TASK', () => {
    it('rejects an out-of-date approval before recording a vote', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetLastAppliedProposalId: 'older-proposal-id',
      });
      setupForApproval(draft, {
        taskLookup: {
          type: 'TASK',
          parentTaskId: 'some-parent',
          lastAppliedProposalId: 'newer-proposal-id',
        },
      });

      (
        service as unknown as {
          reconciliation: { assertApplicable: jest.Mock };
        }
      ).reconciliation.assertApplicable.mockRejectedValueOnce(
        new ConflictException('Reconciliation is required.'),
      );
      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Reconciliation is required.');
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
    });

    it('does not let acknowledgement bypass the shared reconciliation owner', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetLastAppliedProposalId: 'older-proposal-id',
      });
      setupForApproval(draft, {
        taskLookup: {
          type: 'TASK',
          parentTaskId: 'some-parent',
          lastAppliedProposalId: 'newer-proposal-id',
        },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const reconciliation = (
        service as unknown as {
          reconciliation: { assertApplicable: jest.Mock };
        }
      ).reconciliation;
      reconciliation.assertApplicable.mockRejectedValueOnce(
        new ConflictException('Reconciliation is required.'),
      );
      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          null,
          true,
        ),
      ).rejects.toThrow('Reconciliation is required.');
      expect(reconciliation.assertApplicable).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({ id: proposalId }),
        undefined,
        true,
      );
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('applies section updates to existing task', async () => {
      const sectionUpdates = {
        sections: [
          { key: 'description', content: 'Updated description' },
          { key: 'acceptanceCriteria', content: 'Updated AC' },
        ],
        sectionUpdateSource: 'AGENT_SUGGESTED',
      };
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: sectionUpdates,
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(testIds.task);
      expect(result.proposal.status).toBe('APPROVED');
      expect(result.enacted).toBe(true);

      expect(mockTaskService.updateInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        null,
        testIds.task,
        sectionUpdates,
        testIds.user,
      );
      // postCommit hooks fire after the outer tx commits
      expect(mockTaskService.runUpdatePostCommit).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        {},
      );
      expect(txMock.task.update).toHaveBeenCalledWith({
        where: { id: testIds.task },
        data: { lastAppliedProposalId: proposalId },
      });
    });

    it('publishes proposal.approved event for UPDATE proposals', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: {
          sections: [{ key: 'description', content: 'New content' }],
        },
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      const [, event] = mockEventPublisher.publishInTransaction.mock.calls[0]!;
      expect(event.type).toBe(EVENT_TYPES.PROPOSAL.APPROVED);

      const payload = event.payload as ProposalApprovedEventPayload;
      expect(payload.resultingEntityId).toBe(testIds.task);
      expect(payload.action).toBe('UPDATE');
    });

    // Graph contract test for PROPOSED_TOGETHER derivation. The Graph service
    // materializes a (:Proposal)-[:AUTHORED_IN]->(:Message) edge from the
    // approved-event payload and walks Proposal → Message → Proposal → Target
    // to surface PROPOSED_TOGETHER between target entities co-authored in the
    // same message context. This asserts the publisher hands the Graph the
    // fields that traversal depends on: proposalId, messageId, conversationId,
    // the materialized targetEntityId, and the influences[] list whose entity
    // ids become the other endpoints of the symmetric edge.
    it('publishes proposal.approved event with messageId, conversationId, and ≥2 influences for Graph traversal', async () => {
      const otherInfluenceTaskId = '123e4567-e89b-42d3-a456-426614174201';
      const otherInfluenceDesignDocId = '123e4567-e89b-42d3-a456-426614174202';

      const draft = makeStoredProposal({
        action: 'UPDATE',
        conversationId: testIds.conversation,
        messageId: testIds.message,
        updates: {
          sections: [{ key: 'description', content: 'New content' }],
        },
        influences: [
          {
            entityId: otherInfluenceTaskId,
            entityType: 'TASK',
            reasoning: 'Co-authored sibling task surfaced in the same message',
            reasonType: 'explicit_mention',
          },
          {
            entityId: otherInfluenceDesignDocId,
            entityType: 'DESIGN_DOC',
            reasoning:
              'Co-authored sibling design doc surfaced in the same message',
            reasonType: 'explicit_mention',
          },
        ],
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      const [, event] = mockEventPublisher.publishInTransaction.mock.calls[0]!;
      expect(event.type).toBe(EVENT_TYPES.PROPOSAL.APPROVED);
      expect(event.aggregateId).toBe(proposalId);

      const payload = event.payload as ProposalApprovedEventPayload;
      expect(payload.proposalId).toBe(proposalId);
      expect(payload.organizationId).toBe(testIds.organization);
      expect(payload.projectId).toBe(testIds.project);
      // The Graph reads messageId to MERGE the (:Proposal)-[:AUTHORED_IN]->
      // (:Message) edge. conversationId travels with it as the on-demand
      // Message ensure-helper falls back to it when the Message node does
      // not yet exist.
      expect(payload.messageId).toBe(testIds.message);
      expect(payload.conversationId).toBe(testIds.conversation);
      // targetEntityId is the live entity id (testIds.task), never the
      // proposal node id. For UPDATE this is just proposal.targetEntityId;
      // for CREATE the approve() flow rewrites it from NIL_UUID to the
      // materialized id before publish.
      expect(payload.targetEntityId).toBe(testIds.task);
      expect(payload.resultingEntityId).toBe(testIds.task);
      expect(payload.targetEntityType).toBe('TASK');
      expect(payload.action).toBe('UPDATE');
      // The Graph traversal joins on each influence.entityId. ≥2 influences
      // is what produces a real co-authored cohort on the other side of the
      // Message; one influence would just round-trip to the target itself.
      expect(payload.influences).toHaveLength(2);
      expect(payload.influences?.map((i) => i.entityId)).toEqual([
        otherInfluenceTaskId,
        otherInfluenceDesignDocId,
      ]);
      expect(payload.influences?.map((i) => i.entityType)).toEqual([
        'TASK',
        'DESIGN_DOC',
      ]);
    });

    it('rolls back when task update fails', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: {
          sections: [{ key: 'description', content: 'New content' }],
        },
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockRejectedValue(
        new Error('Task update failed'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Task update failed');

      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      // Post-commit work must NOT run when the tx rolled back — atomicity
      // guarantee is the whole point of routing the entity write through
      // taskService.updateInTransaction.
      expect(mockTaskService.runUpdatePostCommit).not.toHaveBeenCalled();
    });
  });

  describe('approve() with UPDATE + DESIGN_DOC', () => {
    it('allows the user author to explicitly approve a design doc update', async () => {
      const docUpdates = {
        name: 'Updated ADR',
        sections: [{ key: 'context', content: 'Updated context' }],
      };
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
        updates: docUpdates,
        requestorId: approvingUserId,
        requestorContext: {
          source: 'user',
          userId: approvingUserId,
          organizationId: testIds.organization,
          toolName: 'PATCH /design-docs',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      });
      setupForApproval(draft);
      mockDesignDocService.updateInTransaction.mockResolvedValue({
        response: { id: testIds.designDoc },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe(testIds.designDoc);
      expect(mockDesignDocService.updateInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.designDoc,
        docUpdates,
        testIds.organization,
        approvingUserId,
      );
    });

    it('applies updates to existing design doc', async () => {
      const docUpdates = {
        name: 'Updated ADR',
        sections: [{ key: 'context', content: 'Updated context' }],
      };
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
        updates: docUpdates,
      });
      setupForApproval(draft);
      mockDesignDocService.updateInTransaction.mockResolvedValue({
        response: { id: testIds.designDoc },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(testIds.designDoc);
      expect(mockDesignDocService.updateInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.designDoc,
        docUpdates,
        testIds.organization,
        testIds.user,
      );
      expect(mockDesignDocService.runUpdatePostCommit).toHaveBeenCalledWith(
        testIds.organization,
        testIds.designDoc,
        {},
      );
    });
  });

  describe('approve() with DELETE + TASK / DESIGN_DOC', () => {
    it('archives the task via removeInTransaction on DELETE + TASK', async () => {
      const draft = makeStoredProposal({ action: 'DELETE' });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
      expect(result.resultingEntityId).toBe(testIds.task);
      expect(mockTaskService.removeInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        testIds.task,
      );

      // The proposal.approved event is published and carries the DELETE action.
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      const [, event] = mockEventPublisher.publishInTransaction.mock.calls[0]!;
      expect(event.type).toBe(EVENT_TYPES.PROPOSAL.APPROVED);
      expect((event.payload as ProposalApprovedEventPayload).action).toBe(
        'DELETE',
      );
    });

    it('archives the design doc and defers dependency archival to post-commit on DELETE + DESIGN_DOC', async () => {
      const runPostCommit = jest.fn().mockResolvedValue(undefined);
      mockDesignDocService.removeInTransaction.mockResolvedValue({
        runPostCommit,
      });
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
      });
      setupForApproval(draft);

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.resultingEntityId).toBe(testIds.designDoc);
      expect(mockDesignDocService.removeInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.designDoc,
        testIds.organization,
      );
      // Dependency archival runs only after the proposal tx commits.
      expect(runPostCommit).toHaveBeenCalledTimes(1);
    });

    it('does not publish proposal.approved when DELETE enactment fails', async () => {
      mockDesignDocService.removeInTransaction.mockRejectedValue(
        new Error('archive failed'),
      );
      const draft = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
      });
      setupForApproval(draft);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('archive failed');
      // Enactment throws before publishApprovedEvent — the tx rolls back.
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('approve() body-mention emission', () => {
    const mentionedTaskId = '123e4567-e89b-42d3-a456-426614174201';
    const mentionedDesignDocId = '123e4567-e89b-42d3-a456-426614174202';

    type MentionEventCall = {
      type: 'mention.created' | 'mention.removed';
      aggregateId: string;
      payload: MentionCreatedEventPayload | MentionRemovedEventPayload;
    };
    const standardSectionDefinitions = [
      { key: 'description', label: 'Description', kind: 'markdown' },
      {
        key: 'acceptanceCriteria',
        label: 'Acceptance criteria',
        kind: 'markdown',
      },
    ];

    function taskBody(
      sections: Array<{ key: string; materializedMarkdown: string | null }>,
      type = 'STANDARD',
    ) {
      return { type, projectId: testIds.project, sections };
    }

    function useSectionDefinitions(sectionDefinitions: unknown[]): void {
      mockWorkItemTypeRegistry.getSectionDefinitions.mockReturnValue(
        sectionDefinitions,
      );
    }

    beforeEach(() => {
      useSectionDefinitions(standardSectionDefinitions);
    });

    function mentionEvents(): MentionEventCall[] {
      return mockEventPublisher.publishInTransaction.mock.calls
        .map((call) => call[1] as { type: string })
        .filter(
          (event) =>
            event.type === EVENT_TYPES.MENTION.CREATED ||
            event.type === EVENT_TYPES.MENTION.REMOVED,
        ) as MentionEventCall[];
    }

    it('emits one mention.created per validated mention on CREATE+TASK', async () => {
      const draft = makeStoredProposal({
        updates: {
          name: 'New task',
          sections: [
            {
              key: 'description',
              content: `Refers to @[task:${mentionedTaskId}|Other task]`,
            },
            {
              key: 'acceptanceCriteria',
              content: `Also @[design-doc:${mentionedDesignDocId}|ADR]`,
            },
          ],
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      txMock.task.findUnique.mockResolvedValue(
        taskBody([
          {
            key: 'description',
            materializedMarkdown: `Refers to @[task:${mentionedTaskId}|Other task]`,
          },
          {
            key: 'acceptanceCriteria',
            materializedMarkdown: `Also @[design-doc:${mentionedDesignDocId}|ADR]`,
          },
        ]),
      );
      mockMentionProcessingService.extractAndValidate.mockResolvedValue([
        { entityId: mentionedTaskId, entityType: 'TASK' },
        { entityId: mentionedDesignDocId, entityType: 'DESIGN_DOC' },
      ]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      const mentions = mentionEvents();
      expect(mentions).toHaveLength(2);
      expect(mentions[0]!.type).toBe(EVENT_TYPES.MENTION.CREATED);
      expect(mentions[0]!.payload.sourceEntityId).toBe(createdTaskId);
      expect(mentions[0]!.payload.sourceEntityType).toBe('TASK');
      expect(mentions.map((m: any) => m.payload.entityId).sort()).toEqual(
        [mentionedTaskId, mentionedDesignDocId].sort(),
      );
    });

    it('emits added + removed events on UPDATE+TASK based on prior/new diff', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: {
          sections: [
            {
              key: 'description',
              content: `Now references @[task:${mentionedDesignDocId}|New target]`,
            },
          ],
        },
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      // Prior body had mentionedTaskId; new body has mentionedDesignDocId.
      // The two task reads (prior snapshot, then post-enact snapshot) each
      // return a different content set.
      txMock.task.findUnique
        .mockResolvedValueOnce(
          taskBody([
            {
              key: 'description',
              materializedMarkdown: `Old: @[task:${mentionedTaskId}|Old target]`,
            },
          ]),
        )
        .mockResolvedValueOnce(
          taskBody([
            {
              key: 'description',
              materializedMarkdown: `New: @[task:${mentionedDesignDocId}|New target]`,
            },
          ]),
        );
      mockMentionProcessingService.extractAndValidate
        .mockResolvedValueOnce([
          { entityId: mentionedTaskId, entityType: 'TASK' },
        ])
        .mockResolvedValueOnce([
          { entityId: mentionedDesignDocId, entityType: 'TASK' },
        ]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      const mentions = mentionEvents();
      const created = mentions.filter(
        (m: any) => m.type === EVENT_TYPES.MENTION.CREATED,
      );
      const removed = mentions.filter(
        (m: any) => m.type === EVENT_TYPES.MENTION.REMOVED,
      );
      expect(created).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(created[0]!.payload.entityId).toBe(mentionedDesignDocId);
      expect(removed[0]!.payload.entityId).toBe(mentionedTaskId);
      expect(created[0]!.payload.sourceEntityId).toBe(testIds.task);
    });

    it('emits mention events on CREATE+DESIGN_DOC across all sections', async () => {
      const draft = makeStoredProposal({
        targetEntityType: 'DESIGN_DOC',
        targetEntityId: testIds.designDoc,
        updates: {
          name: 'New ADR',
          template: 'ADR',
          projectId: testIds.project,
        },
      });
      setupForApproval(draft);
      mockDesignDocService.createInTransaction.mockResolvedValue({
        id: createdDesignDocId,
      });
      txMock.designDocSection.findMany.mockResolvedValue([
        {
          materializedMarkdown: `Context: @[task:${mentionedTaskId}|task]`,
        },
        {
          materializedMarkdown: 'Decision: keep simple',
        },
      ]);
      mockMentionProcessingService.extractAndValidate.mockResolvedValue([
        { entityId: mentionedTaskId, entityType: 'TASK' },
      ]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      const mentions = mentionEvents();
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.payload.sourceEntityId).toBe(createdDesignDocId);
      expect(mentions[0]!.payload.sourceEntityType).toBe('DESIGN_DOC');
      expect(mentions[0]!.payload.entityId).toBe(mentionedTaskId);
    });

    it('de-dups against declared edges so the agent cannot double-emit', async () => {
      const draft = makeStoredProposal({
        updates: {
          name: 'New task',
          sections: [
            {
              key: 'description',
              content: `Belt and braces: @[task:${mentionedTaskId}|already declared]`,
            },
          ],
        },
      });
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      txMock.task.findUnique.mockResolvedValue(
        taskBody([
          {
            key: 'description',
            materializedMarkdown: `Belt and braces: @[task:${mentionedTaskId}|already declared]`,
          },
        ]),
      );
      mockMentionProcessingService.extractAndValidate.mockResolvedValue([
        { entityId: mentionedTaskId, entityType: 'TASK' },
      ]);
      // Pretend the agent also declared a RELATED_TO edge to the same target.
      mockPendingEdgeService.processDeclaredEdges.mockResolvedValue([
        {
          sourceEntityId: createdTaskId,
          targetEntityId: mentionedTaskId,
          edgeType: 'RELATED_TO',
        },
      ]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      const mentions = mentionEvents();
      expect(mentions).toHaveLength(0);
    });

    function scannedContent(): string {
      const calls = mockMentionProcessingService.extractAndValidate.mock.calls;
      return calls[calls.length - 1]![0] as string;
    }

    async function approveTaskCreate(
      sections: Array<{ key: string; materializedMarkdown: string | null }>,
      type?: string,
    ): Promise<void> {
      setupForApproval(makeStoredProposal({ updates: { name: 'New task' } }));
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      txMock.task.findUnique.mockResolvedValue(taskBody(sections, type));
      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );
    }

    it('scans every markdown section the work-item type defines', async () => {
      useSectionDefinitions([
        ...standardSectionDefinitions,
        { key: 'risks', label: 'Risks', kind: 'markdown' },
      ]);

      await approveTaskCreate([
        { key: 'description', materializedMarkdown: 'Plain description' },
        {
          key: 'risks',
          materializedMarkdown: `Blocked by @[task:${mentionedTaskId}|Other]`,
        },
      ]);

      expect(scannedContent()).toContain(`@[task:${mentionedTaskId}|Other]`);
      expect(scannedContent()).toContain('Plain description');
    });

    it('skips non-prose sections and rows the type does not define', async () => {
      useSectionDefinitions([
        ...standardSectionDefinitions,
        {
          key: 'diagram',
          label: 'Diagram',
          kind: 'json',
          schemaRef: '#/components/schemas/DiagramMetadata',
        },
        { key: 'mockup', label: 'Mockup', kind: 'html/css' },
      ]);

      await approveTaskCreate([
        { key: 'description', materializedMarkdown: 'Kept' },
        {
          key: 'diagram',
          materializedMarkdown: `{"label":"@[task:${mentionedTaskId}|x]"}`,
        },
        {
          key: 'mockup',
          materializedMarkdown: `{"html":"@[task:${mentionedTaskId}|x]"}`,
        },
        {
          key: 'retired',
          materializedMarkdown: `@[task:${mentionedTaskId}|x]`,
        },
      ]);

      expect(scannedContent()).toBe('Kept');
    });

    it('scans only requirement statements for FEATURE requirements', async () => {
      useSectionDefinitions([
        { key: 'description', label: 'Description', kind: 'markdown' },
        { key: 'requirements', label: 'Requirements', kind: 'json' },
      ]);

      await approveTaskCreate(
        [
          {
            key: 'requirements',
            materializedMarkdown: JSON.stringify({
              records: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  statement: `Works with @[task:${mentionedTaskId}|Types]`,
                  group: 'Core',
                  designedBy: [],
                  fulfilledBy: [
                    {
                      entityType: 'TASK',
                      entityId: mentionedDesignDocId,
                      entityTitle: 'Impl',
                    },
                  ],
                  contracts: [],
                },
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  statement: 'Unlinked statement',
                  designedBy: [],
                  fulfilledBy: [],
                  contracts: [],
                },
              ],
            }),
          },
        ],
        'FEATURE',
      );

      expect(scannedContent()).toBe(
        `Works with @[task:${mentionedTaskId}|Types]\nUnlinked statement`,
      );
    });

    it('fails the approval when the task type is missing from the registry', async () => {
      mockWorkItemTypeRegistry.getSectionDefinitions.mockImplementation(() => {
        throw new Error(
          "Work-item type 'STANDARD' is not present in the registry for project.",
        );
      });

      await expect(
        approveTaskCreate([
          {
            key: 'description',
            materializedMarkdown: `@[task:${mentionedTaskId}|x]`,
          },
        ]),
      ).rejects.toThrow('is not present in the registry');
      expect(
        mockMentionProcessingService.extractAndValidate,
      ).not.toHaveBeenCalled();
      expect(mentionEvents()).toHaveLength(0);
    });
  });

  describe('approve() requirement citation edges', () => {
    const designDocId = '123e4567-e89b-42d3-a456-426614174301';
    const taskId = '123e4567-e89b-42d3-a456-426614174302';
    const contractId = '123e4567-e89b-42d3-a456-426614174303';

    function requirementsContent(
      records: Array<{
        designedBy?: string[];
        fulfilledBy?: string[];
        contracts?: string[];
      }>,
    ): string {
      return JSON.stringify({
        records: records.map((record, index) => ({
          id: `11111111-1111-4111-8111-11111111111${index}`,
          statement: `Statement ${index}`,
          designedBy: (record.designedBy ?? []).map((entityId) => ({
            entityType: 'DESIGN_DOC',
            entityId,
            entityTitle: 'Design',
          })),
          fulfilledBy: (record.fulfilledBy ?? []).map((entityId) => ({
            entityType: 'TASK',
            entityId,
            entityTitle: 'Task',
          })),
          contracts: (record.contracts ?? []).map((entityId) => ({
            entityType: 'CONTRACT',
            entityId,
            entityTitle: 'Contract',
          })),
        })),
      });
    }

    // Body-mention reads select every section; the citation read narrows the
    // relation to the requirements section.
    function stubEnactedFeature(content: string, type = 'FEATURE'): void {
      txMock.task.findUnique.mockImplementation(
        (args: { select?: { sections?: { where?: unknown } } }) =>
          Promise.resolve(
            args.select?.sections?.where
              ? { type, sections: [{ materializedMarkdown: content }] }
              : { type, projectId: testIds.project, sections: [] },
          ),
      );
    }

    function citationEdges(): Array<Record<string, unknown>> {
      return mockPendingEdgeService.materializeRequirementCitationEdges.mock.calls.flatMap(
        (call) => call[2] as Array<Record<string, unknown>>,
      );
    }

    it('creates one DEPENDS_ON edge per cited entity on a legacy FEATURE create', async () => {
      const content = requirementsContent([
        { designedBy: [designDocId], fulfilledBy: [taskId] },
        { fulfilledBy: [taskId], contracts: [contractId] },
      ]);
      setupForApproval(
        makeStoredProposal({
          updates: {
            name: 'Feature',
            type: 'FEATURE',
            initialRequirements: [{ statement: 'Statement 0' }],
          },
        }),
      );
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      stubEnactedFeature(content);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(citationEdges()).toEqual([
        {
          id: requirementCitationEdgeId(createdTaskId, designDocId),
          featureId: createdTaskId,
          entityId: designDocId,
          entityType: 'DESIGN_DOC',
        },
        expect.objectContaining({
          id: requirementCitationEdgeId(createdTaskId, taskId),
          entityId: taskId,
          entityType: 'TASK',
        }),
        expect.objectContaining({
          id: requirementCitationEdgeId(createdTaskId, contractId),
          entityId: contractId,
          entityType: 'TASK',
        }),
      ]);
      expect(mockPendingEdgeService.deleteEdgesById).not.toHaveBeenCalled();
    });

    it('deletes only the requirements-derived edge of an uncited entity after commit', async () => {
      setupForApproval(
        makeStoredProposal({
          action: 'UPDATE',
          updates: { requirementOps: [] },
        }),
        { taskLookup: { type: 'FEATURE', parentTaskId: 'some-parent' } },
      );
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });
      txMock.taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: requirementsContent([
          { fulfilledBy: [taskId], contracts: [contractId] },
        ]),
      });
      stubEnactedFeature(requirementsContent([{ fulfilledBy: [taskId] }]));
      // A declared DEPENDS_ON to the uncited contract is independent.
      mockPendingEdgeService.processDeclaredEdges.mockResolvedValue([
        {
          sourceEntityId: testIds.task,
          sourceEntityType: 'TASK',
          targetEntityId: contractId,
          targetEntityType: 'TASK',
          edgeType: 'DEPENDS_ON',
        },
      ]);

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(citationEdges()).toEqual([]);
      expect(mockPendingEdgeService.materializeEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.arrayContaining([
          expect.objectContaining({
            targetEntityId: contractId,
            edgeType: 'DEPENDS_ON',
          }),
        ]),
        null,
      );
      expect(mockPendingEdgeService.deleteEdgesById).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [requirementCitationEdgeId(testIds.task, contractId)],
        expect.any(String),
      );
    });

    it('fails the approval transaction when a newly cited edge cannot be written', async () => {
      setupForApproval(
        makeStoredProposal({
          action: 'UPDATE',
          updates: { requirementOps: [] },
        }),
        { taskLookup: { type: 'FEATURE', parentTaskId: 'some-parent' } },
      );
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });
      txMock.taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: requirementsContent([]),
      });
      stubEnactedFeature(requirementsContent([{ fulfilledBy: [taskId] }]));
      mockPendingEdgeService.materializeRequirementCitationEdges.mockRejectedValue(
        new Error('Graph unavailable'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Graph unavailable');
      expect(mockTaskService.runUpdatePostCommit).not.toHaveBeenCalled();
      expect(mockPendingEdgeService.materializeEdges).not.toHaveBeenCalled();
      expect(
        mockPendingEdgeService.rollbackMaterializedEdges,
      ).toHaveBeenCalled();
    });

    it('derives no citation edges for non-FEATURE targets', async () => {
      setupForApproval(
        makeStoredProposal({
          updates: {
            name: 'Task',
            sections: [{ key: 'requirements', content: '{"records":[]}' }],
          },
        }),
      );
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });
      stubEnactedFeature(
        requirementsContent([{ fulfilledBy: [taskId] }]),
        'STANDARD',
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(citationEdges()).toEqual([]);
    });
  });

  describe('UX flow review and approval integration', () => {
    it.each(
      ['edit', 'create', 'transition'].flatMap((change) =>
        [true, false].map((keepReference) => ({ change, keepReference })),
      ),
    )(
      'validates $change during review and approval (valid: $keepReference)',
      async ({ change, keepReference }) => {
        const diagramId = '81818181-8181-4181-8181-818181818181';
        const screenId = '82828282-8282-4282-8282-828282828282';
        const mockupId = '84848484-8484-4484-8484-848484848484';
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'mockup',
            projectId: testIds.project,
            capabilities: { requiresParent: false },
            sectionDefinitions: [],
          },
          {
            typeKey: 'DIAGRAM',
            projectId: testIds.project,
            capabilities: { requiresParent: false },
            sectionDefinitions: [
              {
                key: 'diagramMetadata',
                label: 'Diagram',
                kind: 'json',
                schemaRef: '#/components/schemas/DiagramMetadata',
              },
            ],
          },
          {
            typeKey: 'DIAGRAM_ELEMENT',
            projectId: testIds.project,
            allowedParentTypes: ['DIAGRAM'],
            capabilities: { requiresParent: true },
            sectionDefinitions: [
              {
                key: 'diagramElementMetadata',
                label: 'Element',
                kind: 'json',
                schemaRef: '#/components/schemas/DiagramElementMetadata',
                diagramElementPolicy: {
                  roles: [
                    { key: 'GENERIC', label: 'Generic', notation: 'box' },
                    {
                      key: 'DIAGRAM_REFERENCE',
                      label: 'Diagram',
                      notation: 'frame',
                    },
                  ],
                  referenceTargets: [
                    { entityType: 'TASK' },
                    { entityType: 'SERVICE' },
                  ],
                },
              },
            ],
          },
        ]);
        const parentage = new WorkItemParentageValidator(registry);
        const rows = [
          {
            id: diagramId,
            name: 'Onboarding',
            type: 'DIAGRAM',
            parentTaskId: null,
            parentTask: null,
            sections: [
              {
                key: 'diagramMetadata',
                materializedMarkdown: JSON.stringify({
                  kind: 'UX_FLOW',
                  level: 'OVERVIEW',
                }),
              },
            ],
          },
          {
            id: screenId,
            name: 'Welcome',
            type: 'DIAGRAM_ELEMENT',
            parentTaskId: diagramId,
            parentTask: { type: 'DIAGRAM' },
            sections: [
              {
                key: 'diagramElementMetadata',
                materializedMarkdown: JSON.stringify({
                  role: 'GENERIC',
                  canonicalReference: {
                    entityType: 'TASK',
                    entityId: mockupId,
                  },
                }),
              },
            ],
          },
          {
            id: mockupId,
            name: 'Welcome mockup',
            type: 'mockup',
            parentTaskId: null,
            parentTask: null,
            sections: [],
          },
        ].map((row) => ({
          ...row,
          status: 'ACTIVE',
          priority: null,
          dueDate: null,
          assigneeId: null,
          tag: null,
          serviceRelations: [],
        }));
        (mockPrisma.db.task.findMany as jest.Mock).mockImplementation(
          async ({ where }) =>
            rows.filter(
              (row) =>
                where.id === row.id ||
                where.id?.in?.includes(row.id) ||
                (where.parentTaskId && row.parentTaskId === where.parentTaskId),
            ),
        );
        const boundaryModule = await Test.createTestingModule({
          providers: [
            { provide: PrismaService, useValue: mockPrisma },
            {
              provide: AgentEdgeClientService,
              useValue: { findIncident: async () => [] },
            },
          ],
        }).compile();
        const prisma = boundaryModule.get(PrismaService);
        const projector = new WorkItemChangeSetProjectorService(
          prisma,
          registry,
          parentage,
          boundaryModule.get(AgentEdgeClientService),
          serviceTokenFactory,
        );
        const engine = new ProposalValidationEngine(
          prisma,
          registry,
          parentage,
          projector,
        );
        const updates: import('src/generated').WorkItemChangeSetValidationRequest =
          {
            root: { refType: 'existing', id: screenId },
            operations: [
              {
                op: 'section.replace',
                ref: { refType: 'existing', id: screenId },
                key: 'diagramElementMetadata',
                content: {
                  role: 'GENERIC',
                  ...(keepReference
                    ? {
                        canonicalReference: {
                          entityType: 'TASK',
                          entityId: mockupId,
                        },
                      }
                    : {}),
                },
              },
            ],
          };
        if (change === 'create') {
          updates.root = { refType: 'existing', id: diagramId };
          const screen = {
            refType: 'temporary',
            tempId: 'profile-screen',
          } satisfies import('src/generated').WorkItemChangeSetIdentity;
          updates.operations = [
            {
              op: 'workItem.create',
              ref: screen,
              name: 'Profile',
              type: 'DIAGRAM_ELEMENT',
              parent: updates.root,
            },
            {
              op: 'section.replace',
              ref: screen,
              key: 'diagramElementMetadata',
              content: {
                role: 'GENERIC',
                ...(keepReference
                  ? {
                      canonicalReference: {
                        entityType: 'TASK',
                        entityId: mockupId,
                      },
                    }
                  : {}),
              },
            },
          ];
        }
        if (change === 'transition') {
          // The root is outside the Diagram; only the endpoints identify its container.
          updates.root = { refType: 'existing', id: mockupId };
          updates.operations = [
            {
              op: 'relationship.create',
              ref: { refType: 'temporary', tempId: 'return' },
              edgeType: 'LOOP',
              category: 'flow',
              source: { refType: 'existing', id: screenId },
              target: { refType: 'existing', id: screenId },
              ...(keepReference ? { actionLabel: 'tap Retry' } : {}),
            },
          ];
        }
        const expectedIssue =
          change === 'transition'
            ? 'missing_ux_flow_action_label'
            : 'missing_ux_flow_mockup_reference';
        const draft = makeStoredProposal({
          action: 'UPDATE',
          targetEntityId: screenId,
          updates,
        });
        setupForApproval(draft, {
          taskLookup: { type: 'DIAGRAM_ELEMENT', parentTaskId: diagramId },
        });
        // Keep the production preparation/projector chain; stub only the durable queue boundary.
        const materializer = new WorkItemChangeSetMaterializerService(
          prisma,
          projector,
          mockTaskService as unknown as TaskService,
          {} as AgentEdgeClientService,
          mockEventPublisher,
          serviceTokenFactory,
          {} as ProposalReconciliationService,
          registry,
          mockPendingEdgeService as unknown as PendingEdgeService,
          mockMentionProcessingService as unknown as MentionProcessingService,
        );
        mockWorkItemChangeSetMaterializer.validationRevision.mockImplementation(
          (request) => materializer.validationRevision(request),
        );
        mockWorkItemChangeSetMaterializer.projectPreparation.mockImplementation(
          (params) => materializer.projectPreparation(params),
        );
        if (!keepReference) {
          let intent: Record<string, unknown> | null = null;
          const intents = {
            findUnique: jest.fn(async () => intent),
            create: jest.fn(async ({ data }) => {
              intent = {
                ...data,
                id: 'materialization-ux-flow',
                status: 'PREPARED',
                checkpoints: data.checkpoints.create,
              };
              return intent;
            }),
            update: jest.fn(async ({ data }) => {
              intent = { ...intent, ...data };
              return intent;
            }),
          };
          Object.assign(mockPrisma.db, {
            workItemChangeSetMaterialization: intents,
          });
          Object.assign(txMock, { workItemChangeSetMaterialization: intents });
          txMock.task.findMany.mockImplementation(mockPrisma.db.task.findMany);
          mockWorkItemChangeSetMaterializer.enqueuePreparedIntent.mockImplementation(
            (tx, params) => materializer.enqueuePreparedIntent(tx, params),
          );
          mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockImplementation(
            (params) => materializer.materializeApprovedChangeSet(params),
          );
        }
        const candidate = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityType: 'TASK',
          targetEntityId: screenId,
          eli5: 'Edit screen',
          updates,
        } satisfies CreateProposalDto;
        const review = engine.assertTaskMutationAuthoringValid(
          candidate,
          testIds.organization,
          testIds.project,
        );
        if (keepReference) {
          await expect(review).resolves.toBeUndefined();
          const result = await service.approve(
            proposalId,
            testIds.organization,
            testIds.project,
            approvingUserId,
          );
          expect(result.proposal.status).toBe('APPROVED');
          expect(
            mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
          ).toHaveBeenCalled();
        } else {
          await expect(review).rejects.toMatchObject({
            response: {
              projection: {
                valid: false,
                issues: expect.arrayContaining([
                  expect.objectContaining({
                    code: expectedIssue,
                  }),
                ]),
              },
            },
          });
          await expect(
            service.approve(
              proposalId,
              testIds.organization,
              testIds.project,
              approvingUserId,
            ),
          ).rejects.toMatchObject({
            response: {
              projection: {
                issues: expect.arrayContaining([
                  expect.objectContaining({
                    code: expectedIssue,
                  }),
                ]),
              },
            },
          });
          expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('validation', () => {
    it('throws when proposal not found', async () => {
      stubStoredProposal(null);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when DELETE targets an unsupported entity type', async () => {
      const deleteProposal = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'CONVERSATION',
      });
      stubStoredProposal(deleteProposal);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when proposal is already APPROVED', async () => {
      const alreadyApproved = makeStoredProposal({ status: 'APPROVED' });
      stubStoredProposal(alreadyApproved);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when proposal status is REJECTED', async () => {
      const rejected = makeStoredProposal({ status: 'REJECTED' });
      stubStoredProposal(rejected);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Cannot approve a proposal with status: REJECTED');
    });

    it('records approval before returning an enactment-time projection failure', async () => {
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [],
        },
      });
      setupForApproval(draft);
      mockWorkItemChangeSetProjector.project.mockResolvedValue({
        valid: false,
        projectedRoot: {
          identity: { refType: 'temporary', tempId: 'root' },
          label: 'Root',
          type: 'STANDARD',
          name: 'Root',
          sections: [],
          deleted: false,
        },
        children: [],
        sections: [],
        incidentRelationships: [],
        identityLabels: {},
        issues: [
          {
            field: 'operations',
            code: 'invalid_projection',
            reason: 'Invalid projection',
            layer: 'referential',
          },
        ],
      });

      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockRejectedValueOnce(
        new BadRequestException({
          message: 'Cannot materialize an invalid work-item change set',
          projection: {
            valid: false,
            issues: [
              {
                field: 'operations',
                code: 'invalid_projection',
                reason: 'Invalid projection',
                layer: 'referential',
              },
            ],
          },
        }),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(txMock.proposalApprovalRecord.create).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'Generic work-item change set requires enactment-time diagnostics',
        expect.objectContaining({
          issueCount: 1,
          issues: [
            expect.objectContaining({
              field: 'operations',
              code: 'invalid_projection',
              reason: 'Invalid projection',
              layer: 'referential',
            }),
          ],
        }),
      );
    });

    it('aborts the approval transaction when retired-type intent preparation fails', async () => {
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'existing', id: testIds.task },
          operations: [
            {
              op: 'workItem.delete',
              ref: { refType: 'existing', id: testIds.task },
            },
          ],
        },
      });
      setupForApproval(draft);
      const failure = new BadRequestException({
        message: 'Work-item type is unavailable in this project.',
        issues: [
          {
            field: `references.${testIds.task}.type`,
            code: 'unrecognized_type',
          },
        ],
      });
      mockWorkItemChangeSetMaterializer.enqueuePreparedIntent.mockRejectedValueOnce(
        failure,
      );
      const commit = jest.fn();
      (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const result = await fn(txMock);
          commit();
          return result;
        },
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toBe(failure);

      expect(commit).not.toHaveBeenCalled();
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.requestDrain,
      ).not.toHaveBeenCalled();
    });

    it('rejects invalid FEATURE requirement references before recording approval', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: {
          root: { refType: 'existing', id: testIds.task },
          operations: [
            {
              op: 'section.replace',
              ref: { refType: 'existing', id: testIds.task },
              key: 'requirements',
              content: { records: [] },
            },
          ],
        },
      });
      setupForApproval(draft);
      mockWorkItemChangeSetProjector.project.mockResolvedValue({
        valid: false,
        projectedRoot: {
          identity: { refType: 'existing', id: testIds.task },
          label: 'Feature',
          type: 'FEATURE',
          name: 'Feature',
          sections: [],
          deleted: false,
        },
        children: [],
        sections: [],
        incidentRelationships: [],
        identityLabels: {},
        issues: [
          {
            field:
              'nodes[existing:' +
              testIds.task +
              '].sections[requirements].records[0].fulfilledBy[0]',
            code: 'feature_requirement_entity_not_found',
            reason: 'TASK was not found in the organization.',
            layer: 'referential',
          },
        ],
      });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(txMock.proposal.update).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).not.toHaveBeenCalled();
    });

    it('rejects a stale FEATURE requirements baseline before approval', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updatedAt: new Date('2026-03-18T00:00:00Z'),
        updates: {
          root: { refType: 'existing', id: testIds.task },
          operations: [
            {
              op: 'section.replace',
              ref: { refType: 'existing', id: testIds.task },
              key: 'requirements',
              content: { records: [] },
            },
          ],
        },
      });
      setupForApproval(draft);
      txMock.taskSection.findMany.mockResolvedValue([
        {
          taskId: testIds.task,
          updatedAt: new Date('2026-03-18T00:01:00Z'),
        },
      ]);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('records approval and completes the selected generic enactment before returning', async () => {
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'Root',
              type: 'STANDARD',
            },
          ],
        },
      });
      setupForApproval(draft);

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.resultingEntityId).toBe(createdTaskId);
      expect(result.proposal.status).toBe('APPROVED');
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledWith(expect.anything(), {
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        prepared: expect.objectContaining({ operationSet: draft.updates }),
      });
      expect(txMock.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proposalId },
          data: { status: 'APPROVED' },
        }),
      );
      expect(
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet,
      ).toHaveBeenCalledWith({
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
    });

    it('projects a generic change set once, before the approval transaction opens', async () => {
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'Root',
              type: 'STANDARD',
            },
          ],
        },
      });
      setupForApproval(draft);
      const order: string[] = [];
      mockWorkItemChangeSetProjector.project.mockImplementation(() => {
        order.push('project');
        return Promise.resolve({
          valid: true,
          projectedRoot: { type: 'STANDARD' },
          issues: [],
        });
      });
      (mockPrisma.db.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          order.push('transaction');
          return fn(txMock);
        },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(
        mockWorkItemChangeSetMaterializer.projectPreparation,
      ).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['project', 'transaction']);
    });

    it('rejects a proposal whose change set changed between projection and the row lock', async () => {
      const projected = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'Before',
              type: 'STANDARD',
            },
          ],
        },
      });
      const locked = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'After',
              type: 'STANDARD',
            },
          ],
        },
      });
      setupForApproval(locked);
      (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue(
        projected,
      );
      mockWorkItemChangeSetMaterializer.validationRevision.mockImplementation(
        (request: unknown) => JSON.stringify(request),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).not.toHaveBeenCalled();
    });

    it('queues an ordinary TASK CREATE instead of letting a graph fence roll back approval', async () => {
      const draft = makeStoredProposal({
        updates: {
          name: 'Root',
          parentTaskId: testIds.task,
          initiativeId: testIds.initiative,
        },
      });
      const request = {
        root: { refType: 'temporary' as const, tempId: 'root' },
        operations: [
          {
            op: 'workItem.create' as const,
            ref: { refType: 'temporary' as const, tempId: 'root' },
            name: 'Root',
            parent: { refType: 'existing' as const, id: testIds.task },
          },
        ],
      };
      setupForApproval(draft);
      mockWorkItemChangeSetMaterializer.taskProposalChangeSet.mockReturnValue(
        request,
      );

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.proposal.status).toBe('APPROVED');
      expect(result.enacted).toBe(true);
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledWith(expect.anything(), {
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        prepared: expect.objectContaining({ operationSet: request }),
      });
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
    });

    it('rejects an ordinary TASK type change before recording approval', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: {
          type: 'FEATURE',
        },
      });
      const request = {
        root: { refType: 'existing' as const, id: testIds.task },
        operations: [
          {
            op: 'workItem.update' as const,
            ref: { refType: 'existing' as const, id: testIds.task },
          },
        ],
      };
      setupForApproval(draft);
      mockWorkItemChangeSetMaterializer.taskProposalChangeSet.mockReturnValue(
        request,
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Task type cannot be changed after creation.');
      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).not.toHaveBeenCalled();
    });

    it('records approval even when another generic enactment is already in flight', async () => {
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [],
        },
      });
      setupForApproval(draft);
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValueOnce(
        {
          proposal: { ...draft, status: 'APPROVED' },
          rootWorkItemId: createdTaskId,
          status: WorkItemChangeSetMaterializationStatus.PREPARED,
          enacted: false,
        },
      );
      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.proposal.status).toBe('APPROVED');
      expect(result.enacted).toBe(false);
      expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledTimes(1);
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledTimes(1);
    });

    it('enqueues element-sourced links to existing work items with the approved Diagram change set', async () => {
      const elementRef = { refType: 'temporary', tempId: 'ui' };
      const elementLinks = [
        ['diagramElements[0].edges[0]', 'RELATED_TO', createdTaskId],
        ['diagramElements[0].edges[1]', 'GUARANTEES', testIds.task],
      ].map(([tempId, edgeType, target]) => ({
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId },
        source: elementRef,
        target: { refType: 'existing', id: target },
        edgeType,
        category: 'meta',
      }));
      const request = {
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Checkout',
            type: 'DIAGRAM',
          },
          {
            op: 'workItem.create',
            ref: elementRef,
            name: 'Checkout UI',
            type: 'DIAGRAM_ELEMENT',
            parent: { refType: 'temporary', tempId: 'root' },
          },
          ...elementLinks,
        ],
      };
      const draft = makeStoredProposal({ updates: request });
      setupForApproval(draft);
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValueOnce(
        {
          proposal: { ...draft, status: 'APPROVED' },
          rootWorkItemId: createdTaskId,
          enacted: true,
        },
      );

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          prepared: expect.objectContaining({
            operationSet: expect.objectContaining({
              operations: expect.arrayContaining(elementLinks),
            }),
          }),
        }),
      );
      expect(
        mockPendingEdgeService.processDeclaredEdges,
      ).not.toHaveBeenCalled();
    });

    it('preserves the reconciliation 409 body after generic approval and explicit retry', async () => {
      const draft = makeStoredProposal({
        updates: {
          root: { refType: 'existing', id: testIds.task },
          operations: [
            {
              op: 'section.replace',
              ref: { refType: 'existing', id: testIds.task },
              key: 'description',
              content: 'Reviewed result',
            },
          ],
        },
      });
      setupForApproval(draft);
      const conflict = new ConflictException({
        message: 'Content changed after review.',
        issues: [
          {
            field: 'sections.description',
            code: 'PROPOSAL_RECONCILIATION_REQUIRED',
            reason: 'Changed after review',
            layer: 'referential',
          },
        ],
        correlationId: 'conflict-correlation',
      });
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockRejectedValue(
        conflict,
      );
      const response = jest
        .spyOn(service as any, 'toResponseDto')
        .mockResolvedValue({
          status: 'APPROVED',
          materialization: { state: 'RECOVERABLE_FAILURE' },
        });
      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toBe(conflict);
      (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue({
        ...draft,
        status: 'APPROVED',
        workItemChangeSetMaterialization: { id: 'intent' },
      });
      await expect(
        service.retryApprovedGenericProposal({
          proposalId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).rejects.toBe(conflict);
      expect(response).not.toHaveBeenCalled();
    });

    it('preserves durable approval and surfaces the concrete generic enactment failure', async () => {
      const durableEdges = [
        {
          endpointMode: 'PROPOSAL',
          targetEntityType: 'PROPOSAL',
          targetEntityId: '123e4567-e89b-42d3-a456-426614174199',
          edgeType: 'EVOLVES',
          targetEntityTitle: 'Earlier proposal',
        },
      ];
      const draft = makeStoredProposal({
        edges: durableEdges,
        updates: {
          root: { refType: 'existing', id: testIds.task },
          operations: [
            {
              op: 'relationship.create',
              ref: { refType: 'temporary', tempId: 'new-link' },
              source: { refType: 'existing', id: testIds.task },
              target: { refType: 'existing', id: createdTaskId },
              edgeType: 'STANDARD',
              category: 'flow',
              direction: 'forward',
            },
            {
              op: 'layout.replace',
              root: { refType: 'existing', id: testIds.task },
              sectionKey: 'graphLayout',
              entries: [
                {
                  node: { refType: 'existing', id: testIds.task },
                  position: { x: 0, y: 0 },
                },
                {
                  node: { refType: 'existing', id: createdTaskId },
                  position: { x: 200, y: 0 },
                },
              ],
            },
          ],
        },
      });
      setupForApproval(draft);
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockRejectedValueOnce(
        new Error('Graph write timed out after commit'),
      );
      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Graph write timed out after commit');

      expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledTimes(1);
      expect(txMock.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'APPROVED' } }),
      );
      expect(
        txMock.proposal.update.mock.calls.every(
          ([args]: any[]) => args.data.edges === undefined,
        ),
      ).toBe(true);
      const approved = {
        ...draft,
        status: 'APPROVED',
        workItemChangeSetMaterialization: { id: 'intent', checkpoints: [] },
      };
      (mockPrisma.db.proposal.findFirst as jest.Mock).mockResolvedValue(
        approved,
      );
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValueOnce(
        {
          proposal: approved,
          rootWorkItemId: testIds.task,
          enacted: true,
        },
      );
      const retried = await service.retryApprovedGenericProposal({
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });
      expect(retried.proposal.edges).toEqual(durableEdges);
      expect(retried.enacted).toBe(true);
      expect(
        mockPendingEdgeService.processDeclaredEdges,
      ).not.toHaveBeenCalled();
    });

    it('throws when user has already voted', async () => {
      const draft = makeStoredProposal();
      stubStoredProposal(draft);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      txMock.proposalApprovalRecord.create.mockRejectedValue(p2002);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws when targetEntityType is unsupported', async () => {
      const draft = makeStoredProposal({ targetEntityType: 'INITIATIVE' });
      setupForApproval(draft);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Unsupported target entity type');
    });

    it('throws when target task not found for UPDATE', async () => {
      const draft = makeStoredProposal({ action: 'UPDATE' });
      stubStoredProposal(draft);
      txMock.proposalApprovalRecord.create.mockResolvedValue({ id: 'v1' });
      txMock.task.findFirst.mockResolvedValue(null);

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('atomicity', () => {
    it('rolls back proposal status when entity creation fails', async () => {
      const draft = makeStoredProposal();
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockRejectedValue(
        new Error('Task creation failed'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Task creation failed');

      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('approve() does not run task post-commit hooks when entity update throws', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      setupForApproval(draft, {
        taskLookup: { type: 'TASK', parentTaskId: 'parent-x' },
      });
      mockTaskService.updateInTransaction.mockRejectedValue(
        new Error('Task update failed mid-tx'),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Task update failed mid-tx');

      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(mockTaskService.runUpdatePostCommit).not.toHaveBeenCalled();
    });

    it('applyInTransaction surfaces a runPostCommit closure that the caller invokes after commit', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      const approved = { ...draft, status: 'APPROVED' };
      txMock.proposal.update.mockResolvedValue(approved);
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: { updateOriginalArtifact: true },
      });

      const result = await service.applyInTransaction(
        txMock as never,
        draft as never,
        testIds.organization,
        testIds.project,
      );

      expect(result.resultingEntityId).toBe(testIds.task);
      // applyInTransaction never runs the post-commit work itself — the
      // outer-tx owner does, after the commit.
      expect(mockTaskService.runUpdatePostCommit).not.toHaveBeenCalled();

      await result.runPostCommit();
      expect(mockTaskService.runUpdatePostCommit).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        { updateOriginalArtifact: true },
      );
    });

    it('applyInTransaction rolls back proposal status when entity update throws', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      const approved = { ...draft, status: 'APPROVED' };
      txMock.proposal.update.mockResolvedValue(approved);
      mockTaskService.updateInTransaction.mockRejectedValue(
        new Error('apply-on-create failed'),
      );

      await expect(
        service.applyInTransaction(
          txMock as never,
          draft as never,
          testIds.organization,
          testIds.project,
        ),
      ).rejects.toThrow('apply-on-create failed');

      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(mockTaskService.runUpdatePostCommit).not.toHaveBeenCalled();
    });

    it('section-only PATCH under apply-on-create routes through updateInTransaction with null initiative', async () => {
      const sectionUpdates = {
        sections: [{ key: 'description', content: 'patched' }],
        sectionUpdateSource: 'USER_EDITED',
      };
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: sectionUpdates,
      });
      const approved = { ...draft, status: 'APPROVED' };
      txMock.proposal.update.mockResolvedValue(approved);
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: { updateOriginalArtifact: true },
      });

      const result = await service.applyInTransaction(
        txMock as never,
        draft as never,
        testIds.organization,
        testIds.project,
      );

      expect(mockTaskService.updateInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.organization,
        null,
        testIds.task,
        sectionUpdates,
        testIds.user,
      );
      expect(result.resultingEntityId).toBe(testIds.task);
    });

    it('applyInTransaction publishes proposal.approved with the materialized targetEntityId for a CREATE proposal', async () => {
      const NIL_UUID = '00000000-0000-0000-0000-000000000000';
      const draft = makeStoredProposal({
        targetEntityId: NIL_UUID,
      });
      txMock.proposal.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...draft, status: 'APPROVED', ...data }),
      );
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });

      await service.applyInTransaction(
        txMock as never,
        draft as never,
        testIds.organization,
        testIds.project,
      );

      // This is the auto-apply-on-create path: a CREATE proposal is stored
      // with targetEntityId = NIL_UUID, enacted, and its column rewritten to
      // the real id. The emitted event must reflect that rewrite, not the
      // pre-enactment placeholder.
      const approvedCall =
        mockEventPublisher.publishInTransaction.mock.calls.find(
          ([, e]) => e.type === EVENT_TYPES.PROPOSAL.APPROVED,
        )!;
      const payload = approvedCall[1].payload as ProposalApprovedEventPayload;
      expect(payload.targetEntityId).toBe(createdTaskId);
      expect(payload.targetEntityId).not.toBe(NIL_UUID);
    });
  });

  describe('reject()', () => {
    function setupForRejection(
      proposal: ReturnType<typeof makeStoredProposal>,
    ) {
      const rejected = { ...proposal, status: 'REJECTED' };
      stubStoredProposal(proposal);
      txMock.proposal.update.mockResolvedValue(rejected);
      txMock.proposalApprovalRecord.create.mockResolvedValue({
        id: 'rejection-1',
      });
      return rejected;
    }

    it('rejects a future refinement without staging it or changing live content', async () => {
      const draft = makeStoredProposal({
        action: 'VERSIONED_UPDATE',
        updates: {
          operation: 'REVISE',
          futureId: proposalId,
          expectedRevision: 1,
        },
      });
      setupForRejection(draft);
      const stage = jest.spyOn(futureRevisions, 'stageFutureRevision');
      try {
        const result = await service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'Keep the approved direction',
        );
        expect(result.proposal.status).toBe('REJECTED');
        expect(stage).not.toHaveBeenCalled();
        expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
        expect(mockDesignDocService.updateInTransaction).not.toHaveBeenCalled();
      } finally {
        stage.mockRestore();
      }
    });

    it('records REJECTION row and sets status to REJECTED', async () => {
      const draft = makeStoredProposal();
      setupForRejection(draft);

      const result = await service.reject(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
        'Needs rework',
      );

      expect(result.proposal.status).toBe('REJECTED');
      expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledWith({
        data: {
          proposalId,
          userId: approvingUserId,
          type: 'REJECTION',
          reason: 'Needs rework',
        },
      });
      expect(txMock.proposal.update).toHaveBeenCalledWith({
        where: { id: proposalId },
        data: { status: 'REJECTED' },
      });
    });

    it('trims whitespace from the rejection reason', async () => {
      const draft = makeStoredProposal();
      setupForRejection(draft);

      await service.reject(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
        '  Needs rework  ',
      );

      expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledWith({
        data: {
          proposalId,
          userId: approvingUserId,
          type: 'REJECTION',
          reason: 'Needs rework',
        },
      });
    });

    it.each([
      ['omitted', undefined],
      ['blank', '   '],
    ])(
      'allows rejecting a CREATE proposal with an %s reason',
      async (_, reason) => {
        const draft = makeStoredProposal({ action: 'CREATE' });
        setupForRejection(draft);

        await service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          reason,
        );

        expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledWith({
          data: {
            proposalId,
            userId: approvingUserId,
            type: 'REJECTION',
            reason: null,
          },
        });
        expect(txMock.proposal.update).toHaveBeenCalledWith({
          where: { id: proposalId },
          data: { status: 'REJECTED' },
        });
      },
    );

    it.each(['UPDATE', 'DELETE'] as const)(
      'preserves a supplied reason when rejecting an %s proposal',
      async (action) => {
        const draft = makeStoredProposal({ action });
        setupForRejection(draft);

        await service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          '  No longer valid  ',
        );

        expect(txMock.proposalApprovalRecord.create).toHaveBeenCalledWith({
          data: {
            proposalId,
            userId: approvingUserId,
            type: 'REJECTION',
            reason: 'No longer valid',
          },
        });
      },
    );

    it.each([
      ['UPDATE', 'omitted', undefined],
      ['UPDATE', 'blank', '   '],
      ['DELETE', 'omitted', undefined],
      ['DELETE', 'blank', '   '],
    ] as const)(
      'rejects an %s proposal with an %s reason without recording a decision',
      async (action, _, reason) => {
        const draft = makeStoredProposal({ action });
        setupForRejection(draft);

        await expect(
          service.reject(
            proposalId,
            testIds.organization,
            testIds.project,
            approvingUserId,
            reason,
          ),
        ).rejects.toThrow(
          'A reason is required when rejecting an UPDATE or DELETE proposal',
        );

        expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
        expect(txMock.proposal.update).not.toHaveBeenCalled();
        expect(
          (service as any).pendingEdgeService.cleanupForProposal,
        ).not.toHaveBeenCalled();
      },
    );

    it('throws when proposal not found', async () => {
      stubStoredProposal(null);

      await expect(
        service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'Bad idea',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when proposal is already REJECTED', async () => {
      const rejected = makeStoredProposal({ status: 'REJECTED' });
      stubStoredProposal(rejected);

      await expect(
        service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'Already bad',
        ),
      ).rejects.toThrow('Proposal is already rejected');
    });

    it('throws when proposal is already APPROVED', async () => {
      const approved = makeStoredProposal({ status: 'APPROVED' });
      stubStoredProposal(approved);

      await expect(
        service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'Too late',
        ),
      ).rejects.toThrow(
        'Cannot reject a proposal that has already been approved',
      );
    });

    it('allows rejecting a DRAFT proposal', async () => {
      const draft = makeStoredProposal({ status: 'DRAFT' });
      stubStoredProposal(draft);
      txMock.proposalApprovalRecord.create.mockResolvedValue({
        id: 'approval-id',
        proposalId,
        userId: approvingUserId,
        type: 'REJECTION',
        reason: 'Not ready',
        createdAt: new Date(),
      });
      txMock.proposal.update.mockResolvedValue({
        ...draft,
        status: 'REJECTED',
      });

      const result = await service.reject(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
        'Not ready',
      );

      expect(result.proposal.status).toBe('REJECTED');
    });

    it('throws ConflictException when user already voted', async () => {
      const draft = makeStoredProposal();
      stubStoredProposal(draft);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      txMock.proposalApprovalRecord.create.mockRejectedValue(p2002);

      await expect(
        service.reject(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
          'Duplicate vote',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('cleans up pending edges on rejection', async () => {
      const draft = makeStoredProposal();
      setupForRejection(draft);
      const mockPendingEdgeService = (service as any).pendingEdgeService;

      await service.reject(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
        'Not the right approach',
      );

      expect(mockPendingEdgeService.cleanupForProposal).toHaveBeenCalledWith(
        expect.anything(),
        proposalId,
      );
    });
  });

  describe('threshold enforcement', () => {
    it('enacts an agent-authored GOAL update after one eligible human approval using the live rule', async () => {
      txMock.projectMember.findMany.mockResolvedValue([
        { userId: approvingUserId },
      ]);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        requestorId: 'agent-requestor-id',
        requestorContext: {
          source: 'agent',
          userId: 'agent-requestor-id',
          organizationId: testIds.organization,
          toolName: 'mcp.edit_goal',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
        updates: { name: 'Updated goal' },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: {
          type: 'GOAL',
          parentTaskId: null,
          initiativeId: null,
        },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });

    it('uses one resolved project policy for approval evaluation and response mapping', async () => {
      const projectPolicy = createDefaultProjectApprovalPolicy(3);
      projectApprovalPolicyService.resolve.mockResolvedValue(projectPolicy);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        requestorId: 'agent-requestor-id',
        requestorContext: {
          source: 'agent',
          userId: 'agent-requestor-id',
          organizationId: testIds.organization,
          toolName: 'mcp.edit_goal',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
        updates: { name: 'Updated goal' },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: {
          type: 'GOAL',
          parentTaskId: null,
          initiativeId: null,
        },
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(projectApprovalPolicyService.resolve).toHaveBeenCalledTimes(1);
      expect(result.proposal.status).toBe('DRAFT');
      expect(result.proposal.requiredApprovals).toBe(3);
      expect(result.enacted).toBe(false);
    });

    it('enacts the fixed onboarding rule after one approval when project policy is higher', async () => {
      projectApprovalPolicyService.resolve.mockResolvedValue(
        createDefaultProjectApprovalPolicy(3),
      );
      const draft = makeStoredProposal({
        action: 'UPDATE',
        requestorId: 'agent-requestor-id',
        requestorContext: {
          source: 'agent',
          userId: 'agent-requestor-id',
          organizationId: testIds.organization,
          toolName: 'shared-generate-features',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
        updates: { name: 'Generated feature' },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: {
          type: 'FEATURE',
          parentTaskId: null,
          initiativeId: null,
        },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(projectApprovalPolicyService.resolve).toHaveBeenCalledTimes(1);
      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
      expect(result.proposal.requiredApprovals).toBe(1);
    });

    it('rejects approval from a user outside the live eligible-member set', async () => {
      txMock.projectMember.findMany.mockResolvedValue([
        { userId: 'different-project-member-id' },
      ]);
      const draft = makeStoredProposal({ action: 'UPDATE' });
      stubStoredProposal(draft);
      txMock.task.findFirst.mockResolvedValue({
        type: 'TASK',
        parentTaskId: 'parent-task-id',
        initiativeId: null,
      });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('Only an active project member may approve');

      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('rejects later self-approval when policy excludes the user author', async () => {
      jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
        requiresProposal: true,
        threshold: 1,
        allowsProposerApproval: false,
      });
      const draft = makeStoredProposal({
        action: 'UPDATE',
        requestorId: approvingUserId,
        requestorContext: {
          source: 'user',
          userId: approvingUserId,
          organizationId: testIds.organization,
          toolName: 'POST /proposals',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      });
      stubStoredProposal(draft);
      txMock.task.findFirst.mockResolvedValue({
        type: 'TASK',
        parentTaskId: 'parent-task-id',
      });

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow(
        'Proposal policy does not permit the author to approve this proposal',
      );

      expect(txMock.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('enacts proposal with single approval when no rules match', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: { type: 'TASK', parentTaskId: 'some-parent' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });

    it('does not approve when application rejects removing a required structural parent', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { parentTaskId: null },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: { type: 'CONTRACT', parentTaskId: 'feature-parent-id' },
      });
      mockTaskService.updateInTransaction.mockRejectedValue(
        new BadRequestException(
          'CONTRACT items require a structural parent under the configured work-item type definition.',
        ),
      );

      await expect(
        service.approve(
          proposalId,
          testIds.organization,
          testIds.project,
          approvingUserId,
        ),
      ).rejects.toThrow('CONTRACT items require a structural parent');
      expect(mockTaskService.updateInTransaction).toHaveBeenCalled();
    });

    it('does not enact when approvals are below the required threshold', async () => {
      // Force a 2-approval gate so this exercises the service's
      // below-threshold branch even though no live rule yields threshold 2.
      forceThreshold(2);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      stubStoredProposal(draft);
      txMock.proposalApprovalRecord.create.mockResolvedValue({ id: 'v1' });
      txMock.proposalApprovalRecord.count.mockResolvedValue(1);
      txMock.task.findFirst.mockResolvedValue({
        type: 'FEATURE',
        parentTaskId: null,
        lastAppliedProposalId: null,
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(false);
      expect(result.proposal.status).toBe('DRAFT');
      expect(txMock.proposal.update).not.toHaveBeenCalled();
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
    });

    it('enacts once approvals reach the required threshold', async () => {
      forceThreshold(2);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      setupForApproval(draft, {
        approvalCount: 2,
        taskLookup: { type: 'FEATURE', parentTaskId: null },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });

    it('enacts a top-level feature content change after a single approval (live default threshold)', async () => {
      // Locks in the shipped default: a top-level FEATURE content edit now
      // needs only one approval. Uses the real evaluator (no forceThreshold).
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: { type: 'FEATURE', parentTaskId: null },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });

    it('enacts non-top-level feature with single approval', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: { type: 'FEATURE', parentTaskId: 'parent-feature-id' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
    });

    it('resolves entity context from updates for CREATE proposals', async () => {
      // The target entity does not exist yet, so the evaluator must receive a
      // context derived from `updates` (type FEATURE, no parent). We force a
      // 2-approval gate so a single approval keeps the proposal DRAFT and we
      // can assert on the resolved context the evaluator was handed.
      const evalSpy = forceThreshold(2);
      const draft = makeStoredProposal({
        action: 'CREATE',
        updates: {
          name: 'Top-level feature',
          type: 'FEATURE',
          initiativeId: testIds.initiative,
        },
      });
      stubStoredProposal(draft);
      txMock.proposalApprovalRecord.create.mockResolvedValue({ id: 'v1' });
      txMock.proposalApprovalRecord.count.mockResolvedValue(1);

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(evalSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FEATURE',
          parentTaskId: null,
          initiativeId: testIds.initiative,
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(result.enacted).toBe(false);
      expect(result.resultingEntityId).toBeNull();
    });

    it('records vote before evaluating threshold', async () => {
      const draft = makeStoredProposal();
      setupForApproval(draft);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: createdTaskId,
      });

      await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      const createCallOrder =
        txMock.proposalApprovalRecord.create.mock.invocationCallOrder[0];
      const countCallOrder =
        txMock.proposalApprovalRecord.count.mock.invocationCallOrder[0];
      expect(createCallOrder).toBeLessThan(countCallOrder!);
    });

    it('agent-source non-top-level UPDATE enacts on the first single human approval', async () => {
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
        requestorContext: {
          source: 'agent',
          userId: testIds.user,
          organizationId: testIds.organization,
          toolName: 'mcp.update_task',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      });
      setupForApproval(draft, {
        approvalCount: 1,
        taskLookup: { type: 'TASK', parentTaskId: 'parent-x' },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });

    it('top-level FEATURE UPDATE stays DRAFT below a 2-approval gate', async () => {
      forceThreshold(2);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
        requestorContext: {
          source: 'user',
          userId: testIds.user,
          organizationId: testIds.organization,
          toolName: 'POST /proposals',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      });
      stubStoredProposal(draft);
      txMock.proposalApprovalRecord.create.mockResolvedValue({ id: 'v1' });
      txMock.proposalApprovalRecord.count.mockResolvedValue(1);
      txMock.task.findFirst.mockResolvedValue({
        type: 'FEATURE',
        parentTaskId: null,
        lastAppliedProposalId: null,
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(false);
      expect(result.proposal.status).toBe('DRAFT');
      expect(mockTaskService.updateInTransaction).not.toHaveBeenCalled();
    });

    it('top-level FEATURE UPDATE enacts on the second approval of a 2-approval gate', async () => {
      forceThreshold(2);
      const draft = makeStoredProposal({
        action: 'UPDATE',
        targetEntityType: 'TASK',
        updates: { sections: [{ key: 'description', content: 'x' }] },
        requestorContext: {
          source: 'user',
          userId: testIds.user,
          organizationId: testIds.organization,
          toolName: 'POST /proposals',
          timestamp: '2026-04-29T00:00:00.000Z',
        },
      });
      setupForApproval(draft, {
        approvalCount: 2,
        taskLookup: { type: 'FEATURE', parentTaskId: null },
      });
      mockTaskService.updateInTransaction.mockResolvedValue({
        task: { id: testIds.task },
        postCommit: {},
      });

      const result = await service.approve(
        proposalId,
        testIds.organization,
        testIds.project,
        approvingUserId,
      );

      expect(result.enacted).toBe(true);
      expect(result.proposal.status).toBe('APPROVED');
    });
  });

  describe('enactGroupedMember()', () => {
    const memberId = '123e4567-e89b-42d3-a456-426614174200';
    const groupId = '123e4567-e89b-42d3-a456-426614174201';
    const reservedId = '123e4567-e89b-42d3-a456-426614174202';
    beforeEach(() => {
      (mockPrisma.db as any).workItemChangeSetMaterialization = {
        findUnique: jest.fn().mockResolvedValue(null),
      };
    });

    it('retries an older section edit with its stored checkpoint operation order', async () => {
      const root = { refType: 'existing' as const, id: reservedId };
      const section = {
        op: 'section.replace' as const,
        ref: root,
        key: 'description',
        content: 'Body',
      };
      const stored = {
        root,
        operations: [{ op: 'workItem.update', ref: root }, section],
      };
      const proposal = makeStoredProposal({
        status: 'APPROVED',
        action: 'UPDATE',
        targetEntityId: reservedId,
        updates: { sections: [{ key: 'description', content: 'Body' }] },
      });
      stubGroupedMember(proposal, { executionState: 'RETRYABLE_FAILURE' });
      mockWorkItemChangeSetMaterializer.taskProposalChangeSet.mockReturnValue({
        root,
        operations: [section],
      });
      (
        mockPrisma.db as any
      ).workItemChangeSetMaterialization.findUnique.mockResolvedValue({
        operationSet: stored,
      });
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValue(
        {
          proposal,
          rootWorkItemId: reservedId,
          status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
          enacted: true,
        },
      );
      await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });
      expect(
        mockWorkItemChangeSetMaterializer.projectPreparation,
      ).not.toHaveBeenCalled();
      expect(mockPrisma.db.$transaction).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet,
      ).toHaveBeenCalledWith(expect.objectContaining({ request: stored }));
    });

    function groupedMember(
      proposal: ReturnType<typeof makeStoredProposal>,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: memberId,
        groupId,
        proposalId: proposal.id,
        reservedTargetEntityId: reservedId,
        executionState: 'READY',
        publicationPayload: null,
        publishedEdgeCount: 0,
        publishedPostCommitCount: 0,
        publicationCompletedAt: null,
        group: {
          id: groupId,
          organizationId: testIds.organization,
          projectId: testIds.project,
          status: 'REVIEWABLE',
        },
        proposal,
        ...overrides,
      };
    }

    function stubGroupedMember(
      proposal: ReturnType<typeof makeStoredProposal>,
      overrides: Record<string, unknown> = {},
    ) {
      const member = groupedMember(proposal, overrides);
      let storedMember = member;
      (
        (mockPrisma.db as any).proposalGroupMember.findFirst as jest.Mock
      ).mockImplementation(() => Promise.resolve(storedMember));
      txMock.proposalGroupMember.findFirst.mockImplementation(() =>
        Promise.resolve({ ...storedMember, group: undefined }),
      );
      txMock.proposalGroupMember.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          storedMember = { ...storedMember, ...data };
          return Promise.resolve(storedMember);
        },
      );
      (
        (mockPrisma.db as any).proposalGroupMember.updateMany as jest.Mock
      ).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        storedMember = { ...storedMember, ...data };
        return Promise.resolve({ count: 1 });
      });
      txMock.proposal.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const updatedProposal = {
            ...storedMember.proposal,
            status: 'APPROVED',
            ...data,
          };
          storedMember = { ...storedMember, proposal: updatedProposal };
          return Promise.resolve(updatedProposal);
        },
      );
      return member;
    }

    it.each(['DRAFT', 'APPROVED'] as const)(
      'projects a %s grouped generic member once, before its transaction',
      async (status) => {
        const root = { refType: 'existing' as const, id: reservedId };
        const request = {
          root,
          operations: [{ op: 'workItem.update', ref: root }],
        };
        const proposal = makeStoredProposal({
          status,
          action: 'UPDATE',
          targetEntityId: reservedId,
          updates: { name: 'Renamed' },
        });
        stubGroupedMember(proposal);
        mockWorkItemChangeSetMaterializer.taskProposalChangeSet.mockReturnValue(
          request,
        );
        (
          mockPrisma.db as any
        ).workItemChangeSetMaterialization.findUnique.mockResolvedValue(null);
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValue(
          {
            proposal: { ...proposal, status: 'APPROVED' },
            rootWorkItemId: reservedId,
            status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
            enacted: true,
          },
        );

        await service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        });

        const project = mockWorkItemChangeSetMaterializer.projectPreparation;
        expect(project).toHaveBeenCalledTimes(1);
        expect(project.mock.invocationCallOrder[0]).toBeLessThan(
          (mockPrisma.db.$transaction as jest.Mock).mock
            .invocationCallOrder[0]!,
        );
        expect(
          mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
        ).toHaveBeenCalledWith(
          txMock,
          expect.objectContaining({
            prepared: await project.mock.results[0]!.value,
          }),
        );
      },
    );

    it('materializes a grouped task at its persisted reserved identity', async () => {
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: { name: 'Reserved task' },
      });
      stubGroupedMember(proposal);
      txMock.task.findUnique.mockResolvedValue(null);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: reservedId,
      });

      const result = await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(mockTaskService.createInTransaction).toHaveBeenCalledWith(
        txMock,
        testIds.organization,
        null,
        { name: 'Reserved task' },
        testIds.project,
        reservedId,
      );
      expect(result.resultingEntityId).toBe(reservedId);
      expect(result.alreadyApplied).toBe(false);
      expect(mockPrisma.db.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 30_000 },
      );
    });

    it('materializes a grouped work-item type at its persisted reserved identity', async () => {
      const proposal = makeStoredProposal({
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: reservedId,
        updates: {
          key: 'RESEARCH',
          name: 'Research',
          sections: [],
          allowedStatuses: ['ACTIVE'],
        },
      });
      stubGroupedMember(proposal);
      txMock.workItemType.findUnique.mockResolvedValue(null);
      mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction.mockResolvedValue(
        {
          id: reservedId,
          runPostCommit: jest.fn().mockResolvedValue(undefined),
        },
      );

      const result = await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(
        mockWorkItemTypeRegistry.insertAcceptedDefinitionInTransaction,
      ).toHaveBeenCalledWith(
        txMock,
        proposal.updates,
        testIds.project,
        testIds.organization,
        reservedId,
      );
      expect(
        mockWorkItemTypeLifecycle.restoreInTransaction,
      ).not.toHaveBeenCalled();
      expect(result.resultingEntityId).toBe(reservedId);
    });

    it('does not enact a grouped cascade delete synchronously', async () => {
      const typeKey = 'MARKETING';
      const proposal = makeStoredProposal({
        action: 'DELETE',
        targetEntityType: 'WORK_ITEM_TYPE',
        targetEntityId: typeKey,
        updates: {
          operation: 'CASCADE_DELETE',
          cascade: true,
          typeKey,
          itemCount: 1,
          edgeCount: 0,
        },
      });
      stubGroupedMember(proposal, { reservedTargetEntityId: null });
      await expect(
        service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).rejects.toThrow('durable execution worker');
      expect(
        mockWorkItemTypeImpact.deleteCascadeIncidentEdges,
      ).not.toHaveBeenCalled();
      expect(
        mockTaskService.hardDeleteByTypeInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('resumes durable publication after a transient post-commit failure', async () => {
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: { name: 'Reserved task' },
      });
      stubGroupedMember(proposal);
      txMock.task.findUnique.mockResolvedValue(null);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: reservedId,
      });
      const edge = {
        sourceEntityId: reservedId,
        sourceEntityType: 'TASK',
        targetEntityId: testIds.task,
        targetEntityType: 'TASK',
        edgeType: 'RELATED_TO',
      };
      mockPendingEdgeService.processDeclaredEdges.mockResolvedValue([edge]);
      mockPendingEdgeService.materializeEdges
        .mockRejectedValueOnce(new Error('graph temporarily unavailable'))
        .mockResolvedValueOnce(undefined);

      await expect(
        service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).rejects.toThrow('graph temporarily unavailable');

      txMock.task.findUnique.mockResolvedValue({
        id: reservedId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        archivedAt: null,
        name: 'Reserved task',
        type: 'STANDARD',
        tag: null,
        initiativeId: null,
        parentTaskId: null,
        status: undefined,
        source: 'system',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
        sections: [],
        serviceRelations: [],
      });

      const retried = await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(retried.alreadyApplied).toBe(true);
      expect(mockTaskService.createInTransaction).toHaveBeenCalledTimes(1);
      expect(mockPendingEdgeService.materializeEdges).toHaveBeenCalledTimes(2);
      const firstPublishedEdge =
        mockPendingEdgeService.materializeEdges.mock.calls[0]?.[2]?.[0];
      const retriedPublishedEdge =
        mockPendingEdgeService.materializeEdges.mock.calls[1]?.[2]?.[0];
      expect(firstPublishedEdge).toEqual({
        ...edge,
        id: expect.any(String),
      });
      expect(retriedPublishedEdge).toEqual(firstPublishedEdge);
      expect(
        (mockPrisma.db as any).proposalGroupMember.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { publicationCompletedAt: expect.any(Date) },
        }),
      );
    });

    it('verifies a matching retry without duplicating task or event writes', async () => {
      const proposal = makeStoredProposal({
        status: 'APPROVED',
        targetEntityId: reservedId,
        updates: { name: 'Reserved task', type: 'STANDARD' },
      });
      stubGroupedMember(proposal, {
        executionState: 'APPLIED',
        publicationPayload: { edges: [], postCommits: [] },
        publicationCompletedAt: new Date('2026-07-24T00:00:00.000Z'),
      });
      txMock.task.findUnique.mockResolvedValue({
        id: reservedId,
        name: 'Reserved task',
        type: 'STANDARD',
        organizationId: testIds.organization,
        projectId: testIds.project,
        archivedAt: null,
        tag: null,
        initiativeId: null,
        parentTaskId: null,
        status: 'BACKLOG',
        source: 'system',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
        sections: [],
        serviceRelations: [],
      });

      const result = await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(result).toEqual(
        expect.objectContaining({
          resultingEntityId: reservedId,
          alreadyApplied: true,
        }),
      );
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(
        mockPendingEdgeService.processDeclaredEdges,
      ).not.toHaveBeenCalled();
      expect(
        mockMentionProcessingService.extractAndValidate,
      ).not.toHaveBeenCalled();
    });

    it('rejects an occupied reserved identity instead of reallocating', async () => {
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: { name: 'Reserved task' },
      });
      stubGroupedMember(proposal);
      txMock.task.findUnique.mockResolvedValue({ id: reservedId });

      await expect(
        service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
    });

    it('does not roll back or publish a Graph edge while grouped enactment is transactional', async () => {
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: { name: 'Reserved task' },
      });
      stubGroupedMember(proposal);
      txMock.task.findUnique.mockResolvedValue(null);
      mockTaskService.createInTransaction.mockResolvedValue({
        id: reservedId,
      });
      mockPendingEdgeService.processDeclaredEdges.mockRejectedValue(
        new Error('mention processing failed'),
      );

      await expect(
        service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).rejects.toThrow('mention processing failed');

      expect(
        mockPendingEdgeService.rollbackMaterializedEdges,
      ).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        [],
        'Rolling back an immediately materialized proposal edge because grouped enactment failed.',
      );
    });

    it('atomically approves and prepares a graph-shaped grouped member before awaiting publication', async () => {
      const updates = {
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Graph root',
            type: 'STANDARD',
          },
        ],
      };
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates,
      });
      stubGroupedMember(proposal);
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValue(
        {
          proposal: {
            ...proposal,
            status: 'APPROVED',
            targetEntityId: reservedId,
          },
          rootWorkItemId: reservedId,
          status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
          enacted: true,
        },
      );

      const result = await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet,
      ).toHaveBeenCalledWith({
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        reservedRootWorkItemId: reservedId,
        request: updates,
      });
      expect(txMock.proposal.update).toHaveBeenCalledWith({
        where: { id: proposalId },
        data: { status: 'APPROVED' },
      });
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledWith(txMock, {
        proposalId,
        organizationId: testIds.organization,
        projectId: testIds.project,
        prepared: expect.objectContaining({ operationSet: updates }),
        reservedRootWorkItemId: reservedId,
      });
      expect(txMock.proposal.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent.mock
          .invocationCallOrder[0]!,
      );
      expect(result.resultingEntityId).toBe(reservedId);
      expect(mockTaskService.createInTransaction).not.toHaveBeenCalled();
    });

    it('keeps a grouped graph member retryable while overlapping materialization is active', async () => {
      const updates = {
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Graph root',
            type: 'STANDARD',
          },
        ],
      };
      const proposal = makeStoredProposal({
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates,
      });
      stubGroupedMember(proposal);
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValue(
        {
          proposal: {
            ...proposal,
            status: 'APPROVED',
            targetEntityId: reservedId,
          },
          rootWorkItemId: reservedId,
          status: WorkItemChangeSetMaterializationStatus.PREPARED,
          enacted: false,
        },
      );

      await expect(
        service.enactGroupedMember({
          memberId,
          organizationId: testIds.organization,
          projectId: testIds.project,
        }),
      ).resolves.toMatchObject({
        resultingEntityId: reservedId,
        alreadyApplied: false,
        enacted: false,
      });
    });

    it('resumes the prepared grouped intent without recording approval again', async () => {
      const updates = {
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Graph root',
            type: 'STANDARD',
          },
        ],
      };
      const proposal = makeStoredProposal({
        status: 'APPROVED',
        targetEntityId: reservedId,
        updates,
      });
      stubGroupedMember(proposal, { executionState: 'RETRYABLE_FAILURE' });
      mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet.mockResolvedValue(
        {
          proposal,
          rootWorkItemId: reservedId,
          status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
          enacted: true,
        },
      );

      await service.enactGroupedMember({
        memberId,
        organizationId: testIds.organization,
        projectId: testIds.project,
      });

      expect(txMock.proposal.update).not.toHaveBeenCalled();
      expect(
        mockWorkItemChangeSetMaterializer.enqueuePreparedIntent,
      ).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          proposalId,
          prepared: expect.objectContaining({ operationSet: updates }),
          reservedRootWorkItemId: reservedId,
        }),
      );
      expect(
        mockWorkItemChangeSetMaterializer.materializeApprovedChangeSet,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
