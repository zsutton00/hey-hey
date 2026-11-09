import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const postgres = new URL('../staging-postgres-statements.mjs', import.meta.url)
  .href;
const cpu = new URL('../staging-cpu-sampling.mjs', import.meta.url).href;
for (const [environment, project] of [
  ['staging', 'hey-hey-staging'],
  ['production', 'hey-hey'],
]) {
  test(`${environment} samples its database and attributes CPU to its own containers`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'recording-scope-'));
    try {
      const capture = join(directory, 'commands');
      writeFileSync(
        join(directory, 'ssh'),
        '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\ncat >/dev/null\nprintf \'{"available":true}\\n\'\n',
        { mode: 0o755 },
      );
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import {readPostgresJson} from ${JSON.stringify(postgres)};
        import {summarizeCpu} from ${JSON.stringify(cpu)};
        assert.equal((await readPostgresJson('test-host', 'SELECT 1')).available, true);
        const own = {name:${JSON.stringify(project + '-api-1')},cpuPercent:120};
        const other = {name:${JSON.stringify((environment === 'production' ? 'hey-hey-staging' : 'hey-hey') + '-api-1')},cpuPercent:999};
        assert.equal(summarizeCpu([{containers:[own,other]}]).api.mean,120);
      `,
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: `${directory}:/usr/bin:/bin`,
            CAPTURE: capture,
            API_DIAGNOSTIC_ENVIRONMENT: environment,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const command = readFileSync(capture, 'utf8');
      assert.match(command, new RegExp(`docker exec -i ${project}-postgres-1`));
      if (environment === 'production')
        assert.doesNotMatch(command, /hey-hey-staging/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('production requires its six service counters without a staging resource slice', async () => {
  const { acceptResourceCounters } =
    await import('../recording-acceptance.mjs');
  const counter = {
    samples: 2,
    intervals: [{ delta: { usage_usec: 10 } }],
    gaps: [],
  };
  const cpu = {
    environment: 'production',
    measuredSamples: 2,
    errors: [],
    measuredCounters: {
      containers: Object.fromEntries(
        [
          'api',
          'graph-service',
          'embeddings',
          'postgres',
          'neo4j',
          'vespa',
        ].map((name) => [`hey-hey-${name}-1`, counter]),
      ),
    },
  };
  assert.equal(acceptResourceCounters(cpu).complete, true);
  delete cpu.measuredCounters.containers['hey-hey-postgres-1'];
  assert.match(acceptResourceCounters(cpu).failures.join(';'), /postgres/);
});
