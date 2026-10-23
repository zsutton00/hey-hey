import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProposalId } from 'src/types';
import { ProposalApprovalService } from './proposal-approval.service';
import { resolveConversationPlanWorkItem } from '../plan/resolve-plan-work-item';
import type { PlanReviewScope } from './withdraw-plan-review-batch';

export type ApproveAllDraftPlanStagesResult =
  | {
      kind: 'approved';
      approvedCount: number;
      preApprovedCount: number;
      preRejectedCount: number;
      approvedProposalIds: ProposalId[];
    }
  | { kind: 'no_stages'; preRejectedCount: number; reason: string };

@Injectable()
export class PlanStageBatchApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposalApprovalService: ProposalApprovalService,
  ) {}

  private async resolveBatch(scope: PlanReviewScope) {
    const { organizationId, projectId, conversationId } = scope;
    const plan = await resolveConversationPlanWorkItem(
      this.prisma.db,
      organizationId,
      projectId,
      conversationId,
    );
    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        organizationId,
        projectId,
        conversationId,
        action: 'CREATE',
        targetEntityType: 'TASK',
        groupMembership: { is: null },
        AND: [
          { updates: { path: ['type'], equals: 'PLAN_STAGE' } },
          { updates: { path: ['parentTaskId'], equals: plan.id } },
        ],
      },
      include: { approvalRecords: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { plan, proposals };
  }

  async withdrawForRevision(scope: PlanReviewScope): Promise<void> {
    const { proposals } = await this.resolveBatch(scope);
    // Validate the entire batch before rejecting anything. Retried withdrawals
    // skip proposals already rejected by a previous attempt.
    if (
      proposals.some(
        (proposal) =>
          proposal.status !== 'REJECTED' &&
          (proposal.status !== 'DRAFT' ||
            proposal.approvalRecords.some(
              (record) => record.type === 'APPROVAL',
            )),
      )
    ) {
      throw new ConflictException(
        'Cannot replace a Plan stage review batch after approval has begun',
      );
    }
    for (const proposal of proposals.filter(
      (item) => item.status === 'DRAFT',
    )) {
      await this.proposalApprovalService.reject(
        proposal.id,
        scope.organizationId,
        scope.projectId,
        scope.userId,
        'User requested a replacement batch through Continue Revising.',
      );
    }
  }

  async approveAllDraftPlanStagesForConversation(
    scope: PlanReviewScope,
  ): Promise<ApproveAllDraftPlanStagesResult> {
    const { plan, proposals } = await this.resolveBatch(scope);
    const { organizationId, projectId, userId } = scope;
    for (const proposal of proposals) {
      assertProposalApplicationEligible(proposal, 'planStageBatch.approveAll');
    }
    const stageWhere = {
      organizationId,
      projectId,
      parentTaskId: plan.id,
      type: 'PLAN_STAGE',
      archivedAt: null,
    };
    const stages = await this.prisma.db.task.findMany({
      where: stageWhere,
      select: { id: true },
    });
    const materializedIds = new Set<string>(stages.map((stage) => stage.id));
    const approvedProposalIds: ProposalId[] = [];
    const expectedStageIds = new Set<string>();
    const preRejectedCount = proposals.filter(
      (item) => item.status === 'REJECTED',
    ).length;

    for (const proposal of proposals) {
      if (proposal.status === 'REJECTED') continue;
      if (
        proposal.status === 'APPROVED' &&
        materializedIds.has(proposal.targetEntityId)
      ) {
        expectedStageIds.add(proposal.targetEntityId);
        continue;
      }
      if (
        proposal.status === 'DRAFT' &&
        proposal.approvalRecords.some(
          (record) => record.userId === userId && record.type === 'APPROVAL',
        )
      ) {
        throw new ConflictException(
          'Stage proposal is still awaiting its approval threshold',
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
          'Stage proposal approval or materialization is still pending',
        );
      }
      expectedStageIds.add(result.resultingEntityId);
      if (proposal.status === 'DRAFT')
        approvedProposalIds.push(proposal.id as ProposalId);
    }

    if (expectedStageIds.size > 0) {
      const count = await this.prisma.db.task.count({
        where: { ...stageWhere, id: { in: [...expectedStageIds] } },
      });
      if (count !== expectedStageIds.size) {
        throw new ConflictException(
          'Approved Stage work items have not materialized under this Plan',
        );
      }
    }
    if (expectedStageIds.size === 0 && stages.length === 0) {
      return {
        kind: 'no_stages',
        preRejectedCount,
        reason:
          'No approvable Stage work-item proposals or materialized stages exist for this Plan',
      };
    }
    return {
      kind: 'approved',
      approvedCount: approvedProposalIds.length,
      preApprovedCount: stages.length,
      preRejectedCount,
      approvedProposalIds,
    };
  }
}
