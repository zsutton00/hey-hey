import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MachineEnrollmentError } from '../auth/machine-enrollment';
import { MachineEnrollmentConfirmation } from '../auth/machine-enrollment-confirmation';
import type { GeneratedMachineKeyPair, KeyPairStore } from '../credentials/index';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import type {
  ConfirmMachineEnrollmentResponseDto,
  CreateMachineEnrollment201Response,
  CreateMachineEnrollmentRequestDto,
  PollMachineEnrollmentResponseDto,
} from '../shared/api/index';
import { ControllerRegistryStore } from '../credentials/controller-registry';
import {
  runPairCommand,
  type MachinesEnrollmentClient,
  type PairCommandDependencies,
} from './pair';
import {
  GatewayMachineAuthenticationError,
  type MachineControllerManagementClient,
} from '../auth/machine-controller-management';
import { WebSocketMachineAuthenticationErrorResponseReasonEnum } from '../shared/api/index';
import { NOOP_LOGGER } from '../server/logger';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001';
const ENROLLMENT_ID = '00000000-0000-4000-8000-000000000002';
const DEVICE_SECRET = 'device-secret-must-not-be-printed';
const REGISTRY_PATH = path.join(process.cwd(), '.pair-test-controller-registry.json');

const makeGeneratedKeyPair = (): GeneratedMachineKeyPair => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }),
  };
};

const makeResponse = (): { data: CreateMachineEnrollment201Response } => ({
  data: {
    success: true,
    message: 'Machine enrollment opened successfully',
    data: {
      enrollmentId: ENROLLMENT_ID,
      machineId: MACHINE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: 'BCDFG-HJKLM',
      expiresAt: '2099-08-11T18:05:00.000Z',
      pollingIntervalSeconds: 5,
    },
    timestamp: '2026-08-11T18:00:00.000Z',
    statusCode: 201,
  },
});

const makePollResponse = (): PollMachineEnrollmentResponseDto => ({
  state: 'ready',
  enrollmentId: ENROLLMENT_ID,
  machineId: MACHINE_ID,
  machineName: 'test-machine',
  osFamily: 'linux',
  cliVersion: '2.2.2',
  machineKeyFingerprint: 'machine-fingerprint',
  accountId: 'account-1',
  organizationId: 'organization-1',
  controllerLabel: 'Test controller',
  controllerCredentialId: 'controller-1',
  controllerCredentialFingerprint: 'controller-fingerprint',
  backupEligible: true,
  backupState: false,
  confirmationNonce: 'confirmation-nonce',
  expiresAt: '2099-08-11T18:05:00.000Z',
});

const makeActivationResponse = (): ConfirmMachineEnrollmentResponseDto => ({
  machineCredential: 'machine-credential-secret',
  serverSigningPublicKey: 'server-signing-key',
  authorizationProtocolVersion: 2,
  activatedBinding: {
    enrollmentId: ENROLLMENT_ID,
    machineId: MACHINE_ID,
    machineName: 'test-machine',
    osFamily: 'linux',
    cliVersion: '2.2.2',
    accountId: 'account-1',
    organizationId: 'organization-1',
    controllerLabel: 'Test controller',
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

const makeDeps = (
  overrides: Partial<PairCommandDependencies> = {},
): PairCommandDependencies & {
  keyPairStore: KeyPairStore;
  machinesApi: MachinesEnrollmentClient & {
    createMachineEnrollment: ReturnType<
      typeof vi.fn<MachinesEnrollmentClient['createMachineEnrollment']>
    >;
  };
  generateKeyPair: ReturnType<typeof vi.fn<() => GeneratedMachineKeyPair>>;
  log: ReturnType<typeof vi.fn<(message: string) => void>>;
  logError: ReturnType<typeof vi.fn<(message: string) => void>>;
} => {
  const {
    keyPairStore: keyPairStoreOverride,
    machinesApi: machinesApiOverride,
    generateKeyPair: generateKeyPairOverride,
    log: logOverride,
    logError: logErrorOverride,
    ...otherOverrides
  } = overrides;
  const keyPairStore = keyPairStoreOverride ?? createTestKeyPairStore();
  vi.spyOn(keyPairStore, 'storePrivateKey');
  vi.spyOn(keyPairStore, 'storePendingEnrollmentSecret');
  vi.spyOn(keyPairStore, 'storePendingEnrollmentMetadata');
  vi.spyOn(keyPairStore, 'setCurrentMachineId');
  vi.spyOn(keyPairStore, 'storeMachineCredential');
  vi.spyOn(keyPairStore, 'storeServerSigningPublicKey');
  vi.spyOn(keyPairStore, 'deleteMachineCredential');

  const generated = makeGeneratedKeyPair();
  const generateKeyPair = vi.fn<() => GeneratedMachineKeyPair>(() => ({
    privateKeyPem: generated.privateKeyPem,
    publicKey: generated.publicKey,
  }));
  const createMachineEnrollment = vi
    .fn<MachinesEnrollmentClient['createMachineEnrollment']>()
    .mockResolvedValue(makeResponse());
  const log = vi.fn<(message: string) => void>();
  const logError = vi.fn<(message: string) => void>();
  const pollMachineEnrollment = vi
    .fn<PairCommandDependencies['machinesApi']['pollMachineEnrollment']>()
    .mockResolvedValue(makePollResponse());
  const confirmMachineEnrollment = vi
    .fn<PairCommandDependencies['machinesApi']['confirmMachineEnrollment']>()
    .mockResolvedValue(makeActivationResponse());

  return {
    keyPairStore,
    machinesApi: machinesApiOverride ?? {
      createMachineEnrollment,
      pollMachineEnrollment,
      confirmMachineEnrollment,
    },
    generateKeyPair: generateKeyPairOverride ?? generateKeyPair,
    getMachineName: () => 'test-machine',
    getOsFamily: () => 'linux',
    cliVersion: '2.2.2',
    getPairingUrl: (userCode) => {
      const pairingUrl = new URL('https://test.heyhey.dev/pairing');
      if (userCode !== undefined) pairingUrl.searchParams.set('code', userCode);
      return pairingUrl.toString();
    },
    logger: NOOP_LOGGER,
    controllerRegistryStore: new ControllerRegistryStore({
      keyPairStore,
      filePath: REGISTRY_PATH,
    }),
    prompter: { confirm: vi.fn().mockResolvedValue(true) },
    log: logOverride ?? log,
    logError: logErrorOverride ?? logError,
    ...otherOverrides,
  } as PairCommandDependencies & {
    keyPairStore: KeyPairStore;
    machinesApi: MachinesEnrollmentClient & {
      createMachineEnrollment: ReturnType<
        typeof vi.fn<MachinesEnrollmentClient['createMachineEnrollment']>
      >;
    };
    generateKeyPair: ReturnType<typeof vi.fn<() => GeneratedMachineKeyPair>>;
    log: ReturnType<typeof vi.fn<(message: string) => void>>;
    logError: ReturnType<typeof vi.fn<(message: string) => void>>;
  };
};

afterEach(async () => {
  await fs.rm(REGISTRY_PATH, { force: true });
});

describe('runPairCommand', () => {
  it('uses the existing-machine controller enrollment path when a machine already exists', async () => {
    const deps = makeDeps();
    await deps.keyPairStore.setCurrentMachineId(MACHINE_ID);
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, makeGeneratedKeyPair().privateKeyPem);
    await deps.keyPairStore.storeMachineCredential(MACHINE_ID, 'existing-machine-credential');
    const createExistingMachineControllerEnrollment = vi
      .fn<MachineControllerManagementClient['createExistingMachineControllerEnrollment']>()
      .mockResolvedValue(makeResponse());
    const existingMachineClient: MachineControllerManagementClient = {
      createExistingMachineControllerEnrollment,
      inspectMachineControllers: vi.fn(),
      reconcileMachineControllers: vi.fn(),
      revokeMachineControllerLocally: vi.fn(),
    };
    deps.existingMachineClient = existingMachineClient;

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(createExistingMachineControllerEnrollment).toHaveBeenCalledWith(MACHINE_ID);
    expect(deps.machinesApi.createMachineEnrollment).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      [
        'Pair this machine in your browser.',
        'Code: BCDFG-HJKLM',
        'Open: https://test.heyhey.dev/pairing?code=BCDFG-HJKLM',
        'Keep this terminal open. After creating the passkey, return here to confirm.',
      ].join('\n'),
    );
    expect(deps.keyPairStore.storePendingEnrollmentMetadata).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      expect.stringContaining('"userCode":"BCDFG-HJKLM"'),
    );
  });

  it('clears revoked local authority and continues into fresh first-machine enrollment', async () => {
    const deps = makeDeps();
    await deps.keyPairStore.setCurrentMachineId(MACHINE_ID);
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, makeGeneratedKeyPair().privateKeyPem);
    await deps.keyPairStore.storeMachineCredential(MACHINE_ID, 'revoked-machine-credential');
    const createExistingMachineControllerEnrollment = vi
      .fn<MachineControllerManagementClient['createExistingMachineControllerEnrollment']>()
      .mockRejectedValue(
        new GatewayMachineAuthenticationError(
          WebSocketMachineAuthenticationErrorResponseReasonEnum.MachineRevoked,
          'machine revoked',
        ),
      );
    deps.existingMachineClient = {
      createExistingMachineControllerEnrollment,
      inspectMachineControllers: vi.fn(),
      reconcileMachineControllers: vi.fn(),
      revokeMachineControllerLocally: vi.fn(),
    };

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(createExistingMachineControllerEnrollment).toHaveBeenCalledWith(MACHINE_ID);
    expect(deps.machinesApi.createMachineEnrollment).toHaveBeenCalledTimes(1);
    expect(deps.keyPairStore.deleteMachineCredential).toHaveBeenCalledWith(MACHINE_ID);
    expect(deps.logError).not.toHaveBeenCalledWith(
      expect.stringContaining('Controller upgrade could not be opened'),
    );
  });

  it('keeps unclassified machine authentication failures fail-closed', async () => {
    const deps = makeDeps();
    await deps.keyPairStore.setCurrentMachineId(MACHINE_ID);
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, makeGeneratedKeyPair().privateKeyPem);
    await deps.keyPairStore.storeMachineCredential(MACHINE_ID, 'machine-credential');
    deps.existingMachineClient = {
      createExistingMachineControllerEnrollment: vi
        .fn<MachineControllerManagementClient['createExistingMachineControllerEnrollment']>()
        .mockRejectedValue(new GatewayMachineAuthenticationError(null, 'temporary failure')),
      inspectMachineControllers: vi.fn(),
      reconcileMachineControllers: vi.fn(),
      revokeMachineControllerLocally: vi.fn(),
    };

    await expect(runPairCommand(deps)).resolves.toBe(false);

    expect(deps.machinesApi.createMachineEnrollment).not.toHaveBeenCalled();
    expect(deps.keyPairStore.deleteMachineCredential).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith(
      'Controller upgrade could not be opened: temporary failure',
    );
  });

  it('generates the key before opening unauthenticated enrollment and sends only enrollment fields', async () => {
    const deps = makeDeps();

    await expect(runPairCommand(deps)).resolves.toBe(true);

    const [request] = deps.machinesApi.createMachineEnrollment.mock.calls[0]!;
    expect(request).toEqual({
      machinePublicKey: expect.stringContaining('BEGIN PUBLIC KEY'),
      machineName: 'test-machine',
      osFamily: 'linux',
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2,
    } satisfies CreateMachineEnrollmentRequestDto);
    expect(request).not.toHaveProperty('machineId');
    expect(request).not.toHaveProperty('deviceSecret');
    expect(deps.generateKeyPair.mock.invocationCallOrder[0]).toBeLessThan(
      deps.machinesApi.createMachineEnrollment.mock.invocationCallOrder[0]!,
    );
  });

  it('polls and confirms the claimed enrollment before promoting the machine', async () => {
    const deps = makeDeps();

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(deps.keyPairStore.storePrivateKey).toHaveBeenCalledWith(
      MACHINE_ID,
      expect.stringContaining('BEGIN PRIVATE KEY'),
    );
    expect(deps.keyPairStore.storePendingEnrollmentSecret).toHaveBeenCalledWith(
      ENROLLMENT_ID,
      DEVICE_SECRET,
    );
    expect(deps.keyPairStore.setCurrentMachineId).toHaveBeenCalledWith(MACHINE_ID);
    expect(deps.keyPairStore.storeMachineCredential).toHaveBeenCalledWith(
      MACHINE_ID,
      'machine-credential-secret',
    );
    expect(deps.keyPairStore.storeServerSigningPublicKey).toHaveBeenCalledWith(
      MACHINE_ID,
      'server-signing-key',
    );
  });

  it('stops the pairing attempt when the initiating CLI receives an account-mismatch warning', async () => {
    const deps = makeDeps();
    deps.machinesApi.pollMachineEnrollment = vi.fn().mockResolvedValue({
      state: 'warning',
      code: 'MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH',
      message: 'The pairing attempt originated from a different account.',
    });

    await expect(runPairCommand(deps)).resolves.toBe(false);

    expect(deps.logError).toHaveBeenCalledWith(
      'The pairing attempt originated from a different account.',
    );
    expect(deps.prompter!.confirm).not.toHaveBeenCalled();
    expect(deps.machinesApi.confirmMachineEnrollment).not.toHaveBeenCalled();
  });

  it('does not persist enrollment material when the API fails', async () => {
    const createMachineEnrollment = vi
      .fn<MachinesEnrollmentClient['createMachineEnrollment']>()
      .mockRejectedValue(new MachineEnrollmentError('API unavailable.', 'NETWORK_ERROR'));
    const deps = makeDeps({
      machinesApi: {
        createMachineEnrollment,
        pollMachineEnrollment: vi.fn(),
        confirmMachineEnrollment: vi.fn(),
      },
    });

    await expect(runPairCommand(deps)).resolves.toBe(false);

    expect(deps.keyPairStore.storePrivateKey).not.toHaveBeenCalled();
    expect(deps.keyPairStore.storePendingEnrollmentSecret).not.toHaveBeenCalled();
    expect(deps.keyPairStore.setCurrentMachineId).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith('Enrollment failed: API unavailable.');
  });

  it('opens a fresh attempt when protected saved-state lookup is unavailable', async () => {
    const logger = { ...NOOP_LOGGER, debug: vi.fn() };
    const deps = makeDeps({
      logger,
      keyPairStore: Object.assign(createTestKeyPairStore(), {
        loadPendingEnrollmentId: vi.fn().mockRejectedValue(new Error('keychain unavailable')),
      }),
    });

    await expect(runPairCommand(deps)).resolves.toBe(true);
    expect(deps.machinesApi.createMachineEnrollment).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith('pair.saved_enrollment.detach_failed', {
      error: 'keychain unavailable',
    });
  });

  it('detaches an expired saved enrollment and displays a fresh code', async () => {
    const deps = makeDeps();
    await deps.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await deps.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await deps.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2020-01-01T00:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(deps.machinesApi.createMachineEnrollment).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Code: BCDFG-HJKLM'));
    await expect(
      deps.keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID),
    ).resolves.toBeNull();
  });

  it('does not resume a recoverable saved enrollment during explicit pairing', async () => {
    const deps = makeDeps();
    const generated = makeGeneratedKeyPair();
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, generated.privateKeyPem);
    await deps.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await deps.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await deps.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        userCode: 'BCDFG-HJKLM',
        expiresAt: '2099-08-11T18:05:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    deps.confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: deps.keyPairStore,
      controllerRegistryStore: deps.controllerRegistryStore!,
      client: deps.machinesApi,
      prompter: deps.prompter!,
      sleep,
      log: deps.log,
      logError: deps.logError,
    });

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('Pair this machine in your browser.'),
    );
    expect(deps.machinesApi.createMachineEnrollment).toHaveBeenCalledTimes(1);
  });

  it('replaces a rejected saved enrollment with a fresh code in the same invocation', async () => {
    const deps = makeDeps();
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, makeGeneratedKeyPair().privateKeyPem);
    await deps.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await deps.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await deps.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        userCode: 'NPQRS-TVWXZ',
        expiresAt: '2099-08-11T18:05:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const pollMachineEnrollment = vi
      .fn<MachinesEnrollmentClient['pollMachineEnrollment']>()
      .mockResolvedValue(makePollResponse());
    deps.machinesApi.pollMachineEnrollment = pollMachineEnrollment;
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    deps.confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: deps.keyPairStore,
      controllerRegistryStore: deps.controllerRegistryStore!,
      client: deps.machinesApi,
      prompter: deps.prompter!,
      sleep,
      log: deps.log,
      logError: deps.logError,
    });

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(deps.machinesApi.createMachineEnrollment).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Code: BCDFG-HJKLM'));
  });

  it('replaces a server-terminal saved enrollment after waiting and preserves active authority', async () => {
    const deps = makeDeps();
    const existingPrivateKey = makeGeneratedKeyPair().privateKeyPem;
    await deps.keyPairStore.setCurrentMachineId(MACHINE_ID);
    await deps.keyPairStore.storePrivateKey(MACHINE_ID, existingPrivateKey);
    await deps.keyPairStore.storeMachineCredential(MACHINE_ID, 'existing-machine-credential');
    await deps.keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await deps.keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await deps.keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2099-08-11T18:05:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const pollMachineEnrollment = vi
      .fn<MachinesEnrollmentClient['pollMachineEnrollment']>()
      .mockResolvedValue(makePollResponse());
    deps.machinesApi.pollMachineEnrollment = pollMachineEnrollment;
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    deps.confirmation = new MachineEnrollmentConfirmation({
      keyPairStore: deps.keyPairStore,
      controllerRegistryStore: deps.controllerRegistryStore!,
      client: deps.machinesApi,
      prompter: deps.prompter!,
      sleep,
      log: deps.log,
      logError: deps.logError,
    });
    const createExistingMachineControllerEnrollment = vi
      .fn<MachineControllerManagementClient['createExistingMachineControllerEnrollment']>()
      .mockResolvedValue(makeResponse());
    deps.existingMachineClient = {
      createExistingMachineControllerEnrollment,
      inspectMachineControllers: vi.fn(),
      reconcileMachineControllers: vi.fn(),
      revokeMachineControllerLocally: vi.fn(),
    };

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(createExistingMachineControllerEnrollment).toHaveBeenCalledWith(MACHINE_ID);
    expect(deps.machinesApi.createMachineEnrollment).not.toHaveBeenCalled();
    await expect(deps.keyPairStore.loadPrivateKey(MACHINE_ID)).resolves.toBe(existingPrivateKey);
    await expect(deps.keyPairStore.loadMachineCredential(MACHINE_ID)).resolves.not.toBeNull();
  });

  it('continues with a fresh attempt when old-attempt cleanup fails', async () => {
    const keyPairStore = createTestKeyPairStore();
    const logger = { ...NOOP_LOGGER, debug: vi.fn() };
    const deps = makeDeps({ keyPairStore, logger });
    const existingPrivateKey = makeGeneratedKeyPair().privateKeyPem;
    await keyPairStore.setCurrentMachineId(MACHINE_ID);
    await keyPairStore.storePrivateKey(MACHINE_ID, existingPrivateKey);
    await keyPairStore.storeMachineCredential(MACHINE_ID, 'existing-machine-credential');
    await keyPairStore.storePendingEnrollmentId(ENROLLMENT_ID);
    await keyPairStore.storePendingEnrollmentSecret(ENROLLMENT_ID, DEVICE_SECRET);
    await keyPairStore.storePendingEnrollmentMetadata(
      ENROLLMENT_ID,
      JSON.stringify({
        enrollmentId: ENROLLMENT_ID,
        machineId: MACHINE_ID,
        expiresAt: '2020-01-01T00:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    deps.existingMachineClient = {
      createExistingMachineControllerEnrollment: vi.fn().mockResolvedValue(makeResponse()),
      inspectMachineControllers: vi.fn(),
      reconcileMachineControllers: vi.fn(),
      revokeMachineControllerLocally: vi.fn(),
    };
    vi.spyOn(keyPairStore, 'deletePendingEnrollmentSecret').mockRejectedValueOnce(
      new Error('keychain cleanup unavailable'),
    );

    await expect(runPairCommand(deps)).resolves.toBe(true);

    expect(deps.machinesApi.createMachineEnrollment).not.toHaveBeenCalled();
    await expect(keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
    await expect(keyPairStore.loadPrivateKey(MACHINE_ID)).resolves.toBe(existingPrivateKey);
    await expect(keyPairStore.loadMachineCredential(MACHINE_ID)).resolves.not.toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      'pair.saved_enrollment.cleanup_failed',
      expect.objectContaining({ enrollmentId: ENROLLMENT_ID, cleanupIndex: 0 }),
    );
  });

  it('does not report success when the mandatory local confirmation cannot poll', async () => {
    const pollMachineEnrollment = vi
      .fn<PairCommandDependencies['machinesApi']['pollMachineEnrollment']>()
      .mockRejectedValue(new Error('poll unavailable'));
    const deps = makeDeps({
      machinesApi: {
        createMachineEnrollment: vi
          .fn<MachinesEnrollmentClient['createMachineEnrollment']>()
          .mockResolvedValue(makeResponse()),
        pollMachineEnrollment,
        confirmMachineEnrollment: vi.fn(),
      },
    });

    await expect(runPairCommand(deps)).resolves.toBe(false);
    expect(deps.keyPairStore.setCurrentMachineId).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledWith(
      'Machine enrollment confirmation failed while waiting: poll unavailable',
    );
  });

  it('fails closed when protected retention is unavailable', async () => {
    const deps = makeDeps({
      keyPairStore: Object.assign(createTestKeyPairStore(), {
        storePrivateKey: vi.fn().mockRejectedValue(new Error('keychain unavailable')),
        storePendingEnrollmentSecret: vi.fn(),
      }),
    });

    await expect(runPairCommand(deps)).resolves.toBe(false);

    expect(deps.logError).toHaveBeenCalledWith(
      'Enrollment opened, but protected local retention failed: keychain unavailable',
    );
    expect(deps.keyPairStore.setCurrentMachineId).not.toHaveBeenCalled();
  });

  it('cleans partial pending state when secret retention fails', async () => {
    const keyPairStore = createTestKeyPairStore();
    const storePendingEnrollmentSecret = vi
      .spyOn(keyPairStore, 'storePendingEnrollmentSecret')
      .mockRejectedValue(new Error('secret store unavailable'));
    const deps = makeDeps({ keyPairStore });

    await expect(runPairCommand(deps)).resolves.toBe(false);

    expect(storePendingEnrollmentSecret).toHaveBeenCalledWith(ENROLLMENT_ID, DEVICE_SECRET);
    await expect(keyPairStore.loadPendingEnrollmentId()).resolves.toBeNull();
    await expect(keyPairStore.loadPendingEnrollmentSecret(ENROLLMENT_ID)).resolves.toBeNull();
    await expect(keyPairStore.loadPendingEnrollmentMetadata(ENROLLMENT_ID)).resolves.toBeNull();
  });

  it('prints only action guidance, the short code, and the direct pairing URL', async () => {
    const generated = makeGeneratedKeyPair();
    const deps = makeDeps({
      generateKeyPair: vi.fn(() => generated),
    });

    await expect(runPairCommand(deps)).resolves.toBe(true);

    const output = deps.log.mock.calls[0]![0];
    expect(output).toBe(
      [
        'Pair this machine in your browser.',
        'Code: BCDFG-HJKLM',
        'Open: https://test.heyhey.dev/pairing?code=BCDFG-HJKLM',
        'Keep this terminal open. After creating the passkey, return here to confirm.',
      ].join('\n'),
    );
    expect(output).not.toContain('2099-08-11T18:05:00.000Z');
    expect(output).not.toContain('test-machine');
    expect(output).not.toContain('linux');
    expect(output).not.toContain(MACHINE_ID);
    expect(output).not.toContain(DEVICE_SECRET);
    expect(output).not.toContain(generated.privateKeyPem);
  });
});
