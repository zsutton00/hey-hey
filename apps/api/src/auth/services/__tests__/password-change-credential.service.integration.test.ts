import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationService } from '../../../services/organization.service';
import { UserService } from '../../../services/user.service';
import { UserId } from '../../../types';
import { BrowserSessionService } from '../browser-session.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { JwtKeysService } from '../jwt-keys.service';
import { PasswordChangeCredentialService } from '../password-change-credential.service';
import { PasswordChangeCredentialKind } from '../../password-change-credential.types';

const describeDatabase =
  process.env.RUN_PASSWORD_CHANGE_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('PasswordChangeCredentialService database concurrency', () => {
  const policy = {
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
    PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
  };

  let prisma: PrismaService;
  let service: PasswordChangeCredentialService;
  let browserSessionService: BrowserSessionService;
  let jwtKeysService: JwtKeysService;
  let userId: UserId;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const configService = {
      get: jest.fn((key: string) => policy[key as keyof typeof policy]),
    } as unknown as ConfigService;
    jwtKeysService = {
      signToken: jest.fn(
        (_payload: unknown, options: { jwtid?: string }) =>
          `access-${options.jwtid}`,
      ),
    } as unknown as JwtKeysService;
    browserSessionService = new BrowserSessionService(
      configService,
      prisma,
      jwtKeysService,
      {
        assertOrganizationAuthorized: jest.fn(),
        isOrganizationAuthorized: jest.fn().mockResolvedValue(true),
      } as unknown as AccountEntitlementService,
    );
    const userService = new UserService(
      prisma,
      {} as OrganizationService,
      {} as AccountEntitlementService,
      {} as ModuleRef,
    );
    service = new PasswordChangeCredentialService(
      configService,
      prisma,
      userService,
      browserSessionService,
    );

    userId = randomUUID() as UserId;
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@password-change.test`,
        name: 'Password Change Integration User',
        passwordHash: await bcrypt.hash('temporary-password', 12),
        mustChangePassword: true,
      },
    });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.db.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('rejects consumption when a row-lock waiter crosses credential expiry', async () => {
    const originalPasswordHash = await prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const token = await service.issue(
      userId,
      PasswordChangeCredentialKind.RequiredChange,
      {},
    );
    const credentialId = createHash('sha256').update(token).digest('hex');
    const credential =
      await prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { credentialId },
      });
    await prisma.db.passwordChangeCredential.update({
      where: { id: credential.id },
      data: { expiresAt: new Date(Date.now() + 150) },
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
        SELECT credential."id"
        FROM "password_change_credentials" AS credential
        WHERE credential."id" = ${credential.id}
        FOR UPDATE OF credential
      `;
      signalLocked();
      await holdLock;
    });

    await locked;
    const consumption = service.complete(token, 'replacement-password', {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseLock();
    await blocker;

    await expect(consumption).rejects.toThrow('not valid');
    await expect(
      prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { id: credential.id },
      }),
    ).resolves.toMatchObject({ consumedAt: null });
    await expect(
      prisma.db.user.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toMatchObject({
      passwordHash: originalPasswordHash.passwordHash,
      mustChangePassword: true,
    });
  });

  it('has exactly one winner and leaves one fresh active session', async () => {
    const user = await prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const principal = {
      userId,
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        isActive: true,
        lastLoginAt: null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        currentOrganizationId: null,
      },
      claims: {
        email: user.email,
        name: user.name,
        orgMemberships: [],
        isDevAdmin: false,
        devAdminMode: false,
      },
    };
    const priorSessions = await Promise.all([
      browserSessionService.establish(principal, {}),
      browserSessionService.establish(principal, {}),
    ]);
    const token = await service.issue(
      userId,
      PasswordChangeCredentialKind.RequiredChange,
      {},
    );
    const credentialId = createHash('sha256').update(token).digest('hex');

    const results = await Promise.allSettled([
      service.complete(token, 'replacement-password', {}),
      service.complete(token, 'replacement-password', {}),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);

    const credential =
      await prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { credentialId },
      });
    expect(credential.consumedAt).not.toBeNull();

    const updatedUser = await prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(updatedUser.mustChangePassword).toBe(false);
    await expect(
      bcrypt.compare('replacement-password', updatedUser.passwordHash),
    ).resolves.toBe(true);

    const families = await prisma.db.browserSessionFamily.findMany({
      where: { userId },
    });
    expect(families.filter((family) => family.revokedAt === null)).toHaveLength(
      1,
    );
    expect(families).toHaveLength(3);

    for (const priorSession of priorSessions) {
      await expect(
        browserSessionService.refresh({
          presentedSecret: priorSession.refreshSecret,
          requestMetadata: {},
        }),
      ).resolves.toEqual({ status: 'revoked' });
    }

    const winner = results.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') {
      throw new Error('Expected one password replacement winner');
    }
    await expect(
      browserSessionService.refresh({
        presentedSecret: winner.value.refreshSecret,
        requestMetadata: {},
      }),
    ).resolves.toMatchObject({ status: 'rotated' });
  });
});
