import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalApplication } from './local-application';
import { ReleaseSource } from './release-source';
import { ReleasePackage } from './release-package';
import { InstallationStore } from './installation-store';
import { DockerBoundary, type ObservedContainer } from './docker-boundary';
import { SERVICE_IMAGES } from './compose';
import { DEFAULT_LOCAL_BRIDGE_PORT, resolveLocalBridgePort } from './local-port';
import { RELEASE_PLATFORMS, type ReleaseManifest } from '../release/release-manifest';

const image = (name: string) => ({
  reference: `example.test/heyhey/${name}@sha256:${'a'.repeat(64)}`,
  platforms: [...RELEASE_PLATFORMS],
});
const release = {
  schemaVersion: 1,
  cliVersion: '1.2.3',
  images: {
    api: image('api'),
    ui: image('ui'),
    graphSearch: image('graph-search'),
    postgres: image('postgres'),
    redis: image('redis'),
  },
} satisfies ReleaseManifest;
function containers(
  running: boolean,
  manifest = release,
  bridgePort = DEFAULT_LOCAL_BRIDGE_PORT,
): ObservedContainer[] {
  return Object.entries(SERVICE_IMAGES).map(([service, name]) => ({
    Id: service,
    Config: {
      Image: manifest.images[name].reference,
      Env: service === 'ui' ? [`VITE_LOCAL_AGENT_PORT=${bridgePort}`] : [],
      Labels: {
        'com.docker.compose.service': service,
        'dev.heyhey.cli-version': manifest.cliVersion,
      },
    },
    State: {
      Running: running,
      Status: running ? 'running' : 'exited',
      Health: { Status: running ? 'healthy' : 'starting' },
    },
  }));
}

/** Fake only the Docker process boundary, retaining production parsing and orchestration. */
class FakeDocker extends DockerBoundary {
  constructor() {
    super({ attempts: 4, intervalMs: 1 });
  }
  availableRelease = release;
  calls: string[][] = [];
  timeline: string[] = [];
  startupSequences = new Map<string, ObservedContainer['State'][]>();
  private pendingStates = new Map<string, ObservedContainer['State'][]>();
  apiKeyDelays = 0;
  private keyProbes = 0;
  private apiKeysReady = false;

  signingKeysAvailable(): boolean {
    this.keyProbes++;
    const api = this.observed.find((container) => container.Id === 'api');
    const ready =
      api?.State.Running === true &&
      api.State.Health?.Status === 'healthy' &&
      this.keyProbes > this.apiKeyDelays;
    this.apiKeysReady = ready;
    this.timeline.push(ready ? 'jwks:ready' : 'jwks:waiting');
    return ready;
  }
  observed: ObservedContainer[] = [];
  prerequisiteFailure: 'missing' | 'stopped' | 'compose' | undefined;
  failedService: string | undefined;
  failMigration = false;
  orphanedStorage = false;
  override command(args: string[]): Promise<string> {
    this.calls.push(args);
    if (
      (args[0] === '--version' && this.prerequisiteFailure === 'missing') ||
      (args[0] === 'info' && this.prerequisiteFailure === 'stopped') ||
      (args[0] === 'compose' && args[1] === 'version' && this.prerequisiteFailure === 'compose')
    ) {
      throw new Error('Unavailable');
    }
    if (args[0] === 'volume') {
      return Promise.resolve(this.orphanedStorage ? 'heyhey-local_postgres-data' : '');
    }
    if (args[0] === 'ps') {
      return Promise.resolve(this.observed.map((c) => c.Id).join('\n'));
    }
    if (args[0] === 'inspect') {
      for (const container of this.observed) {
        const next = this.pendingStates.get(container.Id)?.shift();
        if (next) {
          container.State = next;
        }
      }
      return Promise.resolve(JSON.stringify(this.observed));
    }
    if (args.includes('stop')) {
      for (const container of this.observed) {
        container.State = { Running: false, Status: 'exited' };
      }
      this.pendingStates.clear();
    }
    if (args.includes('migrate') && this.failMigration) {
      throw new Error('Check API migration diagnostics, then retry.');
    }
    if (args.includes('up')) {
      const service = args.at(-1);
      const fixture = containers(true, this.availableRelease).find(
        (container) => container.Id === service,
      );
      if (!service || !fixture) {
        throw new Error('Unknown fixture service');
      }
      this.timeline.push(`up:${service}`);
      if (service === 'api') {
        this.apiKeysReady = false;
      }
      if (service === 'graph-search' && !this.apiKeysReady) {
        throw new Error('Graph/search cannot load the API signing keys yet');
      }
      this.observed = [...this.observed.filter((container) => container.Id !== service), fixture];
      const sequence = this.startupSequences.get(service) ?? [fixture.State];
      this.pendingStates.set(service, structuredClone(sequence));
      if (service === this.failedService) {
        this.pendingStates.set(service, [
          { Running: true, Status: 'running', Health: { Status: 'unhealthy' } },
        ]);
      }
    }
    return Promise.resolve('');
  }
}

function recoveryMessage(app: LocalApplication): string {
  if (app.state.kind !== 'recovery') {
    throw new Error('Expected local startup recovery');
  }
  return app.state.message;
}

let directory: string;
let models: string;
let docker: FakeDocker;
let storage: InstallationStore;
let source: ReleaseSource;
const application = () => new LocalApplication(source, storage, docker, models, 'darwin');
const mutated = () =>
  docker.calls.filter(
    (args) =>
      args.includes('up') || args.includes('run') || args.includes('pull') || args.includes('exec'),
  );

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'heyhey-local-test-'));
  models = join(directory, 'models');
  await mkdir(models);
  await writeFile(join(models, 'model_quantized.onnx'), 'fixture');
  await writeFile(join(models, 'tokenizer.json'), '{}');
  await writeFile(join(directory, 'release.json'), JSON.stringify(release));
  source = new ReleaseSource(join(directory, 'release.json'), release.cliVersion);
  storage = new InstallationStore(join(directory, 'installation'));
  docker = new FakeDocker();
  vi.stubEnv('HEYHEY_SERVER_PORT', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: docker.signingKeysAvailable() })),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('local application installation and return visits', () => {
  it('requires consent, installs a fixture release and persists protected storage across owners', async () => {
    const app = application();
    await app.run();
    expect(app.state.kind).toBe('installation');
    expect(mutated()).toEqual([]);
    expect(await readdir(directory)).not.toContain('installation');
    await app.install();
    expect(app.state).toMatchObject({
      kind: 'ready',
      url: 'http://localhost:5173/local',
      bridgeConnected: false,
      executionAuthorized: false,
    });
    expect(docker.calls.some((args) => args.includes('pull'))).toBe(true);
    expect(docker.calls.some((args) => args.includes('migrate'))).toBe(true);
    const persisted = await storage.read();
    expect(persisted?.release).toEqual(release);
    const secrets = await storage.secrets();
    const returned = new InstallationStore(storage.directory);
    expect(await returned.secrets()).toEqual(secrets);
    for (const name of ['installation.json', 'secrets.json', 'compose.json']) {
      expect((await stat(join(storage.directory, name))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(storage.directory)).mode & 0o777).toBe(0o700);
  });

  it('starts a stopped installation without reinstalling images or replacing secrets', async () => {
    await storage.prepare(release, models);
    const before = await storage.secrets();
    docker.observed = containers(false);
    const app = application();
    await app.run();
    expect(app.state.kind).toBe('ready');
    expect(docker.calls.some((args) => args.includes('up'))).toBe(true);
    expect(docker.calls.some((args) => args.includes('pull'))).toBe(false);
    expect(await storage.secrets()).toEqual(before);
  });

  it('checks a running installation without pulling, migrating or starting anything', async () => {
    await storage.prepare(release, models);
    docker.observed = containers(true);
    const app = application();
    await app.run();
    expect(app.state.kind).toBe('ready');
    expect(mutated()).toEqual([]);
    expect(fetch).toHaveBeenCalled();
  });

  it('tells the web app the bridge port without disturbing hosted ports', () => {
    expect(DEFAULT_LOCAL_BRIDGE_PORT).not.toBeOneOf([3847, 3848, 3849]);
    expect(resolveLocalBridgePort({})).toBe(DEFAULT_LOCAL_BRIDGE_PORT);
    expect(resolveLocalBridgePort({ HEYHEY_SERVER_PORT: '4100' })).toBe(4100);
    expect(resolveLocalBridgePort({ HEYHEY_SERVER_PORT: 'nope' })).toBe(DEFAULT_LOCAL_BRIDGE_PORT);
  });

  it('writes the bridge port into the UI container configuration', async () => {
    const installation = await storage.prepare(release, models);
    const { composeConfiguration } = await import('./compose');
    const config = composeConfiguration(installation, await storage.secrets(), 4100);
    expect(config.services.ui.environment.VITE_LOCAL_AGENT_PORT).toBe('4100');
  });

  it('reconfigures a running UI that does not know the bridge port, keeping data and secrets', async () => {
    await storage.prepare(release, models);
    const before = await storage.secrets();
    docker.observed = containers(true, release, 3847);
    const app = new LocalApplication(source, storage, docker, models, 'darwin', undefined, 4100);
    await app.run();
    expect(app.state.kind).toBe('ready');
    expect(mutated().map((args) => args.at(-1))).toEqual(['ui']);
    expect(mutated().some((args) => args.includes('pull') || args.includes('run'))).toBe(false);
    const written = JSON.parse(await readFile(storage.composePath, 'utf8'));
    expect(written.services.ui.environment.VITE_LOCAL_AGENT_PORT).toBe('4100');
    expect(await storage.secrets()).toEqual(before);
  });

  it.each(['missing', 'stopped', 'compose'] as const)(
    'reports Docker %s with retry and no installation side effects',
    async (failure) => {
      docker.prerequisiteFailure = failure;
      const app = application();
      await app.run();
      expect(app.state.kind).toBe('prerequisite');
      expect(mutated()).toEqual([]);
      docker.prerequisiteFailure = undefined;
      await app.retry();
      expect(app.state.kind).toBe('installation');
      app.cancel();
      expect(app.state.kind).toBe('cancelled');
    },
  );

  it('rejects both stored and observed release mismatches before mutation, including retry', async () => {
    const other = structuredClone(release);
    other.cliVersion = '1.2.2';
    await storage.prepare(other, models);
    const before = await readFile(join(storage.directory, 'secrets.json'), 'utf8');
    const app = application();
    await app.run();
    await app.retry();
    expect(app.state).toMatchObject({ kind: 'update', required: true, release });
    await app.declineUpdate();
    expect(app.state.kind).toBe('cancelled');
    expect(mutated()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(join(storage.directory, 'secrets.json'), 'utf8')).toBe(before);
  });

  it.each(['version', 'digest', 'unknown'] as const)(
    'rejects an observed %s mismatch even with matching storage',
    async (mismatch) => {
      await storage.prepare(release, models);
      docker.observed = containers(false);
      const container = docker.observed[0];
      if (!container?.Config.Labels) {
        throw new Error('Expected labelled API fixture container');
      }
      if (mismatch === 'digest') {
        container.Config.Image = image('wrong-image').reference;
      }
      if (mismatch === 'version') {
        container.Config.Labels['dev.heyhey.cli-version'] = 'different';
      }
      if (mismatch === 'unknown') {
        container.Config.Labels['com.docker.compose.service'] = 'unknown';
      }
      const before = await storage.secrets();
      const app = application();
      await app.run();
      await app.retry();
      expect(recoveryMessage(app)).toContain('release differs');
      expect(mutated()).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(await storage.secrets()).toEqual(before);
    },
  );

  it('preserves durable data and secrets after service failure and recovery', async () => {
    const app = application();
    docker.failedService = 'graph-search';
    await app.install();
    expect(recoveryMessage(app)).toContain('graph-search');
    const before = await storage.secrets();
    await writeFile(join(storage.directory, 'independent-user-data'), 'keep');
    docker.failedService = undefined;
    docker.observed = containers(false);
    await app.retry();
    expect(app.state.kind).toBe('ready');
    expect(await storage.secrets()).toEqual(before);
    expect(await readFile(join(storage.directory, 'independent-user-data'), 'utf8')).toBe('keep');
    expect(docker.calls.flat()).not.toContain('down');
    expect(
      docker.calls.some(
        (args) => args[0] === 'volume' && (args.includes('rm') || args.includes('prune')),
      ),
    ).toBe(false);
    expect(docker.calls.flat()).not.toContain('rm');
  });

  it('waits through delayed API signing-key readiness before launching graph/search', async () => {
    docker.apiKeyDelays = 2;
    const app = application();
    await app.install();
    expect(app.state.kind).toBe('ready');
    expect(docker.timeline.filter((event) => event === 'jwks:waiting')).toHaveLength(2);
    expect(docker.timeline.indexOf('up:graph-search')).toBeGreaterThan(
      docker.timeline.indexOf('jwks:ready'),
    );
  });

  it('waits for API signing keys after a transient connection refusal', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'));
    const app = application();
    await app.install();
    expect(app.state.kind).toBe('ready');
    expect(docker.timeline.indexOf('up:graph-search')).toBeGreaterThan(
      docker.timeline.indexOf('jwks:ready'),
    );
  });

  it('does not launch graph/search when API signing keys remain unavailable', async () => {
    docker.apiKeyDelays = 100;
    const app = application();
    await app.install();
    expect(recoveryMessage(app)).toContain('api signing keys');
    expect(docker.timeline).not.toContain('up:graph-search');
    const before = await storage.secrets();
    docker.apiKeyDelays = 0;
    await app.retry();
    expect(app.state.kind).toBe('ready');
    expect(await storage.secrets()).toEqual(before);
    expect(docker.calls.flat()).not.toContain('down');
  });

  it.each(['api', 'graph-search'])(
    'allows %s to recover from a transient restart before reporting ready',
    async (service) => {
      docker.startupSequences.set(service, [
        { Running: true, Status: 'restarting', Health: { Status: 'healthy' } },
        { Running: true, Status: 'running', Health: { Status: 'starting' } },
        { Running: true, Status: 'running', Health: { Status: 'healthy' } },
      ]);
      const app = application();
      await app.install();
      expect(app.state.kind).toBe('ready');
      const recovered = docker.observed.find((container) => container.Id === service);
      expect(recovered?.State).toEqual({
        Running: true,
        Status: 'running',
        Health: { Status: 'healthy' },
      });
      expect(docker.timeline.indexOf('up:graph-search')).toBeGreaterThan(
        docker.timeline.indexOf('jwks:ready'),
      );
    },
  );

  it.each(['unhealthy', 'exited'])(
    'keeps graph/search stopped when the API remains %s',
    async (status) => {
      docker.startupSequences.set('api', [
        {
          Running: status !== 'exited',
          Status: status === 'exited' ? 'exited' : 'running',
          Health: { Status: status },
        },
      ]);
      const app = application();
      await app.install();
      expect(recoveryMessage(app)).toContain(
        `api: ${status === 'exited' ? 'exited' : 'running (unhealthy)'}`,
      );
      expect(docker.timeline).not.toContain('up:graph-search');
      expect(docker.calls.filter((args) => args[0] === 'inspect')).toHaveLength(4);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('names a persistently restarting service and preserves storage on bounded retry', async () => {
    docker.startupSequences.set('graph-search', [{ Running: false, Status: 'restarting' }]);
    const app = application();
    await app.install();
    expect(recoveryMessage(app)).toContain('graph-search: restarting');
    const before = await storage.secrets();
    await app.retry();
    expect(recoveryMessage(app)).toContain('graph-search: restarting');
    expect(await storage.secrets()).toEqual(before);
    expect(docker.calls.flat()).not.toContain('down');
    expect(docker.calls.flat()).not.toContain('rm');
  });

  it('never starts application services after migration failure', async () => {
    docker.failMigration = true;
    const app = application();
    await app.install();
    expect(recoveryMessage(app)).toContain('migration');
    expect(docker.calls.some((args) => args.includes('up') && args.includes('api'))).toBe(false);
    docker.failMigration = false;
    await app.retry();
    expect(app.state.kind).toBe('ready');
  });

  it('preserves orphaned volumes when installation identity is missing', async () => {
    docker.orphanedStorage = true;
    const app = application();
    await app.run();
    await app.retry();
    expect(recoveryMessage(app)).toContain('Restore installation.json');
    expect(mutated()).toEqual([]);
    expect(await storage.read()).toBeUndefined();
    expect(docker.calls.some((args) => args[0] === 'volume' && args.includes('rm'))).toBe(false);
  });

  it('reports missing model files before creating storage or pulling images', async () => {
    models = join(directory, 'missing-models');
    const app = application();
    await app.install();
    expect(recoveryMessage(app)).toContain('HEYHEY_LOCAL_MODEL_DIR');
    expect(await storage.read()).toBeUndefined();
    expect(mutated()).toEqual([]);
  });

  it('does not replace a damaged durable identity or missing secrets', async () => {
    await storage.prepare(release, models);
    await writeFile(join(storage.directory, 'secrets.json'), 'damaged');
    docker.observed = containers(false);
    const app = application();
    await app.run();
    await app.retry();
    expect(recoveryMessage(app)).toContain('Restore protected');
    expect(await readFile(join(storage.directory, 'secrets.json'), 'utf8')).toBe('damaged');
    expect(mutated()).toEqual([]);
    await writeFile(join(storage.directory, 'installation.json'), 'damaged');
    await app.retry();
    expect(recoveryMessage(app)).toContain('identity is unreadable');
  });

  it('generates only pinned images, loopback app ports, private databases and no hosted credentials', async () => {
    const installation = await storage.prepare(release, models);
    const { composeConfiguration } = await import('./compose');
    const config = composeConfiguration(
      installation,
      await storage.secrets(),
      DEFAULT_LOCAL_BRIDGE_PORT,
    );
    const expectedImages = Object.values(release.images).map((image) => image.reference);
    for (const service of Object.values(config.services)) {
      expect(expectedImages).toContain(service.image);
      if ('ports' in service) {
        expect(service.ports.every((port) => port.startsWith('127.0.0.1:'))).toBe(true);
      }
    }
    expect(config.services.postgres).not.toHaveProperty('ports');
    expect(config.services.redis).not.toHaveProperty('ports');
    expect(config.services['graph-search']).not.toHaveProperty('ports');
    expect(config.services.api.environment.DEPLOYMENT_ENVIRONMENT).toBe('local');
    expect(JSON.stringify(config)).not.toMatch(
      /TEMPORAL|CLAUDE_API_KEY|OPENAI_API_KEY|SYNTHETIC_LLM_API_KEY/,
    );
    expect(config.services.api.environment.GRAPH_SERVICE_URL).toBe(
      config.services.api.environment.EMBEDDINGS_SERVICE_URL,
    );
    expect(config.services['graph-search'].environment.GRAPH_SEARCH_DATABASE_URL).toContain(
      '/heyhey_graph_search',
    );
  });

  it('dev mode runs only pinned infrastructure on loopback and derives the API configuration from the installed definition', async () => {
    const installation = await storage.prepare(release, models);
    const secrets = await storage.secrets();
    const {
      composeConfiguration,
      devComposeConfiguration,
      localApiEnvironment,
      DEV_INFRASTRUCTURE_ENDPOINTS,
    } = await import('./compose');
    const installed = composeConfiguration(installation, secrets, DEFAULT_LOCAL_BRIDGE_PORT);
    const dev = devComposeConfiguration(
      installation,
      secrets,
      DEFAULT_LOCAL_BRIDGE_PORT,
      '/flyway',
    );

    expect(dev.name).toBe(installed.name);
    expect(dev.volumes).toEqual(installed.volumes);
    expect(dev.services).not.toHaveProperty('ui');
    expect(dev.services.api).not.toHaveProperty('ports');
    for (const name of ['postgres', 'redis', 'graph-search'] as const) {
      expect(dev.services[name].image).toBe(installed.services[name].image);
      expect(dev.services[name].ports.every((port) => port.startsWith('127.0.0.1:'))).toBe(true);
    }

    const hostApi = localApiEnvironment(secrets, DEV_INFRASTRUCTURE_ENDPOINTS);
    const addressKeys = /URL|HOST|PORT/;
    for (const [key, value] of Object.entries(installed.services.api.environment)) {
      if (!addressKeys.test(key)) {
        expect(hostApi[key as keyof typeof hostApi]).toBe(value);
      }
    }
    expect(hostApi.PROJECT_DATABASE_URL).toContain('127.0.0.1:55432');
    expect(hostApi.GRAPH_SERVICE_URL).toBe('http://127.0.0.1:58090');
  });

  it('fixture releases cannot bypass packaged version or digest validation', async () => {
    await expect(
      new ReleaseSource(join(directory, 'release.json'), 'other-version').read(),
    ).rejects.toThrow('package.json');
    const invalid = structuredClone(release);
    invalid.images.api.reference = 'example.test/api:latest';
    await writeFile(join(directory, 'release.json'), JSON.stringify(invalid));
    await expect(source.read()).rejects.toThrow('digest');
    await expect(
      new ReleaseSource(join(directory, 'absent.json'), release.cliVersion).read(),
    ).rejects.toThrow('manifest is missing');
  });
});

class FixturePackage extends ReleasePackage {
  installed: ReleaseManifest[] = [];
  availableRelease = structuredClone(release);
  constructor() {
    super();
    this.availableRelease.cliVersion = '1.2.4';
    for (const image of Object.values(this.availableRelease.images)) {
      image.reference = image.reference.replace('a'.repeat(64), 'b'.repeat(64));
    }
  }
  override async newerThan(): Promise<ReleaseManifest> {
    return this.availableRelease;
  }
  override async install(target: ReleaseManifest): Promise<void> {
    expect(await storage.updateConsent()).toEqual({ from: release, target });
    this.installed.push(target);
  }
}

it('offers the complete newer fixture release without mutation; declining keeps the matched installation usable', async () => {
  await storage.prepare(release, models);
  docker.observed = containers(true);
  const packages = new FixturePackage();
  const app = new LocalApplication(source, storage, docker, models, 'darwin', packages);
  await app.run();
  expect(app.state).toEqual({
    kind: 'update',
    required: false,
    activeCount: 0,
    release: packages.availableRelease,
  });
  expect(mutated()).toEqual([]);
  expect(packages.installed).toEqual([]);
  expect(await storage.updateConsent()).toBeUndefined();
  await app.declineUpdate();
  expect(app.state.kind).toBe('ready');
  expect(mutated()).toEqual([]);
});

it('records coordinated consent before package install, then repairs a partial image update on retry without removing data', async () => {
  await storage.prepare(release, models);
  docker.observed = containers(true);
  const packages = new FixturePackage();
  const app = new LocalApplication(source, storage, docker, models, 'darwin', packages);
  await app.run();
  await app.acceptUpdate();
  expect(app.state).toEqual({
    kind: 'update-restart',
    version: packages.availableRelease.cliVersion,
  });
  expect(packages.installed).toEqual([packages.availableRelease]);
  expect(mutated()).toEqual([]);
  const secrets = await storage.secrets();
  await writeFile(join(directory, 'release.json'), JSON.stringify(packages.availableRelease));
  source = new ReleaseSource(join(directory, 'release.json'), packages.availableRelease.cliVersion);
  docker.availableRelease = packages.availableRelease;
  docker.observed = [
    ...containers(false).slice(0, 2),
    ...containers(false, packages.availableRelease).slice(2),
  ];
  docker.failMigration = true;
  const updated = application();
  await updated.run();
  expect(updated.state.kind).toBe('recovery');
  expect((await storage.read())?.release).toEqual(release);
  expect(fetch).not.toHaveBeenCalled();
  docker.failMigration = false;
  await updated.retry();
  expect(updated.state.kind).toBe('ready');
  expect((await storage.read())?.release).toEqual(packages.availableRelease);
  const stoppedAt = docker.calls.findIndex((args) => args.includes('stop'));
  expect(stoppedAt).toBeGreaterThanOrEqual(0);
  expect(stoppedAt).toBeLessThan(docker.calls.findIndex((args) => args.includes('pull')));
  expect(stoppedAt).toBeLessThan(docker.calls.findIndex((args) => args.includes('up')));
  expect(await storage.secrets()).toEqual(secrets);
  expect(docker.calls.flat()).not.toContain('down');
  expect(docker.calls.flat()).not.toContain('rm');
});

it('does not reuse update consent for a different source release or start a partial, unconsented release', async () => {
  const older = { ...release, cliVersion: '1.2.2' };
  await storage.prepare(older, models);
  await storage.recordUpdate({ ...release, cliVersion: '1.2.1' }, release);
  docker.observed = [...containers(false, older).slice(0, 2), ...containers(false).slice(2)];
  const app = application();
  await app.run();
  expect(app.state).toMatchObject({ kind: 'update', required: true, release });
  expect(mutated()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  await app.declineUpdate();
  expect(app.state.kind).toBe('cancelled');
  await app.retry();
  expect(app.state.kind).toBe('update');
  expect(mutated()).toEqual([]);
});

it('lets a matched installation decline a newer release even when another terminal cannot report work', async () => {
  await storage.prepare(release, models);
  docker.observed = containers(true);
  await mkdir(join(storage.directory, 'bridges'));
  await writeFile(join(storage.directory, 'bridges', 'unreadable-owner.json'), 'invalid');
  const app = new LocalApplication(source, storage, docker, models, 'darwin', new FixturePackage());
  await app.run();
  expect(app.state).toMatchObject({ kind: 'update', required: false, activeCount: null });
  await app.declineUpdate();
  expect(app.state.kind).toBe('ready');
  expect(mutated()).toEqual([]);
});

it('rejects duplicated or manually altered containers during a consented update before any launch', async () => {
  const older = { ...release, cliVersion: '1.2.2' };
  await storage.prepare(older, models);
  await storage.recordUpdate(older, release);
  docker.observed = [...containers(false, older), ...containers(false).slice(0, 1)];
  const app = application();
  await app.run();
  expect(app.state.kind).toBe('recovery');
  expect(mutated()).toEqual([]);
  docker.observed = containers(false, older);
  docker.observed[0]!.Config.Image = image('manual-image').reference;
  await app.retry();
  expect(app.state.kind).toBe('recovery');
  expect(mutated()).toEqual([]);
});
