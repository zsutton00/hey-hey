import type { ImplementRuntimeSelection, RunAttachmentReference } from './generated/api';
import type {
  RunCreatePayload as GeneratedLocalCreateRunPayload,
  LocalPromptType,
  LocalRunEvent as GeneratedLocalRunEvent,
  LocalRunMode as GeneratedLocalRunMode,
  LocalRunPromptResult as GeneratedLocalRunPromptResult,
  RunReferences as LocalRunReferences,
  LocalRunScope as GeneratedLocalRunScope,
  LocalRunWorkspaceLayout as GeneratedLocalRunWorkspaceLayout,
  LocalStartupPlanDiscrepancyDisposition as GeneratedLocalStartupPlanDiscrepancyDisposition,
  LocalStartupPlanDiscrepancyReview as GeneratedLocalStartupPlanDiscrepancyReview,
  LocalStartupPlanQuestionAnswer as GeneratedLocalStartupPlanQuestionAnswer,
  LocalStartupPlanReviewSummary as GeneratedLocalStartupPlanReviewSummary,
  LocalRun as GeneratedLocalRun,
  LocalPlanExecutionPromptPayload as GeneratedLocalPlanExecutionPromptPayload,
  LocalPlanExecutionPromptPayloadPlan as GeneratedLocalPlanExecutionPromptPayloadPlan,
  CliReadProjectSessionCostsListEnvelopeBody,
  CliReadProjectSessionCostsResult,
  AgentSessionConfig as GeneratedAgentSessionConfig,
  ProjectAssistantConfig as GeneratedProjectAssistantConfig,
  RunEntityReference,
  ContextData,
  CliReadProviderSessionUsageCost,
  CliReadRunContextUsageResult,
  AgentSkillSelection,
} from './generated/api';
import type { UserMessageAdmittedServiceScope } from '../api/generated/api';
import type {
  LocalCodeReviewPromptPayload as RuntimeLocalCodeReviewPromptPayload,
  LocalCreateRunRequest as RuntimeLocalCreateRunRequest,
  LocalFeatureSyncIteratePromptPayload as RuntimeLocalFeatureSyncIteratePromptPayload,
  LocalPendingRunContext as RuntimeLocalPendingRunContext,
  LocalPlanShapingFeatureSyncIteratePromptPayload as RuntimeLocalPlanShapingFeatureSyncIteratePromptPayload,
  LocalRunDiffFilePatch as RuntimeLocalRunDiffFilePatch,
  LocalRunPromptPayload as RuntimeLocalRunPromptPayload,
  TaskMonitorConversationPromptPayload as RuntimeTaskMonitorConversationPromptPayload,
  LocalToolUsageEntry as RuntimeLocalToolUsageEntry,
  LocalWorktreeConfig as RuntimeLocalWorktreeConfig,
} from './runtime-types';
import {
  StartRunPromptPayloadReasoningEffortEnum as GENERATED_LOCAL_REASONING_EFFORT,
  StartRunPromptPayloadProviderEnum as GENERATED_LOCAL_RUN_PROVIDER,
  LocalRunMode as GENERATED_LOCAL_RUN_MODE,
  LocalRunWorkspaceLayout as GENERATED_LOCAL_RUN_WORKSPACE_LAYOUT,
} from './generated/api';

export type {
  RunReferences as LocalRunReferences,
  RunContextMetadata as LocalRunContextMetadata,
  LocalTokenUsage,
  TaskResponseDto,
} from './generated/api';
export { LocalPromptType } from './generated/api';

export const LocalRunProvider = GENERATED_LOCAL_RUN_PROVIDER;
export type LocalRunProvider = (typeof LocalRunProvider)[keyof typeof LocalRunProvider];
export type { RunEntityReference };
export type { CliReadProjectSessionCostsListEnvelopeBody, CliReadProjectSessionCostsResult };
export type { CliReadRunContextUsageResult };
export type AgentSessionConfig = GeneratedAgentSessionConfig;
export type ProjectAssistantConfig = GeneratedProjectAssistantConfig;

export const LOCAL_RUN_MODE = {
  default: GENERATED_LOCAL_RUN_MODE.Default,
  crossServiceReview: GENERATED_LOCAL_RUN_MODE.CrossServiceReview,
} as const;

type LocalRunMode = GeneratedLocalRunMode;

export const LOCAL_RUN_WORKSPACE_LAYOUT = {
  singleRepo: GENERATED_LOCAL_RUN_WORKSPACE_LAYOUT.SingleRepo,
  symlinkTree: GENERATED_LOCAL_RUN_WORKSPACE_LAYOUT.SymlinkTree,
} as const;

type LocalRunWorkspaceLayout = GeneratedLocalRunWorkspaceLayout;

export type LocalPendingRunContext = RuntimeLocalPendingRunContext;

type LocalRunPromptResult = GeneratedLocalRunPromptResult;

type LocalStartupPlanDiscrepancyDisposition = GeneratedLocalStartupPlanDiscrepancyDisposition;

export type LocalCreateRunPayload = GeneratedLocalCreateRunPayload;
type LocalRunPromptPayload =
  | (import('./runtime-types').LocalCodingFreeformPromptPayload & {
      promptType: 'coding_freeform';
    })
  | (import('./runtime-types').LocalFinalAssessmentPromptPayload & {
      promptType: 'final_assessment';
    })
  | (import('./runtime-types').LocalPlanShapingFeatureSyncDiscussPromptPayload & {
      promptType: 'plan_shaping_feature_sync_discuss';
    });
export type LocalRunDiffFilePatch = RuntimeLocalRunDiffFilePatch;

/**
 * Broad in-memory union that the hand-written `LocalRunPromptRequest` envelope
 * uses for its `payload` field. The wire-level follow-up payload
 * (`LocalRunPromptPayload`) is narrow — only `coding_freeform` and
 * `final_assessment` — but the same envelope is reused inside the CLI runtime
 * for handler
 * dispatch over any payload (daily_session, report_update, etc.). Keep the
 * two distinct: validate against `LocalRunPromptPayload` at the wire
 * boundary, route against `LocalAnyPromptPayload` internally.
 */
export type LocalAnyPromptPayload =
  | LocalCreateRunPayload
  | LocalRunPromptPayload
  | import('../api/generated/api').SessionMessageInput
  | RuntimeLocalFeatureSyncIteratePromptPayload
  | RuntimeLocalPlanShapingFeatureSyncIteratePromptPayload
  | RuntimeLocalCodeReviewPromptPayload
  | RuntimeTaskMonitorConversationPromptPayload;

export type TaskMonitorConversationPromptPayload = RuntimeTaskMonitorConversationPromptPayload;

/**
 * One resolved entry in a Run's services set: a service id paired with its
 * on-disk repository path. Resolved once at session creation by walking every
 * id on the wire `LocalPendingRunContext.serviceIds` through `repoStore`.
 */
export interface ResolvedServiceBinding {
  id: string;
  path: string;
}

/**
 * Generic in-memory overlay for handlers whose `prepare` step stitches
 * additional context fields onto a wire payload before invoking `buildPrompt`.
 * Wire payload `T` carries only what crosses the HTTP boundary; the
 * `Prepared<T>` shape lets handlers attach run-scoped fields (e.g.
 * `priorPromptType`, the resolved `services` set + `launchServiceId`,
 * `priorAssistantMessage`, `taskId` for the `coding_freeform` handler)
 * without polluting the wire contract.
 */
export type Prepared<T> = T & {
  priorPromptType?: string;
  services?: ResolvedServiceBinding[];
  launchServiceId?: string;
  worktreeState?: LocalWorktreeStateByService;
  priorAssistantMessage?: string;
  taskId?: string;
};

export interface LocalRunPromptRequest {
  /**
   * In-memory routing key. Mirrors `payload.promptType` for ergonomic access
   * from runtime/scheduler code that does not destructure the payload. Both
   * sides must agree — the wire validator stamps them together from a single
   * source (the trigger envelope's `handlerPromptType` or the payload's own
   * discriminator).
   */
  promptType: LocalPromptType;
  payload?: LocalAnyPromptPayload;
  references: LocalRunReferences;
  attachments?: readonly RunAttachmentReference[];
  attachUserMessageData?: boolean;
  userMessageData?: { [key: string]: any };
  /**
   * The (externalAgentNodeId, triggerMessageId) pair that identifies which
   * paused workflow node this turn is answering and which trigger message
   * initiated it. Either both are present (a complete pair that will rotate
   * the Run's stamped context) or neither is (absent / null — leave the Run's
   * existing stamped pair unchanged). A partial pair is not representable:
   * callers cannot supply one id without the other.
   *
   * `undefined` = absent (no rotation); `null` = explicit-clear; object = rotate.
   */
  triggerContext?: { externalAgentNodeId: string; triggerMessageId: string } | null;
  /** Pathless provider Skill identity; the provider resolves it within the Run workspace. */
  skillSelection?: AgentSkillSelection;
  /**
   * The runtime the user picked for this one Turn's sub-agent (Commit or Review). Applies to
   * that Turn only: the Run's stored runtime is untouched. Absent means the Run's current
   * settings; fields omitted within a selection are not filled from the Run.
   */
  turnRuntime?: ImplementRuntimeSelection;
  /**
   * Marker set only by the workflow-defined wire resolver when the platform
   * reports the conversation's workflow is alive but parked on a user-review
   * gate awaiting the user (e.g. the feature-sync review). The turn is
   * dispatched as a conversational follow-up rather than the flow's terminal
   * prompt type; downstream handlers detect this marker to suppress action
   * tools and state in the prompt that the workflow is waiting on the user.
   * Never supplied by HTTP callers — `getConversationPromptType` is the sole
   * authority on whether the workflow is awaiting a user review.
   */
  awaitingUserReview?: boolean;
}

/**
 * Internal-only narrowing of `LocalRunPromptRequest`. At the wire edge,
 * `triggerContext` is optional to keep callers that do not participate in
 * workflow-node dispatch from having to construct the pair. Once the wire
 * edge has normalized the field, every internal call site sees either a
 * complete pair or an explicit null — there is no `undefined` past the seam.
 */
export type InternalRunPromptRequest = Omit<LocalRunPromptRequest, 'triggerContext'> & {
  /** Durable correlation only; execution authority remains in the admission owner. */
  inputAdmissionTurnId?: string;
  triggerContext: { externalAgentNodeId: string; triggerMessageId: string } | null;
};

/**
 * Wire-edge normalizer: collapses an absent `triggerContext` into an explicit
 * `null` so internal code sees the narrowed `InternalRunPromptRequest` shape.
 */
export const toInternalRunPromptRequest = (
  input: LocalRunPromptRequest,
): InternalRunPromptRequest => ({
  ...input,
  ...(input.attachments
    ? {
        attachments: Object.freeze(
          input.attachments.map((reference) => Object.freeze({ ...reference })),
        ),
      }
    : {}),
  triggerContext: input.triggerContext ?? null,
});

/**
 * A single USER message that landed on a trigger's conversation node between
 * the anchor (the previous trigger's completion, or epoch on the first
 * trigger) and the current trigger. Internal-only — never crosses the wire.
 * Computed by `pending.ts` from the conversation tree and threaded through
 * `MessageService.sendMessage`'s `options` arg.
 */
export interface RecentUserReply {
  messageId: string;
  text: string;
  createdAt: string;
}

/**
 * In-process-only inputs to `MessageService.sendMessage` that are not part
 * of the wire contract. The conversation dispatcher uses this to forward
 * `recentUserReplies` for handlers that classify user replies (e.g.
 * coding-plan APPROVED/REVISED). HTTP callers do not supply it.
 */
export interface SendMessageOptions {
  /** Complete Service grant persisted with the authenticated USER message. */
  admittedServiceScope?: UserMessageAdmittedServiceScope;

  admittedInput?: {
    turnId: string;
    onStarted: () => Promise<void>;
    onRejected: () => Promise<void>;
    onSettled: (outcome: {
      turnId: string;
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
      reports: string[];
      settledAt?: string;
    }) => Promise<void>;
  };

  admittedSessionMessage?: {
    turnId: string;
    admissionId: string;
    onTurnSettled: (outcome: {
      turnId: string;
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
    }) => Promise<void>;
  };
  /**
   * Identity of the canonical USER Message that caused this signed
   * `user_message` trigger. It is private scheduling metadata: the Message
   * body remains in the platform conversation and this id never enters the
   * prompt payload or the provider session.
   */
  sourceUserMessageId?: string;
  onTurnStarted?: (turnId: string) => void;
  onTurnSettled?: (outcome: {
    turnId: string;
    terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
    completedAssistantMessageId: string | null;
  }) => void;
  recentUserReplies?: ReadonlyArray<RecentUserReply>;
  /**
   * `parentMessageId` of the trigger message, computed by `pending.ts` from
   * the conversation graph. Threaded into the resolver and surfaced on
   * `PromptTypeHandlerContext` so handlers that quote the prior exchange
   * (e.g. `coding_freeform`) can fetch the parent message's `data.response`
   * via the platform API without re-walking the conversation log. `null`
   * when the trigger is the conversation's first message; absent for HTTP
   * callers that did not arrive through the dispatcher.
   */
  triggerParentMessageId?: string | null;
}

/** Extract the user-facing text from a prompt request. */
export const resolvePromptText = (item: LocalRunPromptRequest): string | null => {
  const payload = item.payload;
  return payload && 'userMessage' in payload && typeof payload.userMessage === 'string'
    ? payload.userMessage
    : null;
};

export type LocalRunScope = GeneratedLocalRunScope;

export type LocalCreateRunRequest = RuntimeLocalCreateRunRequest;

/**
 * Return shape of monitor-runner identity resolution. Carries the resolved
 * identity triple explicitly so callers don't re-derive ids from
 * `run.agentic_session_id` / `run.conversationId`. `targetConversationId` is
 * populated for routes whose Run posts into a different conversation than its
 * own (session-monitor) and left undefined for routes that only address their
 * own conversation (daily-session). Internal — never crosses the wire.
 */
export interface MonitorRunEnsuredResponse {
  created: boolean;
  run: LocalRun;
  agentSessionId: string;
  ownConversationId: string;
  targetConversationId: string | undefined;
}

const LOCAL_REASONING_EFFORT = {
  low: GENERATED_LOCAL_REASONING_EFFORT.Low,
  medium: GENERATED_LOCAL_REASONING_EFFORT.Medium,
  high: GENERATED_LOCAL_REASONING_EFFORT.High,
} as const;

export const LocalReasoningEffort = GENERATED_LOCAL_REASONING_EFFORT;
export type LocalReasoningEffort = (typeof LocalReasoningEffort)[keyof typeof LocalReasoningEffort];

type LocalStartupPlanQuestionAnswer = GeneratedLocalStartupPlanQuestionAnswer;

type LocalStartupPlanDiscrepancyReview = GeneratedLocalStartupPlanDiscrepancyReview;

type LocalStartupPlanReviewSummary = GeneratedLocalStartupPlanReviewSummary;

export type LocalPlanExecutionPromptPayload = GeneratedLocalPlanExecutionPromptPayload;
type LocalPlanExecutionPromptPayloadPlan = GeneratedLocalPlanExecutionPromptPayloadPlan;

type LocalRunEvent = GeneratedLocalRunEvent;

export type {
  RuntimeLocalToolUsageEntry as LocalToolUsageEntry,
  ContextData as LocalContextData,
  CliReadProviderSessionUsageCost as LocalProviderSessionUsageCost,
};

export type LocalRun = GeneratedLocalRun;

export type LocalCreateRunResponse =
  | {
      status: 'started';
      run: LocalRun;
    }
  | {
      status: 'repo-required';
      serviceIds: string[];
      launchServiceId: string;
    };

export interface LocalSubmitPromptResponse {
  result: LocalRunPromptResult;
  run: LocalRun;
}

export interface LocalGetRunResponse {
  run: LocalRun | null;
}

export type LocalWorktreeConfig = RuntimeLocalWorktreeConfig;

export interface LocalWorktreeState {
  worktreePath: string;
  branch: string;
  repoPath: string;
}

export type LocalWorktreeStateByService = Record<string, LocalWorktreeState>;

export type LocalAgentRunnerErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'REFRESH_FAILED'
  | 'RATE_LIMITED'
  | 'MISSING_CREDENTIAL'
  | 'SESSION_NOT_FOUND'
  | 'REPO_BINDING_MISSING'
  | 'PROVIDER_SESSION_ID_MISSING'
  | 'NO_ACTIVE_SESSION'
  | 'NOT_SUPPORTED'
  | 'RUN_FAILED';
