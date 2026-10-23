import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProposalId } from 'src/types';
import { ProposalApprovalService } from './proposal-approval.service';
import {
  resolvePlanReviewBatch,
  withdrawPlanReviewBatch,
  type PlanReviewScope,
} from './withdraw-plan-review-batch';

export type ApproveAllDraftPlanStepsResult =
  | {
      kind: 'approved';
      approvedCount: number;
      preApprovedCount: number;
      preRejectedCount: number;
      approvedProposalIds: ProposalId[];
    }
  | { kind: 'no_steps'; preRejectedCount: number; reason: string };

@Injectable()
export class PlanStepBatchApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposalApprovalService: ProposalApprovalService,
  ) {}

  private async resolveBatch(scope: PlanReviewScope) {
    return resolvePlanReviewBatch(this.prisma, scope, 'STANDARD');
  }

  async withdrawForRevision(scope: PlanReviewScope): Promise<void> {
    await withdrawPlanReviewBatch(
      this.prisma,
      this.proposalApprovalService,
      scope,
      'STANDARD',
    );
  }

  async approveAllDraftPlanStepsForConversation(
    scope: PlanReviewScope,
  ): Promise<ApproveAllDraftPlanStepsResult> {
    const { plan, proposals } = await this.resolveBatch(scope);
    const { organizationId, projectId, userId } = scope;
    for (const proposal of proposals) {
      assertProposalApplicationEligible(proposal, 'planStepBatch.approveAll');
    }
    const stepWhere = {
      organizationId,
      projectId,
      type: 'STANDARD',
      parentTask: {
        organizationId,
        projectId,
        parentTaskId: plan.id,
        type: 'PLAN_STAGE',
        archivedAt: null,
      },
      archivedAt: null,
    };
    const steps = await this.prisma.db.task.findMany({
      where: stepWhere,
      select: { id: true },
    });
    const materializedIds = new Set<string>(steps.map((step) => step.id));
    const approvedProposalIds: ProposalId[] = [];
    const expectedStepIds = new Set<string>();
    const preRejectedCount = proposals.filter(
      (item) => item.status === 'REJECTED',
    ).length;

    for (const proposal of proposals) {
      if (proposal.status === 'REJECTED') continue;
      if (
        proposal.status === 'APPROVED' &&
        materializedIds.has(proposal.targetEntityId)
      ) {
        expectedStepIds.add(proposal.targetEntityId);
        continue;
      }
      if (
        proposal.status === 'DRAFT' &&
        proposal.approvalRecords.some(
          (record) => record.userId === userId && record.type === 'APPROVAL',
        )
      ) {
        throw new ConflictException(
          'Step proposal is still awaiting its approval threshold',
        );
      }
      // Resume interrupted durable materialization without recording approval twice.
      const result =
        proposal.status === 'APPROVED'
          ? await this.proposalApprovalService.retryApprovedGenericProposal({
              proposalId: proposal.id,
              organizationId,
              projectId,
            })
          : await this.proposalApprovalService.approve(
              proposal.id,
              organizationId,
              projectId,
              userId,
            );
      if (!result.enacted || !result.resultingEntityId) {
        throw new ConflictException(
          'Step proposal approval or materialization is still pending',
        );
      }
      expectedStepIds.add(result.resultingEntityId);
      if (proposal.status === 'DRAFT')
        approvedProposalIds.push(proposal.id as ProposalId);
    }

    if (expectedStepIds.size > 0) {
      const count = await this.prisma.db.task.count({
        where: { ...stepWhere, id: { in: [...expectedStepIds] } },
      });
      if (count !== expectedStepIds.size) {
        throw new ConflictException(
          'Approved Step work items have not materialized under this Plan',
        );
      }
    }
    if (expectedStepIds.size === 0 && steps.length === 0) {
      return {
        kind: 'no_steps',
        preRejectedCount,
        reason:
          'No approvable Step work-item proposals or materialized steps exist for this Plan',
      };
    }
    return {
      kind: 'approved',
      approvedCount: approvedProposalIds.length,
      preApprovedCount: steps.length,
      preRejectedCount,
      approvedProposalIds,
    };
  }
}
