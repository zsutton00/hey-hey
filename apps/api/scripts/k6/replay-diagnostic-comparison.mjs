// Offline replay: node scripts/k6/replay-diagnostic-comparison.mjs CURRENT PRIOR...
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  summarizeCounters,
  counterIntervals,
} from './cpu-counter-analysis.mjs';

function readRun(directory) {
  const manifest = JSON.parse(
    readFileSync(join(directory, 'run-manifest.json')),
  );
  const step = manifest.steps.find((s) => s.vus === 50);
  const run = step?.runs.find((r) => r.status === 'completed');
  if (!run || manifest.status !== 'completed')
    throw new Error('Only completed 50-user runs can be compared');
  const envelopePath = join(directory, 'resource-envelope-before.json');
  const envelope = existsSync(envelopePath)
    ? JSON.parse(readFileSync(envelopePath)).evidence
    : readFileSync(join(directory, 'cap-and-images.txt'), 'utf8');
  const cpu = envelope.match(/CPUQuotaPerSecUSec=(\d+)s/);
  const memory = envelope.match(/MemoryMax=(\d+)/);
  if (!cpu || !memory) throw new Error('Verified resource envelope absent');
  const samples = readFileSync(
    join(directory, 'users-050/run-01/cpu-samples.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const selected = samples.filter(
    (s) =>
      s.phase === 'activity' &&
      Date.parse(s.startedAt) >=
        Date.parse(run.startedAt) + manifest.load.warmupSeconds * 1000 &&
      Date.parse(s.endedAt) <= Date.parse(run.endedAt),
  );
  const peaks = Object.fromEntries(
    Object.keys(run.cpu.measured).map((name) => {
      const peak = selected.reduce((best, s) => {
        const value = s.containers.find(
          (c) => c.name === `hey-hey-staging-${name}-1`,
        )?.cpuPercent;
        return value !== undefined && (!best || value > best.cpuPercent)
          ? { cpuPercent: value, startedAt: s.startedAt, endedAt: s.endedAt }
          : best;
      }, null);
      return [name, peak];
    }),
  );
  const historical = selected.every((s) => !s.resources);
  const legacy = historical
    ? counterIntervals(
        selected,
        (s) =>
          s.neo4jCpuCounters && {
            identity: 'legacy-neo4j',
            startedAtNs: String(BigInt(Date.parse(s.endedAt)) * 1000000n),
            cpu: s.neo4jCpuCounters,
            processes: [],
            clockTicks: 100,
          },
      )
    : null;
  return {
    directory,
    manifest,
    cpu: Number(cpu[1]),
    memory: Number(memory[1]),
    result: {
      runId: manifest.runId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      outcomes: run.analysis,
      snapshotCpu: run.cpu,
      peaks,
      counters: historical ? null : summarizeCounters(selected),
      historicalNeo4jCounters: legacy,
      counterCaveat: historical
        ? 'Approximate end timestamps; includes in-container cypher-shell overhead. Not server-only demand and not comparable to collector-v2 process CPU.'
        : null,
      images: Object.fromEntries(
        envelope.split('\n').flatMap((line) => {
          const name = line.match(/^\/(hey-hey-staging-[\w-]+)/)?.[1];
          const digest = line.match(/sha256:[a-f0-9]{64}/)?.[0];
          return name && digest ? [[name, digest]] : [];
        }),
      ),
    },
  };
}

export function comparable(a, b) {
  const x = a.manifest,
    y = b.manifest;
  const fields = [
    'fixtureVersion',
    'contentHash',
    'distributionVersion',
    'projectCount',
  ];
  const assignmentFields = [
    'userIndex',
    'userId',
    'projectId',
    'scratchTaskId',
    'agentSessionId',
    'conversationId',
  ];
  return (
    a.cpu === b.cpu &&
    a.memory === b.memory &&
    ['duration', 'repetitions', 'warmupSeconds'].every(
      (key) => x.load[key] === y.load[key],
    ) &&
    fields.every((key) => x.fixture[key] === y.fixture[key]) &&
    x.mix.mixVersion === y.mix.mixVersion &&
    x.mix.searchesPerMinute === y.mix.searchesPerMinute &&
    ['actions', 'searchActions'].every(
      (group) =>
        Object.keys(x.mix[group]).length === Object.keys(y.mix[group]).length &&
        Object.entries(x.mix[group]).every(
          ([key, value]) => y.mix[group][key] === value,
        ),
    ) &&
    Object.keys(x.mix.cohorts).length === Object.keys(y.mix.cohorts).length &&
    Object.entries(x.mix.cohorts).every(([key, value]) => {
      const other = y.mix.cohorts[key];
      return (
        other &&
        value.requestsPerMinute === other.requestsPerMinute &&
        value.everyNthUser === other.everyNthUser &&
        [
          'requestsPerMinute',
          'durationSeconds',
          'periodSeconds',
          'firstAtSeconds',
        ].every((field) => value.burst?.[field] === other.burst?.[field])
      );
    }) &&
    x.fixture.assignments.length === y.fixture.assignments.length &&
    x.fixture.assignments.every((assignment, i) =>
      assignmentFields.every(
        (key) => assignment[key] === y.fixture.assignments[i][key],
      ),
    )
  );
}

export function replayComparison(currentDirectory, candidates) {
  const current = readRun(currentDirectory);
  const eligible = candidates
    .map(readRun)
    .filter(
      (prior) =>
        comparable(current, prior) &&
        Date.parse(prior.result.startedAt) <
          Date.parse(current.result.startedAt),
    )
    .sort(
      (a, b) => Date.parse(a.result.startedAt) - Date.parse(b.result.startedAt),
    );
  const previous = eligible.at(-1);
  return {
    current: current.result,
    previous: previous?.result ?? null,
    firstBaseline: eligible[0]?.result ?? null,
    coverage:
      'Baseline selection is limited to supplied completed candidate directories.',
    deploymentChanges: previous
      ? Object.keys(current.result.images).filter(
          (name) =>
            current.result.images[name] !== previous.result.images[name],
        )
      : [],
    caveats: [
      'Fixed workload does not isolate deployment changes or cache/background state.',
      'Snapshots and cumulative counters are separate measurement series.',
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify(
      replayComparison(process.argv[2], process.argv.slice(3)),
      null,
      2,
    ),
  );
}
