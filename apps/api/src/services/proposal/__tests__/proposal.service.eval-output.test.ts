import { mockProposalAdmission } from './mock-proposal-admission';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProjectAccessService } from '../../../auth/services/project-access.service';
import { ProposalService } from '../proposal.service';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationGroupService } from '../proposal-reconciliation-group.service';
import { PendingEdgeService } from '../pending-edge.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { EventContextManager } from '../../../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import * as TestUtils from '../../../utils/testUtils';

jest.mock('../proposal-response-policy', () => {
  const actual = jest.requireActual('../proposal-response-policy');
  const { toProposalResponseDto } = jest.requireActual('../proposal.types');
  return {
    ...actual,
    mapProposalResponse: async (_tx: unknown, proposal: never) =>
      toProposalResponseDto(proposal, 1),
  };
});

const { testIds } = TestUtils;
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const writingAs = <T>(agentSessionId: string, fn: () => Promise<T>) =>
  EventContextManager.getInstance().runWithContext(
    EventContextManager.getInstance().createInitialContext('test', 'test', {
      agentSessionId,
    }),
    fn,
  );
const proposalId = '123e4567-e89b-42d3-a456-426614174099';

const storedProposal = (overrides: Record<string, unknown> = {}) => ({
  id: proposalId,
  organizationId: testIds.organization,
  projectId: testIds.project,
  type: 'SINGLE',
  action: 'UPDATE',
  status: 'DRAFT',
  targetEntityId: testIds.task,
  targetEntityType: 'TASK',
  updates: { sections: [{ key: 'description', content: 'Proposed' }] },
  requestorId: testIds.user,
  requestorContext: { source: 'agent' },
  influences: null,
  generatedWithVersion: null,
  validationSessionId: null,
  conversationId: null,
  messageId: null,
  ragEnabled: true,
  applicationEligible: true,
  retainedOriginalTargetContent: null,
  createdAt: new Date('2026-10-20T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
  ...overrides,
});

describe('ProposalService eval target output', () => {
  let service: ProposalService;
  let db: any;
  let approvalService: Record<string, jest.Mock>;

  const dto = {
    type: 'SINGLE',
    action: 'UPDATE',
    eli5: 'Rewrites the description.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    title: 'Rewrite description',
    updates: { sections: [{ key: 'description', content: 'Proposed' }] },
    requestorContext: {
      source: 'user',
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'mcp.edit_work_item',
      timestamp: '2026-10-20T00:00:00.000Z',
    },
  } as const;

  beforeEach(async () => {
    const mockPrisma = TestUtils.createMockPrismaService();
    db = mockPrisma.db;
    db.task.findMany.mockResolvedValue([
      { id: testIds.task, type: 'STANDARD', projectId: testIds.project },
    ]);
    db.task.findUnique = jest.fn().mockResolvedValue({
      id: testIds.task,
      name: 'Task',
      sections: [{ key: 'description', materializedMarkdown: 'Original' }],
    });
    db.proposal = {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    db.proposalApprovalRecord = { create: jest.fn() };
    db.report = {
      findFirst: jest.fn().mockResolvedValue({ id: 'attempt-report-id' }),
    };
    db.project.findFirst = jest.fn().mockResolvedValue({ id: testIds.project });
    db.projectMember.findMany.mockResolvedValue([{ userId: testIds.user }]);
    db.entityRegistry.findMany.mockResolvedValue([]);

    approvalService = {
      approve: jest.fn(),
      applyInTransaction: jest.fn(),
      genericChangeSetRequest: jest.fn().mockReturnValue(null),
      projectGenericPreparation: jest.fn(),
      assertPreparedChangeSetCurrent: jest.fn(),
      queueGenericWorkItemChangeSetInTransaction: jest.fn(),
      materializeGenericWorkItemChangeSet: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalService,
        ProjectAccessService,
        ProjectApprovalPolicyService,
        {
          provide: WorkItemTypeRegistryService,
          useValue: { getDefinitions: jest.fn().mockReturnValue([]) },
        },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: {
            assertAuthoringCandidatesValid: jest
              .fn()
              .mockImplementation(mockProposalAdmission),
            assertTaskMutationAuthoringValid: jest
              .fn()
              .mockResolvedValue(undefined),
            assertPlanStageProposalTopologyValid: jest
              .fn()
              .mockResolvedValue(undefined),
          },
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
          provide: ProposalReconciliationService,
          useValue: { captureAuthoring: jest.fn() },
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
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
    service = module.get(ProposalService);
  });

  it('stores an eval proposal inert, keeps the original target content, and never applies it on create', async () => {
    db.proposal.create.mockImplementation(({ data }: any) =>
      Promise.resolve(storedProposal(data)),
    );

    const result = await writingAs(SESSION_ID, () =>
      service.create(testIds.organization, testIds.project, testIds.user, {
        ...dto,
        ragEnabled: false,
        applicationEligible: false,
      } as never),
    );

    expect(db.proposal.create.mock.calls[0][0].data).toMatchObject({
      ragEnabled: false,
      applicationEligible: false,
      retainedOriginalTargetContent: {
        'sections.description.content': 'Original',
      },
    });
    expect(result).toMatchObject({
      ragEnabled: false,
      applicationEligible: false,
      retainedOriginalTargetContent: {
        'sections.description.content': 'Original',
      },
    });
    expect(db.report.findFirst).not.toHaveBeenCalled();
    expect(db.proposalApprovalRecord.create).not.toHaveBeenCalled();
    expect(approvalService.applyInTransaction).not.toHaveBeenCalled();
    expect(
      approvalService.queueGenericWorkItemChangeSetInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('leaves a proposal ordinary when no in-flight attempt names the writing session', async () => {
    db.proposal.create.mockImplementation(({ data }: any) =>
      Promise.resolve(storedProposal(data)),
    );

    db.report.findFirst.mockResolvedValue(null);

    await writingAs(SESSION_ID, () =>
      service.create(testIds.organization, testIds.project, testIds.user, {
        ...dto,
        action: 'CREATE',
        updates: { name: 'New task' },
        requestorContext: { ...dto.requestorContext, source: 'agent' },
      } as never),
    );

    const data = db.proposal.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('applicationEligible');
  });
});
