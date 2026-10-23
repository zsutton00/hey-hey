import { DeterministicE2EEvidence } from '../../run/runners/deterministic-e2e-evidence';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isReviewAdmission, type RunFollowUpAdmission } from './input-admission-payload';
import { canonicalizeJson } from '../trigger-verification/jcs';
export { collaborationPayloadSchema } from './input-admission-payload';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { RunAttachmentNotFoundError, RunAttachmentStore } from '../run-attachment-store';
import { StagedBrowserTabNotFoundError } from '../../browser/run-tabs';
import { SessionValidationError } from '../../session/errors';
import { MissingServiceBindingError } from '../services/run-errors';
import { failureProjection } from './start-failure';
import type { RunStore } from '../../run-store/run-store';
import { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import { z as durable } from 'zod/v4';
import {
  AgentSessionsApi,
  ProjectsApi,
  type InputExecutionProjection,
  type AgentInteractionSettledTurn,
} from '../../shared/api/generated/api';
import { Configuration } from '../../shared/api/generated/configuration';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  type LocalRunPromptRequest,
  type SendMessageOptions,
} from '../../shared/agent-bridge-contract/contract';
import type { KeyPairStore } from '../../credentials';
import type { RunRegistry } from '../../run/run-registry';
import type { LocalAgentService } from '../local-agent-service';
import type { ServerLogger } from '../logger';
import { toCreateRunRequest, toRunPromptRequest } from '../trigger-verification/dispatch';
import { storedSettlementCorrelationV4Schema } from './storage-schema/v4';
import {
  InputAdmissionOwner,
  MAX_PROJECTION_ATTEMPTS,
  STARTED_PROJECTION_BACKOFF_MS,
} from './input-admission-owner';
import {
  storedInput,
  type InputIdentity,
  type OpenInputRecord,
  type ReadableInputRecord,
  type StoredInput,
} from './input-admission-codec';
import type { OperationTimelineRegistry } from './operation-timeline';
import { projectionDiagnostics } from './projection-diagnostics';

const id = z.string().uuid();
const isTerminalInputDeliveryRejection = (error: unknown): boolean =>
  error instanceof SessionValidationError ||
  error instanceof RunAttachmentNotFoundError ||
  error instanceof StagedBrowserTabNotFoundError ||
  error instanceof MissingServiceBindingError ||
  (error instanceof LocalAgentApiError && error.statusCode === 400);

const settledSchema = z.object({
  turnId: id,
  terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
  completedAssistantMessageId: id.nullable(),
  reports: z.array(id),
  settledAt: z.string(),
});

/** The platform answered `accepted: false`: definitive, so retrying cannot help. */
class ProjectionRejectedError extends Error {}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type PlatformApis = { machineId: string; projects: ProjectsApi; sessions: AgentSessionsApi };

/** A pass that did no work is logged only when at least this slow. */
const SLOW_PASS_LOG_MS = 100;
/** Retry delay for a pickup or recovery the Run refused for a transient reason. */
const SESSION_RETRY_MS = { initial: 1_000, max: 60_000 } as const;
/** Floor between retry timer firings, so a due record another path is handling cannot spin it. */
const MIN_RETRY_GAP_MS = 250;

type PassWork = 'picked' | 'delivered' | 'reported' | 'settled' | 'recovered';

/** Accumulated per-pass substep durations; fields carry durations and counts only. */
class PassTimings {
  private readonly started = performance.now();
  private readonly totals: Record<string, number> = {};
  private readonly work: Partial<Record<PassWork, number>> = {};
  async measure<T>(substep: string, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.totals[substep] = (this.totals[substep] ?? 0) + performance.now() - started;
    }
  }
  did(work: PassWork): void {
    this.work[work] = (this.work[work] ?? 0) + 1;
  }
  /** A pass that did nothing, did not fail, and was quick logs nothing. */
  log(logger: ServerLogger, event: string, fields: Record<string, unknown>): void {
    const elapsedMs = performance.now() - this.started;
    if (
      fields['outcome'] !== 'failed' &&
      Object.keys(this.work).length === 0 &&
      elapsedMs < SLOW_PASS_LOG_MS
    )
      return;
    logger.debug(event, { ...fields, elapsedMs, ...this.work, ...this.totals });
  }
}

/** Admission keys are UUIDs; derive one deterministically so a replayed stable key collides. */
const stableAdmissionKey = (stableKey: string): string => {
  const hex = createHash('sha256').update(stableKey).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Drives only open admission obligations; Run still decides when execution is possible. There
 * is no sweep. `advance` handles one session's open records, and runs when that session's
 * committed state changes, when its Run reports it can take input (`durableInputReady`), and
 * once per open session at startup. A single timer handles failed deliveries and reports at
 * their persisted due time.
 */
export class InputAdmissionLifecycle implements RunFollowUpAdmission {
  private starting: Promise<void> | null = null;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt: number | null = null;
  /** Machine of the last successful platform read; foreign records are never due here. */
  private machineId: string | null = null;
  /** In-memory retries for pickup and recovery a Run refused transiently, per session. */
  private readonly sessionRetries = new Map<string, { attempts: number; at: number | null }>();
  private readonly recoveryPending = new Set<string>();
  private readonly advancing = new Map<string, Promise<void>>();
  private readonly advanceAgain = new Set<string>();
  private readonly scheduled = new Set<string>();
  private readonly projecting = new Set<string>();
  private readonly settling = new Set<string>();
  private readonly platformUnavailableSessions = new Set<string>();
  constructor(
    public readonly owner: InputAdmissionOwner,
    private readonly service: LocalAgentService,
    private readonly runs: RunRegistry,
    private readonly keys: KeyPairStore,
    private readonly apiBaseUrl: string,
    private readonly logger: ServerLogger,
    private readonly pickupReady: () => boolean,
    private readonly runStore: RunStore,
    private readonly operationTimeline?: OperationTimelineRegistry,
    private readonly attachmentStore = new RunAttachmentStore(),
  ) {}
  private async platform(timings = new PassTimings()): Promise<PlatformApis | null> {
    const machineId = await timings.measure('machineIdMs', () => this.keys.loadCurrentMachineId());
    if (!machineId) return null;
    this.machineId = machineId;
    const credential = await timings.measure('credentialMs', () =>
      this.keys.loadMachineCredential(machineId),
    );
    if (!credential) return null;
    const config = new Configuration({ accessToken: credential, basePath: this.apiBaseUrl });
    return { machineId, projects: new ProjectsApi(config), sessions: new AgentSessionsApi(config) };
  }
  /** Settles a Turn a restart interrupted; false when the record needs no recovery. */
  private async recover(record: ReadableInputRecord): Promise<boolean> {
    if (record.state !== 'started' || !record.turnId || this.runs.get(record.runId)?.isProcessing)
      return false;
    const restore = new RunReadRestoreCoordinator({
      runStore: this.runStore,
      runRegistry: this.runs,
      logger: this.logger,
    });
    const run = await restore.restoreIdentity(record.runId);
    const evidence = await run.recoverInterruptedInput(record.turnId);
    await this.owner.transition(
      record.agentSessionId,
      record.key,
      'settled',
      durable.json().parse(evidence),
    );
    return true;
  }
  async inspectReviewContinuation(sessionId: string, runId: string, turnId: string) {
    const record = (await this.owner.session(sessionId)).find(
      (item) => item.runId === runId && item.turnId === turnId,
    );
    if (!record) throw new Error('Legacy Review continuation admission is missing.');
    if (!isReviewAdmission(record))
      throw new Error('Legacy Review continuation does not own a Review admission.');
    return {
      userId: record.userId,
      settled: ['settled', 'cancelled', 'failed'].includes(record.state),
    };
  }
  /** Commit a Run-owned follow-up through the same reserving admission as delivered inputs. */
  async admit(input: Parameters<RunFollowUpAdmission['admit']>[0]): Promise<{ replayed: boolean }> {
    const machineId = await this.keys.loadCurrentMachineId();
    if (!machineId) throw new Error('Run follow-up admission requires a paired machine.');
    const payload = durable.json().parse(input.payload);
    const { replayed } = await this.admitInput(
      {
        key: stableAdmissionKey(input.stableKey),
        fingerprint: createHash('sha256').update(canonicalizeJson(payload)).digest('hex'),
        agentSessionId: input.agentSessionId,
        runId: input.runId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        machineId,
        messageId: null,
      },
      storedInput('run_follow_up', 'operation', payload),
      input.payload.origin === 'review_service_recovery' ? input.payload.replacesTurnId : undefined,
    );
    return { replayed };
  }
  /**
   * Commits an input and reserves immediate execution when the Run could take it now, then
   * advances the session (replays too, re-driving open work) so pickup delivers it. The returned
   * record carries the recorded disposition; reserving never reports `started`, which waits for
   * execution itself.
   */
  async admitInput(
    input: InputIdentity,
    stored: StoredInput,
    replacesReviewTurnId?: string,
  ): Promise<{ record: ReadableInputRecord; replayed: boolean }> {
    const machineId = await this.keys.loadCurrentMachineId();
    const admitted = await this.owner.admit(
      input,
      stored,
      (candidate) =>
        this.starting !== null &&
        !this.disposed &&
        this.pickupReady() &&
        candidate.machineId === machineId &&
        this.runs.canAcceptDurableInput(candidate.runId),
      replacesReviewTurnId,
    );
    DeterministicE2EEvidence.current()?.record('admission', {
      operationId: input.key,
      runId: input.runId,
      turnId: admitted.record.turnId,
      replayed: admitted.replayed,
    });
    void this.advance(input.agentSessionId);
    return admitted;
  }
  /**
   * Opens the queue once: reads only the open sessions, recovers interrupted Turns, retries
   * undelivered settlements, advances each open session, then arms the retry timer.
   */
  start(): Promise<void> {
    this.starting ??= this.startup();
    return this.starting;
  }
  private async startup(): Promise<void> {
    const timings = new PassTimings();
    let outcome = 'completed';
    try {
      await timings.measure('openIndexMs', () => this.owner.openIndex());
      const platform = await this.platform(timings);
      if (!platform) {
        outcome = 'no_platform';
        return;
      }
      for (const sessionId of this.owner.openSessionIds()) {
        for (const record of await this.owner.openRecords(sessionId)) {
          if (
            (record.state === 'queued' || record.state === 'picked') &&
            !this.operationTimeline?.has(record.key)
          ) {
            this.operationTimeline?.registerRecovered({
              key: record.key,
              keyKind: record.keyKind,
              metadata: {
                admissionId: record.admissionId,
                agentSessionId: record.agentSessionId,
                runId: record.runId,
                ...(record.turnId ? { turnId: record.turnId } : {}),
              },
            });
          }
          if (record.machineId !== platform.machineId) continue;
          if (record.state === 'started') {
            this.recoveryPending.add(record.key);
            await timings.measure('recoveryMs', () => this.recoverSafely(record, timings));
          }
        }
      }
      await timings.measure('advanceMs', () => this.advanceOpenSessions());
    } catch (error) {
      outcome = 'failed';
      this.logger.error('input_admission.recovery_unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      timings.log(this.logger, 'input_admission.startup.timing', {
        outcome,
        openSessionCount: this.owner.openSessionIds().length,
      });
      this.owner.setDueListener(() => this.armRetry());
      this.armRetry();
    }
  }
  /** Stops new passes synchronously, then resolves once in-flight passes and queued writes finish. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
    await Promise.allSettled(this.advancing.values());
    await this.owner.drain();
  }
  /** Advances every open session; used at startup and when pickup becomes possible again. */
  async advanceOpenSessions(): Promise<void> {
    await Promise.all(this.owner.openSessionIds().map((sessionId) => this.advance(sessionId)));
  }
  /** A Run can take its next durable input: advance the open sessions that Run owns. */
  durableInputReady(runId: string): void {
    for (const sessionId of this.owner.openSessionIdsForRun(runId)) void this.advance(sessionId);
  }
  private retrySession(sessionId: string): void {
    const attempts = (this.sessionRetries.get(sessionId)?.attempts ?? 0) + 1;
    const wait = Math.min(SESSION_RETRY_MS.max, SESSION_RETRY_MS.initial * 2 ** (attempts - 1));
    this.sessionRetries.set(sessionId, { attempts, at: Date.now() + wait });
    this.armRetry();
  }
  /** Arms the single retry timer for the earliest due record or refused session. */
  private armRetry(floor = 0): void {
    if (this.disposed || !this.starting) return;
    const due = [
      this.owner.earliestDueAt(this.machineId),
      ...[...this.sessionRetries.values()].map((retry) => retry.at),
    ].filter((at): at is number => at !== null);
    const next = due.length > 0 ? Math.max(floor, Math.min(...due)) : null;
    if (next === this.retryAt) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = next;
    if (next === null) return;
    this.retryTimer = setTimeout(() => void this.fireRetry(), Math.max(0, next - Date.now()));
    this.retryTimer.unref?.();
  }
  /** Touches only sessions with a due record or a due refused pickup or recovery. */
  private async fireRetry(): Promise<void> {
    this.retryTimer = null;
    this.retryAt = null;
    const now = Date.now();
    const sessions = new Set(this.owner.sessionsWithDue(now, this.machineId));
    for (const [sessionId, retry] of this.sessionRetries) {
      if (retry.at === null || retry.at > now) continue;
      // Keep the attempt count while the retry runs. A failed recovery or pickup
      // schedules the next delay from this count instead of restarting at 1s.
      this.sessionRetries.set(sessionId, { ...retry, at: null });
      sessions.add(sessionId);
    }
    await Promise.all(
      [...sessions].map(async (sessionId) => {
        for (const record of await this.owner.openRecords(sessionId).catch(() => [])) {
          if (this.recoveryPending.has(record.key)) await this.recoverSafely(record);
        }
        await this.advance(sessionId);
        if (this.sessionRetries.get(sessionId)?.at === null) this.sessionRetries.delete(sessionId);
      }),
    );
    this.armRetry(now + MIN_RETRY_GAP_MS);
  }
  /** Resolves after every pass requested so far for this session, including a coalesced rerun. */
  advance(sessionId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const running = this.advancing.get(sessionId);
    if (running) {
      this.advanceAgain.add(sessionId);
      return running.then(() => this.advancing.get(sessionId));
    }
    const work = this.advanceSession(sessionId).finally(() => {
      this.advancing.delete(sessionId);
      if (this.advanceAgain.delete(sessionId)) void this.advance(sessionId);
    });
    this.advancing.set(sessionId, work);
    return work;
  }
  private async advanceSession(sessionId: string): Promise<void> {
    const timings = new PassTimings();
    let outcome = 'completed';
    try {
      const platform = await this.platform(timings);
      if (!platform) {
        outcome = 'no_platform';
        if (!this.platformUnavailableSessions.has(sessionId)) {
          this.platformUnavailableSessions.add(sessionId);
          for (const record of await this.owner.openRecords(sessionId)) {
            if (record.messageId && record.projectedRevision < record.revision)
              this.logger.warn('input_admission.projection_unavailable', {
                operationId: record.key,
                messageId: record.messageId,
                agentSessionId: sessionId,
                admissionId: record.admissionId,
                state: record.state,
                revision: record.revision,
                reason: 'platform_unavailable',
              });
          }
        }
        return;
      }
      this.platformUnavailableSessions.delete(sessionId);
      const records = (await this.owner.openRecords(sessionId)).filter(
        (record) => record.machineId === platform.machineId,
      );
      if (this.pickupReady())
        await timings.measure('pickupMs', () =>
          this.pickup(sessionId, records, platform.sessions, timings),
        );
      // Decide pickup first: only inputs left waiting may enter the visible queue.
      // Re-read committed state because delivery callbacks may already have started a Turn.
      for (const record of await this.owner.openRecords(sessionId)) {
        // An admission committed after this pass's pickup decision is decided by the rerun.
        if (record.state === 'queued' && !records.some((previous) => previous.key === record.key))
          continue;
        if (record.machineId !== platform.machineId) continue;
        if (record.state === 'settled' && !record.settlementDelivered)
          await timings.measure('settlementMs', () =>
            this.settleSafely(record, platform.sessions, timings),
          );
        await timings.measure('projectionMs', () =>
          this.projectSafely(record, platform.projects, timings),
        );
      }
    } catch (error) {
      outcome = 'failed';
      this.logger.error('input_admission.advance_failed', {
        agentSessionId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      timings.log(this.logger, 'input_admission.advance.timing', {
        agentSessionId: sessionId,
        outcome,
      });
    }
  }
  private async recoverSafely(record: ReadableInputRecord, timings?: PassTimings): Promise<void> {
    try {
      if (await this.recover(record)) timings?.did('recovered');
      this.recoveryPending.delete(record.key);
      this.sessionRetries.delete(record.agentSessionId);
    } catch (error) {
      this.logger.warn('input_admission.recovery_deferred', {
        admissionId: record.admissionId,
        runId: record.runId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.retrySession(record.agentSessionId);
    }
  }
  private async pickup(
    sessionId: string,
    records: readonly ReadableInputRecord[],
    sessions: AgentSessionsApi,
    timings: PassTimings,
  ): Promise<void> {
    const candidate = records.find(
      (record) => record.state === 'queued' || record.state === 'picked',
    );
    if (!candidate || this.scheduled.has(candidate.admissionId)) return;
    if (!this.runs.canAcceptDurableInput(candidate.runId)) return;
    let picked: ReadableInputRecord | null;
    try {
      picked = await this.owner.pickup(sessionId);
    } catch (error) {
      this.operationTimeline?.emit(candidate.key, 'failed', {
        admissionId: candidate.admissionId,
        agentSessionId: candidate.agentSessionId,
        runId: candidate.runId,
      });
      throw error;
    }
    if (picked?.state !== 'picked' || this.scheduled.has(picked.admissionId)) return;
    timings.did('picked');
    if (picked.turnId) {
      this.operationTimeline?.aliasTurnId(picked.key, picked.turnId);
      this.operationTimeline?.mark(picked.key, 'pickedUp');
    }
    this.operationTimeline?.updateMetadata(picked.key, {
      admissionId: picked.admissionId,
      agentSessionId: picked.agentSessionId,
      runId: picked.runId,
      ...(picked.turnId ? { turnId: picked.turnId } : {}),
    });
    this.logger.info('input_admission.picked', {
      operationId: picked.key,
      keyKind: picked.keyKind,
      admissionId: picked.admissionId,
      turnId: picked.turnId,
      agentSessionId: picked.agentSessionId,
      runId: picked.runId,
    });
    this.scheduled.add(picked.admissionId);
    try {
      await this.deliver(picked, sessions);
      timings.did('delivered');
      this.sessionRetries.delete(sessionId);
    } catch (error) {
      this.scheduled.delete(picked.admissionId);
      const terminalRejection = isTerminalInputDeliveryRejection(error);
      if (terminalRejection) {
        await this.owner.transition(
          picked.agentSessionId,
          picked.key,
          'failed',
          error instanceof MissingServiceBindingError
            ? {
                failure: { reason: 'service_folder_not_bound', serviceIds: error.serviceIds },
              }
            : null,
        );
        this.operationTimeline?.emit(picked.key, 'rejected', {
          admissionId: picked.admissionId,
          agentSessionId: picked.agentSessionId,
          runId: picked.runId,
          ...(picked.turnId ? { turnId: picked.turnId } : {}),
        });
      }
      this.logger.warn(
        terminalRejection
          ? 'input_admission.delivery_rejected'
          : 'input_admission.delivery_deferred',
        {
          admissionId: picked.admissionId,
          ...(error instanceof LocalAgentApiError ? { code: error.code } : {}),
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // Nothing else re-offers a picked input whose delivery failed transiently.
      if (!terminalRejection) this.retrySession(sessionId);
    }
  }
  private async settleSafely(
    record: ReadableInputRecord,
    api: AgentSessionsApi,
    timings?: PassTimings,
  ): Promise<void> {
    if (this.settling.has(record.admissionId)) return;
    this.settling.add(record.admissionId);
    let attempted = record;
    try {
      // Reserve before the network call so a failure is retried at its persisted due time.
      const reserved = await this.owner.reserveSettlement(record.agentSessionId, record.key);
      if (!reserved) return;
      attempted = reserved;
      await this.settle(reserved, api);
      timings?.did('settled');
    } catch (error) {
      this.logger.warn('input_admission.settlement_deferred', {
        admissionId: record.admissionId,
        attempt: attempted.settlementRetry?.attempts,
        nextAttemptAt: attempted.settlementRetry?.nextAttemptAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.settling.delete(record.admissionId);
    }
  }
  /** Deliver settlement now; the session's next input waits for it. */
  private async settleCommitted(record: ReadableInputRecord): Promise<void> {
    const platform = await this.platform().catch(() => null);
    if (platform?.machineId !== record.machineId) return;
    await this.settleSafely(record, platform.sessions);
    await this.advance(record.agentSessionId);
  }
  private async projectSafely(
    record: ReadableInputRecord,
    api: ProjectsApi,
    timings?: PassTimings,
  ): Promise<void> {
    const key = record.admissionId;
    if (this.projecting.has(key)) return;
    this.projecting.add(key);
    let attempted = record;
    try {
      const reserved = await this.owner.reserveProjection(record.agentSessionId, record.key);
      if (!reserved) return;
      attempted = reserved;
      this.logger.debug('input_admission.projection_attempt', {
        admissionId: reserved.admissionId,
        revision: reserved.revision,
        attempt: reserved.projectionRetry?.attempts,
        maxAttempts: MAX_PROJECTION_ATTEMPTS,
      });
      await this.project(reserved, api);
      timings?.did('reported');
    } catch (error) {
      const exhausted =
        attempted.state !== 'started' &&
        attempted.projectionRetry?.attempts === MAX_PROJECTION_ATTEMPTS;
      this.logger.warn(
        exhausted ? 'input_admission.projection_exhausted' : 'input_admission.projection_deferred',
        {
          ...projectionDiagnostics(
            attempted,
            this.apiBaseUrl,
            error instanceof Error ? error : String(error),
          ),
          attempt: attempted.projectionRetry?.attempts,
          maxAttempts: MAX_PROJECTION_ATTEMPTS,
          nextAttemptAt: exhausted ? null : attempted.projectionRetry?.nextAttemptAt,
        },
      );
    } finally {
      this.projecting.delete(key);
    }
  }
  /** Publish the committed transition immediately; the retry timer retries failures. */
  private async projectCommitted(record: ReadableInputRecord): Promise<void> {
    if (!record.messageId) return;
    try {
      const platform = await this.platform();
      if (platform?.machineId !== record.machineId) {
        this.logger.warn('input_admission.projection_unavailable', {
          operationId: record.key,
          messageId: record.messageId,
          agentSessionId: record.agentSessionId,
          admissionId: record.admissionId,
          revision: record.revision,
          state: record.state,
          reason: platform ? 'machine_changed' : 'platform_unavailable',
        });
        return;
      }
      await this.projectSafely(record, platform.projects);
    } catch (error) {
      this.logger.warn(
        'input_admission.projection_deferred',
        projectionDiagnostics(
          record,
          this.apiBaseUrl,
          error instanceof Error ? error : String(error),
        ),
      );
    }
  }
  /**
   * The Turn may not post output until the platform has accepted its start, so this blocks
   * until it has: transport failures retry without limit (the retry timer may project it first),
   * and only a definitive `accepted: false` throws, failing the Turn's begin.
   */
  private async projectStartedUntilAccepted(started: ReadableInputRecord): Promise<void> {
    if (!started.messageId) return;
    for (;;) {
      const record = await this.owner.record(started.agentSessionId, started.key);
      if (record.projectedRevision >= started.revision) return;
      let wait: number = STARTED_PROJECTION_BACKOFF_MS.initial;
      if (!this.projecting.has(record.admissionId)) {
        this.projecting.add(record.admissionId);
        try {
          const platform = await this.platform();
          if (platform && platform.machineId !== record.machineId) return;
          const reserved = platform
            ? await this.owner.reserveProjection(record.agentSessionId, record.key)
            : null;
          if (reserved) {
            wait = Math.max(0, (reserved.projectionRetry?.nextAttemptAt ?? 0) - Date.now());
            await this.project(reserved, platform!.projects);
          } else if (record.projectionRetry) {
            wait = Math.max(wait, record.projectionRetry.nextAttemptAt - Date.now());
          }
        } catch (error) {
          if (error instanceof ProjectionRejectedError) throw error;
          this.logger.warn('input_admission.started_projection_deferred', {
            ...projectionDiagnostics(
              record,
              this.apiBaseUrl,
              error instanceof Error ? error : String(error),
            ),
            retryInMs: wait,
          });
        } finally {
          this.projecting.delete(record.admissionId);
        }
      }
      await delay(Math.min(wait, STARTED_PROJECTION_BACKOFF_MS.max));
    }
  }
  private async project(record: ReadableInputRecord, api: ProjectsApi): Promise<void> {
    if (
      !record.messageId ||
      record.projectedRevision >= record.revision ||
      record.state === 'picked'
    )
      return;
    const executionStatus = record.state === 'settled' ? 'started' : record.state;
    const inputExecutionProjection = {
      operationId: record.key,
      operationFingerprint: record.fingerprint,
      messageId: record.messageId,
      admissionId: record.admissionId,
      revision: record.revision,
      executionStatus,
      ...(executionStatus === 'started' && record.turnId ? { turnId: record.turnId } : {}),
      ...(record.state === 'failed' ? failureProjection(record.settlement) : {}),
    } satisfies InputExecutionProjection;
    const response = await api.projectInputExecution({
      organizationId: record.organizationId,
      projectId: record.projectId,
      agentSessionId: record.agentSessionId,
      inputExecutionProjection,
    });
    if (!z.object({ data: z.object({ accepted: z.boolean() }) }).parse(response.data).data.accepted)
      throw new ProjectionRejectedError('Input execution projection was not accepted.');
    await this.owner.acknowledge(record.agentSessionId, record.key, record.revision);
    this.logger.info('input_admission.projection_accepted', {
      operationId: record.key,
      messageId: record.messageId,
      agentSessionId: record.agentSessionId,
      runId: record.runId,
      admissionId: record.admissionId,
      revision: record.revision,
      state: record.state,
      executionStatus,
    });
  }
  private async settle(record: ReadableInputRecord, api: AgentSessionsApi): Promise<void> {
    if (record.kind === 'session_message') {
      // Settled history is otherwise opaque; read only what canonical settlement needs.
      const correlation = storedSettlementCorrelationV4Schema.safeParse(record.payload);
      if (!correlation.success) {
        await this.owner.quarantine(
          record.agentSessionId,
          record.key,
          `Settled collaboration input has no readable settlement correlation: ${correlation.error.message}`,
        );
        this.scheduled.delete(record.admissionId);
        return;
      }
      const outcome = settledSchema.parse(record.settlement);
      const input = correlation.data.input;
      const evidence = {
        attemptId: input.attemptId,
        interactionId: input.interactionId,
        generation: correlation.data.generation,
        targetSessionId: record.agentSessionId,
        targetTurnId: outcome.turnId,
        terminalOutcome: outcome.terminalOutcome,
        settledAt: outcome.settledAt,
        completedAssistantMessageId: outcome.completedAssistantMessageId,
        reports: outcome.reports,
      } satisfies AgentInteractionSettledTurn;
      const response = await api.settleAgentInteractionTurn({
        organizationId: record.organizationId,
        projectId: record.projectId,
        interactionId: input.interactionId,
        agentInteractionSettledTurn: evidence,
      });
      const accepted = z.object({ data: z.object({ accepted: z.boolean() }) }).parse(response.data);
      if (!accepted.data.accepted) throw new Error('The platform rejected canonical settlement.');
    }
    await this.owner.acknowledge(record.agentSessionId, record.key, record.projectedRevision, true);
    this.scheduled.delete(record.admissionId);
  }
  /** Delivers from the typed stored record only; no wire schema is consulted for saved input. */
  private async deliver(record: OpenInputRecord, sessions: AgentSessionsApi): Promise<void> {
    if (!record.turnId) throw new Error('Picked input is missing its execution identity.');
    let request: LocalRunPromptRequest;
    let admittedServiceScope: SendMessageOptions['admittedServiceScope'];
    switch (record.kind) {
      case 'run_follow_up': {
        const followUp = record.payload;
        request = {
          promptType: followUp.agentInput.promptType,
          payload:
            followUp.origin === 'review_service_recovery'
              ? {
                  ...(followUp.agentInput.userMessage !== undefined
                    ? { userMessage: followUp.agentInput.userMessage }
                    : {}),
                }
              : followUp.agentInput,
          references: { resolved: [], unresolved: [] },
        };
        break;
      }
      case 'session_message': {
        const collaboration = record.payload;
        const claimed = await sessions.claimAgentSessionTurnHead({
          organizationId: record.organizationId,
          projectId: record.projectId,
          agentSessionId: record.agentSessionId,
          turnAdmissionClaimRequest: {
            turnId: record.turnId,
            admissionId: collaboration.platformAdmissionId,
          },
        });
        const correlation = z
          .object({
            data: z.object({
              claimed: z.boolean(),
              admission: z.object({ id, turnId: id }).optional(),
            }),
          })
          .parse(claimed.data).data;
        if (
          !correlation.claimed ||
          correlation.admission?.id !== collaboration.platformAdmissionId ||
          correlation.admission.turnId !== record.turnId
        )
          throw new Error('Platform execution correlation is not available.');
        request = {
          promptType: LocalPromptType.SessionMessage,
          payload: collaboration.input,
          references: { resolved: [], unresolved: [] },
        };
        break;
      }
      case 'trigger_frame': {
        const { event, conversationId } = record.payload;
        if (event.promptType === 'start_run') {
          admittedServiceScope = event.admittedServiceScope;
          if (!conversationId) throw new Error('Persisted input is missing its conversation.');
          const creation = toCreateRunRequest(event.payload, conversationId);
          const materialized = await this.service.materializeAdmittedRun({
            ...creation,
            triggersAgent: false,
          });
          if (materialized.status === 'repo-required')
            throw new MissingServiceBindingError(
              materialized.serviceIds,
              materialized.launchServiceId,
            );
          await this.attachmentStore.bindStaged(record.runId, creation.attachments);
          this.logger.debug('input_admission.start_run.attachments_bound', {
            runId: record.runId,
            attachments: creation.attachments,
          });
          await this.service.adoptStagedBrowserTab(
            record.runId,
            creation.context.projectId,
            creation.stagedBrowserTab,
          );
          this.operationTimeline?.mark(record.key, 'runReady');
          if (
            !creation.payload ||
            !Object.values(LocalPromptType).some((value) => value === creation.payload?.promptType)
          )
            throw new Error('Executable input has no concrete prompt.');
          request = {
            promptType: creation.payload.promptType as LocalPromptType,
            payload: creation.payload,
            attachments: creation.attachments,
            references: creation.references ?? { resolved: [], unresolved: [] },
            ...(creation.skillSelection ? { skillSelection: creation.skillSelection } : {}),
          };
          break;
        }
        if (event.promptType === 'user_message') admittedServiceScope = event.admittedServiceScope;
        request = toRunPromptRequest(event);
        if (event.promptType === 'user_message' && event.payload.attachments.length > 0) {
          await this.attachmentStore.resolvePaths(record.runId, event.payload.attachments);
          this.logger.debug('input_admission.attachments_resolved', {
            runId: record.runId,
            attachments: event.payload.attachments.map(({ attachmentId, fileName }) => ({
              attachmentId,
              fileName,
            })),
          });
        }
        break;
      }
    }
    const options: SendMessageOptions = {
      ...(admittedServiceScope ? { admittedServiceScope } : {}),
      ...(record.messageId ? { sourceUserMessageId: record.messageId } : {}),
      admittedInput: {
        turnId: record.turnId,
        onStarted: async () => {
          const started = await this.owner.transition(record.agentSessionId, record.key, 'started');
          await this.projectStartedUntilAccepted(started);
        },
        onRejected: async () => {
          const failed = await this.owner.transition(record.agentSessionId, record.key, 'failed');
          this.operationTimeline?.emit(record.key, 'rejected', {
            admissionId: failed.admissionId,
            agentSessionId: failed.agentSessionId,
            runId: failed.runId,
            ...(failed.turnId ? { turnId: failed.turnId } : {}),
          });
          void this.projectCommitted(failed);
          this.scheduled.delete(record.admissionId);
          void this.advance(record.agentSessionId);
        },
        onSettled: async (outcome) => {
          const settled = await this.owner.transition(
            record.agentSessionId,
            record.key,
            'settled',
            durable
              .json()
              .parse({ ...outcome, settledAt: outcome.settledAt ?? new Date().toISOString() }),
          );
          DeterministicE2EEvidence.current()?.record('input_settled', {
            operationId: record.key,
            runId: record.runId,
            turnId: record.turnId,
          });
          void this.settleCommitted(settled);
        },
      },
    };
    await this.service.sendSystemMessage(record.runId, request, options);
  }
}
