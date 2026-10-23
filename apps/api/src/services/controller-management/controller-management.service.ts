import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import {
  ControllerEnrollmentEligibilityState,
  ControllerCredentialRevocationState,
  ControllerCredentialPublicKey,
  ControllerCredentialSummaryDto,
  ControllerInventoryResponseDto,
  ControllerRevocationReductionBodyDto,
  ControllerRevocationRequestDto,
  ControllerRevocationResponseDto,
  ControllerReconciliationResponseDto,
  WebSocketAuthorityReductionEvent,
  ExistingMachineControllerEnrollmentRequestDto,
  MachineControllerAuthenticationProofDto,
  MachineControllerInventoryRequestDto,
  MachineControllerReconciliationRequestDto,
} from '../../generated';
import {
  ControllerManagementAlreadyRevokedException,
  ControllerManagementInvalidStateException,
  ControllerManagementMachineRevokedException,
  ControllerManagementWrongOwnerException,
  ExistingMachineEnrollmentRejectedException,
} from '../../common/exceptions/controller-management.exceptions';
import { MachineChallengeService } from '../../core/websockets/machine-challenge.service';
import { TriggerEnvelopeSigner } from '../../core/websockets/trigger-envelope-signer.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import {
  AuthenticatedMachine,
  MachinePairingService,
} from '../machine-pairing/machine-pairing.service';
import { MachineExecutionReadinessService } from '../machine-pairing/machine-execution-readiness.service';
import { machineEnrollmentDiagnostic } from '../machine-pairing/machine-enrollment-diagnostics';
import { MachineId, UserId } from '../../types';

type StoredMachine = {
  id: string;
  userId: string;
  organizationId: string | null;
  publicKey: string;
  authorizationProtocolVersion: number | null;
  authorizationState: 'LEGACY' | 'CONTROLLER_ENROLLMENT_REQUIRED' | 'READY';
  revokedAt: Date | null;
  controllerCredentials: Array<StoredControllerCredential>;
};

type StoredControllerCredential = {
  id: string;
  credentialId: string;
  credentialPublicKeyX: Uint8Array;
  credentialPublicKeyY: Uint8Array;
  controllerLabel: string;
  credentialFingerprint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  credentialBackupEligible: boolean;
  credentialBackupState: boolean;
  revokedAt: Date | null;
};

type RevocationResult = {
  machineId: MachineId;
  userId: UserId;
  controllerCredentialId: string;
  revokedAt: Date;
  enrollmentState: ControllerEnrollmentEligibilityState;
  organizationId: string | null;
};

const MACHINE_MANAGEMENT_REQUEST_VERSION = 2 as const;
const AUTHORITY_REDUCTION_ACK_TIMEOUT_MS = 5_000;

@Injectable()
export class ControllerManagementService {
  private readonly logger = new Logger(ControllerManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly machinePairingService: MachinePairingService,
    private readonly machineExecutionReadinessService: MachineExecutionReadinessService,
    private readonly machineChallengeService: MachineChallengeService,
    private readonly triggerEnvelopeSigner: TriggerEnvelopeSigner,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async createExistingMachineControllerEnrollment(params: {
    machineId: MachineId;
    machine: AuthenticatedMachine;
    input: ExistingMachineControllerEnrollmentRequestDto;
    sourceAddress: string | undefined;
  }) {
    this.assertExactKeys(params.input, [
      'authorizationProtocolVersion',
      'machineProof',
    ]);
    this.assertManagementVersion(params.input.authorizationProtocolVersion);
    await this.authenticateMachineProof(
      params.machineId,
      params.machine,
      params.input.machineProof,
    );

    const machine = await this.loadMachine(params.machineId);
    this.assertMachineOwner(machine, params.machine.userId);
    this.assertNotRevoked(machine);
    this.assertEnrollmentState(machine);

    try {
      const result =
        await this.machinePairingService.createExistingMachineControllerEnrollment(
          {
            machineId: params.machineId,
            userId: params.machine.userId,
            sourceAddress: params.sourceAddress ?? '',
          },
        );
      this.logger.log('Existing-machine controller enrollment opened', machineEnrollmentDiagnostic('creation', {
        machineId: params.machineId,
        userId: params.machine.userId,
        enrollmentId: result.enrollmentId,
        organizationId: machine.organizationId ?? undefined,
        reasonCode: 'controller_enrollment_opened',
        state: 'pending',
        decision: 'created',
      }));
      return result;
    } catch (error) {
      if (error instanceof ExistingMachineEnrollmentRejectedException) {
        if (error.reason === 'MACHINE_REVOKED') {
          throw new ControllerManagementMachineRevokedException();
        }
        throw new ControllerManagementInvalidStateException();
      }
      throw error;
    }
  }

  async listMachineControllers(
    userId: UserId,
    machineId: MachineId,
  ): Promise<ControllerInventoryResponseDto> {
    const machine = await this.loadMachine(machineId);
    this.assertMachineOwner(machine, userId);
    this.assertNotRevoked(machine);
    return this.toInventory(machine, userId);
  }

  async inspectMachineControllers(params: {
    machineId: MachineId;
    machine: AuthenticatedMachine;
    input: MachineControllerInventoryRequestDto;
  }): Promise<ControllerInventoryResponseDto> {
    this.assertExactKeys(params.input, [
      'authorizationProtocolVersion',
      'machineProof',
    ]);
    this.assertManagementVersion(params.input.authorizationProtocolVersion);
    await this.authenticateMachineProof(
      params.machineId,
      params.machine,
      params.input.machineProof,
    );
    const machine = await this.loadMachine(params.machineId);
    this.assertMachineOwner(machine, params.machine.userId);
    this.assertNotRevoked(machine);
    return this.toInventory(machine, params.machine.userId);
  }

  async reconcileMachineControllers(params: {
    machineId: MachineId;
    machine: AuthenticatedMachine;
    input: MachineControllerReconciliationRequestDto;
  }): Promise<ControllerReconciliationResponseDto> {
    this.logger.debug('Controller authority reconciliation request received', {
      machineId: params.machineId,
      authenticatedMachineId: params.machine.machineId,
      authenticatedUserId: params.machine.userId,
      authorizationProtocolVersion: params.input.authorizationProtocolVersion,
      knownControllerCredentialIdsRuntimeType: Array.isArray(
        params.input.knownControllerCredentialIds,
      )
        ? 'array'
        : Object.prototype.toString.call(
            params.input.knownControllerCredentialIds,
          ),
      knownControllerCredentialIdCount: Array.isArray(
        params.input.knownControllerCredentialIds,
      )
        ? params.input.knownControllerCredentialIds.length
        : -1,
      knownControllerCredentialIds: Array.isArray(
        params.input.knownControllerCredentialIds,
      )
        ? params.input.knownControllerCredentialIds
        : [],
    });
    this.assertExactKeys(params.input, [
      'authorizationProtocolVersion',
      'machineProof',
      'knownControllerCredentialIds',
    ]);
    this.assertManagementVersion(params.input.authorizationProtocolVersion);
    await this.authenticateMachineProof(
      params.machineId,
      params.machine,
      params.input.machineProof,
    );
    this.logger.debug(
      'Controller authority reconciliation proof authenticated',
      {
        machineId: params.machineId,
        authenticatedUserId: params.machine.userId,
      },
    );
    const machine = await this.loadMachine(params.machineId);
    this.logger.debug('Controller authority reconciliation machine loaded', {
      machineId: params.machineId,
      ownerUserId: machine.userId,
      authorizationProtocolVersion: machine.authorizationProtocolVersion,
      authorizationState: machine.authorizationState,
      isMachineRevoked: Boolean(machine.revokedAt),
      storedControllerCount: machine.controllerCredentials.length,
      storedControllerCredentialIds: machine.controllerCredentials.map(
        (controller) => controller.credentialId,
      ),
      storedActiveControllerCredentialIds: machine.controllerCredentials
        .filter((controller) => !controller.revokedAt)
        .map((controller) => controller.credentialId),
      storedRevokedControllerCredentialIds: machine.controllerCredentials
        .filter((controller) => Boolean(controller.revokedAt))
        .map((controller) => controller.credentialId),
    });
    this.assertMachineOwner(machine, params.machine.userId);
    this.assertNotRevoked(machine);
    const knownControllerCredentialIds = this.normalizeKnownControllerIds(
      params.input.knownControllerCredentialIds,
    );
    this.logger.debug(
      'Controller authority reconciliation request normalized',
      {
        machineId: params.machineId,
        knownControllerCredentialIdCount: knownControllerCredentialIds.length,
        knownControllerCredentialIds,
      },
    );

    const inventory = await this.toInventory(machine, params.machine.userId);
    this.logger.debug(
      'Controller authority reconciliation inventory resolved',
      {
        machineId: inventory.machineId,
        enrollmentState: inventory.enrollmentState,
        executionReadiness: inventory.executionReadiness,
        controllerCount: inventory.controllers.length,
        controllerCredentialIds: inventory.controllers.map(
          (controller) => controller.credentialId,
        ),
        activeControllerCredentialIds: inventory.controllers
          .filter((controller) => controller.revocationState === 'ACTIVE')
          .map((controller) => controller.credentialId),
        revokedControllerCredentialIds: inventory.controllers
          .filter((controller) => controller.revocationState === 'REVOKED')
          .map((controller) => controller.credentialId),
      },
    );
    const known = new Set(knownControllerCredentialIds);
    const revokedControllerCredentialIds = inventory.controllers
      .filter(
        (controller) =>
          controller.revocationState ===
            ControllerCredentialRevocationState.Revoked &&
          known.has(controller.credentialId),
      )
      .map((controller) => controller.credentialId);

    const response = {
      ...inventory,
      revokedControllerCredentialIds,
    } satisfies ControllerReconciliationResponseDto;
    this.logger.debug('Controller authority reconciliation response prepared', {
      machineId: response.machineId,
      enrollmentState: response.enrollmentState,
      executionReadiness: response.executionReadiness,
      controllerCount: response.controllers.length,
      revokedControllerCredentialIdsRuntimeType: Array.isArray(
        response.revokedControllerCredentialIds,
      )
        ? 'array'
        : Object.prototype.toString.call(
            response.revokedControllerCredentialIds,
          ),
      revokedControllerCredentialIdCount:
        response.revokedControllerCredentialIds.length,
      revokedControllerCredentialIds: response.revokedControllerCredentialIds,
    });
    return response;
  }

  async revokeMachineController(
    userId: UserId,
    machineId: MachineId,
    controllerCredentialId: string,
  ): Promise<ControllerRevocationResponseDto> {
    const machine = await this.loadMachine(machineId);
    this.assertMachineOwner(machine, userId);
    this.assertNotRevoked(machine);
    return this.revokeController({
      machineId,
      userId,
      controllerCredentialId,
    });
  }

  async revokeMachineControllerLocally(params: {
    machineId: MachineId;
    controllerCredentialId: string;
    machine: AuthenticatedMachine;
    input: ControllerRevocationRequestDto;
  }): Promise<ControllerRevocationResponseDto> {
    this.assertExactKeys(params.input, [
      'authorizationProtocolVersion',
      'machineProof',
    ]);
    this.assertManagementVersion(params.input.authorizationProtocolVersion);
    await this.authenticateMachineProof(
      params.machineId,
      params.machine,
      params.input.machineProof,
    );
    const machine = await this.loadMachine(params.machineId);
    this.assertMachineOwner(machine, params.machine.userId);
    this.assertNotRevoked(machine);
    return this.revokeController({
      machineId: params.machineId,
      userId: params.machine.userId,
      controllerCredentialId: params.controllerCredentialId,
    });
  }

  private async revokeController(params: {
    machineId: MachineId;
    userId: UserId;
    controllerCredentialId: string;
  }): Promise<ControllerRevocationResponseDto> {
    this.assertCredentialId(params.controllerCredentialId);
    const result = await this.prisma.db.$transaction(async (tx) => {
      await this.lockMachine(tx, params.machineId);
      const machine = await tx.machine.findUnique({
        where: { id: params.machineId },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          authorizationProtocolVersion: true,
          authorizationState: true,
          revokedAt: true,
        },
      });
      if (!machine || machine.userId !== params.userId) {
        throw new ControllerManagementWrongOwnerException();
      }
      if (machine.revokedAt) {
        throw new ControllerManagementMachineRevokedException();
      }
      if (machine.authorizationProtocolVersion !== 2) {
        throw new ControllerManagementInvalidStateException();
      }

      const controller = await tx.machineControllerCredential.findFirst({
        where: {
          credentialId: params.controllerCredentialId,
          machineId: params.machineId,
          userId: params.userId,
        },
        select: { id: true, credentialId: true, revokedAt: true },
      });
      if (!controller) {
        throw new ControllerManagementWrongOwnerException();
      }
      if (controller.revokedAt) {
        throw new ControllerManagementAlreadyRevokedException();
      }

      const revokedAt = new Date();
      const controllerUpdate = await tx.machineControllerCredential.updateMany(
        {
          where: { id: controller.id, revokedAt: null },
          data: { revokedAt },
        },
      );
      if (controllerUpdate.count !== 1) {
        throw new ControllerManagementAlreadyRevokedException();
      }

      const grantUpdate = await tx.executionGrant.updateMany({
        where: {
          controllerCredentialId: controller.id,
          revokedAt: null,
        },
        data: { revokedAt },
      });

      const activeControllerCount =
        await tx.machineControllerCredential.count({
          where: { machineId: params.machineId, revokedAt: null },
        });
      const enrollmentState =
        activeControllerCount === 0
          ? ControllerEnrollmentEligibilityState.ControllerEnrollmentRequired
          : ControllerEnrollmentEligibilityState.Ready;

      if (activeControllerCount === 0) {
        await tx.machine.updateMany({
          where: { id: params.machineId, revokedAt: null },
          data: { authorizationState: 'CONTROLLER_ENROLLMENT_REQUIRED' },
        });
      }

      this.logger.log('Controller authority revoked in transaction', {
        machineId: params.machineId,
        userId: params.userId,
        controllerCredentialId: controller.credentialId,
        grantsRevoked: grantUpdate.count,
        activeControllerCount,
        reasonCode: 'controller_revoked',
      });

      return {
        machineId: params.machineId,
        userId: params.userId,
        controllerCredentialId: controller.credentialId,
        revokedAt,
        enrollmentState,
        organizationId: machine.organizationId,
      } satisfies RevocationResult;
    });

    const inventory = await this.readInventoryAfterRevocation(
      result.machineId,
      result.userId,
    );
    const event = {
      version: MACHINE_MANAGEMENT_REQUEST_VERSION,
      kind: 'controller_revocation_reduction',
      action: 'CONTROLLER_REVOKE',
      machineId: result.machineId,
      controllerCredentialId: result.controllerCredentialId,
      revokedAt: result.revokedAt.toISOString(),
      enrollmentState: result.enrollmentState,
      executionReadiness: inventory.executionReadiness,
    } satisfies ControllerRevocationReductionBodyDto;
    const reductionFrame = this.triggerEnvelopeSigner.signControllerRevocationReduction(
      event,
      result.machineId,
      result.userId,
    );

    let delivered = false;
    try {
      if (result.organizationId) {
        const acknowledgement = await this.websocketGateway.emitAuthorityReductionWithAck(
          {
            type: 'trigger.authority_reduction',
            timestamp: new Date().toISOString(),
            organizationId: result.organizationId,
            userId: result.userId,
            envelope: reductionFrame,
          } satisfies WebSocketAuthorityReductionEvent,
          AUTHORITY_REDUCTION_ACK_TIMEOUT_MS,
        );
        delivered = acknowledgement?.status === 'APPLIED';
      }
    } catch (error) {
      this.logger.warn('Controller revocation reduction delivery failed', {
        machineId: result.machineId,
        controllerCredentialId: result.controllerCredentialId,
        reasonCode: 'delivery_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.logger.log('Controller revocation reduction completed', {
      machineId: result.machineId,
      controllerCredentialId: result.controllerCredentialId,
      executionReadiness: inventory.executionReadiness,
      delivered,
      reasonCode: delivered ? 'delivered' : 'offline_reconcile_required',
    });

    return {
      outcome: 'REVOKED',
      machineId: result.machineId,
      controllerCredentialId: result.controllerCredentialId,
      revokedAt: result.revokedAt.toISOString(),
      executionReadiness: inventory.executionReadiness,
      reductionFrame,
    } satisfies ControllerRevocationResponseDto;
  }

  private async readInventoryAfterRevocation(
    machineId: MachineId,
    userId: UserId,
  ): Promise<ControllerInventoryResponseDto> {
    const machine = await this.loadMachine(machineId);
    this.assertMachineOwner(machine, userId);
    this.assertNotRevoked(machine);
    return this.toInventory(machine, userId);
  }

  private async toInventory(
    machine: StoredMachine,
    userId: UserId,
  ): Promise<ControllerInventoryResponseDto> {
    const readiness = await this.machineExecutionReadinessService.resolve({
      machineId: machine.id as MachineId,
      userId,
    });
    if (!readiness) {
      throw new ControllerManagementWrongOwnerException();
    }

    return {
      machineId: machine.id as MachineId,
      authorizationProtocolVersion:
        machine.authorizationProtocolVersion === 2 ? 2 : 1,
      enrollmentState: this.resolveEnrollmentState(machine),
      executionReadiness: readiness.executionReadiness,
      controllers: machine.controllerCredentials.map((controller) =>
        this.toControllerSummary(controller),
      ),
    } satisfies ControllerInventoryResponseDto;
  }

  private toControllerSummary(
    controller: StoredControllerCredential,
  ): ControllerCredentialSummaryDto {
    return {
      credentialId: controller.credentialId,
      controllerCredentialPublicKey: this.toControllerPublicKey(controller),
      label: controller.controllerLabel,
      fingerprint: controller.credentialFingerprint.slice(0, 16),
      createdAt: controller.createdAt.toISOString(),
      lastUsedAt: controller.lastUsedAt?.toISOString() ?? null,
      backupEligible: controller.credentialBackupEligible,
      backupState: controller.credentialBackupState,
      revocationState:
        controller.revokedAt === null
          ? ControllerCredentialRevocationState.Active
          : ControllerCredentialRevocationState.Revoked,
      revokedAt: controller.revokedAt?.toISOString() ?? null,
    } satisfies ControllerCredentialSummaryDto;
  }

  private toControllerPublicKey(
    controller: Pick<StoredControllerCredential, 'credentialPublicKeyX' | 'credentialPublicKeyY'>,
  ): ControllerCredentialPublicKey {
    return {
      kty: 'EC',
      crv: 'P-256',
      x: Buffer.from(controller.credentialPublicKeyX).toString('base64url'),
      y: Buffer.from(controller.credentialPublicKeyY).toString('base64url'),
    } satisfies ControllerCredentialPublicKey;
  }

  private resolveEnrollmentState(
    machine: Pick<
      StoredMachine,
      'authorizationProtocolVersion' | 'authorizationState' | 'controllerCredentials'
    >,
  ): ControllerEnrollmentEligibilityState {
    if (machine.authorizationProtocolVersion !== 2) {
      return ControllerEnrollmentEligibilityState.LegacyProtocol;
    }
    if (machine.authorizationState === 'CONTROLLER_ENROLLMENT_REQUIRED') {
      return ControllerEnrollmentEligibilityState.ControllerEnrollmentRequired;
    }
    if (machine.controllerCredentials.some((controller) => !controller.revokedAt)) {
      return ControllerEnrollmentEligibilityState.Ready;
    }
    return ControllerEnrollmentEligibilityState.NoController;
  }

  private async loadMachine(machineId: MachineId): Promise<StoredMachine> {
    const machine = await this.prisma.db.machine.findUnique({
      where: { id: machineId },
      include: {
        controllerCredentials: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!machine) {
      throw new ControllerManagementWrongOwnerException();
    }
    return machine as StoredMachine;
  }

  private async authenticateMachineProof(
    machineId: MachineId,
    authenticatedMachine: AuthenticatedMachine,
    proof: MachineControllerAuthenticationProofDto,
  ): Promise<void> {
    if (
      authenticatedMachine.machineId !== machineId ||
      proof?.machineId !== machineId
    ) {
      throw new ControllerManagementWrongOwnerException();
    }
    this.assertExactKeys(proof, ['machineId', 'challenge', 'signature']);
    const challenge = this.decodeBase64(proof.challenge, 32);
    this.decodeBase64(proof.signature, 64);
    const machine = await this.prisma.db.machine.findUnique({
      where: { id: machineId },
      select: {
        userId: true,
        publicKey: true,
        revokedAt: true,
      },
    });
    if (
      !machine ||
      machine.userId !== authenticatedMachine.userId ||
      machine.revokedAt !== null ||
      !this.machineChallengeService.verifyChallengeSignature(
        machine.publicKey,
        challenge,
        proof.signature,
      ) ||
      !this.machineChallengeService.consumeControllerProofChallenge(
        machineId,
        challenge,
      )
    ) {
      this.logger.warn('Machine controller proof rejected', {
        machineId,
        userId: authenticatedMachine.userId,
        reasonCode: 'machine_proof_rejected',
      });
      throw new UnauthorizedException('Invalid or expired machine proof');
    }
  }

  private assertMachineOwner(machine: StoredMachine, userId: UserId): void {
    if (machine.userId !== userId) {
      throw new ControllerManagementWrongOwnerException();
    }
  }

  private assertNotRevoked(machine: StoredMachine): void {
    if (machine.revokedAt !== null) {
      throw new ControllerManagementMachineRevokedException();
    }
  }

  private assertEnrollmentState(machine: StoredMachine): void {
    if (
      machine.authorizationState !== 'LEGACY' &&
      machine.authorizationState !== 'CONTROLLER_ENROLLMENT_REQUIRED' &&
      machine.authorizationState !== 'READY'
    ) {
      throw new ControllerManagementInvalidStateException();
    }
  }

  private normalizeKnownControllerIds(
    ids: string[],
  ): string[] {
    if (!Array.isArray(ids) || ids.length > 128) {
      throw new UnauthorizedException('Invalid controller reconciliation input');
    }
    for (const id of ids) this.assertCredentialId(id);
    if (new Set(ids).size !== ids.length) {
      throw new UnauthorizedException('Invalid controller reconciliation input');
    }
    return ids;
  }

  private assertCredentialId(value: string): void {
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new UnauthorizedException('Invalid controller credential identifier');
    }
  }

  private assertManagementVersion(value: number): void {
    if (value !== MACHINE_MANAGEMENT_REQUEST_VERSION) {
      throw new ControllerManagementInvalidStateException();
    }
  }

  private assertExactKeys(value: object, expected: readonly string[]): void {
    if (!value || typeof value !== 'object') {
      throw new UnauthorizedException('Invalid controller management request');
    }
    const actual = Object.keys(value).sort();
    const required = [...expected].sort();
    if (
      actual.length !== required.length ||
      actual.some((key, index) => key !== required[index])
    ) {
      throw new UnauthorizedException('Invalid controller management request');
    }
  }

  private decodeBase64(value: string, byteLength: number): Buffer {
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    ) {
      throw new UnauthorizedException('Invalid or expired machine proof');
    }
    const decoded = Buffer.from(value, 'base64');
    const canonical = decoded.toString('base64').replace(/=+$/u, '');
    if (
      decoded.length !== byteLength ||
      canonical !== value.replace(/=+$/u, '')
    ) {
      throw new UnauthorizedException('Invalid or expired machine proof');
    }
    return decoded;
  }

  private sha256Fingerprint(value: string): string {
    return value.length > 0
      ? crypto.createHash('sha256').update(value).digest('hex')
      : 'unavailable';
  }

  private async lockMachine(
    tx: AnyTransactionClient,
    machineId: MachineId,
  ): Promise<void> {
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${machineId}, 42))`;
    }
  }
}
