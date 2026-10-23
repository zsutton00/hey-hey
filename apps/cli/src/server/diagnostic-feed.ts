/**
 * DiagnosticFeed — the bounded, live Debug source.
 *
 * Accepts two kinds of record: structured log entries teed from the server
 * logger (it is a `ServerLogSink`) and typed console/stderr records handed to
 * its capture sink by whichever owner installs terminal capture hooks. It
 * keeps the most recent records within explicit count and byte limits and
 * offers a race-free snapshot plus ordered updates, like the session sources.
 *
 * Recursion safety: records raised while the feed is delivering to its own
 * observers (an observer that logs, or a capture hook triggered by an
 * observer's write) are dropped and counted, never re-delivered. Output the
 * process writes on purpose — the logger's own JSON lines — runs inside
 * `writeDirectOutput`, which capture hooks consult through
 * `isDirectOutputActive` so a structured log is never captured a second time
 * as console text.
 */

import type { ServerLogEntry, ServerLogLevel, ServerLogSink } from './logger';
import {
  DIAGNOSTIC_RETENTION_POLICY,
  diagnosticRetentionLane,
  type DiagnosticRetentionLane,
  type DiagnosticRetentionBudget,
} from './diagnostic-retention';

export interface DiagnosticFeedLimits {
  readonly maxRecords: number;
  readonly maxBytes: number;
  readonly maxRecordTextBytes: number;
}

/** Routine lane defaults; constructor overrides apply independently to both lanes. */
export const DIAGNOSTIC_FEED_LIMITS: DiagnosticFeedLimits = Object.freeze({
  /** Records retained, oldest evicted first. */
  maxRecords: DIAGNOSTIC_RETENTION_POLICY.routine.maxRecords,
  /** UTF-8 bytes retained across all records. */
  maxBytes: DIAGNOSTIC_RETENTION_POLICY.routine.maxBytes,
  /** A single record's text beyond this is truncated, keeping its start. */
  maxRecordTextBytes: 8 * 1024,
});

export type CapturedConsoleStream = 'stdout' | 'stderr';

/** One console or stream write observed by an installed capture hook. */
export interface CapturedConsoleRecord {
  stream: CapturedConsoleStream;
  /** `console.<method>` that produced the text, or `write` for a raw stream write. */
  source: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'write';
  text: string;
  timestamp: string;
}

interface DiagnosticRecordBase {
  /** Monotonic, gap-free across appends; evictions leave gaps in the retained range. */
  readonly seq: number;
  readonly timestamp: string;
  /** Bytes the original text exceeded the per-record limit by; 0 when whole. */
  readonly truncatedBytes: number;
}

interface DiagnosticLogRecord extends DiagnosticRecordBase {
  readonly kind: 'log';
  readonly level: ServerLogLevel;
  readonly event: string;
  /** The entry serialized as the logger writes it, truncated to the record limit. */
  readonly text: string;
}

interface DiagnosticConsoleRecord extends DiagnosticRecordBase {
  readonly kind: 'console';
  readonly stream: CapturedConsoleStream;
  readonly source: CapturedConsoleRecord['source'];
  readonly text: string;
}

export type DiagnosticRecord = DiagnosticLogRecord | DiagnosticConsoleRecord;

export interface DiagnosticMetadata {
  readonly policy: {
    readonly lifetimeMs: number;
    readonly maxRecordTextBytes: number;
    readonly routine: DiagnosticRetentionBudget;
    readonly incident: DiagnosticRetentionBudget;
  };
  readonly coverage: {
    readonly oldestTimestamp: string | null;
    readonly newestTimestamp: string | null;
  };
  readonly losses: {
    readonly routine: { readonly evicted: number; readonly expired: number };
    readonly incident: { readonly evicted: number; readonly expired: number };
  };
  readonly expiredCount: number;
  readonly repetitionCount: number;
}

export interface DiagnosticFeedSnapshot extends DiagnosticMetadata {
  readonly records: readonly DiagnosticRecord[];
  /** Records evicted by the count or byte limit since the feed started. */
  readonly evictedCount: number;
  /** Re-entrant records dropped while the feed was delivering. */
  readonly droppedReentrantCount: number;
}

export type DiagnosticFeedUpdate =
  | {
      readonly kind: 'appended';
      readonly record: DiagnosticRecord;
      readonly metadata: DiagnosticMetadata;
    }
  | {
      readonly kind: 'evicted';
      readonly sequences: readonly number[];
      readonly count: number;
      readonly metadata: DiagnosticMetadata;
    };

export type DiagnosticFeedObserver = (update: DiagnosticFeedUpdate) => void;

export interface DiagnosticFeedObservation {
  readonly snapshot: DiagnosticFeedSnapshot;
  readonly unsubscribe: () => void;
}

/** The seam capture hooks write into. Never throws. */
export interface DiagnosticCaptureSink {
  capture(record: CapturedConsoleRecord): void;
}

let directOutputDepth = 0;

/**
 * Runs `write` as deliberate process output that capture hooks must pass
 * through without recording. Structured log lines are written this way.
 */
export const writeDirectOutput = (write: () => void): void => {
  directOutputDepth += 1;
  try {
    write();
  } finally {
    directOutputDepth -= 1;
  }
};

/** True while deliberate process output is being written. */
export const isDirectOutputActive = (): boolean => directOutputDepth > 0;

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const truncateText = (
  text: string,
  maxBytes: number,
): { text: string; bytes: number; truncatedBytes: number } => {
  const bytes = utf8Bytes(text);
  if (bytes <= maxBytes) return { text, bytes, truncatedBytes: 0 };
  // Drop a split trailing code point rather than emit a replacement character.
  const kept = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/�$/u, '');
  const keptBytes = utf8Bytes(kept);
  return { text: kept, bytes: keptBytes, truncatedBytes: bytes - keptBytes };
};

export class DiagnosticFeed implements ServerLogSink, DiagnosticCaptureSink {
  private readonly records: Array<{
    record: DiagnosticRecord;
    bytes: number;
    lane: DiagnosticRetentionLane;
    retainedAtMs: number;
  }> = [];
  private readonly snapshotObservers = new Set<() => void>();
  private readonly lanes = {
    routine: { count: 0, bytes: 0, evicted: 0, expired: 0 },
    incident: { count: 0, bytes: 0, evicted: 0, expired: 0 },
  };
  private expirationTimer: ReturnType<typeof setTimeout> | null = null;
  private flushingSnapshot = false;
  private repetitionCount = 0;
  private readonly observers = new Set<DiagnosticFeedObserver>();
  private nextSeq = 1;
  private evictedCount = 0;
  private droppedReentrantCount = 0;
  private observerFailureCount = 0;
  private delivering = false;

  private readonly policy: DiagnosticMetadata['policy'];
  public constructor(
    limits?: DiagnosticFeedLimits,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
    this.policy = Object.freeze({
      lifetimeMs: DIAGNOSTIC_RETENTION_POLICY.lifetimeMs,
      maxRecordTextBytes:
        limits?.maxRecordTextBytes ?? DIAGNOSTIC_RETENTION_POLICY.maxRecordTextBytes,
      routine: Object.freeze(
        limits
          ? { maxRecords: limits.maxRecords, maxBytes: limits.maxBytes }
          : DIAGNOSTIC_RETENTION_POLICY.routine,
      ),
      incident: Object.freeze(
        limits
          ? { maxRecords: limits.maxRecords, maxBytes: limits.maxBytes }
          : DIAGNOSTIC_RETENTION_POLICY.incident,
      ),
    });
  }

  /** Producers flush pending safe summaries before the immutable snapshot boundary. */
  public beforeSnapshot(observer: () => void): () => void {
    this.snapshotObservers.add(observer);
    return () => {
      this.snapshotObservers.delete(observer);
    };
  }

  public dispose(): void {
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.expirationTimer = null;
    this.observers.clear();
    this.snapshotObservers.clear();
  }

  /** `ServerLogSink`: tees one structured log entry. */
  public append(entry: ServerLogEntry): void {
    if (this.rejectReentrant()) return;
    const { text, bytes, truncatedBytes } = truncateText(
      JSON.stringify(entry),
      this.policy.maxRecordTextBytes,
    );
    if (
      entry.event === 'control_reduction.repeated' &&
      typeof entry['repetitionCount'] === 'number'
    ) {
      this.repetitionCount += entry['repetitionCount'];
    }
    this.record(
      {
        kind: 'log',
        seq: this.nextSeq++,
        timestamp: entry.timestamp,
        level: entry.level,
        event: entry.event,
        text,
        truncatedBytes,
      },
      bytes,
    );
  }

  /** `DiagnosticCaptureSink`: records one captured console or stream write. */
  public capture(captured: CapturedConsoleRecord): void {
    if (isDirectOutputActive() || this.rejectReentrant()) return;
    if (captured.text.length === 0) return;
    const { text, bytes, truncatedBytes } = truncateText(
      captured.text,
      this.policy.maxRecordTextBytes,
    );
    this.record(
      {
        kind: 'console',
        seq: this.nextSeq++,
        timestamp: captured.timestamp,
        stream: captured.stream,
        source: captured.source,
        text,
        truncatedBytes,
      },
      bytes,
    );
  }

  public snapshot(): DiagnosticFeedSnapshot {
    if (!this.flushingSnapshot && !this.delivering) {
      this.flushingSnapshot = true;
      try {
        for (const observer of [...this.snapshotObservers]) {
          try {
            observer();
          } catch {
            this.observerFailureCount += 1;
          }
        }
      } finally {
        this.flushingSnapshot = false;
      }
    }
    this.expire();
    return Object.freeze({
      ...this.metadata(),
      records: Object.freeze(this.records.map((slot) => slot.record)),
      evictedCount: this.evictedCount,
      droppedReentrantCount: this.droppedReentrantCount,
    });
  }

  /** Atomically reads the current snapshot and subscribes to every later update. */
  public observe(observer: DiagnosticFeedObserver): DiagnosticFeedObservation {
    const snapshot = this.snapshot();
    this.observers.add(observer);
    this.armExpiration();
    return {
      snapshot,
      unsubscribe: () => {
        this.observers.delete(observer);
        this.armExpiration();
      },
    };
  }

  /** Observer callbacks that threw; failures are counted, never logged back into the feed. */
  public get observerFailures(): number {
    return this.observerFailureCount;
  }

  private rejectReentrant(): boolean {
    if (!this.delivering) return false;
    this.droppedReentrantCount += 1;
    return true;
  }

  private metadata(): DiagnosticMetadata {
    return Object.freeze({
      policy: this.policy,
      coverage: Object.freeze({
        oldestTimestamp: this.records[0]?.record.timestamp ?? null,
        newestTimestamp: this.records.at(-1)?.record.timestamp ?? null,
      }),
      losses: Object.freeze({
        routine: Object.freeze({
          evicted: this.lanes.routine.evicted,
          expired: this.lanes.routine.expired,
        }),
        incident: Object.freeze({
          evicted: this.lanes.incident.evicted,
          expired: this.lanes.incident.expired,
        }),
      }),
      expiredCount: this.lanes.routine.expired + this.lanes.incident.expired,
      repetitionCount: this.repetitionCount,
    });
  }

  private remove(sequences: readonly number[], expired: boolean): void {
    if (sequences.length === 0) return;
    const removed = new Set(sequences);
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const slot = this.records[index]!;
      if (!removed.has(slot.record.seq)) continue;
      const lane = this.lanes[slot.lane];
      lane.count -= 1;
      lane.bytes -= slot.bytes;
      if (expired) lane.expired += 1;
      else {
        lane.evicted += 1;
        this.evictedCount += 1;
      }
      this.records.splice(index, 1);
    }
    this.deliver({
      kind: 'evicted',
      sequences: Object.freeze([...sequences]),
      count: sequences.length,
      metadata: this.metadata(),
    });
  }

  private expire(): void {
    if (this.delivering) return;
    const cutoff = this.monotonicNow() - this.policy.lifetimeMs;
    const expired: number[] = [];
    for (const slot of this.records) {
      if (slot.retainedAtMs > cutoff) break;
      expired.push(slot.record.seq);
    }
    this.remove(expired, true);
    this.armExpiration();
  }

  private armExpiration(): void {
    if (this.expirationTimer) clearTimeout(this.expirationTimer);
    this.expirationTimer = null;
    const first = this.records[0];
    if (!first || this.observers.size === 0) return;
    this.expirationTimer = setTimeout(
      () => {
        this.expirationTimer = null;
        this.expire();
      },
      Math.max(1, first.retainedAtMs + this.policy.lifetimeMs - this.monotonicNow()),
    );
    this.expirationTimer.unref?.();
  }

  private record(record: DiagnosticRecord, bytes: number): void {
    this.expire();
    const frozen = Object.freeze(record);
    const lane =
      record.kind === 'log'
        ? diagnosticRetentionLane(record.kind, record.level, record.event, undefined, undefined)
        : diagnosticRetentionLane(record.kind, undefined, undefined, record.source, record.stream);
    this.records.push({ record: frozen, bytes, lane, retainedAtMs: this.monotonicNow() });
    const usage = this.lanes[lane];
    const budget = this.policy[lane];
    usage.count += 1;
    usage.bytes += bytes;
    const evicted: number[] = [];
    let count = usage.count;
    let laneBytes = usage.bytes;
    for (const slot of this.records) {
      if (count <= budget.maxRecords && laneBytes <= budget.maxBytes) break;
      if (slot.lane !== lane) continue;
      evicted.push(slot.record.seq);
      count -= 1;
      laneBytes -= slot.bytes;
    }
    this.remove(evicted, false);
    if (!evicted.includes(record.seq))
      this.deliver({ kind: 'appended', record: frozen, metadata: this.metadata() });
    this.armExpiration();
  }

  private deliver(update: DiagnosticFeedUpdate): void {
    this.delivering = true;
    try {
      for (const observer of [...this.observers]) {
        try {
          observer(update);
        } catch {
          this.observerFailureCount += 1;
        }
      }
    } finally {
      this.delivering = false;
    }
  }
}
