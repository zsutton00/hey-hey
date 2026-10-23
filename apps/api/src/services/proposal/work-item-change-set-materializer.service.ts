import { assertProposalApplicationEligible } from './proposal-application-eligibility';
import {
  isWorkItemChangeSetValidationRequest,
  proposalWriteFacts,
  taskCreateOperation,
  taskUpdateOperation,
} from './task-proposal-change-set-conversion';
import { ProposalReconciliationService } from './proposal-reconciliation.service';
import { canonicalDiagramType } from '../tasks/diagram-metadata';
import { ProposalEdgeEndpointMode } from 'src/generated/model/proposalEdgeEndpointMode';
import { normalizeDiagramChangeSet } from './diagram-change-set-compatibility';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  Proposal,
  ProposalEdgeType as PrismaProposalEdgeType,
  WorkItemChangeSetCheckpointStatus,
  WorkItemChangeSetMaterialization,
  WorkItemChangeSetMaterializationCheckpoint,
  WorkItemChangeSetMaterializationStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { performance } from 'node:perf_hooks';
import { withApiSpan } from 'src/telemetry/api-tracing';
import type {
  CreateTaskDto,
  ProjectedWorkItemChangeSetResponse,
  ProposalApprovalFailureDiagnostic,
  ProposalEdgeDeclaration,
  TaskSectionInput,
  UpdateTaskDto,
  WorkItemChangeSetIdentity,
  WorkItemCreateOperation,
  WorkItemChangeSetOperation,
  WorkItemChangeSetRelationshipIdentity,
  WorkItemUpdateOperation,
  WorkItemChangeSetValidationRequest,
  WorkItemGraphLayoutValue,
  WorkItemRelationshipCreateOperation,
} from 'src/generated';
import { PayloadType } from 'src/generated/model/payloadType';
import { AgentEdgeEndpointEntityType } from 'src/generated/graphs/model/agentEdgeEndpointEntityType';
import { AgentEdgeCategory } from 'src/generated/graphs/model/agentEdgeCategory';
import type { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import type { AgentEdge as GraphAgentEdge } from 'src/generated/graphs/model/agentEdge';
import type { CreateAgentEdgeDto } from 'src/generated/graphs/model/createAgentEdgeDto';
import type { UpdateAgentEdgeDto } from 'src/generated/graphs/model/updateAgentEdgeDto';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import type { ProposalApprovedEventPayload } from 'src/core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  ProposalId,
  TaskId,
  UserId,
  InitiativeId,
} from 'src/types';
import { v4 as uuidv4 } from 'uuid';
import {
  AGENT_EDGE_BATCH_SIZE,
  AgentEdgeClientService,
} from '../agent-edge-client.service';
import { TaskService } from '../tasks/task.service';
import {
  diffBodyMentions,
  publishBodyMentionEvents,
} from '../mentions/body-mention-events';
import {
  MentionProcessingService,
  type ResolvedMention,
} from '../mentions/mention-processing.service';
import {
  collectWorkItemMentionContent,
  type WorkItemMentionSectionRow,
} from '../mentions/work-item-mention-content';
import {
  resolveWorkItemSectionContentKind,
  TaskSectionSchemaValidatorRegistry,
} from '../tasks/task-section-schema-validator.registry';
import { PROJECT_MODE_FILES_SCHEMA_REF } from '../tasks/project-mode-files.validator';
import {
  findIneligibleProjectModeTypeKeys,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
} from '../tasks/project-mode-settings.validator';
import {
  MentionCreatedEventPayload,
  type ProjectModeSettings,
} from '../../generated';
import type { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import { validateFeatureRequirementsSection } from '../tasks/feature-requirements-section.validator';
import { FeatureRequirementsReadError } from '../tasks/feature-requirements-reader';
import {
  diffRequirementCitationEdges,
  hasRequirementCitationEdgeChanges,
  toRequirementCitationEdgeDto,
  REQUIREMENT_CITATION_EDGE_TYPE,
  type RequirementCitationEdge,
  type RequirementCitationEdgeDiff,
} from '../tasks/feature-requirement-citation-edges';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { projectionFootprintIds } from '../work-item-change-set-footprint';
import {
  PendingEdgeService,
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from './pending-edge.service';
import {
  WorkItemChangeSetProjectionSnapshots,
  WorkItemChangeSetProjectorService,
} from './work-item-change-set-projector.service';
import {
  parseProposalApprovalFailure,
  proposalApprovalFailureMessage,
  serializeProposalApprovalFailure,
  toProposalApprovalFailureDiagnostic,
  type PersistedProposalApprovalFailure,
} from './proposal-approval-failure-diagnostic';
import {
  PROPOSAL_RESPONSE_BASE_RELATIONS_INCLUDE,
  type ProposalWithResponseRelations,
} from './proposal.types';
import {
  materializeDiagramGroupMembers,
  parseDiagramGroupsContent,
  reconcileDiagramGroups,
} from '../tasks/diagram-groups';

type MaterializationWithCheckpoints = WorkItemChangeSetMaterialization & {
  checkpoints: WorkItemChangeSetMaterializationCheckpoint[];
};

const normalizedFailures = new WeakMap<
  object,
  PersistedProposalApprovalFailure
>();

function normalizedFailure(error: unknown): PersistedProposalApprovalFailure {
  if (typeof error === 'object' && error !== null) {
    const cached = normalizedFailures.get(error);
    if (cached) return cached;
    const failure = {
      message: proposalApprovalFailureMessage(error),
      diagnostic: toProposalApprovalFailureDiagnostic(error),
    };
    normalizedFailures.set(error, failure);
    return failure;
  }
  return {
    message: proposalApprovalFailureMessage(error),
    diagnostic: toProposalApprovalFailureDiagnostic(error),
  };
}

/**
 * A change set projected once, before any approval transaction opens, so the
 * intent can be stored inside the transaction without projector or Graph reads.
 */
export type PreparedChangeSetProjection = {
  operationSet: WorkItemChangeSetValidationRequest;
  validationRevision: string;
  snapshots: WorkItemChangeSetProjectionSnapshots;
};

export type WorkItemChangeSetMaterializationResult = {
  proposal: ProposalWithResponseRelations;
  rootWorkItemId: string | null;
  status: WorkItemChangeSetMaterializationStatus;
  enacted: boolean;
};

type IdentityMappings = {
  workItems: Record<string, string>;
  relationships: Record<string, string>;
};

type TaskProposalPayload = Record<string, unknown>;
type DurableProposalEdgeType = Exclude<
  ProposalEdgeDeclaration['edgeType'],
  'BLOCKS'
>;

type TaskProposalMaterializationPayload = {
  action: 'CREATE' | 'UPDATE';
  updates: TaskProposalPayload;
};

type StoredProjection = {
  schemaVersion: 'work-item-change-set-projection.v1';
  projection: Awaited<ReturnType<WorkItemChangeSetProjectorService['project']>>;
  workItems?: Record<string, PriorSectionSnapshot>;
  requirementCitationEdges?: RequirementCitationEdgeDiff;
};

// Prior state of a section-written work item: mention diffing at publish and
// requirement-citation planning are its only readers.
type PriorSectionSnapshot = {
  type: string;
  projectId: string;
  sections: WorkItemMentionSectionRow[];
};

// Requirement citations can target design docs, which the work-item
// relationship operations cannot address. Their edges are planned at prepare
// time into the prior projection and applied under this dedicated checkpoint
// so they share the intent's claim, retry and publication gate. Index -1 is
// the post-publication deferred-edge handoff.
const REQUIREMENT_CITATION_CHECKPOINT_INDEX = -2;
const REQUIREMENT_CITATION_CHECKPOINT_KIND = 'requirementCitationEdges.sync';
const FEATURE_REQUIREMENTS_SECTION_KEY = 'requirements';

@Injectable()
export class WorkItemChangeSetMaterializerService {
  private static readonly CLAIM_TTL_MS = 15 * 60 * 1000;
  private readonly logger = new Logger(
    WorkItemChangeSetMaterializerService.name,
  );
  private readonly taskSectionSchemaValidators =
    new TaskSectionSchemaValidatorRegistry();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projector: WorkItemChangeSetProjectorService,
    private readonly taskService: TaskService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
    private readonly reconciliation: ProposalReconciliationService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly pendingEdgeService: PendingEdgeService,
    private readonly mentionProcessingService: MentionProcessingService,
  ) {}

  async hasNonterminalIntent(
    tx: AnyTransactionClient,
    proposalId: string,
    validationRevision: string,
  ): Promise<boolean> {
    const intent = await tx.workItemChangeSetMaterialization.findUnique({
      where: { proposalId },
      select: { status: true, validationRevision: true },
    });
    if (!intent) return false;
    if (intent.validationRevision !== validationRevision) {
      throw new BadRequestException(
        'Stored work-item change-set validation revision does not match the proposal updates.',
      );
    }
    return intent.status !== WorkItemChangeSetMaterializationStatus.PUBLISHED;
  }

  async materializeApprovedChangeSet(params: {
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    reservedRootWorkItemId?: TaskId;
    request?: WorkItemChangeSetValidationRequest;
  }): Promise<WorkItemChangeSetMaterializationResult> {
    const startedAt = performance.now();
    try {
      return await withApiSpan('proposal.change_set.materialize', () =>
        this.materializeApprovedChangeSetInternal(params),
      );
    } finally {
      this.logger.log('Generic materialization timing', {
        proposalId: params.proposalId,
        totalElapsedMs: performance.now() - startedAt,
      });
    }
  }

  private async materializeApprovedChangeSetInternal(params: {
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    reservedRootWorkItemId?: TaskId;
    request?: WorkItemChangeSetValidationRequest;
  }): Promise<WorkItemChangeSetMaterializationResult> {
    this.logger.log('Generic materialization started', {
      proposalId: params.proposalId,
      organizationId: params.organizationId,
      projectId: params.projectId,
    });
    const prepared = await withApiSpan('proposal.change_set.prepare', () =>
      this.prepareIntent(params),
    );
    this.logger.debug('Generic materialization prepared', {
      proposalId: params.proposalId,
      materializationId: prepared.id,
      status: prepared.status,
    });
    const targetProjection =
      prepared.targetProjection as unknown as StoredProjection;
    if (!targetProjection.projection.valid) {
      const persistedFailure = parseProposalApprovalFailure(prepared.lastError);
      const message =
        persistedFailure?.message ??
        'Cannot materialize an invalid work-item change set';
      const diagnostic =
        persistedFailure?.diagnostic ??
        toProposalApprovalFailureDiagnostic(targetProjection.projection);
      throw new BadRequestException({
        message,
        projection: targetProjection.projection,
        diagnostic,
      });
    }
    if (prepared.status !== WorkItemChangeSetMaterializationStatus.PUBLISHED) {
      const claimed = await withApiSpan('proposal.change_set.claim', () =>
        this.claimPreparedIntent(params, prepared.id),
      );
      if (!claimed) {
        this.logger.log(
          'Generic materialization claim unavailable; reading current result',
          { proposalId: params.proposalId, materializationId: prepared.id },
        );
        return this.requireCurrentResult(prepared.id);
      }
      try {
        this.assertRecoverableIntent(claimed);
        await withApiSpan('proposal.change_set.apply', () =>
          this.applyPreparedIntent(params, claimed, claimed.claimToken!),
        );
        await withApiSpan('proposal.change_set.publish', () =>
          this.publishPreparedIntent(params, claimed.id, claimed.claimToken!),
        );
        await withApiSpan('proposal.change_set.release_fences', () =>
          this.releaseFences(claimed.id, claimed.claimToken!),
        );
      } catch (error) {
        const failure = normalizedFailure(error);
        const postconditionIssue = failure.diagnostic.issues.find(
          (issue) => issue.code === 'POSTCONDITION_MISMATCH',
        );
        this.logger.error('Generic materialization attempt failed', {
          proposalId: params.proposalId,
          materializationId: claimed.id,
          failureCode: postconditionIssue?.code ?? 'MATERIALIZATION_FAILED',
          fieldPath: postconditionIssue?.field,
          reason: postconditionIssue?.reason,
          diagnosticCorrelationId: failure.diagnostic.correlationId,
        });
        await this.markIntentRecoverableFailure(
          claimed.id,
          claimed.claimToken!,
          error,
          failure,
        );
        throw error instanceof HttpException
          ? new HttpException(failure, error.getStatus())
          : new InternalServerErrorException(failure);
      }
    }
    this.logger.debug('Generic materialization verifying published result', {
      proposalId: params.proposalId,
      materializationId: prepared.id,
    });
    const published = await withApiSpan(
      'proposal.change_set.published_result',
      () => this.requirePublishedResult(prepared.id),
    );
    await withApiSpan('proposal.change_set.edge_handoff', () =>
      this.handoffDeferredEntityEdgesAfterChangeSetPublication(
        prepared.id,
        published.proposal,
      ),
    );
    this.logger.log('Generic materialization completed', {
      proposalId: params.proposalId,
      materializationId: prepared.id,
    });
    return {
      ...published,
      status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
      enacted: true,
    };
  }

  private async requireCurrentResult(
    materializationId: string,
  ): Promise<WorkItemChangeSetMaterializationResult> {
    const current =
      await this.prisma.db.workItemChangeSetMaterialization.findUniqueOrThrow({
        where: { id: materializationId },
        include: {
          checkpoints: true,
          proposal: { include: PROPOSAL_RESPONSE_BASE_RELATIONS_INCLUDE },
        },
      });
    if (current.proposal.status !== 'APPROVED') {
      throw new ConflictException(
        'Generic change-set materialization is not bound to an approved proposal.',
      );
    }
    const { proposal, ...materialization } = current;
    return {
      proposal: {
        ...proposal,
        workItemChangeSetMaterialization: materialization,
      },
      rootWorkItemId: current.rootWorkItemId,
      status: current.status,
      enacted:
        current.status === WorkItemChangeSetMaterializationStatus.PUBLISHED,
    };
  }

  private async requirePublishedResult(materializationId: string): Promise<{
    proposal: ProposalWithResponseRelations;
    rootWorkItemId: string | null;
  }> {
    const completed =
      await this.prisma.db.workItemChangeSetMaterialization.findUniqueOrThrow({
        where: { id: materializationId },
        include: {
          checkpoints: true,
          proposal: { include: PROPOSAL_RESPONSE_BASE_RELATIONS_INCLUDE },
        },
      });
    if (
      completed.status !== WorkItemChangeSetMaterializationStatus.PUBLISHED ||
      completed.checkpoints.some(
        (checkpoint) =>
          this.isPublicationGatedCheckpoint(checkpoint) &&
          (checkpoint.status !== WorkItemChangeSetCheckpointStatus.COMPLETED ||
            checkpoint.validationRevision !== completed.validationRevision),
      )
    ) {
      throw new Error(
        'Generic work-item change set remains recoverable and is not yet published.',
      );
    }
    if (
      completed.rootWorkItemId &&
      completed.proposal.targetEntityId !== completed.rootWorkItemId
    ) {
      throw new ConflictException(
        'Published generic proposal target does not match its materialized root identity.',
      );
    }
    if (completed.proposal.status !== 'APPROVED') {
      throw new ConflictException(
        'Published generic change set is not bound to an approved proposal.',
      );
    }
    const { proposal, ...materialization } = completed;
    return {
      proposal: {
        ...proposal,
        workItemChangeSetMaterialization: materialization,
      },
      rootWorkItemId: completed.rootWorkItemId,
    };
  }

  private async handoffDeferredEntityEdgesAfterChangeSetPublication(
    materializationId: string,
    proposal: Proposal,
  ): Promise<void> {
    try {
      const declarations =
        (proposal.edges as unknown as ProposalEdgeDeclaration[] | null)?.filter(
          (edge) =>
            edge.endpointMode !== ProposalEdgeEndpointMode.Proposal &&
            edge.targetEntityType === 'PROPOSAL',
        ) ?? [];
      const pendingEdgeService = this.pendingEdgeService;
      const targetIds = await this.prisma.db.$transaction(async (tx) => {
        const intent =
          await tx.workItemChangeSetMaterialization.findUniqueOrThrow({
            where: { id: materializationId },
          });
        const previous =
          await tx.workItemChangeSetMaterializationCheckpoint.findFirst({
            where: { materializationId, operationIndex: -1 },
          });
        if (!previous) {
          const request =
            intent.operationSet as unknown as WorkItemChangeSetValidationRequest;
          const mappings = this.readIdentityMappings(intent);
          const handedOff = new Set<string>();
          for (const edge of declarations) {
            const target = await tx.proposal.findFirst({
              where: {
                id: edge.targetEntityId,
                organizationId: proposal.organizationId,
                projectId: proposal.projectId,
              },
              select: { status: true },
            });
            if (target?.status === 'REJECTED') continue;
            const sourceEntityId = this.resolveWorkItemId(
              edge.sourceRef ?? request.root,
              mappings.workItems,
            );
            const key = [
              proposal.id,
              sourceEntityId,
              edge.targetEntityId,
              edge.edgeType,
            ].join(':');
            if (handedOff.has(key)) continue;
            handedOff.add(key);
            await pendingEdgeService.storeDeferredEntityEdgeAfterChangeSetPublication(
              tx,
              {
                organizationId: proposal.organizationId,
                projectId: proposal.projectId,
                sourceProposalId: proposal.id,
                sourceEntityId,
                targetProposalId: edge.targetEntityId,
                edgeType: edge.edgeType as PrismaProposalEdgeType,
                description: edge.description,
              },
            );
          }
          await tx.workItemChangeSetMaterializationCheckpoint.create({
            data: {
              materializationId,
              operationIndex: -1,
              operationKind: 'deferredEdges.handoff',
              validationRevision: intent.validationRevision,
              status: WorkItemChangeSetCheckpointStatus.COMPLETED,
              completedAt: new Date(),
            },
          });
        }
        const targets = await tx.proposal.findMany({
          where: {
            id: { in: declarations.map((edge) => edge.targetEntityId) },
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
            status: 'APPROVED',
          },
        });
        return targets;
      });
      for (const target of targetIds) {
        if (target.targetEntityId) {
          await pendingEdgeService.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal(
            target,
            target.targetEntityId,
          );
        }
      }
      if (proposal.targetEntityId) {
        await pendingEdgeService.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal(
          proposal,
          proposal.targetEntityId,
        );
      }
    } catch (error) {
      this.logger.error(
        'Published change-set deferred entity-edge handoff remains retryable',
        {
          proposalId: proposal.id,
          materializationId,
          error,
        },
      );
    }
  }

  async enqueuePreparedIntent(
    tx: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      reservedRootWorkItemId?: TaskId;
      prepared: PreparedChangeSetProjection;
    },
  ): Promise<MaterializationWithCheckpoints> {
    return this.prepareIntentInTransaction(tx, params);
  }

  // Projects on the default client: callers run this before their transaction
  // so the Graph and pooled reads never pin a transaction connection.
  async projectPreparation(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    request: WorkItemChangeSetValidationRequest;
  }): Promise<PreparedChangeSetProjection> {
    const operationSet = normalizeDiagramChangeSet(params.request);
    const validationRevision = this.validationRevision(operationSet);
    const snapshots = await this.projector.projectSnapshots({
      organizationId: params.organizationId,
      projectId: params.projectId,
      request: operationSet,
    });
    this.logger.debug('Projected generic change-set preparation', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      validationRevision,
      valid: snapshots.target.valid,
      issueCount: snapshots.target.issues.length,
    });
    return { operationSet, validationRevision, snapshots };
  }

  validationRevision(request: WorkItemChangeSetValidationRequest): string {
    return createHash('sha256').update(stableStringify(request)).digest('hex');
  }

  isWorkItemChangeSetValidationRequest(
    value: unknown,
  ): value is WorkItemChangeSetValidationRequest {
    return isWorkItemChangeSetValidationRequest(value);
  }

  /**
   * Adapt an ordinary task proposal to the same durable operation contract as
   * a graph-shaped proposal. The original proposal remains authoritative for
   * task-only fields that the graph operation contract intentionally does not
   * model; checkpoint application merges those fields back in from the
   * proposal row.
   */
  taskProposalChangeSet(
    proposal: Pick<
      Proposal,
      | 'id'
      | 'action'
      | 'targetEntityType'
      | 'targetEntityId'
      | 'updates'
      | 'projectId'
      | 'edges'
    >,
  ): WorkItemChangeSetValidationRequest | null {
    if (
      proposal.targetEntityType !== 'TASK' ||
      !['CREATE', 'UPDATE', 'DELETE'].includes(proposal.action)
    ) {
      return null;
    }
    if (this.isWorkItemChangeSetValidationRequest(proposal.updates)) {
      return null;
    }

    const updates = this.requireTaskProposalPayload(proposal.updates);
    // Structured FEATURE requirements are prepared into one canonical JSON
    // section before a proposal is stored. The generic graph operation
    // contract has no representation for raw initialRequirements or
    // requirementOps, so retain the ordinary path for any legacy/unprepared
    // payload rather than silently dropping those fields while translating the
    // surrounding task fields.
    if (proposalWriteFacts(proposal).hasUnpreparedRequirements) {
      return null;
    }
    const taskUpdates = updates as unknown as CreateTaskDto;
    const root =
      proposal.action === 'CREATE'
        ? ({ refType: 'temporary', tempId: 'root' } as const)
        : ({ refType: 'existing', id: proposal.targetEntityId } as const);
    const declaredEdgeOperations = this.taskProposalDeclaredEdgeOperations(
      proposal,
      root,
    );
    if (declaredEdgeOperations === null) {
      return null;
    }

    if (proposal.action === 'DELETE') {
      return {
        root,
        operations: [
          {
            op: 'workItem.delete',
            ref: root,
          },
        ],
      } satisfies WorkItemChangeSetValidationRequest;
    }

    if (proposal.action === 'CREATE') {
      const create = this.toTaskCreateOperation(updates, root);
      const operations: WorkItemChangeSetOperation[] = [create];
      this.appendCreateSectionOperations(
        operations,
        root,
        taskUpdates.sections,
        taskUpdates.type ?? 'STANDARD',
        proposal.projectId as ProjectId | undefined,
      );
      if (taskUpdates.type === 'workflow') {
        this.appendWorkflowOperations(
          operations,
          updates,
          root,
          proposal.projectId as ProjectId | undefined,
        );
      }
      operations.push(...declaredEdgeOperations);
      return { root, operations } satisfies WorkItemChangeSetValidationRequest;
    }

    const update: WorkItemUpdateOperation = {
      op: 'workItem.update',
      ref: root,
    };
    this.copyTaskUpdateOperationFields(update, updates);
    const operations: WorkItemChangeSetOperation[] = [update];
    this.appendSectionOperations(
      operations,
      root,
      (updates as unknown as UpdateTaskDto).sections,
    );
    // Section operations already own root existence, scope and checkpoint proof.
    // Keep fieldless updates for empty/edge-only proposals; only omit the extra
    // checkpoint when a section edit carries the same root through enactment.
    if (operations.length > 1 && Object.keys(update).length === 2) {
      operations.shift();
    }
    operations.push(...declaredEdgeOperations);
    return { root, operations } satisfies WorkItemChangeSetValidationRequest;
  }

  /**
   * Fold ordinary task-to-task declarations into the durable operation set so
   * approval cannot publish the task mutation while silently dropping its
   * relationships. Declarations that require the legacy proposal-edge
   * protocol (proposal/design-doc targets, BLOCKS, TRACKS, or the atomic
   * SUPERSEDES transition) leave the whole proposal on that protocol.
   */
  private taskProposalDeclaredEdgeOperations(
    proposal: Pick<Proposal, 'action' | 'edges'>,
    root: WorkItemChangeSetIdentity,
  ): WorkItemRelationshipCreateOperation[] | null {
    const edges = (
      proposal.edges as unknown as ProposalEdgeDeclaration[] | null
    )?.filter(
      (edge) => edge.endpointMode !== ProposalEdgeEndpointMode.Proposal,
    );
    if (!edges || edges.length === 0) {
      return [];
    }
    if (proposal.action === 'DELETE') {
      return null;
    }

    const durableEdgeTypes: ReadonlySet<ProposalEdgeDeclaration['edgeType']> =
      new Set([
        'DEPENDS_ON',
        'RELATED_TO',
        'DERIVES_FROM',
        'CONTRADICTS',
        'EVOLVES',
      ]);
    if (
      edges.some(
        (edge) =>
          edge.targetEntityType !== 'TASK' ||
          !durableEdgeTypes.has(edge.edgeType),
      )
    ) {
      return null;
    }

    return edges.map((edge, index) => ({
      op: 'relationship.create' as const,
      ref: {
        refType: 'temporary' as const,
        tempId: `proposal-edge-${index}`,
      },
      source: root,
      target: { refType: 'existing' as const, id: edge.targetEntityId },
      edgeType: edge.edgeType as DurableProposalEdgeType,
      category: 'meta' as const,
      reasoning:
        edge.description ?? `Declared via proposal edge (${edge.edgeType})`,
    }));
  }

  private requireTaskProposalPayload(value: unknown): TaskProposalPayload {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(
        'Task proposal updates must be an object before approval.',
      );
    }
    return value as TaskProposalPayload;
  }

  private toTaskCreateOperation(
    updates: TaskProposalPayload,
    root: WorkItemChangeSetIdentity,
  ): WorkItemCreateOperation {
    const taskUpdates = updates as unknown as CreateTaskDto;
    if (typeof taskUpdates.name !== 'string' || taskUpdates.name.length === 0) {
      throw new BadRequestException(
        'Task CREATE proposal updates must include a non-empty name.',
      );
    }
    const operation = taskCreateOperation(
      taskUpdates,
      root as WorkItemCreateOperation['ref'],
    );
    if (Object.prototype.hasOwnProperty.call(updates, 'serviceIds')) {
      operation.serviceIds = this.requireServiceIds(updates.serviceIds);
    }
    return operation;
  }

  private copyTaskUpdateOperationFields(
    operation: WorkItemUpdateOperation,
    updates: TaskProposalPayload,
  ): void {
    Object.assign(
      operation,
      taskUpdateOperation(updates as unknown as UpdateTaskDto, operation.ref),
    );
    if (Object.prototype.hasOwnProperty.call(updates, 'serviceIds')) {
      operation.serviceIds = this.requireServiceIds(updates.serviceIds);
    }
  }

  private appendSectionOperations(
    operations: WorkItemChangeSetOperation[],
    ref: WorkItemChangeSetIdentity,
    sections: TaskSectionInput[] | undefined,
  ): void {
    for (const section of sections ?? []) {
      operations.push({
        op: 'section.replace',
        ref,
        key: section.key,
        content: section.content,
      });
    }
  }

  private appendCreateSectionOperations(
    operations: WorkItemChangeSetOperation[],
    ref: WorkItemChangeSetIdentity,
    sections: TaskSectionInput[] | undefined,
    taskType: string,
    projectId: ProjectId | undefined,
  ): void {
    if (!projectId) {
      this.appendSectionOperations(operations, ref, sections);
      return;
    }

    const suppliedByKey = new Map(
      (sections ?? []).map((section) => [section.key, section]),
    );
    for (const definition of this.workItemTypeRegistry.getSectionDefinitions(
      taskType,
      projectId,
    )) {
      const supplied = suppliedByKey.get(definition.key);
      const contentKind = resolveWorkItemSectionContentKind(definition);
      if (supplied) {
        if (contentKind !== 'markdown' && supplied.content === null) continue;
        operations.push({
          op: 'section.replace',
          ref,
          key: supplied.key,
          content:
            definition.schemaRef === PROJECT_MODE_FILES_SCHEMA_REF
              ? this.taskSectionSchemaValidators.canonicalize(
                  definition,
                  supplied.content,
                )
              : definition.schemaRef === PROJECT_MODE_SETTINGS_SCHEMA_REF
                ? this.canonicalizeProjectModeSettings(
                    definition,
                    supplied.content,
                    projectId,
                  )
                : supplied.content,
        });
      } else if (contentKind === 'markdown') {
        operations.push({
          op: 'section.replace',
          ref,
          key: definition.key,
          content: '',
        });
      }
    }
  }

  // Approval must reject keys outside the effective registry before
  // persistence, matching the structural settings checks above it.
  private canonicalizeProjectModeSettings(
    definition: WorkItemTypeSectionDefinition,
    content: unknown,
    projectId: ProjectId,
  ): string {
    const canonical = this.taskSectionSchemaValidators.canonicalize(
      definition,
      content,
    );
    const ineligible = findIneligibleProjectModeTypeKeys(
      JSON.parse(canonical) as ProjectModeSettings,
      (typeKey) =>
        this.workItemTypeRegistry.isTypeActiveForProject(typeKey, projectId),
    );
    if (ineligible.length > 0) {
      throw new BadRequestException(
        `Eligible work-item type keys must be active in the project's effective registry: ${ineligible.join(', ')}`,
      );
    }
    return canonical;
  }

  private appendWorkflowOperations(
    operations: WorkItemChangeSetOperation[],
    updates: TaskProposalPayload,
    root: WorkItemChangeSetIdentity,
    projectId: ProjectId | undefined,
  ): void {
    const taskUpdates = updates as unknown as CreateTaskDto;
    for (const step of taskUpdates.workflowSteps ?? []) {
      const stepRef = {
        refType: 'temporary' as const,
        tempId: `workflowStep:${step.tempId}`,
      };
      operations.push({
        op: 'workItem.create',
        ref: stepRef,
        name: step.name,
        type: 'DIAGRAM_ELEMENT',
        parent: root,
        ...(step.status !== undefined ? { status: step.status } : {}),
        ...(step.priority !== undefined ? { priority: step.priority } : {}),
        ...(step.dueDate !== undefined ? { dueDate: step.dueDate } : {}),
        ...(step.assigneeId !== undefined
          ? { assigneeId: step.assigneeId }
          : {}),
      } satisfies WorkItemCreateOperation);
      this.appendCreateSectionOperations(
        operations,
        stepRef,
        step.sections,
        'workflow_step',
        projectId,
      );
    }

    for (const [index, link] of (taskUpdates.workflowLinks ?? []).entries()) {
      const source = {
        refType: 'temporary' as const,
        tempId: `workflowStep:${link.sourceStepTempId}`,
      };
      const target =
        link.type === 'FULFILLED_BY'
          ? { refType: 'existing' as const, id: link.targetTaskId }
          : link.type === 'LOOP' && !link.targetStepTempId
            ? source
            : {
                refType: 'temporary' as const,
                tempId: `workflowStep:${link.targetStepTempId}`,
              };
      const common = {
        op: 'relationship.create' as const,
        ref: {
          refType: 'temporary' as const,
          tempId: `workflowLink:${index}`,
        },
        source,
        target,
        reasoning: link.description ?? null,
      };
      const operation =
        link.type === 'CONDITIONAL'
          ? ({
              ...common,
              edgeType: link.type,
              category: 'flow',
              direction: link.direction,
              predicate: link.predicate,
            } satisfies WorkItemRelationshipCreateOperation)
          : link.type === 'STANDARD'
            ? ({
                ...common,
                edgeType: link.type,
                category: 'flow',
                direction: link.direction,
              } satisfies WorkItemRelationshipCreateOperation)
            : link.type === 'LOOP'
              ? ({
                  ...common,
                  edgeType: link.type,
                  category: 'flow',
                  ...(link.predicate !== undefined
                    ? { predicate: link.predicate }
                    : {}),
                } satisfies WorkItemRelationshipCreateOperation)
              : ({
                  ...common,
                  edgeType: link.type,
                  category: 'meta',
                } satisfies WorkItemRelationshipCreateOperation);
      operations.push(operation);
    }
  }

  // Prepare runs without a transaction: under READ COMMITTED one would give no
  // consistent snapshot across the Graph and pooled task reads, and the unique
  // proposalId constraint already makes concurrent prepares converge. Holding
  // one would only pin an idle pooled connection while those reads run.
  private async prepareIntent(params: {
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    reservedRootWorkItemId?: TaskId;
    request?: WorkItemChangeSetValidationRequest;
  }): Promise<MaterializationWithCheckpoints> {
    const db = this.prisma.db;
    const proposal = await this.findProposalForPreparation(db, params);
    assertProposalApplicationEligible(proposal, 'materializeApprovedChangeSet');
    const existing = await this.findExistingIntent(db, proposal.id);
    if (existing) {
      return this.resumeExistingIntent(
        db,
        params,
        proposal,
        existing,
        this.resolvePreparationOperationSet(params, proposal, existing)
          .validationRevision,
      );
    }
    const { operationSet } = this.resolvePreparationOperationSet(
      params,
      proposal,
      null,
    );
    const prepared = await this.projectPreparation({
      organizationId: params.organizationId,
      projectId: params.projectId,
      request: operationSet,
    });
    try {
      return await this.createIntent(db, params, proposal, prepared);
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const winner = await this.findExistingIntent(db, proposal.id);
      if (!winner) throw error;
      this.logger.log(
        'Concurrent generic change-set prepare stored the intent first; resuming it',
        { proposalId: proposal.id, materializationId: winner.id },
      );
      return this.resumeExistingIntent(
        db,
        params,
        proposal,
        winner,
        prepared.validationRevision,
      );
    }
  }

  private async prepareIntentInTransaction(
    tx: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      reservedRootWorkItemId?: TaskId;
      prepared: PreparedChangeSetProjection;
    },
  ): Promise<MaterializationWithCheckpoints> {
    const proposal = await this.findProposalForPreparation(tx, params);
    const existing = await this.findExistingIntent(tx, proposal.id);
    return existing
      ? this.resumeExistingIntent(
          tx,
          params,
          proposal,
          existing,
          params.prepared.validationRevision,
        )
      : this.createIntent(tx, params, proposal, params.prepared);
  }

  private async findProposalForPreparation(
    db: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
  ): Promise<Proposal> {
    const proposal = (await db.proposal.findFirst({
      where: {
        id: params.proposalId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
    })) as Proposal | null;
    if (!proposal) {
      throw new BadRequestException('Proposal not found for materialization.');
    }
    return proposal;
  }

  private async findExistingIntent(
    db: AnyTransactionClient,
    proposalId: string,
  ): Promise<MaterializationWithCheckpoints | null> {
    return (await db.workItemChangeSetMaterialization.findUnique({
      where: { proposalId },
      include: { checkpoints: true },
    })) as MaterializationWithCheckpoints | null;
  }

  private resolvePreparationOperationSet(
    params: { request?: WorkItemChangeSetValidationRequest },
    proposal: Proposal,
    existing: MaterializationWithCheckpoints | null,
  ): {
    operationSet: WorkItemChangeSetValidationRequest;
    validationRevision: string;
  } {
    const rawOperationSet: unknown =
      params.request ?? (existing?.operationSet as unknown) ?? proposal.updates;
    if (!this.isWorkItemChangeSetValidationRequest(rawOperationSet)) {
      throw new BadRequestException(
        'Proposal updates are not a generic work-item change set.',
      );
    }

    const operationSet =
      !existing ||
      existing.validationRevision !== this.validationRevision(rawOperationSet)
        ? normalizeDiagramChangeSet(rawOperationSet)
        : rawOperationSet;
    return {
      operationSet,
      validationRevision: this.validationRevision(operationSet),
    };
  }

  private async resumeExistingIntent(
    db: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      reservedRootWorkItemId?: TaskId;
    },
    proposal: Proposal,
    existing: MaterializationWithCheckpoints,
    validationRevision: string,
  ): Promise<MaterializationWithCheckpoints> {
    if (existing.validationRevision !== validationRevision) {
      throw new BadRequestException(
        'Stored work-item change-set validation revision does not match the proposal updates.',
      );
    }
    this.assertRecoverableIntent(existing);
    if (
      params.reservedRootWorkItemId &&
      existing.rootWorkItemId !== params.reservedRootWorkItemId
    ) {
      throw new ConflictException(
        'Stored generic change-set root identity does not match the grouped member reservation.',
      );
    }
    this.logger.log('Resuming generic change-set materialization intent', {
      proposalId: proposal.id,
      materializationId: existing.id,
      status: existing.status,
      validationRevision,
    });
    if (
      existing.status === WorkItemChangeSetMaterializationStatus.PREPARED &&
      !(existing.targetProjection as unknown as StoredProjection).projection
        .valid
    ) {
      return this.reprojectInvalidPreparedIntent(db, params, existing);
    }
    return existing;
  }

  private async createIntent(
    db: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      reservedRootWorkItemId?: TaskId;
    },
    proposal: Proposal,
    prepared: PreparedChangeSetProjection,
  ): Promise<MaterializationWithCheckpoints> {
    const {
      operationSet,
      validationRevision,
      snapshots: projections,
    } = prepared;
    this.logger.debug('Checked generic change-set context before intent', {
      proposalId: proposal.id,
      valid: projections.target.valid,
      issueCount: projections.target.issues.length,
      validationRevision,
    });
    const projectionFailure = projections.target.valid
      ? undefined
      : {
          message: 'Cannot materialize an invalid work-item change set',
          diagnostic: toProposalApprovalFailureDiagnostic(projections.target),
        };
    if (!projections.target.valid) {
      this.logger.warn(
        'Stored generic change-set projection requires recovery',
        {
          proposalId: proposal.id,
          issueCount: projections.target.issues.length,
          issues: projections.target.issues,
          diagnostic: projectionFailure!.diagnostic,
        },
      );
    }

    if (params.reservedRootWorkItemId) {
      if (operationSet.root.refType !== 'temporary') {
        throw new BadRequestException(
          'A grouped graph-shaped CREATE requires a temporary root identity.',
        );
      }
      const collision = await db.task.findUnique({
        where: { id: params.reservedRootWorkItemId },
        select: { id: true },
      });
      if (collision) {
        this.logger.warn(
          'Rejected grouped generic change-set reserved identity collision',
          {
            proposalId: proposal.id,
            reservedRootWorkItemId: params.reservedRootWorkItemId,
          },
        );
        throw new ConflictException(
          'Reserved grouped work-item identity is already materialized by unrelated state.',
        );
      }
    }

    const mappings = this.allocateIdentityMappings(
      operationSet,
      params.reservedRootWorkItemId,
    );
    this.includeProjectionIdentities(mappings, projections.prior);
    this.includeProjectionIdentities(mappings, projections.target);
    const priorWorkItems = await this.capturePriorSectionSnapshots(
      db,
      params.organizationId,
      operationSet,
      mappings,
      projections.unavailableWorkItemIds,
    );
    const rootWorkItemId = this.resolveWorkItemId(
      operationSet.root,
      mappings.workItems,
    );
    const requirementCitationEdges = this.planRequirementCitationEdges(
      proposal.id,
      operationSet,
      rootWorkItemId,
      priorWorkItems,
    );
    operationSet.operations.forEach((operation, operationIndex) => {
      this.logOperationInput(
        proposal.id,
        undefined,
        operationIndex,
        operation,
        'before_persistence',
      );
    });
    const created = await db.workItemChangeSetMaterialization.create({
      data: {
        proposalId: proposal.id,
        organizationId: params.organizationId,
        projectId: params.projectId,
        rootWorkItemId,
        validationRevision,
        operationSet: operationSet as unknown as Prisma.InputJsonValue,
        workItemIdMappings:
          mappings.workItems as unknown as Prisma.InputJsonValue,
        relationshipIdMappings:
          mappings.relationships as unknown as Prisma.InputJsonValue,
        priorProjection: this.storedProjection(
          projections.prior,
          priorWorkItems,
          requirementCitationEdges,
        ),
        targetProjection: this.storedProjection(projections.target),
        ...(projectionFailure
          ? {
              lastError: serializeProposalApprovalFailure(
                projectionFailure.message,
                projectionFailure.diagnostic,
              ),
            }
          : {}),
        affectedWorkItemIds: projectionFootprintIds(
          projections.workItemKeys,
          mappings.workItems,
        ),
        affectedRelationshipIds: projectionFootprintIds(
          projections.relationshipKeys,
          mappings.relationships,
        ),
        priorProjectionRevision: validationRevision,
        checkpoints: {
          create: [
            ...(
              operationSet as unknown as WorkItemChangeSetValidationRequest
            ).operations.map((operation, index) => ({
              id: uuidv4(),
              operationIndex: index,
              operationKind: operation.op,
              validationRevision,
            })),
            ...(requirementCitationEdges
              ? [
                  {
                    id: uuidv4(),
                    operationIndex: REQUIREMENT_CITATION_CHECKPOINT_INDEX,
                    operationKind: REQUIREMENT_CITATION_CHECKPOINT_KIND,
                    validationRevision,
                  },
                ]
              : []),
          ],
        },
      },
      include: { checkpoints: true },
    });
    this.logger.log('Stored generic change-set materialization intent', {
      proposalId: proposal.id,
      materializationId: created.id,
      validationRevision,
      operationCount: operationSet.operations.length,
      rootWorkItemId,
      requirementCitationEdgeCreates:
        requirementCitationEdges?.creates.length ?? 0,
      requirementCitationEdgeDeletes:
        requirementCitationEdges?.deletes.length ?? 0,
    });
    return created;
  }

  /**
   * Derive the root FEATURE's requirement citation edges when the change set
   * writes its requirements section. The prior cited set comes from the
   * snapshot captured for this intent, so retries never re-derive it from
   * state the change set has already modified.
   */
  private planRequirementCitationEdges(
    proposalId: string,
    operationSet: WorkItemChangeSetValidationRequest,
    rootWorkItemId: string,
    priorWorkItems: Record<string, PriorSectionSnapshot>,
  ): RequirementCitationEdgeDiff | undefined {
    const rootKey = this.workItemKey(operationSet.root);
    const isRoot = (ref: WorkItemChangeSetIdentity) =>
      this.workItemKey(ref) === rootKey;
    const priorRoot = priorWorkItems[rootWorkItemId];
    const rootCreate = operationSet.operations.find(
      (operation): operation is WorkItemCreateOperation =>
        operation.op === 'workItem.create' && isRoot(operation.ref),
    );
    const rootType = rootCreate
      ? (rootCreate.type ?? 'STANDARD')
      : priorRoot?.type;
    if (rootType !== 'FEATURE') return undefined;

    const requirementsWrite = operationSet.operations
      .filter(
        (
          operation,
        ): operation is Extract<
          WorkItemChangeSetOperation,
          { op: 'section.replace' | 'section.clear' }
        > =>
          (operation.op === 'section.replace' ||
            operation.op === 'section.clear') &&
          operation.key === FEATURE_REQUIREMENTS_SECTION_KEY &&
          isRoot(operation.ref),
      )
      .at(-1);
    if (!requirementsWrite) return undefined;

    const priorContent = priorRoot?.sections?.find(
      (section) => section.key === FEATURE_REQUIREMENTS_SECTION_KEY,
    )?.materializedMarkdown;
    const nextContent =
      requirementsWrite.op === 'section.replace'
        ? requirementsWrite.content
        : undefined;

    let diff: RequirementCitationEdgeDiff;
    try {
      diff = diffRequirementCitationEdges(
        rootWorkItemId,
        priorContent,
        nextContent,
      );
    } catch (error) {
      if (!(error instanceof FeatureRequirementsReadError)) throw error;
      // Unconverted legacy content cites nothing the derivation can identify;
      // the next set must still be canonical.
      try {
        diff = diffRequirementCitationEdges(
          rootWorkItemId,
          undefined,
          nextContent,
        );
      } catch (nextError) {
        if (!(nextError instanceof FeatureRequirementsReadError)) {
          throw nextError;
        }
        throw new BadRequestException(nextError.message);
      }
      this.logger.warn(
        'Prior FEATURE requirements are not canonical; no citation edges will be removed',
        { proposalId, featureId: rootWorkItemId, code: error.code },
      );
    }
    this.logger.log('Planned requirement citation edges', {
      proposalId,
      featureId: rootWorkItemId,
      creates: diff.creates.length,
      deletes: diff.deletes.length,
    });
    return hasRequirementCitationEdgeChanges(diff) ? diff : undefined;
  }

  private async reprojectInvalidPreparedIntent(
    db: AnyTransactionClient,
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    existing: MaterializationWithCheckpoints,
  ): Promise<MaterializationWithCheckpoints> {
    const operationSet =
      existing.operationSet as unknown as WorkItemChangeSetValidationRequest;
    const mappings = this.readIdentityMappings(existing);
    const projections = await this.projector.projectSnapshots({
      organizationId: params.organizationId,
      projectId: params.projectId,
      request: operationSet,
    });
    const projectionFailure = projections.target.valid
      ? null
      : serializeProposalApprovalFailure(
          'Cannot materialize an invalid work-item change set',
          toProposalApprovalFailureDiagnostic(projections.target),
        );

    this.logger.log('Refreshed invalid prepared change-set projection', {
      proposalId: params.proposalId,
      materializationId: existing.id,
      valid: projections.target.valid,
      issueCount: projections.target.issues.length,
    });

    return db.workItemChangeSetMaterialization.update({
      where: { id: existing.id },
      data: {
        targetProjection: this.storedProjection(projections.target),
        affectedWorkItemIds: projectionFootprintIds(
          projections.workItemKeys,
          mappings.workItems,
        ),
        affectedRelationshipIds: projectionFootprintIds(
          projections.relationshipKeys,
          mappings.relationships,
        ),
        lastError: projectionFailure,
      },
      include: { checkpoints: true },
    });
  }

  private async claimPreparedIntent(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    materializationId: string,
  ): Promise<MaterializationWithCheckpoints | null> {
    return this.prisma.db.$transaction(async (tx) => {
      await withApiSpan('proposal.change_set.advisory_lock', () =>
        tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.organizationId}:${params.projectId}`}, 0))::text AS "lockAcquired"`,
        ),
      );
      const replacement = await tx.proposalReconciliationReplacement.findFirst({
        where: { proposalId: params.proposalId },
      });
      if (replacement) {
        const replacementGroup = replacement.replacementGroupId
          ? await tx.proposalGroup.findUnique({
              where: { id: replacement.replacementGroupId },
              select: { status: true },
            })
          : null;
        if (
          !replacement.replacementGroupId ||
          replacementGroup?.status !== 'BUILDING'
        ) {
          throw new ConflictException(
            'This proposal has a reconciled replacement requiring fresh review.',
          );
        }
      }
      const now = new Date();
      const active = await tx.workItemChangeSetMaterialization.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          status: WorkItemChangeSetMaterializationStatus.APPLYING,
          claimExpiresAt: { gt: now },
        },
        select: {
          id: true,
          affectedWorkItemIds: true,
          affectedRelationshipIds: true,
        },
      });
      const selected = await tx.workItemChangeSetMaterialization.findFirst({
        where: {
          id: materializationId,
          proposalId: params.proposalId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          status: {
            in: [
              WorkItemChangeSetMaterializationStatus.PREPARED,
              WorkItemChangeSetMaterializationStatus.APPLYING,
            ],
          },
          OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
        },
        include: { checkpoints: true },
      });
      if (!selected) return null;
      if (
        active.some(
          (candidate) =>
            candidate.id === selected.id ||
            this.materializationFootprintsOverlap(candidate, selected),
        )
      ) {
        return null;
      }
      const claimToken = uuidv4();
      return tx.workItemChangeSetMaterialization.update({
        where: { id: selected.id },
        data: {
          status: WorkItemChangeSetMaterializationStatus.APPLYING,
          claimToken,
          claimExpiresAt: new Date(
            now.getTime() + WorkItemChangeSetMaterializerService.CLAIM_TTL_MS,
          ),
        },
        include: { checkpoints: true },
      });
    });
  }

  private materializationFootprintsOverlap(
    left: Pick<
      WorkItemChangeSetMaterialization,
      'affectedWorkItemIds' | 'affectedRelationshipIds'
    >,
    right: Pick<
      WorkItemChangeSetMaterialization,
      'affectedWorkItemIds' | 'affectedRelationshipIds'
    >,
  ): boolean {
    const leftWorkItems = this.readFootprintIds(left.affectedWorkItemIds);
    const rightWorkItems = this.readFootprintIds(right.affectedWorkItemIds);
    const leftRelationships = this.readFootprintIds(
      left.affectedRelationshipIds,
    );
    const rightRelationships = this.readFootprintIds(
      right.affectedRelationshipIds,
    );
    if (
      !leftWorkItems ||
      !rightWorkItems ||
      !leftRelationships ||
      !rightRelationships
    ) {
      return true;
    }
    return (
      leftWorkItems.some((id) => rightWorkItems.includes(id)) ||
      leftRelationships.some((id) => rightRelationships.includes(id))
    );
  }

  private readFootprintIds(value: Prisma.JsonValue | null): string[] | null {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
      return null;
    }
    return value as string[];
  }

  private async applyPreparedIntent(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    prepared: MaterializationWithCheckpoints,
    claimToken: string,
  ): Promise<void> {
    const request =
      prepared.operationSet as unknown as WorkItemChangeSetValidationRequest;
    const effectiveParentIds = this.effectiveParentIds(request, prepared);
    request.operations.forEach((operation, operationIndex) => {
      this.logOperationInput(
        params.proposalId,
        prepared.id,
        operationIndex,
        operation,
        'after_reload',
      );
    });
    const validationRevision = this.validationRevision(request);
    if (prepared.validationRevision !== validationRevision) {
      throw new BadRequestException(
        'Stored work-item change-set validation revision does not match the operation set.',
      );
    }
    const mappings = this.readIdentityMappings(prepared);
    this.assertRecoverableIntent(prepared);
    await this.markIntentAttempt(prepared.id, claimToken);

    const indexedOperations = request.operations.map((operation, index) => ({
      operation,
      index,
    }));
    for (let cursor = 0; cursor < indexedOperations.length; ) {
      const indexedOperation = indexedOperations[cursor]!;
      if (indexedOperation.operation.op === 'relationship.create') {
        const relationshipCreates = [];
        while (
          cursor < indexedOperations.length &&
          indexedOperations[cursor]!.operation.op === 'relationship.create'
        ) {
          const candidate = indexedOperations[cursor]!;
          relationshipCreates.push({
            operation: candidate.operation as Extract<
              WorkItemChangeSetOperation,
              { op: 'relationship.create' }
            >,
            index: candidate.index,
            checkpoint: this.requireCheckpoint(
              prepared,
              candidate.index,
              validationRevision,
            ),
          });
          cursor += 1;
        }
        await this.applyRelationshipCreateBatch(
          params,
          prepared,
          relationshipCreates,
          mappings,
          claimToken,
        );
        continue;
      }
      const checkpoint = this.requireCheckpoint(
        prepared,
        indexedOperation.index,
        validationRevision,
      );
      await this.applyCheckpoint(
        params,
        prepared,
        checkpoint,
        indexedOperation.operation,
        mappings,
        claimToken,
        effectiveParentIds,
      );
      cursor += 1;
    }
    await this.applyRequirementCitationEdges(
      params,
      prepared,
      validationRevision,
      claimToken,
    );
  }

  private storedRequirementCitationEdges(
    materialization: WorkItemChangeSetMaterialization,
  ): RequirementCitationEdgeDiff | undefined {
    return (materialization.priorProjection as unknown as StoredProjection)
      .requirementCitationEdges;
  }

  private async applyRequirementCitationEdges(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    prepared: MaterializationWithCheckpoints,
    validationRevision: string,
    claimToken: string,
  ): Promise<void> {
    const plan = this.storedRequirementCitationEdges(prepared);
    if (!plan) return;
    const checkpoint = this.requireCheckpoint(
      prepared,
      REQUIREMENT_CITATION_CHECKPOINT_INDEX,
      validationRevision,
    );
    if (checkpoint.status === WorkItemChangeSetCheckpointStatus.COMPLETED) {
      this.logger.debug('Requirement citation edges already applied', {
        proposalId: params.proposalId,
        materializationId: prepared.id,
      });
      return;
    }

    await this.renewClaim(prepared.id, claimToken);
    await this.markCheckpointApplying(prepared.id, checkpoint.id, claimToken);
    const token = this.tokenFactory(params.organizationId, params.projectId);
    try {
      const results = await this.agentEdgeClient.createBatch(
        params.organizationId,
        params.projectId,
        plan.creates.map(toRequirementCitationEdgeDto),
        token,
        prepared.id,
      );
      const failures = results.filter(
        (result) =>
          !result.success ||
          !result.edge ||
          !this.requirementCitationEdgeMatches(
            result.edge,
            plan.creates[result.index]!,
          ),
      );
      if (failures.length > 0) {
        // Graph may refuse a second DEPENDS_ON between a pair that already
        // has a declared one. That is reported, never accepted silently.
        this.logger.error('Requirement citation edge creation failed', {
          proposalId: params.proposalId,
          materializationId: prepared.id,
          failures: failures.map((result) => ({
            edgeId: plan.creates[result.index]?.id,
            featureId: plan.creates[result.index]?.featureId,
            targetEntityId: plan.creates[result.index]?.entityId,
            error: result.error ?? 'Created edge did not match its citation.',
          })),
        });
        throw new InternalServerErrorException(
          `Failed to create ${failures.length} requirement citation edge(s) in graph service.`,
        );
      }
      for (const edge of plan.deletes) {
        await this.agentEdgeClient.delete(
          params.organizationId,
          params.projectId,
          edge.id,
          token,
          'Feature requirements no longer cite this entity.',
          prepared.id,
        );
      }
    } catch (error) {
      await this.markCheckpointFailed(
        prepared.id,
        checkpoint.id,
        claimToken,
        error,
      );
      throw error;
    }
    await this.markCheckpointCompleted(prepared.id, checkpoint.id, claimToken);
    this.logger.log('Applied requirement citation edges', {
      proposalId: params.proposalId,
      materializationId: prepared.id,
      created: plan.creates.length,
      deleted: plan.deletes.length,
    });
  }

  private requirementCitationEdgeMatches(
    graphEdge: GraphAgentEdge,
    edge: RequirementCitationEdge,
  ): boolean {
    return (
      graphEdge.id === edge.id &&
      graphEdge.sourceNodeId === edge.featureId &&
      graphEdge.targetNodeId === edge.entityId &&
      graphEdge.targetEntityType === edge.entityType &&
      graphEdge.type === REQUIREMENT_CITATION_EDGE_TYPE
    );
  }

  private async requirementCitationEdgesSatisfied(
    params: { organizationId: OrganizationId; projectId: ProjectId },
    plan: RequirementCitationEdgeDiff,
  ): Promise<boolean> {
    for (const edge of plan.creates) {
      const graphEdge = await this.findRelationship(params, edge.id);
      if (!graphEdge || !this.requirementCitationEdgeMatches(graphEdge, edge)) {
        return false;
      }
    }
    for (const edge of plan.deletes) {
      if ((await this.findRelationship(params, edge.id)) !== null) {
        return false;
      }
    }
    return true;
  }

  private isPublicationGatedCheckpoint(
    checkpoint: WorkItemChangeSetMaterializationCheckpoint,
  ): boolean {
    return (
      checkpoint.operationIndex >= 0 ||
      checkpoint.operationIndex === REQUIREMENT_CITATION_CHECKPOINT_INDEX
    );
  }

  private requireCheckpoint(
    prepared: MaterializationWithCheckpoints,
    operationIndex: number,
    validationRevision: string,
  ): WorkItemChangeSetMaterializationCheckpoint {
    const checkpoint = prepared.checkpoints.find(
      (item) => item.operationIndex === operationIndex,
    );
    if (!checkpoint) {
      throw new BadRequestException(
        `Missing checkpoint for operation ${operationIndex}.`,
      );
    }
    if (checkpoint.validationRevision !== validationRevision) {
      throw new BadRequestException(
        `Checkpoint ${operationIndex} validation revision does not match.`,
      );
    }
    return checkpoint;
  }

  private async applyRelationshipCreateBatch(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    prepared: MaterializationWithCheckpoints,
    entries: Array<{
      operation: Extract<
        WorkItemChangeSetOperation,
        { op: 'relationship.create' }
      >;
      index: number;
      checkpoint: WorkItemChangeSetMaterializationCheckpoint;
    }>,
    mappings: IdentityMappings,
    claimToken: string,
  ): Promise<void> {
    const totalStartedAt = performance.now();
    let applyingCheckpointPersistenceMs = 0;
    let completedCheckpointPersistenceMs = 0;
    let failureCheckpointPersistenceMs = 0;
    await this.renewClaim(prepared.id, claimToken);
    for (const entry of entries) {
      const checkpointStartedAt = performance.now();
      await this.markCheckpointApplying(
        prepared.id,
        entry.checkpoint.id,
        claimToken,
      );
      applyingCheckpointPersistenceMs +=
        performance.now() - checkpointStartedAt;
      this.logger.debug('Applying generic change-set checkpoint', {
        proposalId: params.proposalId,
        materializationId: prepared.id,
        operationIndex: entry.index,
        operationKind: entry.operation.op,
      });
    }

    const graphStartedAt = performance.now();
    let results;
    try {
      results = await this.agentEdgeClient.createBatch(
        params.organizationId,
        params.projectId,
        entries.map(({ operation }) =>
          this.toCreateAgentEdgeDto(operation, mappings),
        ),
        this.tokenFactory(params.organizationId, params.projectId),
        prepared.id,
      );
    } catch (error) {
      const entry = entries[0]!;
      this.logger.error('Relationship batch request failed', {
        proposalId: params.proposalId,
        materializationId: prepared.id,
        operationIndexes: entries.map(({ index }) => index),
        error,
        includeErrorDetails: true,
      });
      const failure = this.checkpointFailure(
        error,
        entry.index,
        entry.operation,
      );
      this.logCheckpointFailure(
        params,
        prepared.id,
        entry.index,
        entry.operation,
        failure,
      );
      const checkpointStartedAt = performance.now();
      await this.markCheckpointFailed(
        prepared.id,
        entry.checkpoint.id,
        claimToken,
        error,
        failure,
      );
      failureCheckpointPersistenceMs += performance.now() - checkpointStartedAt;
      this.logRelationshipBatchTiming({
        entries: entries.length,
        failures: entries.length,
        applyingCheckpointPersistenceMs,
        completedCheckpointPersistenceMs,
        failureCheckpointPersistenceMs,
        graphRequestElapsedMs: performance.now() - graphStartedAt,
        totalElapsedMs: performance.now() - totalStartedAt,
      });
      throw error;
    }
    const graphRequestElapsedMs = performance.now() - graphStartedAt;
    const failures: Array<{
      entry: (typeof entries)[number];
      error: Error;
    }> = [];

    for (const result of results) {
      const entry = entries[result.index];
      if (!entry) {
        throw new InternalServerErrorException(
          'Graph batch result referenced an unknown relationship operation.',
        );
      }
      const edgeReturned = result.edge !== null && result.edge !== undefined;
      const mismatchedFields = edgeReturned
        ? this.relationshipCreateMismatches(
            result.edge!,
            entry.operation,
            mappings,
          )
        : [];
      if (!result.success || !edgeReturned || mismatchedFields.length > 0) {
        failures.push({
          entry,
          error: new Error(
            result.error ??
              this.relationshipBatchPostconditionReason(
                entry.index,
                result.success,
                edgeReturned,
                mismatchedFields,
              ),
          ),
        });
        this.logger.error('Relationship batch entry failed', {
          proposalId: params.proposalId,
          materializationId: prepared.id,
          operationIndex: entry.index,
          operationKind: entry.operation.op,
          success: result.success,
          edgeReturned,
          graphError: result.error ?? null,
          mismatchedFields,
        });
        continue;
      }
      const checkpointStartedAt = performance.now();
      await this.reconciliation.recordEdgeEffect(
        this.prisma.db,
        prepared.id,
        entry.index,
        result.edge!,
      );
      await this.markCheckpointCompleted(
        prepared.id,
        entry.checkpoint.id,
        claimToken,
      );
      completedCheckpointPersistenceMs +=
        performance.now() - checkpointStartedAt;
      this.logger.debug('Generic checkpoint completed', {
        proposalId: params.proposalId,
        materializationId: prepared.id,
        operationIndex: entry.index,
        operationKind: entry.operation.op,
        alreadySatisfied: false,
        satisfied: true,
      });
    }

    if (failures.length > 0) {
      const { entry, error } = failures[0]!;
      const failure = this.checkpointFailure(
        error,
        entry.index,
        entry.operation,
      );
      this.logCheckpointFailure(
        params,
        prepared.id,
        entry.index,
        entry.operation,
        failure,
      );
      this.logOperationInput(
        params.proposalId,
        prepared.id,
        entry.index,
        entry.operation,
        'checkpoint_failure',
      );
      const checkpointStartedAt = performance.now();
      await this.markCheckpointFailed(
        prepared.id,
        entry.checkpoint.id,
        claimToken,
        error,
        failure,
      );
      failureCheckpointPersistenceMs += performance.now() - checkpointStartedAt;
      this.logRelationshipBatchTiming({
        entries: entries.length,
        failures: failures.length,
        applyingCheckpointPersistenceMs,
        completedCheckpointPersistenceMs,
        failureCheckpointPersistenceMs,
        graphRequestElapsedMs,
        totalElapsedMs: performance.now() - totalStartedAt,
      });
      throw error;
    }
    this.logRelationshipBatchTiming({
      entries: entries.length,
      failures: 0,
      applyingCheckpointPersistenceMs,
      completedCheckpointPersistenceMs,
      failureCheckpointPersistenceMs,
      graphRequestElapsedMs,
      totalElapsedMs: performance.now() - totalStartedAt,
    });
  }

  private logRelationshipBatchTiming(timing: {
    entries: number;
    failures: number;
    applyingCheckpointPersistenceMs: number;
    completedCheckpointPersistenceMs: number;
    failureCheckpointPersistenceMs: number;
    graphRequestElapsedMs: number;
    totalElapsedMs: number;
  }): void {
    this.logger.log('Generic relationship batch materialization timing', {
      edgeCount: timing.entries,
      failureCount: timing.failures,
      outcome:
        timing.failures === 0
          ? 'success'
          : timing.failures === timing.entries
            ? 'failure'
            : 'mixed',
      graphRequestCount: 1,
      graphTransactionCount: timing.entries,
      graphStatementCount: timing.entries * 2,
      applyingCheckpointPersistenceMs: timing.applyingCheckpointPersistenceMs,
      completedCheckpointPersistenceMs: timing.completedCheckpointPersistenceMs,
      failureCheckpointPersistenceMs: timing.failureCheckpointPersistenceMs,
      checkpointPersistenceElapsedMs:
        timing.applyingCheckpointPersistenceMs +
        timing.completedCheckpointPersistenceMs +
        timing.failureCheckpointPersistenceMs,
      graphRequestElapsedMs: timing.graphRequestElapsedMs,
      totalElapsedMs: timing.totalElapsedMs,
    });
  }

  private async applyCheckpoint(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    prepared: MaterializationWithCheckpoints,
    checkpoint: WorkItemChangeSetMaterializationCheckpoint,
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    claimToken: string,
    effectiveParentIds?: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    return withApiSpan(
      'proposal.change_set.checkpoint',
      () =>
        this.applyCheckpointInternal(
          params,
          prepared,
          checkpoint,
          operation,
          mappings,
          claimToken,
          effectiveParentIds,
        ),
      {
        operationKind: operation.op,
        operationIndex: checkpoint.operationIndex,
      },
    );
  }

  private async applyCheckpointInternal(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    prepared: MaterializationWithCheckpoints,
    checkpoint: WorkItemChangeSetMaterializationCheckpoint,
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    claimToken: string,
    effectiveParentIds?: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    const startedAt = performance.now();
    const phaseMs: Partial<
      Record<
        (typeof import('src/telemetry/api-tracing').API_SPAN_NAMES)[number],
        number
      >
    > = {};
    const measure = async <T>(
      name: (typeof import('src/telemetry/api-tracing').API_SPAN_NAMES)[number],
      callback: () => Promise<T>,
    ): Promise<T> => {
      const started = performance.now();
      try {
        return await withApiSpan(name, callback, {
          operationKind: operation.op,
          operationIndex: checkpoint.operationIndex,
        });
      } finally {
        phaseMs[name] = performance.now() - started;
      }
    };
    let outcome = 'failed';
    let alreadySatisfied: boolean | undefined;
    try {
      await measure('proposal.change_set.checkpoint.renew', () =>
        this.renewClaim(prepared.id, claimToken),
      );
      await measure('proposal.change_set.checkpoint.applying', () =>
        this.markCheckpointApplying(prepared.id, checkpoint.id, claimToken),
      );
      try {
        this.logger.debug('Applying generic change-set checkpoint', {
          proposalId: params.proposalId,
          materializationId: prepared.id,
          operationIndex: checkpoint.operationIndex,
          operationKind: operation.op,
        });
        if (
          operation.op === 'relationship.update' ||
          operation.op === 'relationship.delete'
        ) {
          const proposal = await this.prisma.db.proposal.findUniqueOrThrow({
            where: { id: params.proposalId },
          });
          await this.reconciliation.reviewedEdgeBasis(
            this.prisma.db,
            proposal,
            prepared.id,
            this.resolveRelationshipId(operation.ref, mappings.relationships),
            operation.op === 'relationship.delete',
          );
        }
        alreadySatisfied = await measure(
          'proposal.change_set.checkpoint.precheck',
          () => this.verifyOperationPostcondition(params, operation, mappings),
        );
        this.logger.debug('Generic checkpoint prior postcondition checked', {
          proposalId: params.proposalId,
          materializationId: prepared.id,
          operationIndex: checkpoint.operationIndex,
          operationKind: operation.op,
          alreadySatisfied,
        });
        if (
          !alreadySatisfied ||
          !operation.op.startsWith('relationship.') ||
          operation.op === 'relationship.delete'
        ) {
          await measure('proposal.change_set.checkpoint.mutation', () =>
            this.applyOperation(
              params,
              prepared.id,
              operation,
              mappings,
              checkpoint.operationIndex,
              claimToken,
              effectiveParentIds,
            ),
          );
        }
        const issues: ProposalApprovalFailureDiagnostic['issues'] = [];
        const satisfied = await measure(
          'proposal.change_set.checkpoint.postcheck',
          () =>
            this.verifyOperationPostcondition(
              params,
              operation,
              mappings,
              issues,
              checkpoint.operationIndex,
            ),
        );
        if (!satisfied) {
          throw this.postconditionFailure(
            checkpoint.operationIndex,
            operation,
            issues,
          );
        }
        await measure('proposal.change_set.checkpoint.completed', () =>
          this.markCheckpointCompleted(prepared.id, checkpoint.id, claimToken),
        );
        outcome = 'completed';
        this.logger.debug('Generic checkpoint completed', {
          proposalId: params.proposalId,
          materializationId: prepared.id,
          operationIndex: checkpoint.operationIndex,
          operationKind: operation.op,
          alreadySatisfied,
          satisfied,
        });
      } catch (error) {
        const failure = this.checkpointFailure(
          error,
          checkpoint.operationIndex,
          operation,
        );
        this.logCheckpointFailure(
          params,
          prepared.id,
          checkpoint.operationIndex,
          operation,
          failure,
        );
        await measure('proposal.change_set.checkpoint.failed', () =>
          this.markCheckpointFailed(
            prepared.id,
            checkpoint.id,
            claimToken,
            error,
            failure,
          ),
        );
        throw error;
      }
    } finally {
      this.logger.debug('Generic checkpoint timing', {
        proposalId: params.proposalId,
        materializationId: prepared.id,
        operationKind: operation.op,
        operationIndex: checkpoint.operationIndex,
        outcome,
        alreadySatisfied,
        phaseMs,
        totalElapsedMs: performance.now() - startedAt,
      });
    }
  }

  private checkpointFailure(
    error: unknown,
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
  ): PersistedProposalApprovalFailure {
    const failure = normalizedFailure(error);
    if (failure.diagnostic.issues.length === 0) {
      failure.diagnostic.issues = [
        {
          field: this.operationFieldPath(operationIndex, operation),
          code: 'CHECKPOINT_APPLICATION_FAILED',
          reason: failure.message,
          layer: 'structural',
        },
      ];
      failure.diagnostic.issueCount = 1;
    }
    return failure;
  }

  private relationshipBatchPostconditionReason(
    operationIndex: number,
    success: boolean,
    edgeReturned: boolean,
    mismatchedFields: string[],
  ): string {
    if (!success) {
      return `Operation ${operationIndex} was reported unsuccessful by Graph without an error.`;
    }
    if (!edgeReturned) {
      return `Operation ${operationIndex} succeeded in Graph but no relationship was returned.`;
    }
    return (
      `Operation ${operationIndex} returned a relationship that differs from ` +
      `the approved operation in: ${mismatchedFields.join(', ')}.`
    );
  }

  private logCheckpointFailure(
    params: { proposalId: string },
    materializationId: string,
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
    failure: PersistedProposalApprovalFailure,
  ): void {
    const issue = failure.diagnostic.issues[0]!;
    this.logger.error('Generic change-set checkpoint failed', {
      proposalId: params.proposalId,
      materializationId,
      operationIndex,
      operationKind: operation.op,
      fieldPath: issue.field,
      failureCode: issue.code,
      reason: issue.reason,
      issues: failure.diagnostic.issues,
      diagnosticCorrelationId: failure.diagnostic.correlationId,
    });
  }

  private postconditionFailure(
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
    issues: ProposalApprovalFailureDiagnostic['issues'] = [],
  ): BadRequestException {
    const field = this.operationFieldPath(operationIndex, operation);
    const reason =
      `Expected persisted state to match approved operation ${operationIndex} ` +
      `(${operation.op}) at ${field}; actual state did not satisfy the postcondition.`;
    return new BadRequestException({
      message: `Approved operation ${operationIndex} did not materialize at ${field}.`,
      diagnostic: {
        issues: issues.length
          ? issues
          : [
              {
                field,
                code: 'POSTCONDITION_MISMATCH',
                reason,
                layer: 'structural',
              },
            ],
        issueCount: issues.length || 1,
        truncated: false,
        correlationId: uuidv4(),
      },
    });
  }

  private operationFieldPath(
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
  ): string {
    let fieldPath: string;
    if (operation.op === 'section.replace') {
      fieldPath = `sections.${operation.key}.content`;
    } else if (operation.op === 'section.clear') {
      fieldPath = `sections.${operation.key}`;
    } else {
      fieldPath = `operations[${operationIndex}]`;
    }
    return fieldPath.slice(0, 512);
  }

  private logOperationInput(
    proposalId: string,
    materializationId: string | undefined,
    operationIndex: number,
    operation: WorkItemChangeSetOperation,
    boundary: 'before_persistence' | 'after_reload' | 'checkpoint_failure',
  ): void {
    const attributes = {
      proposalId,
      materializationId,
      operationIndex,
      operationKind: operation.op,
      boundary,
      operationIdentity: JSON.stringify(
        'ref' in operation ? operation.ref : operation.root,
      ),
      serviceIdsPresent: 'serviceIds' in operation,
      serviceIdsType:
        'serviceIds' in operation
          ? Object.prototype.toString.call(operation.serviceIds)
          : 'absent',
      serviceIdsCount:
        'serviceIds' in operation && Array.isArray(operation.serviceIds)
          ? operation.serviceIds.length
          : undefined,
    };
    if (boundary === 'checkpoint_failure') {
      this.logger.error(
        'Failed generic change-set operation input',
        attributes,
      );
    } else {
      this.logger.debug('Generic change-set operation input', attributes);
    }
    // Primitive fields survive the production envelope. Log IDs individually
    // so long arrays cannot hide values behind its string-length bound.
    if ('serviceIds' in operation && Array.isArray(operation.serviceIds)) {
      operation.serviceIds.forEach((serviceId, serviceIdIndex) => {
        const serviceAttributes = { ...attributes, serviceId, serviceIdIndex };
        if (boundary === 'checkpoint_failure') {
          this.logger.error(
            'Failed generic change-set Service assignment input',
            serviceAttributes,
          );
        } else {
          this.logger.debug(
            'Generic change-set Service assignment input',
            serviceAttributes,
          );
        }
      });
    }
  }

  private assignmentServiceIds(
    serviceIds: readonly string[],
    proposalId: string,
  ): string[] {
    const uniqueIds = [...new Set(serviceIds)];
    if (uniqueIds.length !== serviceIds.length) {
      this.logger.warn(
        'Ignoring duplicate Service IDs during work-item assignment',
        {
          proposalId,
          suppliedCount: serviceIds.length,
          assignedCount: uniqueIds.length,
          duplicateCount: serviceIds.length - uniqueIds.length,
        },
      );
    }
    return uniqueIds;
  }

  private async guardedTaskTransaction<T>(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    materializationId: string,
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    operationIndex: number,
    claimToken: string,
    write: (tx: AnyTransactionClient) => Promise<T>,
  ): Promise<T | undefined> {
    const ref = 'ref' in operation ? operation.ref : operation.root;
    const taskId = this.resolveWorkItemId(ref, mappings.workItems);
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM work_item_change_set_materializations WHERE id = ${materializationId} FOR UPDATE`;
      const intent =
        await tx.workItemChangeSetMaterialization.findUniqueOrThrow({
          where: { id: materializationId },
          include: { proposal: true },
        });
      if (
        intent.claimToken !== claimToken ||
        !intent.claimExpiresAt ||
        intent.claimExpiresAt <= new Date()
      ) {
        throw new ConflictException(
          'The application claim expired before the guarded write.',
        );
      }
      return this.reconciliation.guardTaskEffect(
        tx,
        intent.proposal,
        materializationId,
        taskId,
        operationIndex,
        operation.op === 'workItem.create',
        () => write(tx),
      );
    });
  }

  private async applyOperation(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    materializationId: string,
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    operationIndex: number,
    claimToken: string,
    effectiveParentIds?: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    switch (operation.op) {
      case 'workItem.create':
        await this.guardedTaskTransaction(
          params,
          materializationId,
          operation,
          mappings,
          operationIndex,
          claimToken,
          async (tx) => {
            const proposalPayload = await this.findTaskProposalPayload(
              params.proposalId,
              operation,
            );
            const createTaskDto = this.mergeCreateTaskProposalPayload(
              this.toCreateTaskDto(operation, mappings),
              proposalPayload,
            );
            const serviceIds = operation.serviceIds
              ? this.assignmentServiceIds(
                  operation.serviceIds,
                  params.proposalId,
                )
              : this.readServiceIds(proposalPayload);
            const { serviceIds: _serviceIds, ...taskUpdates } =
              createTaskDto as CreateTaskDto & { serviceIds?: string[] };
            const task = await this.taskService.createInTransaction(
              tx as unknown as Prisma.TransactionClient,
              params.organizationId,
              (taskUpdates.initiativeId as InitiativeId | undefined) ?? null,
              taskUpdates,
              params.projectId,
              this.resolveWorkItemId(
                operation.ref,
                mappings.workItems,
              ) as TaskId,
              materializationId,
            );
            if (serviceIds !== undefined) {
              await this.taskService.replaceServiceAssignmentsInTransaction(
                tx as unknown as Prisma.TransactionClient,
                task.id as TaskId,
                serviceIds,
              );
            }
          },
        );
        return;
      case 'workItem.update':
        {
          const taskId = this.resolveWorkItemId(
            operation.ref,
            mappings.workItems,
          ) as TaskId;
          let postCommit:
            | Awaited<
                ReturnType<TaskService['updateInTransaction']>
              >['postCommit']
            | undefined;
          await this.guardedTaskTransaction(
            params,
            materializationId,
            operation,
            mappings,
            operationIndex,
            claimToken,
            async (tx) => {
              const proposalPayload = await this.findTaskProposalPayload(
                params.proposalId,
                operation,
              );
              const updateTaskDto = this.mergeUpdateTaskProposalPayload(
                this.toUpdateTaskDto(operation, mappings),
                proposalPayload,
              );
              const serviceIds = operation.serviceIds
                ? this.assignmentServiceIds(
                    operation.serviceIds,
                    params.proposalId,
                  )
                : this.readServiceIds(proposalPayload);
              const { serviceIds: _serviceIds, ...taskUpdates } =
                updateTaskDto as UpdateTaskDto & { serviceIds?: string[] };
              const result = await this.taskService.updateInTransaction(
                tx as unknown as Prisma.TransactionClient,
                params.organizationId,
                null,
                taskId,
                taskUpdates,
                undefined,
                materializationId,
              );
              postCommit = result?.postCommit;
              if (serviceIds !== undefined) {
                await this.taskService.replaceServiceAssignmentsInTransaction(
                  tx as unknown as Prisma.TransactionClient,
                  taskId,
                  serviceIds,
                );
              }
            },
          );
          if (postCommit) {
            await this.taskService.runUpdatePostCommit(
              params.organizationId,
              taskId,
              postCommit,
            );
          }
        }
        return;
      case 'workItem.delete':
        await this.guardedTaskTransaction(
          params,
          materializationId,
          operation,
          mappings,
          operationIndex,
          claimToken,
          (tx) =>
            this.taskService.removeInTransaction(
              tx as unknown as Prisma.TransactionClient,
              params.organizationId,
              this.resolveWorkItemId(
                operation.ref,
                mappings.workItems,
              ) as TaskId,
              materializationId,
            ),
        );
        return;
      case 'section.replace':
      case 'layout.replace':
      case 'section.clear':
      case 'layout.clear':
        await this.applySectionLikeOperation(
          params,
          materializationId,
          operation,
          mappings,
          operationIndex,
          claimToken,
          effectiveParentIds,
        );
        return;
      case 'relationship.create': {
        const createDto = this.toCreateAgentEdgeDto(operation, mappings);
        const edge = await this.agentEdgeClient.create(
          params.organizationId,
          params.projectId,
          createDto,
          this.tokenFactory(params.organizationId, params.projectId),
          materializationId,
        );
        await this.reconciliation.recordEdgeEffect(
          this.prisma.db,
          materializationId,
          operationIndex,
          edge,
        );
        return;
      }
      case 'relationship.update': {
        const relationshipId = this.resolveRelationshipId(
          operation.ref,
          mappings.relationships,
        );
        const proposal = await this.prisma.db.proposal.findUniqueOrThrow({
          where: { id: params.proposalId },
        });
        const reviewed = await this.reconciliation.reviewedEdgeBasis(
          this.prisma.db,
          proposal,
          materializationId,
          relationshipId,
        );
        const previous = await this.findRelationship(params, relationshipId);
        if (!previous) {
          throw new BadRequestException(
            `Existing relationship ${relationshipId} was not found.`,
          );
        }
        const applied = await this.agentEdgeClient.update(
          params.organizationId,
          params.projectId,
          relationshipId,
          this.toUpdateAgentEdgeDto(operation, mappings, params.proposalId),
          this.tokenFactory(params.organizationId, params.projectId),
          materializationId,
          reviewed.version,
        );
        const basis = await this.reconciliation.edgeBasis(
          proposal,
          relationshipId,
        );
        if (basis.version !== applied.updatedAt)
          throw new ConflictException(
            'Relationship changed immediately after application. Reconciliation is required.',
          );
        const identity = {
          materializationId,
          entityType: 'EDGE',
          entityId: relationshipId,
        };
        await this.prisma.db.proposalReconciliationEffect.upsert({
          where: { materializationId_entityType_entityId: identity },
          create: {
            ...identity,
            basis: basis as unknown as Prisma.InputJsonValue,
            operationIndexes: [operationIndex],
          },
          update: {
            basis: basis as unknown as Prisma.InputJsonValue,
            operationIndexes: { push: operationIndex },
          },
        });
        return;
      }
      case 'relationship.delete': {
        const relationshipId = this.resolveRelationshipId(
          operation.ref,
          mappings.relationships,
        );
        const proposal = await this.prisma.db.proposal.findUniqueOrThrow({
          where: { id: params.proposalId },
        });
        const reviewed = await this.reconciliation.reviewedEdgeBasis(
          this.prisma.db,
          proposal,
          materializationId,
          relationshipId,
          true,
        );
        if (reviewed.version === 'absent') return;
        await this.agentEdgeClient.delete(
          params.organizationId,
          params.projectId,
          relationshipId,
          this.tokenFactory(params.organizationId, params.projectId),
          'Deleting relationship during generic work-item change-set materialization.',
          materializationId,
          reviewed.version,
        );
        const identity = {
          materializationId,
          entityType: 'EDGE',
          entityId: relationshipId,
        };
        const basis = {
          entityType: 'EDGE',
          entityId: relationshipId,
          version: 'absent',
          content: { deleted: true },
        };
        await this.prisma.db.proposalReconciliationEffect.upsert({
          where: { materializationId_entityType_entityId: identity },
          create: { ...identity, basis, operationIndexes: [operationIndex] },
          update: { basis, operationIndexes: { push: operationIndex } },
        });
        return;
      }
    }
  }

  private effectiveParentIds(
    request: WorkItemChangeSetValidationRequest,
    materialization: MaterializationWithCheckpoints,
  ): ReadonlyMap<string, string | null> {
    const mappings = this.readIdentityMappings(materialization);
    const parents = new Map<string, string | null>();
    for (const operation of request.operations) {
      if (operation.op === 'workItem.create') {
        parents.set(
          this.resolveWorkItemId(operation.ref, mappings.workItems),
          operation.parent
            ? this.resolveWorkItemId(operation.parent, mappings.workItems)
            : null,
        );
      } else if (
        operation.op === 'workItem.update' &&
        Object.prototype.hasOwnProperty.call(operation, 'parent')
      ) {
        parents.set(
          this.resolveWorkItemId(operation.ref, mappings.workItems),
          operation.parent
            ? this.resolveWorkItemId(operation.parent, mappings.workItems)
            : null,
        );
      }
    }
    return parents;
  }

  private async applySectionLikeOperation(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    materializationId: string,
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    operationIndex: number,
    claimToken: string,
    effectiveParentIds?: ReadonlyMap<string, string | null>,
  ): Promise<void> {
    if (
      operation.op !== 'section.replace' &&
      operation.op !== 'layout.replace' &&
      operation.op !== 'section.clear' &&
      operation.op !== 'layout.clear'
    ) {
      return;
    }
    const ref = 'ref' in operation ? operation.ref : operation.root;
    const key = 'key' in operation ? operation.key : operation.sectionKey;
    const targetId = this.resolveWorkItemId(ref, mappings.workItems);
    if (operation.op === 'section.clear' || operation.op === 'layout.clear') {
      await this.guardedTaskTransaction(
        params,
        materializationId,
        operation,
        mappings,
        operationIndex,
        claimToken,
        async (tx) => {
          await this.assertFeatureRequirementBaselineBeforeSectionWrite(
            tx,
            params,
            operation,
            targetId,
          );
          await this.taskService.applySectionUpdatesInTransaction(
            tx as unknown as Prisma.TransactionClient,
            params.organizationId,
            targetId as TaskId,
            [{ key, content: null }],
            {
              materializationId,
              ...(effectiveParentIds?.has(targetId)
                ? {
                    effectiveParentId: effectiveParentIds.get(targetId),
                  }
                : {}),
            },
          );
        },
      );
      return;
    }
    const content =
      operation.op === 'section.replace'
        ? await this.materializedSectionContent(params, operation, mappings)
        : this.materializedLayoutValue(operation, mappings);
    await this.guardedTaskTransaction(
      params,
      materializationId,
      operation,
      mappings,
      operationIndex,
      claimToken,
      async (tx) => {
        await this.assertFeatureRequirementBaselineBeforeSectionWrite(
          tx,
          params,
          operation,
          targetId,
        );
        const update = {
          sections: [
            {
              key,
              content:
                typeof content === 'string' ? content : JSON.stringify(content),
            } satisfies TaskSectionInput,
          ],
        };
        if (effectiveParentIds?.has(targetId)) {
          await this.taskService.updateInTransaction(
            tx as unknown as Prisma.TransactionClient,
            params.organizationId,
            null,
            targetId as TaskId,
            update,
            undefined,
            materializationId,
            effectiveParentIds.get(targetId),
          );
          return;
        }
        await this.taskService.updateInTransaction(
          tx as unknown as Prisma.TransactionClient,
          params.organizationId,
          null,
          targetId as TaskId,
          update,
          undefined,
          materializationId,
        );
      },
    );
  }

  private async assertFeatureRequirementBaselineBeforeSectionWrite(
    tx: AnyTransactionClient,
    params: { proposalId: string; organizationId: string; projectId: string },
    operation: Extract<
      WorkItemChangeSetOperation,
      {
        op:
          | 'section.replace'
          | 'section.clear'
          | 'layout.replace'
          | 'layout.clear';
      }
    >,
    targetId: string,
  ): Promise<void> {
    const ref = 'ref' in operation ? operation.ref : operation.root;
    const key = 'key' in operation ? operation.key : operation.sectionKey;
    if (ref.refType !== 'existing' || key !== 'requirements') return;

    if (typeof tx.$queryRaw === 'function') {
      await withApiSpan('proposal.change_set.advisory_lock', () =>
        tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.organizationId}:${params.projectId}`}, 0))::text AS "lockAcquired"`,
        ),
      );
    }
    const [proposal, section] = await Promise.all([
      tx.proposal.findUnique({
        where: { id: params.proposalId },
        select: { updatedAt: true },
      }),
      tx.taskSection.findFirst({
        where: { taskId: targetId, key: 'requirements' },
        select: { updatedAt: true },
      }),
    ]);
    if (!proposal || !section || section.updatedAt <= proposal.updatedAt) {
      return;
    }
    throw new ConflictException(
      'FEATURE requirements changed after this proposal was prepared; review the current collection and resubmit.',
    );
  }

  private async verifyOperationPostcondition(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    operation: WorkItemChangeSetOperation,
    mappings: IdentityMappings,
    issues: ProposalApprovalFailureDiagnostic['issues'] = [],
    operationIndex = 0,
  ): Promise<boolean> {
    const mismatch = (
      field: string,
      expected: unknown,
      actual: unknown,
      disclose = false,
    ): false => {
      const describe = (value: unknown): string => {
        if (value === undefined) return 'absent';
        if (value === null) return 'null';
        if (disclose) return String(value).slice(0, 120);
        if (typeof value === 'string')
          return `[redacted text, ${value.length} characters]`;
        if (Array.isArray(value))
          return `[${value.length} entries; values redacted]`;
        return '[redacted structured value]';
      };
      issues.push({
        field: field.slice(0, 512),
        code: 'POSTCONDITION_MISMATCH',
        reason: `Persisted value differs: expected ${describe(expected)}; actual ${describe(actual)}.`,
        layer: 'structural',
      });
      return false;
    };
    switch (operation.op) {
      case 'workItem.create':
      case 'workItem.update': {
        const task = await this.prisma.db.task.findFirst({
          where: {
            id: this.resolveWorkItemId(operation.ref, mappings.workItems),
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
          },
          include: { serviceRelations: { select: { serviceId: true } } },
        });
        const path = `operations[${operationIndex}]`;
        if (!task) return mismatch(`${path}.ref`, 'present', 'absent', true);
        const checks: boolean[] = [];
        const check = (
          key: string,
          expected: unknown,
          actual: unknown,
          matches = expected === actual,
        ) => {
          checks.push(
            matches ||
              mismatch(`${path}.${key}`, expected, actual, key === 'dueDate'),
          );
        };
        if (operation.op === 'workItem.create') {
          check('name', operation.name, task.name);
          check('type', operation.type ?? 'STANDARD', task.type);
        } else if (operation.name !== undefined) {
          check('name', operation.name, task.name);
        }
        if (operation.op === 'workItem.create' || 'parent' in operation) {
          check(
            'parent',
            operation.parent
              ? this.resolveWorkItemId(operation.parent, mappings.workItems)
              : null,
            task.parentTaskId,
          );
        }
        for (const key of ['status', 'priority', 'tag'] as const) {
          if (operation[key] !== undefined)
            check(key, operation[key], task[key]);
        }
        if (operation.dueDate !== undefined) {
          const expectedTime =
            operation.dueDate === null
              ? null
              : new Date(operation.dueDate).getTime();
          check(
            'dueDate',
            operation.dueDate,
            task.dueDate?.toISOString() ?? null,
            expectedTime === (task.dueDate?.getTime() ?? null),
          );
        }
        if (operation.assigneeId !== undefined)
          check('assigneeId', operation.assigneeId, task.assigneeId);
        if (operation.serviceIds !== undefined) {
          check(
            'serviceIds',
            operation.serviceIds,
            task.serviceRelations.map(({ serviceId }) => serviceId),
            this.serviceAssignmentsMatch(
              task.serviceRelations,
              operation.serviceIds,
            ),
          );
        }
        return checks.every(Boolean);
      }
      case 'workItem.delete': {
        const task = await this.prisma.db.task.findFirst({
          where: {
            id: this.resolveWorkItemId(operation.ref, mappings.workItems),
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
          },
          select: { id: true },
        });
        return task === null;
      }
      case 'section.replace':
      case 'section.clear':
      case 'layout.replace':
      case 'layout.clear': {
        const ref = 'ref' in operation ? operation.ref : operation.root;
        const key = 'key' in operation ? operation.key : operation.sectionKey;
        const section = await this.prisma.db.taskSection.findFirst({
          where: {
            taskId: this.resolveWorkItemId(ref, mappings.workItems),
            key,
          },
          select: { materializedMarkdown: true },
        });
        if (
          operation.op === 'section.clear' ||
          operation.op === 'layout.clear'
        ) {
          return section === null || section.materializedMarkdown === null;
        }
        const expected =
          operation.op === 'section.replace'
            ? await this.materializedSectionContent(params, operation, mappings)
            : JSON.stringify(this.materializedLayoutValue(operation, mappings));
        if (typeof expected === 'string') {
          if (key === 'requirements') {
            const expectedRequirements =
              validateFeatureRequirementsSection(expected);
            const actualRequirements =
              section?.materializedMarkdown === undefined ||
              section.materializedMarkdown === null
                ? null
                : validateFeatureRequirementsSection(
                    section.materializedMarkdown,
                  );
            if (expectedRequirements.success && actualRequirements?.success) {
              return (
                expectedRequirements.canonicalContent ===
                  actualRequirements.canonicalContent ||
                mismatch(
                  `sections.${key}.content`,
                  expected,
                  section?.materializedMarkdown,
                )
              );
            }
          }
          return (
            section?.materializedMarkdown === expected ||
            mismatch(
              `sections.${key}.content`,
              expected,
              section?.materializedMarkdown,
            )
          );
        }
        if (expected === null) {
          return (
            section?.materializedMarkdown === null ||
            mismatch(
              `sections.${key}.content`,
              null,
              section?.materializedMarkdown,
            )
          );
        }
        return (
          (section?.materializedMarkdown !== undefined &&
            section?.materializedMarkdown !== null &&
            stableStringify(
              this.parseJsonValue(section.materializedMarkdown),
            ) === stableStringify(expected)) ||
          mismatch(
            `sections.${key}.content`,
            expected,
            section?.materializedMarkdown,
          )
        );
      }
      case 'relationship.create':
      case 'relationship.update': {
        const relationshipId = this.resolveRelationshipId(
          operation.ref,
          mappings.relationships,
        );
        const edge = await this.findRelationship(params, relationshipId);
        if (!edge) return false;
        const graphMatches =
          operation.op === 'relationship.create'
            ? this.relationshipMatchesCreate(edge, operation, mappings)
            : this.relationshipMatchesUpdate(edge, operation, mappings);
        return graphMatches;
      }
      case 'relationship.delete': {
        const relationshipId = this.resolveRelationshipId(
          operation.ref,
          mappings.relationships,
        );
        return (await this.findRelationship(params, relationshipId)) === null;
      }
    }
  }

  private serviceAssignmentsMatch(
    relations: Array<{ serviceId: string }>,
    expected: readonly string[] | undefined,
  ): boolean {
    if (expected === undefined) return true;
    return (
      stableStringify(relations.map(({ serviceId }) => serviceId).sort()) ===
      stableStringify([...new Set(expected)].sort())
    );
  }

  private async findRelationship(
    params: { organizationId: OrganizationId; projectId: ProjectId },
    relationshipId: string,
  ): Promise<GraphAgentEdge | null> {
    try {
      return await this.agentEdgeClient.get(
        params.organizationId,
        params.projectId,
        relationshipId,
        this.tokenFactory(params.organizationId, params.projectId),
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) return null;
      throw error;
    }
  }

  private relationshipMatchesCreate(
    edge: GraphAgentEdge,
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.create' }
    >,
    mappings: IdentityMappings,
  ): boolean {
    return (
      this.relationshipCreateMismatches(edge, operation, mappings).length === 0
    );
  }

  /** Field names only — values may carry private metadata. */
  private relationshipCreateMismatches(
    edge: GraphAgentEdge,
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.create' }
    >,
    mappings: IdentityMappings,
  ): string[] {
    const checks: Array<[string, boolean]> = [
      [
        'sourceNodeId',
        edge.sourceNodeId ===
          this.resolveWorkItemId(operation.source, mappings.workItems),
      ],
      [
        'sourceEntityType',
        edge.sourceEntityType === AgentEdgeEndpointEntityType.Task,
      ],
      [
        'targetNodeId',
        edge.targetNodeId ===
          this.resolveWorkItemId(operation.target, mappings.workItems),
      ],
      [
        'targetEntityType',
        edge.targetEntityType === AgentEdgeEndpointEntityType.Task,
      ],
      ['type', edge.type === operation.edgeType],
      [
        'category',
        operation.category === undefined ||
          edge.category === operation.category,
      ],
      [
        'direction',
        (edge.direction ?? null) ===
          ('direction' in operation ? (operation.direction ?? null) : null),
      ],
      [
        'predicate',
        (edge.predicate ?? null) ===
          ('predicate' in operation ? (operation.predicate ?? null) : null),
      ],
      [
        'reasoning',
        edge.reasoning ===
          (operation.reasoning ?? 'Generic work-item change-set relationship.'),
      ],
      [
        'metadata',
        stableStringify(edge.metadata ?? null) ===
          stableStringify(operation.metadata ?? null),
      ],
    ];
    return checks.filter(([, matches]) => !matches).map(([field]) => field);
  }

  private relationshipMatchesUpdate(
    edge: GraphAgentEdge,
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.update' }
    >,
    mappings: IdentityMappings,
  ): boolean {
    return (
      (!operation.source ||
        edge.sourceNodeId ===
          this.resolveWorkItemId(operation.source, mappings.workItems)) &&
      (!operation.target ||
        edge.targetNodeId ===
          this.resolveWorkItemId(operation.target, mappings.workItems)) &&
      (operation.edgeType === undefined || edge.type === operation.edgeType) &&
      (operation.category === undefined ||
        edge.category === operation.category) &&
      (!Object.prototype.hasOwnProperty.call(operation, 'direction') ||
        (edge.direction ?? null) === (operation.direction ?? null)) &&
      (!Object.prototype.hasOwnProperty.call(operation, 'predicate') ||
        (edge.predicate ?? null) === (operation.predicate ?? null)) &&
      (!Object.prototype.hasOwnProperty.call(operation, 'reasoning') ||
        edge.reasoning === operation.reasoning) &&
      (!Object.prototype.hasOwnProperty.call(operation, 'metadata') ||
        stableStringify(edge.metadata ?? null) ===
          stableStringify(operation.metadata ?? null))
    );
  }

  /**
   * A groups value (recognised by its strict versioned schema, whatever the
   * declared section key) may name elements created in this change set;
   * rewrite them to persisted IDs. Members whose element is archived (deleted
   * later in the same change set) are pruned so the postcondition converges
   * with TaskService's prune-on-delete. Other sections pass through.
   */
  private async materializedSectionContent(
    params: { organizationId: OrganizationId; projectId: ProjectId },
    operation: Extract<WorkItemChangeSetOperation, { op: 'section.replace' }>,
    mappings: IdentityMappings,
  ): Promise<unknown> {
    const parsed = parseDiagramGroupsContent(operation.content);
    if (!parsed.success) return operation.content;
    const materialized = materializeDiagramGroupMembers(
      parsed.value,
      (temporaryRef) =>
        this.resolveWorkItemId(
          { refType: 'temporary', tempId: temporaryRef },
          mappings.workItems,
        ),
    );
    const memberIds = [
      ...new Set(
        materialized.groups.flatMap((group) =>
          group.members.flatMap((member) =>
            member.kind === 'persistedWorkItem' ? [member.workItemId] : [],
          ),
        ),
      ),
    ];
    const archived = memberIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: memberIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: { not: null },
          },
          select: { id: true },
        })
      : [];
    return reconcileDiagramGroups(materialized, {
      removedMemberKeys: new Set(archived.map(({ id }) => `existing:${id}`)),
    });
  }

  private materializedLayoutValue(
    operation: Extract<WorkItemChangeSetOperation, { op: 'layout.replace' }>,
    mappings: IdentityMappings,
  ): WorkItemGraphLayoutValue {
    return {
      schemaVersion: 'work-item-graph-layout.v1',
      nodes: operation.entries.map((entry) => ({
        node: {
          kind: 'persistedWorkItem',
          workItemId: this.resolveWorkItemId(entry.node, mappings.workItems),
        },
        position: entry.position,
      })),
    };
  }

  private async publishPreparedIntent(
    params: {
      proposalId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
    materializationId: string,
    claimToken: string,
  ): Promise<{ proposal: Proposal; rootWorkItemId: string | null }> {
    const intent =
      await this.prisma.db.workItemChangeSetMaterialization.findUnique({
        where: { id: materializationId },
        include: { checkpoints: true },
      });
    if (!intent) {
      throw new BadRequestException('Materialization intent not found.');
    }
    this.assertRecoverableIntent(intent);
    this.assertCheckpointsComplete(intent);
    if (
      intent.status !== WorkItemChangeSetMaterializationStatus.APPLYING ||
      intent.claimToken !== claimToken
    ) {
      throw new ConflictException(
        'Work-item change-set materialization claim is no longer owned.',
      );
    }

    const request =
      intent.operationSet as unknown as WorkItemChangeSetValidationRequest;
    const mappings = this.readIdentityMappings(intent);
    const createdRelationships = await this.findCreatedRelationships(
      params,
      request.operations.filter(
        (
          operation,
        ): operation is Extract<
          WorkItemChangeSetOperation,
          { op: 'relationship.create' }
        > => operation.op === 'relationship.create',
      ),
      mappings,
    );
    for (const [operationIndex, operation] of request.operations.entries()) {
      const satisfied =
        operation.op === 'relationship.create'
          ? this.createdRelationshipMatches(
              createdRelationships,
              operation,
              mappings,
            )
          : await this.verifyOperationPostcondition(
              params,
              operation,
              mappings,
            );
      this.logger.debug('Generic publication postcondition checked', {
        proposalId: params.proposalId,
        materializationId,
        operationIndex,
        operationKind: operation.op,
        satisfied,
      });
      if (!satisfied) {
        throw new BadRequestException(
          `Cannot publish generic change set because ${operation.op} does not match the stored target.`,
        );
      }
    }
    const citationPlan = this.storedRequirementCitationEdges(intent);
    if (
      citationPlan &&
      !(await this.requirementCitationEdgesSatisfied(params, citationPlan))
    ) {
      throw new BadRequestException(
        'Cannot publish generic change set because its requirement citation edges do not match the stored plan.',
      );
    }

    return this.prisma.db.$transaction(async (tx) => {
      await this.assertClaimOwned(tx, materializationId, claimToken);
      const ownedIntent =
        await tx.workItemChangeSetMaterialization.findUniqueOrThrow({
          where: { id: materializationId },
          include: { checkpoints: true, proposal: true },
        });
      this.assertRecoverableIntent(ownedIntent);
      this.assertCheckpointsComplete(ownedIntent);
      if (ownedIntent.proposal.status !== 'APPROVED') {
        throw new ConflictException(
          'Generic change set cannot be published before its proposal is approved.',
        );
      }
      const affectedWorkItemIds = ownedIntent.affectedWorkItemIds;
      if (!Array.isArray(affectedWorkItemIds)) {
        throw new BadRequestException(
          'Cannot publish generic change set without affected work-item identities.',
        );
      }
      await this.reconciliation.publishTaskEffects(
        tx,
        ownedIntent.proposal,
        materializationId,
        async () => {
          await tx.task.updateMany({
            where: {
              id: { in: affectedWorkItemIds as string[] },
              organizationId: params.organizationId,
              projectId: params.projectId,
            },
            data: { lastAppliedProposalId: params.proposalId },
          });
        },
      );
      await tx.workItemChangeSetMaterialization.update({
        where: { id: ownedIntent.id, claimToken },
        data: {
          status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
          completedAt: new Date(),
          publishedAt: new Date(),
          lastError: null,
        },
      });
      const proposal = await tx.proposal.update({
        where: { id: params.proposalId },
        data: {
          targetEntityId: ownedIntent.rootWorkItemId ?? undefined,
        },
      });
      // Published exactly once under the claim, so mention events share the
      // PUBLISHED transition and a retried publication cannot re-emit them.
      await this.publishChangeSetBodyMentions(
        tx,
        ownedIntent,
        proposal,
        params,
      );
      this.logger.log('Published generic work-item change set', {
        proposalId: params.proposalId,
        materializationId: ownedIntent.id,
        rootWorkItemId: ownedIntent.rootWorkItemId,
      });
      return { proposal, rootWorkItemId: ownedIntent.rootWorkItemId };
    });
  }

  /**
   * Diff the `@[…]` mentions of every work item whose sections this change
   * set wrote and publish mention events for the delta, mirroring the legacy
   * approval path. Prior mentions come from the read projection stored at
   * prepare time (created items have none); deleted items are skipped because
   * archived-entity consumers own their mention cleanup.
   */
  private async publishChangeSetBodyMentions(
    tx: AnyTransactionClient,
    intent: WorkItemChangeSetMaterialization,
    proposal: Proposal,
    params: { organizationId: OrganizationId; projectId: ProjectId },
  ): Promise<void> {
    const request =
      intent.operationSet as unknown as WorkItemChangeSetValidationRequest;
    const mappings = this.readIdentityMappings(intent);
    const deletedIds = new Set<string>();
    const sectionWrittenIds = new Set<string>();
    const declaredTargetsBySource = new Map<string, Set<string>>();
    for (const operation of request.operations) {
      if (operation.op === 'workItem.delete') {
        deletedIds.add(
          this.resolveWorkItemId(operation.ref, mappings.workItems),
        );
      } else if (
        operation.op === 'section.replace' ||
        operation.op === 'section.clear'
      ) {
        sectionWrittenIds.add(
          this.resolveWorkItemId(operation.ref, mappings.workItems),
        );
      } else if (operation.op === 'relationship.create') {
        const sourceId = this.resolveWorkItemId(
          operation.source,
          mappings.workItems,
        );
        const targets = declaredTargetsBySource.get(sourceId) ?? new Set();
        targets.add(
          this.resolveWorkItemId(operation.target, mappings.workItems),
        );
        declaredTargetsBySource.set(sourceId, targets);
      }
    }
    const workItemIds = [...sectionWrittenIds]
      .filter((id) => !deletedIds.has(id))
      .sort();
    this.logger.debug('Resolved change-set work items for mention diffing', {
      proposalId: proposal.id,
      materializationId: intent.id,
      workItemCount: workItemIds.length,
      skippedDeletedCount: sectionWrittenIds.size - workItemIds.length,
    });
    if (workItemIds.length === 0) return;

    const priorWorkItems =
      (intent.priorProjection as unknown as StoredProjection | null)
        ?.workItems ?? {};
    for (const workItemId of workItemIds) {
      const prior = priorWorkItems[workItemId];
      const priorMentions = prior
        ? await this.readWorkItemMentions(
            tx,
            prior.type,
            prior.projectId,
            prior.sections ?? [],
            params.organizationId,
          )
        : [];
      const current: {
        type: string;
        projectId: string;
        sections: WorkItemMentionSectionRow[];
      } | null = await tx.task.findUnique({
        where: { id: workItemId },
        select: {
          type: true,
          projectId: true,
          sections: { select: { key: true, materializedMarkdown: true } },
        },
      });
      if (!current) {
        throw new ConflictException(
          `Work item ${workItemId} disappeared before its mentions were published.`,
        );
      }
      const nextMentions = await this.readWorkItemMentions(
        tx,
        current.type,
        current.projectId,
        current.sections,
        params.organizationId,
      );
      const { added, removed, dedupedAgainstDeclared } = diffBodyMentions(
        priorMentions,
        nextMentions,
        declaredTargetsBySource.get(workItemId) ?? new Set(),
      );
      if (added.length === 0 && removed.length === 0) continue;
      this.logger.log('Emitting change-set body-mention events', {
        proposalId: proposal.id,
        materializationId: intent.id,
        workItemId,
        addedCount: added.length,
        removedCount: removed.length,
        dedupedAgainstDeclared,
      });
      await publishBodyMentionEvents(
        this.eventPublisher,
        tx,
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          sourceEntityId: workItemId,
          sourceEntityType:
            MentionCreatedEventPayload.SourceEntityTypeEnum.Task,
          conversationId:
            (proposal.conversationId as ConversationId | null) ?? undefined,
          userId: (proposal.requestorId as UserId | null) ?? undefined,
          added,
          removed,
        },
        this.logger,
      );
    }
  }

  private async readWorkItemMentions(
    tx: AnyTransactionClient,
    typeKey: string,
    projectId: string,
    sections: readonly WorkItemMentionSectionRow[],
    organizationId: OrganizationId,
  ): Promise<ResolvedMention[]> {
    // Throws for an unregistered type: an unresolvable type must fail the
    // publication rather than silently drop every mention.
    const content = collectWorkItemMentionContent(
      typeKey,
      this.workItemTypeRegistry.getSectionDefinitions(typeKey, projectId),
      sections,
    );
    if (!content) return [];
    return this.mentionProcessingService.extractAndValidate(
      content,
      organizationId,
      tx,
    );
  }

  private async findCreatedRelationships(
    params: { organizationId: OrganizationId; projectId: ProjectId },
    operations: Array<
      Extract<WorkItemChangeSetOperation, { op: 'relationship.create' }>
    >,
    mappings: IdentityMappings,
  ): Promise<Map<string, GraphAgentEdge>> {
    const requestedIds = new Set(
      operations.map((operation) =>
        this.resolveRelationshipId(operation.ref, mappings.relationships),
      ),
    );
    const edgesById = new Map<string, GraphAgentEdge>();
    const token = this.tokenFactory(params.organizationId, params.projectId);

    for (
      let offset = 0;
      offset < operations.length;
      offset += AGENT_EDGE_BATCH_SIZE
    ) {
      const chunk = operations.slice(offset, offset + AGENT_EDGE_BATCH_SIZE);
      const nodeIds = new Set<string>();
      const types = new Set<AgentEdgeType>();
      for (const operation of chunk) {
        nodeIds.add(
          this.resolveWorkItemId(operation.source, mappings.workItems),
        );
        nodeIds.add(
          this.resolveWorkItemId(operation.target, mappings.workItems),
        );
        types.add(operation.edgeType);
      }
      const edges = await this.agentEdgeClient.findIncident(
        params.organizationId,
        params.projectId,
        { nodeIds, types },
        token,
      );
      for (const edge of edges) {
        if (requestedIds.has(edge.id)) edgesById.set(edge.id, edge);
      }
    }
    return edgesById;
  }

  private createdRelationshipMatches(
    edgesById: ReadonlyMap<string, GraphAgentEdge>,
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.create' }
    >,
    mappings: IdentityMappings,
  ): boolean {
    const relationshipId = this.resolveRelationshipId(
      operation.ref,
      mappings.relationships,
    );
    const edge = edgesById.get(relationshipId);
    return edge
      ? this.relationshipMatchesCreate(edge, operation, mappings)
      : false;
  }

  private assertCheckpointsComplete(
    intent: MaterializationWithCheckpoints,
  ): void {
    const incomplete = intent.checkpoints.filter(
      (checkpoint) =>
        this.isPublicationGatedCheckpoint(checkpoint) &&
        (checkpoint.status !== WorkItemChangeSetCheckpointStatus.COMPLETED ||
          checkpoint.validationRevision !== intent.validationRevision),
    );
    if (incomplete.length > 0) {
      throw new BadRequestException(
        'Cannot publish generic change set before all checkpoints complete.',
      );
    }
  }

  private parseJsonValue(content: unknown): unknown {
    if (typeof content !== 'string') return content;
    try {
      return JSON.parse(content) as unknown;
    } catch {
      return content;
    }
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
      // Every proposal ingests until output exclusion computes this per proposal.
      shouldProcess: true,
    };

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.PROPOSAL.APPROVED,
      aggregateId: proposal.id,
      payload,
    });
  }

  private async markIntentAttempt(
    materializationId: string,
    claimToken: string,
  ): Promise<void> {
    const updated =
      await this.prisma.db.workItemChangeSetMaterialization.updateMany({
        where: {
          id: materializationId,
          claimToken,
          status: WorkItemChangeSetMaterializationStatus.APPLYING,
        },
        data: {
          attemptCount: { increment: 1 },
          lastAttemptedAt: new Date(),
          lastError: null,
          claimExpiresAt: new Date(
            Date.now() + WorkItemChangeSetMaterializerService.CLAIM_TTL_MS,
          ),
        },
      });
    this.assertClaimUpdated(updated.count, materializationId);
  }

  private async renewClaim(
    materializationId: string,
    claimToken: string,
  ): Promise<void> {
    const updated =
      await this.prisma.db.workItemChangeSetMaterialization.updateMany({
        where: {
          id: materializationId,
          claimToken,
          status: WorkItemChangeSetMaterializationStatus.APPLYING,
        },
        data: {
          claimExpiresAt: new Date(
            Date.now() + WorkItemChangeSetMaterializerService.CLAIM_TTL_MS,
          ),
        },
      });
    this.assertClaimUpdated(updated.count, materializationId);
  }

  private async markCheckpointApplying(
    materializationId: string,
    checkpointId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertClaimOwned(tx, materializationId, claimToken);
      await tx.workItemChangeSetMaterializationCheckpoint.update({
        where: { id: checkpointId },
        data: {
          status: WorkItemChangeSetCheckpointStatus.APPLYING,
          attemptCount: { increment: 1 },
          lastAttemptedAt: new Date(),
          lastError: null,
        },
      });
    });
  }

  private async markCheckpointCompleted(
    materializationId: string,
    checkpointId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await this.assertClaimOwned(tx, materializationId, claimToken);
      await tx.workItemChangeSetMaterializationCheckpoint.update({
        where: { id: checkpointId },
        data: {
          status: WorkItemChangeSetCheckpointStatus.COMPLETED,
          completedAt: new Date(),
          lastError: null,
        },
      });
    });
  }

  private async markCheckpointFailed(
    materializationId: string,
    checkpointId: string,
    claimToken: string,
    error: unknown,
    failure = normalizedFailure(error),
  ): Promise<void> {
    const persistedError = serializeProposalApprovalFailure(
      failure.message,
      failure.diagnostic,
    );
    await this.prisma.db.$transaction(async (tx) => {
      const owned = await tx.workItemChangeSetMaterialization.updateMany({
        where: { id: materializationId, claimToken },
        data: {
          status: WorkItemChangeSetMaterializationStatus.PREPARED,
          lastError: persistedError,
          claimToken: null,
          claimExpiresAt: null,
        },
      });
      if (owned.count === 0) return;
      await tx.workItemChangeSetMaterializationCheckpoint.update({
        where: { id: checkpointId },
        data: {
          status: WorkItemChangeSetCheckpointStatus.FAILED,
          lastError: persistedError,
        },
      });
    });
  }

  private async assertClaimOwned(
    tx: AnyTransactionClient,
    materializationId: string,
    claimToken: string,
  ): Promise<void> {
    const owned = await tx.workItemChangeSetMaterialization.findFirst({
      where: {
        id: materializationId,
        claimToken,
        status: WorkItemChangeSetMaterializationStatus.APPLYING,
      },
      select: { id: true },
    });
    if (!owned) {
      throw new ConflictException(
        'Work-item change-set materialization claim is no longer owned.',
      );
    }
  }

  private assertClaimUpdated(count: number, materializationId: string): void {
    if (count === 0) {
      throw new ConflictException(
        `Work-item change-set materialization ${materializationId} claim is no longer owned.`,
      );
    }
  }

  private storedProjection(
    projection: StoredProjection['projection'],
    workItems?: Record<string, PriorSectionSnapshot>,
    requirementCitationEdges?: RequirementCitationEdgeDiff,
  ): Prisma.InputJsonValue {
    return {
      schemaVersion: 'work-item-change-set-projection.v1',
      projection,
      ...(workItems ? { workItems } : {}),
      ...(requirementCitationEdges ? { requirementCitationEdges } : {}),
    } as unknown as Prisma.InputJsonValue;
  }

  private async capturePriorSectionSnapshots(
    db: AnyTransactionClient,
    organizationId: OrganizationId,
    operationSet: WorkItemChangeSetValidationRequest,
    mappings: IdentityMappings,
    unavailableIds: ReadonlySet<string>,
  ): Promise<Record<string, PriorSectionSnapshot>> {
    const sectionWrittenIds = new Set<string>();
    for (const operation of operationSet.operations) {
      if (
        (operation.op === 'section.replace' ||
          operation.op === 'section.clear') &&
        operation.ref.refType === 'existing'
      ) {
        sectionWrittenIds.add(
          this.resolveWorkItemId(operation.ref, mappings.workItems),
        );
      }
    }
    // Deleted-type records are intentionally absent from normal reads. They
    // still have identity mappings so an explicit DELETE can archive them.
    const readableIds = [...sectionWrittenIds]
      .filter((id) => !unavailableIds.has(id))
      .sort();
    if (readableIds.length === 0) return {};
    const rows = await db.task.findMany({
      where: { id: { in: readableIds }, organizationId },
      select: {
        id: true,
        type: true,
        projectId: true,
        sections: { select: { key: true, materializedMarkdown: true } },
      },
    });
    const result: Record<string, PriorSectionSnapshot> = {};
    for (const { id, ...snapshot } of rows) result[id] = snapshot;
    const missing = readableIds.filter((id) => !result[id]);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Affected work item ${missing[0]} disappeared while preparing materialization.`,
      );
    }
    this.logger.debug('Captured prior section snapshots', {
      workItemCount: readableIds.length,
    });
    return result;
  }

  private assertRecoverableIntent(
    materialization: WorkItemChangeSetMaterialization,
  ): void {
    const prior =
      materialization.priorProjection as unknown as StoredProjection;
    const target =
      materialization.targetProjection as unknown as StoredProjection | null;
    const operationSet =
      materialization.operationSet as unknown as WorkItemChangeSetValidationRequest;
    const mappings = this.readIdentityMappings(materialization);
    if (
      prior?.schemaVersion !== 'work-item-change-set-projection.v1' ||
      target?.schemaVersion !== 'work-item-change-set-projection.v1' ||
      !Array.isArray(materialization.affectedWorkItemIds) ||
      !Array.isArray(materialization.affectedRelationshipIds) ||
      !this.isWorkItemChangeSetValidationRequest(operationSet) ||
      materialization.validationRevision !==
        this.validationRevision(operationSet) ||
      materialization.priorProjectionRevision !==
        materialization.validationRevision ||
      !mappings.workItems ||
      Array.isArray(mappings.workItems) ||
      !mappings.relationships ||
      Array.isArray(mappings.relationships)
    ) {
      throw new BadRequestException(
        'Stored work-item change-set intent does not satisfy the convergent materialization protocol.',
      );
    }
    const resolvedRoot = this.resolveWorkItemId(
      operationSet.root,
      mappings.workItems,
    );
    if (resolvedRoot !== materialization.rootWorkItemId) {
      throw new BadRequestException(
        'Stored work-item change-set root identity does not match its stable binding.',
      );
    }
  }

  private async releaseFences(
    materializationId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.db.workItemChangeSetMaterialization.updateMany({
      where: {
        id: materializationId,
        claimToken,
        status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
        fencesReleasedAt: null,
      },
      data: {
        fencesReleasedAt: new Date(),
        claimToken: null,
        claimExpiresAt: null,
      },
    });
  }

  private async markIntentRecoverableFailure(
    materializationId: string,
    claimToken: string,
    error: unknown,
    failure = normalizedFailure(error),
  ): Promise<void> {
    await this.prisma.db.workItemChangeSetMaterialization.updateMany({
      where: {
        id: materializationId,
        claimToken,
        status: WorkItemChangeSetMaterializationStatus.APPLYING,
      },
      data: {
        status: WorkItemChangeSetMaterializationStatus.PREPARED,
        lastError: serializeProposalApprovalFailure(
          failure.message,
          failure.diagnostic,
        ),
        claimToken: null,
        claimExpiresAt: null,
      },
    });
  }

  private allocateIdentityMappings(
    request: WorkItemChangeSetValidationRequest,
    reservedRootWorkItemId?: TaskId,
  ): IdentityMappings {
    const workItems: Record<string, string> = {};
    const relationships: Record<string, string> = {};
    const visitWorkItem = (
      identity: WorkItemChangeSetIdentity | null | undefined,
    ) => {
      if (!identity) return;
      const key = this.workItemKey(identity);
      if (workItems[key]) return;
      workItems[key] = identity.refType === 'existing' ? identity.id : uuidv4();
    };
    const visitRelationship = (
      identity: WorkItemChangeSetRelationshipIdentity | undefined,
    ) => {
      if (!identity) return;
      relationships[this.relationshipKey(identity)] =
        identity.refType === 'existing' ? identity.id : uuidv4();
    };

    visitWorkItem(request.root);
    if (reservedRootWorkItemId) {
      if (request.root.refType !== 'temporary') {
        throw new BadRequestException(
          'A reserved root identity cannot replace an existing work item.',
        );
      }
      workItems[this.workItemKey(request.root)] = reservedRootWorkItemId;
    }
    for (const operation of request.operations) {
      if ('ref' in operation && operation.op.startsWith('workItem.')) {
        visitWorkItem(operation.ref as WorkItemChangeSetIdentity);
      }
      if ('root' in operation) visitWorkItem(operation.root);
      if ('parent' in operation) visitWorkItem(operation.parent);
      if ('source' in operation) visitWorkItem(operation.source);
      if ('target' in operation) visitWorkItem(operation.target);
      if (
        operation.op === 'relationship.create' ||
        operation.op === 'relationship.update' ||
        operation.op === 'relationship.delete'
      ) {
        visitRelationship(operation.ref);
      }
    }
    this.logger.debug('Allocated generic change-set identity mappings', {
      workItemCount: Object.keys(workItems).length,
      relationshipCount: Object.keys(relationships).length,
      reservedRootWorkItemId: reservedRootWorkItemId ?? null,
    });
    return { workItems, relationships };
  }

  private includeProjectionIdentities(
    mappings: IdentityMappings,
    projection: ProjectedWorkItemChangeSetResponse,
  ): void {
    const includeWorkItem = (identity: WorkItemChangeSetIdentity) => {
      const key = this.workItemKey(identity);
      if (mappings.workItems[key]) return;
      if (identity.refType !== 'existing') {
        throw new BadRequestException(
          `Projected temporary work item ${identity.tempId} has no preallocated identity.`,
        );
      }
      mappings.workItems[key] = identity.id;
    };
    const includeRelationship = (
      identity: WorkItemChangeSetRelationshipIdentity,
    ) => {
      const key = this.relationshipKey(identity);
      if (mappings.relationships[key]) return;
      if (identity.refType !== 'existing') {
        throw new BadRequestException(
          `Projected temporary relationship ${identity.tempId} has no preallocated identity.`,
        );
      }
      mappings.relationships[key] = identity.id;
    };

    [projection.projectedRoot, ...projection.children].forEach((node) => {
      includeWorkItem(node.identity);
      if (node.parent) includeWorkItem(node.parent);
    });
    projection.incidentRelationships.forEach((relationship) => {
      includeRelationship(relationship.identity);
      includeWorkItem(relationship.source);
      includeWorkItem(relationship.target);
    });
  }

  private readIdentityMappings(
    materialization: WorkItemChangeSetMaterialization,
  ): IdentityMappings {
    return {
      workItems: materialization.workItemIdMappings as Record<string, string>,
      relationships: materialization.relationshipIdMappings as Record<
        string,
        string
      >,
    };
  }

  private toCreateTaskDto(
    operation: Extract<WorkItemChangeSetOperation, { op: 'workItem.create' }>,
    mappings: IdentityMappings,
  ): CreateTaskDto {
    return {
      name: operation.name,
      type: operation.type,
      parentTaskId: operation.parent
        ? this.resolveWorkItemId(operation.parent, mappings.workItems)
        : undefined,
      status: operation.status,
      priority: operation.priority,
      dueDate: operation.dueDate ?? undefined,
      assigneeId: operation.assigneeId ?? undefined,
      tag: operation.tag,
    };
  }

  private async findTaskProposalPayload(
    proposalId: string,
    operation:
      | Extract<WorkItemChangeSetOperation, { op: 'workItem.create' }>
      | Extract<WorkItemChangeSetOperation, { op: 'workItem.update' }>,
  ): Promise<TaskProposalMaterializationPayload | null> {
    const proposal = await this.prisma.db.proposal.findUnique({
      where: { id: proposalId },
      select: { action: true, targetEntityType: true, updates: true },
    });
    if (
      !proposal ||
      proposal.targetEntityType !== 'TASK' ||
      !['CREATE', 'UPDATE'].includes(proposal.action)
    ) {
      return null;
    }
    const updates = this.requireTaskProposalPayload(proposal.updates);
    if (proposal.action === 'UPDATE') {
      return { action: 'UPDATE', updates };
    }
    if (operation.ref.refType !== 'temporary') return null;
    if (operation.ref.tempId === 'root') {
      return { action: 'CREATE', updates };
    }
    const taskUpdates = updates as unknown as CreateTaskDto;
    const stepTempId = operation.ref.tempId.startsWith('workflowStep:')
      ? operation.ref.tempId.slice('workflowStep:'.length)
      : null;
    const step = taskUpdates.workflowSteps?.find(
      (candidate) => candidate.tempId === stepTempId,
    );
    if (!step) return null;
    return {
      action: 'CREATE',
      updates: {
        ...(step as unknown as TaskProposalPayload),
        ...(Object.prototype.hasOwnProperty.call(updates, 'initiativeId')
          ? { initiativeId: taskUpdates.initiativeId }
          : {}),
      },
    };
  }

  private mergeCreateTaskProposalPayload(
    base: CreateTaskDto,
    payload: TaskProposalMaterializationPayload | null,
  ): CreateTaskDto & { serviceIds?: string[] } {
    if (!payload || payload.action !== 'CREATE') return base;
    const original = payload.updates as unknown as CreateTaskDto;
    return {
      ...base,
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'sections')
        ? { sections: original.sections }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'initiativeId')
        ? { initiativeId: original.initiativeId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'source')
        ? { source: original.source }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'config')
        ? { config: original.config }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'serviceId')
        ? { serviceId: original.serviceId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'serviceIds')
        ? {
            serviceIds: payload.updates.serviceIds as string[],
          }
        : {}),
    };
  }

  private mergeUpdateTaskProposalPayload(
    base: UpdateTaskDto,
    payload: TaskProposalMaterializationPayload | null,
  ): UpdateTaskDto & { serviceIds?: string[] } {
    if (!payload || payload.action !== 'UPDATE') return base;
    const original = payload.updates as unknown as UpdateTaskDto;
    return {
      ...base,
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'sections')
        ? { sections: original.sections }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'initiativeId')
        ? { initiativeId: original.initiativeId }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'type')
        ? { type: original.type }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        payload.updates,
        'sectionUpdateSource',
      )
        ? { sectionUpdateSource: original.sectionUpdateSource }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'reason')
        ? { reason: original.reason }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.updates, 'serviceIds')
        ? {
            serviceIds: payload.updates.serviceIds as string[],
          }
        : {}),
    };
  }

  private readServiceIds(
    payload: TaskProposalMaterializationPayload | null,
  ): string[] | undefined {
    if (
      !payload ||
      !Object.prototype.hasOwnProperty.call(payload.updates, 'serviceIds')
    ) {
      return undefined;
    }
    return this.requireServiceIds(payload.updates.serviceIds);
  }

  private requireServiceIds(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
      throw new BadRequestException(
        'Task proposal serviceIds must be an array of service IDs.',
      );
    }
    return value;
  }

  private toUpdateTaskDto(
    operation: Extract<WorkItemChangeSetOperation, { op: 'workItem.update' }>,
    mappings: IdentityMappings,
  ): UpdateTaskDto {
    return {
      name: operation.name,
      ...(Object.prototype.hasOwnProperty.call(operation, 'parent')
        ? {
            parentTaskId: operation.parent
              ? this.resolveWorkItemId(operation.parent, mappings.workItems)
              : null,
          }
        : {}),
      status: operation.status,
      priority: operation.priority,
      ...(Object.prototype.hasOwnProperty.call(operation, 'dueDate')
        ? { dueDate: operation.dueDate }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(operation, 'assigneeId')
        ? { assigneeId: operation.assigneeId }
        : {}),
      tag: operation.tag,
    };
  }

  private toCreateAgentEdgeDto(
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.create' }
    >,
    mappings: IdentityMappings,
  ): CreateAgentEdgeDto {
    return {
      id: this.resolveRelationshipId(operation.ref, mappings.relationships),
      sourceNodeId: this.resolveWorkItemId(
        operation.source,
        mappings.workItems,
      ),
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetNodeId: this.resolveWorkItemId(
        operation.target,
        mappings.workItems,
      ),
      targetEntityType: AgentEdgeEndpointEntityType.Task,
      type: operation.edgeType,
      category: operation.category,
      ...('direction' in operation
        ? { direction: operation.direction ?? undefined }
        : {}),
      ...('predicate' in operation
        ? { predicate: operation.predicate ?? undefined }
        : {}),
      metadata: operation.metadata,
      reasoning:
        operation.reasoning ?? 'Generic work-item change-set relationship.',
    };
  }

  private toUpdateAgentEdgeDto(
    operation: Extract<
      WorkItemChangeSetOperation,
      { op: 'relationship.update' }
    >,
    mappings: IdentityMappings,
    proposalId: string,
  ): UpdateAgentEdgeDto {
    return {
      ...(operation.source
        ? {
            sourceNodeId: this.resolveWorkItemId(
              operation.source,
              mappings.workItems,
            ),
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
          }
        : {}),
      ...(operation.target
        ? {
            targetNodeId: this.resolveWorkItemId(
              operation.target,
              mappings.workItems,
            ),
            targetEntityType: AgentEdgeEndpointEntityType.Task,
          }
        : {}),
      type: operation.edgeType,
      category: operation.category,
      direction: operation.direction,
      predicate: operation.predicate,
      metadata: operation.metadata,
      reasoning: operation.reasoning ?? undefined,
      lastModifiedBySessionId: proposalId,
    };
  }

  private resolveWorkItemId(
    identity: WorkItemChangeSetIdentity,
    mappings: Record<string, string>,
  ): string {
    if (identity.refType === 'existing') {
      return identity.id;
    }
    const id = mappings[this.workItemKey(identity)];
    if (!id) {
      throw new BadRequestException('Missing work-item identity mapping.');
    }
    return id;
  }

  private resolveRelationshipId(
    identity: WorkItemChangeSetRelationshipIdentity,
    mappings: Record<string, string>,
  ): string {
    if (identity.refType === 'existing') {
      return identity.id;
    }
    const id = mappings[this.relationshipKey(identity)];
    if (!id) {
      throw new BadRequestException('Missing relationship identity mapping.');
    }
    return id;
  }

  private workItemKey(identity: WorkItemChangeSetIdentity): string {
    return identity.refType === 'existing'
      ? `existing:${identity.id}`
      : `temporary:${identity.tempId}`;
  }

  private relationshipKey(
    identity: WorkItemChangeSetRelationshipIdentity,
  ): string {
    return identity.refType === 'existing'
      ? `existing:${identity.id}`
      : `temporary:${identity.tempId}`;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}
