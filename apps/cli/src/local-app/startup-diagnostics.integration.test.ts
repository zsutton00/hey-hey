import { recordBrowserSessionDiagnostic } from '../../../../packages/ui-common/src/services/browserSessionDiagnostics';
import {
  recordLocalStartupDiagnostic,
  holdStartupDiagnosticTransport,
  sendStartupBrowserEvent,
} from '../../../../packages/ui-common/src/services/localStartupDiagnostics';
import { readCurrentAttemptEvidence } from './troubleshooting-evidence';
import { buildTroubleshootingPrompt } from './troubleshooting-prompt';
import { LocalKeyPairStore } from './local-key-pair-store';
import { afterEach, expect, it, vi } from 'vitest';
import { fsyncSync } from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StartupDiagnostics } from './startup-diagnostics';
import { StartupBrowserDiagnostics } from './startup-browser-diagnostics';
import { StructuredServerLogger } from '../server/logger';
import { LocalApplication } from './local-application';
import { ReleaseSource } from './release-source';
import { InstallationStore } from './installation-store';
import { ModelDownloader } from './model-downloader';
import { DockerBoundary } from './docker-boundary';
import { version } from '../../package.json';
import {
  StorageLockedError,
  DefaultCollectionMissingError,
  PermissionDeniedError,
} from '../credentials/errors';

const directories: string[] = [];
const journals: StartupDiagnostics[] = [];
const terminals: string[] = [];
const secret = 'secret-enrollment-token-and-arbitrary-user-content';
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'heyhey-startup-evidence-'));
  directories.push(path);
  return path;
}
function journal(path: string, maxFiles = 10, maxBytes = 1024 * 1024) {
  const owner = new StartupDiagnostics(path, { maxFiles, maxBytes }, (text) =>
    terminals.push(text),
  );
  journals.push(owner);
  return owner;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const owner of journals.splice(0)) {
    await owner.finish('cancelled');
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  terminals.length = 0;
});
async function records(owner: StartupDiagnostics) {
  return (await readFile(owner.path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
async function dockerExecutable(path: string, body: string) {
  await writeFile(join(path, 'docker'), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  vi.stubEnv('PATH', path + delimiter + process.env['PATH']);
}

it('preserves a pre-container failure and successful retry through real startup orchestration, readable after exit', async () => {
  const path = await directory();
  await dockerExecutable(path, 'process.exit(17)');
  const manifestPath = join(path, 'release-manifest.json');
  const image = {
    reference: `example.test/heyhey@sha256:${'a'.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  };
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      cliVersion: version,
      images: { api: image, ui: image, graphSearch: image, postgres: image, redis: image },
    }),
  );
  const owner = journal(join(path, 'diagnostics'));
  const model = Buffer.from('realistic bounded model fixture');
  const modelFile = {
    name: 'model_quantized.onnx',
    path: 'model_quantized.onnx',
    sha256: createHash('sha256').update(model).digest('hex'),
  };
  const app = new LocalApplication(
    new ReleaseSource(manifestPath, version),
    new InstallationStore(path),
    new DockerBoundary(),
    new ModelDownloader([modelFile], 'https://model.test'),
    process.platform,
    undefined,
    undefined,
    undefined,
    owner,
  );
  await app.run();
  expect(app.state.kind).toBe('prerequisite');
  const firstAttempt = owner.attemptId;
  expect(terminals.join('\n')).toContain(firstAttempt);
  expect(terminals.join('\n')).toContain(owner.path);
  // Existing installation has no models or containers yet. Retry must keep the first failure.
  await dockerExecutable(
    path,
    "if (process.argv[2] === 'ps' || process.argv[2] === 'volume') process.exit(0); process.stdout.write('ready');",
  );
  await app.retry();
  expect(app.state.kind).toBe('installation');
  const observed = ['api', 'ui', 'postgres', 'redis', 'graph-search'].map((service) => ({
    Id: service,
    Config: {
      Image: image.reference,
      Labels: { 'com.docker.compose.service': service, 'dev.heyhey.cli-version': version },
      Env:
        service === 'api'
          ? ['ACCOUNT_PASSKEY_ORIGIN=http://localhost:3850']
          : service === 'ui'
            ? ['VITE_LOCAL_AGENT_PORT=3851', 'VITE_WS_URL=ws://localhost:3850']
            : [],
    },
    HostConfig: { PortBindings: service === 'ui' ? { '5173/tcp': [{ HostPort: '3850' }] } : {} },
    State: { Running: true, Status: 'running', Health: { Status: 'healthy' } },
  }));
  const marker = join(path, 'containers-started');
  await dockerExecutable(
    path,
    `const fs = require('node:fs'); const args = process.argv.slice(2); if (args.includes('up')) fs.writeFileSync(${JSON.stringify(marker)}, 'started'); if (args[0] === 'ps') process.stdout.write(fs.existsSync(${JSON.stringify(marker)}) ? 'abcdef123456' : ''); else if (args[0] === 'inspect') process.stdout.write(${JSON.stringify(JSON.stringify(observed))});`,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(url.startsWith('https://model.test') ? model : '{}')),
  );
  await app.install();
  expect(app.state.kind).toBe('ready');
  // The persisted installation and Compose document contain real generated keys and all services.
  expect(JSON.parse(await readFile(join(path, 'compose.json'), 'utf8')).services).toHaveProperty(
    'api',
  );

  await owner.finish('success');
  const saved = await records(owner);
  expect(saved.find((event) => event.event === 'local.docker.command_failed').error).toMatchObject({
    code: 'DOCKER_EXIT',
    exitCode: 17,
  });
  expect(saved.find((event) => event.previousAttemptId === firstAttempt)).toBeDefined();
  expect(saved.filter((event) => event.event === 'attempt.started')).toHaveLength(2);
  expect(saved.at(-1)).toMatchObject({ event: 'attempt.finished', outcome: 'success' });
  expect(saved.map((event) => event.seq)).toEqual(saved.map((_, index) => index + 1));
  expect((await stat(owner.path)).mode & 0o777).toBe(0o600);
  expect((await stat(owner.directory)).mode & 0o777).toBe(0o700);
});

it.each([StorageLockedError, DefaultCollectionMissingError, PermissionDeniedError])(
  'keeps observed native credential codes and safe causes without content (%s)',
  async (Failure) => {
    const owner = journal(await directory());
    const logger = new StructuredServerLogger({ minLevel: 'error', writeLine: () => {} });
    logger.debug('local.protected_storage', {
      outcome: 'failed',
      error: new Failure(secret, Object.assign(new Error(secret), { code: 'EACCES' })),
      token: secret,
    });
    logger.debug('unrelated.user.content', { message: secret });
    logger.debug('local.pairing.step', { state: 'browser-handoff', userCode: secret });
    await owner.finish('failed');
    const contents = await readFile(owner.path, 'utf8');
    expect(contents).not.toContain(secret);
    expect(contents).toContain('EACCES');
    expect(
      (await records(owner)).find((entry) => entry.event === 'local.protected_storage').error.code,
    ).toBe(new Failure('').code);
  },
);

it('bounds retention and marks truncated evidence instead of claiming complete success', async () => {
  const path = await directory();
  for (let index = 0; index < 4; index++) {
    const owner = journal(path, 2, 2400);
    for (let i = 0; i < 50; i++) {
      owner.record('operation', { operation: 'checking' });
    }
    await owner.finish('success');
    expect(await readFile(owner.path, 'utf8')).toContain('evidence.truncated');
    expect((await stat(owner.path)).size).toBeLessThanOrEqual(2400);
  }
  expect(await readdir(path)).toHaveLength(2);
});

it('still records the failure outcome after the journal reaches its size limit', async () => {
  const owner = journal(await directory(), 10, 4000);
  for (let i = 0; i < 100; i++) {
    owner.record('operation', { operation: 'checking' });
  }
  owner.failure();
  await owner.finish('failed');
  const events = (await records(owner)).map((entry) => entry.event);
  expect(events).toContain('evidence.truncated');
  expect(events).toContain('attempt.failure');
  expect(events.at(-1)).toBe('attempt.finished');
  expect((await stat(owner.path)).size).toBeLessThanOrEqual(4000);
});

it('evicts successful journals before an earlier failed one and links the next launch to it', async () => {
  const path = await directory();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
  const failed = journal(path, 3);
  failed.failure();
  await failed.finish('failed');
  for (let index = 0; index < 4; index++) {
    await pause();
    await journal(path, 3).finish('success');
  }
  await pause();
  const next = journal(path, 3);
  await next.finish('success');
  expect(await readdir(path)).toContain(failed.path.split('/').at(-1));
  const started = (await records(next))[0];
  expect(started.previousAttemptId).toBeNull();
  expect(started.lastFailedAttemptId).toBe(failed.attemptId);
  expect(started.lastFailedSessionId).toBe(failed.sessionId);
});

it('saves bounded startup evidence from failing containers without log content', async () => {
  const path = await directory();
  await dockerExecutable(
    path,
    `const args = process.argv.slice(2);
if (args[0] === 'ps') {
  process.stdout.write(['aaaaaa111111 api', 'bbbbbb222222 redis', 'cccccc333333 api', 'dddddd444444 api'].join('\\n'));
} else if (args[0] === 'logs') {
  if (args.at(-1) === 'bbbbbb222222') process.exit(1);
  process.stdout.write(JSON.stringify({ level: 'error', timestamp: '2026-11-17T07:00:00.000Z', event: 'api.startup_failed', message: ${JSON.stringify(secret)}, error: { code: 'EACCES', message: ${JSON.stringify(secret)}, stack: ${JSON.stringify(secret)} } }) + '\\n' + JSON.stringify({ level: 'info', message: ${JSON.stringify(secret)} }) + '\\n');
  process.stdout.write(JSON.stringify({ level: 'error', timestamp: '2026-11-18T06:02:04.775Z', component: 'Error', errorCode: 'MACHINE_ENROLLMENT_INVALID_TRANSITION', statusCode: 409, message: ${JSON.stringify(secret)} }) + '\\n');
  process.stderr.write('Error: connect ECONNREFUSED ' + ${JSON.stringify(secret)} + '\\n');
}`,
  );
  const owner = journal(join(path, 'journal'));
  owner.failure();
  await owner.finish('failed');

  const contents = await readFile(owner.path, 'utf8');
  expect(contents).not.toContain(secret);
  const evidence = (await records(owner)).filter((entry) => entry.event === 'container.evidence');
  const containers = evidence.filter((entry) => entry.kind === 'local_startup_container');
  const api = containers.find((entry) => entry.service === 'api' && entry.containerIndex === 0);
  expect(api.eventGroups).toEqual([
    expect.objectContaining({
      level: 'error',
      event: 'api.startup_failed',
      cause: { code: 'EACCES' },
      count: 1,
    }),
    expect.objectContaining({
      event: 'Error',
      cause: { code: 'MACHINE_ENROLLMENT_INVALID_TRANSITION', status: 409 },
    }),
  ]);
  expect(api.unstructuredCauseCodes).toEqual({ ECONNREFUSED: 1 });
  expect(containers.find((entry) => entry.service === 'redis')).toMatchObject({
    reasonCode: 'container_collection_failed',
    evidenceIncomplete: true,
  });
  expect(evidence.find((entry) => entry.reasonCode === 'collected')).toMatchObject({
    containerCount: 4,
    omittedContainers: 1,
  });
});

it('says why startup container evidence is unavailable when Docker is absent', async () => {
  const path = await directory();
  vi.stubEnv('PATH', path);
  const owner = journal(join(path, 'journal'));
  owner.failure();
  await owner.finish('failed');
  const evidence = (await records(owner)).filter((entry) => entry.event === 'container.evidence');
  expect(evidence).toContainEqual(
    expect.objectContaining({ kind: 'local_startup_collection', reasonCode: 'docker_unavailable' }),
  );
});

it('keeps the startup cause and reports unavailable storage truthfully', async () => {
  const path = await directory();
  const notDirectory = join(path, 'file');
  await writeFile(notDirectory, secret);
  const owner = journal(join(notDirectory, 'diagnostics'));
  new StructuredServerLogger({ writeLine: () => {} }).error('local.protected_storage', {
    outcome: 'failed',
    error: new StorageLockedError(secret),
  });
  owner.failure();
  await owner.finish('failed');
  const output = terminals.join('\n');
  expect(output).toContain('ENOTDIR');
  expect(output).toContain('STORAGE_LOCKED');
  expect(output).toContain('not fully saved');
  expect(output).not.toContain('saved diagnostic log:');
  expect(output).not.toContain(secret);
});

it.each(['ENOSPC', 'EACCES'])(
  'isolates a disk failure at the actual write boundary (%s)',
  async (code) => {
    const owner = journal(await directory());
    const failure = Object.assign(new Error(secret), { code });
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw failure;
    });
    const logger = new StructuredServerLogger({ writeLine: () => {} });
    expect(() =>
      logger.error('local.protected_storage', {
        outcome: 'failed',
        error: new StorageLockedError(secret),
      }),
    ).not.toThrow();
    owner.failure();
    await owner.finish('failed');
    expect(terminals.join('\n')).toContain(code);
    expect(terminals.join('\n')).toContain('STORAGE_LOCKED');
    expect(terminals.join('\n')).toContain('not fully saved');
  },
);

it('persists an interrupted process without an API or browser and retains it on the next launch', async () => {
  const path = await directory();
  const modulePath = resolve('src/local-app/startup-diagnostics.ts');
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { StartupDiagnostics } from ${JSON.stringify(modulePath)}; const journal = new StartupDiagnostics(${JSON.stringify(path)}); console.log('durable'); setInterval(() => {}, 1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise<void>((resolveReady, reject) => {
    child.stdout.once('data', () => resolveReady());
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) {
        reject(new Error(`child exit ${code}`));
      }
    });
  });
  child.kill('SIGKILL');
  await new Promise((done) => child.once('exit', done));
  const files = await readdir(path);
  const interrupted = await readFile(join(path, files[0]!), 'utf8');
  expect(interrupted).toContain('Incomplete or interrupted');
  expect(
    interrupted
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .some((entry) => entry.event === 'attempt.finished'),
  ).toBe(false);
  const next = journal(path);
  await next.finish('success');
  const previous = JSON.parse(interrupted.trim().split('\n')[0]!);
  expect((await records(next))[0]).toMatchObject({
    previousAttemptId: previous.attemptId,
    previousOutcome: 'interrupted',
  });
  expect(await readdir(path)).toHaveLength(2);
});

it('authenticates browser evidence and bounds both content and event count', async () => {
  const owner = journal(await directory());
  const origin = 'http://localhost:3850';
  const listener = new StartupBrowserDiagnostics(owner, origin);
  await listener.start();
  try {
    const fragment = new URLSearchParams(
      new URL(listener.decorate(`${origin}/local`)).hash.slice(1),
    );
    const target = `http://127.0.0.1:${fragment.get('diagnosticPort')}/local-startup/events`;
    const headers = { Origin: origin, 'X-HeyHey-Diagnostic': fragment.get('diagnosticToken')! };
    expect(
      (
        await fetch(target, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://unrelated.test' },
          body: 'mounted',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(target, {
          method: 'POST',
          headers: { ...headers, 'X-HeyHey-Diagnostic': 'x'.repeat(43) },
          body: 'mounted',
        })
      ).status,
    ).toBe(403);
    expect((await fetch(target, { method: 'POST', headers, body: secret })).status).toBe(400);
    const browserStorage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => browserStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        browserStorage.set(key, value);
      },
    });
    holdStartupDiagnosticTransport(new URL(listener.decorate(`${origin}/local`)).hash);
    const nativeFetch = globalThis.fetch;
    // Browsers supply Origin; Node's fetch does not. Keep the real HTTP transport.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      nativeFetch(url, { ...init, headers: { ...init.headers, Origin: origin } }),
    );
    sendStartupBrowserEvent(`handoff: failed (${secret})`);
    await vi.waitFor(async () => {
      expect(await readFile(owner.path, 'utf8')).toContain('handoff_failed');
    });
    vi.stubGlobal('fetch', nativeFetch);
    for (let index = 0; index < 119; index++) {
      await fetch(target, { method: 'POST', headers, body: 'mounted' });
    }
    expect((await fetch(target, { method: 'POST', headers, body: 'mounted' })).status).toBe(429);
    await owner.finish('failed');
    const contents = await readFile(owner.path, 'utf8');
    expect(contents).toContain('handoff_failed');
    expect(contents).toContain('browser.evidence.truncated');
    expect(contents).not.toContain(secret);
    expect(contents).not.toContain(headers['X-HeyHey-Diagnostic']);
  } finally {
    listener.close();
  }
});

it('captures the native credential boundary without altering populated keyring entries', async () => {
  const owner = journal(await directory());
  const entries = new Map([
    ['foreign:machine-key', secret],
    ['heyhey-local-cli:existing-machine', secret],
  ]);
  const before = new Map(entries);
  const keys = new LocalKeyPairStore((service, account) => ({
    setPassword: () => {
      throw Object.assign(new Error(`Access denied ${secret}`), { code: 'EACCES' });
    },
    getPassword: () => entries.get(`${service}:${account}`) ?? null,
    deletePassword: () => entries.delete(`${service}:${account}`),
  }));
  await expect(keys.ensureProtectedStorageReady()).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  });
  await owner.finish('failed');
  const contents = await readFile(owner.path, 'utf8');
  expect(contents).toContain('local.credential.operation_failed');
  expect(contents).toContain('PERMISSION_DENIED');
  expect(contents).toContain('EACCES');
  expect(contents).not.toContain(secret);
  expect(entries).toEqual(before);
});

it('carries the local setup failure timeline through the real browser listener into the offline agent prompt', async () => {
  const owner = journal(await directory());
  const origin = 'http://localhost:3850';
  const listener = new StartupBrowserDiagnostics(owner, origin);
  await listener.start();
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const nativeFetch = globalThis.fetch;
  try {
    const target = new URL(listener.decorate(`${origin}/local?pairing=started`));
    holdStartupDiagnosticTransport(target.hash);
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      nativeFetch(url, { ...init, headers: { ...init.headers, Origin: origin } }),
    );
    recordLocalStartupDiagnostic('setup_view', { view: 'name' });
    recordLocalStartupDiagnostic('passkey_inventory', { passkeyCount: 0 });
    recordLocalStartupDiagnostic('setup_status', {
      nameSaved: true,
      machineConnected: false,
      hasProjects: true,
      setupUnfinished: true,
    });
    recordLocalStartupDiagnostic('passkey_registration_started');
    recordBrowserSessionDiagnostic('socket_renewal_started', { reason: 'terminal_socket_auth' });
    recordBrowserSessionDiagnostic('auth_renewal_failed', {
      status: 401,
      reason: 'request_failed',
    });
    recordBrowserSessionDiagnostic('auth_cleared', { authenticated: true });
    recordLocalStartupDiagnostic('setup_redirect', {
      destination: 'login',
      reason: 'unauthenticated',
    });
    await vi.waitFor(async () => {
      expect(
        (await records(owner)).filter((entry) => entry.event === 'browser.setup'),
      ).toHaveLength(8);
    });
    expect(owner.hasFailed).toBe(false);
    const evidence = await readCurrentAttemptEvidence(owner);
    expect(evidence.browserTimeline?.map((entry) => entry.state)).toEqual([
      'setup_view',
      'passkey_inventory',
      'setup_status',
      'passkey_registration_started',
      'socket_renewal_started',
      'auth_renewal_failed',
      'auth_cleared',
      'setup_redirect',
    ]);
    const sequences = evidence.browserTimeline!.map((entry) => entry.browserSequence!);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    const prompt = buildTroubleshootingPrompt({
      evidence,
      docs: { found: false, reason: 'not installed in this fixture' },
      runningCliVersion: version,
    });
    expect(prompt).toContain('"passkeyCount":0');
    expect(prompt).toContain('"machineConnected":false');
    expect(prompt).toContain('"status":401');
    expect(prompt).toContain('"destination":"login"');
    const token = new URLSearchParams(target.hash.slice(1)).get('diagnosticToken')!;
    expect(prompt).not.toContain(token);
    const endpoint = `http://127.0.0.1:${new URLSearchParams(target.hash.slice(1)).get('diagnosticPort')}/local-startup/events`;
    const rejected = await nativeFetch(endpoint, {
      method: 'POST',
      headers: { Origin: origin, 'X-HeyHey-Diagnostic': token },
      body: JSON.stringify({
        event: 'auth_state',
        sequence: 99,
        observedAt: new Date().toISOString(),
        facts: { token: secret },
      }),
    });
    expect(rejected.status).toBe(400);
    expect(await readFile(owner.path, 'utf8')).not.toContain(secret);
  } finally {
    vi.stubGlobal('fetch', nativeFetch);
    listener.close();
  }
});
