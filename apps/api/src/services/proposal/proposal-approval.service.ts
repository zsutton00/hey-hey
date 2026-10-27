import { isEqual } from 'lodash';
import { readProjectReadyCandidates } from './project-ready-futures';
import {
  futureGraph,
  graphChangeSet,
  graphContentBasis,
  remapGraphProjection,
} from './future-graph';
import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import { readFutureRevision, stageFutureRevision } from './future-revision';
import {
  futureBaselineBlocker,
  futureTargetUpdates,
  matchesFutureConfirmation,
  readFutureApplyConfirmation,
} from './future-application';
import { ProposalReconciliationService } from './proposal-reconciliation.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Proposal } from '@prisma/client';
import {
  EntityType,
  Prisma,
  ProposalStatus as PrismaProposalStatus,
  ProposalApprovalType,
  WorkItemTypeCascadeExecutionState,
} from '@prisma/client';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import type { ProposalApprovedEventPayload } from 'src/core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import type {
  CreateDesignDocDto,
  FutureApplicability,
  FutureApplicationOffer,
  ProjectReadyFuture,
  ProjectReadyFuturesPage,
  FutureApplyRequest,
  FutureApplyResponse,
  FutureRevisionResponse,
  CreateInitiativeDto,
  CreateProposalDto,
  CreateTaskDto,
  Influence,
  ProjectedWorkItemChangeSetResponse,
  TaskSectionInput,
  UpdateDesignDocDto,
  UpdateInitiativeDto,
  UpdateTaskDto,
  WorkflowProposalLinkInput,
  WorkflowProposalStepInput,
  WorkItemChangeSetValidationRequest,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSummaryDto,
  WorkItemTypeCascadeDeleteUpdatesPayload,
  EntityPromptTemplateProposalUpdatesPayload,
} from 'src/generated';
import {
  InitiativeSourceType,
  MentionCreatedEventPayload,
  WorkflowName,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkStatus,
} from 'src/generated';
import { PayloadType } from 'src/generated/model/payloadType';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import {
  DesignDocService,
  type DesignDocUpdatePostCommit,
} from 'src/services/design-doc/design-doc.service';
import { InfluenceService } from 'src/services/influence/influence.service';
import {
  InitiativeService,
  type InitiativeUpdatePostCommit,
} from 'src/services/initiatives/initiative.service';
import {
  diffBodyMentions,
  publishBodyMentionEvents,
} from 'src/services/mentions/body-mention-events';
import {
  MentionProcessingService,
  ResolvedMention,
} from 'src/services/mentions/mention-processing.service';
import { PlanFromDesignDocLauncherService } from 'src/services/plan/plan-from-design-doc-launcher.service';
import { TaskService } from 'src/services/tasks/task.service';
import type { TaskUpdatePostCommit } from 'src/services/tasks/task.service';
import { WORK_ITEM_TYPE_KEYS } from 'src/services/tasks/work-item-type-keys';
import { FeatureRequirementsReadError } from 'src/services/tasks/feature-requirements-reader';
import {
  diffRequirementCitationEdges,
  type RequirementCitationEdgeDiff,
} from 'src/services/tasks/feature-requirement-citation-edges';
import { WorkItemTypeLifecycleService } from 'src/services/tasks/work-item-type-lifecycle.service';
import {
  WorkItemTypeRegistryService,
  writtenAgentSettableStatuses,
} from 'src/services/tasks/work-item-type-registry.service';
import {
  collectWorkItemMentionContent,
  type WorkItemMentionSectionRow,
} from 'src/services/mentions/work-item-mention-content';
import { ConversationWorkflowService } from 'src/services/workflows/conversation-workflow.service';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MessageId,
  OrganizationId,
  PlanId,
  ProjectId,
  ProposalId,
  TaskId,
  UserId,
} from 'src/types';
import { foldImplementationIntoSections } from 'src/utils/implementation-folding.util';
import { v4 as uuidv4 } from 'uuid';
import {
  type MaterializedProposalEdge,
  MaterializableEdge,
  PendingEdgeService,
  type PendingEdgeTaskPostCommit,
} from './pending-edge.service';
import { evaluatePermissions } from './permission-evaluation';
import { resolvePermissionEvaluationContext } from './permission-evaluation-context';
import {
  deriveProposalOutOfDateStatus,
  deriveProposalSourceContext,
  mapProposalResponse,
  resolveProjectApprovalPolicies,
  resolveRequiredApprovals,
  resolveRequiredApprovalsByProposalId,
} from './proposal-response-policy';
import {
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from './project-approval-policy.service';
import { NIL_UUID } from './work-item-type-proposal.builder';
import type {
  ProposalGroupMembershipWithGroup,
  ProposalWithApprovals,
  TypedProposalResponse,
} from './proposal.types';
import {
  assertProposalStructurallyValid,
  assertWorkflowProposalLinksStructurallyValid,
  isCascadeWorkItemTypeDeletePayload,
} from './proposal-validation.engine';
import { assertWorkItemTypeEditSupported } from './work-item-type-edit-classifier';
import { assertStoredTracksDeclarationsValid } from './proposal-tracking-attachment';
import {
  WorkItemChangeSetMaterializerService,
  type PreparedChangeSetProjection,
  type WorkItemChangeSetMaterializationResult,
} from './work-item-change-set-materializer.service';
import { normalizeDiagramChangeSet } from './diagram-change-set-compatibility';
import { ProposalGroupDecisionService } from './proposal-group-decision.service';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { EntityPromptTemplateService } from '../entity-prompt-template.service';
import { toProposalApprovalFailureDiagnostic } from './proposal-approval-failure-diagnostic';

export interface ApprovalResult {
  proposal: TypedProposalResponse;
  resultingEntityId: string | null;
  enacted: boolean;
}

export interface RejectionResult {
  proposal: TypedProposalResponse;
}

/**
 * Closure that runs the entity-side post-commit work produced by
 * {@link TaskService.updateInTransaction} or
 * {@link DesignDocService.updateInTransaction}. Captured inside the proposal
 * tx and invoked by the caller after the outer tx commits, alongside edge
 * materialization.
 */
export type PostCommitRunner = () => Promise<void>;

export type FutureProposalApprovalState =
  | {
      kind: 'future';
      proposalId: string;
      proposalTitle: string | null;
      futureId: string;
      status: PrismaProposalStatus;
      approvalsRecorded: number;
      requiredApprovals: number;
    }
  | {
      kind: 'unresolved';
      proposalId: string;
      reason: 'NOT_FOUND' | 'NOT_FUTURE_REVISION';
    };

export const NOOP_POST_COMMIT: PostCommitRunner = async () => {};

// Citation creates participate in enactment and must complete within its
// timeout; other graph publication remains post-commit.
export const PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS = {
  timeout: 30_000,
} as const;

type EnactResult = {
  entityId: string;
  materializableEdges: MaterializableEdge[];
  runPostCommit: PostCommitRunner;
  durablePostCommits: DurablePostCommit[];
};

type DurablePostCommit =
  | { kind: 'TASK_UPDATE'; entityId: string; payload: TaskUpdatePostCommit }
  | {
      kind: 'DESIGN_DOC_UPDATE';
      entityId: string;
      payload: DesignDocUpdatePostCommit;
    }
  | {
      kind: 'INITIATIVE_UPDATE';
      entityId: string;
      payload: InitiativeUpdatePostCommit;
    }
  | { kind: 'DESIGN_DOC_DELETE'; entityId: string }
  | { kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED'; typeKey: string }
  | { kind: 'REQUIREMENT_CITATION_EDGE_DELETE'; edgeIds: string[] };

/** Prior requirements of a FEATURE proposal that writes its requirements. */
type PriorRequirementCitations = { priorContent: string | null };

const REQUIREMENT_CITATION_EDGE_DELETE_REASON =
  'Feature requirements no longer cite this entity.';

type GroupedPublicationPayload = {
  edges: MaterializableEdge[];
  postCommits: DurablePostCommit[];
};

type EnactmentOptions = {
  reviewedFuture?: FutureRevisionResponse;
  reservedTargetEntityId?: string;
  onImmediateEdgeCreated?: (edge: MaterializedProposalEdge) => void;
};

export type GroupedMemberEnactmentResult = {
  proposal: TypedProposalResponse;
  resultingEntityId: string;
  alreadyApplied: boolean;
  enacted: boolean;
};

type ApprovalTransactionResult = {
  proposal: Proposal;
  resultingEntityId: string | null;
  materializableEdges: MaterializableEdge[];
  runPostCommit: PostCommitRunner;
  enacted: boolean;
  genericChangeSetReady: boolean;
  cascadeExecutionId?: string;
};

@Injectable()
export class ProposalApprovalService {
  private readonly logger = new Logger(ProposalApprovalService.name);

  private async checkFutureApplicationApproval(
    tx: Prisma.TransactionClient,
    future: FutureRevisionResponse,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ) {
    const proposal = await tx.proposal.findFirst({
      where: { id: future.latestProposalId, organizationId, projectId },
      include: {
        approvalRecords: true,
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
    if (!proposal || proposal.status !== 'APPROVED')
      return { blocker: 'APPROVAL_REQUIRED' as const };
    const context = await resolvePermissionEvaluationContext(
      tx,
      organizationId,
      projectId,
      proposal,
      deriveProposalSourceContext(proposal),
      this.workItemTypeRegistry,
    );
    if (!context.proposal.eligibleProjectMemberIds.includes(userId))
      return { blocker: 'PERMISSION_DENIED' as const };
    const { requiredApprovals, approvalsRecorded } =
      await this.resolveApprovalCounts(tx, proposal, projectId);
    if (approvalsRecorded < requiredApprovals)
      return { blocker: 'APPROVAL_REQUIRED' as const };
    return { blocker: null, proposal };
  }

  private async resolveApprovalCounts(
    tx: Prisma.TransactionClient,
    proposal: ProposalWithApprovals & {
      approvalRecords: { type: ProposalApprovalType; userId: string }[];
      groupMembership: ProposalGroupMembershipWithGroup | null;
    },
    projectId: ProjectId,
  ): Promise<{ requiredApprovals: number; approvalsRecorded: number }> {
    const policy = await this.projectApprovalPolicyService.resolve(projectId);
    const requiredApprovals = await resolveRequiredApprovals(
      tx,
      proposal,
      policy,
      { workItemTypeRegistry: this.workItemTypeRegistry },
    );
    const approvalsRecorded = new Set(
      proposal.approvalRecords
        .filter((record) => record.type === ProposalApprovalType.APPROVAL)
        .map((record) => record.userId),
    ).size;
    return { requiredApprovals, approvalsRecorded };
  }

  /**
   * Approval state of future-revision proposals, read from the proposal
   * record and the same policy that gates future application. Every linked ID
   * is represented, including missing proposals and non-future proposals.
   */
  async readFutureProposalApprovalStates(
    proposalIds: readonly string[],
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<FutureProposalApprovalState[]> {
    if (proposalIds.length === 0) return [];
    const db = this.prisma.db as unknown as Prisma.TransactionClient;
    const proposals = await db.proposal.findMany({
      where: {
        id: { in: [...proposalIds] },
        organizationId,
        projectId,
      },
      include: {
        approvalRecords: true,
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
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    const futureProposals: typeof proposals = [];
    const futureIdByProposalId = new Map<string, string>();
    const unresolvedById = new Map<
      string,
      Extract<FutureProposalApprovalState, { kind: 'unresolved' }>
    >();
    for (const proposalId of proposalIds) {
      const proposal = byId.get(proposalId);
      if (!proposal) {
        unresolvedById.set(proposalId, {
          kind: 'unresolved',
          proposalId,
          reason: 'NOT_FOUND',
        });
        continue;
      }
      if (proposal.action !== 'VERSIONED_UPDATE') {
        unresolvedById.set(proposalId, {
          kind: 'unresolved',
          proposalId,
          reason: 'NOT_FUTURE_REVISION',
        });
        continue;
      }
      const futureId = (proposal.updates as { futureId?: unknown } | null)
        ?.futureId;
      if (typeof futureId !== 'string') {
        unresolvedById.set(proposalId, {
          kind: 'unresolved',
          proposalId,
          reason: 'NOT_FUTURE_REVISION',
        });
        continue;
      }
      futureProposals.push(proposal);
      futureIdByProposalId.set(proposal.id, futureId);
    }

    const projectPolicies = await resolveProjectApprovalPolicies(
      this.projectApprovalPolicyService,
      futureProposals,
    );
    const requiredByProposalId = await resolveRequiredApprovalsByProposalId(
      db,
      futureProposals,
      projectPolicies,
      { workItemTypeRegistry: this.workItemTypeRegistry },
    );
    const futureById = new Map(
      futureProposals.map((proposal) => [proposal.id, proposal]),
    );
    const states = proposalIds.map(
      (proposalId): FutureProposalApprovalState => {
        const unresolved = unresolvedById.get(proposalId);
        if (unresolved) return unresolved;

        const proposal = futureById.get(proposalId);
        const futureId = futureIdByProposalId.get(proposalId);
        const requiredApprovals = requiredByProposalId.get(proposalId);
        if (
          !proposal ||
          futureId === undefined ||
          requiredApprovals === undefined ||
          requiredApprovals === null
        ) {
          throw new Error(
            `Missing proposal approval state for linked proposal ${proposalId}`,
          );
        }
        return {
          kind: 'future',
          proposalId: proposal.id,
          proposalTitle: proposal.title,
          futureId,
          status: proposal.status,
          approvalsRecorded: new Set(
            proposal.approvalRecords
              .filter((record) => record.type === ProposalApprovalType.APPROVAL)
              .map((record) => record.userId),
          ).size,
          requiredApprovals,
        };
      },
    );
    this.logger.log('readFutureProposalApprovalStates completed', {
      organizationId,
      projectId,
      requestedCount: proposalIds.length,
      resolvedCount: states.length,
    });
    return states;
  }

  async getFutureApplicability(
    futureId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<FutureApplicability> {
    const tx = this.prisma.db;
    // The branded Prisma extension preserves the TransactionClient operations.
    const db = tx as unknown as Prisma.TransactionClient;
    const future = await readFutureRevision(
      tx,
      this.workItemTypeRegistry,
      futureId,
      organizationId,
      projectId,
    );
    const blockers: FutureApplicability['blockers'] = [];
    const approval = await this.checkFutureApplicationApproval(
      db,
      future,
      organizationId,
      projectId,
      userId,
    );
    if (approval.blocker) blockers.push(approval.blocker);
    if (future.outcome === 'APPLIED') blockers.push('APPLIED');
    if (future.outcome === 'CANCELLED') blockers.push('CANCELLED');
    if (!future.completionEligibility.eligible)
      blockers.push('COMPLETION_INCOMPLETE');
    const baselineBlocker = await futureBaselineBlocker(
      db,
      future,
      this.reconciliation,
    );
    if (
      baselineBlocker === 'BASELINE_CHANGED' ||
      baselineBlocker === 'BASELINE_UNAVAILABLE'
    )
      blockers.push(baselineBlocker);
    this.logger.log('getFutureApplicability completed', {
      futureId,
      organizationId,
      projectId,
      blockers,
    });
    return {
      revision: future.revision,
      canApply: blockers.length === 0,
      blockers,
      completionEligibility: future.completionEligibility,
    };
  }

  /** Project outstanding work is selected by stable future identity, before paging. */
  async listProjectReadyFutures(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    limit: number,
    offset: number,
  ): Promise<ProjectReadyFuturesPage> {
    this.logger.debug('Reading project ready futures', {
      organizationId,
      projectId,
      limit,
      offset,
    });
    const db = this.prisma.db as unknown as Prisma.TransactionClient;
    const policy = await this.projectApprovalPolicyService.resolve(projectId);
    const selection = await readProjectReadyCandidates(
      db,
      this.workItemTypeRegistry,
      policy,
      organizationId,
      projectId,
    );
    const items: ProjectReadyFuture[] = [];
    let unavailableCount = selection.unavailableCount;
    // Baseline checks cannot change membership: drift remains reviewable.
    // Restrict this expensive reconciliation work to the requested page.
    for (const { item, baseline, result } of selection.candidates.slice(
      offset,
      offset + limit,
    )) {
      try {
        const blockers: FutureApplicability['blockers'] = [];
        if (!selection.eligibleMemberIds.includes(userId))
          blockers.push('PERMISSION_DENIED');
        const blocker = await futureBaselineBlocker(
          db,
          {
            organizationId,
            projectId,
            baseline,
            result,
            latestProposalId: item.proposalId,
            targetEntityId: item.targetEntityId,
            targetEntityType: item.targetEntityType,
          },
          this.reconciliation,
        );
        if (
          blocker === 'BASELINE_CHANGED' ||
          blocker === 'BASELINE_UNAVAILABLE'
        )
          blockers.push(blocker);
        items.push({
          ...item,
          applicability: {
            ...item.applicability,
            canApply: blockers.length === 0,
            blockers,
          },
        });
      } catch {
        unavailableCount += 1;
        this.logger.warn('Project ready future read failed', {
          futureId: item.futureId,
          organizationId,
          projectId,
        });
      }
    }
    this.logger.debug('Project ready futures selected', {
      organizationId,
      projectId,
      total: selection.candidates.length,
      unavailableCount,
      limit,
      offset,
    });
    return {
      items,
      total: selection.candidates.length,
      limit,
      offset,
      unavailableCount,
    };
  }

  /** Staged futures depending on one work item, each with fresh readiness. */
  async listFutureOffers(
    dependencyTaskId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<FutureApplicationOffer[]> {
    const db = this.prisma.db as unknown as Prisma.TransactionClient;
    const futures = await db.proposalFuture.findMany({
      where: {
        organizationId,
        projectId,
        outcome: 'STAGED',
        dependencies: { some: { targetEntityId: dependencyTaskId } },
      },
      select: {
        id: true,
        targetEntityType: true,
        targetEntityId: true,
        latestProposalId: true,
      },
      orderBy: { id: 'asc' },
    });
    const proposals = await db.proposal.findMany({
      where: { id: { in: futures.map((future) => future.latestProposalId) } },
      select: { id: true, title: true },
    });
    const titleById = new Map(proposals.map((p) => [p.id, p.title]));
    const offers: FutureApplicationOffer[] = [];
    for (const future of futures) {
      offers.push({
        futureId: future.id,
        proposalId: future.latestProposalId,
        proposalTitle: titleById.get(future.latestProposalId) ?? '',
        targetEntityType:
          future.targetEntityType as FutureApplicationOffer['targetEntityType'],
        targetEntityId: future.targetEntityId,
        applicability: await this.getFutureApplicability(
          future.id,
          organizationId,
          projectId,
          userId,
        ),
      });
    }
    this.logger.log('listFutureOffers completed', {
      dependencyTaskId,
      organizationId,
      projectId,
      offerCount: offers.length,
      applicableCount: offers.filter((o) => o.applicability.canApply).length,
    });
    return offers;
  }

  async applyFuture(
    futureId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    request: FutureApplyRequest,
  ): Promise<FutureApplyResponse> {
    const selected = await this.prisma.db.$transaction((tx) =>
      readFutureRevision(
        tx,
        this.workItemTypeRegistry,
        futureId,
        organizationId,
        projectId,
      ),
    );
    let graph = futureGraph(selected.result);
    let graphBaseline = futureGraph(selected.baseline.content);
    if (graph && graphBaseline && selected.baseline.kind === 'FUTURE') {
      const parent = await this.prisma.db.proposalFuture.findFirst({
        where: { id: selected.baseline.futureId, organizationId, projectId },
      });
      const parentIntent = parent
        ? await this.prisma.db.workItemChangeSetMaterialization.findUnique({
            where: { proposalId: parent.latestProposalId },
          })
        : null;
      if (parentIntent?.status === 'PUBLISHED') {
        const items = parentIntent.workItemIdMappings as Record<string, string>;
        const relationships = parentIntent.relationshipIdMappings as Record<
          string,
          string
        >;
        graphBaseline = remapGraphProjection(
          graphBaseline,
          items,
          relationships,
        );
        graph = remapGraphProjection(graph, items, relationships, true);
      }
    }
    const existingIntent = graph
      ? await this.prisma.db.workItemChangeSetMaterialization.findUnique({
          where: { proposalId: selected.latestProposalId },
        })
      : null;
    const graphRequest =
      graph && graphBaseline ? graphChangeSet(graphBaseline, graph) : undefined;
    if (
      graphRequest &&
      'type' in selected.result &&
      'type' in selected.baseline.content &&
      !isEqual(
        selected.result.initiativeId ?? null,
        selected.baseline.content.initiativeId ?? null,
      ) &&
      !graphRequest.operations.some(
        (op) =>
          op.op === 'workItem.update' &&
          op.ref.refType === 'existing' &&
          op.ref.id === selected.targetEntityId,
      )
    ) {
      graphRequest.operations.unshift({
        op: 'workItem.update',
        ref: graphRequest.root,
      });
    }
    const preparedGraph =
      graphRequest && !existingIntent
        ? await this.workItemChangeSetMaterializer.projectPreparation({
            organizationId,
            projectId,
            request: graphRequest,
            view: { kind: 'rootChildren', includeExternalRelationships: true },
          })
        : undefined;
    const result = await this.prisma.db.$transaction(
      async (tx) => {
        const db = tx as unknown as Prisma.TransactionClient;
        await tx.$queryRaw`SELECT id FROM proposal_futures WHERE id = ${futureId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
        const future = await readFutureRevision(
          tx,
          this.workItemTypeRegistry,
          futureId,
          organizationId,
          projectId,
        );
        const approval = await this.checkFutureApplicationApproval(
          db,
          future,
          organizationId,
          projectId,
          userId,
        );
        if (approval.blocker)
          throw new ForbiddenException(
            approval.blocker === 'PERMISSION_DENIED'
              ? 'Only an active project member may apply this future.'
              : 'The selected revision has insufficient approvals or is not approved.',
          );
        const proposal = approval.proposal;
        const blocked = (blocker: FutureApplyResponse['blocker']) => ({
          response: {
            status: 'BLOCKED',
            future,
            blocker,
          } satisfies FutureApplyResponse,
        });
        if (future.revision !== request.expectedRevision)
          return blocked('REVISION_CHANGED');
        if (future.outcome === 'CANCELLED') return blocked('CANCELLED');
        if (future.outcome === 'APPLIED')
          return {
            response: {
              status: 'APPLIED',
              future,
            } satisfies FutureApplyResponse,
          };
        if (future.dependencies.length) {
          await tx.$queryRaw`SELECT id FROM tasks WHERE id IN (${Prisma.join(future.dependencies.map((dependency) => dependency.targetEntityId))}) ORDER BY id FOR SHARE`;
        }
        if (!future.completionEligibility.eligible)
          return blocked('COMPLETION_INCOMPLETE');
        if (future.targetEntityType === 'TASK') {
          await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${future.targetEntityId} FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM design_docs WHERE id = ${future.targetEntityId} FOR UPDATE`;
        }
        if (graphBaseline) {
          const ids = [graphBaseline.projectedRoot, ...graphBaseline.children]
            .flatMap((node) =>
              node.identity.refType === 'existing' ? [node.identity.id] : [],
            )
            .sort();
          if (ids.length)
            await tx.$queryRaw`SELECT id FROM tasks WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        }
        const baselineBlocker = existingIntent
          ? undefined
          : await futureBaselineBlocker(db, future, this.reconciliation);
        if (baselineBlocker) return blocked(baselineBlocker);
        await tx.$queryRaw`SELECT id FROM proposals WHERE organization_id = ${organizationId} AND project_id = ${projectId} AND action = 'VERSIONED_UPDATE' AND status = 'DRAFT' AND updates->>'futureId' = ${futureId} ORDER BY id FOR UPDATE`;
        const confirmation = await readFutureApplyConfirmation(db, future);
        if (
          (confirmation.refinements.length || request.confirmation) &&
          !matchesFutureConfirmation(request.confirmation, confirmation)
        ) {
          return {
            response: {
              status: 'CONFIRMATION_REQUIRED',
              future,
              confirmation,
            } satisfies FutureApplyResponse,
          };
        }

        if (graph) {
          if (
            !graphBaseline ||
            future.revision !== selected.revision ||
            future.latestProposalId !== selected.latestProposalId
          )
            return blocked('REVISION_CHANGED');
          if (preparedGraph) {
            if (
              !preparedGraph.snapshots.target.valid ||
              !isEqual(
                graphContentBasis(preparedGraph.snapshots.target),
                graphContentBasis(graph),
              )
            )
              return blocked('BASELINE_CHANGED');
            await this.workItemChangeSetMaterializer.enqueuePreparedIntent(tx, {
              proposalId: proposal.id,
              organizationId,
              projectId,
              prepared: preparedGraph,
              futureApplication: {
                futureId,
                revision: future.revision,
                reviewedBases: await this.reconciliation.currentBases(
                  tx,
                  {
                    ...proposal,
                    action: 'UPDATE',
                    updates:
                      preparedGraph.operationSet as unknown as Prisma.JsonObject,
                  },
                  true,
                ),
                refinementIds: confirmation.refinements.map(
                  (entry) => entry.proposalId,
                ),
              },
            });
          }
          return {
            graphApplication: true as const,
            response: {
              status: 'APPLIED',
              future,
            } satisfies FutureApplyResponse,
          };
        }

        const enactment = await this.applyInTransaction(
          tx,
          proposal,
          organizationId,
          projectId,
          { reviewedFuture: future },
        );
        const materializationMismatch = await futureBaselineBlocker(
          db,
          {
            ...future,
            baseline: {
              kind: 'LIVE',
              revision: future.baseline.revision,
              content: future.result,
            },
          },
          this.reconciliation,
        );
        if (materializationMismatch) {
          throw new ConflictException(
            'The target update contract could not materialize the complete reviewed result. Application was rolled back.',
          );
        }
        // The target, outcome and confirmed invalidations share the existing enactment
        // transaction. Any failure rolls all three back; another Apply retries it.
        const refinementIds = confirmation.refinements.map(
          (entry) => entry.proposalId,
        );
        if (refinementIds.length) {
          await tx.proposal.updateMany({
            where: {
              id: { in: refinementIds },
              organizationId,
              projectId,
              status: 'DRAFT',
            },
            data: { status: 'REJECTED' },
          });
          for (const id of refinementIds)
            await this.pendingEdgeService.cleanupForProposal(tx, id);
          await this.proposalGroupDecisionService!.invalidateFutureRefinementsInTransaction(
            tx,
            organizationId,
            projectId,
            refinementIds,
          );
        }
        const appliedAt = new Date();
        await tx.proposalFuture.update({
          where: { id: futureId },
          data: {
            outcome: 'APPLIED',
            appliedAt,
            appliedRevision: future.revision,
          },
        });
        return {
          response: {
            status: 'APPLIED',
            future: {
              ...future,
              outcome: 'APPLIED',
              appliedAt: appliedAt.toISOString(),
              appliedRevision: future.revision,
              outstandingRefinementProposalIds: [],
            },
          } satisfies FutureApplyResponse,
          enactment,
        };
      },
      {
        ...PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
    if ('graphApplication' in result) {
      const materialized =
        await this.workItemChangeSetMaterializer.materializeApprovedChangeSet({
          proposalId: selected.latestProposalId,
          organizationId,
          projectId,
        });
      if (!materialized.enacted)
        throw new ConflictException(
          'Future graph application is incomplete; retry Apply to resume.',
        );
      const future = await this.prisma.db.$transaction((tx) =>
        readFutureRevision(
          tx,
          this.workItemTypeRegistry,
          futureId,
          organizationId,
          projectId,
        ),
      );
      return { status: 'APPLIED', future };
    }
    if ('enactment' in result && result.enactment) {
      await this.pendingEdgeService.materializeEdges(
        organizationId,
        projectId,
        result.enactment.materializableEdges,
        result.enactment.proposal.conversationId,
      );
      await result.enactment.runPostCommit();
    }
    return result.response;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    private readonly taskService: TaskService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly workItemTypeLifecycle: WorkItemTypeLifecycleService,
    private readonly designDocService: DesignDocService,
    private readonly planFromDesignDocLauncher: PlanFromDesignDocLauncherService,
    private readonly initiativeService: InitiativeService,
    private readonly influenceService: InfluenceService,
    private readonly conversationWorkflowService: ConversationWorkflowService,
    private readonly pendingEdgeService: PendingEdgeService,
    private readonly workItemChangeSetMaterializer: WorkItemChangeSetMaterializerService,
    private readonly mentionProcessingService: MentionProcessingService,
    private readonly projectApprovalPolicyService: ProjectApprovalPolicyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly reconciliation: ProposalReconciliationService,
    @Optional()
    private readonly entityPromptTemplateService?: EntityPromptTemplateService,
    @Optional()
    @Inject(forwardRef(() => ProposalGroupDecisionService))
    private readonly proposalGroupDecisionService?: ProposalGroupDecisionService,
  ) {}

  isGenericWorkItemChangeSet(
    value: unknown,
    proposal?: Pick<
      Proposal,
      | 'id'
      | 'action'
      | 'targetEntityType'
      | 'targetEntityId'
      | 'updates'
      | 'projectId'
      | 'edges'
    >,
  ): boolean {
    if (
      this.workItemChangeSetMaterializer.isWorkItemChangeSetValidationRequest(
        value,
      )
    ) {
      return true;
    }
    return proposal
      ? this.workItemChangeSetMaterializer.taskProposalChangeSet(proposal) !==
          null
      : false;
  }

  async materializeGenericWorkItemChangeSet(params: {
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<WorkItemChangeSetMaterializationResult> {
    return this.workItemChangeSetMaterializer.materializeApprovedChangeSet(
      params,
    );
  }

  async retryApprovedGenericProposal(params: {
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<ApprovalResult> {
    const projectPolicy = await this.projectApprovalPolicyService.resolve(
      params.projectId,
    );
    const target = await this.prisma.db.proposal.findFirst({
      where: {
        id: params.proposalId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        status: 'APPROVED',
      },
      include: { workItemChangeSetMaterialization: true },
    });
    if (!target?.workItemChangeSetMaterialization) {
      throw new BadRequestException(
        'Only an approved generic work-item proposal with durable retry state can be retried.',
      );
    }
    assertProposalApplicationEligible(target, 'retryApprovedGenericProposal');
    let materialized: WorkItemChangeSetMaterializationResult;
    try {
      materialized =
        await this.workItemChangeSetMaterializer.materializeApprovedChangeSet({
          proposalId: params.proposalId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        });
    } catch (error) {
      return this.recoverableMaterializationFailureResult(
        target,
        projectPolicy,
        params.proposalId,
        error,
      );
    }
    return {
      proposal: await this.toResponseDto(materialized.proposal, projectPolicy),
      resultingEntityId:
        materialized.rootWorkItemId ?? materialized.proposal.targetEntityId,
      enacted: materialized.enacted,
    };
  }

  private async recoverableMaterializationFailureResult(
    proposal: Proposal,
    projectPolicy: ProjectApprovalPolicy,
    proposalId: string,
    error: unknown,
  ): Promise<ApprovalResult> {
    if (error instanceof ConflictException) throw error;
    const response = await this.toResponseDto(proposal, projectPolicy);
    if (
      response.status !== 'APPROVED' ||
      response.materialization?.state !== 'RECOVERABLE_FAILURE'
    ) {
      throw error;
    }

    this.logger.warn(
      'Proposal approval recorded with recoverable materialization failure',
      {
        proposalId,
        state: response.materialization.state,
        attemptCount: response.materialization.attemptCount,
        diagnosticCorrelationId:
          response.materialization.diagnostic?.correlationId,
      },
    );
    return {
      proposal: response,
      resultingEntityId: null,
      enacted: false,
    };
  }

  async queueGenericWorkItemChangeSetInTransaction(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    prepared: PreparedChangeSetProjection,
    reservedRootWorkItemId?: TaskId,
  ): Promise<{
    proposal: Proposal;
    rootWorkItemId: string | null;
    materialization: Awaited<
      ReturnType<WorkItemChangeSetMaterializerService['enqueuePreparedIntent']>
    >;
  }> {
    assertProposalApplicationEligible(
      proposal,
      'queueGenericWorkItemChangeSetInTransaction',
    );
    this.logger.debug('Preparing generic approval in transaction', {
      proposalId: proposal.id,
      organizationId,
      projectId,
      validationRevision: prepared.validationRevision,
    });
    const updated = await tx.proposal.update({
      where: { id: proposal.id },
      data: { status: 'APPROVED' as PrismaProposalStatus },
    });
    this.logger.debug('Generic proposal approval written in transaction', {
      proposalId: proposal.id,
      status: updated.status,
    });
    const intent =
      await this.workItemChangeSetMaterializer.enqueuePreparedIntent(tx, {
        proposalId: proposal.id,
        organizationId,
        projectId,
        prepared,
        ...(reservedRootWorkItemId ? { reservedRootWorkItemId } : {}),
      });
    this.logger.debug(
      'Generic approval intent prepared; publishing transactional event',
      { proposalId: proposal.id, rootWorkItemId: intent.rootWorkItemId },
    );
    await this.publishApprovedEvent(
      tx,
      updated,
      intent.rootWorkItemId ?? updated.targetEntityId,
    );
    this.logger.debug('Generic approval event queued in transaction', {
      proposalId: proposal.id,
      rootWorkItemId: intent.rootWorkItemId,
    });
    return {
      proposal: updated,
      rootWorkItemId: intent.rootWorkItemId,
      materialization: intent,
    };
  }

  async approve(
    proposalId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    userToken: string | null = null,
    acknowledgeOutOfDate = false,
    reviewedReconciliationRevisionId?: string,
  ): Promise<ApprovalResult> {
    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    const grouped = this.proposalGroupDecisionService
      ? await this.prisma.db.proposal.findFirst({
          where: { id: proposalId, organizationId, projectId },
          select: { groupMembership: { select: { groupId: true } } },
        })
      : null;
    if (grouped?.groupMembership && this.proposalGroupDecisionService) {
      const decision = await this.proposalGroupDecisionService.approve(
        {
          proposalId,
          organizationId,
          projectId,
          userId,
        },
        projectPolicy,
      );
      if (
        decision.result.outcome !== 'APPROVAL_RECORDED' &&
        !(
          decision.result.outcome === 'ALREADY_APPROVED' &&
          ['READY', 'RETRYABLE_FAILURE', 'APPLYING'].includes(
            decision.result.executionState,
          )
        )
      ) {
        const messageByOutcome = {
          ALREADY_APPROVED: 'User has already approved this proposal',
          ALREADY_REJECTED: 'User has already rejected this proposal',
          ALREADY_TERMINAL: `Cannot approve a grouped proposal in ${decision.result.executionState}`,
          NOT_ELIGIBLE:
            'Only an eligible project member may approve this proposal',
          FAILED: decision.result.message ?? 'Grouped proposal approval failed',
        } as const;
        throw new BadRequestException({
          message: messageByOutcome[decision.result.outcome],
          ...(decision.result.outcome === 'FAILED' && decision.result.diagnostic
            ? { diagnostic: decision.result.diagnostic }
            : {}),
        });
      }
      const proposal = await this.prisma.db.proposal.findUniqueOrThrow({
        where: { id: proposalId },
      });
      return {
        proposal: await this.toResponseDto(proposal, projectPolicy),
        resultingEntityId: null,
        enacted: false,
      };
    }
    const immediatelyMaterializedEdges: MaterializedProposalEdge[] = [];
    let result: ApprovalTransactionResult;

    // Project before the transaction so it holds no connection across the
    // projector's Graph and pooled reads; the locked row is re-checked below.
    const unlocked = await this.prisma.db.proposal.findFirst({
      where: { id: proposalId, organizationId, projectId },
    });
    if (unlocked) {
      assertProposalApplicationEligible(unlocked, 'approve');
    }
    if (unlocked?.targetEntityType === 'WORK_ITEM_TYPE') {
      await this.projectAccess.assertProjectRole(
        projectId,
        userId,
        'manageWorkItemTypes',
      );
    }
    if (unlocked && unlocked.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot approve a proposal with status: ${unlocked.status}`,
      );
    }
    const unlockedRequest = unlocked
      ? this.genericChangeSetRequest(unlocked)
      : null;
    const preparedChangeSet = unlockedRequest
      ? await this.workItemChangeSetMaterializer.projectPreparation({
          organizationId,
          projectId,
          request: unlockedRequest,
        })
      : null;

    try {
      result = await this.prisma.db.$transaction(async (tx) => {
        const proposal = await this.findForUpdateInTx(
          tx,
          proposalId,
          organizationId,
          projectId,
        );

        assertProposalApplicationEligible(proposal, 'approve');
        if (proposal.groupMembership) {
          throw new ConflictException(
            'Grouped proposals can only be approved through proposal-group review.',
          );
        }

        if (!this.isEnactableAction(proposal)) {
          throw new BadRequestException(
            `This proposal cannot be enacted. CREATE and UPDATE are always ` +
              `enactable; DELETE is enactable only for TASK, DESIGN_DOC, ` +
              `WORK_ITEM_TYPE, and ` +
              `ENTITY_PROMPT_TEMPLATE. ` +
              `Got: ${proposal.action} (${proposal.targetEntityType})`,
          );
        }

        if (proposal.status !== 'DRAFT') {
          throw new BadRequestException(
            `Cannot approve a proposal with status: ${proposal.status}`,
          );
        }

        assertWorkflowProposalLinksStructurallyValid(
          this.toProposalValidationDto(proposal),
        );
        if (
          proposal.action === 'DELETE' &&
          proposal.targetEntityType === 'WORK_ITEM_TYPE'
        ) {
          this.logger.log('Validating accepted work-item type delete payload', {
            proposalId,
            targetEntityId: proposal.targetEntityId,
          });
          assertProposalStructurallyValid(
            this.toProposalValidationDto(proposal),
          );
        }
        if (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
          assertProposalStructurallyValid(
            this.toProposalValidationDto(proposal),
          );
        }
        const genericChangeSetRequest = this.genericChangeSetRequest(proposal);
        const prepared = this.assertPreparedChangeSetCurrent(
          proposalId,
          genericChangeSetRequest,
          preparedChangeSet,
        );
        await this.assertGenericChangeSetValid(
          proposal,
          genericChangeSetRequest,
          prepared?.snapshots.target ?? null,
          tx,
        );

        const contextInput = {
          targetEntityType: proposal.targetEntityType,
          action: proposal.action,
          targetEntityId: proposal.targetEntityId,
          updates: proposal.updates,
        };
        const evaluationContext = await resolvePermissionEvaluationContext(
          tx,
          organizationId,
          projectId,
          contextInput,
          deriveProposalSourceContext(proposal),
          this.workItemTypeRegistry,
        );
        const approvalConfig = evaluatePermissions(
          evaluationContext.entity,
          evaluationContext.proposal,
          projectPolicy,
        );

        if (
          !evaluationContext.proposal.eligibleProjectMemberIds.includes(userId)
        ) {
          throw new BadRequestException(
            'Only an active project member may approve this proposal',
          );
        }

        if (
          evaluationContext.proposal.source === 'user' &&
          proposal.requestorId === userId &&
          !approvalConfig.allowsProposerApproval
        ) {
          throw new BadRequestException(
            'Proposal policy does not permit the author to approve this proposal',
          );
        }

        await this.reconciliation.assertApplicable(
          tx,
          proposal,
          reviewedReconciliationRevisionId,
          true,
        );

        await this.recordApprovalInTx(tx, proposalId, userId);

        const approvalCount = await tx.proposalApprovalRecord.count({
          where: {
            proposalId,
            type: ProposalApprovalType.APPROVAL,
          },
        });

        this.logger.log('Evaluated approval threshold', {
          proposalId,
          entityContext: evaluationContext.entity,
          proposalContext: evaluationContext.proposal,
          threshold: approvalConfig.threshold,
          approvalCount,
        });

        if (approvalCount < approvalConfig.threshold) {
          this.logger.log('Approval recorded but threshold not met', {
            proposalId,
            approvalCount,
            threshold: approvalConfig.threshold,
          });
          return {
            proposal,
            resultingEntityId: null,
            materializableEdges: [] as MaterializableEdge[],
            runPostCommit: NOOP_POST_COMMIT,
            enacted: false,
            genericChangeSetReady: false,
          };
        }

        if (genericChangeSetRequest && prepared) {
          const queued = await this.queueGenericWorkItemChangeSetInTransaction(
            tx,
            proposal,
            organizationId,
            projectId,
            prepared,
          );
          this.logger.log(
            'Approval durably recorded; generic work-item change set queued for enactment',
            {
              proposalId,
              operationCount: genericChangeSetRequest.operations.length,
            },
          );
          return {
            proposal: queued.proposal,
            resultingEntityId: queued.rootWorkItemId,
            materializableEdges: [] as MaterializableEdge[],
            runPostCommit: NOOP_POST_COMMIT,
            enacted: true,
            genericChangeSetReady: true,
          };
        }

        if (
          proposal.action === 'DELETE' &&
          proposal.targetEntityType === 'WORK_ITEM_TYPE' &&
          isCascadeWorkItemTypeDeletePayload(proposal.updates)
        ) {
          const cascadeExecution =
            await this.prepareCascadeDeleteExecutionInTransaction(
              tx,
              proposal,
              organizationId,
              projectId,
              proposal.updates,
            );
          this.logger.log('Queued durable cascade deletion execution', {
            proposalId: proposal.id,
            executionId: cascadeExecution.id,
            typeKey: proposal.targetEntityId,
            workItemCount: cascadeExecution.workItemIds.length,
          });
          return {
            proposal,
            resultingEntityId: null,
            materializableEdges: [] as MaterializableEdge[],
            runPostCommit: NOOP_POST_COMMIT,
            enacted: false,
            genericChangeSetReady: false,
            cascadeExecutionId: cascadeExecution.id,
          };
        }

        let updated = await tx.proposal.update({
          where: { id: proposalId },
          data: { status: 'APPROVED' as PrismaProposalStatus },
        });

        if (updated.action === 'VERSIONED_UPDATE') {
          await stageFutureRevision(tx, this.workItemTypeRegistry, updated);
          await this.publishApprovedEvent(tx, updated, updated.targetEntityId);
          return {
            proposal: updated,
            resultingEntityId: updated.targetEntityId,
            materializableEdges: [],
            runPostCommit: NOOP_POST_COMMIT,
            enacted: true,
            genericChangeSetReady: false,
          };
        }

        const priorMentions = await this.snapshotPriorBodyMentions(
          tx,
          updated,
          organizationId,
        );
        const priorRequirementCitations =
          await this.snapshotPriorRequirementCitations(tx, updated);

        let entityId: string;
        let runPostCommit: PostCommitRunner = NOOP_POST_COMMIT;
        let embeddedMaterializableEdges: MaterializableEdge[] = [];
        if (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
          entityId = await this.enactEntityPromptTemplate(
            tx,
            updated,
            projectId,
          );
        } else if (proposal.action === 'CREATE') {
          const createResult = await this.enactCreate(
            tx,
            updated,
            organizationId,
            projectId,
          );
          entityId = createResult.entityId;
          runPostCommit = createResult.runPostCommit;
          embeddedMaterializableEdges = createResult.materializableEdges;
          // Enactment created the entity; rewrite the placeholder NIL_UUID
          // targetEntityId to the real id and re-capture the row so the
          // approved event (and downstream consumers) see the materialized id.
          updated = await tx.proposal.update({
            where: { id: proposalId },
            data: { targetEntityId: entityId },
          });
        } else if (proposal.action === 'UPDATE') {
          const enactResult = await this.enactUpdate(
            tx,
            updated,
            organizationId,
            projectId,
            {},
          );
          entityId = enactResult.entityId;
          runPostCommit = enactResult.runPostCommit;
        } else {
          const enactResult = await this.enactDelete(
            tx,
            updated,
            projectId,
            organizationId,
          );
          entityId = enactResult.entityId;
          runPostCommit = enactResult.runPostCommit;
        }

        await this.advanceTaskMarkerAfterMaterialization(tx, updated, entityId);
        await this.reconciliation.recordCreatedDelivery(tx, updated);

        await this.publishApprovedEvent(tx, updated, entityId);

        const pendingEdgeTaskPostCommits: PendingEdgeTaskPostCommit[] = [];
        const materializableEdges = [
          ...embeddedMaterializableEdges,
          ...(await this.pendingEdgeService.processDeclaredEdges(
            tx,
            updated,
            entityId,
            {
              onTaskPostCommit: (postCommit) =>
                pendingEdgeTaskPostCommits.push(postCommit),
            },
          )),
        ];

        if (updated.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE') {
          await this.processBodyMentions(
            tx,
            updated,
            entityId,
            priorMentions,
            materializableEdges,
          );
        }

        const citationEdgeDeletes = await this.collectRequirementCitationEdges(
          tx,
          updated,
          entityId,
          priorRequirementCitations,
          (edge) => immediatelyMaterializedEdges.push(edge),
        );

        return {
          proposal: updated,
          resultingEntityId: entityId,
          materializableEdges,
          runPostCommit: this.withRequirementCitationEdgeDeletes(
            this.combinePostCommitRunners(
              runPostCommit,
              organizationId,
              pendingEdgeTaskPostCommits,
            ),
            organizationId,
            projectId,
            citationEdgeDeletes,
          ),
          enacted: true,
          genericChangeSetReady: false,
        };
      }, PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS);
    } catch (error) {
      await this.pendingEdgeService.rollbackMaterializedEdges(
        organizationId,
        projectId,
        immediatelyMaterializedEdges,
        'Rolling back an immediately materialized proposal edge because approval failed.',
      );
      throw error;
    }

    if (result.cascadeExecutionId) {
      return {
        proposal: await this.toResponseDto(result.proposal, projectPolicy),
        resultingEntityId: result.resultingEntityId,
        enacted: false,
      };
    }

    if (result.enacted) {
      this.logger.log('Proposal approved and enacted', {
        proposalId,
        organizationId,
        projectId,
        action: result.proposal.action,
        targetEntityType: result.proposal.targetEntityType,
        resultingEntityId: result.resultingEntityId,
        pendingEdgesToMaterialize: result.materializableEdges.length,
      });

      if (result.materializableEdges.length > 0) {
        await this.pendingEdgeService.materializeEdges(
          organizationId,
          projectId,
          result.materializableEdges,
          result.proposal.conversationId,
        );
      }

      await result.runPostCommit();
    }

    if (result.genericChangeSetReady) {
      let materialized: WorkItemChangeSetMaterializationResult;
      try {
        materialized =
          await this.workItemChangeSetMaterializer.materializeApprovedChangeSet(
            {
              proposalId,
              organizationId,
              projectId,
            },
          );
      } catch (error) {
        return this.recoverableMaterializationFailureResult(
          result.proposal,
          projectPolicy,
          proposalId,
          error,
        );
      }
      return {
        proposal: await this.toResponseDto(
          materialized.proposal,
          projectPolicy,
        ),
        resultingEntityId:
          materialized.rootWorkItemId ?? materialized.proposal.targetEntityId,
        enacted: materialized.enacted,
      };
    }

    return {
      proposal: await this.toResponseDto(result.proposal, projectPolicy),
      resultingEntityId: result.resultingEntityId,
      enacted: result.enacted,
    };
  }

  private async queueGroupedMemberIntent(
    params: {
      memberId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    reservedRootWorkItemId: TaskId | undefined,
    prepared: PreparedChangeSetProjection,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`
          SELECT id FROM proposal_group_members
          WHERE id = ${params.memberId}
          FOR UPDATE
        `;
      const member = await tx.proposalGroupMember.findFirst({
        where: {
          id: params.memberId,
          group: {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
        },
        include: { proposal: true },
      });
      if (!member) {
        throw new NotFoundException('Proposal group member not found');
      }
      if (member.proposal.status === 'DRAFT') {
        await this.queueGenericWorkItemChangeSetInTransaction(
          tx,
          member.proposal,
          params.organizationId,
          params.projectId,
          prepared,
          reservedRootWorkItemId,
        );
        return;
      }
      if (member.proposal.status !== 'APPROVED') {
        throw new ConflictException(
          `Grouped generic proposal cannot be enacted from ${member.proposal.status}.`,
        );
      }
      await this.workItemChangeSetMaterializer.enqueuePreparedIntent(tx, {
        proposalId: member.proposal.id,
        organizationId: params.organizationId,
        projectId: params.projectId,
        prepared,
        ...(reservedRootWorkItemId ? { reservedRootWorkItemId } : {}),
      });
    });
  }

  /**
   * Apply one durable proposal-group member after the coordinator has made it
   * enactment-ready. This deliberately does not evaluate or record approval
   * policy: grouped decision handling owns that phase. The boundary only
   * reuses the authoritative proposal mutation pipeline and sources CREATE
   * identity exclusively from the persisted member reservation.
   */
  async enactGroupedMember(params: {
    memberId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<GroupedMemberEnactmentResult> {
    const projectPolicy = await this.projectApprovalPolicyService.resolve(
      params.projectId,
    );
    const seed = await this.prisma.db.proposalGroupMember.findFirst({
      where: {
        id: params.memberId,
        group: {
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
      },
      include: { group: true, proposal: true },
    });
    if (!seed) {
      throw new NotFoundException('Proposal group member not found');
    }
    assertProposalApplicationEligible(seed.proposal, 'enactGroupedMember');
    if (
      seed.group.status !== 'REVIEWABLE' &&
      !(seed.group.status === 'SETTLED' && seed.executionState === 'APPLIED')
    ) {
      throw new ConflictException(
        'Proposal group member can only be enacted from a reviewable group.',
      );
    }
    if (
      !['READY', 'APPLYING', 'RETRYABLE_FAILURE', 'APPLIED'].includes(
        seed.executionState,
      )
    ) {
      throw new ConflictException(
        `Proposal group member cannot be enacted from ${seed.executionState}.`,
      );
    }

    const reservedTargetEntityId =
      seed.proposal.action === 'CREATE'
        ? seed.reservedTargetEntityId
        : undefined;
    if (seed.proposal.action === 'CREATE' && !reservedTargetEntityId) {
      throw new BadRequestException(
        'Grouped CREATE member is missing its persisted reserved target identity.',
      );
    }

    this.logger.debug('Selected grouped member enactment identity', {
      memberId: seed.id,
      groupId: seed.groupId,
      proposalId: seed.proposalId,
      action: seed.proposal.action,
      targetEntityType: seed.proposal.targetEntityType,
      reservedTargetEntityId: reservedTargetEntityId ?? null,
      executionState: seed.executionState,
    });

    const graphChangeSetRequest =
      this.workItemChangeSetMaterializer.isWorkItemChangeSetValidationRequest(
        seed.proposal.updates,
      )
        ? seed.proposal.updates
        : null;
    const taskChangeSetRequest = graphChangeSetRequest
      ? null
      : this.isGenericWorkItemChangeSet(seed.proposal.updates, seed.proposal)
        ? this.workItemChangeSetMaterializer.taskProposalChangeSet(
            seed.proposal,
          )
        : null;
    // Conversion can evolve between approval and retry. A durable intent owns
    // its operation order/revision; never reconstruct its checkpoint identities.
    const storedIntent =
      seed.proposal.status === 'APPROVED' &&
      (graphChangeSetRequest || taskChangeSetRequest)
        ? await this.prisma.db.workItemChangeSetMaterialization.findUnique({
            where: { proposalId: seed.proposalId },
            select: { operationSet: true },
          })
        : null;
    const groupedChangeSetRequest = storedIntent
      ? (storedIntent.operationSet as unknown as WorkItemChangeSetValidationRequest)
      : (graphChangeSetRequest ?? taskChangeSetRequest);

    if (groupedChangeSetRequest) {
      this.logger.log(
        'Delegating grouped work-item member to generic materializer',
        {
          memberId: seed.id,
          proposalId: seed.proposalId,
          reservedTargetEntityId: reservedTargetEntityId ?? null,
        },
      );
      // A stored intent resumes through the materializer's existing-intent
      // path, which never creates an intent and so needs no projection.
      if (storedIntent) {
        this.logger.debug(
          'Grouped member has a stored intent; resuming without projection',
          { memberId: seed.id, proposalId: seed.proposalId },
        );
      } else {
        await this.queueGroupedMemberIntent(
          params,
          reservedTargetEntityId as TaskId | undefined,
          await this.workItemChangeSetMaterializer.projectPreparation({
            organizationId: params.organizationId,
            projectId: params.projectId,
            request: groupedChangeSetRequest,
          }),
        );
      }

      const materialized =
        await this.workItemChangeSetMaterializer.materializeApprovedChangeSet({
          proposalId: seed.proposalId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          ...(reservedTargetEntityId
            ? {
                reservedRootWorkItemId: reservedTargetEntityId as TaskId,
              }
            : {}),
          request: groupedChangeSetRequest,
        });
      if (materialized.proposal.status !== 'APPROVED') {
        throw new Error(
          'Grouped generic publication completed without Proposal APPROVED.',
        );
      }
      if (!materialized.enacted) {
        return {
          proposal: await this.toResponseDto(
            materialized.proposal,
            projectPolicy,
          ),
          resultingEntityId:
            materialized.rootWorkItemId ?? materialized.proposal.targetEntityId,
          alreadyApplied: false,
          enacted: false,
        };
      }
      const resultingEntityId =
        materialized.rootWorkItemId ?? materialized.proposal.targetEntityId;
      if (
        reservedTargetEntityId &&
        resultingEntityId !== reservedTargetEntityId
      ) {
        throw new ConflictException(
          'Generic materializer published a root identity that does not match the grouped member reservation.',
        );
      }
      this.logger.log('Grouped generic member publication completed', {
        memberId: seed.id,
        proposalId: seed.proposalId,
        resultingEntityId,
      });
      return {
        proposal: await this.toResponseDto(
          materialized.proposal,
          projectPolicy,
        ),
        resultingEntityId,
        alreadyApplied: seed.proposal.status === 'APPROVED',
        enacted: true,
      };
    }

    const immediatelyMaterializedEdges: MaterializedProposalEdge[] = [];
    let transactionResult:
      | {
          kind: 'applied';
          proposal: Proposal;
          resultingEntityId: string;
        }
      | {
          kind: 'enacted';
          result: Awaited<
            ReturnType<ProposalApprovalService['applyInTransaction']>
          >;
        };
    try {
      transactionResult = await this.prisma.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM proposal_group_members
          WHERE id = ${params.memberId}
          FOR UPDATE
        `;
        const member = await tx.proposalGroupMember.findFirst({
          where: {
            id: params.memberId,
            group: {
              organizationId: params.organizationId,
              projectId: params.projectId,
            },
          },
          include: { proposal: true },
        });
        if (!member) {
          throw new NotFoundException('Proposal group member not found');
        }
        const proposal = member.proposal;
        const reservedId =
          proposal.action === 'CREATE'
            ? member.reservedTargetEntityId
            : undefined;
        if (proposal.action === 'CREATE' && !reservedId) {
          throw new BadRequestException(
            'Grouped CREATE member is missing its persisted reserved target identity.',
          );
        }

        if (proposal.status === 'APPROVED') {
          const resultingEntityId =
            proposal.action === 'CREATE'
              ? (reservedId as string)
              : proposal.targetEntityId;
          if (
            proposal.action === 'CREATE' &&
            proposal.targetEntityId !== reservedId
          ) {
            throw new ConflictException(
              'Approved grouped proposal target does not match its reserved identity.',
            );
          }
          if (proposal.action === 'CREATE') {
            await this.verifyReservedCreateMaterialization(
              tx,
              proposal,
              reservedId as string,
              params.organizationId,
              params.projectId,
            );
          }
          if (!member.publicationPayload) {
            throw new ConflictException(
              'Approved grouped proposal is missing its durable publication payload.',
            );
          }
          this.logger.debug(
            'Verified already-materialized grouped member retry',
            {
              memberId: member.id,
              proposalId: proposal.id,
              resultingEntityId,
            },
          );
          return { kind: 'applied', proposal, resultingEntityId };
        }
        if (proposal.status !== 'DRAFT') {
          throw new ConflictException(
            `Grouped member proposal cannot be enacted from ${proposal.status}.`,
          );
        }
        if (proposal.action === 'CREATE') {
          await this.assertReservedIdentityAvailable(
            tx,
            proposal,
            reservedId as string,
          );
        }

        const result = await this.applyInTransaction(
          tx,
          proposal,
          params.organizationId,
          params.projectId,
          {
            ...(reservedId ? { reservedTargetEntityId: reservedId } : {}),
            onImmediateEdgeCreated: (edge) =>
              immediatelyMaterializedEdges.push(edge),
          },
        );
        const publicationPayload: GroupedPublicationPayload = {
          edges: result.materializableEdges.map((edge) => ({
            ...edge,
            id: edge.id ?? uuidv4(),
          })),
          postCommits: result.durablePostCommits,
        };
        await tx.proposalGroupMember.update({
          where: { id: member.id },
          data: {
            publicationPayload: JSON.parse(
              JSON.stringify(publicationPayload),
            ) as Prisma.InputJsonValue,
            publishedEdgeCount: 0,
            publishedPostCommitCount: 0,
            publicationCompletedAt: null,
          },
        });
        return { kind: 'enacted', result };
      }, PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS);
    } catch (error) {
      await this.pendingEdgeService.rollbackMaterializedEdges(
        params.organizationId,
        params.projectId,
        immediatelyMaterializedEdges,
        'Rolling back an immediately materialized proposal edge because grouped enactment failed.',
      );
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn('Rejected grouped reserved identity collision', {
          memberId: seed.id,
          proposalId: seed.proposalId,
          reservedTargetEntityId: reservedTargetEntityId ?? null,
        });
        throw new ConflictException(
          'Reserved grouped target identity collided with existing state.',
        );
      }
      throw error;
    }

    if (transactionResult.kind === 'applied') {
      await this.publishGroupedMember(
        params.memberId,
        params.organizationId,
        params.projectId,
      );
      this.logger.log('Grouped member retry reached terminal enactment', {
        memberId: seed.id,
        proposalId: seed.proposalId,
        resultingEntityId: transactionResult.resultingEntityId,
      });
      return {
        proposal: await this.toResponseDto(
          transactionResult.proposal,
          projectPolicy,
        ),
        resultingEntityId: transactionResult.resultingEntityId,
        alreadyApplied: true,
        enacted: true,
      };
    }

    const enacted = transactionResult.result;
    await this.publishGroupedMember(
      params.memberId,
      params.organizationId,
      params.projectId,
    );
    this.logger.log('Grouped member enactment completed', {
      memberId: seed.id,
      proposalId: seed.proposalId,
      resultingEntityId: enacted.resultingEntityId,
      publicationCompleted: true,
    });
    return {
      proposal: await this.toResponseDto(enacted.proposal, projectPolicy),
      resultingEntityId: enacted.resultingEntityId,
      alreadyApplied: false,
      enacted: true,
    };
  }

  private async publishGroupedMember(
    memberId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const member = await this.prisma.db.proposalGroupMember.findFirst({
      where: {
        id: memberId,
        group: { organizationId, projectId },
      },
      include: { proposal: true },
    });
    if (!member) {
      throw new NotFoundException('Proposal group member not found');
    }
    if (member.publicationCompletedAt) {
      this.logger.debug('Grouped member publication already completed', {
        memberId,
        proposalId: member.proposalId,
      });
      return;
    }

    const payload = this.readGroupedPublicationPayload(
      member.publicationPayload,
    );
    for (
      let index = member.publishedEdgeCount;
      index < payload.edges.length;
      index += 1
    ) {
      await this.pendingEdgeService.materializeEdges(
        organizationId,
        projectId,
        [payload.edges[index]!],
        member.proposal.conversationId,
      );
      await this.advanceGroupedPublicationCheckpoint(
        memberId,
        'publishedEdgeCount',
        index,
      );
    }

    for (
      let index = member.publishedPostCommitCount;
      index < payload.postCommits.length;
      index += 1
    ) {
      await this.runDurablePostCommit(
        organizationId,
        projectId,
        payload.postCommits[index]!,
      );
      await this.advanceGroupedPublicationCheckpoint(
        memberId,
        'publishedPostCommitCount',
        index,
      );
    }

    const completed = await this.prisma.db.proposalGroupMember.updateMany({
      where: {
        id: memberId,
        publishedEdgeCount: payload.edges.length,
        publishedPostCommitCount: payload.postCommits.length,
        publicationCompletedAt: null,
      },
      data: { publicationCompletedAt: new Date() },
    });
    if (completed.count !== 1) {
      throw new ConflictException(
        'Grouped member publication checkpoints changed before completion.',
      );
    }
  }

  private readGroupedPublicationPayload(
    value: Prisma.JsonValue | null,
  ): GroupedPublicationPayload {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new ConflictException(
        'Grouped member has no valid durable publication payload.',
      );
    }
    const edges = value.edges;
    const postCommits = value.postCommits;
    if (!Array.isArray(edges) || !Array.isArray(postCommits)) {
      throw new ConflictException(
        'Grouped member durable publication payload is malformed.',
      );
    }
    return {
      edges: edges as unknown as MaterializableEdge[],
      postCommits: postCommits as unknown as DurablePostCommit[],
    };
  }

  private async advanceGroupedPublicationCheckpoint(
    memberId: string,
    field: 'publishedEdgeCount' | 'publishedPostCommitCount',
    completedIndex: number,
  ): Promise<void> {
    const updated = await this.prisma.db.proposalGroupMember.updateMany({
      where: { id: memberId, [field]: completedIndex },
      data: { [field]: completedIndex + 1 },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'Grouped member publication checkpoint changed concurrently.',
      );
    }
  }

  private async runDurablePostCommit(
    organizationId: OrganizationId,
    projectId: ProjectId,
    operation: DurablePostCommit,
  ): Promise<void> {
    switch (operation.kind) {
      case 'TASK_UPDATE':
        await this.taskService.runUpdatePostCommit(
          organizationId,
          operation.entityId as TaskId,
          operation.payload,
        );
        return;
      case 'DESIGN_DOC_UPDATE':
        await this.designDocService.runUpdatePostCommit(
          organizationId,
          operation.entityId as DesignDocId,
          operation.payload,
        );
        return;
      case 'INITIATIVE_UPDATE':
        await this.initiativeService.runUpdatePostCommit(
          organizationId,
          operation.entityId as InitiativeId,
          operation.payload,
        );
        return;
      case 'DESIGN_DOC_DELETE':
        await this.designDocService.runRemovePostCommit(
          organizationId,
          operation.entityId as DesignDocId,
        );
        return;
      case 'WORK_ITEM_TYPE_CONFIG_CHANGED':
        await this.workItemTypeRegistry.publishConfigChanged(
          organizationId,
          operation.typeKey,
          projectId,
        );
        return;
      case 'REQUIREMENT_CITATION_EDGE_DELETE':
        await this.pendingEdgeService.deleteEdgesById(
          organizationId,
          projectId,
          operation.edgeIds,
          REQUIREMENT_CITATION_EDGE_DELETE_REASON,
        );
        return;
    }
  }

  private async assertReservedIdentityAvailable(
    tx: AnyTransactionClient,
    proposal: Proposal,
    reservedTargetEntityId: string,
  ): Promise<void> {
    let existing: { id: string } | null;
    switch (proposal.targetEntityType) {
      case 'TASK':
        existing = await tx.task.findUnique({
          where: { id: reservedTargetEntityId },
          select: { id: true },
        });
        break;
      case 'DESIGN_DOC':
        existing = await tx.designDoc.findUnique({
          where: { id: reservedTargetEntityId },
          select: { id: true },
        });
        break;
      case 'CONVERSATION':
        existing = await tx.conversation.findUnique({
          where: { id: reservedTargetEntityId },
          select: { id: true },
        });
        break;
      case 'WORK_ITEM_TYPE':
        existing = await tx.workItemType.findUnique({
          where: { id: reservedTargetEntityId },
          select: { id: true },
        });
        break;
      default:
        throw new BadRequestException(
          `Unsupported grouped CREATE target entity type: ${String(
            proposal.targetEntityType,
          )}`,
        );
    }

    if (!existing) {
      return;
    }
    this.logger.warn('Rejected occupied grouped reserved identity', {
      proposalId: proposal.id,
      targetEntityType: proposal.targetEntityType,
      reservedTargetEntityId,
    });
    throw new ConflictException(
      'Reserved grouped target identity is already occupied.',
    );
  }

  private async verifyReservedCreateMaterialization(
    tx: AnyTransactionClient,
    proposal: Proposal,
    reservedTargetEntityId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const updates = proposal.updates as Record<string, unknown>;
    let mismatches: string[];

    switch (proposal.targetEntityType) {
      case 'TASK': {
        const task = await tx.task.findUnique({
          where: { id: reservedTargetEntityId },
          include: {
            sections: {
              select: { key: true, materializedMarkdown: true },
            },
            serviceRelations: { select: { serviceId: true } },
          },
        });
        if (!task) {
          mismatches = ['entity is missing'];
          break;
        }
        mismatches = this.collectMaterializationMismatches([
          ['organizationId', task.organizationId, organizationId],
          ['projectId', task.projectId, projectId],
          ['archivedAt', task.archivedAt, null],
          ['name', task.name, updates.name],
          ['type', task.type, updates.type ?? 'STANDARD'],
          ['tag', task.tag, updates.tag ?? null],
          ['initiativeId', task.initiativeId, updates.initiativeId ?? null],
          ['parentTaskId', task.parentTaskId, updates.parentTaskId ?? null],
          ['status', task.status, updates.status],
          ['source', task.source, updates.source ?? 'system'],
          ['priority', task.priority, updates.priority ?? 'MEDIUM'],
          ['assigneeId', task.assigneeId, updates.assigneeId ?? null],
          [
            'dueDate',
            task.dueDate?.toISOString() ?? null,
            typeof updates.dueDate === 'string'
              ? new Date(updates.dueDate).toISOString()
              : null,
          ],
          ['config', task.config ?? null, updates.config ?? null],
        ]);
        const sections = updates.sections;
        if (Array.isArray(sections)) {
          const storedSections = new Map<string, string | null>(
            task.sections.map(
              (section: { key: string; materializedMarkdown: string | null }) =>
                [section.key, section.materializedMarkdown] as const,
            ),
          );
          for (const section of sections as Array<Record<string, unknown>>) {
            if (
              typeof section.key !== 'string' ||
              storedSections.get(section.key) !== section.content
            ) {
              mismatches.push(`sections.${String(section.key)}`);
            }
          }
        }
        if (
          typeof updates.serviceId === 'string' &&
          !task.serviceRelations.some(
            (relation: { serviceId: string }) =>
              relation.serviceId === updates.serviceId,
          )
        ) {
          mismatches.push('serviceId');
        }
        break;
      }
      case 'DESIGN_DOC': {
        const designDoc = await tx.designDoc.findUnique({
          where: { id: reservedTargetEntityId },
          include: {
            sections: {
              select: { key: true, order: true, materializedMarkdown: true },
            },
          },
        });
        if (!designDoc) {
          mismatches = ['entity is missing'];
          break;
        }
        mismatches = this.collectMaterializationMismatches([
          ['organizationId', designDoc.organizationId, organizationId],
          ['projectId', designDoc.projectId, projectId],
          ['archivedAt', designDoc.archivedAt, null],
          ['name', designDoc.name, updates.name],
          ['template', designDoc.template, updates.template],
          ['status', designDoc.status, updates.status],
          ['tags', designDoc.tags, updates.tags],
          ['summary', designDoc.summary, updates.summary],
          ['parentEntityId', designDoc.parentEntityId, updates.parentEntityId],
          [
            'parentEntityType',
            designDoc.parentEntityType,
            updates.parentEntityType,
          ],
        ]);
        const sections = updates.sections;
        if (Array.isArray(sections)) {
          const storedSections = new Map<
            string,
            { order: number; content: string | null }
          >(
            designDoc.sections.map(
              (section: {
                key: string;
                order: number;
                materializedMarkdown: string | null;
              }) =>
                [
                  section.key,
                  {
                    order: section.order,
                    content: section.materializedMarkdown,
                  },
                ] as const,
            ),
          );
          for (const section of sections as Array<Record<string, unknown>>) {
            const stored = storedSections.get(String(section.key));
            if (
              !stored ||
              stored.order !== section.order ||
              stored.content !== section.content
            ) {
              mismatches.push(`sections.${String(section.key)}`);
            }
          }
        }
        break;
      }
      case 'CONVERSATION': {
        const conversation = await tx.conversation.findUnique({
          where: { id: reservedTargetEntityId },
          select: {
            id: true,
            organizationId: true,
            projectId: true,
            workflowName: true,
            workflowAboutType: true,
            workflowAboutId: true,
            title: true,
          },
        });
        if (!conversation) {
          mismatches = ['entity is missing'];
          break;
        }
        mismatches = this.collectMaterializationMismatches([
          ['organizationId', conversation.organizationId, organizationId],
          ['projectId', conversation.projectId, projectId],
          ['workflowName', conversation.workflowName, updates.workflowName],
          ['workflowAboutType', conversation.workflowAboutType, 'task'],
          ['title', conversation.title, updates.planTitle],
        ]);
        if (!conversation.workflowAboutId) {
          mismatches.push('workflowAboutId');
          break;
        }
        const plan = await tx.task.findFirst({
          where: {
            id: conversation.workflowAboutId,
            organizationId,
            projectId,
            type: 'PLAN',
            archivedAt: null,
          },
          select: {
            name: true,
            sections: {
              where: { key: 'outcome' },
              select: { materializedMarkdown: true },
            },
          },
        });
        if (!plan) {
          mismatches.push('plan work item');
        } else {
          mismatches.push(
            ...this.collectMaterializationMismatches([
              ['plan.name', plan.name, updates.planTitle],
              [
                'plan.outcome',
                plan.sections[0]?.materializedMarkdown,
                updates.planTitle,
              ],
            ]),
          );
        }
        break;
      }
      case 'WORK_ITEM_TYPE': {
        const type = await tx.workItemType.findUnique({
          where: { id: reservedTargetEntityId },
        });
        if (!type) {
          mismatches = ['entity is missing'];
          break;
        }
        mismatches = this.collectMaterializationMismatches([
          ['projectId', type.projectId, projectId],
          ['lifecycleStatus', type.lifecycleStatus, 'active'],
          ['typeKey', type.typeKey, updates.key],
          ['name', type.name, updates.name],
          ['iconKey', type.iconKey, updates.iconKey ?? null],
          ['colorKey', type.colorKey, updates.colorKey ?? null],
          ['description', type.description, updates.description ?? null],
          ['sectionDefinitions', type.sectionDefinitions, updates.sections],
          ['allowedStatuses', type.allowedStatuses, updates.allowedStatuses],
          [
            'allowedParentTypes',
            type.allowedParentTypes,
            updates.allowedParentTypes ?? [],
          ],
          ['edgeTargets', type.edgeTargets, updates.edgeTargets ?? []],
          [
            'requiredScalars',
            type.requiredScalars,
            updates.requiredScalars ?? [],
          ],
          [
            'forbiddenScalars',
            type.forbiddenScalars,
            updates.forbiddenScalars ?? [],
          ],
          [
            'agentSettableStatuses',
            type.agentSettableStatuses,
            writtenAgentSettableStatuses(
              updates as unknown as WorkItemTypeDefinitionDto,
            ),
          ],
          [
            'anchorableReportTypes',
            type.anchorableReportTypes,
            updates.anchorableReportTypes ?? [],
          ],
        ]);
        break;
      }
      default:
        throw new BadRequestException(
          `Unsupported grouped CREATE target entity type: ${String(
            proposal.targetEntityType,
          )}`,
        );
    }

    if (mismatches.length === 0) {
      return;
    }
    this.logger.warn('Rejected mismatched grouped reserved identity retry', {
      proposalId: proposal.id,
      targetEntityType: proposal.targetEntityType,
      reservedTargetEntityId,
      mismatches,
    });
    throw new ConflictException(
      `Reserved grouped target identity does not match the approved proposal materialization (${mismatches.join(
        ', ',
      )}).`,
    );
  }

  private collectMaterializationMismatches(
    comparisons: Array<[field: string, actual: unknown, expected: unknown]>,
  ): string[] {
    return comparisons
      .filter(
        ([, actual, expected]) =>
          expected !== undefined &&
          this.stableMaterializationValue(actual) !==
            this.stableMaterializationValue(expected),
      )
      .map(([field]) => field);
  }

  private stableMaterializationValue(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => this.stableMaterializationValue(entry))
        .join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.stableMaterializationValue(
              object[key],
            )}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
  }

  private toProposalValidationDto(proposal: Proposal): CreateProposalDto {
    return {
      type: proposal.type,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      updates: (proposal.updates as Record<string, unknown>) ?? {},
      requestorContext:
        (proposal.requestorContext as Record<string, unknown>) ?? undefined,
      influences:
        (proposal.influences as unknown as CreateProposalDto['influences']) ??
        undefined,
      generatedWithVersion: proposal.generatedWithVersion ?? undefined,
      validationSessionId: proposal.validationSessionId ?? undefined,
      conversationId: proposal.conversationId ?? undefined,
    };
  }

  async projectGenericPreparation(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: WorkItemChangeSetValidationRequest,
  ): Promise<PreparedChangeSetProjection> {
    return this.workItemChangeSetMaterializer.projectPreparation({
      organizationId,
      projectId,
      request,
    });
  }

  genericChangeSetRequest(
    proposal: Proposal,
  ): WorkItemChangeSetValidationRequest | null {
    if (
      this.workItemChangeSetMaterializer.isWorkItemChangeSetValidationRequest(
        proposal.updates,
      )
    ) {
      return proposal.updates;
    }
    return this.workItemChangeSetMaterializer.taskProposalChangeSet(proposal);
  }

  /**
   * The projection was computed before the row lock; reject the approval when
   * the locked proposal no longer carries the operation set that was projected.
   */
  assertPreparedChangeSetCurrent(
    proposalId: string,
    request: WorkItemChangeSetValidationRequest | null,
    prepared: PreparedChangeSetProjection | null,
  ): PreparedChangeSetProjection | null {
    const lockedRevision = request
      ? this.workItemChangeSetMaterializer.validationRevision(
          normalizeDiagramChangeSet(request),
        )
      : null;
    if (lockedRevision !== (prepared?.validationRevision ?? null)) {
      this.logger.warn(
        'Proposal changed between projection and approval lock',
        {
          proposalId,
          preparedRevision: prepared?.validationRevision ?? null,
          lockedRevision,
        },
      );
      throw new ConflictException(
        'Proposal changed while it was being approved; retry the approval.',
      );
    }
    return prepared;
  }

  private async assertGenericChangeSetValid(
    proposal: Proposal,
    changeSet: WorkItemChangeSetValidationRequest | null,
    projection: ProjectedWorkItemChangeSetResponse | null,
    db: AnyTransactionClient,
  ): Promise<void> {
    if (!changeSet || !projection) {
      await this.assertFeatureRequirementBaseline(proposal, undefined, db);
      return;
    }
    await this.assertFeatureRequirementBaseline(proposal, changeSet, db);
    this.logger.debug(
      'Validated generic work-item change set before approval',
      {
        proposalId: proposal.id,
        valid: projection.valid,
        issueCount: projection.issues.length,
      },
    );
    if (!projection.valid) {
      const requirementIssues = projection.issues.filter(
        (issue) =>
          issue.code.startsWith('feature_requirement_') ||
          issue.code === 'invalid_feature_requirement_section',
      );
      if (requirementIssues.length > 0) {
        throw new BadRequestException({
          message: 'FEATURE requirements change set is invalid.',
          errors: requirementIssues,
          diagnostic: toProposalApprovalFailureDiagnostic({
            ...projection,
            issues: requirementIssues,
          }),
        });
      }
      this.logger.warn(
        'Generic work-item change set requires enactment-time diagnostics',
        {
          proposalId: proposal.id,
          issueCount: projection.issues.length,
          issues: projection.issues,
          diagnostic: toProposalApprovalFailureDiagnostic(projection),
        },
      );
    }
    if (
      proposal.targetEntityType === 'TASK' &&
      proposal.action === 'UPDATE' &&
      proposal.updates !== null &&
      typeof proposal.updates === 'object' &&
      !Array.isArray(proposal.updates)
    ) {
      const proposedType = (proposal.updates as Record<string, unknown>).type;
      if (
        typeof proposedType === 'string' &&
        proposedType !== projection.projectedRoot.type
      ) {
        throw new BadRequestException(
          'Task type cannot be changed after creation.',
        );
      }
    }
  }

  /**
   * A prepared requirements replacement is a review snapshot, not a patch to
   * whatever collection happens to exist at approval time. The section's
   * updatedAt is therefore the live baseline marker: if it moved after the
   * proposal was last written, approval must fail before any vote or enqueue
   * is persisted. Proposal updates refresh updatedAt, so an edited proposal
   * establishes a new baseline without rebasing the reviewed collection.
   */
  private async assertFeatureRequirementBaseline(
    proposal: Proposal,
    request: WorkItemChangeSetValidationRequest | undefined,
    db: AnyTransactionClient,
  ): Promise<void> {
    const taskIds = [
      ...new Set(
        request
          ? request.operations.flatMap((operation) => {
              if (
                (operation.op !== 'section.replace' &&
                  operation.op !== 'section.clear') ||
                operation.key !== 'requirements' ||
                operation.ref.refType !== 'existing'
              ) {
                return [];
              }
              return [operation.ref.id];
            })
          : this.hasOrdinaryFeatureRequirementUpdate(proposal)
            ? [proposal.targetEntityId]
            : [],
      ),
    ];
    if (taskIds.length === 0) return;

    if (typeof db.$queryRaw === 'function') {
      await db.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${proposal.organizationId}:${proposal.projectId}`}, 0))::text AS "lockAcquired"`,
      );
    }
    const sections = await db.taskSection.findMany({
      where: { taskId: { in: taskIds }, key: 'requirements' },
      select: { taskId: true, updatedAt: true },
    });
    const changed = sections.find(
      (section: { taskId: string; updatedAt: Date }) =>
        section.updatedAt > proposal.updatedAt,
    );
    if (!changed) return;

    this.logger.warn('Rejected stale FEATURE requirements baseline', {
      proposalId: proposal.id,
      taskId: changed.taskId,
      proposalUpdatedAt: proposal.updatedAt,
      sectionUpdatedAt: changed.updatedAt,
    });
    throw new ConflictException(
      'FEATURE requirements changed after this proposal was prepared; review the current collection and resubmit.',
    );
  }

  private hasOrdinaryFeatureRequirementUpdate(proposal: Proposal): boolean {
    if (
      proposal.targetEntityType !== 'TASK' ||
      proposal.action !== 'UPDATE' ||
      proposal.updates === null ||
      typeof proposal.updates !== 'object' ||
      Array.isArray(proposal.updates)
    ) {
      return false;
    }
    const updates = proposal.updates as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(updates, 'requirementOps')) {
      return true;
    }
    return (
      Array.isArray(updates.sections) &&
      updates.sections.some(
        (section) =>
          section !== null &&
          typeof section === 'object' &&
          (section as { key?: unknown }).key === 'requirements',
      )
    );
  }

  private isWorkItemChangeSetValidationRequest(
    value: unknown,
  ): value is WorkItemChangeSetValidationRequest {
    return (
      value !== null &&
      typeof value === 'object' &&
      'root' in value &&
      Array.isArray((value as { operations?: unknown }).operations)
    );
  }

  /**
   * Apply a freshly-created (DRAFT) CREATE/UPDATE proposal inside the caller's
   * transaction: enact the change, mark the proposal APPROVED, and publish the
   * `proposal.approved` event — without recording an approval row and without
   * re-running threshold evaluation. The caller (the create flow) is
   * responsible for the apply-on-create eligibility decision.
   *
   * Returns `materializableEdges` so the caller can run
   * `pendingEdgeService.materializeEdges` after the transaction commits.
   */
  async applyInTransaction(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    enactmentOptions: EnactmentOptions = {},
  ): Promise<{
    proposal: Proposal;
    resultingEntityId: string;
    materializableEdges: MaterializableEdge[];
    immediatelyMaterializedEdges: MaterializedProposalEdge[];
    runPostCommit: PostCommitRunner;
    durablePostCommits: DurablePostCommit[];
  }> {
    assertProposalApplicationEligible(proposal, 'applyInTransaction');
    if (!this.isEnactableAction(proposal)) {
      throw new BadRequestException(
        `Only CREATE and UPDATE proposals can be applied. ` +
          `Got: ${proposal.action} (${proposal.targetEntityType})`,
      );
    }
    if (
      proposal.action === 'DELETE' &&
      proposal.targetEntityType === 'WORK_ITEM_TYPE'
    ) {
      assertProposalStructurallyValid(this.toProposalValidationDto(proposal));
    }
    if (proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
      assertProposalStructurallyValid(this.toProposalValidationDto(proposal));
    }

    await this.reconciliation.assertApplicable(tx, proposal);

    let approved = enactmentOptions.reviewedFuture
      ? {
          ...proposal,
          action: 'UPDATE' as const,
          updates: futureTargetUpdates(
            enactmentOptions.reviewedFuture,
            this.workItemTypeRegistry,
          ) as Prisma.InputJsonObject,
        }
      : await tx.proposal.update({
          where: { id: proposal.id },
          data: { status: 'APPROVED' as PrismaProposalStatus },
        });

    if (approved.action === 'VERSIONED_UPDATE') {
      await stageFutureRevision(tx, this.workItemTypeRegistry, approved);
      await this.publishApprovedEvent(tx, approved, approved.targetEntityId);
      return {
        proposal: approved,
        resultingEntityId: approved.targetEntityId,
        materializableEdges: [],
        immediatelyMaterializedEdges: [],
        runPostCommit: NOOP_POST_COMMIT,
        durablePostCommits: [],
      };
    }

    const priorMentions =
      approved.targetEntityType === 'ENTITY_PROMPT_TEMPLATE'
        ? []
        : await this.snapshotPriorBodyMentions(tx, approved, organizationId);
    const priorRequirementCitations =
      await this.snapshotPriorRequirementCitations(tx, approved);

    let entityId: string;
    let runPostCommit: PostCommitRunner = NOOP_POST_COMMIT;
    let durablePostCommits: DurablePostCommit[] = [];
    let embeddedMaterializableEdges: MaterializableEdge[] = [];
    if (approved.targetEntityType === 'ENTITY_PROMPT_TEMPLATE') {
      entityId = await this.enactEntityPromptTemplate(tx, approved, projectId);
    } else if (approved.action === 'CREATE') {
      const createResult = await this.enactCreate(
        tx,
        approved,
        organizationId,
        projectId,
        enactmentOptions,
      );
      entityId = createResult.entityId;
      runPostCommit = createResult.runPostCommit;
      durablePostCommits = createResult.durablePostCommits;
      embeddedMaterializableEdges = createResult.materializableEdges;
      // Enactment created the entity; rewrite the placeholder NIL_UUID
      // targetEntityId to the real id and re-capture the row so the
      // approved event (and downstream consumers) see the materialized id.
      approved = await tx.proposal.update({
        where: { id: approved.id },
        data: { targetEntityId: entityId },
      });
    } else if (approved.action === 'UPDATE') {
      const enactResult = await this.enactUpdate(
        tx,
        approved,
        organizationId,
        projectId,
        enactmentOptions,
      );
      entityId = enactResult.entityId;
      runPostCommit = enactResult.runPostCommit;
      durablePostCommits = enactResult.durablePostCommits;
    } else {
      const enactResult = await this.enactDelete(
        tx,
        approved,
        projectId,
        organizationId,
        enactmentOptions,
      );
      entityId = enactResult.entityId;
      runPostCommit = enactResult.runPostCommit;
      durablePostCommits = enactResult.durablePostCommits;
    }

    await this.advanceTaskMarkerAfterMaterialization(tx, approved, entityId);
    await this.reconciliation.recordCreatedDelivery(tx, approved);

    if (!enactmentOptions.reviewedFuture)
      await this.publishApprovedEvent(tx, approved, entityId);

    const pendingEdgeTaskPostCommits: PendingEdgeTaskPostCommit[] = [];
    const immediatelyMaterializedEdges: MaterializedProposalEdge[] = [];
    const materializableEdges = [
      ...embeddedMaterializableEdges,
      ...(await this.pendingEdgeService.processDeclaredEdges(
        tx,
        approved,
        entityId,
        {
          onTaskPostCommit: (postCommit) =>
            pendingEdgeTaskPostCommits.push(postCommit),
        },
      )),
    ];

    if (approved.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE') {
      await this.processBodyMentions(
        tx,
        approved,
        entityId,
        priorMentions,
        materializableEdges,
      );
    }

    const citationEdgeDeletes = await this.collectRequirementCitationEdges(
      tx,
      approved,
      entityId,
      priorRequirementCitations,
      (edge) => {
        immediatelyMaterializedEdges.push(edge);
        enactmentOptions.onImmediateEdgeCreated?.(edge);
      },
    );

    return {
      proposal: approved,
      resultingEntityId: entityId,
      materializableEdges,
      immediatelyMaterializedEdges,
      runPostCommit: this.withRequirementCitationEdgeDeletes(
        this.combinePostCommitRunners(
          runPostCommit,
          organizationId,
          pendingEdgeTaskPostCommits,
        ),
        organizationId,
        projectId,
        citationEdgeDeletes,
      ),
      durablePostCommits: [
        ...durablePostCommits,
        ...pendingEdgeTaskPostCommits.map(
          (pending): DurablePostCommit => ({
            kind: 'TASK_UPDATE',
            entityId: pending.taskId,
            payload: pending.postCommit,
          }),
        ),
        ...(citationEdgeDeletes.length > 0
          ? [
              {
                kind: 'REQUIREMENT_CITATION_EDGE_DELETE',
                edgeIds: citationEdgeDeletes,
              } satisfies DurablePostCommit,
            ]
          : []),
      ],
    };
  }

  private withRequirementCitationEdgeDeletes(
    primary: PostCommitRunner,
    organizationId: OrganizationId,
    projectId: ProjectId,
    edgeIds: string[],
  ): PostCommitRunner {
    if (edgeIds.length === 0) {
      return primary;
    }
    return async () => {
      await primary();
      await this.pendingEdgeService.deleteEdgesById(
        organizationId,
        projectId,
        edgeIds,
        REQUIREMENT_CITATION_EDGE_DELETE_REASON,
      );
    };
  }

  private writesFeatureRequirements(proposal: Proposal): boolean {
    if (
      proposal.targetEntityType !== 'TASK' ||
      (proposal.action !== 'CREATE' && proposal.action !== 'UPDATE') ||
      proposal.updates === null ||
      typeof proposal.updates !== 'object' ||
      Array.isArray(proposal.updates)
    ) {
      return false;
    }
    const updates = proposal.updates as Record<string, unknown>;
    return (
      Object.prototype.hasOwnProperty.call(updates, 'initialRequirements') ||
      Object.prototype.hasOwnProperty.call(updates, 'requirementOps') ||
      (Array.isArray(updates.sections) &&
        updates.sections.some(
          (section) =>
            section !== null &&
            typeof section === 'object' &&
            (section as { key?: unknown }).key === 'requirements',
        ))
    );
  }

  /**
   * Snapshot the stored requirements before enactment so the citation edge
   * diff compares against the collection this proposal replaces.
   */
  private async snapshotPriorRequirementCitations(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<PriorRequirementCitations | null> {
    if (!this.writesFeatureRequirements(proposal)) {
      return null;
    }
    if (proposal.action === 'CREATE') {
      return { priorContent: null };
    }
    const section: { materializedMarkdown: string | null } | null =
      await tx.taskSection.findFirst({
        where: { taskId: proposal.targetEntityId, key: 'requirements' },
        select: { materializedMarkdown: true },
      });
    this.logger.debug('Snapshotted prior requirements for citation edges', {
      proposalId: proposal.id,
      targetEntityId: proposal.targetEntityId,
      hasPriorSection: section !== null,
    });
    return { priorContent: section?.materializedMarkdown ?? null };
  }

  /**
   * Write newly cited edges before committing requirements. Return removed
   * edge ids for post-commit deletion; rollback compensates successful creates
   * if any citation write or the enclosing transaction fails.
   */
  private async collectRequirementCitationEdges(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    prior: PriorRequirementCitations | null,
    onCreated: (edge: MaterializedProposalEdge) => void,
  ): Promise<string[]> {
    if (!prior) {
      return [];
    }
    const task: {
      type: string;
      sections: Array<{ materializedMarkdown: string | null }>;
    } | null = await tx.task.findUnique({
      where: { id: resultingEntityId },
      select: {
        type: true,
        sections: {
          where: { key: 'requirements' },
          select: { materializedMarkdown: true },
        },
      },
    });
    if (!task || task.type !== WORK_ITEM_TYPE_KEYS.Feature) {
      return [];
    }
    const nextContent = task.sections[0]?.materializedMarkdown ?? undefined;
    let diff: RequirementCitationEdgeDiff;
    try {
      diff = diffRequirementCitationEdges(
        resultingEntityId,
        prior.priorContent ?? undefined,
        nextContent,
      );
    } catch (error) {
      if (!(error instanceof FeatureRequirementsReadError)) throw error;
      // Unconverted legacy content cites nothing the derivation can identify.
      // A malformed next collection still fails the approval below.
      diff = diffRequirementCitationEdges(
        resultingEntityId,
        undefined,
        nextContent,
      );
      this.logger.warn(
        'Prior FEATURE requirements are not canonical; no citation edges will be removed',
        { proposalId: proposal.id, featureId: resultingEntityId },
      );
    }
    await this.pendingEdgeService.materializeRequirementCitationEdges(
      proposal.organizationId as OrganizationId,
      proposal.projectId as ProjectId,
      diff.creates,
      onCreated,
    );
    this.logger.log('Derived requirement citation edges', {
      proposalId: proposal.id,
      featureId: resultingEntityId,
      creates: diff.creates.length,
      deletes: diff.deletes.length,
    });
    return diff.deletes.map((edge) => edge.id);
  }

  private combinePostCommitRunners(
    primary: PostCommitRunner,
    organizationId: OrganizationId,
    taskPostCommits: Array<{
      taskId: TaskId;
      postCommit: TaskUpdatePostCommit;
    }>,
  ): PostCommitRunner {
    if (taskPostCommits.length === 0) {
      return primary;
    }
    return async () => {
      await primary();
      for (const taskPostCommit of taskPostCommits) {
        await this.taskService.runUpdatePostCommit(
          organizationId,
          taskPostCommit.taskId,
          taskPostCommit.postCommit,
        );
      }
    };
  }

  async reject(
    proposalId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    reason?: string,
  ): Promise<RejectionResult> {
    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    const grouped = this.proposalGroupDecisionService
      ? await this.prisma.db.proposal.findFirst({
          where: { id: proposalId, organizationId, projectId },
          select: { groupMembership: { select: { groupId: true } } },
        })
      : null;
    if (grouped?.groupMembership && this.proposalGroupDecisionService) {
      const decision = await this.proposalGroupDecisionService.reject(
        {
          proposalId,
          organizationId,
          projectId,
          userId,
          reason,
        },
        projectPolicy,
      );
      if (decision.result.outcome === 'NOT_ELIGIBLE') {
        throw new BadRequestException(
          'Only an eligible project member may reject this proposal',
        );
      }
      if (decision.result.outcome === 'ALREADY_APPROVED') {
        throw new BadRequestException(
          'User has already approved this proposal',
        );
      }
      if (
        decision.result.outcome === 'ALREADY_REJECTED' &&
        !decision.recorded
      ) {
        throw new BadRequestException(
          'User has already rejected this proposal',
        );
      }
      if (
        decision.result.outcome === 'ALREADY_TERMINAL' &&
        decision.result.executionState !== 'REJECTED'
      ) {
        throw new BadRequestException(
          `Cannot reject a grouped proposal in ${decision.result.executionState}`,
        );
      }
      const proposal = await this.prisma.db.proposal.findUniqueOrThrow({
        where: { id: proposalId },
      });
      return { proposal: await this.toResponseDto(proposal, projectPolicy) };
    }
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const proposal = await this.findForUpdateInTx(
        tx,
        proposalId,
        organizationId,
        projectId,
      );

      if (proposal.groupMembership) {
        throw new ConflictException(
          'Grouped proposals can only be rejected through proposal-group review.',
        );
      }

      if (proposal.status === 'REJECTED') {
        throw new BadRequestException('Proposal is already rejected');
      }

      if (proposal.status === 'APPROVED') {
        throw new BadRequestException(
          'Cannot reject a proposal that has already been approved',
        );
      }

      const normalizedReason = reason?.trim() || null;
      if (proposal.action !== 'CREATE' && normalizedReason === null) {
        throw new BadRequestException(
          'A reason is required when rejecting an UPDATE or DELETE proposal',
        );
      }

      await this.recordRejectionInTx(tx, proposalId, userId, normalizedReason);

      const result = await tx.proposal.update({
        where: { id: proposalId },
        data: { status: 'REJECTED' as PrismaProposalStatus },
      });

      await this.pendingEdgeService.cleanupForProposal(tx, proposalId);

      return result;
    });

    this.logger.log('Proposal rejected', {
      proposalId,
      organizationId,
      projectId,
      rejectedBy: userId,
    });

    return {
      proposal: await this.toResponseDto(updated, projectPolicy),
    };
  }

  private async recordRejectionInTx(
    tx: AnyTransactionClient,
    proposalId: string,
    userId: UserId,
    reason: string | null,
  ): Promise<void> {
    try {
      await tx.proposalApprovalRecord.create({
        data: {
          proposalId,
          userId,
          type: ProposalApprovalType.REJECTION,
          reason,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'User has already recorded a decision on this proposal',
          );
        }
      }
      throw error;
    }
  }

  private async recordApprovalInTx(
    tx: AnyTransactionClient,
    proposalId: string,
    userId: UserId,
  ): Promise<void> {
    try {
      await tx.proposalApprovalRecord.create({
        data: {
          proposalId,
          userId,
          type: ProposalApprovalType.APPROVAL,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'User has already recorded a decision on this proposal',
          );
        }
      }
      throw error;
    }
  }

  private async advanceTaskMarkerAfterMaterialization(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
  ): Promise<void> {
    if (proposal.targetEntityType !== 'TASK' || proposal.action === 'DELETE') {
      return;
    }
    await tx.task.update({
      where: { id: resultingEntityId },
      data: { lastAppliedProposalId: proposal.id },
    });
  }

  private async findForUpdateInTx(
    tx: AnyTransactionClient,
    proposalId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<
    Proposal & { groupMembership: { groupId: string } | null | undefined }
  > {
    const selected = await tx.proposal.findFirst({
      where: { id: proposalId, organizationId, projectId },
      select: { action: true, updates: true },
    });
    if (selected?.action === 'VERSIONED_UPDATE') {
      if (
        await tx.proposalReconciliationSuggestion.findUnique({
          where: { legacyProposalId: proposalId },
        })
      )
        throw new ConflictException(
          'This saved correction is now a suggestion. Review and accept it on the original proposal.',
        );
      await tx.$queryRaw`SELECT f.id FROM proposal_futures f JOIN proposals p ON p.updates->>'futureId' = f.id WHERE p.id = ${proposalId} AND f.organization_id = ${organizationId} AND f.project_id = ${projectId} FOR UPDATE OF f`;
    }
    // Acquire a pessimistic row lock. The raw query exists *solely* to get
    // `FOR UPDATE` — Prisma's typed API has no lock option. We select only
    // `id` and never read columns off the raw row: `$queryRaw` returns the
    // literal Postgres column names (`target_entity_type`), not the Prisma
    // field names (`targetEntityType`), so a `SELECT *` cast to `Proposal`
    // would silently yield `undefined` for every @map-ed field.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId}
        AND organization_id = ${organizationId}
        AND project_id = ${projectId}
      FOR UPDATE
    `;

    if (locked.length === 0) {
      this.logger.warn('Proposal not found', {
        proposalId,
        organizationId,
        projectId,
      });
      throw new NotFoundException('Proposal not found');
    }

    // Re-load through the typed API so the returned row carries Prisma field
    // names. Safe inside the tx: the row is now locked and cannot vanish.
    const proposal = await tx.proposal.findFirst({
      where: { id: proposalId, organizationId, projectId },
      include: {
        groupMembership: {
          select: { groupId: true },
        },
      },
    });

    if (!proposal) {
      this.logger.warn('Proposal not found', {
        proposalId,
        organizationId,
        projectId,
      });
      throw new NotFoundException('Proposal not found');
    }

    return proposal;
  }

  /**
   * The base contract is "CREATE/UPDATE go through the enactor."
   * DELETE archives TASK (including Plan work items), DESIGN_DOC, and
   * WORK_ITEM_TYPE targets, and supports ENTITY_PROMPT_TEMPLATE. CONVERSATION DELETE
   * has no enactor branch and remains rejected.
   */
  private isEnactableAction(proposal: Proposal): boolean {
    if (proposal.action === 'VERSIONED_UPDATE') {
      return (
        proposal.targetEntityType === 'TASK' ||
        proposal.targetEntityType === 'DESIGN_DOC'
      );
    }
    if (proposal.action === 'CREATE' || proposal.action === 'UPDATE') {
      return true;
    }
    if (proposal.action === 'DELETE') {
      return (
        proposal.targetEntityType === 'TASK' ||
        proposal.targetEntityType === 'DESIGN_DOC' ||
        proposal.targetEntityType === 'WORK_ITEM_TYPE' ||
        proposal.targetEntityType === 'ENTITY_PROMPT_TEMPLATE'
      );
    }
    return false;
  }

  private async enactEntityPromptTemplate(
    tx: AnyTransactionClient,
    proposal: Proposal,
    projectId: ProjectId,
  ): Promise<string> {
    if (!this.entityPromptTemplateService) {
      throw new BadRequestException(
        'Entity prompt-template proposal enactment is not configured',
      );
    }

    await this.entityPromptTemplateService.enactProposalInTransaction(
      tx,
      projectId,
      proposal.targetEntityId,
      proposal.updates as unknown as EntityPromptTemplateProposalUpdatesPayload,
    );
    return proposal.targetEntityId;
  }

  private async enactCreate(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: EnactmentOptions = {},
  ): Promise<EnactResult> {
    const updates = proposal.updates as unknown;

    await assertStoredTracksDeclarationsValid({
      db: tx,
      registry: this.workItemTypeRegistry,
      organizationId,
      projectId,
      proposal,
    });

    switch (proposal.targetEntityType) {
      case 'TASK':
        return this.enactCreateTask(
          tx,
          updates as CreateTaskDto,
          organizationId,
          projectId,
          options.reservedTargetEntityId,
        );
      case 'DESIGN_DOC':
        return this.enactCreateDesignDoc(
          tx,
          updates as CreateDesignDocDto,
          organizationId,
          options.reservedTargetEntityId,
        );
      case 'CONVERSATION':
        return this.enactCreateConversation(
          tx,
          updates as Record<string, unknown>,
          proposal,
          organizationId,
          projectId,
          options.reservedTargetEntityId,
        );
      case 'WORK_ITEM_TYPE':
        return this.enactCreateWorkItemType(
          tx,
          updates as WorkItemTypeDefinitionDto,
          organizationId,
          projectId,
          proposal.targetEntityId,
          options.reservedTargetEntityId,
        );
      default:
        // The CREATE-enactable target types above are now exhaustive, so this
        // branch is a runtime safety net for a DB-level targetEntityType outside
        // the TS union — hence the explicit string cast on the narrowed `never`.
        this.logger.warn('Unsupported target entity type for enactment', {
          proposalId: proposal.id,
          targetEntityType: proposal.targetEntityType,
        });
        throw new BadRequestException(
          `Unsupported target entity type: ${proposal.targetEntityType as string}`,
        );
    }
  }

  private async enactCreateTask(
    tx: AnyTransactionClient,
    updates: CreateTaskDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    reservedTargetEntityId?: string,
  ): Promise<EnactResult> {
    if (
      updates.type === 'workflow' &&
      ((updates.workflowSteps?.length ?? 0) > 0 ||
        (updates.workflowLinks?.length ?? 0) > 0)
    ) {
      return this.enactCreateWorkflowTask(
        tx,
        updates,
        organizationId,
        projectId,
        reservedTargetEntityId,
      );
    }

    const initiativeId = (updates.initiativeId as InitiativeId) ?? null;

    const serviceIds = (updates as CreateTaskDto & { serviceIds?: string[] })
      .serviceIds;
    const { serviceIds: _serviceIds, ...taskUpdates } =
      updates as CreateTaskDto & { serviceIds?: string[] };
    const task = await this.taskService.createInTransaction(
      tx,
      organizationId,
      initiativeId,
      taskUpdates,
      projectId,
      reservedTargetEntityId as TaskId | undefined,
    );
    if (serviceIds !== undefined) {
      await this.taskService.replaceServiceAssignmentsInTransaction(
        tx as Prisma.TransactionClient,
        task.id as TaskId,
        serviceIds,
      );
    }

    return {
      entityId: task.id,
      materializableEdges: [],
      runPostCommit: NOOP_POST_COMMIT,
      durablePostCommits: [],
    };
  }

  private async enactCreateWorkflowTask(
    tx: AnyTransactionClient,
    updates: CreateTaskDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    reservedTargetEntityId?: string,
  ): Promise<EnactResult> {
    await this.requireWorkflowFulfillmentTargetsExist(
      tx,
      updates.workflowLinks ?? [],
      organizationId,
      projectId,
    );

    const workflowCreateDto = this.stripWorkflowProposalGraph(updates);
    const initiativeId =
      (workflowCreateDto.initiativeId as InitiativeId) ?? null;

    const workflow = await this.taskService.createInTransaction(
      tx,
      organizationId,
      initiativeId,
      workflowCreateDto,
      projectId,
      reservedTargetEntityId as TaskId | undefined,
    );

    const stepIdByTempId = new Map<string, string>();
    for (const step of updates.workflowSteps ?? []) {
      const stepCreateDto = this.toWorkflowStepCreateDto(
        step,
        workflow.id,
        updates,
      );
      const createdStep = await this.taskService.createInTransaction(
        tx,
        organizationId,
        (stepCreateDto.initiativeId as InitiativeId) ?? null,
        stepCreateDto,
        projectId,
      );
      stepIdByTempId.set(step.tempId, createdStep.id);
    }

    return {
      entityId: workflow.id,
      materializableEdges: this.resolveWorkflowProposalLinks(
        updates.workflowLinks ?? [],
        stepIdByTempId,
      ),
      runPostCommit: NOOP_POST_COMMIT,
      durablePostCommits: [],
    };
  }

  private stripWorkflowProposalGraph(updates: CreateTaskDto): CreateTaskDto {
    const {
      workflowSteps: _workflowSteps,
      workflowLinks: _workflowLinks,
      ...taskUpdates
    } = updates;
    void _workflowSteps;
    void _workflowLinks;
    return taskUpdates;
  }

  private toWorkflowStepCreateDto(
    step: WorkflowProposalStepInput,
    workflowId: string,
    workflowUpdates: CreateTaskDto,
  ): CreateTaskDto {
    return {
      name: step.name,
      sections: step.sections,
      initiativeId: workflowUpdates.initiativeId,
      status: step.status,
      source: step.source,
      priority: step.priority,
      dueDate: step.dueDate,
      assigneeId: step.assigneeId,
      parentTaskId: workflowId,
      serviceId: step.serviceId,
      type: 'workflow_step',
    } satisfies CreateTaskDto;
  }

  private resolveWorkflowProposalLinks(
    links: WorkflowProposalLinkInput[],
    stepIdByTempId: Map<string, string>,
  ): MaterializableEdge[] {
    return links.map((link) => {
      const sourceEntityId = this.requireWorkflowProposalStepId(
        stepIdByTempId,
        link.sourceStepTempId,
        'sourceStepTempId',
      );

      if (link.type === 'FULFILLED_BY') {
        if (!link.targetTaskId) {
          throw new BadRequestException(
            'FULFILLED_BY workflow links require targetTaskId.',
          );
        }
        return {
          sourceEntityId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: link.targetTaskId,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          edgeType: link.type,
          category: 'meta',
          description: link.description,
        } satisfies MaterializableEdge;
      }

      const targetEntityId =
        link.type === 'LOOP' && !link.targetStepTempId
          ? sourceEntityId
          : this.requireWorkflowProposalStepId(
              stepIdByTempId,
              link.targetStepTempId,
              'targetStepTempId',
            );

      const workflowFields =
        link.type === 'CONDITIONAL'
          ? { direction: link.direction, predicate: link.predicate }
          : link.type === 'STANDARD'
            ? { direction: link.direction }
            : link.predicate !== undefined
              ? { predicate: link.predicate }
              : {};

      return {
        sourceEntityId,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetEntityId,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        edgeType: link.type,
        category: 'flow',
        ...workflowFields,
        description: link.description,
      } satisfies MaterializableEdge;
    });
  }

  private async requireWorkflowFulfillmentTargetsExist(
    tx: AnyTransactionClient,
    links: WorkflowProposalLinkInput[],
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const targetTaskIds = [
      ...new Set(
        links
          .filter((link) => link.type === 'FULFILLED_BY')
          .map((link) => link.targetTaskId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    if (targetTaskIds.length === 0) {
      return;
    }

    const targets: Array<{ id: string }> = await tx.task.findMany({
      where: {
        id: { in: targetTaskIds },
        organizationId,
        projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    const found = new Set(targets.map((target) => target.id));
    const missing = targetTaskIds.find(
      (targetTaskId) => !found.has(targetTaskId),
    );
    if (missing) {
      throw new BadRequestException(
        `FULFILLED_BY workflow link target task ${missing} was not found in this project.`,
      );
    }
  }

  private requireWorkflowProposalStepId(
    stepIdByTempId: Map<string, string>,
    tempId: string | undefined,
    field: string,
  ): string {
    if (!tempId) {
      throw new BadRequestException(
        `Workflow proposal link is missing ${field}.`,
      );
    }
    const stepId = stepIdByTempId.get(tempId);
    if (!stepId) {
      throw new BadRequestException(
        `Workflow proposal link references unknown proposed step '${tempId}'.`,
      );
    }
    return stepId;
  }

  private async enactCreateDesignDoc(
    tx: AnyTransactionClient,
    updates: CreateDesignDocDto,
    organizationId: OrganizationId,
    reservedTargetEntityId?: string,
  ): Promise<EnactResult> {
    const designDoc = await this.designDocService.createInTransaction(
      tx,
      {
        ...updates,
        organizationId,
      },
      reservedTargetEntityId as DesignDocId | undefined,
    );

    return {
      entityId: designDoc.id,
      materializableEdges: [],
      runPostCommit: NOOP_POST_COMMIT,
      durablePostCommits: [],
    };
  }

  private async enactCreateConversation(
    tx: AnyTransactionClient,
    updates: Record<string, unknown>,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    reservedTargetEntityId?: string,
  ): Promise<EnactResult> {
    const designDocMarkdown = updates.designDocMarkdown as string;
    const planTitle = updates.planTitle as string;
    const parentFeatureId = updates.parentFeatureId as string | undefined;
    const workflowName = updates.workflowName as WorkflowName | undefined;

    // Today only PlanFromDesignDoc is supported. Reject anything else loudly
    // rather than silently coercing — the proposal payload is the contract
    // between create_plan and this enactor.
    if (workflowName !== WorkflowName.PlanFromDesignDoc) {
      throw new BadRequestException(
        `Unsupported workflowName for CONVERSATION CREATE proposal: ${workflowName ?? '(missing)'}`,
      );
    }
    if (!parentFeatureId) {
      throw new BadRequestException(
        'parentFeatureId is required for PlanFromDesignDoc conversation proposals',
      );
    }

    const requestorId = proposal.requestorId as UserId;

    // Materialize design doc and plan inside the same proposal transaction so
    // the conversation can be born with the correct (plan, planId) workflow
    // about-fields. Doing this in the workflow node would create a window
    // where the conversation announces about=project before being patched.
    this.logger.log('Materializing design doc for plan-from-design-doc', {
      proposalId: proposal.id,
      planTitle,
      projectId,
    });

    const designDoc = await this.designDocService.createInTransaction(tx, {
      name: planTitle,
      template: 'PLAN_DOCUMENT',
      status: 'READY',
      projectId,
      organizationId,
      sections: [{ key: 'content', order: 0, content: designDocMarkdown }],
      parentEntityType: 'TASK',
      parentEntityId: parentFeatureId,
    });
    const designDocId = designDoc.id as DesignDocId;

    // Materialize the plan + agent session + NOT_STARTED conversation and bind
    // them, LINKing the design doc just created above. This is the shared
    // birth-a-run sequence; the restart relaunch path reuses the identical
    // launcher (against a preserved design doc) via PlanGenerationRestartService.
    this.logger.log('Materializing plan-from-design-doc run', {
      proposalId: proposal.id,
      planTitle,
      projectId,
      designDocId,
    });

    const { conversationId, planId } =
      await this.planFromDesignDocLauncher.materializeRunInTransaction(tx, {
        designDocId,
        designDocMarkdown,
        planTitle,
        parentFeatureId: parentFeatureId as TaskId,
        requestorId,
        projectId,
        organizationId,
        ...(reservedTargetEntityId
          ? { conversationId: reservedTargetEntityId as ConversationId }
          : {}),
      });

    return {
      entityId: conversationId,
      materializableEdges: [
        {
          sourceEntityId: planId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetEntityId: designDocId,
          targetEntityType: AgentEdgeEndpointEntityType.DesignDoc,
          edgeType: 'DERIVES_FROM',
        },
      ],
      runPostCommit: NOOP_POST_COMMIT,
      durablePostCommits: [],
    };
  }

  /**
   * Materialize an accepted WORK_ITEM_TYPE definition: persist it as a
   * project-owned, active `work_item_type` row inside the approval
   * tx, and hand back the registry's post-commit runner so the cross-instance
   * invalidation publishes only after the row commits. The registry owns the
   * table and the invalidation signal; this enactor just supplies the
   * proposal's project scope. Structural and referential validity (key
   * collision, unrecognized references) were already enforced at proposal time
   * by the validation engine, so no re-gating happens here.
   *
   * CREATE is universally enactable, while lifecycle edits and archives route
   * through their respective dispatchers below.
   */
  private async enactCreateWorkItemType(
    tx: AnyTransactionClient,
    definition: WorkItemTypeDefinitionDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetEntityId: string,
    reservedTargetEntityId?: string,
  ): Promise<EnactResult> {
    const isGroupedReservedCreate =
      reservedTargetEntityId !== undefined &&
      targetEntityId === reservedTargetEntityId;

    if (targetEntityId !== NIL_UUID && !isGroupedReservedCreate) {
      this.logger.log('Enacting stable-key restoration for work-item type', {
        typeKey: targetEntityId,
        projectId,
        organizationId,
      });
      const { runPostCommit } =
        await this.workItemTypeLifecycle.restoreInTransaction(
          tx as Prisma.TransactionClient,
          targetEntityId,
          definition,
          projectId,
          organizationId,
        );
      await this.provisionCustomWorkItemTypeTemplate(
        tx,
        projectId,
        targetEntityId,
      );

      return {
        entityId: targetEntityId,
        materializableEdges: [],
        runPostCommit,
        durablePostCommits: [
          { kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED', typeKey: targetEntityId },
        ],
      };
    }

    this.logger.log('Enacting CREATE proposal for work-item type', {
      typeKey: definition.key,
      projectId,
      organizationId,
    });

    const { id, runPostCommit } =
      await this.workItemTypeRegistry.insertAcceptedDefinitionInTransaction(
        tx as Prisma.TransactionClient,
        definition,
        projectId,
        organizationId,
        reservedTargetEntityId,
      );
    await this.provisionCustomWorkItemTypeTemplate(
      tx,
      projectId,
      definition.key,
    );

    return {
      entityId: id,
      materializableEdges: [],
      runPostCommit,
      durablePostCommits: [
        { kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED', typeKey: definition.key },
      ],
    };
  }

  private async provisionCustomWorkItemTypeTemplate(
    tx: AnyTransactionClient,
    projectId: ProjectId,
    workItemTypeKey: string,
  ): Promise<void> {
    if (!this.entityPromptTemplateService) {
      throw new BadRequestException(
        'Entity prompt-template provisioning is not configured',
      );
    }
    await this.entityPromptTemplateService.provisionCustomWorkItemTypeTemplateInTransaction(
      tx,
      projectId,
      workItemTypeKey,
    );
  }

  private async enactUpdate(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    enactmentOptions: EnactmentOptions = {},
  ): Promise<{
    entityId: string;
    runPostCommit: PostCommitRunner;
    durablePostCommits: DurablePostCommit[];
  }> {
    const updates = proposal.updates as unknown;
    const targetEntityId = proposal.targetEntityId;

    switch (proposal.targetEntityType) {
      case 'TASK': {
        const postCommit = await this.enactUpdateTask(
          tx,
          targetEntityId,
          updates as UpdateTaskDto,
          organizationId,
          proposal.requestorId as UserId,
        );
        return {
          entityId: targetEntityId,
          runPostCommit: postCommit.run,
          durablePostCommits: postCommit.durable,
        };
      }
      case 'DESIGN_DOC': {
        const postCommit = await this.enactUpdateDesignDoc(
          tx,
          targetEntityId,
          updates as UpdateDesignDocDto,
          organizationId,
          proposal.requestorId as UserId,
        );
        return {
          entityId: targetEntityId,
          runPostCommit: postCommit.run,
          durablePostCommits: postCommit.durable,
        };
      }
      case 'WORK_ITEM_TYPE': {
        if (
          updates !== null &&
          typeof updates === 'object' &&
          (updates as { resetToCanonical?: unknown }).resetToCanonical ===
            'RESET_TO_CANONICAL'
        ) {
          const canonical = await (
            tx as Prisma.TransactionClient
          ).workItemTypeTemplate.findUnique({
            where: { typeKey: targetEntityId },
            select: { id: true },
          });
          if (!canonical) {
            throw new BadRequestException(
              `Work-item type '${targetEntityId}' is not a canonical override.`,
            );
          }
          const result = await (
            tx as Prisma.TransactionClient
          ).workItemType.deleteMany({
            where: { projectId, typeKey: targetEntityId },
          });
          if (result.count !== 1)
            throw new BadRequestException(
              `Work-item type '${targetEntityId}' is not a canonical override.`,
            );
          return {
            entityId: targetEntityId,
            runPostCommit: () =>
              this.workItemTypeRegistry.publishConfigChanged(
                organizationId,
                targetEntityId,
                projectId,
              ),
            durablePostCommits: [
              {
                kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED',
                typeKey: targetEntityId,
              },
            ],
          };
        }
        const lifecycleRow =
          await this.workItemTypeLifecycle.resolveInTransaction(
            tx as Prisma.TransactionClient,
            targetEntityId,
            projectId,
          );
        if (lifecycleRow?.row.lifecycleStatus === 'archived') {
          this.logger.debug(
            'Routing archived work-item type UPDATE to restore',
            {
              proposalId: proposal.id,
              typeKey: targetEntityId,
              rowId: lifecycleRow.row.id,
            },
          );
          const { runPostCommit } =
            await this.workItemTypeLifecycle.restoreInTransaction(
              tx as Prisma.TransactionClient,
              targetEntityId,
              (updates as { definition: WorkItemTypeDefinitionDto }).definition,
              projectId,
              organizationId,
            );
          return {
            entityId: targetEntityId,
            runPostCommit,
            durablePostCommits: [
              {
                kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED',
                typeKey: targetEntityId,
              },
            ],
          };
        }
        const definition = (
          updates as { definition?: WorkItemTypeDefinitionDto }
        ).definition;
        if (!definition) {
          throw new BadRequestException(
            'WORK_ITEM_TYPE updates require a complete definition.',
          );
        }
        let storedDefinition: WorkItemTypeSummaryDto | undefined;
        if (lifecycleRow) {
          storedDefinition =
            await this.workItemTypeRegistry.getAcceptedCustomDefinitionInTransaction(
              tx as Prisma.TransactionClient,
              targetEntityId,
              projectId,
            );
        } else {
          const canonical = await (
            tx as Prisma.TransactionClient
          ).workItemTypeTemplate.findUnique({
            where: { typeKey: targetEntityId },
          });
          if (canonical) {
            if (
              (updates as { acknowledgeCanonicalCustomization?: boolean })
                .acknowledgeCanonicalCustomization !== true
            ) {
              throw new BadRequestException(
                'Canonical customization acknowledgement is required.',
              );
            }
            storedDefinition = {
              id: canonical.id,
              definition:
                this.workItemTypeRegistry.materializeTemplateDefinition(
                  canonical,
                ),
              status: WorkItemTypeLifecycleStatus.Active,
              projectId,
              effectiveSource: WorkItemTypeEffectiveSource.Canonical,
            };
          }
        }
        if (!storedDefinition)
          throw new BadRequestException(
            `Work-item type '${targetEntityId}' is not available in this project.`,
          );
        assertWorkItemTypeEditSupported(storedDefinition, definition);
        const { runPostCommit } =
          await this.workItemTypeRegistry.updateAcceptedDefinitionInTransaction(
            tx as Prisma.TransactionClient,
            targetEntityId,
            definition,
            projectId,
            organizationId,
          );
        return {
          entityId: targetEntityId,
          runPostCommit,
          durablePostCommits: [
            {
              kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED',
              typeKey: targetEntityId,
            },
          ],
        };
      }
      default:
        this.logger.warn(
          'Unsupported target entity type for UPDATE enactment',
          {
            proposalId: proposal.id,
            targetEntityType: proposal.targetEntityType,
          },
        );
        throw new BadRequestException(
          `Unsupported target entity type for UPDATE: ${proposal.targetEntityType}`,
        );
    }
  }

  private async prepareCascadeDeleteExecutionInTransaction(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
    projectId: ProjectId,
    confirmedImpact: WorkItemTypeCascadeDeleteUpdatesPayload,
  ): Promise<{ id: string; workItemIds: string[] }> {
    const typeKey = proposal.targetEntityId;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${organizationId}:${projectId}`}, 0)
      )::text AS "lockAcquired"
    `;
    await this.workItemTypeRegistry.assertCustomDefinitionDeletableInTransaction(
      tx as Prisma.TransactionClient,
      typeKey,
      projectId,
    );

    const workItems = await tx.task.findMany({
      where: { organizationId, projectId, type: typeKey },
      select: { id: true },
    });
    const workItemIds = [
      ...new Set(workItems.map((item: { id: string }) => item.id)),
    ].sort();
    if (confirmedImpact.itemCount !== workItemIds.length) {
      throw new ConflictException(
        'Cascade impact changed before approval; recount the affected work items and try again.',
      );
    }
    const existing = await tx.workItemTypeCascadeExecution.findUnique({
      where: { proposalId: proposal.id },
      select: { id: true, workItemIds: true },
    });
    if (existing) {
      const existingIds = this.readCascadeWorkItemIds(existing.workItemIds);
      this.logger.log('Reused existing durable cascade execution', {
        proposalId: proposal.id,
        executionId: existing.id,
        typeKey,
        workItemCount: existingIds.length,
      });
      return { id: existing.id, workItemIds: existingIds };
    }

    const created = await tx.workItemTypeCascadeExecution.create({
      data: {
        proposalId: proposal.id,
        organizationId,
        projectId,
        typeKey,
        workItemIds,
      },
      select: { id: true, workItemIds: true },
    });
    this.logger.log('Persisted cascade deletion impact before Graph cleanup', {
      proposalId: proposal.id,
      typeKey,
      confirmedItemCount: confirmedImpact.itemCount,
      confirmedEdgeCount: confirmedImpact.edgeCount,
      currentItemCount: workItemIds.length,
    });
    return {
      id: created.id,
      workItemIds: this.readCascadeWorkItemIds(created.workItemIds),
    };
  }

  /**
   * Completes a claimed cascade after Graph cleanup has been durably marked
   * successful. The external Graph call is intentionally absent from this
   * transaction; a rollback leaves GRAPH_CLEANED work available for retry.
   */
  async finalizeCascadeDeleteExecution(
    executionId: string,
    claimToken: string,
  ): Promise<void> {
    let runPostCommit: PostCommitRunner = NOOP_POST_COMMIT;
    await this.prisma.db.$transaction(async (tx) => {
      const execution = await tx.workItemTypeCascadeExecution.findFirst({
        where: {
          id: executionId,
          state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
          claimToken,
        },
      });
      if (!execution) return;

      const proposal = await this.findForUpdateInTx(
        tx,
        execution.proposalId,
        execution.organizationId as OrganizationId,
        execution.projectId as ProjectId,
      );
      const cascadeUpdates = isCascadeWorkItemTypeDeletePayload(
        proposal.updates,
      )
        ? proposal.updates
        : null;
      if (
        proposal.action !== 'DELETE' ||
        proposal.targetEntityType !== 'WORK_ITEM_TYPE' ||
        !cascadeUpdates ||
        proposal.status !== 'DRAFT'
      ) {
        throw new ConflictException(
          'Cascade execution no longer matches its draft proposal.',
        );
      }

      if (
        proposal.targetEntityId !== execution.typeKey ||
        cascadeUpdates.typeKey !== execution.typeKey
      ) {
        throw new ConflictException(
          'Cascade execution target no longer matches its draft proposal.',
        );
      }
      assertProposalStructurallyValid(this.toProposalValidationDto(proposal));

      const typeKey = execution.typeKey;
      await this.workItemTypeRegistry.assertCustomDefinitionDeletableInTransaction(
        tx as unknown as Prisma.TransactionClient,
        typeKey,
        execution.projectId as ProjectId,
      );
      const workItemIds = this.readCascadeWorkItemIds(execution.workItemIds);
      if (cascadeUpdates.itemCount !== workItemIds.length) {
        throw new ConflictException(
          'Cascade execution item count no longer matches its draft proposal.',
        );
      }
      const deletedWorkItemCount =
        await this.taskService.hardDeleteByIdsInTransaction(
          tx as unknown as Prisma.TransactionClient,
          execution.organizationId as OrganizationId,
          execution.projectId as ProjectId,
          typeKey,
          workItemIds,
        );
      const { runPostCommit: invalidateRegistry } =
        await this.workItemTypeRegistry.deleteAcceptedCustomDefinitionInTransaction(
          tx as unknown as Prisma.TransactionClient,
          typeKey,
          execution.projectId as ProjectId,
          execution.organizationId as OrganizationId,
        );
      const approved = await tx.proposal.update({
        where: { id: proposal.id },
        data: { status: 'APPROVED' as PrismaProposalStatus },
      });
      await this.publishApprovedEvent(tx, approved, typeKey);

      const completed = await tx.workItemTypeCascadeExecution.updateMany({
        where: {
          id: execution.id,
          state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
          claimToken,
        },
        data: {
          state: WorkItemTypeCascadeExecutionState.COMPLETED,
          completedAt: new Date(),
          claimToken: null,
          claimedAt: null,
          claimExpiresAt: null,
          lastError: null,
        },
      });
      if (completed.count === 0) {
        throw new ConflictException(
          'Cascade execution claim was lost during finalization.',
        );
      }
      runPostCommit = async () => {
        this.logger.log('Publishing cascade deletion registry invalidation', {
          proposalId: proposal.id,
          executionId: execution.id,
          typeKey,
          deletedWorkItemCount,
          deletedEdgeCount: execution.graphDeletedEdgeCount,
        });
        await invalidateRegistry();
      };
    });
    await runPostCommit();
  }

  private readCascadeWorkItemIds(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      !value.every((item): item is string => typeof item === 'string')
    ) {
      throw new ConflictException(
        'Cascade execution contains invalid affected work-item IDs.',
      );
    }
    return [...new Set(value)].sort();
  }

  /**
   * Dispatcher for DELETE enactment. TASK / DESIGN_DOC and WORK_ITEM_TYPE
   * archive the target; ENTITY_PROMPT_TEMPLATE uses its deletion service.
   * Any other target type is blocked by the entry guard
   * (`isEnactableAction`) before reaching this branch.
   */
  private async enactDelete(
    tx: AnyTransactionClient,
    proposal: Proposal,
    projectId: ProjectId,
    organizationId: OrganizationId,
    enactmentOptions: EnactmentOptions = {},
  ): Promise<{
    entityId: string;
    runPostCommit: PostCommitRunner;
    durablePostCommits: DurablePostCommit[];
  }> {
    const targetEntityId = proposal.targetEntityId;

    switch (proposal.targetEntityType) {
      case 'TASK': {
        await this.enactDeleteTask(tx, proposal, targetEntityId);
        return {
          entityId: targetEntityId,
          runPostCommit: NOOP_POST_COMMIT,
          durablePostCommits: [],
        };
      }
      case 'DESIGN_DOC': {
        const runPostCommit = await this.enactDeleteDesignDoc(
          tx,
          proposal,
          targetEntityId,
        );
        return {
          entityId: targetEntityId,
          runPostCommit,
          durablePostCommits: [
            { kind: 'DESIGN_DOC_DELETE', entityId: targetEntityId },
          ],
        };
      }
      case 'WORK_ITEM_TYPE': {
        if (isCascadeWorkItemTypeDeletePayload(proposal.updates)) {
          throw new ConflictException(
            'Cascade work-item type deletion must be enacted by its durable execution worker.',
          );
        }
        const lifecycleRow =
          await this.workItemTypeLifecycle.resolveInTransaction(
            tx as Prisma.TransactionClient,
            targetEntityId,
            projectId,
          );
        if (!lifecycleRow) {
          const canonical = await (
            tx as Prisma.TransactionClient
          ).workItemTypeTemplate.findUnique({
            where: { typeKey: targetEntityId },
          });
          if (!canonical)
            throw new BadRequestException(
              `Work-item type '${targetEntityId}' is not available in this project.`,
            );
          if (
            (
              proposal.updates as {
                acknowledgeCanonicalCustomization?: boolean;
              }
            ).acknowledgeCanonicalCustomization !== true
          ) {
            throw new BadRequestException(
              'Canonical customization acknowledgement is required.',
            );
          }
          const definition =
            this.workItemTypeRegistry.materializeTemplateDefinition(canonical);
          await this.workItemTypeRegistry.insertAcceptedDefinitionInTransaction(
            tx as Prisma.TransactionClient,
            definition,
            projectId,
            organizationId,
          );
        }
        const { runPostCommit } =
          await this.workItemTypeLifecycle.archiveInTransaction(
            tx as Prisma.TransactionClient,
            targetEntityId,
            projectId,
            organizationId,
          );
        return {
          entityId: targetEntityId,
          runPostCommit,
          durablePostCommits: [
            {
              kind: 'WORK_ITEM_TYPE_CONFIG_CHANGED',
              typeKey: targetEntityId,
            },
          ],
        };
      }
      default:
        // Unreachable in practice — `isEnactableAction` blocks DELETE
        // for any other targetEntityType before we get here.
        throw new BadRequestException(
          `Unsupported target entity type for DELETE: ${proposal.targetEntityType}`,
        );
    }
  }

  private async enactDeleteTask(
    tx: AnyTransactionClient,
    proposal: Proposal,
    taskId: string,
  ): Promise<void> {
    this.logger.log('Enacting DELETE proposal for task', {
      proposalId: proposal.id,
      taskId,
      organizationId: proposal.organizationId,
    });

    await this.taskService.removeInTransaction(
      tx as Prisma.TransactionClient,
      proposal.organizationId as OrganizationId,
      taskId as TaskId,
    );
  }

  private async enactDeleteDesignDoc(
    tx: AnyTransactionClient,
    proposal: Proposal,
    designDocId: string,
  ): Promise<PostCommitRunner> {
    this.logger.log('Enacting DELETE proposal for design doc', {
      proposalId: proposal.id,
      designDocId,
      organizationId: proposal.organizationId,
    });

    const { runPostCommit } = await this.designDocService.removeInTransaction(
      tx as Prisma.TransactionClient,
      designDocId,
      proposal.organizationId as OrganizationId,
    );

    return runPostCommit;
  }

  private async enactUpdateTask(
    tx: AnyTransactionClient,
    taskId: string,
    updates: UpdateTaskDto,
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<{ run: PostCommitRunner; durable: DurablePostCommit[] }> {
    this.logger.log('Enacting UPDATE proposal for task', {
      taskId,
      organizationId,
      updateKeys: Object.keys(updates),
    });

    if (Object.keys(updates).length === 0) {
      return { run: NOOP_POST_COMMIT, durable: [] };
    }

    const serviceIds = (updates as UpdateTaskDto & { serviceIds?: string[] })
      .serviceIds;
    const { serviceIds: _serviceIds, ...taskUpdates } =
      updates as UpdateTaskDto & { serviceIds?: string[] };
    const { postCommit } = await this.taskService.updateInTransaction(
      tx as Prisma.TransactionClient,
      organizationId,
      null,
      taskId as TaskId,
      taskUpdates,
      userId,
    );
    if (serviceIds !== undefined) {
      await this.taskService.replaceServiceAssignmentsInTransaction(
        tx as Prisma.TransactionClient,
        taskId as TaskId,
        serviceIds,
      );
    }

    return {
      run: async () => {
        await this.taskService.runUpdatePostCommit(
          organizationId,
          taskId as TaskId,
          postCommit,
        );
      },
      durable: [{ kind: 'TASK_UPDATE', entityId: taskId, payload: postCommit }],
    };
  }

  private async enactUpdateDesignDoc(
    tx: AnyTransactionClient,
    designDocId: string,
    updates: UpdateDesignDocDto,
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<{ run: PostCommitRunner; durable: DurablePostCommit[] }> {
    this.logger.log('Enacting UPDATE proposal for design doc', {
      designDocId,
      organizationId,
      updateKeys: Object.keys(updates),
    });

    const { postCommit } = await this.designDocService.updateInTransaction(
      tx as Prisma.TransactionClient,
      designDocId,
      updates,
      organizationId,
      userId,
    );

    return {
      run: async () => {
        await this.designDocService.runUpdatePostCommit(
          organizationId,
          designDocId as DesignDocId,
          postCommit,
        );
      },
      durable: [
        {
          kind: 'DESIGN_DOC_UPDATE',
          entityId: designDocId,
          payload: postCommit,
        },
      ],
    };
  }

  private async publishApprovedEvent(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
  ): Promise<void> {
    const payload: ProposalApprovedEventPayload = {
      payloadType: PayloadType.ProposalApproved,
      proposalId: proposal.id as ProposalId,
      organizationId: proposal.organizationId as OrganizationId,
      projectId: proposal.projectId as ProjectId,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      action: proposal.action,
      requestorId: proposal.requestorId as UserId,
      requestorContext:
        (proposal.requestorContext as Record<string, unknown>) ?? undefined,
      influences:
        (proposal.influences as unknown as ProposalApprovedEventPayload['influences']) ??
        undefined,
      generatedWithVersion: proposal.generatedWithVersion ?? undefined,
      resultingEntityId,
      conversationId: (proposal.conversationId as ConversationId) ?? undefined,
      messageId: (proposal.messageId as MessageId) ?? undefined,
      createdAt: proposal.createdAt.toISOString(),
      shouldProcess: proposal.ragEnabled,
    };

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.PROPOSAL.APPROVED,
      aggregateId: proposal.id,
      payload,
    });
  }

  private async toResponseDto(
    proposal: Proposal,
    projectPolicy: ProjectApprovalPolicy,
  ): Promise<TypedProposalResponse> {
    return mapProposalResponse(this.prisma.db, proposal, projectPolicy, {
      workItemTypeRegistry: this.workItemTypeRegistry,
    });
  }

  /**
   * Body-mention support is scoped to TASK and DESIGN_DOC proposals. Other
   * targets (CONVERSATION) do not carry user-authored prose with mentions.
   */
  private isBodyMentionTarget(
    targetEntityType: string,
  ): targetEntityType is 'TASK' | 'DESIGN_DOC' {
    return targetEntityType === 'TASK' || targetEntityType === 'DESIGN_DOC';
  }

  /**
   * For UPDATE proposals, snapshot the entity's body mentions BEFORE the
   * enactment writes the new sections, so we can diff after enactment to
   * find added vs removed mentions. CREATE proposals always return [].
   */
  private async snapshotPriorBodyMentions(
    tx: AnyTransactionClient,
    proposal: Proposal,
    organizationId: OrganizationId,
  ): Promise<ResolvedMention[]> {
    if (proposal.action !== 'UPDATE') {
      return [];
    }
    if (!this.isBodyMentionTarget(proposal.targetEntityType)) {
      return [];
    }
    const prior = await this.readBodyMentions(
      tx,
      proposal.targetEntityType,
      proposal.targetEntityId,
      organizationId,
    );
    this.logger.debug('Snapshotted prior body mentions for UPDATE proposal', {
      proposalId: proposal.id,
      targetEntityType: proposal.targetEntityType,
      targetEntityId: proposal.targetEntityId,
      priorCount: prior.length,
    });
    return prior;
  }

  /**
   * After enactment + declared-edge processing, read the entity's now-current
   * body mentions, diff against the prior snapshot, dedup against declared
   * edges, and emit one mention.created (or mention.removed) per change.
   */
  private async processBodyMentions(
    tx: AnyTransactionClient,
    proposal: Proposal,
    resultingEntityId: string,
    priorMentions: ResolvedMention[],
    declaredEdges: MaterializableEdge[],
  ): Promise<void> {
    if (!this.isBodyMentionTarget(proposal.targetEntityType)) {
      return;
    }

    // DELETE archives the entity; its prose is no longer live. The prior-
    // mention snapshot is empty for a DELETE (snapshotPriorBodyMentions
    // only snapshots UPDATEs), so diffing would read the archived entity's
    // sections and emit spurious mention.created events. Mention cleanup
    // for an archived entity is handled by the archived-event consumers,
    // exactly as on the normal archive path — so skip diffing here.
    if (proposal.action === 'DELETE') {
      this.logger.debug('Skipping body-mention diffing for DELETE proposal', {
        proposalId: proposal.id,
        targetEntityType: proposal.targetEntityType,
        resultingEntityId,
      });
      return;
    }

    const newMentions = await this.readBodyMentions(
      tx,
      proposal.targetEntityType,
      resultingEntityId,
      proposal.organizationId as OrganizationId,
    );

    // De-dup against edges the agent already declared from the resulting
    // entity: the declared-edge path is authoritative on a shared target.
    const declaredTargets = new Set(
      declaredEdges
        .filter((edge) => edge.sourceEntityId === resultingEntityId)
        .map((edge) => edge.targetEntityId),
    );
    const { added, removed, dedupedAgainstDeclared } = diffBodyMentions(
      priorMentions,
      newMentions,
      declaredTargets,
    );

    if (added.length === 0 && removed.length === 0) {
      return;
    }

    this.logger.log('Emitting body-mention events', {
      proposalId: proposal.id,
      resultingEntityId,
      addedCount: added.length,
      removedCount: removed.length,
      dedupedAgainstDeclared,
    });

    await publishBodyMentionEvents(
      this.eventPublisher,
      tx,
      {
        organizationId: proposal.organizationId as OrganizationId,
        projectId: proposal.projectId as ProjectId,
        sourceEntityId: resultingEntityId,
        sourceEntityType:
          proposal.targetEntityType === 'TASK'
            ? MentionCreatedEventPayload.SourceEntityTypeEnum.Task
            : MentionCreatedEventPayload.SourceEntityTypeEnum.DesignDoc,
        conversationId:
          (proposal.conversationId as ConversationId | null) ?? undefined,
        userId: (proposal.requestorId as UserId | null) ?? undefined,
        added,
        removed,
      },
      this.logger,
    );
  }

  /**
   * Read the entity's text content, run mention extraction + registry
   * validation. For TASK the sections scanned come from the work-item type's
   * section definitions; for DESIGN_DOC we scan every section's materialized
   * markdown.
   */
  private async readBodyMentions(
    tx: AnyTransactionClient,
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<ResolvedMention[]> {
    const content = await this.readEntityBodyContent(
      tx,
      targetEntityType,
      entityId,
    );
    this.logger.debug('Read entity body content for mention scan', {
      targetEntityType,
      entityId,
      contentLength: content.length,
    });
    if (!content) {
      return [];
    }
    return this.mentionProcessingService.extractAndValidate(
      content,
      organizationId,
      tx,
    );
  }

  private async readEntityBodyContent(
    tx: AnyTransactionClient,
    targetEntityType: 'TASK' | 'DESIGN_DOC',
    entityId: string,
  ): Promise<string> {
    if (targetEntityType === 'TASK') {
      // Explicit annotation: AnyTransactionClient is `Prisma.TransactionClient | any`,
      // which collapses the Prisma return type to `any` and loses the
      // `select` shape inference. Restating the row shape keeps callers
      // strict-typed without re-narrowing `tx` here.
      const task: {
        type: string;
        projectId: string;
        sections: WorkItemMentionSectionRow[];
      } | null = await tx.task.findUnique({
        where: { id: entityId },
        select: {
          type: true,
          projectId: true,
          sections: { select: { key: true, materializedMarkdown: true } },
        },
      });
      if (!task) {
        this.logger.warn('Task not found for body-mention scan', { entityId });
        return '';
      }
      // Throws when the type is missing from the registry: an unresolvable
      // type must fail the approval rather than silently drop every mention.
      const sectionDefinitions =
        this.workItemTypeRegistry.getSectionDefinitions(
          task.type,
          task.projectId,
        );
      this.logger.debug('Collecting task body-mention content', {
        entityId,
        typeKey: task.type,
        sectionCount: task.sections.length,
        definedSectionCount: sectionDefinitions.length,
      });
      return collectWorkItemMentionContent(
        task.type,
        sectionDefinitions,
        task.sections,
      );
    }

    const sections = await tx.designDocSection.findMany({
      where: { designDocId: entityId },
      select: { materializedMarkdown: true },
    });
    return sections
      .map(
        (s: { materializedMarkdown: string | null }) =>
          s.materializedMarkdown ?? '',
      )
      .join('\n\n');
  }
}
