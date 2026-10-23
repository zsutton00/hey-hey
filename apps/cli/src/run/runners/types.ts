import type { BrowserMcpMount } from '../../agents/browser-tools/browser-mcp-access';
/**
 * Runner module — the per-Turn dispatch choice.
 *
 * A `Runner` is the object `Turn.run()` invokes. One `Runner` instance is
 * built per Turn by `pickRunner(ctx)` and discarded when the Turn ends.
 *
 * Runners do NOT hold a reference to the Turn. The Run resolves every
 * Turn input (prompt, handler, processing message id) before the runner
 * is built, and packs them into a `RunnerContext` bag that names each
 * collaborator — the Run itself, the handler, the resolved prompt, the
 * raw input, the processing anchor. The Turn is an immutable value
 * object with no reverse pointer; the runner is a sibling of the Turn
 * that closes over Run directly.
 *
 * Three concrete runners live in this module:
 *
 * - `SubagentRunner` launches an isolated provider session through the shared
 *   child agent launcher using the handler's declarative `subagentConfig`.
 *   The Run's persisted provider session is not touched; the subagent's
 *   ephemeral session is discarded on `Turn.end()`.
 * - `ResumeRunner` calls `sessionRunner.resumeSession` on the Run's
 *   persisted provider session. Picked when the handler declares
 *   `runnerKind: 'provider_session'` and the Run already has a session.
 *   An empty `resolvedPrompt` signals "resume only, no new user text".
 * - `NewSessionRunner` calls `sessionRunner.runPrompt` to initialize
 *   the Run's provider session for the first time. Picked when the
 *   handler declares `runnerKind: 'provider_session'` and the Run has
 *   no session. `resolvedPrompt` must be non-empty.
 */

import type { ChildAgentLauncher } from '../child-agent-launcher';
import type { OAuthClient } from '../../auth/index';
import type { SubmissionToolRegistry } from '../../agents/submission-tools/registry';
import type { LocalAgentEndpoint } from '../../server/local-base-url';
import type { ResolvedRunWorkspace } from '../../agents/run-scope';
import type { RunWorkspaceWriteBoundary } from '../../agents/workspace-write-boundary';
import type { PlatformMcpProxyMount } from '../../agents/platform-mcp-proxy/turn-proxy';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
} from '../../agents/prompt-type-handler';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { ImplementRuntimeSelection } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalReasoningEffort } from '../../shared/agent-bridge-contract/index';
import type { ServerLogger } from '../../server/logger';
import type { RunChangedFilesReader } from '../../server/run-changed-files';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import type { Run } from '../run';
import type { ReportChainEntry } from '../types';
import type { ServiceScopeContinuation } from '../../session/types';
import type { DeterministicE2EScenarioRegistry } from './deterministic-e2e-scenario-registry';
import type {
  ProviderSessionDecision,
  ProviderSessionStartupSegments,
} from '../provider-session-startup-input';

/**
 * Per-Turn context passed to the runner at construction. Every field is
 * already resolved by Run before `pickRunner` is invoked — the runner
 * does not reach back into the Run's activeTurn pointer or re-derive
 * anything.
 */
export interface RunnerContext {
  /** The Run this Turn belongs to. Source of truth for session + run state. */
  run: Run;
  /**
   * Stable identity of the Turn that constructed this runner. Present on all
   * production contexts; optional only for runner fixtures that do not use it.
   */
  turnId?: string;
  /** The handler picked for this Turn. Always non-null — every promptType has one. */
  handler: PromptTypeHandler<unknown>;
  /**
   * The resolved prompt text. Non-null; an empty string means "no new user
   * text for this Turn" (legitimate for resume-only continuations and for
   * subagent handlers that compose their own prompts downstream).
   */
  resolvedPrompt: string;
  /** The raw `InternalRunPromptRequest`. Runners read payload / references from this. */
  input: InternalRunPromptRequest;
  /**
   * Enriched payload returned by `handler.prepare`, or `undefined` when the
   * handler has no `prepare` step. Subagent runners must prefer this over
   * `input.payload` so handler-prepared enrichment (e.g. the implement
   * handler's approved-plan lookup) reaches the spawn adapter.
   */
  preparedPayload?: unknown;
  /**
   * The working directory runners should pass to the provider runtime.
   * Resolved by Run from the session's service binding (and worktree, if
   * enabled). Always non-null; defaults to `process.cwd()` only when the
   * session has no service binding.
   */
  cwd: string;
  /**
   * The full Run-owned workspace resolution for service-bound turns. Provider
   * runners consume this object instead of deriving their own cwd so launch,
   * file-change tracking, and persisted recovery facts all share one workspace
   * identity. Absent only for non-service sessions.
   */
  workspace?: ResolvedRunWorkspace;
  /** Canonical write authority paired with `workspace`. */
  workspaceWriteBoundary?: RunWorkspaceWriteBoundary;
  /**
   * Effective model id for this Turn. Resolved by `resolveTurnEffective`
   * (handler-pinned default → session.model → null). Threaded through
   * runPrompt/resumeSession so the SDK call observes the same value the
   * `current_agent` broadcast advertises.
   */
  effectiveModel: string | null;
  /** Provider runner selected authoritatively for this Turn. */
  executionProvider?: string;
  /**
   * Effective reasoning effort for this Turn. Resolved by
   * `resolveTurnEffective` (handler-pinned default → session.reasoningEffort
   * → null). Threaded through runPrompt/resumeSession alongside `effectiveModel`.
   */
  effectiveReasoningEffort: LocalReasoningEffort | null;
  /**
   * The runtime the user picked for this Turn's sub-agent, already reflected in
   * `effectiveModel` and `effectiveReasoningEffort`. Carries the provider and Fast mode a
   * sub-agent needs; absent when the Turn runs on the Run's settings.
   */
  turnRuntime?: ImplementRuntimeSelection;
  /**
   * Snapshot of the Run's append-only report chain at Turn-construction
   * time. The runtime `SubAgent` reads this off the runner ctx and
   * prepends the same prior-report context the provider-session
   * resolver already injects for non-subagent flows.
   * Empty when no reports have landed yet on this Run.
   */
  priorReports: ReadonlyArray<Readonly<ReportChainEntry>>;
  /** Cached authoritative entity startup projection, if this Run is scoped. */
  startupPromptInput?: AgentStartupPromptInputResult;
  /** Stable/dynamic/user semantics retained from the single prompt render. */
  providerSessionStartupSegments?: ProviderSessionStartupSegments;
  /** Final provider-neutral lifecycle classification for this Turn. */
  providerSessionDecision?: ProviderSessionDecision;
  /**
   * Why a `NewSessionRunner` would be picked on this Turn. Observability-
   * only — the picker still branches on `ctx.run.hasProviderSession`. Set
   * by Run.resolveTurnInputs to `'agent-transition'` when persisted handler
   * ownership differs from the incoming handler id, and to `'first-turn'`
   * for a first or explicitly fresh mint. Absent for resume turns.
   */
  providerSessionMintReason?: 'first-turn' | 'agent-transition';
  /** Pending recovery included only when this Turn must mint a replacement provider session. */
  serviceScopeRecovery?: ServiceScopeContinuation;
  /** Scoped platform MCP mount produced by the Turn-owned proxy. */
  browserMcpMount?: BrowserMcpMount;
  platformMcpProxyMount?: PlatformMcpProxyMount;
  /** Handler-declared platform MCP short names after static + dynamic merge. */
  platformMcpAdditionalAllowedTools?: readonly string[];
  /**
   * Run-owned handler collaborators. Present on all production contexts;
   * optional only for runner fixtures that do not run procedural handlers.
   */
  handlerDeps?: PromptTypeHandlerDeps;
}

/**
 * Collaborators owned by the runner picker. Wired once when the application
 * constructs the picker; each Turn is then classified through `pick`.
 */
export interface RunnerPickerDependencies {
  deterministicE2EScenarioRegistry?: DeterministicE2EScenarioRegistry;
  sessionRunnerFacade: SessionRunnerFacade;
  childAgentLauncher?: ChildAgentLauncher;
  /** Kept for existing picker fixtures; child execution uses childAgentLauncher. */
  oauthClient?: OAuthClient;
  submissionToolRegistry?: SubmissionToolRegistry;
  localAgentEndpoint?: LocalAgentEndpoint;
  logger: ServerLogger;
  runChangedFilesReader: RunChangedFilesReader;
}
