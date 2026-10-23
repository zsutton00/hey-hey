// Re-fetch only trace IDs already correlated to a diagnostic by the collector.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeTraceSpans } from './safe-trace-spans.mjs';

const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error('Supply correlated-tempo-sample files');
const samples = inputs.map((path) => ({ path, sample: JSON.parse(readFileSync(path, 'utf8')) }));
for (const { sample } of samples) {
  if (sample.kind !== 'correlated-tempo-sample' ||
      !sample.traces.every((item) => /^[a-f0-9]{32}$/i.test(item.traceId)))
    throw new Error('Expected existing correlated diagnostic trace evidence');
}
const token = readFileSync(join(homedir(), '.config/hey-hey/grafana-mcp/staging-token'), 'utf8').trim();
async function get(path) {
  const response = await fetch(new URL(path, 'https://staging.heyhey.dev/grafana/'), {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Staging Grafana HTTP ${response.status}`);
  return response.json();
}
const tempo = (await get('api/datasources')).find((source) => source.type === 'tempo');
if (!tempo) throw new Error('Staging Tempo datasource missing');
const cache = new Map();
for (const { path, sample } of samples) {
  const traces = [], failures = [];
  for (const { traceId } of sample.traces) {
    if (!cache.has(traceId)) {
      try {
        const trace = await get(`api/datasources/proxy/uid/${encodeURIComponent(tempo.uid)}/api/traces/${traceId}`);
        cache.set(traceId, { traceId, spans: safeTraceSpans(trace) });
      } catch (error) { cache.set(traceId, { traceId, error: error.message }); }
    }
    const result = cache.get(traceId);
    (result.error ? failures : traces).push(result);
  }
  const output = path.replace(/\.json$/, '-operations.json');
  writeFileSync(output, JSON.stringify({
    kind: 'correlated-tempo-operation-recovery', startAt: sample.startAt,
    endAt: sample.endAt, query: sample.query, datasourceUid: tempo.uid,
    recoveredAt: new Date().toISOString(), traces, failures,
    coverage: 'Only previously correlated trace IDs; names and services allowlisted; no payloads or arbitrary attributes.',
  }, null, 2) + '\n');
  console.log(JSON.stringify({ output, traceCount: traces.length, failures: failures.length }));
}
if ([...cache.values()].some((item) => item.error)) process.exitCode = 1;
