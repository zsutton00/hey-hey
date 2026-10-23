import { MachineEnrollmentCeremony } from './machine-enrollment-ceremony';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import {
  ControllerRegistryStore,
  type ControllerRegistryEntry,
} from '../credentials/controller-registry';
import { generateMachineKeyPair } from '../credentials/keypair';
import { canonicalizeJson } from '../shared/canonical-json';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { CURRENT_AGENT_OPERATIONS } from '../server/controller-authorization/types';
import type { CreateMachineEnrollment201Response } from '../shared/api/index';
import type { MachineControllerManagementClient } from './machine-controller-management';
import { GatewayMachineAuthenticationError } from './machine-controller-management';
import {
  MachineEnrollmentConfirmation,
  type MachineEnrollmentConfirmationClient,
} from './machine-enrollment-confirmation';
import {
  MachineControllerAuthority,
  MachineDirectoryUnavailableError,
  type MachineDirectoryClient,
} from './machine-controller-authority';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001';
const CONTROLLER_ID = 'controller-1';
const CONTROLLER_INSTALLATION_ID = 'installation-1';
const CONTROLLER_FINGERPRINT = 'a'.repeat(64);
const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const directories: string[] = [];

const makeEntry = (): ControllerRegistryEntry => ({
  enrollmentId: 'enrollment-1',
  machineId: MACHINE_ID,
  machineName: 'test machine',
  osFamily: 'linux',
  cliVersion: '2.2.2',
  authorizationProtocolVersion: 2,
  accountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  controllerLabel: 'test passkey',
  controllerCredentialId: CONTROLLER_ID,
  controllerCredentialPublicKey: {
    kty: 'EC',
    crv: 'P-256',
    x: 'A'.repeat(43),
    y: 'B'.repeat(43),
  },
  controllerCredentialFingerprint: CONTROLLER_FINGERPRINT,
  backupEligible: true,
  backupState: false,
  enrolledAt: new Date(NOW).toISOString(),
});

const summary = {
  credentialId: CONTROLLER_ID,
  controllerCredentialPublicKey: {
    kty: 'EC' as const,
    crv: 'P-256' as const,
    x: 'A'.repeat(43),
    y: 'B'.repeat(43),
  },
  label: 'test passkey',
  fingerprint: CONTROLLER_FINGERPRINT,
  createdAt: new Date(NOW).toISOString(),
  lastUsedAt: null,
  backupEligible: true,
  backupState: false,
  revocationState: 'ACTIVE' as const,
  revokedAt: null,
};

const makeManagementClient = (): MachineControllerManagementClient & {
  createExistingMachineControllerEnrollment: ReturnType<
    typeof vi.fn<MachineControllerManagementClient['createExistingMachineControllerEnrollment']>
  >;
  reconcileMachineControllers: ReturnType<
    typeof vi.fn<MachineControllerManagementClient['reconcileMachineControllers']>
  >;
  revokeMachineControllerLocally: ReturnType<
    typeof vi.fn<MachineControllerManagementClient['revokeMachineControllerLocally']>
  >;
} => {
  const reconcileMachineControllers =
    vi.fn<MachineControllerManagementClient['reconcileMachineControllers']>();
  const revokeMachineControllerLocally =
    vi.fn<MachineControllerManagementClient['revokeMachineControllerLocally']>();
  return {
    createExistingMachineControllerEnrollment: vi.fn(),
    inspectMachineControllers: vi.fn(),
    reconcileMachineControllers,
    revokeMachineControllerLocally,
  };
};

const createAuthority = async (
  managementClient: MachineControllerManagementClient,
  machineDirectory?: MachineDirectoryClient,
): Promise<{
  authority: MachineControllerAuthority;
  keyPairStore: ReturnType<typeof createTestKeyPairStore>;
  registry: ControllerRegistryStore;
  grants: ExecutionGrantStore;
  directory: string;
  log: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
  logDebug: ReturnType<typeof vi.fn>;
  logDiagnosticError: ReturnType<typeof vi.fn>;
}> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-authority-test-'));
  directories.push(directory);
  const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
  await keyPairStore.storePrivateKey(MACHINE_ID, 'private-key');
  await keyPairStore.storeMachineCredential(MACHINE_ID, 'machine-credential');
  const registry = new ControllerRegistryStore({
    keyPairStore,
    filePath: path.join(directory, 'controllers.json'),
  });
  const grants = new ExecutionGrantStore({
    keyPairStore,
    filePath: path.join(directory, 'grants.json'),
    integrityKey: Buffer.alloc(32, 7),
    now: () => NOW,
  });
  const log = vi.fn();
  const logError = vi.fn();
  const logDebug = vi.fn();
  const logDiagnosticError = vi.fn();
  const authority = new MachineControllerAuthority({
    keyPairStore,
    controllerRegistryStore: registry,
    executionGrantStore: grants,
    managementClient,
    ...(machineDirectory ? { machineDirectory } : {}),
    now: () => NOW,
    log,
    logError,
    logDebug,
    logDiagnosticError,
  });
  return {
    authority,
    keyPairStore,
    registry,
    grants,
    directory,
    log,
    logError,
    logDebug,
    logDiagnosticError,
  };
};

const reconciliation = {
  success: true,
  message: 'ok',
  data: {
    machineId: MACHINE_ID,
    authorizationProtocolVersion: 2 as const,
    enrollmentState: 'READY' as const,
    executionReadiness: 'READY' as const,
    controllers: [summary],
    revokedControllerCredentialIds: [],
  },
  timestamp: new Date(NOW).toISOString(),
  statusCode: 200,
};

afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('MachineControllerAuthority', () => {
  it('presents a fresh controller handoff only after protected pending state is retained', async () => {
    const managementClient = makeManagementClient();
    const enrollment = {
      enrollmentId: 'enrollment-2',
      machineId: MACHINE_ID,
      deviceSecret: 'device-secret-not-output',
      userCode: 'BCDFG HJKLM',
      expiresAt: '2099-08-12T22:00:00.000Z',
      pollingIntervalSeconds: 5,
    };
    const response = {
      success: true,
      message: 'Machine enrollment opened successfully',
      data: enrollment,
      timestamp: '2026-08-12T21:00:00.000Z',
      statusCode: 201,
    } satisfies CreateMachineEnrollment201Response;
    managementClient.createExistingMachineControllerEnrollment.mockResolvedValue({
      data: response,
    });
    const { authority, keyPairStore, registry } = await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    const storePendingEnrollmentMetadata = vi.spyOn(keyPairStore, 'storePendingEnrollmentMetadata');
    const ceremony = new MachineEnrollmentCeremony();
    const onEnrollmentOpened = vi.fn();
    ceremony.observe((step) => {
      if (step.kind === 'browser-handoff') onEnrollmentOpened({ userCode: step.userCode });
    });
    const confirmationRun = vi
      .spyOn(MachineEnrollmentConfirmation.prototype, 'run')
      .mockResolvedValue({ outcome: 'declined' });

    try {
      await expect(authority.addController({ ports: ceremony.ports })).resolves.toEqual({
        outcome: 'declined',
      });

      expect(onEnrollmentOpened).toHaveBeenCalledWith({ userCode: enrollment.userCode });
      expect(storePendingEnrollmentMetadata).toHaveBeenCalledWith(
        enrollment.enrollmentId,
        expect.stringContaining(`\"userCode\":\"${enrollment.userCode}\"`),
      );
      expect(storePendingEnrollmentMetadata.mock.invocationCallOrder[0]).toBeLessThan(
        onEnrollmentOpened.mock.invocationCallOrder[0]!,
      );
      expect(confirmationRun).toHaveBeenCalledWith(
        expect.objectContaining({ userCode: enrollment.userCode }),
        { ports: ceremony.ports },
      );
    } finally {
      confirmationRun.mockRestore();
    }
  });

  it('reuses the retained code when controllers add resumes a pending enrollment', async () => {
    const managementClient = makeManagementClient();
    const { authority, keyPairStore } = await createAuthority(managementClient);
    await keyPairStore.storePendingEnrollmentId('pending-enrollment');
    await keyPairStore.storePendingEnrollmentSecret('pending-enrollment', 'device-secret');
    await keyPairStore.storePendingEnrollmentMetadata(
      'pending-enrollment',
      JSON.stringify({
        enrollmentId: 'pending-enrollment',
        machineId: MACHINE_ID,
        userCode: 'NPQRS-TVWXZ',
        expiresAt: '2099-08-12T22:00:00.000Z',
        pollingIntervalSeconds: 5,
      }),
    );
    const ceremony = new MachineEnrollmentCeremony();
    const onEnrollmentOpened = vi.fn();
    ceremony.observe((step) => {
      if (step.kind === 'browser-handoff') onEnrollmentOpened({ userCode: step.userCode });
    });
    const resumePendingEnrollment = vi
      .spyOn(MachineEnrollmentConfirmation.prototype, 'resumePendingEnrollment')
      .mockResolvedValue({ outcome: 'expired' });

    try {
      await expect(authority.addController({ ports: ceremony.ports })).resolves.toEqual({
        outcome: 'expired',
      });

      expect(onEnrollmentOpened).toHaveBeenCalledWith({ userCode: 'NPQRS-TVWXZ' });
      expect(managementClient.createExistingMachineControllerEnrollment).not.toHaveBeenCalled();
      expect(resumePendingEnrollment).toHaveBeenCalledWith(
        'pending-enrollment',
        undefined,
        ceremony.ports,
      );
    } finally {
      resumePendingEnrollment.mockRestore();
    }
  });

  it('preserves a machine-directory failure as a typed startup boundary error', async () => {
    const managementClient = makeManagementClient();
    const machineDirectory = {
      listMachines: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    } satisfies MachineDirectoryClient;
    const { authority, registry, logDiagnosticError } = await createAuthority(
      managementClient,
      machineDirectory,
    );
    await registry.upsert(makeEntry());

    await expect(authority.reconcileBeforeRuntime()).rejects.toBeInstanceOf(
      MachineDirectoryUnavailableError,
    );
    expect(logDiagnosticError).toHaveBeenCalledWith(
      'server_directory.failed',
      expect.objectContaining({
        machineId: MACHINE_ID,
        error: 'connect ECONNREFUSED',
      }),
    );
    expect(managementClient.reconcileMachineControllers).not.toHaveBeenCalled();
  });

  it('classifies an explicit gateway machine revocation as pairing-required readiness', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockRejectedValue(
      new GatewayMachineAuthenticationError('machine_revoked', 'machine revoked'),
    );
    const { authority, keyPairStore, registry, logDiagnosticError } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    const deleteMachineCredential = vi.spyOn(keyPairStore, 'deleteMachineCredential');

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('machine-revoked');
    expect(deleteMachineCredential).toHaveBeenCalledWith(MACHINE_ID);
    expect(logDiagnosticError).toHaveBeenCalledWith(
      'reconciliation.machine_revoked_authentication',
      expect.objectContaining({
        machineId: MACHINE_ID,
        priorState: 'ready',
        reason: 'machine_revoked',
      }),
    );
    expect(logDiagnosticError).not.toHaveBeenCalledWith('reconciliation.failed', expect.anything());
  });

  it('keeps a reasonless gateway authentication failure distinct and fail closed', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockRejectedValue(
      new GatewayMachineAuthenticationError(null, 'temporary gateway failure'),
    );
    const { authority, keyPairStore, registry, logDiagnosticError } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    const deleteMachineCredential = vi.spyOn(keyPairStore, 'deleteMachineCredential');

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('locally-inconsistent');
    expect(deleteMachineCredential).not.toHaveBeenCalled();
    expect(logDiagnosticError).toHaveBeenCalledWith(
      'reconciliation.failed',
      expect.objectContaining({ error: 'temporary gateway failure' }),
    );
  });

  it('classifies a locally paired machine missing from the server directory as unrecognized', async () => {
    const managementClient = makeManagementClient();
    const machineDirectory = {
      listMachines: vi.fn().mockResolvedValue({ data: { data: { machines: [] } } } as never),
    } satisfies MachineDirectoryClient;
    const { authority, keyPairStore, registry, logDiagnosticError } = await createAuthority(
      managementClient,
      machineDirectory,
    );
    await registry.upsert(makeEntry());
    const deleteMachineCredential = vi.spyOn(keyPairStore, 'deleteMachineCredential');

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('machine-unrecognized');
    expect(deleteMachineCredential).toHaveBeenCalledWith(MACHINE_ID);
    expect(managementClient.reconcileMachineControllers).not.toHaveBeenCalled();
    expect(logDiagnosticError).toHaveBeenCalledWith(
      'readiness.machine_unrecognized',
      expect.objectContaining({
        machineId: MACHINE_ID,
        reason: 'current_machine_absent_from_server_directory',
      }),
    );
  });

  it('does not misclassify a rejected machine-directory request as platform unavailability', async () => {
    const managementClient = makeManagementClient();
    const rejectedRequest = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    const machineDirectory = {
      listMachines: vi.fn().mockRejectedValue(rejectedRequest),
    } satisfies MachineDirectoryClient;
    const { authority, registry } = await createAuthority(managementClient, machineDirectory);
    await registry.upsert(makeEntry());

    await expect(authority.reconcileBeforeRuntime()).rejects.toBe(rejectedRequest);
    expect(managementClient.reconcileMachineControllers).not.toHaveBeenCalled();
  });

  it('durably removes all machine authority before a live machine reduction resolves', async () => {
    const managementClient = makeManagementClient();
    const { authority, keyPairStore, registry, grants, directory } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    await grants.create({
      grantId: '00000000-0000-4000-8000-000000000006',
      descriptor: {
        scope: 'controller_device_window',
        controllerCredentialId: CONTROLLER_ID,
        controllerInstallationId: CONTROLLER_INSTALLATION_ID,
        machineId: MACHINE_ID,
        userId: makeEntry().accountId,
        organizationId: makeEntry().organizationId,
        cadence: 'ONE_DAY',
        policyRevision: 1,
        allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
        allowedActionCategories: new Set(['CONVERSATION']),
        issuedAtMs: NOW,
        effectiveExpiresAtMs: NOW + ONE_DAY_MS,
      },
      descriptorHash: 'c'.repeat(64),
      controllerCredentialFingerprint: CONTROLLER_FINGERPRINT,
    });

    await authority.applyVerifiedAuthorityReduction({
      protocolVersion: 2,
      machineId: MACHINE_ID,
      userId: makeEntry().accountId,
      nonce: '00000000-0000-4000-8000-000000000007',
      timestampMs: NOW,
      signature: 'already-verified',
      event: {
        version: 2,
        kind: 'machine_revocation_reduction',
        action: 'MACHINE_REVOKE',
        machineId: MACHINE_ID,
        revokedAt: new Date(NOW).toISOString(),
        executionReadiness: 'MACHINE_REVOKED',
      },
    });

    const restartedGrantStore = new ExecutionGrantStore({
      keyPairStore,
      filePath: path.join(directory, 'grants.json'),
      integrityKey: Buffer.alloc(32, 7),
      now: () => NOW,
    });
    expect(await restartedGrantStore.list()).toEqual([
      expect.objectContaining({
        grantId: '00000000-0000-4000-8000-000000000006',
        revoked: true,
        suspended: true,
      }),
    ]);
    expect((await registry.read())?.controllers).toEqual([]);
    await expect(keyPairStore.loadMachineCredential(MACHINE_ID)).resolves.toBeNull();
  });

  it('reconciles the authenticated server snapshot before reporting ready', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockResolvedValue({
      data: {
        ...reconciliation,
        data: {
          ...reconciliation.data,
          controllers: [{ ...summary, fingerprint: CONTROLLER_FINGERPRINT.slice(0, 16) }],
        },
      },
    });
    const { authority, registry, logDebug } = await createAuthority(managementClient);
    await registry.upsert(makeEntry());

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('ready');
    expect(managementClient.reconcileMachineControllers).toHaveBeenCalledWith(
      MACHINE_ID,
      new Set([CONTROLLER_ID]),
    );
    expect(logDebug).toHaveBeenCalledWith(
      'reconciliation.response_received',
      expect.objectContaining({
        controllerCount: 1,
        revokedControllerCredentialIdsRuntimeType: 'array',
      }),
    );
    expect(logDebug).toHaveBeenCalledWith(
      'reconciliation.completed',
      expect.objectContaining({ state: 'ready' }),
    );
    expect((await registry.read())?.controllers[0]?.controllerCredentialFingerprint).toBe(
      CONTROLLER_FINGERPRINT,
    );
  });

  it('does not block existing machine authority while an additional enrollment is pending', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockResolvedValue({ data: reconciliation });
    const { authority, keyPairStore, registry, logDebug } = await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    await keyPairStore.storePendingEnrollmentId('pending-enrollment');

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('ready');
    expect(managementClient.reconcileMachineControllers).toHaveBeenCalledWith(
      MACHINE_ID,
      new Set([CONTROLLER_ID]),
    );
    expect(logDebug).toHaveBeenCalledWith('local_snapshot.pending_enrollment_retained', {
      hasPendingEnrollmentId: true,
      machineId: MACHINE_ID,
      reason: 'existing_machine_authority_remains_usable',
    });
  });

  it('resumes an interrupted first enrollment during ordinary startup', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-pending-authority-test-'));
    directories.push(directory);
    const keyPairStore = createTestKeyPairStore();
    const registry = new ControllerRegistryStore({
      keyPairStore,
      filePath: path.join(directory, 'controllers.json'),
    });
    const grants = new ExecutionGrantStore({
      keyPairStore,
      filePath: path.join(directory, 'grants.json'),
      integrityKey: Buffer.alloc(32, 7),
      now: () => NOW,
    });
    const generated = generateMachineKeyPair();
    const enrollmentId = 'pending-enrollment';
    const expiresAt = new Date(NOW + 60_000).toISOString();
    const claim = {
      ...makeEntry(),
      enrollmentId,
      expiresAt,
      confirmationNonce: 'confirmation-nonce',
      state: 'ready' as const,
    };
    const activation = {
      machineCredential: 'machine-credential',
      serverSigningPublicKey: 'server-signing-key',
      authorizationProtocolVersion: 2 as const,
      activatedBinding: {
        enrollmentId,
        machineId: MACHINE_ID,
        machineName: claim.machineName,
        osFamily: claim.osFamily,
        cliVersion: claim.cliVersion,
        accountId: claim.accountId,
        organizationId: claim.organizationId,
        controllerLabel: claim.controllerLabel,
        controllerCredentialId: claim.controllerCredentialId,
        controllerCredentialPublicKey: claim.controllerCredentialPublicKey,
        controllerCredentialFingerprint: claim.controllerCredentialFingerprint,
        backupEligible: claim.backupEligible,
        backupState: claim.backupState,
      },
    };
    await keyPairStore.storePrivateKey(MACHINE_ID, generated.privateKeyPem);
    await keyPairStore.storePendingEnrollmentId(enrollmentId);
    await keyPairStore.storePendingEnrollmentSecret(enrollmentId, 'device-secret');
    await keyPairStore.storePendingEnrollmentMetadata(
      enrollmentId,
      JSON.stringify({
        enrollmentId,
        machineId: MACHINE_ID,
        expiresAt,
        pollingIntervalSeconds: 5,
      }),
    );
    const enrollmentClient: MachineEnrollmentConfirmationClient = {
      pollMachineEnrollment: vi.fn().mockResolvedValue(claim),
      confirmMachineEnrollment: vi.fn().mockResolvedValue(activation),
    };
    const confirmation = new MachineEnrollmentConfirmation({
      keyPairStore,
      controllerRegistryStore: registry,
      client: enrollmentClient,
      prompter: { confirm: vi.fn().mockResolvedValue(true) },
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => NOW,
      log: vi.fn(),
      logError: vi.fn(),
    });
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockResolvedValue({ data: reconciliation });
    const authority = new MachineControllerAuthority({
      keyPairStore,
      controllerRegistryStore: registry,
      executionGrantStore: grants,
      managementClient,
      confirmation,
      now: () => NOW,
      log: vi.fn(),
      logError: vi.fn(),
      logDebug: vi.fn(),
      logDiagnosticError: vi.fn(),
    });

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('ready');
    await expect(keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
    expect(managementClient.reconcileMachineControllers).toHaveBeenCalledWith(
      MACHINE_ID,
      new Set([CONTROLLER_ID]),
    );
  });

  it('reports server-only controllers without blocking locally admitted authority', async () => {
    const managementClient = makeManagementClient();
    const serverOnlyController = {
      ...summary,
      credentialId: 'server-only-controller',
      controllerCredentialPublicKey: {
        kty: 'EC' as const,
        crv: 'P-256' as const,
        x: 'C'.repeat(43),
        y: 'D'.repeat(43),
      },
      fingerprint: 'b'.repeat(64),
    };
    managementClient.reconcileMachineControllers.mockResolvedValue({
      data: {
        ...reconciliation,
        data: {
          ...reconciliation.data,
          controllers: [summary, serverOnlyController],
        },
      },
    });
    const { authority, registry, logDebug, logDiagnosticError } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('ready');
    expect(result.localControllers).toHaveLength(1);
    expect(result.serverControllers).toHaveLength(2);
    expect(logDebug).toHaveBeenCalledWith(
      'reconciliation.server_controllers_not_locally_admitted',
      expect.objectContaining({
        unknownServerControllerIds: ['server-only-controller'],
        reason: 'server_inventory_is_disclosure_only_local_registry_remains_authority_allowlist',
      }),
    );
    expect(logDiagnosticError).not.toHaveBeenCalledWith(
      'reconciliation.unknown_server_controllers',
      expect.anything(),
    );
  });

  it('fails closed and logs the runtime response shape when revoked IDs are not an array', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockResolvedValue({
      data: {
        ...reconciliation,
        data: {
          ...reconciliation.data,
          revokedControllerCredentialIds: {},
        },
      },
    } as never);
    const { authority, registry, logDebug, logDiagnosticError } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('locally-inconsistent');
    expect(logDebug).toHaveBeenCalledWith(
      'reconciliation.response_received',
      expect.objectContaining({
        revokedControllerCredentialIdsRuntimeType: '[object Object]',
        revokedControllerCredentialIdCount: -1,
      }),
    );
    expect(logDiagnosticError).toHaveBeenCalledWith(
      'reconciliation.failed',
      expect.objectContaining({
        error:
          'Controller reconciliation response field revokedControllerCredentialIds must be an array; received [object Object]',
        stack: expect.any(String),
      }),
    );
  });

  it('accepts disconnected presence after durable controller authority reconciles', async () => {
    const managementClient = makeManagementClient();
    managementClient.reconcileMachineControllers.mockResolvedValue({
      data: {
        ...reconciliation,
        data: {
          ...reconciliation.data,
          executionReadiness: 'DISCONNECTED',
        },
      },
    });
    const { authority, registry, logDebug, logDiagnosticError } =
      await createAuthority(managementClient);
    await registry.upsert(makeEntry());

    const result = await authority.reconcileBeforeRuntime();

    expect(result.state).toBe('ready');
    expect(result.serverExecutionReadiness).toBe('DISCONNECTED');
    expect(logDebug).toHaveBeenCalledWith('reconciliation.disconnected_presence_accepted', {
      machineId: MACHINE_ID,
      executionReadiness: 'DISCONNECTED',
      reason: 'local_transport_starts_after_durable_authority_reconciliation',
    });
    expect(logDiagnosticError).not.toHaveBeenCalledWith(
      'reconciliation.server_not_ready',
      expect.anything(),
    );
  });

  it('fails closed on a tampered registry', async () => {
    const managementClient = makeManagementClient();
    const { authority, registry } = await createAuthority(managementClient);
    await registry.upsert(makeEntry());
    const serialized = await fs.readFile(registry.path, 'utf8');
    await fs.writeFile(registry.path, serialized.replace('test passkey', 'tampered passkey'));

    const result = await authority.readReadiness();

    expect(result.state).toBe('locally-inconsistent');
    expect(managementClient.reconcileMachineControllers).not.toHaveBeenCalled();
  });

  it('verifies the signed reduction, revokes only the selected controller grants, and is idempotent', async () => {
    const serverKeys = crypto.generateKeyPairSync('ed25519');
    const rawServerPublicKey = serverKeys.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32);
    const managementClient = makeManagementClient();
    const { authority, keyPairStore, registry, grants, logError } =
      await createAuthority(managementClient);
    await keyPairStore.storeServerSigningPublicKey(
      MACHINE_ID,
      rawServerPublicKey.toString('base64'),
    );
    await registry.upsert(makeEntry());
    await grants.create({
      grantId: '00000000-0000-4000-8000-000000000004',
      descriptor: {
        scope: 'controller_device_window',
        controllerCredentialId: CONTROLLER_ID,
        controllerInstallationId: CONTROLLER_INSTALLATION_ID,
        machineId: MACHINE_ID,
        userId: makeEntry().accountId,
        organizationId: makeEntry().organizationId,
        cadence: 'ONE_DAY',
        policyRevision: 1,
        allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
        allowedActionCategories: new Set(['CONVERSATION']),
        issuedAtMs: NOW,
        effectiveExpiresAtMs: NOW + ONE_DAY_MS,
      },
      descriptorHash: 'a'.repeat(64),
      controllerCredentialFingerprint: CONTROLLER_FINGERPRINT,
    });
    await grants.create({
      grantId: '00000000-0000-4000-8000-000000000005',
      descriptor: {
        scope: 'controller_device_window',
        controllerCredentialId: 'controller-2',
        controllerInstallationId: 'installation-2',
        machineId: MACHINE_ID,
        userId: makeEntry().accountId,
        organizationId: makeEntry().organizationId,
        cadence: 'ONE_DAY',
        policyRevision: 1,
        allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
        allowedActionCategories: new Set(['CONVERSATION']),
        issuedAtMs: NOW,
        effectiveExpiresAtMs: NOW + ONE_DAY_MS,
      },
      descriptorHash: 'b'.repeat(64),
      controllerCredentialFingerprint: 'b'.repeat(64),
    });

    const frameWithoutSignature = {
      machineId: MACHINE_ID,
      userId: makeEntry().accountId,
      controllerCredentialId: CONTROLLER_ID,
      nonce: 'reduction-nonce',
      timestampMs: NOW,
      protocolVersion: 2 as const,
      event: {
        version: 2 as const,
        kind: 'controller_revocation_reduction' as const,
        action: 'CONTROLLER_REVOKE' as const,
        machineId: MACHINE_ID,
        controllerCredentialId: CONTROLLER_ID,
        revokedAt: new Date(NOW).toISOString(),
        enrollmentState: 'NO_CONTROLLER' as const,
        executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED' as const,
      },
    };
    const signature = crypto
      .sign(
        null,
        Buffer.from(
          canonicalizeJson({ ...frameWithoutSignature, event: frameWithoutSignature.event }),
          'utf8',
        ),
        serverKeys.privateKey,
      )
      .toString('base64');
    managementClient.revokeMachineControllerLocally.mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        data: {
          outcome: 'REVOKED' as const,
          machineId: MACHINE_ID,
          controllerCredentialId: CONTROLLER_ID,
          revokedAt: new Date(NOW).toISOString(),
          executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED' as const,
          reductionFrame: { ...frameWithoutSignature, signature },
        },
        timestamp: new Date(NOW).toISOString(),
        statusCode: 200,
      },
    });

    await expect(authority.revokeController(CONTROLLER_ID)).resolves.toBe(true);
    expect(logError).not.toHaveBeenCalled();
    await expect(authority.revokeController(CONTROLLER_ID)).resolves.toBe(true);
    const remaining = await grants.list();
    expect(remaining.find((grant) => grant.controllerCredentialId === CONTROLLER_ID)?.revoked).toBe(
      true,
    );
    expect(
      remaining.find((grant) => grant.controllerCredentialId === 'controller-2')?.revoked,
    ).toBe(false);
    expect((await registry.read())?.controllers).toHaveLength(0);
  });
});
