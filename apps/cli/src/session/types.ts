import type {
  LocalReasoningEffort,
  LocalRunScope,
  LocalWorktreeConfig,
  LocalWorktreeStateByService,
  AgentSessionConfig,
  InternalRunPromptRequest,
  LocalRunContextMetadata,
  LocalRunReferences,
  LocalTokenUsage,
  RunEntityReference,
  ResolvedServiceBinding,
  TaskResponseDto,
} from '../shared/agent-bridge-contract/contract';
import type { AgentSessionServiceScopeRequest } from '../shared/api/generated/api';
import type {
  ReviewFileScopeContinuation,
  ReviewFileScopeReconciliation,
  ReviewFileScopeRequestPresentation,
} from '../agents/review-file-scope-request/review-file-scope-types';
import type { GatherTrace } from '../jev/trace';
import type { CanonicalFileChangeFact } from '../run/file-change-facts';

export type TaskSessionProviderPreference = 'claude' | 'codex' | 'opencode';

export type AgenticSessionStatus = 'idle' | 'running' | 'complete';
type AgenticEventActor = 'app' | 'agent' | 'system';

type AgenticEventType =
  | 'run_started'
  | 'prompt_sent'
  | 'agent_output'
  | 'run_completed'
  | 'post_processed';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheAvailability: LocalTokenUsage['cacheAvailability'];
}

export interface PreviousProviderSession {
  promptType: string;
  lastMessage: string;
  completedAt: string;
}

export interface ProviderSessionHistoryEntry {
  providerSessionId: string;
  providerConversationId: string | null;
  /** Null is permitted only for best-effort legacy event reconstruction. */
  providerSessionAgentId: string | null;
  observedAt: string;
}

/**
 * One accumulating, never-consumed inter-phase context entry. A third
 * carryover mechanism alongside `previousProviderSession` (a rolling single
 * slot) and the Run's append-only report chain: memos are append-only,
 * persisted across CLI restarts, and prepended to every subsequent phase's
 * first-turn prompt without ever being cleared. Appended directly by a
 * producer at the moment the data exists, never written by the agent.
 *
 * - `source` — the `promptType` of the handler that produced the memo
 *   (rendered as the sub-section label in the prompt block).
 * - `content` — the rendered memo body.
 * - `writtenAt` — ISO timestamp the memo was appended.
 */
export interface RunMemo {
  source: string;
  content: string;
  writtenAt: string;
}

/**
 * Durable identity of a permission presentation. The provider-side waiter is
 * process-bound, but the original conversation message must remain
 * addressable after a restart so a stale decision can settle it exactly once.
 */
export interface PermissionRequestPresentation {
  requestId: string;
  messageId: string;
}

export interface ServiceScopeRequestPresentation {
  request: AgentSessionServiceScopeRequest;
  messageId: string;
}

export interface RecoverableTurnCheckpoint {
  completedActions: readonly string[];
  discoveries: readonly string[];
  toolResults: readonly string[];
  changedFiles: readonly CanonicalFileChangeFact[];
  nextAction: string | null;
}

export interface ServiceScopeContinuation {
  input: InternalRunPromptRequest;
  checkpoint: RecoverableTurnCheckpoint;
  delivery: 'pending' | 'delivered';
  interruptedTurnId: string;
  capturedAt: string;
}

export type { ReviewFileScopeRequestPresentation } from '../agents/review-file-scope-request/review-file-scope-types';

interface AgenticNormalizedErrorSummary {
  error_type: string;
  error_reason: string;
  message: string;
  suggested_action: string;
  suggested_user_action: string;
  retryable: boolean;
  terminal: boolean;
  attempt: number;
  max_attempts: number;
  adapter: string;
  session_id: string | null;
}

type AgenticTaskMetadata = TaskResponseDto;

type AgenticSessionFileReferences = LocalRunReferences;

export type AgenticSessionContextMetadata = LocalRunContextMetadata;

/**
 * Stable loopback envelope exchanged with the generated Agent Bridge client.
 * RunStore projects this local envelope into its separate canonical durable
 * event union; provider-native fields remain valid only at this live boundary.
 */
export interface AgenticSessionEvent {
  seq: number;
  ts: string;
  app_session_id: string;
  run_id: string;
  actor: AgenticEventActor;
  event_type: AgenticEventType;
  state_version: number;
  payload?: AgenticEventPayload;
  payload_ref?: string;
}

interface AgenticSessionBase {
  agentic_session_id: string;
  /** Canonical entity scope captured from payload.entity before Run creation. */
  entity: RunEntityReference | null;
  /**
   * Resolved on-disk bindings for every service in this Run's scope. Empty
   * when the Run was launched without a service set (e.g. an entity-scoped
   * session). When non-empty, every entry has a path resolved at session
   * creation; resolution does not happen later.
   */
  services: ResolvedServiceBinding[];
  /**
   * The service the Run launched against — the one whose path is `cwd` for
   * the provider session. Required when `services` is non-empty and is
   * guaranteed to be a member of `services` by `startAgenticSession`
   * (mirroring the wire-level `launchServiceId ∈ serviceIds` invariant).
   */
  launchServiceId?: string;
  provider: string;
  provider_session_id: string;
  provider_conversation_id: string | null;
  /** Stable PromptTypeHandler.id that owns the current provider session. */
  provider_session_agent_id?: string | null;
  /**
   * Append-only membership ledger of real provider sessions — Run-owned and
   * subagent — each labelled with its owning handler id. Separate from the
   * active `provider_session_id` pointer; subagent members are never resumed.
   */
  provider_session_history?: ProviderSessionHistoryEntry[];
  status: AgenticSessionStatus;
  scope?: LocalRunScope;
  conversationId: string;
  promptType?: string;
  config?: AgentSessionConfig | null;
  worktree?: { enabled: true; branch?: string };
  worktreeState?: LocalWorktreeStateByService;
  createdAt: string;
  updatedAt: string;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  fastMode?: boolean;
  tokenUsage?: TokenUsage;
  sessionContext?: Record<string, unknown>;
  /**
   * The previous provider session's final output — the last text message the
   * provider stream emitted (what the user saw), captured at assistant_complete
   * time and consumed by the next phase's prompt resolution. Persisted so it
   * survives CLI restarts between turns. Cleared (set to null) once consumed.
   */
  previousProviderSession?: PreviousProviderSession | null;
  /**
   * Accumulating, never-consumed inter-phase context list. A producer appends
   * an entry directly as the data exists (e.g. the `create_coding_research`
   * tool); the resolver prepends every entry to subsequent phases' first-turn
   * prompts and never clears them. Persisted so the accumulated context
   * survives CLI restarts.
   */
  memos?: RunMemo[];
  /**
   * One step-by-step trace per context gathering, stored by Project Assistant's preparation as
   * gathering finishes and persisted with the Run so it survives restarts.
   */
  gatherTraces?: GatherTrace[];
  /** Permission presentations that are still actionable in the conversation. */
  permissionRequestPresentations?: PermissionRequestPresentation[];
  /** Service-scope review requests that remain actionable after a restart. */
  serviceScopeRequestPresentations?: ServiceScopeRequestPresentation[];
  /** Legacy prompt-only continuation retained for persisted Run compatibility. */
  serviceScopeContinuationInput?: InternalRunPromptRequest | undefined;
  /** Durable interrupted-Turn recovery owned by the Run. */
  serviceScopeContinuation?: ServiceScopeContinuation | undefined;
  /** Original legacy Review request evidence, retained after its controls are retired. */
  reviewFileScopeRequestPresentations?: ReviewFileScopeRequestPresentation[];
  /** Legacy shared Review input, retained for admission-owned compatibility recovery. */
  reviewFileScopeContinuation?: ReviewFileScopeContinuation | undefined;
  reviewFileScopeReconciliations?: ReviewFileScopeReconciliation[];
  /**
   * The most recent trigger's EXTERNAL_AGENT node id and trigger message id,
   * stamped on the Run when a fresh trigger dispatch arrives. Persisted so
   * the Run can rehydrate them across CLI restarts — they anchor the
   * companion-completion post emitted by the in-turn submission path. Cleared
   * (set to null) on Run.stop().
   */
  triggerExternalAgentNodeId?: string | null;
  triggerMessageId?: string | null;
  /**
   * Whether the one-shot Project Assistant subagent has already run for this
   * Run. Persisted so a CLI restart does not re-fire the gate on a Run that
   * already bootstrapped — the in-memory `_projectAssistantDone` flag alone
   * would reset to false when the Run is reconstructed. Rollout behavior is
   * intentional: Runs created before this marker was persisted have the field
   * absent and receive one bootstrap on their next participating handler;
   * persisted `true` Runs remain complete across restart and replay.
   */
  projectAssistantDone?: boolean;
  /**
   * Prompt types of every handler that has started a Turn on this Run, in
   * start order, so a restarted Run keeps the record. Absent on Runs persisted
   * before this field existed; those restore as an empty set.
   */
  startedPromptTypes?: string[];
  events: AgenticSessionEvent[];
}

export type AgenticSession = AgenticSessionBase & {
  contextMetadata: AgenticSessionContextMetadata;
};

interface CreateAgenticSessionInputBase {
  agentic_session_id?: string;
  entity: RunEntityReference | null;
  services: ResolvedServiceBinding[];
  launchServiceId?: string;
  provider: string;
  provider_session_id: string;
  provider_conversation_id?: string | null;
  provider_session_agent_id?: string | null;
  status?: AgenticSessionStatus;
  scope?: LocalRunScope;
  conversationId: string;
  promptType?: string;
  config?: AgentSessionConfig | null;
  worktree?: LocalWorktreeConfig;
  model?: string;
  reasoningEffort?: LocalReasoningEffort;
  fastMode?: boolean;
}

export type CreateAgenticSessionInput = CreateAgenticSessionInputBase & {
  contextMetadata: AgenticSessionContextMetadata;
};

export interface AgenticProviderStartDiagnostics {
  provider: string;
  action: 'startSession' | 'resumeSession';
  cwd: string;
  sandboxMode: string;
  serviceCount: number;
  launchServiceId?: string | null;
  allowedRepositoryRoots: string[];
  extraWritableDirCount: number;
  extraWritableDirs: string[];
  model?: string | null;
  effort?: string | null;
  fastModeSelection?: 'enabled' | 'disabled' | 'omitted';
  platformPromptDeliveryMode?:
    | 'appended-system-slot'
    | 'mint-turn-system-field'
    | 'initial-prefix'
    | 'base-instructions';
}

export interface AgenticRunStartedPayload {
  mode: 'prompt' | 'resume';
  prompt: string;
  adapterId: string;
  repositoryPath: string;
  /** Exact prompt fields handed to the provider startup boundary. */
  providerStartupInput?: {
    prompt: string;
    systemPrompt: string | null;
  };
  references?: AgenticSessionFileReferences;
  provider_session_id?: string;
  provider_conversation_id?: string | null;
  providerStart?: AgenticProviderStartDiagnostics;
}

export interface AgenticOutputMessagePayload {
  messageType: string;
  subtype?: string | null;
  summary?: string;
  sessionId?: string | null;
  timestamp?: number | string;
  eventType?: string;
  session_id?: string | null;
  agent_id?: string | null;
  raw_event?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AgenticOutputNormalizedErrorPayload {
  messageType: 'normalized_error';
  summary: AgenticNormalizedErrorSummary;
}

export interface AgenticRunCompletedPayload {
  mode: 'prompt' | 'resume';
  provider_session_id?: string | null;
  provider_conversation_id?: string | null;
  errorCount?: number;
  normalizedErrorCount?: number;
  error?: string;
  code?: string;
  terminalError?: AgenticNormalizedErrorSummary;
}

interface AgenticPostProcessedPayload {
  summary?: string;
  [key: string]: unknown;
}

type AgenticEventPayloadByType = {
  run_started: AgenticRunStartedPayload;
  prompt_sent: AgenticOutputMessagePayload;
  agent_output: AgenticOutputMessagePayload | AgenticOutputNormalizedErrorPayload;
  run_completed: AgenticRunCompletedPayload;
  post_processed: AgenticPostProcessedPayload;
};

type AgenticEventPayload = AgenticEventPayloadByType[AgenticEventType];

export interface AppendAgenticEventInput {
  run_id: string;
  actor: AgenticEventActor;
  event_type: AgenticEventType;
  state_version: number;
  payload?: AgenticEventPayload;
  payload_ref?: string;
}
