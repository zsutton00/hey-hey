/**
 * Core types for the runtime event system.
 *
 * raw event → normalize → dispatch to handler
 *
 * NormalizedEvent is a discriminated union on `kind`. Each variant carries
 * exactly the fields its handler needs — no optional maybes, no runtime
 * narrowing. If the compiler lets you access `event.summary`, it exists.
 */

import type {
  CreateSystemMessage,
  CreateUserMessage,
  UpdateMessageDto,
  ReportType,
} from '../shared/api/index';
import type { AgentQuestionPayload } from '../shared/api/generated/api';
import {
  AgentSessionCurrentState,
  type AgentSessionCurrentState as AgentSessionCurrentStateType,
  type ConversationPhase,
  type SubmitExecutableUserMessageRequestDto,
  type SubmitExternalAgentCompletionRequestDto,
} from '../shared/api/generated/api';
import type { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { SubmissionToolAction } from '../agents/submission-tools/types';
import type { OnCompleteDeps } from '../agents/prompt-type-handler';
import type { ServerLogger } from '../server/logger';
import type { ReportSyncService } from '../server/report-sync-service';
import type { MessagePoster } from './message-poster';
import type { Run } from './run';
import type { NormalizedProviderFacts } from '../agents/providers/provider-event-normalization';

// ---------------------------------------------------------------------------
// LocalAgentOutputEvent — the raw event envelope from session runners
// ---------------------------------------------------------------------------

export interface LocalAgentOutputEvent {
  runId: string;
  source: 'provider' | 'local';
  eventType: string;
  timestamp: string;
  sessionId: string | null;
  agentId: string | null;
  payload: Record<string, unknown>;
  /** Typed provider facts are available when the provider normalizer supplied them. */
  providerFacts?: NormalizedProviderFacts;
}

// ---------------------------------------------------------------------------
// Shared base for all normalized events
// ---------------------------------------------------------------------------

interface NormalizedEventBase extends LocalAgentOutputEvent {
  kind: NormalizedEventKind;
}

// ---------------------------------------------------------------------------
// NormalizedEvent — discriminated union on `kind`
// ---------------------------------------------------------------------------

type NormalizedEventKind =
  | 'run_started'
  | 'run_completed'
  | 'assistant_delta'
  | 'assistant_complete'
  | 'processing_status'
  | 'conversation_phase'
  | 'diff'
  | 'permission'
  | 'permission_decision_recorded'
  | 'agent_question'
  | 'question_answered'
  | 'tool_use'
  | 'tool_result'
  | 'other';

export interface RunStartedEvent extends NormalizedEventBase {
  kind: 'run_started';
  prompt: string | null;
}

export interface RunCompletedEvent extends NormalizedEventBase {
  kind: 'run_completed';
  status: 'complete' | 'error';
}

export interface AssistantDeltaEvent extends NormalizedEventBase {
  kind: 'assistant_delta';
  summary: string;
}

export interface AssistantCompleteEvent extends NormalizedEventBase {
  kind: 'assistant_complete';
  summary: string;
}

/** Provider activity phase emitted by session runners before Run maps it to
 * the generated Agent Session current-state contract. */
const PROVIDER_PHASE_VALUES = [
  'starting',
  'gathering_context',
  'thinking',
  'writing',
  'idle',
  'awaiting_approval',
] as const;

export type ProviderPhase = (typeof PROVIDER_PHASE_VALUES)[number];

export const isProviderPhase = (value: unknown): value is ProviderPhase =>
  typeof value === 'string' && (PROVIDER_PHASE_VALUES as readonly string[]).includes(value);

export const PROVIDER_PHASE_TO_AGENT_SESSION_CURRENT_STATE: Record<
  ProviderPhase,
  AgentSessionCurrentStateType
> = {
  starting: AgentSessionCurrentState.Starting,
  gathering_context: AgentSessionCurrentState.GatheringContext,
  thinking: AgentSessionCurrentState.Thinking,
  writing: AgentSessionCurrentState.Writing,
  idle: AgentSessionCurrentState.Idle,
  awaiting_approval: AgentSessionCurrentState.AwaitingApproval,
};

export interface ProcessingStatusEvent extends NormalizedEventBase {
  kind: 'processing_status';
  loadingText: string | null;
  toolName: string | null;
  toolPhase: string | null;
  phase?: ProviderPhase;
}

const CONVERSATION_PHASE_VALUES = [
  'idle',
  'starting',
  'gathering_context',
  'thinking',
  'writing',
  'awaiting_approval',
  'reviewing',
] as const satisfies readonly ConversationPhase[];

export const isConversationPhase = (value: unknown): value is ConversationPhase =>
  typeof value === 'string' && (CONVERSATION_PHASE_VALUES as readonly string[]).includes(value);

export interface ConversationPhaseEvent extends NormalizedEventBase {
  kind: 'conversation_phase';
  phase: ConversationPhase;
}

export interface DiffEvent extends NormalizedEventBase {
  kind: 'diff';
  files: string[];
  awaitingPermission: boolean;
  itemId?: string;
  authority: 'confirmed' | 'provisional' | 'diagnostic';
  providerThreadId: string | null;
  providerTurnId: string | null;
  toolUses: ToolUseNormalizedBlock[];
  patches: Array<{ path: string; diff: string }>;
  /** The raw diff text (diff_blob) extracted by the normalizer. */
  diffBlob: string | null;
}

export interface PermissionEvent extends NormalizedEventBase {
  kind: 'permission';
  files: string[];
  itemId?: string;
}

export interface ToolUseNormalizedBlock {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultNormalizedBlock {
  toolUseId: string;
  isError: boolean;
  contentText: string | null;
}

export interface ToolUseEvent extends NormalizedEventBase {
  kind: 'tool_use';
  blocks: ToolUseNormalizedBlock[];
  results: ToolResultNormalizedBlock[];
  providerThreadId: string | null;
  providerTurnId: string | null;
}

export interface ToolResultEvent extends NormalizedEventBase {
  kind: 'tool_result';
  results: ToolResultNormalizedBlock[];
  providerThreadId: string | null;
  providerTurnId: string | null;
}

export interface PermissionDecisionRecordedEvent extends NormalizedEventBase {
  kind: 'permission_decision_recorded';
  requestId: string;
  decision: 'approve' | 'always_approve' | 'whitelist' | 'deny';
  decidedAt: string;
  userId?: string;
}

export interface AgentQuestionEvent extends NormalizedEventBase {
  kind: 'agent_question';
  requestId: string;
  question: AgentQuestionPayload;
}

export interface QuestionAnsweredEvent extends NormalizedEventBase {
  kind: 'question_answered';
  requestId: string;
  answers: Record<string, string>;
  answeredAt: string;
}

interface OtherEvent extends NormalizedEventBase {
  kind: 'other';
}

export type NormalizedEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | AssistantDeltaEvent
  | AssistantCompleteEvent
  | ProcessingStatusEvent
  | ConversationPhaseEvent
  | DiffEvent
  | PermissionEvent
  | PermissionDecisionRecordedEvent
  | AgentQuestionEvent
  | QuestionAnsweredEvent
  | ToolUseEvent
  | ToolResultEvent
  | OtherEvent;

// ---------------------------------------------------------------------------
// PendingDiff — diff buffered while waiting for its permission event
// ---------------------------------------------------------------------------

export interface PendingDiff {
  event: DiffEvent;
  files: string[];
  itemId?: string;
}

// ---------------------------------------------------------------------------
// ReportChainEntry — one report produced during a Run, in insertion order
//
// Append-only history of every report the Run has produced so handlers /
// prompt resolvers downstream can prepend prior turns' structured output to
// the next prompt without re-fetching from the API. Entries are frozen at
// append time; `Run.readReportChain()` returns a defensive shallow copy.
// ---------------------------------------------------------------------------

export interface ReportChainEntry {
  readonly createdAt: string;
  readonly phase: LocalPromptType;
  readonly reportId: string;
  readonly reportType: ReportType;
  readonly summary: string;
  readonly audience: 'EXTERNAL' | 'INTERNAL';
  readonly serviceId?: string;
  /**
   * PHASE_GROUNDING-only payload slice. Present iff `reportType ===
   * 'PHASE_GROUNDING'`; absent on every other report type. The
   * `submit_phase_breakdown` cross-validator reads these entries directly off
   * the Run's report chain to pair each emitted PhaseBreakdownStep with the
   * touch point that motivated it, rather than re-fetching the report body
   * from the platform. Populated by `create-phase-grounding-tool` from the
   * agent's `touchPoints` argument at the time of the
   * `create_phase_grounding` call.
   */
  readonly touchPoints?: ReadonlyArray<{
    readonly file: string;
    readonly expectedOutcome: string;
  }>;
}

// ---------------------------------------------------------------------------
// PendingTurnCompletion — an EXTERNAL_AGENT completion deferred to turn-end
//
// Captured at the moment the turn decides to complete a workflow node (a
// submission-tool call mid-stream, or a JSON-body completion at
// assistant_complete) and flushed by the Run as the turn's terminal write. The
// `stamp` is snapshotted at record time — while the Turn is still active — so
// the flushed completion records the right SDK session / prompt handler even
// though the post happens after `activeTurn` has been cleared.
// ---------------------------------------------------------------------------

export interface PendingTurnCompletion {
  /** Stable machine-effect identity reused until the platform acknowledges delivery. */
  effectId?: string;
  action: SubmissionToolAction;
  externalAgentNodeId: string;
  triggerMessageId: string;
  userFacingResponse?: string;
  /** When true the posted completion carries an AgentHidden UI element so the renderer suppresses the bubble. */
  hidden?: boolean;
  stamp: MessageStamp | null;
}

// ---------------------------------------------------------------------------
// MessagePoster — serialized generic projections plus typed completion effects
// ---------------------------------------------------------------------------

/** The poster merges conversationId and parentMessageId from args into the dto. */
export type CreateMessageBody =
  | Omit<CreateSystemMessage, 'conversationId' | 'parentMessageId'>
  | Omit<CreateUserMessage, 'conversationId' | 'parentMessageId'>
  | Omit<SubmitExecutableUserMessageRequestDto, 'conversationId' | 'parentMessageId'>;

/**
 * Provenance stamps merged onto SystemMessageData-shaped payloads at the
 * poster seam. A non-null stamp causes the poster to attach
 * `providerSessionId` and/or `promptHandler` onto the outgoing data so every
 * Turn-authored SYSTEM message records which SDK session and prompt handler
 * produced it. Either field individually may be `null` (omit-from-data
 * semantics) — the user-decision-dispatch SYSTEM completion path posts
 * without a Turn and supplies a stamp with both fields null. Callers posting
 * USER messages (or other non-SystemMessageData payloads) pass `null` here.
 */
export interface MessageStamp {
  providerSessionId: string | null;
  promptHandler: string | null;
}

/**
 * Args for `createOutOfBand` — the no-parent variant for out-of-band writes.
 * Posts a message with no explicit parent; the server resolves the
 * conversation tail. No `parentMessageId` field — the caller does not own
 * the parent decision.
 */
export interface MessagePosterCreateOutOfBandArgs {
  organizationId: string;
  projectId: string;
  conversationId: string;
  dto: CreateMessageBody;
  stamp: MessageStamp | null;
}

export interface MessagePosterExternalAgentCompletionArgs {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  effectId: string;
  request: Omit<SubmitExternalAgentCompletionRequestDto, 'proof'>;
}

// ---------------------------------------------------------------------------
// MessagePosterApiClient — the raw HTTP calls the poster delegates to
// ---------------------------------------------------------------------------

export interface MessagePosterApiClient {
  postMessage(requestParameters: {
    organizationId: string;
    projectId: string;
    createMessageDto:
      | CreateSystemMessage
      | CreateUserMessage
      | SubmitExecutableUserMessageRequestDto;
  }): Promise<unknown>;

  updateMessage(requestParameters: {
    id: string;
    projectId: string;
    organizationId: string;
    updateMessageDto: UpdateMessageDto;
  }): Promise<unknown>;

  submitExternalAgentCompletion?(
    requestParameters: MessagePosterExternalAgentCompletionArgs,
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// HandlerDeps — shared services injected into every handler
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  poster: MessagePoster;
  logger: ServerLogger;
  /**
   * Execute a response-dispatch side effect (e.g. sync final-assessment
   * report). Wired from the top-level server so the runtime stays
   * platform-agnostic. Fire-and-forget — failures log but don't abort the
   * handler.
   */
  reportSyncService?: ReportSyncService;
  /** Async deps for prompt-type onComplete hooks (report creation, etc.). */
  onCompleteDeps?: OnCompleteDeps;
}

// ---------------------------------------------------------------------------
// EventHandler — each handler takes its specific event type
// ---------------------------------------------------------------------------

type EventHandler<T extends NormalizedEvent = NormalizedEvent> = (
  event: T,
  ctx: Run,
  deps: HandlerDeps,
) => Promise<void> | void;
