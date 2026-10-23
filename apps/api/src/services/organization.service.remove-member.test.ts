import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityLoggerService } from './security-logger.service';
import { ApiKeyService } from './api-key.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';
import { EmailService } from './email.service';
import { AccountEntitlementService } from './account-entitlement.service';
import { OrganizationId, UserId } from '../types';

describe('OrganizationService.removeOrganizationMember', () => {
  let service: OrganizationService;

  const orgId = 'org-1' as OrganizationId;
  const userId = 'user-1' as UserId;
  const actorId = 'actor-1' as UserId;
  const assertOrganizationRole = jest.fn();

  const memberMembership = {
    id: 'mem-1',
    userId,
    organizationId: orgId,
    role: OrganizationRole.MEMBER,
    isActive: true,
  };
  const ownerMembership = {
    ...memberMembership,
    id: 'mem-owner',
    role: OrganizationRole.OWNER,
  };

  const mockPrismaService = {
    db: {
      organizationMember: {
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      projectMember: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertProject: jest.fn(),
            assertOrganizationRole,
            projectWhere: ProjectAccessService.prototype.projectWhere,
          },
        },
        {
          provide: ProjectMembershipRevocationService,
          useValue: { membershipRemoved: jest.fn() },
        },
        OrganizationService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: SecurityLoggerService,
          useValue: { logSecurityEvent: jest.fn() },
        },
        { provide: ApiKeyService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: AccountEntitlementService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);

    assertOrganizationRole.mockReset();
    assertOrganizationRole.mockResolvedValue(OrganizationRole.ADMIN);
    mockPrismaService.db.organizationMember.findUnique.mockReset();
    mockPrismaService.db.organizationMember.update.mockReset();
    mockPrismaService.db.organizationMember.count.mockReset();
    mockPrismaService.db.projectMember.deleteMany.mockReset();
    mockPrismaService.db.$transaction.mockReset();

    mockPrismaService.db.$transaction.mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );
    mockPrismaService.db.organizationMember.update.mockResolvedValue(
      memberMembership,
    );
    mockPrismaService.db.projectMember.deleteMany.mockResolvedValue({
      count: 0,
    });
  });

  it('deactivates membership and clears project memberships on happy path', async () => {
    mockPrismaService.db.organizationMember.findUnique.mockResolvedValue(
      memberMembership,
    );

    await service.removeOrganizationMember(orgId, userId, actorId);

    expect(mockPrismaService.db.organizationMember.update).toHaveBeenCalledWith(
      {
        where: { userId_organizationId: { userId, organizationId: orgId } },
        data: { isActive: false },
      },
    );
    expect(mockPrismaService.db.projectMember.deleteMany).toHaveBeenCalledWith({
      where: { userId, project: { organizationId: orgId } },
    });
    expect(mockPrismaService.db.$transaction).toHaveBeenCalled();
  });

  it('throws NotFoundException when membership does not exist', async () => {
    mockPrismaService.db.organizationMember.findUnique.mockResolvedValue(null);

    await expect(
      service.removeOrganizationMember(orgId, userId, actorId),
    ).rejects.toThrow(NotFoundException);
    expect(
      mockPrismaService.db.organizationMember.update,
    ).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when membership is already inactive', async () => {
    mockPrismaService.db.organizationMember.findUnique.mockResolvedValue({
      ...memberMembership,
      isActive: false,
    });

    await expect(
      service.removeOrganizationMember(orgId, userId, actorId),
    ).rejects.toThrow(NotFoundException);
    expect(
      mockPrismaService.db.organizationMember.update,
    ).not.toHaveBeenCalled();
  });

  it('blocks removing the last active OWNER of the organization', async () => {
    mockPrismaService.db.organizationMember.findUnique.mockResolvedValue(
      ownerMembership,
    );
    mockPrismaService.db.organizationMember.count.mockResolvedValue(0);

    await expect(
      service.removeOrganizationMember(orgId, userId, actorId),
    ).rejects.toThrow(BadRequestException);
    expect(
      mockPrismaService.db.organizationMember.update,
    ).not.toHaveBeenCalled();
  });

  it('allows removing an OWNER when other active OWNERs remain', async () => {
    mockPrismaService.db.organizationMember.findUnique.mockResolvedValue(
      ownerMembership,
    );
    mockPrismaService.db.organizationMember.count.mockResolvedValue(1);

    await service.removeOrganizationMember(orgId, userId, actorId);

    expect(mockPrismaService.db.organizationMember.update).toHaveBeenCalled();
    expect(mockPrismaService.db.projectMember.deleteMany).toHaveBeenCalled();
  });

  it('refuses callers whose organization role does not allow removing members, before any write', async () => {
    assertOrganizationRole.mockRejectedValue(
      new ForbiddenException('Insufficient permissions'),
    );

    await expect(
      service.removeOrganizationMember(orgId, userId, actorId),
    ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

    expect(assertOrganizationRole).toHaveBeenCalledWith(
      orgId,
      actorId,
      'removeOrganizationMember',
    );
    expect(
      mockPrismaService.db.organizationMember.findUnique,
    ).not.toHaveBeenCalled();
    expect(mockPrismaService.db.$transaction).not.toHaveBeenCalled();
  });
});
