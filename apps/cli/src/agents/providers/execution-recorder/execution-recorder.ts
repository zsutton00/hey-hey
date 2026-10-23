import { randomUUID } from 'node:crypto';
import type { ServerLogger } from '../../../server/logger';
import { ObservationStore } from './observation-store';
import { ContentSnapshot } from './content-snapshot';
import type { CaptureGap, CaptureIdentity, CaptureRoot, ExecutionObservation } from './observation';

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

/** Owns execution evidence only. It has no canonical file-change writer or membership dependency. */
export class ExecutionRecorder {
  public readonly store: ObservationStore;
  private readonly snapshot: ContentSnapshot;
  private readonly pending = new Map<string, ExecutionObservation>();
  private readonly mutations = new Map<string, Promise<void>>();

  public constructor(
    directory: string,
    private readonly logger: ServerLogger,
  ) {
    this.store = new ObservationStore(directory, logger);
    this.snapshot = new ContentSnapshot(this.store, logger);
  }

  private serialize(key: string, operation: () => Promise<void>): Promise<void> {
    const next = (this.mutations.get(key) ?? Promise.resolve()).then(operation);
    const tracked = next.catch(() => undefined);
    this.mutations.set(key, tracked);
    void tracked.finally(() => {
      if (this.mutations.get(key) === tracked) this.mutations.delete(key);
    });
    return next;
  }

  public begin(
    identity: CaptureIdentity,
    roots: readonly CaptureRoot[],
    harnessVersion: string,
  ): Promise<void> {
    return this.serialize(identityKey(identity), async () => {
      if (this.pending.has(identityKey(identity))) return;
      // Compatibility is checked before creating anything that could obscure older evidence.
      await this.store.list();
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
        await this.store.save(observation);
        await this.store.recordOverlaps(observation);
        this.logger.debug('execution_capture.baseline_started', {
          ...identity,
          observationId: observation.id,
        });
        const snapshotStartedAt = Date.now();
        observation.before = await this.snapshot.capture(roots, identity, 'baseline');
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
        await this.store.save(observation);
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
        });
        throw error;
      }
    });
  }

  public finish(
    identity: CaptureIdentity,
    roots: readonly CaptureRoot[],
    harnessVersion: string,
    outcome: NonNullable<ExecutionObservation['outcome']>,
    writerStopped: boolean,
  ): Promise<void> {
    return this.serialize(identityKey(identity), async () => {
      const key = identityKey(identity);
      const recovered = this.pending.has(key)
        ? null
        : (await this.store.list()).find((entry) => identityKey(entry.identity) === key);
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
      const snapshotStartedAt = Date.now();
      this.logger.debug('execution_capture.final_snapshot_started', {
        ...identity,
        observationId: observation.id,
        rootCount: observation.roots.length,
      });
      observation.after = await this.snapshot.capture(
        observation.roots,
        observation.identity,
        'final',
      );
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
      await this.store.save(observation);
      await this.store.recordOverlaps(observation);
      this.pending.delete(key);
      this.logger.debug('execution_capture.finalized', {
        ...identity,
        observationId: observation.id,
        state: observation.state,
        gaps: observation.gaps,
      });
    });
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
          return this.serialize(key, async () => {
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
            observation.after = await this.snapshot.capture(
              observation.roots,
              observation.identity,
              'interrupt',
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
            await this.store.save(observation);
            this.pending.delete(key);
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
    return this.serialize(identityKey(identity), async () => {
      const startedAt = Date.now();
      this.logger.debug('execution_capture.unobserved_lookup_started', { ...identity });
      const existing = await this.store.list();
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
      await this.store.save(observation);
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
    return this.serialize(identityKey(identity), async () => {
      const observation = (await this.store.list()).find(
        (entry) => identityKey(entry.identity) === identityKey(identity),
      );
      if (!observation) return;
      observation.outcome = outcome;
      observation.gaps = observation.gaps.filter((gap) => gap !== 'outcome_unresolved');
      if (outcome === 'denied' && !observation.gaps.includes('denied'))
        observation.gaps.push('denied');
      // Authoritative outcome cannot repair incomplete content coverage.
      if (observation.gaps.length) observation.state = 'incomplete';
      await this.store.save(observation);
      this.logger.debug('execution_capture.outcome_confirmed', {
        ...identity,
        outcome,
        observationId: observation.id,
      });
    });
  }
}
