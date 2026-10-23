import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { safeTraceSpans, traceCoverage } from '../safe-trace-spans.mjs';

test('keeps nested phase durations separate and flags missing parents', () => {
  const result = traceCoverage([
    {
      spanId: 'parent',
      operationName: 'materialize',
      startTimeUnixNano: '0',
      endTimeUnixNano: '2000000000',
    },
    {
      spanId: 'child',
      parentSpanId: 'parent',
      operationName: 'checkpoint',
      startTimeUnixNano: '0',
      endTimeUnixNano: '1000000000',
    },
  ]);
  assert.deepEqual(
    result.phases.map((x) => x.durationMs),
    [2000, 1000],
  );
  assert.equal(result.incomplete, false);
  assert.equal(
    traceCoverage([{ spanId: 'child', parentSpanId: 'missing' }]).incomplete,
    true,
  );
});

test('collector preserves every operation allowed by the API exporter', () => {
  const source = readFileSync(
    new URL('../../../src/telemetry/api-tracing.ts', import.meta.url),
    'utf8',
  );
  const registry = source.match(
    /export const API_SPAN_NAMES = \[([\s\S]*?)\] as const;/,
  )[1];
  const names = [...registry.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const spans = safeTraceSpans({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'hey-hey-api' } },
          ],
        },
        scopeSpans: [{ spans: names.map((name) => ({ name })) }],
      },
    ],
  });
  assert.deepEqual(
    spans.map((span) => span.operationName),
    names,
  );
  assert.ok(spans.every((span) => span.serviceName === 'hey-hey-api'));
});

test('retains known service/operation identities without arbitrary names or attributes', () => {
  const spans = safeTraceSpans({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'embeddings' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: 'vespa.search.query',
                attributes: [
                  { key: 'payload', value: { stringValue: 'PRIVATE' } },
                ],
              },
              {
                name: 'PRIVATE',
                attributes: [
                  { key: 'http.method', value: { stringValue: 'POST' } },
                ],
              },
              { name: 'PRIVATE' },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(spans[0].serviceName, 'embeddings');
  assert.equal(spans[0].operationName, 'vespa.search.query');
  assert.equal(spans[1].operationName, 'HTTP POST');
  assert.equal(spans[2].operationName, undefined);
  assert.equal(JSON.stringify(spans).includes('PRIVATE'), false);
});

test('retains database phases and checkpoint coordinates without content', () => {
  const spans = safeTraceSpans({
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              { name: 'PostgreSQL db_query' },
              { name: 'PostgreSQL connection' },
              {
                name: 'proposal.change_set.checkpoint',
                attributes: [
                  {
                    key: 'operation.kind',
                    value: { stringValue: 'section.replace' },
                  },
                  { key: 'operation.index', value: { intValue: '0' } },
                  { key: 'section.content', value: { stringValue: 'PRIVATE' } },
                ],
              },
              { name: 'PostgreSQL db_query PRIVATE' },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(spans[0].operationName, 'PostgreSQL db_query');
  assert.equal(spans[1].operationName, 'PostgreSQL connection');
  assert.equal(spans[2].operationKind, 'section.replace');
  assert.equal(spans[2].operationIndex, 0);
  assert.equal(spans[3].operationName, undefined);
  assert.equal(JSON.stringify(spans).includes('PRIVATE'), false);
});
