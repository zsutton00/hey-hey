import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorStateMachineInputAdapter,
  TaskMonitorVerifiedAdmissionResult,
} from './state-machine-input-adapter';
import type { TaskMonitorStateStore } from '../agents/task-monitor/state-machine/machine';
import type { ServerLogger } from './logger';
import type { TaskMonitorLaunchFailureEvent } from './task-monitor-launch-failure-runtime';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import type { VerifiedTaskMonitorLaunchFailureInput } from '../agents/task-monitor/state-machine/events';

/** Validates launch-failure identity against canonical state before machine admission. */
export class TaskMonitorLaunchFailureAdapter {
  private unsubscribe: (() => void) | null = null;

  public constructor(
    private readonly runtime: TaskMonitorLaunchFailureRuntime,
    private readonly stateStore: TaskMonitorStateStore,
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly logger: ServerLogger,
  ) {}

  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe(this.handle);
    this.logger.debug('task_monitor.launch_failure.adapter.started');
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.logger.debug('task_monitor.launch_failure.adapter.disposed');
  }

  private readonly handle = async (event: TaskMonitorLaunchFailureEvent): Promise<void> => {
    this.logger.debug('task_monitor.launch_failure.adapter.received', {
      taskMonitorId: event.taskMonitorId,
      taskId: event.taskId,
      runId: event.runId,
      agentSessionId: event.agentSessionId,
      conversationId: event.conversationId,
      fingerprint: event.failure.fingerprint,
      eventId: event.eventId,
    });
    try {
      const instance = await this.stateStore.findByInstanceId(event.taskMonitorId);
      const context = instance?.snapshot.context;
      const rejection = this.validateCanonicalIdentity(context, event);
      if (rejection) {
        this.logger.warn('task_monitor.launch_failure.adapter.rejected', {
          taskMonitorId: event.taskMonitorId,
          taskId: event.taskId,
          agentSessionId: event.agentSessionId,
          fingerprint: event.failure.fingerprint,
          eventId: event.eventId,
          reason: rejection,
        });
        return;
      }
      if (!context || context.cursor === null) {
        this.logger.warn('task_monitor.launch_failure.adapter.rejected', {
          taskMonitorId: event.taskMonitorId,
          eventId: event.eventId,
          reason: 'canonical_launch_context_missing',
        });
        return;
      }

      const input: VerifiedTaskMonitorLaunchFailureInput = {
        source: 'LAUNCH_FAILURE',
        identity: { machineType: 'TASK_MONITOR', instanceId: event.taskMonitorId },
        ingressId: event.eventId,
        taskMonitorId: event.taskMonitorId,
        taskId: event.taskId,
        cursor: context.cursor,
        agentSessionId: event.agentSessionId,
        conversationId: event.conversationId,
        failure: event.failure,
      };
      const result = await this.inputAdapter.admitVerified(input);
      this.logAdmission(event, result);
    } catch (error) {
      this.logger.error('task_monitor.launch_failure.adapter.failed', {
        taskMonitorId: event.taskMonitorId,
        taskId: event.taskId,
        agentSessionId: event.agentSessionId,
        fingerprint: event.failure.fingerprint,
        eventId: event.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  private validateCanonicalIdentity(
    context: TaskMonitorMachineContext | undefined,
    event: TaskMonitorLaunchFailureEvent,
  ): string | null {
    if (!context) return 'machine_not_found';
    if (context.taskMonitorId !== event.taskMonitorId) return 'task_monitor_identity_mismatch';
    if (context.selectedTaskId !== event.taskId) return 'selected_task_mismatch';
    if (context.agentSessionId !== event.agentSessionId) return 'agent_session_mismatch';
    if (context.conversationId !== event.conversationId) return 'conversation_mismatch';
    if (context.cursor === null) return 'cursor_missing';
    if (context.executionPlan[context.cursor]?.taskId !== event.taskId) {
      return 'execution_cursor_mismatch';
    }
    return null;
  }

  private logAdmission(
    event: TaskMonitorLaunchFailureEvent,
    result: TaskMonitorVerifiedAdmissionResult,
  ): void {
    if (result.status === 'accepted' || result.status === 'replayed') {
      this.logger.info('task_monitor.launch_failure.adapter.admitted', {
        taskMonitorId: event.taskMonitorId,
        taskId: event.taskId,
        agentSessionId: event.agentSessionId,
        fingerprint: event.failure.fingerprint,
        eventId: event.eventId,
        status: result.status,
        revision: result.snapshot.revision,
      });
      return;
    }
    this.logger.warn('task_monitor.launch_failure.adapter.rejected', {
      taskMonitorId: event.taskMonitorId,
      taskId: event.taskId,
      agentSessionId: event.agentSessionId,
      fingerprint: event.failure.fingerprint,
      eventId: event.eventId,
      reason: result.reason,
    });
  }
}
