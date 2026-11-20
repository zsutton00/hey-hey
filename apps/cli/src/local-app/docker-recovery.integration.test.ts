import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parse } from 'yaml';
import { DockerProcess, DockerProcessError } from './docker-process';
import { DockerBoundary } from './docker-boundary';
import { observeServerLogs } from '../server/logger';
import { selectStartupFields } from './startup-diagnostic-boundary';
import { InstallationStore } from './installation-store';
import { composeConfiguration } from './compose';
import { RELEASE_PLATFORMS, type ReleaseManifest } from '../release/release-manifest';
import { LocalApplication } from './local-application';
import { ReleaseSource } from './release-source';
import { ModelDownloader } from './model-downloader';
import { createHash } from 'node:crypto';

const directories: string[] = [];
const unsubscribe: (() => void)[] = [];
afterEach(async () => {
  unsubscribe.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'heyhey-docker-'));
  directories.push(path);
  return path;
}
async function executable(path: string, body: string) {
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 });
}
const image = {
  reference: `example.test/heyhey@sha256:${'a'.repeat(64)}`,
  platforms: [...RELEASE_PLATFORMS],
};
const release = {
  schemaVersion: 1,
  cliVersion: '1.2.3',
  images: { api: image, ui: image, graphSearch: image, postgres: image, redis: image },
} satisfies ReleaseManifest;

async function fixture() {
  const root = await directory();
  const colimaHome = join(root, '.colima');
  const profile = join(colimaHome, 'work');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'docker.sock'), 'socket fixture');
  const configPath = join(profile, 'colima.yaml');
  const config =
    'cpu: 6\nmounts:\n  - location: /unrelated\n    writable: true\n    sshfs:\n      cache: false\n  - location: /another\n    writable: false\nnetwork:\n  address: true\n';
  await writeFile(configPath, config);
  const storage = new InstallationStore(join(root, 'populated-installation'));
  const installation = await storage.prepare(release);
  await mkdir(installation.modelDirectory, { recursive: true });
  const model = Buffer.from('populated verified model fixture');
  await writeFile(join(installation.modelDirectory, 'model_quantized.onnx'), model);
  await writeFile(
    join(storage.directory, 'project-data'),
    'existing projects and installation data',
  );
  const secrets = await storage.secrets();
  await storage.writeCompose(composeConfiguration(installation, secrets, 3851, 3850));
  const state = join(root, 'state.json');
  await writeFile(
    state,
    JSON.stringify({ ready: false, services: [], restartFail: false, mode: 'bind' }),
  );
  await executable(
    join(root, 'docker'),
    `
const fs = require('node:fs');
let a = process.argv.slice(2); const statePath = ${JSON.stringify(state)}; const s = JSON.parse(fs.readFileSync(statePath));
const socket = ${JSON.stringify(`unix://${join(profile, 'docker.sock')}`)};
if (a[0] === '--host' || a[0] === '--context') a = a.slice(2);
if (a[0] === 'context') { process.stdout.write(a[1] === 'show' ? 'arbitrary-name' : JSON.stringify([{Endpoints:{docker:{Host:socket}}}])); }
else if (a[0] === 'ps') process.stdout.write(s.services.join(' '));
else if (a[0] === 'inspect') process.stdout.write(JSON.stringify(s.services.map(service => ({Id:service,Config:{Image:${JSON.stringify(image.reference)},Labels:{'com.docker.compose.service':service,'dev.heyhey.cli-version':'1.2.3'},Env:[]},State:{Running:true,Status:'running',Health:{Status:'healthy'}}}))));
else if (a.includes('up')) {
 const service = a.at(-1);
 if (service === 'graph-search' && !s.ready) { process.stderr.write(s.mode === 'bind' ? 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ' + ${JSON.stringify(installation.modelDirectory)} : 'Error response from daemon: port is already allocated'); process.exitCode=1; }
 else { if(!s.services.includes(service)) s.services.push(service); fs.writeFileSync(statePath,JSON.stringify(s)); }
}`,
  );
  await executable(
    join(root, 'colima'),
    `
const fs = require('node:fs'); const a=process.argv.slice(2); const statePath=${JSON.stringify(state)}; const s=JSON.parse(fs.readFileSync(statePath));
if(a[0]==='version') process.stdout.write('colima version 0.10.3');
else if(a[0]==='list') process.stdout.write(JSON.stringify({name:'work',runtime:'docker',status:'Running'}));
else if(a.includes('ssh')) process.stdout.write(s.ready ? 'visible' : 'absent');
else if(a.includes('restart')) { if(s.restartFail) {process.stderr.write('VM restart refused: permission denied');process.exitCode=9;} else {s.ready=true;fs.writeFileSync(statePath,JSON.stringify(s));} }
`,
  );
  const processBoundary = new DockerProcess(
    { PATH: `${root}${delimiter}${process.env['PATH']}`, HOME: root, COLIMA_HOME: colimaHome },
    1000,
  );
  processBoundary.protect(Object.values(secrets));
  const docker = new DockerBoundary({ attempts: 1, intervalMs: 1 }, processBoundary);
  const manifest = join(root, 'release.json');
  await writeFile(manifest, JSON.stringify(release));
  const models = new ModelDownloader([
    {
      name: 'model_quantized.onnx',
      path: 'model_quantized.onnx',
      sha256: createHash('sha256').update(model).digest('hex'),
    },
  ]);
  const app = new LocalApplication(
    new ReleaseSource(manifest, release.cliVersion),
    storage,
    docker,
    models,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  return { root, docker, storage, configPath, config, state, app };
}

it('keeps a pre-container Docker cause through terminal, logger and diagnostic selection without chunked secrets', async () => {
  const root = await directory();
  const binary = join(root, 'docker');
  await executable(
    binary,
    `process.stderr.write('\\x1b[31minvalid mount config: bind source path does not exist: /Users/person/.heyhey/models\\n'); process.stderr.write('DB_PASSWORD="chunk'); setTimeout(() => {process.stderr.write('ed-secret" https://name:pass@registry.test/image?token=query-secret\\nBearer bearer-secret\\n{\"password\":\"json-secret\"}\\n');process.exit(23)},10);`,
  );
  const boundary = new DockerBoundary(
    undefined,
    new DockerProcess({ PATH: root, EXAMPLE_SECRET: 'chunked-secret' }),
  );
  const lines: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
    lines.push(String(value));
    return true;
  });
  const records: unknown[] = [];
  unsubscribe.push(
    observeServerLogs({
      append: (entry) => {
        const selected = selectStartupFields(entry.event, entry);
        if (selected) records.push(selected);
      },
    }),
  );
  const error = await boundary.startGraphSearch('compose.json').catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DockerProcessError);
  if (!(error instanceof DockerProcessError)) throw new Error('Expected a safe Docker failure');
  expect(error.diagnostic).toMatchObject({
    service: 'graph-search',
    exitCode: 23,
    outcome: 'exit',
    truncated: false,
  });
  const output = [error.message, JSON.stringify(records), lines.join('\n')].join('\n');
  expect(output).toContain('bind source path does not exist');
  expect(output).toContain('/Users/person/.heyhey/models');
  for (const secret of [
    'chunked-secret',
    'name:pass',
    'query-secret',
    'bearer-secret',
    'json-secret',
    '\u001b',
  ])
    expect(output).not.toContain(secret);
});

it.each(['spawn', 'signal', 'timeout', 'output-limit', 'exit'] as const)(
  'captures %s outcomes with bounded sanitized reasons',
  async (outcome) => {
    const root = await directory();
    const binary = join(root, 'command');
    if (outcome !== 'spawn')
      await executable(
        binary,
        outcome === 'signal'
          ? "process.kill(process.pid, 'SIGTERM')"
          : outcome === 'timeout'
            ? 'setInterval(()=>{},1000)'
            : outcome === 'output-limit'
              ? "process.stdout.write('x'.repeat(5*1024*1024))"
              : "process.stderr.write('permission denied\\n' + 'x'.repeat(100000) + 'SECRET=unfinished'); process.exitCode=5",
      );
    const runner = new DockerProcess({}, outcome === 'timeout' ? 80 : 2000);
    const error = await runner.run(binary, [], 'test').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DockerProcessError);
    if (!(error instanceof DockerProcessError)) throw new Error('Expected failure');
    expect(error.diagnostic.outcome).toBe(outcome);
    expect(error.message.length).toBeLessThan(8400);
    if (outcome === 'exit') {
      expect(error.diagnostic.truncated).toBe(true);
      expect(error.message).toContain('permission denied');
      expect(error.message).not.toContain('unfinished');
    }
  },
);

it('repairs shipped Compose startup on a populated installation only after confirmation, preserving every existing share and retrying to readiness', async () => {
  const f = await fixture();
  await f.app.run();
  expect(f.app.state.kind).toBe('docker-repair');
  expect(await f.docker.inspect()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ Id: 'graph-search' })]),
  );
  expect(await readFile(f.configPath, 'utf8')).toBe(f.config);
  f.app.declineDockerRepair();
  expect(f.app.state.kind).toBe('recovery');
  expect(await readFile(f.configPath, 'utf8')).toBe(f.config);
  await f.app.retry();
  expect(f.app.state.kind).toBe('docker-repair');
  await f.app.confirmDockerRepair();
  expect(f.app.state.kind).toBe('ready');
  const repaired: unknown = parse(await readFile(f.configPath, 'utf8'));
  expect(repaired).toMatchObject({
    cpu: 6,
    network: { address: true },
    mounts: [
      { location: '/unrelated', writable: true, sshfs: { cache: false } },
      { location: '/another', writable: false },
      { location: f.storage.modelDirectory, writable: false },
    ],
  });
  expect(await readFile(join(f.storage.directory, 'project-data'), 'utf8')).toBe(
    'existing projects and installation data',
  );
  expect(
    (await readdir(join(f.root, '.colima', 'work'))).some((name) => name.includes('heyhey-backup')),
  ).toBe(true);
  const after = await readFile(f.configPath, 'utf8');
  await f.app.retry();
  expect(await readFile(f.configPath, 'utf8')).toBe(after);
});

it('rejects concurrent configuration changes without overwriting them', async () => {
  const f = await fixture();
  await f.app.run();
  await writeFile(f.configPath, f.config + 'memory: 12\n');
  await f.app.confirmDockerRepair();
  expect(f.app.state).toMatchObject({
    kind: 'recovery',
    message: expect.stringContaining('configuration changed'),
  });
  expect(await readFile(f.configPath, 'utf8')).toBe(f.config + 'memory: 12\n');
});

it('retains both the initiating bind failure and a failed restart', async () => {
  const f = await fixture();
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  state.restartFail = true;
  await writeFile(f.state, JSON.stringify(state));
  await f.app.run();
  await f.app.confirmDockerRepair();
  expect(f.app.state).toMatchObject({
    kind: 'recovery',
    message: expect.stringContaining('bind source path does not exist'),
  });
  expect(f.app.state).toMatchObject({
    message: expect.stringContaining('VM restart refused: permission denied'),
  });
});

it('does not attribute an unrelated Docker refusal to Colima', async () => {
  const f = await fixture();
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  state.mode = 'port';
  await writeFile(f.state, JSON.stringify(state));
  await f.app.run();
  expect(f.app.state).toMatchObject({
    kind: 'recovery',
    message: expect.stringContaining('port is already allocated'),
  });
  expect(JSON.stringify(f.app.state)).not.toContain('Colima');
});

it('honors a remote DOCKER_HOST override instead of a misleading context name', async () => {
  const f = await fixture();
  const boundary = new DockerBoundary(
    undefined,
    new DockerProcess({
      PATH: `${f.root}${delimiter}${process.env['PATH']}`,
      DOCKER_HOST: 'ssh://remote.example',
      HOME: f.root,
    }),
  );
  const error = await boundary
    .startGraphSearch(f.storage.composePath)
    .catch((cause: unknown) => cause);
  if (!(error instanceof DockerProcessError)) throw new Error('Expected failure');
  const diagnosis = await boundary.recovery().diagnose(error, f.storage.modelDirectory);
  expect(diagnosis.repair).toBeUndefined();
  expect(diagnosis.message).toContain('remote');
  expect(diagnosis.message).not.toContain('Colima profile');
});

it('gives exact correction instructions when mount configuration cannot be safely edited', async () => {
  const f = await fixture();
  await writeFile(f.configPath, 'mounts: null\ncpu: 6\n');
  await f.app.run();
  expect(f.app.state).toMatchObject({
    kind: 'recovery',
    message: expect.stringContaining(f.configPath),
  });
  expect(f.app.state).toMatchObject({
    message: expect.stringContaining('retain every existing mount'),
  });
  expect(await readFile(f.configPath, 'utf8')).toBe('mounts: null\ncpu: 6\n');
});

it('prioritizes DOCKER_CONTEXT over DOCKER_HOST and keeps the selected local endpoint', async () => {
  const f = await fixture();
  const boundary = new DockerBoundary(
    undefined,
    new DockerProcess({
      PATH: `${f.root}${delimiter}${process.env['PATH']}`,
      HOME: f.root,
      DOCKER_CONTEXT: 'chosen-context',
      DOCKER_HOST: 'ssh://wrong.example',
    }),
  );
  await boundary.command(['--version']);
  expect(boundary.endpoint).toEqual({
    context: 'chosen-context',
    host: `unix://${join(f.root, '.colima', 'work', 'docker.sock')}`,
  });
});

it('does not offer a missing-share repair when the VM sees the recorded path', async () => {
  const f = await fixture();
  const error = await f.docker
    .startGraphSearch(f.storage.composePath)
    .catch((cause: unknown) => cause);
  if (!(error instanceof DockerProcessError)) throw new Error('Expected failure');
  const state = JSON.parse(await readFile(f.state, 'utf8'));
  state.ready = true;
  await writeFile(f.state, JSON.stringify(state));
  const diagnosis = await f.docker.recovery().diagnose(error, f.storage.modelDirectory);
  expect(diagnosis.repair).toBeUndefined();
  expect(diagnosis.message).toContain('missing VM share is not established');
});

it('makes an already-applied repair idempotent while retaining the recoverable snapshot', async () => {
  const f = await fixture();
  const error = await f.docker
    .startGraphSearch(f.storage.composePath)
    .catch((cause: unknown) => cause);
  if (!(error instanceof DockerProcessError)) throw new Error('Expected failure');
  const diagnosis = await f.docker.recovery().diagnose(error, f.storage.modelDirectory);
  expect(diagnosis.repair).toBeDefined();
  await diagnosis.repair?.apply();
  const config = await readFile(f.configPath, 'utf8');
  await diagnosis.repair?.apply();
  expect(await readFile(f.configPath, 'utf8')).toBe(config);
  const backups = (await readdir(join(f.root, '.colima', 'work'))).filter((name) =>
    name.includes('heyhey-backup'),
  );
  expect(backups).toHaveLength(1);
  expect(await readFile(join(f.root, '.colima', 'work', backups[0] ?? ''), 'utf8')).toBe(f.config);
});
