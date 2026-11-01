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
  it('passes organization, project and authenticated identity to the dedicated listing', async () => {
    const result = { hints: [] };
    const service = { listProjectHints: jest.fn().mockResolvedValue(result) };
    const controller = new AdminHintController(service as never);
    await expect(
      controller.list(
        testIds.organization,
        testIds.project,
        testIds.user,
        'token',
      ),
    ).resolves.toEqual(result);
    expect(service.listProjectHints).toHaveBeenCalledWith({
      organizationId: testIds.organization,
      projectId: testIds.project,
      userId: testIds.user,
      token: 'token',
    });
  });
});
