import { describe, expect, it, vi } from 'vitest';

import type { MachineReadinessSnapshot } from '../auth/machine-controller-authority';
import type { MachineEnrollmentCeremonyPorts } from '../auth/machine-enrollment-ceremony';
import type { MachineEnrollmentConfirmationResult } from '../auth/machine-enrollment-confirmation';
import type { ServerLogger } from '../server/logger';
import type {
  PlatformConnectionState,
  PlatformConnectionStateListener,
} from '../server/platform-ws';
import { MachineActions, type MachineActionsDependencies } from './machine-actions';

const logger = (): ServerLogger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

const readiness = (state: MachineReadinessSnapshot['state']): MachineReadinessSnapshot => ({
  state,
  machineId: state === 'unpaired' ? null : 'machine-1',
  machine: null,
  localControllers: [],
  serverControllers: [],
  serverExecutionReadiness: null,
});

const makeHarness = (
  options: {
    state?: MachineReadinessSnapshot['state'];
    pair?: MachineActionsDependencies['pair'];
    authenticated?: boolean | Error;
  } = {},
) => {
  const log = logger();
  let authListener: ((token: string | null) => void) | undefined;
  let connectionListener: PlatformConnectionStateListener | undefined;
  const oauthClient = {
    isAuthenticated:
      options.authenticated instanceof Error
        ? vi.fn().mockRejectedValue(options.authenticated)
        : vi.fn().mockResolvedValue(options.authenticated ?? true),
    logout: vi.fn(() => {
      authListener?.(null);
      return Promise.resolve({ success: true as const, data: undefined });
    }),
    onAuthChanged: vi.fn((listener: (token: string | null) => void) => {
      authListener = listener;
      return () => true;
    }),
  };
  const connection: PlatformConnectionState = 'disconnected';
  const authority = {
    readReadiness: vi.fn().mockResolvedValue(readiness(options.state ?? 'ready')),
    addController: vi.fn(),
  };
  const actions = new MachineActions({
    oauthClient,
    platformWebSocketManager: {
      getConnectionState: () => connection,
      onConnectionStateChanged: (listener) => {
        connectionListener = listener;
        return () => undefined;
      },
      onMachineRevoked: () => () => undefined,
    },
    machineControllerAuthority: authority,
    pair: options.pair ?? vi.fn(),
    logger: log,
  });
  return {
    actions,
    oauthClient,
    authority,
    log,
    setConnection: (state: PlatformConnectionState) => connectionListener?.(state),
  };
};

const availability = (actions: MachineActions, id: string) =>
  actions.snapshot().actions.find((action) => action.id === id)?.availability;

describe('MachineActions', () => {
  it('exposes stable action identities and labels', () => {
    const { actions } = makeHarness();
    expect(actions.snapshot().actions.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'pair', label: 'Pair' },
      { id: 'add-controller', label: 'Add controller' },
      { id: 'log-out', label: 'Log out' },
    ]);
  });

  it('observes account, connection and readiness separately', async () => {
    const { actions, setConnection } = makeHarness({ state: 'no-controller' });
    await vi.waitFor(() => expect(actions.snapshot().readiness).toBe('no-controller'));
    expect(actions.snapshot().account).toBe('signed-in');
    expect(actions.snapshot().connection).toBe('disconnected');

    setConnection('connected');

    expect(actions.snapshot()).toMatchObject({
      account: 'signed-in',
      connection: 'connected',
    });
  });

  it('logs a failed account read and leaves the account unknown', async () => {
    const { actions, log } = makeHarness({ authenticated: new Error('keychain locked') });
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith('machine_actions.account_read_failed', {
        error: 'keychain locked',
      }),
    );
    expect(actions.snapshot().account).toBe('unknown');
  });

  it('gives safe reasons when pair, add controller or log out are unavailable', async () => {
    const unpaired = makeHarness({ state: 'unpaired', authenticated: false });
    await vi.waitFor(() => expect(unpaired.actions.snapshot().readiness).toBe('unpaired'));
    await vi.waitFor(() => expect(unpaired.actions.snapshot().account).toBe('signed-out'));
    expect(availability(unpaired.actions, 'add-controller')).toEqual({
      available: false,
      reason: 'machine-not-paired',
    });
    expect(availability(unpaired.actions, 'log-out')).toEqual({
      available: false,
      reason: 'signed-out',
    });
    expect(availability(unpaired.actions, 'pair')).toEqual({ available: true });

    const revoked = makeHarness({ state: 'machine-revoked' });
    await vi.waitFor(() => expect(revoked.actions.snapshot().readiness).toBe('machine-revoked'));
    expect(availability(revoked.actions, 'add-controller')).toEqual({
      available: false,
      reason: 'machine-authority-unusable',
    });
    expect(availability(revoked.actions, 'pair')).toEqual({ available: true });

    const paired = makeHarness({ state: 'ready' });
    await vi.waitFor(() => expect(paired.actions.snapshot().readiness).toBe('ready'));
    expect(availability(paired.actions, 'pair')).toEqual({
      available: false,
      reason: 'already-paired',
    });
  });

  it('runs one ceremony at a time and frees every action after a failure', async () => {
    const pair = vi.fn(
      (): Promise<MachineEnrollmentConfirmationResult> => Promise.reject(new Error('offline')),
    );
    const { actions } = makeHarness({ pair });

    const started = actions.start('pair');
    expect(started.started).toBe(true);
    expect(actions.start('log-out')).toEqual({ started: false, reason: 'operation-in-progress' });
    if (!started.started || started.operation.kind !== 'ceremony')
      throw new Error('expected ceremony');

    await expect(started.operation.completion).resolves.toBe('failed');
    await vi.waitFor(() => expect(availability(actions, 'log-out')).toEqual({ available: true }));
    expect(availability(actions, 'pair')).toEqual({ available: false, reason: 'already-paired' });
  });

  it('cancelling a ceremony ends its input path and releases the slot', async () => {
    const pair = vi.fn(
      (ports: MachineEnrollmentCeremonyPorts): Promise<MachineEnrollmentConfirmationResult> =>
        ports
          .requestConfirmation({
            machineName: 'Alice laptop',
            osFamily: 'macos',
            controllerLabel: 'Alice passkey',
            controllerCredentialFingerprint: 'fp-1',
            backupEligible: true,
            backupState: false,
            expiresAt: '2099-01-01T00:00:00.000Z',
          })
          .then(
            () => ({ outcome: 'declined' }),
            () => ({ outcome: 'cancelled' }),
          ),
    );
    const { actions } = makeHarness({ pair });
    const started = actions.start('pair');
    if (!started.started || started.operation.kind !== 'ceremony')
      throw new Error('expected ceremony');
    const { ceremony, completion } = started.operation;
    await vi.waitFor(() => expect(ceremony.step?.kind).toBe('local-review'));

    ceremony.cancel();

    await expect(completion).resolves.toBe('cancelled');
    expect(ceremony.respond({ kind: 'confirm', approved: true })).toBe(false);
    await vi.waitFor(() =>
      expect(availability(actions, 'add-controller')).toEqual({ available: true }),
    );
  });

  it('logs out through the account owner and reports signed-out without touching machine authority', async () => {
    const { actions, oauthClient, authority } = makeHarness();
    await vi.waitFor(() => expect(actions.snapshot().account).toBe('signed-in'));

    const started = actions.start('log-out');
    if (!started.started || started.operation.kind !== 'logout') throw new Error('expected logout');

    await expect(started.operation.completion).resolves.toEqual({ outcome: 'signed-out' });
    expect(oauthClient.logout).toHaveBeenCalledOnce();
    expect(actions.snapshot().account).toBe('signed-out');
    expect(authority.addController).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(availability(actions, 'add-controller')).toEqual({ available: true }),
    );
  });
});
