import { PlanDependenciesService } from '../plan/plan-dependencies.service';
import { orderPlanStages } from '../plan/order-plan-stages';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { WorkStatus } from '@prisma/client';

import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { TaskService, type TaskEntity } from '../tasks/task.service';
import {
  FeatureRequirementsReadError,
  readCanonicalFeatureRequirementsContent,
  readFeatureRequirementsSection,
} from '../tasks/feature-requirements-reader';
import { PrismaService } from 'src/prisma/prisma.service';
import { withApiSpan } from '../../telemetry/api-tracing';
import type { OrganizationId, ProjectId, TaskId } from 'src/types';
import type { EntityType } from 'src/generated/model/entityType';
import { ProjectApprovalPolicyService } from 'src/services/proposal/project-approval-policy.service';
import {
  mapProposalResponses,
  resolveProjectApprovalPolicies,
} from 'src/services/proposal/proposal-response-policy';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from 'src/services/proposal/proposal-visibility';
import {
  loadAuthorizedConversationSeed,
  type AuthorizedConversationSeed,
  type ConversationSeedKind,
} from './conversation-seed-context';
import type { ProposalWithApprovals } from 'src/services/proposal/proposal.types';
import {
  GOAL_TRACKS_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
} from 'src/mcp/tools/proposal-tool-names';
import { EntityType as EntityTypeEnum } from 'src/generated/model/entityType';
import { GraphsClientService } from 'src/services/graphs-client.service';
import {
  AGENT_EDGE_LABELS,
  graphRelationshipToAgentEdge,
} from 'src/services/graphs/agent-edge-mapping';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import type {
  EntityNeighborhoodRelatedEntity,
  EntityNeighborhoodResponse,
  IncidentEdgesRequest,
} from 'src/generated/graphs';
import type { AvailableMcpToolDto } from 'src/generated/model/availableMcpToolDto';
import type { EntityContextDto } from 'src/generated/model/entityContextDto';
import type { FullEntityContextDto } from 'src/generated/model/fullEntityContextDto';
import type { EntityContentDto } from 'src/generated/model/entityContentDto';
import type { ContextRelatedEntityDto } from 'src/generated/model/contextRelatedEntityDto';
import type { RelatedEntityViaDto } from 'src/generated/model/relatedEntityViaDto';
import type { PlanContextDto } from 'src/generated/model/planContextDto';
import type { PlanContextEntryDto } from 'src/generated/model/planContextEntryDto';
import type { AgentSessionEntryDto } from 'src/generated/model/agentSessionEntryDto';
import type { FeatureHierarchyEntryDto } from 'src/generated/model/featureHierarchyEntryDto';
import type { FeatureTag } from 'src/generated/model/featureTag';
import type { AncestorFeatureDto } from 'src/generated/model/ancestorFeatureDto';
import type { FeatureSyncContextDto } from 'src/generated/model/featureSyncContextDto';
import type { FeatureListItemDto } from 'src/generated/model/featureListItemDto';
import type { FeatureSkeletonNode } from 'src/generated/model/featureSkeletonNode';
import type { ListFeaturesResponseDto } from 'src/generated/model/listFeaturesResponseDto';
import type { ActiveGoalDto } from 'src/generated/model/activeGoalDto';
import type { ActiveGoalsResponseDto } from 'src/generated/model/activeGoalsResponseDto';
import type { ProposalDetail } from 'src/generated/model/proposalDetail';
import { GoalAudience } from 'src/generated/model/goalAudience';
import type { AgentEdge } from 'src/generated/graphs/model/agentEdge';
import {
  type EdgeDirection,
  agentEdgeToRelationship,
  isAgentEdgeRelationshipType,
  isFlowAgentEdgeRelationshipType,
} from './relationship-mapping';
import { projectContextProposalSummaries } from './proposal-history-projection';

export type {
  AvailableMcpToolDto,
  EntityContextDto,
  FullEntityContextDto,
  EntityContentDto,
  ContextRelatedEntityDto,
  RelatedEntityViaDto,
  PlanContextDto,
  PlanContextEntryDto,
  AgentSessionEntryDto,
  FeatureHierarchyEntryDto,
  AncestorFeatureDto,
  FeatureSyncContextDto,
  FeatureListItemDto,
  FeatureSkeletonNode,
  ListFeaturesResponseDto,
  ActiveGoalDto,
  ActiveGoalsResponseDto,
};

// MCP-only listing shape for goals. Goals are flat (no parent/depth)
// with an optional target date (see Goals feature
// requirement 2), so the wire shape diverges from FeatureListItemDto.
// Defined inline rather than going through OpenAPI generation because
// list_goals has no HTTP endpoint counterpart.
export interface GoalListItemDto {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
}

export interface ListGoalsResponseDto {
  items: GoalListItemDto[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface EntityContextIncludeFlags {
  includeRelatedEntities?: boolean;
  includeFeatureHierarchy?: boolean;
  includePlan?: boolean;
  includeProposals?: boolean;
  includeAvailableMcpTools?: boolean;
  relatedEntityDepth?: RelatedEntityDepth;
  proposalDetail?: ProposalDetail;
}

export type RelatedEntityDepth = 1 | 2;

/**
 * Agent-authored edge relationship types accepted by `resolveDependentTasks`.
 * Narrower than the agent-edge mapping in relationship-mapping.ts because the
 * dependent-tasks endpoint exposes a stable enum on its DTO.
 */
const DEPENDENT_TASK_RELATIONSHIP_TYPES = [
  'DEPENDS_ON',
  'DERIVES_FROM',
  'SUPERSEDES',
  'CONTRADICTS',
  'RELATED_TO',
  'EVOLVES',
] as const;

export type AgentEdgeRelationshipType =
  (typeof DEPENDENT_TASK_RELATIONSHIP_TYPES)[number];

export interface DependentTaskDto {
  entityId: string;
  entityType: string;
  displayName: string;
  status: string;
  relationshipType: AgentEdgeRelationshipType;
  direction: 'outbound' | 'inbound';
  description: string | null;
  acceptanceCriteria: string | null;
  edgeReasoning: string;
}

/**
 * Edge types `getEdges` surfaces: the canonical agent edge vocabulary,
 * workflow edge vocabulary, INFLUENCES (proposal-influence edges), and
 * PROPOSED_TOGETHER (symmetric, system-emitted edges materialized by the
 * Graph service from approved proposals). This list must stay in lockstep
 * with the get_edges output enum in edge-tools.provider.ts — emitting a type
 * outside it would fail that tool's output validation. PROPOSED_TOGETHER and
 * workflow edges are intentionally absent from the raw create_edge/update_edge
 * authoring subset; get_edges is a read surface.
 */
const GET_EDGES_EDGE_TYPES = [
  'RELATED_TO',
  'DEPENDS_ON',
  'DERIVES_FROM',
  'SUPERSEDES',
  'CONTRADICTS',
  'EVOLVES',
  'FULFILLED_BY',
  'STANDARD',
  'CONDITIONAL',
  'LOOP',
  'INFLUENCES',
  'PROPOSED_TOGETHER',
] as const;

export type GetEdgesEdgeType = (typeof GET_EDGES_EDGE_TYPES)[number];

function isGetEdgesEdgeType(value: string): value is GetEdgesEdgeType {
  return (GET_EDGES_EDGE_TYPES as readonly string[]).includes(value);
}

/** A {entityType, entityId} seed pair accepted by `getEdges`. */
export interface GetEdgesSeed {
  entityType: string;
  entityId: string;
}

/** The far end of an edge, resolved from the traversal's depth-1 nodes. */
export interface EdgeEndpointDto {
  entityType: string;
  entityId: string;
  displayName: string;
  taskType?: string;
}

/**
 * One direct edge incident on a seed, as returned by `getEdges`. Direction
 * is relative to the seed: `out` when the seed is the edge source, `in`
 * when it is the target. `reasonType` is populated only for INFLUENCES
 * edges.
 */
export interface EntityEdgeDto {
  direction: 'out' | 'in';
  edgeType: GetEdgesEdgeType;
  otherEndpoint: EdgeEndpointDto;
  createdAt: string;
  reasonType?: string;
}

const TASK = EntityTypeEnum.Task;

/**
 * Relationship types included in the topology traversal.
 * Excludes messaging and scoping relationships
 * to keep context focused on structural project topology.
 */
const TOPOLOGY_RELATIONSHIP_WHITELIST: RelationshipType[] = [
  RelationshipType.HasTask,
  RelationshipType.HasPlanStage,
  RelationshipType.HasPlanStep,
  RelationshipType.HasDesignDoc,
  RelationshipType.HasAgentSession,
  RelationshipType.HasImplementationHint,
  RelationshipType.HasPrompt,
  RelationshipType.PlanTracks,
  RelationshipType.PlanStageTracks,
  RelationshipType.PlanStepTracks,
  RelationshipType.Tracks,
  RelationshipType.AgentLinked,
  RelationshipType.Blocks,
  RelationshipType.CreatedVia,
  RelationshipType.DerivesFrom,
  RelationshipType.Influences,
  RelationshipType.Mentions,
  RelationshipType.ProposedTogether,
];

const DEFAULT_RELATED_ENTITY_DEPTH: RelatedEntityDepth = 1;
const DEFAULT_PROPOSAL_COUNT = 4;
const DEFAULT_PROPOSAL_QUERY_COUNT = 10;
const FULL_PROPOSAL_QUERY_COUNT = 50;

/**
 * Internal return shape from `buildPlanContext`. The public `PlanContextDto`
 * lives inside; `planResidentFeatureSeedId` is a private carrier that lets
 * `buildFeatureHierarchy` pivot a plan-resident seed through `plan.parentTaskId`
 * without leaking that ID onto the wire-facing DTO.
 */
interface BuildPlanContextResult {
  planContext: PlanContextDto;
  planResidentFeatureSeedId: string | null;
}

interface BuildPlanPivotsResult {
  planPivotEntityIds: Set<string>;
  planResidentFeatureSeedId: string | null;
}

/**
 * The TASK row already authorized for this request (org-scoped, unarchived,
 * project-checked). Content and metadata reuse it instead of re-reading the
 * same row, so it must stay a plain scalar fetch with no include.
 */
type AuthorizedTaskSeed = Pick<
  TaskEntity,
  | 'type'
  | 'name'
  | 'createdAt'
  | 'status'
  | 'priority'
  | 'assigneeId'
  | 'dueDate'
>;

function authorizedSeedMeta(
  seed: AuthorizedTaskSeed | AuthorizedConversationSeed,
): { createdAt: string; displayName: string; taskType?: string } {
  if ('meta' in seed) {
    return {
      createdAt: seed.meta.createdAt.toISOString(),
      displayName: seed.meta.displayName,
    };
  }
  return {
    createdAt: seed.createdAt.toISOString(),
    displayName: seed.name ?? '(unnamed)',
    taskType: seed.type,
  };
}

/**
 * Collects the entity IDs of PLAN / PLAN_STAGE pivots reachable through the
 * seed's planContext. These are the plan-tree entities that should be
 * excluded from relatedEntities and used as pivots for sibling-via-parent
 * lookup. The seed itself is included when it is a PLAN — the seed
 * exclusion in isExcludedFromRelated still drops it from the flat list, but
 * letting it act as a pivot means tasks tracked by the PLAN can find a
 * pivot match through it.
 */
function collectPlanPivotEntityIds(
  planContext: PlanContextDto | null,
): Set<string> {
  const ids = new Set<string>();
  if (!planContext) return ids;
  if (planContext.parentPlan) ids.add(planContext.parentPlan.id);
  if (planContext.parentStage) ids.add(planContext.parentStage.id);
  for (const stage of planContext.siblingStages ?? []) {
    ids.add(stage.id);
  }
  return ids;
}

/**
 * Materializes a list of CRDT-backed sections into a flat
 * key -> markdown map for the EntityContentDto content body. Sections
 * are emitted in `order` so the map's insertion order matches how the
 * entity renders. A null `materializedMarkdown` collapses to an empty
 * string — the section exists, it just has no content yet.
 */
function formatSections(
  sections: {
    key: string;
    order: number;
    materializedMarkdown: string | null;
  }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const s of [...sections].sort((a, b) => a.order - b.order)) {
    result[s.key] = s.materializedMarkdown ?? '';
  }
  return result;
}

/**
 * Drops duplicate entries from a merged list, keeping the first occurrence
 * of each key. Used to union PLAN_STEP related entities and agent sessions
 * drawn from both the step ID and its backing entity ID — step-side entries
 * are listed first, so they win ties.
 */
function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * MCP tools keyed by viewing context — the entity type whose
 * context menu surfaces the tool, not the tool's target type.
 */
const MCP_TOOLS_BY_ENTITY_TYPE: Partial<
  Record<EntityType, AvailableMcpToolDto[]>
> = {
  TASK: [
    {
      toolName: GOAL_TRACKS_TOOL_NAMES.ATTACH_TO_GOAL,
      targetEntityType: TASK,
      label: 'Add to Goal...',
      description: 'Attach this task to a goal',
      validTaskTypes: [
        WORK_ITEM_TYPE_KEYS.Standard,
        WORK_ITEM_TYPE_KEYS.Bug,
        WORK_ITEM_TYPE_KEYS.Feature,
      ],
    },
  ],
  INITIATIVE: [
    {
      toolName: PROPOSAL_TOOL_NAMES.CREATE_WORK_ITEM,
      targetEntityType: TASK,
      label: 'Create work item...',
      description: 'Propose a new work item',
    },
  ],
};

function withCreatingProposal(
  proposals: readonly ProposalWithApprovals[],
  creatingProposal: ProposalWithApprovals | null,
): ProposalWithApprovals[] {
  const combined =
    creatingProposal &&
    !proposals.some((proposal) => proposal.id === creatingProposal.id)
      ? [...proposals, creatingProposal]
      : [...proposals];
  return combined.sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

@Injectable()
export class EntityContextService {
  private readonly logger = new Logger(EntityContextService.name);

  constructor(
    private readonly planDependencies: PlanDependenciesService,
    private readonly prisma: PrismaService,
    private readonly graphsClientService: GraphsClientService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly taskService: TaskService,
    @Optional()
    private readonly projectApprovalPolicyService: ProjectApprovalPolicyService = new ProjectApprovalPolicyService(),
  ) {}

  async getEntityContext(
    organizationId: OrganizationId,
    entityType: EntityType,
    entityId: string,
    includeFlags?: EntityContextIncludeFlags,
    proposalTargetEntityIds: readonly string[] = [entityId],
    seed?: AuthorizedTaskSeed | AuthorizedConversationSeed,
  ): Promise<EntityContextDto> {
    const includeProposals = includeFlags?.includeProposals !== false;
    const includeMcpTools = includeFlags?.includeAvailableMcpTools !== false;
    const proposalDetail = includeFlags?.proposalDetail ?? 'summary';

    const [rawProposals, entityMeta, creatingProposal] = await Promise.all([
      includeProposals
        ? this.findProposalsByEntities(
            organizationId,
            proposalTargetEntityIds,
            proposalDetail === 'summary'
              ? DEFAULT_PROPOSAL_QUERY_COUNT
              : FULL_PROPOSAL_QUERY_COUNT,
          )
        : Promise.resolve([] as ProposalWithApprovals[]),
      seed
        ? Promise.resolve(authorizedSeedMeta(seed))
        : this.resolveEntityMeta(entityType, entityId),
      this.findCreatingProposal(organizationId, entityId),
    ]);

    const { createdAt, displayName, taskType } = entityMeta;

    const nonCreateProposals = rawProposals.filter(
      (proposal) => proposal.action !== 'CREATE',
    );
    const comparisonProposals = withCreatingProposal(
      rawProposals,
      creatingProposal,
    );
    const proposalsToMap =
      proposalDetail === 'summary'
        ? withCreatingProposal(
            nonCreateProposals.slice(0, DEFAULT_PROPOSAL_COUNT),
            creatingProposal,
          )
        : rawProposals;
    const projectPolicies = includeProposals
      ? await resolveProjectApprovalPolicies(
          this.projectApprovalPolicyService,
          proposalsToMap,
        )
      : undefined;
    const mappedProposals =
      includeProposals && projectPolicies
        ? await mapProposalResponses(
            this.prisma.db,
            proposalsToMap,
            projectPolicies,
            { workItemTypeRegistry: this.workItemTypeRegistry },
          )
        : undefined;

    return {
      entityId,
      entityType,
      displayName,
      createdAt,
      ...(taskType !== undefined ? { taskType } : {}),
      creatingProposalId: creatingProposal?.id,
      proposalDetail: includeProposals ? proposalDetail : undefined,
      olderProposalsOmitted: includeProposals
        ? proposalDetail === 'summary' &&
          nonCreateProposals.length > DEFAULT_PROPOSAL_COUNT
        : undefined,
      proposals:
        mappedProposals === undefined
          ? undefined
          : proposalDetail === 'full'
            ? mappedProposals
            : projectContextProposalSummaries(
                mappedProposals,
                comparisonProposals.map((proposal) => ({
                  id: proposal.id,
                  updates: proposal.updates,
                  createdAt: proposal.createdAt.toISOString(),
                  targetEntityId: proposal.targetEntityId,
                })),
              ),
      availableMcpTools: includeMcpTools
        ? this.getToolsForEntityType(entityType)
        : undefined,
    };
  }

  async getFullEntityContext(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    userToken: string | null,
    includeFlags?: EntityContextIncludeFlags,
  ): Promise<FullEntityContextDto> {
    return withApiSpan('entity_context.assemble_full', () =>
      this.assembleFullEntityContext(
        organizationId,
        projectId,
        entityType,
        entityId,
        userToken,
        includeFlags,
      ),
    );
  }

  private async assembleFullEntityContext(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    userToken: string | null,
    includeFlags?: EntityContextIncludeFlags,
  ): Promise<FullEntityContextDto> {
    this.logger.log('getFullEntityContext called', {
      organizationId,
      projectId,
      entityType,
      entityId,
      includeFlags,
    });

    let seed: AuthorizedTaskSeed | undefined;
    if (entityType === EntityTypeEnum.Task) {
      const task = await this.taskService.findPersistedByOrganization(
        organizationId,
        entityId as TaskId,
      );
      if (!task || task.projectId !== projectId) {
        throw new NotFoundException(
          `${entityType} with id ${entityId} not found`,
        );
      }
      seed = task;
    }
    let conversationSeed: AuthorizedConversationSeed | undefined;
    if (
      entityType === EntityTypeEnum.Conversation ||
      entityType === EntityTypeEnum.Message
    ) {
      conversationSeed = await loadAuthorizedConversationSeed(
        this.prisma.db,
        organizationId,
        projectId,
        entityType as ConversationSeedKind,
        entityId,
      );
    }

    const wantRelatedEntities = includeFlags?.includeRelatedEntities !== false;
    const wantHierarchy = includeFlags?.includeFeatureHierarchy !== false;
    const wantPlanContext = includeFlags?.includePlan !== false;

    if (wantRelatedEntities && !userToken) {
      this.logger.warn(
        'getFullEntityContext: no auth token — relatedEntities will be empty',
        { entityId, entityType },
      );
    }

    // Independent reads start only after successful seed authorization.
    const contentPromise = this.loadEntityContent(
      projectId,
      entityType,
      entityId,
      seed,
    );
    const contextPromise = this.getEntityContext(
      organizationId,
      entityType,
      entityId,
      includeFlags,
      [entityId],
      seed ?? conversationSeed,
    );
    const planPromise = wantPlanContext
      ? this.buildPlanContext(entityType, entityId)
      : Promise.resolve(null);
    const planPivotsPromise: Promise<BuildPlanPivotsResult> = wantPlanContext
      ? planPromise.then((placement) => ({
          planPivotEntityIds: collectPlanPivotEntityIds(
            placement?.planContext ?? null,
          ),
          planResidentFeatureSeedId:
            placement?.planResidentFeatureSeedId ?? null,
        }))
      : wantHierarchy || wantRelatedEntities
        ? this.buildPlanContextPivots(entityType, entityId, wantRelatedEntities)
        : Promise.resolve({
            planPivotEntityIds: new Set<string>(),
            planResidentFeatureSeedId: null,
          });
    // Agent edges feed both buildFeatureHierarchy's typed-edge entries
    // and the auxiliary loader's related-entities merge — fetch once and
    // share so a non-step seed never double-fetches them.
    const edgesPromise =
      wantRelatedEntities || wantHierarchy
        ? this.fetchAgentEdges(organizationId, projectId, entityId, userToken)
        : Promise.resolve([] as AgentEdge[]);

    const hierarchyPromise = Promise.all([
      planPivotsPromise,
      edgesPromise,
    ]).then(([planPivots, agentEdges]) =>
      wantHierarchy
        ? this.buildFeatureHierarchy(
            projectId,
            entityType,
            entityId,
            agentEdges,
            planPivots.planResidentFeatureSeedId,
          )
        : [],
    );

    // Neighborhood reads depend on topology pivots, not proposal history.
    const auxiliaryPromise = Promise.all([
      planPivotsPromise,
      edgesPromise,
      hierarchyPromise,
    ]).then(([planPivots, agentEdges, featureHierarchy]) =>
      this.loadNeighborhoodContext(
        organizationId,
        projectId,
        entityType,
        entityId,
        userToken,
        agentEdges,
        new Set(featureHierarchy.map((f) => f.id)),
        planPivots.planPivotEntityIds,
        includeFlags,
        wantRelatedEntities,
      ),
    );
    const reads = [
      contentPromise,
      contextPromise,
      planPromise,
      planPivotsPromise,
      edgesPromise,
      hierarchyPromise,
      auxiliaryPromise,
    ] as const;
    // Preserve the rejection while settling all started work before releasing
    // this seed's batch-concurrency slot.
    const [content, context, placement, , , featureHierarchy, auxiliary] =
      await Promise.all(reads).finally(() => Promise.allSettled(reads));
    const planContext = placement?.planContext ?? null;

    const result: FullEntityContextDto = { ...context };
    if (planContext) {
      result.planContext = planContext;
    }
    if (wantRelatedEntities) {
      result.relatedEntities = auxiliary.relatedEntities ?? [];
      result.agentSessions = auxiliary.agentSessions ?? [];
    }
    if (wantHierarchy) {
      result.featureHierarchy = featureHierarchy;
    }
    if (content) {
      result.content = content;
    }
    if (conversationSeed) {
      result.conversationContext = conversationSeed.conversationContext;
    }

    this.logger.log('getFullEntityContext completed', {
      entityId,
      entityType,
      relatedEntityCount: result.relatedEntities?.length ?? 0,
      agentSessionCount: result.agentSessions?.length ?? 0,
      agentAuthoredCount:
        result.relatedEntities?.filter((e) => e.source === 'agent').length ?? 0,
      featureHierarchyCount: result.featureHierarchy?.length ?? 0,
      planContextPresent: result.planContext !== undefined,
      contentPresent: result.content !== undefined,
    });

    return result;
  }

  /**
   * Loads the content body for an entity: its materialized sections plus
   * work-tracking metadata. TASK / FEATURE / GOAL all resolve through the
   * TASK loader (they are TASK rows); DESIGN_DOC resolves through the
   * design-doc loader. Every other entity type has no content body and
   * yields undefined, so get_context omits the `content` field for it.
   */
  private async loadEntityContent(
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    seed?: AuthorizedTaskSeed,
  ): Promise<EntityContentDto | undefined> {
    if (entityType === EntityTypeEnum.Task) {
      return this.loadTaskContent(projectId, entityId, seed);
    }
    if (entityType === EntityTypeEnum.DesignDoc) {
      return this.loadDesignDocContent(entityId);
    }
    return undefined;
  }

  /**
   * Builds the content body for a TASK row: its sections keyed by
   * section key, plus status / priority / assignee / dueDate. Returns
   * undefined when the task row is missing.
   *
   * The four lifecycle scalars are emitted only for status-bearing types
   * (STANDARD, BUG). Non-status-bearing types (FEATURE, GOAL) carry no
   * meaningful lifecycle status, assignee, or due date — their state is
   * read from links and tasks, not stored — so the scalars are omitted
   * for them while `sections` is kept for every type.
   */
  private async loadTaskContent(
    projectId: ProjectId,
    taskId: string,
    seed?: AuthorizedTaskSeed,
  ): Promise<EntityContentDto | undefined> {
    const task = seed
      ? {
          ...seed,
          sections: await this.prisma.db.taskSection.findMany({
            where: { taskId },
            select: { key: true, order: true, materializedMarkdown: true },
          }),
        }
      : await this.prisma.db.task.findUnique({
          where: { id: taskId },
          select: {
            type: true,
            status: true,
            priority: true,
            assigneeId: true,
            dueDate: true,
            sections: {
              select: { key: true, order: true, materializedMarkdown: true },
            },
          },
        });
    if (!task) {
      this.logger.warn('loadTaskContent: task not found', { taskId });
      return undefined;
    }
    // FEATURE is identified via the registry hierarchy-node capability;
    // GOAL is not a hierarchy node, so it is named explicitly. The
    // forbiddenScalars registry path can't express this rule —
    // TaskScalarField only spans 'dueDate' | 'tag', not status / priority
    // / assignee — so the suppression is an inline type check here.
    const isNonStatusBearing =
      this.workItemTypeRegistry.isHierarchyNode(
        task.type as WorkItemTypeKey,
        projectId,
      ) || task.type === WORK_ITEM_TYPE_KEYS.Goal;

    const content: EntityContentDto = {
      sections: formatSections(task.sections ?? []),
    };
    if (task.type === WORK_ITEM_TYPE_KEYS.Feature) {
      const requirementsContent = task.sections?.find(
        (section) => section.key === 'requirements',
      )?.materializedMarkdown;
      try {
        const requirementsSection =
          readFeatureRequirementsSection(requirementsContent);
        if (requirementsSection !== undefined) {
          content.requirementsSection = requirementsSection;
        }
      } catch (error) {
        this.logger.error('loadTaskContent: invalid feature requirements', {
          taskId,
          code:
            error instanceof FeatureRequirementsReadError
              ? error.code
              : 'unknown',
          diagnostic: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    if (!isNonStatusBearing) {
      content.priority = task.priority ?? null;
      content.assigneeId = task.assigneeId ?? null;
      content.dueDate = task.dueDate ? task.dueDate.toISOString() : null;
      if (task.status != null) {
        content.status = task.status;
      }
    }
    this.logger.log('loadTaskContent completed', {
      taskId,
      type: task.type,
      nonStatusBearing: isNonStatusBearing,
      seedReused: seed !== undefined,
      sectionCount: Object.keys(content.sections).length,
    });
    return content;
  }

  /**
   * Builds the content body for a DESIGN_DOC row: its sections keyed by
   * section key, plus status. Design docs carry no priority / assignee /
   * dueDate, so those task-shaped fields are left absent. Returns
   * undefined when the design-doc row is missing.
   */
  private async loadDesignDocContent(
    designDocId: string,
  ): Promise<EntityContentDto | undefined> {
    const doc = await this.prisma.db.designDoc.findUnique({
      where: { id: designDocId },
      select: {
        status: true,
        sections: {
          select: { key: true, order: true, materializedMarkdown: true },
        },
      },
    });
    if (!doc) {
      this.logger.warn('loadDesignDocContent: design doc not found', {
        designDocId,
      });
      return undefined;
    }
    const content: EntityContentDto = {
      sections: formatSections(doc.sections ?? []),
    };
    if (doc.status != null) {
      content.status = doc.status;
    }
    this.logger.log('loadDesignDocContent completed', {
      designDocId,
      sectionCount: Object.keys(content.sections).length,
    });
    return content;
  }

  /**
   * Loads related entities and agent sessions from the graph neighborhood.
   *
   * `agentEdges` is passed in rather than fetched here so the caller can
   * share one seed-scoped fetch with buildFeatureHierarchy.
   */
  private async loadNeighborhoodContext(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    userToken: string | null,
    agentEdges: AgentEdge[],
    featureIds: Set<string>,
    planPivotEntityIds: Set<string>,
    includeFlags: EntityContextIncludeFlags | undefined,
    wantRelatedEntities: boolean,
  ): Promise<{
    relatedEntities?: ContextRelatedEntityDto[];
    agentSessions?: AgentSessionEntryDto[];
  }> {
    if (!wantRelatedEntities) {
      return {};
    }

    const neighborhood = userToken
      ? await this.fetchEntityNeighborhood(
          organizationId,
          projectId,
          entityType,
          entityId,
          featureIds,
          planPivotEntityIds,
          userToken,
          includeFlags?.relatedEntityDepth ?? DEFAULT_RELATED_ENTITY_DEPTH,
        )
      : null;

    const { relatedEntities, agentSessions } = await this.assembleNeighborhood(
      organizationId,
      projectId,
      entityId,
      neighborhood,
      agentEdges,
      featureIds,
      planPivotEntityIds,
    );

    return { relatedEntities, agentSessions };
  }

  /**
   * Resolves tasks connected to the given entity via agent-authored edges.
   *
   * Fetches both outbound (entity → target) and inbound (source → entity)
   * agent edges, filters to the five semantic relationship types, then
   * hydrates each connected task with its description and acceptance
   * criteria from the TaskSection table.
   *
   * Only direct connections are returned (not transitive).
   */
  async resolveDependentTasks(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityId: string,
    userToken: string | null,
  ): Promise<DependentTaskDto[]> {
    this.logger.log('resolveDependentTasks called', {
      organizationId,
      projectId,
      entityId,
    });

    if (!userToken) {
      this.logger.warn(
        'resolveDependentTasks: no auth token — returning empty',
        { entityId },
      );
      return [];
    }

    const pageSize = 100;
    const request: IncidentEdgesRequest = {
      seedEntityIds: [entityId],
      relationshipTypes: [...AGENT_EDGE_LABELS, 'AGENT_LINKED'],
    };

    let response: Awaited<ReturnType<GraphsClientService['readIncidentEdges']>>;
    try {
      response = await this.graphsClientService.readIncidentEdges(
        organizationId,
        projectId,
        request,
        userToken,
      );
    } catch (error) {
      this.logger.warn('resolveDependentTasks: failed to fetch agent edges', {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    for (const group of response.groups) {
      if (group.neighborTotal > pageSize) {
        this.logger.warn('resolveDependentTasks: edges may be truncated', {
          seedEntityId: group.seedEntityId,
          neighborTotal: group.neighborTotal,
          pageSize,
        });
      }
    }

    type DirectedEdge = {
      taskId: TaskId;
      direction: 'outbound' | 'inbound';
      relationshipType: AgentEdgeRelationshipType;
      reasoning: string;
    };

    const directedEdges: DirectedEdge[] = [];
    const seenEdgeIds = new Set<string>();
    for (const seedResult of response.groups) {
      if (seedResult.seedEntityId !== entityId) continue;
      for (const relationship of seedResult.relationships ?? []) {
        const edge = graphRelationshipToAgentEdge(relationship);
        if (!edge) continue;
        if (seenEdgeIds.has(edge.id)) continue;
        seenEdgeIds.add(edge.id);
        if (
          !DEPENDENT_TASK_RELATIONSHIP_TYPES.includes(
            edge.type as AgentEdgeRelationshipType,
          )
        ) {
          continue;
        }
        if (relationship.sourceNodeId === entityId) {
          directedEdges.push({
            taskId: relationship.targetNodeId as TaskId,
            direction: 'outbound',
            relationshipType: edge.type as AgentEdgeRelationshipType,
            reasoning: edge.reasoning,
          });
        } else if (relationship.targetNodeId === entityId) {
          directedEdges.push({
            taskId: relationship.sourceNodeId as TaskId,
            direction: 'inbound',
            relationshipType: edge.type as AgentEdgeRelationshipType,
            reasoning: edge.reasoning,
          });
        }
      }
    }

    if (directedEdges.length === 0) {
      this.logger.log('resolveDependentTasks: no agent edges found', {
        entityId,
      });
      return [];
    }

    const uniqueTaskIds = [...new Set(directedEdges.map((e) => e.taskId))];

    // Batch-fetch task metadata and sections
    const [tasks, sections] = await Promise.all([
      this.prisma.db.task.findMany({
        where: { id: { in: uniqueTaskIds }, projectId },
        select: { id: true, name: true, type: true, status: true },
      }),
      this.prisma.db.taskSection.findMany({
        where: {
          taskId: { in: uniqueTaskIds },
          key: { in: ['description', 'acceptanceCriteria'] },
        },
        select: {
          taskId: true,
          key: true,
          materializedMarkdown: true,
        },
      }),
    ]);

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const sectionMap = new Map<string, Map<string, string | null>>();
    for (const section of sections) {
      if (!sectionMap.has(section.taskId)) {
        sectionMap.set(section.taskId, new Map());
      }
      sectionMap
        .get(section.taskId)!
        .set(section.key, section.materializedMarkdown);
    }

    const results: DependentTaskDto[] = [];
    for (const edge of directedEdges) {
      const task = taskMap.get(edge.taskId);
      if (!task) {
        this.logger.debug(
          'resolveDependentTasks: skipping edge to non-existent task',
          { taskId: edge.taskId, direction: edge.direction },
        );
        continue;
      }

      const taskSections = sectionMap.get(edge.taskId);
      results.push({
        entityId: task.id,
        entityType: 'TASK',
        displayName: task.name,
        status: task.status,
        relationshipType: edge.relationshipType,
        direction: edge.direction,
        description: taskSections?.get('description') ?? null,
        acceptanceCriteria: taskSections?.get('acceptanceCriteria') ?? null,
        edgeReasoning: edge.reasoning,
      });
    }

    this.logger.log('resolveDependentTasks completed', {
      entityId,
      totalEdges: directedEdges.length,
      resolvedCount: results.length,
      skippedCount: directedEdges.length - results.length,
    });

    return results;
  }

  /**
   * Batched read of the direct (depth-1) typed and influence edges incident
   * on up to ten seed entities, in a single graph traversal.
   *
   * `includeSeedEntities` must remain true: in a batch, one seed can be the
   * direct neighbor of another. Graph traversal otherwise removes every
   * terminal whose ID appears in the seed set, which also removes the path
   * carrying that seed-to-seed relationship before grouping.
   *
   * The far endpoint's type and displayName are resolved from the traversed
   * depth-1 nodes the same call returns (properties.name ?? properties.title)
   * — uniform across arbitrary entity types, no extra DB round-trip.
   *
   * Every input seed is keyed in the result up front, so a no-edge seed and
   * an unknown/stale ID both return an empty array (key present) without
   * poisoning the rest of the batch. INFLUENCES relationships are not yet
   * materialized in the graph, so that half stays empty until they are —
   * then it populates here with no further change.
   */
  async getEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    seeds: GetEdgesSeed[],
    userToken: string | null,
  ): Promise<Record<string, EntityEdgeDto[]>> {
    this.logger.log('getEdges called', {
      organizationId,
      projectId,
      seedCount: seeds.length,
    });

    // Seed every bucket up front: no-edge seeds and unknown/stale IDs both
    // resolve to an empty array with the key present.
    const buckets = new Map<string, EntityEdgeDto[]>();
    for (const seed of seeds) {
      buckets.set(seed.entityId, []);
    }

    if (seeds.length === 0) {
      return {};
    }

    if (!userToken) {
      this.logger.warn('getEdges: no auth token — returning empty buckets', {
        seedCount: seeds.length,
      });
      return Object.fromEntries(buckets);
    }

    const pageSize = 100;
    const request: IncidentEdgesRequest = {
      seedEntityIds: seeds.map((s) => s.entityId),
      relationshipTypes: [
        ...AGENT_EDGE_LABELS,
        'AGENT_LINKED',
        'INFLUENCES',
        'PROPOSED_TOGETHER',
      ],
    };

    let response: Awaited<ReturnType<GraphsClientService['readIncidentEdges']>>;
    try {
      response = await this.graphsClientService.readIncidentEdges(
        organizationId,
        projectId,
        request,
        userToken,
      );
    } catch (error) {
      this.logger.warn('getEdges: failed to fetch edges', {
        seedCount: seeds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return Object.fromEntries(buckets);
    }

    for (const group of response.groups) {
      if (group.neighborTotal > pageSize) {
        this.logger.warn('getEdges: edges may be truncated', {
          seedEntityId: group.seedEntityId,
          neighborTotal: group.neighborTotal,
          pageSize,
        });
      }
    }

    const nodeInfoById = new Map(
      response.groups.flatMap((group) =>
        group.endpoints.map(
          (endpoint) => [endpoint.entityId, endpoint] as const,
        ),
      ),
    );

    let droppedEndpoints = 0;
    for (const seedResult of response.groups) {
      const bucket = buckets.get(seedResult.seedEntityId);
      if (!bucket) continue; // ignore groups for IDs we did not seed

      const seenEdgeIds = new Set<string>();
      for (const relationship of seedResult.relationships ?? []) {
        // Direction + the other endpoint relative to this seed.
        let direction: 'out' | 'in';
        let otherEntityId: string;
        if (relationship.sourceNodeId === seedResult.seedEntityId) {
          direction = 'out';
          otherEntityId = relationship.targetNodeId;
        } else if (relationship.targetNodeId === seedResult.seedEntityId) {
          direction = 'in';
          otherEntityId = relationship.sourceNodeId;
        } else {
          continue;
        }

        let edgeType: GetEdgesEdgeType;
        let createdAt: string;
        let reasonType: string | undefined;

        if (relationship.type === RelationshipType.Influences) {
          // INFLUENCES is typed at the relationship level and carries a
          // reasonType property rather than the agent-edge shape.
          if (relationship.id) {
            if (seenEdgeIds.has(relationship.id)) continue;
            seenEdgeIds.add(relationship.id);
          }
          edgeType = 'INFLUENCES';
          createdAt = relationship.createdAt;
          const props = (relationship.properties ?? {}) as Record<
            string,
            unknown
          >;
          reasonType =
            typeof props.reasonType === 'string' ? props.reasonType : undefined;
        } else {
          // AGENT_LINKED: semantic subtype + reasoning live in properties.
          const edge = graphRelationshipToAgentEdge(relationship);
          if (!edge) continue;
          if (seenEdgeIds.has(edge.id)) continue;
          seenEdgeIds.add(edge.id);
          // Skip types outside the get_edges vocabulary (e.g. BLOCKS)
          // so the output never carries a type the tool rejects.
          if (!isGetEdgesEdgeType(edge.type)) continue;
          edgeType = edge.type;
          createdAt = edge.createdAt;
        }

        const info = nodeInfoById.get(otherEntityId);
        if (!info) {
          droppedEndpoints += 1;
          continue;
        }

        bucket.push({
          direction,
          edgeType,
          otherEndpoint: {
            entityId: otherEntityId,
            entityType: info.entityType,
            displayName: info.displayName,
            ...(info.taskType !== undefined ? { taskType: info.taskType } : {}),
          },
          createdAt,
          ...(reasonType !== undefined ? { reasonType } : {}),
        });
      }
    }

    // Deterministic per-bucket order: direction, then edgeType, then
    // createdAt descending.
    for (const bucket of buckets.values()) {
      bucket.sort((a, b) => {
        if (a.direction !== b.direction) {
          return a.direction < b.direction ? -1 : 1;
        }
        if (a.edgeType !== b.edgeType) {
          return a.edgeType < b.edgeType ? -1 : 1;
        }
        if (a.createdAt === b.createdAt) return 0;
        return a.createdAt > b.createdAt ? -1 : 1;
      });
    }

    this.logger.log('getEdges completed', {
      seedCount: seeds.length,
      totalEdges: [...buckets.values()].reduce((n, b) => n + b.length, 0),
      droppedEndpoints,
    });

    return Object.fromEntries(buckets);
  }

  /**
   * Returns the ancestor FEATURE chain for a task with each feature's
   * full description and requirements inline.
   *
   * Walks the parent chain upward via a recursive CTE, keeps only
   * FEATURE-typed ancestors, and hydrates each with its description
   * and requirements sections. Results are ordered nearest-first.
   *
   * FEATURE tasks use a `requirements` section (not `acceptanceCriteria`,
   * which is reserved for STANDARD/BUG tasks).
   *
   * Unlike `buildFeatureHierarchy`, descriptions are not truncated and
   * siblings/descendants are not returned — this is the single-purpose
   * payload for feature-sync drift/enrichment walks.
   */
  async getFeatureSyncContext(
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskId: TaskId,
  ): Promise<FeatureSyncContextDto> {
    this.logger.log('getFeatureSyncContext called', {
      organizationId,
      projectId,
      taskId,
    });

    type AncestorRow = {
      id: string;
      name: string;
      type: string;
      tag: FeatureTag | null;
      parent_task_id: string | null;
      distance: number | bigint;
    };
    // Org/project scoping on both the seed and recursive step prevents
    // cross-tenant traversal via a known or guessed task UUID. The
    // `ac.distance < ${MAX_ANCESTOR_DEPTH}` guard bounds the walk in the
    // presence of cyclic or pathologically deep parent_task_id chains.
    const MAX_ANCESTOR_DEPTH = 50;
    const ancestorRows = await this.prisma.db.$queryRaw<AncestorRow[]>`
      WITH RECURSIVE ancestor_chain AS (
        SELECT id, name, type, tag, parent_task_id, 0 AS distance
        FROM   tasks
        WHERE  id = ${taskId}
          AND  organization_id = ${organizationId}
          AND  project_id = ${projectId}
        UNION ALL
        SELECT t.id, t.name, t.type, t.tag, t.parent_task_id, ac.distance + 1
        FROM   tasks t
        JOIN   ancestor_chain ac ON t.id = ac.parent_task_id
        WHERE  t.organization_id = ${organizationId}
          AND  t.project_id = ${projectId}
          AND  ac.distance < ${MAX_ANCESTOR_DEPTH}
      )
      SELECT id, name, type, tag, parent_task_id, distance
      FROM   ancestor_chain
      ORDER BY distance ASC
    `;

    const seedExists = ancestorRows.some((r) => Number(r.distance) === 0);
    if (!seedExists) {
      throw new NotFoundException(`Task with id ${taskId} not found`);
    }

    let featureAncestors = ancestorRows.filter(
      (r) =>
        Number(r.distance) > 0 &&
        this.workItemTypeRegistry.isHierarchyNode(
          r.type as WorkItemTypeKey,
          projectId,
        ),
    );

    // Plan-resident pivot. A task with no structural feature ancestry of its
    // own may still belong to a feature through the plan that tracks it: the
    // plan's parentTaskId is the feature it delivers. When the seed has no
    // parent task at all, follow that pivot and re-root the ancestor walk
    // there, so a plan-step task returns the delivered feature and its
    // ancestors rather than an empty chain. An explicit structural parent
    // always wins — the pivot only fills absent ancestry, never firing when
    // the seed already has any parent task or any feature ancestor.
    const seedRow = ancestorRows.find((r) => Number(r.distance) === 0);
    if (featureAncestors.length === 0 && seedRow?.parent_task_id == null) {
      const pivotSeedId = await this.resolvePlanResidentFeatureSeedId(taskId);
      if (pivotSeedId) {
        const pivotRows = await this.prisma.db.$queryRaw<AncestorRow[]>`
          WITH RECURSIVE ancestor_chain AS (
            SELECT id, name, type, tag, parent_task_id, 0 AS distance
            FROM   tasks
            WHERE  id = ${pivotSeedId}
              AND  organization_id = ${organizationId}
              AND  project_id = ${projectId}
            UNION ALL
            SELECT t.id, t.name, t.type, t.tag, t.parent_task_id, ac.distance + 1
            FROM   tasks t
            JOIN   ancestor_chain ac ON t.id = ac.parent_task_id
            WHERE  t.organization_id = ${organizationId}
              AND  t.project_id = ${projectId}
              AND  ac.distance < ${MAX_ANCESTOR_DEPTH}
          )
          SELECT id, name, type, tag, parent_task_id, distance
          FROM   ancestor_chain
          ORDER BY distance ASC
        `;
        // The pivot feature sits at distance 0 in this walk but is the task's
        // nearest feature ancestor, so shift every hop +1: the delivered
        // feature reads as distance 1 (matching a direct structural parent)
        // and its own ancestors as 2+. Nearest-first ordering is preserved.
        featureAncestors = pivotRows
          .filter((r) =>
            this.workItemTypeRegistry.isHierarchyNode(
              r.type as WorkItemTypeKey,
              projectId,
            ),
          )
          .map((r) => ({ ...r, distance: Number(r.distance) + 1 }));
      }
    }

    if (featureAncestors.length === 0) {
      this.logger.log('getFeatureSyncContext completed', {
        taskId,
        ancestorFeatureCount: 0,
      });
      return { taskId, ancestorFeatures: [] };
    }

    const featureIds = featureAncestors.map((f) => f.id);
    const sections = await this.prisma.db.taskSection.findMany({
      where: {
        taskId: { in: featureIds },
        key: { in: ['description', 'requirements'] },
      },
      select: {
        taskId: true,
        key: true,
        materializedMarkdown: true,
      },
    });

    const sectionMap = new Map<string, Map<string, string | null>>();
    for (const section of sections) {
      if (!sectionMap.has(section.taskId)) {
        sectionMap.set(section.taskId, new Map());
      }
      sectionMap
        .get(section.taskId)!
        .set(section.key, section.materializedMarkdown);
    }

    const ancestorFeatures: AncestorFeatureDto[] = featureAncestors.map((f) => {
      const requirementsSource = sectionMap.get(f.id)?.get('requirements');
      let requirements: string | null = null;
      try {
        requirements =
          readCanonicalFeatureRequirementsContent(requirementsSource) ?? null;
      } catch (error) {
        this.logger.error(
          'getFeatureSyncContext: invalid feature requirements',
          {
            taskId: f.id,
            code:
              error instanceof FeatureRequirementsReadError
                ? error.code
                : 'unknown',
            diagnostic: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
      return {
        id: f.id,
        name: f.name,
        description: sectionMap.get(f.id)?.get('description') ?? null,
        requirements,
        distance: Number(f.distance),
        ...(f.tag != null ? { tag: f.tag } : {}),
      };
    });

    this.logger.log('getFeatureSyncContext completed', {
      taskId,
      ancestorFeatureCount: ancestorFeatures.length,
    });

    return { taskId, ancestorFeatures };
  }

  /**
   * Returns every FEATURE-typed task in the project as a flat list,
   * ordered pre-order DFS (root, then each child's subtree). Each
   * entry carries `parentFeatureId` and `depth` so a caller can
   * rebuild the tree in O(n) without nesting in the wire format.
   *
   * Pagination (limit/offset) applies AFTER the DFS sort, so the
   * first page always starts at the first root and the window
   * preserves the visual hierarchy when read top-to-bottom.
   *
   * Pre-order DFS pseudo-code:
   *   visit(node):
   *     emit(node)
   *     for child in children(node):
   *       visit(child)
   *
   * Roots are sorted by name (case-insensitive); siblings under each
   * parent are sorted the same way. Stable ordering means the same
   * project produces the same listing across calls.
   */
  async listFeatures(
    organizationId: OrganizationId,
    projectId: ProjectId,
    limit: number,
    offset: number,
  ): Promise<ListFeaturesResponseDto> {
    this.logger.log('listFeatures called', {
      organizationId,
      projectId,
      limit,
      offset,
    });

    const features = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        type: {
          in: this.workItemTypeRegistry.getHierarchyNodeTypes(projectId),
        },
        archivedAt: null,
      },
      select: { id: true, name: true, parentTaskId: true, tag: true },
    });

    // Group children by parent so we can DFS without re-scanning the
    // full list at each step. Roots live under the `null` key.
    const childrenByParent = new Map<string | null, typeof features>();
    for (const f of features) {
      const key = f.parentTaskId;
      const bucket = childrenByParent.get(key);
      if (bucket) {
        bucket.push(f);
      } else {
        childrenByParent.set(key, [f]);
      }
    }
    const compareByName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    for (const bucket of childrenByParent.values()) {
      bucket.sort(compareByName);
    }

    // A FEATURE may have a non-FEATURE parent (e.g. an Initiative root or a
    // STANDARD task above it in some legacy graphs). Treat any feature whose
    // parent is not itself a FEATURE in this project as a root for DFS, so
    // the listing always reaches every feature even when the parent chain
    // breaks out of the FEATURE-type subtree.
    const featureIds = new Set<string>(features.map((f) => f.id));
    const rootBucket: typeof features = [];
    for (const f of features) {
      if (f.parentTaskId === null || !featureIds.has(f.parentTaskId)) {
        rootBucket.push(f);
      }
    }
    rootBucket.sort(compareByName);

    const items: FeatureListItemDto[] = [];
    const stack: Array<{
      feature: (typeof features)[number];
      depth: number;
    }> = [];
    // Push roots in reverse so the first root is visited first when popped.
    for (let i = rootBucket.length - 1; i >= 0; i -= 1) {
      const feature = rootBucket[i];
      if (feature) stack.push({ feature, depth: 0 });
    }
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      const { feature, depth } = next;
      const parentIsFeature =
        feature.parentTaskId !== null && featureIds.has(feature.parentTaskId);
      items.push({
        id: feature.id,
        name: feature.name,
        parentFeatureId: parentIsFeature ? feature.parentTaskId : null,
        depth,
        ...(feature.tag != null ? { tag: feature.tag as FeatureTag } : {}),
      });
      const children = childrenByParent.get(feature.id);
      if (children) {
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const child = children[i];
          if (child) stack.push({ feature: child, depth: depth + 1 });
        }
      }
    }

    const total = items.length;
    const window = items.slice(offset, offset + limit);
    const hasMore = offset + window.length < total;

    this.logger.log('listFeatures completed', {
      organizationId,
      projectId,
      total,
      returned: window.length,
      offset,
      limit,
      hasMore,
    });

    return {
      items: window,
      total,
      hasMore,
      limit,
      offset,
    };
  }

  /**
   * Returns the project's full FEATURE tree as a flat array of compact
   * skeleton nodes, ordered pre-order DFS so reading top-to-bottom shows
   * the hierarchy. Each entry carries id, name, tag, status, parentId,
   * depth, and direct (non-recursive) taskCount.
   *
   * Consumed by the Feature Tree Conversation CLI at session init — the
   * agent injects the whole array into its system prompt so it can reason
   * over the whole tree without round-tripping. No pagination; the caller
   * takes the entire array in one response.
   *
   * Distinct from `listFeatures`:
   * - Returns FeatureSkeletonNode[] (status + taskCount, no envelope).
   * - parentId is null when the parent is not itself a FEATURE in this
   *   project, matching the listFeatures "root if parent not a feature"
   *   rule so the array always covers every feature.
   */
  async getProjectFeaturesSkeleton(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<FeatureSkeletonNode[]> {
    this.logger.log('getProjectFeaturesSkeleton called', {
      organizationId,
      projectId,
    });

    const hierarchyNodeTypes =
      this.workItemTypeRegistry.getHierarchyNodeTypes(projectId);
    const [features, childCountRows] = await Promise.all([
      this.prisma.db.task.findMany({
        where: {
          organizationId,
          projectId,
          type: { in: hierarchyNodeTypes },
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          parentTaskId: true,
          tag: true,
          status: true,
        },
      }),
      this.prisma.db.task.groupBy({
        by: ['parentTaskId'],
        where: {
          organizationId,
          projectId,
          type: { notIn: hierarchyNodeTypes },
          archivedAt: null,
          parentTaskId: { not: null },
        },
        _count: { _all: true },
      }),
    ]);

    const featureIds = new Set<string>(features.map((f) => f.id));
    const directTaskCount = new Map<string, number>();
    for (const row of childCountRows) {
      if (row.parentTaskId === null) continue;
      if (!featureIds.has(row.parentTaskId)) continue;
      directTaskCount.set(row.parentTaskId, row._count._all);
    }

    const childrenByParent = new Map<string | null, typeof features>();
    for (const f of features) {
      const key = f.parentTaskId;
      const bucket = childrenByParent.get(key);
      if (bucket) {
        bucket.push(f);
      } else {
        childrenByParent.set(key, [f]);
      }
    }
    const compareByName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    for (const bucket of childrenByParent.values()) {
      bucket.sort(compareByName);
    }

    const rootBucket: typeof features = [];
    for (const f of features) {
      if (f.parentTaskId === null || !featureIds.has(f.parentTaskId)) {
        rootBucket.push(f);
      }
    }
    rootBucket.sort(compareByName);

    const items: FeatureSkeletonNode[] = [];
    const stack: Array<{
      feature: (typeof features)[number];
      depth: number;
    }> = [];
    for (let i = rootBucket.length - 1; i >= 0; i -= 1) {
      const feature = rootBucket[i];
      if (feature) stack.push({ feature, depth: 0 });
    }
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      const { feature, depth } = next;
      const parentIsFeature =
        feature.parentTaskId !== null && featureIds.has(feature.parentTaskId);
      items.push({
        id: feature.id,
        name: feature.name,
        tag: (feature.tag as FeatureTag | null) ?? null,
        status: feature.status,
        parentId: parentIsFeature ? feature.parentTaskId : null,
        depth,
        taskCount: directTaskCount.get(feature.id) ?? 0,
      });
      const children = childrenByParent.get(feature.id);
      if (children) {
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const child = children[i];
          if (child) stack.push({ feature: child, depth: depth + 1 });
        }
      }
    }

    this.logger.log('getProjectFeaturesSkeleton completed', {
      organizationId,
      projectId,
      total: items.length,
    });

    return items;
  }

  /**
   * Returns every GOAL-typed task in the project as a flat list.
   *
   * Goals are flat by design (parent Goals feature, requirement 7:
   * "must not appear in the feature hierarchy"), so this method skips
   * the DFS treatment listFeatures applies to features. Items are
   * ordered by dueDate ascending then name ascending — soonest-deadline
   * first matches the natural reading order for a time-bound surface.
   *
   * Optional `statuses` filters down to a specific set of WorkStatus
   * values; the MCP provider does the simplified-status → WorkStatus[]
   * mapping before calling this method, mirroring how task_search
   * normalizes filters.
   */
  async listGoals(
    organizationId: OrganizationId,
    projectId: ProjectId,
    limit: number,
    offset: number,
    statuses?: WorkStatus[],
  ): Promise<ListGoalsResponseDto> {
    this.logger.log('listGoals called', {
      organizationId,
      projectId,
      limit,
      offset,
      statuses,
    });

    const where = {
      organizationId,
      projectId,
      type: WORK_ITEM_TYPE_KEYS.Goal,
      archivedAt: null,
      ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
    };

    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.task.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          dueDate: true,
        },
        orderBy: [{ dueDate: 'asc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.db.task.count({ where }),
    ]);

    const window = rows.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      dueDate: g.dueDate ? g.dueDate.toISOString() : null,
    }));
    const hasMore = offset + window.length < total;

    this.logger.log('listGoals completed', {
      organizationId,
      projectId,
      total,
      returned: window.length,
      offset,
      limit,
      hasMore,
    });

    return {
      items: window,
      total,
      hasMore,
      limit,
      offset,
    };
  }

  /**
   * Returns undated GOAL-typed tasks and dated Goals inside a fixed
   * look-ahead window for a user. "Active" means: not archived, status not
   * in COMPLETED / CANCELLED / ARCHIVED, and no date or dueDate between now and
   * `now + windowDays`.
   *
   * Audience is derived per goal from the goal_memberships join: zero
   * rows → PROJECT (project-wide), one or more rows → MEMBERS (scoped
   * subset). PERSONAL is reserved for future per-user rollup work and
   * is not yet emitted.
   *
   * Ordering puts goals the caller is a member of first (member-of-first
   * is a per-row computed predicate that Prisma cannot express in
   * `orderBy` without raw SQL), then secondary-sorts by dueDate (undated last)
   * ascending then name ascending.
   */
  async getActiveGoals(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: string,
    windowDays: number,
  ): Promise<ActiveGoalsResponseDto> {
    this.logger.log('getActiveGoals called', {
      organizationId,
      projectId,
      userId,
      windowDays,
    });

    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + windowDays * 24 * 60 * 60 * 1000,
    );

    const rows = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        archivedAt: null,
        status: {
          notIn: [
            WorkStatus.COMPLETED,
            WorkStatus.CANCELLED,
            WorkStatus.ARCHIVED,
          ],
        },
        OR: [{ dueDate: null }, { dueDate: { gte: now, lte: windowEnd } }],
      },
      select: {
        id: true,
        name: true,
        dueDate: true,
        goalMemberships: { select: { userId: true } },
      },
    });

    type DerivedGoal = {
      item: ActiveGoalDto;
      memberOf: boolean;
      dueDate: Date | null;
      name: string;
    };

    const derived: DerivedGoal[] = rows.map((row) => {
      const memberCount = row.goalMemberships.length;
      const memberOf = row.goalMemberships.some((m) => m.userId === userId);
      const audience =
        memberCount === 0 ? GoalAudience.Project : GoalAudience.Members;
      return {
        item: {
          id: row.id,
          name: row.name,
          dueDate: row.dueDate?.toISOString() ?? null,
          audience,
        },
        memberOf,
        dueDate: row.dueDate,
        name: row.name,
      };
    });

    derived.sort((a, b) => {
      if (a.memberOf !== b.memberOf) return a.memberOf ? -1 : 1;
      if (a.dueDate === null && b.dueDate !== null) return 1;
      if (a.dueDate !== null && b.dueDate === null) return -1;
      const due =
        a.dueDate && b.dueDate ? a.dueDate.getTime() - b.dueDate.getTime() : 0;
      if (due !== 0) return due;
      return a.name.localeCompare(b.name);
    });

    const items = derived.map((d) => d.item);
    const memberCount = derived.filter((d) => d.memberOf).length;
    const audienceCounts = items.reduce(
      (acc, item) => {
        acc[item.audience] = (acc[item.audience] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    this.logger.log('getActiveGoals completed', {
      organizationId,
      projectId,
      userId,
      windowDays,
      returned: items.length,
      memberOfCount: memberCount,
      audienceCounts,
    });

    return {
      items,
      userId,
      windowDays,
    };
  }

  /**
   * Builds the feature hierarchy context for an entity.
   *
   * Only TASK entities can belong to a feature hierarchy (a tree of
   * tasks whose `type` is FEATURE). For other entity types the result
   * is always an empty array.
   *
   * Three sets are collected:
   * - ancestors  – FEATURE tasks in the parent chain above this task
   * - siblings   – FEATURE tasks sharing the same direct parent (distance 1)
   * - descendants – FEATURE tasks anywhere below this task in the subtree
   *
   * Uses two recursive CTEs (one upward, one downward) plus a single
   * sibling query — three queries total regardless of tree depth.
   */
  private async buildFeatureHierarchy(
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    agentEdges: AgentEdge[],
    planResidentFeatureSeedId: string | null = null,
  ): Promise<FeatureHierarchyEntryDto[]> {
    // Task seeds walk their own ancestry. Task-owned DesignDocs use the
    // owning Plan's feature ancestor when canonical Plan context resolved it.
    let walkSeedId: string;
    if (entityType === 'TASK') {
      walkSeedId = entityId;
    } else if (
      entityType === EntityTypeEnum.DesignDoc &&
      planResidentFeatureSeedId !== null
    ) {
      walkSeedId = planResidentFeatureSeedId;
    } else {
      return [];
    }

    // ── Ancestors (recursive CTE walking up the parent chain) ───────────
    // Includes the walk seed itself at distance 0 so we can read its
    // parentTaskId and type without a separate query.
    type AncestorRow = {
      id: string;
      name: string;
      type: string;
      tag: FeatureTag | null;
      parent_task_id: string | null;
      distance: number | bigint;
    };
    let ancestorRows = await this.prisma.db.$queryRaw<AncestorRow[]>`
      WITH RECURSIVE ancestor_chain AS (
        SELECT id, name, type, tag, parent_task_id, 0 AS distance
        FROM   tasks
        WHERE  id = ${walkSeedId}
        UNION ALL
        SELECT t.id, t.name, t.type, t.tag, t.parent_task_id, ac.distance + 1
        FROM   tasks t
        JOIN   ancestor_chain ac ON t.id = ac.parent_task_id
      )
      SELECT id, name, type, tag, parent_task_id, distance
      FROM   ancestor_chain
    `;

    let entityRow = ancestorRows.find((r) => Number(r.distance) === 0);
    if (!entityRow) {
      return [];
    }

    // Plan-walk fall-through for TASK seeds: when the actual TASK seed has
    // no explicit parent feature *and* a plan-resident pivot is available,
    // re-root the structural walk at the plan's parent feature. An explicit
    // parentTaskId on the TASK always wins — the plan-walk only fills in
    // missing ancestry.
    if (
      entityType === 'TASK' &&
      planResidentFeatureSeedId !== null &&
      walkSeedId === entityId &&
      entityRow.parent_task_id == null
    ) {
      walkSeedId = planResidentFeatureSeedId;
      ancestorRows = await this.prisma.db.$queryRaw<AncestorRow[]>`
        WITH RECURSIVE ancestor_chain AS (
          SELECT id, name, type, tag, parent_task_id, 0 AS distance
          FROM   tasks
          WHERE  id = ${walkSeedId}
          UNION ALL
          SELECT t.id, t.name, t.type, t.tag, t.parent_task_id, ac.distance + 1
          FROM   tasks t
          JOIN   ancestor_chain ac ON t.id = ac.parent_task_id
        )
        SELECT id, name, type, tag, parent_task_id, distance
        FROM   ancestor_chain
      `;
      entityRow = ancestorRows.find((r) => Number(r.distance) === 0);
      if (!entityRow) {
        return [];
      }
    }

    const structuralEntries: FeatureHierarchyEntryDto[] = [];

    for (const row of ancestorRows) {
      if (
        Number(row.distance) > 0 &&
        this.workItemTypeRegistry.isHierarchyNode(
          row.type as WorkItemTypeKey,
          projectId,
        )
      ) {
        structuralEntries.push({
          id: row.id,
          name: row.name,
          description: null,
          descriptionFullLength: null,
          relationshipType: 'structural',
          relationship: 'ancestor',
          distance: Number(row.distance),
          ...(row.tag != null ? { tag: row.tag } : {}),
        });
      }
    }

    // ── Siblings (single query; parent_task_id known from entity row) ────
    if (entityRow.parent_task_id) {
      const siblings = await this.prisma.db.task.findMany({
        where: {
          parentTaskId: entityRow.parent_task_id,
          id: { not: walkSeedId },
          type: {
            in: this.workItemTypeRegistry.getHierarchyNodeTypes(projectId),
          },
        },
        select: { id: true, name: true, tag: true },
      });
      for (const s of siblings) {
        structuralEntries.push({
          id: s.id,
          name: s.name,
          description: null,
          descriptionFullLength: null,
          relationshipType: 'structural',
          relationship: 'sibling',
          distance: 1,
          ...(s.tag != null ? { tag: s.tag as FeatureTag } : {}),
        });
      }
    }

    // ── Descendants (recursive CTE walking down the subtree) ─────────────
    type DescendantRow = {
      id: string;
      name: string;
      type: string;
      tag: FeatureTag | null;
      distance: number | bigint;
    };
    const descendantRows = await this.prisma.db.$queryRaw<DescendantRow[]>`
      WITH RECURSIVE descendant_tree AS (
        SELECT id, name, type, tag, parent_task_id, 1 AS distance
        FROM   tasks
        WHERE  parent_task_id = ${walkSeedId}
        UNION ALL
        SELECT t.id, t.name, t.type, t.tag, t.parent_task_id, dt.distance + 1
        FROM   tasks t
        JOIN   descendant_tree dt ON t.parent_task_id = dt.id
      )
      SELECT id, name, type, tag, distance
      FROM   descendant_tree
    `;

    for (const row of descendantRows) {
      if (
        this.workItemTypeRegistry.isHierarchyNode(
          row.type as WorkItemTypeKey,
          projectId,
        )
      ) {
        structuralEntries.push({
          id: row.id,
          name: row.name,
          description: null,
          descriptionFullLength: null,
          relationshipType: 'structural',
          relationship: 'descendant',
          distance: Number(row.distance),
          ...(row.tag != null ? { tag: row.tag } : {}),
        });
      }
    }

    // ── Typed-edge entries (only when the real seed is itself a FEATURE)
    // Walk agent edges that touch the seed; keep agent-typed edges to other
    // FEATURE tasks (BLOCKS excluded). Each surviving edge becomes a
    // typed-edge entry alongside the structural ones. Skipped in plan-walk
    // mode because the agent edges are scoped to the real plan-resident
    // seed, not the substituted feature.
    const typedEdgeEntries =
      walkSeedId === entityId &&
      this.workItemTypeRegistry.isHierarchyNode(
        entityRow.type as WorkItemTypeKey,
        projectId,
      )
        ? await this.buildFeatureEdgeEntries(projectId, entityId, agentEdges)
        : [];

    const entries: FeatureHierarchyEntryDto[] = [
      ...structuralEntries,
      ...typedEdgeEntries,
    ];

    // ── Hydrate descriptions from TaskSection ───────────────────────────
    const DESCRIPTION_PREVIEW_LENGTH = 225;
    if (entries.length > 0) {
      const featureIds = entries.map((e) => e.id);
      const descriptionSections = await this.prisma.db.taskSection.findMany({
        where: {
          taskId: { in: featureIds },
          key: 'description',
        },
        select: {
          taskId: true,
          materializedMarkdown: true,
        },
      });
      const descriptionMap = new Map(
        descriptionSections.map((s) => [s.taskId, s.materializedMarkdown]),
      );
      for (const entry of entries) {
        const full = descriptionMap.get(entry.id) ?? null;
        if (full !== null) {
          entry.description =
            full.length > DESCRIPTION_PREVIEW_LENGTH
              ? full.slice(0, DESCRIPTION_PREVIEW_LENGTH)
              : full;
          entry.descriptionFullLength = full.length;
        }
      }
    }

    return entries;
  }

  /**
   * Builds typed-edge entries for the featureHierarchy. Called only when
   * the seed entity is itself a FEATURE task. Walks agent edges, keeps
   * the five typed relationships (BLOCKS deliberately excluded), and
   * hydrates each connected feature's parentTaskId. Edges to non-FEATURE
   * endpoints, edges to the seed itself, and edges whose endpoint task
   * row is missing are dropped.
   */
  private async buildFeatureEdgeEntries(
    projectId: ProjectId,
    seedEntityId: string,
    agentEdges: AgentEdge[],
  ): Promise<FeatureHierarchyEntryDto[]> {
    type FeatureEdgeRelationshipType =
      | 'RELATED_TO'
      | 'DEPENDS_ON'
      | 'DERIVES_FROM'
      | 'SUPERSEDES'
      | 'CONTRADICTS'
      | 'EVOLVES'
      | 'PROPOSED_TOGETHER';
    const FEATURE_HIERARCHY_EDGE_TYPES: ReadonlySet<string> = new Set([
      'RELATED_TO',
      'DEPENDS_ON',
      'DERIVES_FROM',
      'SUPERSEDES',
      'CONTRADICTS',
      'EVOLVES',
      'PROPOSED_TOGETHER',
    ]);

    type DirectedFeatureEdge = {
      otherEntityId: string;
      relationshipType: FeatureEdgeRelationshipType;
      direction: EdgeDirection;
      reasoning: string;
    };

    const directedEdges: DirectedFeatureEdge[] = [];
    for (const edge of agentEdges) {
      if (!FEATURE_HIERARCHY_EDGE_TYPES.has(edge.type)) continue;

      let otherEntityId: string;
      let direction: EdgeDirection;
      if (edge.sourceNodeId === seedEntityId) {
        otherEntityId = edge.targetNodeId;
        direction = 'outbound';
      } else if (edge.targetNodeId === seedEntityId) {
        otherEntityId = edge.sourceNodeId;
        direction = 'inbound';
      } else {
        continue;
      }
      if (otherEntityId === seedEntityId) continue;

      directedEdges.push({
        otherEntityId,
        relationshipType: edge.type as FeatureEdgeRelationshipType,
        direction,
        reasoning: edge.reasoning,
      });
    }

    if (directedEdges.length === 0) return [];

    const otherTaskIds = [
      ...new Set(directedEdges.map((e) => e.otherEntityId as TaskId)),
    ];
    const otherTasks = await this.prisma.db.task.findMany({
      where: { id: { in: otherTaskIds } },
      select: {
        id: true,
        name: true,
        type: true,
        tag: true,
        parentTaskId: true,
      },
    });
    const otherTaskMap = new Map<string, (typeof otherTasks)[number]>(
      otherTasks.map((t) => [t.id, t]),
    );

    const entries: FeatureHierarchyEntryDto[] = [];
    for (const edge of directedEdges) {
      const task = otherTaskMap.get(edge.otherEntityId);
      if (!task) continue;
      if (
        !this.workItemTypeRegistry.isHierarchyNode(
          task.type as WorkItemTypeKey,
          projectId,
        )
      )
        continue;
      entries.push({
        id: task.id,
        name: task.name,
        description: null,
        descriptionFullLength: null,
        relationshipType: edge.relationshipType,
        direction: edge.direction,
        parentTaskId: task.parentTaskId,
        reasoning: edge.reasoning,
        ...(task.tag != null ? { tag: task.tag as FeatureTag } : {}),
      });
    }
    return entries;
  }

  /**
   * The plan-resident feature pivot for a Task: the Plan ancestor's
   * `parentTaskId` is the feature the Plan delivers, and
   * thus the seed to walk feature ancestry from when the task carries no
   * structural feature parent of its own. Null when the task is not
   * plan-resident, or its plan has no parent feature.
   *
   * Canonical Task ancestry is authoritative.
   */
  private async resolvePlanResidentFeatureSeedId(
    taskId: string,
  ): Promise<string | null> {
    const task = await this.prisma.db.task.findUnique({
      where: { id: taskId },
      select: {
        type: true,
        parentTask: {
          select: {
            type: true,
            parentTask: {
              select: { type: true, parentTaskId: true },
            },
          },
        },
      },
    });
    if (
      task?.type === 'STANDARD' &&
      task.parentTask?.type === 'PLAN_STAGE' &&
      task.parentTask.parentTask?.type === 'PLAN'
    ) {
      return task.parentTask.parentTask.parentTaskId;
    }

    return null;
  }

  /**
   * Resolves only the Plan pivots needed by feature hierarchy and neighborhood
   * projections when the caller omits Plan placement. Stage rows stay ID-only;
   * response fields and dependency ordering belong to buildPlanContext.
   */
  private async buildPlanContextPivots(
    entityType: EntityType,
    entityId: string,
    includeNeighborhoodPivots: boolean,
  ): Promise<BuildPlanPivotsResult> {
    const empty: BuildPlanPivotsResult = {
      planPivotEntityIds: new Set<string>(),
      planResidentFeatureSeedId: null,
    };

    if (entityType === EntityTypeEnum.DesignDoc) {
      const document = await this.prisma.db.designDoc.findUnique({
        where: { id: entityId },
        select: { parentEntityType: true, parentEntityId: true },
      });
      if (document?.parentEntityType !== 'TASK' || !document.parentEntityId) {
        return empty;
      }
      return this.buildPlanContextPivots(
        EntityTypeEnum.Task,
        document.parentEntityId,
        includeNeighborhoodPivots,
      );
    }

    if (entityType !== EntityTypeEnum.Task) return empty;

    const task = await this.prisma.db.task.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        type: true,
        parentTaskId: true,
        parentTask: {
          select: {
            id: true,
            type: true,
            parentTaskId: true,
            parentTask: {
              select: { id: true, type: true, parentTaskId: true },
            },
          },
        },
      },
    });
    if (!task) return empty;

    const loadStageIds = async (
      planId: string,
      excludedStageId?: string,
    ): Promise<Set<string>> => {
      const stages = await this.prisma.db.task.findMany({
        where: {
          parentTaskId: planId,
          type: 'PLAN_STAGE',
          archivedAt: null,
        },
        select: { id: true },
      });
      return new Set(
        stages
          .map((stage) => stage.id)
          .filter((stageId) => stageId !== excludedStageId),
      );
    };

    if (task.type === 'PLAN') {
      return {
        planPivotEntityIds: includeNeighborhoodPivots
          ? await loadStageIds(task.id)
          : new Set<string>(),
        planResidentFeatureSeedId: task.parentTaskId,
      };
    }

    if (task.type === 'PLAN_STAGE' && task.parentTask?.type === 'PLAN') {
      const plan = task.parentTask;
      const planPivotEntityIds = includeNeighborhoodPivots
        ? await loadStageIds(plan.id, task.id)
        : new Set<string>();
      if (includeNeighborhoodPivots) planPivotEntityIds.add(plan.id);
      return {
        planPivotEntityIds,
        planResidentFeatureSeedId: plan.parentTaskId,
      };
    }

    if (
      task.type === 'STANDARD' &&
      task.parentTask?.type === 'PLAN_STAGE' &&
      task.parentTask.parentTask?.type === 'PLAN'
    ) {
      const stage = task.parentTask;
      const plan = stage.parentTask;
      if (!plan || plan.type !== 'PLAN') return empty;
      const planPivotEntityIds = includeNeighborhoodPivots
        ? await loadStageIds(plan.id)
        : new Set<string>();
      if (includeNeighborhoodPivots) {
        planPivotEntityIds.add(plan.id);
        planPivotEntityIds.add(stage.id);
      }
      return {
        planPivotEntityIds,
        planResidentFeatureSeedId: plan.parentTaskId,
      };
    }

    return empty;
  }

  private async buildPlanContext(
    entityType: EntityType,
    entityId: string,
  ): Promise<BuildPlanContextResult | null> {
    if (entityType === EntityTypeEnum.DesignDoc) {
      const document = await this.prisma.db.designDoc.findUnique({
        where: { id: entityId },
        select: { parentEntityType: true, parentEntityId: true },
      });
      if (document?.parentEntityType !== 'TASK' || !document.parentEntityId) {
        return null;
      }
      return this.buildPlanContext(
        EntityTypeEnum.Task,
        document.parentEntityId,
      );
    }

    const canonicalTaskEntry = (task: {
      id: string;
      name: string;
      status: string;
      type: 'PLAN' | 'PLAN_STAGE';
    }): PlanContextEntryDto => ({
      id: task.id,
      entityType: 'TASK',
      taskType: task.type,
      displayName: task.name,
      status: task.status,
    });

    if (entityType === 'TASK') {
      const task = await this.prisma.db.task.findUnique({
        where: { id: entityId },
        select: {
          organizationId: true,
          projectId: true,
          id: true,
          name: true,
          status: true,
          type: true,
          parentTaskId: true,
          parentTask: {
            select: {
              id: true,
              name: true,
              status: true,
              type: true,
              parentTaskId: true,
              parentTask: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  type: true,
                  parentTaskId: true,
                },
              },
            },
          },
        },
      });

      if (task?.type === 'PLAN') {
        const stages = await this.prisma.db.task.findMany({
          where: {
            parentTaskId: task.id,
            type: 'PLAN_STAGE',
            archivedAt: null,
          },
          select: {
            id: true,
            name: true,
            status: true,
            type: true,
            createdAt: true,
          },
        });
        return {
          planContext: {
            siblingStages: (
              await orderPlanStages(
                this.planDependencies,
                task.organizationId,
                task.projectId,
                stages,
              )
            ).map((stage) =>
              canonicalTaskEntry({ ...stage, type: 'PLAN_STAGE' }),
            ),
          },
          planResidentFeatureSeedId: task.parentTaskId,
        };
      }

      if (task?.type === 'PLAN_STAGE' && task.parentTask?.type === 'PLAN') {
        const siblingRows = await this.prisma.db.task.findMany({
          where: {
            parentTaskId: task.parentTask.id,
            type: 'PLAN_STAGE',
            archivedAt: null,
          },
          select: {
            id: true,
            name: true,
            status: true,
            type: true,
            createdAt: true,
          },
        });
        const siblings = await orderPlanStages(
          this.planDependencies,
          task.organizationId,
          task.projectId,
          siblingRows.filter((sibling) => sibling.type === 'PLAN_STAGE'),
        );
        return {
          planContext: {
            parentPlan: canonicalTaskEntry({
              ...task.parentTask,
              type: 'PLAN',
            }),
            siblingStages: siblings
              .filter((sibling) => sibling.id !== task.id)
              .map((stage) =>
                canonicalTaskEntry({ ...stage, type: 'PLAN_STAGE' }),
              ),
          },
          planResidentFeatureSeedId: task.parentTask.parentTaskId,
        };
      }

      if (
        task?.type === 'STANDARD' &&
        task.parentTask?.type === 'PLAN_STAGE' &&
        task.parentTask.parentTask?.type === 'PLAN'
      ) {
        const plan = task.parentTask.parentTask;
        const siblingRows = await this.prisma.db.task.findMany({
          where: {
            parentTaskId: plan.id,
            type: 'PLAN_STAGE',
            archivedAt: null,
          },
          select: {
            id: true,
            name: true,
            status: true,
            type: true,
            createdAt: true,
          },
        });
        const stages = await orderPlanStages(
          this.planDependencies,
          task.organizationId,
          task.projectId,
          siblingRows.filter((stage) => stage.type === 'PLAN_STAGE'),
        );
        return {
          planContext: {
            parentPlan: canonicalTaskEntry({ ...plan, type: 'PLAN' }),
            parentStage: canonicalTaskEntry({
              ...task.parentTask,
              type: 'PLAN_STAGE',
            }),
            siblingStages: stages.map((stage) =>
              canonicalTaskEntry({ ...stage, type: 'PLAN_STAGE' }),
            ),
          },
          planResidentFeatureSeedId: plan.parentTaskId,
        };
      }
    }
    return null;
  }

  /**
   * Fetches agent-authored edges that touch the seed entity via a single
   * `searchGraph` traversal scoped to the seed. Returns the merged,
   * de-duplicated list so a project's full edge set never lands in the
   * response.
   */
  private async fetchAgentEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    seedEntityId: string,
    userToken: string | null,
  ): Promise<AgentEdge[]> {
    if (!userToken) {
      return [];
    }

    const pageSize = 100;
    const request: IncidentEdgesRequest = {
      seedEntityIds: [seedEntityId],
      relationshipTypes: [...AGENT_EDGE_LABELS, 'AGENT_LINKED'],
    };

    try {
      const response = await this.graphsClientService.readIncidentEdges(
        organizationId,
        projectId,
        request,
        userToken,
      );

      for (const group of response.groups) {
        if (group.neighborTotal > pageSize) {
          this.logger.warn(
            'Agent edges may be truncated — returned page-size limit',
            {
              seedEntityId: group.seedEntityId,
              neighborTotal: group.neighborTotal,
              pageSize,
            },
          );
        }
      }

      const seen = new Set<string>();
      const merged: AgentEdge[] = [];
      for (const seedResult of response.groups) {
        if (seedResult.seedEntityId !== seedEntityId) continue;
        for (const relationship of seedResult.relationships ?? []) {
          const edge = graphRelationshipToAgentEdge(relationship);
          if (!edge) continue;
          if (seen.has(edge.id)) continue;
          seen.add(edge.id);
          merged.push(edge);
        }
      }
      return merged;
    } catch (error) {
      this.logger.warn('Failed to fetch agent edges for relatedEntities', {
        organizationId,
        projectId,
        seedEntityId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async fetchEntityNeighborhood(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityType: EntityType,
    entityId: string,
    featureIds: Set<string>,
    planPivotEntityIds: Set<string>,
    userToken: string,
    relatedEntityDepth: RelatedEntityDepth,
  ): Promise<EntityNeighborhoodResponse | null> {
    try {
      return await this.graphsClientService.getEntityNeighborhood(
        organizationId,
        projectId,
        {
          seedEntityType: entityType,
          seedEntityId: entityId,
          featureIds: Array.from(featureIds),
          planPivotEntityIds: Array.from(planPivotEntityIds),
          depth: relatedEntityDepth,
          relationshipTypes: TOPOLOGY_RELATIONSHIP_WHITELIST,
        },
        userToken,
      );
    } catch (error) {
      this.logger.warn(
        'Entity neighborhood fetch failed; relatedEntities/agentSessions empty',
        {
          entityId,
          entityType,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  /**
   * Thin adapter that takes the labeled neighborhood from the graph
   * service and merges in agent-edge entries (which the API still owns
   * because the agent-edge fetch and `reasoning` text are agent-specific).
   *
   * The graph service has already applied every labeling and exclusion
   * rule for system-graph edges. This method only:
   * - Maps the wire DTOs onto `ContextRelatedEntityDto` / `AgentSessionEntryDto`.
   * - Walks the agent-edge list, hydrates each endpoint from the
   *   neighborhood's own entries, and merges with dedup.
   */
  private async assembleNeighborhood(
    organizationId: OrganizationId,
    projectId: ProjectId,
    seedEntityId: string,
    neighborhood: EntityNeighborhoodResponse | null,
    agentEdges: AgentEdge[],
    featureIds: Set<string>,
    planPivotEntityIds: Set<string>,
  ): Promise<{
    relatedEntities: ContextRelatedEntityDto[];
    agentSessions: AgentSessionEntryDto[];
  }> {
    if (!neighborhood) {
      return { relatedEntities: [], agentSessions: [] };
    }

    const relatedEntries: ContextRelatedEntityDto[] = (
      neighborhood.relatedEntities ?? []
    ).map((entry: EntityNeighborhoodRelatedEntity): ContextRelatedEntityDto => {
      const mapped: ContextRelatedEntityDto = {
        entityId: entry.entityId,
        entityType: entry.entityType,
        displayName: entry.displayName,
        relationship: entry.relationship,
        source: 'system',
      };
      // Feature entries (structural siblings/descendants surfaced by the
      // graph service) must not carry a status — features have no work
      // status to report, and stamping one is misleading. This is the only
      // path that can surface a FEATURE-typed entry with a status: the
      // agent-edge path (buildAgentEdgeEntries) already `continue`s on
      // featureIds before its own status stamp, and the nodeCatalog
      // hydration only feeds that already-guarded path.
      if (entry.status !== undefined && !featureIds.has(entry.entityId))
        mapped.status = entry.status;
      // taskType is an opaque work-item type key (STANDARD, BUG, or a custom
      // registry string like MARKETING) — forward it as-is for TASK entries.
      if (entry.taskType !== undefined) mapped.taskType = entry.taskType;
      if (entry.via && entry.via.length > 0) {
        mapped.via = entry.via.map(
          (v): RelatedEntityViaDto => ({
            entityId: v.entityId,
            entityType: v.entityType,
            displayName: v.displayName,
            relationship: v.relationship,
          }),
        );
      }
      return mapped;
    });

    let agentSessions: AgentSessionEntryDto[] = (
      neighborhood.agentSessions ?? []
    ).map((entry) => {
      const mapped: AgentSessionEntryDto = {
        entityId: entry.entityId,
        entityType: entry.entityType,
        displayName: entry.displayName,
      };
      if (entry.status !== undefined) mapped.status = entry.status;
      return mapped;
    });

    agentSessions = await this.orderAttachedAgentSessions(
      organizationId,
      projectId,
      agentSessions,
      seedEntityId,
    );

    // Agent-edge entries (always direct because the fetch is seed-scoped).
    // Hydrate endpoint metadata from the neighborhood's nodeCatalog — the
    // graph service publishes every traversed entity there, so endpoints
    // reachable only via AGENT_LINKED still get displayName / status.
    // Agent-edge endpoints not in the catalog are silently dropped,
    // matching prior behavior.
    const entityInfoById = new Map<
      string,
      {
        entityId: string;
        entityType: string;
        displayName: string;
        status: string | undefined;
        taskType: string | undefined;
      }
    >();
    for (const node of neighborhood.nodeCatalog ?? []) {
      entityInfoById.set(node.entityId, {
        entityId: node.entityId,
        entityType: node.entityType,
        displayName: node.displayName,
        status: node.status,
        taskType: node.taskType,
      });
    }
    for (const entry of relatedEntries) {
      if (entityInfoById.has(entry.entityId)) continue;
      entityInfoById.set(entry.entityId, {
        entityId: entry.entityId,
        entityType: entry.entityType,
        displayName: entry.displayName,
        status: entry.status,
        taskType: entry.taskType,
      });
    }
    for (const entry of agentSessions) {
      if (entityInfoById.has(entry.entityId)) continue;
      entityInfoById.set(entry.entityId, {
        entityId: entry.entityId,
        entityType: entry.entityType,
        displayName: entry.displayName,
        status: entry.status,
        // AGENT_SESSION endpoints are not tasks and carry no taskType.
        taskType: undefined,
      });
    }

    const seenEntityKeys = new Set<string>(
      relatedEntries.map((e) => `${e.entityId}:${e.relationship}`),
    );
    const agentEntries = this.buildAgentEdgeEntries(
      seedEntityId,
      agentEdges,
      entityInfoById,
      featureIds,
      planPivotEntityIds,
    );
    for (const entry of agentEntries) {
      const key = `${entry.entityId}:${entry.relationship}:agent`;
      if (seenEntityKeys.has(key)) continue;
      seenEntityKeys.add(key);
      relatedEntries.push(entry);
    }

    return { relatedEntities: relatedEntries, agentSessions };
  }

  private async orderAttachedAgentSessions(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentSessions: AgentSessionEntryDto[],
    seedEntityId: string,
  ): Promise<AgentSessionEntryDto[]> {
    if (agentSessions.length < 2) return agentSessions;

    const orderedSessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        projectId,
        id: { in: agentSessions.map((entry) => entry.entityId) },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const orderById = new Map<string, number>(
      orderedSessions.map((entry, index) => [entry.id, index]),
    );
    const ordered = [...agentSessions].sort(
      (left, right) =>
        (orderById.get(left.entityId) ?? Number.MAX_SAFE_INTEGER) -
          (orderById.get(right.entityId) ?? Number.MAX_SAFE_INTEGER) ||
        left.entityId.localeCompare(right.entityId),
    );
    this.logger.debug('Ordered attached agent sessions newest first', {
      seedEntityId,
      agentSessionCount: ordered.length,
    });
    return ordered;
  }

  private buildAgentEdgeEntries(
    seedEntityId: string,
    agentEdges: AgentEdge[],
    entityInfoById: Map<
      string,
      {
        entityId: string;
        entityType: string;
        displayName: string;
        status: string | undefined;
        taskType: string | undefined;
      }
    >,
    featureIds: Set<string>,
    planPivotEntityIds: Set<string>,
  ): ContextRelatedEntityDto[] {
    const entries: ContextRelatedEntityDto[] = [];
    const droppedTargets: string[] = [];

    for (const edge of agentEdges) {
      if (isFlowAgentEdgeRelationshipType(edge.type)) continue;
      if (!isAgentEdgeRelationshipType(edge.type)) continue;

      let direction: EdgeDirection;
      let otherEntityId: string;
      if (edge.sourceNodeId === seedEntityId) {
        direction = 'outbound';
        otherEntityId = edge.targetNodeId;
      } else if (edge.targetNodeId === seedEntityId) {
        direction = 'inbound';
        otherEntityId = edge.sourceNodeId;
      } else {
        continue;
      }

      if (otherEntityId === seedEntityId) continue;
      if (featureIds.has(otherEntityId)) continue;
      if (planPivotEntityIds.has(otherEntityId)) continue;

      const info = entityInfoById.get(otherEntityId);
      if (!info) {
        droppedTargets.push(otherEntityId);
        continue;
      }
      if (info.entityType === 'ARTIFACT' || info.entityType === 'AGENT_SESSION')
        continue;

      const relationship = agentEdgeToRelationship(edge.type, direction);
      const entry: ContextRelatedEntityDto = {
        entityId: info.entityId,
        entityType: info.entityType,
        displayName: info.displayName,
        relationship,
        source: 'agent',
        reasoning: edge.reasoning,
      };
      if (info.status !== undefined) entry.status = info.status;
      // Endpoints here are already gated to non-ARTIFACT / non-AGENT_SESSION
      // types; taskType rides along for TASK endpoints (opaque registry key).
      if (info.taskType !== undefined) entry.taskType = info.taskType;
      entries.push(entry);
    }

    if (droppedTargets.length > 0) {
      this.logger.debug(
        'Dropped agent-edge entries whose endpoint was not in graph traversal',
        { seedEntityId, count: droppedTargets.length },
      );
    }

    return entries;
  }

  private async findProposalsByEntities(
    organizationId: OrganizationId,
    entityIds: readonly string[],
    take: number,
  ): Promise<ProposalWithApprovals[]> {
    return this.prisma.db.proposal.findMany({
      where: {
        organizationId,
        targetEntityId: { in: [...new Set(entityIds)] },
        ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { approvalRecords: true },
    });
  }

  private async findCreatingProposal(
    organizationId: OrganizationId,
    entityId: string,
  ): Promise<ProposalWithApprovals | null> {
    return this.prisma.db.proposal.findFirst({
      where: {
        organizationId,
        targetEntityId: entityId,
        action: 'CREATE',
        ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      },
      include: { approvalRecords: true },
    });
  }

  private getToolsForEntityType(entityType: EntityType): AvailableMcpToolDto[] {
    return MCP_TOOLS_BY_ENTITY_TYPE[entityType] ?? [];
  }

  private async resolveEntityMeta(
    entityType: EntityType,
    entityId: string,
  ): Promise<{ createdAt: string; displayName: string; taskType?: string }> {
    const where = { id: entityId } as const;

    type MetaRow = {
      createdAt: Date;
      displayName: string | null;
      taskType?: string;
    } | null;

    // Exhaustive over EntityType so a new kind must choose how it resolves.
    // `null` kinds have no standalone metadata read here: CONVERSATION and
    // MESSAGE are resolved by their authorized seed before this point.
    const lookups: Record<EntityType, (() => Promise<MetaRow>) | null> = {
      ARTIFACT: null,
      VALIDATION_SESSION: null,
      PROPOSAL: null,
      USER: null,
      CONVERSATION: null,
      MESSAGE: null,
      PROJECT: async () => {
        const r = await this.prisma.db.project.findUnique({
          where,
          select: { createdAt: true, name: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.name };
      },
      TASK: async () => {
        const r = await this.prisma.db.task.findUnique({
          where,
          select: { createdAt: true, name: true, type: true },
        });
        return (
          r && {
            createdAt: r.createdAt,
            displayName: r.name,
            taskType: r.type,
          }
        );
      },
      DESIGN_DOC: async () => {
        const r = await this.prisma.db.designDoc.findUnique({
          where,
          select: { createdAt: true, name: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.name };
      },
      INITIATIVE: async () => {
        const r = await this.prisma.db.initiative.findUnique({
          where,
          select: { createdAt: true, name: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.name };
      },
      REPORT: async () => {
        const r = await this.prisma.db.report.findUnique({
          where,
          select: { createdAt: true, reportType: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.reportType };
      },
      AGENT_SESSION: async () => {
        const r = await this.prisma.db.agentSession.findUnique({
          where,
          select: { createdAt: true, title: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.title };
      },
      SERVICE: async () => {
        const r = await this.prisma.db.service.findUnique({
          where,
          select: { createdAt: true, name: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.name };
      },
      IMPLEMENTATION_HINT: async () => {
        const r = await this.prisma.db.implementationHint.findUnique({
          where,
          select: { createdAt: true, featureName: true },
        });
        return r && { createdAt: r.createdAt, displayName: r.featureName };
      },
    };

    const lookup = lookups[entityType];
    if (!lookup) {
      throw new NotFoundException(
        `No metadata lookup for entity type ${entityType}`,
      );
    }

    const entity = await lookup();
    if (!entity) {
      throw new NotFoundException(
        `${entityType} with id ${entityId} not found`,
      );
    }

    return {
      createdAt: entity.createdAt.toISOString(),
      displayName: entity.displayName ?? '(unnamed)',
      ...(entity.taskType !== undefined ? { taskType: entity.taskType } : {}),
    };
  }
}
