import type { ServerLogger } from '../logger';

export type OperationTimelineKeyKind = 'operation' | 'trigger_message';

export type OperationTimelineMark =
  | 'received'
  | 'verified'
  | 'admitted'
  | 'receiptCommitted'
  | 'pickedUp'
  | 'runReady'
  | 'bootstrapStarted'
  | 'bootstrapEnded'
  | 'turnInputsResolved'
  | 'startingEmitted'
  | 'firstProviderEvent';

export type OperationTimelineDuration =
  | 'materializeOnlyAckMs'
  | 'workflowResolvedMs'
  | 'idleReapWaitMs'
  | 'seedWaitMs'
  | 'workspaceMs'
  | 'resolvePromptMs';

export type OperationTimelineOutcome =
  | 'provider_output'
  | 'no_provider_output'
  | 'rejected'
  | 'failed';

export interface OperationTimelineMetadata {
  /** Process-local delivery that registered this timeline; matches admission substep logs. */
  admissionAttempt?: number;
  admissionId?: string;
  agentSessionId?: string;
  runId?: string;
  turnId?: string;
  promptType?: string;
  provider?: string;
  providerRunner?: 'new' | 'resume';
  projectAssistant?: boolean;
}

interface OperationTimelineEntry {
  key: string;
  keyKind: OperationTimelineKeyKind;
  receivedAt: string | null;
  origin: number;
  marks: Partial<Record<OperationTimelineMark, number>>;
  durations: Partial<Record<OperationTimelineDuration, number>>;
  metadata: OperationTimelineMetadata;
  partial: boolean;
  expiryTimer: ReturnType<typeof setTimeout>;
}

const ENTRY_TTL_MS = 10 * 60 * 1000;

/** Process-local, single-emission timing for one admitted input. */
export class OperationTimelineRegistry {
  private readonly entriesByKey = new Map<string, OperationTimelineEntry>();
  private readonly entriesByTurnId = new Map<string, OperationTimelineEntry>();

  public constructor(
    private readonly logger: ServerLogger,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly wallClockNow: () => Date = () => new Date(),
  ) {}

  public register(input: {
    key: string;
    keyKind: OperationTimelineKeyKind;
    receivedAt: string;
    origin: number;
    metadata?: OperationTimelineMetadata;
  }): void {
    if (this.entriesByKey.has(input.key)) return;
    const entry = this.createEntry({
      ...input,
      partial: false,
      receivedAt: input.receivedAt,
    });
    this.entriesByKey.set(entry.key, entry);
    this.markEntry(entry, 'received', input.origin);
  }

  /** Rebuild a bounded partial timeline when a durable queued input survived restart. */
  public registerRecovered(input: {
    key: string;
    keyKind: OperationTimelineKeyKind;
    origin?: number;
    metadata?: OperationTimelineMetadata;
  }): void {
    if (this.entriesByKey.has(input.key)) return;
    const entry = this.createEntry({
      ...input,
      origin: input.origin ?? this.monotonicNow(),
      partial: true,
      receivedAt: null,
    });
    this.entriesByKey.set(entry.key, entry);
  }

  public has(keyOrTurnId: string): boolean {
    return this.find(keyOrTurnId) !== undefined;
  }

  public aliasTurnId(key: string, turnId: string): void {
    const entry = this.entriesByKey.get(key);
    if (!entry) return;
    entry.metadata.turnId = turnId;
    this.entriesByTurnId.set(turnId, entry);
  }

  public updateMetadata(keyOrTurnId: string, metadata: OperationTimelineMetadata): void {
    const entry = this.find(keyOrTurnId);
    if (!entry) return;
    entry.metadata = { ...entry.metadata, ...metadata };
  }

  public mark(keyOrTurnId: string, mark: OperationTimelineMark, at = this.monotonicNow()): void {
    const entry = this.find(keyOrTurnId);
    if (entry) this.markEntry(entry, mark, at);
  }

  public hasMark(keyOrTurnId: string, mark: OperationTimelineMark): boolean {
    return this.find(keyOrTurnId)?.marks[mark] !== undefined;
  }

  public recordDuration(
    keyOrTurnId: string,
    duration: OperationTimelineDuration,
    durationMs: number,
  ): void {
    const entry = this.find(keyOrTurnId);
    if (!entry) return;
    entry.durations[duration] = (entry.durations[duration] ?? 0) + Math.max(0, durationMs);
  }

  public recordDurationAt(
    keyOrTurnId: string,
    duration: OperationTimelineDuration,
    at: number,
  ): void {
    const entry = this.find(keyOrTurnId);
    if (!entry || entry.receivedAt === null) return;
    this.recordDuration(keyOrTurnId, duration, at - entry.origin);
  }

  public markPartial(keyOrTurnId: string): void {
    const entry = this.find(keyOrTurnId);
    if (entry) entry.partial = true;
  }

  public emit(
    keyOrTurnId: string,
    outcome: OperationTimelineOutcome,
    fields: OperationTimelineMetadata = {},
  ): void {
    const entry = this.find(keyOrTurnId);
    if (!entry) return;
    const timeline = {
      key: entry.key,
      keyKind: entry.keyKind,
      ...entry.metadata,
      ...fields,
      receivedAt: entry.receivedAt,
      marks: { ...entry.marks },
      durations: { ...entry.durations },
      outcome,
      projectAssistant: entry.metadata.projectAssistant ?? false,
      ...(entry.partial ? { partial: true } : {}),
    };
    this.remove(entry);
    this.logger.info('agent_operation.timeline', timeline);
  }

  private createEntry(input: {
    key: string;
    keyKind: OperationTimelineKeyKind;
    origin: number;
    receivedAt: string | null;
    partial: boolean;
    metadata?: OperationTimelineMetadata;
  }): OperationTimelineEntry {
    const entry = {
      key: input.key,
      keyKind: input.keyKind,
      receivedAt: input.receivedAt,
      origin: input.origin,
      marks: {},
      durations: {},
      metadata: { ...input.metadata },
      partial: input.partial,
      expiryTimer: setTimeout(() => this.remove(entry), ENTRY_TTL_MS),
    } satisfies OperationTimelineEntry;
    entry.expiryTimer.unref?.();
    return entry;
  }

  private find(keyOrTurnId: string): OperationTimelineEntry | undefined {
    return this.entriesByKey.get(keyOrTurnId) ?? this.entriesByTurnId.get(keyOrTurnId);
  }

  private markEntry(entry: OperationTimelineEntry, mark: OperationTimelineMark, at: number): void {
    if (entry.marks[mark] !== undefined) return;
    entry.marks[mark] = Math.max(0, at - entry.origin);
  }

  private remove(entry: OperationTimelineEntry): void {
    clearTimeout(entry.expiryTimer);
    if (this.entriesByKey.get(entry.key) === entry) this.entriesByKey.delete(entry.key);
    for (const [turnId, aliased] of this.entriesByTurnId) {
      if (aliased === entry) this.entriesByTurnId.delete(turnId);
    }
  }
}
