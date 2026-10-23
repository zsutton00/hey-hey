import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { BrowserSessionService } from '../browser-session.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { JwtKeysService } from '../jwt-keys.service';

const describeDatabase =
  process.env.RUN_BROWSER_SESSION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('BrowserSessionService database concurrency', () => {
  const policy = {
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  };

  let prisma: PrismaService;
  let service: BrowserSessionService;
  let userId: UserId;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    userId = randomUUID() as UserId;
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@browser-session.test`,
        name: 'Browser Session Integration User',
        passwordHash: 'integration-test-only',
      },
    });

    const configService = {
      get: jest.fn((key: string) => policy[key as keyof typeof policy]),
    } as unknown as ConfigService;
    const jwtKeysService = {
      signToken: jest
        .fn()
        .mockImplementation(({ sid }: { sid: string }) => `access-${sid}`),
    } as unknown as JwtKeysService;

    service = new BrowserSessionService(configService, prisma, jwtKeysService, {
      assertOrganizationAuthorized: jest.fn(),
      isOrganizationAuthorized: jest.fn().mockResolvedValue(true),
      getAuthorizedOrganizationIds: jest.fn(
        async (ids: string[]) => new Set(ids),
      ),
    } as unknown as AccountEntitlementService);
  });

  afterAll(async () => {
    if (userId) {
      await prisma.db.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('persists explicit selection and null denial through real database rotation and recovery', async () => {
    const ids = [randomUUID(), randomUUID()].sort() as OrganizationId[];
    const now = new Date();
    try {
      for (const id of ids) {
        await prisma.db.organization.create({
          data: {
            id,
            name: 'Browser selection test',
            slug: `browser-selection-${id}`,
          },
        });
        await prisma.db.organizationMember.create({
          data: { userId, organizationId: id },
        });
      }
      const established = await service.establish(
        {
          userId,
          user: {
            id: userId,
            name: 'Browser Session Integration User',
            email: `${userId}@browser-session.test`,
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            currentOrganizationId: ids[0],
          },
          claims: {
            email: `${userId}@browser-session.test`,
            name: 'Browser Session Integration User',
            orgMemberships: ids.map((orgId) => ({ orgId, role: 'MEMBER' })),
          },
        },
        {},
      );
      expect(established.response).toHaveProperty(
        'status',
        'selection_required',
      );
      let secret = established.refreshSecret;
      const rotate = async (requestedOrganizationId?: OrganizationId) => {
        const result = await service.refresh({
          presentedSecret: secret,
          requestMetadata: {},
          requestedOrganizationId,
        });
        if (result.status !== 'rotated')
          throw new Error(`Expected rotation, received ${result.status}`);
        secret = result.refreshSecret;
        return result.response;
      };
      expect((await rotate(ids[1])).user.currentOrganizationId).toBe(ids[1]);
      await prisma.db.user.update({
        where: { id: userId },
        data: { defaultOrganizationId: ids[0] },
      });
      expect((await rotate()).user.currentOrganizationId).toBe(ids[1]);
      expect(
        (await prisma.db.user.findUniqueOrThrow({ where: { id: userId } }))
          .defaultOrganizationId,
      ).toBe(ids[0]);
      const fresh = await service.establish(
        {
          userId,
          user: {
            id: userId,
            name: 'Browser Session Integration User',
            email: `${userId}@browser-session.test`,
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            currentOrganizationId: null,
          },
          claims: {
            orgMemberships: ids.map((orgId) => ({ orgId, role: 'MEMBER' })),
          },
        },
        {},
      );
      expect(fresh.response.user.currentOrganizationId).toBe(ids[0]);
      expect(fresh.response).toHaveProperty('accessToken');
      await prisma.db.organizationMember.deleteMany({
        where: { userId, organizationId: ids[1] },
      });
      const denied = await rotate();
      expect(denied).toHaveProperty('status', 'selection_denied');
      expect(denied).not.toHaveProperty('accessToken');
      const family = await prisma.db.browserSessionFamily.findUniqueOrThrow({
        where: { id: established.familyId },
      });
      expect(family.currentOrganizationId).toBeNull();
      expect(family.revokedAt).toBeNull();
      expect((await rotate(ids[0])).user.currentOrganizationId).toBe(ids[0]);
    } finally {
      await prisma.db.user.update({
        where: { id: userId },
        data: { defaultOrganizationId: null },
      });
      await prisma.db.organization.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it.each([
    ['inactivity', 'inactivityExpiresAt', 'revoked'],
    ['absolute', 'absoluteExpiresAt', 'absolutely_expired'],
  ] as const)(
    'rejects rotation when a row-lock waiter crosses the %s deadline',
    async (_deadline, deadlineField, expectedStatus) => {
      const now = new Date();
      const established = await service.establish(
        {
          userId,
          user: {
            id: userId,
            email: `${userId}@browser-session.test`,
            name: 'Browser Session Integration User',
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            currentOrganizationId: null,
          },
          claims: {
            email: `${userId}@browser-session.test`,
            name: 'Browser Session Integration User',
            orgMemberships: [],
            isDevAdmin: false,
            devAdminMode: false,
          },
        },
        {},
      );
      const generation = await prisma.db.refreshGeneration.findFirstOrThrow({
        where: { browserSessionFamilyId: established.familyId },
      });
      const deadline = new Date(Date.now() + 150);
      await prisma.db.browserSessionFamily.update({
        where: { id: established.familyId },
        data: {
          inactivityExpiresAt:
            deadlineField === 'absoluteExpiresAt'
              ? deadline
              : new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 60_000),
          [deadlineField]: deadline,
        },
      });

      let releaseLock!: () => void;
      const holdLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let signalLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const blocker = prisma.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT generation."id"
          FROM "refresh_generations" AS generation
          INNER JOIN "browser_session_families" AS family
            ON family."id" = generation."browser_session_family_id"
          WHERE generation."id" = ${generation.id}
          FOR UPDATE OF generation, family
        `;
        signalLocked();
        await holdLock;
      });

      await locked;
      const rotation = service.refresh({
        presentedSecret: established.refreshSecret,
        requestMetadata: {},
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseLock();
      await blocker;

      await expect(rotation).resolves.toMatchObject({ status: expectedStatus });
      await expect(
        prisma.db.refreshGeneration.count({
          where: { browserSessionFamilyId: established.familyId },
        }),
      ).resolves.toBe(1);
    },
  );

  it('allows one concurrent rotation winner and revokes the family on stale use', async () => {
    const now = new Date();
    const established = await service.establish(
      {
        userId,
        user: {
          id: userId,
          email: `${userId}@browser-session.test`,
          name: 'Browser Session Integration User',
          isActive: true,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          currentOrganizationId: null,
        },
        claims: {
          email: `${userId}@browser-session.test`,
          name: 'Browser Session Integration User',
          orgMemberships: [],
          isDevAdmin: false,
          devAdminMode: false,
        },
      },
      { ipAddress: '203.0.113.20', userAgent: 'integration-test' },
    );

    const results = await Promise.all([
      service.refresh({
        presentedSecret: established.refreshSecret,
        requestMetadata: { ipAddress: '203.0.113.20' },
      }),
      service.refresh({
        presentedSecret: established.refreshSecret,
        requestMetadata: { ipAddress: '203.0.113.21' },
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'rotated'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'replay_detected'),
    ).toHaveLength(1);

    const family = await prisma.db.browserSessionFamily.findUnique({
      where: { id: established.familyId },
      include: { refreshGenerations: true },
    });
    expect(family?.revokedAt).not.toBeNull();
    expect(family?.revocationReason).toBe('refresh_replay');
    expect(family?.refreshGenerations).toHaveLength(2);
    expect(
      family?.refreshGenerations.filter(
        (generation) => generation.consumedAt === null,
      ),
    ).toHaveLength(1);

    const winner = results.find((result) => result.status === 'rotated');
    if (!winner || winner.status !== 'rotated') {
      throw new Error('Expected one concurrent rotation winner');
    }

    await expect(
      service.refresh({
        presentedSecret: winner.refreshSecret,
        requestMetadata: {},
      }),
    ).resolves.toEqual({ status: 'revoked' });
  });
});
