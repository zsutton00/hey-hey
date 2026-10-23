import type { TaskMonitorManagedTurnRuntime } from '../task-monitor-managed-turn-runtime';
import type { ServerLogger } from '../logger';
import type { MonitorPipeline } from '.';
import type { AgentSource } from './normalizer';

/** Publishes canonical settled-Turn liveness through the local monitor lane. */
export class TaskMonitorManagedTurnPublisher {
  private unsubscribe: (() => void) | null = null;

  public constructor(
    private readonly runtime: TaskMonitorManagedTurnRuntime,
    private readonly agentSource: AgentSource,
    private readonly monitorPipeline: MonitorPipeline,
    private readonly logger: ServerLogger,
  ) {}

  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe((settledTurn) => {
      const event = this.agentSource.ingest(settledTurn);
      if (!event) {
        this.logger.warn('monitors.settled_turn.normalization_failed', {
          agentSessionId: settledTurn.agentSessionId,
          turnId: settledTurn.turnId,
        });
        return;
      }
      this.monitorPipeline.ingest(event);
    });
  }

  public dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
