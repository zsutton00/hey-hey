import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import {
  EntityContextService,
  type FullEntityContextDto,
} from '../../services/entity-context/entity-context.service';
import { EdgeSource } from '../../generated/model/edgeSource';
import { EntityType as EntityTypeEnum } from '../../generated/model/entityType';
import type { ContextProposalSummaryDto } from '../../generated/model/contextProposalSummaryDto';
import type { EntityContextDtoProposalsInner } from '../../generated/model/entityContextDtoProposalsInner';
import { ContextProposalFieldChangeDto } from '../../generated/model/contextProposalFieldChangeDto';
import { ProposalAction } from '../../generated/model/proposalAction';
import { ProposalDetail } from '../../generated/model/proposalDetail';
import { ProposalStatus } from '../../generated/model/proposalStatus';
import { ProposalType } from '../../generated/model/proposalType';
import { TargetEntityType } from '../../generated/model/targetEntityType';
import type { FeatureRequirementsSection } from '../../generated/model/featureRequirementsSection';
import { validateFeatureRequirementsSection } from '../../services/tasks/feature-requirements-section.validator';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import { ProposalApprovalService } from '../../services/proposal/proposal-approval.service';
import type { OrganizationId, ProjectId } from '../../types';
import { featureTagSchema } from '../../types/feature-tag.types';
import {
  extractAuthContext,
  isAuthContext,
  isProjectId,
  mcpError,
  resolveProjectId,
} from './mcp-tool.utils';
import { admitWholeRecords, SIZE_BUDGET_REASON } from './response-budget';

const GET_CONTEXT_TOOL_NAME = 'get_context';
const MAX_CONTEXT_SEEDS = 5;
const MAX_CONTEXT_CONCURRENCY = 2;
const FUTURE_PROPOSAL_EDGE_PAGE_SIZE = 100;

const contextEntityTypeSchema = z.string();

export const contextSeedSchema = z.object({
  entityId: z.string().uuid().describe('ID of the entity to get context for'),
  entityType: contextEntityTypeSchema.describe(
    'Entity type (e.g. TASK, DESIGN_DOC, PLAN, PLAN_STAGE, INITIATIVE, SERVICE, IMPLEMENTATION_HINT). ' +
      'Any registered work-item type key aliases TASK.',
  ),
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Project ID the entity belongs to. ' +
        'Inferred from session when omitted.',
    ),
});

// Batch seeds are validated per item in the handler so one malformed seed does
// not prevent otherwise valid siblings from being read. Keep the wire shape
// string-based while allowing missing/invalid UUID and enum values through the
// outer MCP schema for item-level error reporting.
const contextBatchSeedSchema = z.object({
  entityId: z.string().optional(),
  entityType: z.string().optional(),
  projectId: z.string().optional(),
});

// Keep this as a ZodObject (rather than a refinement) because the MCP schema
// generator cannot represent ZodEffects. The exactly-one constraint is
// enforced by the handler.
export const getContextParameters = contextSeedSchema.partial().extend({
  seeds: z
    .array(contextBatchSeedSchema)
    .min(1)
    .max(MAX_CONTEXT_SEEDS)
    .optional()
    .describe(
      'Batch of up to five entity seeds. Returns one ordered item per seed; ' +
        'each item independently contains either Context or an error. Provide ' +
        'exactly one complete singular seed or `seeds`.',
    ),
});

const proposalFieldChangeSchema = z.object({
  path: z.string(),
  type: z.nativeEnum(ContextProposalFieldChangeDto.TypeEnum),
  diff: z.string().max(2000).optional(),
  diffTruncated: z.boolean().optional(),
  diffOmittedCharacters: z.number().int().nonnegative().optional(),
  unavailableReason: z
    .nativeEnum(ContextProposalFieldChangeDto.UnavailableReasonEnum)
    .optional(),
  searchedProposalCount: z.number().int().nonnegative().optional(),
  proposedPreview: z.string().optional(),
  proposedLength: z.number().int().nonnegative().optional(),
  proposedPreviewTruncated: z.boolean().optional(),
});

const proposalSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  groupMembership: z.unknown().optional(),
  type: z.nativeEnum(ProposalType),
  action: z.nativeEnum(ProposalAction).describe('CREATE, UPDATE, or DELETE'),
  status: z.nativeEnum(ProposalStatus).describe('DRAFT, APPROVED, or REJECTED'),
  targetEntityId: z.string(),
  targetEntityType: z.nativeEnum(TargetEntityType),
  title: z.string().nullable().optional(),
  requestorId: z.string(),
  requestorContext: z.record(z.unknown()).optional(),
  requiredApprovals: z.number().int(),
  influences: z
    .array(z.unknown())
    .optional()
    .describe('What informed this proposal (lineage data)'),
  generatedWithVersion: z.string().optional(),
  validationSessionId: z.string().optional(),
  conversationId: z
    .string()
    .optional()
    .describe('ID of the conversation that originated this proposal'),
  messageId: z.string().optional(),
  edges: z.array(z.unknown()).optional(),
  approvals: z.array(z.unknown()),
  materialization: z.unknown().optional(),
  changes: z.array(proposalFieldChangeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const relationshipValueSchema = z.enum([
  'depends-on',
  'depended-on-by',
  'blocks',
  'blocked-by',
  'superseded-by',
  'supersedes',
  'derives-from',
  'derived-from-by',
  'contradicts',
  'related-to',
  'evolves',
  'evolved-by',
  'mentions',
  'mentioned-by',
  'created-via',
  'proposed-together',
  'sibling-via-parent',
  'parent',
  'tracked-by',
  'tracks',
]);

const relatedEntityViaSchema = z.object({
  entityId: z.string(),
  entityType: z.string(),
  displayName: z.string(),
  relationship: relationshipValueSchema,
});

const relatedEntitySchema = z.object({
  entityId: z.string(),
  entityType: z.string(),
  displayName: z
    .string()
    .describe('Human-readable name or title of the entity'),
  status: z.string().optional(),
  taskType: z
    .string()
    .optional()
    .describe('Resolved work-item type key for TASK entries.'),
  source: z
    .enum([EdgeSource.System, EdgeSource.Agent, EdgeSource.User])
    .optional()
    .describe(
      'Origin of the relationship: system for platform-derived graph ' +
        'relationships, agent for AI-authored edges, or user for ' +
        'human-authored edges.',
    ),
  relationship: relationshipValueSchema.describe(
    'Relationship between the seed entity and this entity. Direction ' +
      'is encoded in the value (supersedes vs superseded-by, mentions ' +
      'vs mentioned-by); sibling-via-parent surfaces tasks reached only ' +
      'through an excluded parent feature; proposed-together is the ' +
      'symmetric, system-emitted edge between entities co-authored by ' +
      'the same approved proposal.',
  ),
  via: z
    .array(relatedEntityViaSchema)
    .optional()
    .describe(
      'Path from the seed when reached through an excluded pivot ' +
        '(e.g. a parent feature). Empty/absent for direct relationships.',
    ),
  reasoning: z
    .string()
    .optional()
    .describe(
      'Natural language rationale recorded on create_edge. Present ' +
        'only for agent-authored relationships.',
    ),
});

const agentSessionEntrySchema = z.object({
  entityId: z.string(),
  entityType: z
    .string()
    .describe('Always AGENT_SESSION for entries in this list'),
  displayName: z.string(),
  status: z.string().optional(),
});

const featureHierarchyEntrySchema = z.object({
  id: z.string().describe('Feature task ID'),
  name: z.string().describe('Feature task name'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Feature description truncated to 225 characters, or null ' +
        'if no description section exists',
    ),
  descriptionFullLength: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'Total character count of the untruncated description. ' +
        'Null when no description section exists. Compare with ' +
        'description.length to decide whether a full fetch is needed.',
    ),
  relationshipType: z
    .enum([
      'structural',
      'RELATED_TO',
      'DEPENDS_ON',
      'DERIVES_FROM',
      'SUPERSEDES',
      'CONTRADICTS',
      'EVOLVES',
      'PROPOSED_TOGETHER',
    ])
    .describe(
      'Discriminator for how this feature is connected to the seed. ' +
        '`structural` denotes a parent/sibling/descendant entry from the ' +
        'tree walk. The remaining values are agent-authored or ' +
        'system-emitted edge types between two FEATURE tasks. ' +
        'PROPOSED_TOGETHER is symmetric and is emitted by the Graph ' +
        'service when both features were created or modified by the ' +
        'same approved proposal.',
    ),
  relationship: z
    .enum(['ancestor', 'descendant', 'sibling'])
    .optional()
    .describe(
      'Structural position relative to the queried entity. Present only ' +
        'when relationshipType is `structural`.',
    ),
  distance: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Number of hops from the entity (minimum 1). Present only when ' +
        'relationshipType is `structural`.',
    ),
  direction: z
    .enum(['outbound', 'inbound'])
    .optional()
    .describe(
      'Edge direction relative to the seed feature. `outbound` when the ' +
        'seed is the edge source; `inbound` when the seed is the edge ' +
        'target. Present only on typed-edge entries.',
    ),
  parentTaskId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'Parent task ID of the connected feature (null when the connected ' +
        'feature is a root). Present only on typed-edge entries.',
    ),
  reasoning: z
    .string()
    .optional()
    .describe(
      'Natural-language rationale recorded on the agent edge. Present ' +
        'only on typed-edge entries.',
    ),
  tag: featureTagSchema
    .optional()
    .describe(
      'Feature tag classification (product, frontend, backend, infra, ' +
        'design). Absent for pre-tag features that have not yet been ' +
        'back-filled.',
    ),
});

const planContextEntrySchema = z.object({
  id: z.string().uuid().describe('Entity ID of the plan, stage, or step.'),
  entityType: z
    .literal(EntityTypeEnum.Task)
    .describe('TASK is the canonical entity identity for hierarchy entries.'),
  taskType: z
    .string()
    .optional()
    .describe(
      'Registry-backed work-item type key, including PLAN and PLAN_STAGE.',
    ),
  displayName: z.string().describe('Human-readable title.'),
  status: z.string().optional().describe('Current status, if available.'),
  sequenceOrder: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Legacy PlanStage ordering. Canonical sibling stages are dependency-ordered.',
    ),
});

const planContextSchema = z.object({
  parentPlan: planContextEntrySchema.optional(),
  parentStage: planContextEntrySchema.optional(),
  siblingStages: z
    .array(planContextEntrySchema)
    .optional()
    .describe('Canonical PLAN_STAGE Task children in dependency order.'),
});

const featureRequirementsSectionSchema = z
  .custom<FeatureRequirementsSection>(
    (value) => validateFeatureRequirementsSection(value).success,
    'Feature requirements section must match the generated schema',
  )
  .describe(
    'Validated FEATURE requirements records. Record and citation order are authoritative; ' +
      'each record preserves its durable ID, statement, group, and typed citation slots.',
  );

const conversationContextSchema = z.object({
  conversationId: z
    .string()
    .describe('The owning conversation. Never a message id.'),
  conversationTitle: z.string().nullable().optional(),
  about: z
    .object({ entityType: z.string(), entityId: z.string() })
    .optional()
    .describe('The entity this conversation is about, when recorded.'),
  agentSessions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      type: z.string(),
    }),
  ),
  proposals: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().nullable().optional(),
        status: z.string(),
        action: z.string(),
        targetEntityType: z.string(),
        targetEntityId: z.string().nullable().optional(),
      }),
    )
    .describe(
      'Newest proposals raised from this conversation (or, for a MESSAGE ' +
        'seed, from that message), capped.',
    ),
  reports: z.array(
    z.object({ id: z.string(), reportType: z.string(), createdAt: z.string() }),
  ),
  message: z
    .object({
      messageId: z.string(),
      type: z.string(),
      createdAt: z.string().nullable().optional(),
      excerpt: z.string(),
      truncated: z
        .boolean()
        .describe('True when excerpt is shorter than the full message.'),
      length: z.number().int(),
    })
    .optional()
    .describe('MESSAGE seeds only: a capped excerpt of the message body.'),
});

const entityContentSchema = z.object({
  sections: z
    .record(z.string())
    .describe(
      'Materialized section content keyed by section key (e.g. ' +
        'description, acceptanceCriteria, requirements).',
    ),
  status: z.string().optional().describe('Current work status of the entity.'),
  priority: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Priority of the backing task (LOW/MEDIUM/HIGH/CRITICAL). Absent ' +
        'for content with no priority concept (design docs, un-backed ' +
        'steps).',
    ),
  assigneeId: z
    .string()
    .nullable()
    .optional()
    .describe('User the backing task is assigned to.'),
  dueDate: z
    .string()
    .nullable()
    .optional()
    .describe('When the backing task is due (ISO 8601).'),
  requirementsSection: featureRequirementsSectionSchema.optional(),
});

const futureProposalDependencyProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('future'),
    proposalId: z.string(),
    proposalTitle: z.string().nullable(),
    futureId: z.string(),
    status: z.nativeEnum(ProposalStatus),
    approvalsRecorded: z.number().int().nonnegative(),
    requiredApprovals: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('unresolved'),
    proposalId: z.string(),
    reason: z.enum(['NOT_FOUND', 'NOT_FUTURE_REVISION']),
  }),
]);

const futureProposalDependenciesSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('loaded'),
    proposals: z.array(futureProposalDependencyProposalSchema),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string(),
  }),
]);

export const getContextOutput = z.object({
  entityId: z.string(),
  entityType: z.string(),
  taskType: z
    .string()
    .optional()
    .describe(
      'Persisted, resolved work-item type key for TASK seeds. Absent for non-TASK seeds.',
    ),
  displayName: z
    .string()
    .describe('Human-readable name or title of the entity'),
  createdAt: z.string(),
  creatingProposalId: z
    .string()
    .optional()
    .describe('ID of the proposal that originally created this entity'),
  proposalDetail: z.literal(ProposalDetail.Summary),
  olderProposalsOmitted: z.boolean(),
  proposals: z
    .array(proposalSummarySchema)
    .describe('Proposals that created or modified this entity, newest first'),
  relatedEntities: z
    .array(relatedEntitySchema)
    .describe(
      'Entities related to the seed within a 2-hop traversal, in a ' +
        'single flat list with the relationship inline on each entry. ' +
        'Workflow flow edges are excluded from this meta relationship ' +
        'surface; workflow fulfillment links remain visible as meta links. ' +
        'Features live in featureHierarchy; agent sessions live in ' +
        'agentSessions.',
    ),
  agentSessions: z
    .array(agentSessionEntrySchema)
    .describe(
      'Agent sessions attached to the seed entity. Broken out from ' +
        'relatedEntities because agent sessions are lifecycle ' +
        'attachments rather than graph relationships.',
    ),
  featureHierarchy: z
    .array(featureHierarchyEntrySchema)
    .describe(
      'FEATURE-typed tasks related to this entity. Structural entries ' +
        '(relationshipType: structural) cover ancestors, siblings, and ' +
        'descendants in the task tree. When the seed is itself a FEATURE, ' +
        'agent-authored edges between FEATURES are appended with ' +
        'relationshipType set to the edge type (RELATED_TO, DEPENDS_ON, ' +
        'DERIVES_FROM, SUPERSEDES, CONTRADICTS, EVOLVES) plus direction, ' +
        'parentTaskId, and reasoning. Features only — not standard tasks.',
    ),
  planContext: planContextSchema
    .optional()
    .describe(
      'Structural plan placement for plan-resident entities. Present only when the shared Context projection resolves plan topology.',
    ),
  futureProposalDependencies: futureProposalDependenciesSchema
    .optional()
    .describe(
      'For TASK seeds, reports linked future-revision approval state. ' +
        'A loaded result lists each dependency proposal, including unresolved ' +
        'links; unavailable means the graph could not be read. Approval ' +
        'counts are read from the proposal policy. Approved proposals can be ' +
        'read with get_future_revision.',
    ),
  content: entityContentSchema
    .optional()
    .describe(
      "The entity's own content body — sections plus work-tracking " +
        'metadata. Present for TASK (including Plan and Stage work items) ' +
        'and DESIGN_DOC seeds. Absent for entity types with no content body.',
    ),
  conversationContext: conversationContextSchema
    .optional()
    .describe(
      'CONVERSATION and MESSAGE seeds: owning conversation, agent ' +
        'sessions, subject entity, related proposals and reports, and a ' +
        'capped message excerpt. Read the full thread with get_agent_session.',
    ),
});

type GetContextOutput = z.infer<typeof getContextOutput>;

const getContextBatchOmissionOutput = z.object({
  seed: contextBatchSeedSchema,
  omitted: z.literal(true),
  reason: z.literal(SIZE_BUDGET_REASON),
});

const getContextBatchItemOutput = z.union([
  z.object({ seed: contextBatchSeedSchema, result: getContextOutput }),
  z.object({ seed: contextBatchSeedSchema, error: z.string() }),
  getContextBatchOmissionOutput,
]);

export const getContextResultOutput = z.union([
  getContextOutput,
  z.object({ items: z.array(getContextBatchItemOutput) }),
]);

type GetContextBatchItem = z.infer<typeof getContextBatchItemOutput>;
type GetContextBatchOmission = z.infer<typeof getContextBatchOmissionOutput>;
type ContextSeed = z.infer<typeof contextSeedSchema>;
type GetContextResultOutput = z.infer<typeof getContextResultOutput>;

function isCallToolError(
  value: GetContextOutput | CallToolResult,
): value is CallToolResult {
  return 'isError' in value && value.isError === true;
}

function readMcpErrorMessage(error: CallToolResult): string {
  const text = error.content.find((item) => item.type === 'text');
  return text?.type === 'text' ? text.text : 'Failed to load entity context';
}

function countContextEntries(context: GetContextOutput | undefined): number {
  if (!context) return 0;
  const planEntries = context.planContext
    ? Number(context.planContext.parentPlan !== undefined) +
      Number(context.planContext.parentStage !== undefined) +
      (context.planContext.siblingStages?.length ?? 0)
    : 0;
  return (
    1 +
    context.proposals.length +
    context.relatedEntities.length +
    context.agentSessions.length +
    context.featureHierarchy.length +
    planEntries
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]!, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function assertSummaryProposals(
  proposals: EntityContextDtoProposalsInner[],
): asserts proposals is ContextProposalSummaryDto[] {
  if (proposals.some((proposal) => !('changes' in proposal))) {
    throw new Error('Context summary mode returned a full proposal payload');
  }
}

@Injectable()
export class GetContextToolsProvider {
  private readonly logger = new Logger(GetContextToolsProvider.name);

  constructor(
    private readonly entityContextService: EntityContextService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly proposalApprovalService: ProposalApprovalService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  private async loadFutureProposalDependencies(
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskId: string,
    token: string | null,
  ) {
    if (!token) {
      throw new Error('A user token is required to read task dependency edges');
    }

    const proposalIds = new Set<string>();
    let page = 0;
    while (true) {
      const response = await this.agentEdgeClient.list(
        organizationId,
        projectId,
        {
          type: 'DEPENDS_ON',
          sourceNodeId: taskId,
          page,
          size: FUTURE_PROPOSAL_EDGE_PAGE_SIZE,
        },
        token,
      );
      for (const edge of response.content ?? []) {
        if (
          edge.sourceNodeId === taskId &&
          edge.type === 'DEPENDS_ON' &&
          edge.targetEntityType === 'PROPOSAL'
        ) {
          proposalIds.add(edge.targetNodeId);
        }
      }

      const totalPages = response.page?.totalPages;
      if (
        totalPages !== undefined
          ? page + 1 >= totalPages
          : (response.content?.length ?? 0) < FUTURE_PROPOSAL_EDGE_PAGE_SIZE
      ) {
        break;
      }
      page += 1;
    }

    const dependencies =
      await this.proposalApprovalService.readFutureProposalApprovalStates(
        [...proposalIds],
        organizationId,
        projectId,
      );
    this.logger.debug('get_context: resolved future proposal dependencies', {
      taskId,
      candidateCount: proposalIds.size,
      dependencyCount: dependencies.length,
    });
    return { status: 'loaded' as const, proposals: dependencies };
  }

  @Tool({
    name: GET_CONTEXT_TOOL_NAME,
    description:
      'Returns orientation context for an entity: its proposal history (what ' +
      'created or modified it and why), the entities it relates to within ' +
      '2 hops (relatedEntities — flat list, with each relationship inline ' +
      'on the entry), the agent sessions attached to it (agentSessions), ' +
      'and its placement in the product feature hierarchy. ' +
      'Any registered work-item type key aliases TASK. ' +
      'The featureHierarchy shows where the entity sits within the product — ' +
      'e.g. UI → Web UI → Design → Colors — enumerating ancestor features ' +
      '(above it), sibling features (at the same level), and descendant ' +
      'features (below it), each with a distance indicating how many hops away. ' +
      'Call this proactively to orient yourself: when starting work on an ' +
      'unfamiliar entity, when checking upstream or downstream consequences ' +
      'of a change before making edits, and when answering questions about ' +
      'how an entity relates to the broader project. Provide either one ' +
      'entityId/entityType seed for the unchanged singular response, or ' +
      '`seeds` with up to five known entities for ordered, independently ' +
      'successful or failing Context results. Batch results are returned ' +
      'whole in request order within an 8,000-token estimated budget; the ' +
      'first seed is always returned whole. A seed that does not fit, and ' +
      'every seed after it, comes back as { seed, omitted: true, reason: ' +
      'SIZE_BUDGET } — re-request exactly those seeds.',
    parameters: getContextParameters,
    outputSchema: getContextResultOutput,
  })
  async getContext(
    params: z.infer<typeof getContextParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetContextResultOutput | CallToolResult> {
    const hasSingle =
      params.entityId !== undefined ||
      params.entityType !== undefined ||
      params.projectId !== undefined;
    const hasBatch = params.seeds !== undefined;
    if (
      hasSingle === hasBatch ||
      (hasSingle &&
        (params.entityId === undefined || params.entityType === undefined))
    ) {
      return mcpError(
        'Provide exactly one complete singular seed or `seeds` ' +
          '(a batch of up to five seeds).',
      );
    }
    if (hasBatch && params.seeds!.length === 0) {
      return mcpError('Provide at least one seed in `seeds`.');
    }
    if (hasBatch && params.seeds!.length > MAX_CONTEXT_SEEDS) {
      return mcpError(
        `Too many seeds: ${params.seeds!.length} provided, but at most ` +
          `${MAX_CONTEXT_SEEDS} are allowed per call.`,
      );
    }

    if (!hasBatch) {
      return this.loadSingleContext(params as ContextSeed, request);
    }

    const startedAt = performance.now();
    const durationsMs = new Array<number>(params.seeds!.length);
    const items = await mapWithConcurrency(
      params.seeds!,
      MAX_CONTEXT_CONCURRENCY,
      async (seed, index) => {
        const itemStartedAt = performance.now();
        try {
          const parsedSeed = contextSeedSchema.safeParse(seed);
          if (!parsedSeed.success) {
            return { seed, error: 'Invalid context seed' };
          }

          const result = await this.loadSingleContext(parsedSeed.data, request);
          return isCallToolError(result)
            ? { seed, error: readMcpErrorMessage(result) }
            : { seed, result };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to load entity context';
          return { seed, error: message };
        } finally {
          durationsMs[index] = performance.now() - itemStartedAt;
        }
      },
    );
    const response = {
      items: admitWholeRecords<
        Exclude<GetContextBatchItem, GetContextBatchOmission>,
        GetContextBatchOmission
      >(
        items,
        ({ seed }) => ({
          seed,
          omitted: true,
          reason: SIZE_BUDGET_REASON,
        }),
        (entry) => JSON.stringify(entry).length,
      ),
    };
    this.logger.log('get_context batch completed', {
      mode: 'batch',
      seedCount: items.length,
      successfulCount: response.items.filter((item) => 'result' in item).length,
      failedCount: response.items.filter((item) => 'error' in item).length,
      omittedCount: response.items.filter((item) => 'omitted' in item).length,
      wallTimeMs: performance.now() - startedAt,
      serverWorkMs: durationsMs.reduce((sum, duration) => sum + duration, 0),
      responseBytes: Buffer.byteLength(JSON.stringify(response), 'utf8'),
      resultSize: response.items.reduce(
        (sum, item) =>
          sum + countContextEntries('result' in item ? item.result : undefined),
        0,
      ),
    });
    return response;
  }

  private async loadSingleContext(
    params: ContextSeed,
    request: Request,
  ): Promise<GetContextOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const { entityId } = params;
    const { organizationId, token } = auth;

    const resolvedProjectId = resolveProjectId(params, request);
    if (!isProjectId(resolvedProjectId)) {
      return resolvedProjectId;
    }
    const projectId = resolvedProjectId;
    const canonicalType = Object.values(EntityTypeEnum).find(
      (type) => type === params.entityType,
    );
    const entityType =
      canonicalType ??
      (this.workItemTypeRegistry.getRulesForProject(
        params.entityType,
        projectId,
      )
        ? EntityTypeEnum.Task
        : undefined);

    if (entityType === undefined) {
      const acceptedTypes = [
        ...new Set([
          ...Object.values(EntityTypeEnum),
          ...this.workItemTypeRegistry
            .getDefinitions(projectId)
            .filter(({ definition }) =>
              this.workItemTypeRegistry.getRulesForProject(
                definition.key,
                projectId,
              ),
            )
            .map(({ definition }) => definition.key),
        ]),
      ];
      return mcpError(
        'Invalid entityType. Accepted types: ' + acceptedTypes.join(', '),
      );
    }

    this.logger.log('get_context called', {
      organizationId,
      entityId,
      entityType,
    });

    let fullContext: FullEntityContextDto;
    try {
      fullContext = await this.entityContextService.getFullEntityContext(
        organizationId as OrganizationId,
        projectId as ProjectId,
        entityType,
        entityId,
        token ?? null,
        { relatedEntityDepth: 2, proposalDetail: ProposalDetail.Summary },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return mcpError(`Failed to load entity context: ${message}`);
    }

    const proposals = fullContext.proposals ?? [];
    assertSummaryProposals(proposals);

    let futureProposalDependencies: GetContextOutput['futureProposalDependencies'];
    if (entityType === EntityTypeEnum.Task) {
      try {
        futureProposalDependencies = await this.loadFutureProposalDependencies(
          organizationId as OrganizationId,
          projectId as ProjectId,
          entityId,
          token ?? null,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `get_context: failed to load future proposal dependencies for ${entityId}`,
          reason,
        );
        futureProposalDependencies = { status: 'unavailable', reason };
      }
    }

    const output: GetContextOutput = {
      entityId: fullContext.entityId,
      entityType: fullContext.entityType,
      ...(fullContext.taskType !== undefined
        ? { taskType: fullContext.taskType }
        : {}),
      displayName: fullContext.displayName,
      createdAt: fullContext.createdAt,
      creatingProposalId: fullContext.creatingProposalId,
      proposalDetail: ProposalDetail.Summary,
      olderProposalsOmitted: fullContext.olderProposalsOmitted ?? false,
      proposals,
      relatedEntities: fullContext.relatedEntities ?? [],
      agentSessions: fullContext.agentSessions ?? [],
      featureHierarchy: fullContext.featureHierarchy ?? [],
      ...(fullContext.planContext !== undefined
        ? { planContext: fullContext.planContext }
        : {}),
      ...(entityType === EntityTypeEnum.Task
        ? { futureProposalDependencies }
        : {}),
      ...(fullContext.content ? { content: fullContext.content } : {}),
      ...(fullContext.conversationContext
        ? { conversationContext: fullContext.conversationContext }
        : {}),
    };

    return output;
  }
}
