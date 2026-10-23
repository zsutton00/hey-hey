import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pairMachine: vi.fn(),
  loadInk: vi.fn(),
  installTerminalCapture: vi.fn(),
}));

// `loadInk` is the only path that imports the Ink package.
vi.mock('./ink', () => ({ loadInk: mocks.loadInk, ink: vi.fn() }));

vi.mock('./terminal-capture', () => ({
  installTerminalCapture: mocks.installTerminalCapture,
}));

vi.mock('../commands/pair', () => ({
  pairMachine: mocks.pairMachine,
  resolvePairDependencies: (dependencies: unknown) => dependencies,
}));

import type { MachineEnrollmentCeremonyPorts } from '../auth/machine-enrollment-ceremony';
import { LocalAgentServerStarter, ServerCommand } from '../commands/server';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import { StructuredServerLogger } from '../server/logger';
import { StartupReadinessError } from '../server/startup-readiness';
import { runDefaultServer, shouldMountMenu } from './interactive-terminal';
import { InteractiveServerPresentation, shouldUseColor } from './launch';
import { topScreen } from './navigation';
import {
  ControlledBrowserManager,
  createOwner,
  FakeSources,
  session,
} from './presentation.test-support';

const fakeServer = (fake: FakeSources) => {
  const close = vi.fn(() => Promise.resolve());
  const server = {
    url: 'http://localhost:3847',
    presentationSources: fake.sources,
    projectBrowsers: new ControlledBrowserManager(),
    close,
  } as unknown as LocalAgentServerRuntime;
  return { server, close };
};

const setup = () => {
  const { owner } = createOwner({ frameIntervalMs: 0 });
  let sigterm!: () => void;
  const terminationSignal = new Promise<void>((resolve) => {
    sigterm = resolve;
  });
  const logger = new StructuredServerLogger({ writeLine: () => undefined });
  const presentation = new InteractiveServerPresentation(owner, logger, terminationSignal);
  return { owner, presentation, sigterm, command: new ServerCommand(console, presentation) };
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('interactive server presentation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.pairMachine.mockReset();
  });

  it('attaches the running server and shuts down once after a confirmed quit', async () => {
    const fake = new FakeSources();
    fake.sessionList = [session()];
    fake.activeWork = 1;
    const { server, close } = fakeServer(fake);
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue(server);
    const { owner, command } = setup();

    const running = command.run();
    await tick();
    expect(fake.sessionObservers.size).toBe(1);

    owner.dispatch({ kind: 'quit' });
    await tick();
    expect(topScreen(owner.getSnapshot().navigation)).toEqual({ kind: 'quit-confirmation' });
    expect(close).not.toHaveBeenCalled();

    // Navigating and a render failure never stop the server or its Runs.
    owner.dispatch({ kind: 'back' });
    owner.detachInteractive();
    await tick();
    expect(close).not.toHaveBeenCalled();

    owner.interrupt();
    await expect(running).resolves.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    owner.dispose();
  });

  it('passes terminal output options through to server startup', async () => {
    const fake = new FakeSources();
    const { server } = fakeServer(fake);
    const start = vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue(server);
    const { owner, command } = setup();
    const terminal = { diagnosticFeed: {} as never, writeLogLine: () => undefined };
    const running = command.run({ terminal });
    await tick();
    expect(start).toHaveBeenCalledWith({ terminal });
    owner.dispatch({ kind: 'quit' });
    await running;
    owner.dispose();
  });

  it('keeps SIGTERM cleanup without asking for confirmation', async () => {
    const fake = new FakeSources();
    fake.activeWork = 2;
    const { server, close } = fakeServer(fake);
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue(server);
    const { owner, command, sigterm } = setup();
    const running = command.run();
    await tick();
    sigterm();
    await expect(running).resolves.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    owner.dispose();
  });

  it('keeps a startup failure on screen until the user quits', async () => {
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockRejectedValue(
      new Error('port in use'),
    );
    const { owner, command } = setup();
    const running = command.run();
    const settled = vi.fn();
    void running.then(settled);
    await tick();
    expect(owner.getSnapshot().startup).toEqual({
      kind: 'failed',
      heading: 'Hey Hey could not start',
      body: 'port in use',
    });
    expect(settled).not.toHaveBeenCalled();
    owner.dispatch({ kind: 'quit' });
    await expect(running).resolves.toBe(false);
    owner.dispose();
  });

  it('recovers pairing at startup on the pairing screen, then starts the server', async () => {
    const fake = new FakeSources();
    const { server } = fakeServer(fake);
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockRejectedValueOnce(
        new StartupReadinessError({
          kind: 'pairing-required',
          snapshot: { state: 'machine-revoked' } as never,
          scenario: {
            kind: 'pairing-required',
            heading: 'Pairing required',
            body: '',
            primaryAction: { kind: 'pair-now', label: 'Pair Now' },
          },
        }),
      )
      .mockResolvedValueOnce(server);
    mocks.pairMachine.mockImplementation(
      (_dependencies: unknown, ports: MachineEnrollmentCeremonyPorts) => {
        ports.step({ kind: 'browser-handoff', userCode: 'CODE' });
        return Promise.resolve({ outcome: 'confirmed' });
      },
    );
    const { owner, command } = setup();
    const running = command.run();
    await tick();
    expect(start).toHaveBeenCalledTimes(2);
    expect(fake.sessionObservers.size).toBe(1);
    expect(owner.getSnapshot().navigation.notice).toBe('This machine is paired.');
    owner.dispatch({ kind: 'quit' });
    await expect(running).resolves.toBe(true);
    owner.dispose();
  });

  it('honours NO_COLOR and FORCE_COLOR=0', () => {
    expect(shouldUseColor({ NO_COLOR: '' })).toBe(false);
    expect(shouldUseColor({ FORCE_COLOR: '0' })).toBe(false);
    expect(shouldUseColor({ TERM: 'xterm-256color' })).toBe(true);
  });
});

describe('default launch terminal check', () => {
  it.each([
    ['both terminals', { stdin: true, stdout: true, stderr: true }, true],
    ['stdout redirected', { stdin: true, stdout: false, stderr: true }, false],
    ['stdin piped', { stdin: false, stdout: true, stderr: true }, false],
    ['stderr only', { stdin: false, stdout: false, stderr: true }, false],
  ])('%s', (_name, flags, expected) => {
    expect(shouldMountMenu(flags)).toBe(expected);
  });

  it('keeps line output without loading Ink or capturing the terminal', async () => {
    const run = vi.spyOn(ServerCommand.prototype, 'run').mockResolvedValue(true);
    await expect(runDefaultServer({ stdin: true, stdout: false, stderr: true }, {})).resolves.toBe(
      true,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.loadInk).not.toHaveBeenCalled();
    expect(mocks.installTerminalCapture).not.toHaveBeenCalled();
  });
});
