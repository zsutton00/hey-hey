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
  const record = {
    event: 'local.setup.pairing_status',
    timestamp: new Date().toISOString(),
    enrollmentId: 'enrollment-1',
    machineId: 'machine-1',
    enrollmentState: 'AWAITING_MACHINE_CONFIRMATION',
    pairingState: 'EXPIRED',
    observedAt: '2026-11-17T07:22:43.177Z',
    expiresAt: '2026-11-17T07:22:42.000Z',
    reasonCode: 'enrollment_deadline_elapsed',
    machineCount: 1,
    presentMachineCount: 1,
    machineConnected: false,
    executionReady: false,
    token: 'must-not-export',
  };
  const lines = [
    record,
    {
      event: 'machine_enrollment.activation',
      timestamp: record.timestamp,
      enrollmentId: 'enrollment-1',
      machineId: 'machine-1',
      state: 'CONSUMED',
      reasonCode: 'activation_completed',
      credential: 'private-credential',
    },
    { token: 'unrelated-secret' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
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
  expect(contents).toContain('collection_failed');
  expect(contents).toContain('ENOENT');
});
