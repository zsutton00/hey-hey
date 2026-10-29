import { filterInertBuiltinTools } from '../../../run/inert-execution-policy';
import { toolResultLogLevel } from './tool-result-log-level';
import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { buildBrowserToolsMcpConfig, BROWSER_ALLOWED_TOOLS } from '../../browser-tools/mcp-config';
import { researchHandler } from '../../research/research.handler';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  loadClaudeUserMcpConfig,
  isMintedUserMcpTool,
  type ClaudeUserMcpConfig,
} from './user-mcp-config';
import { ClaudeExecutionCaptureHooks } from './execution-capture-hooks';
import { summarizeClaudeInitToolExposure } from './init-tool-exposure';
import type { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import {
  ClaudeCodeSdkClient,
  type ClaudeCodePermissionResult,
  type ClaudeCodeSdkEvent,
  type ClaudeCodeTurnResult,
  type UsageData,
} from '../../../agent-runtime/index';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import {
  nativeProviderSessionId,
  recordPermissionDecisionSubmitted,
  workspaceResolutionError,
} from '../runner-common';
import { isRecord, readTrimmedString as readTrimmed } from '../provider-event-normalization-core';
import {
  AgentQuestionPayloadAgentTypeEnum,
  AgentQuestionPayloadResponseTypeEnum,
  type AgentQuestion,
  type AgentQuestionPayload,
} from '../../../shared/api/generated/api';
import type { Run } from '../../../run/run';
import { NOOP_LOGGER, type ServerLogger } from '../../../server/logger';
import { requestContext } from '../../../server/request-context';
import { redactAgentEventForLog, loadAgentEventLogRedactionConfig } from '../agent-event-redaction';
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
  type QuestionAnswerDispatchArgs,
  type QuestionAnswerDispatchResult,
  type ResumeArgs,
  type RunPromptArgs,
} from '../session-runner';
import { resolveRunWorkspace } from '../../run-scope';
import type { ToolRuleStore } from '../../../session/tool-rules';
import type { OAuthClient } from '../../../auth/index';
import { buildMcpServerConfig, resolveHintPromptAccess } from '../../mcp-server-config';
import { buildPlatformMcpProxyMcpConfig } from '../../platform-mcp-proxy/mcp-config';
import type { LocalAgentEndpoint } from '../../../server/local-base-url';
import type { SubmissionToolRegistry } from '../../submission-tools/registry';
import type { ProviderPhase } from '../../../run/types';
import { buildSubmissionToolsMcpConfig } from '../../submission-tools/mcp-config';
import { buildPlatformSystemPrompt } from '../../prompts/common';
import {
  readSessionStartContext,
  type SessionStartContext,
} from '../../prompts/session-start-context';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import {
  composeFreshPlatformPromptDelivery,
  PLATFORM_PROMPT_DELIVERY_MODE,
  resolveProviderPlatformPromptDeliveryMode,
  PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE,
} from '../platform-prompt-delivery';
import type { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import { IsolatedProviderWorkingDirectory } from '../isolated-provider-working-directory';

export interface ClaudeAgentSessionRunnerDependencies {
  executionRecorder?: ExecutionRecorder;
  runStore: RunStore;
  repoStore: RepoMappingStore;
  localAgentEndpoint: LocalAgentEndpoint;
  submissionToolRegistry: SubmissionToolRegistry;
  toolRuleStore: ToolRuleStore;
  oauthClient?: OAuthClient;
  agentOutputOwner?: Run;
  logger?: ServerLogger;
}

interface PendingClaudePermissionRequest {
  requestId: string;
  sessionId: string;
  createdAt: string;
  toolName: string;
  toolInputRecord: Record<string, unknown> | null;
  resolve: (result: ClaudeCodePermissionResult) => void;
  reject: (error: Error) => void;
}

interface PendingClaudeQuestion {
  requestId: string;
  toolInputRecord: Record<string, unknown>;
  resolve: (result: ClaudeCodePermissionResult) => void;
}

const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

const askUserQuestionInputSchema = z
  .object({
    questions: z
      .array(
        z.object({
          question: z.string().min(1),
          header: z.string(),
          multiSelect: z.boolean(),
          options: z.array(z.object({ label: z.string().min(1), description: z.string() })).min(1),
        }),
      )
      .min(1),
  })
  .passthrough();

const DEFAULT_RESUME_PROMPT = 'Continue from the latest state and complete the task.';

/**
 * Built-in tool set the Claude SDK runs with when a handler declares
 * `readOnlyFilesystem: true`. Maps to the Claude CLI's `--tools <names...>`
 * flag, which restricts the session's built-in surface to exactly these
 * names — so `Edit`, `Write`, `NotebookEdit`, etc. are structurally absent
 * from the agent's tool catalog, not merely deniable. Mirrors the Codex
 * runner's `sandbox: 'read-only'` posture: same contract, provider-specific
 * mechanism.
 */
const CLAUDE_READ_ONLY_BUILTIN_TOOLS: readonly string[] = ['Read', 'Bash', 'Glob', 'Grep'];
export const resolveClaudeRepositoryResearchTools = (
  delegation: 'allowed' | 'disabled',
): readonly string[] =>
  delegation === 'allowed' ? ['Read', 'Glob', 'Grep', 'Agent'] : ['Read', 'Glob', 'Grep'];

const CLAUDE_WRITE_PATH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
};

// Upper bound on a resume-based context-usage read (spawn `claude --resume`,
// issue one `get_context_usage` control request, await the reply).
const CONTEXT_USAGE_RESUME_TIMEOUT_MS = 60_000;

const isClaudeAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'Aborted' || error.message === 'Aborted';
};

/** A Claude turn whose `result` event reported an error. */
class ClaudeTurnFailedError extends Error {
  public constructor(
    public readonly subtype: string | null,
    errorText: string,
  ) {
    super(`Claude run failed: ${errorText}`);
    this.name = 'ClaudeTurnFailedError';
  }
}

// Verified against `claude --resume <unknown-id>`: it emits an
// `error_during_execution` result with zero turns whose errors read
// "No conversation found with session ID: <id>", then exits 1.
const isMissingProviderSessionResult = (
  result: Extract<ClaudeCodeTurnResult, { ok: false }>,
  resumedProviderSessionId: string,
): boolean =>
  result.subtype === 'error_during_execution' &&
  (result.numTurns ?? 0) === 0 &&
  result.errors.some((error) =>
    error.includes(`No conversation found with session ID: ${resumedProviderSessionId}`),
  );

const readFirstStringValue = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = readTrimmed(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const toEventRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : { value: String(value) };

const extractAssistantText = (event: ClaudeCodeSdkEvent): string | null => {
  const message = event['message'] as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = message['content'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const item of content) {
    if (item['type'] === 'text' && typeof item['text'] === 'string') {
      parts.push(item['text']);
    }
  }

  return parts.length > 0 ? parts.join('') : null;
};

export class ClaudeAgentSessionRunner implements AgentSessionRunner {
  private readonly client = new ClaudeCodeSdkClient();
  private readonly executionCapture: ClaudeExecutionCaptureHooks | null;
  private connected = false;
  private skipAllPermissions = false;
  private reportingRepair = false;
  // Set at this.runPrompt entry; cleared only at this.runPrompt exit. Never touched by
  // this.discardSession — the agentic session is Run-scoped, not provider-session-scoped.
  private activeAgenticSessionId: string | null = null;
  private activeProviderSessionId: string | null = null;
  // Live background tasks (e.g. subagents run in the background through
  // Claude's built-in `Agent` tool) reported by the current Claude process.
  // A Turn does not settle while any remain. Per-process: cleared whenever a
  // new process is started.
  private liveBackgroundTaskIds: readonly string[] = [];
  private workspaceWriteBoundary: RunWorkspaceWriteBoundary | null = null;
  private lastBrowserMcpToken: string | null = null;
  private lastMcpToken: string | null = null;
  // The active session's fully-resolved allow-list (mcp-server-config base +
  // the handler's additionalAllowedTools + submission tools + builtins),
  // captured at session mint. This is the single source of truth for tool
  // pre-approval: a tool the active handler allow-listed must not raise a UI
  // permission prompt. The permission handler consults it so auto-approval
  // tracks mcp-server-config exactly, instead of drifting from the static
  // `this.alwaysAllowedTools` baseline below.
  private activeAllowedToolNames = new Set<string>();
  private mintedUserMcpConfig: ClaudeUserMcpConfig | null = null;
  private readonly pendingPermissionRequests = new Map<string, PendingClaudePermissionRequest>();
  // Waiting `AskUserQuestion` calls, keyed by the question request id. Kept apart
  // from pendingPermissionRequests: the answer comes from a `question_answer`
  // control, not a permission decision.
  private readonly pendingQuestions = new Map<string, PendingClaudeQuestion>();
  private readonly answeredQuestionTokens = new Set<string>();
  private readonly alwaysAllowedTools = new Set<string>([
    // read-only built-ins: Sandbox lets agents read anywhere without asking
    'Read',
    'Glob',
    'Grep',
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
    'create_design_doc',
    'edit_design_doc',
    'update_proposal',
    'delete_proposal',
  ]);
  private readonly redactionConfig = loadAgentEventLogRedactionConfig();
  private readonly normalizationConfig = loadProviderEventNormalizationConfig();
  private readonly attachmentContentReader = new RunAttachmentContentReader();
  private readonly runStore: RunStore;
  private readonly repoStore: RepoMappingStore;
  private readonly localAgentEndpoint: LocalAgentEndpoint;
  private readonly submissionToolRegistry: SubmissionToolRegistry;
  private readonly toolRuleStore: ToolRuleStore;
  private readonly oauthClient: OAuthClient | undefined;
  private readonly agentOutputOwner: Run | undefined;
  private readonly logger: ServerLogger;

  public constructor(dependencies: ClaudeAgentSessionRunnerDependencies) {
    this.runStore = dependencies.runStore;
    this.repoStore = dependencies.repoStore;
    this.localAgentEndpoint = dependencies.localAgentEndpoint;
    this.submissionToolRegistry = dependencies.submissionToolRegistry;
    this.toolRuleStore = dependencies.toolRuleStore;
    this.oauthClient = dependencies.oauthClient;
    this.agentOutputOwner = dependencies.agentOutputOwner;
    this.logger = dependencies.logger ?? NOOP_LOGGER;
    this.executionCapture = dependencies.executionRecorder
      ? new ClaudeExecutionCaptureHooks(dependencies.executionRecorder, this.logger)
      : null;
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

  private readonly persistAutomaticPermissionDecision = async (input: {
    toolName: string;
    toolInput: Record<string, unknown> | null;
    decision: 'allow' | 'deny';
    reason: string;
  }): Promise<void> => {
    const agenticSessionId = this.activeAgenticSessionId;
    if (!agenticSessionId) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.claude.permission_decision.missing_agentic_session',
        { toolName: input.toolName, decision: input.decision, reason: input.reason },
      );
      return;
    }

    const requestId = `claude_permission_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const sessionId = this.resolveActiveProviderSessionId() ?? agenticSessionId;
    const command = readTrimmed(input.toolInput?.['command']);
    const filePath = readTrimmed(input.toolInput?.['file_path']);
    const target = command ?? filePath ?? input.toolName;
    const fingerprint = `sha256:${crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          provider: 'claude',
          providerActionId: requestId,
          providerSessionId: sessionId,
          action: input.toolName,
          target,
          toolInput: input.toolInput,
        }) ?? 'null',
      )
      .digest('hex')}`;

    await this.runStore.appendEvent(agenticSessionId, {
      run_id: agenticSessionId,
      actor: 'agent',
      event_type: 'agent_output',
      state_version: 1,
      payload: {
        messageType: 'provider_event',
        provider: 'claude',
        eventType: 'permission_request',
        timestamp,
        session_id: sessionId,
        agent_id: 'claude',
        permission_request: {
          id: requestId,
          permission_type: input.toolName,
          action: input.toolName,
          target,
          fingerprint,
          created_at: timestamp,
          expires_at: null,
        },
        enrichment_metadata: {
          reason: input.reason,
          agent_intent: null,
          referenced_files: filePath ? [filePath] : [],
          referenced_diffs: [],
        },
      },
    });
    await this.runStore.appendEvent(agenticSessionId, {
      run_id: agenticSessionId,
      actor: 'system',
      event_type: 'agent_output',
      state_version: 1,
      payload: {
        messageType: 'permission_decision_ui',
        requestId,
        decision: input.decision,
        decidedAt: timestamp,
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
      agentId: 'claude',
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
      'local.runner.claude.permission_requests.rejecting_all',
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
        agentId: 'claude',
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
      pending.reject(new Error(reason));
    }
    this.pendingPermissionRequests.clear();
  };

  private readonly releasePendingQuestions = (reason: string): void => {
    if (this.pendingQuestions.size === 0) {
      return;
    }
    requestContext.log(this.logger, 'warn', 'local.runner.claude.questions.releasing_all', {
      reason,
      count: this.pendingQuestions.size,
      requestIds: Array.from(this.pendingQuestions.keys()),
    });
    for (const pending of this.pendingQuestions.values()) {
      pending.resolve({ behavior: 'deny', message: reason });
    }
    this.pendingQuestions.clear();
  };

  private readonly resolveActiveProviderSessionId = (): string | null =>
    readTrimmed(this.client.getSessionId()) ?? this.activeProviderSessionId;

  private inertExecution = false;

  private readonly ensureConnected = async (): Promise<void> => {
    if (this.connected) return;
    requestContext.log(this.logger, 'debug', 'local.runner.claude.connecting');
    this.client.onPermissionRequest(async (toolName, input) => {
      if (this.inertExecution && !this.activeAllowedToolNames.has(toolName)) {
        return { behavior: 'deny', message: 'Tool unavailable to inert execution.' };
      }
      if (this.reportingRepair && !toolName.endsWith('__report_changed_files')) {
        return {
          behavior: 'deny',
          message: 'Only report_changed_files is permitted during reporting repair.',
        };
      }
      let toolInputRecord = isRecord(input) ? input : null;
      const writePathFields = CLAUDE_WRITE_PATH_FIELDS[toolName] ?? [];
      if (writePathFields.length > 0 && this.workspaceWriteBoundary) {
        if (!toolInputRecord) {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.claude.workspace_write.invalid_tool_input',
            { toolName },
          );
          await this.persistAutomaticPermissionDecision({
            toolName,
            toolInput: null,
            decision: 'deny',
            reason: 'missing_tool_input',
          });
          return { behavior: 'deny', message: `${toolName} did not provide a write target.` };
        }
        try {
          const updatedInput: Record<string, unknown> = { ...toolInputRecord };
          for (const field of writePathFields) {
            const requestedPath = readTrimmed(toolInputRecord[field]);
            if (!requestedPath) {
              requestContext.log(
                this.logger,
                'warn',
                'local.runner.claude.workspace_write.missing_target',
                { toolName, field },
              );
              await this.persistAutomaticPermissionDecision({
                toolName,
                toolInput: toolInputRecord,
                decision: 'deny',
                reason: `${field}_missing`,
              });
              return {
                behavior: 'deny',
                message: `${toolName} did not provide its required ${field} write target.`,
              };
            }
            updatedInput[field] =
              await this.workspaceWriteBoundary.resolveWriteTarget(requestedPath);
          }
          toolInputRecord = updatedInput;
          requestContext.log(
            this.logger,
            'debug',
            'local.runner.claude.workspace_write.validated',
            { toolName, fields: writePathFields },
          );
        } catch (error) {
          requestContext.log(this.logger, 'warn', 'local.runner.claude.workspace_write.rejected', {
            toolName,
            error,
          });
          await this.persistAutomaticPermissionDecision({
            toolName,
            toolInput: toolInputRecord,
            decision: 'deny',
            reason: 'workspace_write_rejected',
          });
          return {
            behavior: 'deny',
            message: error instanceof Error ? error.message : 'Write target is outside the Run.',
          };
        }
      }

      if (toolName === ASK_USER_QUESTION_TOOL) {
        return this.askUserQuestion(toolInputRecord);
      }

      const baseToolName = toolName.replace(/^mcp__heyhey-platform__/, '');
      // Auto-approve when the active handler allow-listed this exact tool
      // (mcp-server-config is the source of truth), or when it is in the static
      // always-allowed baseline, or when permissions are globally skipped.
      // Matching the session allow-list by FULL qualified name — not the
      // platform-stripped base — keeps a deliberately-withheld twin gated: e.g.
      // phase-breakdown excludes the platform `create_report` so the agent must
      // use the pass-through wrapper, and that exclusion still raises a prompt.
      const sessionPreApproved =
        this.activeAllowedToolNames.has(toolName) ||
        isMintedUserMcpTool(toolName, this.mintedUserMcpConfig?.serverNames ?? []);
      if (
        this.alwaysAllowedTools.has(baseToolName) ||
        sessionPreApproved ||
        this.skipAllPermissions
      ) {
        requestContext.log(
          this.logger,
          'info',
          'local.runner.claude.permission_request.auto_approved',
          {
            toolName,
            reason: this.skipAllPermissions
              ? 'skip_permissions'
              : sessionPreApproved
                ? 'session_allowlisted'
                : 'always_allowed',
          },
        );
        await this.persistAutomaticPermissionDecision({
          toolName,
          toolInput: toolInputRecord,
          decision: 'allow',
          reason: this.skipAllPermissions
            ? 'skip_permissions'
            : sessionPreApproved
              ? 'session_allowlisted'
              : 'always_allowed',
        });
        return { behavior: 'allow', updatedInput: toolInputRecord ?? {} };
      }

      // Coalesce parallel permission requests for the same tool. When Claude
      // makes N parallel calls to the same tool (e.g. 4 Grep calls), the SDK
      // fires onPermissionRequest N times. Only the first should emit events
      // and create a UI-visible permission request; the rest piggyback on its
      // resolution so the user sees a single approval prompt.
      const existingPending = Array.from(this.pendingPermissionRequests.values()).find(
        (p) => p.toolName === toolName,
      );
      if (existingPending) {
        requestContext.log(
          this.logger,
          'debug',
          'local.runner.claude.permission_request.coalesced',
          {
            toolName,
            existingRequestId: existingPending.requestId,
            agenticSessionId: this.activeAgenticSessionId,
          },
        );
        // Wait for the existing request to resolve and mirror its result.
        const result = await new Promise<ClaudeCodePermissionResult>((resolve, reject) => {
          const coalescedId = `claude_permission_${crypto.randomUUID()}`;
          this.pendingPermissionRequests.set(coalescedId, {
            requestId: coalescedId,
            sessionId: existingPending.sessionId,
            createdAt: new Date().toISOString(),
            toolName,
            toolInputRecord,
            resolve,
            reject,
          });
        });
        return result;
      }

      const requestId = `claude_permission_${crypto.randomUUID()}`;
      const timestamp = new Date().toISOString();
      const sessionId =
        this.resolveActiveProviderSessionId() ?? this.activeAgenticSessionId ?? requestId;
      const rawPermissionRequest = {
        type: 'control_request',
        request: {
          subtype: 'can_use_tool',
          request_id: requestId,
          tool_name: toolName,
          input: toolInputRecord ?? {},
        },
      } satisfies Record<string, unknown>;

      this.emitRawEvent({
        source: 'local',
        eventType: 'permission_request',
        timestamp,
        sessionId,
        agentId: 'claude',
        payload: {
          messageType: 'permission_request',
          permission_request: {
            id: requestId,
            permission_type: 'command_execution',
            session_id: sessionId,
            agent_id: 'claude',
            agent_type: 'claude',
            run_id: this.activeAgenticSessionId,
            timestamp,
            idempotency_token: requestId,
            raw_event: rawPermissionRequest,
          },
          tool_name: toolName,
          tool_input: toolInputRecord ?? {},
          raw_event: rawPermissionRequest,
        },
      });

      this.emitProcessingStatus({
        kind: 'tool.progress',
        loadingText: `Using tool: ${toolName}`,
        toolName,
        toolPhase: 'pending_approval',
        phase: 'awaiting_approval',
      });

      requestContext.log(this.logger, 'debug', 'local.runner.claude.permission_request.detected', {
        requestId,
        sessionId,
        agenticSessionId: this.activeAgenticSessionId,
        toolName,
      });

      // Emit as agent_output so the message poster creates a QUESTION-type
      // SystemMessage with the permission request UI field.
      const toolFilePath =
        toolInputRecord && typeof toolInputRecord['file_path'] === 'string'
          ? toolInputRecord['file_path']
          : null;
      const toolCommand =
        toolInputRecord && typeof toolInputRecord['command'] === 'string'
          ? toolInputRecord['command']
          : null;
      const permissionReason = toolCommand
        ? `${toolName}: ${toolCommand.length > 200 ? `${toolCommand.slice(0, 200)}…` : toolCommand}`
        : toolFilePath
          ? `${toolName}: ${toolFilePath}`
          : `Permission requested for tool: ${toolName}`;
      const referencedFiles = toolFilePath ? [toolFilePath] : [];
      const agenticSessionId = this.activeAgenticSessionId;
      const permissionTarget = toolCommand || toolFilePath || toolName;
      const permissionFingerprint = `sha256:${crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            provider: 'claude',
            providerActionId: requestId,
            providerSessionId: sessionId,
            action: toolName,
            target: permissionTarget,
            toolInput: toolInputRecord,
          }) ?? 'null',
        )
        .digest('hex')}`;
      const canonicalPermissionRequest = {
        id: requestId,
        permission_type: toolName,
        session_id: sessionId,
        agent_id: 'claude',
        agent_type: 'claude',
        timestamp,
        idempotency_token: requestId,
        action: toolName,
        target: permissionTarget,
        fingerprint: permissionFingerprint,
        created_at: timestamp,
        expires_at: null,
      };

      if (!agenticSessionId) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.claude.permission_request.missing_agentic_session',
          { requestId, sessionId, toolName },
        );
      } else {
        await this.runStore.appendEvent(agenticSessionId, {
          run_id: agenticSessionId,
          actor: 'agent',
          event_type: 'agent_output',
          state_version: 1,
          payload: {
            messageType: 'provider_event',
            provider: 'claude',
            eventType: 'permission_request',
            timestamp,
            session_id: sessionId,
            agent_id: 'claude',
            permission_request: canonicalPermissionRequest,
            enrichment_metadata: {
              reason: permissionReason,
              agent_intent: null,
              referenced_files: referencedFiles,
              referenced_diffs: [],
            },
          },
        });
      }

      this.emitRawEvent({
        source: 'provider',
        eventType: 'agent_output',
        timestamp,
        sessionId,
        agentId: null,
        payload: {
          summary: JSON.stringify({
            responseType: 'agent_request_permission_v1',
            permission_request: {
              ...canonicalPermissionRequest,
              raw_event: { toolName, toolInput: toolInputRecord },
            },
            enrichment_metadata: {
              reason: permissionReason,
              agent_intent: null,
              referenced_files: referencedFiles,
              referenced_diffs: [],
            },
            raw_event: { toolName, toolInput: toolInputRecord },
          }),
          messageType: 'system',
        },
      });

      const result = await new Promise<ClaudeCodePermissionResult>((resolve, reject) => {
        this.pendingPermissionRequests.set(requestId, {
          requestId,
          sessionId,
          createdAt: timestamp,
          toolName,
          toolInputRecord,
          resolve,
          reject,
        });
      });

      requestContext.log(this.logger, 'debug', 'local.runner.claude.permission.resolved', {
        requestId,
        sessionId,
        toolName,
        behavior: result.behavior,
      });

      this.emitProcessingStatus({
        kind: 'loading.update',
        loadingText: 'Thinking...',
        phase: 'thinking',
      });

      return result;
    });
    this.connected = true;
    requestContext.log(this.logger, 'debug', 'local.runner.claude.connected');
  };

  /**
   * Post an `AskUserQuestion` call as an interactive question and keep the tool
   * call waiting until `submitQuestionAnswer` (or a release) resolves it. Never
   * raises a generic permission request.
   */
  private askUserQuestion(
    toolInputRecord: Record<string, unknown> | null,
  ): Promise<ClaudeCodePermissionResult> {
    const parsed = askUserQuestionInputSchema.safeParse(toolInputRecord);
    if (!toolInputRecord || !parsed.success) {
      requestContext.log(this.logger, 'warn', 'local.runner.claude.question.invalid_input', {
        error: parsed.success ? 'missing_tool_input' : parsed.error.message,
      });
      return Promise.resolve({
        behavior: 'deny',
        message: `${ASK_USER_QUESTION_TOOL} input is invalid: ${
          parsed.success ? 'no input provided' : parsed.error.message
        }`,
      });
    }

    const requestId = `claude_question_${crypto.randomUUID()}`;
    const sessionId =
      this.resolveActiveProviderSessionId() ?? this.activeAgenticSessionId ?? requestId;
    const questions: AgentQuestion[] = parsed.data.questions;
    const payload: AgentQuestionPayload = {
      responseType: AgentQuestionPayloadResponseTypeEnum.AgentQuestionV1,
      requestId,
      sessionId,
      agentType: AgentQuestionPayloadAgentTypeEnum.Claude,
      idempotencyToken: requestId,
      questions,
      answers: null,
    };

    const result = new Promise<ClaudeCodePermissionResult>((resolve) => {
      this.pendingQuestions.set(requestId, { requestId, toolInputRecord, resolve });
    });
    this.emitRawEvent({
      source: 'provider',
      eventType: 'agent_output',
      timestamp: new Date().toISOString(),
      sessionId,
      agentId: null,
      payload: { summary: JSON.stringify(payload), messageType: 'system' },
    });
    requestContext.log(this.logger, 'debug', 'local.runner.claude.question.posted', {
      requestId,
      sessionId,
      questionCount: questions.length,
    });
    return result;
  }

  public submitQuestionAnswer(args: QuestionAnswerDispatchArgs): QuestionAnswerDispatchResult {
    if (this.answeredQuestionTokens.has(args.idempotencyToken)) {
      return { delivered: false, outcome: 'duplicate' };
    }
    const pending = this.pendingQuestions.get(args.requestId);
    if (!pending) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.claude.question_answer.request_not_found',
        {
          requestId: args.requestId,
          pendingRequestIds: Array.from(this.pendingQuestions.keys()),
        },
      );
      return { delivered: false, outcome: 'stale', reason: 'request_not_found' };
    }
    this.pendingQuestions.delete(args.requestId);
    this.answeredQuestionTokens.add(args.idempotencyToken);
    pending.resolve({
      behavior: 'allow',
      updatedInput: { ...pending.toolInputRecord, answers: args.answers },
    });

    const answeredAt = new Date().toISOString();
    this.emitRawEvent({
      source: 'local',
      eventType: 'question_answer_ui',
      timestamp: answeredAt,
      sessionId: this.resolveActiveProviderSessionId(),
      agentId: null,
      payload: {
        requestId: args.requestId,
        answers: args.answers,
        answeredAt,
      },
    });
    requestContext.log(this.logger, 'debug', 'local.runner.claude.question_answer.delivered', {
      requestId: args.requestId,
    });
    return { delivered: true, answeredAt };
  }

  public async promptOnce(args: PromptOnceArgs): Promise<string> {
    const { session, prompt, model, reasoningEffort, signal } = args;
    const isolatedDirectory = await IsolatedProviderWorkingDirectory.create();
    // A transient client: the Run's own client, session and event log are never touched.
    const client = new ClaudeCodeSdkClient();
    let answer: string | null = null;
    client.onEvent((event) => {
      if (event.type !== 'assistant') return;
      const text = extractAssistantText(event);
      if (text) answer = text;
    });
    try {
      const result = await client.startSession(
        {
          prompt,
          cwd: isolatedDirectory.path,
          fastMode: session.fastMode === true,
          permissionMode: 'default',
          builtinTools: [],
          ...((model ?? session.model) ? { model: (model ?? session.model) as string } : {}),
          ...((reasoningEffort ?? session.reasoningEffort)
            ? { reasoningEffort: (reasoningEffort ?? session.reasoningEffort) as string }
            : {}),
        },
        { signal },
      );
      if (!result.ok) {
        throw new AgentSessionRunnerError('RUN_FAILED', result.errorText);
      }
      if (answer === null) {
        throw new AgentSessionRunnerError('RUN_FAILED', 'Claude returned no text for the prompt.');
      }
      return answer;
    } finally {
      await client.disconnect();
      await isolatedDirectory.cleanup().catch((error: unknown) => {
        requestContext.log(this.logger, 'warn', 'local.runner.claude.isolated_cwd.cleanup_failed', {
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
        requestContext.log(this.logger, 'warn', 'local.runner.claude.isolated_cwd.cleanup_failed', {
          sessionId: args.session.agentic_session_id,
          error,
        });
      });
    }
  }

  private async runPromptInDirectory(
    args: RunPromptArgs,
    isolatedWorkingDirectory?: string,
  ): Promise<AgentRunResult> {
    const {
      session,
      prompt,
      attachmentRunId,
      attachments = [],
      signal,
      startingMessage,
      skipPermissions,
      mcpToolUseCase,
      additionalAllowedTools,
      additionalBuiltinTools,
      readOnlyFilesystem,
      repositoryResearch,
      builtinTools,
      model,
      reasoningEffort,
      browserMcpMount,
      platformMcpProxyMount,
      workspace: suppliedWorkspace,
      workspaceWriteBoundary,
      startupSegments,
      replaceProviderSystemPrompt,
    } = args;
    this.skipAllPermissions = skipPermissions ?? false;
    this.reportingRepair = args.reportingRepair ?? false;
    const startedAt = Date.now();
    const runId = `claude_${crypto.randomUUID()}`;
    let hasExistingSession = this.client.getSessionId() !== null;
    const rawPersistedId = readTrimmed(session.provider_session_id);
    let persistedProviderSessionId = nativeProviderSessionId(rawPersistedId);
    let canResumeFromPersisted = !hasExistingSession && persistedProviderSessionId !== null;

    // The Run may have discarded the session during an agent transition or an
    // explicit fresh start while the SDK this.client still holds the old handle.
    // provider_session_id is null only on an explicit discard — detect the
    // mismatch and disconnect now so the MCP-config block below mints fresh
    // instead of continuing the stale session.
    if (hasExistingSession && rawPersistedId === null) {
      const staleProviderSessionId = this.client.getSessionId();
      await this.client.disconnect();
      this.connected = false;
      hasExistingSession = false;
      persistedProviderSessionId = null;
      canResumeFromPersisted = false;
      requestContext.log(
        this.logger,
        'info',
        'local.runner.claude.session.stale_discard_detected',
        {
          runId,
          sessionId: session.agentic_session_id,
          staleProviderSessionId,
        },
      );
    }

    const mode: 'prompt' | 'resume' =
      hasExistingSession || canResumeFromPersisted ? 'resume' : 'prompt';
    this.activeAgenticSessionId = session.agentic_session_id;
    this.activeProviderSessionId = persistedProviderSessionId;
    this.rejectPendingPermissionRequests(
      `Claude permission request was canceled because run ${runId} started a new turn.`,
    );
    this.releasePendingQuestions(
      `Claude question was canceled because run ${runId} started a new turn.`,
    );
    requestContext.log(this.logger, 'debug', 'local.runner.claude.run_prompt.started', {
      runId,
      sessionId: session.agentic_session_id,
      launchServiceId: session.launchServiceId,
      serviceCount: session.services?.length ?? 0,
      mode,
      hasExistingSession,
      canResumeFromPersisted,
      persistedProviderSessionId,
    });

    // Sessions without a service (e.g. entity conversations) skip workspace
    // resolution entirely — they operate via MCP tools, not file access.
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
      requestContext.log(this.logger, 'warn', 'local.runner.claude.repo_binding_missing', {
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
        'Claude received a Run workspace without its write boundary.',
      );
    }
    this.workspaceWriteBoundary = workspaceWriteBoundary ?? null;

    if (!suppliedWorkspace && workspace?.ok && workspace.worktree) {
      await this.runStore.updateRunWorktreeState(session.agentic_session_id, workspace.worktree);
    }

    await this.runStore.updateRunStatus(session.agentic_session_id, 'running');
    try {
      await this.ensureConnected();

      // The Claude SDK freezes MCP server config at session mint. Recycle the
      // process on resume whenever the Turn-owned proxy URL changes, or when
      // direct remote MCP headers have gone stale.
      if (
        hasExistingSession &&
        (platformMcpProxyMount ||
          this.oauthClient ||
          (browserMcpMount?.token ?? null) !== this.lastBrowserMcpToken)
      ) {
        let needsRecycle =
          Boolean(platformMcpProxyMount) ||
          (browserMcpMount?.token ?? null) !== this.lastBrowserMcpToken;
        const recycleReasons: string[] = platformMcpProxyMount
          ? ['platform_proxy_turn_mount_rotated']
          : [];

        if (this.oauthClient && this.lastMcpToken) {
          try {
            const currentTokenResult = await this.oauthClient.getAccessToken();
            if (currentTokenResult.success && currentTokenResult.data !== this.lastMcpToken) {
              needsRecycle = true;
              recycleReasons.push('token_refreshed');
            }
          } catch (err: unknown) {
            requestContext.log(this.logger, 'warn', 'local.runner.claude.mcp_token.check_failed', {
              runId,
              error: err,
            });
          }
        }

        if (needsRecycle) {
          const savedSessionId = this.client.getSessionId()!;
          requestContext.log(this.logger, 'debug', 'local.runner.claude.mcp_headers.stale', {
            runId,
            sessionId: session.agentic_session_id,
            savedProviderSessionId: savedSessionId,
            reasons: recycleReasons,
          });
          await this.client.disconnect();
          this.connected = false;
          await this.ensureConnected();
          hasExistingSession = false;
          // Backstop against resurrecting a Run-discarded session. The recycle
          // exists to refresh stale MCP headers on a session the Run still
          // wants to keep. Reaching here means the this.client still holds a live
          // session, so a null session.provider_session_id is unambiguous: the
          // Run has discarded the session out from under a this.client that hasn't
          // caught up. (A present id — the persisted one or a `pending_`
          // placeholder before identity is recorded — is not a discard.) On the
          // discard signal, still disconnect/reconnect for fresh headers but
          // fall through to a fresh mint instead of re-seeding the dead id.
          const runDiscardedSession = readTrimmed(session.provider_session_id) === null;
          if (runDiscardedSession) {
            persistedProviderSessionId = null;
            canResumeFromPersisted = false;
            requestContext.log(
              this.logger,
              'info',
              'local.runner.claude.mcp_headers.recycle_skipped_discarded',
              {
                runId,
                sessionId: session.agentic_session_id,
                savedProviderSessionId: savedSessionId,
              },
            );
          } else {
            persistedProviderSessionId = savedSessionId;
            canResumeFromPersisted = true;
          }
        }
      }

      const pendingAgentOutputPersists = new Set<Promise<void>>();
      let firstPersistError: unknown = null;
      let normalizationSuccessCount = 0;
      let normalizationFailureCount = 0;
      let normalizationSchemaMismatchCount = 0;

      const enqueuePersist = (writer: () => Promise<void>): void => {
        const persistPromise = writer()
          .then(() => undefined)
          .catch((error: unknown) => {
            if (!firstPersistError) {
              firstPersistError = error;
            }
          })
          .finally(() => {
            pendingAgentOutputPersists.delete(persistPromise);
          });
        pendingAgentOutputPersists.add(persistPromise);
      };

      const awaitPendingPersists = async (): Promise<void> => {
        while (pendingAgentOutputPersists.size > 0) {
          await Promise.allSettled(Array.from(pendingAgentOutputPersists));
        }
        if (firstPersistError) {
          throw firstPersistError;
        }
      };

      let firstProviderEventReceived = false;
      let firstAssistantUsageLogged = false;
      let lastProcessingKind: string | null = null;
      let bufferedAssistantOutput: Parameters<ClaudeAgentSessionRunner['emitRawEvent']>[0] | null =
        null;
      if (!hasExistingSession) {
        this.liveBackgroundTaskIds = [];
      }

      // Tool-use registry: maps tool_use_id → originating call metadata so we
      // can correlate tool_result errors back to the tool name/input that
      // triggered them. Keyed by id emitted by the model in assistant events;
      // populated from `all_tool_use_blocks` on the normalized payload.
      const toolUseRegistry = new Map<
        string,
        {
          toolName: string;
          input: Record<string, unknown>;
          timestamp: string;
          providerSessionId: string | null;
        }
      >();

      const eventsDone = new Promise<void>((resolve, reject) => {
        this.client.onEvent((event: ClaudeCodeSdkEvent) => {
          const eventRecord = toEventRecord(event);
          const eventType = readTrimmed(eventRecord['type']) ?? 'unknown';
          const message = isRecord(eventRecord['message']) ? eventRecord['message'] : null;
          // Native attachment echoes are input, not durable provider output.
          if (
            attachments.length > 0 &&
            eventType === 'user' &&
            message &&
            Array.isArray(message['content']) &&
            !message['content'].some((part) => isRecord(part) && part['type'] === 'tool_result')
          )
            return;
          this.executionCapture?.observe(event);
          const eventTimestamp =
            readFirstStringValue(eventRecord, ['timestamp', 'ts']) ?? new Date().toISOString();
          const eventSessionId = readFirstStringValue(eventRecord, [
            'session_id',
            'sessionId',
            'conversation_id',
            'conversationId',
            'thread_id',
            'threadId',
          ]);
          if (eventSessionId && eventSessionId !== this.activeProviderSessionId) {
            this.activeProviderSessionId = eventSessionId;
            // Persist provider identity to disk eagerly so that permission
            // response validation can match the session id before the run
            // completes.  Fire-and-forget — errors are non-fatal.
            void this.runStore
              .updateRunProviderIdentity(session.agentic_session_id, {
                providerSessionId: eventSessionId,
                providerSessionAgentId: session.provider_session_agent_id ?? null,
              })
              .catch((error: unknown) => {
                requestContext.log(
                  this.logger,
                  'warn',
                  'local.runner.claude.event.provider_identity_persist_failed',
                  {
                    runId,
                    sessionId: session.agentic_session_id,
                    eventSessionId,
                    error,
                  },
                );
              });
          }
          const eventAgentId =
            readFirstStringValue(eventRecord, ['agent_id', 'agentId']) ?? 'claude';
          requestContext.log(this.logger, 'trace', 'local.runner.claude.event.raw_received', {
            runId,
            sessionId: session.agentic_session_id,
            eventType,
            eventTimestamp,
            eventSessionId,
            eventAgentId,
            redactionEnabled: this.redactionConfig.enabled,
            rawEvent: redactAgentEventForLog(eventRecord, this.redactionConfig),
          });

          if (eventType === 'system' && readTrimmed(eventRecord['subtype']) === 'thinking_tokens') {
            return;
          }

          if (eventType === 'system' && readTrimmed(eventRecord['subtype']) === 'init') {
            requestContext.log(this.logger, 'info', 'local.runner.claude.tool_search.init_diff', {
              runId,
              sessionId: session.agentic_session_id,
              ...summarizeClaudeInitToolExposure(
                eventRecord,
                allowedTools ?? [...this.activeAllowedToolNames],
                this.mintedUserMcpConfig?.serverNames ?? [],
              ),
            });
          }

          const normalizedProviderEvent = normalizeProviderEventPayload({
            provider: 'claude',
            runId,
            eventType,
            timestamp: eventTimestamp,
            sessionId: eventSessionId,
            agentId: eventAgentId,
            rawEvent: eventRecord,
            config: this.normalizationConfig,
          });

          // The normalizer determines the canonical event type (e.g. 'diff',
          // 'permission_request') but the dispatcher switches on eventType.
          // Bridge the two here so diffs/permissions actually reach their
          // handlers. This mapping should move into the normalizer itself
          // during the provider→normalizer→dispatcher refactor.
          const canonicalType = normalizedProviderEvent.diagnostics.canonicalEventType;
          const resolvedEventType =
            canonicalType === 'diff'
              ? 'file_diff_detected'
              : canonicalType === 'permission_request'
                ? 'permission_request_detected'
                : eventType;

          this.emitRawEvent({
            source: 'provider',
            eventType: resolvedEventType,
            timestamp: eventTimestamp,
            sessionId: eventSessionId,
            agentId: eventAgentId,
            payload: normalizedProviderEvent.payload,
            ...(normalizedProviderEvent.facts
              ? { providerFacts: normalizedProviderEvent.facts }
              : {}),
          });

          // Populate the tool-use registry from typed normalizer facts so
          // live correlation does not depend on the provider envelope shape.
          for (const block of normalizedProviderEvent.facts?.toolUses ?? []) {
            toolUseRegistry.set(block.toolUseId, {
              toolName: block.toolName,
              input: isRecord(block.input) ? block.input : {},
              timestamp: eventTimestamp,
              providerSessionId: eventSessionId,
            });
          }

          // Keep rejection diagnostics and correlation at the appropriate severity.
          for (const result of normalizedProviderEvent.facts?.toolResults ?? []) {
            if (!result.isError) continue;
            const toolUseId = result.toolUseId;
            const origin = toolUseId ? (toolUseRegistry.get(toolUseId) ?? null) : null;
            const contentText = result.content;
            requestContext.log(
              this.logger,
              toolResultLogLevel(origin?.toolName ?? null, toolUseId, contentText, eventRecord),
              'local.runner.claude.tool_result.error',
              {
                runId,
                agenticSessionId: session.agentic_session_id,
                providerSessionId: eventSessionId,
                conversationId: session.conversationId,
                eventType,
                toolUseId,
                toolName: origin?.toolName ?? null,
                toolInput: origin?.input ?? null,
                toolCallTimestamp: origin?.timestamp ?? null,
                correlated: origin !== null,
                errorText: contentText,
                contentRaw: null,
                rawEvent: redactAgentEventForLog(eventRecord, this.redactionConfig),
              },
            );
          }

          const backgroundTasks = normalizedProviderEvent.facts?.backgroundTasks ?? null;
          if (backgroundTasks) {
            this.liveBackgroundTaskIds = backgroundTasks.liveTaskIds;
            requestContext.log(
              this.logger,
              'debug',
              'local.runner.claude.background_tasks.changed',
              {
                runId,
                sessionId: session.agentic_session_id,
                liveTaskIds: backgroundTasks.liveTaskIds,
              },
            );
          } else if (
            eventType === 'system' &&
            readTrimmed(eventRecord['subtype']) === 'background_tasks_changed'
          ) {
            requestContext.log(
              this.logger,
              'error',
              'local.runner.claude.background_tasks.unreadable',
              {
                runId,
                sessionId: session.agentic_session_id,
                rawEvent: redactAgentEventForLog(eventRecord, this.redactionConfig),
              },
            );
          }
          // A `result` while background tasks are live is not the end of the
          // Turn: the provider delivers their output afterwards and answers
          // with a later `result`. Hold settlement until a `result` arrives
          // with none live.
          const holdResultForBackgroundTasks =
            eventType === 'result' && this.liveBackgroundTaskIds.length > 0;
          if (holdResultForBackgroundTasks) {
            requestContext.log(this.logger, 'info', 'local.runner.claude.result.held', {
              runId,
              sessionId: session.agentic_session_id,
              liveTaskIds: this.liveBackgroundTaskIds,
            });
          }

          // Emit processing status on key transitions.
          if (!firstProviderEventReceived) {
            firstProviderEventReceived = true;
            lastProcessingKind = 'thinking';
            this.emitProcessingStatus({
              kind: 'loading.update',
              loadingText: 'Thinking...',
              phase: 'thinking',
            });
          }

          if (eventType === 'assistant' && lastProcessingKind !== 'writing') {
            lastProcessingKind = 'writing';
            this.emitProcessingStatus({
              kind: 'loading.update',
              loadingText: 'Writing response...',
              phase: 'writing',
            });
          } else if (
            eventType !== 'assistant' &&
            (eventType !== 'result' || holdResultForBackgroundTasks) &&
            lastProcessingKind !== 'thinking'
          ) {
            lastProcessingKind = 'thinking';
            this.emitProcessingStatus({
              kind: 'loading.update',
              loadingText: 'Thinking...',
              phase: 'thinking',
            });
          }

          if (eventType === 'result') {
            if (!holdResultForBackgroundTasks) {
              this.emitProcessingStatus({ kind: 'run.status', status: 'complete' });
            }

            // The Claude SDK `result` event carries the authoritative cumulative
            // usage + cost for the whole run. Per-turn `assistant.message.usage`
            // is unreliable as a total (under-reports for long/streamed outputs),
            // so we overwrite the accumulated value with the result totals here.
            const resultUsage = eventRecord['usage'];
            if (typeof resultUsage === 'object' && resultUsage !== null) {
              const u = resultUsage as Record<string, unknown>;
              const inputTokens = typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0;
              const outputTokens = typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0;
              const cacheCreationInputTokens =
                typeof u['cache_creation_input_tokens'] === 'number'
                  ? u['cache_creation_input_tokens']
                  : 0;
              const cacheReadInputTokens =
                typeof u['cache_read_input_tokens'] === 'number' ? u['cache_read_input_tokens'] : 0;
              const totalCostUsd = eventRecord['total_cost_usd'];
              const numTurns = eventRecord['num_turns'];
              const durationMs = eventRecord['duration_ms'];

              // Fire-and-forget — token tracking is non-fatal.
              void this.runStore
                .setRunTokenUsage(session.agentic_session_id, {
                  inputTokens,
                  outputTokens,
                  cacheCreationInputTokens,
                  cacheReadInputTokens,
                })
                .catch((err: unknown) => {
                  requestContext.log(
                    this.logger,
                    'warn',
                    'local.runner.claude.token-usage.persist-failed',
                    { runId, error: err },
                  );
                });

              if (session.promptType === 'daily_session') {
                requestContext.log(
                  this.logger,
                  'info',
                  'local.runner.claude.daily-session.result-usage',
                  {
                    runId,
                    sessionId: session.agentic_session_id,
                    inputTokens,
                    outputTokens,
                    cacheCreationInputTokens,
                    cacheReadInputTokens,
                    totalCostUsd: typeof totalCostUsd === 'number' ? totalCostUsd : null,
                    numTurns: typeof numTurns === 'number' ? numTurns : null,
                    durationMs: typeof durationMs === 'number' ? durationMs : null,
                  },
                );
              }
            }
          }
          const normalizationDiagnostics = normalizedProviderEvent.diagnostics;
          if (normalizationDiagnostics.success) {
            normalizationSuccessCount += 1;
          } else {
            normalizationFailureCount += 1;
          }
          if (normalizationDiagnostics.schemaMismatch) {
            normalizationSchemaMismatchCount += 1;
          }

          enqueuePersist(async () => {
            await this.runStore.appendEvent(session.agentic_session_id, {
              run_id: runId,
              actor: 'agent',
              event_type: 'agent_output',
              state_version: 1,
              payload: normalizedProviderEvent.payload,
            });
          });
          requestContext.log(
            this.logger,
            normalizationDiagnostics.success ? 'trace' : 'warn',
            'local.runner.claude.event.normalization',
            {
              runId,
              sessionId: session.agentic_session_id,
              eventType,
              canonicalEventType: normalizationDiagnostics.canonicalEventType,
              validationMode: normalizationDiagnostics.validationMode,
              success: normalizationDiagnostics.success,
              schemaMismatch: normalizationDiagnostics.schemaMismatch,
              errors: normalizationDiagnostics.errors,
              latencyMs: normalizationDiagnostics.latencyMs,
              normalizationSuccessCount,
              normalizationFailureCount,
              normalizationSchemaMismatchCount,
              ...(normalizationDiagnostics.success
                ? {}
                : { rawEvent: redactAgentEventForLog(eventRecord, this.redactionConfig) }),
            },
          );

          if (eventType === 'assistant') {
            // Extract and accumulate token usage from assistant events.
            // Claude SDK emits usage at event.message.usage on each turn.
            const messageObj = eventRecord['message'];
            if (typeof messageObj === 'object' && messageObj !== null) {
              const usage = (messageObj as Record<string, unknown>)['usage'];
              if (typeof usage === 'object' && usage !== null) {
                const u = usage as Record<string, unknown>;
                const inputTokens = typeof u['input_tokens'] === 'number' ? u['input_tokens'] : 0;
                const outputTokens =
                  typeof u['output_tokens'] === 'number' ? u['output_tokens'] : 0;
                const cacheCreationInputTokens =
                  typeof u['cache_creation_input_tokens'] === 'number'
                    ? u['cache_creation_input_tokens']
                    : 0;
                const cacheReadInputTokens =
                  typeof u['cache_read_input_tokens'] === 'number'
                    ? u['cache_read_input_tokens']
                    : 0;

                if (
                  inputTokens > 0 ||
                  outputTokens > 0 ||
                  cacheCreationInputTokens > 0 ||
                  cacheReadInputTokens > 0
                ) {
                  requestContext.log(
                    this.logger,
                    'debug',
                    'local.runner.claude.token-usage.accumulated',
                    {
                      runId,
                      inputTokens,
                      outputTokens,
                      cacheCreationInputTokens,
                      cacheReadInputTokens,
                    },
                  );

                  // First assistant turn's input_tokens reflects the initial prompt cost
                  // (system + user message). Log it specifically for daily-session so we
                  // can track prompt size/cost without scraping per-turn debug logs.
                  if (!firstAssistantUsageLogged && session.promptType === 'daily_session') {
                    firstAssistantUsageLogged = true;
                    requestContext.log(
                      this.logger,
                      'info',
                      'local.runner.claude.daily-session.prompt-usage',
                      {
                        runId,
                        sessionId: session.agentic_session_id,
                        inputTokens,
                        outputTokens,
                        cacheCreationInputTokens,
                        cacheReadInputTokens,
                      },
                    );
                  }

                  // Fire-and-forget — token tracking is non-fatal.
                  void this.runStore
                    .updateRunTokenUsage(session.agentic_session_id, {
                      inputTokens,
                      outputTokens,
                      cacheCreationInputTokens,
                      cacheReadInputTokens,
                    })
                    .catch((err: unknown) => {
                      requestContext.log(
                        this.logger,
                        'warn',
                        'local.runner.claude.token-usage.persist-failed',
                        { runId, error: err },
                      );
                    });
                }
              }
            }

            const text = extractAssistantText(event);
            if (text) {
              enqueuePersist(async () => {
                await this.runStore.appendEvent(session.agentic_session_id, {
                  run_id: runId,
                  actor: 'agent',
                  event_type: 'agent_output',
                  state_version: 1,
                  payload: { messageType: 'assistant', summary: text },
                });
              });

              // Flush any previously buffered assistant output before buffering the new one.
              if (bufferedAssistantOutput) {
                this.emitRawEvent(bufferedAssistantOutput);
              }
              bufferedAssistantOutput = {
                source: 'provider',
                eventType: 'agent_output',
                timestamp: eventTimestamp,
                sessionId: eventSessionId,
                agentId: eventAgentId,
                payload: { messageType: 'assistant', summary: text },
              };
            }
          } else if (eventType === 'result' && !holdResultForBackgroundTasks) {
            // Flush the buffered assistant output with taskComplete merged in,
            // so the message poster tags it with triggerNotification + actionHint
            // instead of creating a separate "Task complete" message.
            if (bufferedAssistantOutput) {
              bufferedAssistantOutput.payload = {
                ...bufferedAssistantOutput.payload,
                taskComplete: true,
              };
              this.emitRawEvent(bufferedAssistantOutput);
              bufferedAssistantOutput = null;
            }
            resolve();
          }
        });

        // If the session promise rejects (process exit, abort, etc.),
        // ensure eventsDone also settles so it doesn't hang.
        signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });

      this.inertExecution = session.inert === true;
      if (session.inert && (!platformMcpProxyMount || !this.localAgentEndpoint.get())) {
        throw new Error('Inert execution requires the scoped platform MCP proxy.');
      }
      let mcpServers: Record<string, unknown> | undefined;
      let allowedTools: string[] | undefined;
      const researchBuiltinTools = repositoryResearch
        ? resolveClaudeRepositoryResearchTools(repositoryResearch.delegation)
        : undefined;
      let sessionStartContext: SessionStartContext | null = null;
      if (!hasExistingSession) {
        requestContext.log(this.logger, 'debug', 'local.runner.claude.mcp_config.building', {
          runId,
          projectId: session.contextMetadata?.projectId,
          conversationId: session.conversationId,
        });
        try {
          const cliBaseUrl = this.localAgentEndpoint.get();
          const mcpConfig =
            platformMcpProxyMount && cliBaseUrl
              ? buildPlatformMcpProxyMcpConfig({
                  mount: platformMcpProxyMount,
                  cliBaseUrl,
                })
              : this.oauthClient
                ? await buildMcpServerConfig(
                    this.oauthClient,
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
                  )
                : null;
          if (!mcpConfig) {
            throw new Error('Scoped platform MCP proxy handle is unavailable for this turn');
          }
          mcpServers = mcpConfig.mcpServers;
          allowedTools = mcpConfig.allowedTools;
          const serverEntries = Object.keys(mcpServers);
          requestContext.log(this.logger, 'debug', 'local.runner.claude.mcp_config.built', {
            runId,
            servers: serverEntries,
            allowedToolCount: allowedTools.length,
            allowedTools,
          });
          if (!platformMcpProxyMount && this.oauthClient) {
            const freshTokenResult = await this.oauthClient.getAccessToken();
            if (freshTokenResult?.success) {
              this.lastMcpToken = freshTokenResult.data;
            }
          }
        } catch (err: unknown) {
          if (session.inert) {
            throw err;
          }
          requestContext.log(this.logger, 'warn', 'local.runner.claude.mcp_config.failed', {
            runId,
            error: err,
          });
        }
      } else {
        requestContext.log(this.logger, 'debug', 'local.runner.claude.mcp_config.skipped', {
          runId,
          hasExistingSession,
          hasOauthClient: !!this.oauthClient,
        });
      }

      if (!hasExistingSession) {
        if (!session.inert && !canResumeFromPersisted) {
          this.mintedUserMcpConfig = await loadClaudeUserMcpConfig(this.logger);
        }
        if (
          !session.inert &&
          this.mintedUserMcpConfig &&
          this.mintedUserMcpConfig.serverNames.length > 0
        ) {
          mcpServers = { ...this.mintedUserMcpConfig.mcpServers, ...(mcpServers ?? {}) };
          allowedTools = [...(allowedTools ?? []), ...this.mintedUserMcpConfig.allowedTools];
        }
      }

      // Submission tools: if the active prompt-type handler registered a set
      // of EXTERNAL_AGENT submission tools for this run, expose them as a
      // local HTTP MCP entry. The agent sees them as
      // `mcp__heyhey-submission-tools__<name>` and the CLI's local HTTP
      // endpoint executes the call + posts the action message.
      if (!hasExistingSession) {
        const runRegistration = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
        const cliBaseUrl = this.localAgentEndpoint.get();
        if (runRegistration && cliBaseUrl && runRegistration.tools.length > 0) {
          const submissionConfig = buildSubmissionToolsMcpConfig({
            token: runRegistration.token,
            cliBaseUrl,
            tools: runRegistration.tools,
          });
          mcpServers = {
            ...(mcpServers ?? {}),
            [submissionConfig.serverName]: submissionConfig.serverEntry,
          };
          allowedTools = [...(allowedTools ?? []), ...submissionConfig.allowedTools];
          requestContext.log(
            this.logger,
            'debug',
            'local.runner.claude.submission_tools.attached',
            {
              runId,
              sessionId: session.agentic_session_id,
              toolCount: runRegistration.tools.length,
              allowedTools: submissionConfig.allowedTools,
            },
          );
        } else if (runRegistration && cliBaseUrl === null) {
          requestContext.log(
            this.logger,
            'warn',
            'local.runner.claude.submission_tools.no_base_url',
            {
              runId,
              sessionId: session.agentic_session_id,
            },
          );
        }
      }

      if (!hasExistingSession) {
        this.lastBrowserMcpToken = browserMcpMount?.token ?? null;
        const browserBaseUrl = this.localAgentEndpoint.get();
        if (!session.inert && browserMcpMount && browserBaseUrl) {
          const browserConfig = buildBrowserToolsMcpConfig(browserMcpMount, browserBaseUrl);
          mcpServers = {
            ...(mcpServers ?? {}),
            [browserConfig.serverName]: browserConfig.serverEntry,
          };
          allowedTools = [...(allowedTools ?? []), ...browserConfig.allowedTools];
        }
      }

      // Built-in SDK tools (WebSearch, WebFetch, etc.) bypass the MCP config
      // entirely — they are exposed to the model as un-prefixed tool names by
      // the Claude SDK. Merge them straight into `allowedTools` so the
      // handler's `additionalBuiltinTools` actually reaches the SDK.
      if (!hasExistingSession && additionalBuiltinTools && additionalBuiltinTools.length > 0) {
        allowedTools = [...(allowedTools ?? []), ...additionalBuiltinTools];
        requestContext.log(this.logger, 'debug', 'local.runner.claude.builtin_tools.attached', {
          runId,
          sessionId: session.agentic_session_id,
          additionalBuiltinTools,
        });
      }

      // Built-in tool surface. The SDK's `--tools` flag restricts which
      // built-ins exist in the session at all, so tools outside the declared
      // surface cannot be reached even via a permission prompt — the agent has
      // no handle to them. Pre-approve any non-empty list in `allowedTools`
      // so those skip the UI permission prompt.
      //
      // `builtinTools` (explicit list, may be empty) takes precedence over
      // `readOnlyFilesystem` (shorthand for ['Read','Bash','Glob','Grep']).
      if (!hasExistingSession && researchBuiltinTools !== undefined) {
        allowedTools = Array.from(new Set([...(allowedTools ?? []), ...researchBuiltinTools]));
        requestContext.log(
          this.logger,
          'info',
          'local.runner.claude.repository_research.resolved',
          {
            runId,
            sessionId: session.agentic_session_id,
            builtinTools: researchBuiltinTools,
            promptBytes: Buffer.byteLength(prompt, 'utf8'),
            delegationRequested: repositoryResearch?.delegation === 'allowed',
            filesystemPosture: 'read-only',
          },
        );
      } else if (!hasExistingSession && builtinTools !== undefined) {
        if (builtinTools.length > 0) {
          allowedTools = Array.from(new Set([...(allowedTools ?? []), ...builtinTools]));
        }
        requestContext.log(this.logger, 'debug', 'local.runner.claude.builtin_tools.explicit', {
          runId,
          sessionId: session.agentic_session_id,
          builtinTools,
        });
      } else if (!hasExistingSession && readOnlyFilesystem) {
        allowedTools = Array.from(
          new Set([...(allowedTools ?? []), ...CLAUDE_READ_ONLY_BUILTIN_TOOLS]),
        );
        requestContext.log(this.logger, 'debug', 'local.runner.claude.builtin_tools.read_only', {
          runId,
          sessionId: session.agentic_session_id,
          builtinTools: CLAUDE_READ_ONLY_BUILTIN_TOOLS,
        });
      }

      const inertBuiltins = filterInertBuiltinTools(
        researchBuiltinTools ?? builtinTools ?? CLAUDE_READ_ONLY_BUILTIN_TOOLS,
      );
      if (session.inert) {
        allowedTools = (allowedTools ?? []).filter(
          (name) => name.startsWith('mcp__') || inertBuiltins.includes(name),
        );
        allowedTools = Array.from(new Set([...allowedTools, ...inertBuiltins]));
      }

      // Capture the turn's fully-resolved allow-list for the permission handler.
      // Only refreshed on a mint (the `!hasExistingSession` blocks above build
      // `allowedTools`); a same-session resume keeps its minted allow-list, so
      // retaining the prior value is correct.
      if (!hasExistingSession) {
        this.activeAllowedToolNames = new Set(allowedTools ?? []);
      }

      // Read the project's active work-item type definitions once per run,
      // before the system prompt is delivered. A failed read aborts session
      // start (it propagates to the run's catch) rather than opening on a stale
      // or empty ontology. Held for the next phase's prompt builder to consume.
      if (
        !hasExistingSession &&
        this.oauthClient &&
        mcpToolUseCase !== 'project_report' &&
        mcpToolUseCase !== 'release_notes'
      ) {
        sessionStartContext = await readSessionStartContext({
          oauthClient: this.oauthClient,
          projectId: session.contextMetadata?.projectId,
        });
        requestContext.log(this.logger, 'debug', 'local.runner.claude.session_start_context.read', {
          runId,
          sessionId: session.agentic_session_id,
          workItemTypeCount: sessionStartContext.workItemTypeDefinitions.length,
        });
      }

      // Assemble the platform system prompt from the run's once-per-run
      // work-item type definitions. Built here on the fresh-session path only;
      // resume turns inherit the session's original appended prompt.
      const platformSystemPrompt = sessionStartContext
        ? buildPlatformSystemPrompt(sessionStartContext.workItemTypeDefinitions, undefined, {
            intentFirst: sessionStartContext.intentFirst,
            maturity: sessionStartContext.maturity,
            hints: resolveHintPromptAccess(sessionStartContext.hintsEnabled, [
              ...this.activeAllowedToolNames,
            ]),
          })
        : null;
      const freshPlatformPromptDelivery = platformSystemPrompt
        ? composeFreshPlatformPromptDelivery({
            mode: resolveProviderPlatformPromptDeliveryMode('claude', replaceProviderSystemPrompt),
            assembledPlatformPrompt: platformSystemPrompt,
            resolvedFirstTurnInput: prompt,
            ...(startupSegments ? { startupSegments } : {}),
          })
        : null;
      const appendSystemPrompt =
        freshPlatformPromptDelivery?.mode === PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.claude
          ? freshPlatformPromptDelivery.appendedSystemPrompt
          : null;

      const systemPrompt =
        freshPlatformPromptDelivery?.mode === PLATFORM_PROMPT_DELIVERY_MODE.FULL_SYSTEM_PROMPT
          ? freshPlatformPromptDelivery.systemPrompt
          : null;
      requestContext.log(this.logger, 'debug', 'local.runner.claude.prompt_delivery.resolved', {
        runId,
        mode,
        hasExistingSession,
        deliveryMode: freshPlatformPromptDelivery?.mode ?? 'existing-session',
      });
      const toolExecutionHooks =
        this.agentOutputOwner && workspace?.ok
          ? await this.executionCapture?.session.open(this.agentOutputOwner, workspace)
          : undefined;
      const attachmentContent = await this.attachmentContentReader.read(
        attachmentRunId,
        attachments,
        this.logger,
      );
      const startSessionConfig = hasExistingSession
        ? undefined
        : {
            prompt: freshPlatformPromptDelivery?.firstTurnInput ?? prompt,
            attachments: attachmentContent,
            fastMode: session.fastMode === true,
            cwd: runCwd,
            permissionMode: 'default' as const,
            ...(toolExecutionHooks ? { toolExecutionHooks } : {}),
            ...(this.workspaceWriteBoundary
              ? {
                  workspaceContainment: repositoryResearch
                    ? this.workspaceWriteBoundary.claudeReadOnlyContainment()
                    : this.workspaceWriteBoundary.claudeContainment(),
                }
              : {}),
            ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
            ...(systemPrompt ? { systemPrompt } : {}),
            ...(canResumeFromPersisted && persistedProviderSessionId
              ? { resumeSessionId: persistedProviderSessionId }
              : {}),
            ...(mcpServers ? { mcpServers } : {}),
            ...(allowedTools ? { allowedTools } : {}),
            ...(session.inert
              ? { builtinTools: inertBuiltins }
              : researchBuiltinTools !== undefined
                ? { builtinTools: Array.from(researchBuiltinTools) }
                : builtinTools !== undefined
                  ? { builtinTools: Array.from(builtinTools) }
                  : readOnlyFilesystem
                    ? { builtinTools: Array.from(CLAUDE_READ_ONLY_BUILTIN_TOOLS) }
                    : {}),
            ...((model ?? session.model) ? { model: (model ?? session.model) as string } : {}),
            ...((reasoningEffort ?? session.reasoningEffort)
              ? {
                  reasoningEffort: (reasoningEffort ?? session.reasoningEffort) as NonNullable<
                    typeof session.reasoningEffort
                  >,
                }
              : {}),
          };

      const providerStartupInput = {
        prompt: startSessionConfig?.prompt ?? prompt,
        systemPrompt:
          startSessionConfig?.systemPrompt ?? startSessionConfig?.appendSystemPrompt ?? null,
      };
      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'app',
        event_type: 'run_started',
        state_version: 1,
        payload: {
          mode,
          prompt,
          adapterId: 'claude-sdk',
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

      // The actual resume id handed to `claude --resume`, so we can see whether
      // a tool-bearing turn takes the resume path and against which session.
      const resumeSessionIdForLog =
        canResumeFromPersisted && persistedProviderSessionId ? persistedProviderSessionId : null;
      requestContext.log(this.logger, 'info', 'local.runner.claude.session.starting', {
        runId,
        mode,
        hasExistingSession,
        canResumeFromPersisted,
        resumeSessionId: resumeSessionIdForLog,
        persistedProviderSessionId,
        sessionProviderSessionId: session.provider_session_id,
        hasMcpServers: !!mcpServers,
        mcpServerSummary: Object.keys(mcpServers ?? {}),
        hasAllowedTools: !!allowedTools,
        allowedToolCount: allowedTools?.length ?? 0,
        platformAllowedToolCount:
          allowedTools?.filter((t) => t.startsWith('mcp__heyhey-platform__')).length ?? 0,
        submissionAllowedToolCount:
          allowedTools?.filter((t) => t.startsWith('mcp__heyhey-submission-tools__')).length ?? 0,
        configKeys: startSessionConfig ? Object.keys(startSessionConfig) : ['continueSession'],
        fastModeSelection:
          session.fastMode === undefined ? 'omitted' : session.fastMode ? 'enabled' : 'disabled',
        spawnFastMode: startSessionConfig?.fastMode ?? null,
        // The exact model/effort handed to the spawn. buildArgs pushes these
        // straight onto argv as `--model`/`--effort`, so these values ARE what
        // the claude process receives. null on a same-process continuation
        // (continueSession reuses the spawn and re-supplies neither).
        spawnModel: startSessionConfig ? (model ?? session.model ?? null) : null,
        spawnReasoningEffort: startSessionConfig
          ? (reasoningEffort ?? session.reasoningEffort ?? null)
          : null,
      });

      this.emitProcessingStatus({
        kind: 'loading.update',
        loadingText: 'Starting...',
        phase: 'starting',
      });

      const sessionPromise = hasExistingSession
        ? this.client.continueSession(prompt, {
            ...(signal ? { signal } : {}),
            attachments: attachmentContent,
          })
        : this.client.startSession(startSessionConfig!, signal ? { signal } : undefined);

      const sessionSettled = sessionPromise.then(
        () =>
          requestContext.log(this.logger, 'debug', 'local.runner.claude.session_promise.settled', {
            runId,
          }),
        (err: unknown) =>
          !signal?.aborted &&
          requestContext.log(this.logger, 'warn', 'local.runner.claude.session_promise.rejected', {
            runId,
            error: err,
          }),
      );
      const eventsSettled = eventsDone.then(
        () =>
          requestContext.log(this.logger, 'debug', 'local.runner.claude.events_done.settled', {
            runId,
          }),
        (err: unknown) =>
          !signal?.aborted &&
          requestContext.log(this.logger, 'warn', 'local.runner.claude.events_done.rejected', {
            runId,
            error: err,
          }),
      );
      void sessionSettled;
      void eventsSettled;

      const [turnResult] = await Promise.all([sessionPromise, eventsDone]);
      await awaitPendingPersists();
      this.client.onEvent(null);
      // End with a newline so the next terminal output starts on a fresh line
      process.stdout.write('\n');

      if (!turnResult.ok) {
        const resumedProviderSessionId =
          !hasExistingSession && canResumeFromPersisted ? persistedProviderSessionId : null;
        if (
          resumedProviderSessionId &&
          isMissingProviderSessionResult(turnResult, resumedProviderSessionId)
        ) {
          // The transcript behind the persisted id is gone (e.g. it lived in a
          // since-deleted config dir). Drop the stale identity and answer this
          // same Turn from a fresh provider session; the fresh attempt carries
          // full prompt delivery, MCP config and containment. It cannot loop:
          // with no persisted id it never resumes.
          requestContext.log(this.logger, 'warn', 'local.runner.claude.session.resume_missing', {
            runId,
            sessionId: session.agentic_session_id,
            staleProviderSessionId: resumedProviderSessionId,
            error: turnResult.errorText,
          });
          await this.client.disconnect();
          this.connected = false;
          this.activeProviderSessionId = null;
          await this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
            providerSessionId: null,
            providerConversationId: null,
          });
          return await this.runPromptInDirectory(
            {
              ...args,
              session: {
                ...session,
                provider_session_id: null,
              } as unknown as RunPromptArgs['session'],
            },
            isolatedWorkingDirectory,
          );
        }
        // The provider session may hold real work (e.g. error_max_turns), so
        // keep its id resumable before failing the Turn.
        const failedProviderSessionId = turnResult.sessionId ?? this.client.getSessionId();
        if (failedProviderSessionId) {
          this.activeProviderSessionId = failedProviderSessionId;
          await this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
            providerSessionId: failedProviderSessionId,
            providerConversationId: null,
            providerSessionAgentId: session.provider_session_agent_id ?? null,
          });
        }
        // Not an AgentSessionRunnerError, so the catch below maps it to
        // RUN_FAILED and records run_completed with the error.
        throw new ClaudeTurnFailedError(turnResult.subtype, turnResult.errorText);
      }

      const providerSessionId = this.client.getSessionId();
      const providerConversationId = null;

      if (providerSessionId) {
        this.activeProviderSessionId = providerSessionId;
        await this.runStore.updateRunProviderIdentity(session.agentic_session_id, {
          providerSessionId,
          providerConversationId,
          providerSessionAgentId: session.provider_session_agent_id ?? null,
        });
      }

      await this.runStore.appendEvent(session.agentic_session_id, {
        run_id: runId,
        actor: 'system',
        event_type: 'run_completed',
        state_version: 1,
        payload: {
          mode,
          provider_session_id: providerSessionId,
          provider_conversation_id: providerConversationId,
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
          provider_conversation_id: providerConversationId,
          errorCount: 0,
        },
      });
      await this.runStore.updateRunStatus(session.agentic_session_id, 'complete');
      requestContext.log(this.logger, 'debug', 'local.runner.claude.run_prompt.succeeded', {
        runId,
        sessionId: session.agentic_session_id,
        providerConversationId,
        providerSessionId,
        durationMs: Date.now() - startedAt,
      });
      this.rejectPendingPermissionRequests(
        `Claude permission request was canceled because run ${runId} completed before a decision was applied.`,
      );
      this.releasePendingQuestions(
        `Claude question was canceled because run ${runId} completed before it was answered.`,
      );
      this.activeAgenticSessionId = null;

      return {
        providerSessionId: providerSessionId ?? null,
        providerConversationId,
        errorCount: 0,
      };
    } catch (error) {
      this.client.onEvent(null);
      const isExpectedServiceScopeTurnAbort =
        signal !== undefined &&
        isClaudeAbortError(error) &&
        this.agentOutputOwner?.serviceScope.consumeExpectedServiceScopeTurnAbort(signal) === true;
      if (isExpectedServiceScopeTurnAbort) {
        this.rejectPendingPermissionRequests(
          `Claude permission request was canceled because run ${runId} changed Service scope.`,
        );
        this.releasePendingQuestions(
          `Claude question was canceled because run ${runId} changed Service scope.`,
        );
        this.activeAgenticSessionId = null;
        await this.runStore.updateRunStatus(session.agentic_session_id, 'idle');
        const providerSessionId = this.client.getSessionId();
        requestContext.log(
          this.logger,
          'info',
          'local.runner.claude.run_prompt.aborted_for_service_scope',
          {
            runId,
            sessionId: session.agentic_session_id,
            mode,
            providerSessionId,
            durationMs: Date.now() - startedAt,
          },
        );
        return {
          providerSessionId,
          providerConversationId: null,
          errorCount: 0,
        };
      }
      this.rejectPendingPermissionRequests(
        `Claude permission request was canceled because run ${runId} failed before completion.`,
      );
      this.releasePendingQuestions(
        `Claude question was canceled because run ${runId} failed before completion.`,
      );
      this.activeAgenticSessionId = null;

      if (error instanceof AgentSessionRunnerError) {
        throw error;
      }

      const mapped = new AgentSessionRunnerError(
        'RUN_FAILED',
        error instanceof Error ? error.message : 'Unknown agent session runner error',
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
      if (!signal?.aborted) {
        requestContext.log(this.logger, 'error', 'local.runner.claude.run_prompt.failed', {
          runId,
          sessionId: session.agentic_session_id,
          durationMs: Date.now() - startedAt,
          error: mapped,
        });
      }
      throw mapped;
    } finally {
      await this.executionCapture?.session.end();
    }
  }

  public async resumeSession({
    reportingRepair,
    session,
    prompt,
    attachmentRunId,
    attachments = [],
    signal,
    model,
    reasoningEffort,
    additionalAllowedTools,
    additionalBuiltinTools,
    browserMcpMount,
    platformMcpProxyMount,
    skipPermissions,
    workspace,
    workspaceWriteBoundary,
    // readOnlyFilesystem is intentionally ignored on resume — the Claude SDK
    // freezes the built-in tool surface at session mint, so a resumed session
    // inherits whatever was pinned at the initial this.runPrompt call.
  }: ResumeArgs): Promise<AgentRunResult> {
    if (skipPermissions !== undefined) {
      this.skipAllPermissions = skipPermissions;
    }
    const rawPersistedSessionId = readTrimmed(session.provider_session_id);
    const persistedSessionId = nativeProviderSessionId(rawPersistedSessionId);
    if (!this.client.getSessionId() && !persistedSessionId) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.claude.resume.missing_provider_session_id',
        {
          sessionId: session.agentic_session_id,
        },
      );
      throw new AgentSessionRunnerError(
        'PROVIDER_SESSION_ID_MISSING',
        `Session ${session.agentic_session_id} does not have a provider session id.`,
      );
    }

    // The Claude SDK freezes `allowedTools` at session mint — a resumed
    // session inherits whatever the initiating handler pinned and cannot be
    // widened. If the resuming handler needs tools the pinned surface does
    // not cover, the agent will reach for them, hit a `tool not available`
    // error, and stall. Surface the gap as a structured warning at resume
    // entry so the symptom is traceable to a session-mint declaration
    // mismatch instead of a mid-Turn agent confusion.
    if (this.activeAllowedToolNames.size > 0) {
      const expected: string[] = [];
      if (additionalAllowedTools) {
        for (const name of additionalAllowedTools) {
          expected.push(`mcp__heyhey-platform__${name}`);
        }
      }
      if (additionalBuiltinTools) {
        for (const name of additionalBuiltinTools) {
          expected.push(name);
        }
      }
      const runRegistration = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
      if (runRegistration) {
        for (const tool of runRegistration.tools) {
          expected.push(`mcp__heyhey-submission-tools__${tool.name}`);
        }
      }
      if (browserMcpMount) expected.push(...BROWSER_ALLOWED_TOOLS);
      const missing = expected.filter((name) => !this.activeAllowedToolNames.has(name));
      if (missing.length > 0) {
        requestContext.log(this.logger, 'warn', 'local.runner.claude.resume.allowed_tools_gap', {
          sessionId: session.agentic_session_id,
          missingAllowedTools: missing,
          pinnedAllowedToolCount: this.activeAllowedToolNames.size,
        });
      }
    }

    const hasUserPrompt = Boolean(prompt?.trim().length);
    return this.runPrompt({
      ...(reportingRepair ? { reportingRepair } : {}),
      session,
      ...(attachmentRunId ? { attachmentRunId } : {}),
      attachments,
      prompt: hasUserPrompt ? prompt! : DEFAULT_RESUME_PROMPT,
      // A cold resume launches a new Claude process, which needs the original
      // handler's replacement policy again; warm resumes reuse the process.
      ...(session.promptType === researchHandler.promptType &&
      researchHandler.replaceProviderSystemPrompt
        ? { replaceProviderSystemPrompt: true }
        : {}),
      ...(signal ? { signal } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(browserMcpMount ? { browserMcpMount } : {}),
      ...(platformMcpProxyMount ? { platformMcpProxyMount } : {}),
      ...(workspace ? { workspace } : {}),
      ...(workspaceWriteBoundary ? { workspaceWriteBoundary } : {}),
    });
  }

  public async submitPermissionDecision({
    session,
    dispatch,
  }: PermissionDecisionDispatchArgs): Promise<PermissionDecisionDispatchResult> {
    if (dispatch.agentType !== 'claude') {
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        `Claude runner received unsupported permission decision agent type: ${dispatch.agentType}.`,
      );
    }

    const pendingPermission = this.pendingPermissionRequests.get(dispatch.routing.requestId);
    if (!pendingPermission) {
      requestContext.log(
        this.logger,
        'warn',
        'local.runner.claude.permission_decision.request_not_found',
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
      'local.runner.claude.permission_decision.dispatching',
      {
        runId: dispatch.routing.runId,
        sessionId: dispatch.routing.sessionId,
        requestId: dispatch.routing.requestId,
        decision: dispatch.decision,
        callbackType: dispatch.callbackType,
        connected: this.connected,
      },
    );
    // Collect all pending requests for the same tool (the primary request
    // plus any coalesced duplicates from parallel SDK callbacks).
    const coalescedRequests: PendingClaudePermissionRequest[] = [];
    for (const [id, pending] of this.pendingPermissionRequests) {
      if (id === dispatch.routing.requestId || pending.toolName === pendingPermission.toolName) {
        coalescedRequests.push(pending);
      }
    }
    for (const req of coalescedRequests) {
      this.pendingPermissionRequests.delete(req.requestId);
    }
    if (coalescedRequests.length > 1) {
      requestContext.log(
        this.logger,
        'info',
        'local.runner.claude.permission_decision.resolving_coalesced',
        {
          primaryRequestId: dispatch.routing.requestId,
          toolName: pendingPermission.toolName,
          coalescedCount: coalescedRequests.length - 1,
          coalescedRequestIds: coalescedRequests
            .filter((r) => r.requestId !== dispatch.routing.requestId)
            .map((r) => r.requestId),
        },
      );
    }
    if (
      dispatch.decision === 'approve' ||
      dispatch.decision === 'always_approve' ||
      dispatch.decision === 'whitelist'
    ) {
      const baseToolName = pendingPermission.toolName.replace(/^mcp__heyhey-platform__/, '');
      if (dispatch.decision === 'always_approve') {
        this.alwaysAllowedTools.add(baseToolName);
      }
      if (dispatch.decision === 'whitelist') {
        this.alwaysAllowedTools.add(baseToolName);
        this.toolRuleStore.save(baseToolName);
      }
      for (const req of coalescedRequests) {
        req.resolve({
          behavior: 'allow',
          updatedInput: req.toolInputRecord ?? {},
        });
      }
    } else {
      const denyResponse = dispatch.callbackPayload.response.response;
      const denyMessage =
        denyResponse.behavior === 'deny' ? denyResponse.message : 'Denied by user.';
      for (const req of coalescedRequests) {
        req.resolve({
          behavior: 'deny',
          message: denyMessage,
        });
      }
    }

    await recordPermissionDecisionSubmitted({
      runStore: this.runStore,
      emitRawEvent: this.emitRawEvent,
      agenticSessionId: session.agentic_session_id,
      dispatch,
    });

    requestContext.log(this.logger, 'debug', 'local.runner.claude.permission_decision.dispatched', {
      runId: dispatch.routing.runId,
      sessionId: dispatch.routing.sessionId,
      requestId: dispatch.routing.requestId,
      decision: dispatch.decision,
      callbackType: dispatch.callbackType,
      connected: this.connected,
    });

    return {
      delivered: true,
      callbackType: dispatch.callbackType,
    };
  }

  public async dispose(): Promise<void> {
    this.releasePendingQuestions('Claude question was canceled because the runner was disposed.');
    try {
      await this.client.disconnect();
    } finally {
      await this.executionCapture?.session.close();
      this.connected = false;
      this.activeProviderSessionId = null;
    }
  }

  // Drop this runner's SDK client session so the next runPrompt mints a fresh
  // provider session instead of resuming. Disconnects the owned client
  // (mirrors the mcp-headers-stale recycle path above) and resets its session
  // state so this.client.getSessionId() returns null on the next Turn. The
  // submission-tool registry token / this.lastMcpToken are deliberately left intact:
  // Run-lifecycle invariant 2 keeps the Run-scoped token stable per Run — only
  // SDK client session is reset here.
  public async discardSession(): Promise<void> {
    const discardedProviderSessionId = this.client.getSessionId();
    this.releasePendingQuestions('Claude question was canceled because the session was discarded.');
    await this.client.disconnect();
    await this.executionCapture?.session.close();
    this.connected = false;
    this.activeProviderSessionId = null;
    requestContext.log(this.logger, 'info', 'local.runner.claude.session.discarded', {
      discardedProviderSessionId,
    });
  }

  // Report the live SDK session's context-window breakdown. The ui-common
  // this.client primitive only addresses the single child-process session this
  // runner currently holds for the Run, so `providerSessionId` (when supplied)
  // is validated against that active session rather than selecting an arbitrary
  // historical one — a mismatch means the requested session is not the live one.
  public async getContextUsage(providerSessionId?: string): Promise<LocalContextData> {
    const activeSessionId = readTrimmed(this.client.getSessionId());
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.claude.context_usage.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active Claude SDK session is available to report context usage.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active Claude SDK session ${activeSessionId}.`,
      );
    }

    // The ui-common this.client validates the payload against the generated
    // LocalContextData shape via zod, but its inferred type widens optional
    // fields to `T | undefined`, which `exactOptionalPropertyTypes` rejects
    // against the DTO's bare-optional props. Reconcile at this single, already
    // schema-validated boundary.
    const contextData = (await this.client.getContextUsage()) as LocalContextData;
    requestContext.log(this.logger, 'debug', 'local.runner.claude.context_usage.succeeded', {
      activeSessionId,
      totalTokens: contextData.totalTokens,
      percentage: contextData.percentage,
    });
    return contextData;
  }

  public hasLiveSession(): boolean {
    return this.connected;
  }

  // Ask Claude Code for the claude.ai plan usage `/usage` shows. A live session
  // answers on its own child process (control requests run alongside a turn);
  // otherwise a short-lived control-only client is spawned for the one read.
  public async getProviderUsage(signal: AbortSignal): Promise<UsageData> {
    if (!this.connected) return requestClaudeUsageByControl(signal, this.logger);
    requestContext.log(this.logger, 'debug', 'local.runner.claude.provider_usage.live', {
      activeSessionId: readTrimmed(this.client.getSessionId()),
    });
    return this.client.getUsage();
  }

  // Compact the live SDK session's conversation history. RUN_BUSY is enforced
  // upstream by Run.compact(); here we only guard the runner-side invariant
  // that the live child process matches the requested provider session (when
  // one is supplied) and translate SDK-this.client failures into runner errors.
  public async compact(providerSessionId?: string): Promise<void> {
    const activeSessionId = readTrimmed(this.client.getSessionId());
    const requestedSessionId = readTrimmed(providerSessionId ?? null);
    requestContext.log(this.logger, 'debug', 'local.runner.claude.compact.started', {
      activeSessionId,
      requestedSessionId,
    });
    if (!activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        'No active Claude SDK session is available to compact.',
      );
    }
    if (requestedSessionId && requestedSessionId !== activeSessionId) {
      throw new AgentSessionRunnerError(
        'NO_ACTIVE_SESSION',
        `Requested provider session ${requestedSessionId} is not the active Claude SDK session ${activeSessionId}.`,
      );
    }

    try {
      await this.client.compact();
      requestContext.log(this.logger, 'debug', 'local.runner.claude.compact.succeeded', {
        activeSessionId,
      });
    } catch (err: unknown) {
      requestContext.log(this.logger, 'warn', 'local.runner.claude.compact.failed', {
        activeSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new AgentSessionRunnerError(
        'RUN_FAILED',
        err instanceof Error ? err.message : 'Claude compact request failed.',
        err,
      );
    }
  }

  // Report context-window usage for an idle (non-live) run by resuming its
  // persisted provider session in a throwaway child process. Unlike the live
  // `this.getContextUsage` — which queries the runner's already-this.connected this.client —
  // this spawns a fresh `claude --resume <id>` purely to issue the read-only
  // `get_context_usage` control request via an init-only connect, so the model
  // never runs a turn. The launch config mirrors `this.runPrompt` (workspace cwd,
  // MCP servers, platform system prompt, model) so the resumed reading matches
  // what the live session would report. The transient this.client is isolated from
  // the runner's live `this.client`, so this never disturbs an in-flight turn.
  public async getContextUsageByResume({
    session,
    model,
    providerSessionId: requestedProviderSessionId,
  }: ResumeArgs): Promise<LocalContextData> {
    const rawPersistedId = requestedProviderSessionId
      ? readTrimmed(requestedProviderSessionId)
      : readTrimmed(session.provider_session_id);
    const persistedProviderSessionId = nativeProviderSessionId(rawPersistedId);
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

    let mcpServers: Record<string, unknown> | undefined;
    let allowedTools: string[] | undefined;
    if (this.mintedUserMcpConfig?.serverNames.length) {
      mcpServers = this.mintedUserMcpConfig.mcpServers;
      allowedTools = [...this.activeAllowedToolNames];
    }
    let platformSystemPrompt: string | null = null;
    if (this.oauthClient) {
      try {
        const mcpConfig = await buildMcpServerConfig(
          this.oauthClient,
          {
            projectId: session.contextMetadata?.projectId,
            conversationId: session.conversationId,
            serviceId: session.launchServiceId,
            agentSessionId: session.agentic_session_id,
          },
          { additionalTools: [] },
        );
        mcpServers = { ...(mcpServers ?? {}), ...mcpConfig.mcpServers };
        allowedTools =
          this.activeAllowedToolNames.size > 0
            ? [...this.activeAllowedToolNames]
            : mcpConfig.allowedTools;
      } catch (err: unknown) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.claude.context_usage_resume.mcp_config_failed',
          { sessionId: session.agentic_session_id, error: err },
        );
      }
      // Re-deliver the assembled platform prompt on the throwaway resume so the
      // probe carries the same ontology a real turn would. Best-effort: a failed
      // read must not sink a token-usage probe, so it degrades to no appended
      // prompt rather than aborting.
      try {
        const sessionStartContext = await readSessionStartContext({
          oauthClient: this.oauthClient,
          projectId: session.contextMetadata?.projectId,
        });
        platformSystemPrompt = buildPlatformSystemPrompt(
          sessionStartContext.workItemTypeDefinitions,
          undefined,
          {
            intentFirst: sessionStartContext.intentFirst,
            maturity: sessionStartContext.maturity,
            hints: resolveHintPromptAccess(sessionStartContext.hintsEnabled, [
              ...this.activeAllowedToolNames,
            ]),
          },
        );
      } catch (err: unknown) {
        requestContext.log(
          this.logger,
          'warn',
          'local.runner.claude.context_usage_resume.session_start_context_failed',
          { sessionId: session.agentic_session_id, error: err },
        );
      }
    }

    const resolvedModel = (model ?? session.model) as string | undefined;
    const resumeClient = new ClaudeCodeSdkClient();
    requestContext.log(this.logger, 'debug', 'local.runner.claude.context_usage_resume.started', {
      sessionId: session.agentic_session_id,
      resumeSessionId: persistedProviderSessionId,
      cwd: runCwd,
      hasMcpServers: !!mcpServers,
      model: resolvedModel ?? null,
      fastMode: session.fastMode === true,
    });
    // Bound the read so a wedged child can't hang the request forever. The
    // `get_context_usage` control request is the first stdin line the resumed
    // CLI receives, which drives it to reply — we don't wait for `init`. On
    // timeout the abort signal rejects the in-flight control request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTEXT_USAGE_RESUME_TIMEOUT_MS);
    try {
      await resumeClient.connectForControl(
        {
          prompt: '',
          fastMode: session.fastMode === true,
          cwd: runCwd,
          permissionMode: 'default',
          ...(platformSystemPrompt
            ? session.promptType === researchHandler.promptType &&
              researchHandler.replaceProviderSystemPrompt
              ? { systemPrompt: platformSystemPrompt }
              : { appendSystemPrompt: platformSystemPrompt }
            : {}),
          resumeSessionId: persistedProviderSessionId,
          ...(mcpServers ? { mcpServers } : {}),
          ...(allowedTools ? { allowedTools } : {}),
          ...(resolvedModel ? { model: resolvedModel } : {}),
        },
        { signal: controller.signal },
      );
      const contextData = (await resumeClient.getContextUsage()) as LocalContextData;
      requestContext.log(
        this.logger,
        'debug',
        'local.runner.claude.context_usage_resume.succeeded',
        {
          sessionId: session.agentic_session_id,
          totalTokens: contextData.totalTokens,
          percentage: contextData.percentage,
        },
      );
      return contextData;
    } finally {
      clearTimeout(timer);
      await resumeClient.disconnect();
    }
  }
}

// Read plan usage through a throwaway control-only Claude Code process. No user
// message is sent, so no model turn runs; `get_usage` is the first stdin line.
// Aborting `signal` rejects the in-flight request; the client is always
// disconnected here.
export async function requestClaudeUsageByControl(
  signal: AbortSignal,
  logger: ServerLogger = NOOP_LOGGER,
): Promise<UsageData> {
  const client = new ClaudeCodeSdkClient();
  requestContext.log(logger, 'debug', 'local.runner.claude.provider_usage.control_started', {});
  try {
    await client.connectForControl(
      {
        prompt: '',
        fastMode: false,
        cwd: process.cwd(),
        permissionMode: 'default',
      },
      { signal },
    );
    return await client.getUsage();
  } finally {
    await client.disconnect();
  }
}
