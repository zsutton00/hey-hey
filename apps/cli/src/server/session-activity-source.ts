/**
 * SessionActivitySource — bounded, typed activity for the Runs registered in
 * this process: assistant narration, tool calls with their arguments, streamed
 * command output and results.
 *
 * It listens at the Run output boundary (`RunEventPublisher.onRunOutput`),
 * after the Run's producer attribution admitted the event and before
 * downstream Run normalization, and reads only the provider-owned typed facts
 * on each event. It never parses raw payloads, never feeds back into the Run
 * and is not persisted: it is a display projection, not history.
 *
 * Capture is independent of any screen: every registered Run is recorded from
 * its first admitted event. `observe()` hands back a snapshot and the
 * subscription in one synchronous step so no update is lost between them.
 *
 * Correlation: entries are keyed within a lane — the subagent Turn that
 * produced the event, the provider thread (Codex descendants) and the Claude
 * `parent_tool_use_id` — so subagents stay distinct and equal tool ids in
 * different lanes never merge. A result that arrives before its start opens
 * the entry; the late start fills it in. No identifier is ever invented: a
 * fact without an id the provider supplied is not correlated.
 *
 * Bounds: per-Run and aggregate byte budgets, a per-Run entry cap and an age
 * limit evict oldest entries first and report each eviction; oversized text
 * is truncated visibly. Correlation keys live on the entries they point to,
 * so evicting an entry frees its bookkeeping. A Run's buffer is disposed when
 * the Run leaves the registry.
 */

import type { NormalizedProviderFacts } from '../agents/providers/provider-event-normalization';
import type { Run } from '../run/run';
import type { LocalAgentOutputEvent } from '../run/types';
import type { LocalSessionReadSource, LocalSessionUpdate } from './local-session-read-source';
import type { ServerLogger } from './logger';
import type { RunEventPublisher, RunOutputAttribution } from './run-event-publisher';

export interface SessionActivityLimits {
  readonly maxRunBytes: number;
  readonly maxTotalBytes: number;
  readonly maxEntriesPerRun: number;
  readonly maxEntryAgeMs: number;
  readonly maxTextBytes: number;
  readonly maxInputBytes: number;
}

/** Concrete session activity retention policy. */
export const SESSION_ACTIVITY_LIMITS: SessionActivityLimits = Object.freeze({
  /** UTF-8 bytes retained for one Run. */
  maxRunBytes: 256 * 1024,
  /** UTF-8 bytes retained across every Run. */
  maxTotalBytes: 2 * 1024 * 1024,
  /** Entries retained for one Run. */
  maxEntriesPerRun: 400,
  /** Entries not updated for this long are evicted. */
  maxEntryAgeMs: 30 * 60 * 1000,
  /** Narration, streamed output and result text beyond this are truncated. */
  maxTextBytes: 16 * 1024,
  /** Serialized tool arguments beyond this are truncated. */
  maxInputBytes: 4 * 1024,
});

/** Fixed per-entry cost so empty entries still count against the budgets. */
const ENTRY_OVERHEAD_BYTES = 256;

/** Who produced an entry. Null fields mean the root agent of the Run. */
export interface SessionActivityLane {
  readonly subagentTurnId: string | null;
  readonly providerThreadId: string | null;
  readonly parentToolUseId: string | null;
}

/** Text held within a byte limit; `truncatedBytes` > 0 marks a visible cut. */
export interface BoundedText {
  readonly text: string;
  readonly truncatedBytes: number;
}

interface SessionActivityEntryBase {
  /** Stable across updates and unique per Run instance. */
  readonly entryId: string;
  /** Per-Run append order; evictions leave gaps. */
  readonly seq: number;
  readonly lane: SessionActivityLane;
  /** The Run's active Turn when the entry opened. */
  readonly turnId: string | null;
  readonly providerTurnId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionNarrationEntry extends SessionActivityEntryBase {
  readonly kind: 'narration';
  /** Keeps the most recent text when truncated. */
  readonly text: BoundedText;
  /** False once the provider delivered the final text. */
  readonly open: boolean;
}

export interface SessionToolEntry extends SessionActivityEntryBase {
  readonly kind: 'tool';
  readonly toolUseId: string;
  /** Null until a start fact names the tool (e.g. result-before-start). */
  readonly toolName: string | null;
  /** Serialized arguments; null when the provider supplied none. Keeps the start. */
  readonly input: BoundedText | null;
  readonly status: 'running' | 'completed' | 'failed';
  /** Streamed command output; keeps the most recent text. Empty when not streamed. */
  readonly output: BoundedText;
  /** Result content; keeps the start. Null before a result. */
  readonly result: BoundedText | null;
  readonly exitCode: number | null;
}

export type SessionActivityEntry = SessionNarrationEntry | SessionToolEntry;

export type SessionActivityEvictionReason = 'run-bytes' | 'total-bytes' | 'entry-count' | 'age';

/** Everything evicted from one Run so far; consumers render it as a gap. */
export interface SessionActivityGap {
  readonly evictedCount: number;
  /** Highest evicted seq; entries at or below it may be missing. */
  readonly throughSeq: number | null;
}

export interface RunActivitySnapshot {
  readonly runId: string;
  readonly runInstanceId: number;
  readonly entries: readonly SessionActivityEntry[];
  readonly gap: SessionActivityGap;
}

export interface SessionActivitySnapshot {
  readonly revision: number;
  readonly runs: readonly RunActivitySnapshot[];
}

export type SessionActivityUpdate =
  | {
      readonly revision: number;
      readonly kind: 'entry';
      readonly runId: string;
      readonly runInstanceId: number;
      /** Upsert by `entryId`. */
      readonly entry: SessionActivityEntry;
    }
  | {
      readonly revision: number;
      readonly kind: 'evicted';
      readonly runId: string;
      readonly runInstanceId: number;
      readonly entryIds: readonly string[];
      readonly reason: SessionActivityEvictionReason;
      readonly gap: SessionActivityGap;
    }
  | {
      readonly revision: number;
      readonly kind: 'disposed';
      readonly runId: string;
      readonly runInstanceId: number;
    };

export type SessionActivityObserver = (update: SessionActivityUpdate) => void;

export interface SessionActivityObservation {
  readonly snapshot: SessionActivitySnapshot;
  readonly unsubscribe: () => void;
}

export interface SessionActivitySourceDependencies {
  runOutput: Pick<RunEventPublisher, 'onRunOutput'>;
  readSource: Pick<LocalSessionReadSource, 'observe' | 'runInstanceIdOf'>;
  logger: ServerLogger;
  limits?: SessionActivityLimits;
  now?: () => Date;
}

interface StoredEntry {
  entry: SessionActivityEntry;
  bytes: number;
  /** Correlation keys resolving to this entry; removed with it. */
  keys: string[];
}

interface RunActivityBuffer {
  readonly runId: string;
  readonly runInstanceId: number;
  /** Insertion order is seq order. */
  readonly entries: Map<number, StoredEntry>;
  readonly index: Map<string, number>;
  bytes: number;
  nextSeq: number;
  gap: SessionActivityGap;
}

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const keepStart = (text: string, maxBytes: number, alreadyTruncated = 0): BoundedText => {
  const bytes = utf8Bytes(text);
  if (bytes <= maxBytes) return { text, truncatedBytes: alreadyTruncated };
  const kept = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/�$/u, '');
  return { text: kept, truncatedBytes: alreadyTruncated + bytes - utf8Bytes(kept) };
};

const keepEnd = (text: string, maxBytes: number, alreadyTruncated = 0): BoundedText => {
  const bytes = utf8Bytes(text);
  if (bytes <= maxBytes) return { text, truncatedBytes: alreadyTruncated };
  const kept = Buffer.from(text, 'utf8')
    .subarray(bytes - maxBytes)
    .toString('utf8')
    .replace(/^�/u, '');
  return { text: kept, truncatedBytes: alreadyTruncated + bytes - utf8Bytes(kept) };
};

const EMPTY_TEXT: BoundedText = Object.freeze({ text: '', truncatedBytes: 0 });

const entryBytes = (entry: SessionActivityEntry): number =>
  ENTRY_OVERHEAD_BYTES +
  (entry.kind === 'narration'
    ? utf8Bytes(entry.text.text)
    : utf8Bytes(entry.input?.text ?? '') +
      utf8Bytes(entry.output.text) +
      utf8Bytes(entry.result?.text ?? ''));

const laneOf = (
  facts: NormalizedProviderFacts,
  attribution: RunOutputAttribution,
): SessionActivityLane =>
  Object.freeze({
    subagentTurnId: attribution.subagentTurnId,
    providerThreadId: facts.provider === 'codex' ? facts.routing.providerThreadId : null,
    parentToolUseId: facts.parentToolUseId,
  });

const carriesActivity = (facts: NormalizedProviderFacts): boolean =>
  facts.narration !== null ||
  facts.toolUses.length > 0 ||
  facts.toolResults.length > 0 ||
  facts.toolProgress !== null ||
  facts.commandLifecycle !== null ||
  facts.commandOutput !== null;

const laneKey = (lane: SessionActivityLane): string =>
  JSON.stringify([lane.subagentTurnId, lane.providerThreadId, lane.parentToolUseId]);

export class SessionActivitySource {
  private readonly limits: SessionActivityLimits;
  private readonly now: () => Date;
  private readonly buffers = new Map<string, RunActivityBuffer>();
  /** Registered Run instance per runId, from the read source. */
  private readonly registered = new Map<string, number>();
  private readonly observers = new Set<SessionActivityObserver>();
  private readonly subscriptions: Array<() => void>;
  private totalBytes = 0;
  private revision = 0;
  private disposed = false;

  public constructor(private readonly dependencies: SessionActivitySourceDependencies) {
    this.limits = dependencies.limits ?? SESSION_ACTIVITY_LIMITS;
    this.now = dependencies.now ?? (() => new Date());
    const membership = dependencies.readSource.observe((update) => this.onMembership(update));
    for (const session of membership.snapshot.sessions) {
      this.registered.set(session.runId, session.runInstanceId);
    }
    this.subscriptions = [
      membership.unsubscribe,
      dependencies.runOutput.onRunOutput((event, attribution) => this.ingest(event, attribution)),
    ];
  }

  public snapshot(): SessionActivitySnapshot {
    this.expire();
    return Object.freeze({
      revision: this.revision,
      runs: Object.freeze([...this.buffers.values()].map((buffer) => this.snapshotOf(buffer))),
    });
  }

  /** Retained activity bytes across every Run, as counted against `maxTotalBytes`. */
  public get retainedBytes(): number {
    return this.totalBytes;
  }

  /** Runs that currently hold an activity buffer. */
  public get bufferedRunCount(): number {
    return this.buffers.size;
  }

  /** Atomically reads the current snapshot and subscribes to every later update. */
  public observe(observer: SessionActivityObserver): SessionActivityObservation {
    const snapshot = this.snapshot();
    if (!this.disposed) this.observers.add(observer);
    return {
      snapshot,
      unsubscribe: () => {
        this.observers.delete(observer);
      },
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.observers.clear();
    this.buffers.clear();
    this.registered.clear();
    this.totalBytes = 0;
  }

  private onMembership(update: LocalSessionUpdate): void {
    if (update.kind === 'removed') {
      if (this.registered.get(update.runId) === update.runInstanceId) {
        this.registered.delete(update.runId);
      }
      this.disposeRun(update.runId, update.runInstanceId);
      return;
    }
    const { runId, runInstanceId } = update.session;
    this.registered.set(runId, runInstanceId);
    const existing = this.buffers.get(runId);
    if (existing !== undefined && existing.runInstanceId !== runInstanceId) {
      this.disposeRun(runId, existing.runInstanceId);
    }
  }

  private disposeRun(runId: string, runInstanceId: number): void {
    const buffer = this.buffers.get(runId);
    if (buffer?.runInstanceId !== runInstanceId) return;
    this.buffers.delete(runId);
    this.totalBytes -= buffer.bytes;
    this.deliver({ revision: ++this.revision, kind: 'disposed', runId, runInstanceId });
  }

  private ingest(event: LocalAgentOutputEvent, attribution: RunOutputAttribution): void {
    if (this.disposed) return;
    const facts = event.providerFacts;
    if (!facts || !carriesActivity(facts)) return;
    try {
      const buffer = this.bufferFor(attribution.run);
      if (!buffer) return;
      this.project(buffer, facts, attribution, event.timestamp);
      this.expire();
    } catch (error) {
      this.dependencies.logger.warn('session_activity.projection_failed', {
        runId: event.runId,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Only a Run instance the registry currently lists is captured. */
  private bufferFor(run: Run): RunActivityBuffer | null {
    const runInstanceId = this.dependencies.readSource.runInstanceIdOf(run);
    if (this.registered.get(run.runId) !== runInstanceId) return null;
    const existing = this.buffers.get(run.runId);
    if (existing?.runInstanceId === runInstanceId) return existing;
    const buffer: RunActivityBuffer = {
      runId: run.runId,
      runInstanceId,
      entries: new Map(),
      index: new Map(),
      bytes: 0,
      nextSeq: 1,
      gap: Object.freeze({ evictedCount: 0, throughSeq: null }),
    };
    this.buffers.set(run.runId, buffer);
    return buffer;
  }

  private project(
    buffer: RunActivityBuffer,
    facts: NormalizedProviderFacts,
    attribution: RunOutputAttribution,
    observedAt: string,
  ): void {
    const lane = laneOf(facts, attribution);
    const context: EntryContext = {
      lane,
      laneKey: laneKey(lane),
      turnId: attribution.turnId,
      providerTurnId: facts.routing.providerTurnId,
      observedAt,
    };

    this.applyNarration(buffer, context, facts);
    for (const use of facts.toolUses) {
      this.applyTool(buffer, context, use.toolUseId, (entry) => ({
        ...entry,
        toolName: use.toolName,
        input: entry.input ?? keepStart(JSON.stringify(use.input), this.limits.maxInputBytes),
      }));
    }
    const progress = facts.toolProgress;
    if (progress) {
      this.applyTool(buffer, context, progress.toolUseId, (entry) => ({
        ...entry,
        toolName: progress.toolName,
        input: keepStart(JSON.stringify(progress.input), this.limits.maxInputBytes),
      }));
    }
    const lifecycle = facts.commandLifecycle;
    if (lifecycle) {
      this.applyTool(buffer, context, lifecycle.commandId, (entry) =>
        lifecycle.status === 'started'
          ? entry
          : { ...entry, status: lifecycle.status, exitCode: lifecycle.exitCode },
      );
    }
    const output = facts.commandOutput;
    if (output) {
      this.applyTool(buffer, context, output.commandId, (entry) => ({
        ...entry,
        output: keepEnd(
          entry.output.text + output.chunk,
          this.limits.maxTextBytes,
          entry.output.truncatedBytes,
        ),
      }));
    }
    for (const result of facts.toolResults) {
      this.applyTool(buffer, context, result.toolUseId, (entry) => ({
        ...entry,
        // A command lifecycle that already settled keeps its own status.
        status:
          entry.status === 'running' ? (result.isError ? 'failed' : 'completed') : entry.status,
        result: keepStart(result.content ?? '', this.limits.maxTextBytes),
      }));
    }
  }

  private applyNarration(
    buffer: RunActivityBuffer,
    context: EntryContext,
    facts: NormalizedProviderFacts,
  ): void {
    const narration = facts.narration;
    if (!narration) return;
    const key = `${context.laneKey}|narration|${facts.routing.itemId ?? ''}`;
    const seq = buffer.index.get(key);
    const current = seq === undefined ? undefined : buffer.entries.get(seq)?.entry;
    const open =
      seq !== undefined && current?.kind === 'narration' && current.open ? current : null;
    const text =
      narration.delivery === 'delta' && open
        ? keepEnd(
            open.text.text + narration.text,
            this.limits.maxTextBytes,
            open.text.truncatedBytes,
          )
        : keepEnd(narration.text, this.limits.maxTextBytes);
    if (open && seq !== undefined) {
      this.write(buffer, seq, {
        ...open,
        text,
        open: !narration.isFinal,
        updatedAt: context.observedAt,
      });
      if (narration.isFinal) this.unindex(buffer, key);
      return;
    }
    const entry: SessionNarrationEntry = {
      kind: 'narration',
      entryId: '',
      seq: 0,
      ...this.base(context),
      text,
      open: !narration.isFinal,
    };
    this.append(buffer, narration.isFinal ? [] : [key], entry);
  }

  private applyTool(
    buffer: RunActivityBuffer,
    context: EntryContext,
    toolUseId: string,
    change: (entry: SessionToolEntry) => SessionToolEntry,
  ): void {
    const key = `${context.laneKey}|tool|${toolUseId}`;
    const seq = buffer.index.get(key);
    const current = seq === undefined ? undefined : buffer.entries.get(seq)?.entry;
    if (seq !== undefined && current?.kind === 'tool') {
      this.write(buffer, seq, { ...change(current), updatedAt: context.observedAt });
      return;
    }
    // Placeholder identity; `append` assigns the real one.
    const opened: SessionToolEntry = {
      kind: 'tool',
      entryId: '',
      seq: 0,
      ...this.base(context),
      toolUseId,
      toolName: null,
      input: null,
      status: 'running',
      output: EMPTY_TEXT,
      result: null,
      exitCode: null,
    };
    this.append(buffer, [key], change(opened));
  }

  private base(context: EntryContext): Omit<SessionActivityEntryBase, 'entryId' | 'seq'> {
    return {
      lane: context.lane,
      turnId: context.turnId,
      providerTurnId: context.providerTurnId,
      createdAt: context.observedAt,
      updatedAt: context.observedAt,
    };
  }

  private append(buffer: RunActivityBuffer, keys: string[], entry: SessionActivityEntry): void {
    const seq = buffer.nextSeq++;
    const full: SessionActivityEntry = Object.freeze({
      ...entry,
      entryId: `${String(buffer.runInstanceId)}:${String(seq)}`,
      seq,
    });
    const bytes = entryBytes(full);
    buffer.entries.set(seq, { entry: full, bytes, keys });
    for (const key of keys) buffer.index.set(key, seq);
    this.account(buffer, bytes);
    this.publishEntry(buffer, full);
    this.enforce(buffer);
  }

  private write(buffer: RunActivityBuffer, seq: number, next: SessionActivityEntry): void {
    const stored = buffer.entries.get(seq);
    if (!stored) return;
    const frozen = Object.freeze(next);
    const bytes = entryBytes(frozen);
    this.account(buffer, bytes - stored.bytes);
    stored.entry = frozen;
    stored.bytes = bytes;
    this.publishEntry(buffer, frozen);
    this.enforce(buffer);
  }

  private unindex(buffer: RunActivityBuffer, key: string): void {
    const seq = buffer.index.get(key);
    if (seq === undefined) return;
    buffer.index.delete(key);
    const stored = buffer.entries.get(seq);
    if (stored) stored.keys = stored.keys.filter((candidate) => candidate !== key);
  }

  private account(buffer: RunActivityBuffer, delta: number): void {
    buffer.bytes += delta;
    this.totalBytes += delta;
  }

  private publishEntry(buffer: RunActivityBuffer, entry: SessionActivityEntry): void {
    this.deliver({
      revision: ++this.revision,
      kind: 'entry',
      runId: buffer.runId,
      runInstanceId: buffer.runInstanceId,
      entry,
    });
  }

  /** Evicts oldest-first until the Run and aggregate budgets hold. */
  private enforce(buffer: RunActivityBuffer): void {
    while (buffer.entries.size > this.limits.maxEntriesPerRun) {
      this.evictOldest(buffer, 'entry-count');
    }
    // The newest entry always survives so an oversized one stays visible.
    while (buffer.bytes > this.limits.maxRunBytes && buffer.entries.size > 1) {
      this.evictOldest(buffer, 'run-bytes');
    }
    while (this.totalBytes > this.limits.maxTotalBytes) {
      const victim = this.oldestBuffer();
      if (!victim || (victim === buffer && buffer.entries.size <= 1)) break;
      this.evictOldest(victim, 'total-bytes');
    }
  }

  private oldestBuffer(): RunActivityBuffer | null {
    let oldest: RunActivityBuffer | null = null;
    let oldestAt = '';
    for (const candidate of this.buffers.values()) {
      const first = candidate.entries.values().next().value;
      if (!first) continue;
      if (oldest === null || first.entry.createdAt < oldestAt) {
        oldest = candidate;
        oldestAt = first.entry.createdAt;
      }
    }
    return oldest;
  }

  private evictOldest(buffer: RunActivityBuffer, reason: SessionActivityEvictionReason): void {
    const first = buffer.entries.keys().next();
    if (first.done) return;
    this.evict(buffer, [first.value], reason);
  }

  private evict(
    buffer: RunActivityBuffer,
    seqs: readonly number[],
    reason: SessionActivityEvictionReason,
  ): void {
    const entryIds: string[] = [];
    let throughSeq = buffer.gap.throughSeq;
    for (const seq of seqs) {
      const stored = buffer.entries.get(seq);
      if (!stored) continue;
      buffer.entries.delete(seq);
      for (const key of stored.keys) {
        if (buffer.index.get(key) === seq) buffer.index.delete(key);
      }
      this.account(buffer, -stored.bytes);
      entryIds.push(stored.entry.entryId);
      throughSeq = Math.max(throughSeq ?? 0, seq);
    }
    if (entryIds.length === 0) return;
    buffer.gap = Object.freeze({
      evictedCount: buffer.gap.evictedCount + entryIds.length,
      throughSeq,
    });
    this.deliver({
      revision: ++this.revision,
      kind: 'evicted',
      runId: buffer.runId,
      runInstanceId: buffer.runInstanceId,
      entryIds,
      reason,
      gap: buffer.gap,
    });
  }

  /** Evicts every entry not updated within the age limit. */
  private expire(): void {
    const cutoff = new Date(this.now().getTime() - this.limits.maxEntryAgeMs).toISOString();
    for (const buffer of [...this.buffers.values()]) {
      const stale = [...buffer.entries.values()]
        .filter((stored) => stored.entry.updatedAt < cutoff)
        .map((stored) => stored.entry.seq);
      if (stale.length > 0) this.evict(buffer, stale, 'age');
    }
  }

  private snapshotOf(buffer: RunActivityBuffer): RunActivitySnapshot {
    return Object.freeze({
      runId: buffer.runId,
      runInstanceId: buffer.runInstanceId,
      entries: Object.freeze([...buffer.entries.values()].map((stored) => stored.entry)),
      gap: buffer.gap,
    });
  }

  private deliver(update: SessionActivityUpdate): void {
    for (const observer of [...this.observers]) {
      try {
        observer(update);
      } catch (error) {
        this.dependencies.logger.warn('session_activity.observer_failed', {
          revision: update.revision,
          kind: update.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

interface EntryContext {
  lane: SessionActivityLane;
  laneKey: string;
  turnId: string | null;
  providerTurnId: string | null;
  observedAt: string;
}
