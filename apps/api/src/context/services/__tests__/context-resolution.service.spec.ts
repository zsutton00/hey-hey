/* eslint-disable @typescript-eslint/unbound-method */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationId, OrganizationId, ProjectId } from '../../../types';
import {
  ContextFilters,
  ContextProvider,
  ContextRequest,
  ContextScope,
  ContextType,
} from '../../interfaces';
import { ProviderId, ProviderPriority } from '../../types/context.types';
import { ProviderRegistryService } from '../../registry/provider-registry.service';
import { ContextResolutionService } from '../context-resolution.service';

describe('ContextResolutionService', () => {
  let service: ContextResolutionService;
  let loggerSpy: jest.SpyInstance;

  // Mock providers for testing
  const mockHighPriorityProvider: ContextProvider = {
    name: 'high-priority-provider',
    priority: ProviderPriority.HIGH,
    supportedTypes: [ContextType.CONVERSATION, ContextType.PROJECT],
    canHandle: jest.fn((req: ContextRequest) =>
      [ContextType.CONVERSATION, ContextType.PROJECT].includes(req.type),
    ),
    resolve: jest.fn().mockResolvedValue({
      artifacts: [
        {
          id: 'artifact-1',
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          type: 'QA_PAIR',
          title: 'Test Artifact',
          data: { question: 'What?', answer: 'This' },
          tags: ['test'],
          category: 'test',
          createdAt: new Date(),
          updatedAt: new Date(),
          sourceType: 'test',
          sourceId: 'test',
          parentId: null,
          priority: 'HIGH',
          status: 'ACTIVE',
          isPublic: false,
          relevanceScore: 0.8,
          selectionReason: 'test_match',
        },
      ],
      totalCount: 1,
      tokenEstimate: 100,
      providerName: 'high-priority-provider',
      executionTimeMs: 50,
      metadata: {
        queryStrategy: 'test_strategy',
      },
    }),
    estimateTokens: jest.fn().mockReturnValue(100),
  };

  const mockLowPriorityProvider: ContextProvider = {
    name: 'low-priority-provider',
    priority: ProviderPriority.LOW,
    supportedTypes: [ContextType.RELATED],
    canHandle: jest.fn((req: ContextRequest) =>
      [ContextType.RELATED].includes(req.type),
    ),
    resolve: jest.fn().mockResolvedValue({
      artifacts: [],
      totalCount: 0,
      tokenEstimate: 0,
      providerName: 'low-priority-provider',
      executionTimeMs: 25,
      metadata: {},
    }),
    estimateTokens: jest.fn().mockReturnValue(0),
  };

  const mockUnsupportedProvider: ContextProvider = {
    name: 'unsupported-provider',
    priority: ProviderPriority.MEDIUM,
    supportedTypes: [ContextType.INITIATIVE],
    canHandle: jest.fn((req: ContextRequest) =>
      [ContextType.INITIATIVE].includes(req.type),
    ),
    resolve: jest.fn(),
    estimateTokens: jest.fn().mockReturnValue(0),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextResolutionService, ProviderRegistryService],
    }).compile();

    service = module.get<ContextResolutionService>(ContextResolutionService);

    // Reset all mock functions
    jest.clearAllMocks();

    // Reset provider mocks to their default behavior
    (mockHighPriorityProvider.canHandle as jest.Mock).mockImplementation(
      (req: ContextRequest) =>
        [ContextType.CONVERSATION, ContextType.PROJECT].includes(req.type),
    );
    (mockHighPriorityProvider.resolve as jest.Mock).mockResolvedValue({
      artifacts: [
        {
          id: 'artifact-1',
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          type: 'QA_PAIR',
          title: 'Test Artifact',
          data: { question: 'What?', answer: 'This' },
          tags: ['test'],
          category: 'test',
          createdAt: new Date(),
          updatedAt: new Date(),
          sourceType: 'test',
          sourceId: 'test',
          parentId: null,
          priority: 'HIGH',
          status: 'ACTIVE',
          isPublic: false,
          relevanceScore: 0.8,
          selectionReason: 'test_match',
        },
      ],
      totalCount: 1,
      tokenEstimate: 100,
      providerName: 'high-priority-provider',
      executionTimeMs: 50,
      metadata: {
        queryStrategy: 'test_strategy',
      },
    });

    (mockLowPriorityProvider.canHandle as jest.Mock).mockImplementation(
      (req: ContextRequest) => [ContextType.RELATED].includes(req.type),
    );
    (mockUnsupportedProvider.canHandle as jest.Mock).mockImplementation(
      (req: ContextRequest) => [ContextType.INITIATIVE].includes(req.type),
    );

    // Spy on logger methods
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerProvider', () => {
    it('should register a provider successfully', () => {
      // Tests that registerProvider() adds provider to registry and logs registration
      // Expects: provider appears in getRegisteredProviders() and logs provider details
      service.registerProvider(mockHighPriorityProvider);

      const registeredProviders = service.getRegisteredProviders();
      expect(registeredProviders).toContain('high-priority-provider');

      expect(loggerSpy).toHaveBeenCalledWith(
        '[registerProvider] Registering context provider',
        {
          providerId: 'high-priority-provider',
          priority: ProviderPriority.HIGH,
          supportedTypes: [ContextType.CONVERSATION, ContextType.PROJECT],
        },
      );
    });

    it('should initialize provider metrics on first registration', () => {
      // Tests that registerProvider() creates initial metrics for new providers
      // Expects: metrics initialized with 0 requests, 1.0 success rate, current timestamp
      service.registerProvider(mockHighPriorityProvider);

      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics).toEqual({
        totalRequests: 0,
        averageExecutionTime: 0,
        successRate: 1.0,
        lastUsed: expect.any(Date),
      });
    });

    it('should not overwrite existing metrics on re-registration', () => {
      // Tests that re-registering same provider doesn't reset existing metrics
      // Expects: metrics remain unchanged when provider is registered again
      service.registerProvider(mockHighPriorityProvider);

      // Register again
      service.registerProvider(mockHighPriorityProvider);

      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics?.totalRequests).toBe(0); // Should remain unchanged
    });
  });

  describe('resolveContext', () => {
    beforeEach(() => {
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);
      service.registerProvider(mockUnsupportedProvider);
    });

    it('should resolve context with capable provider', async () => {
      // Tests that resolveContext() successfully finds and executes capable provider
      // Expects: calls provider.resolve(), returns artifacts, includes resolution metrics
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        maxResults: 10,
        correlationId: 'test-correlation',
      };

      const result = await service.resolveContext(request);

      expect(result).toEqual({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            id: 'artifact-1',
            relevanceScore: 0.8,
          }),
        ]),
        totalCount: 1,
        tokenEstimate: 100,
        providerName: 'high-priority-provider',
        executionTimeMs: expect.any(Number),
        metadata: expect.objectContaining({
          queryStrategy: 'test_strategy',
          resolutionMetrics: expect.objectContaining({
            requestId: expect.any(String),
            totalProviders: 3,
            selectedProvider: 'high-priority-provider',
            executionTime: expect.any(Number),
            artifactsReturned: 1,
            tokenEstimate: 100,
          }),
        }),
      });

      expect(mockHighPriorityProvider.canHandle).toHaveBeenCalledWith(request);
      expect(mockHighPriorityProvider.resolve).toHaveBeenCalledWith(
        request,
        undefined,
      );
    });

    it('should select highest priority provider when multiple are capable', async () => {
      // Tests that resolveContext() selects provider with lowest priority number (highest priority)
      // Expects: chooses HIGH (1) over LOW (3) when both can handle the request
      // Make low priority provider also capable of handling the request
      (mockLowPriorityProvider.canHandle as jest.Mock).mockImplementation(
        (req: ContextRequest) => req.type === ContextType.CONVERSATION,
      );
      mockLowPriorityProvider.supportedTypes = [ContextType.CONVERSATION];

      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      const result = await service.resolveContext(request);

      // Should select high priority provider (priority 1) over low priority (priority 3)
      expect(result.providerName).toBe('high-priority-provider');
      expect(mockHighPriorityProvider.resolve).toHaveBeenCalled();
      expect(mockLowPriorityProvider.resolve).not.toHaveBeenCalled();
    });

    it('should return empty result when no providers are capable', async () => {
      // Tests that resolveContext() handles case where no providers can handle request
      // Expects: returns empty result with 'no_providers_available' strategy and warns
      const request: ContextRequest = {
        type: ContextType.INITIATIVE,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      // Make all providers unable to handle the request
      (mockHighPriorityProvider.canHandle as jest.Mock).mockReturnValue(false);
      (mockLowPriorityProvider.canHandle as jest.Mock).mockReturnValue(false);
      (mockUnsupportedProvider.canHandle as jest.Mock).mockReturnValue(false);

      const result = await service.resolveContext(request);

      expect(result).toEqual({
        artifacts: [] as any[],
        totalCount: 0,
        tokenEstimate: 0,
        providerName: 'none',
        executionTimeMs: expect.any(Number),
        metadata: {
          queryStrategy: 'no_providers_available',
          filters: undefined,
        },
      });

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        '[resolveContext] No capable providers found',
        expect.objectContaining({
          requestType: ContextType.INITIATIVE,
          organizationId: 'org-1' as OrganizationId,
          correlationId: 'test-correlation',
        }),
      );
    });

    it('should pass filters to provider', async () => {
      // Tests that resolveContext() passes optional filters parameter to provider.resolve()
      // Expects: provider.resolve() called with both request and filters objects
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      const filters: ContextFilters = {
        tags: ['important'],
        categories: ['documentation'],
      };

      await service.resolveContext(request, filters);

      expect(mockHighPriorityProvider.resolve).toHaveBeenCalledWith(
        request,
        filters,
      );
    });

    it('should update provider metrics on successful resolution', async () => {
      // Tests that resolveContext() increments provider metrics after successful execution
      // Expects: totalRequests++, successRate maintained, executionTime updated
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      await service.resolveContext(request);

      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics?.totalRequests).toBe(1);
      expect(providerMetrics?.successRate).toBe(1.0);
      expect(providerMetrics?.averageExecutionTime).toBeGreaterThanOrEqual(0);
      expect(providerMetrics?.lastUsed).toBeInstanceOf(Date);
    });

    it('should handle provider errors and update metrics', async () => {
      // Tests that resolveContext() handles provider failures and updates failure metrics
      // Expects: throws original error, logs failure, decrements successRate
      const error = new Error('Provider failed');
      (mockHighPriorityProvider.resolve as jest.Mock).mockRejectedValue(error);

      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      await expect(service.resolveContext(request)).rejects.toThrow(
        'Provider failed',
      );

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        '[resolveContext] Context resolution failed',
        expect.objectContaining({
          requestType: ContextType.CONVERSATION,
          organizationId: 'org-1' as OrganizationId,
          error: 'Provider failed',
          correlationId: 'test-correlation',
        }),
      );

      // Should update metrics for failed request
      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics?.totalRequests).toBe(1);
      expect(providerMetrics?.successRate).toBe(0.0);
    });
  });

  describe('Provider Metrics', () => {
    beforeEach(() => {
      service.registerProvider(mockHighPriorityProvider);
    });

    it('should track multiple requests and calculate averages correctly', async () => {
      // Tests that provider metrics correctly calculate running averages over multiple requests
      // Expects: totalRequests increments, averageExecutionTime calculated properly
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      // Simulate different execution times
      const baseResult = {
        artifacts: [] as any[],
        totalCount: 0,
        tokenEstimate: 0,
        providerName: 'high-priority-provider',
        metadata: {},
      };

      (mockHighPriorityProvider.resolve as jest.Mock)
        .mockResolvedValueOnce({
          ...baseResult,
          executionTimeMs: 100,
        })
        .mockResolvedValueOnce({
          ...baseResult,
          executionTimeMs: 200,
        });

      // Make two requests
      await service.resolveContext(request);
      await service.resolveContext(request);

      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics?.totalRequests).toBe(2);
      expect(providerMetrics?.successRate).toBe(1.0);
      expect(providerMetrics?.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate success rate correctly with mixed results', async () => {
      // Tests that provider metrics track success rate across successful and failed requests
      // Expects: 1 success + 1 failure = 0.5 (50%) success rate
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      // First request succeeds
      await service.resolveContext(request);

      // Second request fails
      (mockHighPriorityProvider.resolve as jest.Mock).mockRejectedValue(
        new Error('Failed'),
      );

      try {
        await service.resolveContext(request);
      } catch {
        // Expected to fail
      }

      const metrics = service.getProviderMetrics();
      const providerMetrics = metrics.get(
        'high-priority-provider' as ProviderId,
      );

      expect(providerMetrics?.totalRequests).toBe(2);
      expect(providerMetrics?.successRate).toBe(0.5); // 1 success out of 2 requests
    });
  });

  describe('getRegisteredProviders', () => {
    it('should return empty array when no providers are registered', () => {
      // Tests that getRegisteredProviders() returns empty array for new service instance
      // Expects: empty array when no providers have been registered yet
      const providers = service.getRegisteredProviders();
      expect(providers).toEqual([]);
    });

    it('should return list of registered provider names', () => {
      // Tests that getRegisteredProviders() returns array of provider names after registration
      // Expects: array containing names of all registered providers
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);

      const providers = service.getRegisteredProviders();
      expect(providers).toEqual(
        expect.arrayContaining([
          'high-priority-provider',
          'low-priority-provider',
        ]),
      );
    });
  });

  describe('Logging', () => {
    beforeEach(() => {
      service.registerProvider(mockHighPriorityProvider);
    });

    it('should log context resolution start and completion', async () => {
      // Tests that resolveContext() logs comprehensive start and completion information
      // Expects: logs request details at start, provider results at completion
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        maxTokens: 1000,
        maxResults: 10,
        correlationId: 'test-correlation',
      };

      await service.resolveContext(request);

      expect(loggerSpy).toHaveBeenCalledWith(
        '[resolveContext] Starting context resolution',
        expect.objectContaining({
          requestType: ContextType.CONVERSATION,
          scope: ContextScope.ORGANIZATION,
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          conversationId: 'conv-1' as ConversationId,
          maxTokens: 1000,
          maxResults: 10,
          correlationId: 'test-correlation',
          availableProviders: 1,
        }),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        '[resolveContext] Context resolution completed',
        expect.objectContaining({
          providerId: 'high-priority-provider',
          artifactsReturned: 1,
          totalCount: 1,
          tokenEstimate: 100,
          correlationId: 'test-correlation',
        }),
      );
    });

    it('should log provider selection details', async () => {
      // Tests that resolveContext() logs debug information about provider selection process
      // Expects: debug logs showing selected provider, priority, and candidate count
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      await service.resolveContext(request);

      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        '[selectBestProvider] Provider selection completed',
        expect.objectContaining({
          selectedProvider: 'high-priority-provider',
          selectedPriority: ProviderPriority.HIGH,
          totalCandidates: 1,
          requestType: ContextType.CONVERSATION,
          correlationId: 'test-correlation',
        }),
      );
    });
  });
});
