import { createInteractivePrompter, type CredentialPrompter } from '@hey-hey/ui-common/agents';
import { isAxiosError } from 'axios';

import type {
  ControllerCredentialSummaryDto,
  ControllerInventoryResponseDto,
  ControllerReconciliationResponseDto,
  CreateMachineEnrollmentResponseDto,
  ListMachines200Response,
  MachineDto,
  MachineExecutionReadinessState,
  PollMachineEnrollmentResponseDto,
} from '../shared/api/index';
import type { ControllerRegistryEntry, ControllerRegistryStore } from '../credentials';
import type { KeyPairStore } from '../credentials';
import type { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import {
  MachineEnrollmentConfirmation,
  type MachineEnrollmentConfirmationClient,
  type MachineEnrollmentConfirmationResult,
  parseStoredPendingEnrollmentMetadata,
} from './machine-enrollment-confirmation';
import {
  createDefaultMachineControllerManagementClient,
  GatewayMachineAuthenticationError,
  type MachineControllerManagementClient,
} from './machine-controller-management';
import { WebSocketMachineAuthenticationErrorResponseReasonEnum } from '../shared/api';
import { verifyControllerRevocationReduction } from './controller-revocation-reduction';
import type { MachineEnrollmentCeremonyPorts } from './machine-enrollment-ceremony';
import type { SignedAuthorityReductionEnvelope } from '../shared/api';

export type LocalMachineReadinessState =
  | 'unpaired'
  | 'legacy-controller-enrollment-required'
  | 'enrollment-pending'
  | 'ready'
  | 'no-controller'
  | 'machine-revoked'
  | 'machine-unrecognized'
  | 'locally-inconsistent';

export interface MachineReadinessSnapshot {
  state: LocalMachineReadinessState;
  machineId: string | null;
  machine: MachineDto | null;
  localControllers: readonly ControllerRegistryEntry[];
  serverControllers: readonly ControllerCredentialSummaryDto[];
  serverExecutionReadiness: MachineExecutionReadinessState | null;
}

export interface MachineDirectoryClient {
  listMachines(): Promise<{ data: ListMachines200Response }>;
}

export class MachineDirectoryUnavailableError extends Error {
  public constructor(
    public readonly machineId: string,
    cause: Error,
  ) {
    super('The platform machine directory is unavailable.', { cause });
    this.name = 'MachineDirectoryUnavailableError';
  }
}

export interface MachineControllerAuthorityDependencies {
  keyPairStore: KeyPairStore;
  controllerRegistryStore: ControllerRegistryStore;
  executionGrantStore: ExecutionGrantStore;
  machineDirectory?: MachineDirectoryClient;
  managementClient?: MachineControllerManagementClient;
  enrollmentConfirmationClient?: MachineEnrollmentConfirmationClient;
  confirmation?: MachineEnrollmentConfirmation;
  prompter?: Pick<CredentialPrompter, 'confirm'>;
  now?: () => number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  logDebug?: (event: string, metadata?: MachineControllerAuthorityLogMetadata) => void;
  logDiagnosticError?: (event: string, metadata?: MachineControllerAuthorityLogMetadata) => void;
}

export interface MachineControllerEnrollmentOptions {
  /** Drives a caller-owned ceremony; without it the terminal prompter and log are used. */
  ports?: MachineEnrollmentCeremonyPorts;
}

export type MachineControllerAuthorityLogMetadata = Readonly<
  Record<string, string | number | boolean | null | readonly string[]>
>;

const emptySnapshot = (state: LocalMachineReadinessState): MachineReadinessSnapshot => ({
  state,
  machineId: null,
  machine: null,
  localControllers: [],
  serverControllers: [],
  serverExecutionReadiness: null,
});

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
  value.expiresAt.length > 0 &&
  Number.isFinite(value.pollingIntervalSeconds) &&
  value.pollingIntervalSeconds >= 0;

const machineForId = (
  response: { data: ListMachines200Response },
  machineId: string,
): MachineDto | null =>
  response.data.data?.machines.find((machine) => machine.machineId === machineId) ?? null;

const controllerInventoryFromResponse = (response: {
  data: { data: ControllerInventoryResponseDto };
}): ControllerInventoryResponseDto => response.data.data;

const controllerReconciliationFromResponse = (response: {
  data: { data: ControllerReconciliationResponseDto };
}): Omit<ControllerReconciliationResponseDto, 'revokedControllerCredentialIds'> & {
  revokedControllerCredentialIds: ReadonlySet<string>;
} => {
  const revokedControllerCredentialIds = response.data.data.revokedControllerCredentialIds;
  if (!Array.isArray(revokedControllerCredentialIds)) {
    throw new Error(
      `Controller reconciliation response field revokedControllerCredentialIds must be an array; received ${Object.prototype.toString.call(revokedControllerCredentialIds)}`,
    );
  }
  return {
    ...response.data.data,
    revokedControllerCredentialIds: new Set(revokedControllerCredentialIds),
  };
};

/** Owns local controller lifecycle, reconciliation, and execution readiness. */
export class MachineControllerAuthority {
  private readonly keyPairStore: KeyPairStore;
  private readonly controllerRegistryStore: ControllerRegistryStore;
  private readonly executionGrantStore: ExecutionGrantStore;
  private readonly machineDirectory: MachineDirectoryClient | undefined;
  private readonly managementClient: MachineControllerManagementClient;
  private readonly enrollmentConfirmationClient: MachineEnrollmentConfirmationClient;
  private readonly confirmation: MachineEnrollmentConfirmation;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly logError: (message: string) => void;
  private readonly logDebug: (
    event: string,
    metadata?: MachineControllerAuthorityLogMetadata,
  ) => void;
  private readonly logDiagnosticError: (
    event: string,
    metadata?: MachineControllerAuthorityLogMetadata,
  ) => void;

  public constructor(dependencies: MachineControllerAuthorityDependencies) {
    this.keyPairStore = dependencies.keyPairStore;
    this.controllerRegistryStore = dependencies.controllerRegistryStore;
    this.executionGrantStore = dependencies.executionGrantStore;
    this.machineDirectory = dependencies.machineDirectory;
    this.managementClient =
      dependencies.managementClient ??
      createDefaultMachineControllerManagementClient(this.keyPairStore);
    this.enrollmentConfirmationClient = dependencies.enrollmentConfirmationClient ?? {
      pollMachineEnrollment: async (): Promise<PollMachineEnrollmentResponseDto> => {
        throw new Error('Machine enrollment polling client is not configured.');
      },
      confirmMachineEnrollment: async (): Promise<never> => {
        throw new Error('Machine enrollment confirmation client is not configured.');
      },
    };
    this.confirmation =
      dependencies.confirmation ??
      new MachineEnrollmentConfirmation({
        keyPairStore: this.keyPairStore,
        controllerRegistryStore: this.controllerRegistryStore,
        client: this.enrollmentConfirmationClient,
        prompter: dependencies.prompter ?? createInteractivePrompter(),
        log: dependencies.log ?? console.log,
        logError: dependencies.logError ?? console.error,
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
    this.now = dependencies.now ?? Date.now;
    this.log = dependencies.log ?? console.log;
    this.logError = dependencies.logError ?? console.error;
    this.logDebug = dependencies.logDebug ?? (() => undefined);
    this.logDiagnosticError = dependencies.logDiagnosticError ?? (() => undefined);
  }

  private async readLocalSnapshot(): Promise<{
    state: LocalMachineReadinessState;
    machineId: string | null;
    localControllers: readonly ControllerRegistryEntry[];
  }> {
    const pendingEnrollmentId = await this.keyPairStore.loadPendingEnrollmentId();
    const machineId = await this.keyPairStore.loadCurrentMachineId();
    if (pendingEnrollmentId && !machineId) {
      this.logDebug('local_snapshot.enrollment_pending', { hasPendingEnrollmentId: true });
      return { state: 'enrollment-pending', machineId: null, localControllers: [] };
    }
    if (pendingEnrollmentId) {
      this.logDebug('local_snapshot.pending_enrollment_retained', {
        hasPendingEnrollmentId: true,
        machineId,
        reason: 'existing_machine_authority_remains_usable',
      });
    }
    if (!machineId) {
      this.logDebug('local_snapshot.unpaired', { hasCurrentMachineId: false });
      return { state: 'unpaired', machineId: null, localControllers: [] };
    }

    const [machineCredential, privateKey] = await Promise.all([
      this.keyPairStore.loadMachineCredential(machineId),
      this.keyPairStore.loadPrivateKey(machineId),
    ]);
    let registry;
    try {
      registry = await this.controllerRegistryStore.read();
    } catch (error) {
      this.logDiagnosticError('local_snapshot.registry_read_failed', {
        machineId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
      });
      return { state: 'locally-inconsistent', machineId, localControllers: [] };
    }
    if (!machineCredential || !privateKey || !registry) {
      this.logDiagnosticError('local_snapshot.protected_material_missing', {
        machineId,
        hasMachineCredential: Boolean(machineCredential),
        hasPrivateKey: Boolean(privateKey),
        hasControllerRegistry: Boolean(registry),
      });
      return { state: 'locally-inconsistent', machineId, localControllers: [] };
    }

    const localControllers = registry.controllers.filter((entry) => entry.machineId === machineId);
    this.logDebug('local_snapshot.ready', {
      machineId,
      state: localControllers.length > 0 ? 'ready' : 'no-controller',
      localControllerCount: localControllers.length,
      localControllerCredentialIds: localControllers.map((entry) => entry.controllerCredentialId),
    });
    return {
      state: localControllers.length > 0 ? 'ready' : 'no-controller',
      machineId,
      localControllers,
    };
  }

  private async serverMachine(machineId: string): Promise<MachineDto | null> {
    if (!this.machineDirectory) return null;
    const response = await this.machineDirectory.listMachines();
    return machineForId(response, machineId);
  }

  public async readReadiness(): Promise<MachineReadinessSnapshot> {
    const local = await this.readLocalSnapshot();
    if (!local.machineId) return { ...emptySnapshot(local.state), machineId: null };

    let machine: MachineDto | null;
    try {
      machine = await this.serverMachine(local.machineId);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logDiagnosticError('server_directory.failed', {
        machineId: local.machineId,
        error: cause.message,
        stack: cause.stack ?? null,
      });
      if (isAxiosError(error) && error.response && error.response.status < 500) {
        throw error;
      }
      throw new MachineDirectoryUnavailableError(local.machineId, cause);
    }
    this.logDebug('server_directory.snapshot', {
      machineId: local.machineId,
      machineFound: Boolean(machine),
      authorizationProtocolVersion: machine?.authorizationProtocolVersion ?? null,
      executionReadiness: machine?.executionReadiness ?? null,
      isMachineRevoked: Boolean(machine?.revokedAt),
    });
    if (this.machineDirectory && !machine) {
      this.logDiagnosticError('readiness.machine_unrecognized', {
        machineId: local.machineId,
        reason: 'current_machine_absent_from_server_directory',
      });
      return {
        state: 'machine-unrecognized',
        machineId: local.machineId,
        machine: null,
        localControllers: local.localControllers,
        serverControllers: [],
        serverExecutionReadiness: null,
      };
    }
    if (machine?.executionReadiness === 'MACHINE_REVOKED' || machine?.revokedAt) {
      this.logDiagnosticError('readiness.machine_revoked', {
        machineId: local.machineId,
        executionReadiness: machine.executionReadiness,
        reason: machine.revokedAt ? 'server_revocation_timestamp_present' : 'server_state_revoked',
      });
      return {
        state: 'machine-revoked',
        machineId: local.machineId,
        machine,
        localControllers: local.localControllers,
        serverControllers: [],
        serverExecutionReadiness: machine.executionReadiness,
      };
    }
    if (
      machine?.authorizationProtocolVersion === 1 ||
      machine?.executionReadiness === 'LEGACY_PROTOCOL'
    ) {
      this.logDiagnosticError('readiness.legacy_protocol', {
        machineId: local.machineId,
        authorizationProtocolVersion: machine.authorizationProtocolVersion,
        executionReadiness: machine.executionReadiness,
      });
      return {
        state: 'legacy-controller-enrollment-required',
        machineId: local.machineId,
        machine,
        localControllers: local.localControllers,
        serverControllers: [],
        serverExecutionReadiness: machine.executionReadiness,
      };
    }
    if (machine?.executionReadiness === 'CONTROLLER_ENROLLMENT_REQUIRED') {
      this.logDiagnosticError('readiness.controller_enrollment_required', {
        machineId: local.machineId,
        executionReadiness: machine.executionReadiness,
        localControllerCount: local.localControllers.length,
      });
      return {
        state: 'legacy-controller-enrollment-required',
        machineId: local.machineId,
        machine,
        localControllers: local.localControllers,
        serverControllers: [],
        serverExecutionReadiness: machine.executionReadiness,
      };
    }
    if (machine?.executionReadiness === 'NO_MACHINE_SELECTED') {
      this.logDiagnosticError('readiness.no_machine_selected', {
        machineId: local.machineId,
        executionReadiness: machine.executionReadiness,
        reason: 'server_directory_did_not_select_machine_for_execution',
      });
      return { ...emptySnapshot('locally-inconsistent'), machineId: local.machineId, machine };
    }
    return {
      state: local.state,
      machineId: local.machineId,
      machine,
      localControllers: local.localControllers,
      serverControllers: [],
      serverExecutionReadiness: machine?.executionReadiness ?? null,
    };
  }

  private async ensurePendingMaterial(
    enrollment: CreateMachineEnrollmentResponseDto,
  ): Promise<void> {
    await this.keyPairStore.storePendingEnrollmentId(enrollment.enrollmentId);
    await this.keyPairStore.storePendingEnrollmentSecret(
      enrollment.enrollmentId,
      enrollment.deviceSecret,
    );
    await this.keyPairStore.storePendingEnrollmentMetadata(
      enrollment.enrollmentId,
      JSON.stringify({
        enrollmentId: enrollment.enrollmentId,
        machineId: enrollment.machineId,
        userCode: enrollment.userCode,
        expiresAt: enrollment.expiresAt,
        pollingIntervalSeconds: enrollment.pollingIntervalSeconds,
      }),
    );
  }

  /** Runs `operation` through `ports`, or through a terminal ceremony when absent. */
  private withPorts(
    ports: MachineEnrollmentCeremonyPorts | undefined,
    operation: (
      ports: MachineEnrollmentCeremonyPorts,
    ) => Promise<MachineEnrollmentConfirmationResult>,
  ): Promise<MachineEnrollmentConfirmationResult> {
    if (ports) return operation(ports);
    return this.confirmation.runInTerminal(
      operation,
      (userCode) =>
        `Controller enrollment opened. Complete it in the Hey Hey web UI. Code: ${userCode}`,
    );
  }

  private async announcePendingEnrollment(
    enrollmentId: string,
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<void> {
    try {
      const serialized = await this.keyPairStore.loadPendingEnrollmentMetadata(enrollmentId);
      const metadata = serialized ? parseStoredPendingEnrollmentMetadata(serialized) : null;
      if (metadata?.enrollmentId !== enrollmentId || metadata.userCode === undefined) return;
      ports.step({ kind: 'browser-handoff', userCode: metadata.userCode });
    } catch (error) {
      this.logDebug('enrollment_handoff.pending_metadata_unavailable', {
        enrollmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public resumePendingEnrollment(
    options: MachineControllerEnrollmentOptions = {},
  ): Promise<MachineEnrollmentConfirmationResult> {
    return this.withPorts(options.ports, (ports) => this.resumeWith(ports));
  }

  private async resumeWith(
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    const enrollmentId = await this.keyPairStore.loadPendingEnrollmentId();
    if (!enrollmentId) return { outcome: 'failed' };
    await this.announcePendingEnrollment(enrollmentId, ports);
    return this.confirmation.resumePendingEnrollment(enrollmentId, undefined, ports);
  }

  /** Open one additional-controller or recovery enrollment on the current machine. */
  public addController(
    options: MachineControllerEnrollmentOptions = {},
  ): Promise<MachineEnrollmentConfirmationResult> {
    return this.withPorts(options.ports, (ports) => this.addControllerWith(ports));
  }

  private async addControllerWith(
    ports: MachineEnrollmentCeremonyPorts,
  ): Promise<MachineEnrollmentConfirmationResult> {
    if (await this.keyPairStore.loadPendingEnrollmentId()) {
      return this.resumeWith(ports);
    }
    const local = await this.readLocalSnapshot();
    if (!local.machineId) {
      ports.step({
        kind: 'problem',
        message: 'No machine is paired. Run `heyhey pair` for first-machine enrollment.',
      });
      return { outcome: 'failed' };
    }
    if (local.state === 'locally-inconsistent' || local.state === 'machine-revoked') {
      ports.step({
        kind: 'problem',
        message:
          'Local machine authority is not usable. Run `heyhey pair` after reviewing `heyhey status`.',
      });
      return { outcome: 'failed' };
    }

    let response: { data: { data?: CreateMachineEnrollmentResponseDto } };
    try {
      response = await this.managementClient.createExistingMachineControllerEnrollment(
        local.machineId,
      );
    } catch (error) {
      ports.step({
        kind: 'problem',
        message: `Controller enrollment could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { outcome: 'failed' };
    }
    const enrollment = response.data.data;
    if (!isEnrollmentResponse(enrollment)) {
      ports.step({
        kind: 'problem',
        message: 'Controller enrollment returned an invalid response.',
      });
      return { outcome: 'failed' };
    }

    try {
      await this.ensurePendingMaterial(enrollment);
    } catch (error) {
      ports.step({
        kind: 'problem',
        message: `Controller enrollment opened, but protected local retention failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return { outcome: 'failed' };
    }
    ports.step({ kind: 'browser-handoff', userCode: enrollment.userCode });
    return this.confirmation.run(
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

  public async listControllers(): Promise<{
    readiness: MachineReadinessSnapshot;
    inventory: ControllerInventoryResponseDto | null;
  }> {
    const readiness = await this.readReadiness();
    if (!readiness.machineId || readiness.state === 'enrollment-pending') {
      return { readiness, inventory: null };
    }
    try {
      const response = await this.managementClient.inspectMachineControllers(readiness.machineId);
      const inventory = controllerInventoryFromResponse(response);
      return {
        readiness: {
          ...readiness,
          serverControllers: inventory.controllers,
          serverExecutionReadiness: inventory.executionReadiness,
        },
        inventory,
      };
    } catch (error) {
      this.logError(
        `Controller inventory could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { readiness, inventory: null };
    }
  }

  /** Reconcile server authority before any executable runtime is constructed. */
  public async reconcileBeforeRuntime(): Promise<MachineReadinessSnapshot> {
    const local = await this.readReadiness();
    this.logDebug('reconciliation.started', {
      state: local.state,
      machineId: local.machineId,
      localControllerCount: local.localControllers.length,
      localControllerCredentialIds: local.localControllers.map(
        (entry) => entry.controllerCredentialId,
      ),
      directoryExecutionReadiness: local.serverExecutionReadiness,
    });
    if (local.state === 'enrollment-pending') {
      this.logDebug('reconciliation.pending_enrollment.resume_started', {
        reason: 'ordinary_startup_recovers_interrupted_pairing',
      });
      this.log(
        'A saved machine pairing is in progress. Resuming it now; no new credential will be requested.',
      );
      const result = await this.resumePendingEnrollment();
      this.logDebug('reconciliation.pending_enrollment.resume_completed', {
        outcome: result.outcome,
      });
      if (result.outcome === 'confirmed') return this.reconcileBeforeRuntime();
      return this.readReadiness();
    }
    if (!local.machineId) {
      this.logDebug('reconciliation.skipped', {
        state: local.state,
        reason: 'machine_id_missing',
      });
      return local;
    }
    if (local.state === 'machine-revoked') {
      this.logDebug('reconciliation.machine_revoked_cleanup_started', {
        machineId: local.machineId,
      });
      await this.handleMachineRevoked(local.machineId);
      return { ...local, state: 'machine-revoked' };
    }
    if (local.state === 'machine-unrecognized') {
      this.logDebug('reconciliation.machine_unrecognized_cleanup_started', {
        machineId: local.machineId,
      });
      await this.handleMachineRevoked(local.machineId);
      return local;
    }
    if (local.state === 'legacy-controller-enrollment-required') {
      this.logDebug('reconciliation.skipped', {
        machineId: local.machineId,
        state: local.state,
        reason: 'legacy_protocol',
      });
      return local;
    }
    if (local.state === 'locally-inconsistent') {
      this.logDiagnosticError('reconciliation.skipped_local_inconsistency', {
        machineId: local.machineId,
        state: local.state,
        reason: 'local_snapshot_failed_validation',
      });
      return local;
    }

    try {
      const knownControllerCredentialIds = new Set(
        local.localControllers.map((entry) => entry.controllerCredentialId),
      );
      this.logDebug('reconciliation.request_started', {
        machineId: local.machineId,
        knownControllerCredentialIdCount: knownControllerCredentialIds.size,
        knownControllerCredentialIds: [...knownControllerCredentialIds],
      });
      const response = await this.managementClient.reconcileMachineControllers(
        local.machineId,
        knownControllerCredentialIds,
      );
      const rawReconciliation = response.data.data;
      this.logDebug('reconciliation.response_received', {
        machineId: rawReconciliation.machineId,
        executionReadiness: rawReconciliation.executionReadiness,
        enrollmentState: rawReconciliation.enrollmentState,
        controllerCount: Array.isArray(rawReconciliation.controllers)
          ? rawReconciliation.controllers.length
          : -1,
        controllerCredentialIds: Array.isArray(rawReconciliation.controllers)
          ? rawReconciliation.controllers.map((controller) => controller.credentialId)
          : [],
        revokedControllerCredentialIdsRuntimeType: Array.isArray(
          rawReconciliation.revokedControllerCredentialIds,
        )
          ? 'array'
          : Object.prototype.toString.call(rawReconciliation.revokedControllerCredentialIds),
        revokedControllerCredentialIdCount: Array.isArray(
          rawReconciliation.revokedControllerCredentialIds,
        )
          ? rawReconciliation.revokedControllerCredentialIds.length
          : -1,
      });
      const reconciliation = controllerReconciliationFromResponse(response);
      if (reconciliation.machineId !== local.machineId) {
        this.logDiagnosticError('reconciliation.machine_id_mismatch', {
          localMachineId: local.machineId,
          serverMachineId: reconciliation.machineId,
        });
        return { ...local, state: 'locally-inconsistent' };
      }
      const registryResult = await this.controllerRegistryStore.reconcileMachine(
        local.machineId,
        reconciliation.controllers,
        reconciliation.revokedControllerCredentialIds,
      );
      this.logDebug('reconciliation.registry_reconciled', {
        machineId: local.machineId,
        unknownServerControllerCount: registryResult.unknownServerControllerIds.length,
        unknownServerControllerIds: registryResult.unknownServerControllerIds,
        revokedControllerCredentialIdCount: reconciliation.revokedControllerCredentialIds.size,
        revokedControllerCredentialIds: [...reconciliation.revokedControllerCredentialIds],
      });
      if (registryResult.unknownServerControllerIds.length > 0) {
        this.logDebug('reconciliation.server_controllers_not_locally_admitted', {
          machineId: local.machineId,
          unknownServerControllerIds: registryResult.unknownServerControllerIds,
          reason: 'server_inventory_is_disclosure_only_local_registry_remains_authority_allowlist',
        });
      }
      for (const controller of local.localControllers) {
        if (reconciliation.revokedControllerCredentialIds.has(controller.controllerCredentialId)) {
          await this.executionGrantStore.revokeForController(
            controller.controllerCredentialId,
            controller.controllerCredentialFingerprint,
          );
        }
      }
      if (reconciliation.executionReadiness === 'MACHINE_REVOKED') {
        this.logDebug('reconciliation.server_machine_revoked', { machineId: local.machineId });
        await this.handleMachineRevoked(local.machineId);
        return { ...local, state: 'machine-revoked' };
      }
      if (
        reconciliation.controllers.every((controller) => controller.revocationState !== 'ACTIVE')
      ) {
        this.logDebug('reconciliation.no_active_controller', {
          machineId: local.machineId,
          serverControllerCount: reconciliation.controllers.length,
        });
        return {
          ...local,
          state: 'no-controller',
          localControllers: [],
          serverControllers: reconciliation.controllers,
          serverExecutionReadiness: reconciliation.executionReadiness,
        };
      }
      if (
        reconciliation.executionReadiness !== 'READY' &&
        reconciliation.executionReadiness !== 'DISCONNECTED'
      ) {
        this.logDiagnosticError('reconciliation.server_not_ready', {
          machineId: local.machineId,
          executionReadiness: reconciliation.executionReadiness,
          enrollmentState: reconciliation.enrollmentState,
        });
        return {
          ...local,
          state:
            reconciliation.executionReadiness === 'LEGACY_PROTOCOL'
              ? 'legacy-controller-enrollment-required'
              : 'locally-inconsistent',
          serverControllers: reconciliation.controllers,
          serverExecutionReadiness: reconciliation.executionReadiness,
        };
      }
      if (reconciliation.executionReadiness === 'DISCONNECTED') {
        this.logDebug('reconciliation.disconnected_presence_accepted', {
          machineId: local.machineId,
          executionReadiness: reconciliation.executionReadiness,
          reason: 'local_transport_starts_after_durable_authority_reconciliation',
        });
      }
      const readySnapshot = {
        ...local,
        state: 'ready',
        localControllers: local.localControllers.filter((entry) =>
          reconciliation.controllers.some(
            (controller) =>
              controller.credentialId === entry.controllerCredentialId &&
              controller.revocationState === 'ACTIVE',
          ),
        ),
        serverControllers: reconciliation.controllers,
        serverExecutionReadiness: reconciliation.executionReadiness,
      } satisfies MachineReadinessSnapshot;
      this.logDebug('reconciliation.completed', {
        machineId: local.machineId,
        state: readySnapshot.state,
        localControllerCount: readySnapshot.localControllers.length,
        serverControllerCount: readySnapshot.serverControllers.length,
      });
      return readySnapshot;
    } catch (error) {
      if (
        error instanceof GatewayMachineAuthenticationError &&
        error.reason === WebSocketMachineAuthenticationErrorResponseReasonEnum.MachineRevoked
      ) {
        this.logDiagnosticError('reconciliation.machine_revoked_authentication', {
          machineId: local.machineId,
          priorState: local.state,
          reason: error.reason,
          error: error.message,
        });
        await this.handleMachineRevoked(local.machineId);
        return { ...local, state: 'machine-revoked' };
      }
      this.logDiagnosticError('reconciliation.failed', {
        machineId: local.machineId,
        priorState: local.state,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
      });
      this.logError(
        `Controller authority reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...local, state: 'locally-inconsistent' };
    }
  }

  /** Apply a server-signed reduction before reporting local revoke success. */
  public async applyControllerRevocationReduction(
    machineId: string,
    controllerCredentialId: string,
    reductionFrame: Parameters<typeof verifyControllerRevocationReduction>[0],
  ): Promise<void> {
    const serverSigningPublicKeyB64 = await this.keyPairStore.loadServerSigningPublicKey(machineId);
    if (!serverSigningPublicKeyB64) throw new Error('Server signing authority is unavailable.');
    const verification = verifyControllerRevocationReduction(reductionFrame, {
      machineId,
      serverSigningPublicKeyB64,
      now: this.now(),
    });
    if (!verification.accepted) {
      throw new Error(`Controller revocation reduction rejected: ${verification.reason}`);
    }
    if (reductionFrame.controllerCredentialId !== controllerCredentialId) {
      throw new Error('Controller revocation reduction addressed a different controller.');
    }
    const entry = (await this.controllerRegistryStore.read())?.controllers.find(
      (candidate) =>
        candidate.machineId === machineId &&
        candidate.controllerCredentialId === controllerCredentialId,
    );
    await this.executionGrantStore.revokeForController(
      controllerCredentialId,
      entry?.controllerCredentialFingerprint,
    );
    await this.controllerRegistryStore.remove(machineId, controllerCredentialId);
  }

  /** Apply an already verified live authority reduction through the durable owners. */
  public async applyVerifiedAuthorityReduction(
    reductionFrame: SignedAuthorityReductionEnvelope,
  ): Promise<void> {
    if (!('controllerCredentialId' in reductionFrame)) {
      await this.handleMachineRevoked(reductionFrame.machineId);
      return;
    }
    const controllerCredentialId = reductionFrame.controllerCredentialId;
    const entry = (await this.controllerRegistryStore.read())?.controllers.find(
      (candidate) =>
        candidate.machineId === reductionFrame.machineId &&
        candidate.controllerCredentialId === controllerCredentialId,
    );
    await this.executionGrantStore.revokeForController(
      controllerCredentialId,
      entry?.controllerCredentialFingerprint,
    );
    await this.controllerRegistryStore.remove(reductionFrame.machineId, controllerCredentialId);
  }

  public async revokeController(controllerCredentialId: string): Promise<boolean> {
    const local = await this.readLocalSnapshot();
    if (!local.machineId || (local.state !== 'ready' && local.state !== 'no-controller')) {
      this.logError(`Controller revoke is unavailable while machine state is ${local.state}.`);
      return false;
    }
    try {
      const response = await this.managementClient.revokeMachineControllerLocally(
        local.machineId,
        controllerCredentialId,
      );
      const result = response.data.data;
      if (
        result.machineId !== local.machineId ||
        result.controllerCredentialId !== controllerCredentialId
      ) {
        this.logError('Controller revoke returned an unexpected addressed response.');
        return false;
      }
      await this.applyControllerRevocationReduction(
        local.machineId,
        controllerCredentialId,
        result.reductionFrame,
      );
      return true;
    } catch (error) {
      this.logError(
        `Controller revoke failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Remove every local authority after an authenticated terminal machine revoke. */
  public async handleMachineRevoked(machineId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.executionGrantStore.revokeAll(),
      this.controllerRegistryStore.removeMachine(machineId),
      this.keyPairStore.deleteMachineCredential(machineId),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
    }
  }
}

export const recoveryGuidanceForReadiness = (state: LocalMachineReadinessState): string => {
  switch (state) {
    case 'unpaired':
      return 'Run `heyhey pair` to enroll the first controller.';
    case 'legacy-controller-enrollment-required':
      return 'Run `heyhey pair` to upgrade this machine in place and confirm the controller locally.';
    case 'enrollment-pending':
      return 'A saved pairing is in progress. Start normally or run `heyhey pair` to resume it; do not start another pairing.';
    case 'no-controller':
      return 'Run `heyhey controllers add` to recover or add a controller.';
    case 'machine-revoked':
      return 'This machine has been revoked. Run `heyhey pair` to enroll it again.';
    case 'machine-unrecognized':
      return 'Hey Hey no longer recognizes this machine. Pair it again to continue.';
    case 'locally-inconsistent':
      return 'Protected local authority is inconsistent. Run `heyhey status`, then re-pair if required.';
    case 'ready':
      return 'Execution is ready.';
  }
};
