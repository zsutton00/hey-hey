import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmMachineEnrollmentResponseDto } from '../shared/api/index';
import {
  MachineControllerAuthority,
  type MachineControllerAuthorityDependencies,
} from '../auth/machine-controller-authority';
import type { MachineControllerManagementClient } from '../auth/machine-controller-management';
import { ControllerRegistryStore } from '../credentials/controller-registry';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import type { ServerCommandOptions } from './server';
import { runControllersCommand } from './controllers';

const makeActivation = (): ConfirmMachineEnrollmentResponseDto => ({
  machineCredential: 'machine-credential',
  serverSigningPublicKey: 'server-signing-key',
  authorizationProtocolVersion: 2,
  activatedBinding: {
    enrollmentId: 'enrollment-1',
    machineId: 'machine-1',
    machineName: 'test machine',
    osFamily: 'linux',
    cliVersion: '2.2.2',
    accountId: 'account-1',
    organizationId: 'organization-1',
    controllerLabel: 'test passkey',
    controllerCredentialId: 'controller-1',
    controllerCredentialPublicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: 'A'.repeat(43),
      y: 'B'.repeat(43),
    },
    controllerCredentialFingerprint: 'controller-fingerprint',
    backupEligible: true,
    backupState: false,
  },
});

const makeAuthority = (): MachineControllerAuthority => {
  const keyPairStore = createTestKeyPairStore();
  const controllerRegistryStore = new ControllerRegistryStore({
    keyPairStore,
    filePath: path.join(os.tmpdir(), 'heyhey-controllers-command-test-registry.json'),
  });
  const executionGrantStore = new ExecutionGrantStore({
    keyPairStore,
    filePath: path.join(os.tmpdir(), 'heyhey-controllers-command-test-grants.json'),
    integrityKey: Buffer.alloc(32, 1),
  });
  const managementClient: MachineControllerManagementClient = {
    createExistingMachineControllerEnrollment: vi.fn(),
    inspectMachineControllers: vi.fn(),
    reconcileMachineControllers: vi.fn(),
    revokeMachineControllerLocally: vi.fn(),
  };
  const dependencies: MachineControllerAuthorityDependencies = {
    keyPairStore,
    controllerRegistryStore,
    executionGrantStore,
    managementClient,
  };
  return new MachineControllerAuthority(dependencies);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runControllersCommand', () => {
  it('uses the concise direct-link handoff supplied after pending state is retained', async () => {
    vi.stubEnv('HEYHEY_WEB_ORIGIN', 'https://staging.heyhey.dev/app');
    const authority = makeAuthority();
    vi.spyOn(authority, 'addController').mockImplementation(async (options = {}) => {
      options.ports?.step({ kind: 'browser-handoff', userCode: 'BCDFG HJKLM' });
      return { outcome: 'declined' };
    });
    const log = vi.fn<(message: string) => void>();
    const startServerAfterConfirmation =
      vi.fn<(options: { preferredPort?: number }) => Promise<boolean>>();

    await expect(
      runControllersCommand(['add'], {
        authority,
        isTty: true,
        log,
        startServerAfterConfirmation,
      }),
    ).resolves.toBe(false);

    expect(log).toHaveBeenCalledWith(
      [
        'Add this controller in your browser.',
        'Code: BCDFG HJKLM',
        'Open: https://staging.heyhey.dev/add-controller?code=BCDFG+HJKLM',
        'Keep this terminal open. After creating the passkey, return here to confirm.',
      ].join('\n'),
    );
    expect(startServerAfterConfirmation).not.toHaveBeenCalled();
  });

  it('keeps the established local-review and completion wording', async () => {
    const authority = makeAuthority();
    vi.spyOn(authority, 'addController').mockImplementation(async (options = {}) => {
      const approved = await options.ports?.requestConfirmation({
        machineName: 'test machine',
        osFamily: 'linux',
        controllerLabel: 'test passkey',
        controllerCredentialFingerprint: 'controller-fingerprint',
        backupEligible: true,
        backupState: false,
        expiresAt: '2026-10-05T00:00:00.000Z',
      });
      return approved
        ? { outcome: 'confirmed', activation: makeActivation() }
        : { outcome: 'declined' };
    });
    const log = vi.fn<(message: string) => void>();
    const confirm = vi.fn().mockResolvedValue(true);

    await expect(
      runControllersCommand(['add', '--no-start'], {
        authority,
        isTty: true,
        log,
        prompter: { confirm, prompt: vi.fn(), password: vi.fn() } as never,
      }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledWith('Confirm pairing on this machine?', false);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Pairing is ready for local confirmation. Review the details in your browser.',
      'Pairing complete. This machine is now active.',
      'Controller enrollment confirmed and stored locally.',
    ]);
  });

  it('enters the existing server lifecycle only after confirmed persistence', async () => {
    const authority = makeAuthority();
    const events: string[] = [];
    vi.spyOn(authority, 'addController').mockImplementation(async () => {
      events.push('confirmed');
      return { outcome: 'confirmed', activation: makeActivation() };
    });
    const startServerAfterConfirmation = vi.fn(async (options: ServerCommandOptions) => {
      events.push('server');
      expect(options).toEqual({ preferredPort: 4848, enableDailySession: true });
      return true;
    });

    await expect(
      runControllersCommand(['add'], {
        authority,
        isTty: true,
        serverOptions: { preferredPort: 4848, enableDailySession: true },
        startServerAfterConfirmation,
      }),
    ).resolves.toBe(true);

    expect(events).toEqual(['confirmed', 'server']);
    expect(startServerAfterConfirmation).toHaveBeenCalledWith({
      preferredPort: 4848,
      enableDailySession: true,
    });
  });

  it.each([
    { name: '--no-start', args: ['add', '--no-start'] as const, isTty: true },
    { name: 'non-TTY input', args: ['add'] as const, isTty: false },
  ])('does not start the server after confirmation for $name', async ({ args, isTty }) => {
    const authority = makeAuthority();
    vi.spyOn(authority, 'addController').mockResolvedValue({
      outcome: 'confirmed',
      activation: makeActivation(),
    });
    const startServerAfterConfirmation =
      vi.fn<(options: { preferredPort?: number }) => Promise<boolean>>();

    await expect(
      runControllersCommand(args, {
        authority,
        isTty,
        serverOptions: { preferredPort: 4848 },
        startServerAfterConfirmation,
      }),
    ).resolves.toBe(true);

    expect(startServerAfterConfirmation).not.toHaveBeenCalled();
  });

  it('does not start the server for a failed confirmation outcome', async () => {
    const authority = makeAuthority();
    vi.spyOn(authority, 'addController').mockResolvedValue({ outcome: 'failed' });
    const startServerAfterConfirmation =
      vi.fn<(options: { preferredPort?: number }) => Promise<boolean>>();

    await expect(
      runControllersCommand(['add'], {
        authority,
        isTty: true,
        startServerAfterConfirmation,
      }),
    ).resolves.toBe(false);

    expect(startServerAfterConfirmation).not.toHaveBeenCalled();
  });
});
