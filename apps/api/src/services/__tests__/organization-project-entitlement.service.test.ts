import { ForbiddenException } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import {
  DEFAULT_PROJECT_LIMIT,
  OrganizationProjectEntitlementService,
  PROJECT_LIMIT_REACHED_CODE,
} from '../organization-project-entitlement.service';

describe('OrganizationProjectEntitlementService', () => {
  const organizationId =
    '99e0a635-9fe1-48c3-b145-6a61b89b9d76' as OrganizationId;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId;
  let tx: any;
  let service: OrganizationProjectEntitlementService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      organizationProjectEntitlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      organizationCapacityUsage: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      organizationMember: {
        findUnique: jest.fn(),
      },
      project: { count: jest.fn().mockResolvedValue(1) },
      task: { count: jest.fn().mockResolvedValue(2500) },
    };
    const prisma = {
      db: {
        ...tx,
        $transaction: jest.fn(async (callback) => callback(tx)),
      },
    } as unknown as PrismaService;
    service = new OrganizationProjectEntitlementService(prisma);
  });

  it('resolves the two-project default and meters work items without limiting them', async () => {
    const result = await service.resolve(organizationId, tx);

    expect(result.defaultProjectLimit).toBe(DEFAULT_PROJECT_LIMIT);
    expect(result.projectLimit).toBe(2);
    expect(result.canCreateProject).toBe(true);
    expect(result.usage.workItemCount).toBe(2500);
    expect(tx.organizationCapacityUsage.upsert).toHaveBeenCalled();
  });

  it('locks the organization and returns the typed conflict at the limit', async () => {
    tx.project.count.mockResolvedValue(2);

    await expect(
      service.assertProjectCreationAllowed(tx, organizationId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: PROJECT_LIMIT_REACHED_CODE }),
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it.each([OrganizationRole.OWNER, OrganizationRole.ADMIN])(
    'allows active %s memberships to update the override',
    async (role) => {
      tx.organizationMember.findUnique.mockResolvedValue({
        isActive: true,
        role,
      });
      tx.organizationProjectEntitlement.findUnique.mockResolvedValue({
        projectLimitOverride: 5,
      });

      const result = await service.updateOverride(organizationId, userId, {
        projectLimitOverride: 5,
      });

      expect(result.projectLimit).toBe(5);
      expect(tx.organizationProjectEntitlement.upsert).toHaveBeenCalled();
    },
  );

  it('rejects inactive and non-operator memberships', async () => {
    tx.organizationMember.findUnique.mockResolvedValue({
      isActive: true,
      role: OrganizationRole.MEMBER,
    });

    await expect(
      service.updateOverride(organizationId, userId, {
        projectLimitOverride: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
