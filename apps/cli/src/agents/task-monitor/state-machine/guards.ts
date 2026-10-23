import type { TaskMonitorMachineContext } from './context';
import type { TaskMonitorLaunchOperation, TaskMonitorMachineEvent } from './events';

interface GuardArguments {
  readonly context: TaskMonitorMachineContext;
  readonly event: TaskMonitorMachineEvent;
}

export const matchesTaskMonitor = ({ context, event }: GuardArguments): boolean =>
  'taskMonitorId' in event && event.taskMonitorId === context.taskMonitorId;

export const matchesLoadedTaskMonitor = ({ context, event }: GuardArguments): boolean =>
  event.type === 'MONITOR_LOADED' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.organizationId === context.organizationId &&
  event.projectId === context.projectId;

export const matchesCoordinatedWork = ({ context, event }: GuardArguments): boolean =>
  event.type === 'WORK_SELECTED' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.cursor >= (context.cursor ?? 0) &&
  context.executionPlan[event.cursor]?.taskId === event.taskId;

export const matchesExhaustedWork = ({ context, event }: GuardArguments): boolean =>
  event.type === 'WORK_EXHAUSTED' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.cursor === context.executionPlan.length;

export const matchesSelectedWork = ({ context, event }: GuardArguments): boolean =>
  (event.type === 'LAUNCH_VALIDATED' ||
    event.type === 'LAUNCH_VALIDATION_FAILED' ||
    event.type === 'LAUNCH_VALIDATION_UNCERTAIN' ||
    event.type === 'LAUNCH_OPERATION_UNCERTAIN' ||
    event.type === 'OPERATION_FOUND' ||
    event.type === 'OPERATION_ABSENT' ||
    event.type === 'RECONCILIATION_FAILED') &&
  event.taskMonitorId === context.taskMonitorId &&
  event.taskId === context.selectedTaskId &&
  event.cursor === context.cursor;

export const matchesSelectedOperation = (
  operation: TaskMonitorLaunchOperation,
  arguments_: GuardArguments,
): boolean => {
  const { event } = arguments_;
  return (
    matchesSelectedWork(arguments_) &&
    (event.type === 'LAUNCH_VALIDATION_UNCERTAIN' ||
      event.type === 'LAUNCH_OPERATION_UNCERTAIN' ||
      event.type === 'OPERATION_FOUND' ||
      event.type === 'OPERATION_ABSENT' ||
      event.type === 'RECONCILIATION_FAILED') &&
    event.operation === operation
  );
};

export const matchesSelectedLaunch = ({ context, event }: GuardArguments): boolean =>
  (event.type === 'AGENT_SESSION_CREATED' ||
    event.type === 'CONVERSATION_CREATED' ||
    event.type === 'RUN_STARTED' ||
    event.type === 'TASK_MONITOR_LAUNCH_PERSISTED' ||
    event.type === 'TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED' ||
    event.type === 'TASK_STARTED_PROJECTED' ||
    event.type === 'TASK_STARTED_PROJECTION_FAILED' ||
    event.type === 'LAUNCH_OPERATION_FAILED' ||
    event.type === 'LAUNCH_OPERATION_CANCELLED') &&
  event.taskMonitorId === context.taskMonitorId &&
  event.taskId === context.selectedTaskId;

export const matchesLaunchFailure = ({ context, event }: GuardArguments): boolean =>
  event.type === 'LAUNCH_FAILURE_REPORTED' &&
  event.taskMonitorId === context.taskMonitorId &&
  event.taskId === context.selectedTaskId &&
  event.cursor === context.cursor &&
  event.agentSessionId === context.agentSessionId &&
  event.conversationId === context.conversationId &&
  context.retryableLaunch?.failure?.fingerprint !== event.failure.fingerprint;
