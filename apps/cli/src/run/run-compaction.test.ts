import { describe, expect, it, vi } from 'vitest';

import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
} from '../agents/providers/session-runner';
import { NOOP_LOGGER } from '../server/logger';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { AgenticSession } from '../session/types';
import { RunCompaction, type RunCompactionDeps } from './run-compaction';

const session = { agentic_session_id: 'session-1' } as unknown as AgenticSession;

const makeHarness = (
  overrides: Partial<RunCompactionDeps> = {},
  runnerOverrides: Partial<AgentSessionRunner> = {},
) => {
  const calls: string[] = [];
  const compact = vi.fn(() => {
    calls.push('compact');
    return Promise.resolve();
  });
  const getContextUsage = vi.fn(() => {
    calls.push('getContextUsage');
    return Promise.resolve({ totalTokens: 1_000, maxTokens: 200_000 } as never);
  });
  const runner = { compact, getContextUsage, ...runnerOverrides } as unknown as AgentSessionRunner;
  const emit = vi.fn(() => {
    calls.push('emit');
  });
  const postAgentSystemMessage = vi.fn<RunCompactionDeps['postAgentSystemMessage']>(() =>
    Promise.resolve(),
  );
  const state = { processing: false };
  const deps: RunCompactionDeps = {
    runId: 'run-1',
    agentSessionId: 'agent-session-1',
    logger: NOOP_LOGGER,
    broadcaster: { emitAgentSessionContextSizeObservation: emit } as unknown as RunEventPublisher,
    autoCompact: null,
    runner: () => runner,
    isProcessing: () => state.processing,
    session: () => session,
    activeTurn: () => null,
    contextProviderSessionId: () => 'provider-session-1',
    postAgentSystemMessage,
    ...overrides,
  };
  return {
    runner,
    compaction: new RunCompaction(deps),
    calls,
    compact,
    getContextUsage,
    emit,
    postAgentSystemMessage,
    state,
  };
};

const notes = (h: ReturnType<typeof makeHarness>): string[] =>
  h.postAgentSystemMessage.mock.calls.map(([response]) => response);

describe('RunCompaction', () => {
  describe('compact', () => {
    it('posts start and finish notes when not silent', async () => {
      const h = makeHarness();
      await h.compaction.compact();
      expect(notes(h)).toEqual(['Starting compact…', 'Finished compact…']);
      expect(h.compact).toHaveBeenCalledTimes(1);
    });

    it('posts no notes when silent', async () => {
      const h = makeHarness();
      await h.compaction.compact({ silent: true });
      expect(notes(h)).toEqual([]);
      expect(h.compact).toHaveBeenCalledTimes(1);
    });

    it('throws NOT_SUPPORTED when the runner cannot compact', async () => {
      const h = makeHarness();
      Reflect.deleteProperty(h.runner, 'compact');
      await expect(h.compaction.compact()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
      expect(notes(h)).toEqual([]);
    });

    it('defers while processing and runs once at afterTurnEnd', async () => {
      const h = makeHarness();
      h.state.processing = true;
      const done = h.compaction.compact();
      expect(h.compact).not.toHaveBeenCalled();

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await expect(done).resolves.toBeUndefined();
      expect(h.compact).toHaveBeenCalledTimes(1);
    });

    it('coalesces deferred callers into one compact and ANDs the silent flags', async () => {
      const h = makeHarness();
      h.state.processing = true;
      const first = h.compaction.compact({ silent: true });
      const second = h.compaction.compact();

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await Promise.all([first, second]);
      expect(h.compact).toHaveBeenCalledTimes(1);
      expect(notes(h)).toEqual(['Starting compact…', 'Finished compact…']);
    });

    it('stays silent when every coalesced caller is silent', async () => {
      const h = makeHarness();
      h.state.processing = true;
      const first = h.compaction.compact({ silent: true });
      const second = h.compaction.compact({ silent: true });

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await Promise.all([first, second]);
      expect(notes(h)).toEqual([]);
    });

    it('rejects every deferred caller when the deferred compact fails', async () => {
      const failure = new Error('boom');
      const h = makeHarness({}, { compact: vi.fn().mockRejectedValue(failure) });
      h.state.processing = true;
      const first = h.compaction.compact({ silent: true });
      const second = h.compaction.compact({ silent: true });

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await expect(first).rejects.toBe(failure);
      await expect(second).rejects.toBe(failure);
    });
  });

  describe('afterTurnEnd', () => {
    it('compacts before publishing the context size', async () => {
      const h = makeHarness();
      h.state.processing = true;
      const done = h.compaction.compact({ silent: true });

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await done;
      expect(h.calls).toEqual(['compact', 'getContextUsage', 'emit']);
    });

    it('auto-compacts silently above the threshold, then publishes', async () => {
      const h = makeHarness({ autoCompact: { threshold: 500 } });
      await h.compaction.afterTurnEnd();
      expect(h.compact).toHaveBeenCalledTimes(1);
      expect(notes(h)).toEqual([]);
      expect(h.calls).toEqual(['getContextUsage', 'compact', 'getContextUsage', 'emit']);
    });

    it('does not auto-compact at or below the threshold', async () => {
      const h = makeHarness({ autoCompact: { threshold: 1_000 } });
      await h.compaction.afterTurnEnd();
      expect(h.compact).not.toHaveBeenCalled();
      expect(h.emit).toHaveBeenCalledTimes(1);
    });

    it('lets a deferred compact suppress the auto-compact check', async () => {
      const h = makeHarness({ autoCompact: { threshold: 500 } });
      h.state.processing = true;
      const done = h.compaction.compact({ silent: true });

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      await done;
      expect(h.compact).toHaveBeenCalledTimes(1);
      expect(h.getContextUsage).toHaveBeenCalledTimes(1);
    });

    it('swallows a failed auto-compact and still publishes', async () => {
      const h = makeHarness(
        { autoCompact: { threshold: 500 } },
        { compact: vi.fn().mockRejectedValue(new Error('boom')) },
      );
      await expect(h.compaction.afterTurnEnd()).resolves.toBeUndefined();
      expect(h.emit).toHaveBeenCalledTimes(1);
    });

    it('publishes nothing when the runner cannot report context usage', async () => {
      const h = makeHarness(
        {},
        {
          getContextUsage: vi
            .fn()
            .mockRejectedValue(new AgentSessionRunnerError('NOT_SUPPORTED', 'nope')),
        },
      );
      await expect(h.compaction.afterTurnEnd()).resolves.toBeUndefined();
      expect(h.emit).not.toHaveBeenCalled();
    });

    it('publishes nothing without a context provider session', async () => {
      const h = makeHarness({ contextProviderSessionId: () => null });
      await h.compaction.afterTurnEnd();
      expect(h.getContextUsage).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    });
  });

  describe('recordSubagentContextReading', () => {
    const reading = {
      providerSessionId: 'provider-session-1',
      usage: { totalTokens: 42, maxTokens: 100 },
    } as never;

    it('publishes the reading from the active Turn instead of reading the runner', async () => {
      const h = makeHarness({
        activeTurn: () => ({ turnId: 'turn-1', subagentProviderSessionId: 'provider-session-1' }),
      });
      h.compaction.recordSubagentContextReading('turn-1', reading);
      await h.compaction.afterTurnEnd();
      expect(h.getContextUsage).not.toHaveBeenCalled();
      expect(h.emit).toHaveBeenCalledWith(
        expect.objectContaining({ providerSessionId: 'provider-session-1', totalTokens: 42 }),
      );
    });

    it('rejects a reading from a different Turn', async () => {
      const h = makeHarness({
        activeTurn: () => ({ turnId: 'turn-2', subagentProviderSessionId: 'provider-session-1' }),
      });
      h.compaction.recordSubagentContextReading('turn-1', reading);
      await h.compaction.afterTurnEnd();
      expect(h.getContextUsage).toHaveBeenCalledTimes(1);
    });

    it('rejects a reading for a session the Turn did not identify', async () => {
      const h = makeHarness({
        activeTurn: () => ({ turnId: 'turn-1', subagentProviderSessionId: 'other-session' }),
      });
      h.compaction.recordSubagentContextReading('turn-1', reading);
      await h.compaction.afterTurnEnd();
      expect(h.getContextUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelPending', () => {
    it('rejects every waiting resolver and clears the deferred compact', async () => {
      const h = makeHarness();
      h.state.processing = true;
      const first = h.compaction.compact();
      const second = h.compaction.compact({ silent: true });
      const error = new Error('Run stopped while compact was pending.');

      h.compaction.cancelPending(error);
      await expect(first).rejects.toBe(error);
      await expect(second).rejects.toBe(error);

      h.state.processing = false;
      await h.compaction.afterTurnEnd();
      expect(h.compact).not.toHaveBeenCalled();
    });

    it('does nothing when no compact is pending', () => {
      const h = makeHarness();
      expect(() => h.compaction.cancelPending(new Error('stopped'))).not.toThrow();
    });
  });
});
