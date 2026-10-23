import { OrganizationRole } from '../../../generated';
import { UserService } from '../../../services/user.service';
import { JwtPayload } from '../../strategies/jwt.strategy';
import { JwtKeysService } from '../jwt-keys.service';
import { UserAccessTokenValidatorService } from '../user-access-token-validator.service';
import { OrganizationId } from '../../../types';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { DemoSandboxActivityService } from '../../../services/demo-sandbox/demo-sandbox-activity.service';

describe('UserAccessTokenValidatorService', () => {
  const activeUser = {
    id: 'user-1',
    email: 'current@example.com',
    name: 'Current User',
    isActive: true,
    isDevAdmin: false,
    devAdminMode: false,
    isDemoUser: false,
    memberships: [
      {
        organizationId: 'org-1',
        isActive: true,
        role: OrganizationRole.Owner,
      },
      {
        organizationId: 'org-2',
        isActive: true,
        role: OrganizationRole.Member,
      },
    ],
  };

  let userService: jest.Mocked<UserService>;
  let jwtKeysService: jest.Mocked<JwtKeysService>;
  let service: UserAccessTokenValidatorService;
  let accountEntitlementService: jest.Mocked<AccountEntitlementService>;
  let getAuthorizedOrganizationIds: jest.Mock;
  let demoSandboxActivity: { recordActivity: jest.Mock };

  beforeEach(() => {
    userService = {
      findForAuthentication: jest.fn().mockResolvedValue(activeUser),
    } as unknown as jest.Mocked<UserService>;
    jwtKeysService = {
      verifyToken: jest.fn(),
      isSystemSubject: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<JwtKeysService>;
    getAuthorizedOrganizationIds = jest
      .fn()
      .mockResolvedValue(new Set(['org-1', 'org-2']));
    accountEntitlementService = {
      getAuthorizedOrganizationIds,
    } as unknown as jest.Mocked<AccountEntitlementService>;
    demoSandboxActivity = { recordActivity: jest.fn() };
    service = new UserAccessTokenValidatorService(
      userService,
      jwtKeysService,
      accountEntitlementService,
      demoSandboxActivity as unknown as DemoSandboxActivityService,
    );
  });

  const legacyAccessPayload = (
    overrides: Partial<JwtPayload> = {},
  ): JwtPayload => ({
    sub: 'user-1',
    currentOrgId: 'org-1' as OrganizationId,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  });

  it('accepts a legacy unscoped browser access token as an interim compatibility case', async () => {
    jwtKeysService.verifyToken.mockReturnValue(legacyAccessPayload());

    await expect(service.verifyAndValidate('legacy-token')).resolves.toEqual(
      expect.objectContaining({
        userId: 'user-1',
        currentOrgId: 'org-1',
        orgMemberships: [
          {
            orgId: 'org-1',
            role: OrganizationRole.Owner,
          },
          {
            orgId: 'org-2',
            role: OrganizationRole.Member,
          },
        ],
      }),
    );
  });

  it('rejects a verified token without an expiry for browser lifecycle use', async () => {
    jwtKeysService.verifyToken.mockReturnValue(
      legacyAccessPayload({ exp: undefined }),
    );

    await expect(service.verifyAndValidate('legacy-token')).rejects.toThrow(
      'Token expiration is missing',
    );
  });

  it('returns expiry and optional lifecycle bindings from the verified payload', async () => {
    jwtKeysService.verifyToken.mockReturnValue(
      legacyAccessPayload({
        exp: Math.floor(Date.now() / 1000) + 60,
        sid: 'session-1',
        authz_version: 3,
      }),
    );

    await expect(service.verifyAndValidate('access-token')).resolves.toEqual(
      expect.objectContaining({
        expiresAt: expect.any(Date),
        sessionId: 'session-1',
        authorizationVersion: 3,
      }),
    );
  });

  it.each([
    ['malformed', new Error('jwt malformed')],
    ['expired', new Error('jwt expired')],
  ])('rejects a %s signed credential', async (_case, error) => {
    jwtKeysService.verifyToken.mockImplementation(() => {
      throw error;
    });

    await expect(service.verifyAndValidate('bad-token')).rejects.toBe(error);
    expect(userService.findForAuthentication).not.toHaveBeenCalled();
  });

  it('rejects a payload without a subject', async () => {
    await expect(
      service.validate(legacyAccessPayload({ sub: '' })),
    ).rejects.toThrow('Token subject is missing');
    expect(userService.findForAuthentication).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'password_change'])(
    'rejects a %s-purpose credential',
    async (type) => {
      await expect(
        service.validate(legacyAccessPayload({ type })),
      ).rejects.toThrow('Scoped token cannot be used for authentication');
      expect(userService.findForAuthentication).not.toHaveBeenCalled();
    },
  );

  it('rejects a system subject', async () => {
    jwtKeysService.isSystemSubject.mockReturnValue(true);

    await expect(
      service.validate(legacyAccessPayload({ sub: 'system:internal' })),
    ).rejects.toThrow('System token cannot authenticate a browser user');
    expect(userService.findForAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['inactive', { ...activeUser, isActive: false }],
  ])('rejects a %s current user', async (_case, user) => {
    userService.findForAuthentication.mockResolvedValue(user as never);

    await expect(service.validate(legacyAccessPayload())).rejects.toThrow(
      'User not found or inactive',
    );
  });

  it('rejects a user token without organization context', async () => {
    await expect(
      service.validate(
        legacyAccessPayload({
          currentOrgId: undefined,
          orgMemberships: [],
        }),
      ),
    ).rejects.toThrow('Token missing organization context');
  });

  it('uses fresh membership roles and denies removal on the next validation', async () => {
    const payload = legacyAccessPayload();
    await expect(service.validate(payload)).resolves.toMatchObject({
      orgMemberships: [
        { orgId: 'org-1', role: OrganizationRole.Owner },
        { orgId: 'org-2', role: OrganizationRole.Member },
      ],
    });
    userService.findForAuthentication.mockResolvedValue({
      ...activeUser,
      memberships: [
        {
          organizationId: 'org-1',
          role: OrganizationRole.Viewer,
          isActive: true,
        },
      ],
    });
    await expect(service.validate(payload)).resolves.toMatchObject({
      orgMemberships: [{ orgId: 'org-1', role: OrganizationRole.Viewer }],
    });
    userService.findForAuthentication.mockResolvedValue({
      ...activeUser,
      memberships: [
        {
          organizationId: 'org-1',
          role: OrganizationRole.Viewer,
          isActive: false,
        },
      ],
    });
    await expect(service.validate(payload)).rejects.toThrow('Not authorized');
    expect(userService.findForAuthentication).toHaveBeenCalledTimes(3);
  });

  it('preserves token identity fallbacks with the minimal user record', async () => {
    await expect(
      service.validate(legacyAccessPayload()),
    ).resolves.toMatchObject({
      email: activeUser.email,
      name: activeUser.name,
      isDevAdmin: false,
      devAdminMode: false,
    });
    await expect(
      service.validate(
        legacyAccessPayload({
          email: 'token@example.com',
          name: 'Token Name',
          isDevAdmin: true,
          devAdminMode: true,
        }),
      ),
    ).resolves.toMatchObject({
      email: 'token@example.com',
      name: 'Token Name',
      isDevAdmin: true,
      devAdminMode: true,
    });
  });

  it('rejects a token whose current organization is not a current membership', async () => {
    await expect(
      service.validate(
        legacyAccessPayload({ currentOrgId: 'foreign-org' as OrganizationId }),
      ),
    ).rejects.toThrow('Not authorized');
    expect(getAuthorizedOrganizationIds).toHaveBeenCalledWith([
      'org-1',
      'org-2',
    ]);
  });

  it('re-reads and denies revoked or expired current organization access', async () => {
    getAuthorizedOrganizationIds.mockResolvedValue(new Set(['org-2']));

    await expect(service.validate(legacyAccessPayload())).rejects.toThrow(
      'Not authorized',
    );
  });

  it('removes revoked or expired secondary organizations from the validated context', async () => {
    getAuthorizedOrganizationIds.mockResolvedValue(new Set(['org-1']));

    await expect(service.validate(legacyAccessPayload())).resolves.toEqual(
      expect.objectContaining({
        currentOrgId: 'org-1',
        orgMemberships: [{ orgId: 'org-1', role: OrganizationRole.Owner }],
      }),
    );
  });

  describe('demo sandbox activity', () => {
    it('records activity for a demo user without changing the validated principal', async () => {
      const plain = await service.validate(legacyAccessPayload());
      userService.findForAuthentication.mockResolvedValue({
        ...activeUser,
        isDemoUser: true,
      } as never);

      const demo = await service.validate(legacyAccessPayload());

      expect(demo).toEqual(plain);
      expect(demoSandboxActivity.recordActivity).toHaveBeenCalledTimes(1);
      expect(demoSandboxActivity.recordActivity).toHaveBeenCalledWith('user-1');
    });

    it('records nothing for an ordinary user', async () => {
      userService.findForAuthentication.mockResolvedValue({
        ...activeUser,
        isDemoUser: false,
      } as never);

      await service.validate(legacyAccessPayload());

      expect(demoSandboxActivity.recordActivity).not.toHaveBeenCalled();
    });

    it('records nothing when the demo user is not authorized', async () => {
      userService.findForAuthentication.mockResolvedValue({
        ...activeUser,
        isDemoUser: true,
      } as never);
      getAuthorizedOrganizationIds.mockResolvedValue(new Set(['org-2']));

      await expect(service.validate(legacyAccessPayload())).rejects.toThrow(
        'Not authorized',
      );

      expect(demoSandboxActivity.recordActivity).not.toHaveBeenCalled();
    });
  });
});
