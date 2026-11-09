import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationService } from '../organization.service';
import { AccountEntitlementService } from '../account-entitlement.service';

describe('UserService', () => {
  let service: UserService;
  let prismaService: PrismaService;

  const mockUserId = 'user-123';

  const mockUser = {
    id: mockUserId,
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const transaction = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), create: jest.fn() },
  };
  const mockEntitlements = {
    createBetaAtAdmissionInTransaction: jest.fn(),
    createBetaAtAdmission: jest.fn(),
  };
  const mockOrganizationService = {
    // Add common methods that might be used by UserService
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createOrganizationWithTransaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mockPrismaService = {
      db: {
        user: {
          create: jest.fn(),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        organizationMember: { findFirstOrThrow: jest.fn() },
        $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
        ),
      },
    };

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
        UserService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: OrganizationService,
          useValue: mockOrganizationService,
        },
        {
          provide: AccountEntitlementService,
          useValue: mockEntitlements,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('local account bootstrap', () => {
    it('authorizes the organization created for a new local account', async () => {
      jest.spyOn(prismaService.db.user, 'findUnique').mockResolvedValue(null);
      transaction.user.findUnique.mockResolvedValue(null);
      transaction.user.create.mockResolvedValue({ id: 'local-user' });
      mockOrganizationService.createOrganizationWithTransaction.mockResolvedValue(
        { id: 'local-org' },
      );

      await service.createLocalBootstrapUser('installation-secret');

      expect(
        mockEntitlements.createBetaAtAdmissionInTransaction,
      ).toHaveBeenCalledWith(
        transaction,
        'local-org',
        expect.objectContaining({ actor: 'local-user' }),
      );
    });

    it('repairs an existing local account whose organization has no entitlement', async () => {
      jest
        .spyOn(prismaService.db.user, 'findUnique')
        .mockResolvedValue({ id: 'local-user' } as never);
      jest
        .spyOn(prismaService.db.organizationMember, 'findFirstOrThrow')
        .mockResolvedValue({ organizationId: 'local-org' } as never);

      await service.createLocalBootstrapUser('installation-secret');

      expect(mockEntitlements.createBetaAtAdmission).toHaveBeenCalledWith(
        'local-org',
        expect.objectContaining({ actor: 'local-user' }),
      );
      expect(prismaService.db.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('basic service functionality', () => {
    it('should have prisma service injected', () => {
      expect(prismaService).toBeDefined();
    });

    it('should be able to mock database operations', async () => {
      jest
        .spyOn(prismaService.db.user, 'findMany')
        .mockResolvedValue([mockUser] as any);

      // Test that the service can interact with the database
      const users = await prismaService.db.user.findMany();
      expect(users).toEqual([mockUser]);
    });
  });
});
