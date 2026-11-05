import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminHintController } from '../admin-hint.controller';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { testIds } from '../../utils/testUtils';

describe('AdminHintController', () => {
  it('requires both authentication and platform-admin access', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminHintController)).toEqual([
      JwtAuthGuard,
      AdminGuard,
    ]);
  });
  it('passes the caller and parsed filters to the listing', async () => {
    const result = { hints: [], matchingCount: 0, totalCount: 0 };
    const listing = { list: jest.fn().mockResolvedValue(result) };
    const controller = new AdminHintController(listing as never);
    await expect(
      controller.list(
        testIds.organization,
        testIds.project,
        testIds.user,
        'token',
        ' text ',
        'FEATURE',
        '2',
      ),
    ).resolves.toEqual(result);
    expect(listing.list).toHaveBeenCalledWith(
      {
        organizationId: testIds.organization,
        projectId: testIds.project,
        userId: testIds.user,
        token: 'token',
      },
      { search: 'text', itemTypes: ['FEATURE'], minStrength: 2 },
    );
  });

  it('rejects a negative minimum strength', () => {
    const controller = new AdminHintController({ list: jest.fn() } as never);
    expect(() =>
      controller.list(
        testIds.organization,
        testIds.project,
        testIds.user,
        'token',
        undefined,
        undefined,
        '-1',
      ),
    ).toThrow('minStrength');
  });
});
