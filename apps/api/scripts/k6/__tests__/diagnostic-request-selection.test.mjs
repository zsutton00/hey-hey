import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { selectDiagnosticRequests } from '../diagnostic-request-selection.mjs';

test('prioritizes errors and slow post-warmup requests without exporting payloads', async () => {
  const dir = mkdtempSync(
    join(process.cwd(), 'artifacts/api-diagnostic/selection-test-'),
  );
  try {
    const path = join(dir, 'points.jsonl');
    writeFileSync(
      path,
      [
        [10, 9999, 'ok', 'run-vu1-it0-r1'],
        [40, 200, 'ok', 'run-vu1-it1-r2'],
        [41, 20, 'error', 'run-vu1-it2-r3'],
        [42, 500, 'ok', 'run-vu1-it3-r4'],
        [43, 900, 'ok', undefined],
      ]
        .map(([seconds, value, outcome, requestId]) =>
          JSON.stringify({
            type: 'Point',
            metric: 'activity_action_latency',
            data: {
              time: new Date(seconds * 1000).toISOString(),
              value,
              tags: {
                outcome,
                requestId,
                action: 'search',
                payload: 'PRIVATE',
              },
            },
          }),
        )
        .join('\n'),
    );
    const result = await selectDiagnosticRequests(path, 'run', 30000, 60000, 2);
    assert.deepEqual(
      result.selected.map((x) => x.durationMs),
      [20, 500],
    );
    assert.equal(result.unmapped, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
