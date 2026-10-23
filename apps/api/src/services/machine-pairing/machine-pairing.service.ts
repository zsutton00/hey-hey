import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MachineEnrollmentOsFamily,
  MachineEnrollmentState,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { isIP } from 'node:net';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { machineEnrollmentDiagnostic } from './machine-enrollment-diagnostics';
import { MachineId, UserId } from '../../types';
import {
  InvalidMachineEnrollmentMaterialException,
  MachineEnrollmentCreationRateLimitException,
  LegacyMachinePairingRetiredException,
} from '../../common/exceptions/pairing.exceptions';
import { ExistingMachineEnrollmentRejectedException } from '../../common/exceptions/controller-management.exceptions';
import {
  CreateMachineEnrollmentRequestDto,
  CreateMachineEnrollmentResponseDto,
  MachineRevocationReductionBodyDto,
  WebSocketAuthorityReductionEvent,
} from '../../generated';
import { MachineConnectionEvictionService } from '../../core/websockets/machine-connection-eviction.service';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { TriggerEnvelopeSigner } from '../../core/websockets/trigger-envelope-signer.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import { DemoSandboxActivityService } from '../demo-sandbox/demo-sandbox-activity.service';

export const MACHINE_ENROLLMENT_TTL_MS = 5 * 60 * 1000;
export const MACHINE_ENROLLMENT_ATTEMPT_WINDOW_MS = 60 * 1000;
export const MACHINE_ENROLLMENT_ATTEMPT_LIMIT = 50;
export const MACHINE_ENROLLMENT_POLLING_INTERVAL_SECONDS = 5;
const AUTHORITY_REDUCTION_ACK_TIMEOUT_MS = 5_000;

export const MACHINE_ENROLLMENT_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const MACHINE_ENROLLMENT_CODE_LENGTH = 10;

export interface IssuedPairingCode {
  id: string;
  code: string;
  expiresAt: Date;
}

export type PairingCodeState = 'pending' | 'claimed' | 'expired';

export interface PairingCodeStatus {
  state: PairingCodeState;
  machineId: MachineId | null;
  label: string | null;
}

export interface RegisterMachineInput {
  pairingCode: string;
  publicKey: string;
  machineId: MachineId;
  userId: UserId;
  machineName?: string;
}

export interface RegisteredMachine {
  machineId: MachineId;
  token: string;
}

export interface PairedMachine {
  machineId: MachineId;
  name: string;
  pairedAt: Date;
  lastSeen: Date | null;
  revokedAt: Date | null;
  authorizationProtocolVersion: 1 | 2;
}

export interface AuthenticatedMachine {
  machineId: MachineId;
  userId: UserId;
}

export interface MachineAuthorityReduction {
  revokedAt: Date;
  controllersRevoked: number;
  grantsRevoked: number;
}

export interface RevokedMachineReduction extends MachineAuthorityReduction {
  machineId: MachineId;
  organizationId: string | null;
  authorizationProtocolVersion: number | null;
}

export interface RotatedMachineKey {
  machineId: MachineId;
  rotatedAt: Date;
}

export function normalizeEnrollmentSourceAddress(
  sourceAddress: string | undefined,
): string {
  if (!sourceAddress) {
    throw new Error('The enrollment source address is required');
  }
  const candidate = sourceAddress.trim().toLowerCase();
  const mappedIpv4 = candidate.startsWith('::ffff:')
    ? candidate.slice('::ffff:'.length)
    : candidate;

  if (isIP(mappedIpv4) === 4) {
    return mappedIpv4;
  }

  if (isIP(candidate) === 6) {
    return candidate;
  }

  throw new Error('The enrollment source address must be a valid IP address');
}

export function normalizeEnrollmentCode(code: string): string {
  const normalized = code.trim().toUpperCase().replaceAll('-', '');
  if (
    normalized.length !== MACHINE_ENROLLMENT_CODE_LENGTH ||
    [...normalized].some(
      (character) => !MACHINE_ENROLLMENT_CODE_ALPHABET.includes(character),
    )
  ) {
    throw new Error('The enrollment code is invalid');
  }
  return normalized;
}

@Injectable()
export class MachinePairingService {
  private readonly logger = new Logger(MachinePairingService.name);
  private readonly enrollmentCodeHmacKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly machineConnectionEviction: MachineConnectionEvictionService,
    private readonly domainEventPublisher: DomainEventPublisher,
    private readonly configService: ConfigService,
    private readonly triggerEnvelopeSigner: TriggerEnvelopeSigner,
    private readonly websocketGateway: WebsocketGateway,
    private readonly demoSandboxActivity: DemoSandboxActivityService,
  ) {
    const configuredKey = this.configService.get<string>(
      'MACHINE_ENROLLMENT_CODE_HMAC_KEY',
    );
    if (!configuredKey || configuredKey.trim().length === 0) {
      throw new Error(
        'MACHINE_ENROLLMENT_CODE_HMAC_KEY must be configured for machine enrollment',
      );
    }
    this.enrollmentCodeHmacKey = configuredKey;
  }

  async createMachineEnrollment(
    input: CreateMachineEnrollmentRequestDto,
    sourceAddress: string,
  ): Promise<CreateMachineEnrollmentResponseDto> {
    return this.createEnrollment(
      input,
      sourceAddress,
      crypto.randomUUID() as MachineId,
    );
  }

  async createExistingMachineControllerEnrollment(input: {
    machineId: MachineId;
    userId: UserId;
    sourceAddress: string;
  }): Promise<CreateMachineEnrollmentResponseDto> {
    const machine = await this.prisma.db.machine.findFirst({
      where: { id: input.machineId, userId: input.userId },
      select: {
        id: true,
        publicKey: true,
        name: true,
        revokedAt: true,
      },
    });

    if (!machine) {
      throw new ExistingMachineEnrollmentRejectedException('INVALID_STATE');
    }
    if (machine.revokedAt) {
      throw new ExistingMachineEnrollmentRejectedException('MACHINE_REVOKED');
    }

    // The legacy Machine row predates the enrollment metadata fields. The
    // existing-machine contract intentionally does not permit the caller to
    // replace those identity fields, so the pending ceremony carries only
    // compatibility metadata while the stored machine name and public key
    // remain authoritative.
    return this.createEnrollment(
      {
        machinePublicKey: machine.publicKey,
        machineName: machine.name,
        osFamily: 'linux',
        cliVersion: '0.0.0',
        authorizationProtocolVersion: 2,
      },
      input.sourceAddress,
      input.machineId,
      input.userId,
    );
  }

  private async createEnrollment(
    input: CreateMachineEnrollmentRequestDto,
    sourceAddress: string,
    machineId: MachineId,
    existingMachineUserId?: UserId,
  ): Promise<CreateMachineEnrollmentResponseDto> {
    const normalizedSourceAddress =
      normalizeEnrollmentSourceAddress(sourceAddress);
    const sourceClass = this.getSourceAddressClass(normalizedSourceAddress);
    const attemptedAt = new Date();

    // This write intentionally lives outside the enrollment transaction. A
    // rejected request must remain counted after the transaction rolls back.
    await this.prisma.db.machineEnrollmentCreationAttempt.create({
      data: {
        sourceAddress: normalizedSourceAddress,
        attemptedAt,
      },
    });

    const material = this.parseEnrollmentPublicKey(input);
    const code = this.generateEnrollmentCode();
    const deviceSecretBytes = crypto.randomBytes(32);
    const deviceSecret = deviceSecretBytes.toString('base64');
    const userCodeHmac = this.hashEnrollmentCode(code);
    const deviceSecretDigest = this.hashDeviceSecret(deviceSecretBytes);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + MACHINE_ENROLLMENT_TTL_MS);
    const sourceWindowStart = new Date(
      attemptedAt.getTime() - MACHINE_ENROLLMENT_ATTEMPT_WINDOW_MS,
    );

    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        await this.lockMachine(tx, machineId);

        if (existingMachineUserId) {
          const existingMachine = await tx.machine.findFirst({
            where: {
              id: machineId,
              userId: existingMachineUserId,
              revokedAt: null,
            },
            select: { id: true },
          });
          if (!existingMachine) {
            throw new ExistingMachineEnrollmentRejectedException(
              'INVALID_STATE',
            );
          }
        }

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${normalizedSourceAddress}, 0))`;

        const attemptCount = await tx.machineEnrollmentCreationAttempt.count({
          where: {
            sourceAddress: normalizedSourceAddress,
            attemptedAt: { gte: sourceWindowStart },
          },
        });

        if (attemptCount > MACHINE_ENROLLMENT_ATTEMPT_LIMIT) {
          this.logger.warn(
            'Machine enrollment creation rejected',
            machineEnrollmentDiagnostic('throttling', {
              reasonCode: 'source_rate_limit',
              sourceClass,
              attemptCount,
              retryAfterSeconds: Math.ceil(
                MACHINE_ENROLLMENT_ATTEMPT_WINDOW_MS / 1000,
              ),
              decision: 'retry_later',
            }),
          );
          throw new MachineEnrollmentCreationRateLimitException(
            Math.ceil(MACHINE_ENROLLMENT_ATTEMPT_WINDOW_MS / 1000),
          );
        }

        const enrollment = await tx.pendingMachineEnrollment.create({
          data: {
            machineId,
            machinePublicKey: input.machinePublicKey,
            machinePublicKeyFingerprint: material.fingerprint,
            machineName: input.machineName,
            osFamily: input.osFamily as MachineEnrollmentOsFamily,
            cliVersion: input.cliVersion,
            authorizationProtocolVersion: input.authorizationProtocolVersion,
            userCodeHmac,
            deviceSecretDigest,
            state: MachineEnrollmentState.PENDING,
            createdAt,
            expiresAt,
          },
        });

        this.logger.log(
          'Machine enrollment created',
          machineEnrollmentDiagnostic('creation', {
            enrollmentId: enrollment.id,
            machineId,
            sourceClass,
            attemptCount,
            state: MachineEnrollmentState.PENDING,
            decision: 'created',
            reasonCode: 'enrollment_created',
          }),
        );

        return {
          enrollmentId: enrollment.id,
          machineId,
          deviceSecret,
          userCode: this.formatEnrollmentCode(code),
          expiresAt: expiresAt.toISOString(),
          pollingIntervalSeconds: MACHINE_ENROLLMENT_POLLING_INTERVAL_SECONDS,
        } satisfies CreateMachineEnrollmentResponseDto;
      });

      return result;
    } catch (error) {
      if (
        error instanceof InvalidMachineEnrollmentMaterialException ||
        error instanceof MachineEnrollmentCreationRateLimitException
      ) {
        throw error;
      }

      this.logger.error(
        'Machine enrollment creation failed',
        machineEnrollmentDiagnostic('failed_transition', {
          reasonCode: 'persistence_failure',
          sourceClass,
          decision: 'creation_failed',
        }),
      );
      throw error;
    }
  }

  async issuePairingCode(userId: UserId): Promise<IssuedPairingCode> {
    return this.rejectLegacyPairing('issuance', { userId });
  }

  async registerMachine(
    input: RegisterMachineInput,
  ): Promise<RegisteredMachine> {
    return this.rejectLegacyPairing('registration', {
      machineId: input.machineId,
      userId: input.userId,
    });
  }

  async listMachines(userId: UserId): Promise<PairedMachine[]> {
    this.logger.log(`Listing paired machines for user ${userId}`);

    const rows = await this.prisma.db.machine.findMany({
      where: { userId, revokedAt: null },
      orderBy: { pairedAt: 'desc' },
    });

    this.logger.log(
      `Found ${rows.length} active paired machine(s) for user ${userId}`,
    );

    return rows.map((row) => ({
      machineId: row.id as MachineId,
      name: row.name,
      pairedAt: row.pairedAt,
      lastSeen: row.lastSeen,
      revokedAt: row.revokedAt,
      authorizationProtocolVersion:
        row.authorizationProtocolVersion === 2 ? 2 : 1,
    }));
  }

  /**
   * Assert the machine is paired to `userId` and not revoked. Not-found and
   * wrong-owner collapse to the same 404 (mirroring `revokeMachine`) so the
   * existence of another user's machine is never leaked; a revoked machine is
   * treated as not-found since it can no longer be a reachability target.
   */
  async assertOwnedMachine(
    userId: UserId,
    machineId: MachineId,
  ): Promise<void> {
    const existing = await this.prisma.db.machine.findFirst({
      where: { id: machineId, userId, revokedAt: null },
    });

    if (!existing) {
      this.logger.warn(
        `Machine ${machineId} not found or not owned by user ${userId}`,
      );
      throw new NotFoundException(`Machine ${machineId} not found`);
    }
  }

  async revokeMachine(userId: UserId, machineId: MachineId): Promise<void> {
    this.logger.log(`Revoking machine ${machineId} for user ${userId}`);

    // Composite ownership lookup: not-found and wrong-owner collapse to the
    // same 404 so we don't leak the existence of another user's machine.
    const existing = await this.prisma.db.machine.findFirst({
      where: { id: machineId, userId },
    });

    if (!existing) {
      this.logger.warn(
        `Revoke failed for machine ${machineId}: not found or not owned by user ${userId}`,
      );
      throw new NotFoundException(`Machine ${machineId} not found`);
    }

    const requestedRevokedAt = new Date();
    const reduction = await this.prisma.db.$transaction(async (tx) => {
      await this.lockMachine(tx, machineId);
      const current = await tx.machine.findFirst({
        where: { id: machineId, userId },
      });
      if (!current) {
        throw new NotFoundException(`Machine ${machineId} not found`);
      }
      return this.reduceMachineAuthorityInTransaction(
        tx,
        machineId,
        current.revokedAt ?? requestedRevokedAt,
      );
    });

    this.logger.log(`Machine ${machineId} revoked for user ${userId}`, {
      machineId,
      userId,
      controllersRevoked: reduction.controllersRevoked,
      grantsRevoked: reduction.grantsRevoked,
      revokedAt: reduction.revokedAt.toISOString(),
      reasonCode: 'machine_revoked',
    });

    await this.deliverMachineReduction(userId, {
      machineId,
      organizationId: existing.organizationId,
      authorizationProtocolVersion: existing.authorizationProtocolVersion,
      ...reduction,
    });
  }

  /**
   * In-transaction half of {@link revokeMachine}, applied to every machine the
   * user still holds. Controllers and execution grants are revoked with the
   * machine and audit rows are retained. Returns only machines revoked by this
   * call, so a resumed caller never redelivers a reduction it already sent.
   * Delivery stays post-commit: pass the result to
   * {@link deliverRevocationReductions} once the transaction has committed.
   */
  async revokeAllForUserInTransaction(
    tx: Prisma.TransactionClient,
    userId: UserId,
    revokedAt: Date,
  ): Promise<RevokedMachineReduction[]> {
    const machines = await tx.machine.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        organizationId: true,
        authorizationProtocolVersion: true,
      },
      orderBy: { id: 'asc' },
    });
    const reductions: RevokedMachineReduction[] = [];
    for (const machine of machines) {
      const machineId = machine.id as MachineId;
      await this.lockMachine(tx, machineId);
      const reduction = await this.reduceMachineAuthorityInTransaction(
        tx,
        machineId,
        revokedAt,
      );
      reductions.push({
        machineId,
        organizationId: machine.organizationId,
        authorizationProtocolVersion: machine.authorizationProtocolVersion,
        ...reduction,
      });
    }
    this.logger.log('All machine authority revoked for user', {
      userId,
      machinesRevoked: reductions.length,
      reasonCode: 'machine_revoked',
    });
    return reductions;
  }

  /** Post-commit: signed reduction frame, socket disconnect and revoked event per machine. */
  async deliverRevocationReductions(
    userId: UserId,
    reductions: RevokedMachineReduction[],
  ): Promise<void> {
    this.logger.log('Delivering machine revocation reductions', {
      userId,
      machines: reductions.length,
    });
    for (const reduction of reductions) {
      await this.deliverMachineReduction(userId, reduction);
    }
  }

  private async reduceMachineAuthorityInTransaction(
    tx: AnyTransactionClient,
    machineId: MachineId,
    revokedAt: Date,
  ): Promise<MachineAuthorityReduction> {
    await tx.machine.update({
      where: { id: machineId },
      data: { revokedAt },
    });
    const controllerReduction =
      await tx.machineControllerCredential?.updateMany({
        where: { machineId, revokedAt: null },
        data: { revokedAt },
      });
    const grantReduction = await tx.executionGrant.updateMany({
      where: {
        machineId,
        revokedAt: null,
      },
      data: { revokedAt },
    });

    return {
      revokedAt,
      controllersRevoked: controllerReduction?.count ?? 0,
      grantsRevoked: grantReduction.count,
    };
  }

  private async deliverMachineReduction(
    userId: UserId,
    reduction: RevokedMachineReduction,
  ): Promise<void> {
    const { machineId, organizationId } = reduction;
    let liveReductionApplied = false;
    if (reduction.authorizationProtocolVersion === 2 && organizationId) {
      const event = {
        version: 2,
        kind: 'machine_revocation_reduction',
        action: 'MACHINE_REVOKE',
        machineId,
        revokedAt: reduction.revokedAt.toISOString(),
        executionReadiness: 'MACHINE_REVOKED',
      } satisfies MachineRevocationReductionBodyDto;
      const envelope =
        this.triggerEnvelopeSigner.signMachineRevocationReduction(
          event,
          machineId,
          userId,
        );
      try {
        const acknowledgement =
          await this.websocketGateway.emitAuthorityReductionWithAck(
            {
              type: 'trigger.authority_reduction',
              timestamp: new Date().toISOString(),
              organizationId,
              userId,
              envelope,
            } satisfies WebSocketAuthorityReductionEvent,
            AUTHORITY_REDUCTION_ACK_TIMEOUT_MS,
          );
        liveReductionApplied = acknowledgement?.status === 'APPLIED';
      } catch (error) {
        this.logger.warn('Machine authority reduction delivery failed', {
          machineId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.logger.log('Machine authority reduction delivery completed', {
      machineId,
      userId,
      liveReductionApplied,
      reasonCode: liveReductionApplied
        ? 'applied_before_ack'
        : 'offline_reconcile_required',
    });

    // The committed revocation blocks future authentication. After the live
    // reduction has had one acknowledged durability opportunity,
    // force-close every remaining socket, on every API replica, so terminal
    // machine authority cannot stay connected anywhere.
    const disconnected =
      await this.machineConnectionEviction.evictMachine(machineId);
    this.logger.log(
      `Force-disconnected ${disconnected} local socket(s) for revoked machine ${machineId}`,
    );

    // Producer-side signal for the machine security event feed (persistence +
    // read endpoint owned by a separate task). Best-effort: a feed write must
    // not fail the revoke itself, which already took effect above.
    try {
      await this.domainEventPublisher.publish({
        type: EVENT_TYPES.MACHINE.REVOKED,
        aggregateId: machineId,
        payload: {
          machineId,
          userId,
          revokedAt: reduction.revokedAt.toISOString(),
        },
      });
      this.logger.log(`Emitted machine.revoked event for machine ${machineId}`);
    } catch (error) {
      this.logger.error(
        `Failed to emit machine.revoked event for machine ${machineId}`,
        error,
      );
    }
  }

  /**
   * Resolve a presented durable machine credential (the `mch_` token issued at
   * registration) to its machine. Hashes the credential and looks it up by the
   * stored token hash — the plaintext token is never persisted. Returns null
   * for an unknown or revoked credential so callers reject uniformly without
   * leaking which case occurred. This is the machine-credential authentication
   * used by the key-rotation route in place of the user JWT.
   */
  async authenticateMachineCredential(
    credential: string,
  ): Promise<AuthenticatedMachine | null> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(credential)
      .digest('hex');

    const machine = await this.prisma.db.machine.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        user: { select: { isDemoUser: true } },
      },
    });

    if (!machine) {
      this.logger.warn(
        'Machine credential authentication failed: unknown token',
      );
      return null;
    }

    if (machine.revokedAt) {
      this.logger.warn(
        `Machine credential authentication failed: machine ${machine.id} is revoked`,
      );
      return null;
    }

    this.logger.log(`Authenticated machine ${machine.id} via credential`);
    // A paired CLI acting for a demo user keeps its sandbox alive. Never
    // blocks or fails authentication.
    if (machine.user.isDemoUser) {
      void this.demoSandboxActivity.recordActivity(machine.userId);
    }
    return {
      machineId: machine.id as MachineId,
      userId: machine.userId as UserId,
    };
  }

  /**
   * Register a new Ed25519 public key for an already-paired machine without a
   * fresh pairing code. Authorization derives from the machine's current
   * credential (verified by the caller via authenticateMachineCredential), not
   * a pairing code. Overwriting the single publicKey column inherently
   * invalidates the old key: the next WebSocket challenge verifies signatures
   * against this key only, so any connection still presenting the old key fails
   * challenge-response. A revoked machine cannot rotate.
   */
  async rotateMachineKey(
    machineId: MachineId,
    newPublicKey: string,
  ): Promise<RotatedMachineKey> {
    this.logger.log(`Rotating public key for machine ${machineId}`);

    const existing = await this.prisma.db.machine.findFirst({
      where: { id: machineId, revokedAt: null },
    });

    if (!existing) {
      this.logger.warn(
        `Key rotation failed for machine ${machineId}: not found or revoked`,
      );
      throw new NotFoundException(`Machine ${machineId} not found`);
    }

    const updated = await this.prisma.db.machine.update({
      where: { id: machineId },
      data: { publicKey: newPublicKey },
    });

    this.logger.log(
      `Public key rotated for machine ${machineId} at ${updated.updatedAt.toISOString()}`,
    );

    return { machineId, rotatedAt: updated.updatedAt };
  }

  async getPairingCodeStatus(
    userId: UserId,
    id: string,
  ): Promise<PairingCodeStatus> {
    return this.rejectLegacyPairing('polling', { pairingCodeId: id, userId });
  }

  private parseEnrollmentPublicKey(input: CreateMachineEnrollmentRequestDto): {
    fingerprint: string;
  } {
    const requestKeys = [
      'machinePublicKey',
      'machineName',
      'osFamily',
      'cliVersion',
      'authorizationProtocolVersion',
    ];
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).some((key) => !requestKeys.includes(key)) ||
      typeof input.machinePublicKey !== 'string' ||
      input.machinePublicKey.length < 1 ||
      input.machinePublicKey.length > 4096 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(
        input.machinePublicKey,
      ) ||
      typeof input.machineName !== 'string' ||
      input.machineName.length < 1 ||
      input.machineName.length > 128 ||
      typeof input.cliVersion !== 'string' ||
      input.cliVersion.length < 1 ||
      input.cliVersion.length > 64 ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.cliVersion) ||
      (input.osFamily !== 'macos' &&
        input.osFamily !== 'windows' &&
        input.osFamily !== 'linux') ||
      input.authorizationProtocolVersion !== 2
    ) {
      throw new InvalidMachineEnrollmentMaterialException();
    }

    try {
      const publicKey = crypto.createPublicKey(input.machinePublicKey);
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('not-ed25519');
      }

      const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
      if (!Buffer.isBuffer(spkiDer)) {
        throw new Error('invalid-spki');
      }

      return {
        fingerprint: crypto.createHash('sha256').update(spkiDer).digest('hex'),
      };
    } catch {
      throw new InvalidMachineEnrollmentMaterialException();
    }
  }

  private rejectLegacyPairing(
    operation: 'issuance' | 'polling' | 'registration',
    identifiers: {
      userId: string;
      machineId?: string;
      pairingCodeId?: string;
    },
  ): never {
    this.logger.warn('Legacy machine pairing boundary rejected', {
      operation,
      reasonCode: 'legacy_machine_pairing_retired',
      ...identifiers,
    });
    throw new LegacyMachinePairingRetiredException();
  }

  private generateEnrollmentCode(): string {
    let code = '';
    for (let index = 0; index < MACHINE_ENROLLMENT_CODE_LENGTH; index += 1) {
      code += MACHINE_ENROLLMENT_CODE_ALPHABET.charAt(
        crypto.randomInt(0, MACHINE_ENROLLMENT_CODE_ALPHABET.length),
      );
    }
    return code;
  }

  private formatEnrollmentCode(code: string): string {
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  }

  private hashEnrollmentCode(code: string): string {
    return crypto
      .createHmac('sha256', this.enrollmentCodeHmacKey)
      .update(code)
      .digest('hex');
  }

  private hashDeviceSecret(deviceSecret: Buffer): string {
    return crypto.createHash('sha256').update(deviceSecret).digest('hex');
  }

  private getSourceAddressClass(sourceAddress: string): 'ipv4' | 'ipv6' {
    return isIP(sourceAddress) === 4 ? 'ipv4' : 'ipv6';
  }

  private async lockMachine(
    tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
    machineId: MachineId,
  ): Promise<void> {
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${machineId}, 42))`;
    }
  }
}
