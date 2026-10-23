import { describe, expect, it, vi } from 'vitest';

import type { ServerLogger } from '../server/logger';
import {
  CodexShellChangeObserver,
  type CodexShellObservationIdentity,
} from './codex-shell-change-observer';

const makeLogger = () => {
  const trace = vi.fn<ServerLogger['trace']>();
  const debug = vi.fn<ServerLogger['debug']>();
  const info = vi.fn<ServerLogger['info']>();
  const warn = vi.fn<ServerLogger['warn']>();
  const error = vi.fn<ServerLogger['error']>();
  const logger: ServerLogger = { trace, debug, info, warn, error, child: () => logger };
  return { logger, debug, info, warn };
};

const identity = (commandItemId: string): CodexShellObservationIdentity => ({
  providerSessionId: 'session-1',
  providerThreadId: 'thread-1',
  providerTurnId: 'provider-turn-1',
  commandItemId,
});

describe('CodexShellChangeObserver', () => {
  it('keeps duplicate repo-relative paths service-qualified when reporting matched and missing paths', async () => {
    const { logger, info } = makeLogger();
    const snapshots = new Map([
      ['root-a', [[], ['src/shared.ts']]],
      ['root-b', [[], ['src/shared.ts']]],
    ]);
    const listChangedPaths = vi.fn((root: string) =>
      Promise.resolve(snapshots.get(root)?.shift() ?? []),
    );
    const observer = new CodexShellChangeObserver(logger, listChangedPaths);

    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-1'),
      roots: [
        { serviceId: 'service-a', root: 'root-a' },
        { serviceId: 'service-b', root: 'root-b' },
      ],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-1'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [{ serviceId: 'service-a', repoRelativePath: 'src/shared.ts' }],
    });

    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({
        result: 'gap',
        ambiguous: false,
        newlyDirtyCount: 2,
        newlyDirty: [
          { serviceId: 'service-a', repoRelativePath: 'src/shared.ts' },
          { serviceId: 'service-b', repoRelativePath: 'src/shared.ts' },
        ],
        alreadyCanonicalCount: 1,
        alreadyCanonical: [{ serviceId: 'service-a', repoRelativePath: 'src/shared.ts' }],
        missingCanonicalCount: 1,
        missingCanonical: [{ serviceId: 'service-b', repoRelativePath: 'src/shared.ts' }],
      }),
    );
  });

  it('logs a failed command with no newly dirty paths as a zero-gap comparison', async () => {
    const { logger, info } = makeLogger();
    const observer = new CodexShellChangeObserver(logger, vi.fn().mockResolvedValue([]));

    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('failed-command'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('failed-command'),
      outcome: { status: 'failed', exitCode: 1, failed: true },
      canonical: [],
    });

    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({
        result: 'zero_gap',
        commandOutcome: { status: 'failed', exitCode: 1, failed: true },
        newlyDirtyCount: 0,
        newlyDirty: [],
      }),
    );
  });

  it('bounds dirty-path diagnostics while retaining total counts', async () => {
    const { logger, debug, info } = makeLogger();
    const dirtyPaths = Array.from(
      { length: 100 },
      (_, index) => `src/.jest-cache/generated-${String(index).padStart(3, '0')}.map`,
    );
    const listChangedPaths = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(dirtyPaths);
    const observer = new CodexShellChangeObserver(logger, listChangedPaths);

    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('cache-producing-command'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('cache-producing-command'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });

    expect(debug).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.service_snapshot_captured',
      expect.objectContaining({ pathCount: 100, pathsTruncated: true }),
    );
    const snapshotLog = debug.mock.calls.find(
      ([event, fields]) =>
        event === 'local.run.codex_shell_observer.service_snapshot_captured' &&
        fields?.['pathCount'] === 100,
    );
    expect(snapshotLog?.[1]?.['paths']).toHaveLength(20);

    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({
        result: 'gap',
        afterPathCount: 100,
        afterPathsTruncated: true,
        newlyDirtyCount: 100,
        newlyDirtyTruncated: true,
        missingCanonicalCount: 100,
        missingCanonicalTruncated: true,
      }),
    );
    const comparisonLog = info.mock.calls.find(
      ([event]) => event === 'local.run.codex_shell_observer.comparison_completed',
    );
    expect(comparisonLog?.[1]?.['afterPaths']).toHaveLength(20);
    expect(comparisonLog?.[1]?.['newlyDirty']).toHaveLength(20);
    expect(comparisonLog?.[1]?.['missingCanonical']).toHaveLength(20);
  });

  it('marks overlapping command windows ambiguous and never attributes their paths', async () => {
    const { logger, info } = makeLogger();
    const listChangedPaths = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['src/overlap.ts'])
      .mockResolvedValueOnce(['src/overlap.ts']);
    const observer = new CodexShellChangeObserver(logger, listChangedPaths);

    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-a'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-b'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-a'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-b'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });

    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({ commandItemId: 'command-a', ambiguous: true, result: 'ambiguous' }),
    );
    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({ commandItemId: 'command-b', ambiguous: true, result: 'ambiguous' }),
    );
  });

  it('logs snapshot failures and continues with diagnostic-only inputs', async () => {
    const { logger, info, warn } = makeLogger();
    const listChangedPaths = vi
      .fn()
      .mockRejectedValueOnce(new Error('not a git repository'))
      .mockResolvedValueOnce(['src/after-failure.ts']);
    const observer = new CodexShellChangeObserver(logger, listChangedPaths);

    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-1'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('command-1'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });

    expect(warn).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.service_snapshot_failed',
      expect.objectContaining({ phase: 'before', error: 'not a git repository' }),
    );
    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.comparison_completed',
      expect.objectContaining({ result: 'snapshot_failure' }),
    );
  });

  it('distinguishes a missing start from an identity mismatch and clears unfinished work', async () => {
    const { logger, info, warn } = makeLogger();
    const observer = new CodexShellChangeObserver(logger, vi.fn().mockResolvedValue([]));

    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('missing-command'),
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });
    await observer.commandStarted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: identity('mismatched-command'),
      roots: [{ serviceId: 'service-a', root: 'root-a' }],
    });
    await observer.commandCompleted({
      runId: 'run-1',
      turnId: 'turn-1',
      identity: {
        ...identity('mismatched-command'),
        providerThreadId: 'different-thread',
      },
      outcome: { status: 'completed', exitCode: 0, failed: false },
      canonical: [],
    });
    await observer.clearTurn('run-1', 'turn-1');

    expect(warn).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.completion_uncorrelated',
      expect.objectContaining({ commandItemId: 'missing-command', reason: 'missing_start' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.completion_uncorrelated',
      expect.objectContaining({ commandItemId: 'mismatched-command', reason: 'identity_mismatch' }),
    );
    expect(info).toHaveBeenCalledWith(
      'local.run.codex_shell_observer.turn_cleared',
      expect.objectContaining({
        unfinishedCount: 1,
        unfinishedCommandItemIds: ['mismatched-command'],
      }),
    );
  });
});
