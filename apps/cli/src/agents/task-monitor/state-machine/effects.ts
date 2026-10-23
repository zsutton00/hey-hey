import type { WorkStatus } from '../../../shared/api/generated/api';
import type {
  TaskMonitorExecutionNode,
  TaskMonitorLaunchDeclaration,
  TaskMonitorLaunchFailure,
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
} from '../../../shared/agent-bridge-contract/generated/api';

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

export type TaskMonitorControlStatus = Extract<WorkStatus, 'ACTIVE' | 'ON_HOLD'>;

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
  readonly human: {
    readonly userId: string;
    readonly authenticatedAt: string;
  };
}

export interface EvaluateTaskMonitorSettledRunEffect {
  readonly type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
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
  readonly expiresAt: string;
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
  event: TaskMonitorHumanDecisionEvent,
): ApplyTaskMonitorDecisionEffect => {
  const pending = context.pendingIntervention;
  if (pending === null) throw new Error('Task Monitor has no pending intervention decision.');
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
  };
};

export const projectTaskMonitorInterventionEffect = (
  context: TaskMonitorMachineContext,
  event: Extract<TaskMonitorMachineEvent, { type: 'EXACT_ACTION_REQUIRED' }>,
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
