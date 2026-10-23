import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  HealthResponse,
  ProjectionDeletionCommand,
  ProjectionDeletionResult,
  SearchRequest,
  SearchResponse,
  SearchResult,
  StatsResponse,
} from 'src/generated/embeddings';
import { DevelopmentService } from 'src/generated/embeddings/api/development.service';
import { OrganizationLifecycleService } from 'src/generated/embeddings/api/organizationLifecycle.service';
import { MonitoringService } from 'src/generated/embeddings/api/monitoring.service';
import { SearchService } from 'src/generated/embeddings/api/search.service';
import { GetDebugEntity200Response } from 'src/generated/embeddings/model/getDebugEntity200Response';
import { OrganizationId, ProjectId } from 'src/types';
import { errorToLoggable } from 'src/utils/logging.util';
import { ApiKeyService } from './api-key.service';

@Injectable()
export class EmbeddingsClientService {
  private readonly logger = new Logger(EmbeddingsClientService.name);
  private readonly isEnabled: boolean;
  private readonly staticApiKey?: string;
  private readonly baseUrl: string;

  constructor(
    private configService: ConfigService,
    private readonly apiKeyService: ApiKeyService,
    private readonly searchService: SearchService,
    private readonly lifecycleService: OrganizationLifecycleService,
    private readonly monitoringService: MonitoringService,
    private readonly developmentService: DevelopmentService,
  ) {
    const baseURL = this.configService.get<string>(
      'EMBEDDINGS_SERVICE_URL',
      'http://localhost:5005',
    );
    const apiKey = this.configService.get<string>('EMBEDDINGS_SERVICE_API_KEY');
    this.staticApiKey = apiKey || undefined;
    this.baseUrl = baseURL;

    // Check if embeddings service is enabled
    const enabledValue = this.configService.get<string>(
      'EMBEDDINGS_SERVICE_ENABLED',
      'true',
    );
    this.isEnabled = enabledValue === 'true';

    this.logger.log(
      `Embeddings service ${this.isEnabled ? 'enabled' : 'disabled'}`,
    );
    this.logger.log(`Embeddings service URL: ${baseURL}`);
  }

  /**
   * Check if embeddings service is enabled and available
   */
  isServiceEnabled(): boolean {
    return this.isEnabled;
  }

  async deleteOrganizationProjection(
    command: ProjectionDeletionCommand,
    systemToken: string,
  ): Promise<ProjectionDeletionResult> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }
    if (!systemToken) {
      throw new Error('Embeddings projection deletion requires a system token');
    }

    try {
      const response = await firstValueFrom<
        AxiosResponse<ProjectionDeletionResult>
      >(
        this.lifecycleService.deleteOrganizationProjection(
          command.organizationId,
          command,
          {
            config: {
              headers: {
                Authorization: `Bearer ${systemToken}`,
                'Content-Type': 'application/json',
              },
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to delete organization embeddings projection', {
        error: (error as Error).message,
        organizationId: command.organizationId,
        markerId: command.markerId,
      });
      throw error;
    }
  }

  /**
   * Search embeddings using POST request
   */
  async searchEmbeddings(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: SearchRequest,
  ): Promise<SearchResponse> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }
    if (!projectId) {
      throw new Error('Embeddings search requires a projectId');
    }

    try {
      this.logger.debug(`Searching embeddings for query: ${request.query}`);

      const requestConfig = await this.buildRequestConfig(organizationId);

      const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
        this.searchService.searchEmbeddingsOrgPost(
          organizationId,
          projectId,
          request,
          {
            config: this.extendRequestConfig(requestConfig, {
              headers: {
                'Content-Type': 'application/json',
              },
            }),
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to search embeddings', {
        error: (error as Error).message,
        query: request.query,
        response: (error as { response?: { data?: unknown; status?: number } })
          .response?.data,
        status: (error as { response?: { data?: unknown; status?: number } })
          .response?.status,
      });
      throw new Error(
        `Failed to search embeddings: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Search embeddings using GET request with URL parameters
   */
  async searchEmbeddingsParams(params: {
    q: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    maxResults?: number;
    threshold?: number;
    searchType?: 'semantic' | 'keyword' | 'hybrid';
    queryMode?: 'default' | 'title_fuzzy';
    boostRecent?: boolean;
  }): Promise<SearchResponse> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }
    if (!params.projectId) {
      throw new Error('Embeddings search requires a projectId');
    }

    try {
      this.logger.debug(`Searching embeddings with params: ${params.q}`);

      const requestConfig = await this.buildRequestConfig(
        params.organizationId,
      );

      const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
        this.searchService.searchEmbeddingsOrgGet(
          params.organizationId,
          params.projectId,
          params.q,
          params.maxResults,
          params.threshold,
          params.searchType,
          params.queryMode,
          params.boostRecent,
          undefined,
          {
            config: this.extendRequestConfig(requestConfig, {}),
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to search embeddings with params', {
        error: (error as Error).message,
        params,
        response: (error as { response?: { data?: unknown; status?: number } })
          .response?.data,
        status: (error as { response?: { data?: unknown; status?: number } })
          .response?.status,
      });
      throw new Error(
        `Failed to search embeddings: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Search embeddings using GET request with user's JWT token
   * This proxies the user's token directly to the embeddings service
   */
  async searchWithUserToken(
    params: {
      q: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
      maxResults?: number;
      threshold?: number;
      searchType?: 'semantic' | 'keyword' | 'hybrid';
      queryMode?: 'default' | 'title_fuzzy';
      boostRecent?: boolean;
      statuses?: string[];
      initiativeId?: string;
      parentTaskId?: string;
      entityType?: string;
    },
    userToken: string,
  ): Promise<SearchResult[]> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }
    if (!params.projectId) {
      throw new Error('Embeddings search requires a projectId');
    }
    try {
      this.logger.debug(
        `Searching embeddings with user token for query: ${params.q}`,
      );

      const normalizedEntityTypes = params.entityType
        ?.split(',')
        .map((type) => type.trim().toLowerCase())
        .filter((type) => type.length > 0);

      const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
        this.searchService.searchEmbeddingsOrgGet(
          params.organizationId,
          params.projectId,
          params.q,
          params.maxResults,
          params.threshold,
          params.searchType,
          params.queryMode,
          params.boostRecent,
          normalizedEntityTypes,
          {
            config: {
              headers: {
                Authorization: `Bearer ${userToken}`,
                'X-API-Auth': `Bearer ${userToken}`,
              },
              params: {
                q: params.q,
                max_results: params.maxResults,
                threshold: params.threshold,
                search_type: params.searchType,
                query_mode: params.queryMode,
                boost_recent: params.boostRecent,
                statuses: params.statuses,
                initiativeId: params.initiativeId,
                parentTaskId: params.parentTaskId,
                entityType: normalizedEntityTypes,
              },
            },
          },
        ),
      );

      return response.data.data ?? [];
    } catch (error) {
      this.logger.error('Failed to search embeddings with user token', {
        error: (error as Error).message,
        query: params.q,
        response: (error as { response?: { data?: unknown; status?: number } })
          .response?.data,
        status: (error as { response?: { data?: unknown; status?: number } })
          .response?.status,
      });
      throw new Error(
        `Failed to search embeddings: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Search embeddings using POST request with user's JWT token
   * This proxies the user's token directly to the embeddings service
   */
  async searchEmbeddingsWithUserTokenPost(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: SearchRequest,
    userToken: string,
  ): Promise<SearchResponse> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }
    if (!projectId) {
      throw new Error('Embeddings search requires a projectId');
    }
    if (!userToken) {
      throw new Error('Embeddings search requires a user token');
    }

    try {
      this.logger.debug('Searching embeddings with user token (POST)', {
        query: request.query,
        organizationId,
        projectId,
        filters: request.filters,
        maxResults: request.max_results,
        baseUrl: this.baseUrl,
      });

      const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
        this.searchService.searchEmbeddingsOrgPost(
          organizationId,
          projectId,
          request,
          {
            config: {
              headers: {
                Authorization: `Bearer ${userToken}`,
                'X-API-Auth': `Bearer ${userToken}`,
                'Content-Type': 'application/json',
              },
            },
          },
        ),
      );

      this.logger.debug('Embeddings search succeeded', {
        query: request.query,
        resultCount: response.data?.data?.length ?? 0,
      });
      return response.data;
    } catch (error) {
      const axiosErr = error as {
        response?: { data?: unknown; status?: number };
        config?: { url?: string; method?: string };
      };
      this.logger.error('Failed to search embeddings with user token (POST)', {
        error: (error as Error).message,
        query: request.query,
        filters: request.filters,
        requestUrl: axiosErr.config?.url,
        requestMethod: axiosErr.config?.method,
        response: axiosErr.response?.data,
        status: axiosErr.response?.status,
      });
      throw error;
    }
  }

  /**
   * Get embeddings service statistics
   */
  async getStats(): Promise<StatsResponse> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }

    try {
      this.logger.debug('Getting embeddings service stats');

      const response = await firstValueFrom(this.monitoringService.getStats());

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get embeddings stats', {
        error: (error as Error).message,
        response: (error as { response?: { data?: unknown; status?: number } })
          .response?.data,
        status: (error as { response?: { data?: unknown; status?: number } })
          .response?.status,
      });
      throw new Error(
        `Failed to get embeddings stats: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check embeddings service health
   */
  async checkHealth(): Promise<HealthResponse> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }

    try {
      this.logger.debug('Checking embeddings service health');

      const response = await firstValueFrom(
        this.monitoringService.healthCheck(),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to check embeddings health', {
        error: (error as Error).message,
        response: (error as { response?: { data?: unknown; status?: number } })
          .response?.data,
        status: (error as { response?: { data?: unknown; status?: number } })
          .response?.status,
      });
      throw new Error(
        `Failed to check embeddings health: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find similar content using embeddings
   */
  async findSimilarContent(
    query: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options?: {
      maxResults?: number;
      threshold?: number;
      searchType?: 'semantic' | 'keyword' | 'hybrid';
      category?: string;
    },
  ): Promise<SearchResponse> {
    if (!projectId) {
      throw new Error('Embeddings search requires a projectId');
    }

    const searchRequest: SearchRequest = {
      query,
      max_results: options?.maxResults || 10,
      similarity_threshold: options?.threshold || 0.15,
      filters: {
        organizationId,
        projectId,
        ...(options?.category && { category: options.category }),
      },
    };

    const requestConfig = await this.buildRequestConfig(organizationId);

    const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
      this.searchService.searchEmbeddingsOrgPost(
        organizationId,
        projectId,
        searchRequest,
        {
          config: this.extendRequestConfig(requestConfig, {
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        },
      ),
    );

    return response.data;
  }

  /**
   * Get debug information for an entity from the embeddings service
   */
  async getDebugEntity(
    type: string,
    id: string,
  ): Promise<GetDebugEntity200Response> {
    if (!this.isEnabled) {
      throw new Error('Embeddings service is disabled');
    }

    try {
      this.logger.debug('Getting debug entity from embeddings service', {
        type,
        id,
      });

      const response = await firstValueFrom(
        this.developmentService.getDebugEntity(type, id),
      );

      return response.data;
    } catch (error) {
      const axiosError = error as {
        response?: { data?: unknown; status?: number };
        message?: string;
      };
      const status = axiosError.response?.status;

      this.logger.error('Failed to get debug entity', {
        error: axiosError.message,
        type,
        id,
        response: axiosError.response?.data,
        status,
      });

      if (status === 404) {
        throw new NotFoundException(
          `Entity not found in embeddings: ${type}/${id}`,
        );
      }

      throw new HttpException(
        `Failed to get debug entity: ${axiosError.message}`,
        status ?? HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async buildRequestConfig(
    organizationId: OrganizationId,
  ): Promise<AxiosRequestConfig> {
    let resolvedKey: string | null = null;

    try {
      resolvedKey =
        await this.apiKeyService.getOrganizationApiKey(organizationId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : errorToLoggable(error);
      this.logger.warn(
        'Falling back to static embeddings API key after resolver failure',
        {
          organizationId,
          error: errorMessage,
        },
      );
    }

    const apiKeyToUse = resolvedKey ?? this.staticApiKey ?? null;

    if (!apiKeyToUse) {
      this.logger.warn(
        'Proceeding without embeddings API key - request may be rejected',
        {
          organizationId,
        },
      );
      return {};
    }

    return {
      headers: {
        Authorization: `Bearer ${apiKeyToUse}`,
        'X-API-Auth': `Bearer ${apiKeyToUse}`,
      },
    };
  }

  private extendRequestConfig(
    baseConfig: AxiosRequestConfig,
    extension: AxiosRequestConfig,
  ): AxiosRequestConfig {
    if (!baseConfig.headers && extension.headers) {
      return {
        ...baseConfig,
        ...extension,
        headers: extension.headers,
      };
    }

    return {
      ...baseConfig,
      ...extension,
      headers: {
        ...(baseConfig.headers ?? {}),
        ...(extension.headers ?? {}),
      },
    };
  }
}
