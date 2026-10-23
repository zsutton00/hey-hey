import type { RunAttachmentContent } from '@hey-hey/ui-common/agents';
import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { buildBrowserToolsMcpConfig, BROWSER_ALLOWED_TOOLS } from '../../browser-tools/mcp-config';
import type { BrowserMcpMount } from '../../browser-tools/browser-mcp-access';
import crypto from 'node:crypto';
import {
  getOpencodeModelRef,
  OPENCODE_DEFAULT_MODEL_ID,
  type OpencodeModelRef,
} from '@hey-hey/ui-common/capability-catalog';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import {
  nativeProviderSessionId,
  recordPermissionDecisionSubmitted,
  workspaceResolutionError,
} from '../runner-common';
import { isRecord, readTrimmedString as readTrimmed } from '../provider-event-normalization-core';
import type { Run } from '../../../run/run';
import { NOOP_LOGGER, type ServerLogger } from '../../../server/logger';
import { requestContext } from '../../../server/request-context';
import {
  loadProviderEventNormalizationConfig,
  normalizeProviderEventPayload,
  type NormalizedProviderFacts,
} from '../provider-event-normalization';
import {
  AgentSessionRunnerError,
  type AgentRunResult,
  type AgentSessionRunner,
  type PermissionDecisionDispatchArgs,
  type PermissionDecisionDispatchResult,
  type PromptOnceArgs,
  type ResumeArgs,
  type RunPromptArgs,
} from '../session-runner';
import { resolveRunWorkspace } from '../../run-scope';
import {
  describeOpenCodeCredentialSources,
  OpenCodeServerProcess,
} from './opencode-server-launcher';
import {
  opencodeExternalDirectoryPermissionAskedProperties,
  opencodeMessageUpdatedProperties,
  opencodeMessagePartUpdatedProperties,
  opencodeProvidersResponse,
  type OpencodePromptRequest,
  opencodeSessionMessage,
  opencodeSessionMessagesResponse,
  opencodeSessionSummarizeResponse,
  parseOpencodeSseLine,
  type OpencodeMessageInfo,
  type OpencodeMessageTokens,
} from './opencode-schemas';
import type { OAuthClient } from '../../../auth/index';
import {
  buildMcpServerConfig,
  MCP_SERVER_NAME,
  PROJECT_REPORT_MCP_TOOLS,
  type McpToolUseCase,
  resolveHintPromptAccess,
} from '../../mcp-server-config';
import type { LocalAgentEndpoint } from '../../../server/local-base-url';
import type { SubmissionToolRegistry } from '../../submission-tools/registry';
import { buildSubmissionToolsMcpConfig } from '../../submission-tools/mcp-config';
import { buildPlatformMcpProxyMcpConfig } from '../../platform-mcp-proxy/mcp-config';
import type { PlatformMcpProxyMount } from '../../platform-mcp-proxy/turn-proxy';
import { buildPlatformSystemPrompt } from '../../prompts/common';
import { readSessionStartContext } from '../../prompts/session-start-context';
import type { ProviderPhase } from '../../../run/types';
import type { ToolRuleStore } from '../../../session/tool-rules';
import {
  LocalPromptType,
  type LocalContextData,
} from '../../../shared/agent-bridge-contract/contract';
import {
  composeFreshPlatformPromptDelivery,
  PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE,
} from '../platform-prompt-delivery';
import type { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';

const OPENCODE_QUICK_TASK_EXECUTION_GUIDANCE = [
  'OpenCode coding-session execution instruction:',
  'Work directly on the task described in the user message.',
  'Inspect the authorized repository, implement the requested change, and verify it with appropriate checks.',
  'Do not repeat or summarize the task context as your response; use tools to perform the work.',
].join('\n');

const buildOpenCodeFreshSystemPrompt = (
  platformSystemPrompt: string | null,
  promptType: string | undefined,
): string | null => {
  const prompts = [
    platformSystemPrompt,
    promptType === LocalPromptType.Quick ? OPENCODE_QUICK_TASK_EXECUTION_GUIDANCE : null,
  ].filter((value): value is string => value !== null);

  return prompts.length > 0 ? prompts.join('\n\n') : null;
};

export interface OpenCodeAgentSessionRunnerDependencies {
  runStore: RunStore;
  repoStore: RepoMappingStore;
  localAgentEndpoint: LocalAgentEndpoint;
  submissionToolRegistry: SubmissionToolRegistry;
  toolRuleStore: ToolRuleStore;
  oauthClient?: OAuthClient;
  agentOutputOwner?: Run;
  logger?: ServerLogger;
  /** Longest a turn may go without a provider event before it fails. */
  inactivityTimeoutMs?: number;
}

interface PendingOpencodePermissionRequest {
  requestId: string;
  sessionId: string;
  createdAt: string;
  permission: string;
  toolName: string;
  handle: OpenCodeServerProcess;
}

interface OpencodeContextSnapshot {
  providerSessionId: string;
  providerID: string;
  modelID: string;
  tokens: OpencodeMessageTokens;
}

const DEFAULT_RESUME_PROMPT = 'Continue from the latest state and complete the task.';
const HEYHEY_PLATFORM_MCP_NAME = 'heyhey-platform';
const SUBMISSION_TOOLS_MCP_NAME = 'heyhey-submission-tools';
const OPENCODE_EXTERNAL_DIRECTORY_PERMISSION = 'external_directory';
// OpenCode itself tolerates 15 minutes between streamed model chunks, so a
// shorter limit would kill turns that are legitimately reasoning in silence.
const DEFAULT_OPENCODE_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const GLOB_CHARACTER = /[*?\[\]{}]/;

export const resolveOpenCodeRepositoryResearchTools = (
  delegation: 'allowed' | 'disabled',
): Readonly<Record<string, boolean>> => ({
  read: true,
  glob: true,
  grep: true,
  list: true,
  task: delegation === 'allowed',
  bash: false,
  edit: false,
  write: false,
  patch: false,
  apply_patch: false,
});

export const resolveOpenCodeProjectReportTools = (
  hasCreateReportSubmission: boolean,
  hasPlatformReads: boolean,
): Readonly<Record<string, boolean>> => ({
  '*': false,
  ...(hasCreateReportSubmission ? { [`${SUBMISSION_TOOLS_MCP_NAME}_create_report`]: true } : {}),
  ...(hasPlatformReads
    ? Object.fromEntries(
        PROJECT_REPORT_MCP_TOOLS.map((toolName) => [`${MCP_SERVER_NAME}_${toolName}`, true]),
      )
    : {}),
});

const getDirectoryQueryParam = (directory: string): string => {
  return `directory=${encodeURIComponent(directory)}`;
};

const buildApiUrl = (handle: OpenCodeServerProcess, path: string): string => {
  const separator = path.includes('?') ? '&' : '?';
  return `${handle.baseUrl}${path}${separator}${getDirectoryQueryParam(handle.directory)}`;
};

/**
 * OpenCode's own default model is used only when no model was selected or the
 * Default row was chosen; any other model must be in this machine's catalog.
 */
const resolveOpencodeModelRef = (
  selectedModel: string | null | undefined,
): OpencodeModelRef | null => {
  if (!selectedModel || selectedModel === OPENCODE_DEFAULT_MODEL_ID) return null;
  const modelRef = getOpencodeModelRef(selectedModel);
  if (!modelRef) {
    throw new AgentSessionRunnerError(
      'RUN_FAILED',
      `OpenCode model "${selectedModel}" is not in this machine's model catalog, so it cannot be launched.`,
    );
  }
  return modelRef;
};

// Permission strings on opencode `permission.asked` events for MCP-backed
// tools are prefixed with `mcp__<server>__<tool>`. Strip the platform prefix
// so the same alwaysAllowedTools Set used by the Claude runner matches.
const stripMcpPrefix = (toolName: string): string => {
  const platformPrefix = `mcp__${HEYHEY_PLATFORM_MCP_NAME}__`;
  if (toolName.startsWith(platformPrefix)) {
    return toolName.slice(platformPrefix.length);
  }
  const submissionPrefix = `mcp__${SUBMISSION_TOOLS_MCP_NAME}__`;
  if (toolName.startsWith(submissionPrefix)) {
    return toolName.slice(submissionPrefix.length);
  }
  return toolName;
};

const externalDirectoryPatternTarget = (pattern: string): string | null => {
  const firstGlobIndex = pattern.search(GLOB_CHARACTER);
  if (firstGlobIndex === -1) {
    return pattern;
  }
  const literalPrefix = pattern.slice(0, firstGlobIndex);
  if (literalPrefix.length === 0) {
    return null;
  }
  if (literalPrefix.endsWith('/') || literalPrefix.endsWith('\\')) {
    return literalPrefix;
  }
  const lastSeparatorIndex = Math.max(
    literalPrefix.lastIndexOf('/'),
    literalPrefix.lastIndexOf('\\'),
  );
  return lastSeparatorIndex === -1 ? null : literalPrefix.slice(0, lastSeparatorIndex + 1);
};

export class OpenCodeAgentSessionRunner implements AgentSessionRunner {
  private activeProviderSessionId: string | null = null;
  private latestContextSnapshot: OpencodeContextSnapshot | null = null;
  private selectedModelRef: { providerID: string; modelID: string } | null = null;
  private workspaceWriteBoundary: RunWorkspaceWriteBoundary | null = null;
  private skipAllPermissions = false;
  private readonly pendingPermissionRequests = new Map<string, PendingOpencodePermissionRequest>();
  private readonly normalizationConfig = loadProviderEventNormalizationConfig();

  private activeBrowserAllowedTools = new Set<string>();
  private readonly alwaysAllowedTools = new Set<string>([
    // search
    'unified_search',
    'task_search',
    'search_features',
    'plan_search',
    'search_design_docs',
    // context
    'get_context',
    'get_agent_sessions',
    'list_services',
    // implementation hints
    'search_implementation_hints',
    'create_implementation_hint',
    'edit_implementation_hint',
    'delete_implementation_hint',
    // proposals
    'create_work_item',
    'edit_work_item',
    'edit_tasks',
    'create_design_doc',
    'edit_design_doc',
    'update_proposal',
    'delete_proposal',
  ]);

  // Run-scoped handle: a single opencode server is launched per Run on first
  // use and torn down via this.dispose() when the Run cleans up. We do not share
  // servers across Runs — each Run owns its own child process.
  private serverHandle: OpenCodeServerProcess | null = null;
  private serverReadOnly = false;
  private serverDirectory: string | null = null;
  // Track whether MCP servers have been registered against the active server
  // so we don't re-add them on every Turn.
  private mcpRegisteredForServer: OpenCodeServerProcess | null = null;
  private mcpRegisteredPlatformProxyUrl: string | null = null;
  // Run-lived assembled platform system prompt, built once on the mint turn
  // from the fresh session's work-item type definitions. Delivered as the
  // `system` field on the mint turn only — OpenCode persists it for the
  // duration of the provider session, so resume turns must not re-supply it.
  private platformSystemPrompt: string | null = null;
  private readonly attachmentContentReader = new RunAttachmentContentReader();
  private readonly runStore: RunStore;
  private readonly repoStore: RepoMappingStore;
  private readonly localAgentEndpoint: LocalAgentEndpoint;
  private readonly submissionToolRegistry: SubmissionToolRegistry;
  private readonly toolRuleStore: ToolRuleStore;
  private readonly oauthClient: OAuthClient | undefined;
  private readonly agentOutputOwner: Run | undefined;
  private readonly logger: ServerLogger;
  private readonly inactivityTimeoutMs: number;

  public constructor(dependencies: OpenCodeAgentSessionRunnerDependencies) {
    this.runStore = dependencies.runStore;
    this.repoStore = dependencies.repoStore;
    this.localAgentEndpoint = dependencies.localAgentEndpoint;
    this.submissionToolRegistry = dependencies.submissionToolRegistry;
    this.toolRuleStore = dependencies.toolRuleStore;
    this.oauthClient = dependencies.oauthClient;
    this.agentOutputOwner = dependencies.agentOutputOwner;
    this.logger = dependencies.logger ?? NOOP_LOGGER;
    this.inactivityTimeoutMs =
      dependencies.inactivityTimeoutMs ?? DEFAULT_OPENCODE_INACTIVITY_TIMEOUT_MS;
    for (const rule of this.toolRuleStore.load()) {
      this.alwaysAllowedTools.add(rule);
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

  private readonly persistPermissionDecision = async (
    runId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'allow_always',
    actor: 'app' | 'system' = 'system',
  ): Promise<void> => {
    await this.runStore.appendEvent(runId, {
      run_id: runId,
      actor,
      event_type: 'agent_output',
      state_version: 1,
      payload: {
        messageType: 'permission_decision_ui',
        requestId,
        decision,
        decidedAt: new Date().toISOString(),
      },
    });
  };

  private readonly emitProcessingStatus = (input: {
    kind: 'loading.update' | 'tool.progress' | 'run.status';
    loadingText?: string;
    toolName?: string;
    toolPhase?: string;
    status?: string;
    phase?: ProviderPhase;
  }): void => {
    this.emitRawEvent({
      source: 'local',
      eventType: 'processing_status',
      timestamp: new Date().toISOString(),
      sessionId: this.activeProviderSessionId,
      agentId: 'opencode',
      payload: {
        kind: input.kind,
        loadingText: input.loadingText ?? null,
        toolName: input.toolName ?? null,
        toolPhase: input.toolPhase ?? null,
        status: input.status ?? null,
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
      },
    });
  };

  private readonly rejectPendingPermissionRequests = (reason: string): void => {
    if (this.pendingPermissionRequests.size === 0) {
      return;
    }

    const requestIds = Array.from(this.pendingPermissionRequests.keys());
    requestContext.log(
      this.logger,
      'warn',
      'local.runner.opencode.permission_requests.rejecting_all',
      {
        reason,
        count: requestIds.length,
        requestIds,
      },
    );

    const timestamp = new Date().toISOString();
    for (const pending of this.pendingPermissionRequests.values()) {
      this.emitRawEvent({
        source: 'local',
        eventType: 'agent_output',
        timestamp,
        sessionId: pending.sessionId,
        agentId: 'opencode',
        payload: {
          summary: JSON.stringify({
            responseType: 'agent_permission_resolved_v1',
            request_id: pending.requestId,
            resolution: 'cancelled',
            reason,
          }),
          messageType: 'system',
        },
      });
    }
    this.pendingPermissionRequests.clear();
  };

  private readonly ensureServer = async (
    cwd: string,
    workspaceWriteBoundary: RunWorkspaceWriteBoundary | null,
    readOnlyFilesystem = false,
    signal?: AbortSignal,
  ): Promise<OpenCodeServerProcess> => {
    if (
      this.serverHandle &&
      this.serverReadOnly === readOnlyFilesystem &&
      this.serverDirectory === cwd
    ) {
      try {
        const response = await fetch(`${this.serverHandle.baseUrl}/health`, {
          ...(signal ? { signal } : {}),
        });
        if (response.ok) {
          return this.serverHandle;
        }
      } catch {
        // Cached server is dead; fall through to launch a new one.
      }
      try {
        await this.serverHandle.stop();
      } catch {
        // Best effort stop on dead handle.
      }
      this.serverHandle = null;
      this.serverDirectory = null;
      this.mcpRegisteredForServer = null;
      this.mcpRegisteredPlatformProxyUrl = null;
    }

    if (this.serverHandle) {
      await this.serverHandle.stop().catch(() => undefined);
      this.serverHandle = null;
      this.serverDirectory = null;
      this.mcpRegisteredForServer = null;
      this.mcpRegisteredPlatformProxyUrl = null;
    }

    requestContext.log(this.logger, 'info', 'local.runner.opencode.server.launching', { cwd });
    const containment = workspaceWriteBoundary
      ? readOnlyFilesystem
        ? workspaceWriteBoundary.readOnlyProcessContainment()
        : workspaceWriteBoundary.processContainment()
      : undefined;
    requestContext.log(
      this.logger,
      'info',
      'local.runner.opencode.server.credential_sources',
      describeOpenCodeCredentialSources({ ...process.env, ...containment?.env }),
    );
    const handle = await OpenCodeServerProcess.launch({
      directory: cwd,
      ...(containment ? { containment } : {}),
      ...(signal ? { signal } : {}),
    });
    this.serverHandle = handle;
    this.serverReadOnly = readOnlyFilesystem;
    this.serverDirectory = cwd;
    requestContext.log(this.logger, 'info', 'local.runner.opencode.server.launched', {
      baseUrl: handle.baseUrl,
      cwd,
    });
    return handle;
  };

  private readonly addMcpServer = async (
    handle: OpenCodeServerProcess,
    name: string,
    config: { type: 'remote'; url: string; headers?: Record<string, string> },
  ): Promise<void> => {
    const response = await fetch(`${handle.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config: { ...config, enabled: true } }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenCode MCP add failed for ${name}: ${response.status} ${text}`);
    }
  };

  private readonly ensureMcpServers = async (
    handle: OpenCodeServerProcess,
    session: {
      contextMetadata?: { projectId?: string };
      conversationId: string;
      launchServiceId?: string;
      agentic_session_id: string;
    },
    platformProxy: {
      mount?: PlatformMcpProxyMount;
      browserMcpMount?: BrowserMcpMount;
      mcpToolUseCase?: McpToolUseCase;
    },
  ): Promise<void> => {
    const cliBaseUrl = this.localAgentEndpoint.get();
    const browserConfig =
      platformProxy.browserMcpMount && cliBaseUrl
        ? buildBrowserToolsMcpConfig(platformProxy.browserMcpMount, cliBaseUrl)
        : null;
    if (browserConfig) {
      try {
        await this.addMcpServer(handle, browserConfig.serverName, {
          type: 'remote',
          url: browserConfig.serverEntry.url,
        });
      } catch {
        this.logger.warn('browser.opencode.mount_failed');
        this.activeBrowserAllowedTools.clear();
      }
    }
    const platformProxyMcpConfig =
      platformProxy.mount && cliBaseUrl
        ? buildPlatformMcpProxyMcpConfig({
            mount: platformProxy.mount,
            cliBaseUrl,
          })
        : null;
    const platformProxyUrl =
      platformProxyMcpConfig?.mcpServers[HEYHEY_PLATFORM_MCP_NAME]?.url ?? null;

    if (
      this.mcpRegisteredForServer === handle &&
      (platformProxyUrl === null || this.mcpRegisteredPlatformProxyUrl === platformProxyUrl)
    ) {
      return;
    }

    if ((platformProxy.mount && cliBaseUrl) || this.oauthClient) {
      try {
        const mcpConfig =
          platformProxyMcpConfig ??
          (await buildMcpServerConfig(
            this.oauthClient!,
            {
              ...(session.contextMetadata?.projectId
                ? { projectId: session.contextMetadata.projectId }
                : {}),
              conversationId: session.conversationId,
              ...(session.launchServiceId ? { serviceId: session.launchServiceId } : {}),
              agentSessionId: session.agentic_session_id,
            },
            {
              ...(platformProxy.mcpToolUseCase ? { useCase: platformProxy.mcpToolUseCase } : {}),
            },
          ));
        const platformEntry = mcpConfig.mcpServers[HEYHEY_PLATFORM_MCP_NAME] as
          | { type: string; url: string; headers?: Record<string, string> }
          | undefined;
        if (platformEntry && platformEntry.type === 'http') {
          await this.addMcpServer(handle, HEYHEY_PLATFORM_MCP_NAME, {
            type: 'remote',
            url: platformEntry.url,
            ...(platformEntry.headers ? { headers: platformEntry.headers } : {}),
          });
          this.mcpRegisteredPlatformProxyUrl = platformProxyUrl;
        }
      } catch (err: unknown) {
        requestContext.log(this.logger, 'warn', 'local.runner.opencode.mcp_config.failed', {
          error: err,
        });
      }
    } else {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.mcp_config.skipped', {
        sessionId: session.agentic_session_id,
        hasPlatformMcpProxyMount: Boolean(platformProxy.mount),
        hasCliBaseUrl: Boolean(cliBaseUrl),
      });
    }

    const runRegistration = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
    if (runRegistration && cliBaseUrl && runRegistration.tools.length > 0) {
      const submissionConfig = buildSubmissionToolsMcpConfig({
        token: runRegistration.token,
        cliBaseUrl,
        tools: runRegistration.tools,
      });
      const entry = submissionConfig.serverEntry;
      try {
        await this.addMcpServer(handle, submissionConfig.serverName, {
          type: 'remote',
          url: entry.url,
        });
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.opencode.submission_tools.attached',
          {
            sessionId: session.agentic_session_id,
            toolCount: runRegistration.tools.length,
            allowedTools: submissionConfig.allowedTools,
          },
        );
      } catch (err: unknown) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.opencode.submission_tools.attach_failed',
          {
            sessionId: session.agentic_session_id,
            error: err,
          },
        );
      }
    } else if (runRegistration && cliBaseUrl === null) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.opencode.submission_tools.no_base_url',
        {
          sessionId: session.agentic_session_id,
        },
      );
    }

    this.mcpRegisteredForServer = handle;
  };

  private readonly replyPermission = async (
    handle: OpenCodeServerProcess,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
  ): Promise<void> => {
    try {
      const response = await fetch(buildApiUrl(handle, `/permission/${requestId}/reply`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
      if (!response.ok) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.opencode.permission_decision.http_failed',
          {
            requestId,
            status: response.status,
          },
        );
      }
    } catch (error) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.opencode.permission_decision.http_error',
        {
          requestId,
          error,
        },
      );
    }
  };

  private readonly contextSnapshotFromInfo = (
    info: OpencodeMessageInfo,
    providerSessionId = this.activeProviderSessionId,
  ): OpencodeContextSnapshot | null => {
    if (info.role !== 'assistant' || !info.tokens) return null;
    if (!providerSessionId) return null;
    const providerID = readTrimmed(info.providerID) ?? this.selectedModelRef?.providerID ?? null;
    const modelID = readTrimmed(info.modelID) ?? this.selectedModelRef?.modelID ?? null;
    if (!providerID || !modelID) return null;
    return { providerSessionId, providerID, modelID, tokens: info.tokens };
  };

  private readonly buildContextData = async (
    handle: OpenCodeServerProcess,
    snapshot: OpencodeContextSnapshot,
  ): Promise<LocalContextData> => {
    const response = await fetch(buildApiUrl(handle, '/config/providers'));
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode provider catalog request failed: ${response.status} ${text}`,
      );
    }

    const parsed = await (async () => {
      try {
        return opencodeProvidersResponse.safeParse(await response.json());
      } catch (error) {
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          `OpenCode provider catalog response was not valid JSON: ${
            error instanceof Error ? error.message : 'unknown JSON error'
          }`,
          error,
        );
      }
    })();
    if (!parsed.success) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode provider catalog response was invalid: ${parsed.error.message}`,
        parsed.error,
      );
    }

    const provider = parsed.data.providers.find((entry) => entry.id === snapshot.providerID);
    const model = provider?.models[snapshot.modelID];
    const maxTokens = model?.limit.context;
    if (!provider || !model || maxTokens === undefined || maxTokens <= 0) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode provider catalog did not contain a context limit for ${snapshot.providerID}/${snapshot.modelID}.`,
      );
    }

    const totalTokens = snapshot.tokens.input;
    const contextData = {
      categories: [],
      totalTokens,
      maxTokens,
      rawMaxTokens: maxTokens,
      percentage: (totalTokens / maxTokens) * 100,
      gridRows: [],
      model: snapshot.modelID,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: {
        input_tokens: snapshot.tokens.input,
        output_tokens: snapshot.tokens.output,
        cache_creation_input_tokens: snapshot.tokens.cache.write,
        cache_read_input_tokens: snapshot.tokens.cache.read,
      },
    } satisfies LocalContextData;
    return contextData;
  };

  private readonly readSessionMessages = async (
    handle: OpenCodeServerProcess,
    providerSessionId: string,
  ): Promise<OpencodeContextSnapshot> => {
    const response = await fetch(
      buildApiUrl(handle, `/session/${providerSessionId}/message?limit=100`),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new AgentSessionRunnerError(
        response.status === 404 ? 'SESSION_NOT_FOUND' : 'RUN_FAILED',
        `OpenCode session messages request failed: ${response.status} ${text}`,
      );
    }

    const parsed = await (async () => {
      try {
        return opencodeSessionMessagesResponse.safeParse(await response.json());
      } catch (error) {
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          `OpenCode session messages response was not valid JSON: ${
            error instanceof Error ? error.message : 'unknown JSON error'
          }`,
          error,
        );
      }
    })();
    if (!parsed.success) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode session messages response was invalid: ${parsed.error.message}`,
        parsed.error,
      );
    }

    let latest: {
      snapshot: OpencodeContextSnapshot;
      timestamp: number | null;
      index: number;
    } | null = null;
    for (const [index, message] of parsed.data.entries()) {
      const snapshot = this.contextSnapshotFromInfo(message.info, providerSessionId);
      if (!snapshot) continue;
      const timestamp = message.info.time?.completed ?? message.info.time?.created ?? null;
      const isNewer =
        latest === null ||
        (timestamp !== null && (latest.timestamp === null || timestamp >= latest.timestamp)) ||
        (timestamp === null && latest.timestamp === null && index > latest.index);
      if (isNewer) latest = { snapshot, timestamp, index };
    }
    if (!latest) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `OpenCode session ${providerSessionId} has no assistant usage snapshot to report.`,
      );
    }
    return latest.snapshot;
  };

  private readonly summarizeSession = async (
    handle: OpenCodeServerProcess,
    providerSessionId: string,
    snapshot: OpencodeContextSnapshot,
  ): Promise<void> => {
    const response = await fetch(buildApiUrl(handle, `/session/${providerSessionId}/summarize`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerID: snapshot.providerID,
        modelID: snapshot.modelID,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode session summarize failed: ${response.status} ${text}`,
      );
    }

    const parsed = await (async () => {
      try {
        return opencodeSessionSummarizeResponse.safeParse(await response.json());
      } catch (error) {
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          `OpenCode session summarize response was not valid JSON: ${
            error instanceof Error ? error.message : 'unknown JSON error'
          }`,
          error,
        );
      }
    })();
    if (!parsed.success || !parsed.data) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode session summarize response was invalid: ${
          parsed.success ? 'the operation returned false' : parsed.error.message
        }`,
        parsed.success ? undefined : parsed.error,
      );
    }
  };

  private readonly verifyResumableSession = async (
    handle: OpenCodeServerProcess,
    providerSessionId: string | null,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (!providerSessionId) return false;

    let response: Response;
    try {
      response = await fetch(buildApiUrl(handle, `/session/${providerSessionId}`), {
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode resume verification failed for session ${providerSessionId}: ${
          error instanceof Error ? error.message : 'unknown fetch error'
        }`,
        error,
      );
    }
    if (response.ok) {
      requestContext.log(
        this.logger,
        'info',
        'local.runner.opencode.session.resume_probe_verified',
        {
          providerSessionId,
          serverDirectory: handle.directory,
        },
      );
      return true;
    }
    const status = response.status;
    let text: string;
    try {
      text = await response.text();
    } catch {
      text = '(failed to read body)';
    }
    const bodyPreview = text.slice(0, 200);
    requestContext.log(this.logger, 'info', 'local.runner.opencode.session.resume_probe_rejected', {
      providerSessionId,
      serverDirectory: handle.directory,
      status,
      bodyPreview,
    });
    if (status === 404) {
      return false;
    }
    throw new AgentSessionRunnerError(
      'RUN_FAILED',
      `OpenCode resume verification failed for session ${providerSessionId}: ${status} ${text}`,
    );
  };

  private readonly createSession = async (
    handle: OpenCodeServerProcess,
    signal?: AbortSignal,
  ): Promise<string> => {
    const response = await fetch(buildApiUrl(handle, '/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenCode session creation failed: ${response.status} ${text}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const newSessionId = readTrimmed(body['id']);
    if (!newSessionId) {
      throw new Error('OpenCode session creation returned no session id');
    }

    requestContext.log(this.logger, 'debug', 'local.runner.opencode.session.created', {
      providerSessionId: newSessionId,
    });
    return newSessionId;
  };

  private readonly sendPromptAsync = async (
    handle: OpenCodeServerProcess,
    sessionId: string,
    prompt: string,
    systemPrompt: string | null,
    modelRef: { providerID: string; modelID: string } | null,
    variant: string | null,
    tools: Readonly<Record<string, boolean>> | null,
    signal?: AbortSignal,
    attachments: readonly RunAttachmentContent[] = [],
  ): Promise<void> => {
    const body = {
      parts: [{ type: 'text', text: prompt }, ...opencodeAttachmentParts(attachments)],
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(modelRef ? { model: modelRef } : {}),
      ...(variant ? { variant } : {}),
      ...(tools ? { tools } : {}),
    } satisfies OpencodePromptRequest;
    const response = await fetch(buildApiUrl(handle, `/session/${sessionId}/prompt_async`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`OpenCode prompt failed: ${response.status}`);
    }
  };

  private readonly subscribeToEvents = async (
    handle: OpenCodeServerProcess,
    sessionId: string,
    runId: string,
    agenticSessionId: string,
    signal: AbortSignal,
    onTerminal: () => void,
  ): Promise<void> => {
    const userMessageIds = new Set<string>();
    const response = await fetch(buildApiUrl(handle, '/event'), {
      headers: { Accept: 'text/event-stream' },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`OpenCode event subscription failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';

    let bufferedAssistantText = '';
    let lastAssistantTextKind: 'text' | 'reasoning' | null = null;
    let lastAssistantTextPartFinal: boolean | null = null;
    let firstAssistantUsageLogged = false;
    let firstProviderEventReceived = false;
    let lastProcessingKind: ProviderPhase | null = null;
    let terminalObserved = false;

    // Inactivity watchdog. Only events for this provider session count as
    // activity (heartbeats and other sessions' events do not). It stays quiet
    // while a tool call is running or a permission decision is pending, since
    // OpenCode legitimately emits nothing then.
    const toolsInFlight = new Set<string>();
    let lastEventType: string | null = null;
    let lastEventAt = Date.now();
    let stallTimer: NodeJS.Timeout | undefined;
    let stallError: AgentSessionRunnerError | null = null;
    const armStallTimer = (): void => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(onStallTimer, this.inactivityTimeoutMs);
    };
    const onStallTimer = (): void => {
      if (toolsInFlight.size > 0 || this.pendingPermissionRequests.size > 0) {
        armStallTimer();
        return;
      }
      const silentMs = Date.now() - lastEventAt;
      requestContext.log(this.logger, 'error', 'local.runner.opencode.inactivity_timeout', {
        runId,
        sessionId: agenticSessionId,
        providerSessionId: sessionId,
        silentMs,
        lastEventType,
      });
      stallError = new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode produced no events for ${Math.round(silentMs / 60_000)} minutes (last event: ${lastEventType ?? 'none'}). The model request may be stalled or rate limited.`,
      );
      // Cancelling ends the pending read, so the loop exits and throws stallError.
      void reader.cancel().catch(() => undefined);
    };

    const handleAssistantMessageUpdated = (info: OpencodeMessageInfo): void => {
      if (info.role !== 'assistant' || !info.tokens) return;
      const snapshot = this.contextSnapshotFromInfo(info);
      if (snapshot) this.latestContextSnapshot = snapshot;

      const inputTokens = info.tokens.input;
      const outputTokens = info.tokens.output;
      const cacheReadInputTokens = info.tokens.cache.read;
      const cacheCreationInputTokens = info.tokens.cache.write;

      if (
        inputTokens === 0 &&
        outputTokens === 0 &&
        cacheReadInputTokens === 0 &&
        cacheCreationInputTokens === 0
      ) {
        return;
      }

      // Use setRunTokenUsage so cumulative totals (assistant message carries
      // running totals across the run, not per-turn deltas) overwrite the
      // session record. Mirrors the Claude runner's `result` handling.
      void this.runStore
        .setRunTokenUsage(agenticSessionId, {
          inputTokens,
          outputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
        })
        .catch((err: unknown) => {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.opencode.token-usage.persist-failed',
            { runId, error: err },
          );
        });

      if (!firstAssistantUsageLogged) {
        firstAssistantUsageLogged = true;
        requestContext.log(this.logger, 'info', 'local.runner.opencode.prompt-usage', {
          runId,
          sessionId: agenticSessionId,
          inputTokens,
          outputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
        });
      } else {
        requestContext.log(this.logger, 'debug', 'local.runner.opencode.token-usage.accumulated', {
          runId,
          inputTokens,
          outputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
        });
      }
    };

    const logToolResultErrorIfPresent = (
      props: Record<string, unknown>,
      eventType: string,
      eventSessionId: string,
    ): void => {
      const part = isRecord(props['part']) ? props['part'] : null;
      if (!part || part['type'] !== 'tool') return;
      const state = isRecord(part['state']) ? part['state'] : null;
      if (!state || state['status'] !== 'error') return;

      const toolName = readTrimmed(part['tool']) ?? 'unknown_tool';
      const callId = readTrimmed(part['callID']) ?? null;
      const errorText = readTrimmed(state['error']);
      const input = isRecord(state['input']) ? state['input'] : null;

      requestContext.log(this.logger, 'error', 'local.runner.opencode.tool_result.error', {
        runId,
        agenticSessionId,
        providerSessionId: eventSessionId,
        eventType,
        toolUseId: callId,
        toolName,
        toolInput: input,
        errorText,
        rawEvent: props,
      });
    };

    const processLine = async (line: string): Promise<void> => {
      if (terminalObserved) return;
      const parsed = parseOpencodeSseLine(line);
      if (!parsed.event) {
        if (parsed.errors.length > 0) {
          requestContext.log(this.logger, 'warn', 'local.runner.opencode.sse.parse_failed', {
            runId,
            errorCount: parsed.errors.length,
            eventLength: line.length,
          });
        }
        return;
      }

      const sseEvent = parsed.event;
      // Drop pure transport heartbeats — they carry no data downstream.
      if (sseEvent.type === 'server.heartbeat') {
        return;
      }

      const timestamp = new Date().toISOString();
      const eventSessionId = readTrimmed(
        (sseEvent.properties as Record<string, unknown>)['sessionID'],
      );

      if (eventSessionId !== sessionId) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.opencode.event.rejected_wrong_session',
          {
            runId,
            expectedProviderSessionId: sessionId,
            receivedProviderSessionId: eventSessionId,
            eventType: sseEvent.type,
          },
        );
        return;
      }

      lastEventType = sseEvent.type;
      lastEventAt = Date.now();
      armStallTimer();

      // message.updated carries assistant token usage. Handled outside the
      // normalizer because the normalizer only wires text/reasoning/tool
      // parts from message.part.updated.
      if (sseEvent.type === 'message.updated') {
        const messageUpdated = opencodeMessageUpdatedProperties.safeParse(sseEvent.properties);
        if (messageUpdated.success) {
          if (messageUpdated.data.info.role === 'user') {
            const id = readTrimmed(messageUpdated.data.info['id']);
            if (id) userMessageIds.add(id);
          }
          handleAssistantMessageUpdated(messageUpdated.data.info);
        }
        return;
      }

      if (sseEvent.type === 'message.part.updated') {
        const part = opencodeMessagePartUpdatedProperties.parse(sseEvent.properties).part;
        if (part.type === 'file' || (part.messageID && userMessageIds.has(part.messageID))) return;
        logToolResultErrorIfPresent(sseEvent.properties, sseEvent.type, eventSessionId);
      }

      const normalized = normalizeProviderEventPayload({
        provider: 'opencode',
        runId,
        eventType: sseEvent.type,
        timestamp,
        sessionId: eventSessionId,
        agentId: 'opencode',
        rawEvent: sseEvent.properties,
        config: this.normalizationConfig,
      });

      void this.runStore
        .appendEvent(agenticSessionId, {
          run_id: runId,
          actor: 'agent',
          event_type: 'agent_output',
          state_version: 1,
          payload: normalized.payload,
        })
        .catch((error: unknown) => {
          requestContext.log(this.logger, 'warn', 'local.runner.opencode.persist_failed', {
            runId,
            error,
          });
        });

      const resolvedEventType = normalized.resolvedEventType ?? sseEvent.type;

      // Track permission requests so this.submitPermissionDecision can find them.
      if (resolvedEventType === 'permission_request_detected') {
        const props = sseEvent.properties as Record<string, unknown>;
        const requestId = readTrimmed(props['id']);
        const permission = readTrimmed(props['permission']) ?? '';
        if (requestId) {
          if (
            permission === OPENCODE_EXTERNAL_DIRECTORY_PERMISSION &&
            this.workspaceWriteBoundary
          ) {
            const externalDirectory =
              opencodeExternalDirectoryPermissionAskedProperties.safeParse(props);
            const patterns = externalDirectory.success ? externalDirectory.data.patterns : [];
            const targets = patterns.map(externalDirectoryPatternTarget);
            if (targets.length === 0 || targets.some((target) => target === null)) {
              requestContext.log(
                this.logger,
                'warn',
                'local.runner.opencode.external_directory.rejected_invalid_pattern',
                { requestId, patterns },
              );
              await this.replyPermission(handle, requestId, 'reject');
              await this.persistPermissionDecision(agenticSessionId, requestId, 'deny');
              return;
            }
            try {
              await this.workspaceWriteBoundary.assertWriteTargets(
                targets.filter((target): target is string => target !== null),
              );
              requestContext.log(
                this.logger,
                'debug',
                'local.runner.opencode.external_directory.validated',
                { requestId, patterns },
              );
            } catch (error) {
              requestContext.log(
                this.logger,
                'warn',
                'local.runner.opencode.external_directory.rejected_out_of_scope',
                { requestId, patterns, error },
              );
              await this.replyPermission(handle, requestId, 'reject');
              await this.persistPermissionDecision(agenticSessionId, requestId, 'deny');
              return;
            }
          }
          const baseToolName = stripMcpPrefix(permission);
          // Auto-approve when the tool is on the allowlist or skipPermissions
          // is set. We still emit the request so the conversation log shows
          // the decision turn, but resolve it immediately without waiting
          // for the user.
          if (
            this.alwaysAllowedTools.has(baseToolName) ||
            this.activeBrowserAllowedTools.has(permission) ||
            this.skipAllPermissions
          ) {
            requestContext.log(
              this.logger,
              'info',
              'local.runner.opencode.permission_request.auto_approved',
              {
                requestId,
                toolName: permission,
                reason: this.skipAllPermissions ? 'skip_permissions' : 'always_allowed',
              },
            );
            void this.replyPermission(handle, requestId, 'once');
            await this.persistPermissionDecision(agenticSessionId, requestId, 'allow');
            return;
          }

          this.pendingPermissionRequests.set(requestId, {
            requestId,
            sessionId: eventSessionId,
            createdAt: timestamp,
            permission,
            toolName: permission,
            handle,
          });
        }
      }

      // Accumulate streamed assistant text from message.part.updated text
      // parts. We do not emit per-part deltas — the buffered total is flushed
      // on session.status idle as a single assistant_complete event below.
      if (normalized.assistantText) {
        const { kind, text, isFinal } = normalized.assistantText;
        if (kind === 'reasoning') {
          requestContext.log(
            this.logger,
            'info',
            'local.runner.opencode.assistant_text.part_observed',
            {
              runId,
              sessionId: agenticSessionId,
              providerSessionId: eventSessionId,
              kind,
              isFinal,
              textLength: text.length,
              bufferedLength: bufferedAssistantText.length,
              bufferSource: 'reasoning_ignored',
            },
          );
        } else {
          let bufferSource: 'final_replaced' | 'non_final_replaced' | 'length_kept';
          if (isFinal) {
            bufferedAssistantText = text;
            bufferSource = 'final_replaced';
          } else if (text.length > bufferedAssistantText.length) {
            bufferedAssistantText = text;
            bufferSource = 'non_final_replaced';
          } else {
            bufferSource = 'length_kept';
          }
          lastAssistantTextKind = kind;
          lastAssistantTextPartFinal = isFinal;
          requestContext.log(
            this.logger,
            'info',
            'local.runner.opencode.assistant_text.part_observed',
            {
              runId,
              sessionId: agenticSessionId,
              providerSessionId: eventSessionId,
              kind,
              isFinal,
              textLength: text.length,
              bufferedLength: bufferedAssistantText.length,
              bufferSource,
            },
          );
        }
      }

      if (normalized.assistantTextDelta) {
        bufferedAssistantText += normalized.assistantTextDelta;
        lastAssistantTextKind = 'text';
        lastAssistantTextPartFinal = false;
        requestContext.log(
          this.logger,
          'info',
          'local.runner.opencode.assistant_text.delta_appended',
          {
            runId,
            sessionId: agenticSessionId,
            providerSessionId: eventSessionId,
            deltaLength: normalized.assistantTextDelta.length,
            bufferedLength: bufferedAssistantText.length,
          },
        );
      }

      if (!firstProviderEventReceived) {
        firstProviderEventReceived = true;
        lastProcessingKind = 'thinking';
        this.emitProcessingStatus({
          kind: 'loading.update',
          loadingText: 'Thinking...',
          phase: 'thinking',
        });
      }

      if (normalized.facts?.toolProgress) {
        toolsInFlight.add(normalized.facts.toolProgress.toolUseId);
      }
      for (const result of normalized.facts?.toolResults ?? []) {
        toolsInFlight.delete(result.toolUseId);
      }

      if (normalized.retry) {
        const { attempt, message, nextAttemptAt, action } = normalized.retry;
        requestContext.log(this.logger, 'warn', 'local.runner.opencode.session.retrying', {
          runId,
          sessionId: agenticSessionId,
          providerSessionId: eventSessionId,
          attempt,
          message,
          nextAttemptAt,
          action,
        });
        const retryInSeconds = Math.max(
          0,
          Math.round((Date.parse(nextAttemptAt) - Date.now()) / 1000),
        );
        lastProcessingKind = null;
        this.emitProcessingStatus({
          kind: 'loading.update',
          loadingText: `Model request failed, retrying in ${retryInSeconds}s (attempt ${attempt}): ${message}`,
          phase: 'thinking',
        });
      } else if (normalized.assistantText && lastProcessingKind !== 'writing') {
        lastProcessingKind = 'writing';
        this.emitProcessingStatus({
          kind: 'loading.update',
          loadingText: 'Writing response...',
          phase: 'writing',
        });
      } else if (
        !normalized.assistantText &&
        !normalized.isTerminal &&
        lastProcessingKind !== 'thinking'
      ) {
        lastProcessingKind = 'thinking';
        this.emitProcessingStatus({
          kind: 'loading.update',
          loadingText: 'Thinking...',
          phase: 'thinking',
        });
      }

      this.emitRawEvent({
        source: 'provider',
        eventType: resolvedEventType,
        timestamp,
        sessionId: eventSessionId,
        agentId: 'opencode',
        payload: normalized.payload,
        ...(normalized.facts ? { providerFacts: normalized.facts } : {}),
      });

      requestContext.log(
        this.logger,
        normalized.diagnostics.success ? 'debug' : 'warn',
        'local.runner.opencode.event.normalization',
        {
          runId,
          sessionId: agenticSessionId,
          eventType: sseEvent.type,
          resolvedEventType,
          canonicalEventType: normalized.diagnostics.canonicalEventType,
          success: normalized.diagnostics.success,
          schemaMismatch: normalized.diagnostics.schemaMismatch,
          errors: normalized.diagnostics.errors,
        },
      );

      if (normalized.providerFailure) {
        terminalObserved = true;
        const { name, message } = normalized.providerFailure;
        requestContext.log(this.logger, 'error', 'local.runner.opencode.session.error', {
          runId,
          sessionId: agenticSessionId,
          providerSessionId: eventSessionId,
          errorName: name,
          message,
          rawEvent: sseEvent.properties,
        });
        throw new AgentSessionRunnerError(
          'RUN_FAILED',
          `OpenCode session error${name ? ` (${name})` : ''}: ${message}`,
        );
      }

      if (normalized.isTerminal) {
        terminalObserved = true;
        // Flush buffered assistant text as a single agent_output with
        // taskComplete:true so src/server/runtime/normalize.ts maps it to
        // kind:'assistant_complete'. Mirrors the claude runner behaviour.
        if (bufferedAssistantText.length > 0) {
          requestContext.log(this.logger, 'info', 'local.runner.opencode.assistant_text.flushed', {
            runId,
            sessionId: agenticSessionId,
            providerSessionId: eventSessionId,
            lastPartKind: lastAssistantTextKind,
            lastPartReachedFinal: lastAssistantTextPartFinal,
            bufferedLength: bufferedAssistantText.length,
            summaryPreview: bufferedAssistantText.slice(0, 300),
          });
          this.emitRawEvent({
            source: 'provider',
            eventType: 'agent_output',
            timestamp,
            sessionId: eventSessionId,
            agentId: 'opencode',
            payload: {
              messageType: 'assistant',
              summary: bufferedAssistantText,
              taskComplete: true,
            },
          });
          bufferedAssistantText = '';
        }
        onTerminal();
      }
    };

    armStallTimer();
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          await processLine(line);
        }
      }
      if (stallError) throw stallError;
    } finally {
      clearTimeout(stallTimer);
      reader.releaseLock();
    }
  };

  public async promptOnce(args: PromptOnceArgs): Promise<string> {
    const { session, prompt, model, reasoningEffort, signal } = args;
    const modelRef = resolveOpencodeModelRef(model ?? session.model);
    const isolatedDirectory = await IsolatedProviderWorkingDirectory.create();
    // A dedicated server: the Run's own server, session and event stream are never touched,
    // and no MCP server is ever registered on it.
    let server: OpenCodeServerProcess | null = null;
    try {
      server = await OpenCodeServerProcess.launch({ directory: isolatedDirectory.path, signal });
      const handle = server;
      const sessionId = await this.createSession(handle, signal);
      try {
        const response = await fetch(buildApiUrl(handle, `/session/${sessionId}/message`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parts: [{ type: 'text', text: prompt }],
            ...(modelRef ? { model: modelRef } : {}),
            ...((reasoningEffort ?? session.reasoningEffort)
              ? { variant: reasoningEffort ?? session.reasoningEffort }
              : {}),
            tools: { '*': false },
          } satisfies OpencodePromptRequest),
          signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => 'Unknown error');
          throw new AgentSessionRunnerError(
            'RUN_FAILED',
            `OpenCode prompt failed: ${response.status} ${text}`,
          );
        }
        const parsed = opencodeSessionMessage.safeParse(await response.json());
        if (!parsed.success) {
          throw new AgentSessionRunnerError(
            'RUN_FAILED',
            `OpenCode prompt response was invalid: ${parsed.error.message}`,
            parsed.error,
          );
        }
        const { info, parts } = parsed.data;
        if (info.error) {
          throw new AgentSessionRunnerError(
            'RUN_FAILED',
            info.error.data?.message ?? `OpenCode prompt failed: ${info.error.name}`,
          );
        }
        const text = parts
          .flatMap((part) =>
            part.type === 'text' && typeof part['text'] === 'string' ? [part['text']] : [],
          )
          .join('');
        if (text.length === 0) {
          throw new AgentSessionRunnerError(
            'RUN_FAILED',
            'OpenCode returned no text for the prompt.',
          );
        }
        return text;
      } finally {
        await fetch(buildApiUrl(handle, `/session/${sessionId}`), { method: 'DELETE' }).catch(
          (error: unknown) => {
            requestContext.log(
              this.logger,
              'warn',
              'local.runner.opencode.prompt_once.delete_failed',
              {
                sessionId: session.agentic_session_id,
                error,
              },
            );
          },
        );
      }
    } finally {
      await server?.stop().catch((error: unknown) => {
        requestContext.log(this.logger, 'warn', 'local.runner.opencode.prompt_once.stop_failed', {
          sessionId: session.agentic_session_id,
          error,
        });
      });
      await isolatedDirectory.cleanup().catch((error: unknown) => {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.opencode.isolated_cwd.cleanup_failed',
          {
            sessionId: session.agentic_session_id,
            error,
          },
        );
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
      await this.stopIsolatedServer(isolatedDirectory.path);
      await isolatedDirectory.cleanup().catch((error: unknown) => {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.opencode.isolated_cwd.cleanup_failed',
          {
            sessionId: args.session.agentic_session_id,
            error,
          },
        );
      });
    }
  }

  private async stopIsolatedServer(directory: string): Promise<void> {
    const serverHandle = this.serverHandle;
    if (!serverHandle || this.serverDirectory !== directory) return;

    try {
      await serverHandle.stop();
    } catch (error: unknown) {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.isolated_server.stop_failed', {
        directory,
        error,
      });
    } finally {
      if (this.serverHandle === serverHandle) {
        this.serverHandle = null;
        this.serverDirectory = null;
        this.mcpRegisteredForServer = null;
        this.mcpRegisteredPlatformProxyUrl = null;
      }
    }
  }

  private async runPromptInDirectory(
    {
      reportingRepair,
      session,
      prompt,
      attachmentRunId,
      attachments = [],
      signal,
      startingMessage,
      skipPermissions,
      model,
      reasoningEffort,
      readOnlyFilesystem,
      repositoryResearch,
      browserMcpMount,
      platformMcpProxyMount,
      workspace: suppliedWorkspace,
      workspaceWriteBoundary,
      mcpToolUseCase,
      additionalAllowedTools,
      startupSegments,
    }: RunPromptArgs,
    isolatedWorkingDirectory?: string,
  ): Promise<AgentRunResult> {
    // OpenCode's HTTP API takes a {providerID, modelID} pair on its `model`
    // field; the catalog resolves the unified model id to that pair. A null
    // ref is only the Default row (or no selection): omit and let OpenCode pick
    // its own default. Reasoning effort maps onto OpenCode's per-model
    // `variant` mechanism — the LocalReasoningEffort vocabulary
    // (low/medium/high/xhigh/max) is a direct subset of the variant keys
    // OpenCode's provider transform exposes for OpenAI- and Anthropic-shaped
    // reasoning models, so a passthrough is correct for the models the
    // catalog surfaces.
    const selectedModel = model ?? session.model;
    const modelRef = resolveOpencodeModelRef(selectedModel);
    this.selectedModelRef = modelRef;
    const variant = reasoningEffort ?? null;
    requestContext.log(this.logger, 'info', 'local.runner.opencode.model_selection', {
      turnModel: model ?? null,
      sessionModel: session.model ?? null,
      selectedModel: selectedModel ?? null,
      modelRef,
      variant,
    });

    this.skipAllPermissions = skipPermissions ?? false;
    const startedAt = Date.now();
    const runId = `opencode_${crypto.randomUUID()}`;
    const rawPersistedId = readTrimmed(session.provider_session_id);
    const persistedProviderSessionId = nativeProviderSessionId(rawPersistedId);
    const mode: 'prompt' | 'resume' = persistedProviderSessionId ? 'resume' : 'prompt';
    if (this.activeProviderSessionId !== persistedProviderSessionId) {
      this.latestContextSnapshot = null;
    }
    this.activeProviderSessionId = persistedProviderSessionId;
    if (mode === 'prompt') {
      this.latestContextSnapshot = null;
    }

    this.rejectPendingPermissionRequests(
      `OpenCode permission request was canceled because run ${runId} started a new turn.`,
    );

    requestContext.log(this.logger, 'debug', 'local.runner.opencode.run_prompt.started', {
      runId,
      sessionId: session.agentic_session_id,
      launchServiceId: session.launchServiceId,
      serviceCount: session.services?.length ?? 0,
      mode,
      persistedProviderSessionId,
    });

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
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.repo_binding_missing', {
        runId,
        sessionId: session.agentic_session_id,
        launchServiceId: session.launchServiceId,
        serviceCount: session.services?.length ?? 0,
        resolutionCode: workspace.code,
      });
      throw workspaceResolutionError(workspace);
    }

    const runCwd = isolatedWorkingDirectory ?? (workspace?.ok ? workspace.cwd : process.cwd());
    if (suppliedWorkspace && !workspaceWriteBoundary) {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        'OpenCode received a Run workspace without its write boundary.',
      );
    }
    this.workspaceWriteBoundary = workspaceWriteBoundary ?? null;

    if (!suppliedWorkspace && workspace?.ok && workspace.worktree) {
      await this.runStore.updateRunWorktreeState(session.agentic_session_id, workspace.worktree);
    }

    this.activeBrowserAllowedTools = new Set(browserMcpMount ? BROWSER_ALLOWED_TOOLS : []);
    await this.runStore.updateRunStatus(session.agentic_session_id, 'running');
    try {
      const handle = await this.ensureServer(
        runCwd,
        this.workspaceWriteBoundary,
        readOnlyFilesystem,
        signal ?? undefined,
      );
      await this.ensureMcpServers(
        handle,
        {
          ...(session.contextMetadata?.projectId
            ? { contextMetadata: { projectId: session.contextMetadata.projectId } }
            : {}),
          conversationId: session.conversationId,
          ...(session.launchServiceId ? { serviceId: session.launchServiceId } : {}),
          agentic_session_id: session.agentic_session_id,
        },
        {
          ...(browserMcpMount ? { browserMcpMount } : {}),
          ...(platformMcpProxyMount ? { mount: platformMcpProxyMount } : {}),
          ...(mcpToolUseCase ? { mcpToolUseCase } : {}),
        },
      );

      let providerSessionMode = mode;
      let providerSessionId =
        mode === 'resume' && persistedProviderSessionId ? persistedProviderSessionId : null;
      if (mode === 'resume') {
        const canResumeProviderSession = await this.verifyResumableSession(
          handle,
          persistedProviderSessionId,
          signal ?? undefined,
        );
        if (!canResumeProviderSession) {
          providerSessionMode = 'prompt';
          providerSessionId = null;
          this.latestContextSnapshot = null;
        }
      }

      // Read the project's active work-item type definitions once per run,
      // before a fresh provider session is created or prompted. A failed read
      // aborts session start rather than opening on a stale or empty ontology.
      if (providerSessionMode === 'prompt') {
        this.platformSystemPrompt = null;
      }
      if (
        providerSessionMode === 'prompt' &&
        this.oauthClient &&
        mcpToolUseCase !== 'project_report' &&
        mcpToolUseCase !== 'release_notes'
      ) {
        const sessionStartContext = await readSessionStartContext({
          oauthClient: this.oauthClient,
          projectId: session.contextMetadata?.projectId,
        });
        this.platformSystemPrompt = buildPlatformSystemPrompt(
          sessionStartContext.workItemTypeDefinitions,
          undefined,
          {
            intentFirst: sessionStartContext.intentFirst,
            maturity: sessionStartContext.maturity,
            hints: resolveHintPromptAccess(
              sessionStartContext.hintsEnabled,
              additionalAllowedTools ?? [],
            ),
          },
        );
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.opencode.session_start_context.read',
          {
            runId,
            sessionId: session.agentic_session_id,
            workItemTypeCount: sessionStartContext.workItemTypeDefinitions.length,
          },
        );
      }

      if (!providerSessionId) {
        providerSessionId = await this.createSession(handle, signal ?? undefined);
      }
      this.activeProviderSessionId = providerSessionId;

      await this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
        providerSessionId,
        providerConversationId: null,
        providerSessionAgentId: session.provider_session_agent_id ?? null,
      });

      this.emitProcessingStatus({
        kind: 'loading.update',
        loadingText: 'Starting...',
        phase: 'starting',
      });

      let resolveTerminal!: () => void;
      const terminalPromise = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      const eventAbortController = new AbortController();
      const onParentAbort = (): void => {
        eventAbortController.abort();
        resolveTerminal();
      };
      signal?.addEventListener('abort', onParentAbort, { once: true });
      if (signal?.aborted) onParentAbort();

      const eventPromise = this.subscribeToEvents(
        handle,
        providerSessionId,
        runId,
        session.agentic_session_id,
        eventAbortController.signal,
        () => resolveTerminal(),
      );

      // OpenCode persists the `system` field on the session, so the platform
      // system prompt is supplied on the mint turn only. Resume turns inherit
      // it from the live provider session.
      const freshSystemPrompt =
        providerSessionMode === 'prompt'
          ? buildOpenCodeFreshSystemPrompt(this.platformSystemPrompt, session.promptType)
          : null;
      const freshPlatformPromptDelivery =
        providerSessionMode === 'prompt' && freshSystemPrompt
          ? composeFreshPlatformPromptDelivery({
              mode: PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.opencode,
              assembledPlatformPrompt: freshSystemPrompt,
              resolvedFirstTurnInput: prompt,
              ...(startupSegments ? { startupSegments } : {}),
            })
          : null;
      const mintTurnSystemPrompt =
        freshPlatformPromptDelivery?.mode === PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.opencode
          ? freshPlatformPromptDelivery.mintTurnSystemPrompt
          : null;
      const providerStartupInput = {
        prompt: freshPlatformPromptDelivery?.firstTurnInput ?? prompt,
        systemPrompt: mintTurnSystemPrompt,
      };
      const reportRegistration = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
      const activeReportSubmissionTools = reportRegistration?.activeToolNames;
      const hasCreateReportSubmission = Boolean(
        reportRegistration?.tools.some(
          (tool) =>
            tool.name === 'create_report' &&
            (!activeReportSubmissionTools || activeReportSubmissionTools.includes('create_report')),
        ),
      );
      const hasProjectReportPlatformReads =
        mcpToolUseCase === 'project_report' &&
        Boolean((platformMcpProxyMount && this.localAgentEndpoint.get()) || this.oauthClient);
      const baseProviderTools = reportingRepair
        ? { '*': false, 'heyhey-submission-tools_report_changed_files': true }
        : mcpToolUseCase === 'project_report'
          ? resolveOpenCodeProjectReportTools(
              hasCreateReportSubmission,
              hasProjectReportPlatformReads,
            )
          : repositoryResearch
            ? resolveOpenCodeRepositoryResearchTools(repositoryResearch.delegation)
            : null;
      const browserProviderTools =
        browserMcpMount || !baseProviderTools
          ? Object.fromEntries(
              BROWSER_ALLOWED_TOOLS.map((name) => [
                name.replace('mcp__heyhey-browser__', 'heyhey-browser_'),
                Boolean(browserMcpMount) && !reportingRepair,
              ]),
            )
          : {};
      const providerTools = { ...(baseProviderTools ?? {}), ...browserProviderTools };
      if (mcpToolUseCase === 'project_report') {
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.opencode.project_report.tool_surface.resolved',
          {
            runId,
            sessionId: session.agentic_session_id,
            tools: providerTools,
            isolatedWorkingDirectory: isolatedWorkingDirectory !== undefined,
          },
        );
      }
      if (repositoryResearch) {
        requestContext.log(
          this.logger,
          'info',
          'local.runner.opencode.repository_research.resolved',
          {
            runId,
            sessionId: session.agentic_session_id,
            tools: providerTools,
            promptBytes: Buffer.byteLength(providerStartupInput.prompt, 'utf8'),
            delegationRequested: repositoryResearch.delegation === 'allowed',
            filesystemPosture: 'read-only',
            childFilesystemPosture: 'process-contained-read-only',
          },
        );
      }
      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: {
          mode: providerSessionMode,
          prompt,
          adapterId: 'opencode-sdk',
          providerStartupInput,
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
      if (providerSessionMode === 'prompt' && session.promptType === LocalPromptType.Quick) {
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.opencode.quick_task_execution_guidance.applied',
          {
            runId,
            sessionId: session.agentic_session_id,
            providerSessionId,
            promptType: session.promptType,
          },
        );
      }
      const attachmentContent = await this.attachmentContentReader.read(
        attachmentRunId,
        attachments,
        this.logger,
      );
      await this.sendPromptAsync(
        handle,
        providerSessionId,
        providerStartupInput.prompt,
        mintTurnSystemPrompt,
        modelRef,
        variant,
        providerTools,
        signal ?? undefined,
        attachmentContent,
      );

      try {
        await Promise.race([terminalPromise, eventPromise]).catch((error: unknown) => {
          if (signal?.aborted) return;
          throw error;
        });
      } finally {
        eventAbortController.abort();
        signal?.removeEventListener('abort', onParentAbort);
        await eventPromise.catch((error: unknown) => {
          if (eventAbortController.signal.aborted) return;
          throw error;
        });
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.opencode.event_subscription.closed',
          {
            runId,
            providerSessionId,
          },
        );
      }

      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'system',
        event_type: 'run_completed',
        state_version: 1,
        payload: {
          mode: providerSessionMode,
          provider_session_id: providerSessionId,
          provider_conversation_id: null,
          errorCount: 0,
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
          errorCount: 0,
        },
      });

      await this.runStore.updateRunStatus(session.agentic_session_id, 'complete');
      requestContext.log(this.logger, 'debug', 'local.runner.opencode.run_prompt.succeeded', {
        runId,
        sessionId: session.agentic_session_id,
        providerSessionId,
        durationMs: Date.now() - startedAt,
      });

      this.rejectPendingPermissionRequests(
        `OpenCode permission request was canceled because run ${runId} completed before a decision was applied.`,
      );

      return {
        providerSessionId,
        providerConversationId: null,
        errorCount: 0,
      };
    } catch (error) {
      this.rejectPendingPermissionRequests(
        `OpenCode permission request was canceled because run ${runId} failed before completion.`,
      );

      if (error instanceof AgentSessionRunnerError) {
        throw error;
      }

      const mapped = new AgentSessionRunnerError(
        'RUN_FAILED',
        error instanceof Error ? error.message : 'Unknown OpenCode agent session runner error',
        error,
      );

      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'system',
        event_type: 'run_completed',
        state_version: 1,
        payload: { mode, error: mapped.message, code: mapped.code },
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

      await this.runStore.updateRunStatus(session.agentic_session_id, 'idle');
      requestContext.log(this.logger, 'error', 'local.runner.opencode.run_prompt.failed', {
        runId,
        sessionId: session.agentic_session_id,
        durationMs: Date.now() - startedAt,
        error: mapped,
      });
      throw mapped;
    }
  }

  public async resumeSession({
    reportingRepair,
    session,
    prompt,
    attachmentRunId,
    attachments = [],
    signal,
    skipPermissions,
    browserMcpMount,
    platformMcpProxyMount,
    model,
    reasoningEffort,
    workspace,
    workspaceWriteBoundary,
  }: ResumeArgs): Promise<AgentRunResult> {
    const rawPersistedSessionId = readTrimmed(session.provider_session_id);
    const persistedSessionId = nativeProviderSessionId(rawPersistedSessionId);

    if (!persistedSessionId) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.opencode.resume.missing_provider_session_id',
        {
          sessionId: session.agentic_session_id,
        },
      );
      throw new AgentSessionRunnerError(
        'PROVIDER_SESSION_ID_MISSING',
        `Session ${session.agentic_session_id} does not have a provider session id.`,
      );
    }

    const hasUserPrompt = Boolean(prompt?.trim().length);
    return this.runPrompt({
      ...(reportingRepair ? { reportingRepair } : {}),
      session,
      ...(attachmentRunId ? { attachmentRunId } : {}),
      attachments,
      prompt: hasUserPrompt ? prompt! : DEFAULT_RESUME_PROMPT,
      ...(signal ? { signal } : {}),
      ...(skipPermissions !== undefined ? { skipPermissions } : {}),
      ...(browserMcpMount ? { browserMcpMount } : {}),
      ...(platformMcpProxyMount ? { platformMcpProxyMount } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(workspace ? { workspace } : {}),
      ...(workspaceWriteBoundary ? { workspaceWriteBoundary } : {}),
    });
  }

  public async submitPermissionDecision({
    session,
    dispatch,
  }: PermissionDecisionDispatchArgs): Promise<PermissionDecisionDispatchResult> {
    if (dispatch.agentType !== 'opencode') {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `OpenCode runner received unsupported permission decision agent type: ${dispatch.agentType}.`,
      );
    }

    const pendingPermission = this.pendingPermissionRequests.get(dispatch.routing.requestId);
    if (!pendingPermission) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.opencode.permission_decision.request_not_found',
        {
          runId: dispatch.routing.runId,
          requestId: dispatch.routing.requestId,
          sessionId: dispatch.routing.sessionId,
          pendingRequestIds: Array.from(this.pendingPermissionRequests.keys()),
        },
      );
      return { delivered: false, outcome: 'stale', reason: 'request_not_found' };
    }

    requestContext.log(
      this.logger,
      'debug',
      'local.runner.opencode.permission_decision.dispatching',
      {
        runId: dispatch.routing.runId,
        sessionId: dispatch.routing.sessionId,
        requestId: dispatch.routing.requestId,
        decision: dispatch.decision,
        callbackType: dispatch.callbackType,
      },
    );

    this.pendingPermissionRequests.delete(pendingPermission.requestId);

    let reply: 'once' | 'always' | 'reject';
    if (
      dispatch.decision === 'approve' ||
      dispatch.decision === 'always_approve' ||
      dispatch.decision === 'whitelist'
    ) {
      reply =
        dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist'
          ? 'always'
          : 'once';
      const baseToolName = stripMcpPrefix(pendingPermission.permission);
      if (dispatch.decision === 'always_approve') {
        this.alwaysAllowedTools.add(baseToolName);
      }
      if (dispatch.decision === 'whitelist') {
        this.alwaysAllowedTools.add(baseToolName);
        this.toolRuleStore.save(baseToolName);
      }
    } else {
      reply = 'reject';
    }

    await this.replyPermission(pendingPermission.handle, pendingPermission.requestId, reply);

    // When the user just promoted a tool to always-allowed, auto-resolve any
    // sibling pending requests for the same tool so the user isn't reprompted
    // mid-turn for a permission they already blanket-approved.
    if (dispatch.decision === 'always_approve' || dispatch.decision === 'whitelist') {
      const baseToolName = stripMcpPrefix(pendingPermission.permission);
      const siblingsToApprove: PendingOpencodePermissionRequest[] = [];
      for (const [, sibling] of this.pendingPermissionRequests) {
        if (stripMcpPrefix(sibling.permission) === baseToolName) {
          siblingsToApprove.push(sibling);
        }
      }
      for (const sibling of siblingsToApprove) {
        this.pendingPermissionRequests.delete(sibling.requestId);
        await this.replyPermission(sibling.handle, sibling.requestId, 'once');
        await this.persistPermissionDecision(
          session.agentic_session_id,
          sibling.requestId,
          'allow',
        );
        requestContext.log(
          this.logger,
          'info',
          'local.runner.opencode.permission_request.auto_approved',
          {
            requestId: sibling.requestId,
            toolName: sibling.permission,
            reason: 'sibling_of_always_allowed',
          },
        );
      }
    }

    await recordPermissionDecisionSubmitted({
      runStore: this.runStore,
      emitRawEvent: this.emitRawEvent,
      agenticSessionId: session.agentic_session_id,
      dispatch,
    });

    requestContext.log(
      this.logger,
      'debug',
      'local.runner.opencode.permission_decision.dispatched',
      {
        runId: dispatch.routing.runId,
        sessionId: dispatch.routing.sessionId,
        requestId: dispatch.routing.requestId,
        decision: dispatch.decision,
        callbackType: dispatch.callbackType,
      },
    );

    return {
      delivered: true,
      callbackType: dispatch.callbackType,
    };
  }

  private readonly stopServer = async (): Promise<string | null> => {
    if (!this.serverHandle) return null;
    const handle = this.serverHandle;
    await handle.stop();
    if (this.serverHandle === handle) {
      this.serverHandle = null;
      this.serverDirectory = null;
      this.mcpRegisteredForServer = null;
      this.mcpRegisteredPlatformProxyUrl = null;
    }
    return handle.baseUrl;
  };

  public async dispose(): Promise<void> {
    try {
      await this.stopServer();
    } catch (error) {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.dispose_failed', { error });
    }
  }

  // OpenCode's live provider resource is the Run-scoped child server, not
  // only the session inside it. Idle reaping therefore uses the same complete
  // release as disposal while leaving the persisted OpenCode session id for
  // the next materialized Run to resume.
  public async discardSession(): Promise<void> {
    const discardedServerBaseUrl = await this.stopServer();
    requestContext.log(this.logger, 'info', 'local.runner.opencode.session.discarded', {
      discardedServerBaseUrl,
    });
  }

  // OpenCode's message.updated assistant record is the authoritative live
  // usage snapshot. It exposes no Claude-style category attribution, so the
  // context-data adapter keeps those collections empty and reports only the
  // prompt total, API counters, selected model, and model context limit.
  public async getContextUsage(providerSessionId?: string): Promise<LocalContextData> {
    const activeSessionId = readTrimmed(this.activeProviderSessionId);
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.opencode.context_usage.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId || !this.serverHandle) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active OpenCode session is available to report context usage.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active OpenCode session ${activeSessionId}.`,
      );
    }

    const snapshot = this.latestContextSnapshot;
    if (!snapshot || snapshot.providerSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No assistant usage snapshot has been received on the active OpenCode session.',
      );
    }

    try {
      const contextData = await this.buildContextData(this.serverHandle, snapshot);
      requestContext.log(this.logger, 'debug', 'local.runner.opencode.context_usage.succeeded', {
        activeSessionId,
        model: contextData.model,
        totalTokens: contextData.totalTokens,
        percentage: contextData.percentage,
      });
      return contextData;
    } catch (error) {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.context_usage.failed', {
        activeSessionId,
        error,
      });
      throw error;
    }
  }

  // Materialize a throwaway OpenCode server for idle reads. The provider
  // session itself remains persisted and is only read through its messages;
  // no prompt is sent and no replacement session is created.
  public async getContextUsageByResume({
    session,
    model,
    providerSessionId: requestedProviderSessionId,
  }: ResumeArgs): Promise<LocalContextData> {
    const rawPersistedId = requestedProviderSessionId
      ? readTrimmed(requestedProviderSessionId)
      : readTrimmed(session.provider_session_id);
    const persistedProviderSessionId = nativeProviderSessionId(rawPersistedId);
    requestContext.log(this.logger, 'debug', 'local.runner.opencode.context_usage_resume.started', {
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
      throw workspaceResolutionError(workspace);
    }
    const runCwd = workspace?.ok ? workspace.cwd : process.cwd();
    requestContext.log(
      this.logger,
      'info',
      'local.runner.opencode.context_usage_resume.target_directory',
      {
        sessionId: session.agentic_session_id,
        providerSessionId: persistedProviderSessionId,
        targetDirectory: runCwd,
        resolvedWorkspaceDirectory: workspace?.ok ? workspace.cwd : null,
        servicesCount: session.services?.length ?? 0,
      },
    );
    const selectedModel = model ?? session.model;
    this.selectedModelRef = resolveOpencodeModelRef(selectedModel);

    try {
      const handle = await this.ensureServer(runCwd, null);
      const canResume = await this.verifyResumableSession(handle, persistedProviderSessionId);
      if (!canResume) {
        throw new AgentSessionRunnerError(
          'SESSION_NOT_FOUND',
          `OpenCode provider session ${persistedProviderSessionId} was not found.`,
        );
      }
      const snapshot = await this.readSessionMessages(handle, persistedProviderSessionId);
      const contextData = await this.buildContextData(handle, snapshot);
      requestContext.log(
        this.logger,
        'debug',
        'local.runner.opencode.context_usage_resume.succeeded',
        {
          sessionId: session.agentic_session_id,
          providerSessionId: persistedProviderSessionId,
          model: contextData.model,
          totalTokens: contextData.totalTokens,
          percentage: contextData.percentage,
        },
      );
      return contextData;
    } catch (error) {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.context_usage_resume.failed', {
        sessionId: session.agentic_session_id,
        providerSessionId: persistedProviderSessionId,
        error,
      });
      throw error;
    } finally {
      await this.dispose();
    }
  }

  // Compact the live OpenCode session through its provider-native summarize
  // endpoint. The selected provider/model pair comes from the latest assistant
  // message, which is also the identity used to build context usage.
  public async compact(providerSessionId?: string): Promise<void> {
    const activeSessionId = readTrimmed(this.activeProviderSessionId);
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.opencode.compact.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId || !this.serverHandle) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active OpenCode session is available to compact.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active OpenCode session ${activeSessionId}.`,
      );
    }
    const snapshot = this.latestContextSnapshot;
    if (!snapshot || snapshot.providerSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No assistant model snapshot is available for the active OpenCode session.',
      );
    }

    try {
      await this.summarizeSession(this.serverHandle, activeSessionId, snapshot);
      requestContext.log(this.logger, 'debug', 'local.runner.opencode.compact.succeeded', {
        activeSessionId,
        providerID: snapshot.providerID,
        modelID: snapshot.modelID,
      });
    } catch (error) {
      requestContext.log(this.logger, 'warn', 'local.runner.opencode.compact.failed', {
        activeSessionId,
        error,
      });
      throw error;
    }
  }
}

export function opencodeAttachmentParts(
  attachments: readonly RunAttachmentContent[],
): OpencodePromptRequest['parts'] {
  return attachments.map((content) =>
    content.kind === 'text'
      ? { type: 'text', text: 'File: ' + content.fileName + '\n' + content.text }
      : {
          type: 'file',
          mime: content.mediaType,
          filename: content.fileName,
          url: 'data:' + content.mediaType + ';base64,' + content.data,
        },
  );
}
