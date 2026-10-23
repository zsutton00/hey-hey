import { taskMonitorExactActionInputFromProviderEvent } from '../agents/task-monitor/state-machine/provider-event-adapter';
import type { RunRegistry } from '../run/run-registry';
import type { AgentOutputEvents } from './agent-output-events';
import type { ServerLogger } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';

/** Owns live provider-event admission into the addressed Task Monitor machine. */
export class TaskMonitorProviderEventAdmission {
  private unsubscribe: (() => void) | null = null;

  public constructor(
    private readonly runRegistry: RunRegistry,
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly logger: ServerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  public start(events: AgentOutputEvents): void {
    if (this.unsubscribe) return;
    this.unsubscribe = events.onAgentOutput(this.handle);
    this.logger.debug('task_monitor.provider_event_admission.started');
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.logger.debug('task_monitor.provider_event_admission.stopped');
  }

  private readonly handle = (rawEvent: Parameters<AgentOutputEvents['publish']>[0]): void => {
    const run = this.runRegistry.get(rawEvent.runId);
    const taskMonitorId = run?.taskMonitorId;
    if (!run || taskMonitorId === null || taskMonitorId === undefined) return;

    const input = taskMonitorExactActionInputFromProviderEvent(
      {
        owner: {
          taskMonitorId,
          runId: rawEvent.runId,
          agentSessionId: run.agentSessionId,
        },
        event: { runId: rawEvent.runId, ...rawEvent.envelope },
      },
      undefined,
      this.now,
    );
    if (!input) return;

    this.logger.info('task_monitor.provider_event_admission.admitting', {
      taskMonitorId,
      runId: rawEvent.runId,
      agentSessionId: run.agentSessionId,
      ingressId: input.ingressId,
      providerActionId: input.providerActionId,
    });
    void this.inputAdapter
      .admitVerified(input)
      .then((result) => {
        this.logger[result.status === 'rejected' ? 'warn' : 'info'](
          'task_monitor.provider_event_admission.completed',
          {
            taskMonitorId,
            runId: rawEvent.runId,
            ingressId: input.ingressId,
            status: result.status,
            ...(result.status === 'rejected' ? { code: result.code, reason: result.reason } : {}),
          },
        );
      })
      .catch((error: Error) => {
        this.logger.error('task_monitor.provider_event_admission.failed', {
          taskMonitorId,
          runId: rawEvent.runId,
          ingressId: input.ingressId,
          error,
        });
      });
  };
}
