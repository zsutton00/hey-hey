import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptRuntimeRecording,
  acceptDatabasePlans,
  acceptResourceCounters,
} from './recording-acceptance.mjs';
import { startCpuSampling } from './staging-cpu-sampling.mjs';
import { startPostgresSampling } from './staging-postgres-sampling.mjs';
import {
  capturePostgresStatements,
  comparePostgresStatements,
} from './staging-postgres-statements.mjs';

const execute = promisify(execFile);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function recordingClient(sshTarget, helper) {
  if (!sshTarget || !helper)
    throw new Error('Staging recording SSH target and helper are required');
  return {
    sshTarget,
    async command(action, token, seconds) {
      try {
        const { stdout } = await execute(
          'ssh',
          [
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            sshTarget,
            [helper, action, token, ...(seconds ? [String(seconds)] : [])]
              .map(quote)
              .join(' '),
          ],
          {
            timeout:
              action === 'recording-stop' || action === 'recording-metrics'
                ? 150000
                : 90000,
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        return JSON.parse(stdout);
      } catch (error) {
        // Nonzero capture retains structured partial data; raw stderr stays private.
        if (error.stdout) {
          try {
            return JSON.parse(error.stdout);
          } catch {
            /* Report transport/parser failure below. */
          }
        }
        return {
          schemaVersion: 1,
          status: 'recording-incomplete',
          error: 'Staging recording transport/authentication/parser failure',
        };
      }
    },
  };
}

export async function smokeRecording(client, directory, token) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (name, value) =>
    writeFileSync(join(directory, name), JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
  const started = await client.command('recording-start', token, 90);
  save('runtime-start.json', started);
  const startAt = new Date().toISOString();
  let runtime,
    plans,
    result,
    cpuSampler,
    waitSampler,
    cpuStopped = false,
    waitsStopped = false;
  try {
    if (
      ['graph-service', 'neo4j', 'embeddings'].some(
        (name) => started.collectors?.[name]?.started !== true,
      )
    )
      result = {
        complete: false,
        failures: Object.entries(started.collectors ?? {})
          .filter(([, c]) => !c.started)
          .map(([name, c]) => `${name}: ${c.error}`)
          .concat(started.error ? [started.error] : []),
        noBenchmarkRan: true,
      };
    if (result && !result.failures.length)
      result.failures.push('Required recorder startup outcomes are missing');
    if (result) return result;
    cpuSampler = await startCpuSampling({
      sshTarget: client.sshTarget,
      path: join(directory, 'cpu-samples.jsonl'),
      baselineSeconds: 1,
      intervalSeconds: 5,
    });
    waitSampler = await startPostgresSampling({
      sshTarget: client.sshTarget,
      path: join(directory, 'postgres-wait-samples.jsonl'),
    });
    const before = await capturePostgresStatements(client.sshTarget);
    save('postgres-statements-before.json', before);
    plans = await client.command('recording-plans', token);
    save('database-plans.json', plans);
    // Check emission outside measurement, without k6 or fixture/account mutation.
    await sleep(35000);
    const endAt = new Date().toISOString();
    const after = await capturePostgresStatements(client.sshTarget);
    save('postgres-statements-after.json', after);
    save(
      'postgres-statements-analysis.json',
      comparePostgresStatements(before, after),
    );
    // Finish sampling before recorder teardown removes toolbox containers.
    const cpu = await cpuSampler.stop(startAt, endAt, 0);
    cpuStopped = true;
    const waits = await waitSampler.stop(startAt, endAt, 0);
    waitsStopped = true;
    save('cpu-analysis.json', cpu);
    save('postgres-wait-analysis.json', waits);
    runtime = await client.command('recording-stop', token);
    save('runtime-recording.json', runtime);
    const metrics = await client.command('recording-metrics', token);
    save('collector-check.json', metrics);
    result = {
      complete: false,
      window: { startAt, endAt },
      noBenchmarkRan: true,
      failures: [
        ...acceptRuntimeRecording(runtime, { startAt, endAt }).failures,
        ...acceptDatabasePlans(plans).failures,
        ...acceptResourceCounters(cpu).failures,
        ...(!waits.samples || waits.errors.length
          ? ['Smoke PostgreSQL waits incomplete']
          : []),
        ...(!before.available || !after.available
          ? ['Smoke PostgreSQL counters unavailable']
          : []),
        ...['graph', 'embeddings', 'database', 'container', 'dropped-telemetry']
          .filter((name) => metrics.outcomes?.[name]?.complete !== true)
          .map((name) => `${name}: smoke collector failed or unavailable`),
      ],
    };
    result.complete = result.failures.length === 0;
    save('recording-acceptance.json', result);
    return result;
  } catch {
    result = {
      complete: false,
      noBenchmarkRan: true,
      failures: [
        'Recording check collector transport/parser/setup failure; partial artifacts retained',
      ],
    };
    return result;
  } finally {
    const end = new Date().toISOString();
    if (cpuSampler && !cpuStopped)
      save('cpu-analysis.json', await cpuSampler.stop(startAt, end, 0));
    if (waitSampler && !waitsStopped)
      save(
        'postgres-wait-analysis.json',
        await waitSampler.stop(startAt, end, 0),
      );
    const cleanup = await client.command('recording-cleanup', token);
    save('cleanup.json', cleanup);
    if (result) {
      if (cleanup.cleaned !== true) {
        result.complete = false;
        result.failures.push(
          'Recording cleanup was not verified; inspect cleanup.json before retrying',
        );
      }
      save('recording-acceptance.json', result);
    }
  }
}
