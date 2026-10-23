import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { DevAdminGuard } from '../dev-admin.guard';

describe('DevAdminGuard', () => {
  let guard: DevAdminGuard;

  beforeEach(() => {
    guard = new DevAdminGuard();
  });

  const mockContext = (user?: {
    userId: string;
    isDevAdmin?: boolean;
    devAdminMode?: boolean;
  }): ExecutionContext => {
    const request = {
      user,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('allows access for users in dev-admin mode', () => {
    const user = {
      userId: 'user_1',
      isDevAdmin: true,
      devAdminMode: true,
    };
    const context = mockContext(user);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws when user missing', () => {
    const context = mockContext();
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws when user is not dev admin', () => {
    const user = { userId: 'user_1', isDevAdmin: false, devAdminMode: false };
    const context = mockContext(user);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws when devAdminMode is disabled even if user is dev admin', () => {
    const user = { userId: 'user_1', isDevAdmin: true, devAdminMode: false };
    const context = mockContext(user);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
