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
const acceptance = await smokeRecording(client, directory, token);
console.log(JSON.stringify({ ...acceptance, directory }, null, 2));
if (!acceptance.complete) process.exitCode = 1;
