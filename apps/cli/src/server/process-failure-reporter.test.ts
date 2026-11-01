import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'process-failure-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const crash = (trigger: string) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `
        const { DiagnosticFeed } = require('./src/server/diagnostic-feed.ts');
        const { StructuredServerLogger } = require('./src/server/logger.ts');
        const { ProcessFailureReporter } = require('./src/server/process-failure-reporter.ts');
        const { installTerminalCapture } = require('./src/tui/terminal-capture.ts');
        const feed = new DiagnosticFeed();
        installTerminalCapture(feed);
        const logger = new StructuredServerLogger({ sink: feed, writeLine: () => {} });
        logger.warn('before.crash', { runId: 'affected-run' });
        new ProcessFailureReporter(logger, feed).start();
        ${trigger}
      `,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, HEYHEY_SESSION_DIR: root, LOG_LEVEL: 'info' },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );

describe('ProcessFailureReporter', () => {
  it.each([
    ['uncaught_exception', "setImmediate(() => { throw new Error('fatal fixture'); });"],
    ['unhandled_rejection', "Promise.reject(new Error('fatal fixture'));"],
  ])('persists %s and prints its stack despite terminal capture', async (kind, trigger) => {
    const result = crash(trigger);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`local.server.${kind}: Error: fatal fixture`);
    expect(result.stdout).toBe('');
    const directory = path.join(root, 'crashes');
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const reportFile = files[0];
    if (!reportFile) throw new Error('Expected a crash report.');
    const reportPath = path.join(directory, reportFile);
    expect(result.stderr).toContain(`Crash report: ${reportPath}`);
    const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(report).toMatchObject({
      event: `local.server.${kind}`,
      error: 'fatal fixture',
    });
    expect(report).toHaveProperty('stack', expect.stringContaining('[eval]'));
    expect(report).toHaveProperty(
      'diagnostics.records',
      expect.arrayContaining([expect.objectContaining({ event: 'before.crash' })]),
    );
    if (process.platform !== 'win32') {
      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
  });

  it('still prints the original fatal error when crash persistence fails', async () => {
    await writeFile(path.join(root, 'crashes'), 'blocked directory');
    const result = crash("Promise.reject(new Error('original failure'));");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error: original failure');
    expect(result.stderr).toContain('Could not save crash report:');
    expect(await readFile(path.join(root, 'crashes'), 'utf8')).toBe('blocked directory');
  });
});
