import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationRole } from '@prisma/client';
import { BulkInviteToOrganizationDto } from '../generated';
import { SecurityLoggerService } from './security-logger.service';
import { ApiKeyService } from './api-key.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';
import { EmailService } from './email.service';
import { AccountEntitlementService } from './account-entitlement.service';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('OrganizationService - Security Tests', () => {
  let service: OrganizationService;
  const requestMetadata = {
    ipAddress: '203.0.113.13',
    userAgent: 'organization-security-test',
  };

  // Per-row transaction mock helpers — bulkInviteToOrganization now opens a
  // fresh $transaction for each row so failures are isolated.
  const buildTxClient = (config: {
    existingUserByEmail?: Record<
      string,
      { id: string; email: string; name?: string }
    >;
    existingActiveMemberIds?: Set<string>;
    orgMemberCreate?: jest.Mock;
    createInvitedUser?: jest.Mock;
  }) => {
    const existingUsers = config.existingUserByEmail ?? {};
    const activeMembers = config.existingActiveMemberIds ?? new Set();

    return {
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({ where }: { where: { email: string } }) =>
              existingUsers[where.email] ?? null,
          ),
      },
      organizationMember: {
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({
              where,
            }: {
              where: { userId_organizationId: { userId: string } };
            }) =>
              activeMembers.has(where.userId_organizationId.userId)
                ? { isActive: true }
                : null,
          ),
        create:
          config.orgMemberCreate ??
          jest.fn().mockImplementation(({ data }) => ({
            id: `membership-${data.userId}`,
            ...data,
            createdAt: new Date(),
            invitedAt: new Date(),
            joinedAt: new Date(),
            user: {
              id: data.userId,
              email:
                Object.values(existingUsers).find((u) => u.id === data.userId)
                  ?.email ?? `${data.userId}@example.com`,
              name: 'Test User',
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              lastLoginAt: null,
            },
          })),
      },
    };
  };

  const mockPrismaService = {
    db: {
      user: {
        findMany: jest.fn(),
      },
      organizationMember: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  };

  const mockSecurityLoggerService = {
    logSecurityEvent: jest.fn(),
    logAuthEvent: jest.fn(),
    logAccessEvent: jest.fn(),
    logBulkInviteAttempt: jest.fn().mockReturnValue('correlation-id-123'),
    logBulkInviteSuccess: jest.fn().mockReturnValue('correlation-id-456'),
    logBulkInviteFailure: jest.fn().mockReturnValue('correlation-id-789'),
    logExcessiveBatchAttempt: jest.fn(),
    logInvalidEmailAttempt: jest.fn(),
    logRoleEscalationAttempt: jest.fn(),
    logMemberInvited: jest.fn(),
    logRateLimitExceeded: jest.fn(),
  };

  const mockProjectService = {
    createProjectMembership: jest.fn(),
  };

  const mockProjectAccess = {
    assertProject: jest.fn(),
    assertOrganizationRole: jest.fn(),
    assertProjectRole: jest.fn(),
    projectWhere: ProjectAccessService.prototype.projectWhere,
  };

  const mockUserService = {
    createInvitedUser: jest.fn(),
  };

  const mockEmailService = {
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockApiKeyService = {
    createMastraApiKey: jest.fn().mockResolvedValue({
      id: 'api-key-1',
      key: 'test-api-key',
      prefix: 'hh_test',
      name: 'Agent Service API Key',
      description:
        'Auto-generated key for agent service data access and callbacks',
      keyType: 'MASTRA_AI',
      scopes: ['agent.read', 'agent.write'],
      createdAt: new Date(),
      isActive: true,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: mockProjectAccess,
        },
        {
          provide: ProjectMembershipRevocationService,
          useValue: { membershipRemoved: jest.fn() },
        },
        OrganizationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SecurityLoggerService, useValue: mockSecurityLoggerService },
        { provide: ApiKeyService, useValue: mockApiKeyService },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: UserService, useValue: mockUserService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AccountEntitlementService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Role enforcement', () => {
    const batchWithProjects: BulkInviteToOrganizationDto = {
      invitations: [
        {
          email: 'a@example.com',
          role: OrganizationRole.MEMBER,
          projects: [{ projectId: 'project-a' as any, role: 'MEMBER' }],
        },
        {
          email: 'b@example.com',
          role: OrganizationRole.MEMBER,
          projects: [
            { projectId: 'project-a' as any, role: 'VIEWER' },
            { projectId: 'project-b' as any, role: 'MEMBER' },
          ],
        },
      ],
    };

    it('refuses callers whose organization role does not allow inviting, before any write', async () => {
      mockProjectAccess.assertOrganizationRole.mockRejectedValue(
        new ForbiddenException('Insufficient permissions'),
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          batchWithProjects,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

      expect(mockProjectAccess.assertOrganizationRole).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'inviteToOrganization',
      );
      expect(mockPrismaService.db.$transaction).not.toHaveBeenCalled();
    });

    it('requires add-member rights once on each distinct assigned project, before any write', async () => {
      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.OWNER,
      );
      mockProjectAccess.assertProjectRole.mockImplementation(
        (projectId: string) =>
          projectId === 'project-b'
            ? Promise.reject(new ForbiddenException('Insufficient permissions'))
            : Promise.resolve('OWNER'),
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          batchWithProjects,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

      expect(mockProjectAccess.assertProjectRole).toHaveBeenCalledTimes(2);
      expect(mockProjectAccess.assertProjectRole).toHaveBeenCalledWith(
        'project-b',
        'user-1',
        'addProjectMember',
      );
      expect(mockPrismaService.db.$transaction).not.toHaveBeenCalled();
      expect(mockProjectService.createProjectMembership).not.toHaveBeenCalled();
    });

    it('adds project members through the internal path without re-checking the actor', async () => {
      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.OWNER,
      );
      mockProjectAccess.assertProjectRole.mockResolvedValue('OWNER');
      mockPrismaService.db.$transaction.mockImplementation(async (callback) =>
        callback(
          buildTxClient({
            existingUserByEmail: {
              'a@example.com': { id: 'user-a', email: 'a@example.com' },
            },
          }),
        ),
      );

      await service.bulkInviteToOrganization(
        'org-1' as any,
        {
          invitations: [
            {
              email: 'a@example.com',
              role: OrganizationRole.MEMBER,
              projects: [{ projectId: 'project-a' as any, role: 'MEMBER' }],
            },
          ],
        },
        'user-1' as any,
        requestMetadata,
      );

      expect(mockProjectService.createProjectMembership).toHaveBeenCalledWith(
        'org-1',
        'project-a',
        expect.objectContaining({ role: 'MEMBER' }),
        expect.anything(),
      );
    });
  });

  describe('Batch Size Limits', () => {
    it('should reject batches larger than 25 invitations', async () => {
      const largeBatch: BulkInviteToOrganizationDto = {
        invitations: Array(26).fill({
          email: 'test@example.com',
          role: OrganizationRole.MEMBER,
        }),
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          largeBatch,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.db.$transaction).not.toHaveBeenCalled();
    });

    it('should accept batches of exactly 25 invitations', async () => {
      const maxBatch: BulkInviteToOrganizationDto = {
        invitations: Array(25).fill({
          email: 'test@example.com',
          role: OrganizationRole.MEMBER,
        }),
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      const createdUser = {
        id: 'user-new',
        email: 'test@example.com',
        name: 'Test',
        mustChangePassword: true,
      };
      mockUserService.createInvitedUser.mockResolvedValue({
        user: createdUser,
        passwordChangeCredential: 'welcome-token',
      });

      mockPrismaService.db.$transaction.mockImplementation(async (callback) =>
        callback(buildTxClient({})),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        maxBatch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalRequested).toBe(25);
    });
  });

  describe('Information Disclosure Prevention', () => {
    it('should return generic error for invalid email formats', async () => {
      const invalidEmailBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'invalid-email', role: OrganizationRole.MEMBER },
          { email: 'another@invalid', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          invalidEmailBatch,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow('Unable to process one or more invitations');
    });

    it('should return same generic error for non-existent users (user-creation path fails) and existing members', async () => {
      const testBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'nonexistent@example.com', role: OrganizationRole.MEMBER },
          { email: 'existing@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      // Row 1 — user-creation raises (simulating a DB constraint on user
      // creation, e.g. concurrent insert). Row 2 — user exists but is
      // already an active org member. Both surface the same generic error.
      mockUserService.createInvitedUser.mockRejectedValueOnce(
        new Error('race on unique email'),
      );

      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback(
          buildTxClient({
            existingUserByEmail: {
              'existing@example.com': {
                id: 'user-2',
                email: 'existing@example.com',
              },
            },
            existingActiveMemberIds: new Set(['user-2']),
          }),
        ),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        testBatch,
        'user-1' as any,
        requestMetadata,
      );

      const firstResult = assertDefined(result.results[0], 'first result');
      const secondResult = assertDefined(result.results[1], 'second result');
      expect(firstResult.error).toBe('Unable to process invitation');
      expect(secondResult.error).toBe('Unable to process invitation');
      expect(firstResult.success).toBe(false);
      expect(secondResult.success).toBe(false);
    });
  });

  describe('Role Escalation Prevention', () => {
    it('should prevent ADMIN from creating OWNER memberships', async () => {
      const escalationBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'test@example.com', role: OrganizationRole.OWNER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          escalationBatch,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow(
        'Insufficient permissions for requested role assignments',
      );
    });

    it('should prevent ADMIN from creating other ADMIN memberships', async () => {
      const escalationBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'test@example.com', role: OrganizationRole.ADMIN },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      await expect(
        service.bulkInviteToOrganization(
          'org-1' as any,
          escalationBatch,
          'user-1' as any,
          requestMetadata,
        ),
      ).rejects.toThrow(
        'Insufficient permissions for requested role assignments',
      );
    });

    it('should allow OWNER to create any role', async () => {
      const ownerBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'admin@example.com', role: OrganizationRole.ADMIN },
          { email: 'member@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.OWNER,
      );

      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback(
          buildTxClient({
            existingUserByEmail: {
              'admin@example.com': { id: 'user-2', email: 'admin@example.com' },
              'member@example.com': {
                id: 'user-3',
                email: 'member@example.com',
              },
            },
          }),
        ),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        ownerBatch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalSuccessful).toBe(2);
    });
  });

  describe('Per-row Transaction Isolation', () => {
    it('opens one $transaction per invitation with timeout and isolation level', async () => {
      const batch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'a@example.com', role: OrganizationRole.MEMBER },
          { email: 'b@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      mockPrismaService.db.$transaction.mockImplementation(
        async (callback, options) => {
          expect(options.timeout).toBe(30000);
          expect(options.isolationLevel).toBe('ReadCommitted');
          return callback(
            buildTxClient({
              existingUserByEmail: {
                'a@example.com': { id: 'user-a', email: 'a@example.com' },
                'b@example.com': { id: 'user-b', email: 'b@example.com' },
              },
            }),
          );
        },
      );

      await service.bulkInviteToOrganization(
        'org-1' as any,
        batch,
        'user-1' as any,
        requestMetadata,
      );

      // One transaction per row — this is what delivers per-row atomicity.
      expect(mockPrismaService.db.$transaction).toHaveBeenCalledTimes(2);
    });

    it('row-1 failure does not prevent row-2 from committing', async () => {
      const batch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'will-fail@example.com', role: OrganizationRole.MEMBER },
          { email: 'will-succeed@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      // Row 1 — the org-member insert throws → whole row's tx rolls back.
      // Row 2 — clean existing-user path → commits normally.
      mockPrismaService.db.$transaction
        .mockImplementationOnce((callback) =>
          callback({
            user: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'user-fail',
                email: 'will-fail@example.com',
                name: 'Fail',
              }),
            },
            organizationMember: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest
                .fn()
                .mockRejectedValue(new Error('simulated DB error')),
            },
          }),
        )
        .mockImplementationOnce((callback) =>
          callback(
            buildTxClient({
              existingUserByEmail: {
                'will-succeed@example.com': {
                  id: 'user-succeed',
                  email: 'will-succeed@example.com',
                },
              },
            }),
          ),
        );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        batch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalRequested).toBe(2);
      expect(result.totalSuccessful).toBe(1);
      expect(result.totalFailed).toBe(1);
      expect(assertDefined(result.results[0], 'row 0').success).toBe(false);
      expect(assertDefined(result.results[0], 'row 0').error).toBe(
        'Unable to process invitation',
      );
      expect(assertDefined(result.results[1], 'row 1').success).toBe(true);
      // Both rows' transactions were attempted — row-1's failure didn't
      // short-circuit the loop.
      expect(mockPrismaService.db.$transaction).toHaveBeenCalledTimes(2);
    });

    it('rejects an existing but inactive membership the same way as an active one (parity with single-invite)', async () => {
      const batch: BulkInviteToOrganizationDto = {
        invitations: [
          {
            email: 'ex-member@example.com',
            role: OrganizationRole.MEMBER,
          },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      // User exists, has a deactivated (isActive: false) membership row —
      // we must not attempt to create another, because the unique key
      // userId_organizationId would collide.
      const orgMemberCreate = jest.fn();
      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback({
          user: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'user-ex',
              email: 'ex-member@example.com',
              name: 'Ex',
            }),
          },
          organizationMember: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'om-ex',
              userId: 'user-ex',
              organizationId: 'org-1',
              isActive: false, // soft-deactivated
            }),
            create: orgMemberCreate,
          },
        }),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        batch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalFailed).toBe(1);
      expect(assertDefined(result.results[0], 'row 0').error).toBe(
        'Unable to process invitation',
      );
      expect(orgMemberCreate).not.toHaveBeenCalled();
    });
  });

  describe('Within-batch duplicate handling', () => {
    it('commits the first duplicate and fails the second with the generic error', async () => {
      const duplicateBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'duplicate@example.com', role: OrganizationRole.MEMBER },
          { email: 'duplicate@example.com', role: OrganizationRole.MEMBER },
          { email: 'unique@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.ADMIN,
      );

      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback(
          buildTxClient({
            existingUserByEmail: {
              'duplicate@example.com': {
                id: 'user-1',
                email: 'duplicate@example.com',
              },
              'unique@example.com': {
                id: 'user-2',
                email: 'unique@example.com',
              },
            },
          }),
        ),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        duplicateBatch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalRequested).toBe(3);
      expect(result.totalSuccessful).toBe(2);
      expect(result.totalFailed).toBe(1);
      // First + third should succeed; second (duplicate) should fail.
      expect(assertDefined(result.results[0], 'row 0').success).toBe(true);
      expect(assertDefined(result.results[1], 'row 1').success).toBe(false);
      expect(assertDefined(result.results[2], 'row 2').success).toBe(true);
    });
  });

  describe('Mixed new + existing emails (user-creation branch)', () => {
    it('creates a user + sends welcome email for unknown emails and reuses existing users without email', async () => {
      const mixedBatch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'fresh@example.com', role: OrganizationRole.MEMBER },
          { email: 'known@example.com', role: OrganizationRole.MEMBER },
          { email: 'alreadymember@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.OWNER,
      );

      mockUserService.createInvitedUser.mockResolvedValue({
        user: {
          id: 'user-fresh',
          email: 'fresh@example.com',
          name: 'fresh',
          mustChangePassword: true,
        },
        passwordChangeCredential: 'welcome-token',
      });

      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback(
          buildTxClient({
            existingUserByEmail: {
              'known@example.com': {
                id: 'user-known',
                email: 'known@example.com',
              },
              'alreadymember@example.com': {
                id: 'user-already',
                email: 'alreadymember@example.com',
              },
            },
            existingActiveMemberIds: new Set(['user-already']),
          }),
        ),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        mixedBatch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalSuccessful).toBe(2);
      expect(result.totalFailed).toBe(1);
      expect(mockUserService.createInvitedUser).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith({
        to: 'fresh@example.com',
        name: 'fresh',
        passwordChangeCredential: 'welcome-token',
      });
    });

    it('does not send a welcome email for a failed row (rollback)', async () => {
      const batch: BulkInviteToOrganizationDto = {
        invitations: [
          { email: 'fresh@example.com', role: OrganizationRole.MEMBER },
        ],
      };

      mockProjectAccess.assertOrganizationRole.mockResolvedValue(
        OrganizationRole.OWNER,
      );

      mockUserService.createInvitedUser.mockResolvedValue({
        user: {
          id: 'user-fresh',
          email: 'fresh@example.com',
          name: 'fresh',
          mustChangePassword: true,
        },
        passwordChangeCredential: 'welcome-token',
      });

      // Simulate the org-member create throwing, causing the whole row's tx
      // to roll back — welcome email should never be queued.
      mockPrismaService.db.$transaction.mockImplementation((callback) =>
        callback({
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          organizationMember: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest
              .fn()
              .mockRejectedValue(new Error('simulated DB error')),
          },
        }),
      );

      const result = await service.bulkInviteToOrganization(
        'org-1' as any,
        batch,
        'user-1' as any,
        requestMetadata,
      );

      expect(result.totalFailed).toBe(1);
      expect(assertDefined(result.results[0], 'row 0').error).toBe(
        'Unable to process invitation',
      );
      expect(mockEmailService.sendWelcomeEmail).not.toHaveBeenCalled();
    });
  });
});
