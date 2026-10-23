import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMachineEnrollmentConfirmation,
  MachineEnrollmentConfirmation,
  parseStoredMachineEnrollmentActivation,
  parseStoredPendingEnrollmentMetadata,
  signMachineEnrollmentConfirmation,
  type MachineEnrollmentConfirmationClient,
  type PendingMachineEnrollment,
} from '../machine-enrollment-confirmation';
import type { ConfirmMachineEnrollmentResponseDto } from '../../shared/api/index';
import { ControllerRegistryStore } from '../../credentials/controller-registry';
import { generateMachineKeyPair, KeyPairStore } from '../../credentials/keypair';
import { MemoryPlatformStore } from '../../credentials/keypair.test-support';
import { canonicalizeJson } from '../../shared/canonical-json';

const ENROLLMENT_ID = 'enrollment-1';
const MACHINE_ID = 'machine-1';
const DEVICE_SECRET = 'device-secret-not-output';
const REGISTRY_PATH = path.join(process.cwd(), '.controller-confirmation-test.json');

beforeEach(async () => {
  await fs.rm(REGISTRY_PATH, { force: true });
});

afterEach(async () => {
  await fs.rm(REGISTRY_PATH, { force: true });
});

const pending = (): PendingMachineEnrollment => ({
  enrollmentId: ENROLLMENT_ID,
  machineId: MACHINE_ID,
  machineName: 'Alice laptop',
  osFamily: 'macos',
  cliVersion: '2.2.2',
  machineKeyFingerprint: 'machine-fp-1',
  accountId: 'account-1',
  organizationId: 'organization-1',
  controllerCredentialId: 'credential-1',
  controllerLabel: 'Alice passkey',
  controllerCredentialFingerprint: 'fp-1',
  backupEligible: true,
  backupState: false,
  confirmationNonce: 'nonce-1',
  expiresAt: '2026-08-12T22:00:00.000Z',
  state: 'ready',
});

const activation = (): ConfirmMachineEnrollmentResponseDto => ({
  machineCredential: 'machine-credential-secret',
  serverSigningPublicKey: 'server-signing-key',
  authorizationProtocolVersion: 2,
  activatedBinding: {
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    machineName: 'Alice laptop',
    osFamily: 'macos',
    cliVersion: '2.2.2',
    accountId: 'account-1',
    organizationId: 'organization-1',
    controllerLabel: 'Alice passkey',
    controllerCredentialId: 'credential-1',
    controllerCredentialPublicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: 'A'.repeat(43),
      y: 'B'.repeat(43),
    },
    controllerCredentialFingerprint: 'fp-1',
    backupEligible: true,
    backupState: false,
  },
});

const makeHarness = (approved: boolean) => {
  const generated = generateMachineKeyPair();
  const platformStore = new MemoryPlatformStore();
  const keyPairStore = new KeyPairStore({
    platformStoreOverride: platformStore,
    namespaceOverride: 'test/',
  });
  const registryStore = new ControllerRegistryStore({
    keyPairStore,
    filePath: REGISTRY_PATH,
  });
  const poll = vi
    .fn<MachineEnrollmentConfirmationClient['pollMachineEnrollment']>()
    .mockResolvedValue(pending());
  const confirm = vi
    .fn<MachineEnrollmentConfirmationClient['confirmMachineEnrollment']>()
    .mockResolvedValue(activation());
  const log = vi.fn<(message: string) => void>();
  const logError = vi.fn<(message: string) => void>();
  const promptConfirm = vi.fn().mockResolvedValue(approved);
  const confirmation = new MachineEnrollmentConfirmation({
    keyPairStore,
    controllerRegistryStore: registryStore,
    client: { pollMachineEnrollment: poll, confirmMachineEnrollment: confirm },
    prompter: { confirm: promptConfirm },
    now: () => Date.parse('2026-08-12T21:00:00.000Z'),
    log,
    logError,
  });
  return {
    confirmation,
    poll,
    confirm,
    promptConfirm,
    log,
    logError,
    keyPairStore,
    generated,
    platformStore,
    registryStore,
  };
};

describe('MachineEnrollmentConfirmation', () => {
  it('signs the exact RFC 8785 confirmation bytes and declines by default', () => {
    const generated = generateMachineKeyPair();
    const confirmation = buildMachineEnrollmentConfirmation(pending());
    const signed = signMachineEnrollmentConfirmation(confirmation, generated.privateKeyPem);
    const publicKey = createPublicKey({ key: generated.publicKey, format: 'der', type: 'spki' });

    expect(signed.canonicalBytes.toString('utf8')).toBe(canonicalizeJson({ ...confirmation }));
    expect(
      verify(null, signed.canonicalBytes, publicKey, Buffer.from(signed.signature, 'base64')),
    ).toBe(true);
  });

  it('declines by default without printing browser-reviewed metadata', async () => {
    const harness = makeHarness(false);
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(ENROLLMENT_ID, '{}');
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toEqual({ outcome: 'declined' });
    expect(harness.promptConfirm).toHaveBeenCalledWith('Confirm pairing on this machine?', false);
    expect(harness.confirm).not.toHaveBeenCalled();
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBeNull();
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(
      harness.keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID),
    ).resolves.toBeNull();
    expect(harness.log.mock.calls.map(([message]) => message)).toEqual([
      'Pairing is ready for local confirmation. Review the details in your browser.',
      'Pairing declined. This machine was not activated.',
    ]);
    const output = harness.log.mock.calls.flat().join('\n');
    expect(output).not.toContain('account-1');
    expect(output).not.toContain('organization-1');
    expect(output).not.toContain('Alice passkey');
    expect(output).not.toContain('fp-1');
    expect(output).not.toContain('Alice laptop');
    expect(output).not.toContain('2026-08-12T22:00:00.000Z');
    expect(output).not.toContain(DEVICE_SECRET);
  });

  it('shows the account-mismatch warning once and stops before confirmation', async () => {
    const harness = makeHarness(true);
    harness.poll.mockResolvedValue({
      state: 'warning',
      code: 'MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH',
      message: 'The pairing attempt originated from a different account.',
    });
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2026-08-12T22:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toEqual({ outcome: 'failed' });

    expect(harness.logError).toHaveBeenCalledTimes(1);
    expect(harness.logError).toHaveBeenCalledWith(
      'The pairing attempt originated from a different account.',
    );
    expect(harness.poll).toHaveBeenCalledTimes(1);
    expect(harness.promptConfirm).not.toHaveBeenCalled();
    expect(harness.confirm).not.toHaveBeenCalled();
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(
      harness.keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID),
    ).resolves.toBeNull();
    await expect(
      harness.keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID),
    ).resolves.toBeNull();
  });

  it('stops before polling when the enrollment has expired', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(ENROLLMENT_ID, '{}');

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T20:00:00.000Z',
      }),
    ).resolves.toEqual({ outcome: 'expired' });
    expect(harness.poll).not.toHaveBeenCalled();
    expect(harness.confirm).not.toHaveBeenCalled();
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBeNull();
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(
      harness.keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID),
    ).resolves.toBeNull();
  });

  it('persists activation in order and only then promotes current machine', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const order: string[] = [];
    const originalCredential = harness.keyPairStore.storeMachineCredential.bind(
      harness.keyPairStore,
    );
    vi.spyOn(harness.keyPairStore, 'storeMachineCredential').mockImplementation(
      async (machineId, credential) => {
        order.push('storeMachineCredential');
        return originalCredential(machineId, credential);
      },
    );
    const originalActivation = harness.keyPairStore.storePendingEnrollmentActivation.bind(
      harness.keyPairStore,
    );
    vi.spyOn(harness.keyPairStore, 'storePendingEnrollmentActivation').mockImplementation(
      async (enrollmentId, activation) => {
        order.push('storePendingEnrollmentActivation');
        return originalActivation(enrollmentId, activation);
      },
    );
    const originalServerKey = harness.keyPairStore.storeServerSigningPublicKey.bind(
      harness.keyPairStore,
    );
    vi.spyOn(harness.keyPairStore, 'storeServerSigningPublicKey').mockImplementation(
      async (machineId, serverKey) => {
        order.push('storeServerSigningPublicKey');
        return originalServerKey(machineId, serverKey);
      },
    );
    const originalCurrent = harness.keyPairStore.setCurrentMachineId.bind(harness.keyPairStore);
    vi.spyOn(harness.keyPairStore, 'setCurrentMachineId').mockImplementation(async (machineId) => {
      order.push('setCurrentMachineId');
      return originalCurrent(machineId);
    });

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toMatchObject({ outcome: 'confirmed' });
    expect(order.indexOf('storePendingEnrollmentActivation')).toBeLessThan(
      order.indexOf('storeMachineCredential'),
    );
    expect(order.indexOf('storeMachineCredential')).toBeLessThan(
      order.indexOf('storeServerSigningPublicKey'),
    );
    expect(order.indexOf('storeServerSigningPublicKey')).toBeLessThan(
      order.indexOf('setCurrentMachineId'),
    );
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
    expect(harness.log).toHaveBeenLastCalledWith('Pairing complete. This machine is now active.');
    const output = harness.log.mock.calls.flat().join('\n');
    expect(output).not.toContain('account-1');
    expect(output).not.toContain('organization-1');
    expect(output).not.toContain('Alice passkey');
    expect(output).not.toContain('fp-1');
    expect(harness.keyPairStore.storePendingEnrollmentActivation).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      JSON.stringify(activation()),
    );
    await expect(harness.registryStore.read()).resolves.toMatchObject({
      controllers: [
        expect.objectContaining({
          enrollmentId: ENROLLMENT_ID,
          authorizationProtocolVersion: 2,
          controllerCredentialFingerprint: 'fp-1',
        }),
      ],
    });
  });

  it('polls at the server interval and resumes a partial local finalization without reconfirming', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const poll = vi
      .fn<MachineEnrollmentConfirmationClient['pollMachineEnrollment']>()
      .mockResolvedValueOnce({ state: 'pending' })
      .mockResolvedValueOnce(pending());
    const confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: new ControllerRegistryStore({
        keyPairStore: harness.keyPairStore,
        filePath: REGISTRY_PATH,
      }),
      client: { pollMachineEnrollment: poll, confirmMachineEnrollment: harness.confirm },
      prompter: { confirm: vi.fn().mockResolvedValue(true) },
      sleep,
      now: () => Date.parse('2026-08-12T21:00:00.000Z'),
      log: vi.fn(),
      logError: vi.fn(),
    });

    await expect(
      confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toMatchObject({ outcome: 'confirmed' });
    expect(sleep).toHaveBeenCalledWith(5000);

    const metadataSerialized =
      await harness.keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID);
    expect(metadataSerialized).toBeNull();
    expect(harness.confirm).toHaveBeenCalledTimes(1);
  });

  it('retains the human code with verified claimant metadata for later handoff recovery', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const storePendingEnrollmentMetadata = vi.spyOn(
      harness.keyPairStore,
      'storePendingEnrollmentMetadata',
    );

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
        userCode: 'BCDFG HJKLM',
      }),
    ).resolves.toMatchObject({ outcome: 'confirmed' });

    const metadata = await harness.keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID);
    expect(metadata).toBeNull();
    expect(storePendingEnrollmentMetadata).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      expect.stringContaining('"userCode":"BCDFG HJKLM"'),
    );
  });

  it('waits the saved server interval before the first poll after restart', async () => {
    const harness = makeHarness(true);
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2026-08-12T22:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: harness.registryStore,
      client: {
        pollMachineEnrollment: harness.poll,
        confirmMachineEnrollment: harness.confirm,
      },
      prompter: { confirm: vi.fn().mockResolvedValue(true) },
      sleep,
      now: () => Date.parse('2026-08-12T21:00:00.000Z'),
      log: harness.log,
      logError: harness.logError,
    });

    await expect(confirmation.resumePendingEnrollment(ENROLLMENT_ID)).resolves.toMatchObject({
      outcome: 'confirmed',
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(
      harness.poll.mock.invocationCallOrder[0]!,
    );
  });

  it('clears a server-rejected saved enrollment after the restart delay', async () => {
    const harness = makeHarness(true);
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const poll = vi
      .fn<MachineEnrollmentConfirmationClient['pollMachineEnrollment']>()
      .mockRejectedValue(
        Object.assign(new Error('rejected enrollment'), {
          isAxiosError: true,
          response: { status: 409 },
        }),
      );
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2026-08-12T22:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: harness.registryStore,
      client: { pollMachineEnrollment: poll, confirmMachineEnrollment: harness.confirm },
      prompter: { confirm: vi.fn() },
      sleep,
      now: () => Date.parse('2026-08-12T21:00:00.000Z'),
      log: harness.log,
      logError: harness.logError,
    });

    await expect(confirmation.resumePendingEnrollment(ENROLLMENT_ID)).resolves.toEqual({
      outcome: 'terminal',
    });
    expect(sleep).toHaveBeenCalledWith(5000);
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(
      harness.keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID),
    ).resolves.toBeNull();
  });

  it('fails closed when terminal enrollment cleanup is incomplete', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await harness.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await harness.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2026-08-12T20:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    vi.spyOn(harness.keyPairStore, 'deletePendingEnrollmentSecret').mockRejectedValue(
      new Error('keychain cleanup unavailable'),
    );

    await expect(harness.confirmation.resumePendingEnrollment(ENROLLMENT_ID)).resolves.toEqual({
      outcome: 'failed',
    });
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBe(ENROLLMENT_ID);
    expect(harness.logError).toHaveBeenCalledWith(
      expect.stringContaining('Machine enrollment cleanup is incomplete'),
    );
  });

  it('retains protected activation data when local finalization fails and recovers it after restart', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const serverSigningKeySpy = vi
      .spyOn(harness.keyPairStore, 'storeServerSigningPublicKey')
      .mockRejectedValue(new Error('server keychain write failed'));

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toEqual({ outcome: 'failed' });
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBeNull();

    const metadataSerialized =
      await harness.keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID);
    const activationSerialized =
      await harness.keyPairStore.loadPendingEnrollmentActivation(ENROLLMENT_ID);
    expect(metadataSerialized).not.toBeNull();
    expect(activationSerialized).not.toBeNull();
    if (metadataSerialized === null || activationSerialized === null) {
      throw new Error('expected protected recovery values');
    }
    const metadata = parseStoredPendingEnrollmentMetadata(metadataSerialized);
    const activation = parseStoredMachineEnrollmentActivation(activationSerialized);
    if (!metadata || !activation) throw new Error('expected valid protected recovery values');
    expect(metadata.claim?.accountId).toBe('account-1');
    expect(activation.machineCredential).toBe('machine-credential-secret');
    expect(activation.authorizationProtocolVersion).toBe(2);
    expect(activation.activatedBinding.controllerCredentialFingerprint).toBe('fp-1');

    const restarted = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: new ControllerRegistryStore({
        keyPairStore: harness.keyPairStore,
        filePath: REGISTRY_PATH,
      }),
      client: { pollMachineEnrollment: vi.fn(), confirmMachineEnrollment: harness.confirm },
      prompter: { confirm: vi.fn() },
      now: () => Date.parse('2026-08-12T21:00:00.000Z'),
      log: vi.fn(),
      logError: vi.fn(),
    });
    serverSigningKeySpy.mockRestore();
    await expect(restarted.recover(metadata, activation)).resolves.toMatchObject({
      outcome: 'confirmed',
    });
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
    expect(harness.confirm).toHaveBeenCalledTimes(1);
  });

  it('recovers when cleanup removes metadata before a crash', async () => {
    const harness = makeHarness(true);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const deleteMetadata = harness.keyPairStore.deletePendingEnrollmentMetadata.bind(
      harness.keyPairStore,
    );
    const cleanupFailure = vi
      .spyOn(harness.keyPairStore, 'deletePendingEnrollmentMetadata')
      .mockImplementation(async (enrollmentId) => {
        await deleteMetadata(enrollmentId);
        throw new Error('crashed after metadata cleanup');
      });

    await expect(
      harness.confirmation.run({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      }),
    ).resolves.toEqual({ outcome: 'failed' });
    cleanupFailure.mockRestore();

    const restarted = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: new ControllerRegistryStore({
        keyPairStore: harness.keyPairStore,
        filePath: REGISTRY_PATH,
      }),
      client: { pollMachineEnrollment: vi.fn(), confirmMachineEnrollment: harness.confirm },
      prompter: { confirm: vi.fn() },
      now: () => Date.parse('2026-08-12T21:00:00.000Z'),
      log: vi.fn(),
      logError: vi.fn(),
    });

    await expect(restarted.resumePendingEnrollment(ENROLLMENT_ID)).resolves.toMatchObject({
      outcome: 'confirmed',
    });
    expect(harness.confirm).toHaveBeenCalledTimes(1);
    await expect(harness.keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
  });
});
