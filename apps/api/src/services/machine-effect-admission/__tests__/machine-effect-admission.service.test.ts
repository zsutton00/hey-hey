import * as crypto from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MachineEffectHttpMethod,
  MachineEffectProofDto,
} from '../../../generated';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RedisService } from '../../../core/redis/redis.service';
import type { AuthenticatedMachine } from '../../machine-pairing/machine-pairing.service';
import type { MachineId, OrganizationId, UserId } from '../../../types';
import {
  MachineEffectAdmissionService,
  type MachineEffectAdmissionRequest,
} from '../machine-effect-admission.service';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const USER_ID = '00000000-0000-4000-8000-000000000002' as UserId;
const ORGANIZATION_ID =
  '00000000-0000-4000-8000-000000000003' as OrganizationId;
const EFFECT_ID = '00000000-0000-4000-8000-000000000004';
const NONCE = '00000000-0000-4000-8000-000000000005';
const OPERATION_ID = 'submitMachineEffect';
const PATH = `/organizations/${ORGANIZATION_ID}/machine-effects`;
const PAYLOAD = { decision: 'continue', sequence: 7 };

describe(MachineEffectAdmissionService.name, () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const authenticatedMachine: AuthenticatedMachine = {
    machineId: MACHINE_ID,
    userId: USER_ID,
  };
  const machine = {
    id: MACHINE_ID,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    revokedAt: null,
  };
  let findUnique: jest.Mock;
  let evalReplay: jest.Mock;
  let service: MachineEffectAdmissionService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
    findUnique = jest.fn().mockResolvedValue(machine);
    evalReplay = jest.fn().mockResolvedValue(1);
    service = new MachineEffectAdmissionService(
      { db: { machine: { findUnique } } } as unknown as PrismaService,
      { getClient: () => ({ eval: evalReplay }) } as unknown as RedisService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const proof = (
    overrides: Partial<MachineEffectProofDto> = {},
  ): MachineEffectProofDto => {
    const unsigned = {
      version: 1,
      operationId: OPERATION_ID,
      method: MachineEffectHttpMethod.Post,
      path: PATH,
      bodySha256: crypto
        .createHash('sha256')
        .update(canonicalizeJcs(PAYLOAD))
        .digest('hex'),
      organizationId: ORGANIZATION_ID,
      effectId: EFFECT_ID,
      nonce: NONCE,
      timestampMs: Date.now(),
      ...overrides,
    } satisfies Omit<MachineEffectProofDto, 'signature'>;
    return {
      ...unsigned,
      signature: crypto
        .sign(null, Buffer.from(canonicalizeJcs(unsigned)), privateKey)
        .toString('base64'),
    } satisfies MachineEffectProofDto;
  };

  const request = (
    proofValue = proof(),
    overrides: Partial<MachineEffectAdmissionRequest> = {},
  ): MachineEffectAdmissionRequest => ({
    authenticatedMachine,
    proof: proofValue,
    operationId: OPERATION_ID,
    method: MachineEffectHttpMethod.Post,
    path: PATH,
    payload: PAYLOAD,
    ...overrides,
  });

  it('derives identity and returns only an admitted capability after exact proof', async () => {
    await expect(service.admit(request())).resolves.toMatchObject({
      machineId: MACHINE_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      effectId: EFFECT_ID,
      operationId: OPERATION_ID,
    });
    expect(evalReplay).toHaveBeenCalledWith(
      expect.any(String),
      2,
      `machine-effect:effect:${MACHINE_ID}:${EFFECT_ID}`,
      `machine-effect:nonce:${MACHINE_ID}:${NONCE}`,
      '600000',
    );
  });

  it.each([
    ['payload substitution', { payload: { decision: 'stop', sequence: 7 } }],
    ['method substitution', { method: MachineEffectHttpMethod.Delete }],
    ['path substitution', { path: `${PATH}/other` }],
    ['operation substitution', { operationId: 'otherOperation' }],
  ])(
    'rejects %s before reserving replay controls',
    async (_label, overrides) => {
      await expect(
        service.admit(request(proof(), overrides)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(evalReplay).not.toHaveBeenCalled();
    },
  );

  it('rejects a caller-selected cross-organization identity', async () => {
    const otherOrganization =
      '00000000-0000-4000-8000-000000000099' as OrganizationId;
    await expect(
      service.admit(request(proof({ organizationId: otherOrganization }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(evalReplay).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric timestamp instead of bypassing freshness checks', async () => {
    const malformedProof = {
      ...proof(),
      timestampMs: 'not-a-number',
    } as unknown as MachineEffectProofDto;

    await expect(
      service.admit(request(malformedProof)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(evalReplay).not.toHaveBeenCalled();
  });

  it('rejects revoked credentials before signature or replay processing', async () => {
    findUnique.mockResolvedValue({ ...machine, revokedAt: new Date() });
    await expect(service.admit(request())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(evalReplay).not.toHaveBeenCalled();
  });

  it('rejects a reused nonce', async () => {
    evalReplay.mockResolvedValue(0);
    await expect(service.admit(request())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an effect identity reused with a conflicting request binding', async () => {
    evalReplay.mockResolvedValue(-1);
    await expect(service.admit(request())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed when the replay store is unavailable', async () => {
    evalReplay.mockRejectedValue(new Error('redis unavailable'));
    await expect(service.admit(request())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
