import type { KeyPairStore } from '../credentials';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorMachineRuntime,
  TaskMonitorMachineState,
  TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type { MachineSnapshot } from '../state-machine';
import type {
  TaskMonitorStateProjection,
  WorkItemExecutionStateObservation,
} from '@hey-hey/contracts/api/models';
import type { PlatformWebSocketManager, WorkItemExecutionStateReport } from './platform-ws';
import type { ServerLogger } from './logger';
import { COORDINATOR_RECOVERY_GUIDANCE } from '../agents/task-monitor/task-monitor-coordinator-recovery';

type Snapshot = MachineSnapshot<string, TaskMonitorMachineState, TaskMonitorMachineContext>;
type LifecycleActions = TaskMonitorStateProjection['availableActions'];
type RunningRegions = Extract<TaskMonitorMachineState, { RUNNING: unknown }>['RUNNING'];

const RETRYABLE_LAUNCH_GUIDANCE =
  'Start the monitor to retry the launch after correcting the cause, or stop it.';

/**
 * Lifecycle commands the machine admits in its committed regions. STOP is
 * handled by RUNNING itself; PAUSE by ACTIVE and RESUMING control; a
 * retryable launch admits START in its work region whatever the control
 * region; otherwise PAUSED control admits RESUME.
 */
const admittedActions = (running: RunningRegions | null): LifecycleActions => {
  if (!running) {
    return [];
  }

  const actions: LifecycleActions = [{ kind: 'STOP', command: 'STOP' }];
  if (running.control === 'ACTIVE' || running.control === 'RESUMING') {
    actions.push({ kind: 'PAUSE', command: 'PAUSE' });
  }
  if (running.work === 'RETRYABLE_LAUNCH') {
    actions.push({ kind: 'RETRYABLE_RECOVERY', command: 'START' });
  } else if (running.control === 'PAUSED') {
    actions.push({ kind: 'PAUSED_CONTINUATION', command: 'RESUME' });
  }

  return actions;
};

const coordinatorRecoveryFailure = (
  context: TaskMonitorMachineContext,
  running: RunningRegions | null,
): TaskMonitorStateProjection['failure'] => {
  const recovery = context.coordinatorRecovery;
  if (!recovery) {
    return undefined;
  }

  const currentFailure =
    context.failureReason && context.failureReason !== recovery.failure.message
      ? ` Current recovery failure: ${context.failureReason}`
      : '';
  const deliveryFailure = recovery.deliveryFailure
    ? ` Recovery request delivery failed: ${recovery.deliveryFailure}`
    : '';

  return {
    code: 'OPERATION_FAILED',
    cause: `${recovery.failure.code}: ${recovery.failure.message}${currentFailure}${deliveryFailure}`,
    correctiveGuidance:
      running?.work === 'OUTCOME_JUDGMENT'
        ? COORDINATOR_RECOVERY_GUIDANCE
        : `Automatic correction ${recovery.correctionAttempt} of 2 is pending or being assessed. Pause or stop the monitor to intervene.`,
  };
};

/** The committed launch failure keeps its own classification and correction. */
const retryableLaunchFailure = (
  context: TaskMonitorMachineContext,
): TaskMonitorStateProjection['failure'] => {
  const retry = context.retryableLaunch;
  if (!retry) {
    return undefined;
  }
  if (retry.failure) {
    return {
      code: retry.failure.code,
      cause: retry.failure.message,
      correctiveGuidance: retry.failure.correctiveAction,
    };
  }

  return {
    code: 'OPERATION_FAILED',
    cause: retry.failureReason,
    correctiveGuidance: RETRYABLE_LAUNCH_GUIDANCE,
  };
};

/** Generic guidance names only actions the machine currently admits. */
const unclassifiedFailure = (
  context: TaskMonitorMachineContext,
  actions: LifecycleActions,
): TaskMonitorStateProjection['failure'] => {
  if (!context.failureReason) {
    return undefined;
  }

  const canStop = actions.some(({ kind }) => kind === 'STOP');

  return {
    code: 'OPERATION_FAILED',
    cause: context.failureReason,
    correctiveGuidance: canStop
      ? 'Inspect the reported failure and stop the monitor if recovery is required.'
      : 'Inspect the reported failure. The monitor has ended and admits no further lifecycle actions.',
  };
};

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
  const availableActions = admittedActions(running);
  const failure =
    coordinatorRecoveryFailure(context, running) ??
    retryableLaunchFailure(context) ??
    unclassifiedFailure(context, availableActions);

  return { execution, availableActions, ...(failure ? { failure } : {}) };
};

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const MAX_TRANSIENT_ATTEMPTS = 6;

export const taskMonitorPublicationRetryDelay = (attempt: number): number =>
  Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);

/**
 * Publishes complete committed snapshots through the shared work-item
 * execution-state seam, independently of coding Run availability.
 *
 * Latest value per monitor: a newer committed snapshot supersedes one still
 * waiting to be sent. A report the platform could not decide on (no receipt,
 * or a receive failure) is resent with bounded backoff while connected; a
 * rejection is permanent for that snapshot and is logged with its code. A
 * skipped report (disconnected) is recovered by the reconnect replay, which
 * re-reads every durable snapshot. Each monitor drains independently, so a
 * failure on one never delays another.
 */
export class TaskMonitorStatePublication {
  private readonly stopWatching: () => void;
  private readonly stopReconnect: () => void;
  private readonly pending = new Map<string, Snapshot>();
  private readonly draining = new Map<string, Promise<void>>();
  private readonly wakers = new Map<string, () => void>();
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
      void this.replay().catch((error: unknown) =>
        this.logger.error('task_monitor.state.replay.failed', { error }),
      );
    });
  }

  public async replay(): Promise<void> {
    const instances = await this.store.listInstances();
    this.logger.debug('task_monitor.state.replay.started', { instances: instances.length });
    await Promise.all(instances.map(({ snapshot }) => this.publish(snapshot)));
  }

  /** Resolves once this monitor has no snapshot left to send. */
  public publish(snapshot: Snapshot): Promise<void> {
    if (this.disposed || snapshot.identity.machineType !== 'TASK_MONITOR') {
      return Promise.resolve();
    }

    const id = snapshot.identity.instanceId;
    const waiting = this.pending.get(id);
    if (!waiting || waiting.revision <= snapshot.revision) {
      this.pending.set(id, snapshot);
    }
    // A newer commit is sent now rather than after a pending retry backoff.
    this.wakers.get(id)?.();

    const running = this.draining.get(id);
    if (running) {
      return running;
    }

    const drain = this.drain(id).finally(() => this.draining.delete(id));
    this.draining.set(id, drain);
    return drain;
  }

  public dispose(): void {
    this.disposed = true;
    this.pending.clear();
    [...this.wakers.values()].forEach((wake) => wake());
    this.stopWatching();
    this.stopReconnect();
  }

  private async drain(id: string): Promise<void> {
    let attempt = 0;
    let snapshot = this.takePending(id);

    while (snapshot && !this.disposed) {
      const report = await this.send(snapshot);
      const newer = this.takePending(id);
      if (newer) {
        snapshot = newer;
        attempt = 0;
        continue;
      }
      if (report !== 'TRANSIENT') {
        return;
      }

      attempt += 1;
      if (attempt >= MAX_TRANSIENT_ATTEMPTS) {
        this.logger.warn('task_monitor.state.publication.retry_exhausted', {
          taskMonitorId: id,
          sourceRevision: snapshot.revision,
          attempts: attempt,
        });
        return;
      }

      await this.wait(id, taskMonitorPublicationRetryDelay(attempt));
      snapshot = this.takePending(id) ?? snapshot;
    }
  }

  private takePending(id: string): Snapshot | undefined {
    const snapshot = this.pending.get(id);
    this.pending.delete(id);
    return snapshot;
  }

  /** One report; every outcome is logged at this boundary with its cause. */
  private async send(snapshot: Snapshot): Promise<'SETTLED' | 'TRANSIENT'> {
    const taskMonitorId = snapshot.identity.instanceId;
    const sourceRevision = snapshot.revision;

    let observation: WorkItemExecutionStateObservation;
    try {
      const machineId = await this.keys.loadCurrentMachineId();
      if (!machineId) {
        this.logger.error('task_monitor.state.publication.failed', {
          taskMonitorId,
          sourceRevision,
          code: 'MACHINE_IDENTITY_MISSING',
        });
        return 'SETTLED';
      }
      observation = {
        workItemId: taskMonitorId,
        machineId,
        sourceRevision,
        state: { type: 'TASK_MONITOR', projection: taskMonitorStateProjection(snapshot) },
      };
    } catch (error) {
      this.logger.error('task_monitor.state.publication.failed', {
        taskMonitorId,
        sourceRevision,
        code: 'PROJECTION_FAILED',
        error,
      });
      return 'SETTLED';
    }

    const report = await this.websocket.reportWorkItemExecutionStateObservation(observation);
    return this.logReport(report, taskMonitorId, sourceRevision);
  }

  private logReport(
    report: WorkItemExecutionStateReport,
    taskMonitorId: string,
    sourceRevision: number,
  ): 'SETTLED' | 'TRANSIENT' {
    const fields = { taskMonitorId, sourceRevision };

    switch (report.kind) {
      case 'SKIPPED':
        this.logger.debug('task_monitor.state.publication.skipped', {
          ...fields,
          reason: 'DISCONNECTED',
        });
        return 'SETTLED';
      case 'NO_RECEIPT':
        this.logger.warn('task_monitor.state.publication.unconfirmed', {
          ...fields,
          reason: report.reason,
        });
        return 'TRANSIENT';
      case 'RECEIPT':
        break;
    }

    const { receipt } = report;
    switch (receipt.outcome) {
      case 'ACCEPTED':
        this.logger.debug('task_monitor.state.publication.accepted', {
          ...fields,
          revision: receipt.revision,
        });
        return 'SETTLED';
      case 'DUPLICATE':
        this.logger.debug('task_monitor.state.publication.duplicate', fields);
        return 'SETTLED';
      case 'REJECTED':
        this.logger.error('task_monitor.state.publication.rejected', {
          ...fields,
          code: receipt.code,
        });
        return 'SETTLED';
      case 'RECEIVE_FAILED':
        this.logger.warn('task_monitor.state.publication.receive_failed', fields);
        return 'TRANSIENT';
    }
  }

  /** Backoff that ends early on a newer commit for this monitor or disposal. */
  private wait(id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.wakers.delete(id);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      timer.unref?.();
      this.wakers.set(id, wake);
    });
  }
}
