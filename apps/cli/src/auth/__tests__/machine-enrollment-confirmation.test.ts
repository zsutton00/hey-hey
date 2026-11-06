import { asOrganizationId, asUserId } from '../../test-utils/contract-ids';
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify,
} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
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
import type {
  ConfirmMachineEnrollmentRequestDto,
  ConfirmMachineEnrollmentResponseDto,
  ControllerAuthorizationCadence,
  ControllerDeviceGrantCadence,
  FirstLocalGrantIntent,
} from '../../shared/api/index';
import { ControllerRegistryStore } from '../../credentials/controller-registry';
import { generateMachineKeyPair, KeyPairStore } from '../../credentials/keypair';
import { MemoryPlatformStore } from '../../credentials/keypair.test-support';
import { canonicalizeJson, canonicalizeJsonObject } from '../../shared/canonical-json';
import { LocalApprovalSecret } from '../local-approval';
import { ExecutionGrantStore } from '../../server/controller-authorization/execution-grant-store';
import { AuthorizationReplayStore } from '../../server/controller-authorization/authorization-replay-store';
import { ControllerAssertionVerifier } from '../../server/controller-authorization/controller-assertion-verifier';
import { HostActionAdmission } from '../../server/controller-authorization/host-action-admission';
import {
  CURRENT_AGENT_OPERATION_CATEGORY,
  CURRENT_AGENT_OPERATIONS,
  type HostActionAdmissionRequest,
} from '../../server/controller-authorization/types';

const ENROLLMENT_ID = 'enrollment-1';
const MACHINE_ID = 'machine-1';
const DEVICE_SECRET = 'device-secret-not-output';
const REGISTRY_PATH = path.join(process.cwd(), '.controller-confirmation-test.json');

// The passkey the browser created; the proof binds its SubjectPublicKeyInfo.
const controllerKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
const controllerJwk = controllerKey.export({ format: 'jwk' });
const CONTROLLER_PUBLIC_KEY = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: String(controllerJwk.x),
  y: String(controllerJwk.y),
};
const controllerSpkiSha256 = (key = controllerKey): string =>
  createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex');
const REGISTRATION_CHALLENGE = randomBytes(32).toString('base64url');

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
  accountId: asUserId('account-1'),
  organizationId: asOrganizationId('organization-1'),
  controllerCredentialId: 'credential-1',
  controllerLabel: 'Alice passkey',
  controllerCredentialFingerprint: 'fp-1',
  backupEligible: true,
  backupState: false,
  controllerCredentialPublicKey: CONTROLLER_PUBLIC_KEY,
  registrationChallenge: REGISTRATION_CHALLENGE,
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
    accountId: asUserId('account-1'),
    organizationId: asOrganizationId('organization-1'),
    controllerLabel: 'Alice passkey',
    controllerCredentialId: 'credential-1',
    controllerCredentialPublicKey: CONTROLLER_PUBLIC_KEY,
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

    expect(signed.canonicalBytes.toString('utf8')).toBe(canonicalizeJsonObject(confirmation));
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

/** What the pairing page computes after creating the passkey. */
const browserProof = (
  secret: string,
  claim: Pick<
    PendingMachineEnrollment,
    | 'enrollmentId'
    | 'accountId'
    | 'organizationId'
    | 'controllerCredentialId'
    | 'registrationChallenge'
  >,
  publicKeySha256 = controllerSpkiSha256(),
): string =>
  createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(
      [
        'heyhey-local-approval-v2',
        claim.enrollmentId,
        claim.accountId,
        claim.organizationId,
        claim.controllerCredentialId,
        publicKeySha256,
        claim.registrationChallenge,
      ].join('\n'),
    )
    .digest('base64url');

describe('first-time heyhey local approval', () => {
  const runWithClaim = async (
    claimFor: (secret: string) => PendingMachineEnrollment,
    localApproval = new LocalApprovalSecret(),
  ) => {
    const harness = makeHarness(false);
    harness.poll.mockResolvedValue(claimFor(localApproval.fragmentValue));
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const result = await harness.confirmation.run(
      {
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      },
      { localApproval },
    );
    return { harness, result };
  };

  it('activates without a terminal prompt when the claim carries this CLI proof', async () => {
    const { harness, result } = await runWithClaim((secret) => ({
      ...pending(),
      localApprovalProof: browserProof(secret, pending()),
    }));

    expect(result).toMatchObject({ outcome: 'confirmed' });
    expect(harness.promptConfirm).not.toHaveBeenCalled();
    expect(harness.confirm).toHaveBeenCalledTimes(1);
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
  });

  it.each([
    ['missing', () => pending()],
    [
      'altered',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(secret, pending()).replace(/^./u, (c) =>
          c === 'A' ? 'B' : 'A',
        ),
      }),
    ],
    [
      'made for another enrollment',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(secret, { ...pending(), enrollmentId: 'enrollment-2' }),
      }),
    ],
    [
      'made for another controller',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(secret, {
          ...pending(),
          controllerCredentialId: 'credential-2',
        }),
      }),
    ],
    [
      'made by a different account claiming the same code',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(secret, {
          ...pending(),
          accountId: asUserId('account-2'),
        }),
      }),
    ],
    [
      'made for another passkey public key',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(
          secret,
          pending(),
          controllerSpkiSha256(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey),
        ),
      }),
    ],
    [
      'made for another registration challenge',
      (secret: string) => ({
        ...pending(),
        localApprovalProof: browserProof(secret, {
          ...pending(),
          registrationChallenge: randomBytes(32).toString('base64url'),
        }),
      }),
    ],
    [
      'made without the CLI secret',
      () => ({
        ...pending(),
        localApprovalProof: browserProof(Buffer.alloc(32, 7).toString('base64url'), pending()),
      }),
    ],
  ])('falls back to terminal confirmation when the proof is %s', async (_label, claimFor) => {
    const { harness, result } = await runWithClaim(claimFor);

    expect(harness.promptConfirm).toHaveBeenCalledWith('Confirm pairing on this machine?', false);
    expect(result).toEqual({ outcome: 'declined' });
    expect(harness.confirm).not.toHaveBeenCalled();
    await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBeNull();
  });

  it('spends the secret on the first claim so a replayed proof needs terminal confirmation', async () => {
    const localApproval = new LocalApprovalSecret();
    const secret = localApproval.fragmentValue;
    const claim = { ...pending(), localApprovalProof: browserProof(secret, pending()) };
    const first = await runWithClaim(() => pending(), localApproval);
    expect(first.result).toEqual({ outcome: 'declined' });

    const harness = makeHarness(false);
    harness.poll.mockResolvedValue(claim);
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    await expect(
      harness.confirmation.run(
        {
          enrollmentId: ENROLLMENT_ID,
          machineId: MACHINE_ID,
          deviceSecret: DEVICE_SECRET,
          pollingIntervalSeconds: 5,
          expiresAt: '2026-08-12T22:00:00.000Z',
        },
        { localApproval },
      ),
    ).resolves.toEqual({ outcome: 'declined' });
    expect(harness.promptConfirm).toHaveBeenCalled();
    expect(harness.confirm).not.toHaveBeenCalled();
  });

  it('never prints the approval secret or proof', async () => {
    let secretSeen = '';
    const { harness } = await runWithClaim((secret) => {
      secretSeen = secret;
      return { ...pending(), localApprovalProof: browserProof(secret, pending()) };
    });
    const output = [...harness.log.mock.calls, ...harness.logError.mock.calls].flat().join('\n');
    expect(output).not.toContain(secretSeen);
    expect(output).not.toContain(browserProof(secretSeen, pending()));
  });
});

describe('first-time heyhey local grant', () => {
  const NOW = Date.parse('2026-08-12T21:00:00.000Z');
  const GRANT_ID = '6f1c3c62-2f5a-4b6e-9d43-3b3c0b9f8a11';
  const FINGERPRINT = `sha256:${'c'.repeat(64)}`;
  const CADENCE_TTL_MS: Record<ControllerAuthorizationCadence, number> = {
    FIVE_MINUTES: 5 * 60 * 1000,
    EIGHT_HOURS: 8 * 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
    ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
  };

  // UNTIL_REVOKED is the one cadence with no expiry.
  const expiryFor = (cadence: ControllerDeviceGrantCadence, issuedAtMs: number): number | null =>
    cadence === 'UNTIL_REVOKED' ? null : issuedAtMs + CADENCE_TTL_MS[cadence];

  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'first-local-grant-'));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const intentFor = (cadence: ControllerDeviceGrantCadence): FirstLocalGrantIntent => ({
    version: 1,
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    userId: asUserId('account-1'),
    organizationId: asOrganizationId('organization-1'),
    projectId: 'project-1',
    controllerInstallationId: 'installation-1',
    cadence,
    policyRevision: 1,
    allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
    allowedActionCategories: [...new Set(Object.values(CURRENT_AGENT_OPERATION_CATEGORY))],
    target: { kind: 'CLI_READ', id: MACHINE_ID },
    issuedAtMs: NOW - 30_000,
    nonce: randomBytes(32).toString('base64url'),
  });

  // An independent implementation of the published challenge rule.
  const challengeFor = (intent: FirstLocalGrantIntent): string =>
    Buffer.concat([
      Buffer.from(intent.nonce, 'base64url'),
      createHash('sha256')
        .update('heyhey-first-local-grant-v1')
        .update(Buffer.from([0]))
        .update(
          canonicalizeJson({
            ...intent,
            allowedActionTypes: [...intent.allowedActionTypes],
            allowedActionCategories: [...intent.allowedActionCategories],
            target: { ...intent.target },
          }),
        )
        .digest(),
    ]).toString('base64url');

  const descriptorFor = (intent: FirstLocalGrantIntent, issuedAtMs: number) => ({
    scope: 'controller_device_window' as const,
    controllerCredentialId: 'credential-1',
    controllerInstallationId: intent.controllerInstallationId,
    machineId: intent.machineId,
    userId: intent.userId,
    organizationId: intent.organizationId,
    cadence: intent.cadence,
    policyRevision: intent.policyRevision,
    allowedActionTypes: [...intent.allowedActionTypes],
    allowedActionCategories: [...intent.allowedActionCategories],
    issuedAtMs,
    effectiveExpiresAtMs: expiryFor(intent.cadence, issuedAtMs),
  });

  const hashDescriptor = (descriptor: ReturnType<typeof descriptorFor>): string =>
    createHash('sha256')
      .update(
        canonicalizeJson({
          ...descriptor,
          allowedActionTypes: [...descriptor.allowedActionTypes],
          allowedActionCategories: [...descriptor.allowedActionCategories],
        }),
      )
      .digest('hex');

  const grantStore = (now = () => NOW) =>
    new ExecutionGrantStore({
      filePath: path.join(directory, 'grants.json'),
      namespace: 'test/',
      integrityKey: Buffer.alloc(32, 9),
      now,
    });

  /**
   * Drives one first-local pairing through the real confirmation owner, proof
   * check, signature and grant store. The API is the network boundary: it
   * answers with the grant `respondWith` describes for the signed request.
   */
  const pair = async (options: {
    cadence?: ControllerDeviceGrantCadence;
    tamperIntent?: (intent: FirstLocalGrantIntent) => FirstLocalGrantIntent;
    proof?: 'valid' | 'missing';
    respondWith?: (
      request: ConfirmMachineEnrollmentRequestDto,
      intent: FirstLocalGrantIntent,
    ) => ConfirmMachineEnrollmentResponseDto['firstLocalGrant'];
    terminalApproves?: boolean;
  }) => {
    const intent = intentFor(options.cadence ?? 'ONE_MONTH');
    const localApproval = new LocalApprovalSecret();
    const claim: PendingMachineEnrollment = {
      ...pending(),
      controllerCredentialFingerprint: FINGERPRINT,
      registrationChallenge: challengeFor(intent),
      firstLocalGrant: options.tamperIntent ? options.tamperIntent(intent) : intent,
    };
    if (options.proof !== 'missing') {
      claim.localApprovalProof = browserProof(localApproval.fragmentValue, claim);
    }

    const harness = makeHarness(options.terminalApproves ?? false);
    const store = grantStore();
    const confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: harness.keyPairStore,
      controllerRegistryStore: harness.registryStore,
      client: { pollMachineEnrollment: harness.poll, confirmMachineEnrollment: harness.confirm },
      prompter: { confirm: harness.promptConfirm },
      executionGrantStore: store,
      now: () => NOW,
      log: harness.log,
      logError: harness.logError,
    });
    harness.poll.mockResolvedValue(claim);
    harness.confirm.mockImplementation(async (request) => {
      const grant = request.confirmation.firstLocalGrant
        ? (
            options.respondWith ??
            ((signed) => ({
              authorizationId: 'authorization-1',
              grantId: GRANT_ID,
              grantDescriptor: descriptorFor(
                intent,
                signed.confirmation.firstLocalGrant!.issuedAtMs,
              ),
            }))
          )(request, intent)
        : undefined;
      const response = activation();
      response.activatedBinding.controllerCredentialFingerprint = FINGERPRINT;
      return grant ? { ...response, firstLocalGrant: grant } : response;
    });
    await harness.keyPairStore.storePrivateKey(MACHINE_ID, harness.generated.privateKeyPem);
    const result = await confirmation.run(
      {
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        deviceSecret: DEVICE_SECRET,
        pollingIntervalSeconds: 5,
        expiresAt: '2026-08-12T22:00:00.000Z',
      },
      { localApproval },
    );
    return { harness, intent, result, store };
  };

  const admission = (store: ExecutionGrantStore, now = () => NOW) =>
    new HostActionAdmission({
      grantStore: store,
      replayStore: new AuthorizationReplayStore({
        filePath: path.join(directory, 'replay.json'),
        namespace: 'test/',
        integrityKey: Buffer.alloc(32, 8),
        now,
      }),
      assertionVerifier: new ControllerAssertionVerifier({
        registry: { read: async () => ({ controllers: [] }) },
        origin: 'http://localhost:5173',
        rpId: 'localhost',
      }),
    });

  const reuse = (
    actionType: HostActionAdmissionRequest['actionType'],
    overrides: Partial<HostActionAdmissionRequest> = {},
  ): HostActionAdmissionRequest => ({
    machineId: MACHINE_ID,
    userId: asUserId('account-1'),
    organizationId: asOrganizationId('organization-1'),
    projectId: 'project-1',
    controllerInstallationId: 'installation-1',
    actionCategory: CURRENT_AGENT_OPERATION_CATEGORY[actionType],
    actionType,
    actionPayloadHash: 'a'.repeat(64),
    target: { kind: 'CLI_READ', id: MACHINE_ID, revision: null },
    agentSessionId: null,
    taskMonitorId: null,
    envelopeNonce: randomBytes(16).toString('base64url'),
    authorization: { kind: 'bounded_grant', grantId: GRANT_ID },
    ...overrides,
  });

  it('pairs and installs the chosen grant with one approval, then admits later permitted actions', async () => {
    const { harness, result, store } = await pair({});

    expect(result).toMatchObject({ outcome: 'confirmed' });
    expect(harness.promptConfirm).not.toHaveBeenCalled();
    const request = harness.confirm.mock.calls[0]![0];
    const signed = request.confirmation.firstLocalGrant!;
    expect(signed.issuedAtMs).toBe(NOW);
    const expected = descriptorFor(intentFor('ONE_MONTH'), NOW);
    expect(signed.grantDescriptorHash).toBe(hashDescriptor(expected));
    const machineKey = createPublicKey({
      key: harness.generated.publicKey,
      format: 'der',
      type: 'spki',
    });
    expect(
      verify(
        null,
        Buffer.from(canonicalizeJsonObject(request.confirmation)),
        machineKey,
        Buffer.from(request.signature, 'base64'),
      ),
    ).toBe(true);

    const installed = await store.get(GRANT_ID);
    expect(installed).toMatchObject({
      cadence: 'ONE_MONTH',
      machineId: MACHINE_ID,
      controllerInstallationId: 'installation-1',
      issuedAtMs: NOW,
      effectiveExpiresAtMs: NOW + CADENCE_TTL_MS.ONE_MONTH,
    });

    // The grant's initial context is a CLI read; a different permitted
    // operation reuses it by reference, also after a CLI restart.
    await expect(admission(store).admit(reuse('CLI_READ'))).resolves.toMatchObject({
      admitted: true,
    });
    await expect(
      admission(grantStore()).admit(reuse('CONVERSATION_TRIGGER')),
    ).resolves.toMatchObject({
      admitted: true,
      grantId: GRANT_ID,
    });
  });

  it.each([...Object.keys(CADENCE_TTL_MS), 'UNTIL_REVOKED'] as ControllerDeviceGrantCadence[])(
    'grants exactly the %s window the person chose',
    async (cadence) => {
      const { store } = await pair({ cadence });
      await expect(store.get(GRANT_ID)).resolves.toMatchObject({
        cadence,
        effectiveExpiresAtMs: expiryFor(cadence, NOW),
      });
    },
  );

  it('keeps an until-revoked grant usable long after any bounded window, until it is revoked', async () => {
    const { store } = await pair({ cadence: 'UNTIL_REVOKED' });
    const muchLater = () => NOW + 10 * 365 * 24 * 60 * 60 * 1000;

    await expect(
      admission(grantStore(muchLater), muchLater).admit(reuse('CLI_READ')),
    ).resolves.toMatchObject({ admitted: true, grantId: GRANT_ID });

    await store.revoke(GRANT_ID);
    await expect(
      admission(grantStore(muchLater), muchLater).admit(reuse('CLI_READ')),
    ).resolves.toEqual({ admitted: false, reason: 'GRANT_NOT_ACTIVE' });
  });

  it('refuses reuse after expiry, after revocation, and from another machine or account', async () => {
    const { store } = await pair({ cadence: 'FIVE_MINUTES' });

    await expect(
      admission(store).admit(reuse('CLI_READ', { machineId: 'machine-2' })),
    ).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_SCOPE_MISMATCH',
    });
    await expect(
      admission(store).admit(reuse('CLI_READ', { userId: 'account-2' })),
    ).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_SCOPE_MISMATCH',
    });
    const later = () => NOW + CADENCE_TTL_MS.FIVE_MINUTES;
    await expect(admission(grantStore(later), later).admit(reuse('CLI_READ'))).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_NOT_ACTIVE',
    });
    await store.revoke(GRANT_ID);
    await expect(admission(store).admit(reuse('CLI_READ'))).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_NOT_ACTIVE',
    });
  });

  it.each([
    ['cadence', (intent: FirstLocalGrantIntent) => ({ ...intent, cadence: 'ONE_WEEK' as const })],
    ['project', (intent: FirstLocalGrantIntent) => ({ ...intent, projectId: 'project-2' })],
    [
      'browser installation',
      (intent: FirstLocalGrantIntent) => ({
        ...intent,
        controllerInstallationId: 'installation-2',
      }),
    ],
    ['machine', (intent: FirstLocalGrantIntent) => ({ ...intent, machineId: 'machine-2' })],
    [
      'operation set',
      (intent: FirstLocalGrantIntent) => ({
        ...intent,
        allowedActionTypes: intent.allowedActionTypes.slice(1),
      }),
    ],
  ])(
    'pairs without a grant when the relayed intent changes the %s the passkey approved',
    async (_label, tamperIntent) => {
      const { harness, result, store } = await pair({ tamperIntent });

      expect(result).toMatchObject({ outcome: 'confirmed' });
      expect(harness.confirm.mock.calls[0]![0].confirmation).not.toHaveProperty('firstLocalGrant');
      await expect(store.list()).resolves.toEqual([]);
    },
  );

  it('falls back to terminal confirmation without a grant when the proof is missing', async () => {
    const { harness, result, store } = await pair({ proof: 'missing', terminalApproves: true });

    expect(harness.promptConfirm).toHaveBeenCalled();
    expect(result).toMatchObject({ outcome: 'confirmed' });
    expect(harness.confirm.mock.calls[0]![0].confirmation).not.toHaveProperty('firstLocalGrant');
    await expect(store.list()).resolves.toEqual([]);
    await expect(admission(store).admit(reuse('CLI_READ'))).resolves.toEqual({
      admitted: false,
      reason: 'GRANT_NOT_ACTIVE',
    });
  });

  it.each([
    [
      'a longer window',
      (request: ConfirmMachineEnrollmentRequestDto, intent: FirstLocalGrantIntent) => ({
        authorizationId: 'authorization-1',
        grantId: GRANT_ID,
        grantDescriptor: descriptorFor(
          { ...intent, cadence: 'ONE_MONTH' },
          request.confirmation.firstLocalGrant!.issuedAtMs - 1,
        ),
      }),
    ],
    [
      'another browser installation',
      (request: ConfirmMachineEnrollmentRequestDto, intent: FirstLocalGrantIntent) => ({
        authorizationId: 'authorization-1',
        grantId: GRANT_ID,
        grantDescriptor: descriptorFor(
          { ...intent, controllerInstallationId: 'installation-2' },
          request.confirmation.firstLocalGrant!.issuedAtMs,
        ),
      }),
    ],
  ])(
    'installs nothing and does not promote when the API returns %s',
    async (_label, respondWith) => {
      const { harness, result, store } = await pair({ cadence: 'ONE_DAY', respondWith });

      expect(result).toEqual({ outcome: 'failed' });
      await expect(store.list()).resolves.toEqual([]);
      await expect(harness.keyPairStore.loadCurrentMachineId()).resolves.toBeNull();
    },
  );
});
