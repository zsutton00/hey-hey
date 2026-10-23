import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachDirectEnrollmentOutput,
  MachineEnrollmentCancelledError,
  MachineEnrollmentCeremony,
  type MachineEnrollmentCeremonyStep,
} from '../machine-enrollment-ceremony';
import {
  MachineEnrollmentConfirmation,
  type MachineEnrollmentConfirmationClient,
  type MachineEnrollmentConfirmationResult,
  type PendingMachineEnrollment,
} from '../machine-enrollment-confirmation';
import type { ConfirmMachineEnrollmentResponseDto } from '../../shared/api/index';
import { ControllerRegistryStore } from '../../credentials/controller-registry';
import { generateMachineKeyPair, KeyPairStore } from '../../credentials/keypair';
import { MemoryPlatformStore } from '../../credentials/keypair.test-support';

const ENROLLMENT_ID = 'enrollment-1';
const MACHINE_ID = 'machine-1';
const DEVICE_SECRET = 'device-secret-not-output';
const NONCE = 'nonce-not-output';
const REGISTRY_PATH = path.join(process.cwd(), '.controller-ceremony-test.json');
const NOW = Date.parse('2026-08-12T21:00:00.000Z');

beforeEach(async () => {
  await fs.rm(REGISTRY_PATH, { force: true });
});

afterEach(async () => {
  await fs.rm(REGISTRY_PATH, { force: true });
});

const ready = (): PendingMachineEnrollment => ({
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
  confirmationNonce: NONCE,
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

const seed = {
  enrollmentId: ENROLLMENT_ID,
  machineId: MACHINE_ID,
  deviceSecret: DEVICE_SECRET,
  pollingIntervalSeconds: 1,
  expiresAt: '2026-08-12T22:00:00.000Z',
  userCode: 'BCDFG-HJKLM',
};

const makeHarness = async (
  poll: MachineEnrollmentConfirmationClient['pollMachineEnrollment'] = vi
    .fn()
    .mockResolvedValue(ready()),
  sleep: (milliseconds: number) => Promise<void> = () => Promise.resolve(),
) => {
  const keyPairStore = new KeyPairStore({
    platformStoreOverride: new MemoryPlatformStore(),
    namespaceOverride: 'test/',
  });
  const generated = generateMachineKeyPair();
  await keyPairStore.storePrivateKey(MACHINE_ID, generated.privateKeyPem);
  await keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
  await keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
  const confirm = vi
    .fn<MachineEnrollmentConfirmationClient['confirmMachineEnrollment']>()
    .mockResolvedValue(activation());
  const terminalPrompt = vi.fn().mockResolvedValue(true);
  const confirmation = new MachineEnrollmentConfirmation({
    keyPairStore,
    controllerRegistryStore: new ControllerRegistryStore({ keyPairStore, filePath: REGISTRY_PATH }),
    client: { pollMachineEnrollment: poll, confirmMachineEnrollment: confirm },
    prompter: { confirm: terminalPrompt },
    sleep,
    now: () => NOW,
    log: vi.fn(),
    logError: vi.fn(),
  });
  return { confirmation, confirm, keyPairStore, terminalPrompt };
};

const recordSteps = (ceremony: MachineEnrollmentCeremony): MachineEnrollmentCeremonyStep[] => {
  const steps: MachineEnrollmentCeremonyStep[] = [];
  ceremony.observe((step) => steps.push(step));
  return steps;
};

const runCeremony = (
  ceremony: MachineEnrollmentCeremony,
  confirmation: MachineEnrollmentConfirmation,
): Promise<MachineEnrollmentConfirmationResult> =>
  ceremony.run(
    (ports) => confirmation.run(seed, { ports }),
    () => ({ outcome: 'failed' }),
  );

const waitForStep = async (
  ceremony: MachineEnrollmentCeremony,
  kind: MachineEnrollmentCeremonyStep['kind'],
): Promise<void> => {
  await vi.waitFor(() => expect(ceremony.step?.kind).toBe(kind));
};

describe('MachineEnrollmentCeremony', () => {
  it('drives the confirmation as typed steps answered by screen input', async () => {
    const { confirmation, confirm, keyPairStore, terminalPrompt } = await makeHarness();
    const ceremony = new MachineEnrollmentCeremony();
    const steps = recordSteps(ceremony);

    const result = runCeremony(ceremony, confirmation);
    await waitForStep(ceremony, 'local-review');
    expect(ceremony.respond({ kind: 'confirm', approved: true })).toBe(true);

    await expect(result).resolves.toMatchObject({ outcome: 'confirmed' });
    expect(steps.map((step) => step.kind)).toEqual([
      'waiting-for-browser',
      'local-review',
      'activating',
      'finished',
    ]);
    expect(steps.at(-1)).toEqual({ kind: 'finished', outcome: 'confirmed' });
    // Display data never carries secrets, nonces or proofs.
    const serialized = JSON.stringify(steps);
    expect(serialized).not.toContain(DEVICE_SECRET);
    expect(serialized).not.toContain(NONCE);
    expect(serialized).not.toContain('machine-credential-secret');
    expect(terminalPrompt).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    await expect(keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
  });

  it('declines without activating when the screen answers no', async () => {
    const { confirmation, confirm, keyPairStore } = await makeHarness();
    const ceremony = new MachineEnrollmentCeremony();

    const result = runCeremony(ceremony, confirmation);
    await waitForStep(ceremony, 'local-review');
    ceremony.respond({ kind: 'confirm', approved: false });

    await expect(result).resolves.toEqual({ outcome: 'declined' });
    expect(confirm).not.toHaveBeenCalled();
    await expect(keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(keyPairStore.loadCurrentMachineId()).resolves.toBeNull();
  });

  it('cancels during local review, discards pending state and closes the input path', async () => {
    const { confirmation, confirm, keyPairStore } = await makeHarness();
    const ceremony = new MachineEnrollmentCeremony();
    const steps = recordSteps(ceremony);

    const result = runCeremony(ceremony, confirmation);
    await waitForStep(ceremony, 'local-review');
    ceremony.cancel();

    await expect(result).resolves.toEqual({ outcome: 'cancelled' });
    expect(steps.at(-1)).toEqual({ kind: 'finished', outcome: 'cancelled' });
    expect(confirm).not.toHaveBeenCalled();
    expect(ceremony.respond({ kind: 'confirm', approved: true })).toBe(false);
    await expect(keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID)).resolves.toBeNull();
  });

  it('cancels while waiting for the browser without another poll', async () => {
    const poll = vi.fn().mockResolvedValue({ state: 'pending' });
    let releaseSleep = (): void => undefined;
    const sleep = (): Promise<void> =>
      new Promise((resolve) => {
        releaseSleep = resolve;
      });
    const { confirmation } = await makeHarness(poll, sleep);
    const ceremony = new MachineEnrollmentCeremony();

    const result = runCeremony(ceremony, confirmation);
    await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());
    ceremony.cancel();

    await expect(result).resolves.toEqual({ outcome: 'cancelled' });
    releaseSleep();
    expect(poll).toHaveBeenCalledOnce();
  });

  it('releases observers once finished so a left ceremony keeps no subscribers', async () => {
    const ceremony = new MachineEnrollmentCeremony();
    const observer = vi.fn();
    ceremony.observe(observer);

    await ceremony.run(
      () => Promise.resolve({ outcome: 'failed' as const }),
      () => ({ outcome: 'failed' }),
    );
    ceremony.ports.step({ kind: 'problem', message: 'late' });

    expect(observer).toHaveBeenLastCalledWith({ kind: 'finished', outcome: 'failed' });
    expect(observer).toHaveBeenCalledOnce();
    expect(ceremony.observe(vi.fn()).step).toEqual({ kind: 'finished', outcome: 'failed' });
  });

  it('reports a thrown owner failure as a problem and a failed finish', async () => {
    const ceremony = new MachineEnrollmentCeremony();
    const steps = recordSteps(ceremony);

    await expect(
      ceremony.run(
        () => Promise.reject(new Error('directory offline')),
        () => ({ outcome: 'failed' as const }),
      ),
    ).resolves.toEqual({ outcome: 'failed' });
    expect(steps).toEqual([
      { kind: 'problem', message: 'directory offline' },
      { kind: 'finished', outcome: 'failed' },
    ]);
  });

  it('reports an escaped cancellation as cancelled, not a problem', async () => {
    const ceremony = new MachineEnrollmentCeremony();
    const steps = recordSteps(ceremony);
    const onError = vi.fn(() => ({ outcome: 'failed' as const }));

    await expect(
      ceremony.run(() => Promise.reject(new MachineEnrollmentCancelledError()), onError),
    ).resolves.toEqual({ outcome: 'cancelled' });
    expect(onError).not.toHaveBeenCalled();
    expect(steps).toEqual([{ kind: 'finished', outcome: 'cancelled' }]);
  });

  it('direct output renders the same ceremony and answers review with the terminal prompter', async () => {
    const { confirmation } = await makeHarness();
    const ceremony = new MachineEnrollmentCeremony();
    const log = vi.fn<(message: string) => void>();
    const prompt = vi.fn().mockResolvedValue(true);
    attachDirectEnrollmentOutput(ceremony, {
      log,
      logError: vi.fn(),
      prompter: { confirm: prompt },
      describeHandoff: (userCode) => `Code: ${userCode}`,
    });

    const result = await ceremony.run(
      (ports) => {
        ports.step({ kind: 'browser-handoff', userCode: seed.userCode });
        return confirmation.run(seed, { ports });
      },
      () => ({ outcome: 'failed' }),
    );

    expect(result.outcome).toBe('confirmed');
    expect(prompt).toHaveBeenCalledWith('Confirm pairing on this machine?', false);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Code: BCDFG-HJKLM',
      'Pairing is ready for local confirmation. Review the details in your browser.',
      'Pairing complete. This machine is now active.',
    ]);
  });
});
