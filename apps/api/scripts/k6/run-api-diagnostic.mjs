import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The staging wrapper invokes this runner; the activity workload reuses its
// environment and never switches tracing.
if (process.env.API_DIAGNOSTIC_WORKLOAD === 'activity') {
  await import('./launch-api-diagnostic.mjs');
  process.exit(process.exitCode ?? 0);
}

const MIN_REPETITIONS = 2;
const MAX_RUN_ID_LENGTH = 64;
const repositoryRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const scenarioPath = resolve(
  repositoryRoot,
  'scripts/k6/authenticated-api-diagnostic.js',
);

function required(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(name, fallback, minimum = 1) {
  const raw = process.env[name]?.trim() || String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function safeRunId(value) {
  if (
    !/^[A-Za-z0-9_.-]{1,64}$/.test(value) ||
    value.length > MAX_RUN_ID_LENGTH
  ) {
    throw new Error(
      'K6_RUN_ID must contain only letters, numbers, dots, underscores, or hyphens and be at most 64 characters',
    );
  }
  return value;
}

function scopedRunId(runId, mode, repetition) {
  const suffix = `-${mode === 'disabled' ? 'off' : 'on'}-r${String(repetition).padStart(2, '0')}`;
  const value = `${runId}${suffix}`;
  if (value.length > MAX_RUN_ID_LENGTH) {
    throw new Error(
      `K6_RUN_ID is too long for a repetition id; use at most ${MAX_RUN_ID_LENGTH - suffix.length} characters`,
    );
  }
  return safeRunId(value);
}

function baseUrlIdentity(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('K6_BASE_URL must be an absolute HTTP or HTTPS URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('K6_BASE_URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('K6_BASE_URL must not contain URL credentials');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runCommand(command, args, environment, stdoutPath, stderrPath) {
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const result = spawnSync(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ['ignore', stdout, stderr],
    });
    return {
      error: result.error?.message,
      signal: result.signal,
      status: result.status,
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function runShellCommand(command, environment, stdoutPath, stderrPath) {
  return runCommand(
    '/bin/sh',
    ['-c', command],
    environment,
    stdoutPath,
    stderrPath,
  );
}

function parseDeploymentContext(raw) {
  let context;
  try {
    context = JSON.parse(raw);
  } catch {
    throw new Error(
      'Deployment context must contain one JSON object',
    );
  }

  if (
    context === null ||
    typeof context !== 'object' ||
    Array.isArray(context) ||
    context.schemaVersion !== 1
  ) {
    throw new Error('Deployment context has an unsupported shape');
  }

  for (const field of [
    'buildId',
    'configurationId',
    'deploymentEnvironment',
    'environmentId',
    'baseUrl',
    'browserOrigin',
  ]) {
    if (typeof context[field] !== 'string' || context[field].trim().length === 0) {
      throw new Error(
        `Deployment context is missing required field: ${field}`,
      );
    }
  }

  return context;
}

function readDeploymentContext() {
  const file = process.env.API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_FILE?.trim();
  if (file) {
    try {
      return parseDeploymentContext(readFileSync(file, 'utf8'));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Deployment context')) {
        throw error;
      }
      throw new Error(
        `API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_FILE could not be read: ${file}`,
      );
    }
  }

  const command = process.env.API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND?.trim();
  if (!command) return undefined;

  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      `API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND failed (status=${result.status ?? 'unknown'}, signal=${result.signal ?? 'none'})`,
    );
  }

  try {
    return parseDeploymentContext(result.stdout);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND must emit a valid context: ${error.message}`,
      );
    }
    throw error;
  }
}

function readAuthUsersJson() {
  const file = process.env.K6_AUTH_USERS_FILE?.trim();
  if (!file) return process.env.K6_AUTH_USERS_JSON;
  try {
    const value = readFileSync(file, 'utf8');
    if (value.trim().length === 0) {
      throw new Error('file is empty');
    }
    return value;
  } catch (error) {
    throw new Error(
      `K6_AUTH_USERS_FILE could not be read: ${file}${error instanceof Error ? ` (${error.message})` : ''}`,
    );
  }
}

function commandSucceeded(result) {
  return result.status === 0 && result.signal === null && !result.error;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function hasRecordedOutput(path) {
  try {
    return readFileSync(path, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function compactMetric(metric) {
  const values = metric?.values;
  if (!values || typeof values !== 'object') return undefined;

  const compact = {};
  for (const key of [
    'min',
    'med',
    'avg',
    'max',
    'p(90)',
    'p(95)',
    'p(99)',
    'count',
    'rate',
    'passes',
    'fails',
  ]) {
    const value = finiteNumber(values[key]);
    if (value !== undefined) compact[key] = value;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactK6Summary(summary) {
  const metrics = {};
  for (const name of [
    'http_req_duration',
    'http_req_failed',
    'http_reqs',
    'api_diagnostic_journey_latency',
    'api_diagnostic_journey_errors',
    'api_diagnostic_correctness',
    'api_diagnostic_cleanup_failures',
    'api_diagnostic_journey_offered',
    'api_diagnostic_journey_completed',
  ]) {
    const metric = compactMetric(summary?.metrics?.[name]);
    if (metric) metrics[name] = metric;
  }
  return { metrics };
}

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function statistics(values) {
  const finiteValues = values.filter(
    (value) => finiteNumber(value) !== undefined,
  );
  if (finiteValues.length === 0) return undefined;

  const mean =
    finiteValues.reduce((total, value) => total + value, 0) /
    finiteValues.length;
  const variance =
    finiteValues.reduce((total, value) => total + (value - mean) ** 2, 0) /
    finiteValues.length;
  return {
    count: finiteValues.length,
    max: Math.max(...finiteValues),
    mean,
    median: median(finiteValues),
    min: Math.min(...finiteValues),
    standardDeviation: Math.sqrt(variance),
  };
}

function representativeMetric(repetition, metricName) {
  const metric = repetition.summary?.metrics?.[metricName];
  if (!metric) return undefined;
  return metric['p(95)'] ?? metric.avg;
}

function aggregateMode(repetitions) {
  const metricNames = [
    'http_req_duration',
    'http_req_failed',
    'api_diagnostic_journey_latency',
    'api_diagnostic_journey_errors',
    'api_diagnostic_correctness',
    'api_diagnostic_cleanup_failures',
  ];
  const metrics = {};
  for (const metricName of metricNames) {
    const values = repetitions
      .map((repetition) => representativeMetric(repetition, metricName))
      .filter((value) => finiteNumber(value) !== undefined);
    const runP95 = statistics(values);
    if (runP95) metrics[metricName] = { runP95 };
  }

  return {
    completedRuns: repetitions.filter(
      (repetition) => repetition.status === 'completed',
    ).length,
    metrics,
    repetitions: repetitions.length,
  };
}

function compareMetric(disabled, enabled, metricName) {
  const disabledMedian = disabled.metrics[metricName]?.runP95?.median;
  const enabledMedian = enabled.metrics[metricName]?.runP95?.median;
  if (
    finiteNumber(disabledMedian) === undefined ||
    finiteNumber(enabledMedian) === undefined
  ) {
    return undefined;
  }

  const delta = enabledMedian - disabledMedian;
  return {
    disabledMedian,
    enabledMedian,
    delta,
    deltaPercent:
      disabledMedian === 0 ? undefined : (delta / disabledMedian) * 100,
  };
}

function compareModes(disabled, enabled) {
  const metrics = {};
  for (const metricName of [
    'http_req_duration',
    'api_diagnostic_journey_latency',
  ]) {
    const comparison = compareMetric(disabled, enabled, metricName);
    if (comparison) metrics[metricName] = comparison;
  }
  return {
    metrics,
    interpretation:
      'Positive latency deltas are measured tracing overhead signals, not optimization findings. Confirm them with repeatable trace and service evidence before ranking work.',
  };
}

const runId = safeRunId(
  process.env.K6_RUN_ID?.trim() ||
    `api-diagnostic-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`,
);
const deploymentContext = readDeploymentContext();
const authUsersJson = readAuthUsersJson();
const buildId = deploymentContext?.buildId ?? required('K6_BUILD_ID');
const baseUrl = deploymentContext?.baseUrl ?? required('K6_BASE_URL');
const browserOrigin =
  deploymentContext?.browserOrigin ?? required('K6_BROWSER_ORIGIN');
const environmentId =
  deploymentContext?.environmentId ?? required('K6_ENVIRONMENT_ID');
const configurationId =
  deploymentContext?.configurationId ?? required('K6_CONFIGURATION_ID');
const deploymentEnvironment =
  deploymentContext?.deploymentEnvironment ?? required('DEPLOYMENT_ENVIRONMENT');
const repetitions = positiveInteger('K6_REPETITIONS', 3, MIN_REPETITIONS);
const outputRoot = resolve(
  process.env.K6_OUTPUT_ROOT?.trim() || 'artifacts/api-diagnostic',
  runId,
);
const k6Binary = process.env.K6_BIN?.trim() || 'k6';
const workload = {
  duration: required('K6_DURATION'),
  gracefulStop: required('K6_GRACEFUL_STOP'),
  maxVUs: required('K6_MAX_VUS'),
  preAllocatedVUs: required('K6_PRE_ALLOCATED_VUS'),
  rate: required('K6_RATE'),
};
const sharedEnvironment = {
  ...process.env,
  DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
  K6_BASE_URL: baseUrl,
  K6_BROWSER_ORIGIN: browserOrigin,
  K6_BUILD_ID: buildId,
  K6_CONFIGURATION_ID: configurationId,
  K6_ENVIRONMENT_ID: environmentId,
  K6_RUN_ID: runId,
  ...(authUsersJson ? { K6_AUTH_USERS_JSON: authUsersJson } : {}),
};

const evidenceCommands = {
  api: required('API_DIAGNOSTIC_API_EVIDENCE_COMMAND'),
  container: required('API_DIAGNOSTIC_CONTAINER_EVIDENCE_COMMAND'),
  database: required('API_DIAGNOSTIC_DATABASE_EVIDENCE_COMMAND'),
  droppedTelemetry: required(
    'API_DIAGNOSTIC_DROPPED_TELEMETRY_EVIDENCE_COMMAND',
  ),
  embeddings: required('API_DIAGNOSTIC_EMBEDDINGS_EVIDENCE_COMMAND'),
  graph: required('API_DIAGNOSTIC_GRAPH_EVIDENCE_COMMAND'),
  traceVolume: required('API_DIAGNOSTIC_TRACE_VOLUME_EVIDENCE_COMMAND'),
};
const traceCommands = {
  disabled: required('API_DIAGNOSTIC_TRACE_DISABLED_COMMAND'),
  enabled: required('API_DIAGNOSTIC_TRACE_ENABLED_COMMAND'),
};

mkdirSync(outputRoot, { recursive: true });

async function runRepetition(mode, repetition) {
  const repetitionDirectory = join(
    outputRoot,
    mode,
    `run-${String(repetition).padStart(2, '0')}`,
  );
  mkdirSync(repetitionDirectory, { recursive: true });

  const repetitionRunId = scopedRunId(runId, mode, repetition);
  const modeEnvironment = {
    ...sharedEnvironment,
    API_DIAGNOSTIC_BUILD_ID: buildId,
    API_DIAGNOSTIC_CONFIGURATION_ID: configurationId,
    API_DIAGNOSTIC_ENVIRONMENT_ID: environmentId,
    API_DIAGNOSTIC_EVIDENCE_DIR: repetitionDirectory,
    API_DIAGNOSTIC_REPETITION: String(repetition),
    API_DIAGNOSTIC_RUN_ID: runId,
    API_DIAGNOSTIC_TRACE_MODE: mode,
    K6_RUN_ID: repetitionRunId,
    K6_TRACE_MODE: mode,
  };
  const startedAt = new Date();
  const toggle = runShellCommand(
    traceCommands[mode],
    modeEnvironment,
    join(repetitionDirectory, 'trace-toggle.stdout.log'),
    join(repetitionDirectory, 'trace-toggle.stderr.log'),
  );

  const summaryPath = join(repetitionDirectory, 'k6-summary.json');
  const rawMetricsPath = join(repetitionDirectory, 'k6-metrics.json');
  rmSync(summaryPath, { force: true });
  rmSync(rawMetricsPath, { force: true });

  if (!commandSucceeded(toggle)) {
    return {
      artifacts: {
        repetitionDirectory,
        summaryPath,
        rawMetricsPath,
      },
      evidence: {},
      endedAt: new Date().toISOString(),
      k6: undefined,
      repetition,
      runId: repetitionRunId,
      startedAt: startedAt.toISOString(),
      status: 'trace_toggle_failed',
      toggle,
    };
  }

  const k6Result = runCommand(
    k6Binary,
    [
      'run',
      '--summary-export',
      summaryPath,
      '--out',
      `json=${rawMetricsPath}`,
      scenarioPath,
    ],
    modeEnvironment,
    join(repetitionDirectory, 'k6.stdout.log'),
    join(repetitionDirectory, 'k6.stderr.log'),
  );
  const endedAt = new Date();
  const evidenceEnvironment = {
    ...modeEnvironment,
    API_DIAGNOSTIC_END_AT: endedAt.toISOString(),
    API_DIAGNOSTIC_START_AT: startedAt.toISOString(),
  };
  const evidence = {};
  for (const [name, command] of Object.entries(evidenceCommands)) {
    const stdoutPath = join(repetitionDirectory, `${name}.stdout.log`);
    const stderrPath = join(repetitionDirectory, `${name}.stderr.log`);
    const result = runShellCommand(
      command,
      evidenceEnvironment,
      stdoutPath,
      stderrPath,
    );
    evidence[name] = {
      ...result,
      stderrPath,
      stdoutPath,
      outputRecorded: hasRecordedOutput(stdoutPath),
    };
  }

  const summary = readJson(summaryPath);
  const evidenceSucceeded = Object.values(evidence).every(
    (result) => commandSucceeded(result) && result.outputRecorded,
  );
  const k6Succeeded = commandSucceeded(k6Result);
  return {
    artifacts: {
      repetitionDirectory,
      summaryPath,
      rawMetricsPath,
    },
    evidence,
    endedAt: endedAt.toISOString(),
    k6: {
      ...k6Result,
      summary: summary ? compactK6Summary(summary) : undefined,
    },
    repetition,
    runId: repetitionRunId,
    startedAt: startedAt.toISOString(),
    status:
      k6Succeeded && evidenceSucceeded && summary ? 'completed' : 'failed',
    summary: summary ? compactK6Summary(summary) : undefined,
    toggle,
  };
}

const manifest = {
  artifactSchemaVersion: 1,
  buildId,
  configurationId,
  ...(deploymentContext ? { deploymentContext } : {}),
  environment: {
    baseUrlOrigin: baseUrlIdentity(baseUrl),
    browserOrigin: baseUrlIdentity(browserOrigin),
    deploymentEnvironment,
    id: environmentId,
    nodeVersion: process.version,
  },
  load: workload,
  repetitions,
  runId,
  scenario: scenarioPath,
  startedAt: new Date().toISOString(),
  traceModes: {
    disabled: [],
    enabled: [],
  },
};
const failures = [];

for (const mode of ['disabled', 'enabled']) {
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const result = await runRepetition(mode, repetition);
    manifest.traceModes[mode].push(result);
    if (result.status !== 'completed') {
      failures.push(`${mode} repetition ${repetition} did not complete`);
    }
  }
}

const disabled = aggregateMode(manifest.traceModes.disabled);
const enabled = aggregateMode(manifest.traceModes.enabled);
manifest.baseline = {
  comparison: compareModes(disabled, enabled),
  disabled,
  enabled,
  normalVariance: {
    disabled: disabled.metrics,
    enabled: enabled.metrics,
  },
};
manifest.comparability = {
  sameBuild: true,
  sameConfiguration: true,
  sameOfferedLoad: true,
  repeatedRunsRequired: MIN_REPETITIONS,
};
manifest.endedAt = new Date().toISOString();
manifest.status = failures.length === 0 ? 'completed' : 'failed';
manifest.failures = failures;
writeJson(join(outputRoot, 'run-manifest.json'), manifest);

if (failures.length > 0) {
  console.error(
    `API diagnostic failed; see ${join(outputRoot, 'run-manifest.json')}`,
  );
  process.exitCode = 1;
} else {
  console.log(`API diagnostic complete; evidence is in ${outputRoot}`);
}
