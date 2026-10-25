import { randomUUID } from 'node:crypto';
import { isReviewAdmission } from './input-admission-payload';
import { InputAdmissionIdentityError } from './input-admission-identity-error';
import type { JsonValue } from '../../durable-data';
import type { ServerLogger } from '../logger';
import { z } from 'zod/v4';
import {
  INPUT_QUEUE_SCHEMA_VERSION,
  decodeStoredRecord,
  type InputIdentity,
  type InputRecordDraft,
  type QuarantinedRecord,
  type ReadableInputRecord,
  type StoredInput,
} from './input-admission-codec';
import { InputAdmissionStore, type InputAdmissionStorePaths } from './input-admission-store';
import { storedTriggerFrameV9Schema } from './storage-schema/v9';

export const MAX_PROJECTION_ATTEMPTS = 3;
/** A `started` projection gates the Turn's output, so it retries quickly and never exhausts. */
export const STARTED_PROJECTION_BACKOFF_MS = { initial: 250, max: 5_000 } as const;

const backoffMs = (attempts: number): number => Math.min(300_000, 5_000 * 2 ** attempts);

const owesProjection = (record: ReadableInputRecord): boolean =>
  record.messageId !== null &&
  record.state !== 'picked' &&
  record.projectedRevision < record.revision &&
  (record.state === 'started' || (record.projectionRetry?.attempts ?? 0) < MAX_PROJECTION_ATTEMPTS);

/**
 * Open records still owe work: execution, settlement delivery, or a status report. Everything
 * else is retained only so replay and cancel-before-input keep recognizing its key.
 */
const isOpen = (record: ReadableInputRecord): boolean =>
  record.state === 'queued' ||
  record.state === 'picked' ||
  record.state === 'started' ||
  (record.state === 'settled' && !record.settlementDelivered) ||
  owesProjection(record);

/**
 * When a failed delivery or report must be retried. Only attempts that have already failed
 * carry a due time; first attempts follow the commit that created them.
 */
const dueAt = (record: ReadableInputRecord): number | null => {
  const due: number[] = [];
  if (owesProjection(record) && (record.projectionRetry?.attempts ?? 0) > 0)
    due.push(record.projectionRetry!.nextAttemptAt);
  if (
    record.state === 'settled' &&
    !record.settlementDelivered &&
    (record.settlementRetry?.attempts ?? 0) > 0
  )
    due.push(record.settlementRetry!.nextAttemptAt);
  return due.length > 0 ? Math.min(...due) : null;
};

/**
 * One recoverable admission boundary shared by every executable input. The CLI is the only
 * writer (one instance per profile), so committed records are served from memory once read.
 * Each session serializes its own inputs; sessions never wait on each other.
 *
 * Only sessions with open records are read at startup, from `open-sessions.json`. Any other
 * session is read the first time it is named. The index may list extra sessions after a
 * crash but never omits an open one: it is written before a record opens its session and
 * after a record closes it.
 */
export class InputAdmissionOwner {
  private readonly store: InputAdmissionStore;
  private opened: Promise<void> | null = null;
  private readonly loaded = new Map<string, readonly ReadableInputRecord[]>();
  /** Records each loaded session holds but cannot read; carried through every commit unchanged. */
  private readonly quarantined = new Map<string, readonly QuarantinedRecord[]>();
  private readonly loading = new Map<string, Promise<readonly ReadableInputRecord[]>>();
  /** Open record keys per session; a session is present only while it has one. */
  private readonly open = new Map<string, Set<string>>();
  /** Unreadable queues remain indexed for recovery but never participate in execution. */
  private readonly unreadableSessions = new Set<string>();
  private indexTail: Promise<void> = Promise.resolve();
  private dueListener: () => void = () => undefined;
  private readonly tails = new Map<string, Promise<void>>();
  /** Queue wait of the work currently running for each session; read by `save` for timing. */
  private readonly queueWaits = new Map<string, number>();
  constructor(
    paths: InputAdmissionStorePaths,
    private readonly logger: ServerLogger,
  ) {
    this.store = new InputAdmissionStore(paths, logger);
  }
  /** Sessions whose records are held in memory; they are never evicted. */
  get cachedSessionCount(): number {
    return this.loaded.size;
  }
  /** Reads the open-session index (rebuilding it once if absent) and loads those sessions. */
  openIndex(): Promise<void> {
    this.opened ??= this.readIndex().catch((error: unknown) => {
      this.opened = null;
      throw error;
    });
    return this.opened;
  }
  private async readIndex(): Promise<void> {
    const migrated = await this.store.migrateLegacyStore();
    const indexed = migrated ? null : await this.store.readOpenSessionIndex();
    // The single permitted pass over every stored session: the index is derived, so a
    // missing or unreadable one is rebuilt rather than read as "nothing open".
    const candidates = indexed ?? (await this.store.listSessionIds());
    for (const sessionId of candidates) {
      let records: readonly ReadableInputRecord[];
      try {
        const session = await this.store.readSession(sessionId);
        records = session.records;
        this.quarantined.set(sessionId, session.quarantined);
      } catch {
        this.unreadableSessions.add(sessionId);
        this.logger.error('input_admission.session_unreadable', {
          agentSessionId: sessionId,
          phase: 'index_load',
          preserved: true,
        });
        continue;
      }
      const keys = new Set(records.filter(isOpen).map((record) => record.key));
      if (keys.size === 0) continue;
      this.loaded.set(sessionId, records);
      this.open.set(sessionId, keys);
    }
    if (indexed === null)
      this.logger.info('input_admission.open_index_rebuilt', {
        scannedSessions: candidates.length,
        openSessions: this.open.size,
      });
    if (indexed === null || this.open.size + this.unreadableSessions.size !== candidates.length)
      await this.writeIndex();
  }
  /** Serialized, and snapshots the open set when it runs, so the last write always wins. */
  private writeIndex(): Promise<void> {
    const write = this.indexTail.then(() =>
      this.store.writeOpenSessionIndex([
        ...new Set([...this.open.keys(), ...this.unreadableSessions]),
      ]),
    );
    this.indexTail = write.catch(() => undefined);
    return write;
  }
  setDueListener(listener: () => void): void {
    this.dueListener = listener;
  }
  /** Resolves once every queued session and index write, including ones queued while waiting, has finished. */
  async drain(): Promise<void> {
    while (this.tails.size > 0) await Promise.all(this.tails.values());
    await this.indexTail;
  }
  private serial<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const queued = performance.now();
    const result = (this.tails.get(sessionId) ?? Promise.resolve()).then(() => {
      this.queueWaits.set(sessionId, performance.now() - queued);
      return work();
    });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(sessionId, tail);
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) {
        this.tails.delete(sessionId);
        this.queueWaits.delete(sessionId);
      }
    });
    return result;
  }
  /** Every record of one session, read from its file on first use. */
  async session(sessionId: string): Promise<readonly ReadableInputRecord[]> {
    await this.openIndex();
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    let loading = this.loading.get(sessionId);
    if (!loading) {
      loading = this.store.readSession(sessionId).then(
        ({ records, quarantined }) => {
          this.loading.delete(sessionId);
          this.unreadableSessions.delete(sessionId);
          // A commit that raced this read is newer.
          if (!this.loaded.has(sessionId)) {
            this.loaded.set(sessionId, records);
            this.quarantined.set(sessionId, quarantined);
          }
          return this.loaded.get(sessionId)!;
        },
        (error: unknown) => {
          this.loading.delete(sessionId);
          throw error;
        },
      );
      this.loading.set(sessionId, loading);
    }
    return loading;
  }
  /**
   * The settlement of a start that ended failed for this conversation. Reads the named session
   * when the caller knows it; otherwise only sessions already in memory are searched.
   */
  async failedStartSettlement(
    conversationId: string,
    agentSessionId?: string,
  ): Promise<JsonValue | null> {
    const sessions = agentSessionId
      ? [await this.session(agentSessionId)]
      : [...this.loaded.values()];
    for (const records of sessions)
      for (const record of records) {
        if (record.state !== 'failed' || record.kind !== 'trigger_frame') continue;
        const frame = storedTriggerFrameV9Schema.safeParse(record.payload);
        if (
          frame.success &&
          frame.data.event.promptType === 'start_run' &&
          frame.data.conversationId === conversationId
        )
          return record.settlement;
      }
    return null;
  }
  /** Sequence numbers count every stored record, quarantined ones included. */
  private storedCount(sessionId: string): number {
    return (
      (this.loaded.get(sessionId)?.length ?? 0) + (this.quarantined.get(sessionId)?.length ?? 0)
    );
  }
  /** Keys of the session's records this build cannot read; they never execute. */
  async quarantinedKeys(sessionId: string): Promise<Array<string | null>> {
    await this.session(sessionId);
    return (this.quarantined.get(sessionId) ?? []).map((record) => record.key);
  }
  async record(sessionId: string, key: string): Promise<ReadableInputRecord> {
    const record = (await this.session(sessionId)).find((item) => item.key === key);
    if (!record) throw new Error('Input admission not found.');
    return record;
  }
  openSessionIds(): string[] {
    return [...this.open.keys()];
  }
  /** Open records of one session, in admission order. */
  async openRecords(sessionId: string): Promise<ReadableInputRecord[]> {
    await this.openIndex();
    const keys = this.open.get(sessionId);
    if (!keys) return [];
    return (await this.session(sessionId)).filter((record) => keys.has(record.key));
  }
  /** Open sessions with an open record owned by this Run. */
  openSessionIdsForRun(runId: string): string[] {
    return this.openSessionIds().filter((sessionId) =>
      this.loaded
        .get(sessionId)
        ?.some((record) => record.runId === runId && this.open.get(sessionId)?.has(record.key)),
    );
  }
  /** Due times of open records; `machineId` excludes records another machine admitted. */
  private openDueTimes(machineId: string | null): Array<{ sessionId: string; at: number }> {
    const due: Array<{ sessionId: string; at: number }> = [];
    for (const [sessionId, keys] of this.open) {
      for (const record of this.loaded.get(sessionId) ?? []) {
        if (!keys.has(record.key) || (machineId !== null && record.machineId !== machineId))
          continue;
        const at = dueAt(record);
        if (at !== null) due.push({ sessionId, at });
      }
    }
    return due;
  }
  earliestDueAt(machineId: string | null = null): number | null {
    const times = this.openDueTimes(machineId).map((due) => due.at);
    return times.length > 0 ? Math.min(...times) : null;
  }
  sessionsWithDue(now = Date.now(), machineId: string | null = null): string[] {
    return [
      ...new Set(
        this.openDueTimes(machineId)
          .filter((due) => due.at <= now)
          .map((due) => due.sessionId),
      ),
    ];
  }
  private assertIdentity(record: ReadableInputRecord, input: InputIdentity): void {
    if (
      record.fingerprint !== input.fingerprint ||
      record.agentSessionId !== input.agentSessionId ||
      record.runId !== input.runId ||
      record.machineId !== input.machineId ||
      record.userId !== input.userId ||
      record.organizationId !== input.organizationId ||
      record.projectId !== input.projectId ||
      record.messageId !== input.messageId
    )
      throw new InputAdmissionIdentityError();
  }
  /** A commit must decode exactly as a later read will, or it is refused before it is written. */
  private decode(draft: InputRecordDraft): ReadableInputRecord {
    const decoded = decodeStoredRecord(z.json().parse(JSON.parse(JSON.stringify(draft))));
    if (decoded.status === 'quarantined')
      throw new Error(`Input admission record is not storable: ${decoded.reason}`);
    return decoded.record;
  }
  private async save(
    draft: InputRecordDraft,
    retiredDraft?: InputRecordDraft,
  ): Promise<ReadableInputRecord> {
    const validationStarted = performance.now();
    const record = this.decode(draft);
    const retired = retiredDraft ? this.decode(retiredDraft) : undefined;
    const validationMs = performance.now() - validationStarted;
    const sessionId = record.agentSessionId;
    const current = await this.session(sessionId);
    const previous = current.find((item) => item.key === record.key);
    const base = retired
      ? current.map((item) => (item.key === retired.key ? retired : item))
      : current;
    const next = previous
      ? base.map((item) => (item.key === record.key ? record : item))
      : [...base, record];
    const before = this.open.get(sessionId);
    const keys = new Set(before);
    if (retired) {
      if (isOpen(retired)) keys.add(retired.key);
      else keys.delete(retired.key);
    }
    if (isOpen(record)) keys.add(record.key);
    else keys.delete(record.key);
    const opens = !before && keys.size > 0;
    const closes = before !== undefined && keys.size === 0;
    const persistStarted = performance.now();
    try {
      if (opens) {
        this.open.set(sessionId, keys);
        await this.writeIndex();
      }
      await this.store.writeSession(sessionId, {
        records: next,
        quarantined: this.quarantined.get(sessionId) ?? [],
      });
    } catch (error) {
      // The index may now list this session without an open record; startup drops it.
      if (opens) this.open.delete(sessionId);
      throw error;
    }
    const persistMs = performance.now() - persistStarted;
    this.loaded.set(sessionId, next);
    if (record.state === 'cancelled' && previous?.state !== 'cancelled') {
      this.logger.info('input_admission.cancellation_committed', {
        operationId: record.key,
        messageId: record.messageId,
        agentSessionId: sessionId,
        runId: record.runId,
        admissionId: record.admissionId,
        revision: record.revision,
        state: record.state,
        platformProjection: 'pending',
      });
    }
    if (closes) {
      this.open.delete(sessionId);
      // The record is durable; a stale index only lists an extra session until the next write.
      await this.writeIndex().catch((error: unknown) =>
        this.logger.warn('input_admission.open_index_write_deferred', {
          agentSessionId: sessionId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } else if (keys.size > 0) this.open.set(sessionId, keys);
    if ((previous ? dueAt(previous) : null) !== dueAt(record)) this.dueListener();
    this.logger.debug('input_admission.committed', {
      operationId: record.key,
      queueWaitMs: this.queueWaits.get(sessionId) ?? 0,
      validationMs,
      persistMs,
      sessionRecordCount: next.length,
      admissionId: record.admissionId,
      state: record.state,
      revision: record.revision,
      agentSessionId: sessionId,
    });
    return record;
  }
  /**
   * Commits a new input and, in the same serialized commit, decides its disposition: when
   * nothing earlier is open and `canReserve` passes, the input takes the session's single
   * execution slot as `picked` (exactly what `pickup` would select next), so a second rapid
   * admission sees it and waits. `canReserve` runs inside the serial section and must not await.
   * A replay returns the stored record and its recorded disposition unchanged.
   */
  admit(
    input: InputIdentity,
    stored: StoredInput,
    canReserve: (input: InputIdentity) => boolean,
    replacesReviewTurnId?: string,
  ): Promise<{ record: ReadableInputRecord; replayed: boolean }> {
    return this.serial(input.agentSessionId, async () => {
      const records = await this.session(input.agentSessionId);
      const existing = records.find((record) => record.key === input.key);
      if (existing) {
        this.assertIdentity(existing, input);
        return { record: existing, replayed: true };
      }
      const predecessor = replacesReviewTurnId
        ? records.find((record) => record.turnId === replacesReviewTurnId)
        : undefined;
      if (replacesReviewTurnId) {
        if (
          !predecessor ||
          predecessor.runId !== input.runId ||
          predecessor.userId !== input.userId ||
          !isReviewAdmission(predecessor)
        )
          throw new Error('Legacy Review replacement ownership is invalid.');
        if (['settled', 'cancelled', 'failed'].includes(predecessor.state))
          throw new Error('Legacy Review replacement has already settled.');
      }
      const blocked = (await this.openRecords(input.agentSessionId))
        .filter((record) => record.key !== predecessor?.key)
        .some(
          (record) =>
            record.state === 'queued' ||
            record.state === 'picked' ||
            record.state === 'started' ||
            (record.state === 'settled' && !record.settlementDelivered),
        );
      const immediate = !blocked && canReserve(input);
      // Replace the obsolete wait and reserve recovery in one durable session write.
      const record = await this.save(
        {
          ...input,
          ...stored,
          admissionId: randomUUID(),
          sequence: this.storedCount(input.agentSessionId),
          // An immediate input keeps the revision it would have had after queued-then-picked, so
          // its first projection (`started`) carries the same revision either way.
          ...(immediate
            ? { state: 'picked', turnId: randomUUID(), revision: 2 }
            : { state: 'queued', turnId: null, revision: 1 }),
          admissionDisposition: immediate ? 'immediate' : 'queued',
          projectedRevision: 0,
          settlement: null,
          settlementDelivered: false,
        },
        predecessor
          ? { ...predecessor, state: 'cancelled', revision: predecessor.revision + 1 }
          : undefined,
      );
      return { record, replayed: false };
    });
  }
  cancel(input: InputIdentity): Promise<ReadableInputRecord> {
    return this.serial(input.agentSessionId, async () => {
      const records = await this.session(input.agentSessionId);
      const existing = records.find((record) => record.key === input.key);
      if (existing) {
        this.assertIdentity(existing, input);
        if (existing.state !== 'queued') return existing;
        return this.save({ ...existing, state: 'cancelled', revision: existing.revision + 1 });
      }
      // A cancellation may overtake its original signed input. Retain its exact identity forever.
      return this.save({
        ...input,
        kind: null,
        keyKind: 'operation',
        payload: null,
        admissionId: randomUUID(),
        sequence: this.storedCount(input.agentSessionId),
        state: 'cancelled',
        admissionDisposition: 'queued',
        revision: 1,
        projectedRevision: 0,
        turnId: null,
        settlement: null,
        settlementDelivered: false,
      });
    });
  }
  pickup(sessionId: string): Promise<ReadableInputRecord | null> {
    return this.serial(sessionId, async () => {
      const records = await this.openRecords(sessionId);
      const occupied = records.find(
        (record) =>
          record.state === 'picked' ||
          record.state === 'started' ||
          (record.state === 'settled' && !record.settlementDelivered),
      );
      if (occupied) return occupied.state === 'picked' ? occupied : null;
      const head = records.find((record) => record.state === 'queued');
      return head
        ? this.save({ ...head, state: 'picked', turnId: randomUUID(), revision: head.revision + 1 })
        : null;
    });
  }
  transition(
    sessionId: string,
    key: string,
    state: 'started' | 'failed' | 'settled',
    settlement: JsonValue = null,
  ): Promise<ReadableInputRecord> {
    return this.serial(sessionId, async () => {
      const record = await this.record(sessionId, key);
      if (record.state === state) return record;
      if (
        (state === 'started' && record.state !== 'picked') ||
        (state === 'failed' && record.state !== 'picked' && record.state !== 'queued') ||
        (state === 'settled' && record.state !== 'started')
      ) {
        this.logger.error('input_admission.transition_rejected', {
          agentSessionId: record.agentSessionId,
          runId: record.runId,
          admissionId: record.admissionId,
          turnId: record.turnId,
          previous: record.state,
          requested: state,
        });
        throw new Error(`Invalid input lifecycle transition: ${record.state} -> ${state}.`);
      }
      return this.save({ ...record, state, settlement, revision: record.revision + 1 });
    });
  }
  /**
   * Sets aside a record whose stored data cannot be read at the point it is needed. Its bytes
   * are kept unchanged and it leaves the open set, so the rest of the session keeps working.
   */
  quarantine(sessionId: string, key: string, reason: string): Promise<void> {
    return this.serial(sessionId, async () => {
      const records = await this.session(sessionId);
      const record = records.find((item) => item.key === key);
      if (!record) return;
      const next = records.filter((item) => item.key !== key);
      const quarantined = [
        ...(this.quarantined.get(sessionId) ?? []),
        {
          key,
          reason,
          sourceSchemaVersion: INPUT_QUEUE_SCHEMA_VERSION,
          raw: z.json().parse(JSON.parse(JSON.stringify(record))),
        },
      ];
      await this.store.writeSession(sessionId, { records: next, quarantined });
      this.loaded.set(sessionId, next);
      this.quarantined.set(sessionId, quarantined);
      const keys = this.open.get(sessionId);
      if (keys?.delete(key) && keys.size === 0) {
        this.open.delete(sessionId);
        await this.writeIndex().catch(() => undefined);
      }
      this.logger.warn('input_admission.record_quarantined', {
        agentSessionId: sessionId,
        recordKey: key,
        reason,
        sourceSchemaVersion: INPUT_QUEUE_SCHEMA_VERSION,
        preserved: true,
      });
    });
  }
  reserveProjection(
    sessionId: string,
    key: string,
    now = Date.now(),
  ): Promise<ReadableInputRecord | null> {
    return this.serial(sessionId, async () => {
      const record = await this.record(sessionId, key);
      const attempts = record.projectionRetry?.attempts ?? 0;
      const started = record.state === 'started';
      if (!owesProjection(record) || (record.projectionRetry?.nextAttemptAt ?? 0) > now)
        return null;
      // Reserve before the network call so crashes and restarts cannot reset the budget.
      return this.save({
        ...record,
        projectionRetry: {
          attempts: attempts + 1,
          nextAttemptAt:
            now +
            (started
              ? Math.min(
                  STARTED_PROJECTION_BACKOFF_MS.max,
                  STARTED_PROJECTION_BACKOFF_MS.initial * 2 ** Math.min(attempts, 16),
                )
              : backoffMs(attempts)),
        },
      });
    });
  }
  /** Settlement delivery never exhausts; its backoff is reserved before each attempt. */
  reserveSettlement(
    sessionId: string,
    key: string,
    now = Date.now(),
  ): Promise<ReadableInputRecord | null> {
    return this.serial(sessionId, async () => {
      const record = await this.record(sessionId, key);
      if (
        record.state !== 'settled' ||
        record.settlementDelivered ||
        (record.settlementRetry?.nextAttemptAt ?? 0) > now
      )
        return null;
      const attempts = record.settlementRetry?.attempts ?? 0;
      return this.save({
        ...record,
        settlementRetry: { attempts: attempts + 1, nextAttemptAt: now + backoffMs(attempts) },
      });
    });
  }
  acknowledge(
    sessionId: string,
    key: string,
    revision: number,
    settlementDelivered = false,
  ): Promise<void> {
    return this.serial(sessionId, async () => {
      const { settlementRetry, ...record } = await this.record(sessionId, key);
      const delivered = record.settlementDelivered || settlementDelivered;
      await this.save({
        ...record,
        projectedRevision: Math.max(record.projectedRevision, revision),
        ...(revision > record.projectedRevision
          ? { projectionRetry: { attempts: 0, nextAttemptAt: 0 } }
          : {}),
        settlementDelivered: delivered,
        ...(settlementRetry && !delivered ? { settlementRetry } : {}),
      });
    });
  }
}
