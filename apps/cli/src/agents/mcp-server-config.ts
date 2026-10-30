import type { OAuthClient } from '../auth/index';
import { extractOrganizationIdFromToken } from '../auth/index';

export interface McpSessionContext {
  readonly inert?: boolean;
  projectId?: string | undefined;
  conversationId?: string | undefined;
  planId?: string | undefined;
  designDocId?: string | undefined;
  serviceId?: string | undefined;
  readonly serviceIds?: readonly string[] | undefined;
  agentSessionId?: string | undefined;
}

export interface McpServerConfigResult {
  mcpServers: Record<string, unknown>;
  allowedTools: string[];
}

export const PROPOSAL_GROUP_MCP_TOOLS: readonly string[] = [
  'start_proposal_group',
  'get_proposal_group_authoring_snapshot',
  'replace_proposal_group_prerequisites',
  'remove_proposal_group_member',
  'finalize_proposal_group',
];

/**
 * Future-revision tools for handlers whose prompts carry authoring guidance.
 * Shared coding/general surfaces expose only the explicit read.
 */
export const FUTURE_REVISION_MCP_TOOLS: readonly string[] = [
  'propose_future_revision',
  'get_future_revision',
];

export type McpToolUseCase =
  | 'coding'
  | 'general'
  | 'planning'
  | 'plan_shaping'
  | 'project_report'
  | 'release_notes'
  | 'research'
  | 'repository_grounding'
  | 'work_tracker_import'
  | 'repository_placement'
  | 'session_monitor'
  | 'task_monitor';

type McpTool = {
  name: string;
  useCases: readonly McpToolUseCase[];
};

export const MCP_SERVER_NAME = 'heyhey-platform';
export const HEYHEY_RESERVED_MCP_SERVER_NAMES = [
  'heyhey-platform',
  'heyhey-submission-tools',
  'heyhey-browser',
] as const;

const MCP_TOOL_LIST: readonly McpTool[] = [
  { name: 'create_edge', useCases: ['coding', 'general'] },
  { name: 'create_implementation_hint', useCases: ['coding', 'general'] },
  { name: 'create_plan', useCases: ['general'] },
  { name: 'create_design_doc', useCases: ['coding', 'general'] },
  { name: 'create_work_item', useCases: ['coding', 'general'] },
  { name: 'create_work_item_type', useCases: ['general'] },
  { name: 'get_work_item_type', useCases: ['general'] },
  {
    name: 'get_work_item_type_guidance_batch',
    useCases: ['coding', 'general'],
  },
  { name: 'edit_work_item_type', useCases: ['general'] },
  ...PROPOSAL_GROUP_MCP_TOOLS.map((name) => ({
    name,
    useCases: ['coding', 'general'] as const,
  })),
  { name: 'get_future_revision', useCases: ['coding', 'general'] },
  { name: 'delete_edge', useCases: ['coding', 'general'] },
  { name: 'delete_implementation_hint', useCases: ['coding', 'general'] },
  { name: 'delete_proposal', useCases: ['coding', 'general'] },
  { name: 'edit_design_doc', useCases: ['coding', 'general'] },
  { name: 'edit_implementation_hint', useCases: ['coding', 'general'] },
  { name: 'edit_work_item', useCases: ['coding', 'general'] },
  { name: 'get_context', useCases: ['coding', 'general'] },
  { name: 'get_edges', useCases: ['coding', 'general'] },
  { name: 'get_feature_sync_context', useCases: ['coding', 'general'] },
  { name: 'get_full_entity', useCases: ['coding', 'general'] },
  { name: 'get_diagram', useCases: ['coding', 'general'] },
  { name: 'get_report_body', useCases: ['coding', 'general'] },
  { name: 'get_proposal', useCases: ['coding', 'general'] },
  { name: 'get_recently_viewed', useCases: ['coding', 'general'] },
  { name: 'get_report_schema', useCases: ['coding', 'general'] },
  { name: 'get_recently', useCases: ['coding', 'general'] },
  { name: 'get_tool_guidance', useCases: ['coding', 'general'] },
  { name: 'get_authoring_guidance', useCases: ['coding', 'general'] },
  { name: 'list_reports_by_entity', useCases: ['coding', 'general'] },
  { name: 'list_features', useCases: ['coding', 'general'] },
  { name: 'plan_search', useCases: ['coding', 'general'] },
  { name: 'search_design_docs', useCases: ['coding', 'general'] },
  { name: 'search_features', useCases: ['coding', 'general'] },
  { name: 'search_implementation_hints', useCases: ['coding', 'general'] },
  { name: 'task_search', useCases: ['coding', 'general'] },
  { name: 'unified_search', useCases: ['coding', 'general'] },
  { name: 'update_edge', useCases: ['coding', 'general'] },
  { name: 'update_proposal', useCases: ['coding', 'general'] },
];

export const CODING_MCP_TOOLS: readonly string[] = MCP_TOOL_LIST.filter((t) =>
  t.useCases.includes('coding'),
).map((t) => t.name);

export const GENERAL_MCP_TOOLS: readonly string[] = MCP_TOOL_LIST.filter((t) =>
  t.useCases.includes('general'),
).map((t) => t.name);

/**
 * Tools the planner must not reach: it surfaces a reviewable plan, it does
 * not mutate the graph. Every entity-mutating proposal tool and every edge
 * tool is stripped from the coding base list. Read/search/report tools
 * survive — including `get_report_schema`, which the planner needs to look
 * up the PLAN payload shape before calling `create_report` (the submission
 * tool wrapper). Implementation-hint tools also survive: hints are the
 * agent's own memory layer, not user-reviewed graph proposals, so the planner
 * may record what it learns while reading the codebase.
 */
const PLANNING_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  // Entity-mutating proposal tools
  'create_design_doc',
  'edit_design_doc',
  'create_work_item',
  'edit_work_item',
  'update_proposal',
  'delete_proposal',
  'propose_future_revision',
  ...PROPOSAL_GROUP_MCP_TOOLS,
  // Shared topology authoring guidance is only useful on authoring surfaces;
  // planning keeps its curated read-only boundary.
  'get_authoring_guidance',
  // Edge tools
  'create_edge',
  'update_edge',
  'delete_edge',
]);

export const PLANNING_MCP_TOOLS: readonly string[] = CODING_MCP_TOOLS.filter(
  (name) => !PLANNING_EXCLUDED_TOOLS.has(name),
);

/**
 * Read/context surface shared by every plan-shaping (plan-from-design-doc)
 * agent — the stage/phase-breakdown handlers. This is the base a
 * plan-shaping handler runs under; each handler then contributes the specific
 * generic work-item authoring tools via `additionalAllowedTools`.
 *
 * Deliberately a curated read-only list rather than a filter of the coding
 * base: the plan-shaping family must NOT inherit the coding toolkit
 * (`create_work_item`, `edit_work_item`, `create_edge`, the searches, …).
 * `create_report` is not listed here — plan-shaping agents reach it via
 * the run-scoped `create_report` submission tool wrapper, which publishes the
 * report-emission lifecycle event and appends to the report chain. The platform
 * MCP tool is not directly reachable by any plan-shaping handler.
 *
 * `list_services` is not in `MCP_TOOL_LIST` (it is not a coding/general tool),
 * but it belongs here because phase-breakdown resolves service
 * ownership from it. Base lists are plain allow-list arrays, so membership in
 * `MCP_TOOL_LIST` is not required.
 */
export const PLAN_SHAPING_MCP_TOOLS: readonly string[] = [
  'get_authoring_guidance',
  'get_full_entity',
  'get_context',
  'get_diagram',
  'get_work_item_type_guidance_batch',
  'get_tool_guidance',
  'get_report_schema',
  'list_services',
];

/**
 * Read-only investigation surface for the `research` mode. Curated to the
 * exact set of platform read tools a research turn needs to map the graph
 * surrounding a focal task: context/edges/full-entity for direct neighborhood
 * walks, the four searches for cross-hierarchy discovery, and
 * implementation-hints for prior-session knowledge. No `create_*`, `edit_*`,
 * `create_edge`, proposal, or report tools — the research handler must not
 * mutate the graph or persist reports as a side effect of its turn.
 */
export const RESEARCH_MCP_TOOLS: readonly string[] = [
  'get_context',
  'get_edges',
  'get_full_entity',
  'get_diagram',
  'get_work_item_type_guidance_batch',
  'unified_search',
  'search_features',
  'task_search',
  'search_design_docs',
  'search_implementation_hints',
];

/**
 * Repository analysis uses provider-native local read/search tools. Its
 * platform MCP surface stays empty because project-graph authoring and remote
 * reads are outside the evidence-acquisition boundary.
 */
const REPOSITORY_GROUNDING_MCP_TOOLS: readonly string[] = [];

export const REPOSITORY_PLACEMENT_MCP_TOOLS: readonly string[] = ['unified_search', 'get_context'];

export const PROJECT_ASSISTANT_EDGE_MCP_TOOLS: readonly string[] = ['create_edge', 'delete_edge'];

const AUTHORING_GUIDANCE_MCP_TOOL = 'get_authoring_guidance';
export const PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL = 'get_tool_guidance';
export const PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL = 'create_work_item';
export const PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL = 'edit_work_item';

const AUTHORING_GUIDANCE_GATED_MUTATION_MCP_TOOLS = new Set([
  ...PROJECT_ASSISTANT_EDGE_MCP_TOOLS,
  PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
]);

/**
 * The session-monitor agent's entire platform surface. It reads exactly one
 * report and emits one JSON decision; the handler's `onComplete` is the only
 * thing that writes anywhere. No other tool may be reachable — the
 * no-side-channel guarantee is structural, not prompt-enforced, matching the
 * structurally-absent `triggersAgent` on its posted message.
 */
export const SESSION_MONITOR_MCP_TOOLS: readonly string[] = ['get_report_body'];

/**
 * Task Monitor supervision receives one preloaded, boundary-validated
 * canonical evidence package. No platform tool is exposed: a resumed provider
 * session may retain reasoning continuity, but cannot substitute ad hoc reads
 * for the package loaded immediately before this decision.
 */
export const TASK_MONITOR_MCP_TOOLS: readonly string[] = [];

/**
 * Project report evidence comes from the host's request-bound reader plus
 * authorized, read-only graph reads that let the agent learn what each subject
 * delivered. No graph-authoring tool is reachable; canonical report submission
 * is the separate local `create_report` tool.
 */
export const PROJECT_REPORT_MCP_TOOLS: readonly string[] = [
  'get_report_schema',
  'get_full_entity',
  'get_context',
  'get_edges',
  'unified_search',
  'task_search',
  'search_features',
  'list_reports_by_entity',
  'get_report_body',
];

/**
 * A report section child reads the same graph as its parent but never sees the
 * report schema: it returns a section to the parent and cannot submit.
 */
export const PROJECT_REPORT_SECTION_MCP_TOOLS: readonly string[] = PROJECT_REPORT_MCP_TOOLS.filter(
  (tool) => tool !== 'get_report_schema',
);

/**
 * Hint tools, offered to the sessions in `HINT_USE_CASES`. The API omits them entirely when its
 * deployment-wide hints switch is off.
 */
export const HINT_WRITE_MCP_TOOLS: readonly string[] = ['create_hint', 'add_hint_connection'];
export const HINT_READ_MCP_TOOLS: readonly string[] = ['get_hints_for_items'];

/**
 * Sessions that do open-ended work get hints. Curated surfaces (reports,
 * monitors, plan shaping, evidence gathering) stay exactly as designed.
 */
const HINT_USE_CASES: ReadonlySet<McpToolUseCase | undefined> = new Set([
  undefined,
  'coding',
  'general',
  'planning',
  'research',
]);

export type HintPromptAccess = 'write' | 'read' | 'none';

/** Which hint guidance a session's prompt carries: none unless hints are on and the session has the tools. */
export const resolveHintPromptAccess = (
  hintsEnabled: boolean,
  /** Platform tool names, short or `mcp__heyhey-platform__`-qualified. */
  allowedToolNames: readonly string[],
): HintPromptAccess => {
  if (!hintsEnabled) return 'none';
  const allows = (tool: string): boolean =>
    allowedToolNames.includes(tool) || allowedToolNames.includes(qualifyMcpToolName(tool));
  if (allows('create_hint')) return 'write';
  if (allows('get_hints_for_items')) return 'read';
  return 'none';
};

export const qualifyMcpToolName = (toolName: string): string =>
  `mcp__${MCP_SERVER_NAME}__${toolName}`;

export const resolveMcpToolNames = (
  options: {
    useCase?: McpToolUseCase;
    additionalTools?: readonly string[];
  } = {},
): string[] => {
  const additionalTools = options.additionalTools ?? [];
  const baseTools =
    options.useCase === 'general'
      ? GENERAL_MCP_TOOLS
      : options.useCase === 'planning'
        ? PLANNING_MCP_TOOLS
        : options.useCase === 'plan_shaping'
          ? PLAN_SHAPING_MCP_TOOLS
          : options.useCase === 'project_report' || options.useCase === 'release_notes'
            ? PROJECT_REPORT_MCP_TOOLS
            : options.useCase === 'research'
              ? RESEARCH_MCP_TOOLS
              : options.useCase === 'repository_grounding'
                ? REPOSITORY_GROUNDING_MCP_TOOLS
                : options.useCase === 'work_tracker_import'
                  ? []
                  : options.useCase === 'repository_placement'
                    ? REPOSITORY_PLACEMENT_MCP_TOOLS
                    : options.useCase === 'session_monitor'
                      ? SESSION_MONITOR_MCP_TOOLS
                      : options.useCase === 'task_monitor'
                        ? TASK_MONITOR_MCP_TOOLS
                        : CODING_MCP_TOOLS;
  const hintTools = HINT_USE_CASES.has(options.useCase)
    ? [...HINT_WRITE_MCP_TOOLS, ...HINT_READ_MCP_TOOLS]
    : [];
  const needsAuthoringGuidance = additionalTools.some((tool) =>
    AUTHORING_GUIDANCE_GATED_MUTATION_MCP_TOOLS.has(tool),
  );
  return Array.from(
    new Set([
      ...baseTools,
      ...hintTools,
      ...(needsAuthoringGuidance ? [AUTHORING_GUIDANCE_MCP_TOOL] : []),
      ...additionalTools,
    ]),
  );
};

export const buildMcpHeaders = (
  token: string,
  context: McpSessionContext,
): Record<string, string> => {
  const organizationId = extractOrganizationIdFromToken(token);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (organizationId) {
    headers['X-Organization-ID'] = organizationId;
  }
  if (context.projectId) {
    headers['X-Project-ID'] = context.projectId;
  }
  if (context.conversationId) {
    headers['X-Conversation-ID'] = context.conversationId;
  }
  if (context.planId) {
    headers['X-Plan-ID'] = context.planId;
  }
  if (context.designDocId) {
    headers['X-Design-Doc-ID'] = context.designDocId;
  }
  if (context.serviceId) {
    headers['X-Service-ID'] = context.serviceId;
  }
  if (context.serviceIds && context.serviceIds.length > 0) {
    headers['X-Service-IDs'] = context.serviceIds.join(',');
  }
  if (context.agentSessionId) {
    headers['X-Agent-Session-ID'] = context.agentSessionId;
  }

  return headers;
};

/**
 * Build the platform MCP endpoint URL from a base host.
 *
 * The MCP transport is mounted at the server root (`/mcp`), OUTSIDE the REST
 * `/api/v1` prefix. This is the single source of truth for that path so every
 * client that talks to the MCP server — the SDK MCP client below and the
 * `create_report` proxy — derives an identical URL and cannot drift. Pass the
 * bare host (e.g. `http://localhost:3000`), never the REST-normalized base.
 */
export const buildMcpEndpointUrl = (apiBaseUrl: string): string =>
  `${apiBaseUrl.replace(/\/$/u, '')}/mcp`;

/**
 * Resolve the live MCP endpoint URL from the environment. Defaults to the
 * production host when `HEYHEY_API_URL` is unset (e.g. when running `--local`
 * the launcher sets it to `http://localhost:3000`).
 */
export const resolveMcpEndpointUrl = (): string =>
  buildMcpEndpointUrl(process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev');

export const buildMcpServerConfig = async (
  oauthClient: OAuthClient,
  context: McpSessionContext,
  options: {
    useCase?: McpToolUseCase;
    additionalTools?: readonly string[];
  } = {},
): Promise<McpServerConfigResult> => {
  const tokenResult = await oauthClient.getAccessToken();
  if (!tokenResult.success) {
    throw new Error(`Cannot configure MCP server: ${tokenResult.error}`);
  }

  const token = tokenResult.data;
  const headers = buildMcpHeaders(token, context);
  const mergedTools = resolveMcpToolNames(options);

  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http' as const,
        url: resolveMcpEndpointUrl(),
        headers,
      },
    },
    allowedTools: Array.from(new Set(mergedTools.map(qualifyMcpToolName))),
  };
};
