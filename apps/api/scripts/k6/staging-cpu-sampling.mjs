import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { startQuerySampling } from './staging-query-sampling.mjs';
import { summarizeCounters } from './cpu-counter-analysis.mjs';

const execute = promisify(execFile);
const services = [
  'api',
  'graph-service',
  'embeddings',
  'postgres',
  'neo4j',
  'vespa',
];
const command = `ids=$(docker ps --filter label=com.docker.compose.project=hey-hey-staging --format '{{.ID}}'); test -n "$ids" && docker stats --no-stream --format '{{json .}}' $ids; echo HOST_CPU; head -n 1 /proc/stat`;

export function summarizeCpu(samples) {
  return Object.fromEntries(
    services.map((service) => {
      const name = `hey-hey-staging-${service}-1`;
      const values = samples.flatMap((sample) =>
        sample.containers
          .filter((c) => c.name === name)
          .map((c) => c.cpuPercent),
      );
      const sorted = [...values].sort((a, b) => a - b);
      return [
        service,
        values.length === 0
          ? { samples: 0 }
          : {
              samples: values.length,
              mean: values.reduce((a, b) => a + b, 0) / values.length,
              p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
              max: sorted.at(-1),
            },
      ];
    }),
  );
}

export async function sampleCpu(sshTarget, phase, path, querySampler) {
  const startedAt = new Date().toISOString();
  const { stdout } = await execute(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, command],
    { timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  const [stats, hostCpu] = stdout.split('HOST_CPU\n');
  const containers = stats
    .trim()
    .split('\n')
    .map((line) => {
      const row = JSON.parse(line);
      const cpuPercent = Number(row.CPUPerc.replace(/%$/, ''));
      if (
        !row.Name.startsWith('hey-hey-staging-') ||
        !Number.isFinite(cpuPercent)
      ) {
        throw new Error('Unexpected staging Docker stats response');
      }
      return {
        name: row.Name,
        cpuPercent,
        memoryUsage: row.MemUsage,
        memoryPercent: Number(row.MemPerc.replace(/%$/, '')),
      };
    });
  for (const service of services) {
    if (!containers.some((c) => c.name === `hey-hey-staging-${service}-1`)) {
      throw new Error(`Staging CPU sample missing ${service}`);
    }
  }
  const hostCpuTicks = hostCpu.trim().split(/\s+/).slice(1).map(Number);
  let queries, queryError, queryCollection, resources;
  try {
    const source = readFileSync(
      new URL('./staging-resource-snapshot.py', import.meta.url),
      'utf8',
    );
    const quote = "'" + source.replaceAll("'", "'\\''") + "'";
    const result = await execute(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        sshTarget,
        `python3 -c ${quote}`,
      ],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
    );
    resources = JSON.parse(result.stdout);
  } catch {
    resources = { gaps: ['Host cgroup/process collection failed'] };
  }
  try {
    queryCollection = await querySampler.sample();
    queries = queryCollection.queries;
    queryError = queryCollection.queryError;
  } catch {
    queryError = 'Active-query collection failed; no query data retained';
  }
  const sample = {
    startedAt,
    endedAt: new Date().toISOString(),
    phase,
    containers,
    hostCpuTicks,
    neo4jCpuCounters: resources.containers?.['hey-hey-staging-neo4j-1']?.cpu,
    resources,
    queryCollection,
    queries,
    queryError,
  };
  appendFileSync(path, `${JSON.stringify(sample)}\n`);
  return sample;
}

export async function startCpuSampling({
  sshTarget,
  path,
  baselineSeconds,
  intervalSeconds,
}) {
  const baseline = [];
  const querySampler = startQuerySampling(sshTarget);
  // Authenticate before baseline; this one-time setup is excluded from measurement.
  try {
    await querySampler.sample();
  } catch {
    /* Each poll records its gap. */
  }
  const activity = [];
  const errors = [];
  const baselineDeadline = Date.now() + baselineSeconds * 1000;
  // Collect the baseline after fixture preparation, before authentication/load.
  do {
    const began = Date.now();
    try {
      baseline.push(await sampleCpu(sshTarget, 'baseline', path, querySampler));
    } catch (error) {
      await querySampler.close();
      throw error;
    }
    const delay = Math.min(
      intervalSeconds * 1000 - (Date.now() - began),
      baselineDeadline - Date.now(),
    );
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
  } while (Date.now() < baselineDeadline);

  let stopped = false;
  let wake;
  const loop = (async () => {
    while (!stopped) {
      const began = Date.now();
      try {
        activity.push(
          await sampleCpu(sshTarget, 'activity', path, querySampler),
        );
      } catch (error) {
        errors.push(error.message);
      }
      const delay = intervalSeconds * 1000 - (Date.now() - began);
      if (!stopped && delay > 0)
        await new Promise((done) => {
          const timer = setTimeout(done, delay);
          wake = () => {
            clearTimeout(timer);
            done();
          };
        });
    }
  })();
  return {
    async stop(startedAt, endedAt, warmupSeconds) {
      stopped = true;
      wake?.();
      await loop;
      await querySampler.close();
      // Require complete samples to fall inside the analyzed k6 window.
      const measured = activity.filter(
        (sample) =>
          Date.parse(sample.startedAt) >=
            Date.parse(startedAt) + warmupSeconds * 1000 &&
          Date.parse(sample.endedAt) <= Date.parse(endedAt),
      );
      return {
        path,
        baselineSeconds,
        intervalSeconds,
        baseline: summarizeCpu(baseline),
        measured: summarizeCpu(measured),
        counterSeriesVersion: 2,
        baselineCounters: summarizeCounters(baseline),
        measuredCounters: summarizeCounters(measured),
        windows: {
          baseline: [baseline.at(0)?.startedAt, baseline.at(-1)?.endedAt],
          activity: [measured.at(0)?.startedAt, measured.at(-1)?.endedAt],
        },
        errors,
        measuredSamples: measured.length,
        querySamples: measured.filter((s) => !s.queryError).length,
        queryErrors: measured.filter((s) => s.queryError).length,
        observedQueries: measured.flatMap((s) => s.queries ?? []).length,
        queryCoverage:
          'Active transactions sampled at the CPU interval; fast queries may be missed. CPU durations may be null when server CPU tracking is disabled. No trace metadata is collected.',
        units: 'percent of one logical CPU (100% = one core)',
        scope: 'all processes in staging containers; includes background work',
      };
    },
  };
}
