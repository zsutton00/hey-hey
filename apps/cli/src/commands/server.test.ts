import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import { createTestLocalAgentServerRuntime } from '../server/local-agent-server-runtime.test-support';
import type { MachineReadinessSnapshot } from '../auth/machine-controller-authority';
import {
  classifyStartupReadiness,
  PlatformUnavailableStartupError,
  StartupReadinessError,
} from '../server/startup-readiness';
import { PairingRequiredStartupRecovery } from './pairing-required-startup-recovery';
import { PlatformUnavailableStartupPresenter } from './platform-unavailable-startup-presenter';
import { LocalAgentServerStarter, ServerCommand, TerminationSignalWaiter } from './server';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const createServer = (port = 3847): LocalAgentServerRuntime => {
  const runtime = createTestLocalAgentServerRuntime(port);
  vi.spyOn(runtime, 'close');
  return runtime;
};

const blockedStartupError = (state: MachineReadinessSnapshot['state']): StartupReadinessError => {
  const snapshot: MachineReadinessSnapshot = {
    state,
    machineId: null,
    machine: null,
    localControllers: [],
    serverControllers: [],
    serverExecutionReadiness: null,
  };
  const outcome = classifyStartupReadiness(snapshot, `guidance for ${state}`);
  if (outcome.kind === 'ready') throw new Error('Expected startup to be blocked.');
  return new StartupReadinessError(outcome);
};

useTestCapabilityCatalog();

describe('ServerCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts, waits, and closes the local server', async () => {
    const localServer = createServer();
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockResolvedValue(localServer);
    const wait = vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run();

    expect(ok).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(localServer.close).toHaveBeenCalledTimes(1);
    expect(output.log).toHaveBeenCalledWith(
      'Local agent server started at http://localhost:3847. Press Ctrl+C to stop.',
    );
    expect(output.error).not.toHaveBeenCalled();
  });

  it('forwards an explicit preferred port to server startup', async () => {
    const localServer = createServer(4848);
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockResolvedValue(localServer);
    vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
    const command = new ServerCommand();

    const ok = await command.run({ preferredPort: 4848 });

    expect(ok).toBe(true);
    expect(start).toHaveBeenCalledWith({ preferredPort: 4848 });
    expect(localServer.close).toHaveBeenCalledTimes(1);
  });

  it('forwards the Daily Session process opt-in to server startup', async () => {
    const localServer = createServer();
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockResolvedValue(localServer);
    vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);

    const ok = await new ServerCommand().run({ enableDailySession: true });

    expect(ok).toBe(true);
    expect(start).toHaveBeenCalledWith({ enableDailySession: true });
  });

  it('returns false when startup fails', async () => {
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockImplementation(
      async (): Promise<LocalAgentServerRuntime> => {
        throw new Error('bind failed');
      },
    );
    const wait = vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run();

    expect(ok).toBe(false);
    expect(wait).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith('Failed to run local agent server: bind failed');
  });

  it('runs pairing recovery and retries startup after successful pairing', async () => {
    const localServer = createServer();
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockRejectedValueOnce(blockedStartupError('machine-revoked'))
      .mockResolvedValueOnce(localServer);
    const recover = vi
      .spyOn(PairingRequiredStartupRecovery.prototype, 'recover')
      .mockResolvedValue(true);
    vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run({ preferredPort: 4848 });

    expect(ok).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(1, { preferredPort: 4848 });
    expect(start).toHaveBeenNthCalledWith(2, { preferredPort: 4848 });
    expect(output.error).not.toHaveBeenCalled();
  });

  it('runs pairing recovery when the platform no longer recognizes the local machine', async () => {
    const localServer = createServer();
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockRejectedValueOnce(blockedStartupError('machine-unrecognized'))
      .mockResolvedValueOnce(localServer);
    const recover = vi
      .spyOn(PairingRequiredStartupRecovery.prototype, 'recover')
      .mockResolvedValue(true);
    vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);

    const ok = await new ServerCommand({ log: vi.fn(), error: vi.fn() }).run();

    expect(ok).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('keeps startup blocked without retrying when pairing recovery is cancelled or fails', async () => {
    const start = vi
      .spyOn(LocalAgentServerStarter.prototype, 'start')
      .mockRejectedValue(blockedStartupError('machine-revoked'));
    const recover = vi
      .spyOn(PairingRequiredStartupRecovery.prototype, 'recover')
      .mockResolvedValue(false);
    const wait = vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockResolvedValue(undefined);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run();

    expect(ok).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  it('does not enter pairing recovery for other blocked readiness states', async () => {
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockRejectedValue(
      blockedStartupError('locally-inconsistent'),
    );
    const recover = vi
      .spyOn(PairingRequiredStartupRecovery.prototype, 'recover')
      .mockResolvedValue(true);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run();

    expect(ok).toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(
      'Failed to run local agent server: Execution is not ready (locally-inconsistent). guidance for locally-inconsistent',
    );
  });

  it('presents platform connectivity failures without generic exception output', async () => {
    const error = new PlatformUnavailableStartupError(
      'http://localhost:3000/api/v1',
      new Error('connect ECONNREFUSED'),
    );
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockRejectedValue(error);
    const present = vi
      .spyOn(PlatformUnavailableStartupPresenter.prototype, 'present')
      .mockResolvedValue(undefined);
    const recover = vi
      .spyOn(PairingRequiredStartupRecovery.prototype, 'recover')
      .mockResolvedValue(true);
    const output = { log: vi.fn(), error: vi.fn() };

    const ok = await new ServerCommand(output).run();

    expect(ok).toBe(true);
    expect(present).toHaveBeenCalledWith(error);
    expect(recover).not.toHaveBeenCalled();
    expect(output.error).not.toHaveBeenCalled();
  });

  it('returns false and still closes server when wait fails', async () => {
    const localServer = createServer();
    vi.spyOn(LocalAgentServerStarter.prototype, 'start').mockResolvedValue(localServer);
    vi.spyOn(TerminationSignalWaiter.prototype, 'wait').mockImplementation(async () => {
      throw new Error('wait failed');
    });
    const output = { log: vi.fn(), error: vi.fn() };
    const command = new ServerCommand(output);

    const ok = await command.run();

    expect(ok).toBe(false);
    expect(localServer.close).toHaveBeenCalledTimes(1);
    expect(output.error).toHaveBeenCalledWith('Failed to run local agent server: wait failed');
  });
});
