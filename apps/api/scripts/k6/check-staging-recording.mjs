import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { recordingScope } from './recording-scope.mjs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  recordingClient,
  smokeRecording,
} from './staging-recording-client.mjs';

const token = `smoke-${randomBytes(8).toString('hex')}`;
const directory = resolve(
  process.env.API_DIAGNOSTIC_RECORDING_OUTPUT ??
    'artifacts/api-diagnostic/recording-check',
  token,
);
const client = recordingClient(
  process.env.API_DIAGNOSTIC_SSH_TARGET,
  process.env.API_DIAGNOSTIC_RECORDING_HELPER,
);
// Check production prerequisites before any recorder attaches. Execute the
// reviewed local collector over SSH so this check needs no deployment/restart.
if (recordingScope().environment === 'production') {
  const root = process.env.API_DIAGNOSTIC_LOCAL_DEPLOY_ROOT;
  if (!root) {
    throw new Error(
      'API_DIAGNOSTIC_LOCAL_DEPLOY_ROOT is required for production recording checks',
    );
  }
  const source = readFileSync(
    resolve(root, 'scripts/staging-runtime-recording.py'),
    'utf8',
  );
  const remoteRoot = process.env.PRODUCTION_REMOTE_DEPLOY_ROOT;
  if (!remoteRoot) {
    throw new Error('PRODUCTION_REMOTE_DEPLOY_ROOT is required');
  }
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const code = `__file__ = ${JSON.stringify(remoteRoot + '/scripts/staging-runtime-recording.py')}\n${source}`;
  const preflight = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      process.env.API_DIAGNOSTIC_SSH_TARGET,
      `API_DIAGNOSTIC_ENVIRONMENT=production python3 -c ${quote(code)} preflight prerequisite-check`,
    ],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 },
  );
  if (preflight.error || preflight.status !== 0) {
    let outcomes;
    try {
      outcomes = JSON.parse(preflight.stdout).outcomes;
    } catch {}
    const result = {
      complete: false,
      noBenchmarkRan: true,
      environment: 'production',
      outcomes,
      failures: outcomes
        ? Object.entries(outcomes)
            .filter(([, value]) => !value.available)
            .map(([name, value]) => `${name}: ${value.error}`)
        : ['Production recording preflight transport/parser failure'],
    };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      resolve(directory, 'recording-acceptance.json'),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ ...result, directory }, null, 2));
    process.exit(1);
  }
}
const acceptance = await smokeRecording(client, directory, token);
console.log(JSON.stringify({ ...acceptance, directory }, null, 2));
if (!acceptance.complete) process.exitCode = 1;
