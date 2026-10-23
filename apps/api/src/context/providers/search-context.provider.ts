import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtKeysService } from 'src/auth/services/jwt-keys.service';
import { SearchService } from 'src/generated/embeddings/api/search.service';
import {
  SearchRequest,
  SearchResponse,
  SearchResult,
} from 'src/generated/embeddings';
import { errorToLoggable } from 'src/utils/logging.util';
import {
  ArtifactWithMetadata,
  ContextFilters,
  ContextProvider,
  ContextRequest,
  ContextResult,
  ContextType,
} from '../interfaces';
import { ProviderPriority } from '../types/context.types';
import { EmbeddingSearchMatchType } from './search-context.types';
import { AxiosError } from 'axios';

@Injectable()
export class SearchContextProvider implements ContextProvider {
  private readonly logger = new Logger(SearchContextProvider.name);

  name = 'search-context-provider';
  priority = ProviderPriority.MEDIUM;
  supportedTypes = [ContextType.SEMANTIC];

  // Circuit breaker state
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly circuitBreakerThreshold = 5;
  private readonly circuitBreakerTimeout = 30000; // 30 seconds

  // Service configuration
  private readonly isServiceEnabled: boolean;
  private readonly serviceUrl: string;
  private readonly requestTimeout: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtKeysService: JwtKeysService,
    private readonly searchService: SearchService,
  ) {
    // Load configuration similar to EmbeddingsClientService
    this.serviceUrl = this.configService.get<string>(
      'EMBEDDINGS_SERVICE_URL',
      'http://localhost:5005',
    );

    const enabledValue = this.configService.get<string>(
      'EMBEDDINGS_SERVICE_ENABLED',
      'true',
    );
    this.isServiceEnabled = enabledValue === 'true';

    this.requestTimeout = this.configService.get<number>(
      'EMBEDDINGS_SERVICE_TIMEOUT',
      10000,
    );

    this.logger.log(
      `Search context provider ${this.isServiceEnabled ? 'enabled' : 'disabled'}`,
    );
    if (this.isServiceEnabled) {
      this.logger.log(`Embeddings service URL: ${this.serviceUrl}`);
    }
  }

  canHandle(request: ContextRequest): boolean {
    // Check if embeddings service is enabled
    if (!this.isServiceEnabled) {
      this.logger.debug('[canHandle] Embeddings service is disabled', {
        correlationId: request.correlationId,
      });
      return false;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      this.logger.warn(
        '[canHandle] Circuit breaker is open, rejecting request',
        {
          failureCount: this.failureCount,
          correlationId: request.correlationId,
        },
      );
      return false;
    }

    // Check if provider supports the request type
    const canHandle = this.supportedTypes.includes(request.type);

    this.logger.debug('[canHandle] Checking if request can be handled', {
      requestType: request.type,
      canHandle,
      supportedTypes: this.supportedTypes,
      correlationId: request.correlationId,
    });

    return canHandle;
  }

  async resolve(
    request: ContextRequest,
    filters?: ContextFilters,
  ): Promise<ContextResult> {
    const startTime = Date.now();

    this.logger.log('[resolve] Starting search context resolution', {
      requestType: request.type,
      scope: request.scope,
      organizationId: request.organizationId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      initiativeId: request.initiativeId,
      maxResults: request.maxResults,
      correlationId: request.correlationId,
    });

    try {
      // Build search query and parameters
      const searchQuery = this.buildSearchQuery(request);
      const searchRequest = this.buildSearchRequest(
        request,
        filters,
        searchQuery,
      );

      this.logger.debug('[resolve] Executing search request', {
        query: searchQuery,
        searchRequest: this.sanitizeSearchRequestForLogging(searchRequest),
        correlationId: request.correlationId,
      });

      // Call embeddings service
      const searchResponse = await this.executeSearchRequest(
        request,
        searchRequest,
      );

      // Transform results
      const artifacts =
        searchResponse.data?.map((result) =>
          this.mapSearchResultToArtifact(result, request),
        ) ?? [];

      const tokenEstimate = this.estimateTokens(artifacts);
      const executionTime = Date.now() - startTime;

      // Reset circuit breaker on success
      this.resetCircuitBreaker();

      this.logger.log('[resolve] Search context resolution completed', {
        artifactsReturned: artifacts.length,
        totalResults: searchResponse.results,
        tokenEstimate,
        executionTime,
        queryStrategy: this.getQueryStrategy(request),
        correlationId: request.correlationId,
      });

      return {
        artifacts,
        totalCount: searchResponse.results ?? 0,
        tokenEstimate,
        providerName: this.name,
        executionTimeMs: executionTime,
        metadata: {
          queryStrategy: this.getQueryStrategy(request),
          searchQuery,
          filters,
          embeddingsQuery: {
            query: searchRequest.query,
            maxResults: searchRequest.max_results,
            similarityThreshold: searchRequest.similarity_threshold,
          },
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Update circuit breaker on failure
      this.updateCircuitBreakerOnFailure();

      this.logger.error('[resolve] Search context resolution failed', {
        requestType: request.type,
        organizationId: request.organizationId,
        error: error instanceof Error ? error.message : error,
        executionTime,
        correlationId: request.correlationId,
      });

      throw error;
    }
  }

  estimateTokens(artifacts: ArtifactWithMetadata[]): number {
    return artifacts.reduce((total, artifact) => {
      // Base content tokens
      const contentLength = JSON.stringify(artifact.data).length;

      // Metadata overhead
      const metadataLength = 150;

      // Rough estimation: 4 characters per token
      return total + Math.ceil((contentLength + metadataLength) / 4);
    }, 0);
  }

  private buildSearchQuery(request: ContextRequest): string {
    if (request.searchQuery && request.searchQuery.trim().length > 0) {
      return request.searchQuery.trim();
    }

    switch (request.type) {
      case ContextType.RELATED:
        return this.buildRelatedQuery(request);
      case ContextType.PROJECT:
        return this.buildProjectQuery(request);
      case ContextType.INITIATIVE:
        return this.buildInitiativeQuery(request);
      default:
        return '';
    }
  }

  private buildRelatedQuery(request: ContextRequest): string {
    // For RELATED context, we need to construct a semantic query
    // This could be enhanced with actual context about what we're looking for
    const parts: string[] = [];

    if (request.projectId) {
      parts.push('project related content');
    }

    if (request.conversationId) {
      parts.push('conversation topics');
    }

    if (request.initiativeId) {
      parts.push('initiative related information');
    }

    // Default fallback query for organizational knowledge
    if (parts.length === 0) {
      parts.push('organizational knowledge and decisions');
    }

    return parts.join(' ');
  }

  private buildProjectQuery(request: ContextRequest): string {
    return `project artifacts and documentation for ${request.projectId || 'current project'}`;
  }

  private buildInitiativeQuery(request: ContextRequest): string {
    return `initiative information and related decisions for ${request.initiativeId || 'current initiative'}`;
  }

  private buildSearchRequest(
    request: ContextRequest,
    filters?: ContextFilters,
    searchQuery?: string,
  ): SearchRequest {
    const searchRequest: SearchRequest = {
      query: searchQuery || this.buildSearchQuery(request),
      max_results: request.maxResults || 10,
      similarity_threshold: 0.15, // Default threshold
      filters: this.buildSearchFilters(
        request,
        filters,
      ) as SearchRequest['filters'],
    };

    return searchRequest;
  }

  private buildSearchFilters(
    request: ContextRequest,
    filters?: ContextFilters,
  ): { [key: string]: unknown } {
    const searchFilters: { [key: string]: unknown } = {};

    // Project scoping
    if (request.projectId) {
      searchFilters.projectId = request.projectId;
    }

    // Initiative scoping
    if (request.initiativeId) {
      searchFilters.initiativeId = request.initiativeId;
    }

    if (request.artifactTypes && request.artifactTypes.length > 0) {
      searchFilters.type =
        request.artifactTypes.length === 1
          ? request.artifactTypes[0]
          : request.artifactTypes;
    } else if (request.type === ContextType.RELATED) {
      // Default to INSIGHT artifacts for related searches when not specified
      searchFilters.type = 'INSIGHT';
    }

    // Additional filters from ContextFilters
    if (filters?.categories && filters.categories.length > 0) {
      searchFilters.category = filters.categories;
    }

    if (filters?.tags && filters.tags.length > 0) {
      searchFilters.tags = filters.tags;
    }

    if (filters?.excludeArtifactIds && filters.excludeArtifactIds.length > 0) {
      searchFilters.excludeIds = filters.excludeArtifactIds;
    }

    if (filters?.dateRange?.start) {
      searchFilters.created_after = filters.dateRange.start.toISOString();
    }

    if (filters?.dateRange?.end) {
      searchFilters.created_before = filters.dateRange.end.toISOString();
    }

    return searchFilters;
  }

  private async executeSearchRequest(
    request: ContextRequest,
    searchRequest: SearchRequest,
  ): Promise<SearchResponse> {
    const organizationId = request.organizationId;
    const projectId = request.projectId;
    if (!projectId) {
      throw new Error('Embeddings search requires a projectId');
    }

    this.logger.debug(
      '[executeSearchRequest] Making request to embeddings service',
      {
        organizationId,
        projectId,
      },
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authToken = this.createJwtForRequest(request);

    headers.Authorization = `Bearer ${authToken}`;
    headers['X-API-Auth'] = `Bearer ${authToken}`;

    try {
      const response = await firstValueFrom(
        this.searchService.searchEmbeddingsOrgPost(
          organizationId,
          projectId,
          searchRequest,
          {
            config: {
              timeout: this.requestTimeout,
              headers,
            },
          },
        ),
      );

      if (response.data.success === false) {
        throw new Error(`Search request failed: ${response.data.query}`);
      }

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.code === 'ECONNREFUSED') {
        throw new Error(`Embeddings service unavailable at ${this.serviceUrl}`);
      }

      if (axiosError.response?.status === 400) {
        throw new Error(
          `Invalid search request: ${(axiosError.response.data as { message: string })?.message || 'Bad request'}`,
        );
      }

      if (axiosError.response?.status === 404) {
        throw new Error(
          `Embeddings not found for organization/project: ${organizationId}/${projectId}`,
        );
      }

      const errorMessage = axiosError.message || errorToLoggable(error);
      throw new Error(`Embeddings service error: ${errorMessage}`);
    }
  }

  private createJwtForRequest(request: ContextRequest): string {
    return this.jwtKeysService.getToken(request, {
      expiresIn: '5m',
    });
  }

  private mapSearchResultToArtifact(
    searchResult: SearchResult,
    request: ContextRequest,
  ): ArtifactWithMetadata {
    // Extract metadata fields with defaults
    const metadata = searchResult.metadata;
    const matchType =
      searchResult.matchType ??
      (searchResult as { match_type?: EmbeddingSearchMatchType }).match_type ??
      'hybrid';

    return {
      id: searchResult.id,
      organizationId: request.organizationId,
      projectId: metadata.projectId || request.projectId || '',
      type: metadata.type || 'SEARCH_RESULT',
      title: metadata.title || 'Search Result',
      data: { content: searchResult.text, searchMetadata: metadata },
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      category: metadata.category || undefined,
      createdAt: metadata.createdAt
        ? new Date(String(metadata.createdAt))
        : new Date(),
      updatedAt: metadata.updatedAt
        ? new Date(String(metadata.updatedAt))
        : new Date(),
      sourceType: metadata.sourceType || 'unknown',
      sourceId: metadata.sourceId || 'unknown',
      priority: metadata.priority || 'MEDIUM',
      status: metadata.status || 'ACTIVE',
      relevanceScore: searchResult.similarity,
      selectionReason: `semantic_match_${matchType}`,
    };
  }

  private getQueryStrategy(request: ContextRequest): string {
    switch (request.type) {
      case ContextType.RELATED:
        return 'semantic_related_search';
      case ContextType.PROJECT:
        return 'semantic_project_search';
      case ContextType.INITIATIVE:
        return 'semantic_initiative_search';
      default:
        return 'semantic_search';
    }
  }

  // Circuit breaker methods
  private isCircuitBreakerOpen(): boolean {
    const now = Date.now();

    if (this.failureCount >= this.circuitBreakerThreshold) {
      if (now - this.lastFailureTime > this.circuitBreakerTimeout) {
        this.resetCircuitBreaker();
        return false;
      }
      return true;
    }

    return false;
  }

  private updateCircuitBreakerOnFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn(
      '[updateCircuitBreakerOnFailure] Circuit breaker updated',
      {
        failureCount: this.failureCount,
        threshold: this.circuitBreakerThreshold,
        isOpen: this.failureCount >= this.circuitBreakerThreshold,
      },
    );
  }

  private resetCircuitBreaker(): void {
    const wasOpen = this.failureCount >= this.circuitBreakerThreshold;
    this.failureCount = 0;
    this.lastFailureTime = 0;

    if (wasOpen) {
      this.logger.log(
        '[resetCircuitBreaker] Circuit breaker reset to closed state',
      );
    }
  }

  private sanitizeSearchRequestForLogging(
    searchRequest: SearchRequest,
  ): Partial<Omit<SearchRequest, 'filters'>> & {
    filters?: string[];
  } {
    return {
      query: searchRequest.query,
      max_results: searchRequest.max_results,
      similarity_threshold: searchRequest.similarity_threshold,
      filters: searchRequest.filters
        ? Object.keys(searchRequest.filters)
        : undefined,
    };
  }
}
