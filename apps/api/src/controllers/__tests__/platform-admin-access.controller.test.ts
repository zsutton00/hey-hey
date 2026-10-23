import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformAdminAccessController } from '../platform-admin-access.controller';

describe('platform admin access', () => {
  const request = { user: { userId: 'caller' } } as unknown as Request & {
    user: AuthenticatedUser;
  };

  it('is open to any authenticated caller under the admin path', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PlatformAdminAccessController),
    ).toEqual([JwtAuthGuard]);
    expect(
      Reflect.getMetadata(PATH_METADATA, PlatformAdminAccessController),
    ).toBe('api/v1/admin/platform-access');
  });

  it.each([true, false])(
    'reports the AdminGuard decision (%s)',
    (isPlatformAdmin) => {
      const guard = {
        isPlatformAdmin: jest.fn().mockReturnValue(isPlatformAdmin),
      };
      const controller = new PlatformAdminAccessController(
        guard as unknown as AdminGuard,
      );

      expect(controller.getAccess(request)).toEqual({ isPlatformAdmin });
      expect(guard.isPlatformAdmin).toHaveBeenCalledWith(request);
    },
  );
});
