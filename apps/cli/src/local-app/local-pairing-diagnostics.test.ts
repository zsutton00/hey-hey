import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiagnosticFeed } from '../server/diagnostic-feed';
import { writeDiagnosticExport } from '../server/diagnostic-feed-export';

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

it('exports API pairing evidence with CLI logs, excluding unrelated output and secret fields', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-pairing-export-'));
  const lines = await readFile(
    path.join(__dirname, '__fixtures__', 'local-pairing-production.jsonl'),
    'utf8',
  );
  await writeFile(
    path.join(directory, 'docker'),
    `#!${process.execPath}\nprocess.stdout.write(process.argv[2] === 'ps' ? 'abc123' : ${JSON.stringify(lines)});\n`,
    { mode: 0o700 },
  );
  vi.stubEnv('PATH', directory + path.delimiter + process.env['PATH']);
  const destination = path.join(directory, 'export.jsonl');
  await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination, true);
  const contents = await readFile(destination, 'utf8');
  expect(contents).toContain('enrollment_deadline_elapsed');
  expect(contents).toContain('AWAITING_MACHINE_CONFIRMATION');
  expect(contents).toContain('machine_enrollment.activation');
  expect(contents).not.toContain('private-credential');
  expect(contents).not.toContain('must-not-export');
  expect(contents).not.toContain('unrelated-secret');
  expect(contents).toContain('"reasonCode":"collected"');
});

it('preserves the CLI export and explains when Docker cannot be read', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-pairing-export-'));
  vi.stubEnv('PATH', directory);
  const destination = path.join(directory, 'export.jsonl');
  await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination, true);
  const contents = await readFile(destination, 'utf8');
  expect(contents).toContain('diagnostic_metadata');
  expect(contents).toContain('docker_unavailable');
  expect(contents).toContain('ENOENT');
});

it('retains available evidence when another API container fails and caps container discovery', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-pairing-export-'));
  const record = {
    event: 'machine_enrollment.activation',
    timestamp: '2026-11-17T07:22:43.177Z',
    enrollmentId: '11111111-1111-4111-8111-111111111111',
    machineId: '22222222-2222-4222-8222-222222222222',
    state: 'CONSUMED',
    reasonCode: 'activation_succeeded',
    token: 'secret-value',
  };
  const calls = path.join(directory, 'calls.jsonl');
  await writeFile(
    path.join(directory, 'docker'),
    `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'ps') process.stdout.write('abc123\\ndef456\\naaa111');
else if (process.argv.at(-1) === 'def456') process.exit(23);
else process.stdout.write(${JSON.stringify(`${JSON.stringify(record)}\n`.repeat(2000))});
`,
    { mode: 0o700 },
  );
  vi.stubEnv('PATH', directory + path.delimiter + process.env['PATH']);
  const destination = path.join(directory, 'export.jsonl');
  await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination, true);
  const contents = await readFile(destination, 'utf8');
  expect(contents).toContain('activation_succeeded');
  expect(contents).toContain('container_collection_failed');
  expect(contents).toContain('"exitCode":23');
  expect(contents).toContain('"potentiallyTruncated":true');
  expect(contents).toContain('"omittedContainers":1');
  expect(contents).not.toContain('secret-value');
  const invocations = (await readFile(calls, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(invocations.slice(1)).toEqual([
    ['logs', '--since', '2h', '--tail', '2000', 'abc123'],
    ['logs', '--since', '2h', '--tail', '2000', 'def456'],
  ]);
});

it('distinguishes absent containers from failed Docker discovery', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'local-pairing-export-'));
  const executable = path.join(directory, 'docker');
  vi.stubEnv('PATH', directory + path.delimiter + process.env['PATH']);
  const destination = path.join(directory, 'export.jsonl');
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
  await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination, true);
  expect(await readFile(destination, 'utf8')).toContain('api_container_absent');
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(7);\n`, { mode: 0o700 });
  await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination, true);
  const contents = await readFile(destination, 'utf8');
  expect(contents).toContain('docker_discovery_failed');
  expect(contents).toContain('"exitCode":7');
});
