import type { Request } from 'express';
import type { UserId } from '../../types';
import { PrivateBetaAccessProgramController } from '../private-beta-access-program.controller';
import type { PrivateBetaAccessProgramService } from '../../services/private-beta-access-program.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

const operatorId = '550e8400-e29b-41d4-a716-446655440027' as UserId;

describe('PrivateBetaAccessProgramController', () => {
  it('keeps admission reads and mutations behind authentication and admin guards', () => {
    expect(
      Reflect.getMetadata('__guards__', PrivateBetaAccessProgramController),
    ).toEqual([JwtAuthGuard, AdminGuard]);
    for (const method of [
      'getAdmissionMode',
      'updateAdmissionMode',
      'close',
    ] as const) {
      const handler = PrivateBetaAccessProgramController.prototype[method];
      expect(Reflect.getMetadata('isPublic', handler)).toBeUndefined();
    }
  });
  it('reads and updates admission mode through the authenticated operator', async () => {
    const getSelfServiceAdmissionMode = jest.fn().mockResolvedValue({
      mode: 'OPEN',
      updatedAt: '2026-09-22T10:00:00.000Z',
      updatedByUserId: null,
    });
    const updateSelfServiceAdmissionMode = jest.fn().mockResolvedValue({
      mode: 'PAUSED',
      updatedAt: '2026-09-22T10:01:00.000Z',
      updatedByUserId: operatorId,
      alreadyCurrent: false,
    });
    const controller = new PrivateBetaAccessProgramController({
      getSelfServiceAdmissionMode,
      updateSelfServiceAdmissionMode,
    } as unknown as PrivateBetaAccessProgramService);

    await expect(controller.getAdmissionMode()).resolves.toEqual(
      expect.objectContaining({ mode: 'OPEN' }),
    );
    await expect(
      controller.updateAdmissionMode({ mode: 'PAUSED' }, {
        user: { userId: operatorId },
      } as unknown as Request),
    ).resolves.toEqual(expect.objectContaining({ mode: 'PAUSED' }));
    expect(updateSelfServiceAdmissionMode).toHaveBeenCalledWith(
      'PAUSED',
      operatorId,
    );
  });
});
