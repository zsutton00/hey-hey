import type { RunAttachmentReference } from '../../shared/agent-bridge-contract/generated/api';
import type { BrowserMcpMount } from '../browser-tools/browser-mcp-access';
import type { AgenticSession } from '../../session/index';
import type {
  LocalContextData,
  LocalReasoningEffort,
} from '../../shared/agent-bridge-contract/contract';
import type { McpToolUseCase } from '../mcp-server-config';
import type {
  AgentPermissionDecisionDispatch,
  PermissionCallbackType,
} from '../permission-response-routing';
import type { PlatformMcpProxyMount } from '../platform-mcp-proxy/turn-proxy';
import type { ResolvedRunWorkspace } from '../run-scope';
import type { RunWorkspaceWriteBoundary } from '../workspace-write-boundary';
import type { AgentSkillCatalog, AgentSkillSelection } from './agent-skills';
import type { ProviderSessionStartupSegments } from '../../run/provider-session-startup-input';

export type AgentSessionRunnerErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'REFRESH_FAILED'
  | 'RATE_LIMITED'
  | 'MISSING_CREDENTIAL'
  | 'SESSION_NOT_FOUND'
  | 'REPO_BINDING_MISSING'
  | 'PROVIDER_SESSION_ID_MISSING'
  | 'NO_ACTIVE_SESSION'
  | 'NOT_SUPPORTED'
  | 'RUN_BUSY'
  | 'MODEL_CAPACITY'
  | 'RUN_FAILED';

export class AgentSessionRunnerError extends Error {
  readonly code: AgentSessionRunnerErrorCode;

  constructor(code: AgentSessionRunnerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AgentSessionRunnerError';
    this.code = code;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * A handler request for the provider's native repository-research surface.
 * Adapters translate this request into their installed runtime's tools and
 * permissions; it never selects a provider or creates a CLI-owned worker.
 */
export interface RepositoryResearchCapability {
  delegation: 'allowed' | 'disabled';
}

export interface RunPromptArgs {
  /** Same-Turn reporting repair: restrict execution to the reporting tool. */
  reportingRepair?: boolean;
  session: AgenticSession;
  attachmentRunId?: string;
  attachments?: readonly RunAttachmentReference[];
  prompt: string;
  /** Initiating handler's `epistemicCalibration` declaration, applied to fresh-session guidance. */
  epistemicCalibration?: true;
  /** Replace provider defaults with the platform prompt on fresh sessions. */
  replaceProviderSystemPrompt?: boolean;
  /** Pathless provider Skill identity; provider adapters resolve native paths locally. */
  skillSelection?: AgentSkillSelection;
  /** Fresh-session prompt semantics used by provider-native cache boundaries. */
  startupSegments?: ProviderSessionStartupSegments;
  references?: {
    resolved: string[];
    unresolved: string[];
  };
  signal?: AbortSignal;
  /** Template-based starting message shown in the UI while the agent begins work. */
  startingMessage?: string;
  /** When true, auto-approve all permission requests without waiting for user input. */
  skipPermissions?: boolean;
  /**
   * Which MCP tool use case this turn runs under. Sourced from the initiating
   * handler's `mcpToolUseCase`; defaults to `'coding'` when absent. Only
   * consumed by implementations that build the MCP config at session start
   * (currently the Claude and Codex SDK runners); other runners ignore it.
   */
  mcpToolUseCase?: McpToolUseCase;
  /**
   * Extra platform MCP tool short-names to merge into the session's
   * `allowedTools` when starting a fresh provider session. Sourced from the
   * initiating handler's `additionalAllowedTools`. Only consumed by
   * implementations that build the MCP config at session start
   * (currently the Claude and Codex SDK runners); other runners ignore it.
   */
  additionalAllowedTools?: readonly string[];
  /** Turn-owned local platform MCP mount for this provider call. */
  browserMcpMount?: BrowserMcpMount;
  platformMcpProxyMount?: PlatformMcpProxyMount;
  /**
   * Extra Claude SDK built-in tool names (e.g. `WebSearch`, `WebFetch`) to
   * merge into the session's `allowedTools` when starting a fresh provider
   * session. Sourced from the initiating handler's `additionalBuiltinTools`.
   * Unlike `additionalAllowedTools` these are NOT routed through the MCP
   * config — they are passed to the SDK as-is so the built-in tool names
   * stay un-prefixed.
   */
  additionalBuiltinTools?: readonly string[];
  /**
   * Provider-agnostic posture: when true, the session must not modify the
   * filesystem. Sourced from the initiating handler's `readOnlyFilesystem`.
   * Each provider runner enforces it structurally — the Claude runner pins a
   * read-only built-in tool surface (`--tools Read Bash Glob Grep`), the
   * Codex runner starts its thread with `sandbox: 'read-only'`. Runners that
   * have no enforcement mechanism ignore the flag.
   */
  readOnlyFilesystem?: boolean;
  /** Native read/search tools plus capability-gated delegation for repository research. */
  repositoryResearch?: RepositoryResearchCapability;
  /**
   * Explicit built-in tool surface for the session. When present, takes
   * precedence over `readOnlyFilesystem` and is passed directly to the SDK's
   * `builtinTools` parameter. An empty array (`[]`) gives the session no
   * built-in tools at all. Sourced from the initiating handler's
   * `builtinTools`. Ignored on resume turns.
   */
  builtinTools?: readonly string[];
  /**
   * Effective Claude model id resolved by `resolveTurnEffective` (handler
   * default → session.model). When supplied, the SDK uses this value
   * instead of `session.model`. Optional so legacy callers (tests,
   * recovery) can rely on the session-only path.
   */
  model?: string;
  /**
   * Effective Claude reasoning effort resolved by `resolveTurnEffective`
   * (handler default → session.reasoningEffort). When supplied, overrides
   * `session.reasoningEffort` for this run.
   */
  reasoningEffort?: LocalReasoningEffort;
  /**
   * Run-owned workspace for this turn. Provider runners consume this instead
   * of deriving their own launch cwd so file-change tracking and agent launch
   * share the same source of truth.
   */
  workspace?: ResolvedRunWorkspace;
  /** Run-owned write boundary derived from `workspace`; absent for service-free sessions. */
  workspaceWriteBoundary?: RunWorkspaceWriteBoundary;
}

export interface ResumeArgs {
  reportingRepair?: boolean;
  session: AgenticSession;
  attachmentRunId?: string;
  attachments?: readonly RunAttachmentReference[];
  prompt?: string;
  /** Pathless provider Skill identity; provider adapters resolve native paths locally. */
  skillSelection?: AgentSkillSelection;
  signal?: AbortSignal;
  /** See `RunPromptArgs.model`. */
  model?: string;
  /** See `RunPromptArgs.reasoningEffort`. */
  reasoningEffort?: LocalReasoningEffort;
  /** Override the provider session id to resume. When omitted, the session's stored id is used. */
  providerSessionId?: string;
  /**
   * Resuming handler's MCP tool use case. Codex rebuilds its local MCP
   * elicitation auto-approval set per turn, so it needs this even though the
   * provider-side allowedTools surface itself was pinned at session mint.
   */
  mcpToolUseCase?: McpToolUseCase;
  /**
   * Resuming handler's declared `additionalAllowedTools`. Not used to widen
   * the resumed provider-side `allowedTools` surface — providers freeze that at
   * mint — but consulted at resume entry so runners can warn or rebuild local
   * policy for the active handler.
   */
  additionalAllowedTools?: readonly string[];
  /** See `RunPromptArgs.platformMcpProxyMount`. */
  browserMcpMount?: BrowserMcpMount;
  platformMcpProxyMount?: PlatformMcpProxyMount;
  /**
   * Resuming handler's declared `additionalBuiltinTools`. Consulted at
   * resume entry for the same warning check as `additionalAllowedTools`.
   */
  additionalBuiltinTools?: readonly string[];
  /**
   * Resuming handler's declared `readOnlyFilesystem`. Both Claude and Codex
   * freeze the filesystem posture at session start, so resume cannot change
   * it; forwarded for parity with the other fields and reserved for future
   * drift-detection at resume entry.
   */
  readOnlyFilesystem?: boolean;
  /** See `RunPromptArgs.skipPermissions`. */
  skipPermissions?: boolean;
  /** See `RunPromptArgs.workspace`. */
  workspace?: ResolvedRunWorkspace;
  /** See `RunPromptArgs.workspaceWriteBoundary`. */
  workspaceWriteBoundary?: RunWorkspaceWriteBoundary;
}

export interface PromptOnceArgs {
  session: AgenticSession;
  prompt: string;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  signal: AbortSignal;
}

export interface ListSkillsArgs {
  session: AgenticSession;
  workspace?: ResolvedRunWorkspace;
}

export interface AgentRunResult {
  providerSessionId: string | null;
  providerConversationId: string | null;
  errorCount: number;
}

export interface PermissionDecisionDispatchArgs {
  session: AgenticSession;
  dispatch: AgentPermissionDecisionDispatch;
}

interface DeliveredPermissionDecisionDispatchResult {
  delivered: true;
  callbackType: PermissionCallbackType;
}

interface StalePermissionDecisionDispatchResult {
  delivered: false;
  outcome: 'stale';
  reason: 'request_not_found';
}

export type PermissionDecisionDispatchResult =
  | DeliveredPermissionDecisionDispatchResult
  | StalePermissionDecisionDispatchResult;

export interface QuestionAnswerDispatchArgs {
  requestId: string;
  idempotencyToken: string;
  /** One answer per question, keyed by question text. */
  answers: Record<string, string>;
}

export type QuestionAnswerDispatchResult =
  | { delivered: true; answeredAt: string }
  | { delivered: false; outcome: 'duplicate' }
  | { delivered: false; outcome: 'stale'; reason: 'request_not_found' };

export interface AgentSessionRunner {
  runPrompt(args: RunPromptArgs): Promise<AgentRunResult>;
  /**
   * Send one prompt with no tools, no MCP servers and no conversation, outside
   * the Run's provider session and event log, and resolve with the model's text.
   * Throws on failure; never resolves with an invented result.
   */
  promptOnce(args: PromptOnceArgs): Promise<string>;
  listSkills?(args: ListSkillsArgs): Promise<AgentSkillCatalog>;
  resumeSession(args: ResumeArgs): Promise<AgentRunResult>;
  /**
   * Report the live provider session's context-window breakdown.
   * `providerSessionId` targets a specific session when the runner exposes
   * more than one; runners with a single live session validate against it and
   * default to that session when omitted. Implementations without context
   * reporting throw `NOT_SUPPORTED`.
   */
  getContextUsage(providerSessionId?: string): Promise<LocalContextData>;
  /**
   * Report context-window usage for an idle (non-live) run by resuming its
   * persisted provider session in a throwaway child process — no prompt is
   * sent, so no turn runs. Unlike {@link getContextUsage}, this does not
   * require a live SDK session, so it serves runs that completed or that have
   * not turned since the server started. Provider-specific runners implement
   * it; callers must feature-detect. Throws
   * `PROVIDER_SESSION_ID_MISSING` when the session has no resumable provider
   * session id.
   */
  getContextUsageByResume?(args: ResumeArgs): Promise<LocalContextData>;
  /**
   * Ask the live provider session to compact its conversation history,
   * collapsing prior turns into a summary so the context window has room for
   * more work. Only provider-session runners that hold an active SDK session
   * can compact; `providerSessionId` targets a specific session when the
   * runner exposes more than one, defaulting to the single live session when
   * omitted. Implementations throw `RUN_BUSY` when a turn is already running
   * (compaction cannot interleave with an in-flight turn) and `NOT_SUPPORTED`
   * when the provider has no compaction capability. Optional so callers must
   * feature-detect; concrete runners implement it via the downstream
   * per-runner tasks.
   */
  compact?(providerSessionId?: string): Promise<void>;
  submitPermissionDecision?(
    args: PermissionDecisionDispatchArgs,
  ): Promise<PermissionDecisionDispatchResult>;
  /**
   * Resolve a waiting agent question (Claude `AskUserQuestion`) with the
   * person's answers. Claude-only; runners without an equivalent tool omit it.
   */
  submitQuestionAnswer?(args: QuestionAnswerDispatchArgs): QuestionAnswerDispatchResult;
  /**
   * Release any Run-scoped resources held by the runner (e.g. a child
   * server process). Called from Run.cleanup() — no-op on runners that
   * keep no per-Run external state.
   */
  dispose?(): Promise<void>;
  /**
   * Release the runner's live provider-session resources. Used both when a
   * handler deliberately remints and when an idle Run is reaped. This does
   * not mutate the persisted provider identity; callers decide separately
   * whether the next Run should resume or mint.
   */
  discardSession?(): void | Promise<void>;
}
