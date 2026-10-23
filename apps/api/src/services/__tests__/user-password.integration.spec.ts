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
import { AccountEntitlementService } from '../account-entitlement.service';

describe('UserService - Password Integration Tests', () => {
  let service: UserService;
  let prismaService: PrismaService;
  let organizationService: OrganizationService;
  let issueInTransaction: jest.Mock;
  const { testIds } = TestUtils;

  jest.setTimeout(30000);

  beforeEach(async () => {
    issueInTransaction = jest.fn().mockResolvedValue('welcome-token');
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
              },
              $transaction: jest.fn(),
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
            createBetaAtAdmissionInTransaction: jest.fn(),
          },
        },
        {
          provide: PASSWORD_CHANGE_CREDENTIAL_ISSUER,
          useValue: { issueInTransaction },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prismaService = module.get<PrismaService>(PrismaService);
    organizationService = module.get<OrganizationService>(OrganizationService);

    jest.clearAllMocks();
  });

  describe('Full Authentication Flow', () => {
    it('should create user with hashed password that can be validated', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'integration@example.com',
        name: 'Integration Test User',
        password: 'mySecurePassword123!',
        organizationName: 'Test Org',
      };

      let storedPasswordHash: string | undefined;

      // Mock the transaction to capture the hashed password
      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => {
                storedPasswordHash = data.passwordHash;

                const createdUser: User = {
                  id: testIds.user,
                  email: data.email,
                  name: data.name,
                  passwordHash: data.passwordHash,
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
                return createdUser;
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act - Create user
      const createdUser = await service.create(registerDto);

      // Assert - Password should be hashed
      if (!storedPasswordHash) {
        throw new Error('Expected stored password hash');
      }
      expect(storedPasswordHash).toBeDefined();
      expect(storedPasswordHash).not.toBe(registerDto.password);
      expect(storedPasswordHash).toMatch(/^\$2b\$/); // bcrypt hash format
      expect(createdUser.passwordHash).toBe(storedPasswordHash);

      // Act - Validate with correct password (using real bcrypt)
      const isValidCorrect = await service.validatePassword(
        createdUser,
        registerDto.password,
      );

      // Assert - Should validate successfully
      expect(isValidCorrect).toBe(true);

      // Act - Validate with incorrect password
      const isValidIncorrect = await service.validatePassword(
        createdUser,
        'wrongPassword',
      );

      // Assert - Should fail validation
      expect(isValidIncorrect).toBe(false);
    });

    it('should never store raw password in database', async () => {
      // Arrange
      const rawPassword = 'plainTextPassword123';
      const registerDto: RegisterDto = {
        email: 'security@example.com',
        name: 'Security Test User',
        password: rawPassword,
        organizationName: 'Test Org',
      };

      let capturedData: any;

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => {
                capturedData = data;
                return {
                  id: testIds.user,
                  ...data,
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  lastLoginAt: null,
                  devAdminMode: false,
                  isDevAdmin: false,
                  mustChangePassword: false,
                  defaultOrganizationId: null,
                  isDemoUser: false,
                };
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act
      await service.create(registerDto);

      // Assert
      expect(capturedData.passwordHash).toBeDefined();
      expect(capturedData.passwordHash).not.toBe(rawPassword);
      expect(capturedData).not.toHaveProperty('password');

      // Verify it's a valid bcrypt hash
      const isValidHash = capturedData.passwordHash.match(
        /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/,
      );
      expect(isValidHash).toBeTruthy();
    });

    it('should use 12 salt rounds as specified in security requirements', async () => {
      // Arrange
      const registerDto: RegisterDto = {
        email: 'rounds@example.com',
        name: 'Rounds Test User',
        password: 'testPassword123',
        organizationName: 'Test Org',
      };

      let hashedPassword: string | undefined;

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => {
                hashedPassword = data.passwordHash;
                return {
                  id: testIds.user,
                  ...data,
                  isActive: true,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  lastLoginAt: null,
                  devAdminMode: false,
                  isDevAdmin: false,
                  mustChangePassword: false,
                  defaultOrganizationId: null,
                  isDemoUser: false,
                };
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act
      await service.create(registerDto);

      // Assert - Extract salt rounds from bcrypt hash
      // Bcrypt hash format: $2b$12$... where 12 is the rounds
      if (!hashedPassword) {
        throw new Error('Expected hashed password');
      }
      const roundsMatch = hashedPassword.match(/^\$2[aby]\$(\d{2})\$/);
      if (!roundsMatch) {
        throw new Error('Expected password rounds match');
      }
      expect(roundsMatch).toBeTruthy();
      expect(roundsMatch[1]).toBe('12');
    });

    it('should handle special characters in passwords correctly', async () => {
      // Arrange
      const passwordWithSpecialChars = 'P@ssw0rd!#$%^&*()_+-=[]{}|;:,.<>?';
      const registerDto: RegisterDto = {
        email: 'special@example.com',
        name: 'Special Chars User',
        password: passwordWithSpecialChars,
        organizationName: 'Test Org',
      };

      let createdUser: User | undefined;

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => {
                createdUser = {
                  id: testIds.user,
                  email: data.email,
                  name: data.name,
                  passwordHash: data.passwordHash,
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
                return createdUser;
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act
      await service.create(registerDto);

      // Assert - Should validate with exact special character match
      if (!createdUser) {
        throw new Error('Expected created user');
      }
      const isValid = await service.validatePassword(
        createdUser,
        passwordWithSpecialChars,
      );
      expect(isValid).toBe(true);

      // Should fail with slightly different special chars
      const isInvalid = await service.validatePassword(
        createdUser,
        'P@ssw0rd!#$%^&*()_+-=[]{}|;:,.<>/',
      ); // Changed ? to /
      expect(isInvalid).toBe(false);
    });

    it('createBetaUser passes organizationName through verbatim and applies no fallback', async () => {
      // Arrange
      const params = {
        email: 'beta-int@example.com',
        name: 'Beta Integration User',
        organizationName: 'Acme Inc',
      };

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => ({
                id: testIds.user,
                ...data,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                lastLoginAt: null,
                devAdminMode: false,
                isDevAdmin: false,
              })),
            },
          };
          return callback(mockTx);
        },
      );
      (
        organizationService.createOrganizationWithTransaction as jest.Mock
      ).mockResolvedValue({ id: testIds.organization, slug: 'acme-inc' });

      // Act
      const requestMetadata = {
        ipAddress: '203.0.113.11',
        userAgent: 'user-integration-test',
      };
      const result = await service.createBetaUser(params, requestMetadata);

      // Assert
      const [, orgData] = (
        organizationService.createOrganizationWithTransaction as jest.Mock
      ).mock.calls[0];
      expect(orgData.name).toBe('Acme Inc');
      expect(orgData.name).not.toContain("'s Organization");
      expect(result.organizationId).toBe(testIds.organization);
      expect(result.passwordChangeCredential).toBe('welcome-token');
      expect(issueInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        testIds.user,
        PasswordChangeCredentialKind.RequiredChange,
        requestMetadata,
      );
    });

    it('should validate password is case-sensitive', async () => {
      // Arrange
      const password = 'CaseSensitivePassword123';
      const registerDto: RegisterDto = {
        email: 'case@example.com',
        name: 'Case Test User',
        password,
        organizationName: 'Test Org',
      };

      let createdUser: User | undefined;

      (prismaService.db.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            user: {
              create: jest.fn().mockImplementation(async ({ data }) => {
                createdUser = {
                  id: testIds.user,
                  email: data.email,
                  name: data.name,
                  passwordHash: data.passwordHash,
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
                return createdUser;
              }),
            },
          };
          return callback(mockTx);
        },
      );

      // Act
      await service.create(registerDto);

      // Assert
      if (!createdUser) {
        throw new Error('Expected created user');
      }
      const validExact = await service.validatePassword(createdUser, password);
      expect(validExact).toBe(true);

      const invalidLowercase = await service.validatePassword(
        createdUser,
        password.toLowerCase(),
      );
      expect(invalidLowercase).toBe(false);

      const invalidUppercase = await service.validatePassword(
        createdUser,
        password.toUpperCase(),
      );
      expect(invalidUppercase).toBe(false);
    });
  });
});
