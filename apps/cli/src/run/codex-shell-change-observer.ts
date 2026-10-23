import { listGitChangedFilePathsExcludingIgnored } from '../git';
import type { ServerLogger } from '../server/logger';
import { canonicalFileChangeKey, type FileChangeProjection } from './file-change-facts';

export interface CodexShellObservationIdentity {
  providerSessionId: string;
  providerThreadId: string;
  providerTurnId: string;
  commandItemId: string;
}

export interface CodexShellServiceRoot {
  serviceId: string;
  root: string;
}

export interface CodexShellCommandOutcome {
  status: string | null;
  exitCode: number | null;
  failed: boolean;
}

interface ServiceQualifiedPath {
  serviceId: string;
  repoRelativePath: string;
}

interface SnapshotFailure {
  serviceId: string;
  root: string;
  phase: 'before' | 'after';
  error: string;
}

interface SnapshotInventory {
  paths: ServiceQualifiedPath[];
  failures: SnapshotFailure[];
}

interface PendingObservation {
  runId: string;
  turnId: string;
  identity: CodexShellObservationIdentity;
  roots: readonly CodexShellServiceRoot[];
  before: SnapshotInventory;
  ambiguous: boolean;
}

type ListChangedPaths = (root: string) => Promise<string[]>;

const LOGGED_PATH_LIMIT = 20;

const identityKey = (identity: CodexShellObservationIdentity): string =>
  [
    identity.providerSessionId,
    identity.providerThreadId,
    identity.providerTurnId,
    identity.commandItemId,
  ].join('\u0000');

const providerWindowKey = (identity: CodexShellObservationIdentity): string =>
  [identity.providerSessionId, identity.providerThreadId, identity.providerTurnId].join('\u0000');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Diagnostic-only comparison of Codex shell windows with canonical Run membership.
 * Snapshot paths never leave this owner and cannot become file-change facts.
 */
export class CodexShellChangeObserver {
  private readonly pending = new Map<string, PendingObservation>();
  private mutation: Promise<void> | null = null;

  public constructor(
    private readonly logger: ServerLogger,
    private readonly listChangedPaths: ListChangedPaths = listGitChangedFilePathsExcludingIgnored,
  ) {}

  public commandStarted(input: {
    runId: string;
    turnId: string;
    identity: CodexShellObservationIdentity;
    roots: readonly CodexShellServiceRoot[];
  }): Promise<void> {
    return this.serialize(async () => {
      const key = identityKey(input.identity);
      if (this.pending.has(key)) {
        this.logger.warn('local.run.codex_shell_observer.start_replaced', {
          runId: input.runId,
          turnId: input.turnId,
          ...input.identity,
        });
      }

      const overlapping = [...this.pending.values()].filter(
        (entry) => providerWindowKey(entry.identity) === providerWindowKey(input.identity),
      );
      for (const entry of overlapping) entry.ambiguous = true;

      this.logger.debug('local.run.codex_shell_observer.start_capture_started', {
        runId: input.runId,
        turnId: input.turnId,
        ...input.identity,
        serviceRoots: input.roots,
        overlappingCommandItemIds: overlapping.map((entry) => entry.identity.commandItemId),
      });
      const before = await this.captureByService(input.roots, input.identity, 'before');
      this.pending.set(key, {
        runId: input.runId,
        turnId: input.turnId,
        identity: input.identity,
        roots: [...input.roots],
        before,
        ambiguous: overlapping.length > 0,
      });
      this.logger.debug('local.run.codex_shell_observer.start_captured', {
        runId: input.runId,
        turnId: input.turnId,
        ...input.identity,
        beforePathCount: before.paths.length,
        beforePaths: before.paths.slice(0, LOGGED_PATH_LIMIT),
        beforePathsTruncated: before.paths.length > LOGGED_PATH_LIMIT,
        snapshotFailures: before.failures,
        ambiguous: overlapping.length > 0,
      });
    });
  }

  public commandCompleted(input: {
    runId: string;
    turnId: string;
    identity: CodexShellObservationIdentity;
    outcome: CodexShellCommandOutcome;
    canonical: readonly FileChangeProjection[];
  }): Promise<void> {
    return this.serialize(async () => {
      const key = identityKey(input.identity);
      const pending = this.pending.get(key);
      if (!pending) {
        const sameItem = [...this.pending.values()].filter(
          (entry) => entry.identity.commandItemId === input.identity.commandItemId,
        );
        this.logger.warn('local.run.codex_shell_observer.completion_uncorrelated', {
          runId: input.runId,
          turnId: input.turnId,
          ...input.identity,
          commandOutcome: input.outcome,
          mismatchCandidates: sameItem.map((entry) => ({
            runId: entry.runId,
            turnId: entry.turnId,
            ...entry.identity,
          })),
          reason: sameItem.length > 0 ? 'identity_mismatch' : 'missing_start',
        });
        return;
      }
      this.pending.delete(key);

      if (pending.runId !== input.runId || pending.turnId !== input.turnId) {
        this.logger.warn('local.run.codex_shell_observer.completion_turn_mismatch', {
          runId: input.runId,
          turnId: input.turnId,
          expectedRunId: pending.runId,
          expectedTurnId: pending.turnId,
          ...input.identity,
          commandOutcome: input.outcome,
        });
        return;
      }

      this.logger.debug('local.run.codex_shell_observer.completion_capture_started', {
        runId: input.runId,
        turnId: input.turnId,
        ...input.identity,
        commandOutcome: input.outcome,
        ambiguous: pending.ambiguous,
      });
      const after = await this.captureByService(pending.roots, input.identity, 'after');
      const beforeKeys = new Set(
        pending.before.paths.map((entry) =>
          canonicalFileChangeKey(entry.serviceId, entry.repoRelativePath),
        ),
      );
      const newlyDirty = after.paths.filter(
        (entry) => !beforeKeys.has(canonicalFileChangeKey(entry.serviceId, entry.repoRelativePath)),
      );
      const canonicalKeys = new Set(
        input.canonical.map((entry) =>
          canonicalFileChangeKey(entry.serviceId, entry.repoRelativePath),
        ),
      );
      const alreadyCanonical = newlyDirty.filter((entry) =>
        canonicalKeys.has(canonicalFileChangeKey(entry.serviceId, entry.repoRelativePath)),
      );
      const missingCanonical = newlyDirty.filter(
        (entry) =>
          !canonicalKeys.has(canonicalFileChangeKey(entry.serviceId, entry.repoRelativePath)),
      );
      const snapshotFailures = [...pending.before.failures, ...after.failures];

      this.logger.info('local.run.codex_shell_observer.comparison_completed', {
        runId: input.runId,
        turnId: input.turnId,
        ...input.identity,
        commandOutcome: input.outcome,
        beforePathCount: pending.before.paths.length,
        beforePaths: pending.before.paths.slice(0, LOGGED_PATH_LIMIT),
        beforePathsTruncated: pending.before.paths.length > LOGGED_PATH_LIMIT,
        afterPathCount: after.paths.length,
        afterPaths: after.paths.slice(0, LOGGED_PATH_LIMIT),
        afterPathsTruncated: after.paths.length > LOGGED_PATH_LIMIT,
        newlyDirtyCount: newlyDirty.length,
        newlyDirty: newlyDirty.slice(0, LOGGED_PATH_LIMIT),
        newlyDirtyTruncated: newlyDirty.length > LOGGED_PATH_LIMIT,
        alreadyCanonicalCount: alreadyCanonical.length,
        alreadyCanonical: alreadyCanonical.slice(0, LOGGED_PATH_LIMIT),
        alreadyCanonicalTruncated: alreadyCanonical.length > LOGGED_PATH_LIMIT,
        missingCanonicalCount: missingCanonical.length,
        missingCanonical: missingCanonical.slice(0, LOGGED_PATH_LIMIT),
        missingCanonicalTruncated: missingCanonical.length > LOGGED_PATH_LIMIT,
        ambiguous: pending.ambiguous,
        snapshotFailures,
        result:
          snapshotFailures.length > 0
            ? 'snapshot_failure'
            : pending.ambiguous
              ? 'ambiguous'
              : missingCanonical.length > 0
                ? 'gap'
                : newlyDirty.length === 0
                  ? 'zero_gap'
                  : 'matched',
      });
    });
  }

  public clearTurn(runId: string, turnId: string): Promise<void> {
    return this.serialize(() => {
      const unfinished = [...this.pending.entries()].filter(
        ([, entry]) => entry.runId === runId && entry.turnId === turnId,
      );
      for (const [key] of unfinished) this.pending.delete(key);
      this.logger.info('local.run.codex_shell_observer.turn_cleared', {
        runId,
        turnId,
        unfinishedCount: unfinished.length,
        unfinishedCommandItemIds: unfinished.map(([, entry]) => entry.identity.commandItemId),
      });
    });
  }

  public clearRun(runId: string): Promise<void> {
    return this.serialize(() => {
      const unfinished = [...this.pending.entries()].filter(([, entry]) => entry.runId === runId);
      for (const [key] of unfinished) this.pending.delete(key);
      this.logger.info('local.run.codex_shell_observer.run_cleared', {
        runId,
        unfinishedCount: unfinished.length,
        unfinishedCommandItemIds: unfinished.map(([, entry]) => entry.identity.commandItemId),
      });
    });
  }

  private serialize(operation: () => void | Promise<void>): Promise<void> {
    let next: Promise<void>;
    if (this.mutation) {
      next = this.mutation.then(operation, operation);
    } else {
      try {
        next = Promise.resolve(operation());
      } catch (error) {
        next = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    const tracked = next.catch(() => undefined);
    this.mutation = tracked;
    void tracked.finally(() => {
      if (this.mutation === tracked) this.mutation = null;
    });
    return next;
  }

  private async captureByService(
    roots: readonly CodexShellServiceRoot[],
    identity: CodexShellObservationIdentity,
    phase: 'before' | 'after',
  ): Promise<SnapshotInventory> {
    const captures = await Promise.all(
      roots.map(async (service): Promise<SnapshotInventory> => {
        try {
          const changedPaths = await this.listChangedPaths(service.root);
          const paths = [...new Set(changedPaths)].sort().map((repoRelativePath) => ({
            serviceId: service.serviceId,
            repoRelativePath,
          }));
          this.logger.debug('local.run.codex_shell_observer.service_snapshot_captured', {
            ...identity,
            serviceId: service.serviceId,
            root: service.root,
            phase,
            pathCount: paths.length,
            paths: paths.slice(0, LOGGED_PATH_LIMIT),
            pathsTruncated: paths.length > LOGGED_PATH_LIMIT,
          });
          return { paths, failures: [] };
        } catch (error) {
          const failure: SnapshotFailure = {
            serviceId: service.serviceId,
            root: service.root,
            phase,
            error: errorMessage(error),
          };
          this.logger.warn('local.run.codex_shell_observer.service_snapshot_failed', {
            ...identity,
            ...failure,
          });
          return { paths: [], failures: [failure] };
        }
      }),
    );
    return {
      paths: captures.flatMap((capture) => capture.paths),
      failures: captures.flatMap((capture) => capture.failures),
    };
  }
}
