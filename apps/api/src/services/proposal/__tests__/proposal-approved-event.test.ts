import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationGroupService } from '../proposal-reconciliation-group.service';
import { mockProposalAdmission } from './mock-proposal-admission';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalService } from '../proposal.service';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { PendingEdgeService } from '../pending-edge.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import * as TestUtils from '../../../utils/testUtils';
import { UserId } from '../../../types';
import { ProjectAccessService } from 'src/auth/services/project-access.service';

const { testIds } = TestUtils;

const proposalId = '123e4567-e89b-42d3-a456-426614174099';
const approvingUserId = 'approver-user-id' as UserId;

function makeStoredProposal(overrides?: Record<string, unknown>) {
  return {
    id: proposalId,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'DRAFT',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'Updated name' },
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

describe('ProposalService proposal.approved event', () => {
  let service: ProposalService;
  let mockPrisma: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockApprovalService: { approve: jest.Mock };
  let mockPendingEdgeService: { cleanupForProposal: jest.Mock };

  beforeEach(async () => {
    mockPrisma = TestUtils.createMockPrismaService();
    (mockPrisma.db as any).proposal = {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };
    Object.assign(mockPrisma.db, {
      proposalGroupMember: { findUnique: jest.fn(async () => null) },
      workItemChangeSetMaterialization: {
        findUnique: jest.fn(async () => null),
      },
      proposalReconciliationRevision: { findMany: jest.fn(async () => []) },
    });
    (mockPrisma.db as any).projectMember = {
      findMany: jest.fn().mockResolvedValue([{ userId: approvingUserId }]),
    };
    (mockPrisma.db as any).entityRegistry.findMany.mockResolvedValue([]);
    (mockPrisma.db as any).task = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({
        updatedAt: new Date(),
        sections: [],
        serviceRelations: [],
        type: 'STANDARD',
        parentTaskId: null,
        initiativeId: null,
      }),
    };

    mockApprovalService = { approve: jest.fn() };
    mockPendingEdgeService = { cleanupForProposal: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertProjectRole: jest.fn() },
        },
        {
          provide: ProposalReconciliationService,
          useFactory: (registry: WorkItemTypeRegistryService) => {
            const owner = new ProposalReconciliationService(
              new ProposalReconciliationAdapterService(registry, {} as never),
              {} as never,
              () => 'test',
            );
            jest.spyOn(owner, 'captureAuthoring').mockResolvedValue();
            return owner;
          },
          inject: [WorkItemTypeRegistryService],
        },
        { provide: ProposalReconciliationGroupService, useValue: {} },
        ProposalService,
        ProjectApprovalPolicyService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ProposalValidationEngine,
          useValue: {
            validate: jest.fn(),
            assertAuthoringCandidatesValid: jest
              .fn()
              .mockImplementation(mockProposalAdmission),
            assertPlanStageProposalTopologyValid: jest
              .fn()
              .mockResolvedValue(undefined),
            assertTaskParentageValid: jest.fn().mockResolvedValue(undefined),
            assertTaskMutationAuthoringValid: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: { project: jest.fn() },
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: { getDefinitions: jest.fn().mockReturnValue([]) },
        },
        {
          provide: ProposalApprovalService,
          useValue: mockApprovalService,
        },
        {
          provide: PendingEdgeService,
          useValue: mockPendingEdgeService,
        },
      ],
    }).compile();

    service = module.get<ProposalService>(ProposalService);
    jest.clearAllMocks();
  });

  it('delegates to approval service when UPDATE transitions to APPROVED', async () => {
    const existing = makeStoredProposal({ status: 'DRAFT' });
    const approvedDto = makeStoredProposal({ status: 'APPROVED' });

    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(existing);
    mockApprovalService.approve.mockResolvedValue({
      proposal: approvedDto,
      resultingEntityId: testIds.task,
    });

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { status: 'APPROVED' },
      approvingUserId,
    );

    expect(mockApprovalService.approve).toHaveBeenCalledWith(
      proposalId,
      testIds.organization,
      testIds.project,
      approvingUserId,
      null,
      undefined,
      undefined,
    );
  });

  it('delegates to approval service when CREATE transitions to APPROVED', async () => {
    const existing = makeStoredProposal({
      status: 'DRAFT',
      action: 'CREATE',
    });
    const approvedDto = makeStoredProposal({
      status: 'APPROVED',
      action: 'CREATE',
    });

    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(existing);
    mockApprovalService.approve.mockResolvedValue({
      proposal: approvedDto,
      resultingEntityId: testIds.task,
    });

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { status: 'APPROVED' },
      approvingUserId,
    );

    expect(mockApprovalService.approve).toHaveBeenCalledWith(
      proposalId,
      testIds.organization,
      testIds.project,
      approvingUserId,
      null,
      undefined,
      undefined,
    );
  });

  it('does not emit event when status transitions to non-APPROVED', async () => {
    const existing = makeStoredProposal({ status: 'DRAFT' });
    const updated = makeStoredProposal({ status: 'REJECTED' });

    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(existing);
    (mockPrisma.db as any).proposal.update.mockResolvedValue(updated);
    (mockPrisma.db as any).proposal.findUnique.mockResolvedValue({
      ...updated,
      approvalRecords: [],
    });

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { status: 'REJECTED' },
      approvingUserId,
    );

    expect(mockApprovalService.approve).not.toHaveBeenCalled();
  });

  it('does not emit event for non-status updates', async () => {
    const existing = makeStoredProposal({ status: 'DRAFT' });
    const updated = makeStoredProposal({
      status: 'DRAFT',
      updates: { name: 'New name' },
    });

    (mockPrisma.db as any).proposal.findFirst.mockResolvedValue(existing);
    (mockPrisma.db as any).proposal.update.mockResolvedValue(updated);
    (mockPrisma.db as any).proposal.findUnique.mockResolvedValue({
      ...updated,
      approvalRecords: [],
    });

    await service.update(
      proposalId,
      testIds.organization,
      testIds.project,
      { updates: { name: 'New name' } },
      approvingUserId,
    );

    expect(mockApprovalService.approve).not.toHaveBeenCalled();
  });
});
