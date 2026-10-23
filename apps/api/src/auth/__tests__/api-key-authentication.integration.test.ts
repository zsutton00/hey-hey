import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyType } from '@prisma/client';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { FlexibleAuthGuard } from '../guards/flexible-auth.guard';
import { OrganizationGuard } from '../guards/organization.guard';
import { ApiKeyStrategy } from '../strategies/api-key.strategy';
import { ApiKeyService } from '../../services/api-key.service';
import { ProjectAccessService } from '../services/project-access.service';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('API Key Authentication Integration', () => {
  let apiKeyGuard: ApiKeyGuard;
  let flexibleAuthGuard: FlexibleAuthGuard;
  let organizationGuard: OrganizationGuard;
  let apiKeyStrategy: ApiKeyStrategy;
  let apiKeyService: ApiKeyService;

  const mockApiKeyService = TestUtils.createMockApiKeyService();
  const mockProjectAccessService = { assertOrganization: jest.fn() };
  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        FlexibleAuthGuard,
        OrganizationGuard,
        ApiKeyStrategy,
        { provide: ApiKeyService, useValue: mockApiKeyService },
        { provide: ProjectAccessService, useValue: mockProjectAccessService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    apiKeyGuard = module.get<ApiKeyGuard>(ApiKeyGuard);
    flexibleAuthGuard = module.get<FlexibleAuthGuard>(FlexibleAuthGuard);
    organizationGuard = module.get<OrganizationGuard>(OrganizationGuard);
    apiKeyStrategy = module.get<ApiKeyStrategy>(ApiKeyStrategy);
    apiKeyService = module.get<ApiKeyService>(ApiKeyService);

    jest.clearAllMocks();
  });

  describe('ApiKeyStrategy validation', () => {
    const mockRequest = {
      method: 'GET',
      url: '/api/v1/test',
      headers: {},
      query: {},
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as any;

    it('should validate API key from Authorization header', async () => {
      const apiKey = 'hh_agent_service_key_123456789';
      const mockValidatedKey = {
        id: testIds.apiKey,
        organizationId: testIds.organization,
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        scopes: ['agent:execute', 'callback:results', 'read:initiatives'],
        name: 'Agent Service API Key',
        createdBy: testIds.user,
      };

      mockRequest.headers.authorization = `Bearer ${apiKey}`;
      mockApiKeyService.validateApiKey.mockResolvedValue(mockValidatedKey);

      const result = await apiKeyStrategy.validate(mockRequest);

      expect(mockApiKeyService.validateApiKey).toHaveBeenCalledWith(
        apiKey,
        '127.0.0.1',
      );

      expect(result).toMatchObject({
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: expect.arrayContaining(['agent:execute', 'callback:results']),
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Agent Service API Key',
        authType: 'api-key',
      });
    });

    it('should validate API key from X-API-Key header', async () => {
      const apiKey = 'hh_agent_x_header_key_987654321';
      const mockValidatedKey = {
        id: testIds.apiKey,
        organizationId: testIds.organization,
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        scopes: ['read:projects', 'write:initiatives'],
        name: 'Agent Service API Key',
        createdBy: testIds.user,
      };

      mockRequest.headers['x-api-key'] = apiKey;
      delete mockRequest.headers.authorization;
      mockApiKeyService.validateApiKey.mockResolvedValue(mockValidatedKey);

      const result = await apiKeyStrategy.validate(mockRequest);

      expect(result.authType).toBe('api-key');
      expect(result.organizationId).toBe(testIds.organization);
    });

    it('should reject non-hh prefixed tokens in Authorization header', async () => {
      mockRequest.headers.authorization = 'Bearer jwt-token-without-hh-prefix';
      delete mockRequest.headers['x-api-key'];

      await expect(apiKeyStrategy.validate(mockRequest)).rejects.toThrow(
        'No API key provided',
      );
    });

    it('should handle API key validation failures', async () => {
      const apiKey = 'hh_invalid_key_123';
      mockRequest.headers.authorization = `Bearer ${apiKey}`;
      mockApiKeyService.validateApiKey.mockRejectedValue(
        new Error('Invalid API key'),
      );

      await expect(apiKeyStrategy.validate(mockRequest)).rejects.toThrow(
        'Invalid API key',
      );
    });
  });

  describe('OrganizationGuard with API key authentication', () => {
    const createMockExecutionContext = (user: any, organizationId: string) => ({
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params: { organizationId },
          method: 'GET',
          url: '/api/v1/test',
        }),
      }),
    });

    it('should allow access for API key with matching organization', async () => {
      const apiKeyUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['read:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Key',
        authType: 'api-key' as const,
      };

      const context = createMockExecutionContext(
        apiKeyUser,
        testIds.organization,
      );

      const result = await organizationGuard.canActivate(
        context as ExecutionContext,
      );

      expect(result).toBe(true);
      expect(mockProjectAccessService.assertOrganization).toHaveBeenCalledWith(
        testIds.user,
        testIds.organization,
      );
    });

    it('should deny access for API key with different organization', async () => {
      const apiKeyUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['read:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Key',
        authType: 'api-key' as const,
      };

      const context = createMockExecutionContext(
        apiKeyUser,
        'different-org-id',
      );

      await expect(
        organizationGuard.canActivate(context as ExecutionContext),
      ).rejects.toThrow('API key does not have access to this organization');
      expect(
        mockProjectAccessService.assertOrganization,
      ).not.toHaveBeenCalled();
    });

    it('should handle missing organizationId parameter', async () => {
      const apiKeyUser = {
        userId: testIds.user,
        organizationId: testIds.organization,
        scopes: ['read:initiatives'],
        apiKeyId: testIds.apiKey,
        apiKeyName: 'Test Key',
        authType: 'api-key' as const,
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: apiKeyUser,
            params: {}, // No organizationId
            method: 'GET',
            url: '/api/v1/test',
          }),
        }),
      };

      await expect(
        organizationGuard.canActivate(context as ExecutionContext),
      ).rejects.toThrow('Organization ID not provided');
      expect(
        mockProjectAccessService.assertOrganization,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Agent callback authentication flow', () => {
    it('should authenticate agent service API key for callback endpoint', async () => {
      const apiKey = 'hh_callback_test_key_555666777';
      const mockRequest = {
        method: 'POST',
        url: '/api/callbacks/agents',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        ip: '10.0.0.1',
        connection: { remoteAddress: '10.0.0.1' },
        body: {
          executionId: 'exec-callback-test',
          agentId: 'initiative-refiner',
          status: 'completed',
          result: { test: 'data' },
          executionTime: 5000,
          timestamp: new Date().toISOString(),
        },
      } as any;

      const mockValidatedKey = {
        id: testIds.apiKey,
        organizationId: testIds.organization,
        keyType: ApiKeyType.MASTRA_AI,
        serviceType: 'agent-service',
        scopes: ['callback:results', 'agent:execute'],
        name: 'Agent Service Callback Key',
        createdBy: testIds.user,
      };

      mockApiKeyService.validateApiKey.mockResolvedValue(mockValidatedKey);

      const authenticatedUser = await apiKeyStrategy.validate(mockRequest);

      expect(authenticatedUser).toMatchObject({
        authType: 'api-key',
        organizationId: testIds.organization,
        scopes: expect.arrayContaining(['callback:results']),
      });

      // Verify the user has callback permissions
      expect(authenticatedUser.scopes).toContain('callback:results');
    });

    it('should handle scope validation for different agent permissions', () => {
      const testCases = [
        {
          scopes: ['read:initiatives', 'write:initiatives'],
          requiredScopes: ['read:initiatives'],
          shouldPass: true,
        },
        {
          scopes: ['read:projects', 'read:conversations'],
          requiredScopes: ['write:initiatives'],
          shouldPass: false,
        },
        {
          scopes: ['admin:org'],
          requiredScopes: ['read:initiatives', 'write:messages'],
          shouldPass: true, // admin:org grants all permissions
        },
        {
          scopes: ['callback:results'],
          requiredScopes: ['callback:results'],
          shouldPass: true,
        },
      ];

      testCases.forEach(({ scopes, requiredScopes, shouldPass }, index) => {
        const hasRequiredScopes = requiredScopes.every(
          (scope) => scopes.includes(scope) || scopes.includes('admin:org'),
        );

        expect(hasRequiredScopes).toBe(shouldPass);
      });
    });
  });

  describe('Full authentication flow integration', () => {
    it('should complete full agent service authentication for data access', async () => {
      const agentApiKey = 'hh_full_agent_key_888999000';

      // Step 1: API key validation
      const mockValidatedKey = {
        id: testIds.apiKey,
        organizationId: testIds.organization,
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
          'agent:execute',
          'callback:results',
        ],
        name: 'Full Agent Service Key',
        createdBy: testIds.user,
      };

      mockApiKeyService.validateApiKey.mockResolvedValue(mockValidatedKey);

      const mockRequest = {
        method: 'GET',
        url: `/api/v1/organizations/${testIds.organization}/initiatives`,
        headers: { authorization: `Bearer ${agentApiKey}` },
        params: { organizationId: testIds.organization },
        ip: '192.168.1.100',
        connection: { remoteAddress: '192.168.1.100' },
      } as any;

      // Step 2: Strategy validation
      const authenticatedUser = await apiKeyStrategy.validate(mockRequest);

      expect(authenticatedUser.authType).toBe('api-key');
      expect(authenticatedUser.organizationId).toBe(testIds.organization);

      // Step 3: Organization guard validation
      mockRequest.user = authenticatedUser;

      const orgContext = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as ExecutionContext;

      const orgAccessAllowed = await organizationGuard.canActivate(orgContext);
      expect(orgAccessAllowed).toBe(true);

      // Step 4: Verify comprehensive scopes
      const requiredScopes = [
        'read:initiatives',
        'write:initiatives',
        'read:messages',
        'write:messages',
        'agent:execute',
        'callback:results',
      ];

      const hasAllScopes = requiredScopes.every((scope) =>
        authenticatedUser.scopes.includes(scope),
      );

      expect(hasAllScopes).toBe(true);
    });

    it('should reject authentication for inactive API keys', async () => {
      const inactiveApiKey = 'hh_inactive_key_111222333';

      mockApiKeyService.validateApiKey.mockRejectedValue(
        new Error('API key is inactive'),
      );

      const mockRequest = {
        method: 'GET',
        url: '/api/v1/test',
        headers: { authorization: `Bearer ${inactiveApiKey}` },
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' },
      } as any;

      await expect(apiKeyStrategy.validate(mockRequest)).rejects.toThrow(
        'Invalid API key',
      );
    });
  });
});
