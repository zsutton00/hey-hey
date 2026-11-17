import { afterEach, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { StartupDiagnostics } from './startup-diagnostics';
import { StructuredServerLogger } from '../server/logger';
import { DefaultCollectionMissingError } from '../credentials/errors';
import { DockerProcessError } from './docker-process';
import { Clipboard } from './clipboard';
import { TroubleshootingPrompt, PROMPT_FILE } from './troubleshooting-prompt-owner';
import { writeOfflineDocs } from '../../scripts/offline-docs.mjs';
import { version } from '../../package.json';

const secret = 'secret-enrollment-token-and-arbitrary-user-content';
const directories: string[] = [];
const journals: StartupDiagnostics[] = [];
const logger = new StructuredServerLogger({ writeLine: () => undefined });

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'heyhey-troubleshooting-'));
  directories.push(path);
  return path;
}
function journal(path: string, maxBytes = 1024 * 1024) {
  const owner = new StartupDiagnostics(path, { maxFiles: 10, maxBytes }, () => undefined);
  journals.push(owner);
  return owner;
}
async function dockerExecutable(path: string, body: string) {
  await writeFile(join(path, 'docker'), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  vi.stubEnv('PATH', `${path}${delimiter}${process.env['PATH'] ?? ''}`);
}
/** The documentation exactly as the build ships it, generated from the canonical help source. */
async function shippedDocs() {
  const out = join(await directory(), 'docs');
  await writeOfflineDocs({
    helpDirectory: resolve(__dirname, '../../../api/content/help'),
    outDirectory: out,
    version,
  });
  return out;
}
async function owner(clipboard = new Clipboard()) {
  const docs = await shippedDocs();
  const printed: string[] = [];
  const prompts = new TroubleshootingPrompt(
    clipboard,
    version,
    (text) => printed.push(text),
    () => Promise.resolve(docs),
  );
  return { prompts, printed, docs };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const item of journals.splice(0)) {
    await item.finish('cancelled');
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const forbiddenAdvice = [
  'HEYHEY_LOCAL_MODEL_DIR',
  'docker-compose.yml',
  'rm -rf',
  'plaintext fallback',
];

it('hands an agent the Linux keyring failure, where the evidence is, and the shipped guidance', async () => {
  const path = await directory();
  vi.stubEnv('PATH', path);
  const diagnostics = journal(join(path, 'diagnostics'));
  logger.error('local.protected_storage', {
    outcome: 'failed',
    error: new DefaultCollectionMissingError(secret),
  });
  diagnostics.failure();
  const { prompts, docs } = await owner();

  const prepared = await prompts.forCurrentAttempt(diagnostics);

  expect(prepared.text).toContain(diagnostics.attemptId);
  expect(prepared.text).toContain(diagnostics.sessionId);
  expect(prepared.text).toContain(diagnostics.path);
  expect(prepared.text).toContain('DEFAULT_COLLECTION_MISSING');
  expect(prepared.text).toContain(`CLI ${version}`);
  expect(prepared.text).toContain('Container diagnostics unavailable: docker_unavailable');
  expect(prepared.text).toContain(join(docs, 'protected-credential-store-failures.md'));
  expect(prepared.text).not.toContain(secret);
  for (const advice of forbiddenAdvice) {
    expect(prepared.text).not.toContain(advice);
  }
  await expect(stat(diagnostics.path)).resolves.toBeDefined();
  await expect(stat(join(docs, 'local-startup-troubleshooting.md'))).resolves.toBeDefined();
  // What is shown is what is saved, owner-only, outside the journal retention pattern.
  expect(prepared.savedPath).toBe(join(diagnostics.directory, PROMPT_FILE));
  const saved = prepared.savedPath ?? '';
  expect(await readFile(saved, 'utf8')).toBe(prepared.text);
  expect((await stat(saved)).mode & 0o777).toBe(0o600);
});

it('names the Docker refusal and container cause of a restricted Colima mount', async () => {
  const path = await directory();
  await dockerExecutable(
    path,
    `const args = process.argv.slice(2);
if (args[0] === 'ps') process.stdout.write('aaaaaa111111 api');
else if (args[0] === 'logs') process.stdout.write(JSON.stringify({ level: 'error', event: 'api.startup_failed', error: { code: 'EACCES', message: ${JSON.stringify(secret)} } }) + '\\n');`,
  );
  const diagnostics = journal(join(path, 'diagnostics'));
  logger.error('local.application.failure', {
    operation: 'startup',
    action: 'Starting application services',
    error: new DockerProcessError({
      operation: 'compose',
      outcome: 'exit',
      code: 'DOCKER_EXIT',
      exitCode: 1,
      signal: null,
      detail:
        'Error response from daemon: mounts denied: the path /home/dev/.heyhey/local-application/models is not shared from the host',
      truncated: false,
    }),
  });
  logger.error('local.docker.repair_failed', { error: new Error(secret) });
  diagnostics.failure();
  const { prompts } = await owner();

  const { text } = await prompts.forCurrentAttempt(diagnostics);

  expect(text).toContain('Last stage: Starting application services');
  expect(text).toContain('DOCKER_EXIT');
  expect(text).toContain('mounts denied');
  expect(text).toContain('api #0');
  expect(text).toContain('EACCES');
  expect(text).toContain('repair was offered and attempted, and it failed');
  expect(text).not.toContain(secret);
});

it('says plainly that an unrecognised error has an unknown cause and what the containers did not reveal', async () => {
  const path = await directory();
  await dockerExecutable(
    path,
    `const args = process.argv.slice(2);
if (args[0] === 'ps') process.stdout.write('aaaaaa111111 api');
else if (args[0] === 'logs') process.stdout.write('crashed without a known code\\n');`,
  );
  const diagnostics = journal(join(path, 'diagnostics'));
  logger.error('local.application.failure', {
    operation: 'startup',
    action: 'Migrating the application database',
    error: new Error(secret),
  });
  diagnostics.failure();
  const { prompts } = await owner();

  const { text } = await prompts.forCurrentAttempt(diagnostics);

  expect(text).toContain('UNCLASSIFIED_FAILURE');
  expect(text).toContain('original error text was deliberately not saved');
  expect(text).toContain('counts only');
  expect(text).toContain('The real cause was not captured');
  expect(text).not.toContain(secret);
});

it('discloses unsaved evidence, truncation and a partial journal line instead of hiding them', async () => {
  const path = await directory();
  vi.stubEnv('PATH', path);
  const blocker = join(path, 'file');
  await writeFile(blocker, secret);
  const unsaved = journal(join(blocker, 'diagnostics'));
  logger.error('local.protected_storage', { outcome: 'failed', error: new Error(secret) });
  unsaved.failure();
  const { prompts } = await owner();

  const memory = await prompts.forCurrentAttempt(unsaved);

  expect(memory.text).toContain('Diagnostic storage failed (ENOTDIR)');
  expect(memory.text).toContain('could not be read');
  expect(memory.text).toContain('No readable journal file exists');
  expect(memory.savedPath).toBeNull();
  expect(memory.text).not.toContain(secret);

  const small = journal(join(path, 'small'), 3000);
  for (let index = 0; index < 20; index++) {
    logger.error('local.model.download_failed', {
      file: 'tokenizer.json',
      error: new Error(secret),
    });
  }
  small.failure();
  await small.settled();
  await appendFile(small.path, '{"event":"local.docker.prereq');
  const partial = await prompts.forCurrentAttempt(small);
  expect(partial.text).toContain('size limit');
  expect(partial.text).toContain('partial or malformed');
  expect(partial.text).toContain(small.attemptId);
});

it('prints the newest failure after the terminal is gone and reports when there is none', async () => {
  const path = await directory();
  vi.stubEnv('PATH', path);
  const failed = journal(join(path, 'diagnostics'));
  logger.error('local.protected_storage', {
    outcome: 'failed',
    error: new DefaultCollectionMissingError(secret),
  });
  failed.failure();
  await failed.finish('failed');
  await new Promise((done) => setTimeout(done, 5));
  await journal(join(path, 'diagnostics')).finish('success');
  const { prompts, printed } = await owner();

  const later = await prompts.forNewestFailure(join(path, 'diagnostics'));
  expect('missing' in later).toBe(false);
  if ('missing' in later) {
    return;
  }
  expect(later.text).toContain(failed.attemptId);
  expect(later.text).toContain('DEFAULT_COLLECTION_MISSING');
  prompts.print(later);
  expect(printed.join('\n')).toContain(later.text);
  expect(printed.join('\n')).toContain('heyhey local troubleshoot');

  const none = await prompts.forNewestFailure(join(path, 'empty'));
  expect(none).toMatchObject({ missing: expect.stringContaining('could not be read') as string });
});

it('copies exactly the saved text, and falls back to the saved file when the clipboard fails', async () => {
  const path = await directory();
  vi.stubEnv('PATH', path);
  const diagnostics = journal(join(path, 'diagnostics'));
  diagnostics.failure();
  const target = join(path, 'clipboard.txt');
  const working = new Clipboard('linux', 5000, [
    {
      command: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(target)}, require('fs').readFileSync(0))`,
      ],
    },
  ]);
  const copying = await owner(working);
  const prepared = await copying.prompts.forCurrentAttempt(diagnostics);

  expect(await copying.prompts.copy(prepared)).toBe('Copied to clipboard.');
  expect(await readFile(target, 'utf8')).toBe(prepared.text);

  const broken = await owner(
    new Clipboard('linux', 500, [{ command: 'heyhey-no-such-clipboard', args: [] }]),
  );
  const line = await broken.prompts.copy(prepared);
  expect(line).toContain('Clipboard unavailable');
  expect(line).toContain('not installed');
  expect(line).toContain(`Saved to ${prepared.savedPath ?? ''}`);
});
