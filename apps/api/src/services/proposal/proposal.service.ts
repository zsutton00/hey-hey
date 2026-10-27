import { MessageService } from '../message.service';
import { ProposalReconciliationCandidatePipe } from '../../pipes/proposal-reconciliation-candidate.pipe';
import { futureGraph, graphChangeSet } from './future-graph';
import { isEqual } from 'lodash';
import {
  projectReconciliationContent,
  manualReconciliationPatch,
} from './proposal-reconciliation-content';
import {
  parseFutureRevisionMutation,
  readFutureRevision,
  validateFutureRevision,
} from './future-revision';
import {
  materializeFutureRevision,
  type FutureTarget,
} from './future-revision-materializer';
import type {
  FutureRevisionAuthoring,
  FutureRevisionMutation,
} from 'src/generated';
import { ProposalReconciliationGroupService } from './proposal-reconciliation-group.service';
import {
  ProposalReconciliationService,
  type ReconciliationProvenance,
} from './proposal-reconciliation.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProposalType as PrismaProposalType,
  ProposalAction as PrismaProposalAction,
  ProposalStatus as PrismaProposalStatus,
  TargetEntityType as PrismaTargetEntityType,
} from '@prisma/client';
import type { Proposal } from '@prisma/client';
import { randomUUID } from 'crypto';
import { withApiSpan } from 'src/telemetry/api-tracing';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import {
  OrganizationId,
  ProjectId,
  UserId,
  MessageId,
  ConversationId,
} from 'src/types';
import {
  PROPOSAL_RESPONSE_RELATIONS_INCLUDE,
  type ProposalWithResponseRelations,
  type TypedProposalResponse,
} from './proposal.types';
import {
  CreateProposalDto,
  PaginatedProposalsDto,
  QueryProposalsDto,
  resolveProposalWindow,
  UpdateProposalDto,
} from './proposal.dto';
import type { StampedCreateProposalDto } from './proposal.types';
import type { Influence } from 'src/generated';
import type {
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import {
  EntityType as GeneratedEntityType,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
} from 'src/generated';
import {
  currentWritingSessionId,
  EvalOutputAdmissionService,
} from '../eval/eval-output-admission.service';
import { ProposalValidationEngine } from './proposal-validation.engine';
import {
  assertWorkItemChangeSetStructurallyValid,
  assertWorkflowProposalLinksStructurallyValid,
} from './proposal-validation.engine';
import type { ProposalValidationResult } from './proposal-validation.types';
import {
  rootChildrenView,
  WorkItemChangeSetProjectorService,
} from './work-item-change-set-projector.service';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import {
  NOOP_POST_COMMIT,
  PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS,
  ProposalApprovalService,
  type PostCommitRunner,
} from './proposal-approval.service';
import { buildOriginInfluence } from './origin-influence';
import {
  resolveProposalTitle,
  snapshotEdgeTitles,
  snapshotInfluenceReferences,
  type ProposalReferenceMetadata,
} from './proposal-title-snapshot';
import { evaluatePermissions } from './permission-evaluation';
import { storeTracksAttachmentAsProposalEdge } from './proposal-tracking-attachment';
import type { PreparedChangeSetProjection } from './work-item-change-set-materializer.service';
import {
  mapProposalResponse,
  mapProposalResponses,
} from './proposal-response-policy';
import { resolvePermissionEvaluationContext } from './permission-evaluation-context';
import {
  PendingEdgeService,
  type MaterializedProposalEdge,
  type MaterializableEdge,
} from './pending-edge.service';
import { evaluateSupersedeInvariant } from './supersede-invariant';
import {
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from './project-approval-policy.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';
import { assertNoRawTracksDeclaration } from './proposal-tracking-attachment';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from './proposal-visibility';

type ApplyOnCreatePreparation = {
  prepared: PreparedChangeSetProjection | null;
  mintedIds: readonly string[];
};

function replayMintedIds(ids: readonly string[]): () => string {
  let next = 0;
  return () => {
    const id = ids[next++];
    if (id === undefined) {
      throw new ConflictException(
        'Proposal requirements changed while it was being created; retry the request.',
      );
    }
    return id;
  };
}

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  private static readonly MAX_PAGE_SIZE = 100;
  private static readonly MAX_BATCH_SIZE = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationEngine: ProposalValidationEngine,
    private readonly workItemChangeSetProjector: WorkItemChangeSetProjectorService,
    private readonly approvalService: ProposalApprovalService,
    private readonly pendingEdgeService: PendingEdgeService,
    private readonly projectApprovalPolicyService: ProjectApprovalPolicyService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly projectAccess: ProjectAccessService,
    private readonly reconciliation: ProposalReconciliationService,
    private readonly reconciliationGroups: ProposalReconciliationGroupService,
    @Optional()
    private readonly evalOutputAdmission: EvalOutputAdmissionService = new EvalOutputAdmissionService(),
    @Optional() private readonly messages?: MessageService,
  ) {}

  private async assertMayAuthorProposals(
    projectId: ProjectId,
    userId: UserId,
    dtos: readonly Pick<StampedCreateProposalDto, 'targetEntityType'>[],
  ): Promise<void> {
    if (!dtos.some((dto) => dto.targetEntityType === 'WORK_ITEM_TYPE')) return;
    await this.projectAccess.assertProjectRole(
      projectId,
      userId,
      'manageWorkItemTypes',
    );
  }

  private async resolveWorkItemRoleWhere(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemRole: WorkItemTypeRole,
  ): Promise<Prisma.ProposalWhereInput> {
    const activeDefinitions = this.workItemTypeRegistry.getDefinitions(
      projectId,
      WorkItemTypeLifecycleStatus.Active,
    );
    const taskTypeKeys = new Set(
      activeDefinitions
        .filter(({ definition }) => definition.role === workItemRole)
        .map(({ definition }) => definition.key),
    );

    if (workItemRole === WorkItemTypeRole.ProjectInfo) {
      taskTypeKeys.add(WORK_ITEM_TYPE_KEYS.Plan);
    }

    const resolvedTaskTypeKeys = [...taskTypeKeys].sort();
    const tasks =
      resolvedTaskTypeKeys.length === 0
        ? []
        : await this.prisma.db.task.findMany({
            where: {
              organizationId,
              projectId,
              type: { in: resolvedTaskTypeKeys },
            },
            select: { id: true, type: true },
          });

    const population: Prisma.ProposalWhereInput[] =
      resolvedTaskTypeKeys.flatMap((typeKey) => {
        const targetIds = tasks
          .filter(({ type }) => type === typeKey)
          .map(({ id }) => id);
        const predicates: Prisma.ProposalWhereInput[] = [
          {
            targetEntityType: PrismaTargetEntityType.TASK,
            action: PrismaProposalAction.CREATE,
            updates: { path: ['type'], equals: typeKey },
          },
        ];

        if (targetIds.length > 0) {
          predicates.push({
            targetEntityType: PrismaTargetEntityType.TASK,
            targetEntityId: { in: targetIds },
            action: {
              in: [PrismaProposalAction.UPDATE, PrismaProposalAction.DELETE],
            },
          });
        }

        return predicates;
      });

    if (workItemRole === WorkItemTypeRole.ProjectInfo) {
      population.push({
        targetEntityType: PrismaTargetEntityType.DESIGN_DOC,
      });
    }

    return { OR: population };
  }

  private async prepareTaskMutationRequirements(
    dto: CreateProposalDto,
    organizationId: OrganizationId,
    projectId: ProjectId,
    db: AnyTransactionClient,
    mintUuid?: () => string,
  ): Promise<CreateProposalDto> {
    const preparer = (
      this.validationEngine as unknown as {
        prepareTaskMutationRequirements?: (
          dto: CreateProposalDto,
          organizationId: OrganizationId,
          projectId: ProjectId,
          db: AnyTransactionClient,
          mintUuid?: () => string,
        ) => Promise<CreateProposalDto>;
      }
    ).prepareTaskMutationRequirements;
    // Isolated service tests may provide a narrow validation double. The
    // production validation engine always supplies the shared preparer.
    return typeof preparer === 'function'
      ? preparer.call(
          this.validationEngine,
          dto,
          organizationId,
          projectId,
          db,
          mintUuid,
        )
      : dto;
  }

  async create(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    dto: StampedCreateProposalDto,
    reconciliationProvenance?: ReconciliationProvenance,
  ): Promise<TypedProposalResponse> {
    return withApiSpan('proposal.create', () =>
      this.createWithReservedId(
        organizationId,
        projectId,
        userId,
        dto,
        undefined,
        reconciliationProvenance,
      ),
    );
  }

  async createWithReservedId(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    dto: StampedCreateProposalDto,
    reservedId?: string,
    reconciliationProvenance?: ReconciliationProvenance,
  ): Promise<TypedProposalResponse> {
    await this.assertMayAuthorProposals(projectId, userId, [dto]);
    // Provider-owned operation receipts may reserve a proposal identity before
    // calling this boundary, allowing recovery after the create response is lost.
    if (reservedId) {
      const existing = await this.prisma.db.proposal.findFirst({
        where: {
          id: reservedId,
          organizationId,
          projectId,
          requestorId: userId,
        },
      });
      if (existing) return this.findOne(reservedId, organizationId, projectId);
    }
    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }
    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    // Eval output and reconciliation candidates are never applied on create,
    // so there is nothing to project up front.
    const applyOnCreate =
      reconciliationProvenance ||
      (await this.isEvalWriter(organizationId, projectId))
        ? null
        : await this.prepareApplyOnCreate(
            organizationId,
            projectId,
            userId,
            dto,
            projectPolicy,
          );

    const immediatelyMaterializedEdges: MaterializedProposalEdge[] = [];
    let result: {
      proposal: ProposalWithResponseRelations;
      materializableEdges: MaterializableEdge[];
      runPostCommit: PostCommitRunner;
      genericChangeSetReady: boolean;
      responseRequiredApprovals?: number;
      immediatelyMaterializedEdges?: MaterializedProposalEdge[];
    };
    try {
      result = await withApiSpan('proposal.create.transaction', () =>
        this.prisma.db.$transaction(async (tx) => {
          const stampedInput = await this.applyOriginInfluence(tx, dto);
          const admission = await withApiSpan(
            'proposal.authoring.validate',
            () =>
              this.validationEngine.assertAuthoringCandidatesValid({
                proposals: [stampedInput],
                context: { organizationId, projectId, db: tx },
              }),
          );
          this.assertProposalContextSource(stampedInput);
          this.assertProposalTitleForCreate(stampedInput);
          this.assertSupersedeInvariant(stampedInput);
          assertWorkflowProposalLinksStructurallyValid(stampedInput);
          assertWorkItemChangeSetStructurallyValid(stampedInput);
          assertNoRawTracksDeclaration(stampedInput);
          if (stampedInput.influences !== undefined) {
            this.validateInfluenceInputs(stampedInput.influences);
          }
          const stampedDto = admission.candidates[0]!.candidate;
          const metadata = admission.metadata;
          if (
            stampedDto.action !== 'CREATE' &&
            stampedDto.targetEntityType !== 'WORK_ITEM_TYPE' &&
            stampedDto.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE'
          ) {
            await this.validateTargetEntity(
              stampedDto.targetEntityId,
              stampedDto.targetEntityType,
              organizationId,
              projectId,
              tx,
              metadata,
            );
          }
          await this.validationEngine.assertTaskMutationAuthoringValid(
            admission.candidates[0]!,
            organizationId,
            projectId,
            tx,
          );

          const preparedDto = await this.prepareTaskMutationRequirements(
            stampedDto,
            organizationId,
            projectId,
            tx,
            applyOnCreate
              ? replayMintedIds(applyOnCreate.mintedIds)
              : undefined,
          );
          const snapshottedDto = await this.snapshotEntityTitles(
            tx,
            organizationId,
            preparedDto,
            metadata,
          );

          const title = await resolveProposalTitle({
            db: tx,
            organizationId,
            action: snapshottedDto.action,
            targetEntityType: snapshottedDto.targetEntityType,
            targetEntityId: snapshottedDto.targetEntityId,
            callerTitle: snapshottedDto.title,
            metadata,
          });
          const { stamp: evalStamp, data: evalData } =
            await this.admitEvalProposal(
              tx,
              organizationId,
              projectId,
              snapshottedDto,
            );
          const targetLastAppliedProposalId =
            await this.snapshotTargetLastAppliedProposalId(tx, snapshottedDto);
          const created = await tx.proposal.create({
            data: {
              ...this.buildCreateData(
                organizationId,
                projectId,
                userId,
                snapshottedDto,
                title,
                targetLastAppliedProposalId,
              ),
              ...evalData,
              ...(reservedId ? { id: reservedId } : {}),
            },
            include: PROPOSAL_RESPONSE_RELATIONS_INCLUDE,
          });

          await this.reconciliation.captureAuthoring(
            tx,
            created,
            reconciliationProvenance,
          );
          const applied =
            evalStamp.applicationEligible && !reconciliationProvenance
              ? await this.maybeApplyOnCreate(
                  tx,
                  created,
                  organizationId,
                  projectId,
                  snapshottedDto,
                  projectPolicy,
                  applyOnCreate,
                  (edge) => immediatelyMaterializedEdges.push(edge),
                )
              : null;
          if (applied?.immediatelyMaterializedEdges) {
            immediatelyMaterializedEdges.push(
              ...applied.immediatelyMaterializedEdges.filter(
                (edge) =>
                  !immediatelyMaterializedEdges.some(
                    (created) => created.edgeId === edge.edgeId,
                  ),
              ),
            );
          }
          return (
            applied ?? {
              proposal: created,
              materializableEdges: [],
              runPostCommit: NOOP_POST_COMMIT,
              genericChangeSetReady: false,
            }
          );
        }, PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS),
      );
    } catch (error) {
      await this.pendingEdgeService.rollbackMaterializedEdges(
        organizationId,
        projectId,
        immediatelyMaterializedEdges,
        'Rolling back an immediately materialized proposal edge because proposal creation failed.',
      );
      throw error;
    }

    if (result.materializableEdges.length > 0) {
      await this.pendingEdgeService.materializeEdges(
        organizationId,
        projectId,
        result.materializableEdges,
        result.proposal.conversationId,
      );
    }

    await withApiSpan('proposal.post_commit', () => result.runPostCommit());

    if (result.genericChangeSetReady) {
      const materialized =
        await this.approvalService.materializeGenericWorkItemChangeSet({
          proposalId: result.proposal.id,
          organizationId,
          projectId,
        });
      result.proposal = materialized.proposal;
    }

    this.logger.log('Proposal created', {
      id: result.proposal.id,
      organizationId,
      projectId,
      type: dto.type,
      action: dto.action,
      targetEntityType: dto.targetEntityType,
      status: result.proposal.status,
    });

    return withApiSpan('proposal.response.map', () =>
      this.toResponseDto(
        result.proposal,
        projectPolicy,
        result.responseRequiredApprovals,
      ),
    );
  }

  async reconciliationReviewState(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ) {
    return this.reconciliationState(id, organizationId, projectId, true);
  }

  /** Approved links may point at an older revision; recovery always uses the stored future. */
  async currentReconciliationProposal(
    proposal: Proposal,
    tx: AnyTransactionClient = this.prisma.db,
  ): Promise<Proposal> {
    if (
      proposal.action !== 'VERSIONED_UPDATE' ||
      proposal.status !== 'APPROVED'
    )
      return proposal;
    const mutation = parseFutureRevisionMutation(proposal.updates);
    const future = await tx.proposalFuture.findFirst({
      where: {
        id: mutation.futureId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
      },
    });
    if (!future || future.latestProposalId === proposal.id) return proposal;
    this.logger.debug(
      `Resolving reconciliation from approved proposal ${proposal.id} to latest future revision ${future.revision}`,
    );
    const latest = await tx.proposal.findFirst({
      where: {
        id: future.latestProposalId,
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
      },
    });
    if (!latest)
      throw new ConflictException('The latest reviewed future is unavailable.');
    return latest;
  }

  async reconciliationState(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    prepareReview = false,
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      if (prepareReview)
        await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${id} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
      const proposal = await tx.proposal.findFirst({
        where: { id, organizationId, projectId },
        include: { groupMembership: true },
      });
      if (!proposal) throw new NotFoundException('Proposal not found');
      if (proposal.action === 'VERSIONED_UPDATE') {
        const latest = await this.currentReconciliationProposal(proposal, tx);
        const mutation = parseFutureRevisionMutation(latest.updates);
        if (mutation.operation === 'REVISE')
          return this.reconciliation.stateForFuture(
            tx,
            latest,
            mutation.baseline,
          );
      }
      return prepareReview
        ? this.prepareStandaloneReview(tx, proposal)
        : this.reconciliation.state(tx, proposal);
    });
  }

  private async prepareStandaloneReview(
    tx: AnyTransactionClient,
    proposal: Proposal & { groupMembership: unknown | null },
  ): Promise<import('src/generated').ProposalReconciliationState> {
    const state = await this.reconciliation.state(tx, proposal);
    if (
      proposal.action !== 'UPDATE' ||
      proposal.groupMembership ||
      proposal.status !== 'DRAFT' ||
      state.status !== 'RECONCILIATION_REQUIRED'
    )
      return state;
    const merged = this.reconciliation.prepareMerge(proposal, state);
    if (state.overlaps.length) return state;
    if (merged.kind !== 'MERGED')
      return {
        ...state,
        status: 'AGENT_FIX_REQUIRED',
        conflictingPaths: [...merged.conflictingPaths],
      };
    const currentBasis = state.currentBases[0];
    if (!currentBasis) return state;
    const proposedResult = projectReconciliationContent(
      currentBasis.content as Prisma.JsonObject,
      merged.updates,
    );
    const updated = await tx.proposal.update({
      where: { id: proposal.id },
      data: { updates: merged.updates as Prisma.InputJsonValue },
    });
    await this.reconciliation.appendRevision(tx, {
      proposalId: proposal.id,
      previousRevisionId: state.candidateRevisionId ?? null,
      source: 'MERGE',
      bases: state.currentBases,
      proposedResult,
      intent: state.revisions.at(-1)!.intent,
    });
    return this.reconciliation.state(tx, updated);
  }

  private async publishProposalReviewChanged(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<void> {
    if (!this.messages) return;
    const references: Array<{ messageId: string }> =
      await tx.messageProposalReference.findMany({
        where: { proposalId: proposal.id },
        select: { messageId: true },
      });
    const ids = [
      ...new Set([
        ...references.map((ref) => ref.messageId),
        ...(proposal.messageId ? [proposal.messageId] : []),
      ]),
    ];
    for (const id of ids) {
      const message = await tx.message.update({
        where: { id },
        data: { contentUpdatedAt: new Date() },
      });
      await this.messages.publishMessageUpdatedEvent(tx, {
        messageId: id as MessageId,
        conversationId: message.conversationId as ConversationId,
        organizationId: proposal.organizationId as OrganizationId,
        projectId: proposal.projectId as ProjectId,
        update: {
          data: message.data as import('src/generated').SystemMessageData,
        },
      });
    }
  }

  private async publishSuggestionDecisions(
    tx: AnyTransactionClient,
    proposal: Proposal,
  ): Promise<void> {
    if (!this.messages) return;
    const state = await this.reconciliation.stateForFuture(
      tx,
      proposal,
      (() => {
        const mutation = parseFutureRevisionMutation(proposal.updates);
        if (mutation.operation !== 'REVISE')
          throw new ConflictException(
            'Cancelled future has no suggestion basis.',
          );
        return mutation.baseline;
      })(),
    );
    for (const suggestion of state.suggestions ?? []) {
      if (!suggestion.messageId || suggestion.status === 'PENDING') continue;
      const message = await tx.message.findUniqueOrThrow({
        where: { id: suggestion.messageId },
      });
      const data = {
        type: 'AGENT',
        response: 'Suggested reconciliation',
        proposalSuggestion: suggestion,
      } satisfies import('src/generated').SystemMessageData;
      await tx.message.update({
        where: { id: message.id },
        data: {
          data: data as unknown as Prisma.InputJsonValue,
          contentUpdatedAt: new Date(),
        },
      });
      await this.messages.publishMessageUpdatedEvent(tx, {
        messageId: message.id as MessageId,
        conversationId: message.conversationId as ConversationId,
        organizationId: proposal.organizationId as OrganizationId,
        projectId: proposal.projectId as ProjectId,
        update: { data },
      });
    }
  }

  async reconcile(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    user: AuthenticatedUser,
    input: import('src/generated').CreateProposalReconciliationCandidate,
    requestorContext: StampedCreateProposalDto['requestorContext'],
    agentSessionId?: string,
  ): Promise<import('src/generated').ProposalReconciliationState> {
    if ('suggestionId' in input) {
      const suggestion =
        await this.prisma.db.proposalReconciliationSuggestion.findFirst({
          where: { id: input.suggestionId, proposalId: id },
        });
      const owner = await this.prisma.db.proposal.findFirst({
        where: { id, organizationId, projectId },
      });
      if (!suggestion || !owner)
        throw new NotFoundException('Suggestion not found');
      if (suggestion.legacyProposalId)
        throw new ConflictException(
          'This suggestion is retired and kept only in history.',
        );
      if (agentSessionId)
        throw new BadRequestException('Suggestion decisions require a user.');
      if (input.method === 'REJECT_SUGGESTION') {
        await this.prisma.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${id} FOR UPDATE`;
          await tx.proposalReconciliationSuggestion.updateMany({
            where: { id: suggestion.id, status: 'PENDING' },
            data: { status: 'REJECTED' },
          });
          await this.publishSuggestionDecisions(tx, owner);
        });
        return this.reconciliationState(id, organizationId, projectId);
      }
      const candidate = new ProposalReconciliationCandidatePipe().transform(
        suggestion.request,
      );
      if (candidate.method !== 'AGENT_FIX')
        throw new ConflictException(
          'The saved suggestion is not an agent candidate.',
        );
      return this.reconcileFuture(
        owner,
        await this.reconciliationState(id, organizationId, projectId),
        organizationId,
        projectId,
        user,
        candidate,
        requestorContext,
        suggestion.id,
      );
    }
    const found = await this.prisma.db.proposal.findFirst({
      where: { id, organizationId, projectId },
      include: { groupMembership: true },
    });
    if (!found) throw new NotFoundException('Proposal not found');
    const original = {
      ...(await this.currentReconciliationProposal(found)),
      groupMembership: found.groupMembership,
    };
    const state =
      input.method === 'MERGE' &&
      original.action === 'UPDATE' &&
      !original.groupMembership
        ? await this.reconciliationReviewState(id, organizationId, projectId)
        : await this.reconciliationState(id, organizationId, projectId);
    if (
      input.method === 'MERGE' &&
      original.action === 'UPDATE' &&
      !original.groupMembership
    )
      return state;
    if (
      input.method === 'AGENT_FIX' &&
      original.action === 'VERSIONED_UPDATE'
    ) {
      if (!agentSessionId)
        throw new BadRequestException(
          'An authorized refiner session is required.',
        );
      const session = await this.prisma.db.agentSession.findFirst({
        where: {
          id: agentSessionId,
          organizationId,
          projectId,
          userId: user.userId,
          entityId: id,
          entityType: 'PROPOSAL',
          type: 'PROPOSAL_REFINING',
        },
      });
      if (!session?.conversationId || !this.messages)
        throw new BadRequestException(
          'The refiner conversation is unavailable.',
        );
      const conversationId = session.conversationId as ConversationId;
      await this.prisma.db.$transaction(async (tx) => {
        const selectedMutation = parseFutureRevisionMutation(original.updates);
        await tx.$queryRaw`SELECT id FROM proposal_futures WHERE id = ${selectedMutation.futureId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;

        await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${original.id} FOR UPDATE`;
        const current = await tx.proposal.findUniqueOrThrow({
          where: { id: original.id },
        });
        const mutation = parseFutureRevisionMutation(current.updates);
        if (mutation.operation !== 'REVISE')
          throw new ConflictException(
            'Cancelled futures cannot receive suggestions.',
          );
        const latest = await this.reconciliation.stateForFuture(
          tx,
          current,
          mutation.baseline,
        );
        if (
          !input.expectedCandidateRevisionId ||
          input.expectedCandidateRevisionId !== latest.candidateRevisionId
        )
          throw new ConflictException(
            'The proposal changed. Prepare a new suggestion.',
          );
        if (latest.futureRevision !== input.expectedFutureRevision)
          throw new ConflictException(
            'The future changed. Prepare a new suggestion.',
          );
        if (
          current.targetEntityType !== 'TASK' &&
          current.targetEntityType !== 'DESIGN_DOC'
        )
          throw new BadRequestException(
            'A future requires a task or design document.',
          );
        this.reconciliation.assertFutureReviewedBasisCurrent(
          input.expectedCurrentBases,
          latest.currentBases,
          current.targetEntityType,
        );
        const content = await this.reconciliation.currentFutureContent({
          organizationId,
          projectId,
          targetEntityType: current.targetEntityType,
          targetEntityId: current.targetEntityId,
        });
        const candidate = parseFutureRevisionMutation({
          ...mutation,
          expectedRevision: latest.futureRevision,
          baseline: {
            kind: 'LIVE',
            revision: latest.currentBases[0]!.version,
            content,
          },
          result: input.proposedResult,
        });
        await validateFutureRevision(
          tx,
          this.workItemTypeRegistry,
          {
            targetEntityId: current.targetEntityId,
            targetEntityType: current.targetEntityType,
            updates: candidate,
          },
          organizationId,
          projectId,
        );
        await tx.proposalReconciliationSuggestion.updateMany({
          where: { proposalId: current.id, agentSessionId, status: 'PENDING' },
          data: { status: 'SUPERSEDED' },
        });
        await this.publishSuggestionDecisions(tx, current);
        const suggestion = await tx.proposalReconciliationSuggestion.create({
          data: {
            proposalId: current.id,
            candidateRevisionId: input.expectedCandidateRevisionId,
            agentSessionId,
            request: input as unknown as Prisma.InputJsonValue,
          },
        });
        const message = await this.messages!.addMessageInTransaction(
          tx,
          {
            conversationId,
            projectId,
            userId: user.userId,
            type: 'SYSTEM',
            data: {
              type: 'AGENT',
              response:
                'Review this suggested reconciliation. Accepting replaces proposal content and clears approvals; live content stays unchanged.',
              proposalSuggestion: {
                id: suggestion.id,
                proposalId: current.id,
                organizationId,
                projectId,
                status: 'PENDING',
                candidateRevisionId: suggestion.candidateRevisionId,
                proposedResult: input.proposedResult,
                createdAt: suggestion.createdAt.toISOString(),
              },
            },
          },
          organizationId,
          'proposal-reconciliation-suggestion',
        );
        await tx.proposalReconciliationSuggestion.update({
          where: { id: suggestion.id },
          data: { messageId: message.id },
        });
      });
      return this.reconciliationState(original.id, organizationId, projectId);
    }
    if (original.action === 'VERSIONED_UPDATE')
      return this.reconcileFuture(
        original,
        state,
        organizationId,
        projectId,
        user,
        input,
        requestorContext,
      );
    let updates: import('src/generated').ProposalUpdates;
    if (input.method === 'MERGE') {
      const result = this.reconciliation.prepareMerge(original, state);
      if (result.kind !== 'MERGED') {
        return {
          ...state,
          status: 'AGENT_FIX_REQUIRED',
          conflictingPaths: [...result.conflictingPaths],
        };
      }
      updates = result.updates;
    } else {
      this.reconciliation.assertReviewedBasisCurrent(
        input.expectedCurrentBases!,
        state.currentBases,
        id,
      );
      updates =
        input.method === 'MANUAL'
          ? manualReconciliationPatch(
              state.currentBases[0]!.content,
              input.proposedResult!,
              original.targetEntityType,
            )
          : input.proposedResult!;
    }
    const provenance: ReconciliationProvenance = {
      source: input.method,
      previousRevisionId: state.candidateRevisionId ?? null,
      expectedBases: state.currentBases,
    };
    if (original.groupMembership) {
      const replacement = await this.reconciliationGroups.replace({
        groupId: original.groupMembership.groupId,
        proposalId: id,
        organizationId,
        projectId,
        user,
        updates,
        provenance,
        requestorContext,
      });
      return {
        ...(await this.reconciliationState(
          replacement.replacementProposalId,
          organizationId,
          projectId,
        )),
        ...replacement,
      };
    }
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${id} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
      const current = await tx.proposal.findFirst({
        where: { id, organizationId, projectId },
        include: { groupMembership: true },
      });
      if (!current) throw new NotFoundException('Proposal not found');
      if (current.status !== 'DRAFT' || current.groupMembership)
        throw new ConflictException(
          'The proposal is no longer available for standalone reconciliation.',
        );
      const latest = await this.reconciliation.state(tx, current);
      if (latest.candidateRevisionId !== state.candidateRevisionId)
        throw new ConflictException(
          'The proposal changed. Review its current candidate.',
        );
      this.reconciliation.assertReviewedBasisCurrent(
        state.currentBases,
        latest.currentBases,
        id,
      );
      if (current.eli5 === null)
        throw new BadRequestException(
          'An ELI5 explanation is required to reconcile this proposal.',
        );
      const candidate = {
        type: current.type,
        action: current.action,
        targetEntityId: current.targetEntityId,
        targetEntityType: current.targetEntityType,
        title: current.title,
        eli5: current.eli5,
        updates,
        edges:
          (current.edges as unknown as CreateProposalDto['edges']) ?? undefined,
        requestorContext,
      } satisfies CreateProposalDto;
      const admission =
        await this.validationEngine.assertAuthoringCandidatesValid({
          proposals: [candidate],
          context: { organizationId, projectId, db: tx },
        });
      await this.validationEngine.assertTaskMutationAuthoringValid(
        admission.candidates[0]!,
        organizationId,
        projectId,
        tx,
      );
      const prepared = await this.prepareTaskMutationRequirements(
        candidate,
        organizationId,
        projectId,
        tx,
      );
      await this.validationEngine.assertTaskMutationAuthoringValid(
        prepared,
        organizationId,
        projectId,
        tx,
      );
      await this.validationEngine.assertPlanStageProposalTopologyValid(
        [{ proposalId: id, proposal: prepared }],
        organizationId,
        projectId,
      );
      const updated = await tx.proposal.update({
        where: { id },
        data: { updates: prepared.updates as Prisma.InputJsonValue },
      });
      await this.reconciliation.captureAuthoring(tx, updated, {
        ...provenance,
        preserveVotes:
          input.method === 'MERGE' ||
          isEqual(current.updates, prepared.updates),
      });
      return this.reconciliation.state(tx, updated);
    });
  }

  /** Turns an authored future delta into the complete mutation ordinary creation validates. */
  async materializeFutureRevision(
    target: FutureTarget,
    authoring: FutureRevisionAuthoring,
  ): Promise<FutureRevisionMutation> {
    this.logger.log(
      `Materializing future ${authoring.futureId} (${authoring.operation}) for ${target.targetEntityType} ${target.targetEntityId}`,
    );
    return this.prisma.db.$transaction((tx) =>
      materializeFutureRevision(
        tx,
        this.reconciliation.futureMaterializationPorts(),
        target,
        authoring,
      ),
    );
  }

  private async reconcileFuture(
    original: Proposal,
    state: import('src/generated').ProposalReconciliationState,
    organizationId: OrganizationId,
    projectId: ProjectId,
    user: AuthenticatedUser,
    input: Exclude<
      import('src/generated').CreateProposalReconciliationCandidate,
      import('src/generated').ProposalReconciliationSuggestionDecision
    >,
    requestorContext: StampedCreateProposalDto['requestorContext'],
    suggestionId?: string,
  ): Promise<import('src/generated').ProposalReconciliationState> {
    if (state.status === 'NOT_APPLICABLE')
      throw new ConflictException(
        'This future is no longer available for reconciliation.',
      );
    if (input.method === 'MERGE')
      return { ...state, status: 'AGENT_FIX_REQUIRED' };
    if (
      original.targetEntityType !== 'TASK' &&
      original.targetEntityType !== 'DESIGN_DOC'
    )
      throw new BadRequestException(
        'Future reconciliation requires a task or design document target.',
      );
    this.logger.debug(
      `Preparing ${input.method} future reconciliation for proposal ${original.id}`,
    );
    const authoredMutation = parseFutureRevisionMutation(original.updates);
    if (authoredMutation.operation !== 'REVISE')
      throw new BadRequestException('Cancelled futures cannot be reconciled.');
    const expectedCurrentBases = input.expectedCurrentBases!;
    this.reconciliation.assertFutureReviewedBasisCurrent(
      expectedCurrentBases,
      state.currentBases,
      original.targetEntityType,
    );
    const storedFuture = await this.prisma.db.proposalFuture.findFirst({
      where: { id: authoredMutation.futureId, organizationId, projectId },
    });
    if (
      !storedFuture &&
      (original.status !== 'DRAFT' || authoredMutation.expectedRevision !== 0)
    )
      throw new ConflictException('The reviewed future is unavailable.');
    const future = storedFuture
      ? await this.prisma.db.$transaction((tx) =>
          readFutureRevision(
            tx,
            this.workItemTypeRegistry,
            authoredMutation.futureId,
            organizationId,
            projectId,
          ),
        )
      : {
          id: authoredMutation.futureId,
          revision: 0,
          outcome: 'STAGED',
          latestProposalId: original.id,
          dependencies: authoredMutation.dependencies,
        };
    if (input.expectedFutureRevision !== future.revision) {
      this.logger.warn(
        `Rejected stale future reconciliation for ${future.id}: expected revision ${input.expectedFutureRevision}, current revision ${future.revision}`,
      );
      throw new ConflictException(
        'The future revision changed. Refresh before reconciling.',
      );
    }
    if (future.outcome !== 'STAGED')
      throw new ConflictException('Only unapplied futures can be reconciled.');
    const sourceMutation = parseFutureRevisionMutation(original.updates);
    if (
      original.status === 'APPROVED' &&
      future.latestProposalId !== original.id
    )
      throw new ConflictException(
        'The approved future changed. Refresh before reconciling.',
      );
    if (
      sourceMutation.operation === 'REVISE' &&
      original.status !== 'APPROVED' &&
      sourceMutation.expectedRevision !== future.revision
    )
      throw new ConflictException(
        'The future revision changed. Refresh before reconciling.',
      );
    const currentContent = await this.reconciliation.currentFutureContent({
      organizationId,
      projectId,
      targetEntityType: original.targetEntityType,
      targetEntityId: original.targetEntityId,
    });
    const currentBasis = state.currentBases[0];
    if (!currentBasis)
      throw new ConflictException(
        'The future target has no current reconciliation basis.',
      );
    const updates = parseFutureRevisionMutation({
      operation: 'REVISE',
      futureId: future.id,
      expectedRevision: future.revision,
      baseline: {
        kind: 'LIVE',
        revision: currentBasis.version,
        content: currentContent,
      },
      result: input.proposedResult!,
      dependencies: authoredMutation.dependencies,
    });
    if (updates.operation !== 'REVISE')
      throw new BadRequestException('Reconciliation must revise a future.');
    {
      const before = futureGraph(updates.baseline.content);
      const after = futureGraph(updates.result);
      if (before && after)
        updates.graphChangeSet = graphChangeSet(before, after);
    }
    const provenance: ReconciliationProvenance = {
      source: input.method,
      previousRevisionId: state.candidateRevisionId ?? null,
      expectedBases: state.currentBases,
    };
    return this.prisma.db.$transaction(async (tx) => {
      // Match Apply's lock order: future, proposal, then authoritative target.
      await tx.$queryRaw`SELECT id FROM proposal_futures WHERE id = ${future.id} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM proposals WHERE id = ${original.id} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
      if (suggestionId) {
        const suggestion = await tx.proposalReconciliationSuggestion.findFirst({
          where: {
            id: suggestionId,
            proposalId: original.id,
            status: 'PENDING',
          },
        });
        if (!suggestion)
          throw new ConflictException('This suggestion is no longer pending.');
      }
      const current = await tx.proposal.findFirst({
        where: { id: original.id, organizationId, projectId },
        include: { groupMembership: true },
      });
      if (!current || current.status === 'REJECTED' || current.groupMembership)
        throw new ConflictException(
          'This proposal is no longer available for standalone reconciliation.',
        );
      const currentMutation = parseFutureRevisionMutation(current.updates);
      if (currentMutation.operation !== 'REVISE')
        throw new ConflictException('Cancelled futures cannot be reconciled.');
      const latest = await this.reconciliation.stateForFuture(
        tx,
        current,
        currentMutation.baseline,
      );
      if (
        !input.expectedCandidateRevisionId ||
        input.expectedCandidateRevisionId !== latest.candidateRevisionId
      )
        throw new ConflictException(
          'The proposal changed. Your edits have not been saved; review the current proposal.',
        );
      if (latest.futureRevision !== input.expectedFutureRevision)
        throw new ConflictException(
          'The reviewed future changed. Your edits have not been saved.',
        );
      this.reconciliation.assertFutureReviewedBasisCurrent(
        expectedCurrentBases,
        latest.currentBases,
        original.targetEntityType as 'TASK' | 'DESIGN_DOC',
      );
      updates.dependencies = currentMutation.dependencies;
      await validateFutureRevision(
        tx,
        this.workItemTypeRegistry,
        {
          targetEntityId: current.targetEntityId,
          targetEntityType: current.targetEntityType,
          updates,
        },
        organizationId,
        projectId,
      );
      const updated = await tx.proposal.update({
        where: { id: current.id },
        data: {
          updates: updates as unknown as Prisma.InputJsonValue,
          status: 'DRAFT',
        },
      });
      // captureAuthoring retires votes before appending the new content version;
      // the database retains their attribution against the preceding version.
      await this.reconciliation.captureAuthoring(tx, updated, provenance);
      if (suggestionId)
        await tx.proposalReconciliationSuggestion.update({
          where: { id: suggestionId },
          data: { status: 'ACCEPTED' },
        });
      await tx.proposalReconciliationSuggestion.updateMany({
        where: { proposalId: current.id, status: 'PENDING' },
        data: { status: 'OUT_OF_DATE' },
      });
      await this.publishSuggestionDecisions(tx, updated);
      await this.publishProposalReviewChanged(tx, updated);
      this.logger.log(
        `Updated reconciliation content on proposal ${current.id}; fresh approvals required`,
      );
      return this.reconciliation.stateForFuture(tx, updated, updates.baseline);
    });
  }

  async findOne(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<TypedProposalResponse> {
    const proposal = await this.prisma.db.proposal.findFirst({
      where: { id, organizationId, projectId },
      include: {
        approvalRecords: true,
        workItemChangeSetMaterialization: { include: { checkpoints: true } },
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

    if (!proposal || proposal.groupMembership?.group.status === 'BUILDING') {
      throw new NotFoundException('Proposal not found');
    }

    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    return this.toResponseDto(proposal, projectPolicy);
  }

  async findFuture(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ) {
    return readFutureRevision(
      this.prisma.db,
      this.workItemTypeRegistry,
      id,
      organizationId,
      projectId,
    );
  }

  async findMany(
    organizationId: OrganizationId,
    projectId: ProjectId,
    query: QueryProposalsDto,
  ): Promise<PaginatedProposalsDto> {
    const limit = Math.min(query.limit ?? 20, ProposalService.MAX_PAGE_SIZE);
    const offset = query.offset ?? 0;
    const window = resolveProposalWindow(query);
    const workItemRoleWhere = query.workItemRole
      ? await this.resolveWorkItemRoleWhere(
          organizationId,
          projectId,
          query.workItemRole,
        )
      : undefined;

    this.logger.log('Listing proposals', {
      organizationId,
      projectId,
      limit,
      offset,
      filters: {
        type: query.type,
        action: query.action,
        status: query.status,
        targetEntityType: query.targetEntityType,
        targetEntityId: query.targetEntityId,
        validationSessionId: query.validationSessionId,
        workItemRole: query.workItemRole,
        windowStart: window?.windowStart.toISOString(),
        windowEnd: window?.windowEnd.toISOString(),
      },
    });

    const dependentFutures = query.completionDependencyId
      ? await this.prisma.db.proposalFuture.findMany({
          where: {
            organizationId,
            projectId,
            dependencies: {
              some: { targetEntityId: query.completionDependencyId },
            },
          },
          select: { latestProposalId: true },
        })
      : undefined;
    const where: Prisma.ProposalWhereInput = {
      ...(dependentFutures
        ? {
            id: {
              in: dependentFutures.map((future) => future.latestProposalId),
            },
          }
        : {}),
      organizationId,
      projectId,
      ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      ...(workItemRoleWhere ?? {}),
      ...(query.type ? { type: query.type as PrismaProposalType } : {}),
      ...(query.action ? { action: query.action as PrismaProposalAction } : {}),
      ...(query.status ? { status: query.status as PrismaProposalStatus } : {}),
      ...(query.targetEntityType
        ? {
            targetEntityType: query.targetEntityType as PrismaTargetEntityType,
          }
        : {}),
      ...(query.targetEntityId ? { targetEntityId: query.targetEntityId } : {}),
      ...(query.validationSessionId
        ? { validationSessionId: query.validationSessionId }
        : {}),
      ...(window
        ? { createdAt: { gte: window.windowStart, lt: window.windowEnd } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.proposal.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          approvalRecords: true,
          workItemChangeSetMaterialization: { include: { checkpoints: true } },
        },
      }),
      this.prisma.db.proposal.count({ where }),
    ]);

    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);

    return {
      data: await mapProposalResponses(this.prisma.db, data, projectPolicy, {
        omitUnresolvableTargets: true,
        workItemTypeRegistry: this.workItemTypeRegistry,
      }),
      total,
      limit,
      offset,
      ...(window
        ? {
            windowStart: window.windowStart.toISOString(),
            windowEnd: window.windowEnd.toISOString(),
          }
        : {}),
    };
  }

  async update(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: UpdateProposalDto,
    userId: UserId,
    userToken: string | null = null,
  ): Promise<TypedProposalResponse> {
    this.logger.log('Updating proposal', {
      id,
      organizationId,
      projectId,
      dtoKeys: Object.keys(dto),
    });
    this.logger.debug('Proposal update payload', { id, dto });

    // Proposals transitioning to APPROVED are handled by the approval
    // service, which atomically enacts the change in the same tx. Every
    // action (CREATE, UPDATE, DELETE) routes there — the approval service
    // runs its own authoritative enactability check inside the tx, so this
    // pre-check only needs to confirm the proposal is not already APPROVED
    // (the terminal-status guard below rejects that case).
    if (dto.status === 'APPROVED') {
      const existing = await this.prisma.db.proposal.findFirst({
        where: { id, organizationId, projectId },
        select: {
          status: true,
          action: true,
          groupMembership: { select: { groupId: true } },
        },
      });

      if (!existing) {
        this.logger.warn('Proposal not found during approval pre-check', {
          id,
          organizationId,
          projectId,
        });
        throw new NotFoundException('Proposal not found');
      }

      // Do not reject groupMembership here. APPROVED is a review decision,
      // and ProposalApprovalService.approve delegates grouped proposals to the
      // proposal-group decision service. The grouped-membership guard in the
      // ordinary update transaction below still blocks payload edits; adding
      // that guard here prevents every grouped approval from reaching review.

      if (existing.status === 'APPROVED' && !existing.groupMembership) {
        const result = await this.approvalService.retryApprovedGenericProposal({
          proposalId: id,
          organizationId,
          projectId,
        });
        return result.proposal;
      }

      if (existing.status !== 'APPROVED' || existing.groupMembership) {
        this.logger.log('Routing to approval service for proposal', {
          id,
          action: existing.action,
          currentStatus: existing.status,
        });
        const result = await this.approvalService.approve(
          id,
          organizationId,
          projectId,
          userId,
          userToken,
          dto.acknowledgeOutOfDate,
          dto.reviewedReconciliationRevisionId,
        );
        return result.proposal;
      }
    }

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.proposal.findFirst({
        where: { id, organizationId, projectId },
        include: {
          groupMembership: {
            select: {
              group: { select: { status: true } },
            },
          },
        },
      });

      if (!existing) {
        this.logger.warn('Proposal not found for update', {
          id,
          organizationId,
          projectId,
        });
        throw new NotFoundException('Proposal not found');
      }

      if (existing.status === 'REJECTED' || existing.status === 'APPROVED') {
        throw new BadRequestException(
          `Cannot update a proposal with terminal status: ${existing.status}`,
        );
      }

      if (existing.groupMembership) {
        throw new ConflictException(
          'Grouped proposals can only be changed through proposal-group authoring or review.',
        );
      }

      if (
        existing.targetEntityType === 'WORK_ITEM_TYPE' ||
        dto.targetEntityType === 'WORK_ITEM_TYPE'
      ) {
        await this.projectAccess.assertProjectRole(
          projectId,
          userId,
          'manageWorkItemTypes',
        );
      }

      if (
        existing.messageId !== null &&
        dto.conversationId !== undefined &&
        dto.conversationId !== existing.conversationId
      ) {
        this.logger.warn(
          'Rejected Conversation reassignment for a Message-owned Proposal',
          {
            id,
            existingConversationId: existing.conversationId,
            requestedConversationId: dto.conversationId,
            messageId: existing.messageId,
          },
        );
        throw new ConflictException(
          'A Message-owned Proposal cannot be moved to another Conversation',
        );
      }

      const updateData: Prisma.ProposalUpdateInput = {};

      if (dto.type !== undefined) {
        updateData.type = dto.type as PrismaProposalType;
      }
      if (dto.action !== undefined) {
        updateData.action = dto.action as PrismaProposalAction;
      }
      if (dto.status !== undefined) {
        updateData.status = dto.status as PrismaProposalStatus;
      }
      if (dto.targetEntityId !== undefined) {
        updateData.targetEntityId = dto.targetEntityId;
      }
      if (dto.targetEntityType !== undefined) {
        updateData.targetEntityType =
          dto.targetEntityType as PrismaTargetEntityType;
      }
      if (dto.updates !== undefined) {
        const existingUpdates =
          (existing.updates as Record<string, unknown>) ?? {};
        updateData.updates = {
          ...existingUpdates,
          ...(dto.updates as Record<string, unknown>),
        } as Prisma.InputJsonValue;
      }
      if (dto.requestorContext !== undefined) {
        updateData.requestorContext = dto.requestorContext
          ? (dto.requestorContext as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (dto.eli5 !== undefined) {
        updateData.eli5 = dto.eli5;
      }
      if (dto.influences !== undefined && dto.influences.length > 0) {
        this.validateInfluenceInputs(dto.influences);
        updateData.influences = [
          ...((existing.influences as unknown as Influence[] | null) ?? []),
          ...dto.influences,
        ] as unknown as Prisma.InputJsonValue;
      }
      if (dto.generatedWithVersion !== undefined) {
        updateData.generatedWithVersion = dto.generatedWithVersion;
      }
      if (dto.validationSessionId !== undefined) {
        updateData.validationSession = dto.validationSessionId
          ? { connect: { id: dto.validationSessionId } }
          : { disconnect: true };
      }
      if (dto.conversationId !== undefined) {
        updateData.conversation = dto.conversationId
          ? { connect: { id: dto.conversationId } }
          : { disconnect: true };
      }
      const updateDataKeys = Object.keys(updateData);
      if (updateDataKeys.length === 0) {
        this.logger.warn('Proposal update called with no effective changes', {
          id,
          dtoKeys: Object.keys(dto),
          existingStatus: existing.status,
        });
      } else {
        this.logger.debug('Proposal update fields', {
          id,
          fields: updateDataKeys,
          previousStatus: existing.status,
          newStatus: dto.status,
        });
      }

      const eli5 = dto.eli5 === undefined ? existing.eli5 : dto.eli5;
      if (eli5 === null) {
        throw new BadRequestException(
          'An ELI5 explanation is required to revise this proposal.',
        );
      }
      const candidateDto = {
        type: (dto.type ?? existing.type) as CreateProposalDto['type'],
        action: (dto.action ?? existing.action) as CreateProposalDto['action'],
        targetEntityId: dto.targetEntityId ?? existing.targetEntityId,
        targetEntityType: (dto.targetEntityType ??
          existing.targetEntityType) as CreateProposalDto['targetEntityType'],
        updates:
          dto.updates !== undefined
            ? {
                ...((existing.updates as Record<string, unknown>) ?? {}),
                ...(dto.updates as Record<string, unknown>),
              }
            : ((existing.updates as Record<string, unknown>) ?? {}),
        title: existing.title ?? undefined,
        eli5,
        edges:
          (existing.edges as unknown as CreateProposalDto['edges']) ??
          undefined,
        conversationId:
          dto.conversationId !== undefined
            ? (dto.conversationId ?? undefined)
            : (existing.conversationId ?? undefined),
        validationSessionId:
          dto.validationSessionId !== undefined
            ? (dto.validationSessionId ?? undefined)
            : (existing.validationSessionId ?? undefined),
        requestorContext:
          dto.requestorContext ??
          ((existing.requestorContext as CreateProposalDto['requestorContext']) ||
            undefined),
        influences: [
          ...((existing.influences as unknown as Influence[] | null) ?? []),
          ...(dto.influences ?? []),
        ],
      } satisfies CreateProposalDto;
      const admission =
        await this.validationEngine.assertAuthoringCandidatesValid({
          proposals: [candidateDto],
          context: { organizationId, projectId, db: tx },
        });
      await this.validationEngine.assertTaskMutationAuthoringValid(
        admission.candidates[0]!,
        organizationId,
        projectId,
        tx,
        { validatePlanStageTopology: false },
      );
      const preparedCandidateDto = await this.prepareTaskMutationRequirements(
        candidateDto,
        organizationId,
        projectId,
        tx,
      );
      if (preparedCandidateDto.updates !== candidateDto.updates) {
        updateData.updates =
          preparedCandidateDto.updates as Prisma.InputJsonValue;
      }
      await this.validationEngine.assertTaskMutationAuthoringValid(
        preparedCandidateDto,
        organizationId,
        projectId,
        tx,
        { validatePlanStageTopology: false },
      );
      await this.validationEngine.assertPlanStageProposalTopologyValid(
        [{ proposalId: id, proposal: preparedCandidateDto }],
        organizationId,
        projectId,
      );

      if (dto.influences !== undefined && dto.influences.length > 0) {
        const newSnapshotted = await snapshotInfluenceReferences(
          tx,
          organizationId,
          dto.influences,
          admission.metadata,
        );
        updateData.influences = [
          ...((existing.influences as unknown as Influence[] | null) ?? []),
          ...newSnapshotted!,
        ] as unknown as Prisma.InputJsonValue;
      }

      const result = await tx.proposal.update({
        where: { id },
        data: updateData,
        include: PROPOSAL_RESPONSE_RELATIONS_INCLUDE,
      });

      await this.reconciliation.captureAuthoring(tx, result);
      return result;
    });

    this.logger.log('Proposal updated', {
      id,
      status: updated.status,
      action: updated.action,
    });

    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    return this.toResponseDto(updated, projectPolicy);
  }

  async delete(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.proposal.findFirst({
        where: { id, organizationId, projectId },
        include: {
          groupMembership: {
            select: { groupId: true },
          },
        },
      });

      if (!existing) {
        throw new NotFoundException('Proposal not found');
      }

      if (existing.groupMembership) {
        throw new ConflictException(
          'Cannot delete a proposal that belongs to a proposal group',
        );
      }

      await tx.proposal.delete({ where: { id } });
    });

    this.logger.log('Proposal deleted', { id, organizationId, projectId });
  }

  async validateProposal(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    requestor: AuthenticatedUser,
  ): Promise<ProposalValidationResult>;
  async validateProposal(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    requestor: AuthenticatedUser,
    changeSet: WorkItemChangeSetValidationRequest,
  ): Promise<ProjectedWorkItemChangeSetResponse>;
  async validateProposal(
    id: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    requestor: AuthenticatedUser,
    changeSet?: WorkItemChangeSetValidationRequest,
  ): Promise<ProposalValidationResult | ProjectedWorkItemChangeSetResponse> {
    const proposal = await this.prisma.db.proposal.findFirst({
      where: {
        id,
        organizationId,
        projectId,
        ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      },
    });

    if (!proposal) {
      throw new NotFoundException('Proposal not found');
    }

    if (Array.isArray(changeSet?.operations)) {
      this.logger.debug('Validating projected work-item change set', {
        proposalId: id,
        operationCount: changeSet.operations.length,
      });
      return this.workItemChangeSetProjector.project({
        organizationId,
        projectId,
        request: changeSet,
        view: rootChildrenView,
      });
    }

    const dto: CreateProposalDto = {
      type: proposal.type,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      updates: (proposal.updates as { [key: string]: unknown }) ?? {},
      requestorContext:
        (proposal.requestorContext as { [key: string]: unknown }) ?? undefined,
      influences:
        (proposal.influences as unknown as CreateProposalDto['influences']) ??
        undefined,
      generatedWithVersion: proposal.generatedWithVersion ?? undefined,
      validationSessionId: proposal.validationSessionId ?? undefined,
      conversationId: proposal.conversationId ?? undefined,
    };

    return this.validationEngine.validate({
      proposals: [dto],
      context: { organizationId, projectId, requestor },
    });
  }

  async createBatch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    dtos: StampedCreateProposalDto[],
  ): Promise<TypedProposalResponse[]> {
    if (dtos.length === 0) {
      throw new BadRequestException('At least one proposal is required');
    }
    if (dtos.length > ProposalService.MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Batch size ${dtos.length} exceeds maximum of ${ProposalService.MAX_BATCH_SIZE}`,
      );
    }
    await this.assertMayAuthorProposals(projectId, userId, dtos);

    const projectPolicy =
      await this.projectApprovalPolicyService.resolve(projectId);
    const applyOnCreateByItem: Array<ApplyOnCreatePreparation | null> = [];
    const evalWriter = await this.isEvalWriter(organizationId, projectId);
    for (const dto of dtos) {
      applyOnCreateByItem.push(
        evalWriter
          ? null
          : await this.prepareApplyOnCreate(
              organizationId,
              projectId,
              userId,
              dto,
              projectPolicy,
            ),
      );
    }

    const immediatelyMaterializedEdges: MaterializedProposalEdge[] = [];
    let results: Array<{
      proposal: ProposalWithResponseRelations;
      materializableEdges: MaterializableEdge[];
      runPostCommit: PostCommitRunner;
      genericChangeSetReady: boolean;
      responseRequiredApprovals?: number;
      immediatelyMaterializedEdges?: MaterializedProposalEdge[];
    }>;
    try {
      results = await this.prisma.db.$transaction(async (tx) => {
        const prepared: Array<{
          dto: StampedCreateProposalDto;
          title: string | null;
          applyOnCreate: ApplyOnCreatePreparation | null;
        }> = [];
        const stampedInputs: StampedCreateProposalDto[] = [];

        for (const dto of dtos) {
          stampedInputs.push(await this.applyOriginInfluence(tx, dto));
        }
        const admission =
          await this.validationEngine.assertAuthoringCandidatesValid({
            proposals: stampedInputs,
            context: { organizationId, projectId, db: tx },
          });
        for (const stampedInput of stampedInputs) {
          this.assertProposalContextSource(stampedInput);
          this.assertProposalTitleForCreate(stampedInput);
          this.assertSupersedeInvariant(stampedInput);
          assertWorkflowProposalLinksStructurallyValid(stampedInput);
          assertWorkItemChangeSetStructurallyValid(stampedInput);
          assertNoRawTracksDeclaration(stampedInput);
          if (stampedInput.influences !== undefined) {
            this.validateInfluenceInputs(stampedInput.influences);
          }
        }
        const project = await tx.project.findFirst({
          where: { id: projectId, organizationId },
        });
        if (!project) {
          throw new NotFoundException('Project not found');
        }
        if (admission.candidates.length !== dtos.length) {
          throw new InternalServerErrorException(
            `Proposal admission returned ${admission.candidates.length} candidates for ${dtos.length} inputs`,
          );
        }
        const metadata = admission.metadata;
        for (const [index, admitted] of admission.candidates.entries()) {
          const stampedDto = admitted.candidate;
          // Admitted candidates carry no input key; the length check above
          // pins admission to one candidate per input, in input order.
          const applyOnCreate = applyOnCreateByItem[index] ?? null;
          if (
            stampedDto.action !== 'CREATE' &&
            stampedDto.targetEntityType !== 'WORK_ITEM_TYPE' &&
            stampedDto.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE'
          ) {
            await this.validateTargetEntity(
              stampedDto.targetEntityId,
              stampedDto.targetEntityType,
              organizationId,
              projectId,
              tx,
              metadata,
            );
          }
          await this.validationEngine.assertTaskMutationAuthoringValid(
            admitted,
            organizationId,
            projectId,
            tx,
            { validatePlanStageTopology: false },
          );

          const preparedDto = await this.prepareTaskMutationRequirements(
            stampedDto,
            organizationId,
            projectId,
            tx,
            applyOnCreate
              ? replayMintedIds(applyOnCreate.mintedIds)
              : undefined,
          );
          const snapshottedDto = await this.snapshotEntityTitles(
            tx,
            organizationId,
            preparedDto,
            metadata,
          );

          const title = await resolveProposalTitle({
            db: tx,
            organizationId,
            action: snapshottedDto.action,
            targetEntityType: snapshottedDto.targetEntityType,
            targetEntityId: snapshottedDto.targetEntityId,
            callerTitle: snapshottedDto.title,
            metadata,
          });

          prepared.push({
            applyOnCreate,
            dto: {
              ...snapshottedDto,
              requestorContext: stampedDto.requestorContext,
              eli5: stampedDto.eli5,
            },
            title,
          });
        }

        await this.validationEngine.assertPlanStageProposalTopologyValid(
          prepared.map(({ dto }) => ({ proposal: dto })),
          organizationId,
          projectId,
        );

        const items: Array<{
          proposal: ProposalWithResponseRelations;
          materializableEdges: MaterializableEdge[];
          runPostCommit: PostCommitRunner;
          genericChangeSetReady: boolean;
          responseRequiredApprovals?: number;
          immediatelyMaterializedEdges?: MaterializedProposalEdge[];
        }> = [];
        for (const { dto, title, applyOnCreate } of prepared) {
          const { stamp: evalStamp, data: evalData } =
            await this.admitEvalProposal(tx, organizationId, projectId, dto);
          const proposal = await tx.proposal.create({
            data: {
              ...this.buildCreateData(
                organizationId,
                projectId,
                userId,
                dto,
                title,
                await this.snapshotTargetLastAppliedProposalId(tx, dto),
              ),
              ...evalData,
            },
            include: PROPOSAL_RESPONSE_RELATIONS_INCLUDE,
          });

          await this.reconciliation.captureAuthoring(tx, proposal);
          const applied = evalStamp.applicationEligible
            ? await this.maybeApplyOnCreate(
                tx,
                proposal,
                organizationId,
                projectId,
                dto,
                projectPolicy,
                applyOnCreate,
                (edge) => immediatelyMaterializedEdges.push(edge),
              )
            : null;
          if (applied?.immediatelyMaterializedEdges) {
            immediatelyMaterializedEdges.push(
              ...applied.immediatelyMaterializedEdges.filter(
                (edge) =>
                  !immediatelyMaterializedEdges.some(
                    (created) => created.edgeId === edge.edgeId,
                  ),
              ),
            );
          }
          items.push(
            applied ?? {
              proposal,
              materializableEdges: [],
              runPostCommit: NOOP_POST_COMMIT,
              genericChangeSetReady: false,
            },
          );
        }

        return items;
      }, PROPOSAL_ENACTMENT_TRANSACTION_OPTIONS);
    } catch (error) {
      await this.pendingEdgeService.rollbackMaterializedEdges(
        organizationId,
        projectId,
        immediatelyMaterializedEdges,
        'Rolling back proposal-declared SUPERSEDES edge because batch proposal creation failed.',
      );
      throw error;
    }

    for (const item of results) {
      if (item.materializableEdges.length > 0) {
        await this.pendingEdgeService.materializeEdges(
          organizationId,
          projectId,
          item.materializableEdges,
          item.proposal.conversationId,
        );
      }
      await item.runPostCommit();
      if (item.genericChangeSetReady) {
        const materialized =
          await this.approvalService.materializeGenericWorkItemChangeSet({
            proposalId: item.proposal.id,
            organizationId,
            projectId,
          });
        item.proposal = materialized.proposal;
      }
    }

    this.logger.log('Batch proposals created', {
      count: results.length,
      organizationId,
      projectId,
    });

    return Promise.all(
      results.map((r) =>
        this.toResponseDto(
          r.proposal,
          projectPolicy,
          r.responseRequiredApprovals,
        ),
      ),
    );
  }

  /**
   * Reject any incoming DTO that lacks a server-stamped requestorContext.source.
   * Production callers (the user proposal-create endpoint and the MCP boundary
   * middleware) both stamp this; missing source means an internal caller skipped
   * the boundary, and is a contract bug we surface immediately rather than
   * silently fall back to a default.
   */
  private assertProposalContextSource(dto: CreateProposalDto): void {
    const source = (dto.requestorContext as { source?: unknown } | undefined)
      ?.source;
    if (source !== 'user' && source !== 'agent') {
      throw new BadRequestException(
        "Proposal must carry a server-stamped requestorContext.source ('user' or 'agent'). Use the user proposal-create endpoint or the MCP boundary middleware to author proposals.",
      );
    }
  }

  /**
   * Enforce the supersede invariant at the create boundary: a SUPERSEDED task
   * status remains transition-only, while successor-authored SUPERSEDES edge
   * declarations are allowed so approval can materialize the predecessor
   * transition. This is the runtime gate every proposal passes through, so the
   * plain status-edit path can never produce a SUPERSEDED task.
   */
  private assertSupersedeInvariant(dto: CreateProposalDto): void {
    const violation = evaluateSupersedeInvariant(dto);
    if (violation) {
      throw new BadRequestException(
        `${violation.reason} ${violation.suggestion}`,
      );
    }
  }

  /**
   * For action=CREATE proposals the to-be entity has no registry row yet,
   * so the writer is the only source of truth for the title snapshot.
   * Reject CREATEs authored without a non-empty `title` rather than
   * silently persisting `null` — UPDATE/DELETE callers may omit it and
   * fall back to the registry, but CREATE has no fallback.
   */
  private assertProposalTitleForCreate(dto: CreateProposalDto): void {
    if (dto.action !== 'CREATE') {
      return;
    }
    if (typeof dto.title !== 'string' || dto.title.length === 0) {
      throw new BadRequestException(
        'CREATE proposals must include a non-empty `title` (the to-be entity has no registry row yet, so the server cannot resolve it).',
      );
    }
  }

  private canApplyOnCreate(
    proposal: Pick<CreateProposalDto, 'action' | 'targetEntityType'>,
  ): boolean {
    return (
      (proposal.action === 'CREATE' ||
        proposal.action === 'UPDATE' ||
        proposal.action === 'VERSIONED_UPDATE') &&
      proposal.targetEntityType !== 'ENTITY_PROMPT_TEMPLATE'
    );
  }

  /**
   * The one apply-on-create decision, shared by the pre-transaction projection
   * step and the transaction. Changed fields come from what the change set
   * writes, so the raw and prepared payloads of one create agree.
   */
  private async evaluateApplyOnCreate(
    db: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    authorId: string,
    dto: CreateProposalDto,
    projectPolicy: ProjectApprovalPolicy,
  ): Promise<{
    source: 'user' | 'agent';
    config: ReturnType<typeof evaluatePermissions>;
    meetsThreshold: boolean;
  }> {
    const requestor = dto.requestorContext as {
      source: 'user' | 'agent';
      toolName?: unknown;
    };
    const source = requestor.source;
    const evaluationContext = await resolvePermissionEvaluationContext(
      db,
      organizationId,
      projectId,
      {
        targetEntityType: dto.targetEntityType,
        action: dto.action,
        targetEntityId: dto.targetEntityId,
        updates: dto.updates,
      },
      {
        source,
        toolName:
          typeof requestor.toolName === 'string' ? requestor.toolName : null,
        authorId,
      },
      this.workItemTypeRegistry,
    );
    const config = evaluatePermissions(
      evaluationContext.entity,
      evaluationContext.proposal,
      projectPolicy,
    );
    const approvalCount =
      source === 'user' && config.allowsProposerApproval ? 1 : 0;
    return {
      source,
      config,
      meetsThreshold: approvalCount >= config.threshold,
    };
  }

  /**
   * Decide apply-on-create before the create transaction and, when the
   * proposer's approval meets the threshold, project the change set there so
   * the transaction never holds a connection across the projector's reads.
   * Requirement IDs minted while preparing are replayed in the transaction so
   * its stored change set matches the projected revision.
   */
  private async prepareApplyOnCreate(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    dto: StampedCreateProposalDto,
    projectPolicy: ProjectApprovalPolicy,
  ): Promise<ApplyOnCreatePreparation | null> {
    if (!this.canApplyOnCreate(dto)) return null;
    const mintedIds: string[] = [];
    let request: ReturnType<ProposalApprovalService['genericChangeSetRequest']>;
    try {
      const { meetsThreshold } = await this.evaluateApplyOnCreate(
        this.prisma.db,
        organizationId,
        projectId,
        userId,
        dto,
        projectPolicy,
      );
      if (!meetsThreshold) return null;
      const preparedDto = await this.prepareTaskMutationRequirements(
        storeTracksAttachmentAsProposalEdge(dto),
        organizationId,
        projectId,
        this.prisma.db,
        () => {
          const id = randomUUID();
          mintedIds.push(id);
          return id;
        },
      );
      request = this.approvalService.genericChangeSetRequest({
        id: '',
        projectId,
        action: preparedDto.action,
        targetEntityType: preparedDto.targetEntityType,
        targetEntityId: preparedDto.targetEntityId,
        updates: preparedDto.updates,
        edges: preparedDto.edges ?? null,
      } as unknown as Proposal);
    } catch (error) {
      // Invalid-input rejections are deferred so the transaction raises them
      // after admission, where they have always surfaced. Anything else is an
      // infrastructure or invariant failure and must not be masked.
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        return null;
      }
      throw error;
    }
    const prepared = request
      ? await this.approvalService.projectGenericPreparation(
          organizationId,
          projectId,
          request,
        )
      : null;
    this.logger.log('Prepared apply-on-create before transaction', {
      organizationId,
      projectId,
      validationRevision: prepared?.validationRevision ?? null,
      mintedRequirementIds: mintedIds.length,
    });
    return { prepared, mintedIds };
  }

  /**
   * Evaluate a freshly-persisted DRAFT proposal at the create boundary.
   * Eligible user authors contribute one approval record. Apply the proposal
   * in the caller's transaction when the resulting count meets the evaluated
   * threshold; otherwise leave it DRAFT with that approval visible.
   *
   * `assertProposalContextSource` runs at the create boundary and guarantees
   * a valid 'user' | 'agent' source on the DTO before this method is reached.
   */
  private async maybeApplyOnCreate(
    tx: AnyTransactionClient,
    proposal: ProposalWithResponseRelations,
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: CreateProposalDto,
    projectPolicy: ProjectApprovalPolicy,
    applyOnCreate: ApplyOnCreatePreparation | null,
    onImmediateEdgeCreated: (edge: MaterializedProposalEdge) => void,
  ): Promise<{
    proposal: ProposalWithResponseRelations;
    materializableEdges: MaterializableEdge[];
    immediatelyMaterializedEdges?: MaterializedProposalEdge[];
    runPostCommit: PostCommitRunner;
    genericChangeSetReady: boolean;
    responseRequiredApprovals?: number;
  } | null> {
    if (!this.canApplyOnCreate(proposal)) {
      return null;
    }

    const { source, config } = await this.evaluateApplyOnCreate(
      tx,
      organizationId,
      projectId,
      proposal.requestorId,
      dto,
      projectPolicy,
    );

    this.logger.log('Evaluated apply-on-create eligibility', {
      proposalId: proposal.id,
      threshold: config.threshold,
      allowsProposerApproval: config.allowsProposerApproval,
      projectedBeforeTransaction: applyOnCreate !== null,
    });

    const proposerApproval =
      source === 'user' && config.allowsProposerApproval
        ? await tx.proposalApprovalRecord.create({
            data: {
              proposalId: proposal.id,
              userId: proposal.requestorId,
              type: 'APPROVAL',
            },
          })
        : null;

    const approvalCount = proposerApproval ? 1 : 0;
    if (approvalCount < config.threshold) {
      return {
        proposal: proposerApproval
          ? { ...proposal, approvalRecords: [proposerApproval] }
          : proposal,
        materializableEdges: [],
        runPostCommit: NOOP_POST_COMMIT,
        genericChangeSetReady: false,
        responseRequiredApprovals: config.threshold,
      };
    }

    if (!applyOnCreate) {
      // Eligibility moved between the pre-transaction read and this one (for
      // example the approval policy changed); never project in a transaction.
      this.logger.warn(
        'Apply-on-create became eligible inside its transaction',
        {
          proposalId: proposal.id,
          threshold: config.threshold,
        },
      );
      throw new ConflictException(
        'Proposal approval requirements changed while it was being created; retry the request.',
      );
    }
    const genericChangeSetRequest =
      this.approvalService.genericChangeSetRequest(proposal);
    const prepared = this.approvalService.assertPreparedChangeSetCurrent(
      proposal.id,
      genericChangeSetRequest,
      applyOnCreate.prepared,
    );
    if (genericChangeSetRequest && prepared) {
      const queued =
        await this.approvalService.queueGenericWorkItemChangeSetInTransaction(
          tx,
          proposal,
          organizationId,
          projectId,
          prepared,
        );
      return {
        proposal: proposerApproval
          ? {
              ...proposal,
              ...queued.proposal,
              approvalRecords: [proposerApproval],
              workItemChangeSetMaterialization: queued.materialization,
            }
          : {
              ...proposal,
              ...queued.proposal,
              workItemChangeSetMaterialization: queued.materialization,
            },
        materializableEdges: [],
        runPostCommit: NOOP_POST_COMMIT,
        genericChangeSetReady: true,
      };
    }

    const result = await this.approvalService.applyInTransaction(
      tx,
      proposal,
      organizationId,
      projectId,
      { onImmediateEdgeCreated },
    );
    return {
      proposal: proposerApproval
        ? {
            ...proposal,
            ...result.proposal,
            approvalRecords: [proposerApproval],
          }
        : { ...proposal, ...result.proposal },
      materializableEdges: result.materializableEdges,
      immediatelyMaterializedEdges: result.immediatelyMaterializedEdges,
      runPostCommit: result.runPostCommit,
      genericChangeSetReady: false,
    };
  }

  /**
   * Verify that the target entity exists and belongs to the organization
   * and project. Skipped for CREATE proposals where the entity doesn't
   * exist yet.
   *
   * Task → Initiative → ProjectInitiative(projectId), so project scoping
   * for tasks traverses the initiative relationship.
   *
   * Accepts an optional transaction client for use within batch operations.
   */
  private async validateTargetEntity(
    targetEntityId: string,
    targetEntityType: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    tx?: AnyTransactionClient,
    metadata?: ProposalReferenceMetadata,
  ): Promise<void> {
    const db = tx ?? this.prisma.db;
    const baseWhere = {
      id: targetEntityId,
      organizationId,
      archivedAt: null,
    };

    let exists: boolean;
    switch (targetEntityType) {
      case 'TASK':
        exists = metadata
          ? metadata.taskRows.get(targetEntityId)?.projectId === projectId
          : !!(await db.task.findFirst({
              where: { ...baseWhere, projectId },
              select: { id: true },
            }));
        break;
      case 'DESIGN_DOC':
        exists = metadata
          ? metadata.designDocRows.has(targetEntityId)
          : !!(await db.designDoc.findFirst({
              where: baseWhere,
              select: { id: true },
            }));
        break;
      default:
        throw new BadRequestException(
          `Unsupported target entity type: ${targetEntityType}`,
        );
    }

    if (!exists) {
      throw new NotFoundException(
        `Target ${targetEntityType} not found: ${targetEntityId}`,
      );
    }
  }

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  private static readonly ALLOWED_INFLUENCE_REASON_TYPES = new Set([
    'explicit_mention',
    'implied',
    'derived',
    'origin',
    'user_reason',
  ]);

  private static readonly ALLOWED_INFLUENCE_ENTITY_TYPES: ReadonlySet<string> =
    new Set(Object.values(GeneratedEntityType));

  private static readonly ALLOWED_INFLUENCE_KEYS: ReadonlySet<string> = new Set(
    [
      'entityId',
      'entityType',
      'entityTitle',
      'reasoning',
      'reasonType',
      'confidence',
    ],
  );

  private validateInfluenceInputs(influences: readonly Influence[]): void {
    influences.forEach((influence, index) => {
      const reject = (reason: string): never => {
        throw new BadRequestException(
          `Invalid influences[${index}]: ${reason}`,
        );
      };

      if (!influence || typeof influence !== 'object') {
        reject('entry must be an object');
      }
      const unsupportedKey = Object.keys(influence).find(
        (key) => !ProposalService.ALLOWED_INFLUENCE_KEYS.has(key),
      );
      if (unsupportedKey) {
        reject(
          `unsupported field "${unsupportedKey}"; declare typed relationships through edges`,
        );
      }
      if (
        typeof influence.entityId !== 'string' ||
        !ProposalService.UUID_REGEX.test(influence.entityId)
      ) {
        reject('entityId is required and must be a UUID');
      }
      if (
        typeof influence.entityType !== 'string' ||
        !ProposalService.ALLOWED_INFLUENCE_ENTITY_TYPES.has(
          influence.entityType,
        )
      ) {
        reject(
          `entityType is required and must be one of ${[
            ...ProposalService.ALLOWED_INFLUENCE_ENTITY_TYPES,
          ].join(', ')}`,
        );
      }
      if (
        typeof influence.reasonType !== 'string' ||
        !ProposalService.ALLOWED_INFLUENCE_REASON_TYPES.has(
          influence.reasonType,
        )
      ) {
        reject(
          `reasonType is required and must be one of ${[
            ...ProposalService.ALLOWED_INFLUENCE_REASON_TYPES,
          ].join(', ')}`,
        );
      }
      if (typeof influence.reasoning !== 'string') {
        reject('reasoning is required and must be a string');
      }
    });
  }

  /**
   * Strip any agent-supplied `origin` influences (only the server may stamp
   * one), then look up the host conversation's workflow-about entity and
   * append a single server-stamped `origin` influence when one is available.
   *
   * Why: provenance must be authoritative. Allowing the agent to author
   * `origin` would make this signal forgeable; producing it server-side
   * keeps it trustworthy.
   */
  /**
   * Stamp `entityTitle` on every influence and `targetEntityTitle` on every
   * non-PROPOSAL edge declaration before the row is persisted as JSONB.
   *
   * Caller-supplied titles win (the resolver only fills holes). Rows whose
   * target is missing from the registry land with `entityTitle: null` and
   * a warn log so deletions are traceable.
   *
   * Staleness contract: the snapshot is intentionally *not* refreshed on
   * subsequent renames or deletes. A proposal is a record of intent at a
   * point in time — "name as of when this proposal was authored" is the
   * correct semantic for the influence/edge row. Mention links still
   * resolve to the live entity for the up-to-date name.
   */
  private async snapshotEntityTitles<T extends CreateProposalDto>(
    db: AnyTransactionClient,
    organizationId: OrganizationId,
    dto: T,
    metadata?: ProposalReferenceMetadata,
  ): Promise<T> {
    const [influences, edges] = await Promise.all([
      snapshotInfluenceReferences(db, organizationId, dto.influences, metadata),
      snapshotEdgeTitles(db, organizationId, dto.edges, metadata),
    ]);
    return { ...dto, influences, edges };
  }

  private async applyOriginInfluence(
    db: AnyTransactionClient,
    dto: StampedCreateProposalDto,
  ): Promise<StampedCreateProposalDto> {
    const sanitizedInfluences = (dto.influences ?? []).filter(
      (influence) => influence.reasonType !== 'origin',
    );

    const origin = await buildOriginInfluence(db, dto.conversationId);

    const influences = origin
      ? [...sanitizedInfluences, origin]
      : sanitizedInfluences;

    if (origin) {
      this.logger.debug('Stamped origin influence on proposal', {
        conversationId: dto.conversationId,
        entityId: origin.entityId,
        entityType: origin.entityType,
      });
    }

    return { ...dto, influences };
  }

  private async admitEvalProposal(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    proposal: CreateProposalDto,
  ) {
    return this.evalOutputAdmission.resolveProposal(tx, {
      organizationId,
      projectId,
      writingSessionId: currentWritingSessionId(),
      proposal,
    });
  }

  private async isEvalWriter(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<boolean> {
    const admission = await this.evalOutputAdmission.resolve(this.prisma.db, {
      organizationId,
      projectId,
      writingSessionId: currentWritingSessionId(),
    });
    return admission.isEvalOutput;
  }

  private buildCreateData(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    dto: CreateProposalDto,
    title: string | null,
    targetLastAppliedProposalId: string | null,
  ): Prisma.ProposalUncheckedCreateInput {
    return {
      organizationId,
      projectId,
      type: dto.type as PrismaProposalType,
      action: dto.action as PrismaProposalAction,
      targetEntityId: dto.targetEntityId,
      targetEntityType: dto.targetEntityType as PrismaTargetEntityType,
      updates: dto.updates as Prisma.InputJsonValue,
      title,
      eli5: dto.eli5,
      requestorId: userId,
      requestorContext: dto.requestorContext
        ? (dto.requestorContext as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      influences: dto.influences
        ? (dto.influences as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      generatedWithVersion: dto.generatedWithVersion ?? null,
      validationSessionId: dto.validationSessionId ?? null,
      conversationId: dto.conversationId ?? null,
      messageId: null,
      targetLastAppliedProposalId,
      edges: dto.edges
        ? (dto.edges as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    };
  }

  private async snapshotTargetLastAppliedProposalId(
    tx: AnyTransactionClient,
    dto: Pick<
      CreateProposalDto,
      'action' | 'targetEntityId' | 'targetEntityType'
    >,
  ): Promise<string | null> {
    if (
      dto.targetEntityType !== 'TASK' ||
      (dto.action !== 'UPDATE' && dto.action !== 'DELETE')
    ) {
      return null;
    }
    const task = await tx.task.findUnique({
      where: { id: dto.targetEntityId },
      select: { lastAppliedProposalId: true },
    });
    if (!task) {
      throw new NotFoundException('Proposal target task not found');
    }
    return task.lastAppliedProposalId;
  }

  private async toResponseDto(
    proposal: ProposalWithResponseRelations,
    projectPolicy: ProjectApprovalPolicy,
    requiredApprovals?: number,
  ): Promise<TypedProposalResponse> {
    return mapProposalResponse(this.prisma.db, proposal, projectPolicy, {
      requiredApprovals,
      workItemTypeRegistry: this.workItemTypeRegistry,
    });
  }
}
