import { CODEX_MCP_ONLY_FEATURE_OVERRIDES } from './mcp-only-features';
import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { withoutCodexInputEcho } from './codex-input-echo';
import {
  buildBrowserToolsMcpConfig,
  BROWSER_ALLOWED_TOOLS,
  BROWSER_MCP_SERVER_NAME,
} from '../../browser-tools/mcp-config';
import { applyCodexSessionReviewerPolicy } from './codex-session-policy';
import { ProviderUsageCapture } from '../../../provider-usage/provider-usage-capture';
import { ProviderUsageStore } from '../../../provider-usage/provider-usage-store';
import crypto from 'node:crypto';
import { CodexExecutionCaptureHooks } from './execution-capture-hooks';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import {
  CodexCompactTimeoutError,
  CodexNoContextSnapshotError,
  CodexSdkClient,
  type CodexSdkEvent,
  type CodexSdkSessionConfig,
  type CodexSdkSkillTurnInput,
  type CodexSdkServerRequest,
} from '../../../agent-runtime/index';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import {
  nativeProviderSessionId,
  recordPermissionDecisionSubmitted,
  workspaceResolutionError,
} from '../runner-common';
import { isRecord, readTrimmedString as readTrimmed } from '../provider-event-normalization-core';
import type { Run } from '../../../run/run';
import { LockTimeoutError, type AgenticProviderStartDiagnostics } from '../../../session/index';
import { NOOP_LOGGER, type ServerLogger } from '../../../server/logger';
import { requestContext } from '../../../server/request-context';
import { redactAgentEventForLog, loadAgentEventLogRedactionConfig } from '../agent-event-redaction';
import {
  loadProviderEventNormalizationConfig,
  type NormalizedProviderFacts,
} from '../provider-event-normalization';
import { mapCodexEvent } from './codex-event-mapper';
import { classifyCodexEventRoute } from './codex-root-turn-event-gate';
import { resolveCodexPermissionPlan, type CodexPermissionPlan } from './codex-permissions';
import {
  AgentSessionRunnerError,
  type AgentRunResult,
  type AgentSessionRunner,
  type ListSkillsArgs,
  type PermissionDecisionDispatchArgs,
  type PermissionDecisionDispatchResult,
  type PromptOnceArgs,
  type ResumeArgs,
  type RunPromptArgs,
} from '../session-runner';
import { resolveRunWorkspace } from '../../run-scope';
import { buildPlatformSystemPrompt } from '../../prompts/common';
import { readSessionStartContext } from '../../prompts/session-start-context';
import type { OAuthClient } from '../../../auth/index';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import type { ProviderPhase } from '../../../run/types';
import type { SubmissionToolRegistry } from '../../submission-tools/registry';
import { buildSubmissionToolsMcpConfig } from '../../submission-tools/mcp-config';
import type { LocalAgentEndpoint } from '../../../server/local-base-url';
import { buildMcpServerConfig, resolveHintPromptAccess } from '../../mcp-server-config';
import { buildPlatformMcpProxyMcpConfig } from '../../platform-mcp-proxy/mcp-config';
import {
  composeFreshPlatformPromptDelivery,
  PLATFORM_PROMPT_DELIVERY_MODE,
  PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE,
  type PlatformPromptDeliveryMode,
  resolveProviderPlatformPromptDeliveryMode,
} from '../platform-prompt-delivery';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../../shared/logging/daily-session';
import { type CodexSkillCatalogContext, CodexSkillCatalog } from './codex-skill-catalog';
import type { AgentSkillCatalog, AgentSkillSelection } from '../agent-skills';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';

type CodexConfigValue =
  | string
  | number
  | boolean
  | null
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

type CodexConfigOverrides = { [key: string]: CodexConfigValue };

type CodexServiceTier = 'priority' | 'default';
// The linked ui-common client does not yet declare or forward serviceTier.
// Keep the CLI-owned mapping closed and structural so the runner can preserve
// launch intent now; end-to-end thread request delivery lands with that client.
type CodexSdkSessionConfigWithServiceTier = CodexSdkSessionConfig & {
  serviceTier?: CodexServiceTier;
};

type PlatformMcpServerEntry = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
};

const CODEX_MCP_ELICITATION_METHOD = 'mcpServer/elicitation/request';
const CODEX_MCP_APPROVAL_KIND_KEY = 'codex_approval_kind';
const CODEX_MCP_APPROVAL_KIND_TOOL_CALL = 'mcp_tool_call';
const CODEX_MCP_TOOL_NAME_KEY = 'tool_name';
const CODEX_MCP_PERSIST_KEY = 'persist';
const CODEX_MCP_PERSIST_ALWAYS = 'always';
const HEYHEY_MCP_SERVER_NAMES = new Set([
  'heyhey-platform',
  'heyhey-submission-tools',
  BROWSER_MCP_SERVER_NAME,
]);
const CONTEXT_USAGE_RESUME_TIMEOUT_MS = 60_000;

export const resolveCodexPlatformPromptDeliveryMode = (
  config: RunPromptArgs['session']['config'],
  replaceProviderSystemPrompt = false,
): PlatformPromptDeliveryMode =>
  replaceProviderSystemPrompt ||
  (config?.type === 'ENTITY_CONVERSATION' && config.disableCodexSystemPrompt === true)
    ? PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS
    : resolveProviderPlatformPromptDeliveryMode('codex');

const toCodexPlatformMcpConfig = (entry: PlatformMcpServerEntry): CodexConfigOverrides | null => {
  if (!entry.url) return null;
  return {
    mcp_servers: {
      'heyhey-platform': {
        url: entry.url,
        ...(entry.headers ? { http_headers: entry.headers } : {}),
      },
    },
  };
};

const mergeCodexMcpConfigs = (
  configs: ReadonlyArray<CodexConfigOverrides | null>,
): CodexConfigOverrides | undefined => {
  const mcpServers: { [key: string]: CodexConfigValue } = {};
  for (const config of configs) {
    const value = config?.['mcp_servers'];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    Object.assign(mcpServers, value);
  }

  return Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : undefined;
};

const applyCodexWorkspaceContainment = (
  config: CodexConfigOverrides | undefined,
  workspaceWriteConfig: NonNullable<CodexPermissionPlan['workspaceWriteConfig']>,
): CodexConfigOverrides => ({
  ...(config ?? {}),
  ...workspaceWriteConfig,
});

export interface CodexAgentSessionRunnerDependencies {
  executionRecorder?: ExecutionRecorder;
  runStore: RunStore;
  repoStore: RepoMappingStore;
  localAgentEndpoint: LocalAgentEndpoint;
  submissionToolRegistry: SubmissionToolRegistry;
  oauthClient?: OAuthClient | undefined;
  agentOutputOwner?: Run;
  logger?: ServerLogger;
}

interface PendingCodexPermissionRequest {
  requestId: string;
  rawRequestId: string | number;
  sessionId: string;
  createdAt: string;
  kind: 'approval' | 'mcp_elicitation';
  permissionType: CodexAutoApprovablePermissionType | null;
  mcpServerName: string | null;
}

type CodexAutoApprovablePermissionType = 'command_execution' | 'file_change';

const isCodexAutoApprovablePermissionType = (
  value: string,
): value is CodexAutoApprovablePermissionType =>
  value === 'command_execution' || value === 'file_change';

const readAutoApprovablePermissionTypeFromMethod = (
  method: string,
): CodexAutoApprovablePermissionType | null => {
  switch (method) {
    case 'execCommandApproval':
    case 'item/commandExecution/requestApproval':
    case 'item/permissions/requestApproval':
      return 'command_execution';
    case 'applyPatchApproval':
    case 'item/fileChange/requestApproval':
      return 'file_change';
    default:
      return null;
  }
};

interface ActiveMcpSurfaceContext {
  activeToolSetSource: string;
  mountedHeyHeyServerNames: string[];
  mountedSubmissionToolNames: string[];
  activeSubmissionToolNames: string[];
}

interface HeyHeyMcpToolSurfaceMismatch {
  serverName: string | null;
  toolName: string | null;
  qualifiedToolName: string | null;
  classification: 'tool_surface_mismatch';
  availability: 'server_not_mounted' | 'mounted_but_inactive' | 'absent_from_active_tool_set';
  agentFacingMessage: string;
}

const DEFAULT_RESUME_PROMPT = 'Continue from the latest state and complete the task.';
const PROVIDER_THREAD_NOT_FOUND_PATTERN = /session not found for thread_id:/i;
const SESSION_WRITE_LOCK_RETRY_DELAYS_MS = [120, 300, 750] as const;

export const resolveCodexRepositoryResearchPosture = (input: {
  delegation: 'allowed' | 'disabled';
  model: string | null;
  effort: string | null;
}) => ({
  filesystemPosture: 'read-only' as const,
  delegationRequested: input.delegation === 'allowed',
  delegationAvailability: 'runtime-configured' as const,
  childModel: input.model,
  childEffort: input.effort,
});

const isCodexAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'Aborted' || error.message === 'Aborted';
};

export const CAPACITY_RETRY_MESSAGE =
  'The provider is temporarily at capacity for the selected model. Please retry.';

const sleep = async (durationMs: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const readCodexProviderFailureMessage = (rawEvent: Record<string, unknown>): string | null => {
  const turn = isRecord(rawEvent['turn']) ? rawEvent['turn'] : null;
  const error = isRecord(rawEvent['error'])
    ? rawEvent['error']
    : turn && isRecord(turn['error'])
      ? turn['error']
      : null;
  const message = error ? readTrimmed(error['message']) : null;
  if (!message) return null;

  try {
    const parsed: unknown = JSON.parse(message);
    if (!isRecord(parsed)) return message;
    const nestedError = isRecord(parsed['error']) ? parsed['error'] : null;
    return (nestedError ? readTrimmed(nestedError['message']) : null) ?? message;
  } catch {
    return message;
  }
};

const isCodexModelCapacityFailure = (message: string): boolean =>
  /\b(selected\s+)?model\b[\s\S]{0,80}\bat capacity\b|\bat capacity\b[\s\S]{0,80}\bmodel\b/i.test(
    message,
  );

const sanitizeCodexCapacityFailureEvent = (
  rawEvent: Record<string, unknown>,
): Record<string, unknown> => {
  const error = isRecord(rawEvent['error']) ? rawEvent['error'] : null;
  const turn = isRecord(rawEvent['turn']) ? rawEvent['turn'] : null;
  const turnError = turn && isRecord(turn['error']) ? turn['error'] : null;

  return {
    ...rawEvent,
    ...(error ? { error: { ...error, message: CAPACITY_RETRY_MESSAGE } } : {}),
    ...(turn && turnError
      ? { turn: { ...turn, error: { ...turnError, message: CAPACITY_RETRY_MESSAGE } } }
      : {}),
  };
};

const parseMcpElicitationMessage = (
  message: string | null,
): { serverName: string | null; toolName: string | null } => {
  if (!message) {
    return { serverName: null, toolName: null };
  }
  const match = /^Allow the (.+?) MCP server to run tool ["'](.+?)["']\??$/u.exec(message.trim());
  return {
    serverName: match?.[1] ?? null,
    toolName: match?.[2] ?? null,
  };
};

const readMcpElicitationTool = (
  request: CodexSdkServerRequest,
): {
  serverName: string | null;
  toolName: string | null;
  qualifiedToolName: string | null;
  approvalKind: string | null;
} => {
  const params = isRecord(request.params) ? request.params : {};
  const requestBody = isRecord(params['request']) ? params['request'] : params;
  const meta = isRecord(requestBody['_meta'])
    ? requestBody['_meta']
    : isRecord(requestBody['meta'])
      ? requestBody['meta']
      : isRecord(params['_meta'])
        ? params['_meta']
        : isRecord(params['meta'])
          ? params['meta']
          : {};
  const message = readTrimmed(requestBody['message']) ?? readTrimmed(params['message']);
  const parsedMessage = parseMcpElicitationMessage(message);
  const serverName =
    readTrimmed(params['serverName']) ??
    readTrimmed(params['server_name']) ??
    parsedMessage.serverName;
  const toolName = readTrimmed(meta[CODEX_MCP_TOOL_NAME_KEY]) ?? parsedMessage.toolName;
  const approvalKind = readTrimmed(meta[CODEX_MCP_APPROVAL_KIND_KEY]);
  const qualifiedToolName = serverName && toolName ? `mcp__${serverName}__${toolName}` : toolName;

  return {
    serverName,
    toolName,
    qualifiedToolName,
    approvalKind,
  };
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isLockTimeoutError = (error: unknown): boolean => {
  if (error instanceof LockTimeoutError) {
    return true;
  }
  return error instanceof Error && /timed out waiting for lock/i.test(error.message);
};

export class CodexAgentSessionRunner implements AgentSessionRunner {
  private readonly client = new CodexSdkClient();
  private readonly executionCapture: CodexExecutionCaptureHooks | null;
  private readonly skillCatalog = new CodexSkillCatalog();
  // Populated by this.client.onServerRequest when a ServerRequest in the permission
  // family (execCommandApproval, applyPatchApproval, item/*/requestApproval)
  // arrives. this.submitPermissionDecision drains entries by canonical request id
  // and sends the matching JSON-RPC ClientResponse via this.client.submitClientResponse.
  private readonly pendingPermissionRequests = new Map<string, PendingCodexPermissionRequest>();
  private readonly alwaysApprovedPermissionTypes = new Set<CodexAutoApprovablePermissionType>();
  private activeAllowedMcpToolNames = new Set<string>();
  private activeMcpSurfaceContext: ActiveMcpSurfaceContext = {
    activeToolSetSource: 'not_initialized',
    mountedHeyHeyServerNames: [],
    mountedSubmissionToolNames: [],
    activeSubmissionToolNames: [],
  };
  private readonly redactionConfig = loadAgentEventLogRedactionConfig();
  private readonly normalizationConfig = loadProviderEventNormalizationConfig();
  private readonly attachmentContentReader = new RunAttachmentContentReader();
  private readonly runStore: RunStore;
  private readonly repoStore: RepoMappingStore;
  private readonly localAgentEndpoint: LocalAgentEndpoint;
  private readonly submissionToolRegistry: SubmissionToolRegistry;
  private readonly oauthClient: OAuthClient | undefined;
  private readonly agentOutputOwner: Run | undefined;
  private readonly logger: ServerLogger;
  private readonly providerUsageCapture: ProviderUsageCapture;

  public constructor(dependencies: CodexAgentSessionRunnerDependencies) {
    this.runStore = dependencies.runStore;
    this.repoStore = dependencies.repoStore;
    this.localAgentEndpoint = dependencies.localAgentEndpoint;
    this.submissionToolRegistry = dependencies.submissionToolRegistry;
    this.oauthClient = dependencies.oauthClient;
    this.agentOutputOwner = dependencies.agentOutputOwner;
    this.logger = dependencies.logger ?? NOOP_LOGGER;
    this.providerUsageCapture = new ProviderUsageCapture(
      new ProviderUsageStore(undefined, this.logger),
      this.logger,
    );
    this.executionCapture = dependencies.executionRecorder
      ? new CodexExecutionCaptureHooks(dependencies.executionRecorder, this.logger)
      : null;
  }

  public async listSkills({
    session,
    workspace: suppliedWorkspace,
  }: ListSkillsArgs): Promise<AgentSkillCatalog> {
    if (session.services.length === 0) {
      return this.skillCatalog.list({
        policy: 'non_repository',
        authorityId: session.agentic_session_id,
      });
    }
    const workspace = suppliedWorkspace
      ? suppliedWorkspace
      : await resolveRunWorkspace({ session, repoStore: this.repoStore, logger: this.logger });
    if (!workspace.ok) {
      requestContext.log(this.logger, 'warn', 'local.runner.codex.skill_catalog.workspace_failed', {
        sessionId: session.agentic_session_id,
        launchServiceId: session.launchServiceId,
        serviceCount: session.services?.length ?? 0,
        resolutionCode: workspace.code,
      });
      throw workspaceResolutionError(workspace);
    }

    requestContext.log(this.logger, 'debug', 'local.runner.codex.skill_catalog.started', {
      sessionId: session.agentic_session_id,
      launchServiceId: session.launchServiceId,
      serviceCount: session.services?.length ?? 0,
    });
    const catalog = await this.skillCatalog.list(
      session.services.length > 0
        ? {
            policy: 'service_workspace',
            cwd: workspace.cwd,
            authorityId: session.agentic_session_id,
          }
        : { policy: 'non_repository', authorityId: session.agentic_session_id },
    );
    requestContext.log(this.logger, 'info', 'local.runner.codex.skill_catalog.completed', {
      sessionId: session.agentic_session_id,
      skillCount: catalog.skills.length,
      discoveryErrorCount: catalog.errors.length,
    });
    return catalog;
  }

  private async resolveSkillSelection(
    context: CodexSkillCatalogContext,
    selection: AgentSkillSelection,
  ): Promise<CodexSdkSkillTurnInput> {
    requestContext.log(this.logger, 'debug', 'local.runner.codex.skill_selection.resolve_started', {
      provider: selection.provider,
      skillName: selection.name,
      catalogScope: selection.catalogScope,
    });
    try {
      const resolved = await this.skillCatalog.resolve(context, selection);
      requestContext.log(
        this.logger,
        'info',
        'local.runner.codex.skill_selection.resolve_completed',
        {
          provider: selection.provider,
          skillName: selection.name,
          catalogScope: selection.catalogScope,
        },
      );
      return resolved;
    } catch (error) {
      requestContext.log(this.logger, 'warn', 'local.runner.codex.skill_selection.resolve_failed', {
        provider: selection.provider,
        skillName: selection.name,
        catalogScope: selection.catalogScope,
        error: toErrorMessage(error),
      });
      throw error;
    }
  }

  private readonly emitRawEvent = (input: {
    source: 'provider' | 'local';
    eventType: string;
    timestamp: string;
    sessionId: string | null;
    agentId: string | null;
    payload: Record<string, unknown>;
    providerFacts?: NormalizedProviderFacts;
  }): void => {
    this.agentOutputOwner?.onAgentOutput({
      event: {
        source: input.source,
        eventType: input.eventType,
        timestamp: input.timestamp,
        sessionId: input.sessionId,
        agentId: input.agentId,
        payload: input.payload,
        ...(input.providerFacts ? { providerFacts: input.providerFacts } : {}),
      },
    });
  };

  private readonly emitLocalStatus = (text: string): void => {
    const timestamp = new Date().toISOString();
    this.emitRawEvent({
      source: 'local',
      eventType: 'status_update',
      timestamp,
      sessionId: null,
      agentId: null,
      payload: { text },
    });
  };

  private readonly emitProcessingStatus = (
    input: {
      kind: 'loading.update' | 'tool.progress' | 'run.status';
      loadingText?: string;
      status?: string;
      phase?: ProviderPhase;
    },
    sessionId: string | null,
    agentId: string | null,
  ): void => {
    this.emitRawEvent({
      source: 'local',
      eventType: 'processing_status',
      timestamp: new Date().toISOString(),
      sessionId,
      agentId,
      payload: {
        kind: input.kind,
        loadingText: input.loadingText ?? null,
        toolName: null,
        toolPhase: null,
        status: input.status ?? null,
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
      },
    });
  };

  private readonly clearPendingPermissionRequests = (reason: string): void => {
    if (this.pendingPermissionRequests.size === 0) {
      return;
    }
    requestContext.log(this.logger, 'debug', 'local.runner.codex.permission_requests.cleared', {
      pendingRequestIds: Array.from(this.pendingPermissionRequests.keys()),
      reason,
    });
    this.pendingPermissionRequests.clear();
  };

  private readonly isPreApprovedMcpElicitation = (request: CodexSdkServerRequest): boolean => {
    if (request.method !== CODEX_MCP_ELICITATION_METHOD) {
      return false;
    }
    const { approvalKind, qualifiedToolName, serverName } = readMcpElicitationTool(request);
    return (
      qualifiedToolName !== null &&
      (approvalKind === CODEX_MCP_APPROVAL_KIND_TOOL_CALL || approvalKind === null) &&
      this.activeAllowedMcpToolNames.has(qualifiedToolName)
    );
  };

  private readonly resolveHeyHeyMcpToolSurfaceMismatch = (
    request: CodexSdkServerRequest,
  ): HeyHeyMcpToolSurfaceMismatch | null => {
    if (request.method !== CODEX_MCP_ELICITATION_METHOD) {
      return null;
    }
    const tool = readMcpElicitationTool(request);
    if (tool.serverName === null || !HEYHEY_MCP_SERVER_NAMES.has(tool.serverName)) {
      return null;
    }
    if (
      tool.qualifiedToolName !== null &&
      this.activeAllowedMcpToolNames.has(tool.qualifiedToolName)
    ) {
      return null;
    }

    const serverMounted = this.activeMcpSurfaceContext.mountedHeyHeyServerNames.includes(
      tool.serverName,
    );
    const availability =
      tool.serverName === 'heyhey-submission-tools' &&
      tool.toolName !== null &&
      this.activeMcpSurfaceContext.mountedSubmissionToolNames.includes(tool.toolName)
        ? this.activeMcpSurfaceContext.activeSubmissionToolNames.includes(tool.toolName)
          ? 'absent_from_active_tool_set'
          : 'mounted_but_inactive'
        : serverMounted
          ? 'absent_from_active_tool_set'
          : 'server_not_mounted';
    const displayName = tool.qualifiedToolName ?? tool.toolName ?? 'the requested Hey Hey MCP tool';
    return {
      ...tool,
      classification: 'tool_surface_mismatch',
      availability,
      agentFacingMessage:
        `${displayName} is not active for the current turn. ` +
        'This is a Hey Hey tool-surface mismatch, not a user rejection.',
    };
  };

  private readonly summarizeActiveMcpPolicy = (
    requestedQualifiedToolName: string | null,
  ): {
    activeAllowedToolCount: number;
    activeHeyHeyPlatformAllowedTools: string[];
    activeHeyHeySubmissionAllowedTools: string[];
    requestedToolAllowed: boolean;
    activeToolSetSource: string;
    mountedHeyHeyServerNames: string[];
    mountedSubmissionToolNames: string[];
    activeSubmissionToolNames: string[];
  } => {
    const activeAllowedTools = Array.from(this.activeAllowedMcpToolNames).sort();
    return {
      activeAllowedToolCount: activeAllowedTools.length,
      activeHeyHeyPlatformAllowedTools: activeAllowedTools.filter((toolName) =>
        toolName.startsWith('mcp__heyhey-platform__'),
      ),
      activeHeyHeySubmissionAllowedTools: activeAllowedTools.filter((toolName) =>
        toolName.startsWith('mcp__heyhey-submission-tools__'),
      ),
      requestedToolAllowed:
        requestedQualifiedToolName !== null &&
        this.activeAllowedMcpToolNames.has(requestedQualifiedToolName),
      activeToolSetSource: this.activeMcpSurfaceContext.activeToolSetSource,
      mountedHeyHeyServerNames: this.activeMcpSurfaceContext.mountedHeyHeyServerNames,
      mountedSubmissionToolNames: this.activeMcpSurfaceContext.mountedSubmissionToolNames,
      activeSubmissionToolNames: this.activeMcpSurfaceContext.activeSubmissionToolNames,
    };
  };

  private readonly submitMcpElicitationResponse = (
    rawRequestId: string | number,
    response: Record<string, unknown>,
  ): void => {
    this.client.submitClientResponse(rawRequestId, response);
  };

  public async promptOnce(args: PromptOnceArgs): Promise<string> {
    const { session, prompt, model, reasoningEffort, signal } = args;
    const selectedModel = model ?? session.model ?? null;
    const selectedReasoningEffort = reasoningEffort ?? session.reasoningEffort ?? null;
    const isolatedDirectory = await IsolatedProviderWorkingDirectory.create();
    // A transient client: the Run's own client, thread and event log are never touched.
    const client = new CodexSdkClient();
    let answer: string | null = null;
    client.onEvent((event) => {
      if (event.method !== 'item/completed') return;
      const item = event.params?.['item'];
      if (!isRecord(item) || item['type'] !== 'agentMessage') return;
      const text = item['text'];
      if (typeof text === 'string' && text.length > 0) answer = text;
    });
    try {
      await client.startSession(
        {
          prompt,
          cwd: isolatedDirectory.path,
          sandbox: 'read-only',
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedReasoningEffort ? { effort: selectedReasoningEffort } : {}),
        },
        { signal },
      );
      if (answer === null) {
        throw new AgentSessionRunnerError('RUN_FAILED', 'Codex returned no text for the prompt.');
      }
      return answer;
    } finally {
      await client.disconnect();
      await isolatedDirectory.cleanup().catch((error: unknown) => {
        requestContext.log(this.logger, 'warn', 'local.runner.codex.isolated_cwd.cleanup_failed', {
          sessionId: session.agentic_session_id,
          error,
        });
      });
    }
  }

  public async runPrompt(args: RunPromptArgs): Promise<AgentRunResult> {
    if (args.mcpToolUseCase !== 'project_report') {
      return this.runPromptInDirectory(args);
    }

    const isolatedDirectory = await IsolatedProviderWorkingDirectory.create();
    try {
      return await this.runPromptInDirectory(args, isolatedDirectory.path);
    } finally {
      await isolatedDirectory.cleanup().catch((error: unknown) => {
        requestContext.log(this.logger, 'warn', 'local.runner.codex.isolated_cwd.cleanup_failed', {
          sessionId: args.session.agentic_session_id,
          error,
        });
      });
    }
  }

  private async runPromptInDirectory(
    {
      reportingRepair,
      session,
      prompt,
      attachmentRunId,
      attachments = [],
      epistemicCalibration,
      signal,
      startingMessage,
      readOnlyFilesystem,
      repositoryResearch,
      skipPermissions,
      model,
      reasoningEffort,
      mcpToolUseCase,
      additionalAllowedTools,
      browserMcpMount,
      platformMcpProxyMount,
      workspace: suppliedWorkspace,
      skillSelection,
      startupSegments,
      replaceProviderSystemPrompt,
    }: RunPromptArgs,
    isolatedWorkingDirectory?: string,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const runId = `codex_${crypto.randomUUID()}`;
    // The native CodexSdkClient exposes a single session id (the codex
    // `thread_id` captured from `thread/started`), persisted as
    // `provider_session_id`. Mirror the Claude runner: a `pending_`-prefixed
    // value is a platform-wide Run seed, not a real native id, so it means "no
    // session yet" and selects a fresh start.
    const rawPersistedProviderSessionId = readTrimmed(session.provider_session_id);
    const resolvedProviderSessionId = nativeProviderSessionId(rawPersistedProviderSessionId);
    const mode: 'prompt' | 'resume' = resolvedProviderSessionId ? 'resume' : 'prompt';
    const clientSessionIdAtStart = this.client.getSessionId();
    this.clearPendingPermissionRequests(
      `Codex permission request was canceled because run ${runId} started a new turn.`,
    );
    requestContext.log(this.logger, 'debug', 'local.runner.codex.run_prompt.started', {
      runId,
      sessionId: session.agentic_session_id,
      launchServiceId: session.launchServiceId,
      serviceCount: session.services?.length ?? 0,
      mode,
      hasExistingSession: Boolean(resolvedProviderSessionId),
      persistedProviderSessionId: session.provider_session_id,
      resolvedProviderSessionId,
      clientSessionIdAtStart,
    });
    const withSessionWriteLockRetry = async <T>(
      operationName: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      let attempt = 0;
      while (true) {
        try {
          return await operation();
        } catch (error) {
          if (!isLockTimeoutError(error) || attempt >= SESSION_WRITE_LOCK_RETRY_DELAYS_MS.length) {
            throw error;
          }

          const retryDelayMs = SESSION_WRITE_LOCK_RETRY_DELAYS_MS[attempt] ?? 0;
          requestContext.log(this.logger, 'warn', 'local.runner.codex.session_write.lock_retry', {
            runId,
            sessionId: session.agentic_session_id,
            operation: operationName,
            attempt: attempt + 1,
            retryDelayMs,
            error: toErrorMessage(error),
          });
          attempt += 1;
          await sleep(retryDelayMs);
        }
      }
    };
    let eagerProviderSessionId: string | null = null;
    let eagerProviderIdentityPersist: Promise<void> | null = null;

    const persistProviderIdentityFromThreadStarted = (providerSessionId: string): void => {
      if (eagerProviderSessionId === providerSessionId) {
        return;
      }
      if (
        mode === 'resume' &&
        resolvedProviderSessionId &&
        providerSessionId !== resolvedProviderSessionId
      ) {
        requestContext.log(this.logger, 'error', 'local.runner.codex.provider_identity.mismatch', {
          runId,
          sessionId: session.agentic_session_id,
          expectedProviderSessionId: resolvedProviderSessionId,
          actualProviderSessionId: providerSessionId,
          phase: 'thread_started',
        });
        return;
      }

      eagerProviderSessionId = providerSessionId;
      eagerProviderIdentityPersist = withSessionWriteLockRetry(
        'update_provider_identity_on_thread_started',
        async () =>
          this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
            providerSessionId,
            providerConversationId: null,
            providerSessionAgentId: session.provider_session_agent_id ?? null,
          }),
      )
        .then(() => {
          requestContext.log(
            this.logger,
            'debug',
            'local.runner.codex.provider_session_id.eager_write',
            {
              runId,
              sessionId: session.agentic_session_id,
              providerSessionIdWritten: providerSessionId,
              providerConversationIdWritten: null,
            },
          );
        })
        .catch((identityWriteError: unknown) => {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.codex.provider_session_id.eager_write_error',
            {
              runId,
              sessionId: session.agentic_session_id,
              providerSessionId,
              error: toErrorMessage(identityWriteError),
            },
          );
        });
    };

    const awaitEagerProviderIdentityPersist = async (): Promise<void> => {
      if (eagerProviderIdentityPersist) {
        await eagerProviderIdentityPersist;
      }
    };

    const hasService = (session.services?.length ?? 0) > 0;
    const workspace = suppliedWorkspace
      ? suppliedWorkspace
      : hasService
        ? await resolveRunWorkspace({
            session,
            repoStore: this.repoStore,
            logger: this.logger,
          })
        : null;
    if (workspace !== null && !workspace.ok) {
      requestContext.log(this.logger, 'warn', 'local.runner.codex.repo_binding_missing', {
        runId,
        sessionId: session.agentic_session_id,
        launchServiceId: session.launchServiceId,
        serviceCount: session.services?.length ?? 0,
        resolutionCode: workspace.code,
      });
      throw workspaceResolutionError(workspace);
    }
    const resolvedRunCwd =
      isolatedWorkingDirectory ?? (workspace?.ok ? workspace.cwd : process.cwd());
    const repositoryPathForRunStarted = workspace?.ok
      ? workspace.repositoryPathForRunStarted
      : resolvedRunCwd;
    const codexPermissionPlan = await resolveCodexPermissionPlan({
      cwd: resolvedRunCwd,
      ...(workspace?.ok
        ? {
            allowedRepositoryRoots: workspace.allowedRepositoryRoots,
            enforceWorkspaceContainment: true,
          }
        : {}),
      ...(session.inert || reportingRepair || readOnlyFilesystem
        ? { readOnlyFilesystem: true }
        : {}),
    });
    const sandboxMode = codexPermissionPlan.sandboxMode;
    const runCwd = codexPermissionPlan.cwd;
    const resolvedSkill: CodexSdkSkillTurnInput | null = skillSelection
      ? await this.resolveSkillSelection(
          session.services.length > 0
            ? { policy: 'service_workspace', cwd: runCwd, authorityId: session.agentic_session_id }
            : { policy: 'non_repository', authorityId: session.agentic_session_id },
          skillSelection,
        )
      : null;
    const extraWritableDirs = codexPermissionPlan.extraWritableDirs;
    const allowedRepositoryRoots = codexPermissionPlan.allowedRepositoryRoots;
    const selectedModel = model ?? session.model ?? null;
    const selectedReasoningEffort = reasoningEffort ?? session.reasoningEffort ?? null;
    if (repositoryResearch) {
      const researchPosture = resolveCodexRepositoryResearchPosture({
        delegation: repositoryResearch.delegation,
        model: selectedModel,
        effort: selectedReasoningEffort,
      });
      requestContext.log(this.logger, 'info', 'local.runner.codex.repository_research.resolved', {
        runId,
        sessionId: session.agentic_session_id,
        cwd: runCwd,
        promptBytes: Buffer.byteLength(prompt, 'utf8'),
        sandboxMode: sandboxMode ?? 'codex-configured-default',
        ...researchPosture,
      });
    }
    const selectedServiceTier: CodexServiceTier | null =
      session.fastMode === undefined ? null : session.fastMode ? 'priority' : 'default';
    const fastModeSelection =
      session.fastMode === undefined ? 'omitted' : session.fastMode ? 'enabled' : 'disabled';
    const platformPromptDeliveryMode = resolveCodexPlatformPromptDeliveryMode(
      session.config,
      replaceProviderSystemPrompt,
    );
    requestContext.log(this.logger, 'debug', 'local.runner.codex.fast_mode.resolved', {
      runId,
      sessionId: session.agentic_session_id,
      mode,
      fastModeSelection,
      platformPromptDeliveryMode,
      serviceTierApplied: selectedServiceTier !== null,
    });
    const providerStartDiagnostics: AgenticProviderStartDiagnostics = {
      provider: 'codex',
      action: mode === 'prompt' ? 'startSession' : 'resumeSession',
      cwd: runCwd,
      sandboxMode: sandboxMode ?? 'codex-configured-default',
      serviceCount: session.services?.length ?? 0,
      launchServiceId: session.launchServiceId ?? null,
      allowedRepositoryRoots,
      extraWritableDirCount: extraWritableDirs.length,
      extraWritableDirs,
      model: selectedModel,
      effort: selectedReasoningEffort,
      fastModeSelection,
    };

    if (!suppliedWorkspace && workspace?.ok && workspace.worktree) {
      await this.runStore.updateRunWorktreeState(session.agentic_session_id, workspace.worktree);
    }

    await withSessionWriteLockRetry('set_status_running', async () =>
      this.runStore.updateRunStatus(session.agentic_session_id, 'running'),
    );

    const pendingAgentOutputPersists = new Set<Promise<void>>();
    let firstPersistError: unknown = null;
    let persistQueue = Promise.resolve();
    let runCompleted = false;

    const enqueueAgentOutputPersist = (input: {
      runId: string;
      sessionId: string;
      payload: Record<string, unknown>;
      actor?: 'app' | 'agent' | 'system';
    }): void => {
      if (runCompleted) return;
      const persistPromise = persistQueue
        .then(() => {
          if (runCompleted) return;
          return this.runStore.appendEvent(input.sessionId, {
            run_id: input.runId,
            actor: input.actor ?? 'agent',
            event_type: 'agent_output',
            state_version: 1,
            payload: input.payload,
          });
        })
        .then(() => undefined)
        .catch((err: unknown) => {
          if (!firstPersistError) {
            firstPersistError = err;
          }
        })
        .finally(() => {
          pendingAgentOutputPersists.delete(persistPromise);
        });
      pendingAgentOutputPersists.add(persistPromise);
      persistQueue = persistPromise;
    };

    const awaitPendingAgentOutputPersists = async (): Promise<void> => {
      while (pendingAgentOutputPersists.size > 0) {
        await Promise.allSettled(Array.from(pendingAgentOutputPersists));
      }
      if (firstPersistError) {
        throw firstPersistError;
      }
    };

    const enqueuePermissionDecisionPersist = (
      requestId: string,
      decision: 'allow' | 'deny' | 'allow_always',
    ): void => {
      enqueueAgentOutputPersist({
        runId,
        sessionId: session.agentic_session_id,
        actor: 'system',
        payload: {
          messageType: 'permission_decision_ui',
          requestId,
          decision,
          decidedAt: new Date().toISOString(),
        },
      });
    };

    try {
      let errorCount = 0;
      const toolExecutionHooks =
        this.agentOutputOwner && workspace?.ok
          ? await this.executionCapture?.session.open(this.agentOutputOwner, workspace)
          : undefined;
      let assistantMessageCount = 0;
      let streamEventCount = 0;
      let firstStreamEventAtMs: number | null = null;
      let firstAssistantEventAtMs: number | null = null;
      let lastStreamEventType: string | null = null;
      const streamEventTypeCounts = new Map<string, number>();
      let normalizationSuccessCount = 0;
      let normalizationFailureCount = 0;
      let normalizationSchemaMismatchCount = 0;
      let bufferedAssistantText = '';
      let pendingAssistantOutput: {
        timestamp: string;
        sessionId: string | null;
        summary: string;
      } | null = null;
      let firstProviderEventReceived = false;
      let lastProcessingKind: ProviderPhase | null = null;
      let terminalProviderFailure: string | null = null;
      let terminalProviderFailureIsModelCapacity = false;

      const handleCodexCanonicalEvent = (input: {
        eventType: string;
        rawEvent: Record<string, unknown>;
        kind: 'notification' | 'server_request';
        emitLive?: boolean;
      }): {
        canonicalEventType: 'permission_request' | 'diff' | 'status' | 'unknown';
        resolvedEventType: string;
        sessionIdForEmit: string | null;
        permissionRequestPayload: Record<string, unknown> | null;
      } => {
        const { eventType, rawEvent } = input;
        const emitLive = input.emitLive !== false;
        const eventTimestamp = new Date().toISOString();
        const fallbackSessionId = this.client.getSessionId();
        streamEventCount += 1;
        const existingTypeCount = streamEventTypeCounts.get(eventType) ?? 0;
        streamEventTypeCounts.set(eventType, existingTypeCount + 1);
        lastStreamEventType = eventType;
        if (firstStreamEventAtMs === null) {
          firstStreamEventAtMs = Date.now() - startedAt;
        }

        const turn = isRecord(rawEvent['turn']) ? rawEvent['turn'] : null;
        const isTerminalErrorNotification = eventType === 'error' && rawEvent['willRetry'] !== true;
        const isFailedTurn = eventType === 'turn/completed' && turn?.['status'] === 'failed';
        const providerFailureCandidate =
          isTerminalErrorNotification || isFailedTurn
            ? (readCodexProviderFailureMessage(rawEvent) ?? 'Codex provider turn failed.')
            : null;
        const providerFailureCandidateIsModelCapacity =
          providerFailureCandidate !== null &&
          isCodexModelCapacityFailure(providerFailureCandidate);
        const conversationRawEvent = providerFailureCandidateIsModelCapacity
          ? sanitizeCodexCapacityFailureEvent(rawEvent)
          : rawEvent;
        const normalized = mapCodexEvent({
          provider: 'codex',
          runId,
          eventType,
          timestamp: eventTimestamp,
          sessionId: fallbackSessionId,
          agentId: 'codex',
          rawEvent: conversationRawEvent,
          config: this.normalizationConfig,
        });

        const resolvedEventType = normalized.resolvedEventType ?? eventType;
        const sessionIdForEmit = normalized.facts?.providerSessionId ?? fallbackSessionId;
        const route = {
          threadId: normalized.facts?.routing.providerThreadId ?? null,
          turnId: normalized.facts?.routing.providerTurnId ?? null,
        };
        const rootIdentity = this.client.getRootTurnIdentity();
        const completionDisposition = classifyCodexEventRoute(rootIdentity, route);
        const canAffectParentCompletion = completionDisposition === 'root';
        const isAssistantCandidate = Boolean(
          normalized.assistantText || normalized.assistantTextDelta,
        );
        const isTerminalCandidate = normalized.isTerminal || providerFailureCandidate !== null;
        const canAffectProcessingStatus =
          canAffectParentCompletion || (!isAssistantCandidate && !isTerminalCandidate);

        requestContext.log(this.logger, 'trace', 'local.runner.codex.event.identity_observed', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          eventType,
          completionDisposition,
          rootThreadId: rootIdentity?.threadId ?? null,
          rootTurnId: rootIdentity?.turnId ?? null,
          receivedThreadId: route.threadId,
          receivedTurnId: route.turnId,
        });

        if ((isAssistantCandidate || isTerminalCandidate) && !canAffectParentCompletion) {
          requestContext.log(
            this.logger,
            'debug',
            'local.runner.codex.event.parent_effect_rejected',
            {
              runId,
              sessionId: session.agentic_session_id,
              mode,
              eventType,
              completionDisposition,
              rootThreadId: rootIdentity?.threadId ?? null,
              rootTurnId: rootIdentity?.turnId ?? null,
              receivedThreadId: route.threadId,
              receivedTurnId: route.turnId,
              assistantCandidate: isAssistantCandidate,
              terminalCandidate: isTerminalCandidate,
            },
          );
        }

        if (
          providerFailureCandidate !== null &&
          canAffectParentCompletion &&
          terminalProviderFailure === null
        ) {
          terminalProviderFailure = providerFailureCandidate;
          terminalProviderFailureIsModelCapacity = providerFailureCandidateIsModelCapacity;
          errorCount += 1;
          requestContext.log(this.logger, 'error', 'local.runner.codex.provider_turn.failed', {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            eventType,
            rootThreadId: rootIdentity?.threadId ?? null,
            rootTurnId: rootIdentity?.turnId ?? null,
            receivedThreadId: route.threadId,
            receivedTurnId: route.turnId,
            error: terminalProviderFailure,
          });
          if (session.promptType === 'daily_session') {
            requestContext.log(this.logger, 'error', DAILY_SESSION_MONITOR_LOG_EVENT, {
              stage: 'provider_turn_failed',
              runId: session.agentic_session_id,
              provider: 'codex',
              model: selectedModel,
              error: terminalProviderFailure,
            });
          }
        }

        if (
          eventType === 'thread/started' &&
          sessionIdForEmit &&
          route.threadId === rootIdentity?.threadId
        ) {
          persistProviderIdentityFromThreadStarted(sessionIdForEmit);
        }

        if (
          canAffectParentCompletion &&
          normalized.assistantText &&
          normalized.assistantText.kind === 'text'
        ) {
          if (!normalized.assistantText.isFinal) {
            if (normalized.assistantText.text.length > bufferedAssistantText.length) {
              bufferedAssistantText = normalized.assistantText.text;
            }
          } else {
            if (pendingAssistantOutput) {
              this.emitRawEvent({
                source: 'provider',
                eventType: 'agent_output',
                timestamp: pendingAssistantOutput.timestamp,
                sessionId: pendingAssistantOutput.sessionId,
                agentId: 'codex',
                payload: {
                  messageType: 'assistant',
                  summary: pendingAssistantOutput.summary,
                },
              });
            }
            pendingAssistantOutput = {
              timestamp: eventTimestamp,
              sessionId: sessionIdForEmit,
              summary: normalized.assistantText.text,
            };
            bufferedAssistantText = '';
          }
        }
        if (canAffectParentCompletion && normalized.assistantTextDelta) {
          bufferedAssistantText += normalized.assistantTextDelta;
        }

        if (!firstProviderEventReceived && canAffectProcessingStatus) {
          firstProviderEventReceived = true;
          lastProcessingKind = 'thinking';
          if (emitLive) {
            this.emitProcessingStatus(
              { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
              sessionIdForEmit,
              'codex',
            );
          }
        }
        if (
          emitLive &&
          canAffectParentCompletion &&
          normalized.assistantText &&
          lastProcessingKind !== 'writing'
        ) {
          lastProcessingKind = 'writing';
          this.emitProcessingStatus(
            { kind: 'loading.update', loadingText: 'Writing response...', phase: 'writing' },
            sessionIdForEmit,
            'codex',
          );
        } else if (
          emitLive &&
          !isAssistantCandidate &&
          !isTerminalCandidate &&
          lastProcessingKind !== 'thinking'
        ) {
          lastProcessingKind = 'thinking';
          this.emitProcessingStatus(
            { kind: 'loading.update', loadingText: 'Thinking...', phase: 'thinking' },
            sessionIdForEmit,
            'codex',
          );
        }

        requestContext.log(this.logger, 'trace', 'local.runner.codex.event.raw_received', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          streamEventCount,
          eventType,
          resolvedEventType,
          eventTimestamp,
          source: input.kind,
          redactionEnabled: this.redactionConfig.enabled,
          rawEvent: redactAgentEventForLog(rawEvent, this.redactionConfig),
        });

        if (emitLive) {
          this.emitRawEvent({
            source: 'provider',
            eventType: resolvedEventType,
            timestamp: eventTimestamp,
            sessionId: sessionIdForEmit,
            agentId: 'codex',
            payload: normalized.payload,
            ...(normalized.facts ? { providerFacts: normalized.facts } : {}),
          });
        }

        enqueueAgentOutputPersist({
          runId,
          sessionId: session.agentic_session_id,
          payload: normalized.payload,
        });

        const diagnostics = normalized.diagnostics;
        if (diagnostics.success) {
          normalizationSuccessCount += 1;
        } else {
          normalizationFailureCount += 1;
        }
        if (diagnostics.schemaMismatch) {
          normalizationSchemaMismatchCount += 1;
        }

        requestContext.log(
          this.logger,
          diagnostics.success ? 'trace' : 'warn',
          'local.runner.codex.event.normalization',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            eventType,
            resolvedEventType,
            canonicalEventType: diagnostics.canonicalEventType,
            validationMode: diagnostics.validationMode,
            success: diagnostics.success,
            schemaMismatch: diagnostics.schemaMismatch,
            errors: diagnostics.errors,
            latencyMs: diagnostics.latencyMs,
            normalizationSuccessCount,
            normalizationFailureCount,
            normalizationSchemaMismatchCount,
            ...(diagnostics.success
              ? {}
              : { rawEvent: redactAgentEventForLog(rawEvent, this.redactionConfig) }),
          },
        );

        if (
          canAffectParentCompletion &&
          normalized.assistantText &&
          normalized.assistantText.isFinal
        ) {
          assistantMessageCount += 1;
          if (firstAssistantEventAtMs === null) {
            firstAssistantEventAtMs = Date.now() - startedAt;
          }
        }

        if (
          emitLive &&
          canAffectParentCompletion &&
          normalized.isTerminal &&
          pendingAssistantOutput
        ) {
          this.emitRawEvent({
            source: 'provider',
            eventType: 'agent_output',
            timestamp: eventTimestamp,
            sessionId: pendingAssistantOutput.sessionId ?? sessionIdForEmit,
            agentId: 'codex',
            payload: {
              messageType: 'assistant',
              summary: pendingAssistantOutput.summary,
              taskComplete: true,
            },
          });
          pendingAssistantOutput = null;
          bufferedAssistantText = '';
        } else if (
          emitLive &&
          canAffectParentCompletion &&
          normalized.isTerminal &&
          bufferedAssistantText.length > 0
        ) {
          this.emitRawEvent({
            source: 'provider',
            eventType: 'agent_output',
            timestamp: eventTimestamp,
            sessionId: sessionIdForEmit,
            agentId: 'codex',
            payload: {
              messageType: 'assistant',
              summary: bufferedAssistantText,
              taskComplete: true,
            },
          });
          bufferedAssistantText = '';
        }

        const fallbackPermissionRequest = isRecord(normalized.payload['permission_request'])
          ? normalized.payload['permission_request']
          : null;
        const permissionRequestPayload =
          diagnostics.canonicalEventType === 'permission_request'
            ? normalized.facts?.permissionRequest
              ? {
                  id: normalized.facts.permissionRequest.requestId,
                  permission_type: normalized.facts.permissionRequest.permissionType,
                  action: normalized.facts.permissionRequest.exactAction.action,
                  target: normalized.facts.permissionRequest.exactAction.target,
                  fingerprint: normalized.facts.permissionRequest.exactAction.fingerprint,
                }
              : fallbackPermissionRequest
            : null;

        return {
          canonicalEventType: diagnostics.canonicalEventType,
          resolvedEventType,
          sessionIdForEmit,
          permissionRequestPayload,
        };
      };

      this.client.onTokenUsage((usage) => {
        if (usage.inputTokens === null) {
          this.logger.debug('local.runner.codex.token-usage.input-unavailable', { runId });
          return;
        }

        void this.runStore
          .setRunTokenUsage(session.agentic_session_id, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.cacheReadInputTokens === null
              ? {}
              : { cacheReadInputTokens: usage.cacheReadInputTokens }),
            cacheAvailability: usage.cacheAvailability,
          })
          .catch((error: unknown) => {
            this.logger.warn('local.runner.codex.token-usage.persist-failed', { runId, error });
          });
      });

      this.client.onEvent((providerEvent: CodexSdkEvent) => {
        const event = withoutCodexInputEcho(providerEvent);
        if (!event) return;
        this.providerUsageCapture.observeCodex(event.method, event.params);
        this.executionCapture?.observe(event, this.client.getRootTurnIdentity());
        handleCodexCanonicalEvent({
          eventType: event.method,
          rawEvent: event.params ?? {},
          kind: 'notification',
        });
      });

      this.client.onServerRequest((request: CodexSdkServerRequest) => {
        const rawEvent: Record<string, unknown> = {
          id: request.id,
          params: request.params ?? {},
        };
        const toolSurfaceMismatch = this.resolveHeyHeyMcpToolSurfaceMismatch(request);
        const preApprovedMcpElicitation = this.isPreApprovedMcpElicitation(request);
        const autoApprovablePermissionType = readAutoApprovablePermissionTypeFromMethod(
          request.method,
        );
        const isAutomaticallyResolved =
          toolSurfaceMismatch !== null ||
          preApprovedMcpElicitation ||
          (autoApprovablePermissionType !== null &&
            (skipPermissions === true ||
              this.alwaysApprovedPermissionTypes.has(autoApprovablePermissionType)));
        const result = handleCodexCanonicalEvent({
          eventType: request.method,
          rawEvent,
          kind: 'server_request',
          emitLive: !isAutomaticallyResolved,
        });
        const requestIdValue = result.permissionRequestPayload?.['id'];
        const requestIdStr =
          typeof requestIdValue === 'string'
            ? requestIdValue
            : typeof requestIdValue === 'number'
              ? String(requestIdValue)
              : String(request.id);
        const persistAutomaticDecision = (decision: 'allow' | 'deny' | 'allow_always'): void => {
          if (
            result.canonicalEventType === 'permission_request' &&
            result.permissionRequestPayload
          ) {
            enqueuePermissionDecisionPersist(requestIdStr, decision);
          }
        };

        if (toolSurfaceMismatch) {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.codex.mcp_elicitation.tool_surface_mismatch',
            {
              runId,
              sessionId: session.agentic_session_id,
              mode,
              sessionPromptType: session.promptType ?? null,
              persistedProviderSessionId: session.provider_session_id ?? null,
              clientSessionId: this.client.getSessionId(),
              rawRequestId: request.id,
              serverName: toolSurfaceMismatch.serverName,
              toolName: toolSurfaceMismatch.toolName,
              qualifiedToolName: toolSurfaceMismatch.qualifiedToolName,
              classification: toolSurfaceMismatch.classification,
              availability: toolSurfaceMismatch.availability,
              reason: toolSurfaceMismatch.agentFacingMessage,
              effectiveMcpToolUseCase: mcpToolUseCase ?? 'coding',
              additionalAllowedTools: additionalAllowedTools ?? [],
              additionalAllowedToolCount: additionalAllowedTools?.length ?? 0,
              ...this.summarizeActiveMcpPolicy(toolSurfaceMismatch.qualifiedToolName),
            },
          );
          try {
            this.submitMcpElicitationResponse(request.id, {
              action: 'decline',
              content: {
                classification: toolSurfaceMismatch.classification,
                message: toolSurfaceMismatch.agentFacingMessage,
              },
              _meta: {
                classification: toolSurfaceMismatch.classification,
                reason: 'inactive_tool_surface',
              },
            });
            persistAutomaticDecision('deny');
          } catch (error) {
            requestContext.log(
              this.logger,
              'error',
              'local.runner.codex.mcp_elicitation.tool_surface_mismatch_response_failed',
              {
                runId,
                sessionId: session.agentic_session_id,
                rawRequestId: request.id,
                serverName: toolSurfaceMismatch.serverName,
                toolName: toolSurfaceMismatch.toolName,
                qualifiedToolName: toolSurfaceMismatch.qualifiedToolName,
                classification: toolSurfaceMismatch.classification,
                error: toErrorMessage(error),
              },
            );
          }
          return;
        }

        if (
          reportingRepair &&
          !readMcpElicitationTool(request).qualifiedToolName?.endsWith('report_changed_files')
        ) {
          if (request.method === CODEX_MCP_ELICITATION_METHOD)
            this.submitMcpElicitationResponse(request.id, { action: 'decline', content: null });
          else this.client.submitClientResponse(request.id, { decision: 'decline' });
          persistAutomaticDecision('deny');
          return;
        }

        if (preApprovedMcpElicitation) {
          const { serverName, toolName, qualifiedToolName } = readMcpElicitationTool(request);
          requestContext.log(
            this.logger,
            'info',
            'local.runner.codex.mcp_elicitation.auto_approved',
            {
              runId,
              sessionId: session.agentic_session_id,
              mode,
              sessionPromptType: session.promptType ?? null,
              persistedProviderSessionId: session.provider_session_id ?? null,
              clientSessionId: this.client.getSessionId(),
              rawRequestId: request.id,
              serverName,
              toolName,
              qualifiedToolName,
              effectiveMcpToolUseCase: mcpToolUseCase ?? 'coding',
              additionalAllowedTools: additionalAllowedTools ?? [],
              additionalAllowedToolCount: additionalAllowedTools?.length ?? 0,
              ...this.summarizeActiveMcpPolicy(qualifiedToolName),
            },
          );
          try {
            this.submitMcpElicitationResponse(request.id, {
              action: 'accept',
              content: null,
              _meta: { [CODEX_MCP_PERSIST_KEY]: CODEX_MCP_PERSIST_ALWAYS },
            });
            persistAutomaticDecision('allow');
          } catch (error) {
            requestContext.log(
              this.logger,
              'error',
              'local.runner.codex.mcp_elicitation.auto_approve_failed',
              {
                runId,
                sessionId: session.agentic_session_id,
                rawRequestId: request.id,
                serverName,
                toolName,
                qualifiedToolName,
                error: toErrorMessage(error),
              },
            );
          }
          return;
        }

        if (skipPermissions === true && autoApprovablePermissionType) {
          this.client.submitClientResponse(request.id, { decision: 'acceptForSession' });
          requestContext.log(
            this.logger,
            'info',
            'local.runner.codex.permission_request.auto_approved',
            {
              runId,
              sessionId: session.agentic_session_id,
              mode,
              clientSessionId: this.client.getSessionId(),
              rawRequestId: request.id,
              method: request.method,
              permissionType: autoApprovablePermissionType,
              decision: 'session_authorization',
            },
          );
          this.emitRawEvent({
            source: 'local',
            eventType: 'permission_auto_approved',
            timestamp: new Date().toISOString(),
            sessionId: this.client.getSessionId(),
            agentId: 'codex',
            payload: {
              messageType: 'permission_auto_approved',
              agent_type: 'codex',
              permission_type: autoApprovablePermissionType,
              raw_request_id: request.id,
              decision: 'session_authorization',
            },
          });
          persistAutomaticDecision('allow_always');
          return;
        }
        if (
          autoApprovablePermissionType &&
          this.alwaysApprovedPermissionTypes.has(autoApprovablePermissionType)
        ) {
          try {
            this.client.submitClientResponse(request.id, { decision: 'acceptForSession' });
            requestContext.log(
              this.logger,
              'info',
              'local.runner.codex.permission_request.auto_approved',
              {
                runId,
                sessionId: session.agentic_session_id,
                mode,
                clientSessionId: this.client.getSessionId(),
                rawRequestId: request.id,
                method: request.method,
                permissionType: autoApprovablePermissionType,
                decision: 'always_approve',
              },
            );
            this.emitRawEvent({
              source: 'local',
              eventType: 'permission_auto_approved',
              timestamp: new Date().toISOString(),
              sessionId: this.client.getSessionId(),
              agentId: 'codex',
              payload: {
                messageType: 'permission_auto_approved',
                agent_type: 'codex',
                permission_type: autoApprovablePermissionType,
                raw_request_id: request.id,
                decision: 'always_approve',
              },
            });
            persistAutomaticDecision('allow_always');
            return;
          } catch (error) {
            requestContext.log(
              this.logger,
              'error',
              'local.runner.codex.permission_request.auto_approve_failed',
              {
                runId,
                sessionId: session.agentic_session_id,
                mode,
                clientSessionId: this.client.getSessionId(),
                rawRequestId: request.id,
                method: request.method,
                permissionType: autoApprovablePermissionType,
                error: toErrorMessage(error),
              },
            );
          }
        }

        // Forward ServerRequests through the same translator. Permission-family
        // requests (execCommandApproval, applyPatchApproval, item/*/requestApproval)
        // emit canonical permission_request events; the runner correlates the
        // raw JSON-RPC id back to the ClientResponse in this.submitPermissionDecision.
        if (
          result.canonicalEventType !== 'permission_request' ||
          !result.permissionRequestPayload
        ) {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.codex.server_request.unrecognized',
            {
              runId,
              sessionId: session.agentic_session_id,
              method: request.method,
              rawRequestId: request.id,
              canonicalEventType: result.canonicalEventType,
            },
          );
          return;
        }
        const mcpElicitationTool =
          request.method === CODEX_MCP_ELICITATION_METHOD ? readMcpElicitationTool(request) : null;
        const permissionTypeValue = result.permissionRequestPayload['permission_type'];
        const permissionType =
          typeof permissionTypeValue === 'string' &&
          isCodexAutoApprovablePermissionType(permissionTypeValue)
            ? permissionTypeValue
            : null;
        this.pendingPermissionRequests.set(requestIdStr, {
          requestId: requestIdStr,
          rawRequestId: request.id,
          sessionId: result.sessionIdForEmit ?? session.agentic_session_id,
          createdAt: new Date().toISOString(),
          kind: request.method === CODEX_MCP_ELICITATION_METHOD ? 'mcp_elicitation' : 'approval',
          permissionType,
          mcpServerName: mcpElicitationTool?.serverName ?? null,
        });
        requestContext.log(this.logger, 'info', 'local.runner.codex.permission_request.queued', {
          runId,
          sessionId: session.agentic_session_id,
          requestId: requestIdStr,
          rawRequestId: request.id,
          method: request.method,
          kind: request.method === CODEX_MCP_ELICITATION_METHOD ? 'mcp_elicitation' : 'approval',
          permissionType,
          mcpServerName: mcpElicitationTool?.serverName ?? null,
          resolvedEventType: result.resolvedEventType,
        });
      });

      // Read the project's active work-item type definitions once per run, on a
      // fresh session, before the prompt is delivered, and assemble the platform
      // system prompt from them. A failed read aborts session start (it
      // propagates to the run's catch) rather than opening on a stale or empty
      // ontology. Resume turns inherit Codex's initial prompt and do not
      // re-compose or re-send this context.
      let platformSystemPrompt: string | null = null;
      if (
        mode === 'prompt' &&
        this.oauthClient &&
        mcpToolUseCase !== 'project_report' &&
        mcpToolUseCase !== 'release_notes'
      ) {
        const sessionStartContext = await readSessionStartContext({
          oauthClient: this.oauthClient,
          projectId: session.contextMetadata?.projectId,
        });
        platformSystemPrompt = buildPlatformSystemPrompt(
          sessionStartContext.workItemTypeDefinitions,
          {
            provider: 'codex',
            model: selectedModel,
            ...(epistemicCalibration ? { epistemicCalibration } : {}),
          },
          {
            provider: 'codex',
            intentFirst: sessionStartContext.intentFirst,
            maturity: sessionStartContext.maturity,
            hints: resolveHintPromptAccess(
              sessionStartContext.hintsEnabled,
              additionalAllowedTools ?? [],
            ),
          },
        );
        requestContext.log(this.logger, 'debug', 'local.runner.codex.session_start_context.read', {
          runId,
          sessionId: session.agentic_session_id,
          workItemTypeCount: sessionStartContext.workItemTypeDefinitions.length,
        });
      }

      let platformMcpConfig: CodexConfigOverrides | null = null;
      const allowedMcpToolNames = new Set<string>();
      const cliBaseUrl = this.localAgentEndpoint.get();
      if (session.inert && (!platformMcpProxyMount || !cliBaseUrl)) {
        throw new Error('Inert execution requires the scoped platform MCP proxy.');
      }
      if ((platformMcpProxyMount && cliBaseUrl) || this.oauthClient) {
        requestContext.log(this.logger, 'debug', 'local.runner.codex.mcp_config.building', {
          runId,
          projectId: session.contextMetadata?.projectId,
          conversationId: session.conversationId,
          mode,
        });
        try {
          const mcpConfig =
            platformMcpProxyMount && cliBaseUrl
              ? buildPlatformMcpProxyMcpConfig({
                  mount: platformMcpProxyMount,
                  cliBaseUrl,
                })
              : await buildMcpServerConfig(
                  this.oauthClient!,
                  {
                    projectId: session.contextMetadata?.projectId,
                    conversationId: session.conversationId,
                    serviceId: session.launchServiceId,
                    agentSessionId: session.agentic_session_id,
                  },
                  {
                    ...(mcpToolUseCase ? { useCase: mcpToolUseCase } : {}),
                    additionalTools: additionalAllowedTools ?? [],
                  },
                );
          const platformEntry = mcpConfig.mcpServers['heyhey-platform'] as
            | PlatformMcpServerEntry
            | undefined;
          platformMcpConfig = platformEntry ? toCodexPlatformMcpConfig(platformEntry) : null;
          for (const toolName of mcpConfig.allowedTools) {
            allowedMcpToolNames.add(toolName);
          }
          if (platformMcpConfig) {
            requestContext.log(this.logger, 'debug', 'local.runner.codex.mcp_config.built', {
              runId,
              sessionId: session.agentic_session_id,
              mode,
              serverName: 'heyhey-platform',
              allowedToolCount: mcpConfig.allowedTools.length,
              allowedTools: mcpConfig.allowedTools,
            });
          } else {
            requestContext.log(
              this.logger,
              'warn',
              'local.runner.codex.mcp_config.missing_server',
              {
                runId,
                sessionId: session.agentic_session_id,
                mode,
              },
            );
          }
        } catch (err: unknown) {
          if (session.inert) {
            throw err;
          }
          requestContext.log(this.logger, 'warn', 'local.runner.codex.mcp_config.failed', {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            error: err,
          });
        }
      } else {
        requestContext.log(this.logger, 'warn', 'local.runner.codex.mcp_config.skipped', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          hasPlatformMcpProxyMount: Boolean(platformMcpProxyMount),
          hasCliBaseUrl: Boolean(cliBaseUrl),
        });
      }

      let submissionToolsConfig: CodexConfigOverrides | null = null;
      const runRegistration = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
      const mountedSubmissionToolNames = runRegistration
        ? runRegistration.tools.map((tool) => tool.name).sort()
        : [];
      const activeSubmissionToolNames = runRegistration?.activeToolNames
        ? [...runRegistration.activeToolNames].sort()
        : mountedSubmissionToolNames;
      if (runRegistration && cliBaseUrl && runRegistration.tools.length > 0) {
        const submissionConfig = buildSubmissionToolsMcpConfig({
          token: runRegistration.token,
          cliBaseUrl,
          tools: runRegistration.tools,
        });
        // Codex applies one tool timeout per MCP server (60s by default), so a
        // long-running submission tool raises it for the whole server.
        const longestToolDurationMs = Math.max(
          0,
          ...runRegistration.tools.map((tool) => tool.maxDurationMs ?? 0),
        );
        submissionToolsConfig = {
          mcp_servers: {
            [submissionConfig.serverName]: {
              url: submissionConfig.serverEntry.url,
              ...(longestToolDurationMs > 0
                ? { tool_timeout_sec: Math.ceil(longestToolDurationMs / 1000) }
                : {}),
            },
          },
        };
        for (const toolName of activeSubmissionToolNames) {
          allowedMcpToolNames.add(`mcp__${submissionConfig.serverName}__${toolName}`);
        }
        requestContext.log(this.logger, 'debug', 'local.runner.codex.submission_tools.attached', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          serverName: submissionConfig.serverName,
          toolCount: runRegistration.tools.length,
          mountedTools: mountedSubmissionToolNames,
          activeTools: activeSubmissionToolNames,
          allowedTools: activeSubmissionToolNames.map(
            (toolName) => `mcp__${submissionConfig.serverName}__${toolName}`,
          ),
        });
      } else if (runRegistration && cliBaseUrl === null) {
        requestContext.log(this.logger, 'warn', 'local.runner.codex.submission_tools.no_base_url', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          toolCount: runRegistration.tools.length,
        });
      } else {
        requestContext.log(this.logger, 'debug', 'local.runner.codex.submission_tools.skipped', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          hasRegistration: Boolean(runRegistration),
          toolCount: runRegistration?.tools.length ?? 0,
        });
      }

      this.emitLocalStatus('Sending prompt to codex...');
      this.activeAllowedMcpToolNames = allowedMcpToolNames;
      this.activeMcpSurfaceContext = {
        activeToolSetSource: 'codex_prompt_mcp_config',
        mountedHeyHeyServerNames: [
          ...(platformMcpConfig ? ['heyhey-platform'] : []),
          ...(submissionToolsConfig ? ['heyhey-submission-tools'] : []),
          ...(browserMcpMount && cliBaseUrl ? [BROWSER_MCP_SERVER_NAME] : []),
        ],
        mountedSubmissionToolNames,
        activeSubmissionToolNames,
      };

      const browserConfig =
        browserMcpMount && cliBaseUrl
          ? buildBrowserToolsMcpConfig(browserMcpMount, cliBaseUrl)
          : null;
      const browserMcpConfig: CodexConfigOverrides | null = browserConfig
        ? {
            mcp_servers: {
              [browserConfig.serverName]: {
                url: browserConfig.serverEntry.url,
                enabled_tools: BROWSER_ALLOWED_TOOLS.map((name) => name.split('__').at(-1)!),
                tool_timeout_sec: 30,
              },
            },
          }
        : null;
      if (browserConfig)
        for (const name of browserConfig.allowedTools) allowedMcpToolNames.add(name);
      const mcpConfig = mergeCodexMcpConfigs([
        platformMcpConfig,
        submissionToolsConfig,
        browserMcpConfig,
      ]);
      const baseConfig = applyCodexSessionReviewerPolicy(
        codexPermissionPlan.workspaceWriteConfig
          ? applyCodexWorkspaceContainment(mcpConfig, codexPermissionPlan.workspaceWriteConfig)
          : mcpConfig,
        sandboxMode,
      );
      const config =
        session.inert || mcpToolUseCase === 'project_report'
          ? {
              ...(baseConfig ?? {}),
              features: CODEX_MCP_ONLY_FEATURE_OVERRIDES,
            }
          : baseConfig;
      requestContext.log(this.logger, 'debug', 'local.runner.codex.session_policy.resolved', {
        runId,
        mode,
        sandboxMode,
        platformPromptDeliveryMode,
        reviewer: sandboxMode === 'read-only' ? 'user' : 'user-configured',
      });

      const freshPlatformPromptDelivery =
        mode === 'prompt' && platformSystemPrompt
          ? composeFreshPlatformPromptDelivery({
              mode: platformPromptDeliveryMode,
              assembledPlatformPrompt: platformSystemPrompt,
              resolvedFirstTurnInput: prompt,
              ...(startupSegments ? { startupSegments } : {}),
            })
          : null;
      const providerPrompt =
        freshPlatformPromptDelivery?.mode === PLATFORM_PROMPT_DELIVERY_MODE.INITIAL_PREFIX
          ? freshPlatformPromptDelivery.prefixedFirstTurnInput
          : (freshPlatformPromptDelivery?.firstTurnInput ?? prompt);
      const providerStartupInput = {
        prompt: providerPrompt,
        systemPrompt:
          freshPlatformPromptDelivery?.mode === PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS
            ? freshPlatformPromptDelivery.baseInstructions
            : null,
      };
      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: {
          mode,
          prompt,
          adapterId: 'codex',
          repositoryPath: repositoryPathForRunStarted,
          providerStartupInput,
          ...(resolvedProviderSessionId ? { provider_session_id: resolvedProviderSessionId } : {}),
          providerStart: providerStartDiagnostics,
        },
      });
      this.emitRawEvent({
        source: 'provider',
        eventType: 'run_started',
        timestamp: new Date().toISOString(),
        sessionId: session.agentic_session_id,
        agentId: null,
        payload: {
          prompt: providerStartupInput.prompt,
          systemPrompt: providerStartupInput.systemPrompt,
          ...(startingMessage ? { startingMessage } : {}),
        },
      });

      const attachmentContent = await this.attachmentContentReader.read(
        attachmentRunId,
        attachments,
        this.logger,
      );
      if (mode === 'prompt') {
        requestContext.log(
          this.logger,
          'info',
          'local.runner.codex.run_prompt.invoking_start_session',
          {
            runId,
            sessionId: session.agentic_session_id,
            repositoryPath: runCwd,
            ...providerStartDiagnostics,
          },
        );
        this.emitProcessingStatus(
          { kind: 'loading.update', loadingText: 'Starting...', phase: 'starting' },
          resolvedProviderSessionId,
          'codex',
        );
        const startSessionConfig: CodexSdkSessionConfigWithServiceTier = {
          ...(toolExecutionHooks ? { toolExecutionHooks } : {}),
          prompt: providerPrompt,
          attachments: attachmentContent,
          ...(freshPlatformPromptDelivery?.mode === PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.codex
            ? { structuredInput: freshPlatformPromptDelivery.structuredFirstTurnInput }
            : {}),
          cwd: runCwd,
          ...(freshPlatformPromptDelivery?.mode === PLATFORM_PROMPT_DELIVERY_MODE.BASE_INSTRUCTIONS
            ? { baseInstructions: freshPlatformPromptDelivery.baseInstructions }
            : {}),
          ...(resolvedSkill ? { skill: resolvedSkill } : {}),
          ...(sandboxMode ? { sandbox: sandboxMode } : {}),
          ...(extraWritableDirs.length > 0 ? { extraWritableDirs } : {}),
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(config ? { config } : {}),
          ...(selectedReasoningEffort ? { effort: selectedReasoningEffort } : {}),
          ...(selectedServiceTier ? { serviceTier: selectedServiceTier } : {}),
        };
        await this.client.startSession(startSessionConfig, signal ? { signal } : undefined);
        requestContext.log(
          this.logger,
          'info',
          'local.runner.codex.run_prompt.start_session_completed',
          {
            runId,
            sessionId: session.agentic_session_id,
            clientSessionIdAfterStart: this.client.getSessionId(),
            toolCompletedAtMs: Date.now() - startedAt,
          },
        );
      } else {
        // `mode === 'resume'` implies `resolvedProviderSessionId` is set: the
        // persisted codex `thread_id` we resume against.
        const threadId = resolvedProviderSessionId!;
        requestContext.log(
          this.logger,
          'info',
          'local.runner.codex.run_prompt.invoking_resume_session',
          {
            runId,
            sessionId: session.agentic_session_id,
            expectedProviderSessionId: resolvedProviderSessionId,
            threadId,
            ...providerStartDiagnostics,
          },
        );
        this.emitProcessingStatus(
          { kind: 'loading.update', loadingText: 'Starting...', phase: 'starting' },
          resolvedProviderSessionId,
          'codex',
        );
        const resumeSessionConfig: CodexSdkSessionConfigWithServiceTier = {
          ...(toolExecutionHooks ? { toolExecutionHooks } : {}),
          prompt: providerPrompt,
          attachments: attachmentContent,
          cwd: runCwd,
          ...(resolvedSkill ? { skill: resolvedSkill } : {}),
          ...(sandboxMode ? { sandbox: sandboxMode } : {}),
          ...(extraWritableDirs.length > 0 ? { extraWritableDirs } : {}),
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(config ? { config } : {}),
          ...(selectedReasoningEffort ? { effort: selectedReasoningEffort } : {}),
          ...(selectedServiceTier ? { serviceTier: selectedServiceTier } : {}),
        };
        await this.client.resumeSession(
          threadId,
          resumeSessionConfig,
          signal ? { signal } : undefined,
        );
        requestContext.log(
          this.logger,
          'info',
          'local.runner.codex.run_prompt.resume_session_completed',
          {
            runId,
            sessionId: session.agentic_session_id,
            clientSessionIdAfterResume: this.client.getSessionId(),
            toolCompletedAtMs: Date.now() - startedAt,
          },
        );
      }

      await awaitPendingAgentOutputPersists();
      await awaitEagerProviderIdentityPersist();
      const streamEventTypeSummary = Object.fromEntries(
        Array.from(streamEventTypeCounts.entries()).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
      if (terminalProviderFailure) {
        if (terminalProviderFailureIsModelCapacity) {
          throw new AgentSessionRunnerError(
            'MODEL_CAPACITY',
            CAPACITY_RETRY_MESSAGE,
            new Error(terminalProviderFailure),
          );
        }
        throw new Error(terminalProviderFailure);
      }
      requestContext.log(this.logger, 'debug', 'local.runner.codex.run_prompt.pre_detach', {
        runId,
        sessionId: session.agentic_session_id,
        mode,
        streamEventCount,
        streamEventTypeSummary,
        assistantMessageCount,
        firstStreamEventAtMs,
        firstAssistantEventAtMs,
        lastStreamEventType,
        pendingAgentOutputPersistsCount: pendingAgentOutputPersists.size,
      });
      if (assistantMessageCount === 0) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.codex.run_prompt.no_assistant_output',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            streamEventCount,
            streamEventTypeSummary,
          },
        );
      }
      this.client.onEvent(null);
      this.client.onTokenUsage(null);
      this.client.onServerRequest(null);
      this.emitLocalStatus('');
      process.stdout.write('\n');

      const providerSessionId = this.client.getSessionId();
      // Codex thread id captured from `thread/started` is the session identity;
      // mirror the Claude runner by persisting it as `provider_session_id` with
      // `provider_conversation_id: null`.
      requestContext.log(this.logger, 'debug', 'local.runner.codex.provider_session_id.resolved', {
        runId,
        sessionId: session.agentic_session_id,
        mode,
        resolvedProviderSessionIdBeforeRun: resolvedProviderSessionId,
        providerSessionIdAfterRun: providerSessionId,
      });

      if (
        mode === 'resume' &&
        resolvedProviderSessionId &&
        providerSessionId &&
        providerSessionId !== resolvedProviderSessionId
      ) {
        requestContext.log(this.logger, 'error', 'local.runner.codex.provider_identity.mismatch', {
          runId,
          sessionId: session.agentic_session_id,
          expectedProviderSessionId: resolvedProviderSessionId,
          actualProviderSessionId: providerSessionId,
        });
        throw new Error(
          `Provider identity mismatch while resuming ${session.agentic_session_id}: expected session id ${resolvedProviderSessionId}, received ${providerSessionId}.`,
        );
      }

      if (providerSessionId) {
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.codex.provider_session_id.pre_write',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            previousProviderSessionId: session.provider_session_id,
            providerSessionIdToWrite: providerSessionId,
            providerConversationIdToWrite: null,
          },
        );
        await withSessionWriteLockRetry('update_provider_identity', async () =>
          this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
            providerSessionId,
            providerConversationId: null,
            providerSessionAgentId: session.provider_session_agent_id ?? null,
          }),
        );
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.codex.provider_session_id.post_write',
          {
            runId,
            sessionId: session.agentic_session_id,
            providerSessionIdWritten: providerSessionId,
            providerConversationIdWritten: null,
          },
        );
      } else {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.codex.provider_session_id.missing_after_run',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
          },
        );
      }

      runCompleted = true;
      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'system',
        event_type: 'run_completed',
        state_version: 1,
        payload: {
          mode,
          provider_session_id: providerSessionId,
          provider_conversation_id: null,
          errorCount,
        },
      });
      this.emitRawEvent({
        source: 'local',
        eventType: 'run_completed',
        timestamp: new Date().toISOString(),
        sessionId: session.agentic_session_id,
        agentId: null,
        payload: {
          provider_session_id: providerSessionId,
          provider_conversation_id: null,
          errorCount,
        },
      });
      await withSessionWriteLockRetry('set_status_complete', async () =>
        this.runStore.updateRunStatus(session.agentic_session_id, 'complete'),
      );
      requestContext.log(this.logger, 'debug', 'local.runner.codex.run_prompt.succeeded', {
        runId,
        sessionId: session.agentic_session_id,
        mode,
        providerSessionId,
        providerConversationId: null,
        streamEventCount,
        firstStreamEventAtMs,
        firstAssistantEventAtMs,
        lastStreamEventType,
        assistantMessageCount,
        errorCount,
        durationMs: Date.now() - startedAt,
      });
      this.clearPendingPermissionRequests(
        `Codex permission request was canceled because run ${runId} completed before a decision was applied.`,
      );

      await this.client.disconnect();

      return {
        providerSessionId: providerSessionId ?? null,
        providerConversationId: null,
        errorCount,
      };
    } catch (error) {
      this.client.onEvent(null);
      this.client.onTokenUsage(null);
      this.client.onServerRequest(null);
      this.emitLocalStatus('');
      this.clearPendingPermissionRequests(
        `Codex permission request was canceled because run ${runId} failed before completion.`,
      );

      try {
        await awaitPendingAgentOutputPersists();
      } catch (persistError) {
        requestContext.log(this.logger, 'warn', 'local.runner.codex.event.persist_drain_failed', {
          runId,
          sessionId: session.agentic_session_id,
          mode,
          pendingAgentOutputPersistsCount: pendingAgentOutputPersists.size,
          error: toErrorMessage(persistError),
        });
      }
      await awaitEagerProviderIdentityPersist();

      const clientSessionIdAtPauseCheck = this.client.getSessionId();
      const providerSessionIdentityMismatch =
        mode === 'resume' &&
        resolvedProviderSessionId !== null &&
        clientSessionIdAtPauseCheck !== null &&
        clientSessionIdAtPauseCheck !== resolvedProviderSessionId;
      const isExpectedServiceScopeTurnAbort =
        signal !== undefined &&
        isCodexAbortError(error) &&
        !providerSessionIdentityMismatch &&
        this.agentOutputOwner?.serviceScope.consumeExpectedServiceScopeTurnAbort(signal) === true;
      if (isExpectedServiceScopeTurnAbort) {
        runCompleted = true;
        await withSessionWriteLockRetry('set_status_idle_after_service_scope_abort', async () =>
          this.runStore.updateRunStatus(session.agentic_session_id, 'idle'),
        );
        const providerSessionId = clientSessionIdAtPauseCheck ?? resolvedProviderSessionId;
        requestContext.log(
          this.logger,
          'info',
          'local.runner.codex.run_prompt.aborted_for_service_scope',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            providerSessionId,
            durationMs: Date.now() - startedAt,
          },
        );
        await this.client.disconnect().catch(() => undefined);
        return {
          providerSessionId,
          providerConversationId: null,
          errorCount: 0,
        };
      }

      const rawErrorMessage =
        error instanceof AgentSessionRunnerError && error.cause instanceof Error
          ? error.cause.message
          : error instanceof Error
            ? error.message
            : 'Unknown agent session runner error';
      const isModelCapacityFailure =
        (error instanceof AgentSessionRunnerError && error.code === 'MODEL_CAPACITY') ||
        isCodexModelCapacityFailure(rawErrorMessage);
      if (error instanceof AgentSessionRunnerError && !isModelCapacityFailure) {
        await this.client.disconnect().catch(() => undefined);
        throw error;
      }
      const mappedCode: AgentSessionRunnerError['code'] = isModelCapacityFailure
        ? 'MODEL_CAPACITY'
        : mode === 'resume' && PROVIDER_THREAD_NOT_FOUND_PATTERN.test(rawErrorMessage)
          ? 'SESSION_NOT_FOUND'
          : 'RUN_FAILED';
      const mappedMessage = isModelCapacityFailure
        ? CAPACITY_RETRY_MESSAGE
        : mappedCode === 'SESSION_NOT_FOUND'
          ? `Provider session not found while resuming: ${rawErrorMessage}`
          : rawErrorMessage;
      const mapped =
        error instanceof AgentSessionRunnerError && error.code === 'MODEL_CAPACITY'
          ? error
          : new AgentSessionRunnerError(mappedCode, mappedMessage, error);
      const clientSessionIdAtFailure = this.client.getSessionId();
      if (mappedCode === 'SESSION_NOT_FOUND') {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.codex.run_prompt.session_not_found_diagnostics',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            resolvedProviderSessionId,
            clientSessionIdAtFailure,
            rawProviderErrorMessage: rawErrorMessage,
          },
        );
      }

      // Persist provider identity on failure so subsequent runs can resume
      // the provider session instead of starting fresh without context.
      const failureProviderSessionId = clientSessionIdAtFailure ?? resolvedProviderSessionId;
      if (failureProviderSessionId && failureProviderSessionId !== session.provider_session_id) {
        try {
          await withSessionWriteLockRetry('update_provider_identity_on_failure', async () =>
            this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
              providerSessionId: failureProviderSessionId,
              providerConversationId: null,
              providerSessionAgentId: session.provider_session_agent_id ?? null,
            }),
          );
          requestContext.log(
            this.logger,
            'debug',
            'local.runner.codex.provider_session_id.failure_write',
            {
              runId,
              sessionId: session.agentic_session_id,
              providerSessionIdWritten: failureProviderSessionId,
              providerConversationIdWritten: null,
            },
          );
        } catch (identityWriteError) {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.codex.provider_session_id.failure_write_error',
            {
              runId,
              sessionId: session.agentic_session_id,
              error: toErrorMessage(identityWriteError),
            },
          );
        }
      }

      runCompleted = true;
      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'system',
        event_type: 'run_completed',
        state_version: 1,
        payload: {
          mode,
          provider_session_id: failureProviderSessionId,
          provider_conversation_id: null,
          error: mapped.message,
          code: mapped.code,
        },
      });
      this.emitRawEvent({
        source: 'local',
        eventType: 'run_completed',
        timestamp: new Date().toISOString(),
        sessionId: session.agentic_session_id,
        agentId: null,
        payload: {
          error: mapped.message,
          code: mapped.code,
        },
      });
      await withSessionWriteLockRetry('set_status_idle', async () =>
        this.runStore.updateRunStatus(session.agentic_session_id, 'idle'),
      );
      if (!signal?.aborted) {
        requestContext.log(this.logger, 'error', 'local.runner.codex.run_prompt.failed', {
          runId,
          sessionId: session.agentic_session_id,
          durationMs: Date.now() - startedAt,
          error: mapped,
          ...(isModelCapacityFailure ? { rawProviderErrorMessage: rawErrorMessage } : {}),
        });
      }
      await this.client.disconnect().catch(() => undefined);
      throw mapped;
    } finally {
      await this.providerUsageCapture.flush();
      await this.executionCapture?.session.close();
    }
  }

  public async resumeSession({
    reportingRepair,
    session,
    prompt,
    attachmentRunId,
    attachments = [],
    skillSelection,
    signal,
    model,
    reasoningEffort,
    skipPermissions,
    mcpToolUseCase,
    additionalAllowedTools,
    browserMcpMount,
    platformMcpProxyMount,
    workspace,
  }: ResumeArgs): Promise<AgentRunResult> {
    const rawPersistedProviderSessionId = readTrimmed(session.provider_session_id);
    const resolvedProviderSessionId = nativeProviderSessionId(rawPersistedProviderSessionId);
    if (!resolvedProviderSessionId) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.codex.resume.missing_provider_session_id',
        {
          sessionId: session.agentic_session_id,
          providerSessionId: session.provider_session_id,
        },
      );
      throw new AgentSessionRunnerError(
        'PROVIDER_SESSION_ID_MISSING',
        `Session ${session.agentic_session_id} does not have a provider session id.`,
      );
    }
    requestContext.log(this.logger, 'debug', 'local.runner.codex.resume.accepted', {
      sessionId: session.agentic_session_id,
      providerSessionId: resolvedProviderSessionId,
      promptProvided: Boolean(prompt?.trim().length),
    });
    requestContext.log(this.logger, 'debug', 'local.runner.codex.resume.mcp_surface', {
      sessionId: session.agentic_session_id,
      sessionPromptType: session.promptType ?? null,
      providerSessionId: resolvedProviderSessionId,
      effectiveMcpToolUseCase: mcpToolUseCase ?? 'coding',
      additionalAllowedTools: additionalAllowedTools ?? [],
      additionalAllowedToolCount: additionalAllowedTools?.length ?? 0,
    });

    return this.runPrompt({
      ...(reportingRepair ? { reportingRepair } : {}),
      session,
      ...(attachmentRunId ? { attachmentRunId } : {}),
      attachments,
      prompt: prompt?.trim().length ? prompt : DEFAULT_RESUME_PROMPT,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(skipPermissions !== undefined ? { skipPermissions } : {}),
      ...(mcpToolUseCase ? { mcpToolUseCase } : {}),
      ...(additionalAllowedTools && additionalAllowedTools.length > 0
        ? { additionalAllowedTools }
        : {}),
      ...(browserMcpMount ? { browserMcpMount } : {}),
      ...(platformMcpProxyMount ? { platformMcpProxyMount } : {}),
      ...(skillSelection ? { skillSelection } : {}),
      ...(workspace ? { workspace } : {}),
      ...(signal ? { signal } : {}),
    });
  }

  public async submitPermissionDecision({
    session,
    dispatch,
  }: PermissionDecisionDispatchArgs): Promise<PermissionDecisionDispatchResult> {
    if (dispatch.agentType !== 'codex') {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Codex runner received unsupported permission decision agent type: ${dispatch.agentType}.`,
      );
    }

    const pendingPermission = this.pendingPermissionRequests.get(dispatch.routing.requestId);
    if (!pendingPermission) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.codex.permission_decision.request_not_found',
        {
          runId: dispatch.routing.runId,
          requestId: dispatch.routing.requestId,
          sessionId: dispatch.routing.sessionId,
          pendingRequestIds: Array.from(this.pendingPermissionRequests.keys()),
        },
      );
      return { delivered: false, outcome: 'stale', reason: 'request_not_found' };
    }
    if (pendingPermission.sessionId !== dispatch.routing.sessionId) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.codex.permission_decision.session_mismatch',
        {
          runId: dispatch.routing.runId,
          requestId: dispatch.routing.requestId,
          expectedSessionId: pendingPermission.sessionId,
          receivedSessionId: dispatch.routing.sessionId,
        },
      );
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Codex permission response sessionId ${dispatch.routing.sessionId} does not match pending request session ${pendingPermission.sessionId}.`,
      );
    }

    requestContext.log(this.logger, 'debug', 'local.runner.codex.permission_decision.dispatching', {
      runId: dispatch.routing.runId,
      sessionId: dispatch.routing.sessionId,
      requestId: dispatch.routing.requestId,
      rawRequestId: pendingPermission.rawRequestId,
      decision: dispatch.decision,
      callbackType: dispatch.callbackType,
      clientSessionId: this.client.getSessionId(),
    });
    this.pendingPermissionRequests.delete(dispatch.routing.requestId);
    const shouldPersistMcpApproval =
      pendingPermission.kind === 'mcp_elicitation' &&
      (dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist') &&
      (pendingPermission.mcpServerName === null ||
        !HEYHEY_MCP_SERVER_NAMES.has(pendingPermission.mcpServerName));
    const codexCommandDecision =
      dispatch.decision === 'deny'
        ? 'decline'
        : dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist'
          ? 'acceptForSession'
          : 'accept';
    const shouldAccept = codexCommandDecision !== 'decline';
    const responseResult: Record<string, unknown> =
      pendingPermission.kind === 'mcp_elicitation'
        ? {
            action: shouldAccept ? 'accept' : 'decline',
            content: null,
            _meta: shouldPersistMcpApproval
              ? { [CODEX_MCP_PERSIST_KEY]: CODEX_MCP_PERSIST_ALWAYS }
              : null,
          }
        : {
            decision: codexCommandDecision,
          };
    try {
      this.client.submitClientResponse(pendingPermission.rawRequestId, responseResult);
    } catch (error) {
      requestContext.log(
        this.logger,
        'error',
        'local.runner.codex.permission_decision.transport_failed',
        {
          runId: dispatch.routing.runId,
          sessionId: dispatch.routing.sessionId,
          requestId: dispatch.routing.requestId,
          rawRequestId: pendingPermission.rawRequestId,
          error: toErrorMessage(error),
        },
      );
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Failed to deliver Codex permission decision ${
          dispatch.routing.requestId
        }: ${toErrorMessage(error)}`,
        error,
      );
    }

    if (
      pendingPermission.kind === 'approval' &&
      pendingPermission.permissionType &&
      (dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist')
    ) {
      this.alwaysApprovedPermissionTypes.add(pendingPermission.permissionType);
      requestContext.log(
        this.logger,
        'debug',
        'local.runner.codex.permission_decision.remembered',
        {
          runId: dispatch.routing.runId,
          sessionId: dispatch.routing.sessionId,
          requestId: dispatch.routing.requestId,
          permissionType: pendingPermission.permissionType,
          decision: dispatch.decision,
          alwaysApprovedPermissionTypes: Array.from(this.alwaysApprovedPermissionTypes),
        },
      );
    }

    await recordPermissionDecisionSubmitted({
      runStore: this.runStore,
      emitRawEvent: this.emitRawEvent,
      agenticSessionId: session.agentic_session_id,
      dispatch,
    });
    requestContext.log(this.logger, 'debug', 'local.runner.codex.permission_decision.dispatched', {
      runId: dispatch.routing.runId,
      sessionId: dispatch.routing.sessionId,
      requestId: dispatch.routing.requestId,
      decision: dispatch.decision,
      callbackType: dispatch.callbackType,
    });

    return {
      delivered: true,
      callbackType: dispatch.callbackType,
    };
  }

  // Report context usage for an idle Codex app-server thread by resuming it
  // without starting a turn and consuming the app-server's restored
  // `thread/tokenUsage/updated` notification.
  public async getContextUsageByResume({
    session,
    providerSessionId: requestedProviderSessionId,
  }: ResumeArgs): Promise<LocalContextData> {
    const rawPersistedId = requestedProviderSessionId
      ? readTrimmed(requestedProviderSessionId)
      : readTrimmed(session.provider_session_id);
    const persistedProviderSessionId = nativeProviderSessionId(rawPersistedId);
    requestContext.log(this.logger, 'debug', 'local.runner.codex.context_usage_resume.started', {
      sessionId: session.agentic_session_id,
      requestedProviderSessionId: requestedProviderSessionId ?? null,
      persistedProviderSessionId,
    });
    if (!persistedProviderSessionId) {
      throw new AgentSessionRunnerError(
        'PROVIDER_SESSION_ID_MISSING',
        `Session ${session.agentic_session_id} has no resumable provider session id.`,
      );
    }

    const hasService = (session.services?.length ?? 0) > 0;
    const workspace = hasService
      ? await resolveRunWorkspace({
          session,
          repoStore: this.repoStore,
          logger: this.logger,
        })
      : null;
    if (workspace !== null && !workspace.ok) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.codex.context_usage_resume.workspace_failed',
        {
          sessionId: session.agentic_session_id,
          launchServiceId: session.launchServiceId,
          serviceCount: session.services?.length ?? 0,
          resolutionCode: workspace.code,
        },
      );
      throw workspaceResolutionError(workspace);
    }
    const runCwd = workspace?.ok ? workspace.cwd : process.cwd();

    const resumeClient = new CodexSdkClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTEXT_USAGE_RESUME_TIMEOUT_MS);
    try {
      // The SDK validates this payload against the generated context schema,
      // but its inferred type widens optional fields to `T | undefined`.
      const contextData = (await resumeClient.getContextUsageByResume(
        persistedProviderSessionId,
        {
          prompt: '',
          cwd: runCwd,
        },
        { signal: controller.signal },
      )) as LocalContextData;
      requestContext.log(
        this.logger,
        'debug',
        'local.runner.codex.context_usage_resume.succeeded',
        {
          sessionId: session.agentic_session_id,
          providerSessionId: persistedProviderSessionId,
          totalTokens: contextData.totalTokens,
          percentage: contextData.percentage,
        },
      );
      return {
        ...contextData,
        categories: contextData.categories.map(({ isDeferred, ...category }) => ({
          ...category,
          ...(isDeferred === undefined ? {} : { isDeferred }),
        })),
      };
    } catch (err: unknown) {
      if (err instanceof CodexNoContextSnapshotError) {
        throw new AgentSessionRunnerError(
          'NO_ACTIVE_SESSION',
          'No context usage data is available. No token usage snapshot has been received on this session.',
          err,
        );
      }
      const message = toErrorMessage(err);
      requestContext.log(this.logger, 'warn', 'local.runner.codex.context_usage_resume.failed', {
        sessionId: session.agentic_session_id,
        providerSessionId: persistedProviderSessionId,
        error: message,
      });
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        message || 'Codex context-usage resume failed.',
        err,
      );
    } finally {
      clearTimeout(timer);
      await resumeClient.disconnect();
    }
  }

  // Report context-window usage for the live Codex app-server by delegating to
  // the connected native this.client, which synthesizes LocalContextData from the
  // latest `thread/tokenUsage/updated` notification. Mirrors the Claude runner:
  // guard the runner-side invariant that a live child exists and matches the
  // requested provider session (when one is supplied), then read at the single
  // already-validated boundary.
  public async getContextUsage(providerSessionId?: string): Promise<LocalContextData> {
    const activeSessionId = readTrimmed(this.client.getSessionId());
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.codex.context_usage.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active Codex SDK session is available to report context usage.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active Codex SDK session ${activeSessionId}.`,
      );
    }

    try {
      // The native this.client validates the payload against the generated
      // LocalContextData shape, but its inferred type widens optional fields to
      // `T | undefined`, which `exactOptionalPropertyTypes` rejects against the
      // DTO's bare-optional props. Reconcile at this single, already-validated
      // boundary, as the Claude runner does.
      return this.client.getContextUsage() as LocalContextData;
    } catch (err: unknown) {
      // A live session that has not yet emitted a usable token-usage snapshot is
      // surfaced as NO_ACTIVE_SESSION so the service layer treats it the same as
      // a child that exited between turns (there is no Codex resume path).
      if (err instanceof CodexNoContextSnapshotError) {
        throw new AgentSessionRunnerError(
          'NO_ACTIVE_SESSION',
          'No context usage data is available. No token usage snapshot has been received on this session.',
          err,
        );
      }
      throw err;
    }
  }

  // Compact the live Codex app-server's conversation history. RUN_BUSY is
  // enforced upstream by Run.compact(); here we only guard the runner-side
  // invariant that the live child matches the requested provider session
  // (when one is supplied) and translate SDK-this.client failures into runner
  // errors. The boundary itself surfaces downstream via the `thread/compacted`
  // → `status:compact_boundary` event mapping.
  public async compact(providerSessionId?: string): Promise<void> {
    const activeSessionId = readTrimmed(this.client.getSessionId());
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.codex.compact.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active Codex SDK session is available to compact.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active Codex SDK session ${activeSessionId}.`,
      );
    }

    try {
      await this.client.compact();
      requestContext.log(this.logger, 'debug', 'local.runner.codex.compact.succeeded', {
        activeSessionId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      requestContext.log(this.logger, 'warn', 'local.runner.codex.compact.failed', {
        activeSessionId,
        error: message,
      });
      if (/turn is in flight/i.test(message)) {
        throw new AgentSessionRunnerError(
          'RUN_BUSY',
          'Codex compaction cannot start while a turn is in flight.',
          err,
        );
      }
      if (/no active session|stdin not writable/i.test(message)) {
        throw new AgentSessionRunnerError('NO_ACTIVE_SESSION', message, err);
      }
      if (err instanceof CodexCompactTimeoutError || /disconnected/i.test(message)) {
        throw new AgentSessionRunnerError('RUN_FAILED', message, err);
      }
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        message || 'Codex compact request failed.',
        err,
      );
    }
  }

  // Release the Run-scoped Codex child process and reject any pending
  // compaction. Invoked from Run.cleanup() so the native app-server cannot
  // outlive the Run that started it.
  public async dispose(): Promise<void> {
    await this.client.disconnect();
    await this.providerUsageCapture.flush();
    await this.executionCapture?.session.close();
  }

  // Per-turn handlers clear Run-level provider identity after each Turn. Give
  // that lifecycle an explicit runner-side reset as well; disconnect is
  // idempotent when this.runPrompt already closed the native app-server.
  public async discardSession(): Promise<void> {
    const discardedProviderSessionId = this.client.getSessionId();
    await this.client.disconnect();
    await this.executionCapture?.session.close();
    requestContext.log(this.logger, 'info', 'local.runner.codex.session.discarded', {
      discardedProviderSessionId,
    });
  }
}
