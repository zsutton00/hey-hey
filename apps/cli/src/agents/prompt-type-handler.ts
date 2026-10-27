import { projectModeSettingsJsonSchema } from '../generated/project-mode-contract.schema';
import type { SessionRole } from '../shared/agent-bridge-contract/generated/api';
import type { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type { AgenticSession } from '../session/types';
import type { RunStore } from '../run-store/run-store';
import type { ReportAudience, ReportType, UpdateMessageDto } from '../shared/api/index';
import type {
  AssistantDeltaEvent,
  AssistantCompleteEvent,
  MessageStamp,
  ProviderPhase,
  ReportChainEntry,
} from '../run/types';
import type { MessagePoster } from '../run/message-poster';
import type { MachineEffectProofSigner } from '../auth/machine-effect-proof';
import type { ServerLogger } from '../server/logger';
import type { EntityReportIndex } from '../server/reports/entity-report-index';
import type { PlatformWebSocketManager } from '../server/platform-ws';
import type { SubmissionToolAction, SubmissionToolDeclaration } from './submission-tools/types';
import type { SubmissionToolAuth } from './submission-tools/submission-tool-auth';
import type {
  InternalRunPromptRequest,
  LocalReasoningEffort,
  RecentUserReply,
  RunEntityReference,
} from '../shared/agent-bridge-contract/contract';
import type { AgentOutputHandler } from './agent-event-stream';
import type { OAuthClient } from '../auth/index';
import type { McpToolUseCase } from './mcp-server-config';
import type { Run } from '../run/run';
import type { ChildAgentLauncher } from '../run/child-agent-launcher';
import type { TaskMonitorDecisionStore } from './task-monitor/task-monitor-decision-store';
import type { SessionMonitorEvaluationStore } from './session-monitor';
import type { LoadedEntityPromptContext } from './entity-context/types';
import type {
  ImplementationReadinessFinding,
  ImplementationReadinessSourceSnapshot,
} from '../shared/api/generated/api';
import type { ResponseTypeToken } from './response-dispatch';
import type {
  AgentStartupPromptInput,
  AgentStartupPromptInputResult,
  AgentStartupPromptTemplate,
  AgentStartupPromptTemplateProvenance,
} from '../commands/agent-startup-prompt-input';
import type { RepositoryResearchCapability } from './providers/session-runner';

export type { RecentUserReply };

/**
 * Per-Turn context derived from the trigger's conversation window. Threaded
 * through `prepare` and `buildPrompt` so handlers that classify or react to
 * user replies (e.g. coding-plan APPROVED/REVISED) never re-walk the
 * conversation log themselves.
 *
 * `recentUserReplies` is computed once by `pending.ts` and forwarded by the
 * resolver. Always present on the resolver-built context — empty when no
 * user messages fall in the trigger's window.
 */
export interface PromptTypeHandlerContext {
  /** Agentic Run identity used to correlate handler diagnostics across a Turn. */
  runId?: string;
  /** The Turn being prepared; set on Turn prompts only. */
  turnId?: string;
  /** The Run's abort signal, read when called; undefined once the Run is not running. */
  abortSignal?: () => AbortSignal | undefined;
  /** Structured logger for handler diagnostics emitted during prompt rendering. */
  logger?: ServerLogger;
  /** Canonical persisted entity for the active Run. */
  entity?: RunEntityReference | null;
  /** Shared, validated context loaded from the persisted Run entity. */
  loadedEntityContext?: LoadedEntityPromptContext;
  /**
   * Canonical source binding for an implementation-readiness response. The
   * resolver computes this from the same startup projection used by Run
   * admission, so a handler can emit a source-bound finding without inventing
   * its revision or focal identity.
   */
  implementationReadinessSourceSnapshot?: ImplementationReadinessSourceSnapshot | null;
  /**
   * Present only when Run routed the user's message as the clarification of
   * its pending REVIEW_REQUIRED readiness finding. Carries that finding so
   * the fresh assessment can resolve it, whether or not the provider session
   * still holds the earlier exchange.
   */
  implementationReadinessClarification?: { finding: ImplementationReadinessFinding | null };
  recentUserReplies: ReadonlyArray<RecentUserReply>;
  /**
   * `parentMessageId` of the trigger message that started this Turn, computed
   * by `pending.ts` from the conversation graph. Surfaced to handlers that
   * orient on the user's prior exchange (e.g. `coding_freeform`, which
   * fetches the parent assistant message's `data.response` to quote it in
   * the system prompt). `null` when the trigger has no parent (first user
   * message in the conversation) or when the request did not arrive through
   * the dispatcher.
   */
  triggerParentMessageId: string | null;
  /**
   * True when the workflow-defined resolver determined the conversation's
   * workflow is alive but parked on a user-review gate awaiting the user
   * (e.g. the feature-sync review). Handlers that build prompts on such a
   * turn render a context block stating the workflow is waiting on a user
   * review so the agent answers conversationally and points back to the
   * pending review instead of attempting workflow work. Default (absent) is
   * false.
   */
  awaitingUserReview?: boolean;
  /**
   * Prompt types of handlers that started a Turn on the Run before this one.
   * Set on Turn prompts only; child-agent prompts have no Turn of their own
   * on the Run and omit it.
   */
  startedPromptTypes?: ReadonlySet<string>;
  /** Runtime-materialized captured MODE bundle, admitted as read-only provider context. */
  projectModeBundleDirectory?: string;
  /**
   * Run-owned temporary directory admitted as read-only provider context for
   * handlers declaring `repositorySnapshots`. The Run deletes it when it ends.
   */
  repositorySnapshotDirectory?: string;
}

export interface PromptTypeHandlerDeps {
  runStore: RunStore;
  fetchImpl: typeof fetch;
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  logger: ServerLogger;
  /** Typed terminal-result handoff for the read-only Task Monitor coordinator. */
  taskMonitorDecisionStore: TaskMonitorDecisionStore;
  /** Required evaluation-context and result handoff for Session Monitor. */
  sessionMonitorEvaluationStore: SessionMonitorEvaluationStore;
  /** Authoritative first-turn entity startup-input owner. */
  startupPromptInput: AgentStartupPromptInput;
  /** Shared launcher for handlers that fan work out to registered child handlers. */
  childAgentLauncher: Pick<ChildAgentLauncher, 'launchRegistered'>;
  /**
   * One-off, tool-free model call on the Run's own provider, model and effort.
   * Cancelled by the Turn's abort signal; rejects on failure. The Run sets
   * `startPhase` when the call begins and `endPhase` when it settles; an
   * omitted phase leaves the Run's state unchanged.
   */
  promptOnce(args: {
    prompt: string;
    startPhase?: ProviderPhase;
    endPhase?: ProviderPhase;
  }): Promise<string>;
}

/** Handler deps the application owns; the Run binds `promptOnce` to itself. */
export type PromptTypeHandlerBaseDeps = Omit<PromptTypeHandlerDeps, 'promptOnce'>;

export type { AgentStartupPromptInputResult, AgentStartupPromptTemplate };

interface ProviderPromptSemanticSegments {
  readonly stableInstructions: string;
  readonly dynamicContext: string;
}

export interface OnCompleteContext {
  runId: string;
  /** Live Run owner for completion hooks that must update shared session state. */
  run?: Run;
  organizationId: string;
  projectId: string;
  conversationId: string;
  messageId: string;
  /** Provider-session attribution for updates to the Turn's own message. */
  stamp: MessageStamp | null;
  payload?: unknown;
}

export type OnInvalidCompletionContext = Omit<OnCompleteContext, 'messageId'>;

export interface CompletionValidationFailure {
  code?: string;
  message: string;
  issues?: readonly string[];
}

export type CompletionValidationResult =
  | { ok: true }
  | { ok: false; error: CompletionValidationFailure };

/**
 * A handler-owned terminal action for a typed completion. The assistant
 * completion owner adds the active trigger identity and defers the action
 * until the turn's final write, preserving completion ordering.
 */
export interface CompletionAction {
  action: SubmissionToolAction;
  userFacingResponse?: string;
  hidden?: boolean;
}

export interface OnCompleteDeps {
  fetchImpl: typeof fetch;
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  machineEffectProofSigner: MachineEffectProofSigner;
  logger: ServerLogger;
  /** Typed terminal-result handoff for the read-only Task Monitor coordinator. */
  taskMonitorDecisionStore: TaskMonitorDecisionStore;
  /** Required evaluation-context and result handoff for Session Monitor. */
  sessionMonitorEvaluationStore: SessionMonitorEvaluationStore;
  /** Message owner for both Turn-message updates and out-of-band posts. */
  poster: MessagePoster;
  /**
   * Durable Run owner. Handlers that stash data in `prepare()` retrieve the
   * persisted session context through this owner during `onComplete()`.
   */
  runStore: RunStore;

  /**
   * Report-index owner used by handlers that create reports so future entity
   * changes can accumulate against them.
   */
  reportIndex: EntityReportIndex;

  /**
   * Platform socket owner for daily-session lifecycle updates.
   */
  platformWebSocketManager: PlatformWebSocketManager;
}

export interface PrepareResult<TPayload> {
  payload: TPayload;
  sessionContext?: Record<string, unknown>;
}

export interface ProviderExecutionSelection {
  provider: string;
  model: string;
}

export interface ResolveAdditionalAllowedToolsArgs<TPayload> {
  session: AgenticSession;
  input: InternalRunPromptRequest;
  payload: TPayload;
}

type ProjectAssistantWorkItemProposalMode = 'none' | 'create' | 'edit' | 'all';

/**
 * Handler-owned participation and capability ceiling for the one-shot
 * Project Assistant bootstrap. Absence from a handler means that handler
 * does not participate.
 */
export interface ProjectAssistantPolicy {
  allowEdgeUpdates: boolean;
  notifyDiscrepancies: boolean;
  workItemProposalMode: ProjectAssistantWorkItemProposalMode;
}

/** Unified argument bag consumed directly by the runtime SubAgent owner. */
interface SubagentSpawnArgs {
  session: AgenticSession;
  payload: unknown;
  touchedFiles: readonly string[];
  onAgentOutput: AgentOutputHandler;
  oauthClient: OAuthClient;
  logger: ServerLogger;
  signal?: AbortSignal;
  /**
   * Working directory the subagent's Claude SDK session should run in.
   * Resolved by Run.resolveTurnInputs from the session's service binding
   * (and worktree, if enabled) so the subagent edits/Bash/Glob/Grep land
   * in the same tree the parent session uses, regardless of where the
   * CLI process itself was launched. Falls back to `process.cwd()` only
   * for sessions with no serviceId (entity conversations).
   */
  cwd: string;
  /**
   * Snapshot of the Run's append-only report chain at Turn-construction
   * time. Mirrors the chain that the provider-session resolver prepends
   * for non-subagent flows so subagents see the same prior-report context
   * — every spawn helper renders this via `prependPriorReports` before
   * passing the prompt into the SDK. Empty when no reports have landed
   * yet on this Run.
   */
  priorReports: ReadonlyArray<Readonly<ReportChainEntry>>;
  /**
   * Effective model id for this Turn, resolved by `resolveTurnEffective`
   * (handler-pinned default → session.model → null) and forwarded by
   * `SubagentRunner` so the subagent's Claude SDK session runs on the same
   * model the platform current-state emission advertises. Absent when neither a
   * handler default nor a session model is set — the spawner omits the
   * field and Claude falls back to its own default.
   */
  model?: string;
  /**
   * Effective reasoning effort for this Turn, resolved alongside `model`
   * (handler-pinned default → session.reasoningEffort → null). Absent when
   * unresolved so the spawner omits the field and Claude uses its default.
   */
  reasoningEffort?: LocalReasoningEffort;
}

interface SubagentSpawnResult {
  assistantCompleted: boolean;
}

export interface OnSubagentCompleteContext {
  run: Run;
  payload: unknown;
  touchedFiles: readonly string[];
  result: SubagentSpawnResult;
  logger: ServerLogger;
  /** Report-chain length captured immediately before the isolated session starts. */
  reportChainLengthBefore: number;
}

/**
 * Outcome of a handler's per-tool permission decision. Mirrors the Claude
 * SDK's `ClaudeCodePermissionResult` discriminated union without leaking the
 * SDK type up into handler files.
 */
export type SubagentPermissionResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string };

/**
 * Per-tool-call context the runtime hands to a handler's `decidePermission`
 * hook. Lets a handler enforce dynamic policy (e.g. "Read only files the
 * coding session touched", "Bash only narrow git commands") without coupling
 * back to the SDK client or the spawn helpers.
 */
export interface SubagentPermissionContext {
  toolName: string;
  input: unknown;
  touchedFiles: readonly string[];
  touchedFilesSet: ReadonlySet<string>;
  /**
   * Canonical absolute paths of every repository the Run is allowed to
   * operate in — the launch service's repo plus any sibling-service repos
   * resolved at session start. Permission deciders use this to allow
   * cross-repo command forms (e.g. `git -C <path>`) without blowing the
   * single-repo `cwd` allowlist open.
   */
  allowedRepoRoots: ReadonlySet<string>;
  logger: ServerLogger;
  runId: string;
}

type SubagentPermissionDecider = (
  ctx: SubagentPermissionContext,
) => Promise<SubagentPermissionResult>;

/**
 * Declarative configuration consumed by the runtime `SubAgent` class. A
 * handler that runs on the subagent runner declares its MCP/built-in tool
 * allowlists, its adapter id (for run_started event labelling), and a
 * `decidePermission` hook for tools that aren't covered by the static
 * allowlist short-circuit.
 *
 * `emitNormalizedEvents` defaults to true. The final-assessment handler is
 * the one exception — it has no filesystem tools, so the dispatcher has
 * nothing useful to extract from its event stream.
 */
export interface SubagentConfig {
  /** Exclude Run-registered mutation tools for a bounded collaboration child. */
  submissionTools?: 'run-registered' | 'none';
  /** Provider sandbox ceiling for a capability that must not write files. */
  codexSandboxMode?: 'read-only' | 'workspace-write';
  /**
   * Whether the isolated subagent receives the Run's prior coding-agent
   * reports as prompt context. Defaults to true. Set false when canonical
   * runtime state is the sole authority for the subagent's inputs.
   */
  includePriorReports?: boolean;
  /**
   * MCP tool short-names (no `mcp__heyhey-platform__` prefix) the subagent
   * may call. The SDK auto-allows anything in this list without prompting.
   */
  mcpAllowedTools: readonly string[];
  /**
   * Built-in Claude Code tool names the subagent may call (e.g. `Read`,
   * `Bash`, `Edit`). The SDK auto-allows anything in this list without
   * prompting; tools needing dynamic policy still hit `decidePermission`.
   */
  builtinAllowedTools: readonly string[];
  /** Identifier stamped onto `run_started.adapterId` for tracing. */
  adapterId: string;
  /**
   * Optional per-tool permission hook. Called for every tool the SDK asks
   * the runtime about *after* the allowlist short-circuit — i.e. for tools
   * that aren't pre-approved (or for tools the handler wants to gate
   * dynamically, like commit's Bash policy). When omitted, anything in
   * either allowlist is allowed and anything else is denied.
   */
  decidePermission?: SubagentPermissionDecider;
  /**
   * Whether the SubAgent should normalize and forward Claude SDK events
   * through the subagent-event pipe (so the parent Run's dispatcher sees
   * structured tool_use blocks for touchedFiles / persistToolUsage).
   * Defaults to true. The final-assessment handler sets this to false
   * because it has no filesystem tools.
   */
  emitNormalizedEvents?: boolean;
}

/**
 * Declares one report variant a handler is expected to produce on a turn.
 * The `reports[]` array on a handler is the source of truth for the
 * runtime's report-emission contract: the type system forces every handler
 * to declare its variants at definition time, and the sibling runtime check
 * (task B4) asserts each `required` variant landed before the turn ends.
 */
export interface ProceduralRunContext {
  session: AgenticSession;
  deps: PromptTypeHandlerDeps;
}

export interface ReportSpec {
  reportType: ReportType;
  audience: ReportAudience;
  required: boolean;
}

export interface PromptTypeHandler<TPayload> {
  readonly sessionRole?: SessionRole;
  resolveSessionRole?(session: AgenticSession): SessionRole;
  /**
   * Stable identity of this logical agent. A Run persists this value as the
   * owner of its current provider session; promptType is routing metadata and
   * must not be used as provider-session identity.
   */
  id: string;

  promptType: LocalPromptType;

  /**
   * Whether a Run for this handler needs a Service. `'optional'`: with no
   * Service selected the Run executes graph-only from the CLI's current
   * directory; a selected Service still resolves a repository. `'required'`
   * always resolves one.
   */
  service: 'required' | 'optional';

  /**
   * What `payload.entity` must be at start-run: `'none'` rejects the key,
   * `'required'` demands a run entity reference, and `'required_goal'` demands
   * a TASK reference whose `taskType` is GOAL.
   */
  launchEntity: 'none' | 'required' | 'required_goal';

  /**
   * Implementation-readiness gate on admission. `'gated_and_clarifiable'` is
   * the composer-driven subset where a user reply answers a pending
   * REVIEW_REQUIRED finding instead of being rejected.
   */
  implementationReadiness: 'none' | 'gated' | 'gated_and_clarifiable';

  /** Receives the widened graph-research guidance (free-form conversational assistants). */
  graphResearchGuidance?: true;

  /** Receives the model-gated epistemic-calibration snippet (free-form conversational assistants). */
  epistemicCalibration?: true;

  /** `userMessage` is an optional guide for this handler, so an empty body is valid. */
  allowsEmptyUserMessage?: true;

  /**
   * Stable project work-item type keys this handler admits. The resolver
   * compares the authoritative type loaded from the persisted Run entity;
   * deprecated wire startupInput content is never consulted.
   */
  eligibleWorkItemTypeKeys?: readonly string[];

  /**
   * Structured response variants this handler is allowed to present. The
   * assistant output dispatcher validates the active handler and response
   * variant as a pair so a response from one flow cannot activate another
   * flow's UI or terminal side effects.
   */
  expectedResponseTypes?: readonly ResponseTypeToken[];

  /**
   * Whether startup-plan output should retain the legacy interactive
   * CodingPromptStartupPlan UI element. Report-owned plan presentation opts
   * out while continuing to use the same typed response and completion data.
   */
  emitLegacyStartupPlanUiElement?: boolean;

  /**
   * Enables the one-shot Project Assistant bootstrap for this consumer and
   * defines its maximum authority. Runtime configuration may eventually
   * narrow this declaration, but must never broaden it.
   */
  projectAssistant?: ProjectAssistantPolicy;

  /**
   * Resolves this handler's Project Assistant declaration from Run-owned
   * captured state when participation is chosen at launch rather than fixed
   * in code. When present it replaces `projectAssistant` as the declaration;
   * session configuration still narrows the result.
   */
  resolveProjectAssistant?(
    session: AgenticSession,
    logger: ServerLogger,
  ): ProjectAssistantPolicy | undefined;

  /**
   * Reports this handler is expected to emit on a successful turn. Required —
   * even handlers that emit nothing must declare an empty list, so the type
   * system rules out accidental omission. Each declared variant is matched
   * by the runtime's report-chain enforcement against what landed on the
   * Run during the turn.
   */
  reports: readonly ReportSpec[];

  /**
   * Which runner executes this handler's provider turn.
   *
   * - `'subagent'`: the turn runs in an isolated Claude SDK session owned by
   *   the shared child launcher using `subagentConfig`. The Run's persisted provider session is not
   *   touched, and the subagent's ephemeral session is discarded on
   *   `Turn.end()`.
   * - `'provider_session'`: the turn runs on the Run's persisted provider
   *   session. The picker chooses `resumeSession` when the Run already has a
   *   session, `runPrompt` for the first turn.
   * - `'procedural'`: the turn is plain code. The Run calls `runProcedure`
   *   and starts no provider session of its own; any agents the procedure
   *   needs are launched as children.
   */
  runnerKind: 'subagent' | 'provider_session' | 'procedural';

  /**
   * Whether this handler's provider session is the Run's working context.
   * The live context gauge and the default Context read select the latest
   * Run history entry whose owning handler declares true. One-off isolated
   * agents (Review, commit, final assessment) declare false so their
   * sessions stay openable without displacing the gauge.
   */
  providerSessionCountsForContext: boolean;

  /**
   * How long the Run-held provider session this handler runs on should
   * live. Meaningful only for `runnerKind: 'provider_session'` — subagent
   * handlers always run in their own ephemeral session.
   *
   * - `'run'` (default when absent): the provider session lives for the
   *   Run. Consecutive same-handler Turns resume the one session minted on
   *   the handler's first Turn — the Run-lifetime behavior every current
   *   handler relies on.
   * - `'turn'`: every Turn mints a fresh provider session that is discarded
   *   at `Turn.end()`. No SDK transcript carries from one Turn into the
   *   next; a handler that needs inter-Turn continuity must carry it
   *   explicitly in its trigger payload rather than leaning on the
   *   accumulated conversation history.
   */
  providerSessionLifetime?: 'run' | 'turn';
  /** Continue ordinary replies in this handler after its originating workflow finishes. */
  retainsConversationAfterWorkflow?: true;
  /** Replace provider defaults with the platform prompt on fresh sessions. */
  replaceProviderSystemPrompt?: boolean;

  /**
   * Rebuild the handler prompt when a same-handler user message starts a
   * fresh provider turn. This is for handlers whose prompt is a per-turn
   * evidence snapshot rather than a persistent provider-session system
   * prompt.
   */
  rebuildPromptOnUserMessage?: boolean;

  /**
   * Where this handler's provider session starts. Independent of
   * `providerSessionLifetime`: `Start` decides whether to inherit whatever
   * the Run's current session was pinned with, `Lifetime` decides whether
   * the session minted (or inherited) here survives past this Turn.
   * Meaningful only for `runnerKind: 'provider_session'` — subagent
   * handlers always run in their own ephemeral session.
   *
   * - `'inherit'` (default when absent): resume the Run's current provider
   *   session when one exists. The picker still discards on a same-Run
   *   handler swap — the prior handler's pinned system prompt and
   *   `allowedTools` cannot be re-grounded by resuming — but a consecutive
   *   same-handler Turn rides on the inherited session. This is the
   *   behavior every existing handler relies on.
   * - `'fresh'`: always mint a new provider session at Turn start,
   *   discarding any inherited one. Use this when the handler opens a tool
   *   surface its upstream handler did not pin (e.g. plan-shaping authoring
   *   tools opened on top of a feature-sync analyze session): the Claude
   *   SDK freezes `allowedTools` at session mint, so a fresh session is the
   *   only way to install the new surface.
   */
  providerSessionStart?: 'inherit' | 'fresh';

  /**
   * Required iff `runnerKind === 'subagent'`. The runtime `SubAgent` class
   * reads this declarative bag to build the isolated Claude SDK session
   * (allowlists, permission policy, event normalization, run lifecycle).
   */
  subagentConfig?: SubagentConfig;

  /** Optional isolated-child policy for a handler whose normal runner is a provider session. */
  childConfig?: SubagentConfig;

  /**
   * Required iff `runnerKind === 'procedural'`. Runs the whole Turn as code and
   * resolves with the text shown to the user when it ends. `signal` aborts when
   * the Run is stopped.
   */
  runProcedure?(payload: TPayload, ctx: ProceduralRunContext, signal: AbortSignal): Promise<string>;
  /** Persist an actionable, terminal result when this handler cannot start its Turn. */
  onStartupFailure?(
    payload: TPayload,
    context: { session: AgenticSession; deps: PromptTypeHandlerBaseDeps },
    message: string,
  ): Promise<void>;

  /** Feature-owned work performed after an isolated subagent returns. */
  onSubagentComplete?(ctx: OnSubagentCompleteContext): Promise<void>;

  /**
   * Per-handler reasoning-effort default. Precedence: request → handler → global
   * config. There is no per-handler model default: a Turn that names no model
   * launches the first model its provider reports.
   */
  defaultReasoningEffort?: LocalReasoningEffort;

  /**
   * Handler-owned executor selection for a provider-session Turn. Use this
   * only when the trigger payload carries an authoritative provider/model
   * choice that must not inherit the surrounding Run configuration.
   */
  resolveProviderExecution?(payload: TPayload): ProviderExecutionSelection;

  prepare?(
    run: AgenticSession,
    payload: TPayload,
    deps: PromptTypeHandlerDeps,
    ctx?: PromptTypeHandlerContext,
  ): Promise<PrepareResult<TPayload>>;

  buildPrompt(payload: TPayload, ctx?: PromptTypeHandlerContext): string;

  /** Provider-neutral cache semantics for handlers with a stable instruction prefix. */
  buildPromptSegments?(
    payload: TPayload,
    ctx?: PromptTypeHandlerContext,
  ): ProviderPromptSemanticSegments;

  /** Omit the generic service-less code-search note when the handler supplies its own scope. */
  omitServiceContextNote?: boolean;

  /**
   * Submission tools exposed to the local agent for an EXTERNAL_AGENT turn.
   * Each tool must produce an `action` payload whose schema matches the
   * server-side EXTERNAL_AGENT node's declared action contract. The runtime
   * validates `args` against `inputSchema` and posts the resulting action as
   * an agent-authored completion message to the conversation.
   *
   * Termination is tool-enforced: the system prompt instructs the agent to
   * either call one of these tools or ask the user a question, so the run
   * cannot end in freeform JSON.
   *
   * Enforcement: `http-mcp.ts` refuses any submission-tool call whose name is
   * not in the active turn's handler's `submissionTools`. A handler can only
   * call tools it explicitly owns.
   */
  submissionTools?: SubmissionToolDeclaration[];

  /**
   * Names of run-registered base submission tools this handler must not
   * mount or accept, for handlers whose contract excludes a shared tool.
   */
  excludedBaseSubmissionTools?: readonly string[];

  /**
   * Which tool use case this handler runs under. Controls which base MCP tool
   * list `buildMcpServerConfig` selects: `'coding'` (default) excludes
   * entity-creation tools for plan shaping that make no sense in a coding
   * context; `'general'` includes them. Ignored on resume turns — the SDK
   * freezes `allowedTools` at session start.
   */
  mcpToolUseCase?: McpToolUseCase;

  /**
   * Extra platform MCP tool short-names (no `mcp__heyhey-platform__` prefix)
   * that this handler contributes to `allowedTools` when it starts a fresh
   * provider session. Merged with the use-case base list in
   * `buildMcpServerConfig`. Ignored on resume turns because the Claude SDK
   * freezes `allowedTools` at session start; handlers that rotate through
   * the same shared session inherit whatever the initiating handler pinned.
   */
  additionalAllowedTools?: readonly string[];

  /**
   * Per-turn platform MCP tool short-names to merge with
   * `additionalAllowedTools`. Use this only when a handler can grant a narrower
   * tool surface from typed payload/session context, such as allowing plan-step
   * authoring only for an entity conversation whose entity is a PLAN.
   */
  resolveAdditionalAllowedTools?(
    args: ResolveAdditionalAllowedToolsArgs<TPayload>,
  ): readonly string[];

  /**
   * Extra Claude SDK built-in tool names (e.g. `WebSearch`, `WebFetch`) to
   * merge into the session's `allowedTools` when starting a fresh provider
   * session. Distinct from `additionalAllowedTools` because built-in tool
   * names are passed through to the SDK as-is, NOT qualified with the
   * `mcp__heyhey-platform__` prefix. Ignored on resume turns for the same
   * reason as `additionalAllowedTools` — the SDK freezes the allowlist at
   * session start.
   */
  additionalBuiltinTools?: readonly string[];

  /**
   * Provider-agnostic posture: when true, the handler's session must not
   * modify the filesystem. Each runner enforces this structurally in its own
   * way — Claude runs with a read-only built-in toolkit
   * (`--tools Read Bash Glob Grep`), Codex starts its thread with
   * `sandbox: 'read-only'`. The contract is what the handler declares; the
   * mechanism is the runner's choice. Ignored on resume turns — both
   * providers freeze the posture at session start.
   */
  readOnlyFilesystem?: boolean;

  /**
   * When true, the Run creates a temporary directory before the workspace
   * boundary is fixed, admits it as a read-only root, passes it to `prepare`
   * as `ctx.repositorySnapshotDirectory`, and deletes it when the Run ends.
   */
  repositorySnapshots?: boolean;

  /** Requests a provider-native, read-only repository research surface. */
  repositoryResearch?: RepositoryResearchCapability;

  /**
   * Explicit built-in tool surface for the handler's provider session. When
   * present, takes precedence over `readOnlyFilesystem` and is passed
   * directly to the SDK's `builtinTools` parameter. An empty array (`[]`)
   * gives the session no built-in tools at all — the project graph is the
   * only investigation surface. Ignored on resume turns (the SDK freezes the
   * built-in surface at session mint).
   */
  builtinTools?: readonly string[];

  buildStartingMessage?(payload: TPayload, ctx?: PromptTypeHandlerContext): string | null;

  transformOutput?(event: AssistantDeltaEvent | AssistantCompleteEvent): UpdateMessageDto | null;

  /**
   * Identifies a provider delta that is the handler's terminal response
   * envelope. The completion event owns validation and persistence for this
   * payload, so the delta must not also be stored as visible narration.
   */
  isCompletionOutput?(event: AssistantDeltaEvent): boolean;

  /**
   * Maps a validated terminal provider result into its canonical conversation
   * subtype before the shared completion writer persists it.
   */
  transformCompletionOutput?(
    event: AssistantCompleteEvent,
    payload?: unknown,
  ): UpdateMessageDto | null;

  /**
   * Transform a user's follow-up message before sending to the provider.
   * Tries to recognize known response shapes (e.g. plan approval JSON)
   * and format them into a clean prompt. Returns null if the message
   * isn't a recognized shape — the raw message passes through unchanged.
   */
  transformInput?(userMessage: string): string | null;

  /**
   * Async post-completion hook. Called after the message update has been
   * posted successfully. Use for side effects that require API calls
   * (e.g. report creation). Failures here do not block the message.
   */
  onComplete?(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void>;

  /**
   * Synchronous, handler-owned validation that runs before the generic
   * assistant-complete message is appended. Use this only for outputs whose
   * completion message must not exist when the handler contract is invalid.
   */
  validateCompletion?(event: AssistantCompleteEvent, payload?: unknown): CompletionValidationResult;

  /**
   * Coding completions require current-Turn validated tool reporting.
   */
  requiresChangedFileReporting?: boolean;
  /** Handler-owned non-coding completion variants have no reporting duty. */
  skipChangedFileReporting?(event: AssistantCompleteEvent): boolean;

  /**
   * Maps a provider completion into an EXTERNAL_AGENT action when the handler
   * owns a typed workflow handoff. It is also called for invalid output so a
   * handler can close the workflow with a typed `invalid_completion` result.
   */
  getCompletionAction?(event: AssistantCompleteEvent, payload?: unknown): CompletionAction | null;

  /**
   * Returns a user-facing notice when a completion with no recognised
   * response type left the Turn's required output unsaved. The notice leads
   * the ordinary reply; the Turn still completes so the user can retry.
   */
  getUnsavedOutputNotice?(
    event: AssistantCompleteEvent,
    payload: unknown,
    saved: { codingPlanElementTypes: readonly string[] },
  ): string | null;

  /**
   * Maps a provider-runner failure into an EXTERNAL_AGENT action when the
   * handler owns a typed workflow handoff. This is called only after the
   * runner fails before it can emit `assistant_complete`, so handlers can
   * preserve their workflow's retry/recovery contract without exposing raw
   * provider diagnostics to the conversation.
   */
  getRunnerFailureAction?(error: unknown, payload?: unknown): CompletionAction | null;

  /**
   * Records a rejected completion without requiring a successfully posted
   * completion message. The generic completion handler invokes this only
   * after `validateCompletion` returns a failure.
   */
  onInvalidCompletion?(
    event: AssistantCompleteEvent,
    ctx: OnInvalidCompletionContext,
    deps: OnCompleteDeps,
    failure: CompletionValidationFailure,
  ): Promise<void>;
}

/**
 * Canonical separator + preamble prepended to a user's message when it is
 * injected at the end of a launchable handler's system prompt. Owned here (not
 * in the resolver) so a format-divergent handler can fully replace the block in
 * its own `addUserMessage` override while the resolver just concatenates the
 * returned string onto the system prompt.
 */
export const USER_MESSAGE_PREAMBLE =
  '\n\n---\n\nThe user has sent the following message. Please respond to it directly:\n\n';

/**
 * Default `addUserMessage` implementation: appends the user's message under the
 * canonical preamble, or returns `null` when there is nothing to inject.
 * Launchable handlers whose prompt has no bespoke user-message heading assign
 * this directly; handlers that need a different heading provide their own.
 */
export const defaultAddUserMessage = (payload: { userMessage?: string }): string | null =>
  payload.userMessage ? `${USER_MESSAGE_PREAMBLE}${payload.userMessage}` : null;

/**
 * Block formatter for the feature-sync / plan-shaping family, which inject the
 * user message under a `User message for this turn:` label rather than the
 * default preamble. Returns the full appendable block (leading separator
 * included) or `null` when there is nothing to inject.
 */
export const turnUserMessageBlock = (userMessage: string | null | undefined): string | null => {
  const trimmed = userMessage?.trim();
  return trimmed ? `\n\nUser message for this turn:\n${trimmed}` : null;
};

/**
 * A handler whose turn can be launched (or re-entered) by a user-typed message.
 * The `TPayload extends { userMessage?: string }` bound makes the compiler
 * reject any handler whose payload lacks `userMessage`, so a launchable
 * promptType can never be wired up without the field the resolver injects from.
 *
 * `addUserMessage` returns the fully-formed block to concatenate onto the
 * system prompt (separator + heading + text), or `null` when the payload
 * carries no message. The resolver owns *where* this lands (always the prompt
 * end); the handler owns *how* it reads — `defaultAddUserMessage` for the plain
 * preamble, a bespoke override for a divergent heading.
 */
export interface UserLaunchablePromptTypeHandler<
  TPayload extends { userMessage?: string },
> extends PromptTypeHandler<TPayload> {
  addUserMessage(payload: TPayload): string | null;
}

/** Resolve only the executing handler; selected modes never set a Run-wide role. */
export function resolveHandlerSessionRole<TPayload>(
  handler: PromptTypeHandler<TPayload>,
  session: AgenticSession,
): SessionRole {
  return (
    handler.resolveSessionRole?.(session) ??
    handler.sessionRole ??
    projectModeSettingsJsonSchema.properties.sessionRole.default
  );
}
