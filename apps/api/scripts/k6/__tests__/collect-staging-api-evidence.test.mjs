import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { safeTraceSpans, traceCoverage } from '../safe-trace-spans.mjs';

const source = readFileSync(
  new URL('../collect-staging-api-evidence.mjs', import.meta.url),
  'utf8',
).replace(/^import .*;\n/gm, '');
const traceId = 'a'.repeat(32);
async function collect(
  mode,
  traceStatus = 200,
  targeted = false,
  sampling = {},
) {
  const output = [];
  const requests = [];
  const process = {
    argv: ['node', 'collector', mode],
    env: {
      API_DIAGNOSTIC_START_AT: '2026-10-12T09:33:38Z',
      API_DIAGNOSTIC_END_AT: '2026-10-12T09:39:04Z',
      K6_RUN_ID: 'activity-test',
      ...(targeted ? { API_DIAGNOSTIC_RAW_METRICS: 'points.jsonl' } : {}),
    },
    exit(code) {
      if (code !== undefined) this.exitCode = code;
      throw new Error('exit');
    },
  };
  await runInNewContext(`(async () => { ${source} })()`, {
    process,
    URL,
    URLSearchParams,
    AbortSignal,
    BigInt,
    readFileSync: () => 'viewer-token',
    homedir: () => '/home/test',
    join: (...parts) => parts.join('/'),
    safeTraceSpans,
    traceCoverage,
    selectDiagnosticRequests: async () => ({
      selected: [
        {
          requestId: 'activity-test-vu1-it2-r3',
          action: 'write_scratch_edit',
          outcome: 'ok',
          durationMs: 3000,
          startedAt: '2026-10-12T09:36:00Z',
          endedAt: '2026-10-12T09:36:03Z',
        },
      ],
    }),
    console: {
      log: (value) => output.push(JSON.parse(value)),
      error: () => {},
    },
    fetch: async (url, options) => {
      requests.push({
        url: String(url),
        authorization: options.headers.Authorization,
      });
      let body;
      if (url.pathname.endsWith('/datasources'))
        body = [
          { type: 'loki', uid: 'logs' },
          { type: 'tempo', uid: 'traces' },
        ];
      else if (url.pathname.endsWith('/labels'))
        body = { data: ['environment', 'service_name'] };
      else if (url.pathname.includes('/label/'))
        body = {
          data: url.pathname.includes('/environment/') ? ['staging'] : ['api'],
        };
      else if (url.pathname.endsWith('/query_range'))
        body = {
          data: {
            result: [
              {
                values: [
                  [
                    '123',
                    JSON.stringify({
                      traceId,
                      traceSampled: sampling.flag,
                      correlationId: 'activity-test-vu1',
                      prompt: 'PRIVATE',
                      operationKind: 'section.replace',
                      operationIndex: 0,
                      outcome: 'completed',
                      phaseMs: {
                        'proposal.change_set.checkpoint.precheck': 12,
                        payload: 'PRIVATE',
                      },
                      eventLoopDelayP99Ms: 25,
                      metadata: { durationMs: 20 },
                    }),
                  ],
                ],
              },
            ],
          },
        };
      else if (url.pathname.endsWith('/search'))
        body = {
          traces: sampling.exported === false ? [] : [{ traceID: traceId }],
        };
      else
        body = {
          batches: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      spanId: 'span',
                      startTimeUnixNano: '100',
                      endTimeUnixNano: '200',
                      attributes: [{ value: 'PRIVATE' }],
                    },
                  ],
                },
              ],
            },
          ],
        };
      const status = url.pathname.includes('/api/traces/') ? traceStatus : 200;
      if (url.pathname.endsWith('/query_range') && sampling.legacyCount) {
        body.data.result[0].values.unshift(
          ...Array.from({ length: sampling.legacyCount }, (_, index) => [
            '123',
            JSON.stringify({
              traceId: (index + 1).toString(16).padStart(32, '0'),
            }),
          ]),
        );
      }
      return { ok: status === 200, status, json: async () => body };
    },
  }).catch((error) => {
    if (error.message !== 'exit') throw error;
  });
  return { output, requests, process };
}

test('Viewer authentication and sanitized correlated logs', async () => {
  const result = await collect('api');
  assert.equal(result.output[0].entries[0].durationMs, 20);
  assert.equal(
    result.output[0].checkpointTimingSample.entries[0].operationKind,
    'section.replace',
  );
  assert.deepEqual(result.output[0].checkpointTimingSample.entries[0].phaseMs, {
    'proposal.change_set.checkpoint.precheck': 12,
  });
  assert.equal(
    result.output[0].processIntervalSample.entries[0].eventLoopDelayP99Ms,
    25,
  );
  assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
  assert.ok(
    result.requests.every(
      (request) => request.authorization === 'Bearer viewer-token',
    ),
  );
  assert.ok(
    result.requests.some((request) =>
      new URL(request.url).searchParams.get('query')?.includes('activity-test'),
    ),
  );
});

test('Tempo exports only correlated span timing and reports missing traces', async () => {
  const result = await collect('tempo');
  const search = result.requests.find((request) =>
    new URL(request.url).pathname.endsWith('/search'),
  );
  assert.equal(
    new URL(search.url).searchParams.get('tags'),
    'service.name=hey-hey-api',
  );
  assert.equal(result.output[0].windowSearch.query, 'service.name=hey-hey-api');
  assert.equal(result.output[0].traceCount, 1);
  assert.equal(result.process.exitCode, undefined);
  assert.equal(result.output[0].traces[0].spans[0].endTimeUnixNano, '200');
  assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
  const missing = await collect('tempo', 404);
  assert.equal(missing.output[0].traceCount, 0);
  assert.equal(
    missing.output[0].failures[0].error,
    'Staging Grafana evidence HTTP 404',
  );
  assert.equal(missing.process.exitCode, 1);
});

test('preflight verifies Loki and Tempo read access without load', async () => {
  const result = await collect('preflight');
  const search = result.requests.find((request) =>
    new URL(request.url).pathname.endsWith('/search'),
  );
  assert.equal(
    new URL(search.url).searchParams.get('tags'),
    'service.name=hey-hey-api',
  );
  assert.equal(result.output[0].accessVerified, true);
  assert.ok(
    result.requests.every(
      (request) => new URL(request.url).hostname === 'staging.heyhey.dev',
    ),
  );
});

test('targets actual slow request windows after warm-up and preserves missing-trace status', async () => {
  const result = await collect('tempo', 404, true);
  const request = result.requests.find((r) =>
    new URL(r.url).searchParams
      .get('query')
      ?.includes('activity-test-vu1-it2-r3'),
  );
  const params = new URL(request.url).searchParams;
  assert.equal(params.get('limit'), '50');
  assert.equal(
    Number(params.get('end')) - Number(params.get('start')),
    7000000000,
  );
  assert.equal(result.output[0].targetedRequests[0].durationMs, 3000);
  assert.equal(result.output[0].failures[0].status, 404);
});

test('explicitly unsampled slow requests retain logs without wasting Tempo reads', async () => {
  const result = await collect('tempo', 404, true, {
    flag: false,
    exported: false,
  });
  assert.equal(
    result.requests.some((r) =>
      new URL(r.url).pathname.includes('/api/traces/'),
    ),
    false,
  );
  assert.deepEqual(Array.from(result.output[0].unsampledTraceIds), [traceId]);
  assert.equal(
    result.output[0].targetedRequests[0].entries[0].traceSampled,
    false,
  );
  assert.equal(result.output[0].failures.length, 0);
  assert.equal(result.process.exitCode, 1); // No recovered trace remains an explicit coverage gap.
});

test('sampled 404 remains an export/retrieval gap, not an unsampled omission', async () => {
  const result = await collect('tempo', 404, true, {
    flag: true,
    exported: false,
  });
  assert.equal(result.output[0].failures[0].sampling, 'sampled');
  assert.equal(result.output[0].unsampledTraceIds.length, 0);
  const supplemental = result.requests.find((r) =>
    new URL(r.url).searchParams.get('query')?.includes('responseTimeMs >= 300'),
  );
  assert.equal(new URL(supplemental.url).searchParams.get('limit'), '50');
});

test('known exported trace survives a budget filled by legacy unknown trace IDs', async () => {
  const result = await collect('tempo', 200, true, { legacyCount: 31 });
  const reads = result.requests.filter((r) =>
    new URL(r.url).pathname.includes('/api/traces/'),
  );
  assert.equal(reads.length, 30);
  assert.ok(reads[0].url.endsWith(traceId));
  assert.equal(result.output[0].omittedTraceCount, 2);
});

test('process evidence spans the full run with nonoverlapping bounded windows', async () => {
  const result = await collect('api');
  const windows = result.output[0].processIntervalSample.windows;
  assert.equal(windows.length, 3);
  assert.equal(windows[0].startAt, '2026-10-12T09:34:08.000Z');
  assert.equal(windows.at(-1).endAt, '2026-10-12T09:39:04.000Z');
  const reads = result.requests
    .map((r) => new URL(r.url))
    .filter((url) =>
      url.searchParams
        .get('query')
        ?.includes('API diagnostic process interval'),
    );
  for (let i = 0; i < reads.length; i++) {
    const params = reads[i].searchParams;
    assert.equal(params.get('limit'), '50');
    assert.ok(
      BigInt(params.get('end')) - BigInt(params.get('start')) < 120000000000n,
    );
    if (i)
      assert.equal(
        BigInt(params.get('start')),
        BigInt(reads[i - 1].searchParams.get('end')) + 1n,
      );
  }
  assert.match(result.output[0].cpuProfileSample.gap, /No CPU profile/);
  assert.equal(JSON.stringify(result.output).includes('PRIVATE'), false);
});
