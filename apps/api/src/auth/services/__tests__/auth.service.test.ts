import { UnauthorizedException } from '@nestjs/common';

import { ApiKeyService } from '../../../services/api-key.service';
import { OrganizationService } from '../../../services/organization.service';
import { UserService } from '../../../services/user.service';
import { OrganizationId, UserId } from '../../../types';
import { AuthService } from '../auth.service';
import {
  BrowserSessionService,
  EstablishedBrowserSession,
} from '../browser-session.service';
import { JwtKeysService } from '../jwt-keys.service';
import { PasswordChangeCredentialService } from '../password-change-credential.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AuthService browser sign-in', () => {
  const userId = 'user-1' as UserId;
  const organizationId = 'org-1' as OrganizationId;
  const user = {
    id: userId,
    email: 'user@example.com',
    name: 'Browser User',
    passwordHash: 'hash',
    isActive: true,
    mustChangePassword: false,
    isDevAdmin: false,
    devAdminMode: false,
  };
  const userResponse = {
    id: userId,
    email: user.email,
    name: user.name,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    currentOrganizationId: organizationId,
  };
  const establishedSession: EstablishedBrowserSession = {
    response: {
      user: userResponse,
      accessToken: 'browser-access',
      expiresIn: 900,
    },
    refreshSecret: 'opaque-refresh-secret',
    sessionId: 'session-1' as EstablishedBrowserSession['sessionId'],
    familyId: 'family-1' as EstablishedBrowserSession['familyId'],
  };

  let userService: jest.Mocked<UserService>;
  let organizationService: jest.Mocked<OrganizationService>;
  let jwtKeysService: jest.Mocked<JwtKeysService>;
  let browserSessionService: jest.Mocked<BrowserSessionService>;
  let passwordChangeCredentialService: jest.Mocked<PasswordChangeCredentialService>;
  let prisma: { db: { $transaction: jest.Mock } };
  let emailService: { sendPasswordRecoveryEmail: jest.Mock };
  let passwordRecoveryThrottleService: {
    check: jest.Mock;
    performEquivalentCostWork: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    userService = {
      findByEmail: jest.fn().mockResolvedValue(user),
      findById: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockResolvedValue(user),
      validatePassword: jest.fn().mockResolvedValue(true),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
      getUserWithOrganizations: jest.fn().mockResolvedValue(userResponse),
    } as unknown as jest.Mocked<UserService>;
    organizationService = {
      getUserMemberships: jest.fn().mockResolvedValue([
        {
          organizationId,
          role: 'MEMBER',
        },
      ]),
    } as unknown as jest.Mocked<OrganizationService>;
    jwtKeysService = {
      signToken: jest
        .fn()
        .mockReturnValueOnce('legacy-access')
        .mockReturnValueOnce('legacy-refresh'),
      verifyToken: jest.fn(),
    } as unknown as jest.Mocked<JwtKeysService>;
    browserSessionService = {
      establish: jest.fn().mockResolvedValue(establishedSession),
      establishInTransaction: jest.fn().mockResolvedValue(establishedSession),
      refresh: jest.fn(),
      logout: jest.fn(),
      revokeAllForUserInTransaction: jest.fn().mockResolvedValue({
        revokedFamilyIds: [],
        revokedSessionIds: [],
      }),
      invalidateRevokedSessions: jest.fn(),
    } as unknown as jest.Mocked<BrowserSessionService>;
    passwordChangeCredentialService = {
      issue: jest.fn().mockResolvedValue('password-change'),
      complete: jest.fn().mockResolvedValue(establishedSession),
    } as unknown as jest.Mocked<PasswordChangeCredentialService>;
    emailService = { sendPasswordRecoveryEmail: jest.fn() };
    passwordRecoveryThrottleService = {
      check: jest.fn().mockResolvedValue({ allowed: true }),
      performEquivalentCostWork: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      userService,
      organizationService,
      jwtKeysService,
      {} as ApiKeyService,
      browserSessionService,
      passwordChangeCredentialService,
      (prisma = {
        db: {
          $transaction: jest
            .fn()
            .mockImplementation((callback) => callback({})),
        },
      }) as unknown as PrismaService,
      emailService as never,
      passwordRecoveryThrottleService as never,
    );
  });

  it('initiates eligible recovery with normalized lookup and one adapter submission', async () => {
    passwordChangeCredentialService.issue.mockResolvedValue('recovery-secret');
    await expect(
      service.initiatePasswordRecovery(
        { email: ' Person@Example.com ' },
        { ipAddress: '203.0.113.5' },
      ),
    ).resolves.toEqual({
      message:
        'If an eligible account exists, recovery instructions will be sent.',
    });

    expect(userService.findByEmail).toHaveBeenCalledWith('person@example.com');
    expect(emailService.sendPasswordRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPasswordRecoveryEmail).toHaveBeenCalledWith({
      to: user.email,
      name: user.name,
      recoveryCredential: 'recovery-secret',
    });
  });

  it('keeps unknown and delivery-failure outcomes indistinguishable', async () => {
    userService.findByEmail.mockResolvedValueOnce(null);
    const unknown = await service.initiatePasswordRecovery(
      { email: 'unknown@example.com' },
      {},
    );
    userService.findByEmail.mockResolvedValueOnce(user as never);
    emailService.sendPasswordRecoveryEmail.mockRejectedValueOnce(
      new Error('provider failure'),
    );
    const adapterFailure = await service.initiatePasswordRecovery(
      { email: user.email },
      {},
    );

    expect(unknown).toEqual(adapterFailure);
    expect(
      passwordRecoveryThrottleService.performEquivalentCostWork,
    ).toHaveBeenCalledTimes(2);
  });

  it('establishes a persisted browser session only after normal login succeeds', async () => {
    const metadata = { ipAddress: '203.0.113.5', userAgent: 'browser/1.0' };

    await expect(
      service.login(
        { email: user.email, password: 'valid-password' },
        metadata,
      ),
    ).resolves.toEqual(establishedSession);

    expect(userService.updateLastLogin).toHaveBeenCalledWith(userId);
    expect(browserSessionService.establish).toHaveBeenCalledWith(
      {
        userId,
        user: userResponse,
        claims: {
          email: user.email,
          name: user.name,
          orgMemberships: [{ orgId: organizationId, role: 'MEMBER' }],
          isDevAdmin: false,
          devAdminMode: false,
        },
      },
      metadata,
    );
  });

  it('creates no browser session for password-change-required login', async () => {
    userService.findByEmail.mockResolvedValue({
      ...user,
      mustChangePassword: true,
    } as never);
    await expect(
      service.login({ email: user.email, password: 'valid-password' }, {}),
    ).resolves.toEqual({
      mustChangePassword: true,
      passwordChangeToken: 'password-change',
    });

    expect(browserSessionService.establish).not.toHaveBeenCalled();
    expect(passwordChangeCredentialService.issue).toHaveBeenCalledWith(
      userId,
      'REQUIRED_CHANGE',
      {},
    );
  });

  it('creates no browser session when password validation fails', async () => {
    userService.validatePassword.mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'invalid-password' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userService.updateLastLogin).not.toHaveBeenCalled();
    expect(browserSessionService.establish).not.toHaveBeenCalled();
  });

  it('creates no browser session for an inactive user', async () => {
    userService.findByEmail.mockResolvedValue({
      ...user,
      isActive: false,
    } as never);

    await expect(
      service.login({ email: user.email, password: 'valid-password' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(browserSessionService.establish).not.toHaveBeenCalled();
  });

  it('keeps OAuth token generation independent from browser session persistence', async () => {
    const result = await service.generateTokensForUserId(userId);

    expect(result).toEqual({
      user: userResponse,
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
      expiresIn: 86400,
    });
    expect(browserSessionService.establish).not.toHaveBeenCalled();
  });

  it('establishes a persisted browser session after registration', async () => {
    const registerDto = {
      email: user.email,
      password: 'valid-password',
      name: user.name,
      organizationName: 'Browser Organization',
    };
    const metadata = {
      ipAddress: '203.0.113.5',
      userAgent: 'browser/1.0',
    };
    userService.findByEmail.mockResolvedValueOnce(null);

    await expect(service.register(registerDto, metadata)).resolves.toEqual(
      establishedSession,
    );

    expect(userService.create).toHaveBeenCalledWith(registerDto);
    expect(userService.updateLastLogin).toHaveBeenCalledWith(userId);
    expect(browserSessionService.establish).toHaveBeenCalledWith(
      {
        userId,
        user: userResponse,
        claims: {
          email: user.email,
          name: user.name,
          orgMemberships: [{ orgId: organizationId, role: 'MEMBER' }],
          isDevAdmin: false,
          devAdminMode: false,
        },
      },
      metadata,
    );
    expect(jwtKeysService.signToken).not.toHaveBeenCalled();
  });

  it('does not fall back to legacy token generation when registration session establishment fails', async () => {
    userService.findByEmail.mockResolvedValueOnce(null);
    browserSessionService.establish.mockRejectedValueOnce(
      new Error('session persistence failed'),
    );

    await expect(
      service.register(
        {
          email: user.email,
          password: 'valid-password',
          name: user.name,
        },
        {},
      ),
    ).rejects.toThrow('session persistence failed');

    expect(jwtKeysService.signToken).not.toHaveBeenCalled();
  });

  it('delegates browser renewal to the stateful session operation', async () => {
    const rotated = {
      status: 'rotated' as const,
      response: establishedSession.response,
      refreshSecret: 'replacement-refresh-secret',
      userId,
      sessionId: establishedSession.sessionId,
      familyId: establishedSession.familyId,
      generation: 1 as any,
      inactivityExpiresAt: new Date('2026-01-08T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    browserSessionService.refresh.mockResolvedValue(rotated);
    const metadata = { ipAddress: '203.0.113.5', userAgent: 'browser/1.0' };

    await expect(
      service.refreshToken('opaque-refresh-secret', metadata),
    ).resolves.toEqual({
      response: establishedSession.response,
      refreshSecret: 'replacement-refresh-secret',
      sessionId: establishedSession.sessionId,
      familyId: establishedSession.familyId,
    });

    expect(browserSessionService.refresh).toHaveBeenCalledWith({
      presentedSecret: 'opaque-refresh-secret',
      requestMetadata: metadata,
    });
    expect(jwtKeysService.verifyToken).not.toHaveBeenCalled();
  });

  it.each([
    'not_found',
    'replay_detected',
    'revoked',
    'inactive',
    'absolutely_expired',
  ] as const)(
    'collapses browser renewal status %s to generic unauthorized',
    async (status) => {
      browserSessionService.refresh.mockResolvedValue({
        status,
      } as never);

      await expect(
        service.refreshToken('opaque-refresh-secret', {}),
      ).rejects.toEqual(
        new UnauthorizedException('Browser session is not authenticated'),
      );
    },
  );

  it('delegates required password completion with bounded request context', async () => {
    const dto = {
      passwordChangeToken: 'password-change',
      newPassword: 'replacement-password',
    };
    const metadata = { ipAddress: '203.0.113.5', userAgent: 'browser/1.0' };

    await expect(service.changePassword(dto, metadata)).resolves.toEqual(
      establishedSession,
    );
    expect(passwordChangeCredentialService.complete).toHaveBeenCalledWith(
      dto.passwordChangeToken,
      dto.newPassword,
      metadata,
    );
  });

  it('atomically replaces a signed-in password and establishes one fresh browser session', async () => {
    const replacementUser = {
      ...user,
      lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      memberships: [
        {
          organizationId,
          role: 'MEMBER',
          organization: { id: organizationId },
        },
      ],
    };
    userService.replaceCurrentPasswordInTransaction = jest
      .fn()
      .mockResolvedValue(replacementUser as never);
    const metadata = { ipAddress: '203.0.113.5', userAgent: 'browser/1.0' };
    const dto = {
      currentPassword: 'current-password',
      newPassword: 'replacement-password',
    };

    await expect(
      service.changeCurrentPassword(userId, dto, metadata),
    ).resolves.toEqual(establishedSession);

    expect(prisma.db.$transaction).toHaveBeenCalledTimes(1);
    expect(
      userService.replaceCurrentPasswordInTransaction,
    ).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    expect(
      browserSessionService.revokeAllForUserInTransaction,
    ).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      expect.any(Date),
      'password_replaced',
    );
    expect(browserSessionService.establishInTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(
      browserSessionService.invalidateRevokedSessions,
    ).toHaveBeenCalledWith([]);
  });

  it('does not revoke sessions when current-password verification fails', async () => {
    userService.replaceCurrentPasswordInTransaction = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('Invalid current password'));

    await expect(
      service.changeCurrentPassword(
        userId,
        {
          currentPassword: 'wrong-password',
          newPassword: 'replacement-password',
        },
        {},
      ),
    ).rejects.toThrow('Invalid current password');

    expect(
      browserSessionService.revokeAllForUserInTransaction,
    ).not.toHaveBeenCalled();
    expect(browserSessionService.establishInTransaction).not.toHaveBeenCalled();
  });

  it('delegates idempotent browser logout resolution', async () => {
    await service.logout('refresh-secret', 'access-token', {});

    expect(browserSessionService.logout).toHaveBeenCalledWith({
      presentedRefreshSecret: 'refresh-secret',
      accessToken: 'access-token',
      requestMetadata: {},
    });
  });
});
