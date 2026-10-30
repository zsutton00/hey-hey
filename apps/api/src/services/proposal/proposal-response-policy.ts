import type { ProposalReconciliationService } from './proposal-reconciliation.service';
import { readProposalDependencyPresentation } from './future-dependency-presentation';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Proposal, ProposalFuture } from '@prisma/client';
import type { ProposalOutOfDateStatus } from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { evaluatePermissions } from './permission-evaluation';
import {
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from './project-approval-policy.service';
import {
  resolvePermissionEvaluationContext,
  resolvePermissionEvaluationContextWithEligibleMembers,
  type ProposalSourceContext,
} from './permission-evaluation-context';
import {
  toProposalResponseDto,
  type ProposalGroupMembershipWithGroup,
  type ProposalWithApprovals,
  type TypedProposalResponse,
} from './proposal.types';
import {
  futureRevisionReferenceKey,
  readFutureRevisions,
  parseFutureRevisionMutation,
} from './future-revision';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';

const logger = new Logger('ProposalResponsePolicy');

type ProposalPolicyFields = Pick<
  Proposal,
  | 'action'
  | 'id'
  | 'organizationId'
  | 'projectId'
  | 'requestorContext'
  | 'requestorId'
  | 'targetEntityId'
  | 'targetEntityType'
  | 'updates'
> &
  Pick<ProposalWithApprovals, 'groupMembership'>;

export async function resolveProposalOutOfDateStatuses(
  tx: AnyTransactionClient,
  proposals: readonly Proposal[],
  reconciliation: ProposalReconciliationService,
): Promise<ReadonlyMap<string, ProposalOutOfDateStatus>> {
  const statuses = new Map<string, ProposalOutOfDateStatus>();
  const applicable = proposals.filter((proposal) => {
    const supported =
      (proposal.targetEntityType === 'TASK' &&
        (proposal.action === 'UPDATE' || proposal.action === 'DELETE')) ||
      (proposal.action === 'VERSIONED_UPDATE' &&
        (proposal.targetEntityType === 'TASK' ||
          proposal.targetEntityType === 'DESIGN_DOC'));
    const terminal =
      proposal.status === 'REJECTED' ||
      (proposal.status === 'APPROVED' &&
        proposal.action !== 'VERSIONED_UPDATE');
    if (!supported || terminal) {
      statuses.set(proposal.id, 'NOT_APPLICABLE');
      return false;
    }
    return true;
  });
  const approvedFutures = applicable.filter(
    (proposal) =>
      proposal.action === 'VERSIONED_UPDATE' && proposal.status === 'APPROVED',
  );
  if (approvedFutures.length) {
    const futures: Pick<ProposalFuture, 'latestProposalId' | 'outcome'>[] =
      await tx.proposalFuture.findMany({
        where: {
          OR: approvedFutures.map((proposal) => ({
            latestProposalId: proposal.id,
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
          })),
        },
        select: { latestProposalId: true, outcome: true },
      });
    const outcomes = new Map(
      futures.map((future) => [future.latestProposalId, future.outcome]),
    );
    for (const proposal of approvedFutures) {
      const outcome = outcomes.get(proposal.id);
      if (!outcome) {
        statuses.set(proposal.id, 'UNKNOWN');
      } else if (outcome !== 'STAGED') {
        statuses.set(proposal.id, 'NOT_APPLICABLE');
      }
    }
  }

  for (const proposal of applicable) {
    if (
      !statuses.has(proposal.id) &&
      proposal.action === 'VERSIONED_UPDATE' &&
      parseFutureRevisionMutation(proposal.updates).operation !== 'REVISE'
    ) {
      statuses.set(proposal.id, 'NOT_APPLICABLE');
    }
  }
  const decisions = await reconciliation.decisionsForProposals(
    tx,
    applicable.filter((proposal) => !statuses.has(proposal.id)),
  );
  for (const [id, decision] of decisions) {
    statuses.set(
      id,
      decision.kind === 'BLOCKED'
        ? 'UNKNOWN'
        : decision.kind === 'REQUIRED'
          ? 'OUT_OF_DATE'
          : 'CURRENT',
    );
  }
  return statuses;
}

async function resolveProposalOutOfDateStatus(
  tx: AnyTransactionClient,
  proposal: Proposal,
  reconciliation: ProposalReconciliationService,
): Promise<ProposalOutOfDateStatus> {
  return (
    await resolveProposalOutOfDateStatuses(tx, [proposal], reconciliation)
  ).get(proposal.id)!;
}

export function deriveProposalSourceContext(
  proposal: Pick<Proposal, 'requestorContext' | 'requestorId'>,
): ProposalSourceContext {
  const requestor =
    (proposal.requestorContext as Record<string, unknown> | null) ?? null;
  const source = requestor?.source;
  const toolName =
    typeof requestor?.toolName === 'string' ? requestor.toolName : null;

  if (source === 'user' || source === 'agent') {
    return { source, toolName, authorId: proposal.requestorId };
  }

  // Legacy proposals persisted before requestorContext.source existed all
  // originated at the MCP boundary, so their enforcement source is agent.
  return { source: 'agent', toolName, authorId: proposal.requestorId };
}

/** Resolve proposal-owned future IDs in one batch for the response page. */
export async function readProposalReviewedFutures(
  tx: AnyTransactionClient,
  registry: WorkItemTypeRegistryService | undefined,
  proposals: readonly Pick<
    Proposal,
    'action' | 'id' | 'organizationId' | 'projectId' | 'updates'
  >[],
): Promise<ReadonlyMap<string, TypedProposalResponse['reviewedFuture']>> {
  const candidates = proposals.flatMap((proposal) => {
    if (proposal.action !== 'VERSIONED_UPDATE') return [];
    const futureId = (proposal.updates as Record<string, unknown> | null)
      ?.futureId;
    return typeof futureId === 'string'
      ? [
          {
            id: futureId,
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
          },
        ]
      : [];
  });
  const futures: ReadonlyMap<string, TypedProposalResponse['reviewedFuture']> =
    registry ? await readFutureRevisions(tx, registry, candidates) : new Map();

  return new Map(
    proposals.map((proposal) => {
      if (proposal.action !== 'VERSIONED_UPDATE') {
        return [proposal.id, null];
      }
      const futureId = (proposal.updates as Record<string, unknown> | null)
        ?.futureId;
      if (typeof futureId !== 'string') return [proposal.id, null];
      return [
        proposal.id,
        futures.get(
          futureRevisionReferenceKey({
            id: futureId,
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
          }),
        ) ?? null,
      ];
    }),
  );
}

export async function resolveRequiredApprovals(
  tx: AnyTransactionClient,
  proposal: ProposalPolicyFields,
  projectPolicy: ProjectApprovalPolicy,
  options: { workItemTypeRegistry?: WorkItemTypeRegistryService } = {},
): Promise<number> {
  const frozenRequiredApprovals = proposal.groupMembership?.requiredApprovals;
  if (
    frozenRequiredApprovals !== null &&
    frozenRequiredApprovals !== undefined
  ) {
    return frozenRequiredApprovals;
  }

  const evaluationContext = await resolvePermissionEvaluationContext(
    tx,
    proposal.organizationId as OrganizationId,
    proposal.projectId as ProjectId,
    {
      targetEntityType: proposal.targetEntityType,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      updates: proposal.updates,
    },
    deriveProposalSourceContext(proposal),
    options.workItemTypeRegistry,
  );

  return evaluatePermissions(
    evaluationContext.entity,
    evaluationContext.proposal,
    projectPolicy,
  ).threshold;
}

export async function resolveRequiredApprovalsByProposalId(
  tx: AnyTransactionClient,
  proposals: readonly ProposalPolicyFields[],
  projectPolicies:
    | ProjectApprovalPolicy
    | ReadonlyMap<string, ProjectApprovalPolicy>,
  options: {
    omitUnresolvableTargets?: boolean;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  } = {},
): Promise<ReadonlyMap<string, number | null>> {
  const frozenEntries = proposals.flatMap((proposal) => {
    const frozenRequiredApprovals = proposal.groupMembership?.requiredApprovals;
    return frozenRequiredApprovals === null ||
      frozenRequiredApprovals === undefined
      ? []
      : [[proposal.id, frozenRequiredApprovals] as const];
  });
  const livePolicyProposals = proposals.filter(
    (proposal) =>
      proposal.groupMembership?.requiredApprovals === null ||
      proposal.groupMembership?.requiredApprovals === undefined,
  );
  const groups = new Map<string, ProposalPolicyFields[]>();
  for (const proposal of livePolicyProposals) {
    const key = `${proposal.organizationId}:${proposal.projectId}`;
    groups.set(key, [...(groups.get(key) ?? []), proposal]);
  }

  const groupedEntries = await Promise.all(
    [...groups.values()].map(async (group) => {
      const seed = group[0];
      if (!seed) return [];
      const projectPolicy = policyForProject(projectPolicies, seed.projectId);

      const eligibleMembers = await tx.projectMember.findMany({
        where: {
          projectId: seed.projectId,
          user: {
            isActive: true,
            memberships: {
              some: {
                organizationId: seed.organizationId,
                isActive: true,
              },
            },
          },
        },
        select: { userId: true },
      });
      const eligibleProjectMemberIds = eligibleMembers.map(
        (member: { userId: string }) => member.userId,
      );

      return Promise.all(
        group.map(async (proposal) => {
          try {
            const evaluationContext =
              await resolvePermissionEvaluationContextWithEligibleMembers(
                tx,
                {
                  targetEntityType: proposal.targetEntityType,
                  action: proposal.action,
                  targetEntityId: proposal.targetEntityId,
                  updates: proposal.updates,
                },
                deriveProposalSourceContext(proposal),
                eligibleProjectMemberIds,
                {
                  organizationId: proposal.organizationId as OrganizationId,
                  projectId: proposal.projectId as ProjectId,
                  workItemTypeRegistry: options.workItemTypeRegistry,
                },
              );
            return [
              proposal.id,
              evaluatePermissions(
                evaluationContext.entity,
                evaluationContext.proposal,
                projectPolicy,
              ).threshold,
            ] as const;
          } catch (error) {
            if (
              options.omitUnresolvableTargets &&
              error instanceof NotFoundException
            ) {
              logger.warn(
                'Omitting proposal with an unresolvable target from a collection response',
                {
                  proposalId: proposal.id,
                  targetEntityId: proposal.targetEntityId,
                  targetEntityType: proposal.targetEntityType,
                },
              );
              return [proposal.id, null] as const;
            }
            throw error;
          }
        }),
      );
    }),
  );

  return new Map([...frozenEntries, ...groupedEntries.flat()]);
}

export async function mapProposalResponse(
  tx: AnyTransactionClient,
  proposal: ProposalWithApprovals,
  projectPolicy: ProjectApprovalPolicy,
  options: {
    reconciliation: ProposalReconciliationService;
    requiredApprovals?: number;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  },
): Promise<TypedProposalResponse> {
  const proposalWithApprovals =
    proposal.approvalRecords !== undefined &&
    proposal.groupMembership !== undefined &&
    proposal.workItemChangeSetMaterialization !== undefined
      ? proposal
      : await tx.proposal.findUnique({
          where: { id: proposal.id },
          include: {
            approvalRecords: true,
            workItemChangeSetMaterialization: {
              include: { checkpoints: true },
            },
            groupMembership: {
              include: {
                group: {
                  select: {
                    status: true,
                    revision: true,
                    frozenRevision: true,
                  },
                },
              },
            },
          },
        });

  if (!proposalWithApprovals) {
    throw new Error(
      `Proposal ${proposal.id} disappeared while mapping response`,
    );
  }

  const requiredApprovals =
    options.requiredApprovals ??
    (await resolveRequiredApprovals(tx, proposalWithApprovals, projectPolicy, {
      workItemTypeRegistry: options.workItemTypeRegistry,
    }));
  const reviewedFuturesByProposalId = await readProposalReviewedFutures(
    tx,
    options.workItemTypeRegistry,
    [proposalWithApprovals],
  );
  const outOfDateStatus = await resolveProposalOutOfDateStatus(
    tx,
    proposalWithApprovals,
    options.reconciliation,
  );
  const dependencyPresentation = await readProposalDependencyPresentation(tx, [
    proposalWithApprovals,
  ]);
  return toProposalResponseDto(
    proposalWithApprovals,
    requiredApprovals,
    reviewedFuturesByProposalId.get(proposal.id) ?? null,
    outOfDateStatus,
    dependencyPresentation.get(proposal.id),
  );
}

export async function mapProposalResponses(
  tx: AnyTransactionClient,
  proposals: readonly ProposalWithApprovals[],
  projectPolicies:
    | ProjectApprovalPolicy
    | ReadonlyMap<string, ProjectApprovalPolicy>,
  options: {
    reconciliation: ProposalReconciliationService;
    omitUnresolvableTargets?: boolean;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  },
): Promise<TypedProposalResponse[]> {
  const missingApprovalIds = proposals
    .filter((proposal) => proposal.approvalRecords === undefined)
    .map((proposal) => proposal.id);
  const loadedApprovals: ProposalWithApprovals[] =
    missingApprovalIds.length === 0
      ? []
      : ((await tx.proposal.findMany({
          where: { id: { in: missingApprovalIds } },
          include: { approvalRecords: true },
        })) as ProposalWithApprovals[]);
  const loadedById = new Map(
    loadedApprovals.map((proposal) => [proposal.id, proposal]),
  );
  const complete = proposals.map((proposal) => {
    if (proposal.approvalRecords !== undefined) return proposal;
    const loaded = loadedById.get(proposal.id);
    if (!loaded) {
      throw new Error(
        `Proposal ${proposal.id} disappeared while mapping response`,
      );
    }
    return loaded;
  });

  const missingMembershipIds = complete
    .filter((proposal) => proposal.groupMembership === undefined)
    .map((proposal) => proposal.id);
  const loadedMemberships: ProposalGroupMembershipWithGroup[] =
    missingMembershipIds.length === 0
      ? []
      : ((await tx.proposalGroupMember.findMany({
          where: { proposalId: { in: missingMembershipIds } },
          include: {
            group: {
              select: {
                status: true,
                revision: true,
                frozenRevision: true,
              },
            },
          },
        })) as ProposalGroupMembershipWithGroup[]);
  const membershipByProposalId = new Map(
    loadedMemberships.map((membership) => [membership.proposalId, membership]),
  );
  const withMembership = complete.map((proposal) => {
    if (proposal.groupMembership !== undefined) return proposal;
    return {
      ...proposal,
      groupMembership: membershipByProposalId.get(proposal.id) ?? null,
    };
  });
  logger.debug('Mapped proposal responses with one optional membership batch', {
    proposalCount: withMembership.length,
    membershipCount: loadedMemberships.length,
    ungroupedCount: withMembership.filter(
      (proposal) => proposal.groupMembership === null,
    ).length,
  });
  const requiredById = await resolveRequiredApprovalsByProposalId(
    tx,
    withMembership,
    projectPolicies,
    options,
  );
  const reviewedFuturesByProposalId = await readProposalReviewedFutures(
    tx,
    options.workItemTypeRegistry,
    withMembership,
  );

  const resolvableProposals = withMembership.filter(
    (proposal) => requiredById.get(proposal.id) !== null,
  );
  const outOfDateStatuses = await Promise.all(
    resolvableProposals.map((proposal) =>
      resolveProposalOutOfDateStatus(tx, proposal, options.reconciliation),
    ),
  );

  const dependencyPresentation = await readProposalDependencyPresentation(
    tx,
    resolvableProposals,
  );
  return resolvableProposals.flatMap((proposal, index) => {
    const requiredApprovals = requiredById.get(proposal.id);
    if (requiredApprovals === null) {
      return [];
    }
    if (requiredApprovals === undefined) {
      throw new Error(
        `Missing API-owned approval requirement for proposal ${proposal.id}`,
      );
    }
    const outOfDateStatus = outOfDateStatuses[index];
    if (!outOfDateStatus) {
      throw new Error(`Missing out-of-date status for proposal ${proposal.id}`);
    }
    return [
      toProposalResponseDto(
        proposal,
        requiredApprovals,
        reviewedFuturesByProposalId.get(proposal.id) ?? null,
        outOfDateStatus,
        dependencyPresentation.get(proposal.id),
      ),
    ];
  });
}

export async function resolveProjectApprovalPolicies(
  projectApprovalPolicyService: Pick<ProjectApprovalPolicyService, 'resolve'>,
  proposals: readonly Pick<
    ProposalPolicyFields,
    'projectId' | 'groupMembership'
  >[],
): Promise<ReadonlyMap<string, ProjectApprovalPolicy>> {
  const projectIds = [
    ...new Set(
      proposals
        .filter(
          (proposal) =>
            proposal.groupMembership?.requiredApprovals === null ||
            proposal.groupMembership?.requiredApprovals === undefined,
        )
        .map((proposal) => proposal.projectId),
    ),
  ];
  return new Map(
    await Promise.all(
      projectIds.map(
        async (projectId) =>
          [
            projectId,
            await projectApprovalPolicyService.resolve(projectId as ProjectId),
          ] as const,
      ),
    ),
  );
}

function policyForProject(
  policies: ProjectApprovalPolicy | ReadonlyMap<string, ProjectApprovalPolicy>,
  projectId: string,
): ProjectApprovalPolicy {
  if ('rules' in policies) {
    return policies;
  }
  const policy = policies.get(projectId);
  if (!policy) {
    throw new Error(
      `Missing resolved approval policy for project ${projectId}`,
    );
  }
  return policy;
}
