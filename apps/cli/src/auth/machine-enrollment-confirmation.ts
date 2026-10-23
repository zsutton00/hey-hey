import { createPrivateKey, sign } from 'node:crypto';

import type { CredentialPrompter } from '../agent-runtime/index';
import { isAxiosError } from 'axios';
import { z } from 'zod';

import type {
  ConfirmMachineEnrollmentRequestDto,
  ConfirmMachineEnrollmentResponseDto,
  MachineEnrollmentActivatedBindingDto,
  MachineEnrollmentConfirmationPayloadDto,
  MachineEnrollmentPollReadyDto,
  PollMachineEnrollmentResponseDto,
} from '../shared/api/index';
import {
  ControllerRegistryStore,
  type ControllerRegistryEntry,
} from '../credentials/controller-registry';
import { KeyPairStore } from '../credentials/keypair';
import { canonicalizeJson, type CanonicalJsonValue } from '../shared/canonical-json';
import {
  attachDirectEnrollmentOutput,
  MachineEnrollmentCancelledError,
  MachineEnrollmentCeremony,
  toMachineEnrollmentReview,
  type MachineEnrollmentCeremonyPorts,
} from './machine-enrollment-ceremony';

/** Generated ready-state evidence retained for local review and recovery. */
export type PendingMachineEnrollment = MachineEnrollmentPollReadyDto;
export type MachineEnrollmentActivationResponse = ConfirmMachineEnrollmentResponseDto;
export type MachineEnrollmentConfirmationPayload = MachineEnrollmentConfirmationPayloadDto;
type MachineEnrollmentConfirmationRequest = ConfirmMachineEnrollmentRequestDto;

export interface MachineEnrollmentSeed {
  enrollmentId: string;
  machineId: string;
  deviceSecret: string;
  pollingIntervalSeconds: number;
  expiresAt: string;
  userCode?: string | undefined;
}

export interface StoredPendingEnrollmentMetadata {
  enrollmentId: string;
  machineId: string;
  machineName?: string | undefined;
  osFamily?: string | undefined;
  userCode?: string | undefined;
  expiresAt: string;
  pollingIntervalSeconds: number;
  claim?: MachineEnrollmentPollReadyDto | undefined;
}

export interface MachineEnrollmentConfirmationClient {
  pollMachineEnrollment(
    enrollmentId: string,
    deviceSecret: string,
  ): Promise<PollMachineEnrollmentResponseDto>;
  confirmMachineEnrollment(
    request: ConfirmMachineEnrollmentRequestDto,
  ): Promise<ConfirmMachineEnrollmentResponseDto>;
}

export type MachineEnrollmentConfirmationResult =
  | { outcome: 'declined' }
  | { outcome: 'expired' }
  | { outcome: 'terminal' }
  | { outcome: 'confirmed'; activation: MachineEnrollmentActivationResponse }
  | { outcome: 'cancelled' }
  | { outcome: 'failed' };

export interface MachineEnrollmentRunOptions {
  waitBeforeFirstPoll?: boolean;
  onResume?: () => void;
  /** Drives a caller-owned ceremony; without it the terminal prompter and log are used. */
  ports?: MachineEnrollmentCeremonyPorts;
}

export interface MachineEnrollmentConfirmationDependencies {
  keyPairStore: KeyPairStore;
  controllerRegistryStore: ControllerRegistryStore;
  client: MachineEnrollmentConfirmationClient;
  prompter: Pick<CredentialPrompter, 'confirm'>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  log: (message: string) => void;
  logError: (message: string) => void;
}

const sleepFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const asConfirmationJson = (
  confirmation: MachineEnrollmentConfirmationPayloadDto,
): CanonicalJsonValue => ({
  enrollmentId: confirmation.enrollmentId,
  machineId: confirmation.machineId,
  accountId: confirmation.accountId,
  organizationId: confirmation.organizationId,
  controllerCredentialId: confirmation.controllerCredentialId,
  confirmationNonce: confirmation.confirmationNonce,
});

// These schemas validate protected local state after JSON leaves the generated
// client. They are persistence guards, not alternate wire DTOs.
const storedReadyEnrollmentSchema = z
  .object({
    enrollmentId: z.string().min(1),
    machineId: z.string().min(1),
    machineName: z.string().min(1),
    osFamily: z.enum(['macos', 'windows', 'linux']),
    cliVersion: z.string().min(1),
    machineKeyFingerprint: z.string().min(1),
    accountId: z.string().min(1),
    organizationId: z.string().min(1),
    controllerLabel: z.string().min(1),
    controllerCredentialId: z.string().min(1),
    controllerCredentialFingerprint: z.string().min(1),
    backupEligible: z.boolean(),
    backupState: z.boolean(),
    confirmationNonce: z.string().min(1),
    expiresAt: z.string().min(1),
    state: z.literal('ready'),
  })
  .strict();

const storedPendingEnrollmentMetadataSchema = z
  .object({
    enrollmentId: z.string().min(1),
    machineId: z.string().min(1),
    machineName: z.string().min(1).optional(),
    osFamily: z.string().min(1).optional(),
    userCode: z.string().min(1).optional(),
    expiresAt: z.string().min(1),
    pollingIntervalSeconds: z.number().finite().nonnegative(),
    claim: storedReadyEnrollmentSchema.optional(),
  })
  .strict();

const storedActivationSchema = z
  .object({
    machineCredential: z.string().min(1),
    serverSigningPublicKey: z.string().min(1),
    authorizationProtocolVersion: z.literal(2),
    activatedBinding: z
      .object({
        enrollmentId: z.string().min(1),
        machineId: z.string().min(1),
        machineName: z.string().min(1),
        osFamily: z.enum(['macos', 'windows', 'linux']),
        cliVersion: z.string().min(1),
        accountId: z.string().min(1),
        organizationId: z.string().min(1),
        controllerLabel: z.string().min(1),
        controllerCredentialId: z.string().min(1),
        controllerCredentialPublicKey: z
          .object({
            kty: z.literal('EC'),
            crv: z.literal('P-256'),
            x: z
              .string()
              .length(43)
              .regex(/^[A-Za-z0-9_-]+$/u),
            y: z
              .string()
              .length(43)
              .regex(/^[A-Za-z0-9_-]+$/u),
          })
          .strict(),
        controllerCredentialFingerprint: z.string().min(1),
        backupEligible: z.boolean(),
        backupState: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const parseStoredPendingEnrollmentMetadata = (
  serialized: string,
): StoredPendingEnrollmentMetadata | null => {
  let result: ReturnType<typeof storedPendingEnrollmentMetadataSchema.safeParse>;
  try {
    result = storedPendingEnrollmentMetadataSchema.safeParse(JSON.parse(serialized));
  } catch {
    return null;
  }
  return result.success ? result.data : null;
};

export const parseStoredMachineEnrollmentActivation = (
  serialized: string,
): MachineEnrollmentActivationResponse | null => {
  let result: ReturnType<typeof storedActivationSchema.safeParse>;
  try {
    result = storedActivationSchema.safeParse(JSON.parse(serialized));
  } catch {
    return null;
  }
  return result.success ? result.data : null;
};

/** Build the exact generated-field object covered by the Ed25519 signature. */
export const buildMachineEnrollmentConfirmation = (
  enrollment: MachineEnrollmentPollReadyDto,
): MachineEnrollmentConfirmationPayload => ({
  enrollmentId: enrollment.enrollmentId,
  machineId: enrollment.machineId,
  accountId: enrollment.accountId,
  organizationId: enrollment.organizationId,
  controllerCredentialId: enrollment.controllerCredentialId,
  confirmationNonce: enrollment.confirmationNonce,
});

export const signMachineEnrollmentConfirmation = (
  confirmation: MachineEnrollmentConfirmationPayload,
  privateKeyPem: string,
): { canonicalBytes: Buffer; signature: string } => {
  const canonicalBytes = Buffer.from(canonicalizeJson(asConfirmationJson(confirmation)), 'utf8');
  const signature = sign(null, canonicalBytes, createPrivateKey(privateKeyPem)).toString('base64');
  return { canonicalBytes, signature };
};

const FAILED: MachineEnrollmentConfirmationResult = { outcome: 'failed' };

/** Waits for the poll interval, ending early when the ceremony is cancelled. */
const sleepUnlessCancelled = (
  sleep: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve();
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(milliseconds).then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
};

const isExpired = (expiresAt: string, now: number): boolean => {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || now >= expiry;
};

const isTerminalPollFailure = (error: Error): boolean =>
  isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 409);

const toRegistryEntry = (
  binding: MachineEnrollmentActivatedBindingDto,
  authorizationProtocolVersion: 2,
  now: number,
): ControllerRegistryEntry => ({
  ...binding,
  authorizationProtocolVersion,
  enrolledAt: new Date(now).toISOString(),
});

const toActivatedBinding = (
  entry: ControllerRegistryEntry,
): MachineEnrollmentActivatedBindingDto => ({
  enrollmentId: entry.enrollmentId,
  machineId: entry.machineId,
  machineName: entry.machineName,
  osFamily: entry.osFamily,
  cliVersion: entry.cliVersion,
  accountId: entry.accountId,
  organizationId: entry.organizationId,
  controllerLabel: entry.controllerLabel,
  controllerCredentialId: entry.controllerCredentialId,
  controllerCredentialPublicKey: entry.controllerCredentialPublicKey,
  controllerCredentialFingerprint: entry.controllerCredentialFingerprint,
  backupEligible: entry.backupEligible,
  backupState: entry.backupState,
});

const bindingsMatch = (
  binding: MachineEnrollmentActivatedBindingDto,
  enrollment: MachineEnrollmentPollReadyDto,
): boolean =>
  binding.enrollmentId === enrollment.enrollmentId &&
  binding.machineId === enrollment.machineId &&
  binding.machineName === enrollment.machineName &&
  binding.osFamily === enrollment.osFamily &&
  binding.cliVersion === enrollment.cliVersion &&
  binding.accountId === enrollment.accountId &&
  binding.organizationId === enrollment.organizationId &&
  binding.controllerLabel === enrollment.controllerLabel &&
  binding.controllerCredentialId === enrollment.controllerCredentialId &&
  binding.controllerCredentialPublicKey.kty === 'EC' &&
  binding.controllerCredentialPublicKey.crv === 'P-256' &&
  binding.controllerCredentialFingerprint === enrollment.controllerCredentialFingerprint &&
  binding.backupEligible === enrollment.backupEligible &&
  binding.backupState === enrollment.backupState;

const activationJson = (activation: ConfirmMachineEnrollmentResponseDto): string =>
  JSON.stringify(activation);

/** Owns the browser-claim wait, local consent, signature, and activation cutover. */
export class MachineEnrollmentConfirmation {
  private readonly keyPairStore: KeyPairStore;
  private readonly controllerRegistryStore: ControllerRegistryStore;
  private readonly client: MachineEnrollmentConfirmationClient;
  private readonly prompter: Pick<CredentialPrompter, 'confirm'>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly logError: (message: string) => void;

  public constructor(dependencies: MachineEnrollmentConfirmationDependencies) {
    this.keyPairStore = dependencies.keyPairStore;
    this.controllerRegistryStore = dependencies.controllerRegistryStore;
    this.client = dependencies.client;
    this.prompter = dependencies.prompter;
    this.sleep = dependencies.sleep ?? sleepFor;
    this.now = dependencies.now ?? Date.now;
    this.log = dependencies.log;
    this.logError = dependencies.logError;
  }

  private async finalize(
    enrollment: MachineEnrollmentPollReadyDto,
    activation: ConfirmMachineEnrollmentResponseDto,
  ): Promise<void> {
    const binding = activation.activatedBinding;
    if (!bindingsMatch(binding, enrollment)) {
      throw new Error('Machine activation response does not match the pending enrollment.');
    }
    if (activation.authorizationProtocolVersion !== 2) {
      throw new Error('Machine activation response has an unsupported protocol version.');
    }
    if (!activation.machineCredential || !activation.serverSigningPublicKey) {
      throw new Error('Machine activation response is missing protected credentials.');
    }

    // Retain the complete generated response before promoting any credential.
    // Every later write is local; no API reissuance is attempted if one fails.
    await this.keyPairStore.storePendingEnrollmentActivation(
      enrollment.enrollmentId,
      activationJson(activation),
    );
    await this.keyPairStore.storeMachineCredential(
      enrollment.machineId,
      activation.machineCredential,
    );
    await this.controllerRegistryStore.upsert(
      toRegistryEntry(binding, activation.authorizationProtocolVersion, this.now()),
    );
    await this.keyPairStore.storeServerSigningPublicKey(
      enrollment.machineId,
      activation.serverSigningPublicKey,
    );
    await this.keyPairStore.setCurrentMachineId(enrollment.machineId);

    // Pending material is cleanup, deliberately after the promotion point.
    await this.cleanupPendingEnrollment(enrollment.enrollmentId);
  }

  private async cleanupPendingEnrollment(enrollmentId: string): Promise<void> {
    await this.keyPairStore.deletePendingEnrollmentSecret(enrollmentId);
    await this.keyPairStore.deletePendingEnrollmentMetadata(enrollmentId);
    await this.keyPairStore.deletePendingEnrollmentActivation(enrollmentId);
    await this.keyPairStore.deletePendingEnrollmentId();
  }

  public async discardPendingEnrollment(enrollmentId: string): Promise<void> {
    const cleanupOperations: Array<() => Promise<void>> = [
      () => this.keyPairStore.deletePendingEnrollmentSecret(enrollmentId),
      () => this.keyPairStore.deletePendingEnrollmentMetadata(enrollmentId),
      () => this.keyPairStore.deletePendingEnrollmentActivation(enrollmentId),
      () => this.keyPairStore.deletePendingEnrollmentId(),
    ];
    let firstError: Error | undefined;
    for (const cleanup of cleanupOperations) {
      try {
        await cleanup();
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    if (firstError) throw firstError;
  }

  private async discardTerminalEnrollment(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<boolean> {
    try {
      await this.cleanupPendingEnrollment(enrollmentId);
      return true;
    } catch (error) {
      problem(
        ports,
        `Machine enrollment cleanup is incomplete: ${
          error instanceof Error ? error.message : String(error)
        }. Remove the protected pending enrollment before starting another pair attempt.`,
      );
      return false;
    }
  }

  /**
   * A crash during cleanup can leave the completion marker without the
   * activation or metadata needed by the normal recovery path. The registry,
   * current-machine pointer, and promoted credentials together prove that the
   * server activation already completed, so finish cleanup without polling or
   * asking the server for another credential.
   */
  private async recoverAlreadyPromoted(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult | null> {
    const registry = await this.controllerRegistryStore.read();
    const entry = registry?.controllers.find(
      (candidate) => candidate.enrollmentId === enrollmentId,
    );
    if (!entry) return null;

    const currentMachineId = await this.keyPairStore.loadCurrentMachineId();
    if (currentMachineId !== entry.machineId) {
      problem(
        ports,
        'Protected machine activation state is inconsistent with the controller registry. No new credential was requested.',
      );
      return FAILED;
    }

    const [machineCredential, serverSigningPublicKey] = await Promise.all([
      this.keyPairStore.loadMachineCredential(entry.machineId),
      this.keyPairStore.loadServerSigningPublicKey(entry.machineId),
    ]);
    if (machineCredential === null || serverSigningPublicKey === null) {
      problem(
        ports,
        'Protected machine activation state is missing promoted credentials. No new credential was requested.',
      );
      return FAILED;
    }

    const activation: MachineEnrollmentActivationResponse = {
      machineCredential,
      serverSigningPublicKey,
      authorizationProtocolVersion: 2,
      activatedBinding: toActivatedBinding(entry),
    };
    try {
      await this.cleanupPendingEnrollment(enrollmentId);
    } catch (error) {
      problem(
        ports,
        `Protected machine activation cleanup is incomplete: ${
          error instanceof Error ? error.message : String(error)
        }. Restart Hey Hey to resume cleanup; do not request another credential.`,
      );
      return FAILED;
    }

    return { outcome: 'confirmed', activation };
  }

  /** Drives `operation` through `ports`, or through a terminal ceremony when absent. */
  private withPorts(
    ports: MachineEnrollmentCeremonyPorts | undefined,
    operation: (
      ports: MachineEnrollmentCeremonyPorts,
    ) => Promise<MachineEnrollmentConfirmationResult>,
  ): Promise<MachineEnrollmentConfirmationResult> {
    return ports ? operation(ports) : this.runInTerminal(operation);
  }

  /**
   * Runs `operation` as a ceremony printed to this owner's log and answered by
   * its terminal prompter. Used when no presentation supplied a ceremony.
   */
  public runInTerminal(
    operation: (
      ports: MachineEnrollmentCeremonyPorts,
    ) => Promise<MachineEnrollmentConfirmationResult>,
    describeHandoff?: (userCode: string) => string,
  ): Promise<MachineEnrollmentConfirmationResult> {
    const ceremony = new MachineEnrollmentCeremony();
    attachDirectEnrollmentOutput(ceremony, {
      log: this.log,
      logError: this.logError,
      prompter: this.prompter,
      ...(describeHandoff ? { describeHandoff } : {}),
    });
    return ceremony.run(operation, () => FAILED);
  }

  public recover(
    metadata: StoredPendingEnrollmentMetadata,
    activation: MachineEnrollmentActivationResponse,
    ports?: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    return this.withPorts(ports, (active) => this.recoverWith(metadata, activation, active));
  }

  private async recoverWith(
    metadata: StoredPendingEnrollmentMetadata,
    activation: MachineEnrollmentActivationResponse,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    if (!metadata.claim) {
      problem(
        ports,
        'Protected activation recovery is missing the verified claimant metadata; no credential reissuance was requested.',
      );
      return FAILED;
    }

    try {
      await this.finalize(metadata.claim, activation);
    } catch (error) {
      problem(
        ports,
        `Protected activation recovery is incomplete: ${
          error instanceof Error ? error.message : String(error)
        }. Restart Hey Hey to resume recovery; do not request another credential.`,
      );
      return FAILED;
    }

    return { outcome: 'confirmed', activation };
  }

  public resumePendingEnrollment(
    enrollmentId: string,
    onResume?: (metadata: StoredPendingEnrollmentMetadata) => void,
    ports?: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    return this.withPorts(ports, (active) => this.resumeWith(enrollmentId, active, onResume));
  }

  private async resumeWith(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
    onResume?: (metadata: StoredPendingEnrollmentMetadata) => void,
  ): Promise<MachineEnrollmentConfirmationResult> {
    try {
      const metadataSerialized =
        await this.keyPairStore.loadPendingEnrollmentMetadata(enrollmentId);
      const metadata = metadataSerialized
        ? parseStoredPendingEnrollmentMetadata(metadataSerialized)
        : null;
      if (metadata?.enrollmentId !== enrollmentId) {
        const promoted = await this.recoverAlreadyPromoted(enrollmentId, ports);
        if (promoted) return promoted;
        problem(
          ports,
          'Protected machine enrollment recovery metadata is invalid. No new credential was requested.',
        );
        return FAILED;
      }

      const promoted = await this.recoverAlreadyPromoted(enrollmentId, ports);
      if (promoted) return promoted;

      const activationSerialized =
        await this.keyPairStore.loadPendingEnrollmentActivation(enrollmentId);
      if (activationSerialized) {
        const activation = parseStoredMachineEnrollmentActivation(activationSerialized);
        if (!activation) {
          problem(
            ports,
            'Protected machine activation recovery data is invalid. No new credential was requested.',
          );
          return FAILED;
        }
        return await this.recoverWith(metadata, activation, ports);
      }

      const deviceSecret = await this.keyPairStore.loadPendingEnrollmentSecret(enrollmentId);
      if (!deviceSecret) {
        problem(
          ports,
          'Protected machine enrollment recovery is missing its device secret. No new credential was requested.',
        );
        return FAILED;
      }
      return await this.runWith(
        {
          enrollmentId: metadata.enrollmentId,
          machineId: metadata.machineId,
          deviceSecret,
          pollingIntervalSeconds: metadata.pollingIntervalSeconds,
          expiresAt: metadata.expiresAt,
          ...(metadata.userCode !== undefined ? { userCode: metadata.userCode } : {}),
        },
        ports,
        { waitBeforeFirstPoll: true, onResume: () => onResume?.(metadata) },
      );
    } catch (error) {
      problem(
        ports,
        `Protected machine enrollment recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }. No new credential was requested.`,
      );
      return FAILED;
    }
  }

  public run(
    enrollment: MachineEnrollmentSeed,
    options: MachineEnrollmentRunOptions = {},
  ): Promise<MachineEnrollmentConfirmationResult> {
    return this.withPorts(options.ports, (ports) => this.runWith(enrollment, ports, options));
  }

  private async cancelled(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    return (await this.discardTerminalEnrollment(enrollmentId, ports))
      ? { outcome: 'cancelled' }
      : FAILED;
  }

  private async expired(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    problem(ports, 'Machine enrollment expired before local confirmation.');
    return (await this.discardTerminalEnrollment(enrollmentId, ports))
      ? { outcome: 'expired' }
      : FAILED;
  }

  private async runWith(
    enrollment: MachineEnrollmentSeed,
    ports: MachineEnrollmentCeremonyPorts,
    options: Pick<MachineEnrollmentRunOptions, 'waitBeforeFirstPoll' | 'onResume'> = {},
  ): Promise<MachineEnrollmentConfirmationResult> {
    let ready: MachineEnrollmentPollReadyDto | undefined;
    let waitBeforePoll = options.waitBeforeFirstPoll === true;
    let resumeAnnounced = false;
    ports.step({
      kind: 'waiting-for-browser',
      expiresAt: enrollment.expiresAt,
      resumed: options.waitBeforeFirstPoll === true,
    });

    for (;;) {
      if (isCancelled(ports)) return this.cancelled(enrollment.enrollmentId, ports);
      if (isExpired(enrollment.expiresAt, this.now())) {
        return this.expired(enrollment.enrollmentId, ports);
      }
      if (waitBeforePoll) {
        if (!resumeAnnounced) {
          options.onResume?.();
          resumeAnnounced = true;
        }
        const interval = Math.max(1, enrollment.pollingIntervalSeconds) * 1000;
        await sleepUnlessCancelled(this.sleep, interval, ports.signal);
        if (isCancelled(ports)) return this.cancelled(enrollment.enrollmentId, ports);
      }
      waitBeforePoll = true;
      if (isExpired(enrollment.expiresAt, this.now())) {
        return this.expired(enrollment.enrollmentId, ports);
      }

      let pollResult: PollMachineEnrollmentResponseDto;
      try {
        pollResult = await this.client.pollMachineEnrollment(
          enrollment.enrollmentId,
          enrollment.deviceSecret,
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (isTerminalPollFailure(failure)) {
          problem(ports, 'Saved machine enrollment is no longer recoverable.');
          return (await this.discardTerminalEnrollment(enrollment.enrollmentId, ports))
            ? { outcome: 'terminal' }
            : FAILED;
        }
        problem(ports, `Machine enrollment confirmation failed while waiting: ${failure.message}`);
        return FAILED;
      }
      if (isCancelled(ports)) return this.cancelled(enrollment.enrollmentId, ports);

      if (pollResult.state === 'pending') continue;
      if (pollResult.state === 'warning') {
        problem(ports, pollResult.message);
        await this.discardTerminalEnrollment(enrollment.enrollmentId, ports);
        return FAILED;
      }
      ready = pollResult;
      if (isExpired(ready.expiresAt, this.now())) {
        return this.expired(enrollment.enrollmentId, ports);
      }
      break;
    }

    try {
      await this.keyPairStore.storePendingEnrollmentMetadata(
        enrollment.enrollmentId,
        JSON.stringify({
          enrollmentId: enrollment.enrollmentId,
          machineId: enrollment.machineId,
          expiresAt: enrollment.expiresAt,
          pollingIntervalSeconds: enrollment.pollingIntervalSeconds,
          ...(enrollment.userCode !== undefined ? { userCode: enrollment.userCode } : {}),
          claim: ready,
        }),
      );
    } catch (error) {
      problem(
        ports,
        `Machine enrollment could not retain verified claimant metadata locally: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return FAILED;
    }

    let approved: boolean;
    try {
      approved = await ports.requestConfirmation(toMachineEnrollmentReview(ready));
    } catch (error) {
      if (error instanceof MachineEnrollmentCancelledError) {
        return this.cancelled(enrollment.enrollmentId, ports);
      }
      problem(
        ports,
        `Machine enrollment confirmation cancelled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return (await this.discardTerminalEnrollment(enrollment.enrollmentId, ports))
        ? { outcome: 'declined' }
        : FAILED;
    }
    if (!approved) {
      const discarded = await this.discardTerminalEnrollment(enrollment.enrollmentId, ports);
      return discarded ? { outcome: 'declined' } : FAILED;
    }
    // Past this point the activation runs to completion; cancellation no longer applies.
    if (isCancelled(ports)) return this.cancelled(enrollment.enrollmentId, ports);
    ports.step({ kind: 'activating' });

    let activation: MachineEnrollmentActivationResponse;
    try {
      const privateKeyPem = await this.keyPairStore.loadPrivateKey(enrollment.machineId);
      if (!privateKeyPem) throw new Error('The enrolling machine private key is unavailable.');
      const confirmation = buildMachineEnrollmentConfirmation(ready);
      const signed = signMachineEnrollmentConfirmation(confirmation, privateKeyPem);
      activation = await this.client.confirmMachineEnrollment({
        deviceSecret: enrollment.deviceSecret,
        confirmation,
        signature: signed.signature,
      });
    } catch (error) {
      problem(
        ports,
        `Machine enrollment confirmation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return FAILED;
    }

    try {
      await this.finalize(ready, activation);
    } catch (error) {
      problem(
        ports,
        `Machine activation succeeded on the server, but local finalization failed: ${
          error instanceof Error ? error.message : String(error)
        }. Restart Hey Hey to resume recovery from protected local state; do not request another credential.`,
      );
      return FAILED;
    }

    return { outcome: 'confirmed', activation };
  }
}

/** Reads the live signal; cancellation can arrive across any await. */
const isCancelled = (ports: MachineEnrollmentCeremonyPorts): boolean => ports.signal.aborted;

const problem = (ports: MachineEnrollmentCeremonyPorts, message: string): void => {
  ports.step({ kind: 'problem', message });
};
