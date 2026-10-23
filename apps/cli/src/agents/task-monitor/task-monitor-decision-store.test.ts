import { describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from '../../server/logger';
import { TaskMonitorManagedTurnRuntime } from '../../server/task-monitor-managed-turn-runtime';
import { TaskMonitorDecisionStore } from './task-monitor-decision-store';

const createStore = () => {
  const managedTurns = new TaskMonitorManagedTurnRuntime(NOOP_LOGGER);
  return { managedTurns, store: new TaskMonitorDecisionStore(NOOP_LOGGER, managedTurns) };
};

const settle = (
  managedTurns: TaskMonitorManagedTurnRuntime,
  terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED',
) =>
  managedTurns.publishSettledTurn({
    agentSessionId: 'coordinator-run',
    turnId: 'coordinator-turn',
    promptType: 'task_monitor',
    terminalOutcome,
    completedAssistantMessageId: terminalOutcome === 'COMPLETED' ? 'assistant-message' : null,
    reports: [],
    settledAt: '2026-08-04T00:00:00.000Z',
  });

describe('Task Monitor decision store', () => {
  it('resolves a waiter with the parsed decision, not merely Run completion', async () => {
    const { store } = createStore();
    const waiting = store.wait('coordinator-run');

    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: { action: 'ACCEPT_TASK', rationale: 'Canonical evidence supports acceptance.' },
    });

    await expect(waiting).resolves.toEqual({
      status: 'DECISION',
      decision: { action: 'ACCEPT_TASK', rationale: 'Canonical evidence supports acceptance.' },
    });
  });

  it('publishes malformed coordinator output as a bounded invalid result', async () => {
    const { store } = createStore();
    store.publish('coordinator-run', { status: 'INVALID', reason: 'INVALID_JSON' });

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'INVALID',
      reason: 'INVALID_JSON',
    });
  });

  it('keeps a decision eligible beyond the former deadline until output arrives', async () => {
    const { store } = createStore();
    const waiting = store.wait('coordinator-run');
    let resolved = false;
    void waiting.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The coordinator is still working.' },
    });
    await expect(waiting).resolves.toEqual({
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The coordinator is still working.' },
    });
  });

  it.each(['COMPLETED', 'FAILED', 'ABORTED'] as const)(
    'resolves a decisionless %s coordinator Turn from canonical settlement',
    async (terminalOutcome) => {
      const { managedTurns, store } = createStore();
      const waiting = store.wait('coordinator-run');

      settle(managedTurns, terminalOutcome);

      await expect(waiting).resolves.toEqual({ status: 'TURN_SETTLED', terminalOutcome });
    },
  );

  it('preserves a validated decision published before completed settlement', async () => {
    const { managedTurns, store } = createStore();
    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'Use the validated decision.' },
    });

    settle(managedTurns, 'COMPLETED');

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'Use the validated decision.' },
    });
  });

  it('ignores settlement for an unbound, unwaited session', async () => {
    const { managedTurns, store } = createStore();

    settle(managedTurns, 'FAILED');
    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The unrelated settlement was not claimed.' },
    });

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The unrelated settlement was not claimed.' },
    });
  });

  it('keeps a repeated publication idempotent', async () => {
    const { store } = createStore();
    store.publish('coordinator-run', { status: 'INVALID', reason: 'first' });
    store.publish('coordinator-run', { status: 'INVALID', reason: 'second' });

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'INVALID',
      reason: 'first',
    });
  });

  it('reserves one durable publication per run correlation and releases failed attempts', () => {
    const { store } = createStore();
    store.bind('coordinator-run', 'report-1');

    expect(store.reservePublication('coordinator-run')).toBe(true);
    expect(store.reservePublication('coordinator-run')).toBe(false);
    store.releasePublication('coordinator-run');
    expect(store.reservePublication('coordinator-run')).toBe(true);
  });

  it('does not replay a prior result when a coordinator Run is reused for a new correlation', async () => {
    const { store } = createStore();
    store.bind('coordinator-run', 'report-1');
    store.publish('coordinator-run', { status: 'INVALID', reason: 'first' });

    store.bind('coordinator-run', 'report-2');
    const waiting = store.wait('coordinator-run');
    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: {
        action: 'REQUEST_CHANGES',
        rationale: 'The new report is settled.',
        guidance: 'Address the remaining gap.',
      },
    });

    await expect(waiting).resolves.toEqual({
      status: 'DECISION',
      decision: {
        action: 'REQUEST_CHANGES',
        rationale: 'The new report is settled.',
        guidance: 'Address the remaining gap.',
      },
    });
  });

  it('does not replay a failed attempt when the same run correlation is retried', async () => {
    const { managedTurns, store } = createStore();
    store.bind('coordinator-run', 'report-1');
    settle(managedTurns, 'FAILED');

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'TURN_SETTLED',
      terminalOutcome: 'FAILED',
    });

    store.bind('coordinator-run', 'report-1');
    store.publish('coordinator-run', {
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The retry produced a valid decision.' },
    });

    await expect(store.wait('coordinator-run')).resolves.toEqual({
      status: 'DECISION',
      decision: { action: 'WAIT', rationale: 'The retry produced a valid decision.' },
    });
  });
});

it('ignores a prior coordinator settlement and output while a correction is pending', async () => {
  const { store, managedTurns } = createStore();
  store.bind('coordinator-run', 'released-turn', 'attempt-1');
  store.bindTurn('coordinator-run', 'attempt-1', 'coordinator-turn');
  store.publish(
    'coordinator-run',
    {
      status: 'INVALID',
      reason: 'Bad JSON',
      failure: { code: 'INVALID_JSON', message: 'Bad JSON', issues: [] },
    },
    'attempt-1',
  );
  store.bind('coordinator-run', 'released-turn', 'attempt-2');
  let resolved = false;
  const waiting = store.wait('coordinator-run').then((result) => {
    resolved = true;
    return result;
  });
  await settle(managedTurns, 'COMPLETED');
  store.publish(
    'coordinator-run',
    { status: 'DECISION', decision: { action: 'ACCEPT_TASK', rationale: 'Old output' } },
    'attempt-1',
  );
  await Promise.resolve();
  expect(resolved).toBe(false);
  store.bindTurn('coordinator-run', 'attempt-2', 'corrected-turn');
  store.publish(
    'coordinator-run',
    { status: 'DECISION', decision: { action: 'WAIT', rationale: 'Corrected output' } },
    'attempt-2',
  );
  await expect(waiting).resolves.toMatchObject({
    status: 'DECISION',
    decision: { action: 'WAIT' },
  });
});
