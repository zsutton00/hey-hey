import type { ReadableInputRecord } from './input-admission/input-admission-codec';
import type { DiagnosticFeed } from './diagnostic-feed';
import type { ServerLogger } from './logger';

interface CancellationOutcome {
  readonly kind: 'cancel_input';
  readonly operationId: string;
  readonly messageId: string | null;
  readonly agentSessionId: string;
  readonly runId: string;
  readonly admissionId: string;
  readonly revision: number;
  readonly state: ReadableInputRecord['state'];
  readonly platformProjection: 'accepted' | 'pending';
  readonly transportAckAvailable: boolean | null;
}

interface RepetitionGroup {
  readonly outcome: CancellationOutcome;
  lastAtMs: number;
  reportedAtMs: number;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

/** Receives only verified, processed outcomes; never owns or skips control processing. */
export class ControlReductionTelemetry {
  private readonly groups = new Map<string, RepetitionGroup>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly unsubscribeSnapshot: (() => void) | undefined;

  constructor(
    private readonly logger: ServerLogger,
    feed?: DiagnosticFeed,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly timestampNow: () => string = () => new Date().toISOString(),
  ) {
    this.unsubscribeSnapshot = feed?.beforeSnapshot(() => this.flush('snapshot'));
  }

  cancellation(record: ReadableInputRecord, transportAckAvailable: boolean | null): void {
    // Explicit allowlist: never retain the input's fingerprint, authority or payload.
    const outcome: CancellationOutcome = {
      kind: 'cancel_input',
      operationId: record.key,
      messageId: record.messageId,
      agentSessionId: record.agentSessionId,
      runId: record.runId,
      admissionId: record.admissionId,
      revision: record.revision,
      state: record.state,
      platformProjection: record.projectedRevision >= record.revision ? 'accepted' : 'pending',
      transportAckAvailable,
    };
    if (this.disposed) {
      this.logger.info('control_reduction.outcome', { ...outcome });
      return;
    }
    const now = this.monotonicNow();
    const timestamp = this.timestampNow();
    this.sweep(now);
    const key = `${outcome.operationId}/${outcome.messageId}/${outcome.agentSessionId}`;
    const previous = this.groups.get(key);
    if (previous && this.sameOutcome(previous.outcome, outcome)) {
      if (previous.count === 0) previous.firstTimestamp = timestamp;
      previous.count += 1;
      previous.lastTimestamp = timestamp;
      previous.lastAtMs = now;
      if (now - previous.reportedAtMs >= 30_000) this.report(previous, 'interval', now);
      return;
    }
    if (previous) this.report(previous, 'outcome_change', now);
    if (!previous && this.groups.size >= 256) {
      // Idle order, not insertion order: a busy key must not displace a colder key.
      const oldest = [...this.groups.entries()].sort((a, b) => a[1].lastAtMs - b[1].lastAtMs)[0];
      if (oldest) {
        this.report(oldest[1], 'capacity', now);
        this.groups.delete(oldest[0]);
      }
    }
    this.logger.info('control_reduction.outcome', { ...outcome });
    this.groups.set(key, {
      outcome,
      lastAtMs: now,
      reportedAtMs: now,
      count: 0,
      firstTimestamp: timestamp,
      lastTimestamp: timestamp,
    });
    this.arm();
  }

  private sameOutcome(a: CancellationOutcome, b: CancellationOutcome): boolean {
    return (
      a.admissionId === b.admissionId &&
      a.runId === b.runId &&
      a.revision === b.revision &&
      a.state === b.state &&
      a.platformProjection === b.platformProjection &&
      a.transportAckAvailable === b.transportAckAvailable
    );
  }

  cancellationFailed(operationId: string, messageId: string, agentSessionId: string): void {
    const key = `${operationId}/${messageId}/${agentSessionId}`;
    const previous = this.groups.get(key);
    if (previous) this.report(previous, 'outcome_change', this.monotonicNow());
    this.groups.delete(key);
    this.logger.warn('control_reduction.failed', {
      kind: 'cancel_input',
      operationId,
      messageId,
      agentSessionId,
    });
  }

  stopped(conversationId: string, runId: string, transportAckAvailable: boolean | null): void {
    this.logger.info('control_reduction.outcome', {
      kind: 'stop_run',
      conversationId,
      runId,
      transportAckAvailable,
      localOutcome: 'completed',
    });
  }

  private report(group: RepetitionGroup, reason: string, now: number): void {
    if (group.count === 0) return;
    this.logger.info('control_reduction.repeated', {
      ...group.outcome,
      repetitionCount: group.count,
      firstTimestamp: group.firstTimestamp,
      lastTimestamp: group.lastTimestamp,
      reason,
    });
    group.count = 0;
    group.reportedAtMs = now;
  }

  private arm(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(this.monotonicNow()), 1_000);
    this.timer.unref?.();
  }

  private sweep(now: number): void {
    for (const [key, group] of this.groups) {
      if (now - group.lastAtMs >= 120_000) {
        this.report(group, 'idle', now);
        this.groups.delete(key);
      } else if (now - group.reportedAtMs >= 30_000) this.report(group, 'interval', now);
    }
    if (this.groups.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  flush(reason: 'snapshot' | 'shutdown'): void {
    const now = this.monotonicNow();
    for (const group of this.groups.values()) this.report(group, reason, now);
  }

  dispose(): void {
    this.disposed = true;
    this.flush('shutdown');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.groups.clear();
    this.unsubscribeSnapshot?.();
  }
}
