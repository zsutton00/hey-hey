import { describe, expect, it, vi } from 'vitest';
import { createTestRun, createTestRunRegistry } from './run.test-support';
import type { Run } from './run';

/**
 * Durable input pickup has no timer, so each change that can make `canAcceptDurableInput`
 * true must raise the Run's readiness signal.
 */
describe('Run durable input readiness', () => {
  const readyRun = () => {
    const durableInputReady = vi.fn();
    const run = createTestRun({}, { durableInputReady });
    return { run, durableInputReady };
  };

  it('signals when the last foreground subagent hold is released', () => {
    const { run, durableInputReady } = readyRun();
    run.holdForSubagent('first');
    run.holdForSubagent('second');
    run.releaseSubagentHold('first');
    expect(durableInputReady).not.toHaveBeenCalled();
    expect(run.canAcceptDurableInput).toBe(false);
    run.releaseSubagentHold('second');
    expect(run.canAcceptDurableInput).toBe(true);
    expect(durableInputReady).toHaveBeenCalled();
  });

  it('signals when a pending scope review settles', () => {
    const { run, durableInputReady } = readyRun();
    run.serviceScope.recordServiceScopeRequest(
      { id: 'scope-request' } as Parameters<Run['serviceScope']['recordServiceScopeRequest']>[0],
      'message-id',
      {} as Parameters<Run['serviceScope']['recordServiceScopeRequest']>[2],
    );
    expect(run.canAcceptDurableInput).toBe(false);
    run.serviceScope.settleServiceScopeRequest('scope-request');
    expect(run.canAcceptDurableInput).toBe(true);
    expect(durableInputReady).toHaveBeenCalledOnce();
  });

  it('signals when draining leaves the in-memory queue empty and the Run idle', async () => {
    const { run, durableInputReady } = readyRun();
    run.isProcessing = true;
    expect(run.canAcceptDurableInput).toBe(false);
    await (run as unknown as { drainQueue: () => Promise<void> }).drainQueue();
    expect(run.canAcceptDurableInput).toBe(true);
    expect(durableInputReady).toHaveBeenCalledOnce();
  });
});

describe('RunRegistry durable input readiness', () => {
  const registryWithAdmission = () => {
    const admission = { admit: vi.fn(), durableInputReady: vi.fn() };
    return { registry: createTestRunRegistry(undefined, admission), admission };
  };

  it('forwards a hydrated Run releasing its last hold', () => {
    const { registry, admission } = registryWithAdmission();
    const run = createTestRun();
    registry.create({
      runId: run.runId,
      organizationId: 'test-org-id',
      projectId: 'test-project-id',
      conversationId: 'test-conversation-id',
      provider: 'claude',
      session: run.session,
    });
    registry.holdForSubagent(run.runId, 'interaction');
    registry.releaseSubagentHold(run.runId, 'interaction');
    expect(admission.durableInputReady).toHaveBeenCalledWith(run.runId);
  });

  it('forwards release of the last hold on a Run that is not hydrated', () => {
    const { registry, admission } = registryWithAdmission();
    registry.holdForSubagent('cold-run', 'first');
    registry.holdForSubagent('cold-run', 'second');
    registry.releaseSubagentHold('cold-run', 'first');
    expect(admission.durableInputReady).not.toHaveBeenCalled();
    registry.releaseSubagentHold('cold-run', 'second');
    expect(admission.durableInputReady).toHaveBeenCalledExactlyOnceWith('cold-run');
  });
});
