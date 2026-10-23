import type { TaskMonitorCoordinatorValidationFailure } from '../../../shared/agent-bridge-contract/generated/api';
import type {
  CoordinateTaskMonitorWorkEffect,
  EvaluateTaskMonitorSettledRunEffect,
} from './effects';
import type {
  MonitorCommandBody1 as MonitorCommandBody,
  TaskMonitorJudgmentResponse,
  TaskMonitorLaunchConfig,
} from '../../../shared/agent-bridge-contract/generated/api';
import type { WorkStatus } from '../../../shared/api/generated/api';
import type {
  TaskMonitorExecutionNode,
  TaskMonitorHumanDecisionEvidence,
  TaskMonitorHumanDecisionResolution,
  TaskMonitorLaunchDeclaration,
  TaskMonitorLaunchFailure,
  TaskMonitorWorktree,
  TaskMonitorTerminalPolicy,
} from './context';
import type { ReportType } from '../../../shared/api/generated/api';
import type { PermissionDecision } from '../../permission-response-routing';

export type VerifiedTaskMonitorCommand = MonitorCommandBody;

export interface TaskMonitorStartEvent {
  readonly type: 'START';
  readonly commandId: string;
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly launchConfig: TaskMonitorLaunchConfig;
  readonly userMessage?: string;
}

interface TaskMonitorPauseEvent {
  readonly type: 'PAUSE';
  readonly taskMonitorId: string;
}

interface TaskMonitorResumeEvent {
  readonly type: 'RESUME';
  readonly taskMonitorId: string;
  readonly commandId?: string | undefined;
}

interface TaskMonitorContinueEvent {
  readonly type: 'CONTINUE';
  readonly taskMonitorId: string;
}

interface TaskMonitorGuidanceChangedEvent {
  readonly type: 'GUIDANCE_CHANGED';
  readonly taskMonitorId: string;
  readonly guidance: string;
}

export interface TaskMonitorStopEvent {
  readonly type: 'STOP';
  readonly taskMonitorId: string;
}

export interface TaskMonitorHumanDecisionEvent {
  readonly type: 'HUMAN_DECISION';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly fingerprint: string;
  readonly resolution: TaskMonitorHumanDecisionResolution;
  readonly providerDecision: PermissionDecision;
  readonly decidedAt: string;
  readonly human: TaskMonitorHumanDecisionEvidence;
}

interface TaskMonitorJudgmentResolvedEvent {
  readonly type: 'JUDGMENT_RESOLVED';
  readonly taskMonitorId: string;
  readonly judgment: TaskMonitorJudgmentResponse;
}

export interface TaskMonitorConversationMessageReceivedEvent {
  readonly type: 'CONVERSATION_MESSAGE_RECEIVED';
  readonly taskMonitorId: string;
  readonly messageId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
}

export interface TaskMonitorConversationTurnStartedEvent {
  readonly type: 'CONVERSATION_TURN_STARTED';
  readonly taskMonitorId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly turnId: string;
}

export interface TaskMonitorConversationResponsePersistedEvent {
  readonly type: 'CONVERSATION_RESPONSE_PERSISTED';
  readonly taskMonitorId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly assistantMessageId: string;
}

export interface TaskMonitorConversationDeliveryFailedEvent {
  readonly type: 'CONVERSATION_DELIVERY_FAILED';
  readonly taskMonitorId: string;
  readonly messageId: string;
  readonly reason: string;
}

export type TaskMonitorExternalMachineEvent =
  | TaskMonitorStartEvent
  | TaskMonitorContinueEvent
  | TaskMonitorPauseEvent
  | TaskMonitorResumeEvent
  | TaskMonitorGuidanceChangedEvent
  | TaskMonitorStopEvent
  | TaskMonitorJudgmentResolvedEvent
  | TaskMonitorHumanDecisionEvent;

/** Closed, policy-free mapping from a verified transport command to one addressed event. */
export const taskMonitorEventFromVerifiedCommand = (
  input: VerifiedTaskMonitorCommand,
): TaskMonitorExternalMachineEvent | null => {
  const addressed = {
    taskMonitorId: input.target.workItemId,
  } as const;
  switch (input.command.cause) {
    case 'START':
      return {
        type: 'START',
        commandId: input.commandId,
        ...addressed,
        organizationId: input.organizationId,
        projectId: input.projectId,
        launchConfig: input.command.launchConfig,
        ...(input.command.userMessage === undefined
          ? {}
          : { userMessage: input.command.userMessage }),
      };
    case 'PAUSE':
    case 'CONTINUE':
    case 'STOP':
      return { type: input.command.cause, ...addressed };
    case 'RESUME':
      return { type: 'RESUME', ...addressed, commandId: input.commandId };
    case 'GUIDANCE_CHANGED':
      return { type: 'GUIDANCE_CHANGED', ...addressed, guidance: input.command.guidance };
    case 'JUDGMENT_RESOLVED':
      return {
        type: 'JUDGMENT_RESOLVED',
        ...addressed,
        judgment: input.command.judgment,
      };
    case 'HUMAN_DECISION':
      return {
        type: 'HUMAN_DECISION',
        ...addressed,
        interventionId: input.command.interventionId,
        providerActionId: input.command.providerActionId,
        runId: input.command.runId,
        agentSessionId: input.command.agentSessionId,
        fingerprint: input.command.fingerprint,
        resolution: input.command.resolution,
        providerDecision: input.command.resolution === 'APPROVE' ? 'approve' : 'deny',
        decidedAt: input.createdAt,
        human: input.command.human,
      };
    default:
      return null;
  }
};

export interface TaskMonitorExactActionRequiredEvent {
  readonly type: 'EXACT_ACTION_REQUIRED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface TaskMonitorInterventionProjectedEvent {
  readonly type: 'INTERVENTION_PROJECTED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly messageId: string;
}

interface TaskMonitorInterventionProjectionFailedEvent {
  readonly type: 'INTERVENTION_PROJECTION_FAILED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly reason: string;
}

interface TaskMonitorDecisionAppliedEvent {
  readonly type: 'DECISION_APPLIED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
}

interface TaskMonitorDecisionApplicationFailedEvent {
  readonly type: 'DECISION_APPLICATION_FAILED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly reason: string;
}

interface TaskMonitorDecisionApplicationStaleEvent {
  readonly type: 'DECISION_APPLICATION_STALE';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly reason: string;
}

interface TaskMonitorDecisionApplicationCancelledEvent {
  readonly type: 'DECISION_APPLICATION_CANCELLED';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly reason: string;
}

interface TaskMonitorDecisionApplicationUncertainEvent {
  readonly type: 'DECISION_APPLICATION_UNCERTAIN';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly reason: string;
}

export interface TaskMonitorRunSettledEvent {
  readonly type: 'RUN_SETTLED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly settledAt: string;
  readonly outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly turnId: string;
  readonly promptType: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly { readonly reportId: string; readonly reportType: ReportType }[];
}

interface TaskMonitorSupervisionContinuesObservingEvent {
  readonly type: 'SUPERVISION_CONTINUES_OBSERVING';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly nextAgentSessionId?: string | undefined;
  readonly nextConversationId?: string | undefined;
}

interface TaskMonitorReviewRequestCommittedEvent {
  readonly type: 'REVIEW_REQUEST_COMMITTED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly requestId: string;
  readonly coordinatorRunId: string;
  readonly rationale: string;
}

interface TaskMonitorReviewRequestAcceptedEvent {
  readonly type: 'REVIEW_REQUEST_ACCEPTED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly requestId: string;
}

interface TaskMonitorReviewRequestFailedEvent {
  readonly type: 'REVIEW_REQUEST_FAILED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly requestId: string;
  readonly reason: string;
  readonly ambiguous: boolean;
}

interface TaskMonitorCoordinationContinuesEvent {
  readonly type: 'COORDINATION_CONTINUES';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
}

interface TaskMonitorLaunchJudgmentRequiredEvent {
  readonly type: 'LAUNCH_JUDGMENT_REQUIRED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly reason: string;
}

interface TaskMonitorCoordinatorCorrectionDeferredEvent {
  readonly type: 'COORDINATOR_CORRECTION_DEFERRED';
  readonly taskMonitorId: string;
  readonly evaluation: CoordinateTaskMonitorWorkEffect | EvaluateTaskMonitorSettledRunEffect;
}

interface TaskMonitorCoordinatorDecisionInvalidEvent {
  readonly type: 'COORDINATOR_DECISION_INVALID';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly attemptId: string;
  readonly evaluation: CoordinateTaskMonitorWorkEffect | EvaluateTaskMonitorSettledRunEffect;
  readonly failure: TaskMonitorCoordinatorValidationFailure;
}

interface TaskMonitorOutcomeJudgmentProjectionEvent {
  readonly type: 'OUTCOME_JUDGMENT_PROJECTED';
  readonly taskMonitorId: string;
  readonly requestId: string;
  readonly messageId: string;
  readonly conversationId: string;
}

interface TaskMonitorOutcomeJudgmentProjectionFailedEvent {
  readonly type: 'OUTCOME_JUDGMENT_PROJECTION_FAILED';
  readonly taskMonitorId: string;
  readonly requestId: string;
  readonly reason: string;
}

interface TaskMonitorOutcomeJudgmentRequiredEvent {
  readonly type: 'OUTCOME_JUDGMENT_REQUIRED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly reason: string;
}

interface TaskMonitorSupervisionHaltedEvent {
  readonly type: 'SUPERVISION_HALTED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly reason: string;
}

interface TaskMonitorSupervisionCompletedEvent {
  readonly type: 'SUPERVISION_COMPLETED';
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
}

export interface TaskMonitorLoadedEvent {
  readonly type: 'MONITOR_LOADED';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly executionPlan: readonly TaskMonitorExecutionNode[];
  readonly cursor: number;
  readonly worktree: TaskMonitorWorktree | null;
  readonly terminalPolicy: TaskMonitorTerminalPolicy;
}

interface TaskMonitorLoadFailedEvent {
  readonly type: 'MONITOR_LOAD_FAILED';
  readonly taskMonitorId: string;
  readonly reason: string;
}

export interface TaskMonitorWorkSelectedEvent {
  readonly type: 'WORK_SELECTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
}

interface TaskMonitorWorkExhaustedEvent {
  readonly type: 'WORK_EXHAUSTED';
  readonly taskMonitorId: string;
  readonly cursor: number;
}

interface TaskMonitorCoordinationFailedEvent {
  readonly type: 'COORDINATION_FAILED';
  readonly taskMonitorId: string;
  readonly reason: string;
}

export interface TaskMonitorLaunchValidatedEvent {
  readonly type: 'LAUNCH_VALIDATED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly launch: TaskMonitorLaunchDeclaration;
}

interface TaskMonitorLaunchValidationFailedEvent {
  readonly type: 'LAUNCH_VALIDATION_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly reason: string;
}

export type TaskMonitorLaunchOperation =
  | 'TASK_ACTIVATION'
  | 'MONITOR_PROJECTION'
  | 'AGENT_SESSION_CREATION'
  | 'CONVERSATION_CREATION'
  | 'RUN_START';

interface TaskMonitorAgentSessionCreatedEvent {
  readonly type: 'AGENT_SESSION_CREATED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
}

interface TaskMonitorConversationCreatedEvent {
  readonly type: 'CONVERSATION_CREATED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
}

interface TaskMonitorRunStartedEvent {
  readonly type: 'RUN_STARTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
}

interface TaskMonitorLaunchPersistedEvent {
  readonly type: 'TASK_MONITOR_LAUNCH_PERSISTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
}

interface TaskMonitorLaunchRetryAdmittedEvent {
  readonly type: 'LAUNCH_RETRY_ADMITTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
}

interface TaskMonitorLaunchRetryRejectedEvent {
  readonly type: 'LAUNCH_RETRY_REJECTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly reason: string;
}

interface TaskMonitorLaunchPersistenceFailedEvent {
  readonly type: 'TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly reason: string;
}

interface TaskMonitorStopSucceededEvent {
  readonly type: 'TASK_MONITOR_STOP_SUCCEEDED';
  readonly taskMonitorId: string;
}

interface TaskMonitorStopFailedEvent {
  readonly type: 'TASK_MONITOR_STOP_FAILED';
  readonly taskMonitorId: string;
  readonly reason: string;
}

interface TaskMonitorStopCancelledEvent {
  readonly type: 'TASK_MONITOR_STOP_CANCELLED';
  readonly taskMonitorId: string;
  readonly reason: string;
}

interface TaskMonitorStopUncertainEvent {
  readonly type: 'TASK_MONITOR_STOP_UNCERTAIN';
  readonly taskMonitorId: string;
  readonly reason: string;
}

interface TaskMonitorControlStatusProjectedEvent {
  readonly type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED';
  readonly taskMonitorId: string;
  readonly status: Extract<WorkStatus, 'ACTIVE' | 'ON_HOLD'>;
}

interface TaskMonitorControlStatusProjectionFailure {
  readonly taskMonitorId: string;
  readonly status: Extract<WorkStatus, 'ACTIVE' | 'ON_HOLD'>;
  readonly reason: string;
}

interface TaskMonitorControlStatusProjectionFailedEvent extends TaskMonitorControlStatusProjectionFailure {
  readonly type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED';
}

interface TaskMonitorControlStatusProjectionCancelledEvent extends TaskMonitorControlStatusProjectionFailure {
  readonly type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED';
}

interface TaskMonitorControlStatusProjectionUncertainEvent extends TaskMonitorControlStatusProjectionFailure {
  readonly type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN';
}

interface TaskMonitorLaunchOperationFailedEvent {
  readonly type: 'LAUNCH_OPERATION_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly operation: 'AGENT_SESSION_CREATION' | 'CONVERSATION_CREATION' | 'RUN_START';
  readonly reason: string;
}

interface TaskMonitorLaunchOperationCancelledEvent {
  readonly type: 'LAUNCH_OPERATION_CANCELLED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly operation: 'AGENT_SESSION_CREATION' | 'CONVERSATION_CREATION' | 'RUN_START';
  readonly reason: string;
}

interface TaskMonitorLaunchOperationUncertainEvent {
  readonly type: 'LAUNCH_OPERATION_UNCERTAIN';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: 'AGENT_SESSION_CREATION' | 'CONVERSATION_CREATION' | 'RUN_START';
  readonly agentSessionId: string;
  readonly conversationId?: string | undefined;
  readonly reason: string;
}

interface TaskMonitorLaunchRecoveryProjectedEvent {
  readonly type: 'LAUNCH_RECOVERY_PROJECTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
  readonly fingerprint: string;
  readonly messageId: string;
}

interface TaskMonitorLaunchRecoveryProjectionFailedEvent {
  readonly type: 'LAUNCH_RECOVERY_PROJECTION_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly agentSessionId: string;
  readonly fingerprint: string;
  readonly reason: string;
}

interface TaskMonitorLaunchValidationUncertainEvent {
  readonly type: 'LAUNCH_VALIDATION_UNCERTAIN';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: 'TASK_ACTIVATION' | 'MONITOR_PROJECTION';
  readonly reason: string;
}

export interface TaskMonitorLaunchFailureReportedEvent {
  readonly type: 'LAUNCH_FAILURE_REPORTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failure: TaskMonitorLaunchFailure;
}

interface TaskMonitorOperationFoundEvent {
  readonly type: 'OPERATION_FOUND';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: TaskMonitorLaunchOperation;
  readonly agentSessionId?: string | undefined;
  readonly conversationId?: string | undefined;
}

interface TaskMonitorOperationAbsentEvent {
  readonly type: 'OPERATION_ABSENT';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: TaskMonitorLaunchOperation;
}

interface TaskMonitorReconciliationFailedEvent {
  readonly type: 'RECONCILIATION_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly operation: TaskMonitorLaunchOperation;
  readonly reason: string;
}

interface TaskMonitorTaskStartedProjectedEvent {
  readonly type: 'TASK_STARTED_PROJECTED';
  readonly taskMonitorId: string;
  readonly taskId: string;
}

interface TaskMonitorTaskStartedProjectionFailedEvent {
  readonly type: 'TASK_STARTED_PROJECTION_FAILED';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly reason: string;
}

export type TaskMonitorMachineEvent =
  | TaskMonitorStartEvent
  | TaskMonitorContinueEvent
  | TaskMonitorPauseEvent
  | TaskMonitorResumeEvent
  | TaskMonitorGuidanceChangedEvent
  | TaskMonitorStopEvent
  | TaskMonitorJudgmentResolvedEvent
  | TaskMonitorConversationMessageReceivedEvent
  | TaskMonitorConversationTurnStartedEvent
  | TaskMonitorConversationResponsePersistedEvent
  | TaskMonitorConversationDeliveryFailedEvent
  | TaskMonitorHumanDecisionEvent
  | TaskMonitorExactActionRequiredEvent
  | TaskMonitorInterventionProjectedEvent
  | TaskMonitorInterventionProjectionFailedEvent
  | TaskMonitorDecisionAppliedEvent
  | TaskMonitorDecisionApplicationStaleEvent
  | TaskMonitorDecisionApplicationFailedEvent
  | TaskMonitorDecisionApplicationCancelledEvent
  | TaskMonitorDecisionApplicationUncertainEvent
  | TaskMonitorRunSettledEvent
  | TaskMonitorControlStatusProjectedEvent
  | TaskMonitorControlStatusProjectionFailedEvent
  | TaskMonitorControlStatusProjectionCancelledEvent
  | TaskMonitorControlStatusProjectionUncertainEvent
  | TaskMonitorSupervisionContinuesObservingEvent
  | TaskMonitorReviewRequestCommittedEvent
  | TaskMonitorReviewRequestAcceptedEvent
  | TaskMonitorReviewRequestFailedEvent
  | TaskMonitorCoordinationContinuesEvent
  | TaskMonitorLaunchJudgmentRequiredEvent
  | TaskMonitorCoordinatorCorrectionDeferredEvent
  | TaskMonitorCoordinatorDecisionInvalidEvent
  | TaskMonitorOutcomeJudgmentProjectionEvent
  | TaskMonitorOutcomeJudgmentProjectionFailedEvent
  | TaskMonitorOutcomeJudgmentRequiredEvent
  | TaskMonitorSupervisionHaltedEvent
  | TaskMonitorSupervisionCompletedEvent
  | TaskMonitorLoadedEvent
  | TaskMonitorLoadFailedEvent
  | TaskMonitorWorkSelectedEvent
  | TaskMonitorWorkExhaustedEvent
  | TaskMonitorCoordinationFailedEvent
  | TaskMonitorLaunchValidatedEvent
  | TaskMonitorLaunchValidationFailedEvent
  | TaskMonitorLaunchValidationUncertainEvent
  | TaskMonitorLaunchFailureReportedEvent
  | TaskMonitorAgentSessionCreatedEvent
  | TaskMonitorConversationCreatedEvent
  | TaskMonitorRunStartedEvent
  | TaskMonitorLaunchPersistedEvent
  | TaskMonitorLaunchRetryAdmittedEvent
  | TaskMonitorLaunchRetryRejectedEvent
  | TaskMonitorLaunchPersistenceFailedEvent
  | TaskMonitorStopSucceededEvent
  | TaskMonitorStopFailedEvent
  | TaskMonitorStopCancelledEvent
  | TaskMonitorStopUncertainEvent
  | TaskMonitorLaunchOperationFailedEvent
  | TaskMonitorLaunchOperationCancelledEvent
  | TaskMonitorLaunchOperationUncertainEvent
  | TaskMonitorLaunchRecoveryProjectedEvent
  | TaskMonitorLaunchRecoveryProjectionFailedEvent
  | TaskMonitorOperationFoundEvent
  | TaskMonitorOperationAbsentEvent
  | TaskMonitorReconciliationFailedEvent
  | TaskMonitorTaskStartedProjectedEvent
  | TaskMonitorTaskStartedProjectionFailedEvent;

interface AddressedTaskMonitorInput {
  readonly identity: {
    readonly machineType: 'TASK_MONITOR';
    readonly instanceId: string;
  };
  readonly ingressId: string;
}

export interface VerifiedTaskMonitorProviderInterventionInput extends AddressedTaskMonitorInput {
  readonly source: 'PROVIDER_INTERVENTION';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly providerSessionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type TaskMonitorExecutionPhase = 'IMPLEMENTATION' | 'REVIEW';

interface VerifiedTaskMonitorExecutionTurnReleasedInput extends AddressedTaskMonitorInput {
  readonly source: 'EXECUTION_TURN_RELEASED';
  readonly phase: TaskMonitorExecutionPhase;
  readonly taskMonitorId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly turnId: string;
  readonly settledAt: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
  readonly reports: readonly { readonly reportId: string; readonly reportType: ReportType }[];
}

export interface VerifiedTaskMonitorLaunchFailureInput extends AddressedTaskMonitorInput {
  readonly source: 'LAUNCH_FAILURE';
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly cursor: number;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failure: TaskMonitorLaunchFailure;
}

export interface VerifiedTaskMonitorHumanDecisionInput extends AddressedTaskMonitorInput {
  readonly source: 'HUMAN_DECISION';
  readonly taskMonitorId: string;
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly fingerprint: string;
  readonly resolution: TaskMonitorHumanDecisionResolution;
  readonly providerDecision: PermissionDecision;
  readonly decidedAt: string;
  readonly human: TaskMonitorHumanDecisionEvidence;
}

interface VerifiedTaskMonitorConversationInput extends AddressedTaskMonitorInput {
  readonly source: 'CONVERSATION_MESSAGE';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

export type VerifiedTaskMonitorInput =
  | MonitorCommandBody
  | VerifiedTaskMonitorProviderInterventionInput
  | VerifiedTaskMonitorExecutionTurnReleasedInput
  | VerifiedTaskMonitorLaunchFailureInput
  | VerifiedTaskMonitorHumanDecisionInput
  | VerifiedTaskMonitorConversationInput;

export const taskMonitorEventFromVerifiedInput = (
  input: Exclude<VerifiedTaskMonitorInput, MonitorCommandBody>,
):
  | TaskMonitorExactActionRequiredEvent
  | TaskMonitorRunSettledEvent
  | TaskMonitorLaunchFailureReportedEvent
  | TaskMonitorHumanDecisionEvent
  | TaskMonitorConversationMessageReceivedEvent => {
  switch (input.source) {
    case 'PROVIDER_INTERVENTION':
      return {
        type: 'EXACT_ACTION_REQUIRED',
        taskMonitorId: input.taskMonitorId,
        interventionId: input.interventionId,
        providerActionId: input.providerActionId,
        providerSessionId: input.providerSessionId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
        action: input.action,
        target: input.target,
        fingerprint: input.fingerprint,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
    case 'EXECUTION_TURN_RELEASED':
      return {
        type: 'RUN_SETTLED',
        taskMonitorId: input.taskMonitorId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
        settledAt: input.settledAt,
        outcome: input.terminalOutcome === 'ABORTED' ? 'CANCELLED' : input.terminalOutcome,
        turnId: input.turnId,
        promptType: input.phase === 'REVIEW' ? 'code_review' : 'implementation',
        terminalOutcome: input.terminalOutcome,
        completedAssistantMessageId: input.completedAssistantMessageId,
        reports: input.reports,
      };
    case 'LAUNCH_FAILURE':
      return {
        type: 'LAUNCH_FAILURE_REPORTED',
        taskMonitorId: input.taskMonitorId,
        taskId: input.taskId,
        cursor: input.cursor,
        agentSessionId: input.agentSessionId,
        conversationId: input.conversationId,
        failure: input.failure,
      };
    case 'HUMAN_DECISION':
      return {
        type: 'HUMAN_DECISION',
        taskMonitorId: input.taskMonitorId,
        interventionId: input.interventionId,
        providerActionId: input.providerActionId,
        runId: input.runId,
        agentSessionId: input.agentSessionId,
        fingerprint: input.fingerprint,
        resolution: input.resolution,
        providerDecision: input.providerDecision,
        decidedAt: input.decidedAt,
        human: input.human,
      };
    case 'CONVERSATION_MESSAGE':
      return {
        type: 'CONVERSATION_MESSAGE_RECEIVED',
        taskMonitorId: input.taskMonitorId,
        messageId: input.messageId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId: input.conversationId,
      };
  }
};

export type TaskMonitorMachineEffectOutcome = Exclude<
  TaskMonitorMachineEvent,
  | TaskMonitorStartEvent
  | TaskMonitorContinueEvent
  | TaskMonitorPauseEvent
  | TaskMonitorResumeEvent
  | TaskMonitorGuidanceChangedEvent
  | TaskMonitorStopEvent
  | TaskMonitorJudgmentResolvedEvent
  | TaskMonitorHumanDecisionEvent
  | TaskMonitorExactActionRequiredEvent
  | TaskMonitorRunSettledEvent
  | TaskMonitorLaunchFailureReportedEvent
  | TaskMonitorConversationMessageReceivedEvent
>;

export type { TaskMonitorMachineEffect } from './effects';
