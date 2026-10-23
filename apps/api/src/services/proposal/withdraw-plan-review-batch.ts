import { ConflictException } from '@nestjs/common';
import type { PrismaService } from 'src/prisma/prisma.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import { resolveConversationPlanWorkItem } from '../plan/resolve-plan-work-item';
import type { ProposalApprovalService } from './proposal-approval.service';

export type PlanReviewScope = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId: ConversationId;
  userId: UserId;
};

/** Select ordinary proposals within the canonical Plan's work-item hierarchy. */
export async function resolvePlanReviewBatch(
  prisma: PrismaService,
  scope: PlanReviewScope,
  type: 'PLAN_STAGE' | 'STANDARD',
) {
  const { organizationId, projectId, conversationId } = scope;
  const plan = await resolveConversationPlanWorkItem(
    prisma.db,
    organizationId,
    projectId,
    conversationId,
  );
  const parentIds =
    type === 'PLAN_STAGE'
      ? [plan.id]
      : (
          await prisma.db.task.findMany({
            where: {
              organizationId,
              projectId,
              parentTaskId: plan.id,
              type: 'PLAN_STAGE',
              archivedAt: null,
            },
            select: { id: true },
          })
        ).map((stage) => stage.id);
  const candidates = await prisma.db.proposal.findMany({
    where: {
      organizationId,
      projectId,
      conversationId,
      action: 'CREATE',
      targetEntityType: 'TASK',
      groupMembership: { is: null },
      OR: parentIds.map((parentTaskId) => ({
        updates: { path: ['parentTaskId'], equals: parentTaskId },
      })),
    },
    include: { approvalRecords: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // Missing type is the generated create-work-item contract's STANDARD default.
  const proposals = candidates.filter(
    ({ updates }) =>
      updates !== null &&
      typeof updates === 'object' &&
      !Array.isArray(updates) &&
      (updates.type === type ||
        (type === 'STANDARD' && updates.type === undefined)),
  );
  return { plan, proposals };
}

/** Withdraw unapproved individual proposals before a replacement authoring turn. */
export async function withdrawPlanReviewBatch(
  prisma: PrismaService,
  approvals: ProposalApprovalService,
  scope: PlanReviewScope,
  type: 'PLAN_STAGE' | 'STANDARD',
): Promise<void> {
  const { proposals } = await resolvePlanReviewBatch(prisma, scope, type);
  // Validate the whole batch first; retries skip previously rejected proposals.
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
      'Cannot replace a Plan review batch after approval has begun',
    );
  }
  for (const proposal of proposals.filter((item) => item.status === 'DRAFT')) {
    await approvals.reject(
      proposal.id,
      scope.organizationId,
      scope.projectId,
      scope.userId,
      'User requested a replacement batch through Continue Revising.',
    );
  }
}
