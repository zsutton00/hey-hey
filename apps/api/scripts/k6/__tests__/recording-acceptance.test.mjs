import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptRuntimeRecording,
  acceptDatabasePlans,
  acceptCollectors,
  diagnosticStatus,
  validateCpuProfile,
  acceptResourceCounters,
} from '../recording-acceptance.mjs';
import { smokeRecording } from '../staging-recording-client.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const window = {
  startAt: '2026-10-14T12:00:01Z',
  endAt: '2026-10-14T12:00:30Z',
};
const profile = {
  startTime: 1,
  endTime: 30000001,
  nodes: [
    { id: 1, callFrame: {}, children: [2] },
    { id: 2, callFrame: {}, children: [] },
  ],
  samples: [2, 1, 2],
  timeDeltas: [10000, 10000, 10000],
};
function recording() {
  const jvm = {
    startedAt: '2026-10-14T12:00:00Z',
    endedAt: '2026-10-14T12:00:31Z',
    maximumSeconds: 60,
    process: { pid: 1 },
    enabledEvents: ['jdk.ExecutionSample'],
    eventCounts: { 'jdk.ExecutionSample': 1 },
    events: [
      {
        type: 'jdk.ExecutionSample',
        values: { stackTrace: { frames: [{ className: 'Example' }] } },
      },
    ],
  };
  return {
    schemaVersion: 1,
    startedAt: '2026-10-14T12:00:00Z',
    endedAt: '2026-10-14T12:00:31Z',
    identities: Object.fromEntries(
      ['api', 'graph-service', 'embeddings', 'postgres', 'neo4j', 'vespa'].map(
        (s) => [
          s,
          {
            containerId: s,
            imageId: 'image',
            hostPid: 100,
            startedAt: '2026-10-14T11:00:00Z',
          },
        ],
      ),
    ),
    collectors: {
      api: {
        complete: true,
        data: {
          profiles: [
            {
              pid: 1,
              intervalStartUtc: '2026-10-14T12:00:00Z',
              intervalEndUtc: '2026-10-14T12:00:31Z',
              profile: structuredClone(profile),
            },
          ],
        },
      },
      'graph-service': { complete: true, data: structuredClone(jvm) },
      neo4j: { complete: true, data: structuredClone(jvm) },
      embeddings: {
        complete: true,
        data: {
          startedAt: jvm.startedAt,
          endedAt: jvm.endedAt,
          maximumSeconds: 60,
          processes: [{ pid: 5 }, { pid: 6 }],
          profiles: [5, 6].map((pid) => ({
            pid,
            speedscope: { profiles: [{ samples: [[0]] }] },
          })),
        },
      },
    },
  };
}
function plans() {
  return {
    collectors: {
      postgres: {
        complete: true,
        data: {
          selectedExpensive: [{ queryid: '100', mapped: true }],
          entries: [
            {
              ownerOperation: 'task.read',
              source: 'task.service',
              startedAt: window.startAt,
              endedAt: window.endAt,
              fingerprints: [{ queryid: '100' }],
              targetedPlan: [{ Plan: { 'Node Type': 'Index Scan' } }],
              inSituPlans: [{ Plan: { 'Node Type': 'Index Scan' } }],
            },
          ],
        },
      },
    },
  };
}
test('complete artifact coverage is independent of workload success', () => {
  assert.equal(acceptRuntimeRecording(recording(), window).complete, true);
  assert.equal(acceptDatabasePlans(plans()).complete, true);
  assert.equal(diagnosticStatus(true, { complete: true }), 'completed');
  assert.equal(diagnosticStatus(false, { complete: true }), 'failed');
  assert.equal(
    diagnosticStatus(true, { complete: false }),
    'recording-incomplete',
  );
});
test('quiet JVM native sample stacks demonstrate recording without Java execution samples', () => {
  const r = recording();
  const graph = r.collectors['graph-service'].data;
  graph.enabledEvents = ['jdk.ExecutionSample', 'jdk.NativeMethodSample'];
  graph.eventCounts = {
    'jdk.ExecutionSample': 0,
    'jdk.NativeMethodSample': 2000,
  };
  graph.events = [
    {
      type: 'jdk.NativeMethodSample',
      values: {
        stackTrace: {
          frames: [{ className: 'java.net.Socket', methodName: 'read' }],
        },
      },
    },
  ];
  assert.equal(acceptRuntimeRecording(r, window).complete, true);
  graph.events[0].values.stackTrace.frames = [];
  assert.equal(acceptRuntimeRecording(r, window).complete, false);
  graph.events = [
    { type: 'jdk.ThreadPark', values: { stackTrace: { frames: [{}] } } },
  ];
  assert.equal(acceptRuntimeRecording(r, window).complete, false);
});
test('flat counts, missing final window and missing worker coverage fail acceptance', () => {
  const r = recording();
  r.collectors.api.data.profiles[0].profile = { topFrames: [{ samples: 100 }] };
  r.collectors.api.data.profiles[0].intervalEndUtc = '2026-10-14T12:00:20Z';
  r.collectors.embeddings.data.profiles.pop();
  const result = acceptRuntimeRecording(r, window);
  assert.equal(result.complete, false);
  assert.match(result.failures.join(';'), /samples\/timing/);
  assert.match(result.failures.join(';'), /final measured window/);
  assert.match(result.failures.join(';'), /worker stack coverage/);
});
test('dangling samples, disconnected nodes and cyclic relationships fail at artifact boundary', () => {
  const dangling = structuredClone(profile);
  dangling.samples.push(99);
  dangling.timeDeltas.push(100);
  assert.match(validateCpuProfile(dangling), /references/);
  const disconnected = structuredClone(profile);
  disconnected.nodes.push({ id: 3, callFrame: {} });
  assert.match(validateCpuProfile(disconnected), /root/);
  const cycle = structuredClone(profile);
  cycle.nodes[1].children.push(1);
  assert.match(validateCpuProfile(cycle), /root/);
});
test('configuration alone and auto-expired recordings cannot admit full load', () => {
  const r = recording();
  r.collectors['graph-service'].data.maximumSeconds = 10;
  assert.match(
    acceptRuntimeRecording(r, window).failures.join(';'),
    /requested window/,
  );
  delete r.collectors.neo4j.data.events;
  assert.match(
    acceptRuntimeRecording(r, window).failures.join(';'),
    /execution stacks/,
  );
});
test('database plan acceptance requires PostgreSQL only; Neo4j runtime evidence remains separately required', () => {
  const p = plans();
  assert.equal('neo4j' in p.collectors, false);
  assert.equal(acceptDatabasePlans(p).complete, true);
  delete p.collectors.postgres;
  assert.equal(acceptDatabasePlans(p).complete, false);
});
test('unmapped selected expensive SQL fails', () => {
  const p = plans();
  p.collectors.postgres.data.selectedExpensive[0].mapped = false;
  assert.match(acceptDatabasePlans(p).failures.join(';'), /unmapped/);
});
test('failed and unparsable required collectors retain partial evidence but fail completion', () => {
  const evidence = Object.fromEntries(
    [
      'api',
      'graph',
      'embeddings',
      'database',
      'traceVolume',
      'droppedTelemetry',
    ].map((n) => [n, { succeeded: true, outputRecorded: true }]),
  );
  evidence.graph.parseError = 'invalid JSON';
  const result = acceptCollectors({
    evidence,
    cpu: { measuredSamples: 2, errors: [] },
    postgresWaits: { samples: 2, errors: [] },
    snapshots: [{ available: true }, { available: true }, { available: false }],
    runtime: recording(),
    plans: plans(),
    window,
  });
  assert.equal(result.complete, false);
  assert.match(result.failures.join(';'), /graph: required collector/);
  assert.match(result.failures.join(';'), /snapshots incomplete/);
  assert.equal(evidence.embeddings.outputRecorded, true);
});

test('six-service demand and parent throttling require cumulative counter coverage', () => {
  const counter = {
    samples: 1,
    intervals: [{ delta: { usage_usec: 100, throttled_usec: 2 } }],
    gaps: [],
  };
  const cpu = {
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
        ].map((name) => [
          `hey-hey-staging-${name}-1`,
          structuredClone(counter),
        ]),
      ),
      slice: structuredClone(counter),
    },
  };
  assert.equal(acceptResourceCounters(cpu).complete, true);
  delete cpu.measuredCounters.containers['hey-hey-staging-vespa-1'];
  cpu.measuredCounters.slice.gaps.push({ reason: 'reset' });
  assert.match(acceptResourceCounters(cpu).failures.join(';'), /vespa/);
  assert.match(acceptResourceCounters(cpu).failures.join(';'), /slice/);
});

test('unavailable recorder stops smoke admission, keeps exact failure and always cleans up', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.recording-test-'));
  const commands = [];
  try {
    const client = {
      async command(action) {
        commands.push(action);
        return action === 'recording-start'
          ? {
              collectors: {
                'graph-service': {
                  started: false,
                  error: 'Graph jcmd unavailable',
                },
              },
            }
          : { cleaned: true };
      },
    };
    const result = await smokeRecording(client, directory, 'smoke-test');
    assert.equal(result.complete, false);
    assert.equal(result.noBenchmarkRan, true);
    assert.deepEqual(commands, ['recording-start', 'recording-cleanup']);
    assert.match(result.failures[0], /Graph jcmd unavailable/);
    const path = join(directory, 'recording-acceptance.json');
    assert.equal(JSON.parse(readFileSync(path)).complete, false);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
