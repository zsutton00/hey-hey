import { Injectable, Logger } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { AgentEdgeClientService } from '../../services/agent-edge-client.service';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import { EntityRegistryService } from '../../services/entity-registry/entity-registry.service';
import type { CreateAgentEdgeDto } from '../../generated/graphs/model/createAgentEdgeDto';
import type { UpdateAgentEdgeDto } from '../../generated/graphs/model/updateAgentEdgeDto';
import { AgentEdgeEndpointEntityType } from '../../generated/graphs/model/agentEdgeEndpointEntityType';
import { OrganizationId, ProjectId } from '../../types';
import {
  AGENT_EDGE_TYPES,
  FREELY_AUTHORABLE_EDGE_TYPES,
  GET_EDGES_VISIBLE_EDGE_TYPES,
  WORKFLOW_FLOW_EDGE_TYPES,
  WORKFLOW_META_EDGE_TYPES,
} from './agent-edge-vocabulary';
import {
  AuthContext,
  extractAuthContext,
  isAgentSessionId,
  isAuthContext,
  mcpError,
  resolveAgentSessionId,
  resolveProjectId,
  isProjectId,
} from './mcp-tool.utils';
import { validateAuthoringRootProof } from './authoring-guidance';
import { admitWholeRecords, SIZE_BUDGET_REASON } from './response-budget';

const FREELY_AUTHORABLE_TYPE_LIST = FREELY_AUTHORABLE_EDGE_TYPES.join(', ');
const AGENT_EDGE_TYPE_LIST = AGENT_EDGE_TYPES.join(', ');
const WORKFLOW_META_EDGE_TYPE_LIST = WORKFLOW_META_EDGE_TYPES.join(', ');
const WORKFLOW_FLOW_EDGE_TYPE_LIST = WORKFLOW_FLOW_EDGE_TYPES.join(', ');
const GET_EDGES_TYPE_LIST = [
  ...GET_EDGES_VISIBLE_EDGE_TYPES,
  'INFLUENCES',
  'PROPOSED_TOGETHER',
].join(', ');

function requireToken(auth: AuthContext): string | CallToolResult {
  if (!auth.token) {
    return mcpError('Authentication token required for edge operations.');
  }
  return auth.token;
}

function isToken(value: string | CallToolResult): value is string {
  return typeof value === 'string';
}

export const createEdgeParameters = z.object({
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required for this topology mutation.',
    ),
  sourceNodeId: z.string().uuid().describe('Entity ID of the source node'),
  targetNodeId: z.string().uuid().describe('Entity ID of the target node'),
  type: z
    .enum(FREELY_AUTHORABLE_EDGE_TYPES)
    .describe(
      `Relationship type, one of: ${FREELY_AUTHORABLE_TYPE_LIST}. ` +
        'SUPERSEDES is not accepted here — it must flow through the ' +
        'supersede transition (status flip + edge), not raw create_edge.',
    ),
  reasoning: z
    .string()
    .min(1)
    .describe(
      'Natural language rationale for why this edge exists — ' +
        'explain the discovered connection',
    ),
});

const createEdgeOutput = z.object({
  id: z.string().describe('Created edge ID'),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  type: z.string(),
  reasoning: z.string(),
  createdBySessionId: z.string().nullable().optional(),
});

type CreateEdgeOutput = z.infer<typeof createEdgeOutput>;

const updateEdgeParameters = z.object({
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required for this topology mutation.',
    ),
  edgeId: z.string().uuid().describe('ID of the edge to update'),
  type: z
    .enum(FREELY_AUTHORABLE_EDGE_TYPES)
    .optional()
    .describe(
      `Updated relationship type, one of: ${FREELY_AUTHORABLE_TYPE_LIST}. ` +
        'SUPERSEDES is not accepted here — it must flow through the ' +
        'supersede transition, not raw update_edge.',
    ),
  reasoning: z
    .string()
    .min(1)
    .optional()
    .describe('Updated rationale for the edge'),
});

const updateEdgeOutput = z.object({
  id: z.string().describe('Updated edge ID'),
  type: z.string(),
  reasoning: z.string(),
  lastModifiedBySessionId: z.string().nullable().optional(),
});

type UpdateEdgeOutput = z.infer<typeof updateEdgeOutput>;

const deleteEdgeParameters = z.object({
  authoringRootProof: z
    .string()
    .optional()
    .describe(
      'Reusable proof returned by get_authoring_guidance(). Required for this topology mutation.',
    ),
  edgeId: z.string().uuid().describe('ID of the edge to delete'),
  reason: z
    .string()
    .optional()
    .describe('Optional reason for deletion, for audit trail'),
});

const deleteEdgeOutput = z.object({
  deleted: z.boolean(),
  edgeId: z.string(),
});

type DeleteEdgeOutput = z.infer<typeof deleteEdgeOutput>;

const GET_EDGES_MAX_SEEDS = 10;
const SUPPORTED_ENDPOINT_ENTITY_TYPES = new Set<string>(
  Object.values(AgentEdgeEndpointEntityType),
);

const getEdgesParameters = z.object({
  entities: z
    .array(
      z.object({
        entityType: z
          .string()
          .describe(
            'Entity type of the seed (TASK, FEATURE, DESIGN_DOC, PLAN, ...)',
          ),
        entityId: z.string().uuid().describe('Entity ID of the seed'),
      }),
    )
    .min(1)
    .describe(
      `Up to ${GET_EDGES_MAX_SEEDS} {entityType, entityId} seed pairs to ` +
        'read direct edges for. Edges are returned keyed by entityId.',
    ),
});

const getEdgesEndpointSchema = z.object({
  entityType: z.string().describe('Type of the entity at the far end'),
  entityId: z.string().describe('ID of the entity at the far end'),
  displayName: z
    .string()
    .describe('Human-readable name or title of the far entity'),
  taskType: z
    .string()
    .optional()
    .describe(
      'Opaque work-item type key when the far endpoint is a TASK; omitted for non-task endpoints.',
    ),
});

const getEdgesEntityEdgeSchema = z.object({
  direction: z
    .enum(['out', 'in'])
    .describe(
      'Edge direction relative to the seed: `out` when the seed is the ' +
        'edge source, `in` when it is the target.',
    ),
  edgeType: z
    .enum([...GET_EDGES_VISIBLE_EDGE_TYPES, 'INFLUENCES', 'PROPOSED_TOGETHER'])
    .describe(
      'Relationship type: one of the meta agent edge types ' +
        `(${AGENT_EDGE_TYPE_LIST}), visible workflow meta edge types ` +
        `(${WORKFLOW_META_EDGE_TYPE_LIST}), workflow flow edge types ` +
        `(${WORKFLOW_FLOW_EDGE_TYPE_LIST}), INFLUENCES for proposal-influence ` +
        'edges, or PROPOSED_TOGETHER for symmetric, system-emitted edges ' +
        'between entities co-authored by the same approved proposal. ' +
        'Workflow flow edge types are read-only sequencing links, and ' +
        'PROPOSED_TOGETHER is read-only — `create_edge` rejects them; only ' +
        'workflow-aware paths or the Graph service emit them.',
    ),
  otherEndpoint: getEdgesEndpointSchema,
  createdAt: z.string().describe('When the edge was created (ISO 8601)'),
  reasonType: z
    .string()
    .optional()
    .describe(
      'Influence reason classification. Present only on INFLUENCES edges.',
    ),
});

const getEdgesOmissionSchema = z.object({
  omitted: z.literal(true),
  reason: z.literal(SIZE_BUDGET_REASON),
  entityType: z.string().describe('Entity type of the omitted seed'),
  entityId: z.string().describe('Entity ID of the omitted seed'),
});

const getEdgesOutput = z.object({
  edgesByEntity: z
    .record(z.array(getEdgesEntityEdgeSchema))
    .describe(
      'Direct edges keyed by the seed entityId, for every seed returned ' +
        'whole. A returned seed with no edges (or an unknown/stale ID) ' +
        'maps to an empty array. Seeds listed in omittedEntities are not ' +
        'keys here.',
    ),
  omittedEntities: z
    .array(getEdgesOmissionSchema)
    .describe(
      'Seeds left out because returning their edges would exceed the ' +
        'response size budget, in request order. Empty when every seed was ' +
        'returned. Re-request exactly these entityType/entityId pairs.',
    ),
});

type GetEdgesOutput = z.infer<typeof getEdgesOutput>;

type EdgeBucket = {
  entityType: string;
  entityId: string;
  edges: GetEdgesOutput['edgesByEntity'][string];
};
type EdgeOmission = z.infer<typeof getEdgesOmissionSchema>;

function toGetEdgesOutput(
  entries: readonly (EdgeBucket | EdgeOmission)[],
): GetEdgesOutput {
  const edgesByEntity: GetEdgesOutput['edgesByEntity'] = {};
  const omittedEntities: GetEdgesOutput['omittedEntities'] = [];
  for (const entry of entries) {
    if ('omitted' in entry) omittedEntities.push(entry);
    else edgesByEntity[entry.entityId] = entry.edges;
  }
  return { edgesByEntity, omittedEntities };
}

function budgetEdges(
  entities: z.infer<typeof getEdgesParameters>['entities'],
  edgesByEntity: GetEdgesOutput['edgesByEntity'],
): GetEdgesOutput {
  const entries = admitWholeRecords<EdgeBucket, EdgeOmission>(
    entities.map(({ entityType, entityId }) => ({
      entityType,
      entityId,
      edges: edgesByEntity[entityId] ?? [],
    })),
    ({ entityType, entityId }) => ({
      omitted: true,
      reason: SIZE_BUDGET_REASON,
      entityType,
      entityId,
    }),
    (entry) => JSON.stringify(entry).length,
  );
  return toGetEdgesOutput(entries);
}

@Injectable()
export class EdgeToolsProvider {
  private readonly logger = new Logger(EdgeToolsProvider.name);

  constructor(
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly entityContextService: EntityContextService,
    private readonly entityRegistryService: EntityRegistryService,
  ) {}

  @Tool({
    name: 'get_edges',
    description:
      'Read the direct (1-hop) edges incident on a batch of up to ten ' +
      'entities, in a single call. Returns, keyed by entityId, the typed ' +
      `edges (${GET_EDGES_TYPE_LIST}) touching each seed, with direction ` +
      '(relative to the seed), the far endpoint, and when the edge was ' +
      'created. Seeds are returned whole in request order within an ' +
      '8,000-token estimated budget; the first seed is always returned ' +
      'whole. Seeds that do not fit are listed in omittedEntities with ' +
      'their entityType and entityId — re-request exactly those pairs and ' +
      'repeat until none remain. FULFILLED_BY is a visible workflow meta edge; STANDARD, ' +
      'CONDITIONAL, and LOOP are workflow flow edges, not generic meta ' +
      'links. PROPOSED_TOGETHER is the symmetric, system-emitted ' +
      'co-authorship edge — read-only on the agent surface. Use to ' +
      'discover how entities connect across the hierarchy before ' +
      'proposing new edges or changes. Project is resolved from the ' +
      'X-Project-ID request header.',
    parameters: getEdgesParameters,
    outputSchema: getEdgesOutput,
  })
  async getEdges(
    params: z.infer<typeof getEdgesParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetEdgesOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    const { entities } = params;
    if (entities.length > GET_EDGES_MAX_SEEDS) {
      return mcpError(
        `get_edges accepts at most ${GET_EDGES_MAX_SEEDS} entities per ` +
          `call; received ${entities.length}. Split the request into ` +
          `batches of ${GET_EDGES_MAX_SEEDS} or fewer.`,
      );
    }

    this.logger.log('get_edges called', {
      organizationId: auth.organizationId,
      projectId,
      entityCount: entities.length,
    });

    try {
      const edgesByEntity = await this.entityContextService.getEdges(
        auth.organizationId as OrganizationId,
        projectId as ProjectId,
        entities,
        token,
      );
      return budgetEdges(entities, edgesByEntity);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(`get_edges failed: ${message}\n${stack}`);
      return mcpError(`Edge read failed: ${message}`);
    }
  }

  @Tool({
    name: 'create_edge',
    description:
      'Create an agent-authored edge between two entities. Use when you ' +
      'discover a meaningful connection between entities (tasks, features, ' +
      'design docs, etc.) that is not captured by the existing graph. ' +
      `Allowed relationship types: ${FREELY_AUTHORABLE_TYPE_LIST}. ` +
      'Workflow flow edges (STANDARD, CONDITIONAL, LOOP) and FULFILLED_BY ' +
      'are not accepted here; use workflow-aware authoring paths for those. ' +
      'SUPERSEDES must go through the supersede transition instead. ' +
      'Project is resolved from the X-Project-ID request header; agent ' +
      'session from X-Agent-Session-ID.',
    parameters: createEdgeParameters,
    outputSchema: createEdgeOutput,
  })
  async createEdge(
    params: z.infer<typeof createEdgeParameters>,
    _context: Context,
    request: Request,
  ): Promise<CreateEdgeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const rootProofError = validateAuthoringRootProof({
      toolName: 'create_edge',
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const agentSessionId = resolveAgentSessionId(request);
    if (!isAgentSessionId(agentSessionId)) return agentSessionId;

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    const { sourceNodeId, targetNodeId, type, reasoning } = params;

    this.logger.log('create_edge called', {
      organizationId: auth.organizationId,
      projectId,
      sourceNodeId,
      targetNodeId,
      type,
    });

    try {
      const endpointTypes = await this.resolveCreateEdgeEndpointTypes(
        auth.organizationId,
        sourceNodeId,
        targetNodeId,
      );
      const dto: CreateAgentEdgeDto = {
        sourceNodeId,
        sourceEntityType: endpointTypes.sourceEntityType,
        targetNodeId,
        targetEntityType: endpointTypes.targetEntityType,
        type,
        reasoning,
        createdBySessionId: agentSessionId,
      };

      const created = await this.agentEdgeClient.create(
        auth.organizationId,
        projectId as ProjectId,
        dto,
        token,
      );

      return {
        id: created.id,
        sourceNodeId: created.sourceNodeId,
        targetNodeId: created.targetNodeId,
        type: created.type,
        reasoning: created.reasoning,
        createdBySessionId: created.createdBySessionId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(`create_edge failed: ${message}\n${stack}`);
      return mcpError(`Edge creation failed: ${message}`);
    }
  }

  private async resolveCreateEdgeEndpointTypes(
    organizationId: OrganizationId,
    sourceNodeId: string,
    targetNodeId: string,
  ): Promise<{
    sourceEntityType: AgentEdgeEndpointEntityType;
    targetEntityType: AgentEdgeEndpointEntityType;
  }> {
    const entities = await this.entityRegistryService.getEntitiesByIds({
      organizationId,
      entities: [{ entityId: sourceNodeId }, { entityId: targetNodeId }],
    });

    return {
      sourceEntityType: this.resolveEndpointEntityType(
        entities,
        sourceNodeId,
        'sourceNodeId',
      ),
      targetEntityType: this.resolveEndpointEntityType(
        entities,
        targetNodeId,
        'targetNodeId',
      ),
    };
  }

  private resolveEndpointEntityType(
    entities: Awaited<ReturnType<EntityRegistryService['getEntitiesByIds']>>,
    entityId: string,
    field: 'sourceNodeId' | 'targetNodeId',
  ): AgentEdgeEndpointEntityType {
    const matches = entities.filter((entity) => entity.entityId === entityId);
    if (matches.length === 0) {
      throw new Error(
        `Unable to resolve ${field} ${entityId} in the entity registry.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Unable to resolve ${field} ${entityId}: multiple entity types matched.`,
      );
    }
    const entityType = matches[0]!.entityType;
    if (!SUPPORTED_ENDPOINT_ENTITY_TYPES.has(entityType)) {
      throw new Error(
        `Entity type ${entityType} for ${field} ${entityId} is not supported as a graph edge endpoint.`,
      );
    }
    return entityType as AgentEdgeEndpointEntityType;
  }

  @Tool({
    name: 'update_edge',
    description:
      'Update an existing agent-authored edge. Use to refine or correct ' +
      'the relationship type or reasoning of a previously created edge. ' +
      `Allowed relationship types: ${FREELY_AUTHORABLE_TYPE_LIST}. ` +
      'Workflow flow edges (STANDARD, CONDITIONAL, LOOP) and FULFILLED_BY ' +
      'are not accepted here; use workflow-aware authoring paths for those. ' +
      'SUPERSEDES must go through the supersede transition instead. ' +
      'Project is resolved from the X-Project-ID request header; agent ' +
      'session from X-Agent-Session-ID.',
    parameters: updateEdgeParameters,
    outputSchema: updateEdgeOutput,
  })
  async updateEdge(
    params: z.infer<typeof updateEdgeParameters>,
    _context: Context,
    request: Request,
  ): Promise<UpdateEdgeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const rootProofError = validateAuthoringRootProof({
      toolName: 'update_edge',
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const agentSessionId = resolveAgentSessionId(request);
    if (!isAgentSessionId(agentSessionId)) return agentSessionId;

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    const { edgeId, type, reasoning } = params;

    if (type === undefined && reasoning === undefined) {
      return mcpError('No fields provided to update.');
    }

    this.logger.log('update_edge called', {
      organizationId: auth.organizationId,
      edgeId,
      type,
    });

    try {
      const dto: UpdateAgentEdgeDto = {
        lastModifiedBySessionId: agentSessionId,
        ...(type !== undefined && { type }),
        ...(reasoning !== undefined && { reasoning }),
      };

      const updated = await this.agentEdgeClient.update(
        auth.organizationId,
        projectId as ProjectId,
        edgeId,
        dto,
        token,
      );

      return {
        id: updated.id,
        type: updated.type,
        reasoning: updated.reasoning,
        lastModifiedBySessionId: updated.lastModifiedBySessionId ?? null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(`update_edge failed: ${message}\n${stack}`);
      return mcpError(`Edge update failed: ${message}`);
    }
  }

  @Tool({
    name: 'delete_edge',
    description:
      'Delete an agent-authored edge that proved incorrect or is no ' +
      'longer relevant. Provide an optional reason for the audit trail. ' +
      'Project is resolved from the X-Project-ID request header.',
    parameters: deleteEdgeParameters,
    outputSchema: deleteEdgeOutput,
  })
  async deleteEdge(
    params: z.infer<typeof deleteEdgeParameters>,
    _context: Context,
    request: Request,
  ): Promise<DeleteEdgeOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const rootProofError = validateAuthoringRootProof({
      toolName: 'delete_edge',
      token: params.authoringRootProof,
      required: true,
    });
    if (rootProofError) return mcpError(rootProofError);

    const token = requireToken(auth);
    if (!isToken(token)) return token;

    const { edgeId, reason } = params;

    this.logger.log('delete_edge called', {
      organizationId: auth.organizationId,
      edgeId,
      reason,
    });

    try {
      await this.agentEdgeClient.delete(
        auth.organizationId,
        projectId as ProjectId,
        edgeId,
        token,
        reason,
      );

      return { deleted: true, edgeId };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? (error.stack ?? '') : '';
      this.logger.warn(`delete_edge failed: ${message}\n${stack}`);
      return mcpError(`Edge deletion failed: ${message}`);
    }
  }
}
