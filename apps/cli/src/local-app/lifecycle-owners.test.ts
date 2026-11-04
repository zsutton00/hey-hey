import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestLocalAgentServerRuntimeOwners } from '../server/local-agent-server-runtime.test-support';
import { createTestRun } from '../run/run.test-support';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';
import { RELEASE_PLATFORMS, type ReleaseManifest } from '../release/release-manifest';
import { InstallationStore } from './installation-store';
import { LocalLifecycleOwners, type LocalBridgeLifecycle } from './lifecycle-owners';
import { LocalApplication } from './local-application';
import { ReleaseSource } from './release-source';
import { DockerBoundary } from './docker-boundary';

import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import {
  LocalAgentServerStarter,
  ServerCommand,
  TerminationSignalWaiter,
} from '../commands/server';
import { SERVICE_IMAGES } from './compose';
import { OpenCodeAgentSessionRunner } from '../agents/providers/opencode/session-runner-opencode';
import {
  createProviderTestRunStore,
  createProviderTestRepoMappingStore,
} from '../agents/providers/provider-owner.test-support';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { ToolRuleStore } from '../session/tool-rules';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn,
}));

useTestCapabilityCatalog();
const image = {
  reference: `example.test/image@sha256:${'a'.repeat(64)}`,
  platforms: [...RELEASE_PLATFORMS],
};
const release = {
  schemaVersion: 1,
  cliVersion: '1.2.3',
  images: { api: image, ui: image, graphSearch: image, postgres: image, redis: image },
} satisfies ReleaseManifest;
class FakeDocker extends DockerBoundary {
  calls: string[][] = [];
  override async command(args: string[]): Promise<string> {
    this.calls.push(args);
    return '';
  }
}
let directory: string;
let storage: InstallationStore;
let docker: FakeDocker;
const runtimes: ReturnType<typeof createTestLocalAgentServerRuntimeOwners>[] = [];
const bridges: LocalBridgeLifecycle[] = [];
beforeEach(async () => {
  spawn.mockReset();
  directory = await mkdtemp(join(tmpdir(), 'heyhey-stop-test-'));
  storage = new InstallationStore(directory);
  await storage.prepare(release, directory);
  docker = new FakeDocker();
});
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(
    runtimes.splice(0).map((owners) => owners.runtime.close().catch(() => undefined)),
  );
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function terminal() {
  const owners = createTestLocalAgentServerRuntimeOwners({ host: '127.0.0.1', preferredPort: 0 });
  runtimes.push(owners);
  await owners.runtime.start();
  const bridge = await new LocalLifecycleOwners(storage).exclusive(() =>
    new LocalLifecycleOwners(storage).register(owners.runtime),
  );
  bridges.push(bridge);
  return owners;
}
function work(owners: ReturnType<typeof createTestLocalAgentServerRuntimeOwners>, id: string) {
  const template = createTestRun();
  const run = owners.runRegistry.create({
    runId: id,
    organizationId: 'org',
    projectId: 'project',
    conversationId: id,
    provider: 'claude',
    session: template.session,
  });
  run.holdForSubagent('pending-work');
  return run;
}
const application = () =>
  new LocalApplication(new ReleaseSource('unused', release.cliVersion), storage, docker, directory);

it('discloses authoritative work from two terminals, cancels safely, and re-discloses concurrent work before any shutdown', async () => {
  const first = await terminal(),
    second = await terminal();
  work(first, 'first');
  work(second, 'other-terminal');
  // These Runs have not started a Turn and are absent from the menu snapshot.
  expect(first.runtime.presentationSources.sessions.snapshot().sessions).toHaveLength(0);
  const app = application();
  await app.requestStop();
  expect(app.state).toMatchObject({ kind: 'stop', activeCount: 2 });
  app.cancel();
  expect(first.runRegistry.size).toBe(1);
  expect(second.runRegistry.size).toBe(1);
  expect(docker.calls).toEqual([]);
  await app.requestStop();
  work(second, 'concurrent-work');
  await app.confirmStop();
  expect(app.state).toMatchObject({ kind: 'stop', activeCount: 3 });
  expect(first.runRegistry.size).toBe(1);
  expect(second.runRegistry.size).toBe(2);
  expect(docker.calls).toEqual([]);
  await app.confirmStop();
  expect(app.state.kind).toBe('stopped');
  expect(docker.calls).toHaveLength(1);
  expect(docker.calls[0]?.at(-1)).toBe('stop');
  expect(await storage.secrets()).toBeDefined();
});

it('awaits provider disposal through the session owner before stopping containers', async () => {
  const owners = await terminal();
  const run = work(owners, 'provider-work');
  let releaseProvider!: () => void;
  const disposal = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const dispose = vi.fn(() => disposal);
  run.setRunner({
    runPrompt: async () => {
      throw new Error('Not used');
    },
    resumeSession: async () => {
      throw new Error('Not used');
    },
    getContextUsage: async () => {
      throw new Error('Not used');
    },
    dispose,
  });
  const app = application();
  await app.requestStop();
  const stopping = app.confirmStop();
  try {
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(docker.calls).toEqual([]);
    await expect(
      new LocalLifecycleOwners(storage).exclusive(async () => undefined),
    ).rejects.toThrow('Another terminal');
  } finally {
    releaseProvider();
    await stopping;
  }
  expect(app.state.kind).toBe('stopped');
  expect(docker.calls[0]?.at(-1)).toBe('stop');
});

it('keeps containers running and admission closed after failed provider cleanup, then retries unfinished teardown', async () => {
  const owners = await terminal();
  const run = work(owners, 'retry-provider');
  const dispose = vi
    .fn()
    .mockRejectedValueOnce(new Error('provider still running'))
    .mockResolvedValue(undefined);
  run.setRunner({
    runPrompt: async () => {
      throw new Error('Not used');
    },
    resumeSession: async () => {
      throw new Error('Not used');
    },
    getContextUsage: async () => {
      throw new Error('Not used');
    },
    dispose,
  });
  let closed = false;
  void owners.runtime.whenClosed.then(() => {
    closed = true;
  });
  const app = application();
  await app.requestStop();
  await app.confirmStop();
  expect(app.state.kind).toBe('recovery');
  expect(docker.calls).toEqual([]);
  expect(closed).toBe(false);
  expect(owners.runRegistry.size).toBe(1);
  expect(() => work(owners, 'must-not-start')).toThrow();
  await app.requestStop();
  await app.confirmStop();
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(closed).toBe(true);
  expect(app.state.kind).toBe('stopped');
  expect(docker.calls).toHaveLength(1);
  expect(docker.calls[0]?.at(-1)).toBe('stop');
});

it('retries failed application cleanup without repeating successful disposal or reopening admission', async () => {
  const owners = await terminal();
  const originalDispose = owners.infrastructure.dispose.bind(owners.infrastructure);
  const dispose = vi.spyOn(owners.infrastructure, 'dispose');
  dispose
    .mockRejectedValueOnce(new Error('temporary cleanup failure'))
    .mockImplementation(originalDispose);
  const platformDispose = vi.spyOn(owners.stateMachineRuntime, 'dispose');
  const app = application();
  await app.requestStop();
  await app.confirmStop();
  expect(app.state.kind).toBe('recovery');
  expect(docker.calls).toEqual([]);
  expect(() => work(owners, 'must-not-start')).toThrow();
  await app.requestStop();
  await app.confirmStop();
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(platformDispose).toHaveBeenCalledOnce();
  expect(app.state.kind).toBe('stopped');
  expect(docker.calls[0]?.at(-1)).toBe('stop');
});

it('rejects browser and unauthenticated lifecycle calls, and ordinary bridge exit never stops containers', async () => {
  const owners = await terminal();
  const [name] = await readdir(join(directory, 'bridges'));
  const descriptor = JSON.parse(await readFile(join(directory, 'bridges', name!), 'utf8'));
  const url = `http://127.0.0.1:${descriptor.port}/local-lifecycle/stop`;
  expect((await fetch(url, { method: 'POST' })).status).toBe(403);
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: {
          Origin: 'https://unrelated.test',
          'X-HeyHey-Local-Secret': (await storage.secrets()).admin,
        },
      })
    ).status,
  ).toBe(403);
  work(owners, 'still-active');
  const invalid = await fetch(url, {
    method: 'POST',
    headers: {
      'X-HeyHey-Local-Secret': (await storage.secrets()).admin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ runIds: [42] }),
  });
  expect(invalid.ok).toBe(false);
  expect(owners.runRegistry.size).toBe(1);
  await owners.runtime.close();
  expect(docker.calls).toEqual([]);
});

it.each(['stored', 'observed', 'pending'] as const)(
  'blocks %s release mismatch again at the foreground connection boundary',
  async (mismatch) => {
    const { ServerCommand } = await import('../commands/server');
    const output = { log: vi.fn(), error: vi.fn() };
    const dockerCommand = vi.spyOn(DockerBoundary.prototype, 'command');
    if (mismatch === 'stored') {
      await writeFile(
        join(directory, 'installation.json'),
        JSON.stringify({ release: { ...release, cliVersion: '0.9.0' }, modelDirectory: directory }),
      );
    }
    if (mismatch === 'pending') {
      await storage.recordUpdate(release, { ...release, cliVersion: '1.2.4' });
    }
    if (mismatch === 'observed') {
      dockerCommand.mockImplementation(async (args) =>
        args[0] === 'ps'
          ? 'api'
          : JSON.stringify([
              {
                Id: 'api',
                Config: {
                  Image: `example.test/wrong@sha256:${'b'.repeat(64)}`,
                  Labels: {
                    'com.docker.compose.service': 'api',
                    'dev.heyhey.cli-version': release.cliVersion,
                  },
                },
                State: { Running: true, Status: 'running' },
              },
            ]),
      );
    }
    try {
      expect(
        await new ServerCommand(output).run({
          localApplicationDirectory: directory,
          localApplicationRelease: release,
        }),
      ).toBe(false);
      const expected =
        mismatch === 'stored'
          ? 'release changed'
          : mismatch === 'pending'
            ? 'pending'
            : 'release differs';
      expect(output.error.mock.calls.flat().join(' ')).toContain(expected);
      if (mismatch !== 'observed') {
        expect(dockerCommand).not.toHaveBeenCalled();
      }
      expect(
        dockerCommand.mock.calls.some(([args]) => args.includes('up') || args.includes('pull')),
      ).toBe(false);
    } finally {
      dockerCommand.mockRestore();
    }
  },
);

it('retains the terminal owner after exit cleanup fails until a consented stop retry finishes', async () => {
  const owners = createTestLocalAgentServerRuntimeOwners({ host: '127.0.0.1', preferredPort: 0 });
  runtimes.push(owners);
  await owners.runtime.start();
  const run = work(owners, 'terminal-exit-failure');
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const dispose = vi
    .fn()
    .mockImplementationOnce(async () => {
      run.releaseSubagentHold('pending-work');
      throw new Error('still running');
    })
    .mockImplementation(() => cleanup);
  run.setRunner({
    runPrompt: async () => {
      throw new Error('Not used');
    },
    resumeSession: async () => {
      throw new Error('Not used');
    },
    getContextUsage: async () => {
      throw new Error('Not used');
    },
    dispose,
  });
  vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue(owners.runtime);
  vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
  vi.spyOn(DockerBoundary.prototype, 'command').mockImplementation(async (args) =>
    args[0] === 'ps'
      ? 'containers'
      : JSON.stringify(
          Object.entries(SERVICE_IMAGES).map(([name, key]) => ({
            Id: name,
            Config: {
              Image: release.images[key].reference,
              Labels: {
                'com.docker.compose.service': name,
                'dev.heyhey.cli-version': release.cliVersion,
              },
            },
            State: { Running: true, Status: 'running', Health: { Status: 'healthy' } },
          })),
        ),
  );
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(input) === 'http://127.0.0.1:3000/api/v1/auth/jwks'
        ? Promise.resolve(new Response('{}'))
        : nativeFetch(input, init),
    ),
  );
  const output = { log: vi.fn(), error: vi.fn() };
  let commandReturned = false;
  const command = new ServerCommand(output)
    .run({ localApplicationDirectory: directory, localApplicationRelease: release })
    .then((result) => {
      commandReturned = true;
      return result;
    });
  const app = application();
  let retry: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(output.error).toHaveBeenCalled());
    expect(commandReturned).toBe(false);
    expect(output.error.mock.calls.flat().join(' ')).toContain('heyhey local stop');
    expect(() => work(owners, 'closed-admission')).toThrow();
    expect(await new LocalLifecycleOwners(storage).inspect()).toMatchObject([
      { work: { runIds: [run.runId] } },
    ]);
    expect(await readdir(join(directory, 'bridges'))).toHaveLength(1);
    await app.requestStop();
    retry = app.confirmStop();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(2));
    expect(commandReturned).toBe(false);
    expect(docker.calls).toEqual([]);
    expect(await new LocalLifecycleOwners(storage).inspect()).toHaveLength(1);
    expect(await readdir(join(directory, 'bridges'))).toHaveLength(1);
  } finally {
    finishCleanup();
    await retry;
    await command;
  }
  expect(app.state.kind).toBe('stopped');
  expect(await readdir(join(directory, 'bridges'))).toEqual([]);
  expect(docker.calls).toHaveLength(1);
  expect(docker.calls[0]?.at(-1)).toBe('stop');
});

it.each(['before-url', 'health-check', 'termination-failure'] as const)(
  'waits for confirmed provider exit when stopping a launch during %s',
  async (phase) => {
    const owners = await terminal();
    const run = work(owners, 'launching-provider');
    const child = new ChildProcess();
    const stdout = new PassThrough();
    Object.defineProperty(child, 'stdout', { value: stdout });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    if (phase === 'termination-failure') {
      kill.mockImplementation(() => {
        throw new Error('termination denied');
      });
    }
    spawn.mockReturnValue(child);
    const endpoint = new LocalAgentEndpoint();
    endpoint.set(owners.runtime.url);
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint: endpoint,
      submissionToolRegistry: new SubmissionToolRegistry(),
      toolRuleStore: new ToolRuleStore(),
      runStore: createProviderTestRunStore(() => run.session),
      repoStore: createProviderTestRepoMappingStore(),
    });
    run.setRunner(runner);
    const nativeFetch = globalThis.fetch;
    let healthRequested = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(input).startsWith('http://127.0.0.1:1234/health')) {
          healthRequested = true;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });
        }
        return nativeFetch(input, init);
      }),
    );
    const session = { ...run.session, services: [] };
    delete session.launchServiceId;
    const startup = new AbortController();
    const launching = runner.runPrompt({ session, prompt: 'go', signal: startup.signal }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    if (phase === 'health-check') {
      stdout.write('listening on http://127.0.0.1:1234');
      await vi.waitFor(() => expect(healthRequested).toBe(true));
    }
    const app = application();
    await app.requestStop();
    let stopping = app.confirmStop();
    try {
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith('SIGTERM'));
      expect(docker.calls).toEqual([]);
      expect(await readdir(join(directory, 'bridges'))).toHaveLength(1);
      expect(await new LocalLifecycleOwners(storage).inspect()).toHaveLength(1);
      expect(() => work(owners, 'closed-during-launch')).toThrow();
      if (phase === 'termination-failure') {
        await stopping;
        expect(app.state.kind).toBe('recovery');
        expect(await new LocalLifecycleOwners(storage).inspect()).toHaveLength(1);
        expect(docker.calls).toEqual([]);
        kill.mockReturnValue(true).mockClear();
        await app.requestStop();
        stopping = app.confirmStop();
        await vi.waitFor(() => expect(kill).toHaveBeenCalledWith('SIGTERM'));
        expect(await readdir(join(directory, 'bridges'))).toHaveLength(1);
        expect(docker.calls).toEqual([]);
      }
    } finally {
      startup.abort();
      Object.defineProperty(child, 'signalCode', { value: 'SIGTERM' });
      child.emit('exit', null, 'SIGTERM');
      await stopping;
      await launching;
    }
    expect(app.state.kind).toBe('stopped');
    expect(await readdir(join(directory, 'bridges'))).toEqual([]);
    expect(docker.calls).toHaveLength(1);
    expect(docker.calls[0]?.at(-1)).toBe('stop');
  },
);
