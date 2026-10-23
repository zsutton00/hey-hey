import type { AgenticSession } from '../../session/types';
import type { AgentEdgeResponseDto, FeatureSkeletonNode } from '../../shared/api/generated/api';
import { AgentEdgeType } from '../../shared/api/generated/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalFeatureTreeConversationPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type {
  PrepareResult,
  PromptTypeHandlerDeps,
  UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildFeatureTreeConversationPrompt } from './feature-tree-conversation-prompt';

type EnrichedPayload = LocalFeatureTreeConversationPromptPayload & {
  _skeleton: FeatureSkeletonNode[];
  _edgesByFeatureId: Map<string, AgentEdgeResponseDto[]>;
};

const fetchSkeleton = async (
  organizationId: string,
  projectId: string,
  deps: PromptTypeHandlerDeps,
): Promise<FeatureSkeletonNode[]> => {
  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch (error) {
    deps.logger.warn('feature_tree_conversation.skeleton.auth_failed', {
      organizationId,
      projectId,
      error,
    });
    return [];
  }

  const url =
    `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/projects/${encodeURIComponent(projectId)}/features/skeleton`;

  try {
    const response = await deps.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      deps.logger.warn('feature_tree_conversation.skeleton.http_error', {
        organizationId,
        projectId,
        status: response.status,
      });
      return [];
    }
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body?.data)) {
      deps.logger.warn('feature_tree_conversation.skeleton.malformed_body', {
        organizationId,
        projectId,
      });
      return [];
    }
    return body.data as FeatureSkeletonNode[];
  } catch (error) {
    deps.logger.warn('feature_tree_conversation.skeleton.fetch_failed', {
      organizationId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
};

const AGENT_EDGE_TYPES = new Set<string>(Object.values(AgentEdgeType));

const isAgentEdge = (value: unknown): value is AgentEdgeResponseDto => {
  if (typeof value !== 'object' || value === null) return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge['sourceNodeId'] === 'string' &&
    typeof edge['targetNodeId'] === 'string' &&
    typeof edge['type'] === 'string' &&
    AGENT_EDGE_TYPES.has(edge['type'])
  );
};

const AGENT_EDGES_PAGE_SIZE = 200;

const fetchAgentEdges = async (
  organizationId: string,
  projectId: string,
  deps: PromptTypeHandlerDeps,
): Promise<AgentEdgeResponseDto[]> => {
  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch (error) {
    deps.logger.warn('feature_tree_conversation.edges.auth_failed', {
      organizationId,
      projectId,
      error,
    });
    return [];
  }

  const basePath =
    `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/projects/${encodeURIComponent(projectId)}/agent-edges`;

  const edges: AgentEdgeResponseDto[] = [];
  let page = 0;
  // Paginate until the server reports no further pages; degrade to whatever has
  // accumulated (often nothing) on any failure so an edge hiccup never blocks
  // the session.
  for (;;) {
    const url = `${basePath}?page=${page}&size=${AGENT_EDGES_PAGE_SIZE}`;
    let response: Awaited<ReturnType<PromptTypeHandlerDeps['fetchImpl']>>;
    try {
      response = await deps.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      deps.logger.warn('feature_tree_conversation.edges.fetch_failed', {
        organizationId,
        projectId,
        page,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return edges;
    }
    if (!response.ok) {
      deps.logger.warn('feature_tree_conversation.edges.http_error', {
        organizationId,
        projectId,
        page,
        status: response.status,
      });
      return edges;
    }
    const body = (await response.json()) as {
      content?: unknown;
      page?: { totalPages?: number };
    };
    if (!Array.isArray(body?.content)) {
      deps.logger.warn('feature_tree_conversation.edges.malformed_body', {
        organizationId,
        projectId,
        page,
      });
      return edges;
    }
    for (const item of body.content) {
      if (isAgentEdge(item)) edges.push(item);
    }
    const totalPages = body.page?.totalPages ?? page + 1;
    if (body.content.length === 0 || page + 1 >= totalPages) {
      return edges;
    }
    page += 1;
  }
};

/**
 * Index every edge under each skeleton feature it is incident to. An edge whose
 * source and target are both in the tree is filed under both; an edge touching a
 * non-skeleton node is filed only under the skeleton endpoint(s) it has.
 */
const buildEdgesByFeatureId = (
  skeleton: FeatureSkeletonNode[],
  edges: AgentEdgeResponseDto[],
): Map<string, AgentEdgeResponseDto[]> => {
  const skeletonIds = new Set(skeleton.map((node) => node.id));
  const byFeatureId = new Map<string, AgentEdgeResponseDto[]>();
  const attach = (featureId: string, edge: AgentEdgeResponseDto): void => {
    const existing = byFeatureId.get(featureId);
    if (existing) existing.push(edge);
    else byFeatureId.set(featureId, [edge]);
  };
  for (const edge of edges) {
    if (skeletonIds.has(edge.sourceNodeId)) attach(edge.sourceNodeId, edge);
    if (skeletonIds.has(edge.targetNodeId)) attach(edge.targetNodeId, edge);
  }
  return byFeatureId;
};

export const featureTreeConversationHandler: UserLaunchablePromptTypeHandler<LocalFeatureTreeConversationPromptPayload> =
  {
    id: 'feature_tree_conversation',
    promptType: LocalPromptType.FeatureTreeConversation,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    graphResearchGuidance: true,
    epistemicCalibration: true,
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],
    mcpToolUseCase: 'general',

    addUserMessage(payload: LocalFeatureTreeConversationPromptPayload): string | null {
      const text = payload.userMessage?.trim();
      return text ? `\n\n## User message for this turn\n\n${text}` : null;
    },

    additionalAllowedTools: [
      'propose_future_revision',
      'get_context',
      'list_features',
      'edit_work_item',
      'create_work_item',
      'create_edge',
    ],
    additionalBuiltinTools: ['WebSearch', 'WebFetch'],

    async prepare(
      run: AgenticSession,
      payload: LocalFeatureTreeConversationPromptPayload,
      deps: PromptTypeHandlerDeps,
    ): Promise<PrepareResult<LocalFeatureTreeConversationPromptPayload>> {
      const { organizationId, projectId } = run.contextMetadata ?? {};
      let skeleton: FeatureSkeletonNode[] = [];
      let edges: AgentEdgeResponseDto[] = [];
      if (!organizationId || !projectId) {
        deps.logger.warn('feature_tree_conversation.prepare.missing_context', {
          runId: run.agentic_session_id,
          hasOrganizationId: !!organizationId,
          hasProjectId: !!projectId,
        });
      } else {
        skeleton = await fetchSkeleton(organizationId, projectId, deps);
        edges = await fetchAgentEdges(organizationId, projectId, deps);
        deps.logger.info('feature_tree_conversation.prepare.skeleton_fetched', {
          runId: run.agentic_session_id,
          organizationId,
          projectId,
          nodeCount: skeleton.length,
          edgeCount: edges.length,
        });
      }

      const enriched: EnrichedPayload = {
        ...payload,
        _skeleton: skeleton,
        _edgesByFeatureId: buildEdgesByFeatureId(skeleton, edges),
      };
      return { payload: enriched };
    },

    buildPrompt(payload: LocalFeatureTreeConversationPromptPayload): string {
      const enriched = payload as EnrichedPayload;
      return buildFeatureTreeConversationPrompt({
        skeleton: enriched._skeleton,
        edgesByFeatureId: enriched._edgesByFeatureId,
      });
    },

    buildStartingMessage(): string | null {
      return 'Loading the project feature tree...';
    },
  };
