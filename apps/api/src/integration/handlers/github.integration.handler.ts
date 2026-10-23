import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { graphql } from '@octokit/graphql';
import { Integration, IntegrationTargetType, Prisma } from '@prisma/client';
import {
  ArtifactSourceType,
  ArtifactStatus,
  ArtifactType,
  CreateArtifactDto,
  DecisionData,
  DocumentData,
  GitHubIntegrationConfig,
  IntegrationType,
  Priority,
  IssueData,
  GitHubWebhookAcceptedEvent,
} from '../../generated';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { PrismaService } from '../../prisma/prisma.service';
import { ArtifactService } from '../../services/artifacts/artifact.service';
import { ConfigEncryptionService } from '../../services/config-encryption.service';
import { SuggestedUser } from '../../services/user-suggestion.service';
import { OrganizationId, ProjectId } from '../../types';
import {
  GitHubGraphQLIssue,
  GitHubGraphQLPullRequest,
  GitHubGraphQLRepository,
  ORGANIZATION_REPOSITORIES_QUERY,
  OrganizationRepositoriesQueryResponse,
  REPOSITORY_SYNC_QUERY,
  SINGLE_REPOSITORY_QUERY,
  USER_REPOSITORIES_QUERY,
  UserRepositoriesQueryResponse,
  VIEWER_QUERY,
  isValidGitHubRepository,
  safeGetAssignees,
  safeGetLabels,
  safeGetLogin,
} from '../types/github-graphql.types';
import { GitHubConfig, GitHubRepository } from '../types/github.types';
import {
  BaseIntegrationHandler,
  ConnectionTestResult,
} from './base-integration.handler';
import {
  GitHubWebhookAcceptanceInput,
  GitHubWebhookAcceptanceResult,
} from '../../types/webhook.types';

@Injectable()
export class GitHubIntegrationHandler extends BaseIntegrationHandler<
  GitHubWebhookAcceptanceInput,
  GitHubWebhookAcceptanceResult
> {
  private readonly logger = new Logger(GitHubIntegrationHandler.name);

  constructor(
    private readonly encryption: ConfigEncryptionService,
    private readonly artifactTypedService: ArtifactService,
    private readonly prisma: PrismaService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {
    super();
  }

  getIntegrationType(): string {
    return IntegrationType.Github;
  }

  async testConnection(
    config: GitHubIntegrationConfig,
    organizationId: OrganizationId,
  ): Promise<ConnectionTestResult> {
    try {
      const decryptedConfig = await this.getDecryptedConfig(
        config,
        organizationId,
      );
      const graphqlWithAuth = this.createGraphQLClient(decryptedConfig.token);
      const result = await graphqlWithAuth<{
        viewer: {
          login: string;
          name: string;
          email: string;
          avatarUrl: string;
        };
      }>(VIEWER_QUERY);
      const user = result.viewer;

      this.logger.log(
        `GitHub connection test successful for user: ${user.login}`,
      );

      return {
        connected: true,
        details: {
          username: user.login,
          name: user.name,
          email: user.email,
        },
      };
    } catch (error) {
      this.logger.error('GitHub connection test failed:', error);
      return {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to connect to GitHub API',
        details: {
          statusCode: this.extractStatusCode(error),
        },
      };
    }
  }

  async sync(integration: Integration): Promise<void> {
    this.logger.log(`Starting GitHub sync for integration ${integration.id}`);

    // Validate integration config structure
    if (!integration.config || typeof integration.config !== 'object') {
      throw new Error('Invalid integration config: must be an object');
    }

    // Validate and cast integration IDs safely
    if (typeof integration.organizationId !== 'string') {
      throw new Error('Invalid organization ID: must be a string');
    }
    if (typeof integration.projectId !== 'string') {
      throw new Error('Invalid project ID: must be a string');
    }

    const decryptedConfig = await this.getDecryptedConfig(
      integration.config as unknown as GitHubIntegrationConfig,
      integration.organizationId as OrganizationId,
    );
    const graphqlWithAuth = this.createGraphQLClient(decryptedConfig.token);

    let repositories: GitHubRepository[] = [];

    if (integration.targetType === IntegrationTargetType.ORGANIZATION) {
      this.logger.log(`Syncing GitHub organization: ${decryptedConfig.owner}`);
      repositories = await this.syncOrganization(
        graphqlWithAuth,
        decryptedConfig.owner,
      );
    } else {
      this.logger.log(`Syncing GitHub user: ${decryptedConfig.owner}`);
      repositories = await this.syncUser(
        graphqlWithAuth,
        decryptedConfig.repositoryUrl,
        decryptedConfig.owner,
      );
    }

    // PERFORMANCE: Limit the number of repositories to prevent memory exhaustion
    const maxRepositories = parseInt(
      process.env.GITHUB_MAX_REPOSITORIES || '50',
    );
    if (repositories.length > maxRepositories) {
      this.logger.warn(
        `Limiting repository sync from ${repositories.length} to ${maxRepositories} repositories. Configure GITHUB_MAX_REPOSITORIES to adjust.`,
      );
      repositories = repositories.slice(0, maxRepositories);
    }

    this.logger.log(
      `Found ${repositories.length} repositories, processing artifacts...`,
    );

    // PERFORMANCE: Process repositories in parallel with concurrency control
    const maxConcurrency = parseInt(process.env.GITHUB_SYNC_CONCURRENCY || '5');
    await this.processRepositoriesInParallel(
      repositories,
      graphqlWithAuth,
      integration.organizationId as OrganizationId,
      integration.projectId as ProjectId,
      maxConcurrency,
    );

    this.logger.log(`GitHub sync completed for integration ${integration.id}`);
  }

  /**
   * Process repositories in parallel with concurrency control
   */
  private async processRepositoriesInParallel(
    repositories: GitHubRepository[],
    graphqlWithAuth: typeof graphql,
    organizationId: OrganizationId,
    projectId: ProjectId,
    maxConcurrency: number,
  ): Promise<void> {
    for (let i = 0; i < repositories.length; i += maxConcurrency) {
      const batch = repositories.slice(i, i + maxConcurrency);

      const batchPromises = batch.map(async (repository) => {
        try {
          await this.processRepository(
            graphqlWithAuth,
            repository,
            organizationId,
            projectId,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process repository ${repository.fullName}:`,
            error,
          );
        }
      });

      // Wait for the current batch to complete before processing the next batch
      await Promise.allSettled(batchPromises);

      // Add a small delay between batches to be respectful to GitHub's API
      if (i + maxConcurrency < repositories.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async syncUser(
    graphqlWithAuth: typeof graphql,
    repositoryUrl: string | undefined,
    username: string,
  ): Promise<GitHubRepository[]> {
    try {
      // If repositoryUrl is specified, fetch only that repository
      if (repositoryUrl) {
        const { owner, repo } = this.parseRepositoryUrl(repositoryUrl);

        // Fetch single repository using a different query
        const result = await graphqlWithAuth<{
          repository: {
            id: string;
            owner: {
              login: string;
            };
            name: string;
          };
        }>(SINGLE_REPOSITORY_QUERY, {
          owner,
          name: repo,
        });

        const repoData = result.repository;
        if (!repoData || !isValidGitHubRepository(repoData)) {
          throw new Error(
            `Invalid repository data received for ${owner}/${repo}`,
          );
        }
        return [
          {
            owner: repoData.owner.login,
            repo: repoData.name,
            fullName: `${repoData.owner.login}/${repoData.name}`,
          },
        ];
      }

      // Otherwise, fetch all user repositories (existing logic)
      const repositories: GitHubRepository[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const result: UserRepositoriesQueryResponse = await graphqlWithAuth(
          USER_REPOSITORIES_QUERY,
          {
            user: username,
            cursor,
          },
        );

        if (!result.user) {
          throw new Error(`User ${username} not found`);
        }

        const repoData = result.user.repositories;
        const repos = repoData.nodes.map((repo) => ({
          owner: repo.owner.login,
          repo: repo.name,
          fullName: `${repo.owner.login}/${repo.name}`,
        }));

        repositories.push(...repos);
        hasNextPage = repoData.pageInfo.hasNextPage;
        cursor = repoData.pageInfo.endCursor;
      }

      return repositories;
    } catch (error) {
      throw this.createAPIError('GitHub', `sync user ${username}`, error);
    }
  }

  private async syncOrganization(
    graphqlWithAuth: typeof graphql,
    org: string,
  ): Promise<GitHubRepository[]> {
    try {
      const repositories: GitHubRepository[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const result: OrganizationRepositoriesQueryResponse =
          await graphqlWithAuth(ORGANIZATION_REPOSITORIES_QUERY, {
            org,
            cursor,
          });

        if (!result.organization) {
          throw new Error(`Organization ${org} not found`);
        }

        const repoData = result.organization.repositories;
        const repos = repoData.nodes.map((repo) => ({
          owner: repo.owner.login,
          repo: repo.name,
          fullName: `${repo.owner.login}/${repo.name}`,
        }));

        repositories.push(...repos);
        hasNextPage = repoData.pageInfo.hasNextPage;
        cursor = repoData.pageInfo.endCursor;
      }

      return repositories;
    } catch (error) {
      throw this.createAPIError('GitHub', `sync organization ${org}`, error);
    }
  }

  /**
   * Process a single repository to create artifacts for documentation, issues, and PRs
   */
  private async processRepository(
    graphqlWithAuth: typeof graphql,
    repository: GitHubRepository,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    this.logger.log(`Processing repository: ${repository.fullName}`);

    try {
      // Fetch all repository data in a single GraphQL query
      const result: { repository: GitHubGraphQLRepository } =
        await graphqlWithAuth(REPOSITORY_SYNC_QUERY, {
          owner: repository.owner,
          name: repository.repo,
        });

      const repoData = result.repository;
      if (!repoData || !isValidGitHubRepository(repoData)) {
        throw new Error(
          `Invalid repository data received for ${repository.fullName}`,
        );
      }
      const artifacts: CreateArtifactDto[] = [];

      // Process documentation (README and docs)
      const docArtifacts = this.processRepositoryDocumentation(
        repoData,
        organizationId,
        projectId,
      );
      artifacts.push(...docArtifacts);

      // Process issues
      const issueArtifacts = this.processRepositoryIssues(
        repoData,
        organizationId,
        projectId,
      );
      artifacts.push(...issueArtifacts);

      // Process pull requests
      const prArtifacts = this.processRepositoryPullRequests(
        repoData,
        organizationId,
        projectId,
      );
      artifacts.push(...prArtifacts);

      // Create all artifacts in batch
      if (artifacts.length > 0) {
        await this.artifactTypedService.createMany(artifacts);
        this.logger.log(
          `Created ${artifacts.length} artifacts for repository ${repository.fullName}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process repository ${repository.fullName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process repository documentation (README and docs directory)
   */
  private processRepositoryDocumentation(
    repoData: GitHubGraphQLRepository,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): CreateArtifactDto[] {
    const artifacts: CreateArtifactDto[] = [];

    // Null checks for repoData structure
    if (!repoData?.owner?.login || !repoData?.name) {
      this.logger.warn('Invalid repository data: missing owner or name');
      return artifacts;
    }

    // Process README with null checks
    if (repoData.readme?.text) {
      const documentData: DocumentData = {
        type: 'DOCUMENT',
        title: `${repoData.owner.login}/${repoData.name} - README`,
        content: repoData.readme.text,
        sourceDocumentId: `${repoData.owner.login}/${repoData.name}:README`,
      };

      artifacts.push({
        organizationId,
        projectId,
        type: ArtifactType.Document,
        data: documentData,
        sourceType: ArtifactSourceType.GithubReadme,
        sourceId: `${repoData.owner.login}/${repoData.name}`,
        tags: ['documentation', 'readme', 'github'],
        category: 'repository-documentation',
        priority: Priority.Medium,
        status: ArtifactStatus.Active,
        generateEmbedding: true,
      });
    }

    // Process docs directory files with enhanced null checks
    if (repoData.docs?.entries && Array.isArray(repoData.docs.entries)) {
      for (const entry of repoData.docs.entries) {
        if (entry?.type === 'blob' && entry?.object?.text && entry?.name) {
          const documentData: DocumentData = {
            type: 'DOCUMENT',
            title: `${repoData.owner.login}/${repoData.name} - ${entry.name}`,
            content: entry.object.text,
            sourceDocumentId: `${repoData.owner.login}/${repoData.name}:${entry.name}`,
          };

          artifacts.push({
            organizationId,
            projectId,
            type: ArtifactType.Document,
            data: documentData,
            sourceType: ArtifactSourceType.GithubDocs,
            sourceId: `${repoData.owner.login}/${repoData.name}:${entry.name}`,
            tags: ['documentation', 'docs', 'github'],
            category: 'repository-documentation',
            priority: Priority.Medium,
            status: ArtifactStatus.Active,
            generateEmbedding: true,
          });
        }
      }
    }

    return artifacts;
  }

  /**
   * Process repository issues
   */
  private processRepositoryIssues(
    repoData: GitHubGraphQLRepository,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): CreateArtifactDto[] {
    const artifacts: CreateArtifactDto[] = [];

    // Null check for repository data
    if (!repoData?.owner?.login || !repoData?.name) {
      this.logger.warn('Invalid repository data for issues processing');
      return artifacts;
    }

    // Null check for issues collection
    if (!repoData.issues?.nodes || !Array.isArray(repoData.issues.nodes)) {
      this.logger.debug('No issues found or invalid issues data structure');
      return artifacts;
    }

    for (const issue of repoData.issues.nodes) {
      // Null checks for issue data
      if (!issue || typeof issue.number !== 'number' || !issue.title) {
        this.logger.warn('Skipping invalid issue: missing number or title');
        continue;
      }

      const issueData: IssueData = {
        type: 'ISSUE',
        title: `Issue #${issue.number}: ${issue.title}`,
        description: issue.body || 'No description provided',
        status: issue.state?.toUpperCase() === 'OPEN' ? 'OPEN' : 'CLOSED',
        severity: this.mapPriorityToIssueSeverity(this.getIssuePriority(issue)),
        assignee: safeGetAssignees(issue.assignees)[0] || undefined,
        sourceSystemId: issue.id,
        relatedIssues: this.extractLinkedIssues(issue.body || '', []),
      };

      artifacts.push({
        organizationId,
        projectId,
        type: ArtifactType.Issue,
        data: issueData,
        sourceType: ArtifactSourceType.GithubIssue,
        sourceId: `${repoData.owner.login}/${repoData.name}:${issue.number}`,
        tags: [
          'github',
          'issue',
          issue.state || 'unknown',
          ...safeGetLabels(issue.labels),
        ],
        category: 'github-issues',
        priority: this.getIssuePriority(issue),
        status:
          issue.state === 'open'
            ? ArtifactStatus.Active
            : ArtifactStatus.Archived,
        generateEmbedding: true,
      });
    }

    return artifacts;
  }

  /**
   * Process repository pull requests
   */
  private processRepositoryPullRequests(
    repoData: GitHubGraphQLRepository,
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): CreateArtifactDto[] {
    const artifacts: CreateArtifactDto[] = [];

    // Null check for repository data
    if (!repoData?.owner?.login || !repoData?.name) {
      this.logger.warn('Invalid repository data for pull requests processing');
      return artifacts;
    }

    // Null check for pull requests collection
    if (
      !repoData.pullRequests?.nodes ||
      !Array.isArray(repoData.pullRequests.nodes)
    ) {
      this.logger.debug(
        'No pull requests found or invalid pull requests data structure',
      );
      return artifacts;
    }

    for (const pr of repoData.pullRequests.nodes) {
      // Null checks for PR data
      if (!pr || typeof pr.number !== 'number' || !pr.title) {
        this.logger.warn(
          'Skipping invalid pull request: missing number or title',
        );
        continue;
      }

      const linkedIssues = this.extractLinkedIssues(
        pr.body || '',
        pr.comments?.nodes || [],
      );

      const decisionData: DecisionData = {
        type: 'DECISION',
        title: `PR #${pr.number}: ${pr.title}`,
        rationale: pr.body || 'No description provided',
        alternatives: [], // GitHub PRs don't typically have explicit alternatives
        outcome:
          pr.state === 'MERGED'
            ? 'Merged'
            : pr.state === 'CLOSED'
              ? 'Rejected'
              : 'Pending',
        stakeholders: [
          safeGetLogin(pr.author),
          ...safeGetAssignees(pr.assignees),
          ...(pr.reviewRequests?.nodes
            ?.map((req) => safeGetLogin(req?.requestedReviewer))
            .filter((name) => name !== 'Unknown') || []),
        ].filter(Boolean),
        relatedArtifactIds: linkedIssues,
      };

      artifacts.push({
        organizationId,
        projectId,
        type: ArtifactType.Decision,
        data: decisionData,
        sourceType: ArtifactSourceType.GithubPullRequest,
        sourceId: `${repoData.owner.login}/${repoData.name}:${pr.number}`,
        tags: [
          'github',
          'pull-request',
          pr.state || 'unknown',
          ...safeGetLabels(pr.labels),
        ],
        category: 'github-pull-requests',
        priority: this.getPullRequestPriority(pr),
        status: this.getPullRequestStatus(pr),
        generateEmbedding: true,
      });
    }

    return artifacts;
  }

  private createGraphQLClient(token: string) {
    if (!token) {
      throw new Error('GitHub token is required');
    }
    this.logger.debug('Creating GraphQL client with GitHub API token');
    return graphql.defaults({
      headers: {
        authorization: `token ${token}`,
      },
    });
  }

  private async getDecryptedConfig(
    config: GitHubIntegrationConfig,
    organizationId: OrganizationId,
  ): Promise<GitHubConfig> {
    const decrypted = await this.encryption.decryptConfig(
      config,
      IntegrationType.Github,
      organizationId,
    );

    // Validate decrypted config structure
    if (!decrypted || typeof decrypted !== 'object') {
      throw new Error('Invalid decrypted config: expected object');
    }

    const gitHubConfig = decrypted as Record<string, unknown>;
    if (typeof gitHubConfig.token !== 'string') {
      throw new Error('Invalid GitHub config: token must be a string');
    }

    const typedConfig: GitHubConfig = {
      token: gitHubConfig.token,
      owner: typeof gitHubConfig.owner === 'string' ? gitHubConfig.owner : '',
      repositoryUrl:
        typeof gitHubConfig.repositoryUrl === 'string'
          ? gitHubConfig.repositoryUrl
          : undefined,
      organization:
        typeof gitHubConfig.organization === 'string'
          ? gitHubConfig.organization
          : undefined,
      webhookSecret:
        typeof gitHubConfig.webhookSecret === 'string'
          ? gitHubConfig.webhookSecret
          : undefined,
      webhookEvents: this.validateWebhookEvents(gitHubConfig.webhookEvents),
    };

    // If owner is missing but repositoryUrl is present, extract owner from URL
    if (!typedConfig.owner && typedConfig.repositoryUrl) {
      const match = typedConfig.repositoryUrl.match(/github\.com\/([^/]+)/);
      const owner = match?.[1];
      if (owner) {
        typedConfig.owner = owner;
        this.logger.debug(
          `Extracted owner "${typedConfig.owner}" from repositoryUrl: ${typedConfig.repositoryUrl}`,
        );
      } else {
        throw new Error(
          `Invalid GitHub repositoryUrl format: ${typedConfig.repositoryUrl}. Expected format: https://github.com/owner/repo`,
        );
      }
    }

    if (!typedConfig.owner) {
      throw new Error(
        'GitHub integration requires either an "owner" field or a valid "repositoryUrl" field',
      );
    }

    return typedConfig;
  }

  async handleWebhook(
    input: GitHubWebhookAcceptanceInput,
    integration: Integration,
  ): Promise<GitHubWebhookAcceptanceResult> {
    const normalized = this.normalizeWebhookPayload(input.payload);
    const payloadHash = createHash('sha256')
      .update(input.rawBody)
      .digest('hex');
    const lockKey = `${integration.id}:${input.deliveryId}`;

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        );

        const existing = await tx.gitHubWebhookInbox.findUnique({
          where: {
            integrationId_deliveryId: {
              integrationId: integration.id,
              deliveryId: input.deliveryId,
            },
          },
        });

        if (existing) {
          this.logger.debug('GitHub webhook duplicate acknowledged', {
            integrationId: integration.id,
            deliveryId: input.deliveryId,
            inboxId: existing.id,
          });
          return {
            accepted: true,
            duplicate: true,
            inboxId: existing.id,
          };
        }

        const inbox = await tx.gitHubWebhookInbox.create({
          data: {
            integrationId: integration.id,
            organizationId: integration.organizationId,
            projectId: integration.projectId,
            deliveryId: input.deliveryId,
            eventName: input.eventName,
            repositoryFullName: normalized.repository.fullName,
            payloadHash,
            normalizedEvent: normalized,
          },
        });

        const event = {
          type: 'github.webhook.accepted',
          aggregateId: inbox.id,
          payload: {
            organizationId: integration.organizationId as OrganizationId,
            projectId: integration.projectId as ProjectId,
            integrationId: integration.id,
            inboxId: inbox.id,
            deliveryId: input.deliveryId,
            eventName: input.eventName,
            ...normalized,
            acceptedAt: inbox.acceptedAt.toISOString(),
          },
        } satisfies Omit<GitHubWebhookAcceptedEvent, 'id'>;

        await this.domainEventPublisher.publishInTransaction(tx, event);
        this.logger.debug('GitHub webhook accepted and persisted', {
          integrationId: integration.id,
          deliveryId: input.deliveryId,
          inboxId: inbox.id,
          projectId: integration.projectId,
          eventName: input.eventName,
        });

        return {
          accepted: true,
          duplicate: false,
          inboxId: inbox.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private normalizeWebhookPayload(
    payload: GitHubWebhookAcceptanceInput['payload'],
  ) {
    const repository = payload.repository;
    if (
      !repository ||
      !Number.isInteger(repository.id) ||
      typeof repository.full_name !== 'string' ||
      repository.full_name.trim().length === 0 ||
      !this.isHttpUrl(repository.html_url)
    ) {
      this.logger.debug('GitHub webhook payload rejected', {
        reason: 'invalid_repository',
      });
      throw new BadRequestException('Invalid GitHub repository payload');
    }

    if (payload.action !== undefined && typeof payload.action !== 'string') {
      this.logger.debug('GitHub webhook payload rejected', {
        reason: 'invalid_action',
      });
      throw new BadRequestException('Invalid GitHub webhook action');
    }

    const pullRequest = this.normalizePullRequest(payload.pull_request);
    return {
      repository: {
        id: repository.id,
        fullName: repository.full_name,
        htmlUrl: repository.html_url,
      },
      action: payload.action ?? null,
      ...(pullRequest ? { pullRequest } : {}),
    } satisfies Prisma.InputJsonObject;
  }

  private normalizePullRequest(value: unknown) {
    if (value === undefined) {
      return undefined;
    }
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Invalid GitHub pull request payload');
    }

    const pullRequest = value as Record<string, unknown>;
    const head = pullRequest.head;
    const base = pullRequest.base;
    const mergedBy = pullRequest.merged_by;
    const mergedByLoginValue =
      mergedBy && typeof mergedBy === 'object'
        ? (mergedBy as Record<string, unknown>).login
        : undefined;
    const mergedByLogin =
      typeof mergedByLoginValue === 'string'
        ? mergedByLoginValue
        : null;
    if (
      !Number.isInteger(pullRequest.id) ||
      !Number.isInteger(pullRequest.number) ||
      typeof pullRequest.title !== 'string' ||
      typeof pullRequest.state !== 'string' ||
      typeof pullRequest.merged !== 'boolean' ||
      (pullRequest.merged === true && mergedByLogin === null) ||
      (pullRequest.merged_at !== null &&
        pullRequest.merged_at !== undefined &&
        !this.isDateTime(pullRequest.merged_at)) ||
      !this.isHttpUrl(pullRequest.html_url) ||
      !head ||
      typeof head !== 'object' ||
      typeof (head as Record<string, unknown>).sha !== 'string' ||
      !base ||
      typeof base !== 'object' ||
      typeof (base as Record<string, unknown>).sha !== 'string'
    ) {
      this.logger.debug('GitHub webhook payload rejected', {
        reason: 'invalid_pull_request',
      });
      throw new BadRequestException('Invalid GitHub pull request payload');
    }

    return {
      id: pullRequest.id as number,
      number: pullRequest.number as number,
      title: pullRequest.title,
      state: pullRequest.state,
      merged: pullRequest.merged,
      mergedAt: (pullRequest.merged_at as string | null | undefined) ?? null,
      mergedByLogin: pullRequest.merged === true ? mergedByLogin : null,
      htmlUrl: pullRequest.html_url as string,
      headSha: (head as Record<string, unknown>).sha as string,
      baseSha: (base as Record<string, unknown>).sha as string,
    } satisfies Prisma.InputJsonObject;
  }

  private isHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string') {
      return false;
    }
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private isDateTime(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }

  async validateConfig(config: unknown): Promise<boolean> {
    return this.isValidGitHubConfig(config);
  }

  private isValidGitHubConfig(
    config: unknown,
  ): config is GitHubIntegrationConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }
    const configObj = config as Record<string, unknown>;
    const hasToken =
      'token' in configObj && typeof configObj.token === 'string';
    const hasOwner =
      'owner' in configObj && typeof configObj.owner === 'string';
    const hasRepositoryUrl =
      'repositoryUrl' in configObj &&
      typeof configObj.repositoryUrl === 'string';

    // Valid if we have a token and either an owner field or a repositoryUrl to extract owner from
    return hasToken && (hasOwner || hasRepositoryUrl);
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error instanceof Error && 'status' in error) {
      const statusError = error as Error & { status: unknown };
      return typeof statusError.status === 'number'
        ? statusError.status
        : undefined;
    }
    return undefined;
  }

  private validateWebhookEvents(events: unknown): string[] | undefined {
    if (!Array.isArray(events)) {
      return undefined;
    }

    const validEvents = events.filter(
      (event): event is string => typeof event === 'string',
    );
    return validEvents.length > 0 ? validEvents : undefined;
  }

  getRequiredConfigFields(): string[] {
    return ['token', 'owner OR repositoryUrl'];
  }

  async getSuggestedUsers(
    integration: Integration,
    projectId?: string,
  ): Promise<SuggestedUser[]> {
    this.logger.log(
      `Getting suggested users from GitHub integration ${integration.id}`,
    );

    try {
      const config = await this.getDecryptedConfig(
        integration.config as unknown as GitHubIntegrationConfig,
        integration.organizationId as OrganizationId,
      );

      const graphqlWithAuth = this.createGraphQLClient(config.token);
      const suggestedUsers: SuggestedUser[] = [];

      // If we have a specific repository, get collaborators
      if (config.repositoryUrl) {
        const { owner, repo } = this.parseRepositoryUrl(config.repositoryUrl);
        const collaborators = await this.getRepositoryCollaborators(
          graphqlWithAuth,
          owner,
          repo,
        );
        suggestedUsers.push(...collaborators);
      }

      // If we have an organization, get organization members
      if (config.organization) {
        const members = await this.getOrganizationMembers(
          graphqlWithAuth,
          config.organization,
        );
        suggestedUsers.push(...members);
      }

      // Get users from recent repository activity (issues, PRs)
      const activityUsers = await this.getUsersFromRecentActivity(
        graphqlWithAuth,
        config,
      );
      suggestedUsers.push(...activityUsers);

      this.logger.log(
        `Found ${suggestedUsers.length} suggested users from GitHub`,
      );
      return suggestedUsers;
    } catch (error) {
      this.logger.error('Failed to get suggested users from GitHub:', error);
      throw this.createAPIError('GitHub', 'get suggested users', error);
    }
  }

  /**
   * Extract linked issue numbers from PR body and comments
   */
  private extractLinkedIssues(
    prBody: string,
    comments: Array<{ body: string }>,
  ): string[] {
    const issuePattern = /#(\d+)/g;
    const allText = [prBody, ...comments.map((c) => c.body)].join(' ');
    const matches = Array.from(allText.matchAll(issuePattern));
    const issues = matches
      .map((match) => match[1])
      .filter((match): match is string => Boolean(match));
    return [...new Set(issues)];
  }

  /**
   * Extract external links (Jira, Linear, Notion, etc.) from PR body and comments
   */
  private extractExternalLinks(
    prBody: string,
    comments: Array<{ body: string }>,
  ): string[] {
    const linkPattern = /https?:\/\/[^\s)\]]+/g;
    const allText = [prBody, ...comments.map((c) => c.body)].join(' ');
    const matches = Array.from(allText.matchAll(linkPattern));
    const links = matches
      .map((match) => match[0])
      .filter((match): match is string => Boolean(match));

    // Filter out GitHub links
    return [...new Set(links.filter((link) => !link.includes('github.com')))];
  }

  /**
   * Format issue content for artifact storage
   */
  private formatIssueContent(issue: GitHubGraphQLIssue): string {
    const createdDate = new Date(issue.createdAt).toLocaleDateString();
    const closedDate = issue.closedAt
      ? new Date(issue.closedAt).toLocaleDateString()
      : null;

    return [
      `Issue #${issue.number}: ${issue.title}`,
      '',
      issue.body || '',
      '',
      `State: ${issue.state}`,
      `Author: ${safeGetLogin(issue.author)}`,
      `Created: ${createdDate}`,
      closedDate ? `Closed: ${closedDate}` : '',
      `Labels: ${safeGetLabels(issue.labels).join(', ')}`,
      `Assignees: ${safeGetAssignees(issue.assignees).join(', ')}`,
      `Comments: ${issue.comments?.totalCount || 0}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Format pull request content for artifact storage
   */
  private formatPullRequestContent(pr: GitHubGraphQLPullRequest): string {
    const createdDate = new Date(pr.createdAt).toLocaleDateString();
    const mergedDate = pr.mergedAt
      ? new Date(pr.mergedAt).toLocaleDateString()
      : null;
    const closedDate = pr.closedAt
      ? new Date(pr.closedAt).toLocaleDateString()
      : null;

    const sections = [
      `Pull Request #${pr.number}: ${pr.title}`,
      '',
      pr.body || '',
      '',
      `State: ${pr.state}`,
      `Author: ${safeGetLogin(pr.author)}`,
      `Created: ${createdDate}`,
      mergedDate ? `Merged: ${mergedDate}` : '',
      closedDate && !mergedDate ? `Closed: ${closedDate}` : '',
      `Base branch: ${pr.baseRefName}`,
      `Head branch: ${pr.headRefName}`,
      `Files changed: ${pr.changedFiles}`,
      `Additions: ${pr.additions}`,
      `Deletions: ${pr.deletions}`,
    ];

    // Add file changes
    if (pr.files?.nodes?.length > 0) {
      sections.push('', 'Changed Files:');
      for (const file of pr.files.nodes) {
        sections.push(
          `${file.path} (${file.changeType}): +${file.additions} -${file.deletions}`,
        );
      }
    }

    // Add discussion
    if (pr.comments?.nodes?.length > 0) {
      sections.push('', 'Discussion:');
      for (const comment of pr.comments.nodes) {
        sections.push(`${safeGetLogin(comment.author)}: ${comment.body}`);
      }
    }

    return sections.filter(Boolean).join('\n');
  }

  /**
   * Determine issue priority based on labels and state
   */
  private getIssuePriority(issue: GitHubGraphQLIssue): Priority {
    const labels = safeGetLabels(issue.labels).map((label) =>
      label.toLowerCase(),
    );

    if (
      labels.some(
        (label) => label.includes('critical') || label.includes('urgent'),
      )
    ) {
      return Priority.High;
    }
    if (
      labels.some(
        (label) => label.includes('high') || label.includes('important'),
      )
    ) {
      return Priority.High;
    }
    if (
      labels.some((label) => label.includes('low') || label.includes('minor'))
    ) {
      return Priority.Low;
    }

    return Priority.Medium;
  }

  /**
   * Determine pull request priority based on labels and changes
   */
  private getPullRequestPriority(pr: GitHubGraphQLPullRequest): Priority {
    const labels = safeGetLabels(pr.labels).map((label) => label.toLowerCase());

    if (
      labels.some(
        (label) => label.includes('critical') || label.includes('urgent'),
      )
    ) {
      return Priority.High;
    }
    if (
      labels.some(
        (label) => label.includes('high') || label.includes('important'),
      )
    ) {
      return Priority.High;
    }
    if (pr.changedFiles > 20 || pr.additions > 500) {
      return Priority.High;
    }
    if (
      labels.some((label) => label.includes('low') || label.includes('minor'))
    ) {
      return Priority.Low;
    }

    return Priority.Medium;
  }

  /**
   * Determine pull request status based on state
   */
  private getPullRequestStatus(pr: GitHubGraphQLPullRequest): ArtifactStatus {
    switch (pr.state.toLowerCase()) {
      case 'merged':
        return ArtifactStatus.Active; // Note: No COMPLETED status available
      case 'closed':
        return ArtifactStatus.Archived;
      case 'open':
      default:
        return ArtifactStatus.Active;
    }
  }

  /**
   * Get repository collaborators
   */
  private async getRepositoryCollaborators(
    graphqlWithAuth: typeof graphql,
    owner: string,
    repo: string,
  ): Promise<SuggestedUser[]> {
    try {
      const query = `
        query GetRepositoryCollaborators($owner: String!, $repo: String!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            collaborators(first: 100, after: $cursor) {
              nodes {
                login
                name
                email
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const users: SuggestedUser[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        interface CollaboratorResponse {
          repository?: {
            collaborators?: {
              nodes?: Array<{
                login: string;
                name?: string | null;
                email?: string | null;
                createdAt: string;
              }>;
              pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
              };
            };
          };
        }

        const result: CollaboratorResponse = await graphqlWithAuth(query, {
          owner,
          repo,
          cursor,
        });

        if (!result.repository?.collaborators?.nodes) {
          break;
        }

        const collaborators = result.repository.collaborators.nodes;

        for (const user of collaborators) {
          if (user.login && user.email) {
            users.push({
              name: user.name || user.login,
              email: user.email,
              sources: ['github'],
              confidence: 0.8, // High confidence for direct collaborators
              lastSeen: new Date(),
              integrationMetadata: {
                githubLogin: user.login,
                source: 'repository_collaborator',
                repository: `${owner}/${repo}`,
              },
            });
          }
        }

        hasNextPage = result.repository.collaborators.pageInfo.hasNextPage;
        cursor = result.repository.collaborators.pageInfo.endCursor;
      }

      return users;
    } catch (error) {
      this.logger.warn(
        `Failed to get repository collaborators for ${owner}/${repo}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get organization members
   */
  private async getOrganizationMembers(
    graphqlWithAuth: typeof graphql,
    organization: string,
  ): Promise<SuggestedUser[]> {
    try {
      const query = `
        query GetOrganizationMembers($org: String!, $cursor: String) {
          organization(login: $org) {
            members(first: 100, after: $cursor) {
              nodes {
                login
                name
                email
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `;

      const users: SuggestedUser[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        interface OrgMemberResponse {
          organization?: {
            members?: {
              nodes?: Array<{
                login: string;
                name?: string | null;
                email?: string | null;
                createdAt: string;
              }>;
              pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
              };
            };
          };
        }

        const result: OrgMemberResponse = await graphqlWithAuth(query, {
          org: organization,
          cursor,
        });

        if (!result.organization?.members?.nodes) {
          break;
        }

        const members = result.organization.members.nodes;

        for (const user of members) {
          if (user.login && user.email) {
            users.push({
              name: user.name || user.login,
              email: user.email,
              sources: ['github'],
              confidence: 0.7, // Good confidence for org members
              lastSeen: new Date(),
              integrationMetadata: {
                githubLogin: user.login,
                source: 'organization_member',
                organization,
              },
            });
          }
        }

        hasNextPage = result.organization.members.pageInfo.hasNextPage;
        cursor = result.organization.members.pageInfo.endCursor;
      }

      return users;
    } catch (error) {
      this.logger.warn(
        `Failed to get organization members for ${organization}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get users from recent repository activity (issues, PRs)
   */
  private async getUsersFromRecentActivity(
    graphqlWithAuth: typeof graphql,
    config: GitHubConfig,
  ): Promise<SuggestedUser[]> {
    try {
      const users: SuggestedUser[] = [];

      // If we have a specific repository, get activity from it
      if (config.repositoryUrl) {
        const { owner, repo } = this.parseRepositoryUrl(config.repositoryUrl);
        const repoUsers = await this.getRepositoryActivityUsers(
          graphqlWithAuth,
          owner,
          repo,
        );
        users.push(...repoUsers);
      }

      return users;
    } catch (error) {
      this.logger.warn('Failed to get users from recent activity:', error);
      return [];
    }
  }

  /**
   * Map Priority enum to IssueData.SeverityEnum
   */
  private mapPriorityToIssueSeverity(
    priority: Priority,
  ): IssueData.SeverityEnum {
    switch (priority) {
      case Priority.High:
        return 'HIGH';
      case Priority.Low:
        return 'LOW';
      case Priority.Critical:
        return 'CRITICAL';
      case Priority.Medium:
      default:
        return 'MEDIUM';
    }
  }

  /**
   * Get users from repository activity (recent issues and PRs)
   */
  private async getRepositoryActivityUsers(
    graphqlWithAuth: typeof graphql,
    owner: string,
    repo: string,
  ): Promise<SuggestedUser[]> {
    try {
      const query = `
        query GetRepositoryActivity($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
              nodes {
                author {
                  login
                  ... on User {
                    name
                    email
                  }
                }
                assignees(first: 10) {
                  nodes {
                    login
                    name
                    email
                  }
                }
                updatedAt
              }
            }
            pullRequests(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
              nodes {
                author {
                  login
                  ... on User {
                    name
                    email
                  }
                }
                assignees(first: 10) {
                  nodes {
                    login
                    name
                    email
                  }
                }
                updatedAt
              }
            }
          }
        }
      `;

      interface ActivityResponse {
        repository?: {
          issues?: {
            nodes?: Array<{
              author?: {
                login: string;
                name?: string | null;
                email?: string | null;
                __typename: string;
              } | null;
              assignees?: {
                nodes?: Array<{
                  login: string;
                  name?: string | null;
                  email?: string | null;
                }>;
              };
              updatedAt: string;
            }>;
          };
          pullRequests?: {
            nodes?: Array<{
              author?: {
                login: string;
                name?: string | null;
                email?: string | null;
                __typename: string;
              } | null;
              assignees?: {
                nodes?: Array<{
                  login: string;
                  name?: string | null;
                  email?: string | null;
                }>;
              };
              updatedAt: string;
            }>;
          };
        };
      }

      const result: ActivityResponse = await graphqlWithAuth(query, {
        owner,
        repo,
      });
      const users: SuggestedUser[] = [];
      const userMap = new Map<string, SuggestedUser>();

      // Process issues
      if (result.repository?.issues?.nodes) {
        for (const issue of result.repository.issues.nodes) {
          // Add issue author
          if (issue.author?.login && issue.author?.email) {
            const key = issue.author.email.toLowerCase();
            if (!userMap.has(key)) {
              userMap.set(key, {
                name: issue.author.name || issue.author.login,
                email: issue.author.email,
                sources: ['github'],
                confidence: 0.6, // Medium confidence for activity
                lastSeen: new Date(issue.updatedAt),
                integrationMetadata: {
                  githubLogin: issue.author.login,
                  source: 'issue_activity',
                  repository: `${owner}/${repo}`,
                },
              });
            }
          }

          // Add assignees
          if (issue.assignees?.nodes) {
            for (const assignee of issue.assignees.nodes) {
              if (assignee.login && assignee.email) {
                const key = assignee.email.toLowerCase();
                if (!userMap.has(key)) {
                  userMap.set(key, {
                    name: assignee.name || assignee.login,
                    email: assignee.email,
                    sources: ['github'],
                    confidence: 0.7, // Higher confidence for assignees
                    lastSeen: new Date(issue.updatedAt),
                    integrationMetadata: {
                      githubLogin: assignee.login,
                      source: 'issue_assignee',
                      repository: `${owner}/${repo}`,
                    },
                  });
                }
              }
            }
          }
        }
      }

      // Process pull requests
      if (result.repository?.pullRequests?.nodes) {
        for (const pr of result.repository.pullRequests.nodes) {
          // Add PR author
          if (pr.author?.login && pr.author?.email) {
            const key = pr.author.email.toLowerCase();
            if (!userMap.has(key)) {
              userMap.set(key, {
                name: pr.author.name || pr.author.login,
                email: pr.author.email,
                sources: ['github'],
                confidence: 0.6,
                lastSeen: new Date(pr.updatedAt),
                integrationMetadata: {
                  githubLogin: pr.author.login,
                  source: 'pr_activity',
                  repository: `${owner}/${repo}`,
                },
              });
            }
          }

          // Add assignees
          if (pr.assignees?.nodes) {
            for (const assignee of pr.assignees.nodes) {
              if (assignee.login && assignee.email) {
                const key = assignee.email.toLowerCase();
                if (!userMap.has(key)) {
                  userMap.set(key, {
                    name: assignee.name || assignee.login,
                    email: assignee.email,
                    sources: ['github'],
                    confidence: 0.7,
                    lastSeen: new Date(pr.updatedAt),
                    integrationMetadata: {
                      githubLogin: assignee.login,
                      source: 'pr_assignee',
                      repository: `${owner}/${repo}`,
                    },
                  });
                }
              }
            }
          }
        }
      }

      return Array.from(userMap.values());
    } catch (error) {
      this.logger.warn(
        `Failed to get activity users for ${owner}/${repo}:`,
        error,
      );
      return [];
    }
  }
}
