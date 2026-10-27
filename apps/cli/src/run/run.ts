import { SessionRoleGuidance } from '../agents/session-role-guidance/session-role-guidance';
import { resolveHandlerSessionRole } from '../agents/prompt-type-handler';
import { RunAttachmentNotFoundError } from '../server/run-attachment-store';
import { RunAttachmentContentReader } from '../agents/providers/run-attachment-content-reader';
import type { BrowserMcpAccess } from '../agents/browser-tools/browser-mcp-access';
import {
  formatBrowserAnnotations,
  type BrowserAnnotationDelivery,
} from '../browser/page-annotations';
import {
  formatBrowserTabNotice,
  type BrowserTabNoticeDelivery,
} from '../browser/browser-tab-notices';
import { ReportedFileChangeFailure, type ReportedFileChangeResolution } from './file-change-facts';
import { DeterministicE2EEvidence } from './runners/deterministic-e2e-evidence';
/**
 * Run — the in-memory, active representation of an `AgenticSession`.
 *
 * Lifecycle. A Run is created the first time the CLI needs to dispatch a
 * message for a conversation; it lives until `cleanup()` fires. During that
 * time it owns every piece of per-session in-memory state: the message
 * queue, the active Turn, the abort controller, the provider-session
 * binding, and the Session object itself (`run.session`, fetched once at
 * activation and never re-read from the store by anything below Run).
 *
 * Role. Run is the scheduler. External callers (message.service, the
 * conversation dispatcher, recovery code) hand Run a concrete
 * `InternalRunPromptRequest` via `handleMessage(input)`; Run decides whether
 * to enqueue or to start a Turn now. When a Turn ends, Run reacts:
 * clearing its per-Turn state, draining the queue, and starting the next
 * Turn if one is waiting. Every Turn is constructed fully-formed — all of
 * its fields are resolved *inside Run* before `new Turn(...)` runs, so
 * Turn itself is an immutable value object with no deps bag and no reverse
 * pointer.
 *
 * Collaborators. Run takes real typed services (`RunStore`,
 * `MessagePoster`, `RunEventPublisher`, `PromptTypeHandlerDeps`, the runner
 * picker, and a logger) at construction. No anonymous callback bag; every
 * dependency is a domain-named collaborator that Run uses through a
 * proper interface.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentOutputMessage } from '../agents/agent-event-stream';
import {
  resolveRunWorkspace,
  resolveServiceBindingsForIds,
  RunWorktreeCollisionError,
  type ResolvedRunWorkspace,
} from '../agents/run-scope';
import type { UserMessageAdmittedServiceScope } from '../shared/api/generated/api';
import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
} from '../agents/providers/session-runner';
import { CAPACITY_RETRY_MESSAGE } from '../agents/providers/codex/session-runner-codex';
import type {
  PermissionCallbackType,
  PermissionDecision,
  PermissionDecisionRoutingInput,
} from '../agents/permission-response-routing';
import type {
  AgentStartupPromptInputResult,
  AgentStartupPromptTemplate,
  PromptTypeHandlerContext,
  PromptTypeHandlerBaseDeps,
  PromptTypeHandlerDeps,
  PromptTypeHandler,
  RecentUserReply,
} from '../agents/prompt-type-handler';
import type { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { resolveProjectAssistantPolicy } from '../agents/project-assistant/proactive-behavior';
import { ProjectAssistantPreparationError } from '../agents/project-assistant/nearest-parent-feature';
import type { ProjectAssistantPromptPayload } from '../agents/project-assistant/project-assistant.handler';
import {
  AgentStartupPromptInputError,
  isEntityPromptTemplateFocalType,
} from '../commands/agent-startup-prompt-input';
import type {
  CachedProviderSessionStartupSegments,
  ProviderSessionDecision,
} from './provider-session-startup-input';
import { classifyProviderSessionDecision } from './provider-session-startup-input';
import {
  readPreparedImplementRequiredServiceIds,
  withPreparedImplementSessionScope,
} from '../agents/implement/implement.handler';
import {
  isPassThroughTool,
  type PassThroughSubmissionToolDeclaration,
  type SubmissionToolAction,
  type SubmissionToolDeclaration,
} from '../agents/submission-tools/types';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { SubmissionActionPoster } from '../agents/submission-tools/action-poster';
import { ActivePlatformToolCatalog } from '../agents/platform-mcp-proxy/catalog';
import { TurnPlatformMcpProxy } from '../agents/platform-mcp-proxy/turn-proxy';
import type { McpSessionContext } from '../agents/mcp-server-config';
import type { RepoMappingStore } from '../repo/index';
import { KeyPairStore } from '../credentials/keypair';
import type { RunStore } from '../run-store/run-store';
import { latestContextProviderSession } from '../run-store/provider-session-history';
import type { WorkflowDispatchVerdictReader } from '../server/services/workflow-dispatch-verdict';
import type {
  AgenticSession,
  PermissionRequestPresentation,
  ServiceScopeContinuation,
  PreviousProviderSession,
  ProviderSessionHistoryEntry,
  RunMemo,
} from '../session/types';
import type {
  AgentSessionReviewFileScopeRequest,
  ImplementationReadinessDisposition,
} from '../shared/api/generated/api';
import { MessageType, MessageStatus, SystemMessageDataTypeEnum } from '../shared/api/index';
import type { AgentSystemMessageData, SystemMessageData } from '../shared/api/index';
import type {
  InternalRunPromptRequest,
  LocalAnyPromptPayload,
  LocalRunScope,
  ProjectAssistantConfig,
  ResolvedServiceBinding,
  SendMessageOptions,
} from '../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { ImplementRuntimeOwner } from '../agents/implement/implement-runtime-owner';
import type { RunEntityReference } from '../shared/agent-bridge-contract/generated/api';
import { resolvePromptText } from '../shared/agent-bridge-contract/contract';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import type { ServerLogger } from '../server/logger';
import type { ProposalStatusReader } from '../server/proposal-status-reader';
import { RunEventPublisher } from '../server/run-event-publisher';
import type { ReportSyncService } from '../server/report-sync-service';
import type { TaskReportChainReader } from '../server/services/task-report-chain-reader';
import type { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import type { TaskMonitorLaunchFailureRuntime } from '../server/task-monitor-launch-failure-runtime';
import type { OperationTimelineRegistry } from '../server/input-admission/operation-timeline';
import type { RunFollowUpAdmission } from '../server/input-admission/input-admission-payload';
import { validateResolvedPromptReferences } from '../server/services/run.service';
import { EventDispatcher } from './event-dispatcher';
import type { MessagePoster } from './message-poster';
import { normalizeEvent } from './normalize';
import { CODING_AGENT_REPORT_TYPES } from '../agents/prompts/report-chain';
import { evaluateDeclaredReports } from './report-enforcement';
import { emitOpenImplementReportIfNeeded } from './open-implement-report';
import { resolvePrompt } from './resolve-prompt';
import { resolveProjectModeFollowup } from '../agents/project-mode/resolve-project-mode-followup';
import type { RunnerContext } from './runners/types';
import { RunWorkspaceWriteBoundary } from '../agents/workspace-write-boundary';
import {
  hasCapturedProjectModeConfig,
  ProjectModeBundleMaterializer,
  validateProjectModeConfig,
} from '../agents/project-mode';
import type { RunnerPicker } from './runners/pick-runner';
import { NewSessionRunner } from './runners/new-session-runner';
import { ResumeRunner } from './runners/resume-runner';
import type { RunRegistry } from './run-registry';
import {
  allowsImplementation,
  ImplementationReadinessOwner,
  parseImplementationReadinessDisposition,
} from '../agents/implementation-readiness/readiness-disposition';
import { createReadinessSourceSnapshotFromStartupInput } from '../agents/implementation-readiness/source-snapshot';
import { Turn, type Runner } from '../turn/turn';
import { bindPromptOnce } from './bind-prompt-once';
import { resolveTurnEffective } from '../turn/turn-effective';
import { AgentSessionCurrentStateOwner } from './agent-session-current-state';
import type { AgentSessionCurrentStateObservation } from '../shared/api/generated/api';
import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import { ConversationPhaseOwner } from './conversation-phase';
import { RunCompaction } from './run-compaction';
import { RunProposalTracker, type ProposalDecisionNotices } from './run-proposal-tracker';
import { setAgentSessionOutputAttentionReady } from './agent-session-output-attention';
import {
  CodexShellChangeObserver,
  type CodexShellCommandOutcome,
  type CodexShellObservationIdentity,
} from './codex-shell-change-observer';
import { AgentSessionServiceScopeCoordinator } from '../agents/service-scope-request/service-scope-coordinator';
import {
  RunServiceScope,
  type HeldAdmission,
  type InputSettlementEvidence,
} from './run-service-scope';
import { ReviewFileScopeCoordinator } from '../agents/review-file-scope-request/review-file-scope-coordinator';
import type { ReviewFileScopeDecisionInput } from '../agents/review-file-scope-request/review-file-scope-types';
import {
  canonicalFileChangeKey,
  captureFileChangeEvidence,
  projectFileChanges,
  resolveProjectedFilePath,
  resolveReportedFileChanges,
  resolveRunFilePath,
  type CanonicalFileChangeCandidate,
  type CanonicalFileChangeFact,
  type FileChangeProjection,
  type StagedFileChange,
} from './file-change-facts';
import type { ReportedChangedFile } from '../agents/completion-reconciliation/schemas';
import type {
  ProviderPhase,
  HandlerDeps,
  LocalAgentOutputEvent,
  PendingDiff,
  PendingTurnCompletion,
  ReportChainEntry,
  ToolUseNormalizedBlock,
} from './types';

type PlanExecutionPromptPayload = Extract<
  LocalAnyPromptPayload,
  { promptType: typeof LocalPromptType.PlanExecution }
>;

type CanonicalFileChangeAttributionSource = 'provider_event' | 'agent_report';

const isPlanExecutionPromptPayload = (
  payload: LocalAnyPromptPayload | undefined,
): payload is PlanExecutionPromptPayload =>
  payload !== undefined &&
  'promptType' in payload &&
  payload.promptType === LocalPromptType.PlanExecution;

// Set only by `routeImplementationReadinessClarification`. Carries the pending
// REVIEW_REQUIRED finding the routed free-form assessment must resolve.
const IMPLEMENTATION_READINESS_CLARIFICATION_MARKER = Symbol.for(
  'heyhey.cli.implementationReadinessClarification',
);
type ImplementationReadinessClarification = NonNullable<
  PromptTypeHandlerContext['implementationReadinessClarification']
>;
type RequestWithReadinessClarification = InternalRunPromptRequest & {
  [IMPLEMENTATION_READINESS_CLARIFICATION_MARKER]: ImplementationReadinessClarification;
};
const readImplementationReadinessClarification = (
  input: InternalRunPromptRequest,
): ImplementationReadinessClarification | undefined =>
  (input as Partial<RequestWithReadinessClarification>)[
    IMPLEMENTATION_READINESS_CLARIFICATION_MARKER
  ];

const readImplementationReadinessFromPayload = (
  payload: LocalAnyPromptPayload | undefined,
): ImplementationReadinessDisposition | null => {
  if (!payload || !('implementationReadiness' in payload)) return null;
  return payload.implementationReadiness ?? null;
};

/**
 * Project the Run's workspace state into the authenticated MCP context.
 * `launchServiceId` remains the singular working-directory and mutation
 * anchor, while `serviceIds` carries the complete authorized read scope.
 */
export const buildRunMcpSessionContext = (
  session: Pick<
    AgenticSession,
    'agentic_session_id' | 'conversationId' | 'contextMetadata' | 'launchServiceId' | 'services'
  >,
): McpSessionContext => ({
  projectId: session.contextMetadata.projectId,
  conversationId: session.conversationId,
  serviceId: session.launchServiceId,
  serviceIds: Array.from(new Set(session.services.map(({ id }) => id))).sort(),
  agentSessionId: session.agentic_session_id,
});

/**
 * Per-Turn coalesced-narration state. `body` is the running concatenation of
 * the Turn's narration segments; `messageId` is a deferred promise the first
 * segment's handler resolves once the row is created, so later segments await
 * the same id before updating in place. `resolve`/`reject` settle that promise.
 */
class NarrationSlot {
  public body: string;
  public readonly messageId: Promise<string>;
  private readonly resolveMessageId: (messageId: string) => void;
  private readonly rejectMessageId: (error: unknown) => void;

  public constructor(initialSegment: string) {
    this.body = initialSegment;
    let resolveMessageId!: (messageId: string) => void;
    let rejectMessageId!: (error: unknown) => void;
    this.messageId = new Promise<string>((resolve, reject) => {
      resolveMessageId = resolve;
      rejectMessageId = reject;
    });
    this.resolveMessageId = resolveMessageId;
    this.rejectMessageId = rejectMessageId;
    // A failed create with no later segment still has an attached rejection
    // observer; callers awaiting the original promise continue to see it.
    this.messageId.catch(() => undefined);
  }

  public append(segment: string): string {
    this.body += NARRATION_SEPARATOR + segment;
    return this.body;
  }

  public resolve(messageId: string): void {
    this.resolveMessageId(messageId);
  }

  public reject(error: unknown): void {
    this.rejectMessageId(error);
  }
}

/**
 * Separator between coalesced narration segments. Each segment is a complete
 * assistant text block (one emission between tool calls, formerly its own
 * message row), so they stack as distinct paragraphs rather than concatenating
 * into one run-on line.
 */
const NARRATION_SEPARATOR = '\n\n──────────\n\n';

export type RunEntityContextLoadStatus = 'pending' | 'loaded' | 'failed' | 'not_loaded';

const requireProposalStatusReader = (
  reader: ProposalStatusReader | undefined,
): ProposalStatusReader => {
  if (!reader) throw new Error('This Run has no proposal status reader');
  return reader;
};

export interface RunCollaborators {
  browserMcpAccess?: BrowserMcpAccess;
  /** Pending page annotations the user made in this Run's shared-browser tabs. */
  browserAnnotations?: BrowserAnnotationDelivery;
  /** The pending notice of a tab the user opened for this Run from the session page. */
  browserTabNotices?: BrowserTabNoticeDelivery;
  /** Reads the decision on Proposals this Run created, so the agent can be told about them. */
  proposalStatusReader?: ProposalStatusReader;
  runStore: RunStore;
  repoStore: RepoMappingStore;
  poster: MessagePoster;
  broadcaster: RunEventPublisher;
  /** Persisted machine identity used by controller-authorized Agent Session mutations. */
  keyPairStore?: KeyPairStore;
  /** Shared prompt-handler deps — used by `resolvePrompt` and by handler onComplete hooks. */
  handlerDeps: PromptTypeHandlerBaseDeps;
  promptTypeRegistry: PromptTypeRegistry;
  submissionToolRegistry: SubmissionToolRegistry;
  /** Select the per-Turn runner after prompt resolution. */
  runnerPicker: RunnerPicker;
  logger: ServerLogger;
  operationTimeline?: OperationTimelineRegistry;
  /** Durable per-session input queue for follow-ups the Run itself owes the agent. */
  runFollowUpAdmission: RunFollowUpAdmission;
  /**
   * Execute a response-dispatch side effect (e.g. sync a report after an
   * assistant completes). Passed through to the event dispatcher so
   * handler `onComplete` hooks can fire it.
   */
  reportSyncService?: ReportSyncService;
  /** Async deps for prompt-type `onComplete` hooks (report creation, etc.). */
  onCompleteDeps?: HandlerDeps['onCompleteDeps'];
  /**
   * Whether tool-usage entries should be persisted to the run store when
   * `tool_use` events arrive. Defaults to true. Server/index flips this
   * to false when `HEYHEY_TRACK_TOOLS=0` is set.
   */
  trackToolUsage?: boolean;
  /**
   * Optional task-scoped report reader. When provided and the Run is
   * task-scoped (`taskId !== null`), the constructor kicks off a fetch and
   * seeds the report chain with the returned entries before the first
   * `handleMessage` reads `readReportChain()`.
   */
  taskReportChainReader?: TaskReportChainReader;
  /** Platform workflow reader used by `readCurrentWorkflowNodeId`. */
  workflowDispatchVerdictReader?: WorkflowDispatchVerdictReader;
  /**
   * Submission tools registered on every Run regardless of the active handler.
   * The universal `create_report` wrapper lives here so all agents reach the
   * platform report endpoint through `onReportEmitted` instead of the raw
   * platform MCP tool. Prepended before handler tools at registration time.
   */
  baseSubmissionTools?: SubmissionToolDeclaration[];
  /**
   * Registry-owned idle reaper. Run owns the inactivity timer and validates
   * genuine idleness; the registry owns the atomic membership transition so
   * an arriving message cannot select a Run whose provider is being released.
   */
  idleRunReaper?: RunRegistry;
  /**
   * Registry-owned readiness signal. Durable input pickup has no timer, so the Run raises
   * this wherever `canAcceptDurableInput` can become true.
   */
  durableInputReady?: () => void;
  /**
   * Registry-owned signal raised when a fact read by the local session source
   * changes: effective state, active work, or the loaded focal entity context.
   */
  readStateChanged?: () => void;
  /** Process-local Task Monitor guidance correlation and completion owner. */
  taskMonitorManagedTurnRuntime?: TaskMonitorManagedTurnRuntime;
  /** Process-local Task Monitor pre-Turn launch-failure publisher. */
  taskMonitorLaunchFailureRuntime?: TaskMonitorLaunchFailureRuntime;
  /** Runtime owner shared with pre-persistence project-mode admission. */
  projectModeBundleMaterializer?: ProjectModeBundleMaterializer;
}

export interface RunArgs {
  runId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  provider: 'claude' | 'codex' | 'opencode';
  /**
   * The AgenticSession this Run is bound to. Resolved once at Run activation
   * and held here for the Run's lifetime. Nothing below Run reads the
   * session from `runStore`.
   */
  session: AgenticSession;
  /**
   * Whether the Run already has a usable persisted provider session. The
   * runner picker reads this to choose `ResumeRunner` vs `NewSessionRunner`.
   * Derived at construction time from the AgenticSession's
   * `provider_session_id`; mutable via `setHasProviderSession` so the first
   * `NewSessionRunner` turn can flip it to true without a rebuild.
   */
  hasProviderSession?: boolean;
  /**
   * When true, skip the one-shot Project Assistant subagent that normally
   * runs before a participating handler's first turn. Reconstruction passes
   * true when the durable `projectAssistantDone` marker is set. Older Runs
   * with no marker remain eligible when their next participating handler
   * arrives, which is the intentional rollout behavior. Defaults to false.
   * Tests and non-task-scoped Runs set this to true to avoid the remote
   * pre-fetch and subagent dispatch overhead.
   */
  skipProjectAssistant?: boolean;
  /** Prompt types of handlers that already started a Turn on this Run. Defaults to none. */
  startedPromptTypes?: readonly string[];
  /**
   * Between-turns auto-compact policy. When enabled, the run reads the
   * bound runner's context usage at each turn boundary and calls compact()
   * when accumulated tokens exceed the threshold. Absent or disabled means
   * no automatic compaction.
   */
  autoCompact?: { enabled: boolean; threshold?: number };
  /** Preloaded durable membership used by atomic read-scoped restoration. */
  fileChangeSeed?: {
    facts: readonly CanonicalFileChangeFact[];
    touchedFiles: readonly string[];
  };
}

/**
 * Internal marker for a coalesced drain batch. When Run coalesces queued
 * messages into a single Turn, it synthesizes a request carrying the joined
 * provider prompt and this marker. `logTurnOpenSource` reads the marker only
 * to label its source-trace event as `coalesced_batch`. Never accepted from
 * the wire.
 */
/**
 * Upper bound on how long turn-end waits for in-flight event dispatches to
 * settle before flushing the pending completion. The drain exists to let a
 * trailing narrative write land first; a single stalled handler must not be
 * able to wedge the turn indefinitely, so the wait is capped here.
 */
const IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS = 10_000;

const COALESCED_BATCH_MARKER = Symbol.for('heyhey.cli.coalescedBatch');
interface CoalescedBatchRequest extends InternalRunPromptRequest {
  [COALESCED_BATCH_MARKER]: true;
}
const isCoalescedBatchRequest = (input: InternalRunPromptRequest): input is CoalescedBatchRequest =>
  (input as CoalescedBatchRequest)[COALESCED_BATCH_MARKER] !== undefined;

/**
 * Provider conversation id keys carried on a raw provider event's payload.
 * Mirrors the local WS hub's `deriveProviderIdentity` so the upstream write
 * and the local emit read the same field.
 */
const PROVIDER_CONVERSATION_PAYLOAD_KEYS = [
  'provider_conversation_id',
  'providerConversationId',
] as const;

const readProviderConversationId = (event: LocalAgentOutputEvent): string | null => {
  const normalizedConversationId = event.providerFacts?.providerConversationId;
  if (normalizedConversationId) return normalizedConversationId;
  for (const key of PROVIDER_CONVERSATION_PAYLOAD_KEYS) {
    const value = event.payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const readProviderRouting = (
  event: LocalAgentOutputEvent,
): { threadId: string | null; turnId: string | null } => {
  const normalizedRouting = event.providerFacts?.routing;
  if (normalizedRouting) {
    return {
      threadId: normalizedRouting.providerThreadId,
      turnId: normalizedRouting.providerTurnId,
    };
  }
  const routingValue = event.payload['routing'];
  if (typeof routingValue !== 'object' || routingValue === null || Array.isArray(routingValue)) {
    return { threadId: null, turnId: null };
  }
  const routing = routingValue as Record<string, unknown>;
  const read = (snakeKey: string, camelKey: string): string | null => {
    const value = routing[snakeKey] ?? routing[camelKey];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  };
  return { threadId: read('thread_id', 'threadId'), turnId: read('turn_id', 'turnId') };
};

const readCodexCommandLifecycle = (
  event: LocalAgentOutputEvent,
):
  | { phase: 'started'; commandItemId: string }
  | { phase: 'completed'; commandItemId: string; outcome: CodexShellCommandOutcome }
  | null => {
  const normalizedLifecycle = event.providerFacts?.commandLifecycle;
  if (normalizedLifecycle) {
    return normalizedLifecycle.status === 'started'
      ? { phase: 'started', commandItemId: normalizedLifecycle.commandId }
      : {
          phase: 'completed',
          commandItemId: normalizedLifecycle.commandId,
          outcome: {
            status: normalizedLifecycle.status,
            exitCode: normalizedLifecycle.exitCode,
            failed: normalizedLifecycle.status === 'failed',
          },
        };
  }
  const nativeEventType = event.payload['eventType'];
  if (nativeEventType !== 'item/started' && nativeEventType !== 'item/completed') return null;
  const rawEvent = event.payload['raw_event'];
  if (typeof rawEvent !== 'object' || rawEvent === null || Array.isArray(rawEvent)) return null;
  const item = (rawEvent as Record<string, unknown>)['item'];
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const command = item as Record<string, unknown>;
  if (command['type'] !== 'commandExecution') return null;
  const itemId = command['id'];
  if (typeof itemId !== 'string' || itemId.trim().length === 0) return null;
  const commandItemId = itemId.trim();
  if (nativeEventType === 'item/started') return { phase: 'started', commandItemId };
  const status = typeof command['status'] === 'string' ? command['status'] : null;
  const exitCode = typeof command['exitCode'] === 'number' ? command['exitCode'] : null;
  return {
    phase: 'completed',
    commandItemId,
    outcome: {
      status,
      exitCode,
      failed: status === 'failed' || (exitCode !== null && exitCode !== 0),
    },
  };
};

/**
 * Reads Project Assistant intent only from session-config variants that own
 * that setting. The Entity Conversation variant is part of the same durable
 * config boundary even when an older generated client has not emitted its
 * discriminator yet, so the runtime check remains deliberately structural.
 */
const resolveProjectAssistantConfig = (
  config: AgenticSession['config'],
): ProjectAssistantConfig | undefined => {
  if (!config) return undefined;

  const configType: string = config.type;
  if (configType !== 'CODING_SESSION' && configType !== 'ENTITY_CONVERSATION') {
    return undefined;
  }

  return 'projectAssistant' in config ? config.projectAssistant : undefined;
};

type EventProducer = { kind: 'run-provider-session' } | { kind: 'active-turn'; turnId: string };

interface ResolvedEventProducer {
  accepted: boolean;
  expectedProviderSessionId: string | null;
  isEphemeral: boolean;
  rejectionReason: 'stale-turn' | 'provider-session-mismatch' | null;
  /** Owning handler id when this event first identified the active subagent's session. */
  observedSubagentAgentId?: string;
}

/**
 * Internal carrier for the trigger's recentUserReplies. Computed by the
 * conversation dispatcher (`pending.ts`) and threaded into the resolver for
 * handlers that classify user replies. Stamped on the request inside
 * `handleMessage` so the data survives queueing alongside the request, then
 * read back in `resolveTurnInputs`. Never accepted from the wire.
 */
const RECENT_USER_REPLIES_MARKER = Symbol.for('heyhey.cli.recentUserReplies');
interface RequestWithRecentReplies extends InternalRunPromptRequest {
  [RECENT_USER_REPLIES_MARKER]: ReadonlyArray<RecentUserReply>;
}
const readRecentUserReplies = (input: InternalRunPromptRequest): ReadonlyArray<RecentUserReply> =>
  (input as Partial<RequestWithRecentReplies>)[RECENT_USER_REPLIES_MARKER] ?? [];

/**
 * Internal carrier for the canonical USER Message that opened a follow-up
 * Turn. The identity is used only to preserve one Message per queued Turn;
 * the Message body remains on the platform conversation and never becomes
 * Run policy or provider metadata.
 */
const USER_MESSAGE_BOUNDARY_MARKER = Symbol.for('heyhey.cli.userMessageBoundary');
interface RequestWithUserMessageBoundary extends InternalRunPromptRequest {
  [USER_MESSAGE_BOUNDARY_MARKER]: {
    sourceUserMessageId: string;
    onTurnStarted?: (turnId: string) => void;
    onTurnSettled?: (outcome: {
      turnId: string;
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
    }) => void;
  };
}
const readUserMessageBoundary = (
  input: InternalRunPromptRequest,
): RequestWithUserMessageBoundary[typeof USER_MESSAGE_BOUNDARY_MARKER] | undefined =>
  (input as Partial<RequestWithUserMessageBoundary>)[USER_MESSAGE_BOUNDARY_MARKER];

const ADMITTED_SERVICE_SCOPE_MARKER = Symbol.for('heyhey.cli.admittedServiceScope');
interface RequestWithAdmittedServiceScope extends InternalRunPromptRequest {
  [ADMITTED_SERVICE_SCOPE_MARKER]: UserMessageAdmittedServiceScope;
}
const readAdmittedServiceScope = (
  input: InternalRunPromptRequest,
): UserMessageAdmittedServiceScope | undefined =>
  (input as Partial<RequestWithAdmittedServiceScope>)[ADMITTED_SERVICE_SCOPE_MARKER];

const INPUT_ADMISSION_MARKER = Symbol.for('heyhey.cli.inputAdmission');
type RequestWithInputAdmission = InternalRunPromptRequest & {
  [INPUT_ADMISSION_MARKER]: NonNullable<SendMessageOptions['admittedInput']>;
};
const readInputAdmission = (input: InternalRunPromptRequest) =>
  (input as Partial<RequestWithInputAdmission>)[INPUT_ADMISSION_MARKER];

/**
 * Internal carrier linking a bootstrap Project Assistant request to the
 * admitted input it prepares. The bootstrap Turn projects that input's actual
 * start but never takes its Turn identity or settles it. Never accepted from
 * the wire.
 */
const BOOTSTRAP_INPUT_ADMISSION_MARKER = Symbol.for('heyhey.cli.bootstrapInputAdmission');
type RequestWithBootstrapInputAdmission = InternalRunPromptRequest & {
  [BOOTSTRAP_INPUT_ADMISSION_MARKER]: NonNullable<SendMessageOptions['admittedInput']>;
};
const readBootstrapInputAdmission = (input: InternalRunPromptRequest) =>
  (input as Partial<RequestWithBootstrapInputAdmission>)[BOOTSTRAP_INPUT_ADMISSION_MARKER];

const SESSION_MESSAGE_BOUNDARY_MARKER = Symbol.for('heyhey.cli.sessionMessageBoundary');
interface RequestWithSessionMessageBoundary extends InternalRunPromptRequest {
  [SESSION_MESSAGE_BOUNDARY_MARKER]: NonNullable<SendMessageOptions['admittedSessionMessage']>;
}
const readSessionMessageBoundary = (input: InternalRunPromptRequest) =>
  (input as Partial<RequestWithSessionMessageBoundary>)[SESSION_MESSAGE_BOUNDARY_MARKER];

/**
 * Internal carrier for the trigger message's `parentMessageId`. Same shape
 * and lifecycle as the recentUserReplies marker — stamped on the queued
 * request so it survives queueing, read back inside `resolveTurnInputs`.
 * Never accepted from the wire.
 */
const TRIGGER_PARENT_MESSAGE_ID_MARKER = Symbol.for('heyhey.cli.triggerParentMessageId');
interface RequestWithTriggerParent extends InternalRunPromptRequest {
  [TRIGGER_PARENT_MESSAGE_ID_MARKER]: string | null;
}

const readTriggerParentMessageId = (input: InternalRunPromptRequest): string | null => {
  const stamped = (input as Partial<RequestWithTriggerParent>)[TRIGGER_PARENT_MESSAGE_ID_MARKER];
  return stamped === undefined ? null : stamped;
};

export class Run {
  private readonly attachmentContentReader = new RunAttachmentContentReader();
  // --- Run-owned state ---------------------------------------------------
  readonly runId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  /**
   * The provider serving this Run's provider sessions. An Implement runtime
   * selection may switch it between Turns; the switch rotates the provider
   * session inside this Run and never creates another Run.
   */
  provider: 'claude' | 'codex' | 'opencode';

  session: AgenticSession;
  hasProviderSession: boolean;
  pendingDiffs: Map<string, PendingDiff> = new Map();
  touchedFiles: Set<string> = new Set();
  private readonly _fileChangeFacts: CanonicalFileChangeFact[] = [];
  private readonly _stagedFileChanges = new Map<string, StagedFileChange>();
  private _fileChangeMutation: Promise<void> = Promise.resolve();
  private _activeProviderThreadId: string | null = null;
  private _activeProviderTurnId: string | null = null;
  private readonly _completedProviderTurnIds = new Set<string>();
  private permissionRequestMessages: Map<
    string,
    { messageId: string; data: SystemMessageData | null }
  > = new Map();
  private readonly settledPermissionRequestIds = new Set<string>();
  // Open `AskUserQuestion` messages by question request id. In-memory only: a
  // waiting question cannot outlive the process that holds its tool call.
  private readonly questionMessages = new Map<
    string,
    { messageId: string; data: SystemMessageData }
  >();
  private taskMonitorAutomationAuthorized = false;
  readonly serviceScope: RunServiceScope;
  readonly serviceScopeCoordinator: AgentSessionServiceScopeCoordinator;
  private readonly reviewFileScopeCoordinator: ReviewFileScopeCoordinator;
  private activeTurnInput: InternalRunPromptRequest | null = null;
  triggerContext: { externalAgentNodeId: string; triggerMessageId: string } | null = null;
  lastSubmissionAction: SubmissionToolAction | null = null;
  /**
   * Persistence guard: skip the runStore round-trip when the in-memory
   * field is being seeded from a value that just came off disk. Rehydration
   * sets these via the same setters as live trigger arrivals to keep the
   * "log on change" behavior, but writing the rehydrated value back would
   * be a wasteful no-op write.
   */
  private _suppressTriggerContextPersist = false;

  /**
   * One-shot guard for the upstream provider-identity write. Set the first
   * time a runner emits an event carrying a real (non-`pending_`) provider
   * session id, so the platform learns the ids exactly once per Run. Mirrors
   * the local WS hub's per-runId `identityByRunId` dedupe.
   */
  private providerIdentityEmitted = false;
  /**
   * A durable rotation clear may succeed before the provider client releases
   * its live session. Keep that incomplete half of the transition explicit so
   * a retry cannot mint through a still-connected outgoing transcript.
   */
  private providerSessionRotationClientDiscardPending = false;

  /** The session runner bound by `setRunner()` after construction. */
  runner: AgentSessionRunner | null = null;

  activeTurn: Turn | null = null;

  /**
   * Promise for the in-flight Turn's `run()` chain — set inside `startTurn`
   * once `turn.begin()` has resolved and cleared by its `.finally` when the
   * Turn's full run → end → onTurnEnded chain completes. `awaitIdle()`
   * follows this promise so external callers (e.g. createRun's first-turn
   * dispatch) can block until the freshly-started Turn finishes streaming
   * and the Run is idle. Null whenever the Run holds no active Turn.
   */
  private _currentTurnPromise: Promise<void> | null = null;

  /**
   * The EXTERNAL_AGENT completion this turn has decided to post, held until
   * turn-end so it lands after the turn's trailing narrative. Recorded by
   * either completion path (submission tool or JSON-body) via
   * `recordPendingCompletion`, flushed once by `flushPendingCompletion` in
   * `onTurnEnded`. Null between completions and on a turn that posts none.
   */
  private pendingCompletionValue: PendingTurnCompletion | null = null;
  private pendingCompletionFlushValue: Promise<void> | null = null;
  private readonly recordedCompletionTriggers = new Set<string>();

  /**
   * In-flight asynchronous work keyed by an identity allocated before each
   * dispatch begins. Every `dispatcher.dispatch` started by `onAgentOutput`
   * is registered here and removed on settle, so `drainInFlightDispatch` can
   * wait at turn-end for a detached handler chain (notably
   * `handleAssistantComplete`'s narrative `createOutOfBand`) to finish before
   * the pending completion is flushed. A handler may exclude its own identity
   * from a nested drain while still waiting for all earlier work. The drain
   * timer is diagnostic-only: dispatch owns authoritative conversation writes,
   * so elapsed wall-clock time cannot release turn settlement past active work.
   */
  private readonly _inFlightDispatch = new Map<symbol, Promise<void>>();

  // --- private state -------------------------------------------------------
  private processingValue = false;
  private _abortController: AbortController | null = null;
  private _phaseHeartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private _inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private _inactivityReapPromise: Promise<void> | null = null;
  private _inactivityReapInterrupted = false;
  private _inactivityReapingDisabled = false;
  private readonly _messageQueue: InternalRunPromptRequest[] = [];
  private readonly foregroundSubagentWaits = new Set<string>();
  /** Whether the one-shot Project Assistant subagent has already run (or was skipped). */
  private _projectAssistantDone: boolean;
  private readonly _skipProjectAssistant: boolean;
  /** Prompt types of handlers that have started a Turn; persisted per Run. */
  private readonly _startedPromptTypes: Set<string>;
  /**
   * Append-only chain of reports produced during this Run. Mutated only via
   * `appendReportChainEntry`; entries are frozen at append time and the
   * array is never cleared (Run-lifetime semantics — `cleanup()` does not
   * touch it). Read via `readReportChain()` which returns a defensive copy.
   */
  private readonly _reportChain: ReportChainEntry[] = [];
  /**
   * Awaited once before the first prompt-render so seed entries are visible
   * to `resolvePrompt`. Resolves to undefined either way — a seed failure is
   * logged and treated as an empty seed; subsequent turns hit the resolved
   * promise and pay no extra latency.
   */
  private readonly _seedPromise: Promise<void> | null;
  private readonly _fileChangeFactsSeedPromise: Promise<void>;
  /**
   * Files touched per Turn, keyed by `Turn.turnId`. Populated by
   * `recordTouchedFile` alongside the cumulative `touchedFiles` set. Read
   * once at turn-end to OR the turn's "made changes" signal into the
   * current handler span, then cleared.
   */
  private readonly _filesTouchedByTurn: Map<string, Set<string>> = new Map();
  /**
   * Set of `Turn.turnId`s whose runner posted at least one submission-tool
   * action. Read once at turn-end to OR the turn's "made changes" signal
   * into the current handler span, then cleared.
   */
  private readonly _submittedTurnIds: Set<string> = new Set();
  /** Coding Plan items (plan version, discrepancy, question) each Turn persisted. */
  private readonly _codingPlanElementsByTurn: Map<string, Set<string>> = new Map();
  /**
   * Report-chain length at Turn start, keyed by `Turn.turnId`. Open's
   * changed-workspace report helper reads the slice from this index to avoid
   * double-emitting when the turn already wrote its own IMPLEMENT report.
   */
  private readonly _reportChainStartByTurn: Map<string, number> = new Map();
  /**
   * The last assistant text block the provider stream emitted during the
   * active turn — what the user actually saw. Updated on every normalized
   * `assistant_delta`/`assistant_complete` event in `onAgentOutput` (last
   * writer wins) and reset to null at turn start so a turn with no assistant
   * text never inherits the prior turn's message. Read by the assistant_complete
   * handler via `lastProviderStreamMessage` to source `previousProviderSession`.
   */
  private _lastProviderStreamMessage: string | null = null;
  /**
   * Coalesced narration slot per Turn, keyed by `Turn.turnId`. A Turn's plain
   * narration (the generic text it emits between tool calls) accumulates into
   * one interstitial message row: the first segment authors the row and the
   * rest update it in place. The slot holds the running `body` plus a deferred
   * `messageId` promise so concurrent `assistant_delta` handlers — which the
   * dispatcher fires without awaiting — coordinate on a single row: the first
   * caller resolves the promise with the created id, later callers await it
   * before updating. Cleared in `onTurnEnded` so the next Turn opens a fresh
   * row (the slot-clear is the seal).
   */
  private readonly _narrationByTurn: Map<string, NarrationSlot> = new Map();
  /**
   * Active handler-span for report-contract evaluation. A "span" is the
   * contiguous sequence of turns under the same prompt-type handler. The
   * span opens on the first turn of a handler, accumulates "made changes"
   * across its turns, and finalizes on handler swap or run cleanup — at
   * which point `evaluateDeclaredReports` runs against the span's chain
   * slice and warns on a miss. Per-turn enforcement was removed because
   * conversational handlers (e.g. `feature_sync_analyze`) write their
   * reports on the terminal turn after multiple clarification turns, and
   * per-turn checks failed those legitimate intermediate turns.
   */
  private _currentHandlerSpan: {
    promptType: string;
    chainStartIndex: number;
    madeChanges: boolean;
  } | null = null;

  // --- collaborators -------------------------------------------------------
  private readonly browserMcpAccess: BrowserMcpAccess | undefined;
  private readonly browserAnnotations: BrowserAnnotationDelivery | undefined;
  private readonly browserTabNotices: BrowserTabNoticeDelivery | undefined;
  private readonly runStore: RunStore;
  private readonly implementationReadinessOwner: ImplementationReadinessOwner;
  private readonly implementRuntimeOwner: ImplementRuntimeOwner;
  private readonly repoStore: RepoMappingStore;
  private readonly poster: MessagePoster;
  private readonly submissionActionPoster: SubmissionActionPoster;
  private readonly broadcaster: RunEventPublisher;
  readonly sessionRoleGuidance: SessionRoleGuidance;
  private readonly handlerDeps: PromptTypeHandlerBaseDeps;
  /** Latest authoritative entity startup projection for the current Turn. */
  private startupPromptInputResult: AgentStartupPromptInputResult | null = null;
  /** Effective template configuration reused while entity Context is refreshed. */
  private startupPromptTemplate: AgentStartupPromptTemplate | null = null;
  /** Stable handler instructions retained for provider-session remints. */
  private providerSessionStartupSegments: CachedProviderSessionStartupSegments | null = null;
  private readonly promptTypeRegistry: PromptTypeRegistry;
  private readonly submissionToolRegistry: SubmissionToolRegistry;
  private readonly runnerPicker: RunnerPicker;
  private readonly logger: ServerLogger;
  private readonly operationTimeline: OperationTimelineRegistry | undefined;
  private readonly runFollowUpAdmission: RunFollowUpAdmission;
  private readonly workflowDispatchVerdictReader: WorkflowDispatchVerdictReader | null;
  private readonly baseSubmissionTools: SubmissionToolDeclaration[];
  private readonly idleRunReaper: RunRegistry | null;
  private readonly durableInputReady: (() => void) | null;
  private readonly readStateChanged: () => void;
  /** Set when the last focal entity Context load failed; cleared by a successful load. */
  private entityContextLoadFailed = false;
  /** Set once a Turn in this process finished resolving its inputs. */
  private entityContextResolved = false;
  /** When this process first started a Turn for the Run; null for a Run only loaded to answer reads. */
  private _activeSince: string | null = null;
  private readonly trackToolUsage: boolean;
  private readonly taskMonitorManagedTurnRuntime: TaskMonitorManagedTurnRuntime | null;
  private readonly taskMonitorLaunchFailureRuntime: TaskMonitorLaunchFailureRuntime | null;
  private readonly agentSessionCurrentState: AgentSessionCurrentStateOwner;
  private readonly conversationPhase: ConversationPhaseOwner;
  readonly compaction: RunCompaction;
  readonly proposalTracker: RunProposalTracker;
  private codexShellChangeObserver: CodexShellChangeObserver | null;
  private readonly projectModeBundleMaterializer: ProjectModeBundleMaterializer;
  private readonly ownsProjectModeBundleMaterializer: boolean;
  private workspaceWriteBoundary: RunWorkspaceWriteBoundary | null = null;
  private repositorySnapshotDirectory: Promise<string> | null = null;

  private readonly dispatcher: EventDispatcher;

  constructor(args: RunArgs, collaborators: RunCollaborators) {
    this.runId = args.runId;
    this.organizationId = args.organizationId;
    this.projectId = args.projectId;
    this.conversationId = args.conversationId;
    this.provider = args.provider;
    this.session = args.session;
    this.hasProviderSession = args.hasProviderSession ?? false;
    this._skipProjectAssistant = args.skipProjectAssistant ?? false;
    this._projectAssistantDone = this._skipProjectAssistant;
    this._startedPromptTypes = new Set(args.startedPromptTypes ?? []);

    this.browserMcpAccess = collaborators.browserMcpAccess;
    this.browserAnnotations = collaborators.browserAnnotations;
    this.browserTabNotices = collaborators.browserTabNotices;
    this.runStore = collaborators.runStore;
    this.implementRuntimeOwner = new ImplementRuntimeOwner(this.runStore);
    this.implementationReadinessOwner = new ImplementationReadinessOwner(
      this.runStore,
      collaborators.logger,
    );
    this.repoStore = collaborators.repoStore;
    this.poster = collaborators.poster;
    this.submissionActionPoster = new SubmissionActionPoster(this.poster);
    this.broadcaster = collaborators.broadcaster;
    this.handlerDeps = collaborators.handlerDeps;
    this.sessionRoleGuidance = new SessionRoleGuidance(
      { ...this.handlerDeps, logger: collaborators.logger },
      this.runStore,
    );
    this.reviewFileScopeCoordinator = new ReviewFileScopeCoordinator({
      admission: collaborators.runFollowUpAdmission,
      runStore: this.runStore,
      poster: this.poster,
      logger: collaborators.logger,
    });
    this.promptTypeRegistry = collaborators.promptTypeRegistry;
    this.submissionToolRegistry = collaborators.submissionToolRegistry;
    this.runnerPicker = collaborators.runnerPicker;
    this.logger = collaborators.logger;
    this.operationTimeline = collaborators.operationTimeline;
    this.runFollowUpAdmission = collaborators.runFollowUpAdmission;
    this.codexShellChangeObserver =
      this.provider === 'codex' ? new CodexShellChangeObserver(this.logger) : null;
    this.readStateChanged = collaborators.readStateChanged ?? (() => {});
    this.agentSessionCurrentState = new AgentSessionCurrentStateOwner(
      this.runId,
      this.agentSessionId,
      this.broadcaster,
      this.logger,
      () => this.readStateChanged(),
    );
    this.conversationPhase = new ConversationPhaseOwner(
      this.runId,
      this.conversationId,
      this.broadcaster,
      this.logger,
    );
    this.compaction = new RunCompaction({
      runId: this.runId,
      agentSessionId: this.agentSessionId,
      logger: this.logger,
      broadcaster: this.broadcaster,
      autoCompact:
        args.autoCompact?.enabled === true
          ? { threshold: args.autoCompact.threshold ?? 150_000 }
          : null,
      runner: () => this.runner ?? undefined,
      isProcessing: () => this._processing,
      session: () => this.session,
      activeTurn: () => this.activeTurn,
      contextProviderSessionId: () => this.contextProviderSessionId(),
      postAgentSystemMessage: (response, session) => this.postAgentSystemMessage(response, session),
    });
    this.proposalTracker = new RunProposalTracker({
      runId: this.runId,
      logger: this.logger,
      lookupProposal: (proposalId, signal) =>
        requireProposalStatusReader(collaborators.proposalStatusReader).lookupProposal(
          { organizationId: this.organizationId, projectId: this.projectId },
          proposalId,
          signal,
        ),
      lookupEntityTitle: (entityId, entityType, signal) =>
        requireProposalStatusReader(collaborators.proposalStatusReader).lookupEntityTitle(
          this.organizationId,
          entityId,
          entityType,
          signal,
        ),
    });
    this.workflowDispatchVerdictReader = collaborators.workflowDispatchVerdictReader ?? null;
    this.baseSubmissionTools = collaborators.baseSubmissionTools ?? [];
    this.idleRunReaper = collaborators.idleRunReaper ?? null;
    this.durableInputReady = collaborators.durableInputReady ?? null;
    this.trackToolUsage = collaborators.trackToolUsage ?? true;
    this.taskMonitorManagedTurnRuntime = collaborators.taskMonitorManagedTurnRuntime ?? null;
    this.taskMonitorLaunchFailureRuntime = collaborators.taskMonitorLaunchFailureRuntime ?? null;
    this.ownsProjectModeBundleMaterializer = !collaborators.projectModeBundleMaterializer;
    this.projectModeBundleMaterializer =
      collaborators.projectModeBundleMaterializer ?? new ProjectModeBundleMaterializer();

    // Build the handler-facing deps bag the dispatcher passes to every
    // normalized-event handler. Each persist* entry closes over `runStore`
    // directly — no naked callbacks crossing a boundary, just a local
    // binding that names the collaborator at the call site.
    const handlerFacingDeps: HandlerDeps = {
      poster: this.poster,
      logger: this.logger,
      ...(collaborators.reportSyncService
        ? { reportSyncService: collaborators.reportSyncService }
        : {}),
      ...(collaborators.onCompleteDeps ? { onCompleteDeps: collaborators.onCompleteDeps } : {}),
    };

    this.dispatcher = new EventDispatcher(handlerFacingDeps);

    this.logger.info('local.run.minted', {
      runId: this.runId,
      conversationId: this.conversationId,
      provider: this.provider,
      hasProviderSession: this.hasProviderSession,
      providerSessionId: this.session.provider_session_id ?? null,
    });

    // Rehydrate trigger context stamped on a prior process so the in-turn
    // submission path can still resolve the paused EXTERNAL_AGENT node after
    // a restart. Rehydrate only when the store carries both halves of the
    // pair — a partial read would violate the atomicity invariant. The
    // suppress flag avoids writing the just-read value back to disk.
    const persistedExternalAgentNodeId = args.session.triggerExternalAgentNodeId ?? null;
    const persistedTriggerMessageId = args.session.triggerMessageId ?? null;
    this.logger.info('local.run.rehydrate_trigger_context', {
      runId: this.runId,
      persistedExternalAgentNodeId,
      persistedTriggerMessageId,
      hadBothIds: persistedExternalAgentNodeId !== null && persistedTriggerMessageId !== null,
    });
    if (persistedExternalAgentNodeId !== null && persistedTriggerMessageId !== null) {
      this._suppressTriggerContextPersist = true;
      try {
        this.setTriggerContext({
          externalAgentNodeId: persistedExternalAgentNodeId,
          triggerMessageId: persistedTriggerMessageId,
        });
      } finally {
        this._suppressTriggerContextPersist = false;
      }
    }

    // Rehydrate only the durable identity of each open permission
    // presentation. The original SYSTEM payload remains in the platform; the
    // message id is sufficient to settle it if the provider waiter vanished
    // with the previous process. Live requests retain their in-memory payload
    // so permission_decision_recorded can still update the UI element in
    // place.
    const persistedPermissionPresentations = args.session.permissionRequestPresentations ?? [];
    for (const presentation of persistedPermissionPresentations) {
      this.permissionRequestMessages.set(presentation.requestId, {
        messageId: presentation.messageId,
        data: null,
      });
    }
    if (persistedPermissionPresentations.length > 0) {
      this.logger.info('local.run.permission_presentations.rehydrated', {
        runId: this.runId,
        presentationCount: persistedPermissionPresentations.length,
      });
    }
    this.serviceScope = new RunServiceScope({
      runId: this.runId,
      logger: this.logger,
      runStore: this.runStore,
      session: () => this.session,
      patchSession: (patch) => this.refreshSessionFields(patch),
      hasProviderSession: () => this.hasProviderSession,
      taskMonitorId: () => this.taskMonitorId,
      activeTurn: () => this.activeTurn,
      activeInput: () => this.activeTurnInput,
      abortSignal: () => this.abortSignal,
      hasInputAdmission: (input) => this.inputAdmissionFor(input) !== undefined,
      captureCheckpoint: (turnId) => this.captureServiceScopeCheckpoint(turnId),
      observeProviderPhase: (phase) => this.observeProviderPhase(phase),
      readStateChanged: () => this.readStateChanged(),
      requestSettled: () => this.notifyIfDurableInputAcceptable(),
      abort: () => this.abort(),
      resumeInput: (input) => {
        this.enqueue(input);
        if (!this.activeTurn && !this._processing) void this.drainQueue();
      },
      releaseHeldAdmission: (held) => this.releaseHeldAdmission(held),
      postAgentSystemMessage: (text) => this.postAgentSystemMessage(text),
    });
    this.serviceScopeCoordinator = new AgentSessionServiceScopeCoordinator({
      runStore: this.runStore,
      repoStore: this.repoStore,
      poster: this.poster,
      auth: this.handlerDeps.auth,
      apiBaseUrl: this.handlerDeps.apiBaseUrl,
      fetchImpl: this.handlerDeps.fetchImpl,
      keyPairStore: collaborators.keyPairStore ?? new KeyPairStore(),
      logger: this.logger,
      serviceScope: this.serviceScope,
      runId: this.runId,
      organizationId: this.organizationId,
      projectId: this.projectId,
      conversationId: this.conversationId,
      provider: this.provider,
      session: () => this.session,
      taskMonitorId: () => this.taskMonitorId,
      currentAgentId: () => this.currentAgentId(),
      canAutoResolveTaskMonitorScopeRequest: () => this.canAutoResolveTaskMonitorScopeRequest(),
      applyApprovedServiceScope: (input) => this.applyApprovedServiceScope(input),
    });
    // Seed Run-lifetime state from values a prior process stamped on the
    // store. The Run is constructed once per agentic session; each seed runs
    // once at activation and subsequent turns hit the resolved promise and
    // pay no extra latency. Both seeds run concurrently and the combined
    // promise is awaited once before the first prompt-render (and out-of-turn
    // via ensureSeeded). Each seed logs and swallows its own failure — a seed
    // must not block the Run, so the combined promise resolves either way.
    const seedSubPromises: Promise<void>[] = [];

    // Report chain from the task scope — only when a task is in scope.
    const taskReportChainReader = collaborators.taskReportChainReader;
    if (this.taskId !== null && taskReportChainReader) {
      const taskId = this.taskId;
      seedSubPromises.push(
        taskReportChainReader
          .read(taskId)
          .then((entries) => {
            for (const entry of entries) {
              this.appendReportChainEntry(entry);
            }
            this.logger.info('local.run.report_chain.seeded', {
              runId: this.runId,
              taskId,
              seededCount: entries.length,
            });
          })
          .catch((error) => {
            this.logger.warn('local.run.report_chain.seed_failed', {
              runId: this.runId,
              taskId,
              error: error instanceof Error ? error.message : String(error),
            });
          }),
      );
    }

    // Canonical facts and their cumulative path projection are seeded before
    // the first Turn. When no canonical sidecar exists, getTouchedFiles reads
    // the legacy path-only sidecar as a read-only compatibility projection.
    this._fileChangeFactsSeedPromise = args.fileChangeSeed
      ? Promise.resolve().then(() => {
          this._fileChangeFacts.push(...args.fileChangeSeed!.facts);
          for (const filePath of args.fileChangeSeed!.touchedFiles) {
            this.touchedFiles.add(filePath);
          }
          this.logger.info('local.run.file_change_facts.seeded_preloaded', {
            runId: this.runId,
            factCount: args.fileChangeSeed!.facts.length,
            projectedFileCount: args.fileChangeSeed!.touchedFiles.length,
          });
        })
      : Promise.resolve()
          .then(async () => {
            const [facts, paths] = await Promise.all([
              this.runStore.getFileChangeFacts(this.runId),
              this.runStore.getTouchedFiles(this.runId),
            ]);
            this._fileChangeFacts.push(...facts);
            for (const filePath of paths) {
              this.touchedFiles.add(filePath);
            }
            this.logger.info('local.run.file_change_facts.seeded', {
              runId: this.runId,
              factCount: facts.length,
              projectedFileCount: paths.length,
              legacyProjection: facts.length === 0 && paths.length > 0,
            });
          })
          .catch((error) => {
            this.logger.warn('local.run.file_change_facts.seed_failed', {
              runId: this.runId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
    seedSubPromises.push(this._fileChangeFactsSeedPromise);

    this._seedPromise = Promise.all(seedSubPromises).then(async () => {
      await this.reviewFileScopeCoordinator.reconcile(this);
    });
  }

  // ==================================================================
  // Handler-facing Run surface
  // ==================================================================

  /**
   * Project the Run-held provider session id for handlers/dispatchers
   * from the Run owner. Returns the current value of
   * `this.session.provider_session_id` (which may be a `pending_<uuid>`
   * placeholder until the SDK confirms its own id, or null after a handler
   * swap discards the prior provider session). Following the Run-owned
   * provider-session lifecycle here means messages stamped during a Turn
   * record the same SDK session the Run is currently bound to.
   */
  get providerSessionId(): string | null {
    return this.session.provider_session_id ?? null;
  }

  /**
   * The provider session the context gauge and the default Context read
   * address: the latest history member whose owning handler counts for
   * context, else the Run's own provider session.
   */
  contextProviderSessionId(): string | null {
    const latest = latestContextProviderSession(
      this.session.provider_session_history ?? [],
      (handlerId) =>
        this.promptTypeRegistry.getById(handlerId)?.providerSessionCountsForContext ?? false,
    );
    return latest?.providerSessionId ?? this.providerSessionId;
  }

  get entity(): RunEntityReference | null {
    return this.session.entity;
  }

  public get workItemType(): string | null {
    const loaded = this.startupPromptInputResult?.loadedEntityContext;
    return loaded?.kind === 'entity' && 'type' in loaded.entity ? loaded.entity.type : null;
  }

  /** Effective Agent Session state last published by this Run, or null before the first. */
  get effectiveState(): AgentSessionCurrentStateObservation | null {
    return this.agentSessionCurrentState.effectiveState;
  }

  /**
   * True while the Run holds work that idle reaping would interrupt. Distinct
   * from registry membership: idle and waiting Runs stay registered.
   */
  get hasActiveWork(): boolean {
    return !this.isGenuinelyIdle();
  }

  /** Typed focal entity and Context loaded for the current Turn, if any. */
  get loadedEntityContext(): LoadedEntityPromptContext | null {
    return this.startupPromptInputResult?.loadedEntityContext ?? null;
  }

  /**
   * Whether the focal entity Context for this Run is loaded, still expected,
   * failed to load, or is never loaded because the entity type has no
   * entity-context startup input. Null when the Run has no focal entity.
   */
  get entityContextLoadStatus(): RunEntityContextLoadStatus | null {
    const entity = this.entity;
    if (entity === null) return null;
    if (this.loadedEntityContext !== null) return 'loaded';
    if (!isEntityPromptTemplateFocalType(entity.entityType)) return 'not_loaded';
    if (this.entityContextLoadFailed) return 'failed';
    // A resolved Turn that carried no startup Context (e.g. a resumed provider session) never loads it.
    return this.entityContextResolved ? 'not_loaded' : 'pending';
  }

  /**
   * When this process first started a Turn for the Run, or null when the Run
   * was only loaded to answer reads. Session list membership and the
   * session's "active here" timer both read it.
   */
  get activeSince(): string | null {
    return this._activeSince;
  }

  get createdAt(): string {
    return this.session.createdAt;
  }

  get taskId(): string | null {
    const entity = this.entity;
    return entity?.entityType === 'TASK' ? entity.entityId : null;
  }

  get agentSessionId(): string {
    return this.session.contextMetadata.agentSessionId;
  }

  get taskMonitorId(): string | null {
    const taskMonitorId = this.session.contextMetadata.taskMonitorId;
    return typeof taskMonitorId === 'string' && taskMonitorId.length > 0 ? taskMonitorId : null;
  }

  public setTaskMonitorAutomationAuthorization(authorized: boolean): void {
    const changed = this.taskMonitorAutomationAuthorized !== authorized;
    this.taskMonitorAutomationAuthorized = authorized;
    this.logger.debug('local.run.task_monitor.automation_authorization_set', {
      runId: this.runId,
      taskMonitorId: this.taskMonitorId,
      authorized,
      changed,
    });
  }

  public canAutoResolveTaskMonitorScopeRequest(): boolean {
    return this.taskMonitorId !== null && this.taskMonitorAutomationAuthorized;
  }

  /**
   * Returns true when the given tool name belongs to the run-level base
   * submission tools (e.g. the universal `create_report` wrapper). Used by
   * the submission-tool HTTP handler to distinguish base tools — which are
   * always callable regardless of the active handler — from handler-specific
   * or peer-session tools, which are only callable when the declaring handler
   * is active.
   */
  isBaseSubmissionTool(name: string): boolean {
    const excluded = this.activeTurn?.handler.excludedBaseSubmissionTools;
    return !excluded?.includes(name) && this.baseSubmissionTools.some((t) => t.name === name);
  }

  // ==================================================================
  // Session / state accessors
  // ==================================================================

  /**
   * Merge updated session fields onto `run.session` in place. The only
   * sanctioned way to mutate `run.session` after activation — runners call
   * this after a `runPrompt`/`resumeSession` returns fresh provider
   * identity, and message.service calls it after activation refreshes the
   * session snapshot on a subsequent sendMessage.
   */
  refreshSessionFields(patch: Partial<AgenticSession>): void {
    if (
      'provider_session_id' in patch &&
      patch.provider_session_id !== this.session.provider_session_id
    ) {
      this.activeTurn?.changedFileReporting.providerSessionChanged(
        patch.provider_session_id ?? null,
      );
    }
    if ('services' in patch || 'launchServiceId' in patch || 'worktreeState' in patch) {
      const next = { ...this.session, ...patch };
      this.logger.debug('local.run.session_workspace.refreshed', {
        runId: this.runId,
        turnId: this.activeTurn?.turnId ?? null,
        promptType: this.session.promptType,
        patchedFields: Object.keys(patch),
        previousLaunchServiceId: this.session.launchServiceId ?? null,
        nextLaunchServiceId: next.launchServiceId ?? null,
        launchServiceChanged: this.session.launchServiceId !== next.launchServiceId,
        previousServices: this.session.services ?? [],
        nextServices: next.services ?? [],
        previousWorktreeState: this.session.worktreeState ?? null,
        nextWorktreeState: next.worktreeState ?? null,
      });
    }
    this.session = { ...this.session, ...patch };
    if ('provider_session_id' in patch || 'provider_conversation_id' in patch) {
      this.readStateChanged();
    }
  }

  /**
   * Replace the opaque revision supplied by the Feature Sync tool with the
   * revision computed from the authoritative Context loaded for this Turn.
   * The agent can describe a finding but cannot author the source hash; Run
   * owns that boundary because it already holds the fresh startup projection.
   */
  public normalizeImplementationReadinessForSubmission(
    disposition: ImplementationReadinessDisposition,
  ): ImplementationReadinessDisposition {
    const startupPromptInput = this.startupPromptInputResult;
    if (!startupPromptInput) {
      throw new Error(
        'Implementation-readiness submission requires an authoritative startup Context.',
      );
    }
    const sourceSnapshot = createReadinessSourceSnapshotFromStartupInput({
      runId: this.runId,
      startupPromptInput,
      capturedAt: new Date().toISOString(),
    });
    if (!sourceSnapshot) {
      throw new Error(
        'Implementation-readiness submission requires a task, feature, design doc, or plan Context.',
      );
    }
    return this.implementationReadinessOwner.normalizeForSource(disposition, sourceSnapshot);
  }

  /**
   * Persists a readiness response produced by the direct free-form preflight
   * and refreshes the live Run projection before a later continuation starts.
   * The response is normalized against the authoritative startup projection so
   * the model cannot choose a different Run identity or source revision.
   */
  public async persistImplementationReadinessFromAgentResponse(
    disposition: ImplementationReadinessDisposition,
  ): Promise<void> {
    const normalized = this.validateImplementationReadinessFromAgentResponse(disposition);
    const sessionContext = {
      ...(this.session.sessionContext ?? {}),
      ...this.implementationReadinessOwner.toSessionContext(normalized),
    };
    await this.runStore.updateRunSessionContext(this.runId, sessionContext);
    this.refreshSessionFields({ sessionContext });
    this.logger.info('local.run.implementation_readiness.response_persisted', {
      runId: this.runId,
      state: normalized.state,
      sourceRevision: normalized.sourceSnapshot.sourceRevision,
    });
  }

  public validateImplementationReadinessFromAgentResponse(
    disposition: ImplementationReadinessDisposition,
  ): ImplementationReadinessDisposition {
    if (disposition.state === 'DISMISSED') {
      throw new Error('DISMISSED is reserved for the confirmed user-facing Dismiss action.');
    }
    const persisted = this.implementationReadinessOwner.read(this.session);
    if (persisted && allowsImplementation(persisted)) {
      throw new Error('Implementation readiness is already complete for this Run.');
    }
    return this.normalizeImplementationReadinessForSubmission(disposition);
  }

  /**
   * While readiness is REVIEW_REQUIRED, any user composer reply is the
   * clarification: it runs a fresh readiness assessment on this Run instead of
   * being rejected by the admission guard. Only the free-form launch preflight
   * persists REVIEW_REQUIRED on the Run, and the Run is that result's
   * authority, so the clarification re-enters the same free-form assessment:
   * its readiness tool records an accepted CLEAR and the turn continues, or a
   * new REVIEW_REQUIRED keeps the review open. It never enters a workflow node
   * handler, whose completion requires a workflow-issued trigger. A reply to a
   * live workflow's review stays with that workflow, and workflow-generated
   * prompts are not replies and stay blocked by the guard.
   */
  private routeImplementationReadinessClarification(
    input: InternalRunPromptRequest,
  ): InternalRunPromptRequest {
    // Only prompt types the user sends from the composer count as a readiness
    // clarification; workflow-generated prompts stay guarded.
    if (
      this.promptTypeRegistry.get(input.promptType)?.implementationReadiness !==
      'gated_and_clarifiable'
    ) {
      return input;
    }
    if (input.awaitingUserReview === true) return input;
    const persisted = this.implementationReadinessOwner.read(this.session);
    if (persisted?.state !== 'REVIEW_REQUIRED') return input;
    this.logger.info('local.run.implementation_readiness.clarification_routed', {
      runId: this.runId,
      fromPromptType: input.promptType,
      sourceRevision: persisted.sourceSnapshot.sourceRevision,
    });
    const clarification: ImplementationReadinessClarification = { finding: persisted.finding };
    return {
      ...input,
      promptType: LocalPromptType.FreeForm,
      payload: {
        promptType: LocalPromptType.FreeForm,
        userMessage: resolvePromptText(input) ?? '',
      },
      [IMPLEMENTATION_READINESS_CLARIFICATION_MARKER]: clarification,
    } as RequestWithReadinessClarification;
  }

  // A routed clarification is the readiness assessment itself, not advancement
  // past it, so admission does not hold it to the pending finding.
  private isImplementationReadinessGatedInput(input: InternalRunPromptRequest): boolean {
    const readiness = this.promptTypeRegistry.get(input.promptType)?.implementationReadiness;
    return (
      input.awaitingUserReview !== true &&
      readImplementationReadinessClarification(input) === undefined &&
      (readiness === 'gated' || readiness === 'gated_and_clarifiable')
    );
  }

  private async enforceImplementationReadinessAdmission(
    input: InternalRunPromptRequest,
  ): Promise<void> {
    if (!this.isImplementationReadinessGatedInput(input)) return;

    const session = this.session;
    const submitted = readImplementationReadinessFromPayload(input.payload);
    const persisted = this.implementationReadinessOwner.read(session);
    const disposition =
      persisted && allowsImplementation(persisted)
        ? persisted
        : submitted
          ? parseImplementationReadinessDisposition(submitted)
          : persisted;
    if (!disposition) return;

    if (disposition.state === 'REVIEW_REQUIRED') {
      this.logger.warn('local.run.implementation_readiness.admission_blocked', {
        runId: this.runId,
        promptType: input.promptType,
        state: disposition.state,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'Implementation readiness requires a clarification or dismissal before planning or coding can continue.',
        409,
      );
    }

    if (!allowsImplementation(disposition)) {
      this.logger.error('local.run.implementation_readiness.admission_invalid_resolution', {
        runId: this.runId,
        promptType: input.promptType,
        state: disposition.state,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'The implementation-readiness disposition is not valid for this Run.',
        409,
      );
    }

    this.logger.info('local.run.implementation_readiness.admitted', {
      runId: this.runId,
      promptType: input.promptType,
      state: disposition.state,
      resolution: disposition.resolution.kind,
      sourceRevision: disposition.sourceSnapshot.sourceRevision,
    });
  }

  private async reconcileApprovedPlanServiceScope(
    requiredServiceIds: readonly string[],
    source: 'implement' | 'plan_execution',
  ): Promise<{
    services: ResolvedServiceBinding[];
    launchServiceId: string;
    workspaceBoundaryChanged: boolean;
  }> {
    const currentServiceIds = this.session.services.map(({ id }) => id);
    const serviceIds = Array.from(new Set([...currentServiceIds, ...requiredServiceIds]));
    const launchServiceId = this.session.launchServiceId;

    this.logger.info(`local.run.${source}.scope_reconcile_started`, {
      runId: this.runId,
      currentServiceIds,
      requiredServiceIds,
      serviceIds,
      launchServiceId: launchServiceId ?? null,
    });

    if (!launchServiceId || !serviceIds.includes(launchServiceId)) {
      const message = 'Approved Coding Plan scope cannot preserve its launch Service.';
      this.logger.warn(`local.run.${source}.scope_reconcile_failed`, {
        runId: this.runId,
        reason: 'launch_service_missing',
        launchServiceId: launchServiceId ?? null,
      });
      throw new LocalAgentApiError('REPO_BINDING_MISSING', message, 409);
    }

    const resolution = await resolveServiceBindingsForIds({
      serviceIds,
      repoStore: this.repoStore,
      logger: this.logger,
    });
    if (!resolution.ok) {
      this.logger.warn(`local.run.${source}.scope_reconcile_failed`, {
        runId: this.runId,
        reason: resolution.code,
        serviceId: resolution.serviceId,
      });
      throw new LocalAgentApiError(resolution.code, resolution.message, 409);
    }

    const reconciledSession: AgenticSession = {
      ...this.session,
      services: resolution.services,
      launchServiceId,
    };
    const workspace = await resolveRunWorkspace({
      session: reconciledSession,
      repoStore: this.repoStore,
      logger: this.logger,
    });
    if (!workspace.ok) {
      this.logger.warn(`local.run.${source}.scope_reconcile_failed`, {
        runId: this.runId,
        reason: workspace.code,
        launchServiceId,
        serviceIds,
      });
      throw new LocalAgentApiError(
        workspace.code === 'REPO_BINDING_MISSING' ? 'REPO_BINDING_MISSING' : 'INVALID_REQUEST',
        workspace.message,
        workspace.code === 'REPO_BINDING_MISSING' ? 409 : 400,
      );
    }
    const workspaceBoundaryChanged =
      this.workspaceWriteBoundary !== null &&
      !this.workspaceWriteBoundary.matchesWorkspace(workspace);

    await this.runStore.updateRunServices(this.runId, {
      services: resolution.services,
      launchServiceId,
    });
    if (workspace.worktree) {
      try {
        await this.runStore.updateRunWorktreeState(this.runId, workspace.worktree);
      } catch (error) {
        this.logger.error(`local.run.${source}.worktree_state_persist_failed`, {
          runId: this.runId,
          serviceIds,
          error,
        });
      }
    }
    this.refreshSessionFields({
      services: resolution.services,
      launchServiceId,
      ...(workspace.worktree ? { worktreeState: workspace.worktree } : {}),
    });

    this.logger.info(`local.run.${source}.scope_reconcile_succeeded`, {
      runId: this.runId,
      serviceIds: resolution.services.map(({ id }) => id),
      launchServiceId,
      worktreeServiceIds: workspace.worktree ? Object.keys(workspace.worktree) : [],
    });
    return { services: resolution.services, launchServiceId, workspaceBoundaryChanged };
  }

  private async reconcilePreparedPromptServiceScope(
    handler: PromptTypeHandler<unknown>,
    payload: unknown,
  ): Promise<{ payload: unknown; workspaceBoundaryChanged: boolean }> {
    if (handler.promptType !== LocalPromptType.Implement) {
      return { payload, workspaceBoundaryChanged: false };
    }

    const requiredServiceIds = readPreparedImplementRequiredServiceIds(payload);
    if (!requiredServiceIds) {
      this.logger.warn('local.run.implement.scope_reconcile_failed', {
        runId: this.runId,
        reason: 'approved_plan_missing_or_invalid',
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'Implement requires a valid approved Coding Plan with requiredServiceIds.',
        400,
      );
    }

    const reconciledScope = await this.reconcileApprovedPlanServiceScope(
      requiredServiceIds,
      'implement',
    );
    return {
      payload: withPreparedImplementSessionScope(
        payload,
        reconciledScope.services,
        reconciledScope.launchServiceId,
        this.session.worktreeState,
      ),
      workspaceBoundaryChanged: reconciledScope.workspaceBoundaryChanged,
    };
  }

  setRunner(runner: AgentSessionRunner): void {
    this.runner = runner;
  }

  notePermissionDecisionDelivered(input: {
    requestId: string;
    decision: PermissionDecision;
    callbackType: PermissionCallbackType;
  }): void {
    this.settlePermissionRequestMessage(input.requestId);
    if (
      this.agentSessionCurrentState.currentProviderPhase !== 'awaiting_approval' &&
      this.conversationPhase.currentPhase !== 'awaiting_approval'
    ) {
      this.logger.debug('local.run.permission_decision.phase_resume.skipped', {
        runId: this.runId,
        conversationId: this.conversationId,
        requestId: input.requestId,
        decision: input.decision,
        callbackType: input.callbackType,
        currentProviderPhase: this.agentSessionCurrentState.currentProviderPhase,
        hasActiveTurn: this.activeTurn !== null,
      });
      return;
    }

    this.logger.debug('local.run.permission_decision.phase_resume.emitted', {
      runId: this.runId,
      conversationId: this.conversationId,
      requestId: input.requestId,
      decision: input.decision,
      callbackType: input.callbackType,
      priorPhase: 'awaiting_approval',
      nextPhase: 'thinking',
      hasActiveTurn: this.activeTurn !== null,
    });
    this.agentSessionCurrentState.observeProviderPhase('thinking');
    this.conversationPhase.resumeAfterApproval();
  }

  /**
   * Settlement boundary for an answered agent question: explicitly publishes the
   * resumed phase instead of waiting for a later provider event.
   */
  noteQuestionAnswerDelivered(input: { requestId: string }): void {
    if (
      this.agentSessionCurrentState.currentProviderPhase !== 'awaiting_approval' &&
      this.conversationPhase.currentPhase !== 'awaiting_approval'
    ) {
      this.logger.debug('local.run.question_answer.phase_resume.skipped', {
        runId: this.runId,
        conversationId: this.conversationId,
        requestId: input.requestId,
        currentProviderPhase: this.agentSessionCurrentState.currentProviderPhase,
        hasActiveTurn: this.activeTurn !== null,
      });
      return;
    }

    this.logger.debug('local.run.question_answer.phase_resume.emitted', {
      runId: this.runId,
      conversationId: this.conversationId,
      requestId: input.requestId,
      priorPhase: 'awaiting_approval',
      nextPhase: 'thinking',
      hasActiveTurn: this.activeTurn !== null,
    });
    this.agentSessionCurrentState.observeProviderPhase('thinking');
    this.conversationPhase.resumeAfterApproval();
  }

  setHasProviderSession(value: boolean, reason: string): void {
    const prior = this.hasProviderSession;
    this.hasProviderSession = value;
    if (prior !== value) {
      this.logger.info('local.run.has_provider_session.changed', {
        runId: this.runId,
        prior,
        next: value,
        reason,
      });
    }
  }

  setTriggerContext(ctx: { externalAgentNodeId: string; triggerMessageId: string } | null): void {
    const prior = this.triggerContext;
    const unchanged =
      prior === ctx ||
      (prior !== null &&
        ctx !== null &&
        prior.externalAgentNodeId === ctx.externalAgentNodeId &&
        prior.triggerMessageId === ctx.triggerMessageId);
    if (unchanged) return;
    this.logger.debug('local.run.trigger_context_changed', {
      runId: this.runId,
      previous: prior,
      next: ctx,
    });
    this.triggerContext = ctx;
    this.persistTriggerContext();
  }

  getTriggerContext(): { externalAgentNodeId: string; triggerMessageId: string } | null {
    return this.triggerContext;
  }

  /**
   * Fire-and-forget persist of the current trigger context as a single write.
   * Errors are logged but never block the Turn. Suppressed during constructor
   * rehydration so reading from disk does not immediately re-write the same
   * value back.
   */
  private persistTriggerContext(): void {
    if (this._suppressTriggerContextPersist) return;
    const ctx = this.triggerContext;
    const externalAgentNodeId = ctx?.externalAgentNodeId ?? null;
    const triggerMessageId = ctx?.triggerMessageId ?? null;
    void this.runStore
      .updateRunTriggerContext(this.runId, { externalAgentNodeId, triggerMessageId })
      .then(() => {
        this.logger.info('local.run.persist_trigger_context.succeeded', {
          runId: this.runId,
          externalAgentNodeId,
          triggerMessageId,
        });
      })
      .catch((error) => {
        this.logger.error('local.run.persist_trigger_context_failed', {
          runId: this.runId,
          externalAgentNodeId,
          triggerMessageId,
          error,
        });
      });
  }

  setLastSubmissionAction(action: SubmissionToolAction | null): void {
    this.lastSubmissionAction = action;
    if (action !== null && this.activeTurn !== null) {
      this._submittedTurnIds.add(this.activeTurn.turnId);
    }
  }

  getLastSubmissionAction(): SubmissionToolAction | null {
    return this.lastSubmissionAction;
  }

  /**
   * Absolute paths observed at any point during this Run's lifetime.
   *
   * This is historical evidence, not the current dirty-file set. Live UI and
   * commit scope must project `getFileChangeProjection()` through git status.
   */
  getRunLifetimeTouchedFiles(): string[] {
    return [...this.touchedFiles];
  }

  getFileChangeProjection(turnId?: string): FileChangeProjection[] {
    if (this._fileChangeFacts.length > 0) {
      return projectFileChanges(this._fileChangeFacts, turnId);
    }
    const touchedFiles =
      turnId === undefined
        ? this.touchedFiles
        : (this._filesTouchedByTurn.get(turnId) ?? new Set());
    return [...touchedFiles].map((candidatePath) => {
      const resolved = resolveRunFilePath(this.session, candidatePath);
      return resolved
        ? {
            serviceId: resolved.serviceId,
            repoRelativePath: resolved.repoRelativePath,
          }
        : { serviceId: 'legacy', repoRelativePath: candidatePath };
    });
  }

  logImplementReportValidation(
    event: string,
    metadata: Record<string, string | number | boolean | null | readonly string[]>,
  ): void {
    this.logger.warn(event, { runId: this.runId, ...metadata });
  }

  /**
   * Resolve once the constructor's Run-lifetime seeds (report chain +
   * touched files) have settled. Out-of-turn readers — e.g. the diffs route
   * reading a freshly reconstructed Run — await this before `getTouchedFiles`
   * so they observe the seeded set rather than an empty one. Resolves even if
   * a seed failed (each seed swallows its own error); a no-op when no seed is
   * pending. `handleMessage` already gates the first prompt-render on the same
   * promise, so in-turn readers (review/commit subagents) need no extra await.
   */
  async ensureSeeded(): Promise<void> {
    if (this._seedPromise) {
      await this._seedPromise;
    }
  }

  /** Await only the durable file-membership seed used by startup read surfaces. */
  async ensureFileChangeFactsSeeded(): Promise<void> {
    await this._fileChangeFactsSeedPromise;
  }

  /**
   * Record that the active Turn's runner touched `file`. Writes to the
   * cumulative `touchedFiles` set (Run-lifetime, used by review/commit
   * subagents and the diffs route) and to the per-turn map keyed by
   * `Turn.turnId` (consumed by post-runner report enforcement so a Turn that
   * re-touches a file already in the cumulative set is still recognised as
   * having made changes).
   */
  recordTouchedFile(file: string): void {
    this.touchedFiles.add(file);
    const turn = this.activeTurn;
    if (turn === null) return;
    let perTurn = this._filesTouchedByTurn.get(turn.turnId);
    if (!perTurn) {
      perTurn = new Set<string>();
      this._filesTouchedByTurn.set(turn.turnId, perTurn);
    }
    perTurn.add(file);
  }

  recordToolUsage(blocks: ToolUseNormalizedBlock[]): void {
    if (!this.trackToolUsage) return;
    const entries = blocks.map((block) => ({
      toolName: block.toolName,
      toolUseId: block.id,
      timestamp: new Date().toISOString(),
      input: block.input,
    }));
    void this.runStore.addToolUsage(this.runId, entries).catch((error) => {
      this.logger.error('local.run.persist_tool_usage_failed', {
        runId: this.runId,
        entryCount: entries.length,
        error,
      });
    });
  }

  observeProviderPhase(phase: ProviderPhase): void {
    this.agentSessionCurrentState.observeProviderPhase(phase);
    this.conversationPhase.observeProviderPhase(phase);
  }

  /**
   * A phase reported by the provider session. Its launch-time `starting` would
   * otherwise briefly replace the handler-requested gathering state, which must
   * hold until the session's first real activity.
   */
  observeProviderSessionPhase(phase: ProviderPhase): void {
    if (
      phase === 'starting' &&
      this.agentSessionCurrentState.currentProviderPhase === 'gathering_context'
    ) {
      this.logger.debug('local.run.current_state.provider_starting_kept_gathering_context', {
        runId: this.runId,
        conversationId: this.conversationId,
      });
      return;
    }
    this.observeProviderPhase(phase);
  }

  observeConversationPhase(phase: import('../shared/api/generated/api').ConversationPhase): void {
    if (phase === 'reviewing') {
      this.conversationPhase.observeReviewing();
      return;
    }
    this.conversationPhase.observeProviderPhase(phase);
  }

  observePersistedPlanReady(reportId: string): void {
    const turn = this.activeTurn;
    if (turn === null) {
      this.logger.warn('local.run.current_state.plan_ready_report_without_active_turn', {
        runId: this.runId,
        agentSessionId: this.agentSessionId,
        reportId,
      });
      return;
    }
    this.agentSessionCurrentState.observePersistedPlanReady(reportId, turn.turnId);
  }

  observeFinalAssistantMessageCommitted(turnId: string, messageId: string): void {
    this.agentSessionCurrentState.observeFinalAssistantMessageCommitted(messageId, turnId);
  }

  stageFileChanges(changes: StagedFileChange[]): void {
    const turn = this.activeTurn;
    if (!turn) {
      this.logger.warn('local.run.file_change.stage.rejected_missing_turn', {
        runId: this.runId,
        changeCount: changes.length,
      });
      return;
    }
    for (const change of changes) {
      this._stagedFileChanges.set(change.toolUseId, change);
      this.logger.debug('local.run.file_change.stage.accepted', {
        runId: this.runId,
        turnId: turn.turnId,
        toolUseId: change.toolUseId,
        providerSessionId: change.candidate.providerSessionId,
        paths: change.candidate.paths,
      });
    }
  }

  async confirmStagedFileChange(input: {
    toolUseId: string;
    isError: boolean;
    providerSessionId: string | null;
    occurredAt: string;
  }): Promise<void> {
    const staged = this._stagedFileChanges.get(input.toolUseId);
    if (!staged) {
      this.logger.debug('local.run.file_change.confirm.rejected_unattributed', {
        runId: this.runId,
        toolUseId: input.toolUseId,
        isError: input.isError,
      });
      return;
    }
    this._stagedFileChanges.delete(input.toolUseId);
    if (input.isError) {
      this.logger.warn('local.run.file_change.confirm.rejected_failed_tool', {
        runId: this.runId,
        toolUseId: input.toolUseId,
      });
      return;
    }
    if (
      !input.providerSessionId ||
      staged.candidate.providerSessionId !== input.providerSessionId
    ) {
      this.logger.warn('local.run.file_change.confirm.rejected_session_mismatch', {
        runId: this.runId,
        toolUseId: input.toolUseId,
        stagedProviderSessionId: staged.candidate.providerSessionId,
        resultProviderSessionId: input.providerSessionId,
      });
      return;
    }
    await this.recordFileChanges({
      ...staged.candidate,
      occurredAt: input.occurredAt,
    });
  }

  async recordFileChanges(candidate: CanonicalFileChangeCandidate): Promise<void> {
    const operation = this._fileChangeMutation
      .catch(() => undefined)
      .then(() => this.recordFileChangesUnlocked(candidate));
    this._fileChangeMutation = operation;
    await operation;
  }

  private async recordFileChangesUnlocked(candidate: CanonicalFileChangeCandidate): Promise<void> {
    const turn = this.activeTurn;
    if (!turn || candidate.runId !== this.runId || candidate.provider !== this.provider) {
      this.logger.warn('local.run.file_change.rejected_context_mismatch', {
        runId: this.runId,
        candidateRunId: candidate.runId,
        candidateProvider: candidate.provider,
        provider: this.provider,
        hasActiveTurn: turn !== null,
      });
      return;
    }
    if (!candidate.providerSessionId) {
      this.logger.warn('local.run.file_change.rejected_missing_provider_session', {
        runId: this.runId,
        turnId: turn.turnId,
      });
      return;
    }
    const expectedProviderSessionId = this.expectedFileChangeProviderSessionId();
    if (
      this.provider !== 'claude' &&
      expectedProviderSessionId !== null &&
      candidate.providerSessionId !== expectedProviderSessionId
    ) {
      this.logger.warn('local.run.file_change.rejected_provider_session_mismatch', {
        runId: this.runId,
        turnId: turn.turnId,
        expectedProviderSessionId,
        receivedProviderSessionId: candidate.providerSessionId,
      });
      return;
    }
    if (this.provider === 'codex') {
      const validThread =
        this._activeProviderThreadId !== null &&
        candidate.providerThreadId === this._activeProviderThreadId;
      const validTurn =
        this._activeProviderTurnId !== null &&
        candidate.providerTurnId === this._activeProviderTurnId &&
        !this._completedProviderTurnIds.has(candidate.providerTurnId);
      if (!validThread || !validTurn) {
        this.logger.warn('local.run.file_change.rejected_codex_routing', {
          runId: this.runId,
          turnId: turn.turnId,
          activeProviderThreadId: this._activeProviderThreadId,
          candidateProviderThreadId: candidate.providerThreadId,
          activeProviderTurnId: this._activeProviderTurnId,
          candidateProviderTurnId: candidate.providerTurnId,
          validThread,
          validTurn,
        });
        return;
      }
    }

    await this.persistFileChangeFacts(
      turn,
      { ...candidate, providerSessionId: candidate.providerSessionId },
      'provider_event',
    );
  }

  /**
   * Records the files the agent reported in its completion for `turn`. Only
   * reported paths git currently shows as changed in the reported service
   * become canonical facts.
   */
  async recordReportedFileChanges(input: {
    turn: Turn;
    providerSessionId: string | null;
    files: readonly ReportedChangedFile[];
    occurredAt: string;
  }): Promise<ReportedFileChangeResolution> {
    const operation = this._fileChangeMutation
      .catch(() => undefined)
      .then(() => this.recordReportedFileChangesUnlocked(input));
    this._fileChangeMutation = operation.then(() => undefined);
    return await operation;
  }

  private async recordReportedFileChangesUnlocked(input: {
    turn: Turn;
    providerSessionId: string | null;
    files: readonly ReportedChangedFile[];
    occurredAt: string;
  }): Promise<ReportedFileChangeResolution> {
    const { turn } = input;
    if (this.activeTurn !== turn) {
      this.logger.warn('local.run.file_change.agent_report.rejected_inactive_turn', {
        runId: this.runId,
        turnId: turn.turnId,
        activeTurnId: this.activeTurn?.turnId ?? null,
      });
      throw new Error('Inactive changed-file reporting context');
    }
    if (!input.providerSessionId) {
      this.logger.warn('local.run.file_change.agent_report.rejected_missing_provider_session', {
        runId: this.runId,
        turnId: turn.turnId,
      });
      throw new Error('Inactive changed-file reporting context');
    }
    const resolution = await resolveReportedFileChanges(
      this.session,
      input.files,
      undefined,
      this._fileChangeFacts.filter(
        (fact) => fact.runId === this.runId && fact.attributionSource === 'provider_event',
      ),
    );
    const { admitted, rejected } = resolution;
    this.logger.info('local.run.file_change.agent_report.resolved', {
      runId: this.runId,
      turnId: turn.turnId,
      reportedCount: input.files.length,
      admitted: admitted.map((file) => ({
        serviceId: file.serviceId,
        repoRelativePath: file.repoRelativePath,
      })),
      rejected,
    });
    const recorded = new Set(
      projectFileChanges(this._fileChangeFacts, turn.turnId).map((fact) =>
        canonicalFileChangeKey(fact.serviceId, fact.repoRelativePath),
      ),
    );
    const unrecorded = admitted.filter(
      (file) => !recorded.has(canonicalFileChangeKey(file.serviceId, file.repoRelativePath)),
    );
    if (unrecorded.length === 0) return resolution;
    await this.persistFileChangeFacts(
      turn,
      {
        runId: this.runId,
        provider: this.provider,
        providerSessionId: input.providerSessionId,
        providerThreadId: this._activeProviderThreadId,
        providerTurnId: this._activeProviderTurnId,
        paths: unrecorded.map((file) => file.absolutePath),
        occurredAt: input.occurredAt,
        providerPatch: null,
      },
      'agent_report',
    );
    return resolution;
  }

  private async persistFileChangeFacts(
    turn: Turn,
    candidate: CanonicalFileChangeCandidate & { providerSessionId: string },
    attributionSource: CanonicalFileChangeAttributionSource,
  ): Promise<void> {
    const facts: CanonicalFileChangeFact[] = [];
    for (const candidatePath of candidate.paths) {
      const resolved = resolveRunFilePath(this.session, candidatePath);
      if (!resolved) {
        this.logger.warn('local.run.file_change.rejected_out_of_root', {
          runId: this.runId,
          turnId: turn.turnId,
          candidatePath,
          serviceIds: this.session.services.map((service) => service.id),
        });
        continue;
      }
      if (
        attributionSource === 'provider_event' &&
        facts.length === 0 &&
        turn.handler.requiresChangedFileReporting
      ) {
        turn.changedFileReporting.successfulEdit();
      }
      const evidenceCapture = await captureFileChangeEvidence(resolved, candidate.providerPatch);
      if (attributionSource === 'agent_report' && evidenceCapture.gitDiffError !== null) {
        throw new ReportedFileChangeFailure('git_read_failed');
      }
      this.logger.debug('local.run.file_change.evidence_captured', {
        runId: this.runId,
        turnId: turn.turnId,
        providerSessionId: candidate.providerSessionId,
        serviceId: resolved.serviceId,
        repoRelativePath: resolved.repoRelativePath,
        evidenceKind: evidenceCapture.evidence.kind,
        evidenceSource: evidenceCapture.source,
        gitDiffError: evidenceCapture.gitDiffError,
        hasProviderPatch: candidate.providerPatch !== null && candidate.providerPatch.length > 0,
        attributionSource,
      });
      facts.push({
        attributionSource,
        executionRoot: resolved.repositoryRoot,
        factId: randomUUID(),
        runId: this.runId,
        turnId: turn.turnId,
        provider: this.provider,
        providerSessionId: candidate.providerSessionId,
        providerThreadId: candidate.providerThreadId,
        providerTurnId: candidate.providerTurnId,
        serviceId: resolved.serviceId,
        repoRelativePath: resolved.repoRelativePath,
        occurredAt: candidate.occurredAt,
        evidence: evidenceCapture.evidence,
      });
    }
    if (facts.length === 0) {
      this.logger.warn('local.run.file_change.rejected_no_resolved_facts', {
        runId: this.runId,
        turnId: turn.turnId,
        providerSessionId: candidate.providerSessionId,
        candidatePathCount: candidate.paths.length,
      });
      return;
    }

    await this.runStore.appendFileChangeFacts(this.runId, facts);
    this._fileChangeFacts.push(...facts);
    if (attributionSource === 'provider_event') {
      if (turn.handler.requiresChangedFileReporting) {
        try {
          await this.persistChangedFileReporting(turn);
        } catch {
          this.logger.warn('local.run.changed_file_reporting.evidence_write_failed', {
            runId: this.runId,
            turnId: turn.turnId,
          });
        }
      }
    }
    for (const fact of facts) {
      const absolutePath = resolveProjectedFilePath(this.session, fact);
      if (absolutePath) this.recordTouchedFile(absolutePath);
    }
    this.logger.info('local.run.file_change.persisted', {
      runId: this.runId,
      turnId: turn.turnId,
      providerSessionId: candidate.providerSessionId,
      attributionSource,
      factCount: facts.length,
      files: facts.map((fact) => ({
        serviceId: fact.serviceId,
        repoRelativePath: fact.repoRelativePath,
      })),
    });
  }

  async enrichFileChangeEvidence(input: {
    providerSessionId: string | null;
    providerTurnId: string | null;
    patches: Array<{ path: string; diff: string }>;
  }): Promise<void> {
    const operation = this._fileChangeMutation
      .catch(() => undefined)
      .then(async () => {
        const turn = this.activeTurn;
        if (!turn) {
          this.logger.warn('local.run.file_change.evidence_enrichment_skipped_missing_turn', {
            runId: this.runId,
            providerSessionId: input.providerSessionId,
            providerTurnId: input.providerTurnId,
            patchCount: input.patches.length,
          });
          return;
        }
        if (!input.providerSessionId) {
          this.logger.warn('local.run.file_change.evidence_enrichment_skipped_missing_session', {
            runId: this.runId,
            turnId: turn.turnId,
            providerTurnId: input.providerTurnId,
            patchCount: input.patches.length,
          });
          return;
        }
        let changed = false;
        for (const patch of input.patches) {
          const resolved = resolveRunFilePath(this.session, patch.path);
          if (!resolved) {
            this.logger.warn('local.run.file_change.evidence_enrichment_skipped_out_of_root', {
              runId: this.runId,
              turnId: turn.turnId,
              providerSessionId: input.providerSessionId,
              providerTurnId: input.providerTurnId,
              patchPath: patch.path,
            });
            continue;
          }
          let matched = false;
          for (let index = this._fileChangeFacts.length - 1; index >= 0; index -= 1) {
            const fact = this._fileChangeFacts[index];
            if (
              fact?.turnId !== turn.turnId ||
              fact.providerSessionId !== input.providerSessionId ||
              fact.serviceId !== resolved.serviceId ||
              fact.repoRelativePath !== resolved.repoRelativePath
            ) {
              continue;
            }
            fact.evidence =
              fact.evidence.kind === 'patch'
                ? { ...fact.evidence, diff: patch.diff }
                : { ...fact.evidence, diff: patch.diff };
            matched = true;
            changed = true;
            break;
          }
          if (!matched) {
            this.logger.debug('local.run.file_change.evidence_enrichment_patch_unmatched', {
              runId: this.runId,
              turnId: turn.turnId,
              providerSessionId: input.providerSessionId,
              providerTurnId: input.providerTurnId,
              serviceId: resolved.serviceId,
              repoRelativePath: resolved.repoRelativePath,
              factCount: this._fileChangeFacts.length,
            });
          }
        }
        if (changed) {
          await this.runStore.replaceFileChangeFacts(this.runId, this._fileChangeFacts);
          this.logger.info('local.run.file_change.evidence_enriched', {
            runId: this.runId,
            turnId: turn.turnId,
            patchCount: input.patches.length,
          });
        } else {
          this.logger.debug('local.run.file_change.evidence_enrichment_skipped_unattributed', {
            runId: this.runId,
            turnId: turn.turnId,
            patchCount: input.patches.length,
          });
        }
      });
    this._fileChangeMutation = operation;
    await operation;
  }

  /**
   * Append a narration `segment` to the Turn's coalesced interstitial buffer
   * and report whether this is the Turn's first segment. Race-safe: the body
   * runs synchronously with no `await`, so concurrent `assistant_delta`
   * handlers can never both observe `isFirst: true`. The first caller authors
   * the row and must settle the returned `messageId` promise with the create
   * outcome (`resolveNarrationMessageId` / `rejectNarrationMessageId`); later
   * callers await `messageId` and update the same row in place.
   */
  claimNarration(
    turnId: string,
    segment: string,
  ): { body: string; isFirst: boolean; messageId: Promise<string> } {
    const existing = this._narrationByTurn.get(turnId);
    if (existing) {
      return { body: existing.append(segment), isFirst: false, messageId: existing.messageId };
    }
    const slot = new NarrationSlot(segment);
    this._narrationByTurn.set(turnId, slot);
    return { body: slot.body, isFirst: true, messageId: slot.messageId };
  }

  resolveNarrationMessageId(turnId: string, messageId: string): void {
    this._narrationByTurn.get(turnId)?.resolve(messageId);
  }

  rejectNarrationMessageId(turnId: string, error: unknown): void {
    this._narrationByTurn.get(turnId)?.reject(error);
  }

  recordPermissionRequestMessage(
    requestId: string,
    messageId: string,
    data: SystemMessageData,
  ): void {
    this.settledPermissionRequestIds.delete(requestId);
    this.permissionRequestMessages.set(requestId, { messageId, data });
    const presentations: PermissionRequestPresentation[] = [
      ...(this.session.permissionRequestPresentations ?? []).filter(
        (presentation) => presentation.requestId !== requestId,
      ),
      { requestId, messageId },
    ];
    this.refreshSessionFields({ permissionRequestPresentations: presentations });
    void this.runStore
      .updateRunPermissionRequestPresentations(this.runId, presentations)
      .catch((error) => {
        this.logger.error('local.run.permission_presentations.persist_failed', {
          runId: this.runId,
          requestId,
          messageId,
          error,
        });
      });
  }

  recordQuestionMessage(requestId: string, messageId: string, data: SystemMessageData): void {
    this.questionMessages.set(requestId, { messageId, data });
  }

  getQuestionMessage(
    requestId: string,
  ): { messageId: string; data: SystemMessageData } | undefined {
    return this.questionMessages.get(requestId);
  }

  forgetQuestionMessage(requestId: string): void {
    this.questionMessages.delete(requestId);
  }

  getPermissionRequestMessage(
    requestId: string,
  ): { messageId: string; data: SystemMessageData | null } | undefined {
    return this.permissionRequestMessages.get(requestId);
  }

  hasPermissionRequestRecord(requestId: string): boolean {
    return (
      this.permissionRequestMessages.has(requestId) ||
      this.settledPermissionRequestIds.has(requestId)
    );
  }

  /**
   * Claim a permission presentation before any recovery side effect. The
   * synchronous map removal is the in-process idempotency gate; persistence
   * follows through `persistPermissionRequestMessages` before the old message
   * is settled or the retry is posted.
   */
  claimPermissionRequestMessage(
    requestId: string,
  ): { messageId: string; data: SystemMessageData | null } | undefined {
    if (this.settledPermissionRequestIds.has(requestId)) return undefined;
    const entry = this.permissionRequestMessages.get(requestId);
    if (!entry) return undefined;
    this.permissionRequestMessages.delete(requestId);
    this.settledPermissionRequestIds.add(requestId);
    this.refreshSessionFields({
      permissionRequestPresentations: (this.session.permissionRequestPresentations ?? []).filter(
        (presentation) => presentation.requestId !== requestId,
      ),
    });
    return entry;
  }

  /** Mark a delivered decision as settled while retaining live payload data
   * long enough for permission_decision_recorded to update the original row. */
  settlePermissionRequestMessage(requestId: string): void {
    if (!this.permissionRequestMessages.has(requestId)) return;
    this.settledPermissionRequestIds.add(requestId);
    const presentations = (this.session.permissionRequestPresentations ?? []).filter(
      (presentation) => presentation.requestId !== requestId,
    );
    this.refreshSessionFields({ permissionRequestPresentations: presentations });
    void this.runStore
      .updateRunPermissionRequestPresentations(this.runId, presentations)
      .catch((error) => {
        this.logger.error('local.run.permission_presentations.settle_persist_failed', {
          runId: this.runId,
          requestId,
          error,
        });
      });
  }

  forgetPermissionRequestMessage(requestId: string): void {
    const deleted = this.permissionRequestMessages.delete(requestId);
    const currentPresentations = this.session.permissionRequestPresentations ?? [];
    const presentations = currentPresentations.filter(
      (presentation) => presentation.requestId !== requestId,
    );
    if (!deleted && presentations.length === currentPresentations.length) return;

    this.settledPermissionRequestIds.add(requestId);
    this.refreshSessionFields({ permissionRequestPresentations: presentations });
    void this.runStore
      .updateRunPermissionRequestPresentations(this.runId, presentations)
      .catch((error) => {
        this.logger.error('local.run.permission_presentations.forget_persist_failed', {
          runId: this.runId,
          requestId,
          error,
        });
      });
  }

  async persistPermissionRequestMessages(): Promise<void> {
    await this.runStore.updateRunPermissionRequestPresentations(
      this.runId,
      this.session.permissionRequestPresentations ?? [],
    );
    this.logger.debug('local.run.permission_presentations.persisted', {
      runId: this.runId,
      presentationCount: this.session.permissionRequestPresentations?.length ?? 0,
    });
  }

  async recoverStalePermissionDecision(
    input: PermissionDecisionRoutingInput,
  ): Promise<{ outcome: 'dropped'; reason: string }> {
    const request = this.claimPermissionRequestMessage(input.requestId);
    if (!request) {
      this.logger.info('local.run.permission_recovery.already_settled', {
        runId: this.runId,
        requestId: input.requestId,
      });
      return { outcome: 'dropped', reason: 'stale_permission_already_settled' };
    }

    await this.persistPermissionRequestMessages();
    if (this.activeTurn === null && this.agentSessionCurrentState.currentProviderPhase !== 'idle') {
      const priorPhase = this.agentSessionCurrentState.currentProviderPhase;
      this.observeProviderPhase('idle');
      this.logger.info('local.run.permission_recovery.phase_cleared', {
        runId: this.runId,
        conversationId: this.conversationId,
        requestId: input.requestId,
        priorPhase,
        nextPhase: 'idle',
      });
    }

    await this.poster.complete(
      this.organizationId,
      this.projectId,
      request.messageId,
      { status: MessageStatus.Completed },
      null,
    );

    // The old provider waiter is left unresolved: it cannot authorize the action. The retry is
    // admitted on the durable input queue (not posted as a USER message — a CLI-posted message
    // never returns as a signed user_message trigger), keyed by the stale request so a repeated
    // click or a restart yields at most one fresh Turn.
    const { replayed } = await this.runFollowUpAdmission.admit({
      stableKey: `permission-recovery:${input.requestId}`,
      agentSessionId: this.agentSessionId,
      runId: this.runId,
      organizationId: this.organizationId,
      projectId: this.projectId,
      userId: input.deciderUserId,
      payload: {
        kind: 'run_follow_up',
        origin: 'permission_recovery',
        requestId: input.requestId,
        agentInput: {
          promptType: LocalPromptType.CodingFreeform,
          userMessage:
            'Please retry the blocked action now. If permission is still required, request it again.',
        },
      },
    });
    if (!replayed) {
      await this.postAgentSystemMessage(
        'Sorry, looks like we have to ask again… The earlier approval request expired when the CLI restarted, so the action will be retried and approval requested again if needed.',
      );
    }

    this.logger.info('local.run.permission_recovery.retry_admitted', {
      runId: this.runId,
      requestId: input.requestId,
      originalMessageId: request.messageId,
      replayed,
    });
    return { outcome: 'dropped', reason: 'stale_permission_recovered' };
  }

  public currentAgentId(): string | null {
    return this.activeTurn?.handler.id ?? this.session.provider_session_agent_id ?? null;
  }

  /** The interrupted Turn's recoverable progress, captured before a Service-scope pause aborts it. */
  private captureServiceScopeCheckpoint(turnId: string): ServiceScopeContinuation['checkpoint'] {
    const visibleProgress = this.lastProviderStreamMessage;
    return {
      completedActions: visibleProgress ? [visibleProgress] : [],
      discoveries: (this.session.memos ?? []).map((memo) => memo.content),
      toolResults: this.readReportChain().map((report) => report.summary),
      changedFiles: this._fileChangeFacts.filter((fact) => fact.turnId === turnId),
      nextAction: 'Resume the interrupted request after applying the approved Service scope.',
    };
  }

  /** Settles a paused Turn's input once its Service-scope continuation is abandoned. */
  private async releaseHeldAdmission(held: HeldAdmission): Promise<void> {
    await this.persistInputSettlement(held.evidence);
    await held.admission.onSettled(held.evidence);
    this.projectedInputStartTurnIds.delete(held.admission.turnId);
    this.logger.info('local.run.input_admission.held_settlement_released', {
      runId: this.runId,
      admissionTurnId: held.admission.turnId,
      terminalOutcome: held.evidence.terminalOutcome,
    });
  }

  public async applyApprovedServiceScope(input: {
    services: ResolvedServiceBinding[];
    launchServiceId: string;
    workspace: ResolvedRunWorkspace;
  }): Promise<void> {
    const priorServices = this.session.services;
    const priorScope = this.session.scope;
    const priorWorktree = this.session.worktreeState;
    const expandedScope: LocalRunScope | null = priorScope
      ? {
          ...priorScope,
          allowedRepositoryRoots: Array.from(
            new Set([
              ...priorScope.allowedRepositoryRoots,
              ...input.services.map((service) => service.path),
            ]),
          ),
        }
      : null;
    await this.runStore.updateRunServices(this.runId, {
      services: input.services,
      launchServiceId: input.launchServiceId,
    });
    try {
      if (expandedScope) {
        await this.runStore.updateRunScope(this.runId, expandedScope);
      }
      if (input.workspace.worktree) {
        await this.runStore.updateRunWorktreeState(this.runId, input.workspace.worktree);
      }
    } catch (error) {
      if (expandedScope && priorScope) {
        await this.runStore.updateRunScope(this.runId, priorScope);
      }
      await this.runStore.updateRunServices(this.runId, {
        services: priorServices,
        launchServiceId: this.session.launchServiceId ?? input.launchServiceId,
      });
      await this.runStore.updateRunWorktreeState(this.runId, priorWorktree ?? {});
      throw error;
    }
    this.refreshSessionFields({
      services: input.services,
      launchServiceId: input.launchServiceId,
      ...(expandedScope ? { scope: expandedScope } : {}),
      ...(input.workspace.worktree ? { worktreeState: input.workspace.worktree } : {}),
    });
    // The boundary was built from the prior roots; the next Turn must rebuild
    // it from the approved workspace or resolution rejects the root mismatch.
    if (
      this.workspaceWriteBoundary &&
      !this.workspaceWriteBoundary.matchesWorkspace(input.workspace)
    ) {
      await this.resetWorkspaceWriteBoundaryForScopeChange();
    }
  }

  private async reconcileAdmittedServiceScope(
    admitted: UserMessageAdmittedServiceScope,
  ): Promise<void> {
    const currentServiceIds = this.session.services.map(({ id }) => id);
    const serviceIds = Array.from(new Set(admitted.serviceIds));
    const launchServiceId = this.session.launchServiceId ?? admitted.launchServiceId;
    if (
      !launchServiceId ||
      !serviceIds.includes(launchServiceId) ||
      currentServiceIds.some((id) => !serviceIds.includes(id)) ||
      (this.session.launchServiceId && this.session.launchServiceId !== admitted.launchServiceId)
    ) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'The admitted Service scope does not preserve the Run workspace.',
        409,
      );
    }
    if (
      this.session.launchServiceId === launchServiceId &&
      currentServiceIds.length === serviceIds.length &&
      currentServiceIds.every((id) => serviceIds.includes(id))
    )
      return;

    const bindings = await resolveServiceBindingsForIds({
      serviceIds,
      repoStore: this.repoStore,
      logger: this.logger,
    });
    if (!bindings.ok) {
      throw new LocalAgentApiError(bindings.code, bindings.message, 409);
    }
    const candidate: AgenticSession = {
      ...this.session,
      services: bindings.services,
      launchServiceId,
    };
    const workspace = await resolveRunWorkspace({
      session: candidate,
      repoStore: this.repoStore,
      logger: this.logger,
    });
    if (!workspace.ok) {
      throw new LocalAgentApiError(
        workspace.code === 'REPO_BINDING_MISSING' ? 'REPO_BINDING_MISSING' : 'INVALID_REQUEST',
        workspace.message,
        409,
      );
    }
    if (this.session.provider_session_agent_id) {
      await this.discardProviderSessionForScopeChange();
    } else if (this.workspaceWriteBoundary) {
      await this.resetWorkspaceWriteBoundaryForScopeChange();
    }
    await this.applyApprovedServiceScope({
      services: bindings.services,
      launchServiceId,
      workspace,
    });
  }

  public async discardProviderSessionForScopeChange(): Promise<void> {
    const agentId = this.currentAgentId();
    if (!agentId)
      throw new Error('Cannot rotate Service scope without an owning provider handler.');
    await this.discardProviderSessionForRotation({
      outgoingAgentId: this.session.provider_session_agent_id ?? null,
      incomingAgentId: agentId,
      reason: 'explicit-fresh',
    });
    await this.resetWorkspaceWriteBoundaryForScopeChange();
  }

  public getReviewFileScopeRequest(requestId: string):
    | {
        request: AgentSessionReviewFileScopeRequest;
        messageId: string;
        data: SystemMessageData | null;
      }
    | undefined {
    return this.reviewFileScopeCoordinator.getPresentation(this, requestId);
  }

  public hasReviewFileScopeRequestRecord(requestId: string): boolean {
    return this.reviewFileScopeCoordinator.hasRequest(this, requestId);
  }

  public isReviewFileScopeRequestSettled(requestId: string): boolean {
    return this.reviewFileScopeCoordinator.isSettled(this, requestId);
  }

  private hasPendingScopeReview(): boolean {
    return this.serviceScope.hasPendingServiceScopeRequest();
  }

  public submitReviewFileScopeDecision(
    input: ReviewFileScopeDecisionInput,
  ): Promise<
    import('../agents/review-file-scope-request/review-file-scope-coordinator').ReviewFileScopeDecisionResult
  > {
    return this.reviewFileScopeCoordinator.decide(this, input);
  }

  /**
   * The last assistant text block the provider stream emitted during the
   * active turn — what the user saw. See `_lastProviderStreamMessage`.
   */
  get lastProviderStreamMessage(): string | null {
    return this._lastProviderStreamMessage;
  }

  /**
   * Append a memo to the Run's accumulating, never-consumed inter-phase
   * context list. Patches `run.session.memos` in place (initialising it to an
   * empty array when absent) and fires `runStore.appendRunMemo` fire-and-forget
   * so the entry survives a CLI restart; persistence failures are logged but
   * do not interrupt the active flow. Mirrors `recordPreviousProviderSession`,
   * but the list is append-only — memos are never consumed/cleared.
   */
  appendMemo(memo: RunMemo): void {
    this.refreshSessionFields({ memos: [...(this.session.memos ?? []), memo] });
    // Per-append log line — the only observability into what a phase carried
    // forward into later phases.
    this.logger.info('local.run.append_memo', {
      runId: this.runId,
      source: memo.source,
      contentLength: memo.content.length,
    });
    void this.runStore.appendRunMemo(this.runId, memo).catch((error) => {
      this.logger.error('local.run.persist_memo_failed', {
        runId: this.runId,
        error,
      });
    });
  }

  /**
   * Persist the previous provider session's final output onto the session so
   * the next phase's prompt resolution can prepend it. Patches `run.session`
   * in place and fires `runStore.updateRunPreviousProviderSession`
   * fire-and-forget; persistence failures are logged but do not interrupt the
   * active flow.
   */
  recordPreviousProviderSession(previous: PreviousProviderSession): void {
    this.refreshSessionFields({ previousProviderSession: previous });
    void this.runStore.updateRunPreviousProviderSession(this.runId, previous).catch((error) => {
      this.logger.error('local.run.persist_previous_provider_session_failed', {
        runId: this.runId,
        error,
      });
    });
  }

  /**
   * Append a report entry to the Run's report chain. Entries are frozen on
   * append so callers can't mutate them after the fact. The chain is
   * append-only for the lifetime of the Run — there is no remove/clear API
   * and `cleanup()` deliberately leaves it intact.
   */
  appendReportChainEntry(entry: ReportChainEntry): void {
    if (!entry.createdAt) throw new Error('ReportChainEntry.createdAt is required');
    if (!entry.phase) throw new Error('ReportChainEntry.phase is required');
    if (!entry.reportId) throw new Error('ReportChainEntry.reportId is required');
    if (!entry.reportType) throw new Error('ReportChainEntry.reportType is required');
    if (typeof entry.summary !== 'string') {
      throw new Error('ReportChainEntry.summary is required');
    }
    if (entry.audience !== 'EXTERNAL' && entry.audience !== 'INTERNAL') {
      throw new Error('ReportChainEntry.audience must be EXTERNAL or INTERNAL');
    }
    const frozen = Object.freeze({
      createdAt: entry.createdAt,
      phase: entry.phase,
      reportId: entry.reportId,
      reportType: entry.reportType,
      summary: entry.summary,
      audience: entry.audience,
      ...(entry.serviceId ? { serviceId: entry.serviceId } : {}),
      ...(entry.touchPoints
        ? { touchPoints: Object.freeze(entry.touchPoints.map((tp) => Object.freeze({ ...tp }))) }
        : {}),
    }) satisfies Readonly<ReportChainEntry>;
    this._reportChain.push(frozen);
    this.logger.info('local.run.report_chain.entry_appended', {
      runId: this.runId,
      reportId: frozen.reportId,
      reportType: frozen.reportType,
      phase: frozen.phase,
      audience: frozen.audience,
      reportChainLength: this._reportChain.length,
    });
  }

  /**
   * Read the Run's report chain in insertion order. Returns a defensive
   * shallow copy so callers iterating an older snapshot do not see
   * subsequent appends. Each entry is frozen at append time.
   */
  readReportChain(): ReadonlyArray<Readonly<ReportChainEntry>> {
    return this._reportChain.slice();
  }

  readReportIdsForTurn(turnId: string): readonly string[] {
    const startIndex = this._reportChainStartByTurn.get(turnId);
    return startIndex === undefined
      ? []
      : this._reportChain.slice(startIndex).map(({ reportId }) => reportId);
  }

  /**
   * Settle and persist any automatic completion artifacts for a Turn before
   * its assistant-complete handler freezes the retry-stable artifact snapshot.
   *
   * The turn-end path calls this too, both for Turns without an assistant
   * completion and as a retry-safe fallback when the completion handler could
   * not publish its Message. An assistant-complete dispatch supplies its own
   * identity so this nested drain cannot wait on the handler that invoked it.
   * The report emitter is idempotent against the Turn's existing report-chain
   * slice, so the canonical Report identity is available to the same final
   * Message in either path.
   */
  async prepareTurnCompletionArtifacts(turn: Turn, activeDispatchId?: symbol): Promise<void> {
    await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS, activeDispatchId);
    try {
      await this._fileChangeMutation;
    } catch (error) {
      this.logger.error('local.run.turn_completion.file_change_settle_failed', {
        runId: this.runId,
        turnId: turn.turnId,
        error,
      });
    }

    const reportChainStartIndex = this._reportChainStartByTurn.get(turn.turnId);
    const reportsSinceTurnStart =
      reportChainStartIndex === undefined ? [] : this._reportChain.slice(reportChainStartIndex);
    const createReportTool = this.baseSubmissionTools.find(
      (tool): tool is PassThroughSubmissionToolDeclaration =>
        tool.name === 'create_report' && isPassThroughTool(tool),
    );

    try {
      await emitOpenImplementReportIfNeeded({
        run: this,
        logger: this.logger,
        promptType: turn.handler.promptType,
        fileChanges: this.getFileChangeProjection(turn.turnId),
        reportsSinceTurnStart,
        createReportTool: createReportTool ?? null,
      });
    } catch (error) {
      this.logger.error('local.run.open_implement_report.emit.failed', {
        runId: this.runId,
        turnId: turn.turnId,
        promptType: turn.handler.promptType,
        error,
      });
    }
  }

  /**
   * Read the previous provider session's output, clear it (in-memory +
   * persisted), and return the prior value. Called by the resolver after a
   * `provider_session` turn has consumed it so the same value is never threaded
   * forward twice.
   */
  async consumePreviousProviderSession(): Promise<PreviousProviderSession | null> {
    const prior = this.session.previousProviderSession ?? null;
    if (!prior) return null;
    this.refreshSessionFields({ previousProviderSession: null });
    try {
      await this.runStore.updateRunPreviousProviderSession(this.runId, null);
    } catch (error) {
      this.logger.error('local.run.persist_previous_provider_session_clear_failed', {
        runId: this.runId,
        error,
      });
    }
    return prior;
  }

  // ==================================================================
  // Event ingress — session runner → Run → dispatcher
  // ==================================================================

  /**
   * The callback given to the session runner at creation time. Provider
   * calls this for every event it emits; Run normalizes and dispatches.
   */
  readonly onAgentOutput = (message: AgentOutputMessage): void => {
    this.handleAgentOutput(message, { kind: 'run-provider-session' });
  };

  /** Accept output only from the active subagent Turn that owns the callback. */
  readonly onActiveTurnAgentOutput = (turnId: string, message: AgentOutputMessage): void => {
    this.handleAgentOutput(message, { kind: 'active-turn', turnId });
  };

  private resolveEventProducer(
    producer: EventProducer,
    incomingSessionId: string | null,
    isProviderNativeEvent: boolean,
  ): ResolvedEventProducer {
    if (producer.kind === 'run-provider-session') {
      const expectedProviderSessionId = this.session.provider_session_id ?? null;
      const accepted =
        !isProviderNativeEvent ||
        incomingSessionId === null ||
        incomingSessionId.startsWith('pending_') ||
        expectedProviderSessionId === null ||
        expectedProviderSessionId.startsWith('pending_') ||
        incomingSessionId === expectedProviderSessionId;
      return {
        accepted,
        expectedProviderSessionId,
        isEphemeral: false,
        rejectionReason: accepted ? null : 'provider-session-mismatch',
      };
    }

    const turn = this.activeTurn;
    if (
      turn === null ||
      turn.turnId !== producer.turnId ||
      turn.handler.runnerKind !== 'subagent'
    ) {
      return {
        accepted: false,
        expectedProviderSessionId: turn?.subagentProviderSessionId ?? null,
        isEphemeral: true,
        rejectionReason: 'stale-turn',
      };
    }

    const observesSubagentSession =
      isProviderNativeEvent &&
      incomingSessionId !== null &&
      !incomingSessionId.startsWith('pending_') &&
      turn.subagentProviderSessionId === null;
    if (observesSubagentSession) {
      turn.recordSubagentProviderSession(incomingSessionId);
      this.logger.debug('local.run.ephemeral_provider_session.observed', {
        runId: this.runId,
        turnId: producer.turnId,
        provider: this.provider,
        providerSessionId: incomingSessionId,
      });
    }

    const expectedProviderSessionId = turn.subagentProviderSessionId;
    const accepted =
      !isProviderNativeEvent ||
      incomingSessionId === null ||
      incomingSessionId.startsWith('pending_') ||
      incomingSessionId === expectedProviderSessionId;
    return {
      accepted,
      expectedProviderSessionId,
      isEphemeral: true,
      rejectionReason: accepted ? null : 'provider-session-mismatch',
      ...(observesSubagentSession ? { observedSubagentAgentId: turn.handler.id } : {}),
    };
  }

  private expectedFileChangeProviderSessionId(): string | null {
    const turn = this.activeTurn;
    return turn?.handler?.runnerKind === 'subagent'
      ? turn.subagentProviderSessionId
      : this.providerSessionId;
  }

  private handleAgentOutput(message: AgentOutputMessage, producer: EventProducer): void {
    if (this._abortController?.signal.aborted) {
      this.logger.debug('local.run.event_dropped_after_abort', {
        runId: this.runId,
        eventType: message.event.eventType,
      });
      return;
    }

    const event: LocalAgentOutputEvent = {
      runId: this.runId,
      ...message.event,
    };

    this.logger.trace('local.run.raw_event_received', {
      runId: this.runId,
      eventType: event.eventType,
      source: event.source,
      payload: event.payload,
    });

    // Promote the SDK-supplied provider session id onto `this.session` as soon
    // as a runner emits an event carrying a real id. Without this, the Run
    // keeps its `pending_<uuid>` seed (from `agent-session-starter.ts`) until
    // the new-session-runner's promise resolves *after the stream ends* —
    // meaning every mid-stream handler (assistant_complete in particular)
    // stamps `pending_<uuid>` onto the message it persists. The runners
    // already write `sessionId` on every raw event with the active provider
    // session id, so this central ingress is the right place to sync.
    const incomingSessionId = event.sessionId;
    const isProviderNativeEvent = event.payload['messageType'] === 'provider_event';
    const resolvedProducer = this.resolveEventProducer(
      producer,
      incomingSessionId,
      isProviderNativeEvent,
    );
    if (!resolvedProducer.accepted) {
      this.logger.debug('local.run.event_rejected_provider_session_mismatch', {
        runId: this.runId,
        turnId: this.activeTurn?.turnId ?? null,
        producerTurnId: producer.kind === 'active-turn' ? producer.turnId : null,
        producerKind: producer.kind,
        rejectionReason: resolvedProducer.rejectionReason,
        hasActiveTurn: this.activeTurn !== null,
        provider: this.provider,
        source: event.source,
        agentId: event.agentId,
        eventType: event.eventType,
        messageType: event.payload['messageType'],
        expectedProviderSessionId: resolvedProducer.expectedProviderSessionId,
        receivedProviderSessionId: incomingSessionId,
      });
      return;
    }
    const admittedTurn = this.activeTurn;
    const admittedTurnId = admittedTurn?.turnId;
    if (admittedTurn && admittedTurnId && this.operationTimeline?.has(admittedTurnId)) {
      this.operationTimeline.mark(admittedTurnId, 'firstProviderEvent');
      this.operationTimeline.emit(admittedTurnId, 'provider_output', {
        agentSessionId: this.session.agentic_session_id,
        runId: this.runId,
        turnId: admittedTurnId,
        promptType: admittedTurn.handler.promptType,
        provider: this.provider,
      });
    }
    if (
      !resolvedProducer.isEphemeral &&
      isProviderNativeEvent &&
      incomingSessionId &&
      !incomingSessionId.startsWith('pending_') &&
      incomingSessionId !== this.session.provider_session_id
    ) {
      this.refreshSessionFields({ provider_session_id: incomingSessionId });
    }

    if (this.provider === 'codex') {
      const routing = readProviderRouting(event);
      if (event.eventType === 'thread/started' && routing.threadId) {
        this._activeProviderThreadId = routing.threadId;
        this.logger.info('local.run.codex_thread.observed', {
          runId: this.runId,
          providerThreadId: routing.threadId,
        });
      }
      if (event.eventType === 'turn/started' && routing.turnId) {
        this._activeProviderTurnId = routing.turnId;
        this._completedProviderTurnIds.delete(routing.turnId);
        this.logger.info('local.run.codex_turn.observed', {
          runId: this.runId,
          providerTurnId: routing.turnId,
        });
      }
      if (event.eventType === 'turn/completed' && routing.turnId) {
        this._completedProviderTurnIds.add(routing.turnId);
        this.logger.debug('local.run.codex_turn.completed', {
          runId: this.runId,
          providerTurnId: routing.turnId,
        });
      }
    }

    // Author the provider ids onto the platform directly, once per Run, the
    // moment a real id surfaces. The CLI holds both ids here; writing them
    // upstream means other platform clients can render the Run without the
    // local bridge needing to round-trip them through a browser transport.
    if (
      !this.providerIdentityEmitted &&
      !resolvedProducer.isEphemeral &&
      isProviderNativeEvent &&
      incomingSessionId &&
      !incomingSessionId.startsWith('pending_')
    ) {
      const providerConversationId = readProviderConversationId(event);
      const providerSessionAgentId =
        this.session.provider_session_agent_id ?? this.activeTurn?.handler?.id ?? null;
      this.providerIdentityEmitted = true;
      const persistence = (
        providerSessionAgentId
          ? this.runStore.appendRunProviderSessionHistory(this.session.agentic_session_id, {
              providerSessionId: incomingSessionId,
              providerConversationId,
              providerSessionAgentId,
              observedAt: event.timestamp,
            })
          : Promise.reject(
              new Error('Cannot persist a real provider session without its owning handler id.'),
            )
      )
        .then((persisted) => {
          this.refreshSessionFields({
            provider_session_history: persisted.provider_session_history ?? [],
          });
          this.broadcaster.emitProviderIdentity({
            conversationId: this.conversationId,
            agentSessionId: this.session.agentic_session_id,
            providerSessionId: incomingSessionId,
            providerConversationId,
          });
        })
        .catch((error: Error) => {
          this.providerIdentityEmitted = false;
          this.logger.error('local.run.provider_session.history_persist_failed', {
            runId: this.runId,
            providerSessionId: incomingSessionId,
            providerSessionAgentId,
            error,
          });
        });
      const persistenceId = Symbol('provider-session-persistence');
      this._inFlightDispatch.set(persistenceId, persistence);
      void persistence.finally(() => {
        this._inFlightDispatch.delete(persistenceId);
      });
    }

    // A subagent session joins the history under its own handler so it can be
    // opened and costed, but never becomes the Run's resumable session or its
    // announced provider identity.
    if (resolvedProducer.observedSubagentAgentId && incomingSessionId) {
      this.appendSubagentProviderSessionHistory({
        providerSessionId: incomingSessionId,
        providerConversationId: readProviderConversationId(event),
        providerSessionAgentId: resolvedProducer.observedSubagentAgentId,
        observedAt: event.timestamp,
      });
    }

    this.broadcaster.publishAgentOutput(event, {
      run: this,
      turnId: admittedTurnId ?? null,
      subagentTurnId: producer.kind === 'active-turn' ? producer.turnId : null,
    });

    const normalized = normalizeEvent(event, this.provider);
    if (
      this.activeTurn?.changedFileReporting.isRepairing &&
      [
        'assistant_delta',
        'assistant_complete',
        'run_started',
        'run_completed',
        'processing_status',
        'conversation_phase',
      ].includes(normalized.kind)
    )
      return;

    // Capture the last assistant text block the stream emitted — what the user
    // saw — so the assistant_complete handler can record it as
    // `previousProviderSession.lastMessage`. Both event kinds carry the text on
    // `summary`; last writer wins, so after the stream this holds the final
    // block. Captured before dispatch so the value is present when the
    // assistant_complete handler (dispatched below) reads it.
    if (normalized.kind === 'assistant_delta' || normalized.kind === 'assistant_complete') {
      this._lastProviderStreamMessage = normalized.summary;
    }

    // Track the dispatch promise so turn-end can drain it. The
    // assistant_complete handler's narrative `createOutOfBand` is awaited
    // inside its dispatch, so registering the promise here makes that
    // detached write observable to `drainInFlightDispatch` before the
    // pending completion is flushed.
    const dispatchId = Symbol(normalized.kind);
    const dispatchPromise = Promise.resolve(this.dispatcher.dispatch(normalized, this, dispatchId));
    this._inFlightDispatch.set(dispatchId, dispatchPromise);
    void dispatchPromise.finally(() => {
      this._inFlightDispatch.delete(dispatchId);
    });

    this.observeCodexShellLifecycle(event, dispatchPromise);
  }

  private appendSubagentProviderSessionHistory(entry: ProviderSessionHistoryEntry): void {
    const persistence = this.runStore
      .appendRunProviderSessionHistory(this.session.agentic_session_id, entry)
      .then((persisted) => {
        this.refreshSessionFields({
          provider_session_history: persisted.provider_session_history ?? [],
        });
      })
      .catch((error: unknown) => {
        this.logger.error('local.run.subagent_provider_session.history_persist_failed', {
          runId: this.runId,
          providerSessionId: entry.providerSessionId,
          providerSessionAgentId: entry.providerSessionAgentId,
          error,
        });
      });
    const persistenceId = Symbol('subagent-provider-session-persistence');
    this._inFlightDispatch.set(persistenceId, persistence);
    void persistence.finally(() => {
      this._inFlightDispatch.delete(persistenceId);
    });
  }

  private observeCodexShellLifecycle(
    event: LocalAgentOutputEvent,
    dispatchPromise: Promise<void>,
  ): void {
    const observer = this.codexShellChangeObserver;
    if (!observer) return;
    const lifecycle = readCodexCommandLifecycle(event);
    if (!lifecycle) return;

    const routing = readProviderRouting(event);
    const providerSessionId = event.sessionId;
    const turnId = this.activeTurn?.turnId ?? null;
    const rejectionReason = !providerSessionId
      ? 'missing_provider_session'
      : !routing.threadId
        ? 'missing_provider_thread'
        : !routing.turnId
          ? 'missing_provider_turn'
          : !turnId
            ? 'missing_active_turn'
            : this._activeProviderThreadId !== routing.threadId
              ? 'provider_thread_mismatch'
              : this._activeProviderTurnId !== routing.turnId
                ? 'provider_turn_mismatch'
                : null;
    if (
      rejectionReason !== null ||
      !providerSessionId ||
      !routing.threadId ||
      !routing.turnId ||
      !turnId
    ) {
      this.logger.debug('local.run.codex_shell_observer.lifecycle_rejected', {
        runId: this.runId,
        turnId,
        eventType: event.eventType,
        commandItemId: lifecycle.commandItemId,
        providerSessionId,
        providerThreadId: routing.threadId,
        providerTurnId: routing.turnId,
        expectedProviderThreadId: this._activeProviderThreadId,
        expectedProviderTurnId: this._activeProviderTurnId,
        rejectionReason,
      });
      return;
    }

    const identity: CodexShellObservationIdentity = {
      providerSessionId,
      providerThreadId: routing.threadId,
      providerTurnId: routing.turnId,
      commandItemId: lifecycle.commandItemId,
    };
    const roots = this.session.services.map((service) => ({
      serviceId: service.id,
      root: service.path,
    }));
    const observation =
      lifecycle.phase === 'started'
        ? observer.commandStarted({ runId: this.runId, turnId, identity, roots })
        : dispatchPromise
            .then(
              () => undefined,
              () => undefined,
            )
            .then(() =>
              observer.commandCompleted({
                runId: this.runId,
                turnId,
                identity,
                outcome: lifecycle.outcome,
                canonical: this.getFileChangeProjection(),
              }),
            );
    const tracked = observation.catch((error) => {
      this.logger.error('local.run.codex_shell_observer.lifecycle_failed', {
        runId: this.runId,
        turnId,
        ...identity,
        phase: lifecycle.phase,
        error,
      });
    });
    const observationId = Symbol('codex-shell-observation');
    this._inFlightDispatch.set(observationId, tracked);
    void tracked.finally(() => this._inFlightDispatch.delete(observationId));
  }

  /**
   * Wait for all in-flight asynchronous work except `excludedDispatchId` to
   * settle. `timeoutMs` controls slow-drain telemetry only. Used at turn-end
   * (via the Turn's `onAfterRunner` hook) so a
   * trailing narrative write started during the stream lands before the
   * pending completion is flushed. Tracked promises remove themselves on
   * settle; a slow handler is reported without manufacturing turn settlement.
   */
  async drainInFlightDispatch(timeoutMs: number, excludedDispatchId?: symbol): Promise<void> {
    const pending = [...this._inFlightDispatch.entries()]
      .filter(([dispatchId]) => dispatchId !== excludedDispatchId)
      .map(([, promise]) => promise);
    if (pending.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    timer = setTimeout(() => {
      this.logger.warn('local.run.in_flight_dispatch.slow', {
        runId: this.runId,
        timeoutMs,
        pendingDispatchCount: [...this._inFlightDispatch.keys()].filter(
          (dispatchId) => dispatchId !== excludedDispatchId,
        ).length,
      });
    }, timeoutMs);
    try {
      await Promise.allSettled(pending);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Resolve the live workflow node for message fields that are authored by an
   * out-of-band CLI completion. A missing reader is limited to unconfigured
   * test or non-workflow runs; production wiring supplies the platform-backed
   * reader.
   */
  async readCurrentWorkflowNodeId(): Promise<string | null> {
    const reader = this.workflowDispatchVerdictReader;
    if (!reader) return null;
    return reader.readCurrentNodeId({
      organizationId: this.organizationId,
      projectId: this.projectId,
      conversationId: this.conversationId,
    });
  }

  hasRecordedCompletion(triggerMessageId: string): boolean {
    return this.recordedCompletionTriggers.has(triggerMessageId);
  }

  /** Record one terminal completion per trigger, including ERROR outcomes. */
  recordPendingCompletion(completion: PendingTurnCompletion): void {
    if (this.hasRecordedCompletion(completion.triggerMessageId)) {
      this.logger.warn('local.run.pending_completion.duplicate_refused', {
        runId: this.runId,
        triggerMessageId: completion.triggerMessageId,
        action: completion.action.action,
      });
      return;
    }
    this.recordedCompletionTriggers.add(completion.triggerMessageId);
    this._pendingCompletion = {
      ...completion,
      effectId: completion.effectId ?? randomUUID(),
    };
    this.logger.debug('local.run.pending_completion.recorded', {
      runId: this.runId,
      triggerMessageId: completion.triggerMessageId,
      action: completion.action.action,
    });
  }

  /**
   * Post the recorded completion as the turn's terminal conversation write.
   * Concurrent callers share one attempt, and the value is cleared only after
   * the platform acknowledges the matching effect. Failed attempts remain
   * available for reconnect recovery.
   */
  async flushPendingCompletion(): Promise<void> {
    if (this._pendingCompletionFlush) return this._pendingCompletionFlush;
    const pending = this._pendingCompletion;
    if (!pending?.effectId) return;
    const effectId = pending.effectId;
    const flush = (async (): Promise<void> => {
      try {
        const messageId = await this.submissionActionPoster.post({
          effectId,
          organizationId: this.organizationId,
          projectId: this.projectId,
          agentSessionId: this.agentSessionId,
          conversationId: this.conversationId,
          externalAgentNodeId: pending.externalAgentNodeId,
          triggerMessageId: pending.triggerMessageId,
          action: pending.action,
          ...(pending.userFacingResponse !== undefined
            ? { userFacingResponse: pending.userFacingResponse }
            : {}),
          ...(pending.hidden === true ? { hidden: true } : {}),
          stamp: pending.stamp,
        });
        this.logger.info('local.run.pending_completion.flushed', {
          runId: this.runId,
          action: pending.action.action,
          messageId,
          externalAgentNodeId: pending.externalAgentNodeId,
          triggerMessageId: pending.triggerMessageId,
          effectId,
        });
        if (this._pendingCompletion?.effectId === effectId) {
          this._pendingCompletion = null;
        }
      } catch (error) {
        this.logger.error('local.run.pending_completion.flush_failed', {
          runId: this.runId,
          agentSessionId: this.agentSessionId,
          conversationId: this.conversationId,
          workflowNodeId: pending.externalAgentNodeId,
          pendingTriggerMessageId: pending.triggerMessageId,
          action: pending.action.action,
          effectId,
          error,
        });
      }
    })();
    this._pendingCompletionFlush = flush;
    try {
      await flush;
    } finally {
      if (this._pendingCompletionFlush === flush) this._pendingCompletionFlush = null;
    }
  }

  // ==================================================================
  // Abort
  // ==================================================================

  createAbortController(): AbortController {
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    return this._abortController;
  }

  get abortSignal(): AbortSignal | undefined {
    return this._abortController?.signal;
  }

  get isAborted(): boolean {
    return this._abortController?.signal.aborted ?? false;
  }

  abort(): void {
    const isPreparingTurn =
      this.activeTurn === null && this._processing && this.activeTurnInput !== null;
    this._abortController?.abort();
    this.activeTurn?.abort();
    if (isPreparingTurn) this.settleTurnPreparation();
  }

  resetAbort(): void {
    this._abortController = null;
  }

  // ==================================================================
  // Message queue
  // ==================================================================

  /** Recover terminal evidence without invoking a provider again after process loss. */
  public async recoverInterruptedInput(turnId: string) {
    if (this._processing || this.activeTurn)
      throw new Error('Cannot recover an input while execution is active.');
    const prior = (await this.runStore.readDurableRunEvents(this.runId)).find(
      (event) => event.payload.kind === 'input_turn_settled' && event.payload.turnId === turnId,
    );
    if (prior?.payload.kind === 'input_turn_settled') return prior.payload;
    // No canonical completion committed before process loss. The interrupted execution is aborted,
    // while its input remains started and any separately committed artifacts retain their owners.
    const outcome = {
      turnId,
      terminalOutcome: 'ABORTED' as const,
      completedAssistantMessageId: null,
      reports: [],
      settledAt: new Date().toISOString(),
    };
    await this.persistInputSettlement(outcome);
    await this.serviceScope.detachRecoveredContinuation(turnId);
    return outcome;
  }

  private async persistInputSettlement(outcome: InputSettlementEvidence): Promise<void> {
    await this.runStore.appendDurableEvent(this.runId, {
      run_id: this.runId,
      actor: 'app',
      state_version: 0,
      event_type: 'post_processed',
      payload: { kind: 'input_turn_settled', ...outcome },
    });
  }

  private readonly inputAdmissionCallbacks = new Map<
    string,
    NonNullable<SendMessageOptions['admittedInput']>
  >();
  /**
   * Admissions whose actual start has been projected. A bootstrap research
   * Turn projects start before the main Turn runs; the owner rejects a second
   * started transition, so the main Turn must skip it. Entries are recorded
   * only after onStarted succeeds, so a failed projection is retried.
   */
  private readonly projectedInputStartTurnIds = new Set<string>();

  private async projectInputStarted(
    admission: NonNullable<SendMessageOptions['admittedInput']>,
    executingTurnId: string,
  ): Promise<void> {
    if (this.projectedInputStartTurnIds.has(admission.turnId)) {
      this.logger.debug('local.run.input_admission.start_already_projected', {
        runId: this.runId,
        admissionTurnId: admission.turnId,
        executingTurnId,
      });
      return;
    }
    await admission.onStarted();
    this.projectedInputStartTurnIds.add(admission.turnId);
    this.logger.info('local.run.input_admission.start_projected', {
      runId: this.runId,
      admissionTurnId: admission.turnId,
      executingTurnId,
      bootstrap: admission.turnId !== executingTurnId,
    });
  }

  private inputAdmissionFor(input: InternalRunPromptRequest) {
    return (
      readInputAdmission(input) ??
      (input.inputAdmissionTurnId
        ? this.inputAdmissionCallbacks.get(input.inputAdmissionTurnId)
        : undefined)
    );
  }

  get canAcceptDurableInput(): boolean {
    return (
      !this._processing &&
      this.activeTurn === null &&
      this.foregroundSubagentWaits.size === 0 &&
      !this.hasPendingScopeReview() &&
      this.queueLength === 0
    );
  }

  /** Offers the durable input queue its next pickup once this Run can take it. */
  private notifyIfDurableInputAcceptable(): void {
    if (this.canAcceptDurableInput) this.durableInputReady?.();
  }

  // Inputs to `isGenuinelyIdle()` raise the read-state signal when they change.
  private get _processing(): boolean {
    return this.processingValue;
  }

  private set _processing(value: boolean) {
    if (this.processingValue === value) return;
    this.processingValue = value;
    this.readStateChanged();
  }

  private get _pendingCompletion(): PendingTurnCompletion | null {
    return this.pendingCompletionValue;
  }

  private set _pendingCompletion(value: PendingTurnCompletion | null) {
    const changed = (this.pendingCompletionValue === null) !== (value === null);
    this.pendingCompletionValue = value;
    if (changed) this.readStateChanged();
  }

  private get _pendingCompletionFlush(): Promise<void> | null {
    return this.pendingCompletionFlushValue;
  }

  private set _pendingCompletionFlush(value: Promise<void> | null) {
    const changed = (this.pendingCompletionFlushValue === null) !== (value === null);
    this.pendingCompletionFlushValue = value;
    if (changed) this.readStateChanged();
  }

  get isProcessing(): boolean {
    return this._processing;
  }

  set isProcessing(value: boolean) {
    this._processing = value;
  }

  get queueLength(): number {
    return this._messageQueue.length;
  }

  enqueue(input: InternalRunPromptRequest): number {
    this._messageQueue.push(input);
    this.readStateChanged();
    return this._messageQueue.length;
  }

  dequeue(): InternalRunPromptRequest | undefined {
    const next = this._messageQueue.shift();
    if (next !== undefined) this.readStateChanged();
    return next;
  }

  peekQueue(): InternalRunPromptRequest | undefined {
    return this._messageQueue[0];
  }

  clearQueue(): void {
    if (this._messageQueue.length === 0) return;
    this._messageQueue.length = 0;
    this.readStateChanged();
  }

  public holdForSubagent(interactionId: string): void {
    this.foregroundSubagentWaits.add(interactionId);
    this.readStateChanged();
    this.clearInactivityTimer('foreground-subagent');
  }

  public releaseSubagentHold(interactionId: string): void {
    if (!this.foregroundSubagentWaits.delete(interactionId)) return;
    this.readStateChanged();
    if (this.foregroundSubagentWaits.size === 0 && !this._processing && this.activeTurn === null) {
      void this.drainQueue().catch((error: unknown) => {
        this.logger.error('local.run.subagent_queue_resume_failed', { runId: this.runId, error });
      });
    }
    this.notifyIfDurableInputAcceptable();
  }

  // ==================================================================
  // Active Turn pointer
  // ==================================================================

  setActiveTurn(turn: Turn | null): void {
    this.activeTurn = turn;
    this.readStateChanged();
  }

  // ==================================================================
  // Scheduling — the heart of Run
  // ==================================================================

  /**
   * Accept a concrete prompt request. Either enqueue it (Turn in flight)
   * or start a Turn now.
   *
   * `input.promptType` is expected to be a concrete, registered
   * `LocalPromptType` — the message-service edge has already resolved the
   * `workflow-defined` sentinel before reaching Run.
   *
   * `options.recentUserReplies` is in-process-only data forwarded by the
   * conversation dispatcher; it travels with the queued request via a
   * private symbol marker so coalescing/draining can stay agnostic.
   * `options.sourceUserMessageId` uses the same private-carrier pattern to
   * keep each canonical USER Message as its own queued Turn.
   */
  async handleMessage(
    input: InternalRunPromptRequest,
    options?: SendMessageOptions,
  ): Promise<void> {
    const modeInput = resolveProjectModeFollowup(this.session.config, input);
    if (modeInput !== input) {
      this.logger.debug('local.run.project_mode.followup_owner_retained', {
        runId: this.runId,
        requestedPromptType: input.promptType,
        resolvedPromptType: modeInput.promptType,
        providerSessionAgentId: this.session.provider_session_agent_id,
      });
      input = modeInput;
    }
    const timelineTurnId = options?.admittedInput?.turnId;
    if (timelineTurnId) {
      this.operationTimeline?.updateMetadata(timelineTurnId, {
        agentSessionId: this.session.agentic_session_id,
        runId: this.runId,
        turnId: timelineTurnId,
        promptType: input.promptType,
        provider: this.provider,
      });
    }
    // This must happen before the first await. It gives a newly arriving
    // message a synchronous race against the timeout callback: either work
    // cancels the timer on this registered Run, or the registry has already
    // evicted it and the message service materializes a replacement.
    this.clearInactivityTimer('new-work');
    this._inactivityReapingDisabled = false;
    const inactivityReapPromise = this._inactivityReapPromise;
    if (inactivityReapPromise) {
      // Keep this Run registered until release finishes. Work that arrives in
      // that window claims the same Run, waits for the disconnect, and then
      // resumes it instead of racing a replacement runner against teardown.
      this._inactivityReapInterrupted = true;
      this.logger.debug('local.run.idle_reap.interrupted_by_new_work', {
        runId: this.runId,
        provider: this.provider,
      });
      const waitStartedAt = performance.now();
      try {
        await inactivityReapPromise;
      } finally {
        if (timelineTurnId) {
          this.operationTimeline?.recordDuration(
            timelineTurnId,
            'idleReapWaitMs',
            performance.now() - waitStartedAt,
          );
        }
      }
    }

    // Gate the first prompt-render on the report-chain seed so the first
    // turn's provider-session and subagent prompts both observe seeded
    // entries. Subsequent turns hit a resolved promise and pay no extra
    // latency. A seed failure has already been logged inside the constructor
    // and resolves the promise normally, so the await never throws.
    if (this._seedPromise) {
      const waitStartedAt = performance.now();
      try {
        await this._seedPromise;
      } finally {
        if (timelineTurnId) {
          this.operationTimeline?.recordDuration(
            timelineTurnId,
            'seedWaitMs',
            performance.now() - waitStartedAt,
          );
        }
      }
    }

    if (options?.admittedInput) {
      this.inputAdmissionCallbacks.set(options.admittedInput.turnId, options.admittedInput);
      input = {
        ...input,
        inputAdmissionTurnId: options.admittedInput.turnId,
        [INPUT_ADMISSION_MARKER]: options.admittedInput,
      } as InternalRunPromptRequest;
    }
    const stamped = this.stampTriggerParentMessageId(
      this.stampSessionMessageBoundary(
        this.stampUserMessageBoundary(
          this.stampRecentUserReplies(input, options?.recentUserReplies),
          options,
        ),
        options?.admittedSessionMessage,
      ),
      options?.triggerParentMessageId,
    );
    const scoped = options?.admittedServiceScope
      ? ({
          ...stamped,
          [ADMITTED_SERVICE_SCOPE_MARKER]: options.admittedServiceScope,
        } as InternalRunPromptRequest)
      : stamped;
    if (this.hasPendingScopeReview()) {
      this.logger.warn('local.run.message_blocked_pending_scope_review', {
        runId: this.runId,
        promptType: stamped.promptType,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'The Run is awaiting a scope-review decision.',
        409,
      );
    }
    if (this._processing && options?.admittedServiceScope) {
      this.enqueue(scoped);
      return;
    }
    if (options?.admittedServiceScope) {
      await this.reconcileAdmittedServiceScope(options.admittedServiceScope);
    }
    const consumerHandler = this.promptTypeRegistry.get(stamped.promptType);
    const projectAssistantConfig = resolveProjectAssistantConfig(this.session.config);
    const projectAssistantPolicy = resolveProjectAssistantPolicy(
      consumerHandler?.resolveProjectAssistant
        ? consumerHandler.resolveProjectAssistant(this.session, this.logger)
        : consumerHandler?.projectAssistant,
      projectAssistantConfig,
    );
    if (projectAssistantConfig?.enabled === false) {
      this.logger.debug('local.run.project_assistant.disabled_by_session_config', {
        runId: this.runId,
        consumerPromptType: stamped.promptType,
      });
    }

    if (!this._projectAssistantDone && projectAssistantConfig?.enabled === false) {
      this.logger.info('local.run.project_assistant.disabled_marker_persist_started', {
        runId: this.runId,
        consumerPromptType: stamped.promptType,
      });
      try {
        await this.runStore.updateRunProjectAssistantDone(this.runId, true);
      } catch (error) {
        this.logger.error('local.run.persist_project_assistant_done_failed', {
          runId: this.runId,
          error,
        });
        throw error;
      }
      this._projectAssistantDone = true;
      this.refreshSessionFields({ projectAssistantDone: true });
    }

    if (this._processing || this.foregroundSubagentWaits.size > 0) {
      const position = this.enqueue(stamped);
      this.logger.debug('local.run.message_queued', {
        runId: this.runId,
        queuePosition: position,
        promptType: stamped.promptType,
        triggerMessageId: stamped.triggerContext?.triggerMessageId ?? null,
      });
      return;
    }

    // One-shot Project Assistant subagent: the consuming handler owns both
    // participation and the maximum capability policy. Carry the exact object
    // resolved above through tools and prompt construction.
    const focalEntity = this.entity;
    if (
      !this._projectAssistantDone &&
      focalEntity !== null &&
      consumerHandler !== undefined &&
      projectAssistantPolicy !== undefined
    ) {
      this.logger.info('local.run.project_assistant.bootstrap_started', {
        runId: this.runId,
        consumerPromptType: stamped.promptType,
        allowEdgeUpdates: projectAssistantPolicy.allowEdgeUpdates,
        notifyDiscrepancies: projectAssistantPolicy.notifyDiscrepancies,
        workItemProposalMode: projectAssistantPolicy.workItemProposalMode,
      });
      if (timelineTurnId) {
        this.operationTimeline?.updateMetadata(timelineTurnId, { projectAssistant: true });
        this.operationTimeline?.mark(timelineTurnId, 'bootstrapStarted');
      }
      this._projectAssistantDone = true;
      this.refreshSessionFields({ projectAssistantDone: true });
      await this.runStore.updateRunProjectAssistantDone(this.runId, true).catch((error) => {
        this.logger.error('local.run.persist_project_assistant_done_failed', {
          runId: this.runId,
          error,
        });
      });
      const preparedAdmission = this.inputAdmissionFor(stamped);
      const projectAssistantRequest = {
        promptType: LocalPromptType.ProjectAssistant,
        references: stamped.references,
        triggerContext: null,
        payload: this.buildProjectAssistantPayload(
          focalEntity,
          stamped,
          consumerHandler.id,
          projectAssistantPolicy,
        ),
        // Research is execution of the admitted input, so it projects the
        // input's start. It deliberately omits inputAdmissionTurnId: the main
        // Turn keeps the admission's Turn identity and owns settlement.
        ...(preparedAdmission ? { [BOOTSTRAP_INPUT_ADMISSION_MARKER]: preparedAdmission } : {}),
      } as InternalRunPromptRequest;
      this.enqueue(stamped);
      await this.startTurn(projectAssistantRequest);
      return;
    }

    await this.startTurn(stamped);
  }

  private stampRecentUserReplies(
    input: InternalRunPromptRequest,
    replies: ReadonlyArray<RecentUserReply> | undefined,
  ): InternalRunPromptRequest {
    if (!replies || replies.length === 0) return input;
    return { ...input, [RECENT_USER_REPLIES_MARKER]: replies } as InternalRunPromptRequest;
  }

  private stampSessionMessageBoundary(
    input: InternalRunPromptRequest,
    boundary: SendMessageOptions['admittedSessionMessage'],
  ): InternalRunPromptRequest {
    return boundary
      ? ({ ...input, [SESSION_MESSAGE_BOUNDARY_MARKER]: boundary } as InternalRunPromptRequest)
      : input;
  }

  private stampUserMessageBoundary(
    input: InternalRunPromptRequest,
    options:
      | {
          sourceUserMessageId?: string;
          onTurnStarted?: (turnId: string) => void;
          onTurnSettled?: (outcome: {
            turnId: string;
            terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
            completedAssistantMessageId: string | null;
          }) => void;
        }
      | undefined,
  ): InternalRunPromptRequest {
    if (options?.sourceUserMessageId === undefined) return input;
    return {
      ...input,
      [USER_MESSAGE_BOUNDARY_MARKER]: {
        sourceUserMessageId: options.sourceUserMessageId,
        ...(options.onTurnStarted ? { onTurnStarted: options.onTurnStarted } : {}),
        ...(options.onTurnSettled ? { onTurnSettled: options.onTurnSettled } : {}),
      },
    } as InternalRunPromptRequest;
  }

  private stampTriggerParentMessageId(
    input: InternalRunPromptRequest,
    triggerParentMessageId: string | null | undefined,
  ): InternalRunPromptRequest {
    if (triggerParentMessageId === undefined) return input;
    return {
      ...input,
      [TRIGGER_PARENT_MESSAGE_ID_MARKER]: triggerParentMessageId,
    } as InternalRunPromptRequest;
  }

  /** Build the Project Assistant payload from the persisted Run identity. The
   * provider startup path supplies the canonical focal entity projection. */
  private buildProjectAssistantPayload(
    focalEntity: RunEntityReference,
    stamped: InternalRunPromptRequest,
    consumerHandlerId: string,
    policy: NonNullable<PromptTypeHandler<unknown>['projectAssistant']>,
  ): ProjectAssistantPromptPayload {
    const userMessage = resolvePromptText(stamped) ?? '';
    this.logger.debug('local.run.project_assistant_payload.task_context_resolved', {
      runId: this.runId,
      entityId: focalEntity.entityId,
      runEntityType: focalEntity.entityType,
    });
    return {
      promptType: LocalPromptType.Research,
      entity: focalEntity,
      userMessage,
      projectAssistantHandoff: {
        consumerHandlerId,
        policy,
      },
    };
  }

  /**
   * Run a Turn from scratch: resolve all inputs, construct the Turn,
   * kick off begin/run. Throws synchronously on invalid input; ordinary
   * resolution failures drain queued work, while authoritative startup-input
   * failures surface one conversation error, clear queued work, and return
   * the Run to idle without retrying the failed boundary.
   */
  private async startTurn(input: InternalRunPromptRequest): Promise<void> {
    input = this.routeImplementationReadinessClarification(input);
    const admission = this.inputAdmissionFor(input);
    const timelineTurnId = admission?.turnId;
    if (timelineTurnId) {
      this.operationTimeline?.updateMetadata(timelineTurnId, {
        agentSessionId: this.session.agentic_session_id,
        runId: this.runId,
        turnId: timelineTurnId,
        promptType: input.promptType,
        provider: this.provider,
      });
      if (this.operationTimeline?.hasMark(timelineTurnId, 'bootstrapStarted')) {
        this.operationTimeline.mark(timelineTurnId, 'bootstrapEnded');
      }
    }
    if (input.inputAdmissionTurnId && !this.inputAdmissionFor(input))
      throw new Error('Durable input must be rebound to its admission owner before execution.');
    this.clearInactivityTimer('turn-start');
    this._processing = true;
    this.activeTurnInput = input;
    if (this._activeSince === null) {
      this._activeSince = new Date().toISOString();
      this.readStateChanged();
    }
    this._lastProviderStreamMessage = null;
    const preparationAbortController = this.createAbortController();

    const turnId =
      this.inputAdmissionFor(input)?.turnId ??
      readSessionMessageBoundary(input)?.turnId ??
      randomUUID();

    this.observeProviderPhase('starting');
    if (timelineTurnId) {
      this.operationTimeline?.mark(timelineTurnId, 'startingEmitted');
    }

    let ctx: RunnerContext;
    let platformMcpProxy: TurnPlatformMcpProxy | null;
    let browserAnnotationIds: readonly string[];
    let browserTabNoticeId: string | null;
    let proposalNotices: ProposalDecisionNotices;
    try {
      ({ ctx, platformMcpProxy, browserAnnotationIds, browserTabNoticeId, proposalNotices } =
        await this.resolveTurnInputs(input, turnId));
      if (preparationAbortController.signal.aborted) {
        void this.drainQueue();
        return;
      }
      if (timelineTurnId) this.operationTimeline?.mark(timelineTurnId, 'turnInputsResolved');
      if (!this.entityContextResolved) {
        this.entityContextResolved = true;
        this.readStateChanged();
      }
    } catch (error) {
      if (error instanceof AgentStartupPromptInputError && !this.entityContextLoadFailed) {
        this.entityContextLoadFailed = true;
        this.readStateChanged();
      }
      if (this.activeTurnInput !== null || this._processing) this.settleTurnPreparation();
      const admission = this.inputAdmissionFor(input);
      const failedHandler = this.promptTypeRegistry.get(input.promptType);
      if (failedHandler?.onStartupFailure) {
        await failedHandler.onStartupFailure(
          input.payload,
          {
            session: this.session,
            deps: this.handlerDeps,
          },
          error instanceof Error ? error.message : 'The session could not start.',
        );
        if (admission) {
          await admission.onRejected();
          this.projectedInputStartTurnIds.delete(admission.turnId);
        }
        this.logger.error('local.run.start_turn.failure_reported', {
          turnId,
          runId: this.runId,
          promptType: input.promptType,
          error,
        });
        void this.drainQueue();
        return;
      }
      const definitiveRejection =
        error instanceof RunAttachmentNotFoundError ||
        (error instanceof LocalAgentApiError && error.statusCode === 400);
      if (definitiveRejection && admission) {
        await admission.onRejected();
        this.projectedInputStartTurnIds.delete(admission.turnId);
      }
      this.logger.error('local.run.start_turn.resolve_failed', {
        turnId,
        runId: this.runId,
        error,
      });
      // Startup context errors can wrap transient API failures. Let the durable
      // owner retry preparation with the same input and selected Turn identity.
      if (admission && !definitiveRejection) throw error;
      // Project Assistant preparation failure is terminal for the admitted input it
      // prepares. Draining would run the queued main Turn without the assistant.
      if (error instanceof ProjectAssistantPreparationError) {
        this._processing = true;
        const preparedAdmission = readBootstrapInputAdmission(input);
        if (preparedAdmission) {
          await preparedAdmission.onRejected();
          this.projectedInputStartTurnIds.delete(preparedAdmission.turnId);
        }
        try {
          await this.postAgentSystemMessage(
            `I could not start this session because Project Assistant could not be prepared: ${error.message}`,
          );
        } catch (postError) {
          this.logger.error('local.run.start_turn.project_assistant_failure_post_failed', {
            turnId,
            runId: this.runId,
            error: postError,
          });
        }
        const queuedCount = this.queueLength;
        this.clearQueue();
        this.logger.info('local.run.start_turn.project_assistant_failure_queue_cleared', {
          turnId,
          runId: this.runId,
          queuedCount,
        });
        this._processing = false;
        this.armInactivityTimerIfIdle();
        this.notifyIfDurableInputAcceptable();
        return;
      }
      if (error instanceof AgentStartupPromptInputError) {
        this._processing = true;
        this.logger.error('local.run.start_turn.startup_input_failed', {
          turnId,
          runId: this.runId,
          boundary: error.boundary,
        });
        try {
          await this.postAgentSystemMessage(
            'I could not start this session because its current entity context could not be prepared. Please try again.',
          );
        } catch (postError) {
          this.logger.error('local.run.start_turn.startup_failure_post_failed', {
            turnId,
            runId: this.runId,
            boundary: error.boundary,
            error: postError,
          });
        }
        const queuedCount = this.queueLength;
        this.clearQueue();
        this.logger.info('local.run.start_turn.startup_failure_queue_cleared', {
          turnId,
          runId: this.runId,
          queuedCount,
        });
        this._processing = false;
        this.armInactivityTimerIfIdle();
        this.notifyIfDurableInputAcceptable();
        return;
      }
      void this.drainQueue();
      throw error;
    }

    let turn: Turn;
    try {
      const runner = this.runnerPicker.pick(ctx);
      if (timelineTurnId) {
        this.operationTimeline?.updateMetadata(timelineTurnId, {
          ...(runner instanceof NewSessionRunner ? { providerRunner: 'new' as const } : {}),
          ...(runner instanceof ResumeRunner ? { providerRunner: 'resume' as const } : {}),
        });
      }

      if (!this._startedPromptTypes.has(ctx.handler.promptType)) {
        await this.runStore.recordRunStartedPromptType(this.runId, ctx.handler.promptType);
        this._startedPromptTypes.add(ctx.handler.promptType);
      }
      this.openOrTransitionHandlerSpan(ctx.handler.promptType);

      turn = new Turn({
        turnId,
        runId: this.runId,
        resolvedPrompt: ctx.resolvedPrompt,
        attachments: ctx.input.attachments ?? [],
        handler: ctx.handler,
        effectiveRole: resolveHandlerSessionRole(ctx.handler, this.session),
        payload: ctx.preparedPayload ?? input.payload,
        externalAgentNodeId: this.triggerContext?.externalAgentNodeId ?? null,
        triggerMessageId: this.triggerContext?.triggerMessageId ?? null,
        runner,
        platformMcpProxy,
        abortController: this._abortController ?? new AbortController(),
        effectiveModel: ctx.effectiveModel,
        effectiveReasoningEffort: ctx.effectiveReasoningEffort,
        logger: this.logger,
        owner: this,
      });

      this.setActiveTurn(turn);
      DeterministicE2EEvidence.current()?.record('turn_created', {
        runId: this.runId,
        turnId,
      });
      readUserMessageBoundary(input)?.onTurnStarted?.(turnId);
      this._reportChainStartByTurn.set(turnId, this._reportChain.length);
      await turn.begin();
      // Cleared only once the Turn carrying them has begun, so a failed start keeps them.
      if (browserAnnotationIds.length > 0) {
        this.browserAnnotations?.delivered(this.runId, browserAnnotationIds);
      }
      if (browserTabNoticeId) this.browserTabNotices?.delivered(this.runId, browserTabNoticeId);
      this.proposalTracker.delivered(proposalNotices);
      const startedAdmission = this.inputAdmissionFor(input) ?? readBootstrapInputAdmission(input);
      if (startedAdmission) await this.projectInputStarted(startedAdmission, turnId);
      await this.persistSessionPromptType(input.promptType);
      if (input.promptType === LocalPromptType.CodeReview) {
        this.observeConversationPhase('reviewing');
      }
    } catch (error) {
      this._reportChainStartByTurn.delete(turnId);
      this.settleTurnPreparation(this.activeTurn !== null);
      this.logger.error('local.run.start_turn.begin_failed', {
        turnId,
        runId: this.runId,
        error,
      });
      void this.drainQueue();
      throw error;
    }

    const PHASE_HEARTBEAT_INTERVAL_MS = 10_000;
    this._phaseHeartbeatTimer = setInterval(() => {
      if (this.activeTurn !== null && this.agentSessionCurrentState.currentProviderPhase !== null) {
        this.agentSessionCurrentState.replay();
        this.conversationPhase.replay();
      }
    }, PHASE_HEARTBEAT_INTERVAL_MS);

    const runPromise = turn.run();
    this._currentTurnPromise = runPromise;
    runPromise
      .catch(() => {
        // Errors inside turn.run() are already handled and logged there;
        // swallow the rejection on this tracking promise so unhandled-promise
        // alarms stay quiet. `awaitIdle` observes the underlying promise
        // directly.
      })
      .finally(() => {
        if (this._currentTurnPromise === runPromise) {
          this._currentTurnPromise = null;
        }
      });
  }

  /** Settle a selected input that failed before provider execution began. */
  private settleTurnPreparation(clearActiveTurn = false): void {
    if (clearActiveTurn) this.setActiveTurn(null);
    this.activeTurnInput = null;
    this.agentSessionCurrentState.settleTurn(this.serviceScope.isWaitingForApproval());
    this.conversationPhase.settleTurn(this.serviceScope.isWaitingForApproval());
    this._processing = false;
    this.resetAbort();
  }

  /**
   * Resolve when the Run has no in-flight Turn and no queued Turns waiting
   * to drain. Follows the captured `turn.run()` promise — which only
   * resolves after `onTurnEnded`'s `drainQueue` completes — so if the
   * Turn's `onEnd` started a successor, the loop re-awaits the new
   * `_currentTurnPromise`. Returns immediately when the Run is already
   * idle. Used by `createRun` to block the HTTP response until the
   * dispatched first Turn has streamed to completion (canonical
   * `provider_session_id`, first assistant message persisted).
   */
  async awaitIdle(): Promise<void> {
    while (this._currentTurnPromise) {
      const current = this._currentTurnPromise;
      try {
        await current;
      } catch {
        // turn.run() never throws by contract — but guard so awaitIdle's
        // own loop cannot reject on an unexpected upstream change.
      }
    }
  }

  /**
   * Open a handler span on the first turn of a handler, or finalize the
   * prior span and open a new one when the prompt-type changes between
   * turns. Called from `startTurn` before Turn construction so the span's
   * `chainStartIndex` reflects the chain length at the moment this handler
   * began running.
   */
  private openOrTransitionHandlerSpan(promptType: string): void {
    const current = this._currentHandlerSpan;
    if (current?.promptType === promptType) {
      return;
    }
    const priorPromptType = current?.promptType ?? null;
    if (current) {
      this.finalizeHandlerSpan('handler-swap');
    }
    this._currentHandlerSpan = {
      promptType,
      chainStartIndex: this._reportChain.length,
      madeChanges: false,
    };
    this.logger.info('local.run.handler_span.opened', {
      runId: this.runId,
      priorPromptType,
      nextPromptType: promptType,
      transition: priorPromptType !== null,
    });
  }

  /**
   * Evaluate the active span's declared report contract and emit a warn
   * log on a miss. Called on handler swap (before opening the next span)
   * and on `cleanup()` / `stop()` (run end). The warn is observability
   * only — it never blocks the turn or the user-visible message. Per-turn
   * enforcement was tried first and produced false positives on
   * conversational handlers that defer reports to a terminal turn.
   */
  private finalizeHandlerSpan(reason: 'handler-swap' | 'run-end'): void {
    const span = this._currentHandlerSpan;
    if (!span) {
      return;
    }
    this._currentHandlerSpan = null;

    const handler = this.promptTypeRegistry.get(span.promptType);
    if (!handler) {
      return;
    }

    const spanReports = this._reportChain.slice(span.chainStartIndex);
    const miss = evaluateDeclaredReports(handler, spanReports, span.madeChanges);
    if (!miss) return;

    this.logger.warn('runtime.handler_span.report_contract_missed', {
      runId: this.runId,
      promptType: span.promptType,
      reason,
      mode: miss.mode,
      missingReportTypes: miss.missingReportTypes,
      spanReportCount: spanReports.length,
      madeChanges: span.madeChanges,
    });
  }

  /** Append reporting evidence to its owning Turn without restoring readiness on a later Turn. */
  async persistChangedFileReporting(turn: Turn): Promise<void> {
    const evidence = turn.changedFileReporting.snapshot();
    await this.runStore.appendDurableEvent(this.runId, {
      run_id: this.runId,
      actor: 'app',
      state_version: 0,
      event_type: 'post_processed',
      payload: {
        kind: 'changed_file_reporting',
        ...evidence,
        retainedResponse: evidence.retainedResponse?.summary ?? null,
      },
    });
  }

  /**
   * Gives the agent bounded chances to correct a rejected final answer in the
   * same provider session. Each reply re-enters `handleAssistantComplete`
   * validation; only exhaustion re-dispatches the last rejection so the
   * handler publishes exactly one failure for the trigger.
   */
  async completeCompletionCorrection(turn: Turn): Promise<void> {
    await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS);
    const correction = turn.completionCorrection;
    if (!correction.hasPendingRejection) return;
    let prompt =
      this.activeTurn === turn && !turn.abortSignal.aborted ? correction.beginCorrection() : null;
    while (prompt !== null) {
      try {
        if (!turn.runner.continueTurn) break;
        await turn.runner.continueTurn(prompt, turn.abortSignal, { reportingRepair: false });
        await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS);
      } catch (error) {
        this.logger.warn('local.run.completion_correction.attempt_failed', {
          runId: this.runId,
          turnId: turn.turnId,
          attempt: correction.attemptCount,
          error,
        });
      } finally {
        correction.endCorrection();
      }
      if (turn.abortSignal.aborted || this.activeTurn !== turn) return;
      prompt = correction.beginCorrection();
    }
    const event = correction.exhaust();
    if (!event) return;
    this.logger.warn('local.run.completion_correction.exhausted', {
      runId: this.runId,
      turnId: turn.turnId,
      attempts: correction.attemptCount,
    });
    await this.dispatcher.dispatch(event, this, Symbol('exhausted_completion'));
  }

  async completeChangedFileReporting(turn: Turn): Promise<void> {
    await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS);
    await this._fileChangeMutation.catch(() => undefined);
    await turn.changedFileReporting.settleReports();
    if (
      !turn.handler.requiresChangedFileReporting ||
      this.activeTurn !== turn ||
      turn.abortSignal.aborted ||
      !turn.changedFileReporting.snapshot().retainedResponse
    )
      return;
    // Omitted submissions release the retained response without repair or validated evidence.
    let prompt = turn.changedFileReporting.beginRepair();
    while (prompt !== null) {
      try {
        await this.persistChangedFileReporting(turn);
        turn.platformMcpProxy?.setReportingRepair(true);
        if (!turn.runner.continueTurn) break;
        await turn.runner.continueTurn(
          prompt,
          AbortSignal.any([turn.abortSignal, AbortSignal.timeout(30_000)]),
          { reportingRepair: true },
        );
        await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS);
      } catch {
        this.logger.warn('local.run.changed_file_reporting.repair_failed', {
          runId: this.runId,
          turnId: turn.turnId,
        });
      } finally {
        turn.platformMcpProxy?.setReportingRepair(false);
        turn.changedFileReporting.endRepair();
      }
      if (turn.abortSignal.aborted || this.activeTurn !== turn) return;
      prompt = turn.changedFileReporting.beginRepair();
    }
    if (turn.abortSignal.aborted) return;
    const event = turn.changedFileReporting.release();
    try {
      await this.persistChangedFileReporting(turn);
    } catch {
      this.logger.warn('local.run.changed_file_reporting.evidence_write_failed', {
        runId: this.runId,
        turnId: turn.turnId,
      });
    }
    if (event) await this.dispatcher.dispatch(event, this, Symbol('retained_completion'));
  }

  async onTurnRunnerCompleted(turn: Turn): Promise<void> {
    await this.drainInFlightDispatch(IN_FLIGHT_DISPATCH_DRAIN_TIMEOUT_MS);

    if (turn.completionPublicationFailed) {
      this.logger.error('local.run.turn_completion.publication_failed', {
        runId: this.runId,
        turnId: turn.turnId,
        promptType: turn.handler.promptType,
        terminalOutcome: turn.terminalOutcome,
        completedAssistantMessageId: turn.completedAssistantMessageId,
      });
      try {
        await this.postAgentSystemMessage(
          'I generated a response, but could not publish it. This Turn was marked as failed; please try again.',
        );
      } catch (error) {
        this.logger.error('local.run.turn_completion.failure_message_failed', {
          runId: this.runId,
          turnId: turn.turnId,
          error,
        });
      }
    }

    const completedAssistantMessageId = turn.completedAssistantMessageId;
    const readyEligible =
      turn.terminalOutcome === 'COMPLETED' && completedAssistantMessageId !== null;

    if (!readyEligible) {
      this.logger.debug('local.run.output_attention.not_ready', {
        runId: this.runId,
        turnId: turn.turnId,
        terminalOutcome: turn.terminalOutcome,
        completedAssistantMessageId,
      });
      return;
    }

    try {
      await setAgentSessionOutputAttentionReady(
        {
          organizationId: this.organizationId,
          projectId: this.projectId,
          agentSessionId: this.agentSessionId,
        },
        this.handlerDeps,
      );
    } catch (error) {
      this.logger.error('local.run.output_attention.failed', {
        runId: this.runId,
        turnId: turn.turnId,
        messageId: completedAssistantMessageId,
        error,
      });
    }
  }

  async onTurnRunnerFailed(turn: Turn, error: unknown): Promise<void> {
    const runnerFailureAction = turn.handler.getRunnerFailureAction?.(error, turn.payload) ?? null;
    if (runnerFailureAction) {
      const externalAgentNodeId = turn.externalAgentNodeId;
      const triggerMessageId = turn.triggerMessageId;
      if (!externalAgentNodeId || !triggerMessageId) {
        this.logger.warn('local.run.turn.runner_failure_completion_skipped_no_trigger', {
          runId: this.runId,
          turnId: turn.turnId,
          promptType: turn.handler.promptType,
          action: runnerFailureAction.action.action,
        });
      } else {
        this.recordPendingCompletion({
          action: runnerFailureAction.action,
          externalAgentNodeId,
          triggerMessageId,
          userFacingResponse: runnerFailureAction.userFacingResponse ?? '',
          ...(runnerFailureAction.hidden === true ? { hidden: true } : {}),
          stamp: {
            providerSessionId: this.providerSessionId,
            promptHandler: turn.handler.promptType,
          },
        });
        this.logger.info('local.run.turn.runner_failure_completion_recorded', {
          runId: this.runId,
          turnId: turn.turnId,
          promptType: turn.handler.promptType,
          action: runnerFailureAction.action.action,
        });
      }
    }

    if (
      this.provider !== 'codex' ||
      !(error instanceof AgentSessionRunnerError) ||
      error.code !== 'MODEL_CAPACITY'
    ) {
      return;
    }

    this.logger.error('local.run.turn.codex_model_capacity', {
      runId: this.runId,
      turnId: turn.turnId,
      promptType: turn.handler.promptType,
      provider: this.provider,
      error,
    });
    await this.postAgentSystemMessage(CAPACITY_RETRY_MESSAGE);
  }

  async onTurnEnded(turn: Turn): Promise<void> {
    if (
      this.operationTimeline?.has(turn.turnId) &&
      !this.operationTimeline.hasMark(turn.turnId, 'firstProviderEvent')
    ) {
      this.operationTimeline.emit(turn.turnId, 'no_provider_output', {
        agentSessionId: this.session.agentic_session_id,
        runId: this.runId,
        turnId: turn.turnId,
        promptType: this.activeTurnInput?.promptType ?? turn.handler.promptType,
        provider: this.provider,
      });
    }
    try {
      this.setLastSubmissionAction(null);
      const filesTouchedThisTurnSet = this._filesTouchedByTurn.get(turn.turnId);
      const filesTouchedThisTurn = filesTouchedThisTurnSet?.size ?? 0;
      const submittedThisTurn = this._submittedTurnIds.has(turn.turnId);
      await this.prepareTurnCompletionArtifacts(turn);
      const reportChainStartIndex = this._reportChainStartByTurn.get(turn.turnId);
      const finalizedReports =
        reportChainStartIndex === undefined ? [] : this._reportChain.slice(reportChainStartIndex);
      if (this.taskMonitorManagedTurnRuntime) {
        await this.taskMonitorManagedTurnRuntime.publishSettledTurn({
          agentSessionId: this.session.agentic_session_id,
          turnId: turn.turnId,
          promptType: turn.handler.promptType,
          terminalOutcome: turn.terminalOutcome,
          completedAssistantMessageId: turn.completedAssistantMessageId,
          reports: finalizedReports.map(({ reportId, reportType }) => ({ reportId, reportType })),
          settledAt: new Date().toISOString(),
        });
      }
      const settledAdmission =
        (this.activeTurnInput && this.inputAdmissionFor(this.activeTurnInput)) ?? null;
      const evidence: InputSettlementEvidence = {
        turnId: turn.turnId,
        terminalOutcome: turn.terminalOutcome,
        completedAssistantMessageId: turn.completedAssistantMessageId,
        reports: finalizedReports.map(({ reportId }) => reportId),
        settledAt: new Date().toISOString(),
      };
      const inputSettlement = this.serviceScope.settleTurnInput(
        turn.turnId,
        settledAdmission,
        evidence,
      );
      if (settledAdmission) {
        if (inputSettlement === 'handed-to-continuation') {
          this.logger.info('local.run.input_admission.settlement_handed_to_continuation', {
            runId: this.runId,
            admissionTurnId: settledAdmission.turnId,
          });
        } else if (inputSettlement === 'held') {
          this.logger.info('local.run.input_admission.settlement_held_for_service_scope', {
            runId: this.runId,
            admissionTurnId: settledAdmission.turnId,
            terminalOutcome: turn.terminalOutcome,
          });
        } else {
          await this.persistInputSettlement(evidence);
          await settledAdmission.onSettled(evidence);
          this.projectedInputStartTurnIds.delete(settledAdmission.turnId);
        }
      }
      if (this.activeTurnInput)
        readUserMessageBoundary(this.activeTurnInput)?.onTurnSettled?.({
          turnId: turn.turnId,
          terminalOutcome: turn.terminalOutcome,
          completedAssistantMessageId: turn.completedAssistantMessageId,
        });
      if (this.activeTurnInput) {
        await readSessionMessageBoundary(this.activeTurnInput)?.onTurnSettled({
          turnId: turn.turnId,
          terminalOutcome: turn.terminalOutcome,
          completedAssistantMessageId: turn.completedAssistantMessageId,
        });
      }
      if (
        this._currentHandlerSpan?.promptType === turn.handler.promptType &&
        (filesTouchedThisTurn > 0 || submittedThisTurn)
      ) {
        this._currentHandlerSpan.madeChanges = true;
      }
      this._filesTouchedByTurn.delete(turn.turnId);
      if (this._stagedFileChanges.size > 0) {
        this.logger.warn('local.run.file_change.stage.cleared_at_turn_end', {
          runId: this.runId,
          turnId: turn.turnId,
          stagedCount: this._stagedFileChanges.size,
        });
        this._stagedFileChanges.clear();
      }
      this._submittedTurnIds.delete(turn.turnId);
      this._codingPlanElementsByTurn.delete(turn.turnId);
      this._reportChainStartByTurn.delete(turn.turnId);
      // Seal the Turn's coalesced narration row: dropping the slot means the
      // next Turn's first segment authors a fresh row instead of updating this
      // one. Reached on normal end, abort, and crash — Turn.run() always funnels
      // through end() → onEnd → here.
      this._narrationByTurn.delete(turn.turnId);
      if (this.activeTurn === turn) {
        await this.codexShellChangeObserver?.clearTurn(this.runId, turn.turnId);
        this.setActiveTurn(null);
        this.activeTurnInput = null;
      }
    } catch (error) {
      this.logger.error('local.run.turn_end.clear_failed', { runId: this.runId, error });
    }

    // A handler that declares a per-Turn provider-session lifetime mints a
    // fresh SDK session every Turn. Discard the just-ended Turn's session
    // here so the next Turn's `resolveTurnInputs` sees `!hasProviderSession`
    // and the picker selects `NewSessionRunner` — no SDK transcript carries
    // from one Turn into the next. Run-lifetime handlers (the default) are
    // untouched and keep resuming their single session.
    if (turn.handler.providerSessionLifetime === 'turn') {
      const { discardedProviderSessionId } = await this.discardProviderSession(
        'per-turn-lifetime-discard',
      );
      // The Run-level discard above is the load-bearing step: it clears
      // hasProviderSession so the picker selects NewSessionRunner next Turn.
      // This second step resets the runner's *client-side* SDK session so its
      // own runPrompt mints fresh instead of reconnecting the just-discarded
      // one. The provider-select layer binds `this.runner` the moment a Turn's
      // runPrompt/resumeSession fires, so by Turn end it is always set in
      // production — only the picker-only test harness leaves it null. A
      // per-Turn-lifetime handler runs only on a provider-session runner,
      // which implements discardSession; a *bound* runner missing it means the
      // SDK client would silently reconnect the stale session, so surface that
      // loudly rather than no-op past it.
      const runner = this.runner;
      if (runner && !runner.discardSession) {
        this.logger.error('local.run.turn_end.discard_session_unsupported', {
          runId: this.runId,
          promptType: turn.handler.promptType,
          provider: this.provider,
        });
      } else if (runner?.discardSession) {
        // Must be awaited — `drainQueue()` below starts the next queued Turn
        // immediately, and that Turn calls `client.query()` on the same
        // singleton SDK client. `client.disconnect()` clears the in-memory
        // sessionId synchronously but the underlying close is async; a
        // fire-and-forget here lets the next Turn race the disconnect and
        // throw `Session already active. Call disconnect() first.` Mirrors
        // the handler-swap discard at `discardProviderSessionForSwap`.
        try {
          await runner.discardSession();
        } catch (error) {
          this.logger.warn('local.run.turn_end.discard_session_failed', {
            runId: this.runId,
            error,
          });
        }
      }
      this.logger.info('local.run.provider_session.discarded_per_turn', {
        runId: this.runId,
        promptType: turn.handler.promptType,
        discardedProviderSessionId,
      });
    }

    clearInterval(this._phaseHeartbeatTimer);
    this._phaseHeartbeatTimer = undefined;
    this.agentSessionCurrentState.settleTurn(this.serviceScope.isWaitingForApproval());
    this.conversationPhase.settleTurn(this.serviceScope.isWaitingForApproval());

    this._processing = false;
    this.resetAbort();

    // Flush the turn's EXTERNAL_AGENT completion as its terminal write only
    // after the user-facing final Message commits. A rejected final Message
    // must not advance the workflow as though delivery succeeded. The
    // post-runner drain has already let any trailing narrative write settle,
    // so a valid advancing completion lands last — before the next queued
    // turn starts in `drainQueue`.
    if (turn.completionPublicationFailed) {
      const pending = this._pendingCompletion;
      this._pendingCompletion = null;
      if (pending) {
        this.logger.warn('local.run.pending_completion.discarded_after_publication_failure', {
          runId: this.runId,
          turnId: turn.turnId,
          action: pending.action.action,
          triggerMessageId: pending.triggerMessageId,
        });
      }
    } else {
      await this.flushPendingCompletion();
    }

    await this.compaction.afterTurnEnd();

    await this.drainQueue();
    this.armInactivityTimerIfIdle();
  }

  private isGenuinelyIdle(): boolean {
    return (
      this.activeTurn === null &&
      this._messageQueue.length === 0 &&
      this.foregroundSubagentWaits.size === 0 &&
      !this._processing &&
      !this.hasPendingScopeReview() &&
      this._pendingCompletion === null &&
      this._pendingCompletionFlush === null
    );
  }

  private armInactivityTimerIfIdle(): void {
    const reaper = this.idleRunReaper;
    if (!reaper || this._inactivityReapingDisabled || !this.isGenuinelyIdle()) return;

    this.clearInactivityTimer('rearm');
    this._inactivityReapInterrupted = false;
    const timer = setTimeout(() => {
      if (this._inactivityTimer !== timer) return;
      this._inactivityTimer = null;
      const reapPromise = this.reapIdleProviderSession();
      this._inactivityReapPromise = reapPromise;
      void reapPromise
        .finally(() => {
          if (this._inactivityReapPromise === reapPromise) {
            this._inactivityReapPromise = null;
          }
        })
        .catch((error: unknown) => {
          this.logger.error('local.run.idle_reap.unexpected_failure', {
            runId: this.runId,
            provider: this.provider,
            error,
          });
        });
    }, reaper.inactivityTimeoutMs);
    timer.unref();
    this._inactivityTimer = timer;
    this.logger.debug('local.run.idle_reap.armed', {
      runId: this.runId,
      provider: this.provider,
      inactivityTimeoutMs: reaper.inactivityTimeoutMs,
      hasProviderSession: this.hasProviderSession,
    });
  }

  private clearInactivityTimer(reason: string): void {
    if (!this._inactivityTimer) return;
    clearTimeout(this._inactivityTimer);
    this._inactivityTimer = null;
    this.logger.debug('local.run.idle_reap.timer_cleared', {
      runId: this.runId,
      reason,
    });
  }

  private async reapIdleProviderSession(): Promise<void> {
    const reaper = this.idleRunReaper;
    if (!reaper) return;

    if (!this.isGenuinelyIdle()) {
      this.logger.debug('local.run.idle_reap.skipped_not_idle', {
        runId: this.runId,
        provider: this.provider,
        hasActiveTurn: this.activeTurn !== null,
        queueLength: this._messageQueue.length,
        isProcessing: this._processing,
      });
      return;
    }

    const runner = this.runner;
    if (runner && !runner.discardSession) {
      this.logger.error('local.run.idle_reap.discard_session_unsupported', {
        runId: this.runId,
        provider: this.provider,
        hasProviderSession: this.hasProviderSession,
      });
      return;
    }

    const persistedProviderSessionId = this.session.provider_session_id ?? null;
    this.logger.info('local.run.idle_reap.started', {
      runId: this.runId,
      provider: this.provider,
      persistedProviderSessionId,
      hasBoundRunner: runner !== null,
    });

    try {
      await runner?.discardSession?.();
    } catch (error) {
      this.logger.error('local.run.idle_reap.discard_session_failed', {
        runId: this.runId,
        provider: this.provider,
        persistedProviderSessionId,
        error,
      });
      if (!this._inactivityReapInterrupted && this.isGenuinelyIdle()) {
        this.armInactivityTimerIfIdle();
      }
      return;
    }

    if (this._inactivityReapInterrupted || !this.isGenuinelyIdle()) {
      this.logger.info('local.run.idle_reap.eviction_cancelled_for_new_work', {
        runId: this.runId,
        provider: this.provider,
        persistedProviderSessionId,
      });
      return;
    }

    if (!reaper.claimAndEvict(this)) {
      this.logger.debug('local.run.idle_reap.skipped_not_registered', {
        runId: this.runId,
        provider: this.provider,
      });
      return;
    }

    this.logger.info('local.run.idle_reap.completed', {
      runId: this.runId,
      provider: this.provider,
      persistedProviderSessionId,
    });
    this.cleanup();
    this.logger.debug('local.run.idle_reap.cleanup_completed', {
      runId: this.runId,
      provider: this.provider,
    });
  }

  /** Re-emit the current state to the platform on reconnect, if a Turn is active. */
  emitCurrentStateIfActive(): void {
    if (this.activeTurn !== null && this.agentSessionCurrentState.currentProviderPhase !== null) {
      this.agentSessionCurrentState.replay();
    }
    if (this.activeTurn !== null && this.conversationPhase.currentPhase !== null) {
      this.conversationPhase.replay();
    }
    void this.flushPendingCompletion();
  }

  /**
   * Pop the next queued message (or a coalesced run of same-promptType
   * messages) and start the resulting Turn. No-op on an empty queue.
   *
   * Each dequeued request that carries a resolved trigger pair is
   * re-validated against the platform's current workflow verdict before it
   * can construct a Turn: a queued request can sit behind an in-flight turn
   * long enough for the workflow to consume, rotate, or finish the trigger
   * it was stamped with — the window that produced the incident's duplicate
   * READY completion. A stale request is dropped with a structured log, then
   * draining continues with the next item, so the lifecycle invariant holds
   * as "queued messages run or are dropped with a log". Requests without a
   * trigger pair (plain conversational messages) are never validated and
   * never dropped.
   */
  private async drainQueue(): Promise<void> {
    if (this.foregroundSubagentWaits.size > 0) {
      this._processing = false;
      return;
    }
    if (this.hasPendingScopeReview()) {
      this._processing = false;
      this.logger.info('local.run.queue_paused_pending_scope_review', {
        runId: this.runId,
        queueDepth: this.queueLength,
      });
      return;
    }
    while (true) {
      const head = this.dequeue();
      if (!head) {
        this._processing = false;
        this.notifyIfDurableInputAcceptable();
        return;
      }

      const headKey = head.promptType ?? null;
      const batch: InternalRunPromptRequest[] = [head];
      while (true) {
        const peeked = this.peekQueue();
        if (!peeked) break;
        if (head.inputAdmissionTurnId || peeked.inputAdmissionTurnId) break;
        if (readUserMessageBoundary(head) !== undefined) break;
        if (readUserMessageBoundary(peeked) !== undefined) break;
        if (readSessionMessageBoundary(head) !== undefined) break;
        if (readSessionMessageBoundary(peeked) !== undefined) break;
        if ((peeked.promptType ?? null) !== headKey) break;
        batch.push(this.dequeue()!);
      }

      if (batch.length === 1) {
        this.logger.debug('local.run.drain.single', {
          runId: this.runId,
          remainingQueue: this.queueLength,
          sourceUserMessageId: readUserMessageBoundary(batch[0]!)?.sourceUserMessageId ?? null,
        });
        try {
          const admitted = readAdmittedServiceScope(batch[0]!);
          if (admitted) await this.reconcileAdmittedServiceScope(admitted);
          await this.startTurn(batch[0]!);
        } catch (error) {
          this.logger.error('local.run.drain.failed', { runId: this.runId, error });
          this.clearQueue();
          try {
            await this.postAgentSystemMessage(
              'I could not start your queued message. Please try sending it again.',
            );
          } catch (postError) {
            this.logger.error('local.run.drain.failure_post_failed', {
              runId: this.runId,
              error: postError,
            });
          }
          this._processing = false;
          this.armInactivityTimerIfIdle();
          this.notifyIfDurableInputAcceptable();
        }
        return;
      }

      this.logger.debug('local.run.drain.coalesced', {
        runId: this.runId,
        count: batch.length,
        promptType: headKey,
        remainingQueue: this.queueLength,
      });
      await this.runCoalescedBatch(batch);
      return;
    }
  }

  /**
   * Collapse a run of same-promptType queued messages into a single Turn.
   * Joins each item's text (after handler transformInput) into one combined
   * provider prompt and synthesizes a request carrying it plus the coalesced
   * marker. USER conversation rows are platform-authored — every queued item
   * arrived from a signed trigger whose USER row the platform has already
   * written — so this path does not post any USER messages itself.
   *
   * All items share a concrete promptType (enforced by the caller), so the
   * head's handler is the transform handler. If no usable text survives
   * transformation, the run is returned to idle without starting a Turn.
   *
   * Every member has already passed drain-time trigger-freshness validation
   * in `drainQueue` — stale members were dropped before this call, so the
   * batch reaching here is the fresh remainder.
   */
  private async runCoalescedBatch(batch: InternalRunPromptRequest[]): Promise<void> {
    const head = batch[0]!;
    const transformHandler = this.promptTypeRegistry.get(head.promptType);
    const resolvedTexts: string[] = [];

    for (const item of batch) {
      const raw = resolvePromptText(item);
      if (!raw) continue;

      const transformed = transformHandler?.transformInput?.(raw);
      resolvedTexts.push(transformed ?? raw);
    }

    if (resolvedTexts.length === 0) {
      // No textual content survived: every batched item is payload-only (e.g.
      // duplicate create_run startup payloads where `userMessage` is `""` and
      // the real prompt is derived from the persisted Run entity). The
      // text-stripping synthesis below would drop the payload entirely and
      // start a turn with an empty prompt — silently losing the work. Run the
      // head as a single turn with its payload intact so the handler's own
      // buildPrompt produces the real first-turn prompt; discard the tail (it
      // is a same-payload duplicate of head by construction).
      this.logger.info('local.run.drain.coalesced.no_text_falling_back_to_single', {
        runId: this.runId,
        promptType: head.promptType,
        droppedDuplicateCount: batch.length - 1,
      });
      try {
        await this.startTurn(head);
      } catch (error) {
        this.logger.error('local.run.drain.coalesced_begin_failed', { runId: this.runId, error });
      }
      return;
    }

    const { payload: _droppedPayload, ...headRest } = head;
    void _droppedPayload;
    const synthesized: CoalescedBatchRequest = {
      ...headRest,
      payload: {
        promptType: head.promptType,
        userMessage: resolvedTexts.join('\n\n'),
      } as LocalAnyPromptPayload,
      references: head.references ?? { resolved: [], unresolved: [] },
      [COALESCED_BATCH_MARKER]: true,
    };

    try {
      await this.startTurn(synthesized);
    } catch (error) {
      this.logger.error('local.run.drain.coalesced_begin_failed', { runId: this.runId, error });
    }
  }

  // ==================================================================
  // Turn input resolution — the body that used to live in message.service's
  // `prepare()` closure. Runs inside Run because these are Run operations:
  // state stamping, reference validation, prompt resolution against the
  // Run-held session, message posting, handler lookup, submission-tool
  // registration.
  // ==================================================================

  private async resolveTurnInputs(
    input: InternalRunPromptRequest,
    turnId: string,
  ): Promise<{
    ctx: RunnerContext;
    platformMcpProxy: TurnPlatformMcpProxy | null;
    browserAnnotationIds: readonly string[];
    browserTabNoticeId: string | null;
    proposalNotices: ProposalDecisionNotices;
  }> {
    await this.attachmentContentReader.validate(this.runId, input.attachments ?? [], this.logger);
    let session = this.session;
    let preparedApprovedPlanWorkspaceChanged = false;
    let preparedImplementWorkspaceReconciled = false;
    const isFirstTurn = !this.hasProviderSession;

    if (isFirstTurn) {
      await validateResolvedPromptReferences({
        run: session,
        references: input.references,
        repoStore: this.repoStore,
      });
    }

    // Handler is non-null by construction: every registered promptType
    // has a handler, and the message-service edge has
    // already rejected unregistered promptTypes with a 400. If the lookup
    // fails here, the edge's guarantee was violated — throw with a clear
    // error rather than carrying a null handler onto the Turn. Resolved
    // before posting the anchor so the handler's promptType can be stamped
    // on the anchor's AgentSystemMessageData.
    const handler = this.promptTypeRegistry.get(input.promptType);
    if (!handler) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `No PromptHandler registered for promptType="${input.promptType}".`,
        400,
      );
    }

    const runtimeSession = await this.implementRuntimeOwner.apply(session, input);
    let providerSwitched = false;
    if (runtimeSession !== session) {
      this.refreshSessionFields(runtimeSession);
      session = this.session;
      providerSwitched = this.switchProvider(session.provider as Run['provider']);
    }

    const providerSessionDecisionPreview =
      handler.runnerKind === 'provider_session' &&
      typeof handler.id === 'string' &&
      handler.id.trim().length > 0
        ? classifyProviderSessionDecision({
            hasProviderSession: this.hasProviderSession,
            outgoingAgentId: this.session.provider_session_agent_id ?? null,
            incomingAgentId: handler.id,
            providerSessionStart: handler.providerSessionStart ?? 'inherit',
            ...(handler.providerSessionLifetime
              ? { providerSessionLifetime: handler.providerSessionLifetime }
              : {}),
            providerSwitched,
          })
        : undefined;
    const readinessGatedInput = this.isImplementationReadinessGatedInput(input);
    const readinessClarification = readImplementationReadinessClarification(input);
    const rawInputReadiness = readinessGatedInput
      ? readImplementationReadinessFromPayload(input.payload)
      : null;
    const inputReadiness = rawInputReadiness
      ? parseImplementationReadinessDisposition(rawInputReadiness)
      : null;
    const persistedReadiness = readinessGatedInput
      ? this.implementationReadinessOwner.read(session)
      : null;
    const readinessForPersistence =
      persistedReadiness && allowsImplementation(persistedReadiness) ? null : inputReadiness;
    const hasReadinessDisposition = readinessForPersistence !== null || persistedReadiness !== null;
    if (readinessForPersistence) {
      const sessionContextWithReadiness = {
        ...(session.sessionContext ?? {}),
        ...this.implementationReadinessOwner.toSessionContext(readinessForPersistence),
      };
      await this.runStore.updateRunSessionContext(
        session.agentic_session_id,
        sessionContextWithReadiness,
      );
      this.refreshSessionFields({ sessionContext: sessionContextWithReadiness });
      session = this.session;
    }
    const refreshStartupPromptInput =
      handler.runnerKind === 'subagent' ||
      // Feature Sync and a routed free-form readiness clarification are
      // source-checking turns. A clarification, structural retry, or
      // stale-gate re-entry must load the current
      // authoritative projection before the readiness tool stamps its source
      // revision; reusing the prior provider-session context could otherwise
      // repeat a stale finding forever.
      input.promptType === LocalPromptType.FeatureSyncAnalyze ||
      readinessClarification !== undefined ||
      (providerSessionDecisionPreview !== undefined &&
        providerSessionDecisionPreview !== 'resume') ||
      (hasReadinessDisposition && readinessGatedInput);
    this.logger.debug('local.run.provider_session.refresh_decision', {
      runId: this.runId,
      promptType: handler.promptType,
      runnerKind: handler.runnerKind,
      providerSessionDecision: providerSessionDecisionPreview ?? null,
      refreshStartupPromptInput,
      cachedTemplateKey: this.startupPromptTemplate?.templateKey ?? null,
      cachedTemplateRevisionId: this.startupPromptTemplate?.provenance.revisionId ?? null,
      cachedRenderedEntity: this.startupPromptInputResult !== null,
    });

    if (input.promptType === LocalPromptType.PlanExecution) {
      if (!isPlanExecutionPromptPayload(input.payload)) {
        throw new LocalAgentApiError(
          'INVALID_REQUEST',
          'plan_execution requires an approved plan payload with requiredServiceIds.',
          400,
        );
      }
      await this.reconcileApprovedPlanServiceScope(
        Array.from(input.payload.plan.requiredServiceIds),
        'plan_execution',
      );
      session = this.session;
    }

    // Resolve and persist the Run-owned worktree before handler preparation.
    // Prompt handlers project this state into their enriched payloads, so
    // resolving only after resolvePrompt would leave a new Run's first prompt
    // pointing at the host checkout even though its provider launches in the
    // worktree.
    const workspaceStartedAt = performance.now();
    const projectModeBundleDirectory = await this.resolveProjectModeBundleDirectory(session);
    const repositorySnapshotDirectory = handler.repositorySnapshots
      ? await this.resolveRepositorySnapshotDirectory()
      : null;
    let turnWorkspace = await this.resolveTurnWorkspace(session, input.promptType, isFirstTurn, [
      ...(projectModeBundleDirectory ? [projectModeBundleDirectory] : []),
      ...(repositorySnapshotDirectory ? [repositorySnapshotDirectory] : []),
    ]);
    session = this.session;
    const admission = this.inputAdmissionFor(input);
    if (admission) {
      this.operationTimeline?.recordDuration(
        admission.turnId,
        'workspaceMs',
        performance.now() - workspaceStartedAt,
      );
    }

    // Snapshot the report chain once so the resolver (provider-session
    // prepend) and the runner ctx (subagent prepend, applied inside the
    // spawn helper) observe the same ordered set. Reading twice would risk
    // an interleaved append landing in one branch but not the other.
    //
    // Handlers whose canonical runtime state is their sole authority can
    // opt out before the chain is read, preventing reports from becoming
    // either prompt context or an implicit execution dependency.
    // Filter to the four agent-facing types produced by coding agents; non-coding
    // reports (GOAL_PROGRESS, SESSION_SUMMARY, etc.) carry no implementation
    // context that coding-agent prompts need, and CODING_RESEARCH is excluded
    // here because its Frame is injected via the memo mechanism — the
    // `create_coding_research` tool appends it directly — instead.
    const priorReports =
      handler.subagentConfig?.includePriorReports === false
        ? []
        : this.readReportChain().filter(
            (entry) =>
              CODING_AGENT_REPORT_TYPES.has(entry.reportType) &&
              entry.reportType !== 'CODING_RESEARCH',
          );

    const resolvePromptStartedAt = performance.now();
    const resolvedPromptData = await resolvePrompt({
      handler,
      run: session,
      runState: {
        currentPromptType: session.promptType ?? null,
        isFirstTurn,
        previousProviderSession: session.previousProviderSession ?? null,
        reportChain: priorReports,
        memos: session.memos ?? [],
        startupPromptInput: this.startupPromptInputResult,
        startupPromptTemplate: this.startupPromptTemplate,
        cachedProviderSessionStartupSegments: this.providerSessionStartupSegments,
        startedPromptTypes: new Set(this._startedPromptTypes),
      },
      input,
      handlerDeps: bindPromptOnce(this.handlerDeps, {
        handler,
        session,
        input,
        abortSignal: () => this.abortSignal,
        runner: () => this.runnerPicker.runnerFor(this),
        observeProviderPhase: (phase) => this.observeProviderPhase(phase),
      }),
      turnId,
      abortSignal: () => this.abortSignal,
      recentUserReplies: readRecentUserReplies(input),
      triggerParentMessageId: readTriggerParentMessageId(input),
      ...(readinessClarification
        ? { implementationReadinessClarification: readinessClarification }
        : {}),
      ...(projectModeBundleDirectory ? { projectModeBundleDirectory } : {}),
      ...(repositorySnapshotDirectory ? { repositorySnapshotDirectory } : {}),
      ...(providerSessionDecisionPreview
        ? { providerSessionDecision: providerSessionDecisionPreview }
        : {}),
      refreshStartupPromptInput,
      onPreparedPayload: async ({
        handler: preparedHandler,
        payload,
        requestStartupPromptInputRefresh,
      }) => {
        const reconciled = await this.reconcilePreparedPromptServiceScope(preparedHandler, payload);
        preparedApprovedPlanWorkspaceChanged ||= reconciled.workspaceBoundaryChanged;
        preparedImplementWorkspaceReconciled =
          preparedHandler.promptType === LocalPromptType.Implement;
        if (reconciled.workspaceBoundaryChanged) {
          requestStartupPromptInputRefresh();
        }
        session = this.session;
        return reconciled.payload;
      },
      ...(readinessGatedInput
        ? {
            onStartupPromptInputResolved: async (resolvedStartupPromptInput) =>
              this.enforceImplementationReadinessAdmission(input),
          }
        : {}),
    });
    if (admission) {
      this.operationTimeline?.recordDuration(
        admission.turnId,
        'resolvePromptMs',
        performance.now() - resolvePromptStartedAt,
      );
    }
    const {
      resolvedPrompt,
      sessionContext,
      preparedPayload,
      isSubagentOwned,
      consumedPreviousProviderSession,
      startupPromptInput,
      providerSessionStartupSegments,
    } = resolvedPromptData;

    if (startupPromptInput) {
      this.startupPromptInputResult = startupPromptInput;
      this.entityContextLoadFailed = false;
      if (startupPromptInput.template) {
        this.startupPromptTemplate = startupPromptInput.template;
      }
      this.readStateChanged();
    }
    if (providerSessionStartupSegments) {
      this.providerSessionStartupSegments = {
        promptType: handler.promptType,
        stableInstructions: providerSessionStartupSegments.stableInstructions,
      };
    }

    if (consumedPreviousProviderSession) {
      await this.consumePreviousProviderSession();
    }

    if (!isSubagentOwned && !resolvedPrompt && isFirstTurn) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Cannot resolve prompt for promptType="${input.promptType}".`,
        400,
      );
    }

    const sessionContextWithReadiness =
      sessionContext || readinessForPersistence
        ? {
            ...(session.sessionContext ?? {}),
            ...(sessionContext ?? {}),
            ...(readinessForPersistence
              ? this.implementationReadinessOwner.toSessionContext(readinessForPersistence)
              : {}),
          }
        : undefined;
    if (sessionContextWithReadiness) {
      await this.runStore.updateRunSessionContext(
        session.agentic_session_id,
        sessionContextWithReadiness,
      );
      this.refreshSessionFields({ sessionContext: sessionContextWithReadiness });
      session = this.session;
    }

    // resolveWireWorkflowDefined stamps an explicit value on every
    // workflow-defined turn: the fetched pair on agent-pending, null on
    // live-non-agent or terminal (no node to answer). setTriggerContext
    // is a no-op when the value is unchanged, so user-reply turns that
    // re-resolve to the same agent-pending node do not spuriously
    // invalidate the existing pair. `stop()` resets the pair on shutdown.
    this.logger.info('local.run.resolve_turn_inputs.trigger_context', {
      runId: this.runId,
      promptType: input.promptType,
      inputTriggerContext: input.triggerContext ?? null,
      stampedTriggerContext: this.triggerContext,
      willClear: input.triggerContext === null,
    });
    if (input.triggerContext !== undefined) {
      this.setTriggerContext(input.triggerContext);
    }

    this.logTurnOpenSource({
      input,
      promptHandler: handler.promptType,
    });

    this.logger.info('local.run.scheduler.resolved', {
      turnId,
      runId: this.runId,
      promptType: input.promptType,
      handlerPromptType: handler.promptType,
      triggerContext: input.triggerContext ?? null,
      isSubagentOwned,
    });

    this.registerSubmissionTools(handler, turnId, input.awaitingUserReview === true);
    const dynamicAdditionalAllowedTools = handler.resolveAdditionalAllowedTools?.({
      session,
      input,
      payload: preparedPayload ?? input.payload,
    });
    const browserMcpMount = await this.browserMcpAccess?.mount(this.runId, this.projectId, turnId);
    const platformMcpAdditionalAllowedTools = Array.from(
      new Set([
        ...(handler.additionalAllowedTools ?? []),
        ...(dynamicAdditionalAllowedTools ?? []),
      ]),
    );
    const platformMcpCatalog = new ActivePlatformToolCatalog({
      ...(handler.mcpToolUseCase ? { useCase: handler.mcpToolUseCase } : {}),
      additionalTools: platformMcpAdditionalAllowedTools,
    });
    const platformMcpProxy = new TurnPlatformMcpProxy({
      runId: this.runId,
      turnId,
      context: buildRunMcpSessionContext(session),
      catalog: platformMcpCatalog,
      activeHandlerPromptType: handler.promptType,
      logger: this.logger,
    });
    this.logger.debug('local.run.platform_mcp_proxy_registered', {
      turnId,
      runId: this.runId,
      agenticSessionId: session.agentic_session_id,
      promptType: handler.promptType,
      toolCount: platformMcpCatalog.shortNames.length,
      tools: platformMcpCatalog.shortNames,
    });

    const providerExecution = handler.resolveProviderExecution?.(preparedPayload ?? input.payload);

    // Handler.id is the stable identity of the logical agent that owns the
    // Run's provider transcript. Resume only when persisted ownership matches
    // the incoming handler. A different id rotates exactly once; promptType
    // remains routing and diagnostic metadata. Legacy unowned sessions rotate
    // safely rather than being ambiguously adopted by the incoming handler.
    let providerSessionMintReason: 'first-turn' | 'agent-transition' | undefined;
    let providerSessionDecision: ProviderSessionDecision | undefined;
    if (handler.runnerKind === 'provider_session') {
      if (typeof handler.id !== 'string' || !handler.id.trim()) {
        throw new Error(
          `Provider-session handler "${handler.promptType}" must declare a non-empty id.`,
        );
      }
      await this.finishPendingProviderSessionRotationClientDiscard();
      const incomingAgentId = handler.id;
      const hadProviderSession = this.hasProviderSession;
      const outgoingAgentId = this.session.provider_session_agent_id ?? null;
      const sessionPersistedPromptType = this.session.promptType ?? null;
      const providerSessionStart = handler.providerSessionStart ?? 'inherit';
      const hasUnownedProviderSession = hadProviderSession && !outgoingAgentId;
      const isAgentTransition =
        hadProviderSession && outgoingAgentId !== null && outgoingAgentId !== incomingAgentId;
      const requiresExplicitFresh =
        hadProviderSession &&
        (providerSessionStart === 'fresh' ||
          preparedApprovedPlanWorkspaceChanged ||
          providerSwitched);
      if (hasUnownedProviderSession || isAgentTransition || requiresExplicitFresh) {
        const rotationReason = hasUnownedProviderSession
          ? 'unowned-session'
          : isAgentTransition
            ? 'agent-transition'
            : 'explicit-fresh';
        await this.discardProviderSessionForRotation({
          outgoingAgentId,
          incomingAgentId,
          reason: rotationReason,
        });
        providerSessionMintReason =
          rotationReason === 'explicit-fresh' ? 'first-turn' : 'agent-transition';
        providerSessionDecision =
          rotationReason === 'unowned-session'
            ? 'unowned-session-mint'
            : rotationReason === 'agent-transition'
              ? 'agent-transition-mint'
              : 'explicit-fresh-mint';
      } else if (!hadProviderSession) {
        providerSessionMintReason = 'first-turn';
        // A per-Turn-lifetime handler discarded its provider session at the
        // prior Turn's end, so it re-enters here with `!hasProviderSession`
        // on every iteration. Label that re-mint distinctly so it is not
        // read as a Run's genuine first-turn mint.
        providerSessionDecision =
          handler.providerSessionLifetime === 'turn' ? 'per-turn-mint' : 'first-turn-mint';
      } else {
        providerSessionDecision = 'resume';
      }
      if (!this.hasProviderSession) {
        this.refreshSessionFields({ provider_session_agent_id: incomingAgentId });
      }
      const phaseBreakdownCursor =
        input.promptType === 'plan_shaping_phase_breakdown'
          ? (() => {
              const p = input.payload as { stageIdx?: unknown; phaseIdx?: unknown } | undefined;
              return {
                stageIdx: typeof p?.stageIdx === 'number' ? p.stageIdx : null,
                phaseIdx: typeof p?.phaseIdx === 'number' ? p.phaseIdx : null,
              };
            })()
          : { stageIdx: null, phaseIdx: null };
      this.logger.info('local.run.provider_session.decision', {
        runId: this.runId,
        agenticSessionId: this.session.agentic_session_id,
        conversationId: this.conversationId,
        decision: providerSessionDecision,
        hasProviderSession: hadProviderSession,
        outgoingAgentId,
        incomingAgentId,
        inputPromptType: input.promptType,
        sessionPersistedPromptType,
        providerSessionStart,
        priorProviderSessionId: this.session.provider_session_id ?? null,
        stageIdx: phaseBreakdownCursor.stageIdx,
        phaseIdx: phaseBreakdownCursor.phaseIdx,
      });
    }

    if (preparedApprovedPlanWorkspaceChanged) {
      await this.resetWorkspaceWriteBoundaryForScopeChange();
    }

    // Implement preparation can widen the selected Service set from the
    // approved plan. Refresh the launch workspace after that reconciliation;
    // all other handlers reuse the workspace resolved before prompt building.
    if (preparedImplementWorkspaceReconciled) {
      turnWorkspace = await this.resolveTurnWorkspace(session, input.promptType, isFirstTurn);
      session = this.session;
    }

    // Pending annotations ride only the user's own message, and only into a
    // provider session that reads `resolvedPrompt`; anything else leaves them pending.
    const deliversBrowserInputs =
      handler.runnerKind === 'provider_session' && Boolean(readUserMessageBoundary(input));
    const browserAnnotations = deliversBrowserInputs
      ? (this.browserAnnotations?.pending(this.runId) ?? [])
      : [];
    const browserTabNotice = deliversBrowserInputs
      ? (this.browserTabNotices?.pending(this.runId) ?? null)
      : null;
    // The agent may have made the proposal under any prompt type, so every provider-session Turn is told.
    // A blank prompt means "resume only": the provider supplies its own continue instruction, which
    // notices would replace, so they wait (still tracked) for a Turn that carries text.
    const proposalNotices: ProposalDecisionNotices =
      handler.runnerKind === 'provider_session' && Boolean(resolvedPrompt?.trim())
        ? await this.proposalTracker.refresh()
        : { lines: [], proposalIds: [] };
    const browserInputBlocks = [
      ...(proposalNotices.lines.length > 0 ? [proposalNotices.lines.join('\n')] : []),
      ...(browserTabNotice ? [formatBrowserTabNotice(browserTabNotice)] : []),
      ...(browserAnnotations.length > 0 ? [formatBrowserAnnotations(browserAnnotations)] : []),
    ];
    // Normalize resolvedPrompt to a non-null string for Turn construction.
    // Null arises only from subagent-owned handlers (which don't use it)
    // and from follow-up resumes with no new user text (where an empty
    // string signals "omit prompt, resume only" to ResumeRunner).
    const resolvedPromptNonNull =
      browserInputBlocks.length > 0
        ? [resolvedPrompt, ...browserInputBlocks]
            .filter((part): part is string => Boolean(part))
            .join('\n\n')
        : (resolvedPrompt ?? '');
    const effectiveProviderSessionStartupSegments = providerSessionStartupSegments;
    const roleGuidance =
      handler.runnerKind === 'provider_session'
        ? await this.sessionRoleGuidance.prepare({
            session: this.session,
            handler,
            payload: preparedPayload ?? input.payload,
            ...(this.startupPromptInputResult ? { startup: this.startupPromptInputResult } : {}),
            fresh: providerSessionDecision !== 'resume',
            userMessages: readRecentUserReplies(input).map((reply) => reply.text),
          })
        : undefined;
    if (this.sessionRoleGuidance.continuity)
      this.refreshSessionFields({
        sessionContext: {
          ...this.session.sessionContext,
          sessionRoleGuidance: this.sessionRoleGuidance.continuity,
        },
      });
    const serviceScopeRecovery = this.serviceScope.pendingRecovery();

    const resolvedTurnEffective = resolveTurnEffective(handler, session);
    // A per-Turn runtime selection is the user's exact choice for this Turn: unset fields are
    // not filled from the Run, whose stored runtime stays as it was.
    const turnRuntime = input.turnRuntime;
    const effectiveModel =
      turnRuntime?.model ?? providerExecution?.model ?? resolvedTurnEffective.model;
    const effectiveReasoningEffort = turnRuntime
      ? (turnRuntime.reasoningEffort ?? null)
      : resolvedTurnEffective.reasoningEffort;

    this.logger.debug('local.run.turn_effective.resolved', {
      runId: this.runId,
      promptType: handler.promptType,
      runnerKind: handler.runnerKind,
      provider: this.provider,
      executionProvider: turnRuntime?.provider ?? providerExecution?.provider ?? this.provider,
      sessionModel: session.model ?? null,
      effectiveModel,
      sessionReasoningEffort: session.reasoningEffort ?? null,
      handlerDefaultReasoningEffort: handler.defaultReasoningEffort ?? null,
      effectiveReasoningEffort,
      effectiveFastMode: turnRuntime ? (turnRuntime.fastMode ?? null) : (session.fastMode ?? null),
    });

    return {
      ctx: {
        run: this,
        turnId,
        handler,
        resolvedPrompt: resolvedPromptNonNull,
        ...(roleGuidance ? { roleGuidance } : {}),
        input,
        ...(preparedPayload !== undefined ? { preparedPayload } : {}),
        cwd: turnWorkspace.cwd,
        ...(turnWorkspace.workspace ? { workspace: turnWorkspace.workspace } : {}),
        ...(turnWorkspace.workspaceWriteBoundary
          ? { workspaceWriteBoundary: turnWorkspace.workspaceWriteBoundary }
          : {}),
        effectiveModel,
        ...(providerExecution ? { executionProvider: providerExecution.provider } : {}),
        effectiveReasoningEffort,
        ...(turnRuntime ? { turnRuntime } : {}),
        priorReports,
        ...(this.startupPromptInputResult
          ? { startupPromptInput: this.startupPromptInputResult }
          : {}),
        ...(effectiveProviderSessionStartupSegments
          ? { providerSessionStartupSegments: effectiveProviderSessionStartupSegments }
          : {}),
        ...(providerSessionDecision ? { providerSessionDecision } : {}),
        ...(providerSessionMintReason ? { providerSessionMintReason } : {}),
        ...(serviceScopeRecovery ? { serviceScopeRecovery } : {}),
        ...(browserMcpMount ? { browserMcpMount } : {}),
        platformMcpProxyMount: platformMcpProxy.mount,
        platformMcpAdditionalAllowedTools,
        handlerDeps: bindPromptOnce(this.handlerDeps, {
          handler,
          session,
          input,
          abortSignal: () => this.abortSignal,
          runner: () => this.runnerPicker.runnerFor(this),
          observeProviderPhase: (phase) => this.observeProviderPhase(phase),
        }),
      },
      platformMcpProxy,
      browserAnnotationIds: browserAnnotations.map((annotation) => annotation.id),
      browserTabNoticeId: browserTabNotice?.id ?? null,
      proposalNotices,
    };
  }

  /**
   * Drop the persisted provider session so the next runner picker call
   * selects `NewSessionRunner` and the SDK mints a fresh session. Clears
   * the provider ids on both the in-memory session view and the persisted
   * run metadata, then flips `hasProviderSession` to false. The persist is
   * what survives a CLI process bounce: without it, the run on disk still
   * carries the discarded `provider_session_id` and rehydration would
   * resurrect the session we just dropped. Returns the id that was
   * dropped so callers can log *why* the session went away.
   */
  private async discardProviderSession(
    reason: string,
    options: { throwOnPersistFailure?: boolean } = {},
  ): Promise<{ discardedProviderSessionId: string | null }> {
    const discardedProviderSessionId = this.session.provider_session_id ?? null;
    const discardedProviderConversationId = this.session.provider_conversation_id ?? null;
    const discardedProviderSessionAgentId = this.session.provider_session_agent_id ?? null;
    const hadProviderSession = this.hasProviderSession;
    const hadEmittedProviderIdentity = this.providerIdentityEmitted;
    // The session type still declares provider_session_id as a non-null
    // string even though the in-memory shape is nullable until the first
    // runPrompt completes (see test fixtures across the runtime). Cast
    // through unknown so the in-memory clear typechecks against the
    // optimistic type without forcing every consumer to widen.
    this.refreshSessionFields({
      provider_session_id: null,
      provider_conversation_id: null,
      provider_session_agent_id: null,
    } as unknown as Partial<AgenticSession>);
    this.providerIdentityEmitted = false;
    this.setHasProviderSession(false, reason);

    if (discardedProviderSessionId) {
      try {
        await this.runStore.updateRunProviderIdentity(this.session.agentic_session_id, {
          providerSessionId: null,
          providerConversationId: null,
        });
      } catch (error) {
        this.logger.warn('local.run.provider_session.discard.persist_failed', {
          runId: this.runId,
          reason,
          discardedProviderSessionId,
          error,
        });
        if (options.throwOnPersistFailure) {
          // A failed durable clear must leave the in-process Run consistent
          // with the still-persisted identity. Otherwise a retry would select
          // NewSessionRunner without re-attempting the clear or disconnecting
          // the outgoing provider client.
          this.refreshSessionFields({
            provider_session_id: discardedProviderSessionId,
            provider_conversation_id: discardedProviderConversationId,
            provider_session_agent_id: discardedProviderSessionAgentId,
          } as unknown as Partial<AgenticSession>);
          this.providerIdentityEmitted = hadEmittedProviderIdentity;
          this.setHasProviderSession(hadProviderSession, `${reason}-persist-rollback`);
          throw error;
        }
      }
    }

    return { discardedProviderSessionId };
  }

  /**
   * Durably discard the outgoing provider transcript before selecting the
   * incoming agent. The provider client reset is awaited so the next mint
   * cannot race a stale live SDK handle.
   */
  /**
   * Point this Run at a newly selected provider. The outgoing provider's
   * client stays bound as `this.runner` until the rotation discard runs, so
   * the outgoing session is closed by the provider that owns it.
   */
  private switchProvider(provider: Run['provider']): boolean {
    if (provider === this.provider) return false;
    this.logger.info('local.run.provider.switched', {
      runId: this.runId,
      fromProvider: this.provider,
      toProvider: provider,
      providerSessionId: this.session.provider_session_id ?? null,
    });
    if (this.codexShellChangeObserver) void this.codexShellChangeObserver.clearRun(this.runId);
    this.provider = provider;
    this.codexShellChangeObserver =
      provider === 'codex' ? new CodexShellChangeObserver(this.logger) : null;
    return true;
  }

  private async discardProviderSessionForRotation(input: {
    outgoingAgentId: string | null;
    incomingAgentId: string;
    reason: 'agent-transition' | 'explicit-fresh' | 'unowned-session';
  }): Promise<void> {
    const { discardedProviderSessionId } = await this.discardProviderSession(
      `${input.reason}-discard`,
      {
        // Known-owner transitions must clear durably before the incoming
        // agent mints. Legacy unowned sessions predate this field and rotate
        // best-effort so an old Run is not adopted by the incoming handler.
        throwOnPersistFailure: input.reason !== 'unowned-session',
      },
    );
    // Mirror the per-turn-lifetime discard path (run.ts ~1348): the run-level
    // discard clears hasProviderSession and the persisted id, but the SDK
    // client's in-memory session handle survives until the client is explicitly
    // disconnected. Disconnect here so runPrompt sees getSessionId() === null
    // and mints fresh with the new handler's MCP config and allowedTools.
    // Must be awaited — the next runPrompt call follows immediately.
    this.providerSessionRotationClientDiscardPending = true;
    await this.finishPendingProviderSessionRotationClientDiscard({
      reason: input.reason,
      outgoingAgentId: input.outgoingAgentId,
      incomingAgentId: input.incomingAgentId,
    });
    this.logger.info('local.run.provider_session.discarded_on_rotation', {
      runId: this.runId,
      reason: input.reason,
      outgoingAgentId: input.outgoingAgentId,
      incomingAgentId: input.incomingAgentId,
      discardedProviderSessionId,
    });
  }

  private async finishPendingProviderSessionRotationClientDiscard(context?: {
    reason: 'agent-transition' | 'explicit-fresh' | 'unowned-session';
    outgoingAgentId: string | null;
    incomingAgentId: string;
  }): Promise<void> {
    if (!this.providerSessionRotationClientDiscardPending) return;
    if (!this.runner?.discardSession) {
      this.providerSessionRotationClientDiscardPending = false;
      return;
    }
    try {
      await this.runner.discardSession();
      this.providerSessionRotationClientDiscardPending = false;
    } catch (error) {
      this.logger.warn('local.run.provider_session.rotation_discard_client_failed', {
        runId: this.runId,
        reason: context?.reason ?? 'retry',
        outgoingAgentId: context?.outgoingAgentId ?? null,
        incomingAgentId: context?.incomingAgentId ?? null,
        error,
      });
      throw error;
    }
  }

  /**
   * A scope approval intentionally changes the Run's authorized roots. The
   * write boundary is immutable once created, so retain the provider-session
   * discard ordering above, then dispose the old boundary before the resumed
   * Turn resolves its expanded workspace.
   */
  private async resetWorkspaceWriteBoundaryForScopeChange(): Promise<void> {
    const boundary = this.workspaceWriteBoundary;
    this.workspaceWriteBoundary = null;
    if (!boundary) return;

    try {
      await boundary.dispose();
      this.logger.debug('local.run.workspace_write_boundary.reset_for_scope_change', {
        runId: this.runId,
      });
    } catch (error) {
      this.logger.warn('local.run.workspace_write_boundary.reset_failed', {
        runId: this.runId,
        error,
      });
    }
  }

  /**
   * Resolve the Run-owned workspace for this turn. This is the single source
   * of truth for both provider launch cwd and relative file-change resolution:
   * provider runners receive the returned workspace, while Run.refreshSessionFields
   * makes the same worktree map visible to recordFileChanges.
   */
  private async resolveTurnWorkspace(
    session: AgenticSession,
    promptType: InternalRunPromptRequest['promptType'],
    isFirstTurn: boolean,
    readOnlyDirectories: readonly string[] = [],
  ): Promise<{
    cwd: string;
    workspace?: ResolvedRunWorkspace;
    workspaceWriteBoundary?: RunWorkspaceWriteBoundary;
  }> {
    const isServiceFreeRun =
      this.promptTypeRegistry.get(promptType)?.service === 'optional' ||
      this.promptTypeRegistry.get(session.promptType)?.service === 'optional';
    if ((session.services?.length ?? 0) === 0 && isServiceFreeRun) {
      const cwd = process.cwd();
      this.logger.debug('local.run.turn_workspace.selected', {
        runId: this.runId,
        sessionId: session.agentic_session_id,
        promptType,
        sessionPromptType: session.promptType ?? null,
        decision: 'graph_only_current_directory',
        cwd,
        serviceCount: 0,
        launchServiceId: null,
      });
      return { cwd };
    }

    let workspace: Awaited<ReturnType<typeof resolveRunWorkspace>>;
    try {
      workspace = await resolveRunWorkspace({
        session,
        repoStore: this.repoStore,
        logger: this.logger,
      });
    } catch (error) {
      if (error instanceof RunWorktreeCollisionError && isFirstTurn) {
        await this.publishTaskMonitorLaunchFailure(error);
      }
      throw error;
    }
    if (!workspace.ok) {
      this.logger.warn('local.run.turn_workspace_resolution_failed', {
        runId: this.runId,
        sessionId: session.agentic_session_id,
        launchServiceId: session.launchServiceId,
        serviceCount: session.services?.length ?? 0,
        resolutionCode: workspace.code,
      });
      throw new LocalAgentApiError(
        workspace.code === 'REPO_BINDING_MISSING' ? 'REPO_BINDING_MISSING' : 'INVALID_REQUEST',
        workspace.message,
        workspace.code === 'REPO_BINDING_MISSING' ? 409 : 400,
      );
    }

    if (this.taskMonitorId !== null) {
      this.taskMonitorLaunchFailureRuntime?.clearLaunchFailures({
        taskMonitorId: this.taskMonitorId,
        agentSessionId: this.agentSessionId,
      });
    }

    if (workspace.worktree) {
      // The resolved workspace is authoritative for this live Turn even when
      // durable persistence is temporarily unavailable. Prompt preparation
      // and file-change tracking must not fall back to host checkout paths
      // while the provider launches inside the resolved worktree.
      this.refreshSessionFields({ worktreeState: workspace.worktree });
      try {
        await this.runStore.updateRunWorktreeState(session.agentic_session_id, workspace.worktree);
      } catch (error) {
        this.logger.error('local.run.turn_worktree_state_persist_failed', {
          runId: this.runId,
          sessionId: session.agentic_session_id,
          error,
        });
      }
    }

    this.logger.debug('local.run.turn_workspace.selected', {
      runId: this.runId,
      promptType,
      decision: 'service_workspace',
      launchServiceId: session.launchServiceId,
      services: session.services ?? [],
      cwd: workspace.cwd,
      processCwd: process.cwd(),
    });
    if (this.provider === 'codex' && readOnlyDirectories.length === 0) {
      return { cwd: workspace.cwd, workspace };
    }

    if (this.workspaceWriteBoundary === null) {
      this.workspaceWriteBoundary = await RunWorkspaceWriteBoundary.create(workspace, {
        runScopeId: this.runId,
        readOnlyDirectories,
      });
      this.logger.info('local.run.workspace_write_boundary.created', {
        runId: this.runId,
        cwd: this.workspaceWriteBoundary.cwd,
        allowedRepositoryRoots: this.workspaceWriteBoundary.allowedRepositoryRoots,
        readOnlyDirectories: this.workspaceWriteBoundary.readOnlyDirectories,
      });
    } else if (!this.workspaceWriteBoundary.matchesWorkspace(workspace, readOnlyDirectories)) {
      this.logger.error('local.run.workspace_write_boundary.identity_changed', {
        runId: this.runId,
        promptType,
        expectedCwd: this.workspaceWriteBoundary.cwd,
        resolvedCwd: workspace.cwd,
        expectedRoots: this.workspaceWriteBoundary.allowedRepositoryRoots,
        resolvedRoots: workspace.allowedRepositoryRoots,
        expectedReadOnlyDirectories: this.workspaceWriteBoundary.readOnlyDirectories,
        resolvedReadOnlyDirectories: readOnlyDirectories,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        'The Run workspace changed after its write boundary was established.',
        409,
      );
    }

    return {
      cwd: workspace.cwd,
      workspace,
      workspaceWriteBoundary: this.workspaceWriteBoundary,
    };
  }

  /**
   * The bundle is Run-scoped: every Turn of a mode-backed Run passes it as a
   * read-only directory so the write boundary identity stays stable.
   */
  /** One directory per Run so the workspace boundary's read-only roots stay stable across turns. */
  private async resolveRepositorySnapshotDirectory(): Promise<string> {
    this.repositorySnapshotDirectory ??= fs
      .mkdtemp(path.join(os.tmpdir(), 'heyhey-repository-snapshots-'))
      .then((directory) => fs.realpath(directory));
    return this.repositorySnapshotDirectory;
  }

  private async resolveProjectModeBundleDirectory(session: AgenticSession): Promise<string | null> {
    if (!hasCapturedProjectModeConfig(session.config)) return null;
    const validated = validateProjectModeConfig(session.config);
    if (!validated.ok) {
      this.logger.error('local.run.project_mode_bundle.invalid_captured_config', {
        runId: this.runId,
        issues: validated.issues,
      });
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `project_mode captured config is invalid: ${validated.issues.join('; ')}`,
        400,
      );
    }
    const bundleDirectory = await this.projectModeBundleMaterializer.materialize(
      session.agentic_session_id,
      validated.value.snapshot,
    );
    this.logger.debug('local.run.project_mode_bundle.ready', {
      runId: this.runId,
      bundleDirectory,
      snapshotHash: validated.value.snapshot.snapshotHash,
    });
    return bundleDirectory;
  }

  private async publishTaskMonitorLaunchFailure(error: RunWorktreeCollisionError): Promise<void> {
    const taskMonitorId = this.taskMonitorId;
    const taskId = this.taskId;
    const runtime = this.taskMonitorLaunchFailureRuntime;
    if (runtime === null || taskMonitorId === null || taskId === null) {
      this.logger.debug('local.run.task_monitor.launch_failure.skipped', {
        runId: this.runId,
        taskMonitorId,
        taskId,
        hasRuntime: runtime !== null,
        reason: 'task_monitor_identity_unavailable',
      });
      return;
    }
    try {
      await runtime.publishLaunchFailure({
        taskMonitorId,
        taskId,
        runId: this.runId,
        agentSessionId: this.agentSessionId,
        conversationId: this.conversationId,
        failure: error.failure,
      });
    } catch (publishError) {
      this.logger.error('local.run.task_monitor.launch_failure.publish_failed', {
        runId: this.runId,
        taskMonitorId,
        taskId,
        agentSessionId: this.agentSessionId,
        fingerprint: error.fingerprint,
        error: publishError instanceof Error ? publishError.message : String(publishError),
      });
    }
  }

  /**
   * Emit the per-turn source-trace event. The turn no longer posts a
   * SYSTEM-processing placeholder ("anchor") — every in-turn write appends to
   * the conversation tail, and the turn's completion is itself a tail append —
   * so this is purely an observability hook recording how the turn was opened.
   */
  private logTurnOpenSource(args: {
    input: InternalRunPromptRequest;
    promptHandler: string;
  }): void {
    const { input, promptHandler } = args;
    const session = this.session;
    const convId = session.conversationId;

    // Source-trace event — emitted once per turn-open so the call-flow that
    // produced the turn is queryable.
    const isCoalesced = isCoalescedBatchRequest(input);
    let turnOpenSource: 'user_message_dispatch' | 'system_trigger_dispatch' | 'coalesced_batch';
    if (isCoalesced) {
      turnOpenSource = 'coalesced_batch';
    } else if (input.triggerContext != null) {
      turnOpenSource = 'system_trigger_dispatch';
    } else {
      turnOpenSource = 'user_message_dispatch';
    }
    this.logger.info('local.run.turn.open.source', {
      runId: this.runId,
      conversationId: convId,
      source: turnOpenSource,
      promptType: input.promptType,
      promptHandler,
      triggerContext: input.triggerContext ?? null,
    });
  }

  private registerSubmissionTools(
    handler: PromptTypeHandler<unknown>,
    turnId: string,
    awaitingUserReview: boolean,
  ): void {
    const session = this.session;
    const triggerCtx = this.triggerContext;
    const externalAgentNodeId = triggerCtx?.externalAgentNodeId ?? null;
    const triggerMessageId = triggerCtx?.triggerMessageId ?? null;

    // While the workflow is waiting on a user review, an action tool would
    // let the agent fabricate workflow progress. Strip them out so only
    // pass-through tools (which never post workflow completion messages)
    // remain. Base tools (e.g. the universal create_report wrapper) are all
    // pass-through and are prepended unconditionally so they survive the filter.
    const ownHandlerTools = handler.submissionTools ?? [];
    const filteredHandlerTools = awaitingUserReview
      ? ownHandlerTools.filter(isPassThroughTool)
      : ownHandlerTools;
    const activeHandlerTools = awaitingUserReview
      ? ownHandlerTools.filter(isPassThroughTool)
      : ownHandlerTools;
    const baseTools = this.baseSubmissionTools.filter(
      (tool) => !handler.excludedBaseSubmissionTools?.includes(tool.name),
    );
    const tools = [...baseTools, ...filteredHandlerTools];
    const activeToolNames = [...baseTools, ...activeHandlerTools].map((tool) => tool.name);

    if (
      tools.length === 0 ||
      !session.contextMetadata.organizationId ||
      !session.contextMetadata.projectId ||
      !session.conversationId
    ) {
      this.logger.info('local.run.submission_tools.registration_skipped', {
        runId: this.runId,
        turnId,
        promptType: handler.promptType,
        toolCount: tools.length,
        hasOrganizationId: Boolean(session.contextMetadata.organizationId),
        hasProjectId: Boolean(session.contextMetadata.projectId),
        hasConversationId: Boolean(session.conversationId),
        awaitingUserReview,
      });
      // A turn awaiting a user review may end up with no tools to mount (the
      // routed handlers — coding_freeform and the feature-sync review
      // persona — declare none) yet a prior turn's registration on the same
      // Run could still hold action tools. Replace the prior tool list so the
      // registry cannot advertise an action tool while the workflow is parked
      // on a user review.
      if (awaitingUserReview) {
        const stale = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
        if (stale && stale.tools.some((t) => !isPassThroughTool(t))) {
          this.submissionToolRegistry.update(session.agentic_session_id, {
            tools,
            activeToolNames,
            externalAgentNodeId,
            triggerMessageId,
          });
        }
      }
      return;
    }

    // Always mount the handler's declared submission tools. Missing
    // `externalAgentNodeId` / `triggerMessageId` is not a registration-time
    // failure — the registry stores them as nullable, and the action-poster
    // path (`http-mcp.ts`) rejects the submit at call time if either is
    // null, surfacing the failure to the agent rather than silently leaving
    // the turn with no completion path. See the writeup at the top of this
    // file for the trigger-message-id history.
    const perTurnFields = {
      tools,
      activeToolNames,
      externalAgentNodeId,
      triggerMessageId,
    };

    const existing = this.submissionToolRegistry.getByRunId(session.agentic_session_id);
    const registration = existing
      ? this.submissionToolRegistry.update(session.agentic_session_id, perTurnFields)
      : this.submissionToolRegistry.register({
          runId: session.agentic_session_id,
          organizationId: session.contextMetadata.organizationId,
          projectId: session.contextMetadata.projectId,
          conversationId: session.conversationId,
          ...perTurnFields,
        });

    this.logger.debug('local.run.submission_tools_registered', {
      turnId,
      runId: this.runId,
      promptType: handler.promptType,
      toolCount: tools.length,
      activeToolCount: activeToolNames.length,
      token: registration.token,
      mode: existing ? 'update' : 'register',
    });
  }

  /**
   * Persist the concrete promptType on the session. Invoked after the
   * Turn has begun (and therefore after the resolver has already observed
   * the PREVIOUS value for handler-swap detection). No-op when the value
   * already matches.
   */
  private async persistSessionPromptType(
    promptType: InternalRunPromptRequest['promptType'],
  ): Promise<void> {
    if (this.session.promptType === promptType) return;
    await this.runStore.updateRunPromptType(this.session.agentic_session_id, promptType);
    this.refreshSessionFields({ promptType });
  }

  // ==================================================================
  // Stop / cleanup
  // ==================================================================

  /**
   * Stop any in-flight Turn and clear the queue. Invoked by the
   * run-service's `stopRun` endpoint. Idempotent — safe to call on an
   * already-idle Run. No conversation message is mutated: the turn no longer
   * posts a SYSTEM anchor to finalize, so a stop just aborts the run and
   * clears per-Run scheduling state.
   */
  async stop(): Promise<void> {
    this.clearInactivityTimer('stop');
    this._inactivityReapInterrupted = true;
    this._inactivityReapingDisabled = true;
    this.abort();
    this.clearQueue();
    this.finalizeHandlerSpan('run-end');
    this.submissionToolRegistry.unregisterByRunId(this.runId);
    // Symmetric with stop semantics: 'this Run is done — do not let a
    // stale submission resolve against it.' Clear the in-memory values via
    // the setters so the persist round-trip mirrors disk to null.
    // cleanup() (process-shutdown) deliberately skips this — the context
    // must survive into the next process and be rehydrated.
    this.logger.info('local.run.stop.clearing_trigger_context', {
      runId: this.runId,
      priorTriggerContext: this.triggerContext,
    });
    this.setTriggerContext(null);
  }

  public async persistCodingPlanElement(
    type: import('../shared/api/generated/api').ExtendedUIFieldType,
    payload: import('../shared/api/generated/api').CodingPlanVersion,
  ): Promise<string> {
    return this.persistCodingPlanMessage(type, '', [
      {
        id: randomUUID(),
        type,
        label: 'Complete plan',
        required: false,
        influences: [],
        payload,
      },
    ]);
  }

  /** Posts a planner question as visible text; the user's reply starts the next Turn. */
  public async persistCodingPlanQuestion(question: string): Promise<string> {
    return this.persistCodingPlanMessage('coding_plan_question', question);
  }

  private async persistCodingPlanMessage(
    savedType: string,
    response: string,
    uiElements?: AgentSystemMessageData['uiElements'],
  ): Promise<string> {
    const turn = this.activeTurn;
    if (turn?.handler.promptType !== 'startup_session') {
      throw new Error('Planning conversation tools require the active planning handler.');
    }
    const session = this.session;
    const messageId = await this.poster.createOutOfBand({
      organizationId: session.contextMetadata.organizationId,
      projectId: session.contextMetadata.projectId,
      conversationId: session.conversationId,
      dto: {
        type: MessageType.System,
        status: MessageStatus.Completed,
        projectId: session.contextMetadata.projectId,
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          response,
          detectedIntent: 'coding_plan_conversation',
          intentConfidence: 1,
          ...(uiElements ? { uiElements } : {}),
        },
      },
      stamp: null,
    });
    const saved = this._codingPlanElementsByTurn.get(turn.turnId) ?? new Set<string>();
    saved.add(savedType);
    this._codingPlanElementsByTurn.set(turn.turnId, saved);
    this.logger.debug('local.coding_plan.conversation.persisted', {
      runId: this.runId,
      turnId: turn.turnId,
      type: savedType,
      messageId,
    });
    return messageId;
  }

  public readCodingPlanElementTypes(turnId: string): readonly string[] {
    return [...(this._codingPlanElementsByTurn.get(turnId) ?? [])];
  }

  private async postAgentSystemMessage(
    response: string,
    session: AgenticSession = this.session,
  ): Promise<void> {
    const agentData: AgentSystemMessageData = {
      type: SystemMessageDataTypeEnum.Agent,
      response,
      detectedIntent: 'agent_response',
      intentConfidence: 1,
    };
    const dto = {
      type: MessageType.System,
      status: MessageStatus.Completed,
      projectId: session.contextMetadata.projectId,
      data: agentData,
      createdAt: new Date().toISOString(),
    } as const;
    await this.poster.createOutOfBand({
      organizationId: session.contextMetadata.organizationId,
      projectId: session.contextMetadata.projectId,
      conversationId: session.conversationId,
      dto,
      stamp: null,
    });
  }

  cleanup(): void {
    this.clearInactivityTimer('cleanup');
    this._inactivityReapInterrupted = true;
    this._inactivityReapingDisabled = true;
    this.logger.info('local.run.cleanup', {
      runId: this.runId,
      hadTriggerContext: this.triggerContext !== null,
      hadActiveTurn: this.activeTurn !== null,
      queueLength: this._messageQueue.length,
      isProcessing: this._processing,
    });
    this.finalizeHandlerSpan('run-end');
    this.pendingDiffs.clear();
    this.questionMessages.clear();
    this.triggerContext = null;
    this.lastSubmissionAction = null;
    this.compaction.cancelPending(new Error('Run stopped while compact was pending.'));
    this._pendingCompletion = null;
    void this.codexShellChangeObserver?.clearRun(this.runId);
    this._inFlightDispatch.clear();
    this._filesTouchedByTurn.clear();
    this._stagedFileChanges.clear();
    this._completedProviderTurnIds.clear();
    this._activeProviderThreadId = null;
    this._activeProviderTurnId = null;
    this._submittedTurnIds.clear();
    this._codingPlanElementsByTurn.clear();
    this._reportChainStartByTurn.clear();
    this._narrationByTurn.clear();
    this.agentSessionCurrentState.cleanup(
      this.activeTurn !== null ||
        this._processing ||
        this.agentSessionCurrentState.currentProviderPhase !== null,
    );
    this.conversationPhase.cleanup(
      this.activeTurn !== null || this._processing || this.conversationPhase.currentPhase !== null,
    );
    this.activeTurn = null;
    this.clearQueue();
    this._processing = false;
    this.resetAbort();
    const runner = this.runner;
    let runnerDisposePromise: Promise<void> = Promise.resolve();
    if (runner?.dispose) {
      runnerDisposePromise = runner.dispose().catch((error: unknown) => {
        this.logger.warn('local.run.cleanup.dispose_failed', {
          runId: this.runId,
          error,
        });
      });
    }
    const workspaceWriteBoundary = this.workspaceWriteBoundary;
    this.workspaceWriteBoundary = null;
    if (workspaceWriteBoundary) {
      void runnerDisposePromise.then(() =>
        workspaceWriteBoundary.dispose().catch((error: unknown) => {
          this.logger.warn('local.run.cleanup.workspace_write_boundary_dispose_failed', {
            runId: this.runId,
            error,
          });
        }),
      );
    }
    const repositorySnapshotDirectory = this.repositorySnapshotDirectory;
    this.repositorySnapshotDirectory = null;
    if (repositorySnapshotDirectory) {
      void runnerDisposePromise
        .then(() => repositorySnapshotDirectory)
        .then((directory) => fs.rm(directory, { recursive: true, force: true }))
        .catch((error: unknown) => {
          this.logger.warn('local.run.cleanup.repository_snapshot_dispose_failed', {
            runId: this.runId,
            error,
          });
        });
    }
    if (this.ownsProjectModeBundleMaterializer) {
      void this.projectModeBundleMaterializer.dispose().catch((error: unknown) => {
        this.logger.warn('local.run.cleanup.project_mode_bundle_dispose_failed', {
          runId: this.runId,
          error,
        });
      });
    }
  }
}

// Re-export narrow types used by tests and external wiring.
export type { ToolUseNormalizedBlock };
