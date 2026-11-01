import { describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from '../server/logger';
import { normalizeEvent } from '../run/normalize';
import { ChangedFileReporting } from './changed-file-reporting';

describe('changed-file reporting repair prompt', () => {
  it.each([false, true])('allows omission without validation after edits=%s', (edited) => {
    const coordinator = new ChangedFileReporting('turn-1', NOOP_LOGGER);
    if (edited) coordinator.successfulEdit();
    expect(coordinator.ready).toBe(false);
    expect(coordinator.needsCorrection).toBe(false);
    expect(coordinator.beginRepair()).toBeNull();
    coordinator.release();
    expect(coordinator.snapshot()).toMatchObject({
      state: 'not_reported',
      validatedRevision: null,
      attempts: 0,
      incomplete: false,
    });
  });

  it('requires correction when the provider changes after validation', () => {
    const coordinator = new ChangedFileReporting('turn-1', NOOP_LOGGER);
    coordinator.report([]);
    coordinator.providerSessionChanged('replacement-provider');
    expect(coordinator.ready).toBe(false);
    expect(coordinator.needsCorrection).toBe(true);
  });

  it('invalidates an explicit empty submission after a successful edit', () => {
    const coordinator = new ChangedFileReporting('turn-1', NOOP_LOGGER);
    coordinator.report([]);
    expect(coordinator.ready).toBe(true);
    coordinator.successfulEdit();
    expect(coordinator.needsCorrection).toBe(true);
    coordinator.release();
    expect(coordinator.snapshot().incomplete).toBe(true);
  });

  it('snapshots the full targeted continuation without the retained answer', () => {
    const coordinator = new ChangedFileReporting(
      '11111111-1111-4111-8111-111111111111',
      NOOP_LOGGER,
    );
    const event = normalizeEvent(
      {
        runId: 'run-1',
        source: 'provider',
        eventType: 'agent_output',
        timestamp: '2026-10-08T18:00:00.000Z',
        sessionId: 'provider-1',
        agentId: 'claude',
        payload: { messageType: 'assistant', taskComplete: true, summary: 'Retained answer' },
      },
      'claude',
    );
    if (event.kind !== 'assistant_complete') throw new Error('Expected completion');
    coordinator.retain(event);
    coordinator.report([
      {
        index: 0,
        status: 'rejected',
        reason: 'absent_path',
        claim: { serviceId: 'service-1', path: 'src/featur.ts' },
      },
    ]);
    expect(coordinator.beginRepair()).toMatchSnapshot();
    coordinator.endRepair();
    expect(coordinator.beginRepair()).toMatchSnapshot();
    coordinator.endRepair();
    expect(coordinator.beginRepair()).toBeNull();
    expect(coordinator.release()?.summary).toBe('Retained answer');
    expect(coordinator.release()).toBeNull();
    expect(coordinator.snapshot().incomplete).toBe(true);
  });
});
