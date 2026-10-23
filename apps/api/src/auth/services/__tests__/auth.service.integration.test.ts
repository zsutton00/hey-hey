import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';

import { RegisterDto } from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationService } from '../../../services/organization.service';
import { UserService } from '../../../services/user.service';
import { UserId } from '../../../types';
import { AuthService } from '../auth.service';
import { BrowserSessionService } from '../browser-session.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { JwtKeysService } from '../jwt-keys.service';

const describeDatabase =
  process.env.RUN_AUTH_DB_TESTS === '1' && process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('AuthService registration browser session handoff', () => {
  const policy = {
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  };

  let prisma: PrismaService;
  let authService: AuthService;
  let userId: UserId;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    userId = randomUUID() as UserId;
    const configService = {
      get: jest.fn((key: string) => policy[key as keyof typeof policy]),
    } as unknown as ConfigService;
    const jwtKeysService = {
      signToken: jest.fn(
        (payload: { sid?: string }) => `access-${payload.sid}`,
      ),
    } as unknown as JwtKeysService;
    const browserSessionService = new BrowserSessionService(
      configService,
      prisma,
      jwtKeysService,
      {
        assertOrganizationAuthorized: jest.fn(),
        isOrganizationAuthorized: jest.fn().mockResolvedValue(true),
      } as unknown as AccountEntitlementService,
    );

    const userService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (dto: RegisterDto) =>
        prisma.db.user.create({
          data: {
            id: userId,
            email: dto.email,
            name: dto.name,
            passwordHash: 'registration-integration-test',
          },
        }),
      ),
      updateLastLogin: jest.fn(async (id: UserId) => {
        await prisma.db.user.update({
          where: { id },
          data: { lastLoginAt: new Date() },
        });
      }),
      getUserWithOrganizations: jest.fn(async (id: UserId) => {
        const user = await prisma.db.user.findUniqueOrThrow({
          where: { id },
        });

        return {
          id: user.id as UserId,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          currentOrganizationId: null,
        };
      }),
    } as unknown as UserService;
    const organizationService = {
      getUserMemberships: jest.fn().mockResolvedValue([]),
    } as unknown as OrganizationService;

    authService = new AuthService(
      userService,
      organizationService,
      jwtKeysService,
      {} as never,
      browserSessionService,
      {} as never,
      prisma,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    if (userId) {
      await prisma.db.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('persists one registration session and renews its opaque refresh secret', async () => {
    const registration = await authService.register(
      {
        email: `${userId}@registration-session.test`,
        password: 'registration-password',
        name: 'Registration Integration User',
      },
      {
        ipAddress: '203.0.113.30',
        userAgent: 'registration-integration-test',
      },
    );

    expect(registration.response).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(registration.response)).not.toContain(
      registration.refreshSecret,
    );

    const family = await prisma.db.browserSessionFamily.findUniqueOrThrow({
      where: { id: registration.familyId },
      include: { refreshGenerations: true },
    });
    expect(family.userId).toBe(userId);
    expect(family.refreshGenerations).toHaveLength(1);
    expect(family.refreshGenerations[0]?.generation).toBe(0);
    expect(family.refreshGenerations[0]?.secretHash).toBe(
      createHash('sha256').update(registration.refreshSecret).digest('hex'),
    );
    expect(family.refreshGenerations[0]?.secretHash).not.toBe(
      registration.refreshSecret,
    );

    const renewal = await authService.refreshToken(registration.refreshSecret, {
      userAgent: 'registration-integration-test',
    });

    expect(renewal.response).not.toHaveProperty('refreshToken');
    expect(renewal.refreshSecret).not.toBe(registration.refreshSecret);
    expect(JSON.stringify(renewal.response)).not.toContain(
      renewal.refreshSecret,
    );

    const generations = await prisma.db.refreshGeneration.findMany({
      where: { browserSessionFamilyId: registration.familyId },
      orderBy: { generation: 'asc' },
    });
    expect(generations).toHaveLength(2);
    expect(generations[0]?.consumedAt).not.toBeNull();
    expect(generations[1]?.generation).toBe(1);
    expect(generations[1]?.secretHash).toBe(
      createHash('sha256').update(renewal.refreshSecret).digest('hex'),
    );
  });
});
