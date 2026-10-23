import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleRunStarted } from './run-started';
import { makeDeps, makeTestRun } from './__test-utils';
import type { LocalAgentOutputEvent, RunStartedEvent } from '../types';

const makeRawRunStarted = (): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'run_started',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    prompt: 'Fix the bug in auth.ts',
  },
});

describe('run_started end-to-end', () => {
  it('normalizes to RunStartedEvent with prompt', () => {
    const raw = makeRawRunStarted();
    const event = normalizeEvent(raw, 'claude');

    expect(event.kind).toBe('run_started');
    const typed = event as RunStartedEvent;
    expect(typed.prompt).toBe('Fix the bug in auth.ts');
  });

  it('is a lifecycle log — does not create messages', () => {
    const event = normalizeEvent(makeRawRunStarted(), 'claude') as RunStartedEvent;
    const deps = makeDeps();
    const ctx = makeTestRun();

    handleRunStarted(event, ctx, deps);

    // No poster calls — messages are created by the service layer.
    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    expect(deps.poster.update).not.toHaveBeenCalled();
    expect(deps.poster.complete).not.toHaveBeenCalled();
  });
});
