import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeCpu } from '../staging-cpu-sampling.mjs';

test('reports multi-core Docker CPU percentages without dividing by host cores', () => {
  const result = summarizeCpu(
    [120, 180].map((cpuPercent) => ({
      containers: [{ name: 'hey-hey-staging-api-1', cpuPercent }],
    })),
  );
  assert.deepEqual(result.api, { samples: 2, mean: 150, p95: 180, max: 180 });
  assert.deepEqual(result.postgres, { samples: 0 });
});
