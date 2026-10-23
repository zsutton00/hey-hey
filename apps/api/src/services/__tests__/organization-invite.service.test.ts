import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRole, ProjectRole } from '@prisma/client';
import { OrganizationService } from '../organization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityLoggerService } from '../security-logger.service';
import { ApiKeyService } from '../api-key.service';
import { ProjectService } from '../project.service';
import { UserService } from '../user.service';
import { EmailService } from '../email.service';
import { AccountEntitlementService } from '../account-entitlement.service';
import { OrganizationId, ProjectId, UserId } from '../../types';

describe('OrganizationService.inviteToOrganization', () => {
  const organizationId = 'org-1' as OrganizationId;
  const inviterId = 'inviter-1' as UserId;
  const invitedUserId = 'user-1' as UserId;
  const projectAId = 'project-a' as ProjectId;
  const projectBId = 'project-b' as ProjectId;
  const requestMetadata = {
    ipAddress: '203.0.113.12',
    userAgent: 'organization-invite-test',
  };

  let service: OrganizationService;
  let createProjectMembership: jest.Mock;
  let createInvitedUser: jest.Mock;
  let sendWelcomeEmail: jest.Mock;

  const invitedUser = {
    id: invitedUserId,
    email: 'invitee@example.com',
    name: 'Invitee',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const createdMembership = {
    id: 'om-1',
    userId: invitedUserId,
    organizationId,
    role: OrganizationRole.MEMBER,
    isActive: true,
    invitedAt: new Date('2024-02-01T00:00:00Z'),
    joinedAt: new Date('2024-02-01T00:00:00Z'),
    createdAt: new Date('2024-02-01T00:00:00Z'),
    user: invitedUser,
  };

  let userFindUnique: jest.Mock;
  let assertOrganizationRole: jest.Mock;
  let assertProjectRole: jest.Mock;
  let orgMemberFindUnique: jest.Mock;
  let orgMemberCreate: jest.Mock;
  let $transaction: jest.Mock;

  beforeEach(async () => {
    createProjectMembership = jest.fn();
    createInvitedUser = jest.fn();
    sendWelcomeEmail = jest.fn().mockResolvedValue(undefined);

    userFindUnique = jest.fn().mockResolvedValue(invitedUser);
    orgMemberFindUnique = jest.fn().mockResolvedValue(null);
    assertOrganizationRole = jest
      .fn()
      .mockResolvedValue(OrganizationRole.OWNER);
    assertProjectRole = jest.fn().mockResolvedValue(ProjectRole.OWNER);
    orgMemberCreate = jest.fn().mockResolvedValue(createdMembership);

    const txClient = {
      user: { findUnique: userFindUnique },
      organizationMember: {
        findUnique: orgMemberFindUnique,
        create: orgMemberCreate,
      },
    };

    $transaction = jest.fn(async (fn) => fn(txClient));

    const mockPrismaService = {
      db: {
        $transaction,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertProject: jest.fn(),
            assertOrganizationRole,
            assertProjectRole,
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
          useValue: {
            logSecurityEvent: jest.fn(),
            logMemberInvited: jest.fn(),
          },
        },
        { provide: ApiKeyService, useValue: {} },
        {
          provide: ProjectService,
          useValue: { createProjectMembership },
        },
        {
          provide: UserService,
          useValue: { createInvitedUser },
        },
        {
          provide: EmailService,
          useValue: { sendWelcomeEmail },
        },
        { provide: AccountEntitlementService, useValue: {} },
      ],
    }).compile();

    service = module.get(OrganizationService);
  });

  describe('existing-user branch', () => {
    it('creates the membership with no projects when projects is omitted', async () => {
      const result = await service.inviteToOrganization(
        organizationId,
        { email: invitedUser.email, role: OrganizationRole.MEMBER },
        inviterId,
        requestMetadata,
      );

      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).not.toHaveBeenCalled();
      expect(createInvitedUser).not.toHaveBeenCalled();
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
      expect(result.userId).toBe(invitedUserId);
    });

    it('creates the membership and fans out to a single project', async () => {
      createProjectMembership.mockResolvedValue({ id: 'pm-1' });

      await service.inviteToOrganization(
        organizationId,
        {
          email: invitedUser.email,
          role: OrganizationRole.MEMBER,
          projects: [{ projectId: projectAId, role: ProjectRole.MEMBER }],
        },
        inviterId,
        requestMetadata,
      );

      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledWith(
        organizationId,
        projectAId,
        { userId: invitedUserId, role: ProjectRole.MEMBER },
        expect.anything(),
      );
      expect(createInvitedUser).not.toHaveBeenCalled();
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('creates the membership and fans out to many projects', async () => {
      createProjectMembership.mockResolvedValue({ id: 'pm-x' });

      await service.inviteToOrganization(
        organizationId,
        {
          email: invitedUser.email,
          role: OrganizationRole.MEMBER,
          projects: [
            { projectId: projectAId, role: ProjectRole.MEMBER },
            { projectId: projectBId, role: ProjectRole.VIEWER },
          ],
        },
        inviterId,
        requestMetadata,
      );

      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(2);
      expect(createProjectMembership).toHaveBeenNthCalledWith(
        1,
        organizationId,
        projectAId,
        { userId: invitedUserId, role: ProjectRole.MEMBER },
        expect.anything(),
      );
      expect(createProjectMembership).toHaveBeenNthCalledWith(
        2,
        organizationId,
        projectBId,
        { userId: invitedUserId, role: ProjectRole.VIEWER },
        expect.anything(),
      );
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('rolls back the org membership when an invalid projectId is given', async () => {
      createProjectMembership.mockRejectedValue(
        new NotFoundException(
          `Project ${projectAId} not found in organization ${organizationId}`,
        ),
      );

      await expect(
        service.inviteToOrganization(
          organizationId,
          {
            email: invitedUser.email,
            role: OrganizationRole.MEMBER,
            projects: [{ projectId: projectAId, role: ProjectRole.MEMBER }],
          },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(1);
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('rolls back the org membership when a duplicate project membership is detected', async () => {
      createProjectMembership.mockRejectedValue(
        new BadRequestException('User is already a member of this project'),
      );

      await expect(
        service.inviteToOrganization(
          organizationId,
          {
            email: invitedUser.email,
            role: OrganizationRole.MEMBER,
            projects: [{ projectId: projectAId, role: ProjectRole.MEMBER }],
          },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(1);
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('fails when the user is already an active org member', async () => {
      orgMemberFindUnique.mockResolvedValue({
        id: 'existing-om',
        userId: invitedUserId,
        organizationId,
        role: OrganizationRole.MEMBER,
        isActive: true,
      });

      await expect(
        service.inviteToOrganization(
          organizationId,
          { email: invitedUser.email, role: OrganizationRole.MEMBER },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(orgMemberCreate).not.toHaveBeenCalled();
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });
  });

  describe('user-creation branch', () => {
    const brandNewEmail = 'newcomer@example.com';
    const createdUserId = 'user-new' as UserId;
    const createdUser = {
      id: createdUserId,
      email: brandNewEmail,
      name: 'newcomer',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2024-02-01T00:00:00Z'),
      updatedAt: new Date('2024-02-01T00:00:00Z'),
      mustChangePassword: true,
    };

    const membershipForCreated = {
      ...createdMembership,
      userId: createdUserId,
      user: createdUser,
    };

    beforeEach(() => {
      userFindUnique.mockResolvedValue(null);
      createInvitedUser.mockResolvedValue({
        user: createdUser,
        passwordChangeCredential: 'welcome-token-abc',
      });
      orgMemberCreate.mockResolvedValue(membershipForCreated);
    });

    it('creates the User, the org membership, and sends one welcome email when projects is omitted', async () => {
      const result = await service.inviteToOrganization(
        organizationId,
        { email: brandNewEmail, role: OrganizationRole.MEMBER },
        inviterId,
        requestMetadata,
      );

      expect(createInvitedUser).toHaveBeenCalledTimes(1);
      expect(createInvitedUser).toHaveBeenCalledWith(
        expect.anything(),
        { email: brandNewEmail },
        requestMetadata,
      );
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).not.toHaveBeenCalled();
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledWith({
        to: brandNewEmail,
        name: createdUser.name,
        passwordChangeCredential: 'welcome-token-abc',
      });
      expect(result.userId).toBe(createdUserId);
    });

    it('creates User + org membership + project memberships atomically with welcome email', async () => {
      createProjectMembership.mockResolvedValue({ id: 'pm-1' });

      await service.inviteToOrganization(
        organizationId,
        {
          email: brandNewEmail,
          role: OrganizationRole.MEMBER,
          projects: [
            { projectId: projectAId, role: ProjectRole.MEMBER },
            { projectId: projectBId, role: ProjectRole.VIEWER },
          ],
        },
        inviterId,
        requestMetadata,
      );

      expect(createInvitedUser).toHaveBeenCalledTimes(1);
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(2);
      expect(createProjectMembership).toHaveBeenNthCalledWith(
        1,
        organizationId,
        projectAId,
        { userId: createdUserId, role: ProjectRole.MEMBER },
        expect.anything(),
      );
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    });

    it('rolls back and sends no welcome email when user-creation fails', async () => {
      createInvitedUser.mockRejectedValue(new Error('bcrypt boom'));

      await expect(
        service.inviteToOrganization(
          organizationId,
          { email: brandNewEmail, role: OrganizationRole.MEMBER },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toThrow('bcrypt boom');

      expect(orgMemberCreate).not.toHaveBeenCalled();
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('rolls back the new user + org membership when a project assignment fails', async () => {
      createProjectMembership.mockRejectedValue(
        new NotFoundException('Project missing'),
      );

      await expect(
        service.inviteToOrganization(
          organizationId,
          {
            email: brandNewEmail,
            role: OrganizationRole.MEMBER,
            projects: [{ projectId: projectAId, role: ProjectRole.MEMBER }],
          },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // createInvitedUser and orgMemberCreate ran inside the tx, but the tx
      // callback rejected, so Prisma rolls both writes back. The welcome
      // email is never reached — the project assignment fails earlier in
      // the same tx callback.
      expect(createInvitedUser).toHaveBeenCalledTimes(1);
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(createProjectMembership).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('rolls the invite back and surfaces a 500 when the welcome email fails', async () => {
      // The welcome email is sent inside the tx callback so any delivery
      // failure rolls back the user + membership writes. Without this, an
      // unconfigured email provider would silently leave an orphan invite
      // and the API would falsely return success.
      sendWelcomeEmail.mockRejectedValue(new Error('Resend 500'));

      await expect(
        service.inviteToOrganization(
          organizationId,
          { email: brandNewEmail, role: OrganizationRole.MEMBER },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toThrow('Resend 500');

      expect(createInvitedUser).toHaveBeenCalledTimes(1);
      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('role enforcement', () => {
    it('refuses an inviter whose organization role does not allow inviting, before any write', async () => {
      assertOrganizationRole.mockRejectedValue(
        new ForbiddenException('Insufficient permissions'),
      );

      await expect(
        service.inviteToOrganization(
          organizationId,
          { email: invitedUser.email, role: OrganizationRole.MEMBER },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

      expect(assertOrganizationRole).toHaveBeenCalledWith(
        organizationId,
        inviterId,
        'inviteToOrganization',
      );
      expect($transaction).not.toHaveBeenCalled();
      expect(createProjectMembership).not.toHaveBeenCalled();
    });

    it('requires add-member rights on every assigned project, before any write', async () => {
      assertProjectRole.mockImplementation((projectId: string) =>
        projectId === projectBId
          ? Promise.reject(new ForbiddenException('Insufficient permissions'))
          : Promise.resolve(ProjectRole.OWNER),
      );

      await expect(
        service.inviteToOrganization(
          organizationId,
          {
            email: invitedUser.email,
            role: OrganizationRole.MEMBER,
            projects: [
              { projectId: projectAId, role: ProjectRole.MEMBER },
              { projectId: projectBId, role: ProjectRole.MEMBER },
            ],
          },
          inviterId,
          requestMetadata,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

      expect(assertProjectRole).toHaveBeenCalledWith(
        projectBId,
        inviterId,
        'addProjectMember',
      );
      expect($transaction).not.toHaveBeenCalled();
      expect(createProjectMembership).not.toHaveBeenCalled();
    });

    it.each([OrganizationRole.OWNER, OrganizationRole.ADMIN])(
      'does not let an ADMIN grant the %s role',
      async (requestedRole) => {
        assertOrganizationRole.mockResolvedValue(OrganizationRole.ADMIN);

        await expect(
          service.inviteToOrganization(
            organizationId,
            { email: invitedUser.email, role: requestedRole },
            inviterId,
            requestMetadata,
          ),
        ).rejects.toThrow(BadRequestException);

        expect($transaction).not.toHaveBeenCalled();
      },
    );

    it('lets an OWNER grant the ADMIN role', async () => {
      await service.inviteToOrganization(
        organizationId,
        { email: invitedUser.email, role: OrganizationRole.ADMIN },
        inviterId,
        requestMetadata,
      );

      expect(orgMemberCreate).toHaveBeenCalledTimes(1);
    });
  });
});
