import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparable } from '../replay-diagnostic-comparison.mjs';

const run = () => ({
  cpu: 8,
  memory: 34359738368,
  manifest: {
    buildId: 'old-build',
    load: { duration: '5m', repetitions: 1, warmupSeconds: 30 },
    fixture: {
      fixtureVersion: 2,
      contentHash: 'routing-hash',
      distributionVersion: 1,
      projectCount: 25,
      assignments: [
        {
          userIndex: 0,
          userId: 'user',
          projectId: 'project',
          scratchTaskId: 'scratch',
          agentSessionId: 'session',
          conversationId: 'conversation',
        },
      ],
    },
    mix: {
      mixVersion: 2,
      searchesPerMinute: 2,
      actions: { read: 1, edit: 2 },
      searchActions: { search: 1 },
      cohorts: { light: { requestsPerMinute: 50 } },
    },
  },
});
test('deployment changes remain comparison variables; property ordering is irrelevant', () => {
  const previous = run();
  const current = run();
  current.manifest.buildId = 'new-build';
  current.manifest.mix.actions = { edit: 2, read: 1 };
  assert.equal(comparable(current, previous), true);
});
test('caps, routing and changed workload split comparison series', () => {
  const previous = run();
  const current = run();
  current.cpu = 4;
  assert.equal(comparable(current, previous), false);
  current.cpu = 8;
  current.manifest.fixture.assignments[0].scratchTaskId = 'other';
  assert.equal(comparable(current, previous), false);
  current.manifest.fixture.assignments[0].scratchTaskId = 'scratch';
  current.manifest.mix.cohorts.light.requestsPerMinute = 60;
  assert.equal(comparable(current, previous), false);
});
