import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  FutureRevisionBaseline,
  FutureRevisionContent,
  ProjectReadyFuture,
} from 'src/generated';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { deriveChangedFields } from './entity-context-resolver';
import { futureCompletionEligibility } from './future-revision';
import { evaluatePermissions } from './permission-evaluation';
import type { ProjectApprovalPolicy } from './project-approval-policy.service';
import { deriveProposalSourceContext } from './proposal-response-policy';

const futureSelection = {
  id: true,
  latestProposalId: true,
  targetEntityId: true,
  targetEntityType: true,
  revision: true,
  baseline: true,
  result: true,
  dependencies: { select: { targetEntityId: true } },
} satisfies Prisma.ProposalFutureSelect;

/** Selection needs no history, pending refinements, dependency titles or baseline reconciliation. */
export async function readProjectReadyCandidates(
  db: Prisma.TransactionClient,
  registry: WorkItemTypeRegistryService,
  policy: ProjectApprovalPolicy,
  organizationId: string,
  projectId: string,
) {
  const scope = { organizationId, projectId };
  const futures = await db.proposalFuture.findMany({
    where: { ...scope, outcome: 'STAGED' },
    orderBy: { id: 'asc' },
    select: futureSelection,
  });
  if (futures.length === 0)
    return { candidates: [], eligibleMemberIds: [], unavailableCount: 0 };
  const [proposals, tasks, docs, members] = await Promise.all([
    db.proposal.findMany({
      where: {
        ...scope,
        id: { in: futures.map((f) => f.latestProposalId) },
        status: 'APPROVED',
      },
      include: { approvalRecords: true, groupMembership: true },
    }),
    db.task.findMany({
      where: {
        ...scope,
        id: {
          in: [
            ...new Set(
              futures.flatMap((f) => [
                ...(f.targetEntityType === 'TASK' ? [f.targetEntityId] : []),
                ...f.dependencies.map((d) => d.targetEntityId),
              ]),
            ),
          ],
        },
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        archivedAt: true,
        parentTaskId: true,
        initiativeId: true,
      },
    }),
    db.designDoc.findMany({
      where: {
        ...scope,
        id: {
          in: [
            ...new Set(
              futures
                .filter((f) => f.targetEntityType === 'DESIGN_DOC')
                .map((f) => f.targetEntityId),
            ),
          ],
        },
      },
      select: { id: true, name: true, archivedAt: true },
    }),
    db.projectMember.findMany({
      where: {
        projectId,
        user: {
          isActive: true,
          memberships: { some: { organizationId, isActive: true } },
        },
      },
      select: { userId: true },
    }),
  ]);
  const eligibleMemberIds = members.map((m) => m.userId);
  if (eligibleMemberIds.length === 0)
    throw new BadRequestException(
      'Permission evaluation requires at least one active project member',
    );
  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const candidates: {
    item: ProjectReadyFuture;
    baseline: FutureRevisionBaseline;
    result: FutureRevisionContent;
  }[] = [];
  let unavailableCount = 0;
  for (const future of futures) {
    const proposal = proposalById.get(future.latestProposalId);
    if (!proposal) continue;
    try {
      const dependencies = future.dependencies.map(
        (d) =>
          ({
            edgeType: 'DEPENDS_ON',
            targetEntityType: 'TASK',
            targetEntityId: d.targetEntityId,
          }) as const,
      );
      const completionEligibility = futureCompletionEligibility(
        registry,
        projectId,
        dependencies,
        taskById,
      );
      if (!completionEligibility.eligible) continue;
      const task = taskById.get(future.targetEntityId);
      const target =
        future.targetEntityType === 'TASK'
          ? task
          : docById.get(future.targetEntityId);
      if (!target || !proposal.title)
        throw new Error('Ready future display metadata is unavailable');
      if (
        future.targetEntityType !== 'TASK' &&
        future.targetEntityType !== 'DESIGN_DOC'
      )
        throw new Error('Unsupported future target');
      const baseline = future.baseline as unknown as FutureRevisionBaseline;
      const required =
        proposal.groupMembership?.requiredApprovals ??
        evaluatePermissions(
          future.targetEntityType === 'TASK' && task
            ? {
                type: task.type,
                parentTaskId: task.parentTaskId,
                initiativeId: task.initiativeId,
              }
            : { type: 'DESIGN_DOC', parentTaskId: null, initiativeId: null },
          {
            ...deriveProposalSourceContext(proposal),
            action: 'UPDATE',
            eligibleProjectMemberIds: eligibleMemberIds,
            changedFields: await deriveChangedFields(db, proposal, {
              ...scope,
              workItemTypeRegistry: registry,
              future: {
                baseline,
                result: future.result as unknown as FutureRevisionContent,
              },
            }),
          },
          policy,
        ).threshold;
      const approvals = new Set(
        proposal.approvalRecords
          .filter((r) => r.type === 'APPROVAL')
          .map((r) => r.userId),
      ).size;
      if (approvals < required) continue;
      candidates.push({
        baseline,
        result: future.result as unknown as FutureRevisionContent,
        item: {
          futureId: future.id,
          proposalId: future.latestProposalId,
          proposalTitle: proposal.title,
          targetEntityId: future.targetEntityId,
          targetEntityType: future.targetEntityType,
          targetName: target.name,
          targetType:
            future.targetEntityType === 'TASK' && task
              ? task.type
              : 'DESIGN_DOC',
          ...(proposal.groupMembership
            ? { reviewGroupId: proposal.groupMembership.groupId }
            : {}),
          applicability: {
            revision: future.revision,
            canApply: true,
            blockers: [],
            completionEligibility,
          },
        },
      });
    } catch {
      unavailableCount += 1;
    }
  }
  return { candidates, eligibleMemberIds, unavailableCount };
}
