import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { OrganizationGuard } from '../organization.guard';
import { ProjectAccessService } from '../../services/project-access.service';

describe('OrganizationGuard', () => {
  const access = { assertOrganization: jest.fn() };
  const guard = new OrganizationGuard(
    access as unknown as ProjectAccessService,
  );
  const context = (user: unknown, organizationId = 'org') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, params: { organizationId } }),
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    access.assertOrganization.mockReset();
  });
  it('uses current persistence even when JWT membership claims are stale', async () => {
    access.assertOrganization.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(
        context({ userId: 'alice', orgMemberships: [{ orgId: 'org' }] }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(access.assertOrganization).toHaveBeenCalledWith('alice', 'org');
  });
  it('admits a current member without relying on token membership claims', async () => {
    await expect(guard.canActivate(context({ userId: 'alice' }))).resolves.toBe(
      true,
    );
  });
  it('rejects unauthenticated requests before persistence', async () => {
    await expect(guard.canActivate(context(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(access.assertOrganization).not.toHaveBeenCalled();
  });
  it('retains the API key organization restriction', async () => {
    await expect(
      guard.canActivate(
        context({
          userId: 'alice',
          authType: 'api-key',
          organizationId: 'other',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(access.assertOrganization).not.toHaveBeenCalled();
  });
  it('checks active membership for an API key owner', async () => {
    access.assertOrganization.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(
        context({
          userId: 'alice',
          authType: 'api-key',
          organizationId: 'org',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
