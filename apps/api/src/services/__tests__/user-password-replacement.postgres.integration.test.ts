import { ModuleRef } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { UserId } from '../../types';
import { AccountEntitlementService } from '../account-entitlement.service';
import { OrganizationService } from '../organization.service';
import { UserService } from '../user.service';

const describeDatabase =
  process.env.RUN_USER_PASSWORD_REPLACEMENT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('UserService password replacement PostgreSQL', () => {
  const currentPassword = 'current-password';
  const replacementPassword = 'replacement-password';

  let prisma: PrismaService;
  let service: UserService;
  const userIds: UserId[] = [];

  const seedUser = async (isActive = true) => {
    const id = randomUUID() as UserId;
    userIds.push(id);
    await prisma.db.user.create({
      data: {
        id,
        email: `${id}@password-replacement.test`,
        name: 'Password Replacement Integration User',
        passwordHash: await bcrypt.hash(currentPassword, 4),
        isActive,
        mustChangePassword: true,
      },
    });
    return id;
  };

  const replace = (userId: UserId, password: string) =>
    prisma.db.$transaction((tx) =>
      service.replaceCurrentPasswordInTransaction(
        tx,
        userId,
        password,
        replacementPassword,
      ),
    );

  const storedUser = (userId: UserId) =>
    prisma.db.user.findUniqueOrThrow({ where: { id: userId } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new UserService(
      prisma,
      {} as OrganizationService,
      {} as AccountEntitlementService,
      {} as ModuleRef,
    );
  });

  afterAll(async () => {
    await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('replaces the stored hash and clears mustChangePassword for the correct current password', async () => {
    const userId = await seedUser();

    await replace(userId, currentPassword);

    const user = await storedUser(userId);
    await expect(
      bcrypt.compare(replacementPassword, user.passwordHash),
    ).resolves.toBe(true);
    expect(user.mustChangePassword).toBe(false);
  });

  it('rejects a wrong current password and leaves the stored hash unchanged', async () => {
    const userId = await seedUser();
    const before = await storedUser(userId);

    await expect(replace(userId, 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const after = await storedUser(userId);
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rejects an inactive user', async () => {
    const userId = await seedUser(false);
    const before = await storedUser(userId);

    await expect(replace(userId, currentPassword)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const after = await storedUser(userId);
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});
