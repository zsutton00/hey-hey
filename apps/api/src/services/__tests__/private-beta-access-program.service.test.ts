import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UserId } from '../../types';
import { PrivateBetaAccessProgramService } from '../private-beta-access-program.service';

const operatorId = '550e8400-e29b-41d4-a716-446655440027' as UserId;
const closedAt = new Date('2026-08-16T12:00:00.000Z');

function makeHarness(state: {
  closedAt: Date | null;
  closedByUserId: string | null;
  selfServiceAdmissionMode?: 'OPEN' | 'PAUSED';
  selfServiceAdmissionUpdatedAt?: Date;
  selfServiceAdmissionUpdatedByUserId?: string | null;
}) {
  const fullState = {
    selfServiceAdmissionMode: 'OPEN' as const,
    selfServiceAdmissionUpdatedAt: new Date('2026-08-16T11:00:00.000Z'),
    selfServiceAdmissionUpdatedByUserId: null,
    ...state,
  };
  const queryRaw = jest.fn().mockResolvedValue([fullState]);
  const update = jest.fn().mockImplementation(({ data }) =>
    data.selfServiceAdmissionMode
      ? {
          selfServiceAdmissionMode: data.selfServiceAdmissionMode,
          selfServiceAdmissionUpdatedAt: data.selfServiceAdmissionUpdatedAt,
          selfServiceAdmissionUpdatedByUserId:
            data.selfServiceAdmissionUpdatedByUserId,
        }
      : {
          closedAt,
          closedByUserId: operatorId,
        },
  );
  const updateMany = jest.fn().mockResolvedValue({ count: 3 });
  const findUnique = jest.fn().mockResolvedValue(fullState);
  const tx = {
    $queryRaw: queryRaw,
    privateBetaAccessProgramState: { update, findUnique },
    passwordChangeCredential: { updateMany },
  };
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  const prisma = {
    db: {
      $transaction: transaction,
      privateBetaAccessProgramState: { findUnique },
    },
  } as unknown as PrismaService;

  return {
    service: new PrivateBetaAccessProgramService(prisma),
    tx,
    queryRaw,
    update,
    updateMany,
    findUnique,
  };
}

describe('PrivateBetaAccessProgramService', () => {
  it('does not authorize a signup after permanent closure even when the stored admission mode is OPEN', async () => {
    const harness = makeHarness({
      closedAt,
      closedByUserId: operatorId,
      selfServiceAdmissionMode: 'OPEN',
    });
    await expect(
      harness.service.isSelfServiceAdmissionOpenInTransaction(
        harness.tx as never,
      ),
    ).resolves.toBe(false);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('closes once and revokes outstanding credentials in the same transaction', async () => {
    jest.useFakeTimers().setSystemTime(closedAt);
    const harness = makeHarness({ closedAt: null, closedByUserId: null });

    await expect(harness.service.close(operatorId)).resolves.toEqual({
      status: 'CLOSED',
      closedAt: closedAt.toISOString(),
      closedByUserId: operatorId,
      alreadyClosed: false,
      revokedCredentialCount: 3,
    });
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: 'private-beta' },
      data: { closedAt, closedByUserId: operatorId },
      select: { closedAt: true, closedByUserId: true },
    });
    expect(harness.updateMany).toHaveBeenCalledWith({
      where: {
        privateBetaAccessRequestId: { not: null },
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: closedAt },
    });
    jest.useRealTimers();
  });

  it('returns the original closure without revoking again', async () => {
    const harness = makeHarness({ closedAt, closedByUserId: operatorId });

    await expect(harness.service.close(operatorId)).resolves.toEqual({
      status: 'CLOSED',
      closedAt: closedAt.toISOString(),
      closedByUserId: operatorId,
      alreadyClosed: true,
      revokedCredentialCount: 0,
    });
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.updateMany).not.toHaveBeenCalled();
  });

  it('rejects approval work when the durable program state is closed', async () => {
    const harness = makeHarness({ closedAt, closedByUserId: operatorId });

    await expect(
      harness.service.assertOpenInTransaction(harness.tx as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reads the durable self-service admission mode', async () => {
    const harness = makeHarness({
      closedAt: null,
      closedByUserId: null,
      selfServiceAdmissionMode: 'PAUSED',
      selfServiceAdmissionUpdatedByUserId: operatorId,
    });

    await expect(
      harness.service.getSelfServiceAdmissionMode(),
    ).resolves.toEqual({
      mode: 'PAUSED',
      updatedAt: '2026-08-16T11:00:00.000Z',
      updatedByUserId: operatorId,
    });
  });

  it('persists a mode transition and replays an already-current update', async () => {
    jest.useFakeTimers().setSystemTime(closedAt);
    const open = makeHarness({ closedAt: null, closedByUserId: null });
    await expect(
      open.service.updateSelfServiceAdmissionMode('PAUSED', operatorId),
    ).resolves.toEqual({
      mode: 'PAUSED',
      updatedAt: closedAt.toISOString(),
      updatedByUserId: operatorId,
      alreadyCurrent: false,
    });
    expect(open.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ selfServiceAdmissionMode: 'PAUSED' }),
      }),
    );

    const paused = makeHarness({
      closedAt: null,
      closedByUserId: null,
      selfServiceAdmissionMode: 'PAUSED',
      selfServiceAdmissionUpdatedByUserId: operatorId,
    });
    await expect(
      paused.service.updateSelfServiceAdmissionMode('PAUSED', operatorId),
    ).resolves.toEqual({
      mode: 'PAUSED',
      updatedAt: '2026-08-16T11:00:00.000Z',
      updatedByUserId: operatorId,
      alreadyCurrent: true,
    });
    expect(paused.update).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('reports whether self-service admission is open without applying closure policy', async () => {
    const harness = makeHarness({
      closedAt,
      closedByUserId: operatorId,
      selfServiceAdmissionMode: 'PAUSED',
    });

    await expect(
      harness.service.isSelfServiceAdmissionOpenInTransaction(
        harness.tx as never,
      ),
    ).resolves.toBe(false);
  });
});
