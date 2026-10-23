import * as crypto from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import {
  MachineEffectHttpMethod,
  MachineEffectProofDto,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import type { MachineId, OrganizationId, UserId } from '../../types';

const MACHINE_EFFECT_FRESHNESS_MS = 5 * 60 * 1000;
const MACHINE_EFFECT_REPLAY_TTL_MS = 10 * 60 * 1000;

const reserveReplayKeysScript = (effectBinding: string): string => `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('PSETEX', KEYS[2], ARGV[1], '1')
local existing_effect_binding = redis.call('GET', KEYS[1])
if existing_effect_binding and existing_effect_binding ~= '${effectBinding}' then
  return -1
end
redis.call('PSETEX', KEYS[1], ARGV[1], '${effectBinding}')
return 1
`;

const ADMITTED_MACHINE_EFFECT: unique symbol = Symbol('AdmittedMachineEffect');

export interface AdmittedMachineEffect {
  readonly [ADMITTED_MACHINE_EFFECT]: true;
  readonly machineId: MachineId;
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly effectId: string;
  readonly operationId: string;
}

class VerifiedMachineEffect implements AdmittedMachineEffect {
  public readonly [ADMITTED_MACHINE_EFFECT] = true;

  public constructor(
    public readonly machineId: MachineId,
    public readonly userId: UserId,
    public readonly organizationId: OrganizationId,
    public readonly effectId: string,
    public readonly operationId: string,
  ) {}
}

export interface MachineEffectAdmissionRequest {
  authenticatedMachine: AuthenticatedMachine;
  proof: MachineEffectProofDto;
  operationId: string;
  method: MachineEffectHttpMethod;
  path: string;
  payload: unknown;
}

@Injectable()
export class MachineEffectAdmissionService {
  private readonly logger = new Logger(MachineEffectAdmissionService.name);
  private readonly redis: Redis;

  public constructor(
    private readonly prisma: PrismaService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getClient();
  }

  public async admit(
    request: MachineEffectAdmissionRequest,
  ): Promise<AdmittedMachineEffect> {
    const { authenticatedMachine, proof } = request;
    this.logger.debug('Resolving machine-effect credential identity', {
      machineId: authenticatedMachine.machineId,
      effectId: proof.effectId,
      operationId: request.operationId,
    });

    const machine = await this.prisma.db.machine.findUnique({
      where: { id: authenticatedMachine.machineId },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        publicKey: true,
        revokedAt: true,
      },
    });

    if (
      !machine ||
      machine.revokedAt !== null ||
      machine.id !== authenticatedMachine.machineId ||
      machine.userId !== authenticatedMachine.userId ||
      machine.organizationId === null ||
      machine.organizationId !== proof.organizationId
    ) {
      this.deny(request, 'credential_identity_rejected');
    }

    this.assertExactProofShape(request);
    this.logger.debug('Canonicalizing machine-effect request', {
      machineId: machine.id,
      effectId: proof.effectId,
      operationId: request.operationId,
    });

    const bodySha256 = crypto
      .createHash('sha256')
      .update(canonicalizeJcs(request.payload), 'utf8')
      .digest('hex');
    const now = Date.now();
    if (
      proof.version !== 1 ||
      proof.operationId !== request.operationId ||
      proof.method !== request.method ||
      proof.path !== request.path ||
      proof.bodySha256 !== bodySha256 ||
      !Number.isSafeInteger(proof.timestampMs) ||
      proof.timestampMs < 0 ||
      Math.abs(now - proof.timestampMs) > MACHINE_EFFECT_FRESHNESS_MS
    ) {
      this.deny(request, 'request_binding_rejected');
    }

    const signature = this.decodeSignature(proof.signature, request);
    const unsignedProof = {
      version: proof.version,
      operationId: proof.operationId,
      method: proof.method,
      path: proof.path,
      bodySha256: proof.bodySha256,
      organizationId: proof.organizationId,
      effectId: proof.effectId,
      nonce: proof.nonce,
      timestampMs: proof.timestampMs,
    } satisfies Omit<MachineEffectProofDto, 'signature'>;

    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(unsignedProof), 'utf8'),
        crypto.createPublicKey(machine.publicKey),
        signature,
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      this.deny(request, 'signature_rejected');
    }

    await this.reserveReplayControls(machine.id as MachineId, proof, request);

    const admitted = new VerifiedMachineEffect(
      machine.id as MachineId,
      machine.userId as UserId,
      machine.organizationId as OrganizationId,
      proof.effectId,
      proof.operationId,
    );
    this.logger.log('Created admitted machine-effect capability', {
      machineId: admitted.machineId,
      userId: admitted.userId,
      organizationId: admitted.organizationId,
      effectId: admitted.effectId,
      operationId: admitted.operationId,
    });
    return admitted;
  }

  private async reserveReplayControls(
    machineId: MachineId,
    proof: MachineEffectProofDto,
    request: MachineEffectAdmissionRequest,
  ): Promise<void> {
    const effectKey = `machine-effect:effect:${machineId}:${proof.effectId}`;
    const nonceKey = `machine-effect:nonce:${machineId}:${proof.nonce}`;
    const effectBinding = crypto
      .createHash('sha256')
      .update(
        canonicalizeJcs({
          version: proof.version,
          operationId: proof.operationId,
          method: proof.method,
          path: proof.path,
          bodySha256: proof.bodySha256,
          organizationId: proof.organizationId,
          effectId: proof.effectId,
        }),
        'utf8',
      )
      .digest('hex');
    try {
      const reserved = await this.redis.eval(
        reserveReplayKeysScript(effectBinding),
        2,
        effectKey,
        nonceKey,
        String(MACHINE_EFFECT_REPLAY_TTL_MS),
      );
      if (reserved !== 1) {
        this.deny(
          request,
          reserved === -1
            ? 'effect_binding_mismatch'
            : 'nonce_replay_rejected',
        );
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('Machine-effect replay store unavailable', {
        machineId,
        effectId: proof.effectId,
        operationId: proof.operationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableException(
        'Machine-effect admission is temporarily unavailable',
      );
    }
  }

  private assertExactProofShape(request: MachineEffectAdmissionRequest): void {
    const expected = [
      'bodySha256',
      'effectId',
      'method',
      'nonce',
      'operationId',
      'organizationId',
      'path',
      'signature',
      'timestampMs',
      'version',
    ];
    const actual = Object.keys(request.proof).sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      this.deny(request, 'proof_shape_rejected');
    }
  }

  private decodeSignature(
    value: string,
    request: MachineEffectAdmissionRequest,
  ): Buffer {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
      this.deny(request, 'signature_encoding_rejected');
    }
    const decoded = Buffer.from(value, 'base64');
    if (
      decoded.length !== 64 ||
      decoded.toString('base64').replace(/=+$/u, '') !==
        value.replace(/=+$/u, '')
    ) {
      this.deny(request, 'signature_encoding_rejected');
    }
    return decoded;
  }

  private deny(
    request: MachineEffectAdmissionRequest,
    reasonCode: string,
  ): never {
    this.logger.warn('Machine-effect admission denied', {
      machineId: request.authenticatedMachine.machineId,
      effectId: request.proof.effectId,
      operationId: request.operationId,
      reasonCode,
    });
    throw new UnauthorizedException('Invalid machine-effect proof');
  }
}
