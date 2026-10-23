import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationService } from '../organization.service';
import { RegisterDto } from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import {
  PASSWORD_CHANGE_CREDENTIAL_ISSUER,
  PasswordChangeCredentialKind,
} from '../../auth/password-change-credential.types';
import type { PrivateBetaAccessRequestId } from '../../types';
import { AccountEntitlementService } from '../account-entitlement.service';

// Mock bcrypt
jest.mock('bcrypt');

describe('UserService - Password Security', () => {
  let service: UserService;
  let prismaService: PrismaService;
  let organizationService: OrganizationService;
  let issueInTransaction: jest.Mock;
  let issueIdempotentlyInTransaction: jest.Mock;
  let createBetaAtAdmissionInTransaction: jest.Mock;
  const { testIds } = TestUtils;

  const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  beforeEach(async () => {
    issueInTransaction = jest.fn().mockResolvedValue('welcome-token');
    issueIdempotentlyInTransaction = jest
      .fn()
      .mockResolvedValue('request-welcome-token');
    createBetaAtAdmissionInTransaction = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              user: {
                create: jest.fn(),
                findUnique: jest.fn(),
                update: jest.fn(),
              },
              $transaction: jest.fn(),
              $queryRaw: jest.fn(),
            },
          },
        },
        {
          provide: OrganizationService,
          useValue: {
            createOrganizationWithTransaction: jest.fn(),
          },
        },
        {
          provide: AccountEntitlementService,
          useValue: {
            createBetaAtAdmissionInTransaction,
          },
        },
        {
          provide: PASSWORD_CHANGE_CREDENTIAL_ISSUER,
          useValue: { issueInTransaction, issueIdempotentlyInTransaction },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prismaService = module.get<PrismaService>(PrismaService);
    organizationService = module.get<OrganizationService>(OrganizationService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('create()', () => {
    it('should hash password with bcrypt using 12 salt rounds', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'mySecurePassword123',
        organizationName: 'Test Org',
      };
      const hashedPassword = '$2b$12$hashedPasswordValue';

      mockBcrypt.hash.mockResolvedValue(hashedPassword as never);

      const mockUser: User = {
        id: testIds.user,
        email: registerDto.email,
        name: registerDto.name,
        passwordHash: hashedPassword,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: false,
        defaultOrganizationId: null,
        isDemoUser: false,
      };

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback({
            user: {
              create: jest.fn().mockResolvedValue(mockUser),
            },
          });
        },
      );

      // Act
      await service.create(registerDto);

      // Assert
      expect(mockBcrypt.hash).toHaveBeenCalledWith('mySecurePassword123', 12);
      expect(mockBcrypt.hash).toHaveBeenCalledTimes(1);
    });

    it('should store hashed password in database, not raw password', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'rawPassword123',
        organizationName: 'Test Org',
      };
      const hashedPassword = '$2b$12$hashedPasswordValue';

      mockBcrypt.hash.mockResolvedValue(hashedPassword as never);

      let capturedUserData: any;
      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(({ data }) => {
                capturedUserData = data;
                return Promise.resolve({
                  id: testIds.user,
                  ...data,
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  lastLoginAt: null,
                  devAdminMode: false,
                  isDevAdmin: false,
                });
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act
      await service.create(registerDto);

      // Assert
      expect(capturedUserData.passwordHash).toBe(hashedPassword);
      expect(capturedUserData.passwordHash).not.toBe('rawPassword123');
      expect(capturedUserData).not.toHaveProperty('password');
    });
  });

  describe('createBetaUser()', () => {
    it('forwards organizationName verbatim to createOrganizationWithTransaction with no fallback prefix', async () => {
      // Arrange
      const params = {
        email: 'beta@example.com',
        name: 'Beta User',
        organizationName: 'Acme Inc',
      };
      mockBcrypt.hash.mockResolvedValue('hashed' as never);

      const txCreate = jest.fn().mockResolvedValue({
        id: testIds.user,
        email: params.email,
        name: params.name,
        passwordHash: 'hashed',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: true,
        defaultOrganizationId: null,
        isDemoUser: false,
      } as User);
      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (cb) => cb({ user: { create: txCreate } }),
      );
      (
        organizationService.createOrganizationWithTransaction as jest.Mock
      ).mockResolvedValue({
        id: testIds.organization,
        slug: 'acme-inc',
      });

      // Act
      const requestMetadata = {
        ipAddress: '203.0.113.10',
        userAgent: 'user-service-test',
      };
      const result = await service.createBetaUser(params, requestMetadata);

      // Assert — exact org name passed through; no `${name}'s Organization` synthesis
      expect(
        organizationService.createOrganizationWithTransaction,
      ).toHaveBeenCalledTimes(1);
      const [, orgData] = (
        organizationService.createOrganizationWithTransaction as jest.Mock
      ).mock.calls[0];
      expect(orgData.name).toBe('Acme Inc');
      expect(orgData.name).not.toContain("'s Organization");
      expect(orgData).not.toHaveProperty('slug'); // slug is generated downstream
      expect(result.organizationId).toBe(testIds.organization);
      expect(result.passwordChangeCredential).toBe('welcome-token');
      expect(issueInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.user,
        PasswordChangeCredentialKind.RequiredChange,
        requestMetadata,
      );
    });
  });

  describe('createInvitedUser()', () => {
    it('issues the persisted welcome credential in the caller transaction', async () => {
      const requestMetadata = {
        ipAddress: '203.0.113.14',
        userAgent: 'invited-user-test',
      };
      const createdUser = {
        id: testIds.user,
        email: 'invitee@example.com',
        name: 'invitee',
        passwordHash: 'hashed',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: true,
        defaultOrganizationId: null,
        isDemoUser: false,
      } as User;
      const tx = {
        user: { create: jest.fn().mockResolvedValue(createdUser) },
      };
      mockBcrypt.hash.mockResolvedValue('hashed' as never);

      await expect(
        service.createInvitedUser(
          tx as never,
          { email: createdUser.email },
          requestMetadata,
        ),
      ).resolves.toEqual({
        user: createdUser,
        passwordChangeCredential: 'welcome-token',
      });

      expect(issueInTransaction).toHaveBeenCalledWith(
        tx,
        testIds.user,
        PasswordChangeCredentialKind.RequiredChange,
        requestMetadata,
      );
    });
  });

  describe('createOrResumeBetaUserForRequest()', () => {
    it('does not adopt an existing account even when its stored email has different casing', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'request' }]),
        privateBetaAccessRequest: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'request',
            normalizedEmail: 'person@example.com',
            provisionedUserId: null,
            provisioningUserCompletedAt: null,
          }),
        },
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: testIds.user,
              email: 'Person@Example.com',
            }),
          create: jest.fn(),
        },
      };
      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        (operation) => operation(tx),
      );
      await expect(
        service.createOrResumeBetaUserForRequest(
          'request' as PrivateBetaAccessRequestId,
          {},
        ),
      ).rejects.toThrow();
      expect(tx.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'person@example.com', mode: 'insensitive' } },
      });
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(
        organizationService.createOrganizationWithTransaction,
      ).not.toHaveBeenCalled();
    });

    it('creates and checkpoints request-owned resources in resumable stages', async () => {
      const requestId =
        '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;
      const request = {
        id: requestId,
        normalizedEmail: 'beta@example.com',
        name: 'Beta User',
        organizationName: 'Acme Inc',
        status: 'APPROVAL_IN_PROGRESS',
        provisionedUserId: null,
        provisionedOrganizationId: null,
        provisioningUserCompletedAt: null,
        provisioningOrganizationCompletedAt: null,
        provisioningCredentialId: null,
        provisioningCredentialCompletedAt: null,
        provisioningOrganizationApiKeyId: null,
        provisioningOrganizationApiKeyCompletedAt: null,
        welcomeEmailIdempotencyKey: null,
        welcomeEmailSentAt: null,
        provisioningCompletedAt: null,
        provisioningFailureCode: null,
        provisioningError: null,
      };
      const createdUser = {
        id: testIds.user,
        email: request.normalizedEmail,
        name: request.name,
        passwordHash: 'hashed',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: true,
        defaultOrganizationId: null,
        isDemoUser: false,
      } as User;
      const userCheckpointRequest = {
        ...request,
        provisionedUserId: testIds.user,
        provisioningUserCompletedAt: new Date(),
      };
      const organizationCheckpointRequest = {
        ...userCheckpointRequest,
        provisionedOrganizationId: testIds.organization,
        provisioningOrganizationCompletedAt: new Date(),
      };
      const updatedRequest = {
        ...organizationCheckpointRequest,
        provisioningCredentialId: 'credential-row-1',
        provisioningCredentialCompletedAt: new Date(),
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: requestId }]),
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(createdUser),
          create: jest.fn().mockResolvedValue(createdUser),
        },
        organization: {
          findUnique: jest.fn(),
        },
        passwordChangeCredential: {
          findUnique: jest.fn().mockResolvedValue({ id: 'credential-row-1' }),
        },
        privateBetaAccessRequest: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce(request)
            .mockResolvedValueOnce(userCheckpointRequest)
            .mockResolvedValueOnce(userCheckpointRequest)
            .mockResolvedValueOnce(organizationCheckpointRequest)
            .mockResolvedValueOnce(organizationCheckpointRequest)
            .mockResolvedValueOnce(updatedRequest)
            .mockResolvedValue(updatedRequest),
          update: jest.fn().mockResolvedValue(undefined),
        },
      };
      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => callback(tx),
      );
      (
        organizationService.createOrganizationWithTransaction as jest.Mock
      ).mockResolvedValue({ id: testIds.organization });
      mockBcrypt.hash.mockResolvedValue('hashed' as never);

      await expect(
        service.createOrResumeBetaUserForRequest(requestId, {
          ipAddress: '203.0.113.10',
          userAgent: 'request-test',
        }),
      ).resolves.toMatchObject({
        request: {
          provisionedUserId: testIds.user,
          provisionedOrganizationId: testIds.organization,
          provisioningCredentialId: 'credential-row-1',
        },
        user: createdUser,
        organizationId: testIds.organization,
        passwordChangeCredential: 'request-welcome-token',
      });

      expect(issueIdempotentlyInTransaction).toHaveBeenCalledWith(
        tx,
        testIds.user,
        requestId,
        { ipAddress: '203.0.113.10', userAgent: 'request-test' },
      );
      expect(prismaService.db.$transaction).toHaveBeenCalledTimes(3);
      expect(tx.privateBetaAccessRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: requestId },
          data: expect.objectContaining({
            provisioningCredentialId: 'credential-row-1',
          }),
        }),
      );
      expect(createBetaAtAdmissionInTransaction).toHaveBeenCalledWith(
        tx,
        testIds.organization,
        {
          actor: testIds.user,
          reason: `PRIVATE_BETA_ADMISSION:${requestId}`,
        },
      );
    });
  });

  describe('validatePassword()', () => {
    it('should use bcrypt.compare to validate password', async () => {
      // Arrange
      const user: User = {
        id: testIds.user,
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: '$2b$12$hashedPasswordValue',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: false,
        defaultOrganizationId: null,
        isDemoUser: false,
      };
      const providedPassword = 'correctPassword123';

      mockBcrypt.compare.mockResolvedValue(true as never);

      // Act
      const result = await service.validatePassword(user, providedPassword);

      // Assert
      expect(mockBcrypt.compare).toHaveBeenCalledWith(
        providedPassword,
        user.passwordHash,
      );
      expect(mockBcrypt.compare).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('should return true for correct password', async () => {
      // Arrange
      const user: User = {
        id: testIds.user,
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: '$2b$12$hashedPasswordValue',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: false,
        defaultOrganizationId: null,
        isDemoUser: false,
      };

      mockBcrypt.compare.mockResolvedValue(true as never);

      // Act
      const result = await service.validatePassword(user, 'correctPassword');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      // Arrange
      const user: User = {
        id: testIds.user,
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: '$2b$12$hashedPasswordValue',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: false,
        defaultOrganizationId: null,
        isDemoUser: false,
      };

      mockBcrypt.compare.mockResolvedValue(false as never);

      // Act
      const result = await service.validatePassword(user, 'wrongPassword');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('replaceCurrentPasswordInTransaction()', () => {
    it('locks the user, verifies the current password, and updates only the hash', async () => {
      const lockedUser: User = {
        id: testIds.user,
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'current-hash',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        devAdminMode: false,
        isDevAdmin: false,
        mustChangePassword: false,
        defaultOrganizationId: null,
        isDemoUser: false,
      };
      const updatedUser = {
        ...lockedUser,
        passwordHash: 'replacement-hash',
        memberships: [],
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: testIds.user }]),
        user: {
          findUnique: jest.fn().mockResolvedValue(lockedUser),
          update: jest.fn().mockResolvedValue(updatedUser),
        },
      };
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockBcrypt.hash.mockResolvedValue('replacement-hash' as never);

      await expect(
        service.replaceCurrentPasswordInTransaction(
          tx as never,
          testIds.user,
          'current-password',
          'replacement-password',
        ),
      ).resolves.toEqual(updatedUser);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { id: testIds.user },
        select: { isActive: true, passwordHash: true },
      });
      expect(mockBcrypt.compare).toHaveBeenCalledWith(
        'current-password',
        'current-hash',
      );
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: testIds.user },
        data: {
          passwordHash: 'replacement-hash',
          mustChangePassword: false,
        },
        include: {
          memberships: {
            where: { isActive: true },
            include: { organization: true },
          },
        },
      });
    });

    it('rejects the current password before hashing or updating', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: testIds.user }]),
        user: {
          findUnique: jest.fn().mockResolvedValue({
            passwordHash: 'current-hash',
            isActive: true,
          }),
          update: jest.fn(),
        },
      };
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.replaceCurrentPasswordInTransaction(
          tx as never,
          testIds.user,
          'wrong-password',
          'replacement-password',
        ),
      ).rejects.toThrow('Invalid current password');

      expect(mockBcrypt.hash).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });
});
