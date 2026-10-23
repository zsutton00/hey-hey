import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import {
  GitHubIntegrationConfig,
  GitHubRepositoryDto,
  IntegrationResponseDto,
  IntegrationType,
  PaginatedGitHubRepositoryResponse,
  UpdateGitHubPrimaryRepositoryDto,
} from '../../generated';
import { RedisService } from '../../core/redis/redis.service';
import { IntegrationId, OrganizationId, ProjectId } from '../../types';
import { IntegrationService } from './integration.service';
import { GitHubRepositoryApiResponse } from '../../integration/types/github.types';

type GitHubRepoApiResponse = GitHubRepositoryApiResponse;

@Injectable()
export class GitHubRepositoryService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly integrationService: IntegrationService,
    private readonly redisService: RedisService,
  ) {}

  async listRepositories(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    integrationId: IntegrationId;
    page?: number;
    limit?: number;
    org?: string;
  }): Promise<PaginatedGitHubRepositoryResponse> {
    // TODO: Support a search parameter to reduce GitHub API scope server-side.
    const { integration, config } = await this.getGitHubIntegration(
      params.organizationId,
      params.projectId,
      params.integrationId,
    );

    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    if (
      !Number.isFinite(page) ||
      !Number.isFinite(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException('Invalid pagination parameters');
    }

    const cacheKey = this.buildCacheKey(integration.id, params.org);
    const cached = await this.getCachedRepositories(cacheKey);
    const repositories =
      cached ??
      (await this.fetchRepositories(config.token, params.org, cacheKey));

    const total = repositories.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const data =
      startIndex >= total
        ? []
        : repositories.slice(startIndex, startIndex + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async updatePrimaryRepository(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    integrationId: IntegrationId;
    payload: UpdateGitHubPrimaryRepositoryDto;
  }): Promise<IntegrationResponseDto> {
    const { integration, config } = await this.getGitHubIntegration(
      params.organizationId,
      params.projectId,
      params.integrationId,
    );

    const fullName = params.payload.fullName?.trim();
    if (!fullName) {
      throw new BadRequestException('Repository fullName is required');
    }

    const { owner, repo } = this.parseRepositoryFullName(fullName);
    const octokit = new Octokit({
      auth: config.token,
      userAgent: 'HeyHey-Repository-Discovery',
    });

    let repoData: GitHubRepoApiResponse;
    try {
      const response = await octokit.rest.repos.get({ owner, repo });
      repoData = response.data as GitHubRepoApiResponse;
    } catch (error) {
      this.handleGitHubError(error, 'fetch repository');
      throw error;
    }

    if (
      !repoData.full_name ||
      !repoData.owner?.login ||
      !repoData.default_branch ||
      !repoData.html_url
    ) {
      throw new BadRequestException(
        'GitHub repository response missing required metadata',
      );
    }

    const updatedConfig: GitHubIntegrationConfig = {
      ...config,
      repositoryUrl: repoData.html_url,
      primaryRepository: {
        fullName: repoData.full_name,
        owner: repoData.owner.login,
        defaultBranch: repoData.default_branch,
      },
    };

    return this.integrationService.update(
      params.organizationId,
      params.projectId,
      integration.id,
      { config: updatedConfig },
    );
  }

  private async getGitHubIntegration(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
  ): Promise<{
    integration: IntegrationResponseDto;
    config: GitHubIntegrationConfig & { token: string };
  }> {
    const integration =
      await this.integrationService.findOneWithDecryptedConfig(
        organizationId,
        projectId,
        integrationId,
      );

    if (integration.type !== IntegrationType.Github) {
      throw new BadRequestException('Integration must be GitHub');
    }

    const config = integration.config as GitHubIntegrationConfig;
    if (!config?.token) {
      throw new BadRequestException('GitHub OAuth token is required');
    }

    return {
      integration,
      config: config as GitHubIntegrationConfig & { token: string },
    };
  }

  private parseRepositoryFullName(fullName: string): {
    owner: string;
    repo: string;
  } {
    const [owner, repo, ...rest] = fullName.split('/');
    if (!owner || !repo || rest.length > 0) {
      throw new BadRequestException(
        'Repository fullName must be in the format "owner/repo"',
      );
    }
    return { owner, repo };
  }

  private async getCachedRepositories(
    cacheKey: string,
  ): Promise<GitHubRepositoryDto[] | null> {
    const redis = this.redisService.getClient();
    const cached = await redis.get(cacheKey);
    if (!cached) {
      return null;
    }

    try {
      const parsed = JSON.parse(cached) as GitHubRepositoryDto[];
      if (!Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async fetchRepositories(
    token: string,
    org: string | undefined,
    cacheKey: string,
  ): Promise<GitHubRepositoryDto[]> {
    const octokit = new Octokit({
      auth: token,
      userAgent: 'HeyHey-Repository-Discovery',
    });

    const lockKey = `${cacheKey}:lock`;
    const lockValue = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const lockTtlMs = 30 * 1000;
    let acquiredLock = false;

    try {
      acquiredLock = await this.acquireLock(lockKey, lockValue, lockTtlMs);

      if (!acquiredLock) {
        const cached = await this.waitForCache(cacheKey, 6, 200);
        if (cached) {
          return cached;
        }
      }

      // TODO: Cap maximum repositories fetched per cache fill (e.g., 500).
      const repos = org
        ? await octokit.paginate(octokit.rest.repos.listForOrg, {
            org,
            type: 'all',
            per_page: 100,
          })
        : await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
            per_page: 100,
            affiliation: 'owner,collaborator,organization_member',
            visibility: 'all',
          });

      const mapped = repos
        .map((repo) => this.mapRepository(repo as GitHubRepoApiResponse))
        .filter((repo): repo is GitHubRepositoryDto => repo !== null);

      const redis = this.redisService.getClient();
      await redis.set(cacheKey, JSON.stringify(mapped), 'PX', this.cacheTtlMs);
      return mapped;
    } catch (error) {
      this.handleGitHubError(error, 'list repositories');
      throw error;
    } finally {
      if (acquiredLock) {
        await this.releaseLock(`${cacheKey}:lock`, lockValue);
      }
    }
  }

  private mapRepository(
    repo: GitHubRepoApiResponse,
  ): GitHubRepositoryDto | null {
    if (
      !repo.name ||
      !repo.full_name ||
      !repo.html_url ||
      !repo.default_branch
    ) {
      return null;
    }

    const owner = repo.owner?.login ?? repo.full_name.split('/')[0];
    if (!owner) {
      return null;
    }

    return {
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? null,
      url: repo.html_url,
      defaultBranch: repo.default_branch,
      owner,
    };
  }

  private buildCacheKey(integrationId: IntegrationId, org?: string): string {
    const scope = org ? `org:${org}` : 'user';
    return `github:repos:${integrationId}:${scope}`;
  }

  private async acquireLock(
    lockKey: string,
    lockValue: string,
    ttlMs: number,
  ): Promise<boolean> {
    const redis = this.redisService.getClient();
    const result = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  private async releaseLock(lockKey: string, lockValue: string): Promise<void> {
    const redis = this.redisService.getClient();
    const currentValue = await redis.get(lockKey);
    if (currentValue === lockValue) {
      await redis.del(lockKey);
    }
  }

  private async waitForCache(
    cacheKey: string,
    attempts: number,
    delayMs: number,
  ): Promise<GitHubRepositoryDto[] | null> {
    for (let i = 0; i < attempts; i += 1) {
      const cached = await this.getCachedRepositories(cacheKey);
      if (cached) {
        return cached;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  private handleGitHubError(error: unknown, operation: string): void {
    const status = this.getStatus(error);
    const headers = this.getHeaders(error);

    if (status === 403 && headers?.['x-ratelimit-remaining'] === '0') {
      const reset = headers?.['x-ratelimit-reset'];
      const resetAt = reset
        ? new Date(Number(reset) * 1000).toISOString()
        : null;
      const message = resetAt
        ? `GitHub rate limit exceeded. Try again after ${resetAt}.`
        : 'GitHub rate limit exceeded. Please try again later.';
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (status === 404) {
      throw new NotFoundException(
        `GitHub ${operation} failed: repository or organization not found or not accessible`,
      );
    }

    if (status === 403) {
      throw new ForbiddenException(
        `GitHub ${operation} failed: insufficient permissions for the connected account`,
      );
    }

    if (status) {
      throw new BadRequestException(
        `GitHub ${operation} failed with status ${status}`,
      );
    }
  }

  private getStatus(error: unknown): number | null {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: unknown }).status;
      return typeof status === 'number' ? status : null;
    }
    return null;
  }

  private getHeaders(error: unknown): Record<string, string> | null {
    if (!error || typeof error !== 'object') {
      return null;
    }
    const response = (
      error as { response?: { headers?: Record<string, string> } }
    ).response;
    if (!response?.headers) {
      return null;
    }
    return response.headers;
  }
}
