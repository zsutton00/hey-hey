/* eslint-disable @typescript-eslint/unbound-method */
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';

jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  Prisma: {
    ...jest.requireActual('@prisma/client').Prisma,
    defineExtension: (extension: unknown) => extension,
  },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $extends() {
      return this;
    }
  },
}));

import {
  Configuration,
  SearchResponse,
  SearchResult,
} from 'src/generated/embeddings';
import { SearchService } from 'src/generated/embeddings/api/search.service';
import { testIds } from 'src/utils/testUtils';
import {
  ContextFilters,
  ContextRequest,
  ContextScope,
  ContextType,
} from '../../interfaces';
import { ProviderPriority } from '../../types/context.types';
import { SearchContextProvider } from '../search-context.provider';

describe('SearchContextProvider', () => {
  let provider: SearchContextProvider;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<Logger>;
  let searchService: SearchService;
  let jwtKeysService: {
    getToken: jest.Mock<string, any>;
  };

  // Test data
  const mockOrganizationId = testIds.organization;
  const mockProjectId = testIds.project;
  const mockInitiativeId = testIds.initiative;
  const mockCorrelationId = 'corr-abc';

  const mockSearchResult: SearchResult = {
    id: 'result-1',
    text: 'This is a test search result about machine learning algorithms.',
    similarity: 0.85,
    metadata: {
      id: 'result-1',
      type: 'artifact',
      title: 'ML Algorithms Guide',
      category: 'technical-documentation',
      projectId: mockProjectId,
      organizationId: mockOrganizationId,
      artifactType: 'DOCUMENTATION',
      createdAt: '2024-01-15T10:30:00Z',
      tags: ['machine-learning', 'algorithms'],
    },
    chunkIndex: 0,
    matchType: 'semantic',
  };

  const mockSearchResponse: SearchResponse = {
    success: true,
    query: 'machine learning',
    results: 1,
    data: [mockSearchResult],
  };

  const mockAxiosResponse: AxiosResponse<SearchResponse> = {
    data: mockSearchResponse,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  const expectRequestConfig = (expectedToken = 'mock-jwt-token') =>
    expect.objectContaining({
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expectedToken}`,
        'X-API-Auth': `Bearer ${expectedToken}`,
      }),
    });

  beforeEach(() => {
    const mockHttpService = {
      post: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        switch (key) {
          case 'EMBEDDINGS_SERVICE_URL':
            return 'http://localhost:5005';
          case 'EMBEDDINGS_SERVICE_ENABLED':
            return 'true';
          case 'EMBEDDINGS_SERVICE_API_KEY':
            return 'static-api-key';
          case 'EMBEDDINGS_SERVICE_TIMEOUT':
            return 10000;
          default:
            return defaultValue;
        }
      }),
    };

    const mockJwtKeysService = {
      getToken: jest.fn().mockReturnValue('mock-jwt-token'),
    } as typeof jwtKeysService;

    httpService = mockHttpService as unknown as jest.Mocked<HttpService>;
    configService = mockConfigService as unknown as jest.Mocked<ConfigService>;
    jwtKeysService = mockJwtKeysService;
    searchService = new SearchService(httpService, new Configuration());

    provider = new SearchContextProvider(
      configService,
      jwtKeysService as any,
      searchService,
    );

    // Mock logger to avoid console noise in tests
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;
    (provider as any).logger = logger;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Properties', () => {
    it('should have correct name and priority', () => {
      expect(provider.name).toBe('search-context-provider');
      expect(provider.priority).toBe(ProviderPriority.MEDIUM);
    });

    it('should support semantic context type', () => {
      expect(provider.supportedTypes).toContain(ContextType.SEMANTIC);
      expect(provider.supportedTypes).not.toContain(ContextType.CONVERSATION);
    });
  });

  describe('canHandle Method', () => {
    const createTestRequest = (type: ContextType): ContextRequest => ({
      type,
      scope: ContextScope.ORGANIZATION,
      organizationId: mockOrganizationId,
      correlationId: mockCorrelationId,
      projectId: testIds.project,
    });

    it('should return true for supported context types when service is enabled', () => {
      const request = createTestRequest(ContextType.SEMANTIC);
      expect(provider.canHandle(request)).toBe(true);
    });

    it('should return false for unsupported context types', () => {
      const request = createTestRequest(ContextType.CONVERSATION);
      expect(provider.canHandle(request)).toBe(false);
    });

    it('should return false when embeddings service is disabled', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDINGS_SERVICE_ENABLED') return 'false';
        return 'http://localhost:5005'; // default for other keys
      });

      // Create new provider instance with disabled service
      const disabledProvider = new SearchContextProvider(
        configService,
        jwtKeysService as any,
        searchService,
      );
      const request = createTestRequest(ContextType.SEMANTIC);

      expect(disabledProvider.canHandle(request)).toBe(false);
    });

    it('should return false when circuit breaker is open', () => {
      // Simulate circuit breaker state
      (provider as any).failureCount = 10; // Above threshold
      (provider as any).lastFailureTime = Date.now();

      const request = createTestRequest(ContextType.SEMANTIC);
      expect(provider.canHandle(request)).toBe(false);
    });
  });

  describe('resolve Method - Success Cases', () => {
    const createBaseRequest = (): ContextRequest => ({
      type: ContextType.RELATED,
      scope: ContextScope.ORGANIZATION,
      organizationId: mockOrganizationId,
      correlationId: mockCorrelationId,
      projectId: testIds.project,
      maxResults: 10,
    });

    beforeEach(() => {
      httpService.post.mockReturnValue(of(mockAxiosResponse));
    });

    it('should successfully resolve RELATED context', async () => {
      const request = createBaseRequest();

      const result = await provider.resolve(request);

      expect(result.artifacts).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.providerName).toBe('search-context-provider');
      expect(result.tokenEstimate).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const artifact = result.artifacts[0];
      if (!artifact) {
        throw new Error('Expected resolved artifact');
      }
      expect(artifact.id).toBe('result-1');
      expect(artifact.organizationId).toBe(mockOrganizationId);
      expect(artifact.relevanceScore).toBe(0.85);
      expect(artifact.selectionReason).toBe('semantic_match_semantic');
    });

    it('should successfully resolve PROJECT context with project filtering', async () => {
      const request: ContextRequest = {
        ...createBaseRequest(),
        type: ContextType.PROJECT,
        projectId: mockProjectId,
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        `http://localhost:5005/orgs/${mockOrganizationId}/projects/${mockProjectId}/embeddings/search`,
        expect.objectContaining({
          filters: expect.objectContaining({
            projectId: mockProjectId,
          }),
        }),
        expectRequestConfig(),
      );
    });

    it('should successfully resolve INITIATIVE context', async () => {
      const request: ContextRequest = {
        ...createBaseRequest(),
        type: ContextType.INITIATIVE,
        initiativeId: mockInitiativeId,
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        `http://localhost:5005/orgs/${mockOrganizationId}/projects/${mockProjectId}/embeddings/search`,
        expect.objectContaining({
          query: expect.stringContaining('initiative'),
          filters: expect.objectContaining({
            initiativeId: mockInitiativeId,
          }),
        }),
        expectRequestConfig(),
      );
    });

    it('should apply context filters correctly', async () => {
      const request = createBaseRequest();
      const filters: ContextFilters = {
        tags: ['machine-learning', 'ai'],
        categories: ['technical', 'research'],
        excludeArtifactIds: ['exclude-1', 'exclude-2'],
      };

      await provider.resolve(request, filters);

      expect(httpService.post).toHaveBeenCalledWith(
        `http://localhost:5005/orgs/${mockOrganizationId}/projects/${mockProjectId}/embeddings/search`,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: 'INSIGHT',
            tags: ['machine-learning', 'ai'],
            category: ['technical', 'research'],
            excludeIds: ['exclude-1', 'exclude-2'],
          }),
        }),
        expectRequestConfig(),
      );
    });

    it('should honor artifact types and date range filters', async () => {
      const request = {
        ...createBaseRequest(),
        artifactTypes: ['DECISION', 'INSIGHT'],
      } as ContextRequest;

      const filters: ContextFilters = {
        dateRange: {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-02-01T00:00:00Z'),
        },
      };

      await provider.resolve(request, filters);

      expect(httpService.post).toHaveBeenCalledWith(
        `http://localhost:5005/orgs/${mockOrganizationId}/projects/${mockProjectId}/embeddings/search`,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['DECISION', 'INSIGHT'],
            created_after: '2024-01-01T00:00:00.000Z',
            created_before: '2024-02-01T00:00:00.000Z',
          }),
        }),
        expectRequestConfig(),
      );
    });

    it('should use custom search query when provided on request', async () => {
      const request: ContextRequest = {
        ...createBaseRequest(),
        searchQuery: 'latest initiative updates',
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        `http://localhost:5005/orgs/${mockOrganizationId}/projects/${mockProjectId}/embeddings/search`,
        expect.objectContaining({
          query: 'latest initiative updates',
        }),
        expectRequestConfig(),
      );
    });

    it('should sign JWT with provided auth context details', async () => {
      const request: ContextRequest = {
        ...createBaseRequest(),
        authContext: {
          sub: 'user-123',
          scopes: ['read', 'write'],
          orgMemberships: [
            {
              orgId: mockOrganizationId,
              role: 'ADMIN',
            },
          ],
          currentOrgId: mockOrganizationId,
          projectIds: [mockProjectId],
          isDevAdmin: true,
        },
      };

      await provider.resolve(request);

      expect(jwtKeysService.getToken).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          authContext: expect.objectContaining({
            sub: 'user-123',
            scopes: ['read', 'write'],
            orgMemberships: [
              {
                orgId: mockOrganizationId,
                role: 'ADMIN',
              },
            ],
            currentOrgId: mockOrganizationId,
            projectIds: [mockProjectId],
            isDevAdmin: true,
          }),
        }),
        expect.objectContaining({ expiresIn: '5m' }),
      );

      const call = httpService.post.mock.calls[0];
      if (!call) {
        throw new Error('Expected HTTP request');
      }
      const [, , config] = call;
      if (!config) {
        throw new Error('Expected request config');
      }
      expect(config.headers).toMatchObject({
        Authorization: 'Bearer mock-jwt-token',
        'X-API-Auth': 'Bearer mock-jwt-token',
      });
    });

    it('should delegate token issuance without auth context when none is provided', async () => {
      const request = createBaseRequest();

      await provider.resolve(request);

      const [forwardedRequest, options] =
        jwtKeysService.getToken.mock.calls[0] ?? [];
      expect(forwardedRequest).toEqual(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
        }),
      );
      expect(forwardedRequest).not.toHaveProperty('authContext');
      expect(options).toEqual(expect.objectContaining({ expiresIn: '5m' }));
    });
  });

  describe('resolve Method - Error Handling', () => {
    const createBaseRequest = (): ContextRequest => ({
      type: ContextType.RELATED,
      scope: ContextScope.ORGANIZATION,
      organizationId: mockOrganizationId,
      correlationId: mockCorrelationId,
      projectId: testIds.project,
    });

    it('should handle connection refused errors', async () => {
      const connectionError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      };

      httpService.post.mockReturnValue(throwError(() => connectionError));

      const request = createBaseRequest();

      await expect(provider.resolve(request)).rejects.toThrow(
        'Embeddings service unavailable at http://localhost:5005',
      );
    });

    it('should handle 400 Bad Request errors', async () => {
      const badRequestError = {
        response: {
          status: 400,
          data: { message: 'Invalid search query' },
        },
        message: 'Bad Request',
      };

      httpService.post.mockReturnValue(throwError(() => badRequestError));

      const request = createBaseRequest();

      await expect(provider.resolve(request)).rejects.toThrow(
        'Invalid search request: Invalid search query',
      );
    });

    it('should handle 404 Not Found errors', async () => {
      const notFoundError = {
        response: {
          status: 404,
          data: {},
        },
        message: 'Not Found',
      };

      httpService.post.mockReturnValue(throwError(() => notFoundError));

      const request = createBaseRequest();

      await expect(provider.resolve(request)).rejects.toThrow(
        `Embeddings not found for organization/project: ${mockOrganizationId}/${mockProjectId}`,
      );
    });

    it('should handle generic network errors', async () => {
      const networkError = {
        message: 'Network timeout',
      };

      httpService.post.mockReturnValue(throwError(() => networkError));

      const request = createBaseRequest();

      await expect(provider.resolve(request)).rejects.toThrow(
        'Embeddings service error: Network timeout',
      );
    });

    it('should update circuit breaker on failure', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error('Service error')),
      );

      const request = createBaseRequest();

      await expect(provider.resolve(request)).rejects.toThrow();

      // Check that failure count increased
      expect((provider as any).failureCount).toBe(1);
      expect((provider as any).lastFailureTime).toBeGreaterThan(0);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after threshold failures', () => {
      // Simulate failures up to threshold
      const threshold = (provider as any).circuitBreakerThreshold;
      (provider as any).failureCount = threshold;
      (provider as any).lastFailureTime = Date.now();

      const request: ContextRequest = {
        type: ContextType.SEMANTIC,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        correlationId: mockCorrelationId,
        projectId: testIds.project,
      };

      expect(provider.canHandle(request)).toBe(false);
    });

    it('should reset circuit breaker after timeout', () => {
      const threshold = (provider as any).circuitBreakerThreshold;
      const timeout = (provider as any).circuitBreakerTimeout;

      // Simulate failures and set old timestamp
      (provider as any).failureCount = threshold;
      (provider as any).lastFailureTime = Date.now() - timeout - 1000;

      const request: ContextRequest = {
        type: ContextType.SEMANTIC,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        correlationId: mockCorrelationId,
        projectId: testIds.project,
      };

      expect(provider.canHandle(request)).toBe(true);
      expect((provider as any).failureCount).toBe(0);
    });

    it('should reset circuit breaker on successful resolve', async () => {
      // Set up circuit breaker with some failures
      (provider as any).failureCount = 3;
      (provider as any).lastFailureTime = Date.now();

      httpService.post.mockReturnValue(of(mockAxiosResponse));

      const request: ContextRequest = {
        type: ContextType.RELATED,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        correlationId: mockCorrelationId,
        projectId: testIds.project,
      };

      await provider.resolve(request);

      // Circuit breaker should be reset
      expect((provider as any).failureCount).toBe(0);
      expect((provider as any).lastFailureTime).toBe(0);
    });
  });

  describe('Search Query Building', () => {
    beforeEach(() => {
      httpService.post.mockReturnValue(of(mockAxiosResponse));
    });

    it('should build appropriate query for RELATED context', async () => {
      const request: ContextRequest = {
        type: ContextType.RELATED,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        correlationId: mockCorrelationId,
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          query: expect.stringContaining('project related content'),
        }),
        expectRequestConfig(),
      );
    });

    it('should build appropriate query for PROJECT context', async () => {
      const request: ContextRequest = {
        type: ContextType.PROJECT,
        scope: ContextScope.PROJECT,
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        correlationId: mockCorrelationId,
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          query: expect.stringContaining('project artifacts and documentation'),
        }),
        expectRequestConfig(),
      );
    });

    it('should build appropriate query for INITIATIVE context', async () => {
      const request: ContextRequest = {
        type: ContextType.INITIATIVE,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        initiativeId: mockInitiativeId,
        correlationId: mockCorrelationId,
      };

      await provider.resolve(request);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          query: expect.stringContaining('initiative information'),
        }),
        expectRequestConfig(),
      );
    });
  });

  describe('Artifact Mapping', () => {
    beforeEach(() => {
      httpService.post.mockReturnValue(of(mockAxiosResponse));
    });

    it('should correctly map search results to artifacts', async () => {
      const request: ContextRequest = {
        type: ContextType.RELATED,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        correlationId: mockCorrelationId,
      };

      const result = await provider.resolve(request);

      const artifact = result.artifacts[0];
      expect(artifact).toMatchObject({
        id: 'result-1',
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        type: 'artifact',
        title: 'ML Algorithms Guide',
        data: {
          content:
            'This is a test search result about machine learning algorithms.',
          searchMetadata: mockSearchResult.metadata,
        },
        tags: ['machine-learning', 'algorithms'],
        category: 'technical-documentation',
        createdAt: new Date('2024-01-15T10:30:00Z'),
        sourceType: 'unknown',
        sourceId: 'unknown',
        priority: 'MEDIUM',
        status: 'ACTIVE',
        relevanceScore: 0.85,
        selectionReason: 'semantic_match_semantic',
      });
      expect(artifact?.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle missing metadata gracefully', async () => {
      const resultWithoutMetadata: SearchResult = {
        id: 'result-2',
        text: 'Result without metadata',
        similarity: 0.75,
        metadata: {} as any,
        matchType: 'hybrid',
      };

      const responseWithoutMetadata: SearchResponse = {
        success: true,
        query: 'test',
        results: 1,
        data: [resultWithoutMetadata],
      };

      httpService.post.mockReturnValue(
        of({
          ...mockAxiosResponse,
          data: responseWithoutMetadata,
        }),
      );

      const request: ContextRequest = {
        type: ContextType.RELATED,
        scope: ContextScope.ORGANIZATION,
        organizationId: mockOrganizationId,
        correlationId: mockCorrelationId,
        projectId: testIds.project,
      };

      const result = await provider.resolve(request);

      const artifact = result.artifacts[0];
      if (!artifact) {
        throw new Error('Expected resolved artifact');
      }
      expect(artifact.title).toBe('Search Result');
      expect(artifact.type).toBe('SEARCH_RESULT');
      expect(artifact.tags).toEqual([]);
      expect(artifact.category).toBeUndefined();
      expect(artifact.selectionReason).toBe('semantic_match_hybrid');
    });
  });

  describe('Token Estimation', () => {
    it('should estimate tokens correctly', () => {
      const artifacts = [
        {
          data: { content: 'Short content' },
        },
        {
          data: {
            content: 'This is a longer piece of content with more words',
          },
        },
      ] as any[];

      const tokenEstimate = provider.estimateTokens(artifacts);

      expect(tokenEstimate).toBeGreaterThan(0);
      expect(typeof tokenEstimate).toBe('number');
    });

    it('should handle different data types in token estimation', () => {
      const artifacts = [
        {
          data: 'string data',
        },
        {
          data: { complex: 'object data', with: ['arrays', 'and', 'objects'] },
        },
      ] as any[];

      const tokenEstimate = provider.estimateTokens(artifacts);

      expect(tokenEstimate).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    it('should use custom service URL from config', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDINGS_SERVICE_URL') return 'http://custom:8080';
        return 'true';
      });

      const customProvider = new SearchContextProvider(
        configService,
        jwtKeysService as any,
        searchService,
      );
      expect((customProvider as any).serviceUrl).toBe('http://custom:8080');
    });

    it('should use custom timeout from config', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'EMBEDDINGS_SERVICE_TIMEOUT') return 5000;
        return 'http://localhost:5005';
      });

      const customProvider = new SearchContextProvider(
        configService,
        jwtKeysService as any,
        searchService,
      );
      expect((customProvider as any).requestTimeout).toBe(5000);
    });
  });
});
