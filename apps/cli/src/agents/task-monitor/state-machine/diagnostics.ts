import { MachineDiagnosticReader, type MachineDiagnosticView } from '../../../state-machine';
import type { TaskMonitorMachineContext } from './context';
import type { TaskMonitorMachineState, TaskMonitorStateStore } from './machine';

export interface TaskMonitorDiagnosticState {
  readonly lifecycleState: 'ABSENT' | 'RUNNING' | 'HALTED' | 'COMPLETED';
  readonly controlState: string;
  readonly executionState: string;
  readonly interventionState: string | null;
  readonly inputState: string | null;
}

export interface TaskMonitorSelectedWorkCorrelation {
  readonly taskMonitorId: string;
  readonly selectedTaskId: string | null;
  readonly cursor: number | null;
  readonly agentSessionId: string | null;
  readonly activeRunAgentSessionId: string | null;
  readonly conversationId: string | null;
  readonly coordinationCause: string | null;
  readonly coordinationCorrelationId: string | null;
}

export type TaskMonitorMachineDiagnosticView = MachineDiagnosticView<
  string,
  TaskMonitorDiagnosticState,
  TaskMonitorSelectedWorkCorrelation
>;

const projectTaskMonitorState = (state: TaskMonitorMachineState): TaskMonitorDiagnosticState => {
  if (typeof state === 'string') {
    return {
      lifecycleState: state,
      controlState: state,
      executionState: state,
      interventionState: null,
      inputState: null,
    };
  }
  return {
    lifecycleState: 'RUNNING',
    controlState: state.RUNNING.control,
    executionState: state.RUNNING.work,
    interventionState: state.RUNNING.intervention,
    inputState: state.RUNNING.input,
  };
};

const projectSelectedWorkCorrelation = (
  context: TaskMonitorMachineContext,
): TaskMonitorSelectedWorkCorrelation => ({
  taskMonitorId: context.taskMonitorId,
  selectedTaskId: context.selectedTaskId,
  cursor: context.cursor,
  agentSessionId: context.agentSessionId,
  activeRunAgentSessionId: context.activeRunAgentSessionId,
  conversationId: context.conversationId,
  coordinationCause: null,
  coordinationCorrelationId: context.authorityCommandId ?? null,
});

/** Owns the Task Monitor-safe projection of generic durable machine evidence. */
export class TaskMonitorMachineDiagnosticReader {
  private readonly reader: MachineDiagnosticReader<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineContext,
    import('./effects').TaskMonitorMachineEffect,
    import('./events').TaskMonitorMachineEffectOutcome,
    TaskMonitorDiagnosticState,
    TaskMonitorSelectedWorkCorrelation
  >;

  public constructor(store: TaskMonitorStateStore) {
    this.reader = new MachineDiagnosticReader(
      store,
      projectTaskMonitorState,
      projectSelectedWorkCorrelation,
    );
  }

  public inspect(instanceId: string): Promise<TaskMonitorMachineDiagnosticView | null> {
    return this.reader.inspect(instanceId);
  }
}
