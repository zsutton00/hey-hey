import { describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from '../server/logger';
import { normalizeEvent } from '../run/normalize';
import { ChangedFileReporting } from './changed-file-reporting';

describe('changed-file reporting repair prompt', () => {
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
