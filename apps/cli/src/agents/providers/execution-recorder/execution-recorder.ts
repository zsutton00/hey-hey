import { CaptureDeadline } from './capture-deadline';
import { randomUUID } from 'node:crypto';
import type { ServerLogger } from '../../../server/logger';
import { ObservationStore } from './observation-store';
import { ContentSnapshot } from './content-snapshot';
import type {
  CaptureGap,
  CaptureIdentity,
  CaptureRoot,
  ContentSnapshotData,
  ExecutionObservation,
  SnapshotEntry,
} from './observation';

const identityKey = (identity: CaptureIdentity): string =>
  JSON.stringify([
    identity.sessionId,
    identity.runId,
    identity.turnId,
    identity.provider,
    identity.providerSessionId,
    identity.providerTurnId,
    identity.toolCallId,
    identity.toolName,
  ]);

/** One file a tool changed, with the content hashes seen immediately before and after it ran. */
export interface CapturedFileChange {
  serviceId: string;
  path: string;
  startedAt: number;
  /** Null when absent; undefined when no reliable baseline was available. */
  beforeHash: string | null | undefined;
  afterHash: string | null;
}

const entryKey = (serviceId: string, repoRelativePath: string): string =>
  `${serviceId}\0${repoRelativePath}`;

/**
 * Paths whose content both snapshots read cleanly and that differ between them.
 * A path missing from a whole-root snapshot did not exist; a path with a read
 * gap in either snapshot is unknown and never reported.
 */
const changedBetween = (
  observation: ExecutionObservation,
  before: ContentSnapshotData,
  after: ContentSnapshotData,
): CapturedFileChange[] => {
  const scoped = new Set(observation.roots.filter((root) => root.paths).map((r) => r.serviceId));
  const index = (snapshot: ContentSnapshotData): Map<string, SnapshotEntry> =>
    new Map(snapshot.entries.map((entry) => [entryKey(entry.serviceId, entry.path), entry]));
  const beforeEntries = index(before);
  const afterEntries = index(after);
  const failedRoots = new Set([...before.rootFailures, ...after.rootFailures]);
  const changes: CapturedFileChange[] = [];
  for (const key of new Set([...beforeEntries.keys(), ...afterEntries.keys()])) {
    const earlier = beforeEntries.get(key);
    const later = afterEntries.get(key);
    const serviceId = (earlier ?? later)!.serviceId;
    const repoRelativePath = (earlier ?? later)!.path;
    if (failedRoots.has(serviceId) || earlier?.gap || later?.gap) continue;
    // A scoped snapshot names every path it read, so a missing entry is not "absent".
    if (scoped.has(serviceId) && (!earlier || !later)) continue;
    const beforeHash = earlier
      ? earlier.hash
      : observation.identity.toolName === 'Bash'
        ? undefined
        : null;
    const afterHash = later?.hash ?? null;
    if (beforeHash === afterHash) continue;
    changes.push({
      serviceId,
      path: repoRelativePath,
      startedAt: observation.startedAt,
      beforeHash,
      afterHash,
    });
  }
  return changes;
};

/** Owns execution evidence only. It has no canonical file-change writer or membership dependency. */
export class ExecutionRecorder {
  public readonly store: ObservationStore;
  private readonly snapshot: ContentSnapshot;
  private readonly pending = new Map<string, ExecutionObservation>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly finished = new Map<string, ExecutionObservation>();
  /** Files each finished tool changed, per `runId:turnId`, until the Turn's report has read them. */
  private readonly capturedChanges = new Map<string, CapturedFileChange[]>();

  public constructor(
    directory: string,
    private readonly logger: ServerLogger,
  ) {
    this.store = new ObservationStore(directory, logger);
    this.snapshot = new ContentSnapshot(this.store, logger);
  }

  private serialize(
    key: string,
    operation: (capture: CaptureDeadline) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    const next = (this.mutations.get(key) ?? Promise.resolve()).then(async () => {
      const capture = new CaptureDeadline(signal);
      try {
        await operation(capture);
      } catch (error) {
        if (capture.signal.aborted) {
          const observation = this.pending.get(key) ?? this.finished.get(key);
          this.logger.warn('execution_capture.operation_abandoned', {
            ...observation?.identity,
            observationId: observation?.id,
            cause: error instanceof Error ? error.message : String(error),
          });
          if (observation) {
            const abandoned: ExecutionObservation = {
              ...observation,
              after: null,
              state: 'incomplete',
              outcome: 'interrupted',
              gaps: [
                ...new Set<CaptureGap>([...observation.gaps, 'interrupted', 'snapshot_failure']),
              ],
            };
            this.pending.delete(key);
            this.finished.set(key, abandoned);
            // Best-effort evidence must not put abandoned I/O back on the serialization queue.
            const cleanup = new CaptureDeadline();
            void cleanup
              .wait(this.store.save(abandoned, cleanup.signal))
              .catch((cause: unknown) => {
                this.logger.warn('execution_capture.abandon_persist_failed', {
                  ...abandoned.identity,
                  observationId: abandoned.id,
                  cause,
                });
              })
              .finally(() => cleanup.close());
          }
          return;
        }
        throw error;
      } finally {
        capture.close();
      }
    });
    const tracked = next.catch(() => undefined);
    this.mutations.set(key, tracked);
    void tracked.finally(() => {
      if (this.mutations.get(key) === tracked) {
        this.mutations.delete(key);
      }
    });
    return next;
  }

  public begin(
    identity: CaptureIdentity,
    roots: readonly CaptureRoot[],
    harnessVersion: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const queuedAt = Date.now();
    return this.serialize(
      identityKey(identity),
      async (capture) => {
        if (this.pending.has(identityKey(identity))) return;
        const observation: ExecutionObservation = {
          id: randomUUID(),
          identity,
          roots: [...roots],
          harnessVersion,
          ownerPid: process.pid,
          startedAt: Date.now(),
          endedAt: null,
          state: 'pending',
          before: null,
          after: null,
          outcome: null,
          gaps: [],
        };
        this.pending.set(identityKey(identity), observation);
        try {
          const persistStartedAt = Date.now();
          await capture.wait(this.store.save(observation, capture.signal));
          await capture.wait(this.store.recordOverlaps(observation, capture.signal));
          this.logger.debug('execution_capture.baseline_started', {
            ...identity,
            observationId: observation.id,
            persistMs: Date.now() - persistStartedAt,
          });
          const snapshotStartedAt = Date.now();
          observation.before = await capture.wait(
            this.snapshot.capture(roots, identity, 'baseline', null, capture.signal),
          );
          this.logger.debug('execution_capture.baseline_snapshot_completed', {
            ...identity,
            observationId: observation.id,
            elapsedMs: Date.now() - snapshotStartedAt,
            entryCount: observation.before.entries.length,
            rootFailureCount: observation.before.rootFailures.length,
          });
          if (
            observation.before.rootFailures.length ||
            observation.before.entries.some((entry) => entry.gap !== null)
          )
            observation.gaps.push('snapshot_failure');
          await capture.wait(this.store.save(observation, capture.signal));
          this.logger.debug('execution_capture.baseline_saved', {
            ...identity,
            observationId: observation.id,
            entryCount: observation.before.entries.length,
            gaps: observation.gaps,
          });
        } catch (error) {
          observation.gaps.push('missing_baseline', 'snapshot_failure');
          this.logger.warn('execution_capture.baseline_failed', {
            ...identity,
            observationId: observation.id,
            elapsedMs: Date.now() - queuedAt,
            error,
          });
          throw error;
        }
      },
      signal,
    );
  }

  public finish(
    identity: CaptureIdentity,
    roots: readonly CaptureRoot[],
    harnessVersion: string,
    outcome: NonNullable<ExecutionObservation['outcome']>,
    writerStopped: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.serialize(
      identityKey(identity),
      async (capture) => {
        const key = identityKey(identity);
        const recovered = this.pending.has(key)
          ? null
          : (this.finished.get(key) ??
            (await capture.wait(this.store.list())).find(
              (entry) => identityKey(entry.identity) === key,
            ));
        if (recovered?.after && recovered.outcome !== null && recovered.outcome !== 'interrupted')
          return;
        const observation: ExecutionObservation = this.pending.get(key) ??
          recovered ?? {
            id: randomUUID(),
            identity,
            roots: [...roots],
            harnessVersion,
            ownerPid: process.pid,
            startedAt: Date.now(),
            endedAt: null,
            state: 'incomplete' as const,
            before: null,
            after: null,
            outcome: null,
            gaps: ['missing_baseline' as const],
          };
        if (recovered) observation.gaps.push('interrupted');
        this.pending.set(key, observation);
        const snapshotStartedAt = Date.now();
        this.logger.debug('execution_capture.final_snapshot_started', {
          ...identity,
          observationId: observation.id,
          rootCount: observation.roots.length,
        });
        const before = observation.before ? structuredClone(observation.before) : null;
        observation.after = await capture.wait(
          this.snapshot.capture(
            observation.roots,
            observation.identity,
            'final',
            before,
            capture.signal,
          ),
        );
        observation.before = before;
        this.logger.debug('execution_capture.final_snapshot_completed', {
          ...identity,
          observationId: observation.id,
          elapsedMs: Date.now() - snapshotStartedAt,
          entryCount: observation.after.entries.length,
          rootFailureCount: observation.after.rootFailures.length,
        });
        observation.outcome = outcome;
        observation.endedAt = writerStopped ? Date.now() : null;
        if (!observation.before) observation.gaps.push('missing_baseline');
        if (!writerStopped) observation.gaps.push('writer_lifetime_unresolved');
        if (outcome === 'denied') observation.gaps.push('denied');
        if (outcome === 'interrupted') observation.gaps.push('interrupted');
        if (outcome === 'unknown') observation.gaps.push('outcome_unresolved');
        if (
          observation.after.rootFailures.length ||
          observation.after.entries.some((entry) => entry.gap !== null)
        )
          observation.gaps.push('snapshot_failure');
        observation.gaps = [...new Set(observation.gaps)];
        observation.state = observation.gaps.length ? 'incomplete' : 'completed';
        await capture.wait(this.store.save(observation, capture.signal));
        await capture.wait(this.store.recordOverlaps(observation, capture.signal));
        this.pending.delete(key);
        this.finished.set(key, observation);
        if (!signal?.aborted) {
          this.rememberChanges(observation);
        }
        this.logger.debug('execution_capture.finalized', {
          ...identity,
          observationId: observation.id,
          state: observation.state,
          gaps: observation.gaps,
        });
      },
      signal,
    );
  }

  private rememberChanges(observation: ExecutionObservation): void {
    if (observation.outcome !== 'success' || !observation.before || !observation.after) return;
    const changes = changedBetween(observation, observation.before, observation.after);
    if (changes.length === 0) return;
    const turnKey = `${observation.identity.runId}:${observation.identity.turnId}`;
    this.capturedChanges.set(turnKey, [...(this.capturedChanges.get(turnKey) ?? []), ...changes]);
  }

  /** What tools in this Turn changed in one file, in the order they started. */
  public capturedFileChanges(
    runId: string,
    turnId: string,
    serviceId: string,
    repoRelativePath: string,
  ): CapturedFileChange[] {
    return (this.capturedChanges.get(`${runId}:${turnId}`) ?? [])
      .filter((change) => change.serviceId === serviceId && change.path === repoRelativePath)
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  public readCapturedContent(hash: string): Promise<Buffer> {
    return this.store.readBlob(hash);
  }

  /** Release only after report persistence succeeds, retaining evidence for failed reports. */
  public async releaseTurn(runId: string, turnId: string): Promise<void> {
    for (const observation of this.finished.values()) {
      if (observation.identity.runId !== runId || observation.identity.turnId !== turnId) {
        continue;
      }
      const cleanup = new CaptureDeadline();
      try {
        await cleanup.wait(this.store.remove(observation.id, observation.ownerPid));
        this.finished.delete(identityKey(observation.identity));
      } catch (error) {
        this.logger.warn('execution_capture.prune_failed', {
          runId,
          turnId,
          observationId: observation.id,
          error,
        });
      } finally {
        cleanup.close();
      }
    }
    this.capturedChanges.delete(`${runId}:${turnId}`);
  }

  /** Drops a finished Run's captured changes; its reports have been written. */
  public releaseRun(runId: string): void {
    for (const [key, observation] of this.finished) {
      if (observation.identity.runId === runId) {
        this.finished.delete(key);
      }
    }
    for (const key of [...this.capturedChanges.keys()]) {
      if (key.startsWith(`${runId}:`)) {
        this.capturedChanges.delete(key);
      }
    }
  }

  public async interrupt(runId: string, turnId: string): Promise<void> {
    const startedAt = Date.now();
    this.logger.debug('execution_capture.interrupt_started', {
      runId,
      turnId,
      pendingCount: this.pending.size,
      mutationCount: this.mutations.size,
    });
    await Promise.all(
      [...this.pending.entries()]
        .filter(
          ([, observation]) =>
            observation.identity.runId === runId && observation.identity.turnId === turnId,
        )
        .map(([key, pendingObservation]) => {
          const queuedAt = Date.now();
          const diagnostic = {
            runId,
            turnId,
            observationId: pendingObservation?.id,
            observationRunId: pendingObservation?.identity.runId,
            observationTurnId: pendingObservation?.identity.turnId,
            toolCallId: pendingObservation?.identity.toolCallId,
            toolName: pendingObservation?.identity.toolName,
            matchesRequestedTurn:
              pendingObservation?.identity.runId === runId &&
              pendingObservation?.identity.turnId === turnId,
            hasQueuedMutation: this.mutations.has(key),
          };
          this.logger.debug('execution_capture.interrupt_observation_queued', diagnostic);
          return this.serialize(key, async (capture) => {
            this.logger.debug('execution_capture.interrupt_observation_entered', {
              ...diagnostic,
              queueWaitMs: Date.now() - queuedAt,
            });
            const observation = this.pending.get(key);
            if (!observation) {
              this.logger.debug('execution_capture.interrupt_observation_skipped', {
                ...diagnostic,
                reason: 'no-longer-pending',
              });
              return;
            }
            if (observation.identity.runId !== runId || observation.identity.turnId !== turnId) {
              this.logger.debug('execution_capture.interrupt_observation_skipped', {
                ...diagnostic,
                reason: 'different-turn',
              });
              return;
            }
            observation.state = 'incomplete';
            observation.outcome = 'interrupted';
            const snapshotStartedAt = Date.now();
            this.logger.debug('execution_capture.interrupt_snapshot_started', diagnostic);
            observation.after = await capture.wait(
              this.snapshot.capture(
                observation.roots,
                observation.identity,
                'interrupt',
                observation.before,
                capture.signal,
              ),
            );
            this.logger.debug('execution_capture.interrupt_snapshot_completed', {
              ...diagnostic,
              elapsedMs: Date.now() - snapshotStartedAt,
              entryCount: observation.after.entries.length,
              rootFailureCount: observation.after.rootFailures.length,
            });
            observation.gaps = [
              ...new Set<CaptureGap>([
                ...observation.gaps,
                'interrupted',
                'writer_lifetime_unresolved',
              ]),
            ];
            // This is an interruption-time observation, not proof that writers stopped.
            await capture.wait(this.store.save(observation, capture.signal));
            this.pending.delete(key);
            this.finished.set(key, observation);
            this.logger.debug('execution_capture.interrupted', {
              ...observation.identity,
              observationId: observation.id,
            });
          });
        }),
    );
    this.logger.debug('execution_capture.interrupt_completed', {
      runId,
      turnId,
      elapsedMs: Date.now() - startedAt,
      pendingCount: this.pending.size,
    });
  }

  /** Native outcomes without a hook are coverage evidence, never a reason to scan at teardown. */
  public recordUnobserved(
    identity: CaptureIdentity,
    roots: readonly CaptureRoot[],
    harnessVersion: string,
    outcome: 'failure' | 'denied',
  ): Promise<void> {
    return this.serialize(identityKey(identity), async (capture) => {
      const startedAt = Date.now();
      this.logger.debug('execution_capture.unobserved_lookup_started', { ...identity });
      const existing = await capture.wait(this.store.list());
      this.logger.debug('execution_capture.unobserved_lookup_completed', {
        ...identity,
        elapsedMs: Date.now() - startedAt,
        observationCount: existing.length,
      });
      if (existing.some((entry) => identityKey(entry.identity) === identityKey(identity))) return;
      const observation: ExecutionObservation = {
        id: randomUUID(),
        identity,
        roots: [...roots],
        harnessVersion,
        ownerPid: process.pid,
        startedAt: Date.now(),
        endedAt: null,
        state: 'incomplete',
        before: null,
        after: null,
        outcome,
        gaps: [
          'hook_not_observed',
          'missing_baseline',
          ...(outcome === 'denied' ? ['denied' as const] : []),
          ...(identity.toolName === 'Bash' ? ['writer_lifetime_unresolved' as const] : []),
        ],
      };
      await capture.wait(this.store.save(observation, capture.signal));
      this.finished.set(identityKey(identity), observation);
      this.logger.info('execution_capture.unobserved_outcome_saved', {
        ...identity,
        observationId: observation.id,
        outcome,
      });
    });
  }

  public confirmOutcome(
    identity: CaptureIdentity,
    outcome: 'success' | 'failure' | 'denied',
  ): Promise<void> {
    return this.serialize(identityKey(identity), async (capture) => {
      const key = identityKey(identity);
      const observation =
        this.pending.get(key) ??
        this.finished.get(key) ??
        (await capture.wait(this.store.list())).find(
          (entry) => identityKey(entry.identity) === key,
        );
      if (!observation) return;
      observation.outcome = outcome;
      observation.gaps = observation.gaps.filter((gap) => gap !== 'outcome_unresolved');
      if (outcome === 'denied' && !observation.gaps.includes('denied'))
        observation.gaps.push('denied');
      // Authoritative outcome cannot repair incomplete content coverage.
      if (observation.gaps.length) observation.state = 'incomplete';
      await capture.wait(this.store.save(observation, capture.signal));
      this.logger.debug('execution_capture.outcome_confirmed', {
        ...identity,
        outcome,
        observationId: observation.id,
      });
    });
  }
}
