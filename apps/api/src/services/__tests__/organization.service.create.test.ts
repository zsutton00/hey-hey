import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationService } from '../organization.service';
import { ApiKeyService } from '../api-key.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityLoggerService } from '../security-logger.service';
import { ProjectService } from '../project.service';
import { UserService } from '../user.service';
import { EmailService } from '../email.service';
import { AccountEntitlementService } from '../account-entitlement.service';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('OrganizationService - createOrganizationWithTransaction slug handling', () => {
  let organizationService: OrganizationService;

  const mockPrisma = TestUtils.createMockPrismaService() as any;

  const buildTx = (slugLookups: (boolean | null)[]) => {
    const findUnique = jest.fn();
    slugLookups.forEach((collides) => {
      if (collides) {
        findUnique.mockResolvedValueOnce({ id: 'existing' });
      } else {
        findUnique.mockResolvedValueOnce(null);
      }
    });

    return {
      organization: {
        findUnique,
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: testIds.organization,
          ...data,
          isActive: true,
          settings: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      organizationMember: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'system' }),
        create: jest.fn(),
      },
      _findUniqueSpy: findUnique,
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: {
            assertProject: jest.fn(),
            projectWhere: ProjectAccessService.prototype.projectWhere,
          },
        },
        {
          provide: ProjectMembershipRevocationService,
          useValue: { membershipRemoved: jest.fn() },
        },
        OrganizationService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ApiKeyService,
          useValue: TestUtils.createMockApiKeyService(),
        },
        {
          provide: SecurityLoggerService,
          useValue: TestUtils.createMockSecurityLoggerService(),
        },
        {
          provide: ProjectService,
          useValue: { addProjectMember: jest.fn() },
        },
        {
          provide: UserService,
          useValue: { createInvitedUser: jest.fn() },
        },
        {
          provide: EmailService,
          useValue: { sendWelcomeEmail: jest.fn() },
        },
        { provide: AccountEntitlementService, useValue: {} },
      ],
    }).compile();

    organizationService = module.get<OrganizationService>(OrganizationService);
    jest.clearAllMocks();
  });

  it('uses the generated slug as-is when free', async () => {
    const tx = buildTx([false]);

    const result = await organizationService.createOrganizationWithTransaction(
      tx,
      { name: 'Acme Inc', description: 'd' },
      testIds.user,
    );

    expect(tx.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'acme-inc' }),
      }),
    );
    expect(result.slug).toBe('acme-inc');
  });

  it('appends -2 when the generated slug collides once', async () => {
    // first lookup: base slug taken; second lookup: -2 free
    const tx = buildTx([true, false]);

    const result = await organizationService.createOrganizationWithTransaction(
      tx,
      { name: 'Acme Inc', description: 'd' },
      testIds.user,
    );

    expect(result.slug).toBe('acme-inc-2');
  });

  it('appends -3 when both base and -2 collide', async () => {
    const tx = buildTx([true, true, false]);

    const result = await organizationService.createOrganizationWithTransaction(
      tx,
      { name: 'Acme Inc', description: 'd' },
      testIds.user,
    );

    expect(result.slug).toBe('acme-inc-3');
  });

  it('rejects user-provided slug duplicates with ForbiddenException', async () => {
    const tx = buildTx([true]);

    await expect(
      organizationService.createOrganizationWithTransaction(
        tx,
        { name: 'Whatever', slug: 'user-chosen', description: 'd' },
        testIds.user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.organization.create).not.toHaveBeenCalled();
  });
});
