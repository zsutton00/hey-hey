import type { ProposalReconciliationService } from './proposal-reconciliation.service';
import { readProposalDependencyPresentation } from './future-dependency-presentation';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Proposal, ProposalFuture } from '@prisma/client';
import type { ProposalOutOfDateStatus } from '@hey-hey/contracts/api/models';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import {
  evaluateApprovalPolicy,
  type ApprovalEvaluation,
} from './permission-evaluation';
import type { ProposalApprovalExplanation } from 'src/generated';
import { EventContextManager } from 'src/core/events/observable-event.context';
import {
  readApprovalEvidence,
  unavailableApprovalExplanation,
} from './approval-explanation';
import {
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from './project-approval-policy.service';
import {
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

import {
  ProjectPolicyMissingError,
  ProposalTargetUnresolvedError,
  logApprovalPolicyReadFailure,
} from './approval-policy-read-diagnostic';

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
  | 'status'
  | 'approvalDecisionEvidence'
  | 'applicationEligible'
> &
  Pick<ProposalWithApprovals, 'approvalRecords'> &
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

interface ResolvedProposalPolicy {
  requiredApprovals: number | null;
  explanation?: ProposalApprovalExplanation;
}

export async function resolveRequiredApprovals(
  tx: AnyTransactionClient,
  proposal: ProposalPolicyFields,
  projectPolicy: ProjectApprovalPolicy,
  options: { workItemTypeRegistry?: WorkItemTypeRegistryService } = {},
): Promise<number> {
  const result = await resolveProposalPolicies(
    tx,
    [proposal],
    projectPolicy,
    options,
  );
  const resolved = result.get(proposal.id);
  if (!resolved || resolved.requiredApprovals === null) {
    throw new Error('Proposal approval policy is unavailable');
  }
  return resolved.requiredApprovals;
}

export async function resolveRequiredApprovalsByProposalId(
  tx: AnyTransactionClient,
  proposals: readonly ProposalPolicyFields[],
  policies: ProjectApprovalPolicy | ReadonlyMap<string, ProjectApprovalPolicy>,
  options: {
    omitUnresolvableTargets?: boolean;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  } = {},
): Promise<ReadonlyMap<string, number | null>> {
  const resolved = await resolveProposalPolicies(
    tx,
    proposals,
    policies,
    options,
  );
  return new Map(
    [...resolved].map(([id, value]) => [id, value?.requiredApprovals ?? null]),
  );
}

async function resolveProposalPolicies(
  tx: AnyTransactionClient,
  proposals: readonly ProposalPolicyFields[],
  policies: ProjectApprovalPolicy | ReadonlyMap<string, ProjectApprovalPolicy>,
  options: {
    omitUnresolvableTargets?: boolean;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
    viewerId?: string;
  } = {},
): Promise<ReadonlyMap<string, ResolvedProposalPolicy | null>> {
  const resolved = new Map<string, ResolvedProposalPolicy | null>();
  const groups = new Map<string, ProposalPolicyFields[]>();
  for (const proposal of proposals) {
    // Group lifecycle and frozen decisions remain with the group owner.
    if (proposal.groupMembership?.requiredApprovals != null) {
      resolved.set(proposal.id, {
        requiredApprovals: proposal.groupMembership.requiredApprovals,
      });
      continue;
    }
    if (
      proposal.action !== 'VERSIONED_UPDATE' &&
      (proposal.status === 'APPROVED' || proposal.status === 'REJECTED')
    ) {
      try {
        const explanation =
          readApprovalEvidence(proposal.approvalDecisionEvidence) ??
          unavailableApprovalExplanation();
        resolved.set(proposal.id, {
          requiredApprovals: explanation.requirement?.requiredApprovals ?? null,
          explanation,
        });
      } catch (error) {
        if (!options.omitUnresolvableTargets) {
          throw error;
        }
        logApprovalPolicyReadFailure(
          logger,
          error,
          'DECISION_EVIDENCE_INVALID',
          { projectId: proposal.projectId, proposalId: proposal.id },
        );
        resolved.set(proposal.id, null);
      }
      continue;
    }
    const key = `${proposal.organizationId}:${proposal.projectId}`;
    groups.set(key, [...(groups.get(key) ?? []), proposal]);
  }
  const viewerId =
    options.viewerId ??
    EventContextManager.getInstance().getCurrentContext()?.userId;
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const seed = group[0];
      if (!seed) {
        return;
      }
      try {
        const policy = policyForProject(policies, seed.projectId);
        const members = await tx.projectMember.findMany({
          where: {
            projectId: seed.projectId,
            user: {
              isActive: true,
              memberships: {
                some: { organizationId: seed.organizationId, isActive: true },
              },
            },
          },
          select: { userId: true },
        });
        const eligibleIds = members.map(
          (member: { userId: string }) => member.userId,
        );
        await Promise.all(
          group.map(async (proposal) => {
            try {
              const context =
                await resolvePermissionEvaluationContextWithEligibleMembers(
                  tx,
                  proposal,
                  deriveProposalSourceContext(proposal),
                  eligibleIds,
                  {
                    organizationId: proposal.organizationId as OrganizationId,
                    projectId: proposal.projectId as ProjectId,
                    workItemTypeRegistry: options.workItemTypeRegistry,
                  },
                );
              const evaluation = evaluateApprovalPolicy(
                context.entity,
                context.proposal,
                policy,
              );
              const explanation = liveApprovalExplanation(
                evaluation,
                proposal,
                viewerId,
              );
              resolved.set(proposal.id, {
                requiredApprovals: evaluation.config.threshold,
                explanation,
              });
            } catch (error) {
              if (!options.omitUnresolvableTargets) {
                throw error;
              }
              logApprovalPolicyReadFailure(logger, error, 'EVALUATION_FAILED', {
                projectId: proposal.projectId,
                proposalId: proposal.id,
              });
              resolved.set(proposal.id, null);
            }
          }),
        );
      } catch (error) {
        if (!options.omitUnresolvableTargets) {
          throw error;
        }
        logApprovalPolicyReadFailure(
          logger,
          error,
          'POLICY_STORAGE_UNAVAILABLE',
          { projectId: seed.projectId },
        );
        for (const proposal of group) {
          resolved.set(proposal.id, null);
        }
      }
    }),
  );
  return resolved;
}

function liveApprovalExplanation(
  evaluation: ApprovalEvaluation,
  proposal: ProposalPolicyFields,
  viewerId?: string | null,
): ProposalApprovalExplanation {
  return {
    ...evaluation.explanation,
    evidence: 'LIVE',
    creditedProposerApprovals:
      evaluation.proposal.source === 'user' &&
      (proposal.approvalRecords ?? []).some(
        (record) =>
          record.userId === proposal.requestorId && record.type === 'APPROVAL',
      )
        ? 1
        : 0,
    viewerEligibility: {
      eligibleToApprove:
        !!viewerId &&
        evaluation.proposal.eligibleProjectMemberIds.includes(viewerId) &&
        proposal.applicationEligible !== false &&
        !(proposal.approvalRecords ?? []).some(
          (record) => record.userId === viewerId,
        ) &&
        (evaluation.proposal.source !== 'user' ||
          proposal.requestorId !== viewerId ||
          evaluation.config.allowsProposerApproval),
    },
  };
}

export async function mapProposalResponse(
  tx: AnyTransactionClient,
  proposal: ProposalWithApprovals,
  projectPolicy:
    | ProjectApprovalPolicy
    | ReadonlyMap<string, ProjectApprovalPolicy>,
  options: {
    reconciliation: ProposalReconciliationService;
    requiredApprovals?: number;
    evaluation?: ApprovalEvaluation;
    viewerId?: string;
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

  const terminal =
    !proposalWithApprovals.groupMembership &&
    proposalWithApprovals.action !== 'VERSIONED_UPDATE' &&
    (proposalWithApprovals.status === 'APPROVED' ||
      proposalWithApprovals.status === 'REJECTED');
  const policyResult =
    options.evaluation && !terminal
      ? {
          requiredApprovals: options.evaluation.config.threshold,
          explanation: liveApprovalExplanation(
            options.evaluation,
            proposalWithApprovals,
            options.viewerId ??
              EventContextManager.getInstance().getCurrentContext()?.userId,
          ),
        }
      : options.requiredApprovals !== undefined &&
          proposalWithApprovals.groupMembership &&
          !terminal
        ? { requiredApprovals: options.requiredApprovals }
        : (
            await resolveProposalPolicies(
              tx,
              [proposalWithApprovals],
              projectPolicy,
              options,
            )
          ).get(proposal.id);
  if (!policyResult) {
    throw new Error('Proposal approval policy is unavailable');
  }
  const requiredApprovals = policyResult.requiredApprovals;
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
    policyResult.explanation,
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
  const policyById = await resolveProposalPolicies(
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
    (proposal) => policyById.get(proposal.id) !== null,
  );
  const outOfDateStatuses = await Promise.all(
    resolvableProposals.map((proposal) =>
      resolveProposalOutOfDateStatus(
        tx,
        proposal,
        options.reconciliation,
      ).catch((error) => {
        if (!options.omitUnresolvableTargets) {
          throw error;
        }
        logApprovalPolicyReadFailure(logger, error, 'TARGET_UNRESOLVED', {
          projectId: proposal.projectId,
          proposalId: proposal.id,
        });
        return null;
      }),
    ),
  );

  const dependencyPresentation = await readProposalDependencyPresentation(
    tx,
    resolvableProposals,
  );
  return resolvableProposals.flatMap((proposal, index) => {
    const policyResult = policyById.get(proposal.id);
    const requiredApprovals = policyResult?.requiredApprovals;
    if (policyResult === null) {
      return [];
    }
    if (requiredApprovals === undefined) {
      throw new Error(
        `Missing API-owned approval requirement for proposal ${proposal.id}`,
      );
    }
    const outOfDateStatus = outOfDateStatuses[index];
    if (!outOfDateStatus) {
      return [];
    }
    return [
      toProposalResponseDto(
        proposal,
        requiredApprovals,
        reviewedFuturesByProposalId.get(proposal.id) ?? null,
        outOfDateStatus,
        dependencyPresentation.get(proposal.id),
        policyResult?.explanation,
      ),
    ];
  });
}

export async function resolveProjectApprovalPolicies(
  projectApprovalPolicyService: Pick<ProjectApprovalPolicyService, 'resolve'>,
  proposals: readonly Pick<
    ProposalPolicyFields,
    'projectId' | 'groupMembership' | 'status' | 'action'
  >[],
): Promise<ReadonlyMap<string, ProjectApprovalPolicy>> {
  const projectIds = [
    ...new Set(
      proposals
        .filter(
          (proposal) =>
            (proposal.action === 'VERSIONED_UPDATE' ||
              (proposal.status !== 'APPROVED' &&
                proposal.status !== 'REJECTED')) &&
            proposal.groupMembership?.requiredApprovals == null,
        )
        .map((proposal) => proposal.projectId),
    ),
  ];
  return new Map(
    (
      await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            return [
              projectId,
              await projectApprovalPolicyService.resolve(
                projectId as ProjectId,
              ),
            ] as const;
          } catch (error) {
            logApprovalPolicyReadFailure(
              logger,
              error,
              'POLICY_STORAGE_UNAVAILABLE',
              { projectId },
            );
            return null;
          }
        }),
      )
    ).filter((entry) => entry !== null),
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
    throw new ProjectPolicyMissingError(
      `Missing resolved approval policy for project ${projectId}`,
    );
  }
  return policy;
}
