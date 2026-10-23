import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { BrowserSessionService } from '../browser-session.service';
import { JwtKeysService } from '../jwt-keys.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';

describe('BrowserSessionService', () => {
  const policy = {
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  };
  const principal = {
    userId: 'user-1' as UserId,
    user: {
      id: 'user-1' as UserId,
      email: 'user@example.com',
      name: 'Browser User',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      currentOrganizationId: 'org-1' as OrganizationId,
    },
    claims: {
      email: 'user@example.com',
      name: 'Browser User',
      currentOrgId: 'org-1' as OrganizationId,
      orgMemberships: [{ orgId: 'org-1', role: 'MEMBER' as const }],
      isDevAdmin: false,
      devAdminMode: false,
    },
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (
    configOverrides: Record<string, string | undefined> = {},
  ) => {
    const familyCreate = jest.fn().mockResolvedValue({ id: 'family-row-1' });
    const familyUpdate = jest.fn().mockResolvedValue({ id: 'family-row-1' });
    const generationCreate = jest.fn().mockResolvedValue({
      id: 'generation-row-1',
    });
    const generationUpdate = jest
      .fn()
      .mockResolvedValue({ id: 'generation-row-1' });
    const queryRaw = jest.fn(
      async (query: TemplateStringsArray): Promise<unknown[]> =>
        query.join('').includes('clock_timestamp')
          ? [{ decisionAt: new Date() }]
          : [],
    );
    const userFindUnique = jest.fn();
    const userFindUniqueOrThrow = jest.fn().mockResolvedValue({
      defaultOrganizationId: null,
      isActive: true,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });
    const userUpdate = jest.fn().mockResolvedValue({});
    const transactionClient = {
      browserSessionFamily: { create: familyCreate, update: familyUpdate },
      refreshGeneration: {
        create: generationCreate,
        update: generationUpdate,
      },
      $queryRaw: queryRaw,
      user: {
        findUnique: userFindUnique,
        findUniqueOrThrow: userFindUniqueOrThrow,
        update: userUpdate,
      },
      organization: {
        findMany: jest.fn(
          async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.map((id) => ({ id, name: id + ' name' })),
        ),
      },
    };
    let committed = false;
    const transaction = jest.fn(
      async (callback: (tx: typeof transactionClient) => unknown) => {
        const result = await callback(transactionClient);
        committed = true;
        return result;
      },
    );
    const prisma = {
      db: { $transaction: transaction },
    } as unknown as PrismaService;
    const signToken = jest.fn().mockReturnValue('signed-access-token');
    const verifyToken = jest.fn();
    const jwtKeysService = {
      signToken,
      verifyToken,
    } as unknown as JwtKeysService;
    const invalidateSession = jest.fn(() => {
      expect(committed).toBe(true);
    });
    const moduleRef = {
      get: jest.fn().mockReturnValue({ invalidateSession }),
    };
    const values = { ...policy, ...configOverrides };
    const configService = {
      get: jest.fn((key: string) => values[key as keyof typeof values]),
    } as unknown as ConfigService;
    const accountEntitlementService = {
      assertOrganizationAuthorized: jest.fn().mockResolvedValue(undefined),
      isOrganizationAuthorized: jest.fn().mockResolvedValue(true),
      getAuthorizedOrganizationIds: jest.fn(
        async (organizationIds: string[]) => new Set(organizationIds),
      ),
    } as unknown as AccountEntitlementService;

    return {
      service: new BrowserSessionService(
        configService,
        prisma,
        jwtKeysService,
        accountEntitlementService,
        moduleRef as never,
      ),
      familyCreate,
      familyUpdate,
      generationCreate,
      generationUpdate,
      queryRaw,
      userFindUnique,
      userFindUniqueOrThrow,
      userUpdate,
      signToken,
      verifyToken,
      transaction,
      invalidateSession,
      accountEntitlementService,
    };
  };

  it('fresh sign-in authorizes the exact saved default and issues browser access', async () => {
    const harness = createHarness();
    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: 'org-1',
      isActive: true,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });
    const result = await harness.service.establish(principal, {});
    expect(result.response).toMatchObject({
      accessToken: 'signed-access-token',
      user: { currentOrganizationId: 'org-1' },
    });
    expect(harness.signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        token_use: 'access',
        sid: result.sessionId,
        currentOrgId: 'org-1',
      }),
      expect.anything(),
    );
    expect(harness.userUpdate).not.toHaveBeenCalled();
  });

  it('denies an inaccessible default without substituting the sole membership', async () => {
    const harness = createHarness();
    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: 'revoked-org',
      isActive: true,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });
    const result = await harness.service.establish(principal, {});
    expect(result.response).toMatchObject({
      status: 'selection_denied',
      user: { currentOrganizationId: null },
    });
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('checks current membership at establishment even when earlier identity proof included the saved organization', async () => {
    const harness = createHarness();
    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: 'org-1',
      isActive: true,
      memberships: [],
    });
    const result = await harness.service.establish(principal, {});
    expect(result.response).toMatchObject({
      status: 'selection_denied',
      user: { currentOrganizationId: null },
    });
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('saves only the exact confirmed and currently authorized choice', async () => {
    const harness = createHarness();
    harness.verifyToken.mockReturnValue({
      sub: 'user-1',
      token_use: 'access',
      sid: 'session-1',
      currentOrgId: 'org-1',
      exp: 4070908800,
    });
    harness.queryRaw.mockImplementation(async (query) =>
      query.join('').includes('clock_timestamp')
        ? [{ decisionAt: new Date() }]
        : [
            {
              currentOrganizationId: 'org-1',
              revokedAt: null,
              inactivityExpiresAt: new Date('2099-01-01'),
              absoluteExpiresAt: new Date('2099-01-01'),
            },
          ],
    );
    harness.userFindUniqueOrThrow.mockResolvedValue({
      isActive: true,
      defaultOrganizationId: null,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });
    await expect(
      harness.service.accountDefaultOrganization(
        'token',
        'org-2' as OrganizationId,
      ),
    ).rejects.toThrow('Default must match');
    expect(harness.userUpdate).not.toHaveBeenCalled();
    await expect(
      harness.service.accountDefaultOrganization(
        'token',
        'org-1' as OrganizationId,
      ),
    ).resolves.toEqual({ organizationId: 'org-1' });
    expect(harness.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { defaultOrganizationId: 'org-1' },
    });
    expect(harness.familyUpdate).not.toHaveBeenCalled();
  });

  it('rejects preference writes after session revocation or membership removal', async () => {
    const harness = createHarness();
    harness.verifyToken.mockReturnValue({
      sub: 'user-1',
      token_use: 'access',
      sid: 'session-1',
      currentOrgId: 'org-1',
      exp: 4070908800,
    });
    await expect(
      harness.service.accountDefaultOrganization(
        'token',
        'org-1' as OrganizationId,
      ),
    ).rejects.toThrow('Browser session choice');
    harness.queryRaw.mockImplementation(async (query) =>
      query.join('').includes('clock_timestamp')
        ? [{ decisionAt: new Date() }]
        : [
            {
              currentOrganizationId: 'org-1',
              revokedAt: null,
              inactivityExpiresAt: new Date('2099-01-01'),
              absoluteExpiresAt: new Date('2099-01-01'),
            },
          ],
    );
    harness.userFindUniqueOrThrow.mockResolvedValue({
      isActive: true,
      defaultOrganizationId: null,
      memberships: [],
    });
    await expect(
      harness.service.accountDefaultOrganization(
        'token',
        'org-1' as OrganizationId,
      ),
    ).rejects.toThrow('Default must match');
    expect(harness.userUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { revokedAt: new Date('2020-01-01') },
    { inactivityExpiresAt: new Date('2020-01-01') },
    { absoluteExpiresAt: new Date('2020-01-01') },
    { currentOrganizationId: 'other-organization' },
  ])(
    'rejects a no-longer-valid browser session before writing its default: %p',
    async (overrides) => {
      const harness = createHarness();
      harness.verifyToken.mockReturnValue({
        sub: 'user-1',
        token_use: 'access',
        sid: 'session-1',
        currentOrgId: 'org-1',
        exp: 4070908800,
      });
      harness.queryRaw.mockImplementation(async (query) =>
        query.join('').includes('clock_timestamp')
          ? [{ decisionAt: new Date() }]
          : [
              {
                currentOrganizationId: 'org-1',
                revokedAt: null,
                inactivityExpiresAt: new Date('2099-01-01'),
                absoluteExpiresAt: new Date('2099-01-01'),
                ...overrides,
              },
            ],
      );
      await expect(
        harness.service.accountDefaultOrganization(
          'token',
          'org-1' as OrganizationId,
        ),
      ).rejects.toThrow('Browser session choice');
      expect(harness.userUpdate).not.toHaveBeenCalled();
    },
  );

  it('creates exactly one family and generation zero and returns no refresh material in JSON', async () => {
    const harness = createHarness();
    const result = await harness.service.establish(principal, {
      ipAddress: `  ${'1'.repeat(60)}  `,
      userAgent: `  ${'a'.repeat(600)}  `,
    });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.familyCreate).toHaveBeenCalledTimes(1);
    expect(harness.generationCreate).toHaveBeenCalledTimes(1);

    const familyData = harness.familyCreate.mock.calls[0][0].data;
    expect(familyData).toEqual(
      expect.objectContaining({
        userId: principal.userId,
        createdIpAddress: '1'.repeat(45),
        lastUsedIpAddress: '1'.repeat(45),
        createdUserAgent: 'a'.repeat(512),
        lastUsedUserAgent: 'a'.repeat(512),
        currentOrganizationId: 'org-1',
      }),
    );
    expect(
      familyData.inactivityExpiresAt.getTime() - familyData.createdAt.getTime(),
    ).toBe(604800000);
    expect(
      familyData.absoluteExpiresAt.getTime() - familyData.createdAt.getTime(),
    ).toBe(2592000000);

    const generationData = harness.generationCreate.mock.calls[0][0].data;
    expect(generationData.generation).toBe(0);
    expect(generationData.secretHash).toBe(
      createHash('sha256').update(result.refreshSecret).digest('hex'),
    );
    expect(generationData.secretHash).not.toBe(result.refreshSecret);

    expect(harness.signToken).toHaveBeenCalledWith(
      expect.objectContaining({ currentOrgId: 'org-1' }),
      expect.anything(),
    );
    expect(result.response).toMatchObject({
      accessToken: 'signed-access-token',
      user: { currentOrganizationId: 'org-1' },
    });
    expect(JSON.stringify(result.response)).not.toContain(result.refreshSecret);
    expect(JSON.stringify(result.response)).not.toContain(
      generationData.secretHash,
    );
  });

  it('preserves browser identity without access when no organizations are authorized', async () => {
    const harness = createHarness();
    (
      harness.accountEntitlementService
        .getAuthorizedOrganizationIds as jest.Mock
    ).mockResolvedValue(new Set());
    const result = await harness.service.establish(principal, {});
    expect(result.response).toMatchObject({
      status: 'selection_required',
      organizations: [],
      user: { currentOrganizationId: null },
    });
    expect(harness.familyCreate).toHaveBeenCalled();
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('selects the sole accessible organization after entitlement filtering', async () => {
    const harness = createHarness();
    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: null,
      isActive: true,
      memberships: [
        { organizationId: 'org-a', role: 'MEMBER' },
        { organizationId: 'org-z', role: 'ADMIN' },
      ],
    });
    (
      harness.accountEntitlementService
        .getAuthorizedOrganizationIds as jest.Mock
    ).mockResolvedValue(new Set(['org-z']));

    const result = await harness.service.establish(principal, {});

    expect(harness.familyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentOrganizationId: 'org-z' }),
    });
    expect(result.response).toMatchObject({
      accessToken: 'signed-access-token',
      user: { currentOrganizationId: 'org-z' },
    });
    expect(harness.signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        currentOrgId: 'org-z',
        orgMemberships: [{ orgId: 'org-z', role: 'ADMIN' }],
      }),
      expect.anything(),
    );
    expect(harness.userUpdate).not.toHaveBeenCalled();
  });

  it('establishes an organizationless session without inventing an entitlement decision', async () => {
    const harness = createHarness();
    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: null,
      isActive: true,
      memberships: [],
    });

    await expect(
      harness.service.establish(
        {
          ...principal,
          user: { ...principal.user, currentOrganizationId: null },
          claims: {
            ...principal.claims,
            orgMemberships: [],
          },
        },
        {},
      ),
    ).resolves.toEqual(
      expect.objectContaining({ refreshSecret: expect.any(String) }),
    );
    expect(
      harness.accountEntitlementService.getAuthorizedOrganizationIds,
    ).not.toHaveBeenCalled();
    expect(harness.familyCreate).toHaveBeenCalledTimes(1);
    expect(harness.generationCreate).toHaveBeenCalledTimes(1);
  });

  it('requires explicit selection when multiple organizations remain authorized', async () => {
    const harness = createHarness();
    (
      harness.accountEntitlementService
        .getAuthorizedOrganizationIds as jest.Mock
    ).mockResolvedValue(new Set(['org-a', 'org-z']));
    const multiOrganizationPrincipal = {
      ...principal,
      user: {
        ...principal.user,
        currentOrganizationId: 'org-z' as OrganizationId,
      },
      claims: {
        ...principal.claims,
        currentOrgId: 'org-z' as OrganizationId,
        orgMemberships: [
          { orgId: 'org-z', role: 'MEMBER' as const },
          { orgId: 'org-a', role: 'ADMIN' as const },
        ],
      },
    };

    harness.userFindUniqueOrThrow.mockResolvedValue({
      defaultOrganizationId: null,
      isActive: true,
      memberships: [
        { organizationId: 'org-z', role: 'MEMBER' },
        { organizationId: 'org-a', role: 'ADMIN' },
      ],
    });
    const result = await harness.service.establish(
      multiOrganizationPrincipal,
      {},
    );

    expect(result.response).toMatchObject({
      status: 'selection_required',
      user: { currentOrganizationId: null },
      organizations: [
        { id: 'org-a', name: 'org-a name' },
        { id: 'org-z', name: 'org-z name' },
      ],
    });
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('rotates one presented generation and returns a hashed replacement only outside the response DTO', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        generationId: 'generation-row-1',
        generation: 0,
        consumedAt: null,
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        userId: principal.userId,
        inactivityExpiresAt: new Date('2026-01-08T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-01-31T00:00:00.000Z'),
        revokedAt: null,
        userIsActive: true,
        currentOrganizationId: 'org-1',
      },
    ]);
    harness.userFindUnique.mockResolvedValueOnce({
      id: principal.userId,
      email: principal.user.email,
      name: principal.user.name,
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });

    const result = await harness.service.refresh({
      presentedSecret: 'presented-refresh-secret',
      requestMetadata: {
        ipAddress: '203.0.113.5',
        userAgent: 'browser/1.0',
      },
    });

    expect(result.status).toBe('rotated');
    if (result.status !== 'rotated') {
      throw new Error('Expected a rotated browser session');
    }
    expect(harness.queryRaw).toHaveBeenCalledTimes(2);
    expect(harness.generationUpdate).toHaveBeenCalledWith({
      where: { id: 'generation-row-1' },
      data: { consumedAt: now },
    });
    expect(harness.generationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        browserSessionFamilyId: 'family-row-1',
        generation: 1,
        issuedAt: now,
      }),
    });
    const replacementHash =
      harness.generationCreate.mock.calls[0][0].data.secretHash;
    expect(replacementHash).toBe(
      createHash('sha256').update(result.refreshSecret).digest('hex'),
    );
    expect(replacementHash).not.toBe(result.refreshSecret);
    expect(harness.familyUpdate).toHaveBeenCalledWith({
      where: { id: 'family-row-1' },
      data: expect.objectContaining({
        lastUsedAt: now,
        inactivityExpiresAt: new Date('2026-01-08T00:00:00.000Z'),
        lastUsedIpAddress: '203.0.113.5',
        lastUsedUserAgent: 'browser/1.0',
      }),
    });
    expect(harness.signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: principal.userId,
        token_use: 'access',
        sid: 'session-1',
      }),
      expect.objectContaining({ expiresIn: 900 }),
    );
    expect(result.response).toEqual({
      user: expect.objectContaining({ id: principal.userId }),
      accessToken: 'signed-access-token',
      expiresIn: 900,
    });
    expect(JSON.stringify(result.response)).not.toContain(
      'presented-refresh-secret',
    );
    expect(JSON.stringify(result.response)).not.toContain(replacementHash);
  });

  it('keeps refresh rotation alive when one organization is denied and another remains authorized', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        generationId: 'generation-row-1',
        generation: 0,
        consumedAt: null,
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        userId: principal.userId,
        inactivityExpiresAt: new Date('2026-01-08T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-01-31T00:00:00.000Z'),
        revokedAt: null,
        userIsActive: true,
        currentOrganizationId: 'org-1',
      },
    ]);
    harness.userFindUnique.mockResolvedValueOnce({
      id: principal.userId,
      email: principal.user.email,
      name: principal.user.name,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [
        { organizationId: 'org-z', role: 'MEMBER' },
        { organizationId: 'org-a', role: 'ADMIN' },
      ],
    });
    (
      harness.accountEntitlementService
        .getAuthorizedOrganizationIds as jest.Mock
    ).mockResolvedValue(new Set(['org-a']));

    const result = await harness.service.refresh({
      presentedSecret: 'presented-refresh-secret',
      requestMetadata: {},
    });

    expect(result.status).toBe('rotated');
    if (result.status !== 'rotated') throw new Error('Expected rotation');
    expect(result.response).toMatchObject({
      status: 'selection_denied',
      user: { currentOrganizationId: null },
      organizations: [{ id: 'org-a', name: 'org-a name' }],
    });
    expect(harness.familyUpdate).toHaveBeenCalledWith({
      where: { id: 'family-row-1' },
      data: expect.objectContaining({ currentOrganizationId: null }),
    });
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('retains identity and rotates without scoped access when all organization access is denied', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        generationId: 'generation-row-1',
        generation: 0,
        consumedAt: null,
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        userId: principal.userId,
        inactivityExpiresAt: new Date('2026-01-08T00:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-01-31T00:00:00.000Z'),
        revokedAt: null,
        userIsActive: true,
        currentOrganizationId: 'org-1',
      },
    ]);
    harness.userFindUnique.mockResolvedValueOnce({
      id: principal.userId,
      email: principal.user.email,
      name: principal.user.name,
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });
    (
      harness.accountEntitlementService
        .getAuthorizedOrganizationIds as jest.Mock
    ).mockResolvedValue(new Set());

    await expect(
      harness.service.refresh({
        presentedSecret: 'presented-refresh-secret',
        requestMetadata: {},
      }),
    ).resolves.toMatchObject({
      status: 'rotated',
      response: {
        status: 'selection_denied',
        organizations: [],
        user: { currentOrganizationId: null },
      },
    });
    expect(harness.familyUpdate).toHaveBeenCalledWith({
      where: { id: 'family-row-1' },
      data: expect.objectContaining({ currentOrganizationId: null }),
    });
    expect(harness.generationUpdate).toHaveBeenCalled();
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it('caps a sliding inactivity deadline at the fixed absolute deadline', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const harness = createHarness();
    const absoluteExpiresAt = new Date('2026-01-01T00:01:00.000Z');
    harness.queryRaw.mockResolvedValueOnce([
      {
        generationId: 'generation-row-1',
        generation: 4,
        consumedAt: null,
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        userId: principal.userId,
        inactivityExpiresAt: new Date('2026-01-01T00:00:30.000Z'),
        absoluteExpiresAt,
        revokedAt: null,
        userIsActive: true,
        currentOrganizationId: 'org-1',
      },
    ]);
    harness.userFindUnique.mockResolvedValueOnce({
      id: principal.userId,
      email: principal.user.email,
      name: principal.user.name,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
    });

    const result = await harness.service.refresh({
      presentedSecret: 'presented-refresh-secret',
      requestMetadata: {},
    });

    expect(result.status).toBe('rotated');
    const updatedExpiry = harness.familyUpdate.mock.calls[0][0].data
      .inactivityExpiresAt as Date;
    expect(updatedExpiry).toEqual(absoluteExpiresAt);
    expect(updatedExpiry.getTime() - now.getTime()).toBeLessThanOrEqual(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(updatedExpiry.getTime()).toBeLessThanOrEqual(
      absoluteExpiresAt.getTime(),
    );
  });

  it.each([
    ['absolute', 'absoluteExpiresAt', 'absolutely_expired'],
    ['inactivity', 'inactivityExpiresAt', 'revoked'],
  ] as const)(
    'uses the post-lock database timestamp when the %s deadline passes while waiting',
    async (_deadline, deadlineField, expectedStatus) => {
      const requestStartedAt = new Date('2026-01-01T00:00:00.000Z');
      const expiresAt = new Date('2026-01-01T00:00:01.000Z');
      const decisionAt = new Date('2026-01-01T00:00:02.000Z');
      jest.useFakeTimers().setSystemTime(requestStartedAt);
      const harness = createHarness();
      harness.queryRaw
        .mockResolvedValueOnce([
          {
            generationId: 'generation-row-1',
            generation: 0,
            consumedAt: null,
            familyRowId: 'family-row-1',
            familyId: 'family-1',
            sessionId: 'session-1',
            userId: principal.userId,
            inactivityExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
            absoluteExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
            revokedAt: null,
            userIsActive: true,
            currentOrganizationId: 'org-1',
            [deadlineField]: expiresAt,
          },
        ])
        .mockResolvedValueOnce([{ decisionAt }]);

      await expect(
        harness.service.refresh({
          presentedSecret: 'presented-refresh-secret',
          requestMetadata: {},
        }),
      ).resolves.toMatchObject({ status: expectedStatus });

      expect(harness.familyUpdate).toHaveBeenCalledWith({
        where: { id: 'family-row-1' },
        data: {
          revokedAt: decisionAt,
          revocationReason:
            deadlineField === 'absoluteExpiresAt'
              ? 'absolute_expired'
              : 'inactivity_expired',
        },
      });
      expect(harness.generationUpdate).not.toHaveBeenCalled();
      expect(harness.generationCreate).not.toHaveBeenCalled();
    },
  );

  it('revokes a family on replay and invalidates the matching browser session only after commit', async () => {
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        generationId: 'generation-row-1',
        generation: 0,
        consumedAt: new Date('2026-01-01T00:00:00.000Z'),
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        userId: principal.userId,
        inactivityExpiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        userIsActive: true,
        currentOrganizationId: 'org-1',
      },
    ]);

    const result = await harness.service.refresh({
      presentedSecret: 'stale-refresh-secret',
      requestMetadata: {},
    });

    expect(result).toMatchObject({
      status: 'replay_detected',
      sessionId: 'session-1',
      familyId: 'family-1',
    });
    expect(harness.familyUpdate).toHaveBeenCalledWith({
      where: { id: 'family-row-1' },
      data: {
        revokedAt: expect.any(Date),
        revocationReason: 'refresh_replay',
      },
    });
    expect(harness.invalidateSession).toHaveBeenCalledWith('session-1');
    expect(harness.generationCreate).not.toHaveBeenCalled();
  });

  it('logs out a known refresh family and invalidates only its browser session after commit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        revokedAt: null,
      },
    ]);

    const result = await harness.service.logout({
      presentedRefreshSecret: 'refresh-secret',
      accessToken: 'expired-access-token',
      requestMetadata: {},
    });

    expect(result).toEqual({
      revokedFamilyIds: ['family-1'],
      revokedSessionIds: ['session-1'],
    });
    expect(harness.familyUpdate).toHaveBeenCalledWith({
      where: { id: 'family-row-1' },
      data: {
        revokedAt: new Date('2026-07-31T12:00:00.000Z'),
        revocationReason: 'logout',
      },
    });
    expect(harness.invalidateSession).toHaveBeenCalledWith('session-1');
    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to a currently valid access-session binding when the refresh secret is unknown', async () => {
    const harness = createHarness();
    harness.verifyToken.mockReturnValue({
      sub: principal.userId,
      sid: 'session-1',
      token_use: 'access',
    });
    harness.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        revokedAt: null,
      },
    ]);

    const result = await harness.service.logout({
      presentedRefreshSecret: 'unknown-refresh-secret',
      accessToken: 'valid-access-token',
      requestMetadata: {},
    });

    expect(harness.verifyToken).toHaveBeenCalledWith('valid-access-token');
    expect(harness.queryRaw).toHaveBeenCalledTimes(2);
    expect(result.revokedSessionIds).toEqual(['session-1']);
    expect(harness.invalidateSession).toHaveBeenCalledWith('session-1');
  });

  it('succeeds without mutation for absent or invalid context', async () => {
    const harness = createHarness();
    harness.verifyToken.mockImplementation(() => {
      throw new Error('expired');
    });

    await expect(
      harness.service.logout({
        accessToken: 'expired-access-token',
        requestMetadata: {},
      }),
    ).resolves.toEqual({
      revokedFamilyIds: [],
      revokedSessionIds: [],
    });
    expect(harness.familyUpdate).not.toHaveBeenCalled();
    expect(harness.invalidateSession).not.toHaveBeenCalled();
  });

  it('keeps repeated logout idempotent for an already-revoked family', async () => {
    const harness = createHarness();
    harness.queryRaw.mockResolvedValueOnce([
      {
        familyRowId: 'family-row-1',
        familyId: 'family-1',
        sessionId: 'session-1',
        revokedAt: new Date(),
      },
    ]);

    await expect(
      harness.service.logout({
        presentedRefreshSecret: 'refresh-secret',
        requestMetadata: {},
      }),
    ).resolves.toEqual({
      revokedFamilyIds: [],
      revokedSessionIds: [],
    });
    expect(harness.familyUpdate).not.toHaveBeenCalled();
    expect(harness.invalidateSession).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown secret', [], 'not_found'],
    [
      'revoked family',
      [{ consumedAt: null, revokedAt: new Date(), userIsActive: true }],
      'revoked',
    ],
    [
      'inactive user',
      [{ consumedAt: null, revokedAt: null, userIsActive: false }],
      'inactive',
    ],
    [
      'absolute expiry',
      [
        {
          consumedAt: null,
          revokedAt: null,
          userIsActive: true,
          currentOrganizationId: 'org-1',
          absoluteExpiresAt: new Date(Date.now() - 1),
        },
      ],
      'absolutely_expired',
    ],
    [
      'inactivity expiry',
      [
        {
          consumedAt: null,
          revokedAt: null,
          userIsActive: true,
          currentOrganizationId: 'org-1',
          inactivityExpiresAt: new Date(Date.now() - 1),
        },
      ],
      'revoked',
    ],
  ] as const)(
    'returns the internal status for %s without issuing access',
    async (_name, rows, status) => {
      const harness = createHarness();
      if (rows.length > 0) {
        harness.queryRaw.mockResolvedValueOnce([
          {
            generationId: 'generation-row-1',
            generation: 0,
            consumedAt: null,
            familyRowId: 'family-row-1',
            familyId: 'family-1',
            sessionId: 'session-1',
            userId: principal.userId,
            inactivityExpiresAt: new Date(Date.now() + 60_000),
            absoluteExpiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            ...rows[0],
          },
        ]);
      }

      const result = await harness.service.refresh({
        presentedSecret: 'invalid-or-stale-secret',
        requestMetadata: {},
      });

      expect(result.status).toBe(status);
      expect(harness.signToken).not.toHaveBeenCalled();

      if (status === 'revoked' && rows[0] && 'inactivityExpiresAt' in rows[0]) {
        expect(harness.familyUpdate).toHaveBeenCalledWith({
          where: { id: 'family-row-1' },
          data: {
            revokedAt: expect.any(Date),
            revocationReason: 'inactivity_expired',
          },
        });
      }
    },
  );

  it.each([
    [
      'missing access lifetime',
      { BROWSER_ACCESS_TOKEN_TTL_SECONDS: undefined },
    ],
    ['invalid access lifetime', { BROWSER_ACCESS_TOKEN_TTL_SECONDS: '0' }],
    ['wrong access policy', { BROWSER_ACCESS_TOKEN_TTL_SECONDS: '901' }],
    [
      'wrong inactivity policy',
      { BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604799' },
    ],
    [
      'wrong absolute policy',
      { BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2591999' },
    ],
  ])('fails fast for %s', (_case, overrides) => {
    expect(() => createHarness(overrides)).toThrow();
  });

  it('rejects missing persisted principal context before opening a transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.establish({ ...principal, userId: '' as UserId }, {}),
    ).rejects.toThrow('Browser session principal is missing a user ID');
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it('does not issue a credential when the family insert fails', async () => {
    const harness = createHarness();
    harness.familyCreate.mockRejectedValueOnce(new Error('insert failed'));

    await expect(harness.service.establish(principal, {})).rejects.toThrow(
      'insert failed',
    );
    expect(harness.generationCreate).not.toHaveBeenCalled();
    expect(harness.signToken).not.toHaveBeenCalled();
  });

  it.each([
    [null, undefined, 'selection_required', null],
    ['org-z', undefined, 'selected', 'org-z'],
    ['org-revoked', undefined, 'selection_denied', null],
    ['org-z', 'org-a', 'selected', 'org-a'],
    ['org-z', 'org-denied', 'selection_denied', null],
    [null, 'org-z', 'selected', 'org-z'],
  ] as const)(
    'authorizes stored %s or explicit %s exactly',
    async (stored, requested, status, selected) => {
      const harness = createHarness();
      const now = new Date();
      harness.queryRaw.mockResolvedValueOnce([
        {
          generationId: 'generation-row-1',
          generation: 0,
          consumedAt: null,
          familyRowId: 'family-row-1',
          familyId: 'family-1',
          sessionId: 'session-1',
          userId: principal.userId,
          userIsActive: true,
          revokedAt: null,
          currentOrganizationId: stored,
          inactivityExpiresAt: new Date(now.getTime() + 60000),
          absoluteExpiresAt: new Date(now.getTime() + 60000),
        },
      ]);
      harness.userFindUnique.mockResolvedValueOnce({
        ...principal.user,
        createdAt: now,
        updatedAt: now,
        memberships: [
          { organizationId: 'org-a', role: 'MEMBER' },
          { organizationId: 'org-z', role: 'ADMIN' },
        ],
      });
      const result = await harness.service.refresh({
        presentedSecret: 'secret',
        requestMetadata: {},
        requestedOrganizationId: requested as OrganizationId | undefined,
      });
      expect(result.status).toBe('rotated');
      if (result.status !== 'rotated') throw new Error('Expected rotation');
      expect(result.response.user.currentOrganizationId).toBe(selected);
      expect(harness.familyUpdate).toHaveBeenCalledWith({
        where: { id: 'family-row-1' },
        data: expect.objectContaining({ currentOrganizationId: selected }),
      });
      if (status === 'selected') {
        expect(harness.signToken).toHaveBeenCalledWith(
          expect.objectContaining({ currentOrgId: selected, sid: 'session-1' }),
          expect.any(Object),
        );
        expect(result.response).toHaveProperty('accessToken');
      } else {
        expect(result.response).toHaveProperty('status', status);
        expect(result.response).not.toHaveProperty('accessToken');
        expect(harness.signToken).not.toHaveBeenCalled();
      }
      expect(harness.generationUpdate).toHaveBeenCalled();
      expect(harness.generationCreate).toHaveBeenCalled();
    },
  );
});
