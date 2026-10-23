// Bounded, read-only Loki/Tempo evidence. Keep credentials and application payloads
// out of artifacts: export only correlation and timing fields.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeTraceSpans, traceCoverage } from './safe-trace-spans.mjs';
import { selectDiagnosticRequests } from './diagnostic-request-selection.mjs';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const mode = process.argv[2] || 'api';
if (!['api', 'tempo', 'preflight'].includes(mode))
  throw new Error('Expected api, tempo, or preflight');
const end =
  mode === 'preflight'
    ? Date.now()
    : Date.parse(required('API_DIAGNOSTIC_END_AT'));
const start =
  mode === 'preflight'
    ? end - 900000
    : Date.parse(required('API_DIAGNOSTIC_START_AT'));
if (
  !Number.isFinite(start) ||
  !Number.isFinite(end) ||
  end <= start ||
  end - start > 7200000
) {
  throw new Error(
    'Evidence window must be positive and no longer than two hours',
  );
}
const runId = mode === 'preflight' ? 'preflight' : required('K6_RUN_ID');
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(runId))
  throw new Error('Invalid diagnostic run ID');
const token = readFileSync(
  process.env.STAGING_GRAFANA_TOKEN_FILE ||
    join(homedir(), '.config/hey-hey/grafana-mcp/staging-token'),
  'utf8',
).trim();
const origin = 'https://staging.heyhey.dev/grafana/';
async function get(path) {
  const response = await fetch(new URL(path, origin), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`Staging Grafana evidence HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
const sources = await get('api/datasources');
const loki = sources.find((source) => source.type === 'loki');
if (!loki) throw new Error('Staging Loki datasource missing');
const tempo = sources.find((source) => source.type === 'tempo');
if (mode !== 'api' && !tempo)
  throw new Error('Staging Tempo datasource missing');
const prefix = `api/datasources/proxy/uid/${encodeURIComponent(loki.uid)}/loki/api/v1/`;
// Two-minute partitions retain the end of a five-minute process timeline
// without increasing the per-call privacy bound. Full partitions are explicit
// gaps rather than silently advertised as complete evidence.
async function windowedLogs(query, from, to) {
  const windows = [];
  const values = [];
  for (let lower = from; lower < to; lower += 120000) {
    const upper = Math.min(to, lower + 120000);
    const result = await get(
      `${prefix}query_range?${new URLSearchParams({
        query,
        start: String(BigInt(lower) * 1000000n),
        end: String(BigInt(upper) * 1000000n - 1n),
        limit: '50',
        direction: 'forward',
      })}`,
    );
    const rows = result.data.result.flatMap((stream) => stream.values);
    values.push(...rows);
    windows.push({
      startAt: new Date(lower).toISOString(),
      endAt: new Date(upper).toISOString(),
      returned: rows.length,
      possiblyTruncated: rows.length >= 50,
    });
  }
  return {
    values,
    windows,
    possiblyTruncated: windows.some((window) => window.possiblyTruncated),
  };
}
const measuredStart =
  mode === 'preflight'
    ? start
    : start + Number(process.env.API_DIAGNOSTIC_WARMUP_SECONDS || 30) * 1000;
const range = {
  start: String(measuredStart * 1000000),
  end: String(end * 1000000),
};
const labels = await get(`${prefix}labels?${new URLSearchParams(range)}`);
for (const name of ['environment', 'service_name']) {
  if (!labels.data.includes(name))
    throw new Error(`Missing staging Loki label ${name}`);
}
for (const [name, expected] of [
  ['environment', 'staging'],
  ['service_name', 'api'],
]) {
  const values = await get(
    `${prefix}label/${name}/values?${new URLSearchParams(range)}`,
  );
  if (!values.data.includes(expected))
    throw new Error(`Missing staging Loki ${name}=${expected}`);
}
// Login/setup precede measured activity and can otherwise fill the entire sample.
const query = `{environment="staging",service_name="api"} |= "${runId}" != "${runId}-login-" != "${runId}-setup-"`;
if (mode === 'preflight') {
  await get(
    `${prefix}query_range?${new URLSearchParams({ ...range, query: '{environment="staging",service_name="api"}', limit: '1' })}`,
  );
  await get(
    `api/datasources/proxy/uid/${encodeURIComponent(tempo.uid)}/api/search?${new URLSearchParams({ tags: 'service.name=hey-hey-api', start: String(Math.floor(start / 1000)), end: String(Math.ceil(end / 1000)), limit: '1' })}`,
  );
  console.log(
    JSON.stringify({
      kind: 'read-only-evidence-preflight',
      loki: loki.uid,
      tempo: tempo.uid,
      accessVerified: true,
    }),
  );
  process.exit(0);
}
const result = await get(
  `${prefix}query_range?${new URLSearchParams({ ...range, query, limit: '50', direction: 'forward' })}`,
);
const fields = [
  'requestId',
  'correlationId',
  'traceId',
  'spanId',
  'durationMs',
  'responseTimeMs',
  'elapsedMs',
  'totalElapsedMs',
  'operationIndex',
  'relatedEntityCount',
  'featureHierarchyCount',
  'level',
];
function safeLogEntry([timestamp, line]) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return { timestamp };
  }
  const safe = { timestamp };
  if (typeof record.traceSampled === 'boolean')
    safe.traceSampled = record.traceSampled;
  for (const key of fields) {
    const value = record[key] ?? record.metadata?.[key];
    if (
      typeof value === 'number' ||
      (typeof value === 'string' && value.length <= 160)
    )
      safe[key] = value;
  }
  const kind = record.operationKind;
  if (
    /^(workItem\.(create|update|delete)|section\.(replace|clear)|layout\.(replace|clear)|relationship\.(create|update|delete))$/.test(
      kind,
    )
  )
    safe.operationKind = kind;
  if (['completed', 'failed'].includes(record.outcome))
    safe.outcome = record.outcome;
  if (typeof record.alreadySatisfied === 'boolean')
    safe.alreadySatisfied = record.alreadySatisfied;
  if (record.phaseMs && typeof record.phaseMs === 'object') {
    safe.phaseMs = Object.fromEntries(
      Object.entries(record.phaseMs).filter(
        ([name, value]) =>
          /^proposal\.change_set\.checkpoint\.(renew|applying|precheck|mutation|postcheck|completed|failed)$/.test(
            name,
          ) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0,
      ),
    );
  }
  return safe;
}
const entries = result.data.result.flatMap((stream) =>
  stream.values.map(safeLogEntry),
);
const logSamplePossiblyTruncated = entries.length === 50;
const requestSelection = process.env.API_DIAGNOSTIC_RAW_METRICS
  ? await selectDiagnosticRequests(
      process.env.API_DIAGNOSTIC_RAW_METRICS,
      runId,
      measuredStart,
      end,
    )
  : { selected: [], gap: 'Raw request mapping unavailable' };
const targetedRequests = [];
for (const request of requestSelection.selected) {
  const targetedQuery = `{environment="staging",service_name="api"} |= "${request.requestId}"`;
  const targeted = await get(
    `${prefix}query_range?${new URLSearchParams({
      start: String(
        Math.max(measuredStart, Date.parse(request.startedAt) - 2000) * 1000000,
      ),
      end: String(Math.min(end, Date.parse(request.endedAt) + 2000) * 1000000),
      query: targetedQuery,
      limit: '50',
      direction: 'forward',
    })}`,
  );
  const logs = targeted.data.result.flatMap((s) => s.values.map(safeLogEntry));
  targetedRequests.push({
    ...request,
    query: targetedQuery,
    entries: logs,
    possiblyTruncated: logs.length === 50,
    gap: logs.length ? undefined : 'No matching request logs',
  });
  entries.unshift(...logs);
}
if (mode === 'tempo') {
  // Slowest overall requests can all be unsampled. Supplement them with a
  // bounded sample of slow HTTP completions known to have been sampled.
  const sampledSlowQuery = `${query} | json | traceSampled = "true" | responseTimeMs >= 300`;
  const sampledSlowLogs = await windowedLogs(
    sampledSlowQuery,
    measuredStart,
    end,
  );
  const sampledSlowEntries = sampledSlowLogs.values.map(safeLogEntry);
  entries.push(...sampledSlowEntries);
  const volumeQuery = new URLSearchParams({
    tags: 'service.name=hey-hey-api',
    start: String(Math.floor(measuredStart / 1000)),
    end: String(Math.ceil(end / 1000)),
    limit: '50',
  });
  const volume = await get(
    `api/datasources/proxy/uid/${encodeURIComponent(tempo.uid)}/api/search?${volumeQuery}`,
  );
  // Sampling means many log trace IDs were never exported. Find exported IDs
  // in this window, then establish diagnostic ownership in Loki before export.
  const exportedIds = volume.traces
    .map((trace) => trace.traceID)
    .filter((id) => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id));
  if (exportedIds.length) {
    const correlated = await get(
      `${prefix}query_range?${new URLSearchParams({ ...range, query: `${query} |~ "${exportedIds.join('|')}"`, limit: '50', direction: 'forward' })}`,
    );
    for (const stream of correlated.data.result) {
      for (const [, line] of stream.values) {
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        const traceId = record.traceId ?? record.metadata?.traceId;
        if (exportedIds.includes(traceId)) entries.push({ traceId });
      }
    }
  }
  const traceIds = [
    ...new Set(
      entries
        .map((entry) => entry.traceId)
        .filter((id) => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id)),
    ),
  ];
  const knownUnsampled = new Set(
    entries
      .filter((entry) => entry.traceSampled === false)
      .map((entry) => entry.traceId),
  );
  const knownSampled = new Set(
    entries
      .filter((entry) => entry.traceSampled === true)
      .map((entry) => entry.traceId),
  );
  const exported = new Set(exportedIds);
  // Keep targeted slow/error requests first within each priority. Older logs
  // without sampling flags remain eligible, but cannot exhaust the budget
  // before known sampled/exported traces are attempted.
  const eligibleTraceIds = traceIds.filter(
    (id) => !knownUnsampled.has(id) || knownSampled.has(id) || exported.has(id),
  );
  eligibleTraceIds.sort(
    (a, b) =>
      Number(knownSampled.has(b) || exported.has(b)) -
      Number(knownSampled.has(a) || exported.has(a)),
  );
  const traces = [];
  const failures = [];
  const traceLimit = 30;
  for (const traceId of eligibleTraceIds.slice(0, traceLimit)) {
    try {
      const trace = await get(
        `api/datasources/proxy/uid/${encodeURIComponent(tempo.uid)}/api/traces/${traceId}`,
      );
      traces.push({
        traceId,
        spans: safeTraceSpans(trace),
        coverage: traceCoverage(safeTraceSpans(trace)),
      });
    } catch (error) {
      failures.push({
        traceId,
        status: error.status,
        error: error.message,
        sampling: knownSampled.has(traceId) ? 'sampled' : 'unknown',
        previouslyFoundInTempo: exported.has(traceId),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        kind: 'correlated-tempo-sample',
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        query,
        datasourceUid: tempo.uid,
        logLimit: 50,
        possiblyTruncated: logSamplePossiblyTruncated,
        windowSearch: {
          query: 'service.name=hey-hey-api',
          limit: 50,
          returnedTraceCount: volume.traces.length,
          possiblyTruncated: volume.traces.length === 50,
        },
        traceCount: traces.length,
        traceLimit,
        omittedTraceCount: Math.max(0, eligibleTraceIds.length - traceLimit),
        unsampledTraceIds: traceIds.filter(
          (id) => !eligibleTraceIds.includes(id),
        ),
        samplingCoverage:
          'Unsampled requests have no recorded spans; sampled flags do not guarantee successful export. Older logs without flags have unknown sampling status.',
        sampledSlowRequestSample: {
          query: sampledSlowQuery,
          minimumResponseTimeMs: 300,
          limit: 50,
          possiblyTruncated: sampledSlowLogs.possiblyTruncated,
          windows: sampledSlowLogs.windows,
          entries: sampledSlowEntries,
        },
        traces,
        failures,
        requestSelection,
        targetedRequests,
      },
      null,
      2,
    ),
  );
  // A bounded sample can include log IDs absent from Tempo. Preserve those
  // gaps; fail collection when no trace was recovered or a read actually failed.
  if (!traces.length || failures.some((failure) => failure.status !== 404))
    process.exitCode = 1;
  if (!traceIds.length)
    console.error(
      'No trace IDs in the bounded correlated Loki sample; trace retention is unknown',
    );
}
if (mode === 'api') {
  const checkpointQuery = `${query} |= "Generic checkpoint timing"`;
  const processQuery =
    '{environment="staging",service_name="api"} |= "API diagnostic process interval"';
  const profileQuery =
    '{environment="staging",service_name="api"} |= "API diagnostic CPU profile"';
  const [checkpointLogs, processLogs, profileLogs] = await Promise.all(
    [checkpointQuery, processQuery, profileQuery].map((q) =>
      windowedLogs(q, measuredStart, end),
    ),
  );
  const checkpointTimings = checkpointLogs.values.map(safeLogEntry);
  const processIntervals = processLogs.values.map(([timestamp, line]) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return { timestamp };
    }
    const safe = { timestamp };
    for (const key of [
      'elapsedMs',
      'cpuUserMs',
      'cpuSystemMs',
      'cpuCoreUtilization',
      'eventLoopUtilization',
      'eventLoopDelaySampleCount',
      'eventLoopDelayP50Ms',
      'eventLoopDelayP99Ms',
      'eventLoopDelayMaxMs',
      'gcCount',
      'gcDurationMs',
      'gcMaxMs',
    ]) {
      if (
        typeof record[key] === 'number' &&
        Number.isFinite(record[key]) &&
        record[key] >= 0
      )
        safe[key] = record[key];
    }
    for (const key of ['intervalStartUtc', 'intervalEndUtc']) {
      if (
        typeof record[key] === 'string' &&
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(record[key])
      )
        safe[key] = record[key];
    }
    if (typeof record.profilingEnabled === 'boolean')
      safe.profilingEnabled = record.profilingEnabled;
    return safe;
  });
  const profiles = profileLogs.values.map(([timestamp, line]) => {
    const safe = { timestamp };
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return safe;
    }
    if (record.message === 'API diagnostic CPU profile unavailable') {
      return { timestamp, unavailable: true };
    }
    for (const key of [
      'sampleCount',
      'profileDurationMs',
      'samplingIntervalUs',
      'omittedSamples',
    ]) {
      if (
        typeof record[key] === 'number' &&
        Number.isFinite(record[key]) &&
        record[key] >= 0
      )
        safe[key] = record[key];
    }
    for (const key of ['intervalStartUtc', 'intervalEndUtc']) {
      if (
        typeof record[key] === 'string' &&
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(record[key])
      )
        safe[key] = record[key];
    }
    if (Array.isArray(record.topFrames))
      safe.topFrames = record.topFrames
        .slice(0, 20)
        .filter(
          (frame) =>
            typeof frame.location === 'string' &&
            frame.location.length <= 250 &&
            /^(?:(?:dist|node_modules)\/[A-Za-z0-9_./@+-]+:\d+|\[(?:unattributed)\]|\((?:idle|garbage collector|program|root)\))$/.test(
              frame.location,
            ) &&
            Number.isInteger(frame.samples) &&
            frame.samples >= 0,
        )
        .map(({ location, samples }) => ({ location, samples }));
    return safe;
  });
  console.log(
    JSON.stringify(
      {
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        query,
        datasourceUid: loki.uid,
        limit: 50,
        possiblyTruncated: entries.length === 50,
        entries,
        requestSelection,
        targetedRequests,
        checkpointTimingSample: {
          query: checkpointQuery,
          limit: 50,
          possiblyTruncated: checkpointLogs.possiblyTruncated,
          windows: checkpointLogs.windows,
          entries: checkpointTimings,
        },
        processIntervalSample: {
          query: processQuery,
          limit: 50,
          possiblyTruncated: processLogs.possiblyTruncated,
          windows: processLogs.windows,
          entries: processIntervals,
        },
        cpuProfileSample: {
          query: profileQuery,
          limit: 50,
          windows: profileLogs.windows,
          possiblyTruncated: profileLogs.possiblyTruncated,
          entries: profiles,
          gap: profiles.some((profile) => profile.sampleCount > 0)
            ? undefined
            : 'No CPU profile samples recovered; profiling may be disabled, unavailable or not yet emitted.',
          coverage:
            'Opt-in main-isolate sampled stacks, not per-request CPU. Profiles cross interval boundaries; final in-progress window may be absent. Profiling overhead is included in process/container counters; compare matching profiling modes.',
        },
      },
      null,
      2,
    ),
  );
  if (entries.length === 0)
    throw new Error('No correlated API evidence in the measured window');
}
