import type {
  CoordinateTaskMonitorWorkEffect,
  EvaluateTaskMonitorSettledRunEffect,
} from './effects';
import type { TaskMonitorCoordinatorValidationFailure } from '@hey-hey/contracts/agent-bridge';
import type {
  TaskMonitorLaunchConfig,
  TaskMonitorPlanGuidance,
} from '@hey-hey/contracts/agent-bridge';
import type { ReportType, TaskMonitorRuntimeSelection } from '@hey-hey/contracts/api/models';
import type { RunWorktreeCollision } from '../../run-scope';
import type { TaskMonitorCoordinationCause } from '../task-monitor-coordination';

type TaskMonitorSessionMethod = 'plan' | 'open' | 'quick';

export interface TaskMonitorWorktree {
  readonly enabled: boolean;
  readonly branch?: string | undefined;
}

export interface TaskMonitorRequestedLaunchConfig {
  readonly taskId: string;
  readonly method: TaskMonitorLaunchConfig['method'];
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly worktree?: TaskMonitorWorktree | undefined;
}

export interface TaskMonitorExecutionNode {
  readonly taskId: string;
  readonly dependsOnTaskIds: readonly string[];
  readonly method: TaskMonitorSessionMethod;
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly agentSessionId: string | null;
}

export interface TaskMonitorTerminalPolicy {
  readonly mode: 'AGENT_DECIDES' | 'REQUIRE_REVIEW';
  readonly reviewRuntime?: TaskMonitorReviewRuntime | undefined;
}

/** A saved Review runtime as the machine persists it. */
export interface TaskMonitorReviewRuntime {
  readonly provider: TaskMonitorRuntimeSelection['provider'];
  readonly model: string;
  readonly reasoningEffort?: TaskMonitorRuntimeSelection['reasoningEffort'] | undefined;
  readonly fastMode?: boolean | undefined;
}

export interface TaskMonitorReviewRequest {
  readonly requestId: string;
  readonly coordinatorRunId: string;
  readonly agentSessionId: string;
  readonly rationale: string;
  readonly failureContext: string | null;
}

export type TaskMonitorPlanGuidanceProjection = TaskMonitorPlanGuidance;
export type TaskMonitorLaunchFailure = RunWorktreeCollision;

export interface TaskMonitorLaunchDeclaration {
  readonly authorityCommandId?: string | undefined;
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskType: string;
  readonly taskDescription: string;
  readonly taskAcceptanceCriteria: string | null;
  readonly cursor: number;
  readonly method: TaskMonitorSessionMethod;
  readonly provider: TaskMonitorLaunchConfig['provider'];
  readonly model: string;
  readonly reasoningEffort: TaskMonitorLaunchConfig['reasoningEffort'];
  readonly fastMode?: TaskMonitorLaunchConfig['fastMode'];
  readonly serviceIds: readonly string[];
  readonly worktree?: TaskMonitorWorktree | undefined;
  readonly userGuidance: string | null;
  readonly planGuidance: TaskMonitorPlanGuidanceProjection | null;
  readonly executionOrder: readonly string[];
  readonly dependsOnTaskIds: readonly string[];
  readonly terminalPolicy: TaskMonitorTerminalPolicy;
  /** Key of the monitor's kind, carried opaquely; null in state persisted before monitors recorded one. */
  readonly kindKey?: string | null | undefined;
}

export interface TaskMonitorRetryableLaunch {
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failedOperation: 'RUN_START';
  readonly failureReason: string;
  readonly failure?: TaskMonitorLaunchFailure | undefined;
}

export type TaskMonitorHumanDecisionResolution = 'APPROVE' | 'DENY';

export interface TaskMonitorHumanDecisionEvidence {
  readonly userId: string;
  readonly authenticatedAt: string;
}

/** Who owns a pending request: the monitor decides first; the human only after an escalation. */
export type TaskMonitorInterventionOwner = 'MONITOR' | 'HUMAN';

/**
 * Which Run-side owner holds the request. A provider permission is answered through the provider
 * runner; a Service scope request is answered through the Run's Service scope coordinator. Absent
 * in state persisted before Service scope requests were monitored, which is always a provider
 * permission.
 */
export type TaskMonitorRequestKind = 'PROVIDER_PERMISSION' | 'SERVICE_SCOPE';

/** Who holds a request right now, derived from the durable pending intervention. */
export type TaskMonitorInterventionHold = 'MONITOR_HELD' | 'HUMAN_HELD' | 'SETTLED';

/** State persisted before the monitor decided requests carries no owner and is human-held. */
export const interventionHold = (
  pending: Pick<TaskMonitorPendingIntervention, 'owner' | 'decision'>,
): TaskMonitorInterventionHold => {
  if (pending.decision !== null) {
    return 'SETTLED';
  }

  return pending.owner === 'MONITOR' ? 'MONITOR_HELD' : 'HUMAN_HELD';
};

export const isHumanHeldQueued = (request: TaskMonitorQueuedIntervention): boolean =>
  request.userRequired === true || request.owner === 'HUMAN';

export const protectedRequestReason =
  'The request is marked USER_REQUIRED, so only a person can decide it.';

/** A request the machine records, wherever it sits: at the front, or queued behind another. */
export interface TaskMonitorRecordedRequest {
  readonly request: TaskMonitorPendingIntervention | TaskMonitorQueuedIntervention;
  readonly hold: TaskMonitorInterventionHold;
}

/** Finds the machine's record of one provider request, which is what decides who may answer it. */
export const findMonitoredRequest = (
  context: Pick<
    TaskMonitorMachineContext,
    'pendingIntervention' | 'queuedInterventions' | 'undeliveredInterventions'
  >,
  runId: string,
  providerActionId: string,
): TaskMonitorRecordedRequest | null => {
  const pending = context.pendingIntervention;
  if (
    pending !== null &&
    pending.runId === runId &&
    pending.providerActionId === providerActionId
  ) {
    return { request: pending, hold: interventionHold(pending) };
  }

  const queued = (context.queuedInterventions ?? []).find(
    (request) => request.runId === runId && request.providerActionId === providerActionId,
  );
  if (queued === undefined) {
    const undelivered = [...(context.undeliveredInterventions ?? [])]
      .reverse()
      .find((request) => request.runId === runId && request.providerActionId === providerActionId);
    return undelivered === undefined ? null : { request: undelivered, hold: 'SETTLED' };
  }

  return { request: queued, hold: isHumanHeldQueued(queued) ? 'HUMAN_HELD' : 'MONITOR_HELD' };
};

/** Exactly one of `human` (a person decided) or `monitorRationale` (the monitor decided) is set. */
export interface TaskMonitorInterventionDecision {
  readonly resolution: TaskMonitorHumanDecisionResolution;
  readonly decidedAt: string;
  readonly human: TaskMonitorHumanDecisionEvidence | null;
  readonly monitorRationale: string | null;
}

export interface TaskMonitorPendingIntervention {
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  /** Marked by an authoritative instruction or the originating tool; the monitor never decides it. */
  readonly userRequired?: boolean | undefined;
  readonly requestKind?: TaskMonitorRequestKind | undefined;
  /** Absent in state persisted before the monitor decided requests; such state is human-owned. */
  readonly owner?: TaskMonitorInterventionOwner | undefined;
  /** Why the monitor handed the request to the human. */
  readonly escalationReason?: string | null | undefined;
  /** When the human took the request: the escalation time, or creation for a USER_REQUIRED request. */
  readonly escalatedAt?: string | null | undefined;
  readonly decision: TaskMonitorInterventionDecision | null;
  readonly applicationFailure: string | null;
}

/** A distinct request that arrived while another was still being decided; it waits its turn. */
export interface TaskMonitorQueuedIntervention {
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly userRequired?: boolean | undefined;
  readonly requestKind?: TaskMonitorRequestKind | undefined;
  /** Set once the request is handed to a person while it still waits behind another. */
  readonly owner?: TaskMonitorInterventionOwner | undefined;
  readonly escalationReason?: string | null | undefined;
  readonly escalatedAt?: string | null | undefined;
}

export interface TaskMonitorSettledRun {
  readonly runId: string;
  readonly agentSessionId: string;
  readonly settledAt: string;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly { readonly reportId: string; readonly reportType: ReportType }[];
  readonly reviewRequestId: string | null;
}

type TaskMonitorInputState = 'WAITING_FOR_INPUT' | 'READING_INPUT' | 'RESPONDING_INPUT';

interface TaskMonitorConversationInputClaim {
  readonly messageId: string;
  readonly effectId: string;
  readonly runId: string | null;
  readonly turnId: string | null;
  readonly assistantMessageId: string | null;
}

export interface TaskMonitorConversationInputContext {
  readonly queuedMessageIds: readonly string[];
  readonly active: TaskMonitorConversationInputClaim | null;
}

interface TaskMonitorCoordinatorRecovery {
  readonly evaluation: CoordinateTaskMonitorWorkEffect | EvaluateTaskMonitorSettledRunEffect;
  readonly correctionAttempt: number;
  readonly failure: TaskMonitorCoordinatorValidationFailure;
  readonly pendingCorrection: boolean;
  readonly requestId: string;
  readonly requestMessageId: string | null;
  readonly conversationId: string | null;
  readonly deliveryFailure: string | null;
}

export interface TaskMonitorPendingJudgment {
  readonly request: string;
  /** The posted request an answer must name; null only for requests settled before it was recorded. */
  readonly requestMessageId: string | null;
}

export interface TaskMonitorMachineContext {
  readonly taskMonitorId: string;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  /** Key of the monitor's kind, carried opaquely; null in state persisted before monitors recorded one. */
  readonly kindKey?: string | null | undefined;
  readonly authorityCommandId?: string | null | undefined;
  readonly coordinationCause?: TaskMonitorCoordinationCause | null | undefined;
  readonly coordinationCorrelationId?: string | null | undefined;
  readonly requestedLaunchConfig: TaskMonitorRequestedLaunchConfig | null;
  readonly executionPlan: readonly TaskMonitorExecutionNode[];
  readonly cursor: number | null;
  readonly selectedTaskId: string | null;
  readonly userGuidance: string | null;
  readonly worktree: TaskMonitorWorktree | null;
  readonly terminalPolicy: TaskMonitorTerminalPolicy | null;
  readonly launch: TaskMonitorLaunchDeclaration | null;
  readonly agentSessionId: string | null;
  readonly activeRunAgentSessionId: string | null;
  readonly conversationId: string | null;
  readonly retryableLaunch?: TaskMonitorRetryableLaunch | null | undefined;
  readonly coordinatorConversationId: string | null;
  readonly pendingIntervention: TaskMonitorPendingIntervention | null;
  /** Requests admitted behind the pending one, in arrival order. Absent in older state. */
  readonly queuedInterventions?: readonly TaskMonitorQueuedIntervention[] | undefined;
  /**
   * Decided requests whose answer could not be delivered, or whose delivery is uncertain, newest
   * last. Each keeps its decision and the specific delivery outcome. They stay settled: none is
   * ever delivered again, and they no longer hold up the requests behind them. Absent in older
   * state.
   */
  readonly undeliveredInterventions?: readonly TaskMonitorPendingIntervention[] | undefined;
  readonly settledRun: TaskMonitorSettledRun | null;
  readonly reviewRequest: TaskMonitorReviewRequest | null;
  readonly input: TaskMonitorConversationInputContext;
  readonly failureReason: string | null;
  /** The coordinator's posted request awaiting the user's judgment; absent in state persisted before it was recorded. */
  readonly pendingJudgment?: TaskMonitorPendingJudgment | null | undefined;
  readonly coordinatorRecovery?: TaskMonitorCoordinatorRecovery | null | undefined;
}
