import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizePostgres } from '../staging-postgres-sampling.mjs';

test('reports active waiting separately from idle sessions and exposes sampling gaps', () => {
  const summary = summarizePostgres([
    {
      capturedAt: '2026-10-13T04:00:00Z',
      activeSessions: 2,
      activeWaitingSessions: 1,
      blockedSessions: [{ pid: 123, blockers: [456] }],
      sessionGroups: [
        {
          state: 'active',
          wait_event_type: 'Lock',
          wait_event: 'advisory',
          sessions: 1,
        },
        {
          state: 'idle',
          wait_event_type: 'Client',
          wait_event: 'ClientRead',
          sessions: 40,
        },
      ],
    },
    {
      capturedAt: '2026-10-13T04:00:01Z',
      activeSessions: 0,
      activeWaitingSessions: 0,
      blockedSessions: [],
      sessionGroups: [],
    },
  ]);
  assert.equal(summary.samplesWithBlockedSessions, 1);
  assert.equal(summary.maxActiveWaitingSessions, 1);
  assert.equal(summary.maxSampleGapMs, 1000);
  assert.deepEqual(summary.waitObservations, { 'Lock:advisory': 1 });
  assert.equal(summarizePostgres([]).maxActiveWaitingSessions, null);
});
