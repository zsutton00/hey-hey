import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleRunCompleted } from './run-completed';
import { makePoster, makeDeps, makeTestRun } from './__test-utils';
import type { LocalAgentOutputEvent, RunCompletedEvent } from '../types';

const makeRawRunCompleted = (status = 'complete'): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'run_completed',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: { status },
});

describe('run_completed end-to-end', () => {
  it('normalizes to RunCompletedEvent with typed status', () => {
    const event = normalizeEvent(makeRawRunCompleted(), 'claude');
    expect(event.kind).toBe('run_completed');
    expect((event as RunCompletedEvent).status).toBe('complete');

    const errorEvent = normalizeEvent(makeRawRunCompleted('error'), 'claude');
    expect((errorEvent as RunCompletedEvent).status).toBe('error');
  });

  it('does not post any message — the turn no longer holds a SYSTEM anchor to finalize', async () => {
    const event = normalizeEvent(makeRawRunCompleted(), 'claude') as RunCompletedEvent;
    const poster = makePoster();
    const ctx = makeTestRun();
    const deps = makeDeps(poster);

    await handleRunCompleted(event, ctx, deps);

    expect(poster.complete).not.toHaveBeenCalled();
    expect(poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('clears pending diffs', async () => {
    const event = normalizeEvent(makeRawRunCompleted(), 'claude') as RunCompletedEvent;
    const deps = makeDeps();
    const pendingDiffs = new Map([['key', { event: {} as never, files: ['src/auth.ts'] }]]);
    const ctx = makeTestRun({ pendingDiffs });

    await handleRunCompleted(event, ctx, deps);

    expect(ctx.pendingDiffs.size).toBe(0);
  });
});
