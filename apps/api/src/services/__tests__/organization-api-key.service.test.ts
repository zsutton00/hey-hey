import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyType } from '@prisma/client';
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

describe('OrganizationService - API Key Integration', () => {
  let organizationService: OrganizationService;
  let apiKeyService: ApiKeyService;
  let prisma: PrismaService;

  const mockPrismaBase = TestUtils.createMockPrismaService() as any;
  const mockPrisma = {
    ...mockPrismaBase,
    db: {
      ...mockPrismaBase.db,
      $transaction: jest.fn(),
    },
  };
  const mockApiKeyService = TestUtils.createMockApiKeyService();
  const mockSecurityLogger = TestUtils.createMockSecurityLoggerService();

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
        { provide: ApiKeyService, useValue: mockApiKeyService },
        { provide: SecurityLoggerService, useValue: mockSecurityLogger },
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
    apiKeyService = module.get<ApiKeyService>(ApiKeyService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createOrganization with API key generation', () => {
    const createOrgDto = {
      name: 'Test Organization',
      slug: 'test-org',
      description: 'Test organization for API key testing',
    };

    const mockOrganization = {
      id: testIds.organization,
      name: createOrgDto.name,
      slug: createOrgDto.slug,
      description: createOrgDto.description,
      isActive: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockApiKey = {
      id: testIds.apiKey,
      key: 'hh_test_agent_service_key_123456789',
      prefix: 'hh_test_',
      name: 'Agent Service API Key',
      description:
        'Auto-generated key for agent service data access and callbacks',
      keyType: ApiKeyType.MASTRA_AI,
      serviceType: 'agent-service',
      scopes: [
        'read:projects',
        'read:initiatives',
        'write:initiatives',
        'read:conversations',
        'read:messages',
        'write:messages',
        'read:artifacts',
        'write:artifacts',
        'read:tasks',
        'write:tasks',
        'read:tags',
        'read:members',
        'agent:execute',
        'callback:results',
      ],
      expiresAt: null as Date | null,
      createdAt: new Date(),
      isActive: true,
    };

    beforeEach(() => {
      // Mock the transaction to return the organization
      mockPrisma.db.$transaction.mockImplementation((callback: any) => {
        return callback(mockPrisma.db);
      });

      // Mock organization creation within transaction
      mockPrisma.db.organizationMember.create.mockResolvedValue({
        id: 'member-1',
        userId: testIds.user,
        organizationId: testIds.organization,
        role: 'OWNER',
        isActive: true,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.db.organization.create.mockResolvedValue(mockOrganization);
      mockPrisma.db.user.findUnique.mockResolvedValue({
        id: 'system-user',
        email: 'system@hey-hey.com',
        name: 'System User',
      });
    });

    it('should create API key after successful organization creation', async () => {
      mockApiKeyService.createMastraApiKey.mockResolvedValue(mockApiKey);

      const result = await organizationService.createOrganization(
        createOrgDto,
        testIds.user,
      );

      expect(result).toMatchObject({
        id: testIds.organization,
        name: createOrgDto.name,
        slug: createOrgDto.slug,
        userRole: 'OWNER',
        memberCount: 1,
      });

      expect(mockApiKeyService.createMastraApiKey).toHaveBeenCalledWith(
        testIds.organization,
        testIds.user,
      );
    });

    it('should succeed even if API key creation fails', async () => {
      const keyError = new Error('API key service temporarily unavailable');
      mockApiKeyService.createMastraApiKey.mockRejectedValue(keyError);

      // Organization creation should still succeed
      const result = await organizationService.createOrganization(
        createOrgDto,
        testIds.user,
      );

      expect(result).toMatchObject({
        id: testIds.organization,
        name: createOrgDto.name,
        slug: createOrgDto.slug,
      });

      // Should log the error but not fail
      expect(mockApiKeyService.createMastraApiKey).toHaveBeenCalledWith(
        testIds.organization,
        testIds.user,
      );
    });

    it('should rollback organization creation if transaction fails', async () => {
      const transactionError = new Error('Database transaction failed');
      mockPrisma.db.$transaction.mockRejectedValue(transactionError);

      await expect(
        organizationService.createOrganization(createOrgDto, testIds.user),
      ).rejects.toThrow(transactionError);

      // API key creation should not be attempted if transaction fails
      expect(mockApiKeyService.createMastraApiKey).not.toHaveBeenCalled();
    });

    it('should create API key with correct parameters', async () => {
      mockApiKeyService.createMastraApiKey.mockResolvedValue(mockApiKey);

      await organizationService.createOrganization(createOrgDto, testIds.user);

      expect(mockApiKeyService.createMastraApiKey).toHaveBeenCalledWith(
        expect.any(String), // organizationId (generated UUID)
        testIds.user, // createdBy
      );

      const [firstCall] = mockApiKeyService.createMastraApiKey.mock.calls;
      if (!firstCall) {
        throw new Error('Expected createMastraApiKey call');
      }
      const [organizationId, createdBy] = firstCall;
      expect(typeof organizationId).toBe('string');
      expect(createdBy).toBe(testIds.user);
    });
  });

  describe('API key creation logging', () => {
    it('should log successful API key creation', async () => {
      const logSpy = jest
        .spyOn(organizationService['logger'], 'log')
        .mockImplementation();
      const debugSpy = jest
        .spyOn(organizationService['logger'], 'debug')
        .mockImplementation();

      const createOrgDto = {
        name: 'Logging Test Org',
        slug: 'logging-test-org',
      };

      mockPrisma.db.$transaction.mockImplementation((callback: any) => {
        return callback(mockPrisma.db);
      });

      mockPrisma.db.organization.create.mockResolvedValue({
        id: testIds.organization,
        name: createOrgDto.name,
        slug: createOrgDto.slug,
        isActive: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.db.organizationMember.create.mockResolvedValue({
        id: 'member-1',
        userId: testIds.user,
        organizationId: testIds.organization,
        role: 'OWNER',
        isActive: true,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.db.user.findUnique.mockResolvedValue({
        id: 'system-user',
        email: 'system@hey-hey.com',
        name: 'System User',
      });

      mockApiKeyService.createMastraApiKey.mockResolvedValue({
        id: testIds.apiKey,
        key: 'test-key',
        prefix: 'hh_test_',
        name: 'Agent Service API Key',
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        scopes: ['agent:execute'],
        createdAt: new Date(),
        isActive: true,
      });

      await organizationService.createOrganization(createOrgDto, testIds.user);

      expect(debugSpy).toHaveBeenCalledWith(
        '[createOrganization] creating Mastra.ai API key',
        expect.objectContaining({
          organizationId: expect.any(String),
          createdBy: testIds.user,
        }),
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Successfully created Mastra.ai API key for organization',
        ),
      );

      logSpy.mockRestore();
      debugSpy.mockRestore();
    });

    it('should log API key creation failures', async () => {
      const errorSpy = jest
        .spyOn(organizationService['logger'], 'error')
        .mockImplementation();

      const createOrgDto = {
        name: 'Error Test Org',
        slug: 'error-test-org',
      };

      mockPrisma.db.$transaction.mockImplementation((callback: any) => {
        return callback(mockPrisma.db);
      });

      mockPrisma.db.organization.create.mockResolvedValue({
        id: testIds.organization,
        name: createOrgDto.name,
        slug: createOrgDto.slug,
        isActive: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.db.organizationMember.create.mockResolvedValue({
        id: 'member-1',
        userId: testIds.user,
        organizationId: testIds.organization,
        role: 'OWNER',
        isActive: true,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.db.user.findUnique.mockResolvedValue({
        id: 'system-user',
        email: 'system@hey-hey.com',
        name: 'System User',
      });

      const keyError = new Error('Key generation failed');
      mockApiKeyService.createMastraApiKey.mockRejectedValue(keyError);

      await organizationService.createOrganization(createOrgDto, testIds.user);

      expect(errorSpy).toHaveBeenCalledWith(
        '[createOrganization] failed to create Mastra.ai API key',
        expect.objectContaining({
          error: 'Key generation failed',
          organizationId: expect.any(String),
          userId: testIds.user,
        }),
      );

      errorSpy.mockRestore();
    });
  });
});
