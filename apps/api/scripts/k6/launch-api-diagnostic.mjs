import { prepareDistributedFixture } from './distributed-activity-fixture.mjs';
// Steps simulated users up through ACTIVITY_VU_STEPS against the persistent
// activity fixture, repeating each step, and writes raw measurements plus a
// readable report. Tracing is only verified (read-only); it is never toggled.
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { spawnSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { startCpuSampling } from './staging-cpu-sampling.mjs';
import { startPostgresSampling } from './staging-postgres-sampling.mjs';
import {
  capturePostgresStatements,
  comparePostgresStatements,
} from './staging-postgres-statements.mjs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  recordingClient,
  smokeRecording,
} from './staging-recording-client.mjs';
import { acceptCollectors, diagnosticStatus } from './recording-acceptance.mjs';
import {
  readAuthUsers,
  seedActivityFixture,
} from './seed-activity-fixture.mjs';

// One-off observations may use one run; daily comparisons still request two.
const MIN_REPETITIONS = 1;
const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const scenarioPath = resolve(
  repositoryRoot,
  'scripts/k6/activity-api-diagnostic.js',
);
// Each mix version is its own comparison series; v1 stays the default so
// the original baseline remains reproducible.
const mixPath = resolve(
  repositoryRoot,
  process.env.ACTIVITY_MIX_FILE?.trim() || 'scripts/k6/activity-mix.json',
);
const EVIDENCE_NAMES = [
  'api',
  'graph',
  'embeddings',
  'database',
  'container',
  'traceVolume',
  'droppedTelemetry',
];
const EVIDENCE_VARIABLES = {
  api: 'API_DIAGNOSTIC_API_EVIDENCE_COMMAND',
  graph: 'API_DIAGNOSTIC_GRAPH_EVIDENCE_COMMAND',
  embeddings: 'API_DIAGNOSTIC_EMBEDDINGS_EVIDENCE_COMMAND',
  database: 'API_DIAGNOSTIC_DATABASE_EVIDENCE_COMMAND',
  container: 'API_DIAGNOSTIC_CONTAINER_EVIDENCE_COMMAND',
  traceVolume: 'API_DIAGNOSTIC_TRACE_VOLUME_EVIDENCE_COMMAND',
  droppedTelemetry: 'API_DIAGNOSTIC_DROPPED_TELEMETRY_EVIDENCE_COMMAND',
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function integer(name, fallback, minimum) {
  const value = Number(optional(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function vuSteps() {
  const steps = optional('ACTIVITY_VU_STEPS', '5,10,25,50')
    .split(',')
    .map((step) => Number(step.trim()));
  if (steps.some((step) => !Number.isInteger(step) || step <= 0)) {
    throw new Error(
      'ACTIVITY_VU_STEPS must be a comma-separated list of positive integers',
    );
  }
  return steps;
}

// Same deployment-context inputs as run-api-diagnostic.mjs, so the staging
// wrapper drives this launcher without new configuration.
function readDeploymentContext() {
  const file = process.env.API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_FILE?.trim();
  const command = process.env.API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND?.trim();
  let raw;
  if (file) raw = readFileSync(file, 'utf8');
  else if (command) {
    const result = spawnSync('/bin/sh', ['-c', command], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0 || result.signal) {
      throw new Error(
        `API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND failed (status=${result.status ?? 'unknown'})`,
      );
    }
    raw = result.stdout;
  } else return undefined;
  const context = JSON.parse(raw);
  if (context?.schemaVersion !== 1) {
    throw new Error('Deployment context has an unsupported shape');
  }
  return context;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function run(command, args, environment, directory, name) {
  const stdoutPath = join(directory, `${name}.stdout.log`);
  const stderrPath = join(directory, `${name}.stderr.log`);
  const stdout = openSync(stdoutPath, 'w', 0o600);
  const stderr = openSync(stderrPath, 'w', 0o600);
  try {
    const result = await new Promise((done) => {
      const child = spawn(command, args, {
        cwd: repositoryRoot,
        env: environment,
        stdio: ['ignore', stdout, stderr],
      });
      child.once('error', (error) =>
        done({ error, status: null, signal: null }),
      );
      child.once('close', (status, signal) => done({ status, signal }));
    });
    return {
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
      stdoutPath,
      stderrPath,
      succeeded: result.status === 0 && result.signal === null && !result.error,
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function stats(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return undefined;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    count: finite.length,
    min: sorted[0],
    median: percentile(sorted, 50),
    mean,
    max: sorted[sorted.length - 1],
    standardDeviation: Math.sqrt(variance),
  };
}

// Reads the raw k6 point stream and summarizes measured actions after the
// warm-up window. Latency is summarized for successful actions only;
// rejected, failed, and incorrect responses are counted by cause.
async function analyzeRawMetrics(path, warmupSeconds) {
  const latencies = new Map();
  const outcomes = new Map();
  const cohorts = {};
  const cohort = (name) =>
    (cohorts[name] ??= { offered: 0, missed: 0, completed: 0, ok: 0 });
  let firstAt;
  let lastAt;
  let reauthentications = 0;
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.includes('"Point"') || !line.includes('activity_')) continue;
    const point = JSON.parse(line);
    const at = Date.parse(point.data.time) / 1000;
    if (point.metric === 'activity_reauthentications') {
      reauthentications += point.data.value;
      continue;
    }
    firstAt ??= at;
    if (at - firstAt < warmupSeconds) continue;
    lastAt = at;
    const tags = point.data.tags;
    if (point.metric === 'activity_action_latency' && tags.outcome === 'ok') {
      if (!latencies.has(tags.action)) latencies.set(tags.action, []);
      latencies.get(tags.action).push(point.data.value);
    }
    if (point.metric === 'activity_offered') {
      cohort(tags.cohort).offered += point.data.value;
      continue;
    }
    if (point.metric === 'activity_missed') {
      cohort(tags.cohort).missed += point.data.value;
      continue;
    }
    if (point.metric === 'activity_actions') {
      cohort(tags.cohort).completed += point.data.value;
      if (tags.outcome === 'ok') cohort(tags.cohort).ok += point.data.value;
      const key = `${tags.action}|${tags.outcome}|${tags.status}|${tags.code}`;
      outcomes.set(key, (outcomes.get(key) ?? 0) + point.data.value);
    }
  }
  const windowSeconds =
    firstAt === undefined || lastAt === undefined
      ? 0
      : lastAt - firstAt - warmupSeconds;
  const actions = {};
  const causes = [];
  for (const [key, count] of outcomes) {
    const [action, outcome, status, code] = key.split('|');
    actions[action] ??= { ok: 0, rejected: 0, error: 0, incorrect: 0 };
    actions[action][outcome] += count;
    if (outcome !== 'ok') causes.push({ action, outcome, status, code, count });
  }
  for (const [action, values] of latencies) {
    const sorted = [...values].sort((a, b) => a - b);
    Object.assign(actions[action], {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1],
      okPerSecond:
        windowSeconds > 0 ? sorted.length / windowSeconds : undefined,
    });
  }
  const totals = Object.values(actions).reduce(
    (sum, action) => ({
      ok: sum.ok + action.ok,
      rejected: sum.rejected + action.rejected,
      error: sum.error + action.error,
      incorrect: sum.incorrect + action.incorrect,
    }),
    { ok: 0, rejected: 0, error: 0, incorrect: 0 },
  );
  return {
    windowSeconds,
    reauthentications,
    totals: {
      ...totals,
      okPerSecond: windowSeconds > 0 ? totals.ok / windowSeconds : undefined,
      offeredPerSecond:
        windowSeconds > 0
          ? (totals.ok + totals.rejected + totals.error + totals.incorrect) /
            windowSeconds
          : undefined,
    },
    actions,
    cohorts: Object.fromEntries(
      Object.entries(cohorts).map(([name, c]) => [
        name,
        {
          ...c,
          offeredPerSecond:
            windowSeconds > 0 ? c.offered / windowSeconds : undefined,
          completedPerSecond:
            windowSeconds > 0 ? c.completed / windowSeconds : undefined,
        },
      ]),
    ),
    causes: causes.sort((a, b) => b.count - a.count),
  };
}

function aggregateStep(runs) {
  const measured = runs.filter((r) => r.analysis);
  const actionNames = new Set(
    measured.flatMap((r) => Object.keys(r.analysis.actions)),
  );
  const actions = {};
  for (const action of actionNames) {
    const per = measured.map((r) => r.analysis.actions[action]).filter(Boolean);
    actions[action] = {
      p50: stats(per.map((a) => a.p50)),
      p95: stats(per.map((a) => a.p95)),
      p99: stats(per.map((a) => a.p99)),
      okPerSecond: stats(per.map((a) => a.okPerSecond)),
      ok: per.reduce((s, a) => s + a.ok, 0),
      rejected: per.reduce((s, a) => s + a.rejected, 0),
      error: per.reduce((s, a) => s + a.error, 0),
      incorrect: per.reduce((s, a) => s + a.incorrect, 0),
    };
  }
  const cohortNames = new Set(
    measured.flatMap((r) => Object.keys(r.analysis.cohorts ?? {})),
  );
  const cohorts = Object.fromEntries(
    [...cohortNames].map((name) => {
      const per = measured
        .map((r) => r.analysis.cohorts?.[name])
        .filter(Boolean);
      return [
        name,
        {
          offeredPerSecond: stats(per.map((c) => c.offeredPerSecond)),
          completedPerSecond: stats(per.map((c) => c.completedPerSecond)),
          missed: per.reduce((s, c) => s + c.missed, 0),
        },
      ];
    }),
  );
  return {
    cohorts,
    completedRuns: runs.filter((r) => r.status === 'completed').length,
    repetitions: runs.length,
    okPerSecond: stats(measured.map((r) => r.analysis.totals.okPerSecond)),
    offeredPerSecond: stats(
      measured.map((r) => r.analysis.totals.offeredPerSecond),
    ),
    actions,
  };
}

function ms(value) {
  return Number.isFinite(value) ? `${Math.round(value)}` : '–';
}

function renderReport(manifest) {
  const lines = [
    `# Activity diagnostic ${manifest.runId}`,
    '',
    `- Build \`${manifest.buildId}\`, environment \`${manifest.environmentId}\`, configuration \`${manifest.configurationId}\``,
    ...(manifest.fixture
      ? [
          `- Fixture v${manifest.fixture.fixtureVersion} (\`${manifest.fixture.contentHash.slice(0, 12)}\`): ${manifest.fixture.features} features, ${manifest.fixture.tasks} tasks, ${manifest.fixture.edges.total} edges (hub ${manifest.fixture.edges.hub})`,
        ]
      : ['- Fixture setup failed; no benchmark ran.']),
    manifest.mix.cohorts
      ? `- Mix v${manifest.mix.mixVersion}: light ${manifest.mix.cohorts.light.requestsPerMinute} req/min; every ${manifest.mix.cohorts.heavy.everyNthUser}th user heavy with staggered ${manifest.mix.cohorts.heavy.burst.durationSeconds}s bursts at ${manifest.mix.cohorts.heavy.burst.requestsPerMinute} req/min every ${manifest.mix.cohorts.heavy.burst.periodSeconds}s; ${manifest.mix.searchesPerMinute} searches/min/user; duration ${manifest.load.duration} per run, first ${manifest.load.warmupSeconds}s excluded`
      : `- Mix v${manifest.mix.mixVersion}, think time ${manifest.mix.thinkTimeSeconds.min}–${manifest.mix.thinkTimeSeconds.max}s, duration ${manifest.load.duration} per run, first ${manifest.load.warmupSeconds}s excluded`,
    ...(manifest.mix.calibration
      ? [`- Calibration: ${manifest.mix.calibration}`]
      : []),
    `- Project distribution: ${manifest.fixture?.projectCount ?? 1} project(s)${manifest.fixture?.distributionVersion ? ', two users per project; separate distributed comparison series' : ''}`,
    `- Status: **${manifest.status}**`,
    '',
    '## Action mix',
    '',
    '| Action | Weight |',
    '| --- | --- |',
    ...Object.entries({
      ...manifest.mix.actions,
      ...manifest.mix.searchActions,
    }).map(([a, w]) => `| ${a} | ${w} |`),
    '',
  ];
  if (manifest.mix.searchActions) {
    lines.push(
      'Search actions fill scheduled search slots; other actions share the remaining slots by weight.',
      '',
    );
  }
  for (const step of manifest.steps) {
    const a = step.aggregate;
    if (a.completedRuns === 0) {
      lines.push(
        `## ${step.vus} users`,
        '',
        `No measured activity; ${manifest.load.repetitions} repetitions were planned.`,
        '',
      );
      continue;
    }
    const cohortRows = Object.entries(a.cohorts ?? {})
      .filter(([name]) => name !== 'uniform')
      .map(
        ([name, c]) =>
          `| ${name} | ${c.offeredPerSecond?.median?.toFixed(2) ?? '–'} | ${c.completedPerSecond?.median?.toFixed(2) ?? '–'} | ${c.missed} |`,
      );
    lines.push(
      `## ${step.vus} users (series \`${step.series}\`)`,
      '',
      ...(cohortRows.length > 0
        ? [
            'Offered counts every scheduled slot, including slots missed because earlier responses were slow.',
            '',
            '| Cohort | Offered req/s (median) | Completed req/s (median) | Missed slots (all runs) |',
            '| --- | --- | --- | --- |',
            ...cohortRows,
            '',
          ]
        : []),
      `${a.completedRuns}/${a.repetitions} runs completed. Successful actions/s median ${a.okPerSecond?.median?.toFixed(2) ?? '–'} (σ ${a.okPerSecond?.standardDeviation?.toFixed(2) ?? '–'}); offered actions/s median ${a.offeredPerSecond?.median?.toFixed(2) ?? '–'}.`,
      '',
      '| Action | p50 ms (median) | p95 ms (median) | p95 σ across runs | p99 ms (median) | ok | rejected | error | incorrect |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...Object.entries(a.actions)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(
          ([name, s]) =>
            `| ${name} | ${ms(s.p50?.median)} | ${ms(s.p95?.median)} | ${ms(s.p95?.standardDeviation)} | ${ms(s.p99?.median)} | ${s.ok} | ${s.rejected} | ${s.error} | ${s.incorrect} |`,
        ),
      '',
    );
    const cpuRuns = step.runs.filter((r) => r.cpu);
    if (cpuRuns.length > 0) {
      lines.push(
        'CPU during activity versus the pre-run baseline (100% = one logical core).',
        '',
        '| Run | Service | Baseline mean % | Activity mean % | Difference (points) | Activity p95 % | Activity max % | Samples |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const r of cpuRuns)
        for (const [service, measured] of Object.entries(r.cpu.measured)) {
          const baseline = r.cpu.baseline[service];
          const number = (value) =>
            Number.isFinite(value) ? value.toFixed(2) : '–';
          lines.push(
            `| ${r.repetition} | ${service} | ${number(baseline.mean)} | ${number(measured.mean)} | ${number(measured.mean - baseline.mean)} | ${number(measured.p95)} | ${number(measured.max)} | ${measured.samples} |`,
          );
        }
      lines.push(
        '',
        'CPU covers all container processes, including background work. Samples exclude the configured warm-up and are not per-request CPU attribution. Baseline means no diagnostic workload; other staging traffic may exist.',
        '',
      );
    }
    const causes = step.runs.flatMap((r) => r.analysis?.causes ?? []);
    if (causes.length > 0) {
      lines.push('Non-successful causes (all runs):', '');
      for (const c of causes.slice(0, 15)) {
        lines.push(
          `- ${c.action}: ${c.outcome} HTTP ${c.status} \`${c.code}\` × ${c.count}`,
        );
      }
      lines.push('');
    }
  }
  lines.push('## Coverage gaps', '');
  if (manifest.coverageGaps.length === 0) lines.push('- None recorded.');
  else manifest.coverageGaps.forEach((gap) => lines.push(`- ${gap}`));
  lines.push(
    '',
    'Rank a bottleneck only when it repeats across measured runs at a step and matches the preserved trace and service evidence.',
    '',
  );
  return lines.join('\n');
}

const deploymentContext = readDeploymentContext();
const operatorConfigPath = join(
  homedir(),
  '.config/hey-hey/staging-api-diagnostic.json',
);
const operatorConfig = existsSync(operatorConfigPath)
  ? JSON.parse(readFileSync(operatorConfigPath, 'utf8'))
  : {};
const cpuSshTarget =
  process.env.API_DIAGNOSTIC_SSH_TARGET?.trim() ||
  (deploymentContext?.deploymentEnvironment === 'staging'
    ? operatorConfig.sshTarget
    : undefined);
if (cpuSshTarget && deploymentContext?.deploymentEnvironment !== 'staging') {
  throw new Error('Staging CPU sampling requires a staging deployment context');
}
const runId = optional(
  'K6_RUN_ID',
  `activity-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`,
);
const identity = {
  buildId: deploymentContext?.buildId ?? required('K6_BUILD_ID'),
  baseUrl: deploymentContext?.baseUrl ?? required('K6_BASE_URL'),
  browserOrigin:
    deploymentContext?.browserOrigin ?? required('K6_BROWSER_ORIGIN'),
  environmentId:
    deploymentContext?.environmentId ?? required('K6_ENVIRONMENT_ID'),
  configurationId:
    deploymentContext?.configurationId ?? required('K6_CONFIGURATION_ID'),
};
const steps = vuSteps();
const repetitions = integer('K6_REPETITIONS', 3, MIN_REPETITIONS);
const load = {
  repetitions,
  duration: optional('K6_DURATION', '5m'),
  gracefulStop: optional('K6_GRACEFUL_STOP', '30s'),
  warmupSeconds: integer('ACTIVITY_WARMUP_SECONDS', 30, 0),
};
const traceVerifyCommand =
  process.env.API_DIAGNOSTIC_TRACE_VERIFY_COMMAND?.trim();
const evidenceCommands = Object.fromEntries(
  EVIDENCE_NAMES.map((name) => [
    name,
    process.env[EVIDENCE_VARIABLES[name]]?.trim(),
  ]).filter(([, command]) => command),
);
if (
  !evidenceCommands.api &&
  deploymentContext?.deploymentEnvironment === 'staging'
) {
  evidenceCommands.api = 'node scripts/k6/collect-staging-api-evidence.mjs';
}
const outputRoot = resolve(
  optional('K6_OUTPUT_ROOT', 'artifacts/api-diagnostic'),
  runId,
);
const manifestPath = resolve(outputRoot, 'fixture-manifest.json');
const k6Binary = optional('K6_BIN', 'k6');
const authUsers = readAuthUsers();
const mix = JSON.parse(readFileSync(mixPath, 'utf8'));
if (
  process.env.ACTIVITY_PROJECT_DISTRIBUTION === '25x2' &&
  (steps.some((vus) => vus !== 50) || mix.mixVersion !== 2)
) {
  throw new Error('Distributed observations require 50 users and mix v2');
}

if (authUsers.length < Math.max(...steps)) {
  throw new Error(
    `At least ${Math.max(...steps)} dedicated users are required`,
  );
}

mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
process.env.K6_BASE_URL = identity.baseUrl;
process.env.K6_BROWSER_ORIGIN = identity.browserOrigin;
process.env.ACTIVITY_FIXTURE_MANIFEST = manifestPath;

const manifest = {
  artifactSchemaVersion: 1,
  diagnostic: 'authenticated-activity',
  runId,
  ...identity,
  baseUrl: new URL(identity.baseUrl).origin,
  load,
  mix,
  steps: [],
  coverageGaps: EVIDENCE_NAMES.filter(
    (name) =>
      !evidenceCommands[name] && !(name === 'container' && cpuSshTarget),
  ).map(
    (name) =>
      `${name} evidence not collected (${EVIDENCE_VARIABLES[name]} unset)`,
  ),
  startedAt: new Date().toISOString(),
};
const failures = [];
let fixtureHash;

// Prove emitted profiles and reviewed database plans before fixture reset or
// admission to full load. Configuration flags are not recording acceptance.
const recorder = recordingClient(
  cpuSshTarget,
  required('API_DIAGNOSTIC_RECORDING_HELPER'),
);
manifest.recordingAdmission = await smokeRecording(
  recorder,
  join(outputRoot, 'recording-check'),
  `smoke-${randomBytes(8).toString('hex')}`,
);
if (!manifest.recordingAdmission.complete) {
  manifest.status = 'recording-incomplete';
  manifest.failures = manifest.recordingAdmission.failures;
  manifest.endedAt = new Date().toISOString();
  writeJson(join(outputRoot, 'run-manifest.json'), manifest);
  console.error(
    'Recording admission failed; no fixture reset or benchmark ran. See recording-check artifacts.',
  );
  process.exit(1);
}

for (const vus of steps) {
  const step = { vus, series: `mix-v${mix.mixVersion}-u${vus}`, runs: [] };
  manifest.steps.push(step);
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const repetitionRunId =
      `${runId}-u${vus}-r${String(repetition).padStart(2, '0')}`.slice(0, 64);
    const directory = join(
      outputRoot,
      `users-${String(vus).padStart(3, '0')}`,
      `run-${String(repetition).padStart(2, '0')}`,
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const result = { repetition, runId: repetitionRunId, directory };
    step.runs.push(result);

    // Setup outside the measurement window: reset scratch additions and
    // wait for projection/embedding readiness so every run starts equal.
    let fixture;
    try {
      ({ manifest: fixture } = await (process.env
        .ACTIVITY_PROJECT_DISTRIBUTION === '25x2'
        ? prepareDistributedFixture()
        : seedActivityFixture()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.status = 'setup_failed';
      result.setupFailure = message.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '[entity]',
      );
      failures.push(`${repetitionRunId}: setup failed; no benchmark ran`);
      manifest.coverageGaps.push(result.setupFailure);
      break;
    }
    fixtureHash ??= fixture.contentHash;
    manifest.fixture ??= {
      fixtureVersion: fixture.fixtureVersion,
      contentHash: fixture.contentHash,
      projectId: fixture.projectId,
      features: fixture.features.length,
      tasks: fixture.tasks.length,
      edges: fixture.edgeCounts,
      distributionVersion: fixture.distributionVersion,
      projectCount: fixture.projects?.length ?? 1,
      projects: fixture.projects?.map(({ projectId, contentHash }) => ({
        projectId,
        contentHash,
      })),
      assignments: fixture.assignments,
    };
    if (fixture.distributionVersion)
      step.series = `mix-v${mix.mixVersion}-u${vus}-p25-pair2-${fixture.contentHash}`;
    writeJson(join(directory, 'fixture-manifest.json'), fixture);
    if (fixture.contentHash !== fixtureHash) {
      result.status = 'fixture_changed';
      failures.push(`${repetitionRunId}: fixture content changed between runs`);
      continue;
    }

    const environment = {
      ...process.env,
      ACTIVITY_MIX_FILE: mixPath,
      API_DIAGNOSTIC_EVIDENCE_DIR: directory,
      API_DIAGNOSTIC_RUN_ID: runId,
      API_DIAGNOSTIC_REPETITION: String(repetition),
      API_DIAGNOSTIC_VUS: String(vus),
      API_DIAGNOSTIC_ENVIRONMENT_ID: identity.environmentId,
      API_DIAGNOSTIC_CONFIGURATION_ID: identity.configurationId,
      K6_AUTH_USERS_JSON: JSON.stringify(authUsers),
      K6_BUILD_ID: identity.buildId,
      K6_CONFIGURATION_ID: identity.configurationId,
      K6_DURATION: load.duration,
      K6_ENVIRONMENT_ID: identity.environmentId,
      K6_GRACEFUL_STOP: load.gracefulStop,
      K6_RUN_ID: repetitionRunId,
      K6_VUS: String(vus),
    };

    if (!traceVerifyCommand) {
      throw new Error('API_DIAGNOSTIC_TRACE_VERIFY_COMMAND is required');
    }
    result.traceVerification = await run(
      '/bin/sh',
      ['-c', traceVerifyCommand],
      environment,
      directory,
      'trace-verify',
    );
    if (!result.traceVerification.succeeded) {
      result.status = 'tracing_not_verified';
      failures.push(
        `${repetitionRunId}: tracing verification failed; no benchmark ran`,
      );
      continue;
    }

    const captureToken = `capture-${randomBytes(8).toString('hex')}`;
    result.runtimeStart = await recorder.command(
      'recording-start',
      captureToken,
      900,
    );
    writeJson(join(directory, 'runtime-start.json'), result.runtimeStart);
    if (
      ['graph-service', 'neo4j', 'embeddings'].some(
        (name) => result.runtimeStart.collectors?.[name]?.started !== true,
      )
    ) {
      result.status = 'recording-incomplete';
      failures.push(
        `${repetitionRunId}: required runtime recorder did not start; no benchmark ran`,
      );
      const cleanup = await recorder.command('recording-cleanup', captureToken);
      writeJson(join(directory, 'recording-cleanup.json'), cleanup);
      if (cleanup.cleaned !== true)
        failures.push(
          `${repetitionRunId}: failed recorder startup cleanup is incomplete`,
        );
      continue;
    }

    let cpuSampler,
      postgresSampler,
      cpuStopped = false,
      waitsStopped = false;
    const controlStartedAt = new Date().toISOString();
    try {
      const rawMetricsPath = join(directory, 'k6-metrics.json');
      cpuSampler = cpuSshTarget
        ? await startCpuSampling({
            sshTarget: cpuSshTarget,
            path: join(directory, 'cpu-samples.jsonl'),
            baselineSeconds: integer(
              'API_DIAGNOSTIC_CPU_BASELINE_SECONDS',
              30,
              1,
            ),
            intervalSeconds: integer(
              'API_DIAGNOSTIC_CPU_INTERVAL_SECONDS',
              5,
              1,
            ),
          })
        : undefined;
      try {
        if (cpuSshTarget) {
          postgresSampler = await startPostgresSampling({
            sshTarget: cpuSshTarget,
            path: join(directory, 'postgres-wait-samples.jsonl'),
          });
        }
      } catch (error) {
        const now = new Date().toISOString();
        await cpuSampler?.stop(now, now, 0);
        cpuStopped = true;
        throw error;
      }
      const statementBefore = cpuSshTarget
        ? await capturePostgresStatements(cpuSshTarget)
        : undefined;
      if (statementBefore)
        writeJson(
          join(directory, 'postgres-statements-before.json'),
          statementBefore,
        );
      let statementWarmup;
      result.startedAt = new Date().toISOString();
      const statementTimer = cpuSshTarget
        ? setTimeout(() => {
            statementWarmup = capturePostgresStatements(cpuSshTarget);
          }, load.warmupSeconds * 1000)
        : undefined;
      try {
        result.k6 = await run(
          k6Binary,
          [
            'run',
            '--summary-export',
            join(directory, 'k6-summary.json'),
            '--out',
            `json=${rawMetricsPath}`,
            scenarioPath,
          ],
          environment,
          directory,
          'k6',
        );
      } finally {
        clearTimeout(statementTimer);
      }
      result.endedAt = new Date().toISOString();
      // Plan replays and final profile retrieval occur outside measurement. Keep
      // their own windows, and keep samplers alive to observe collection demand.
      result.databasePlans = await recorder.command(
        'recording-plans',
        captureToken,
      );
      writeJson(join(directory, 'database-plans.json'), result.databasePlans);
      let statementAfter, statementPostWarmup;
      if (cpuSshTarget) {
        const warmup = (await statementWarmup) ?? {
          available: false,
          gap: 'Run ended before post-warm-up snapshot started',
        };
        const after = await capturePostgresStatements(cpuSshTarget);
        statementAfter = after;
        statementPostWarmup = warmup;
        writeJson(join(directory, 'postgres-statements-warmup.json'), warmup);
        writeJson(join(directory, 'postgres-statements-after.json'), after);
        result.postgresStatements = comparePostgresStatements(warmup, after);
        result.postgresStatements.measurementStartAt = result.startedAt;
        result.postgresStatements.measurementEndAt = result.endedAt;
        result.postgresStatements.windowNote =
          'Snapshot timestamps define the actual counter window; it begins after warm-up and may extend past load completion while collectors finish. Snapshot overhead is included.';
        writeJson(
          join(directory, 'postgres-statements-analysis.json'),
          result.postgresStatements,
        );
        for (const gap of result.postgresStatements.gaps.filter(Boolean))
          manifest.coverageGaps.push(
            `${repetitionRunId}: PostgreSQL statements: ${gap}`,
          );
      }
      if (postgresSampler) {
        result.postgresWaits = await postgresSampler.stop(
          result.startedAt,
          result.endedAt,
          load.warmupSeconds,
        );
        waitsStopped = true;
        writeJson(
          join(directory, 'postgres-wait-analysis.json'),
          result.postgresWaits,
        );
        if (
          result.postgresWaits.errors.length ||
          !result.postgresWaits.samples
        ) {
          manifest.coverageGaps.push(
            `${repetitionRunId}: PostgreSQL wait sampling incomplete`,
          );
        }
      }
      if (cpuSampler) {
        result.cpu = await cpuSampler.stop(
          result.startedAt,
          result.endedAt,
          load.warmupSeconds,
        );
        cpuStopped = true;
        writeJson(join(directory, 'cpu-analysis.json'), result.cpu);
        manifest.coverageGaps.push(
          `${repetitionRunId}: ${result.cpu.queryCoverage}; query polls ${result.cpu.querySamples}, failures ${result.cpu.queryErrors}, observations ${result.cpu.observedQueries}. Supported JVM GC/compilation counters are in queryCollection; query-cache, safepoints and direct query-to-trace attribution remain gaps.`,
        );
        if (result.cpu.errors.length > 0 || result.cpu.measuredSamples === 0) {
          manifest.coverageGaps.push(
            `${repetitionRunId}: CPU sampling incomplete (${result.cpu.errors.length} errors, ${result.cpu.measuredSamples} measured samples)`,
          );
        }
      }

      // Teardown removes profiling containers; stop Docker/cgroup sampling first.
      result.runtimeRecording = await recorder.command(
        'recording-stop',
        captureToken,
      );
      writeJson(join(directory, 'runtime-recording.json'), result.runtimeRecording);
      result.evidence = {};
      for (const [name, command] of Object.entries(evidenceCommands)) {
        const evidence = await run(
          '/bin/sh',
          ['-c', command],
          {
            ...environment,
            API_DIAGNOSTIC_START_AT: result.startedAt,
            API_DIAGNOSTIC_END_AT: result.endedAt,
            API_DIAGNOSTIC_RAW_METRICS: rawMetricsPath,
            API_DIAGNOSTIC_WARMUP_SECONDS: String(load.warmupSeconds),
          },
          directory,
          name,
        );
        evidence.outputRecorded =
          readFileSync(evidence.stdoutPath, 'utf8').trim().length > 0;
        result.evidence[name] = evidence;
        if (evidence.outputRecorded) {
          try {
            // Each collector's stdout is its versioned JSON boundary. Preserve raw
            // partial output, but reject an unparsable required artifact.
            if (name !== 'container')
              JSON.parse(readFileSync(evidence.stdoutPath, 'utf8'));
          } catch {
            evidence.parseError = 'Collector JSON is unparsable';
          }
        }
        if (!evidence.succeeded || !evidence.outputRecorded) {
          manifest.coverageGaps.push(
            `${repetitionRunId}: ${name} evidence command failed or was empty`,
          );
        }
      }

      try {
        result.analysis = await analyzeRawMetrics(
          rawMetricsPath,
          load.warmupSeconds,
        );
        writeJson(join(directory, 'activity-analysis.json'), result.analysis);
      } catch (error) {
        result.analysisError =
          error instanceof Error ? error.message : String(error);
      }
      result.recordingAcceptance = acceptCollectors({
        evidence: result.evidence,
        cpu: result.cpu,
        postgresWaits: result.postgresWaits,
        snapshots: [statementBefore, statementPostWarmup, statementAfter],
        runtime: result.runtimeRecording,
        plans: result.databasePlans,
        window: { startAt: result.startedAt, endAt: result.endedAt },
      });
      writeJson(
        join(directory, 'recording-acceptance.json'),
        result.recordingAcceptance,
      );
      result.status = diagnosticStatus(
        result.k6.succeeded && Boolean(result.analysis),
        result.recordingAcceptance,
      );
      if (result.status !== 'completed')
        failures.push(
          `${repetitionRunId}: ${result.status}; ${result.recordingAcceptance.failures.join('; ')}`,
        );
      console.log(`${repetitionRunId}: ${result.status}`);
    } catch {
      result.status = 'recording-incomplete';
      result.recordingFailure =
        'Collector/control failure; private diagnostics suppressed and partial artifacts retained';
      failures.push(`${repetitionRunId}: ${result.recordingFailure}`);
    } finally {
      const cleanupEnd = new Date().toISOString();
      for (const [name, sampler, stopped] of [
        ['cpu', cpuSampler, cpuStopped],
        ['postgres-wait', postgresSampler, waitsStopped],
      ]) {
        if (sampler && !stopped) {
          try {
            writeJson(join(directory, `${name}-aborted.json`), {
              aborted: true,
              evidence: await sampler.stop(controlStartedAt, cleanupEnd, 0),
            });
          } catch {
            failures.push(`${repetitionRunId}: ${name} sampler cleanup failed`);
          }
        }
      }
      const cleanup = await recorder.command('recording-cleanup', captureToken);
      writeJson(join(directory, 'recording-cleanup.json'), cleanup);
      if (cleanup.cleaned !== true) {
        result.status = 'recording-incomplete';
        failures.push(
          `${repetitionRunId}: recording cleanup not verified; inspect cleanup.json`,
        );
      }
    }
  }
  step.aggregate = aggregateStep(step.runs);
  if (step.runs.some((result) => result.status === 'setup_failed')) break;
}

manifest.endedAt = new Date().toISOString();
manifest.failures = failures;
manifest.status = failures.length === 0 ? 'completed' : 'failed';
writeJson(join(outputRoot, 'run-manifest.json'), manifest);
writeFileSync(join(outputRoot, 'report.md'), renderReport(manifest), 'utf8');

if (failures.length > 0) {
  console.error(
    `Activity diagnostic incomplete; see ${join(outputRoot, 'report.md')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Activity diagnostic complete; report at ${join(outputRoot, 'report.md')}`,
  );
}
