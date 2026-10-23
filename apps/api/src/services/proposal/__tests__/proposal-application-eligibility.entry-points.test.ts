import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlanStageBatchApprovalService } from '../plan-stage-batch-approval.service';
import { PlanStepBatchApprovalService } from '../plan-step-batch-approval.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalGroupDecisionService } from '../proposal-group-decision.service';
import { ProposalGroupFinalizationService } from '../proposal-group-finalization.service';
import { ProposalVoteService } from '../proposal-vote.service';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';

const ORG = 'org-1' as never;
const PROJECT = 'project-1' as never;
const USER = 'user-1' as never;

const evalProposal = {
  id: 'proposal-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  status: 'DRAFT',
  action: 'UPDATE',
  targetEntityType: 'TASK',
  applicationEligible: false,
  ragEnabled: false,
};
const eligibleProposal = {
  ...evalProposal,
  applicationEligible: true,
  ragEnabled: true,
};

const policy = { resolve: jest.fn().mockResolvedValue({}) };
const logger = {
  log: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function instance<T extends object>(
  type: { prototype: T },
  fields: Record<string, unknown>,
): T {
  return Object.assign(Object.create(type.prototype), fields) as T;
}

describe('application eligibility at every approval and enactment entry point', () => {
  describe('ProposalApprovalService', () => {
    const build = (proposal: object) =>
      instance(ProposalApprovalService, {
        logger,
        projectApprovalPolicyService: policy,
        prisma: {
          db: {
            proposal: { findFirst: jest.fn().mockResolvedValue(proposal) },
          },
        },
      }) as any;

    it('refuses approve', async () => {
      await expect(
        build(evalProposal).approve('proposal-1', ORG, PROJECT, USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an eligible proposal past the guard, whatever its ragEnabled', async () => {
      await expect(
        build({
          ...eligibleProposal,
          ragEnabled: false,
          status: 'APPROVED',
        }).approve('proposal-1', ORG, PROJECT, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses retryApprovedGenericProposal', async () => {
      await expect(
        build({
          ...evalProposal,
          status: 'APPROVED',
          workItemChangeSetMaterialization: {},
        }).retryApprovedGenericProposal({
          proposalId: 'proposal-1',
          organizationId: ORG,
          projectId: PROJECT,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses queueGenericWorkItemChangeSetInTransaction', async () => {
      await expect(
        build(evalProposal).queueGenericWorkItemChangeSetInTransaction(
          {},
          evalProposal,
          ORG,
          PROJECT,
          {},
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses applyInTransaction', async () => {
      await expect(
        build(evalProposal).applyInTransaction({}, evalProposal, ORG, PROJECT),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses enactGroupedMember', async () => {
      const service = instance(ProposalApprovalService, {
        logger,
        projectApprovalPolicyService: policy,
        prisma: {
          db: {
            proposalGroupMember: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'member-1',
                group: { status: 'REVIEWABLE' },
                executionState: 'READY',
                proposal: evalProposal,
              }),
            },
          },
        },
      }) as any;
      await expect(
        service.enactGroupedMember({
          memberId: 'member-1',
          organizationId: ORG,
          projectId: PROJECT,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('refuses materialization of an approved change set', async () => {
    const service = instance(WorkItemChangeSetMaterializerService, {
      logger,
      prisma: {
        db: {
          proposal: { findFirst: jest.fn().mockResolvedValue(evalProposal) },
        },
      },
    }) as any;
    await expect(
      service.materializeApprovedChangeSet({
        proposalId: 'proposal-1',
        organizationId: ORG,
        projectId: PROJECT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a grouped approval', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue({
          proposalId: 'proposal-1',
          group: { status: 'REVIEWABLE', frozenRevision: 1, revision: 1 },
          proposal: evalProposal,
        }),
      },
    };
    const service = instance(ProposalGroupDecisionService, {
      logger,
      prisma: { db: { $transaction: (fn: any) => fn(tx) } },
    }) as any;
    await expect(
      service.approve(
        {
          proposalId: 'proposal-1',
          organizationId: ORG,
          projectId: PROJECT,
          userId: USER,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to finalize a group holding eval output so a zero threshold cannot apply it', async () => {
    const service = instance(ProposalGroupFinalizationService, {
      logger,
      prisma: { db: { $transaction: (fn: any) => fn({}) } },
    }) as any;
    service.lockAndReadGroup = jest.fn().mockResolvedValue({
      members: [{ id: 'member-1', proposal: evalProposal }],
    });
    await expect(
      service.finalize(ORG, PROJECT, 'group-1', { userId: USER } as never, {
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a recorded approval vote', async () => {
    const service = new ProposalVoteService({
      db: {
        proposal: { findFirst: jest.fn().mockResolvedValue(evalProposal) },
      },
    } as never);
    await expect(
      service.recordApproval('proposal-1' as never, USER, ORG),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    [
      'Plan stage batch approval',
      PlanStageBatchApprovalService,
      'approveAllDraftPlanStagesForConversation',
    ],
    [
      'Plan step batch approval',
      PlanStepBatchApprovalService,
      'approveAllDraftPlanStepsForConversation',
    ],
  ])('refuses %s before approving any member', async (_name, type, method) => {
    const approval = {
      approve: jest.fn(),
      retryApprovedGenericProposal: jest.fn(),
    };
    const service = instance(type as never, {
      proposalApprovalService: approval,
      resolveBatch: jest.fn().mockResolvedValue({
        plan: { id: 'plan-1' },
        proposals: [evalProposal],
      }),
    }) as any;
    await expect(
      service[method]({
        organizationId: ORG,
        projectId: PROJECT,
        conversationId: 'conversation-1',
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(approval.approve).not.toHaveBeenCalled();
    expect(approval.retryApprovedGenericProposal).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    'publishes proposal.approved with shouldProcess from ragEnabled=%s',
    async (ragEnabled, shouldProcess) => {
      const eventPublisher = { publishInTransaction: jest.fn() };
      const service = instance(ProposalApprovalService, {
        eventPublisher,
      }) as any;

      await service.publishApprovedEvent(
        {},
        {
          ...eligibleProposal,
          ragEnabled,
          targetEntityId: 'task-1',
          requestorId: 'user-1',
          createdAt: new Date('2026-10-20T00:00:00Z'),
        },
        'task-1',
      );

      expect(
        eventPublisher.publishInTransaction.mock.calls[0][1].payload,
      ).toMatchObject({ shouldProcess });
    },
  );
});
