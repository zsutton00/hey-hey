import type { TaskMonitorCoordinatorValidationFailure } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalTaskMonitorCoordinatorDecision } from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../../server/logger';
import type {
  SettledTurnMonitorEvent,
  TaskMonitorManagedTurnRuntime,
} from '../../server/task-monitor-managed-turn-runtime';
import type { ManagedTurnTerminalOutcome } from '../../turn/turn';

export type TaskMonitorDecisionResult =
  | {
      status: 'DECISION';
      decision: LocalTaskMonitorCoordinatorDecision;
    }
  | {
      status: 'INVALID';
      reason: string;
      failure?: TaskMonitorCoordinatorValidationFailure;
    }
  | {
      status: 'TURN_SETTLED';
      terminalOutcome: ManagedTurnTerminalOutcome;
    };

interface PendingWaiter {
  resolve: (result: TaskMonitorDecisionResult) => void;
  promise: Promise<TaskMonitorDecisionResult>;
}

/**
 * The coordinator Run is only an execution container. This store is the
 * narrow handoff that resolves from either typed assistant output or the
 * canonical terminal lifecycle. Keeping those outcomes explicit prevents a
 * completed coordinator Turn from being mistaken for a valid decision.
 */
export class TaskMonitorDecisionStore {
  private readonly results = new Map<string, TaskMonitorDecisionResult>();
  private readonly waiters = new Map<string, PendingWaiter>();
  private readonly currentKeys = new Map<string, string>();
  private readonly currentAttemptIds = new Map<string, string>();
  private readonly expectedTurns = new Map<string, string | null>();
  private readonly publicationReservations = new Set<string>();
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly logger: ServerLogger,
    managedTurns: TaskMonitorManagedTurnRuntime,
  ) {
    this.unsubscribe = managedTurns.subscribe((event) => this.publishSettlement(event));
  }

  /**
   * Bind a coordinator Run to the lifecycle correlation being evaluated.
   * Task Monitor coordinator Runs can be reused across turns, so the Run id
   * alone is not a unique decision delivery key.
   */
  public bind(runId: string, correlationId: string, attemptId?: string): void {
    const key = JSON.stringify([runId, correlationId, ...(attemptId ? [attemptId] : [])]);
    if (attemptId && this.currentKeys.get(runId) === key) return;
    if (attemptId) this.currentAttemptIds.set(runId, attemptId);
    else this.currentAttemptIds.delete(runId);
    if (attemptId) this.expectedTurns.set(key, null);
    const priorResult = this.results.delete(key);
    this.publicationReservations.delete(key);
    this.currentKeys.set(runId, key);
    this.logger.debug('task_monitor.decision_store.bound', {
      runId,
      correlationId,
      retrying: priorResult,
    });
  }

  public publish(
    runId: string,
    result: Exclude<TaskMonitorDecisionResult, { status: 'TURN_SETTLED' }>,
    attemptId?: string,
  ): void {
    if (attemptId && this.currentAttemptIds.get(runId) !== attemptId) return;
    this.logger.debug('task_monitor.decision_store.publish.received', {
      runId,
      resultStatus: result.status,
      ...(result.status === 'DECISION' ? { action: result.decision.action } : {}),
    });
    this.resolve(runId, result);
  }

  public reservePublication(runId: string, attemptId?: string): boolean {
    if (attemptId && this.currentAttemptIds.get(runId) !== attemptId) return false;
    const key = this.keyFor(runId);
    if (this.results.has(key) || this.publicationReservations.has(key)) {
      this.logger.debug('task_monitor.decision_store.publication.duplicate', { runId });
      return false;
    }
    this.publicationReservations.add(key);
    this.logger.debug('task_monitor.decision_store.publication.reserved', { runId });
    return true;
  }

  public releasePublication(runId: string): void {
    const key = this.keyFor(runId);
    this.publicationReservations.delete(key);
    this.logger.debug('task_monitor.decision_store.publication.released', { runId });
  }

  public wait(runId: string): Promise<TaskMonitorDecisionResult> {
    const key = this.keyFor(runId);
    const existing = this.results.get(key);
    if (existing) {
      this.logger.debug('task_monitor.decision_store.wait.resolved_existing', {
        runId,
        resultStatus: existing.status,
      });
      return Promise.resolve(existing);
    }

    const active = this.waiters.get(key);
    if (active) {
      this.logger.debug('task_monitor.decision_store.wait.joined', { runId });
      return active.promise;
    }

    let resolvePending: (result: TaskMonitorDecisionResult) => void = () => undefined;
    const promise = new Promise<TaskMonitorDecisionResult>((resolve) => {
      resolvePending = resolve;
    });
    this.waiters.set(key, { resolve: resolvePending, promise });
    this.logger.debug('task_monitor.decision_store.wait.started', { runId });
    return promise;
  }

  public isCurrentAttempt(runId: string, attemptId: string): boolean {
    return this.currentAttemptIds.get(runId) === attemptId;
  }

  public bindTurn(runId: string, attemptId: string, turnId: string): void {
    const key = this.keyFor(runId);
    if (this.currentAttemptIds.get(runId) === attemptId) this.expectedTurns.set(key, turnId);
  }

  public dispose(): void {
    this.unsubscribe();
  }

  private publishSettlement(event: SettledTurnMonitorEvent): void {
    if (!this.currentKeys.has(event.agentSessionId) && !this.waiters.has(event.agentSessionId)) {
      this.logger.debug('task_monitor.decision_store.settlement.unbound', {
        runId: event.agentSessionId,
        turnId: event.turnId,
      });
      return;
    }
    const key = this.keyFor(event.agentSessionId);
    if (this.expectedTurns.has(key) && this.expectedTurns.get(key) !== event.turnId) {
      this.logger.debug('task_monitor.decision_store.settlement.stale', {
        runId: event.agentSessionId,
        turnId: event.turnId,
      });
      return;
    }
    this.logger.debug('task_monitor.decision_store.settlement.received', {
      runId: event.agentSessionId,
      turnId: event.turnId,
      terminalOutcome: event.terminalOutcome,
    });
    this.resolve(event.agentSessionId, {
      status: 'TURN_SETTLED',
      terminalOutcome: event.terminalOutcome,
    });
  }

  private resolve(runId: string, result: TaskMonitorDecisionResult): void {
    const key = this.keyFor(runId);
    this.publicationReservations.delete(key);
    if (this.results.has(key)) {
      this.logger.debug('task_monitor.decision_store.publish.duplicate', {
        runId,
        resultStatus: result.status,
      });
      return;
    }
    this.results.set(key, result);
    this.logger.debug('task_monitor.decision_store.publish.stored', {
      runId,
      resultStatus: result.status,
    });
    const waiter = this.waiters.get(key);
    if (!waiter) return;
    this.waiters.delete(key);
    this.logger.debug('task_monitor.decision_store.publish.delivered', {
      runId,
      resultStatus: result.status,
    });
    waiter.resolve(result);
  }

  private keyFor(runId: string): string {
    return this.currentKeys.get(runId) ?? runId;
  }
}
