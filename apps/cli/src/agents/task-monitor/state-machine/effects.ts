import type { TaskResponseDto } from '@hey-hey/contracts/api/models';

import type {
  TaskMonitorExecutionNode,
  TaskMonitorLaunchDeclaration,
  TaskMonitorLaunchFailure,
  TaskMonitorPendingIntervention,
  TaskMonitorRequestKind,
  TaskMonitorTerminalPolicy,
  TaskMonitorRequestedLaunchConfig,
  TaskMonitorRetryableLaunch,
  TaskMonitorWorktree,
} from './context';
import type { TaskMonitorHumanDecisionEvent } from './events';
import type { TaskMonitorLaunchOperation } from './events';
import type {
  TaskMonitorLaunchValidatedEvent,
  TaskMonitorLaunchFailureReportedEvent,
  TaskMonitorLoadedEvent,
  TaskMonitorMachineEvent,
  TaskMonitorRunSettledEvent,
  TaskMonitorStartEvent,
  TaskMonitorStopEvent,
  TaskMonitorWorkSelectedEvent,
} from './events';
import type { TaskMonitorMachineContext } from './context';
import type {
  TaskMonitorCoordinationCause,
  TaskMonitorCoordinationLocalState,
} from '../task-monitor-coordination';
import type {
  TaskMonitorCoordinatorCorrection,
  TaskMonitorCoordinatorValidationFailure,
  SessionMonitorSettledTurnEvidence,
  TaskMonitorJudgmentResponse,
} from '@hey-hey/contracts/agent-bridge';

export interface LoadTaskMonitorEffect {
  readonly type: 'LOAD_TASK_MONITOR';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly requestedLaunchConfig: TaskMonitorRequestedLaunchConfig;
}

export interface CoordinateTaskMonitorWorkEffect {
  readonly type: 'COORDINATE_TASK_MONITOR_WORK';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly kindKey: string | null;
  readonly executionPlan: readonly TaskMonitorExecutionNode[];
  readonly cursor: number;
  /** Cause and correlation are persisted with Resume coordination. */
  readonly cause?: TaskMonitorCoordinationCause | undefined;
  readonly correlationId?: string | undefined;
  readonly authorityCommandId?: string | undefined;
  readonly coordination?: TaskMonitorCoordinationLocalState | undefined;
  readonly settledTurn?: SessionMonitorSettledTurnEvidence | undefined;
  readonly judgment?: TaskMonitorJudgmentResponse | undefined;
  readonly correction?: TaskMonitorCoordinatorCorrection | undefined;
}

export interface ValidateTaskMonitorLaunchEffect {
  readonly type: 'VALIDATE_TASK_MONITOR_LAUNCH';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly kindKey: string | null;
  readonly authorityCommandId?: string | undefined;
  readonly requestedLaunchConfig: TaskMonitorRequestedLaunchConfig;
  readonly executionPlan: readonly TaskMonitorExecutionNode[];
  readonly cursor: number;
  readonly taskId: string;
  readonly userGuidance: string | null;
  readonly worktree: TaskMonitorWorktree | null;
  readonly terminalPolicy: TaskMonitorTerminalPolicy;
}

export interface ReconcileTaskMonitorLaunchEffect {
  readonly type: 'RECONCILE_TASK_MONITOR_LAUNCH';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly kindKey: string | null;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: TaskMonitorLaunchOperation;
  readonly agentSessionId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly retry?: TaskMonitorRetryableLaunch | undefined;
}

export interface CreateTaskMonitorAgentSessionEffect {
  readonly type: 'CREATE_TASK_MONITOR_AGENT_SESSION';
  readonly launch: TaskMonitorLaunchDeclaration;
}

export interface CreateTaskMonitorConversationEffect {
  readonly type: 'CREATE_TASK_MONITOR_CONVERSATION';
  readonly launch: TaskMonitorLaunchDeclaration;
  readonly agentSessionId: string;
}

export interface StartTaskMonitorRunEffect {
  readonly type: 'START_TASK_MONITOR_RUN';
  readonly launch: TaskMonitorLaunchDeclaration;
  readonly agentSessionId: string;
  readonly conversationId: string;
}

export interface PersistTaskMonitorLaunchEffect {
  readonly type: 'PERSIST_TASK_MONITOR_LAUNCH';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
}

export interface ProjectTaskMonitorStartedEffect {
  readonly type: 'PROJECT_TASK_MONITOR_STARTED';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly taskTitle: string;
}

export interface ProjectTaskMonitorLaunchRecoveryEffect {
  readonly type: 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failure: TaskMonitorLaunchFailure;
}

export interface HaltTaskMonitorControlEffect {
  readonly type: 'HALT_TASK_MONITOR_CONTROL';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly activeRunAgentSessionId: string | null;
  readonly failureContext: string;
}

export type TaskMonitorControlStatus = TaskResponseDto['status'] & ('ACTIVE' | 'ON_HOLD');

export interface ProjectTaskMonitorControlStatusEffect {
  readonly type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly status: TaskMonitorControlStatus;
}

export interface DeliverTaskMonitorConversationMessageEffect {
  readonly type: 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

export interface ReconcileTaskMonitorConversationResponseEffect {
  readonly type: 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly turnId: string;
}

/** Asks the Task Monitor agent to decide one pending provider permission request. */
export interface DecideTaskMonitorPermissionEffect {
  readonly type: 'DECIDE_TASK_MONITOR_PERMISSION';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string | null;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly requestKind?: TaskMonitorRequestKind | undefined;
  /** Set when the monitor is paused: it is not asked, and the request goes straight to the person. */
  readonly monitorPaused?: true | undefined;
  /** When the request goes to the person if the monitor has not decided it; absent in older state. */
  readonly dueAt?: string | undefined;
}

/**
 * Hands one monitor-held request to the person once its due time passes, whether it is being
 * decided or still queued. The machine ignores the outcome when the request is already answered.
 */
export interface WatchTaskMonitorPermissionDeadlineEffect {
  readonly type: 'WATCH_TASK_MONITOR_PERMISSION_DEADLINE';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly requestKind?: TaskMonitorRequestKind | undefined;
  readonly dueAt: string;
}

/** Records one committed monitor permission outcome as supervision activity. */
export interface RecordTaskMonitorPermissionDecisionEffect {
  readonly type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string | null;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly action: string;
  readonly target: string;
  readonly decision: 'APPROVED' | 'DENIED' | 'ESCALATED';
  readonly rationale: string;
}

export interface ApplyTaskMonitorDecisionEffect {
  readonly type: 'APPLY_TASK_MONITOR_DECISION';
  readonly operation: 'RELEASE_EXACT_ACTION' | 'REJECT_EXACT_ACTION';
  readonly providerDecision: TaskMonitorHumanDecisionEvent['providerDecision'];
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly decidedAt: string;
  readonly requestKind?: TaskMonitorRequestKind | undefined;
  /** The person who decided; null when the Task Monitor decided. */
  readonly human: {
    readonly userId: string;
    readonly authenticatedAt: string;
  } | null;
  readonly monitorRationale: string | null;
}

export interface EvaluateTaskMonitorSettledRunEffect {
  readonly type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly kindKey: string | null;
  readonly authorityCommandId?: string | undefined;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly settledAt: string;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: TaskMonitorRunSettledEvent['reports'];
  readonly reviewRequestId: string | null;
  readonly judgment?: TaskMonitorJudgmentResponse | undefined;
  readonly correction?: TaskMonitorCoordinatorCorrection | undefined;
}

export interface DeliverTaskMonitorReviewEffect {
  readonly type: 'DELIVER_TASK_MONITOR_REVIEW';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly requestId: string;
  readonly coordinatorRunId: string;
  readonly rationale: string;
}

export interface ProjectTaskMonitorInterventionEffect {
  readonly type: 'PROJECT_TASK_MONITOR_INTERVENTION';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  /** Requests handed to the person together with this one, each shown on its own card. */
  readonly alsoProject?:
    | readonly Pick<
        ProjectTaskMonitorInterventionEffect,
        | 'interventionId'
        | 'providerActionId'
        | 'runId'
        | 'agentSessionId'
        | 'action'
        | 'target'
        | 'fingerprint'
        | 'createdAt'
        | 'expiresAt'
      >[]
    | undefined;
}

export interface ProjectTaskMonitorOutcomeJudgmentEffect {
  readonly type: 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly failure: TaskMonitorCoordinatorValidationFailure;
}

export type TaskMonitorMachineEffect =
  | ProjectTaskMonitorOutcomeJudgmentEffect
  | LoadTaskMonitorEffect
  | CoordinateTaskMonitorWorkEffect
  | ValidateTaskMonitorLaunchEffect
  | ReconcileTaskMonitorLaunchEffect
  | CreateTaskMonitorAgentSessionEffect
  | CreateTaskMonitorConversationEffect
  | StartTaskMonitorRunEffect
  | PersistTaskMonitorLaunchEffect
  | ProjectTaskMonitorStartedEffect
  | ProjectTaskMonitorLaunchRecoveryEffect
  | ProjectTaskMonitorControlStatusEffect
  | DeliverTaskMonitorConversationMessageEffect
  | ReconcileTaskMonitorConversationResponseEffect
  | HaltTaskMonitorControlEffect
  | ProjectTaskMonitorInterventionEffect
  | DecideTaskMonitorPermissionEffect
  | WatchTaskMonitorPermissionDeadlineEffect
  | RecordTaskMonitorPermissionDecisionEffect
  | EvaluateTaskMonitorSettledRunEffect
  | DeliverTaskMonitorReviewEffect
  | ApplyTaskMonitorDecisionEffect;

export const loadTaskMonitorEffect = (event: TaskMonitorStartEvent): LoadTaskMonitorEffect => ({
  type: 'LOAD_TASK_MONITOR',
  taskMonitorId: event.taskMonitorId,
  organizationId: event.organizationId,
  projectId: event.projectId,
  requestedLaunchConfig: event.launchConfig,
});

export const coordinateTaskMonitorWorkEffect = (
  event: TaskMonitorLoadedEvent,
  options: {
    readonly cause?: TaskMonitorCoordinationCause;
    readonly correlationId?: string;
    readonly authorityCommandId?: string;
    readonly coordination?: TaskMonitorCoordinationLocalState;
    readonly settledTurn?: SessionMonitorSettledTurnEvidence;
    readonly judgment?: TaskMonitorJudgmentResponse;
  } = {},
): CoordinateTaskMonitorWorkEffect => ({
  type: 'COORDINATE_TASK_MONITOR_WORK',
  taskMonitorId: event.taskMonitorId,
  organizationId: event.organizationId,
  projectId: event.projectId,
  kindKey: event.kindKey,
  executionPlan: event.executionPlan,
  cursor: event.cursor,
  ...(options.cause ? { cause: options.cause } : {}),
  ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  ...(options.authorityCommandId ? { authorityCommandId: options.authorityCommandId } : {}),
  ...(options.coordination ? { coordination: options.coordination } : {}),
  ...(options.settledTurn ? { settledTurn: options.settledTurn } : {}),
  ...(options.judgment ? { judgment: options.judgment } : {}),
});

export const coordinateTaskMonitorWorkFromContext = (
  context: TaskMonitorMachineContext,
  options: {
    readonly cause?: TaskMonitorCoordinationCause;
    readonly cursor?: number;
    readonly correlationId?: string;
    readonly coordination?: TaskMonitorCoordinationLocalState;
    readonly settledTurn?: SessionMonitorSettledTurnEvidence;
    readonly judgment?: TaskMonitorJudgmentResponse;
  } = {},
): CoordinateTaskMonitorWorkEffect => {
  if (context.organizationId === null || context.projectId === null || context.cursor === null) {
    throw new Error('Task Monitor has no settled Run context ready for coordination.');
  }
  return {
    type: 'COORDINATE_TASK_MONITOR_WORK',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    kindKey: context.kindKey ?? null,
    executionPlan: context.executionPlan,
    cursor: options.cursor ?? context.cursor + 1,
    ...(options.cause ? { cause: options.cause } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...(context.authorityCommandId ? { authorityCommandId: context.authorityCommandId } : {}),
    ...(options.coordination ? { coordination: options.coordination } : {}),
    ...(options.settledTurn ? { settledTurn: options.settledTurn } : {}),
    ...(options.judgment ? { judgment: options.judgment } : {}),
  };
};

export const deliverTaskMonitorConversationMessageEffect = (
  context: TaskMonitorMachineContext,
  messageId: string,
): DeliverTaskMonitorConversationMessageEffect => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.coordinatorConversationId === null
  ) {
    throw new Error('Task Monitor has no canonical conversation owner context.');
  }
  return {
    type: 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.coordinatorConversationId,
    messageId,
  };
};

export const reconcileTaskMonitorConversationResponseEffect = (
  context: TaskMonitorMachineContext,
): ReconcileTaskMonitorConversationResponseEffect => {
  const active = context.input.active;
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.coordinatorConversationId === null ||
    active?.runId === null ||
    active?.turnId === null ||
    active === null
  ) {
    throw new Error('Task Monitor has no started conversation Turn to reconcile.');
  }
  return {
    type: 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.coordinatorConversationId,
    messageId: active.messageId,
    runId: active.runId,
    turnId: active.turnId,
  };
};

const requireLaunchContext = (
  context: TaskMonitorMachineContext,
): {
  organizationId: string;
  projectId: string;
  requestedLaunchConfig: TaskMonitorRequestedLaunchConfig;
  terminalPolicy: TaskMonitorTerminalPolicy;
  authorityCommandId: string;
} => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.requestedLaunchConfig === null ||
    context.terminalPolicy === null ||
    context.authorityCommandId == null
  ) {
    throw new Error('Task Monitor launch context is incomplete.');
  }
  return {
    organizationId: context.organizationId,
    projectId: context.projectId,
    requestedLaunchConfig: context.requestedLaunchConfig,
    terminalPolicy: context.terminalPolicy,
    authorityCommandId: context.authorityCommandId,
  };
};

export const validateTaskMonitorLaunchEffect = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorWorkSelectedEvent,
): ValidateTaskMonitorLaunchEffect => {
  const required = requireLaunchContext(context);
  return {
    type: 'VALIDATE_TASK_MONITOR_LAUNCH',
    taskMonitorId: context.taskMonitorId,
    organizationId: required.organizationId,
    projectId: required.projectId,
    kindKey: context.kindKey ?? null,
    authorityCommandId: required.authorityCommandId,
    requestedLaunchConfig: required.requestedLaunchConfig,
    executionPlan: context.executionPlan,
    cursor: event.cursor,
    taskId: event.taskId,
    userGuidance: context.userGuidance,
    worktree: context.worktree,
    terminalPolicy: required.terminalPolicy,
  };
};

export const retryTaskMonitorLaunchEffect = (
  context: TaskMonitorMachineContext,
): ValidateTaskMonitorLaunchEffect => {
  if (context.selectedTaskId === null || context.cursor === null) {
    throw new Error('Task Monitor has no selected work to validate.');
  }
  return validateTaskMonitorLaunchEffect(context, {
    type: 'WORK_SELECTED',
    taskMonitorId: context.taskMonitorId,
    taskId: context.selectedTaskId,
    cursor: context.cursor,
  });
};

export const reconcileTaskMonitorLaunchEffect = (
  context: TaskMonitorMachineContext,
  operation: TaskMonitorLaunchOperation,
): ReconcileTaskMonitorLaunchEffect => {
  const required = requireLaunchContext(context);
  if (context.selectedTaskId === null || context.cursor === null) {
    throw new Error('Task Monitor has no selected work to reconcile.');
  }
  return {
    type: 'RECONCILE_TASK_MONITOR_LAUNCH',
    taskMonitorId: context.taskMonitorId,
    organizationId: required.organizationId,
    projectId: required.projectId,
    kindKey: context.kindKey ?? null,
    taskId: context.selectedTaskId,
    cursor: context.cursor,
    operation,
    ...(context.agentSessionId === null ? {} : { agentSessionId: context.agentSessionId }),
    ...(context.conversationId === null ? {} : { conversationId: context.conversationId }),
  };
};

export const admitTaskMonitorLaunchRetryEffect = (
  context: TaskMonitorMachineContext,
): ReconcileTaskMonitorLaunchEffect => {
  const retry = context.retryableLaunch ?? null;
  if (
    context.organizationId === null ||
    context.projectId === null ||
    retry === null ||
    context.launch === null
  ) {
    throw new Error('Task Monitor has no retryable selected-session launch.');
  }
  return {
    type: 'RECONCILE_TASK_MONITOR_LAUNCH',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    kindKey: context.kindKey ?? null,
    taskId: retry.taskId,
    cursor: retry.cursor,
    operation: 'RUN_START',
    agentSessionId: retry.agentSessionId,
    conversationId: retry.conversationId,
    retry,
  };
};

const createTaskMonitorAgentSessionEffect = (
  event: TaskMonitorLaunchValidatedEvent,
): CreateTaskMonitorAgentSessionEffect => ({
  type: 'CREATE_TASK_MONITOR_AGENT_SESSION',
  launch: event.launch,
});

export const createTaskMonitorAgentSessionEffectFromContext = (
  context: TaskMonitorMachineContext,
): CreateTaskMonitorAgentSessionEffect => {
  if (context.launch === null) {
    throw new Error('Task Monitor has no validated launch declaration.');
  }
  return { type: 'CREATE_TASK_MONITOR_AGENT_SESSION', launch: context.launch };
};

export const createTaskMonitorConversationEffectFromContext = (
  context: TaskMonitorMachineContext,
): CreateTaskMonitorConversationEffect => {
  if (context.launch === null || context.agentSessionId === null) {
    throw new Error('Task Monitor has no Agent Session ready for Conversation creation.');
  }
  return {
    type: 'CREATE_TASK_MONITOR_CONVERSATION',
    launch: context.launch,
    agentSessionId: context.agentSessionId,
  };
};

export const startTaskMonitorRunEffectFromContext = (
  context: TaskMonitorMachineContext,
): StartTaskMonitorRunEffect => {
  if (
    context.launch === null ||
    context.agentSessionId === null ||
    context.conversationId === null
  ) {
    throw new Error('Task Monitor has no Conversation ready for Run dispatch.');
  }
  return {
    type: 'START_TASK_MONITOR_RUN',
    launch: context.launch,
    agentSessionId: context.agentSessionId,
    conversationId: context.conversationId,
  };
};

export const projectTaskMonitorStartedEffectFromContext = (
  context: TaskMonitorMachineContext,
): ProjectTaskMonitorStartedEffect => {
  if (context.launch === null || context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no completed Run launch ready for STARTED projection.');
  }
  return {
    type: 'PROJECT_TASK_MONITOR_STARTED',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    taskId: context.launch.taskId,
    taskTitle: context.launch.taskTitle,
  };
};

export const projectTaskMonitorLaunchRecoveryEffect = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorLaunchFailureReportedEvent,
): ProjectTaskMonitorLaunchRecoveryEffect => {
  if (context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no owner context for launch recovery projection.');
  }
  return {
    type: 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    taskId: event.taskId,
    agentSessionId: event.agentSessionId,
    conversationId: event.conversationId,
    failure: event.failure,
  };
};

export const persistTaskMonitorLaunchEffectFromContext = (
  context: TaskMonitorMachineContext,
): PersistTaskMonitorLaunchEffect => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.cursor === null ||
    context.selectedTaskId === null ||
    context.agentSessionId === null
  ) {
    throw new Error('Task Monitor has no linked Agent Session ready for persistence.');
  }
  return {
    type: 'PERSIST_TASK_MONITOR_LAUNCH',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    taskId: context.selectedTaskId,
    cursor: context.cursor,
    agentSessionId: context.agentSessionId,
  };
};

export const haltTaskMonitorControlEffect = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorStopEvent,
): HaltTaskMonitorControlEffect => {
  if (context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no owner context for a durable stop.');
  }
  return {
    type: 'HALT_TASK_MONITOR_CONTROL',
    taskMonitorId: event.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    // Run start may complete after its durable effect is claimed but before the
    // RUN_STARTED outcome re-enters the machine. Keep the already-recorded
    // launch Agent Session as the interruption address so STOP cannot leave
    // that Run alive after committing HALTED. The control handler treats a
    // missing local Run as successful.
    activeRunAgentSessionId: context.activeRunAgentSessionId ?? context.agentSessionId,
    failureContext: 'Stopped by user.',
  };
};

export const projectTaskMonitorControlStatusEffect = (
  context: TaskMonitorMachineContext,
  status: TaskMonitorControlStatus,
): ProjectTaskMonitorControlStatusEffect => {
  if (context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no owner context for lifecycle projection.');
  }
  return {
    type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    status,
  };
};

export const applyTaskMonitorDecisionEffect = (
  context: TaskMonitorMachineContext,
  event:
    | TaskMonitorHumanDecisionEvent
    | Extract<TaskMonitorMachineEvent, { type: 'MONITOR_PERMISSION_DECIDED' }>,
): ApplyTaskMonitorDecisionEffect => {
  const pending = context.pendingIntervention;
  if (pending === null) throw new Error('Task Monitor has no pending intervention decision.');
  if (event.type === 'MONITOR_PERMISSION_DECIDED') {
    return {
      type: 'APPLY_TASK_MONITOR_DECISION',
      operation: event.resolution === 'APPROVE' ? 'RELEASE_EXACT_ACTION' : 'REJECT_EXACT_ACTION',
      providerDecision: event.providerDecision,
      taskMonitorId: context.taskMonitorId,
      interventionId: pending.interventionId,
      providerActionId: pending.providerActionId,
      providerSessionId: pending.providerSessionId,
      runId: pending.runId,
      agentSessionId: pending.agentSessionId,
      action: pending.action,
      target: pending.target,
      fingerprint: pending.fingerprint,
      decidedAt: event.decidedAt,
      human: null,
      monitorRationale: event.rationale,
      ...(pending.requestKind ? { requestKind: pending.requestKind } : {}),
    };
  }
  return {
    type: 'APPLY_TASK_MONITOR_DECISION',
    operation: event.resolution === 'APPROVE' ? 'RELEASE_EXACT_ACTION' : 'REJECT_EXACT_ACTION',
    providerDecision: event.providerDecision,
    taskMonitorId: context.taskMonitorId,
    interventionId: pending.interventionId,
    providerActionId: pending.providerActionId,
    providerSessionId: pending.providerSessionId,
    runId: pending.runId,
    agentSessionId: pending.agentSessionId,
    action: pending.action,
    target: pending.target,
    fingerprint: pending.fingerprint,
    decidedAt: event.decidedAt,
    human: event.human,
    monitorRationale: null,
    ...(pending.requestKind ? { requestKind: pending.requestKind } : {}),
  };
};

type PermissionRecordRequest = Pick<
  TaskMonitorPendingIntervention,
  'interventionId' | 'providerActionId' | 'action' | 'target'
>;

export const recordTaskMonitorPermissionDecisionEffect = (
  context: TaskMonitorMachineContext,
  event: Extract<
    TaskMonitorMachineEvent,
    { type: 'MONITOR_PERMISSION_DECIDED' | 'MONITOR_PERMISSION_ESCALATED' }
  >,
  request: PermissionRecordRequest | null = context.pendingIntervention,
): RecordTaskMonitorPermissionDecisionEffect => {
  if (request === null || context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no pending request to record a permission outcome for.');
  }

  return {
    type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    interventionId: request.interventionId,
    providerActionId: request.providerActionId,
    action: request.action,
    target: request.target,
    decision:
      event.type === 'MONITOR_PERMISSION_ESCALATED'
        ? 'ESCALATED'
        : event.resolution === 'APPROVE'
          ? 'APPROVED'
          : 'DENIED',
    rationale: event.type === 'MONITOR_PERMISSION_ESCALATED' ? event.reason : event.rationale,
  };
};

export const decideTaskMonitorPermissionEffect = (
  context: TaskMonitorMachineContext,
  event: Pick<
    Extract<TaskMonitorMachineEvent, { type: 'EXACT_ACTION_REQUIRED' }>,
    | 'interventionId'
    | 'providerActionId'
    | 'runId'
    | 'agentSessionId'
    | 'action'
    | 'target'
    | 'fingerprint'
    | 'createdAt'
    | 'expiresAt'
    | 'requestKind'
  >,
  options: { readonly monitorPaused?: true } = {},
): DecideTaskMonitorPermissionEffect => {
  if (context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no organization or project to decide a permission request.');
  }
  return {
    type: 'DECIDE_TASK_MONITOR_PERMISSION',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    interventionId: event.interventionId,
    providerActionId: event.providerActionId,
    runId: event.runId,
    agentSessionId: event.agentSessionId,
    action: event.action,
    target: event.target,
    fingerprint: event.fingerprint,
    createdAt: event.createdAt,
    expiresAt: event.expiresAt,
    ...(event.requestKind ? { requestKind: event.requestKind } : {}),
    ...(options.monitorPaused ? { monitorPaused: true as const } : {}),
    dueAt: monitorDecisionDueAt(event.createdAt),
  };
};

/** How long the monitor may take before a request it still holds goes to the person. */
export const MONITOR_PERMISSION_DECISION_DEADLINE_MS = 5 * 60 * 1000;

/** The due time starts when the request is created, so queueing and startup share one budget. */
export const monitorDecisionDueAt = (createdAt: string): string =>
  new Date(Date.parse(createdAt) + MONITOR_PERMISSION_DECISION_DEADLINE_MS).toISOString();

export const watchTaskMonitorPermissionDeadlineEffect = (
  context: TaskMonitorMachineContext,
  request: Pick<
    Extract<TaskMonitorMachineEvent, { type: 'EXACT_ACTION_REQUIRED' }>,
    'interventionId' | 'providerActionId' | 'runId' | 'agentSessionId' | 'createdAt' | 'requestKind'
  >,
): WatchTaskMonitorPermissionDeadlineEffect => ({
  type: 'WATCH_TASK_MONITOR_PERMISSION_DEADLINE',
  taskMonitorId: context.taskMonitorId,
  interventionId: request.interventionId,
  providerActionId: request.providerActionId,
  runId: request.runId,
  agentSessionId: request.agentSessionId,
  ...(request.requestKind ? { requestKind: request.requestKind } : {}),
  dueAt: monitorDecisionDueAt(request.createdAt),
});

type InterventionProjectionRequest = Pick<
  Extract<TaskMonitorMachineEvent, { type: 'EXACT_ACTION_REQUIRED' }>,
  | 'interventionId'
  | 'providerActionId'
  | 'runId'
  | 'agentSessionId'
  | 'action'
  | 'target'
  | 'fingerprint'
  | 'createdAt'
  | 'expiresAt'
>;

export const projectTaskMonitorInterventionEffect = (
  context: TaskMonitorMachineContext,
  event: InterventionProjectionRequest,
  alsoProject: readonly InterventionProjectionRequest[] = [],
): ProjectTaskMonitorInterventionEffect => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.conversationId === null
  ) {
    throw new Error('Task Monitor has no Conversation owner for intervention projection.');
  }
  return {
    type: 'PROJECT_TASK_MONITOR_INTERVENTION',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    conversationId: context.conversationId,
    interventionId: event.interventionId,
    providerActionId: event.providerActionId,
    runId: event.runId,
    agentSessionId: event.agentSessionId,
    action: event.action,
    target: event.target,
    fingerprint: event.fingerprint,
    createdAt: event.createdAt,
    expiresAt: event.expiresAt,
    ...(alsoProject.length > 0
      ? {
          alsoProject: alsoProject.map((request) => ({
            interventionId: request.interventionId,
            providerActionId: request.providerActionId,
            runId: request.runId,
            agentSessionId: request.agentSessionId,
            action: request.action,
            target: request.target,
            fingerprint: request.fingerprint,
            createdAt: request.createdAt,
            expiresAt: request.expiresAt,
          })),
        }
      : {}),
  };
};

export const evaluateTaskMonitorSettledRunEffect = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorRunSettledEvent,
): EvaluateTaskMonitorSettledRunEffect => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.authorityCommandId == null
  ) {
    throw new Error('Task Monitor has no canonical owner scope for settled-Run evaluation.');
  }
  return {
    type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    kindKey: context.kindKey ?? null,
    authorityCommandId: context.authorityCommandId,
    runId: event.runId,
    agentSessionId: event.agentSessionId,
    settledAt: event.settledAt,
    outcome: event.outcome,
    turnId: event.turnId,
    promptType: event.promptType,
    terminalOutcome: event.terminalOutcome,
    completedAssistantMessageId: event.completedAssistantMessageId,
    reports: event.reports,
    reviewRequestId: context.settledRun?.reviewRequestId ?? null,
  };
};

export const evaluateTaskMonitorResolvedJudgmentEffect = (
  context: TaskMonitorMachineContext,
  event: Extract<TaskMonitorMachineEvent, { type: 'JUDGMENT_RESOLVED' }>,
): EvaluateTaskMonitorSettledRunEffect => {
  if (
    context.organizationId === null ||
    context.projectId === null ||
    context.authorityCommandId == null ||
    context.settledRun === null
  ) {
    throw new Error('Task Monitor has no settled Run ready for resolved-judgment evaluation.');
  }
  return {
    type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    kindKey: context.kindKey ?? null,
    authorityCommandId: context.authorityCommandId,
    ...context.settledRun,
    judgment: event.judgment,
  };
};

export const deliverTaskMonitorReviewEffect = (
  context: TaskMonitorMachineContext,
  event: Extract<TaskMonitorMachineEvent, { type: 'REVIEW_REQUEST_COMMITTED' }>,
): DeliverTaskMonitorReviewEffect => {
  if (context.organizationId === null || context.projectId === null) {
    throw new Error('Task Monitor has no committed Review request ready for delivery.');
  }
  return {
    type: 'DELIVER_TASK_MONITOR_REVIEW',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    runId: event.runId,
    agentSessionId: event.agentSessionId,
    requestId: event.requestId,
    coordinatorRunId: event.coordinatorRunId,
    rationale: event.rationale,
  };
};

export const projectTaskMonitorOutcomeJudgmentEffect = (
  context: TaskMonitorMachineContext,
): ProjectTaskMonitorOutcomeJudgmentEffect => {
  const recovery = context.coordinatorRecovery;
  if (!context.organizationId || !context.projectId || !recovery)
    throw new Error('Missing committed coordinator recovery.');
  return {
    type: 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT',
    taskMonitorId: context.taskMonitorId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    requestId: recovery.requestId,
    failure: recovery.failure,
  };
};
