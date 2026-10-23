import { createPublicKey } from 'node:crypto';
import os from 'node:os';

import { version as cliVersion } from '../../package.json';
import { createInteractivePrompter, type CredentialPrompter } from '@hey-hey/ui-common/agents';
import {
  generateMachineKeyPair,
  KeyPairStore,
  ControllerRegistryStore,
  type GeneratedMachineKeyPair,
} from '../credentials/index';
import { CreateMachineEnrollmentRequestDtoAuthorizationProtocolVersionEnum } from '../shared/api/index';
import type {
  CreateMachineEnrollment201Response,
  CreateMachineEnrollmentRequestDto,
  CreateMachineEnrollmentResponseDto,
} from '../shared/api/index';
import { MachineEnrollmentError, toMachineEnrollmentError } from '../auth/machine-enrollment';
import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import {
  createDefaultMachineControllerManagementClient,
  GatewayMachineAuthenticationError,
  type MachineControllerManagementClient,
} from '../auth/machine-controller-management';
import { WebSocketMachineAuthenticationErrorResponseReasonEnum } from '../shared/api/index';
import {
  MachineEnrollmentConfirmation,
  type MachineEnrollmentConfirmationClient,
  type MachineEnrollmentConfirmationResult,
} from '../auth/machine-enrollment-confirmation';
import {
  attachDirectEnrollmentOutput,
  MachineEnrollmentCeremony,
  type MachineEnrollmentCeremonyPorts,
} from '../auth/machine-enrollment-ceremony';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { StructuredServerLogger, type ServerLogger } from '../server/logger';
import { resolvePairingUrl } from './pairing-web-url';
import { describeEnrollment } from './pairing-presentation';

export interface MachinesEnrollmentClient {
  createMachineEnrollment(
    dto: CreateMachineEnrollmentRequestDto,
  ): Promise<{ data: CreateMachineEnrollment201Response }>;
  pollMachineEnrollment: MachineEnrollmentConfirmationClient['pollMachineEnrollment'];
  confirmMachineEnrollment: MachineEnrollmentConfirmationClient['confirmMachineEnrollment'];
}

export interface PairCommandDependencies {
  keyPairStore: KeyPairStore;
  machinesApi: MachinesEnrollmentClient;
  generateKeyPair: () => GeneratedMachineKeyPair;
  getMachineName: () => string;
  getOsFamily: () => CreateMachineEnrollmentRequestDto['osFamily'];
  cliVersion: string;
  getPairingUrl: (userCode?: string) => string;
  logger: ServerLogger;
  controllerRegistryStore?: ControllerRegistryStore;
  executionGrantStore?: ExecutionGrantStore;
  existingMachineClient?: MachineControllerManagementClient;
  confirmation?: MachineEnrollmentConfirmation;
  prompter?: Pick<CredentialPrompter, 'confirm'>;
  log: (message: string) => void;
  logError: (message: string) => void;
}

/** Converts the DER-encoded SPKI public key from the pure key generator into PEM. */
const encodePublicKeyPem = (publicKey: Buffer): string =>
  createPublicKey({ key: publicKey, format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'pem' })
    .toString();

const createDefaultMachinesApi = (): MachinesEnrollmentClient =>
  createDefaultMachineEnrollmentClient();

const createDefaultExistingMachineClient = (
  keyPairStore: KeyPairStore,
): MachineControllerManagementClient =>
  createDefaultMachineControllerManagementClient(keyPairStore);

const getHostOsFamily = (): CreateMachineEnrollmentRequestDto['osFamily'] => {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      throw new Error(`Unsupported operating-system family: ${process.platform}`);
  }
};

const isEnrollmentResponse = (
  value: CreateMachineEnrollmentResponseDto | undefined,
): value is CreateMachineEnrollmentResponseDto =>
  value !== undefined &&
  typeof value.enrollmentId === 'string' &&
  value.enrollmentId.length > 0 &&
  typeof value.machineId === 'string' &&
  value.machineId.length > 0 &&
  typeof value.deviceSecret === 'string' &&
  value.deviceSecret.length > 0 &&
  typeof value.userCode === 'string' &&
  value.userCode.length > 0 &&
  typeof value.expiresAt === 'string' &&
  value.expiresAt.length > 0;

const describeEnrollmentFailure = (error: MachineEnrollmentError): string => {
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== undefined) {
    return `Enrollment failed: ${error.message} (retry after ${String(error.retryAfterSeconds)}s)`;
  }
  return `Enrollment failed: ${error.message}`;
};

const createConfirmationOwner = (
  dependencies: PairCommandDependencies,
): MachineEnrollmentConfirmation => {
  if (dependencies.confirmation) return dependencies.confirmation;
  return new MachineEnrollmentConfirmation({
    keyPairStore: dependencies.keyPairStore,
    controllerRegistryStore:
      dependencies.controllerRegistryStore ??
      new ControllerRegistryStore({ keyPairStore: dependencies.keyPairStore }),
    client: dependencies.machinesApi,
    prompter: dependencies.prompter ?? createInteractivePrompter(),
    log: dependencies.log,
    logError: dependencies.logError,
  });
};

const FAILED: MachineEnrollmentConfirmationResult = { outcome: 'failed' };

const detachSavedAttemptForExplicitPair = async (
  keyPairStore: KeyPairStore,
  logger: ServerLogger,
): Promise<string | null> => {
  let enrollmentId: string | null = null;
  try {
    enrollmentId = await keyPairStore.loadPendingEnrollmentId();
    await keyPairStore.deletePendingEnrollmentId();
  } catch (error) {
    logger.debug('pair.saved_enrollment.detach_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!enrollmentId) return null;

  const cleanupResults = await Promise.allSettled([
    keyPairStore.deletePendingEnrollmentSecret(enrollmentId),
    keyPairStore.deletePendingEnrollmentMetadata(enrollmentId),
    keyPairStore.deletePendingEnrollmentActivation(enrollmentId),
  ]);
  cleanupResults.forEach((result, cleanupIndex) => {
    if (result.status !== 'rejected') return;
    logger.debug('pair.saved_enrollment.cleanup_failed', {
      enrollmentId,
      cleanupIndex,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  return enrollmentId;
};

const isMachineRevokedAuthenticationError = (
  error: unknown,
): error is GatewayMachineAuthenticationError =>
  error instanceof GatewayMachineAuthenticationError &&
  error.reason === WebSocketMachineAuthenticationErrorResponseReasonEnum.MachineRevoked;

/**
 * Removes only the local authority for a server-revoked machine. The server
 * machine and its audit history are intentionally untouched; the next branch
 * opens a new machine enrollment for this physical computer.
 */
const clearRevokedMachineAuthority = async (
  dependencies: PairCommandDependencies,
  machineId: string,
): Promise<void> => {
  const controllerRegistryStore =
    dependencies.controllerRegistryStore ??
    new ControllerRegistryStore({ keyPairStore: dependencies.keyPairStore });
  const executionGrantStore =
    dependencies.executionGrantStore ??
    new ExecutionGrantStore({ keyPairStore: dependencies.keyPairStore });
  const results = await Promise.allSettled([
    executionGrantStore.revokeAll(),
    controllerRegistryStore.removeMachine(machineId),
    dependencies.keyPairStore.deleteMachineCredential(machineId),
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
  }
};

export const resolvePairDependencies = (
  dependencies: Partial<PairCommandDependencies>,
): PairCommandDependencies => ({
  keyPairStore: dependencies.keyPairStore ?? new KeyPairStore(),
  machinesApi: dependencies.machinesApi ?? createDefaultMachinesApi(),
  generateKeyPair: dependencies.generateKeyPair ?? generateMachineKeyPair,
  getMachineName: dependencies.getMachineName ?? os.hostname,
  getOsFamily: dependencies.getOsFamily ?? getHostOsFamily,
  cliVersion: dependencies.cliVersion ?? cliVersion,
  getPairingUrl: dependencies.getPairingUrl ?? resolvePairingUrl,
  logger: dependencies.logger ?? new StructuredServerLogger().child({ component: 'pair-command' }),
  ...(dependencies.controllerRegistryStore
    ? { controllerRegistryStore: dependencies.controllerRegistryStore }
    : {}),
  ...(dependencies.executionGrantStore
    ? { executionGrantStore: dependencies.executionGrantStore }
    : {}),
  ...(dependencies.existingMachineClient
    ? { existingMachineClient: dependencies.existingMachineClient }
    : {}),
  ...(dependencies.confirmation ? { confirmation: dependencies.confirmation } : {}),
  ...(dependencies.prompter ? { prompter: dependencies.prompter } : {}),
  log: dependencies.log ?? console.log,
  logError: dependencies.logError ?? console.error,
});

const problem = (ports: MachineEnrollmentCeremonyPorts, message: string): void => {
  ports.step({ kind: 'problem', message });
};

/**
 * Direct `heyhey pair`: runs the pairing ceremony with terminal output and the
 * terminal prompter answering the local review.
 */
export const runPairCommand = async (
  dependencies: Partial<PairCommandDependencies> = {},
): Promise<boolean> => {
  const deps = resolvePairDependencies(dependencies);
  const ceremony = new MachineEnrollmentCeremony();
  attachDirectEnrollmentOutput(ceremony, {
    log: deps.log,
    logError: deps.logError,
    prompter: deps.prompter ?? createInteractivePrompter(),
    describeHandoff: (userCode) => describeEnrollment({ userCode }, deps.getPairingUrl(userCode)),
  });
  const result = await ceremony.run(
    (ports) => pairMachine(deps, ports),
    () => FAILED,
  );
  return result.outcome === 'confirmed';
};

/**
 * Opens a protocol-version-2 enrollment from the machine that will run Hey
 * Hey. The API call is deliberately unauthenticated: the local key and the
 * one-time device secret are retained for the later browser-authorized step.
 * Every step and the local review go through `ports`.
 */
export const pairMachine = async (
  deps: PairCommandDependencies,
  ports: MachineEnrollmentCeremonyPorts,
): Promise<MachineEnrollmentConfirmationResult> => {
  const detachedEnrollmentId = await detachSavedAttemptForExplicitPair(
    deps.keyPairStore,
    deps.logger,
  );
  if (detachedEnrollmentId) {
    deps.logger.debug('pair.saved_enrollment.detached', {
      enrollmentId: detachedEnrollmentId,
      reason: 'explicit_pair_opens_fresh_attempt',
    });
  }

  const existingMachineId = await deps.keyPairStore.loadCurrentMachineId();
  if (existingMachineId) {
    const [machineCredential, privateKey] = await Promise.all([
      deps.keyPairStore.loadMachineCredential(existingMachineId),
      deps.keyPairStore.loadPrivateKey(existingMachineId),
    ]);
    if (!machineCredential || !privateKey) {
      problem(
        ports,
        'This machine has incomplete protected authority. Run `heyhey status`; do not start a new first-machine enrollment.',
      );
      return FAILED;
    }

    let response: { data: CreateMachineEnrollment201Response } | null = null;
    try {
      response = await (
        deps.existingMachineClient ?? createDefaultExistingMachineClient(deps.keyPairStore)
      ).createExistingMachineControllerEnrollment(existingMachineId);
    } catch (error) {
      if (isMachineRevokedAuthenticationError(error)) {
        deps.logger.debug('pair.existing_machine.machine_revoked', {
          machineId: existingMachineId,
          reason: error.reason,
        });
        try {
          deps.logger.debug('pair.existing_machine.authority_cleanup_started', {
            machineId: existingMachineId,
          });
          await clearRevokedMachineAuthority(deps, existingMachineId);
          deps.logger.debug('pair.existing_machine.authority_cleanup_completed', {
            machineId: existingMachineId,
            reason: 'machine_revoked_terminal_for_old_identity',
          });
        } catch (cleanupError) {
          problem(
            ports,
            `Revoked machine authority could not be cleared locally: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
          return FAILED;
        }
      } else {
        problem(
          ports,
          `Controller upgrade could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
        return FAILED;
      }
    }
    if (response === null) {
      deps.logger.debug('pair.existing_machine.falling_back_to_fresh_enrollment', {
        machineId: existingMachineId,
        reason: 'machine_revoked',
      });
    } else {
      const enrollment = response.data.data;
      if (!isEnrollmentResponse(enrollment)) {
        problem(ports, 'Controller upgrade returned an unexpected response.');
        return FAILED;
      }
      if (detachedEnrollmentId) {
        deps.logger.debug('pair.saved_enrollment.replaced', {
          enrollmentId: detachedEnrollmentId,
          replacementEnrollmentId: enrollment.enrollmentId,
          machineId: enrollment.machineId,
        });
      }
      try {
        await deps.keyPairStore.storePendingEnrollmentId(enrollment.enrollmentId);
        await deps.keyPairStore.storePendingEnrollmentSecret(
          enrollment.enrollmentId,
          enrollment.deviceSecret,
        );
        await deps.keyPairStore.storePendingEnrollmentMetadata(
          enrollment.enrollmentId,
          JSON.stringify({
            enrollmentId: enrollment.enrollmentId,
            machineId: enrollment.machineId,
            userCode: enrollment.userCode,
            expiresAt: enrollment.expiresAt,
            pollingIntervalSeconds: enrollment.pollingIntervalSeconds,
          }),
        );
      } catch (error) {
        const confirmation = createConfirmationOwner(deps);
        try {
          await confirmation.discardPendingEnrollment(enrollment.enrollmentId);
        } catch (cleanupError) {
          problem(
            ports,
            `Could not clean up protected pending enrollment state: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        }
        problem(
          ports,
          `Controller upgrade opened, but protected local retention failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return FAILED;
      }
      ports.step({ kind: 'browser-handoff', userCode: enrollment.userCode });
      const confirmation = createConfirmationOwner(deps);
      return confirmation.run(
        {
          enrollmentId: enrollment.enrollmentId,
          machineId: enrollment.machineId,
          deviceSecret: enrollment.deviceSecret,
          pollingIntervalSeconds: enrollment.pollingIntervalSeconds,
          expiresAt: enrollment.expiresAt,
          userCode: enrollment.userCode,
        },
        { ports },
      );
    }
  }

  let generated: GeneratedMachineKeyPair;
  let machineName: string;
  let osFamily: CreateMachineEnrollmentRequestDto['osFamily'];
  try {
    generated = deps.generateKeyPair();
    machineName = deps.getMachineName();
    osFamily = deps.getOsFamily();
  } catch (error) {
    problem(
      ports,
      `Enrollment failed: could not prepare local machine identity. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return FAILED;
  }

  const request: CreateMachineEnrollmentRequestDto = {
    machinePublicKey: encodePublicKeyPem(generated.publicKey),
    machineName,
    osFamily,
    cliVersion: deps.cliVersion,
    authorizationProtocolVersion:
      CreateMachineEnrollmentRequestDtoAuthorizationProtocolVersionEnum.NUMBER_2,
  };

  let response: { data: CreateMachineEnrollment201Response };
  try {
    response = await deps.machinesApi.createMachineEnrollment(request);
  } catch (error) {
    problem(
      ports,
      describeEnrollmentFailure(
        error instanceof Error
          ? toMachineEnrollmentError(error)
          : new MachineEnrollmentError('Enrollment failed unexpectedly.', 'UNEXPECTED'),
      ),
    );
    return FAILED;
  }

  const enrollment = response.data.data;
  if (!isEnrollmentResponse(enrollment)) {
    problem(
      ports,
      describeEnrollmentFailure(
        new MachineEnrollmentError(
          'Machine enrollment returned an unexpected response.',
          'INVALID_RESPONSE',
        ),
      ),
    );
    return FAILED;
  }
  if (detachedEnrollmentId) {
    deps.logger.debug('pair.saved_enrollment.replaced', {
      enrollmentId: detachedEnrollmentId,
      replacementEnrollmentId: enrollment.enrollmentId,
      machineId: enrollment.machineId,
    });
  }

  try {
    await deps.keyPairStore.storePrivateKey(enrollment.machineId, generated.privateKeyPem);
    await deps.keyPairStore.storePendingEnrollmentId(enrollment.enrollmentId);
    await deps.keyPairStore.storePendingEnrollmentSecret(
      enrollment.enrollmentId,
      enrollment.deviceSecret,
    );
    await deps.keyPairStore.storePendingEnrollmentMetadata(
      enrollment.enrollmentId,
      JSON.stringify({
        enrollmentId: enrollment.enrollmentId,
        machineId: enrollment.machineId,
        machineName,
        osFamily,
        userCode: enrollment.userCode,
        expiresAt: enrollment.expiresAt,
        pollingIntervalSeconds: enrollment.pollingIntervalSeconds,
      }),
    );
  } catch (error) {
    const confirmation = createConfirmationOwner(deps);
    try {
      await confirmation.discardPendingEnrollment(enrollment.enrollmentId);
    } catch (cleanupError) {
      problem(
        ports,
        `Could not clean up protected pending enrollment state: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
    problem(
      ports,
      `Enrollment opened, but protected local retention failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return FAILED;
  }

  ports.step({ kind: 'browser-handoff', userCode: enrollment.userCode });

  const confirmation = createConfirmationOwner(deps);
  return confirmation.run(enrollment, { ports });
};
