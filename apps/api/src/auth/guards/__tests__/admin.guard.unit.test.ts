import { ConfigService } from '@nestjs/config';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from '../admin.guard';
import type { AuthenticatedUser } from '../../strategies/jwt.strategy';

describe('AdminGuard', () => {
  const contextFor = (
    user?: AuthenticatedUser,
    remoteAddress = '127.0.0.1',
    headers: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, socket: { remoteAddress }, headers }),
      }),
    }) as unknown as ExecutionContext;

  const contextWithoutSocket = (user: AuthenticatedUser): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  const makeGuard = (env: Record<string, string | undefined>): AdminGuard =>
    new AdminGuard({
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService);

  const user = (
    overrides: Partial<Omit<AuthenticatedUser, 'userId'>> & {
      userId?: string;
    } = {},
  ): AuthenticatedUser =>
    ({
      userId: 'local-user',
      email: 'local@example.test',
      name: 'Local User',
      currentOrgId: 'local-org',
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
      ...overrides,
    }) as AuthenticatedUser;

  it('allows an explicit development administrator over direct loopback', () => {
    const guard = makeGuard({ NODE_ENV: 'development' });

    expect(
      guard.canActivate(
        contextFor(user({ isDevAdmin: true, devAdminMode: true })),
      ),
    ).toBe(true);
  });

  it('rejects an ordinary authenticated development user', () => {
    const guard = makeGuard({ NODE_ENV: 'development' });

    expect(() => guard.canActivate(contextFor(user()))).toThrow(
      new ForbiddenException('Admin access required'),
    );
  });

  it('fails closed when NODE_ENV is unset', () => {
    const guard = makeGuard({});

    expect(() => guard.canActivate(contextFor(user()))).toThrow(
      new ForbiddenException('Admin access required'),
    );
  });

  it('still requires authentication in development', () => {
    const guard = makeGuard({ NODE_ENV: 'development' });

    expect(() => guard.canActivate(contextFor())).toThrow(
      new ForbiddenException('Authentication required'),
    );
  });

  it('honors a configured allowlist in development', () => {
    const guard = makeGuard({
      NODE_ENV: 'development',
      ADMIN_USER_IDS: 'allowed-user',
    });

    expect(
      guard.canActivate(contextFor(user({ userId: 'allowed-user' }))),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(user({ userId: 'different-user' }))),
    ).toThrow(new ForbiddenException('Admin access required'));
  });

  it.each(['192.168.1.50', '10.0.0.20'])(
    'rejects an authenticated development user from non-loopback peer %s',
    (remoteAddress) => {
      const guard = makeGuard({ NODE_ENV: 'development' });

      expect(() =>
        guard.canActivate(
          contextFor(
            user({ isDevAdmin: true, devAdminMode: true }),
            remoteAddress,
          ),
        ),
      ).toThrow(new ForbiddenException('Admin access required'));
    },
  );

  it('rejects an authenticated development user when the direct peer is unavailable', () => {
    const guard = makeGuard({ NODE_ENV: 'development' });

    expect(() =>
      guard.canActivate(
        contextWithoutSocket(user({ isDevAdmin: true, devAdminMode: true })),
      ),
    ).toThrow(new ForbiddenException('Admin access required'));
  });

  it.each(['forwarded', 'x-forwarded-for', 'x-real-ip'])(
    'rejects a loopback development request carrying the %s proxy header',
    (header) => {
      const guard = makeGuard({ NODE_ENV: 'development' });

      expect(() =>
        guard.canActivate(
          contextFor(
            user({ isDevAdmin: true, devAdminMode: true }),
            '127.0.0.1',
            { [header]: '203.0.113.10' },
          ),
        ),
      ).toThrow(new ForbiddenException('Admin access required'));
    },
  );

  it.each(['::1', '127.0.0.1', '::ffff:127.0.0.1'])(
    'allows direct loopback address %s in development with an empty allowlist',
    (remoteAddress) => {
      const guard = makeGuard({ NODE_ENV: 'development' });

      expect(
        guard.canActivate(
          contextFor(
            user({ isDevAdmin: true, devAdminMode: true }),
            remoteAddress,
          ),
        ),
      ).toBe(true);
    },
  );

  it.each(['test', 'staging', 'production'])(
    'fails closed with an empty allowlist in %s',
    (nodeEnv) => {
      const guard = makeGuard({ NODE_ENV: nodeEnv });

      expect(() =>
        guard.canActivate(
          contextFor(user({ isDevAdmin: true, devAdminMode: true })),
        ),
      ).toThrow(new ForbiddenException('Admin access required'));
    },
  );

  describe('isPlatformAdmin', () => {
    const requestFor = (
      caller?: AuthenticatedUser,
      remoteAddress = '127.0.0.1',
    ) => ({ user: caller, socket: { remoteAddress }, headers: {} });

    it('answers with the allowlist the guard enforces', () => {
      const guard = makeGuard({
        NODE_ENV: 'production',
        ADMIN_USER_IDS: 'allowed-user, other-admin',
      });

      expect(
        guard.isPlatformAdmin(requestFor(user({ userId: 'allowed-user' }))),
      ).toBe(true);
      expect(
        guard.isPlatformAdmin(requestFor(user({ userId: 'other-admin' }))),
      ).toBe(true);
      expect(
        guard.isPlatformAdmin(requestFor(user({ userId: 'different-user' }))),
      ).toBe(false);
    });

    it('matches the development loopback allowance', () => {
      const guard = makeGuard({ NODE_ENV: 'development' });
      const devAdmin = user({ isDevAdmin: true, devAdminMode: true });

      expect(guard.isPlatformAdmin(requestFor(devAdmin))).toBe(true);
      expect(guard.isPlatformAdmin(requestFor(devAdmin, '10.0.0.20'))).toBe(
        false,
      );
    });

    it('answers false without throwing for anonymous requests', () => {
      const guard = makeGuard({ ADMIN_USER_IDS: 'allowed-user' });

      expect(guard.isPlatformAdmin(requestFor())).toBe(false);
    });
  });
});
