import type { KeyPairStore } from '../credentials';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorMachineRuntime,
  TaskMonitorMachineState,
  TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type { MachineSnapshot } from '../state-machine';
import type { TaskMonitorStateProjection } from '../shared/api/generated/api';
import type { PlatformWebSocketManager } from './platform-ws';
import type { ServerLogger } from './logger';
import { COORDINATOR_RECOVERY_GUIDANCE } from '../agents/task-monitor/task-monitor-coordinator-recovery';

type Snapshot = MachineSnapshot<string, TaskMonitorMachineState, TaskMonitorMachineContext>;

export const taskMonitorStateProjection = ({
  state,
  context,
}: Snapshot): TaskMonitorStateProjection => {
  const running = typeof state === 'object' ? state.RUNNING : null;
  const execution = running
    ? {
        lifecycle: 'RUNNING' as const,
        control: running.control,
        work: running.work,
        intervention: running.intervention,
      }
    : {
        lifecycle: typeof state === 'string' ? state : ('ABSENT' as const),
        control: null,
        work: null,
        intervention: null,
      };
  const availableActions: TaskMonitorStateProjection['availableActions'] = [];
  if (running) {
    availableActions.push({ kind: 'STOP', command: 'STOP' });
    if (running.control === 'ACTIVE') availableActions.push({ kind: 'PAUSE', command: 'PAUSE' });
    if (running.control === 'PAUSED')
      availableActions.push({ kind: 'PAUSED_CONTINUATION', command: 'RESUME' });
  }
  const recovery = context.coordinatorRecovery;
  const cause = recovery
    ? `${recovery.failure.code}: ${recovery.failure.message}${context.failureReason && context.failureReason !== recovery.failure.message ? ` Current recovery failure: ${context.failureReason}` : ''}${recovery.deliveryFailure ? ` Recovery request delivery failed: ${recovery.deliveryFailure}` : ''}`
    : context.failureReason;
  return {
    execution,
    availableActions,
    ...(cause
      ? {
          failure: {
            code: 'OPERATION_FAILED' as const,
            cause,
            correctiveGuidance: recovery
              ? running?.work === 'OUTCOME_JUDGMENT'
                ? COORDINATOR_RECOVERY_GUIDANCE
                : `Automatic correction ${recovery.correctionAttempt} of 2 is pending or being assessed. Pause or stop the monitor to intervene.`
              : 'Inspect the reported failure and stop the monitor if recovery is required.',
          },
        }
      : {}),
  };
};

/** Publishes complete committed snapshots independently of coding Run availability. */
export class TaskMonitorStatePublication {
  private readonly stopWatching: () => void;
  private readonly stopReconnect: () => void;
  private readonly tails = new Map<string, Promise<void>>();
  private disposed = false;

  public constructor(
    runtime: TaskMonitorMachineRuntime,
    private readonly store: TaskMonitorStateStore,
    private readonly websocket: PlatformWebSocketManager,
    private readonly keys: KeyPairStore,
    private readonly logger: ServerLogger,
  ) {
    this.stopWatching = runtime.onTransitionCommitted(null, (snapshot) => {
      void this.publish(snapshot);
    });
    this.stopReconnect = websocket.onReconnect(() => {
      void this.replay().catch((error) =>
        this.logger.error('task_monitor.state.replay.failed', { error }),
      );
    });
  }

  public async replay(): Promise<void> {
    const instances = await this.store.listInstances();
    await Promise.all(instances.map(({ snapshot }) => this.publish(snapshot)));
  }

  public publish(snapshot: Snapshot): Promise<void> {
    const id = snapshot.identity.instanceId;
    const prior = this.tails.get(id) ?? Promise.resolve();
    const next = prior
      .then(async () => {
        if (this.disposed || snapshot.identity.machineType !== 'TASK_MONITOR') return;
        const machineId = await this.keys.loadCurrentMachineId();
        if (!machineId)
          throw new Error('Task Monitor state publication requires the paired machine identity.');
        this.websocket.emitTaskMonitorStateObservation({
          taskMonitorId: id,
          machineId,
          sourceRevision: snapshot.revision,
          projection: taskMonitorStateProjection(snapshot),
        });
        this.logger.debug('task_monitor.state.published', {
          taskMonitorId: id,
          sourceRevision: snapshot.revision,
        });
      })
      .catch((error) =>
        this.logger.error('task_monitor.state.publication.failed', {
          taskMonitorId: id,
          sourceRevision: snapshot.revision,
          error,
        }),
      );
    this.tails.set(id, next);
    void next.finally(() => {
      if (this.tails.get(id) === next) this.tails.delete(id);
    });
    return next;
  }

  public dispose(): void {
    this.disposed = true;
    this.stopWatching();
    this.stopReconnect();
  }
}
