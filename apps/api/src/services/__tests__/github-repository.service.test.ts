import { Test, TestingModule } from '@nestjs/testing';
import {
  GitHubIntegrationConfig,
  IntegrationConnectionStatus,
  IntegrationResponseDto,
  IntegrationState,
  IntegrationType,
} from '../../generated';
import { GitHubRepositoryService } from '../integrations/github-repository.service';
import { IntegrationService } from '../integrations/integration.service';
import { createRedisServiceMock } from '../../../test/mocks/redis-service.mock';
import { IntegrationId, OrganizationId, ProjectId } from '../../types';

const mockPaginate = jest.fn();
const mockOctokitRest = {
  repos: {
    listForOrg: jest.fn(),
    listForAuthenticatedUser: jest.fn(),
    get: jest.fn(),
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: mockOctokitRest,
    paginate: mockPaginate,
  })),
}));

describe('GitHubRepositoryService', () => {
  let service: GitHubRepositoryService;
  let integrationService: IntegrationService;
  const redisProvider = createRedisServiceMock();

  const integrationBase: IntegrationResponseDto = {
    id: 'integration-1' as IntegrationId,
    projectId: 'project-1' as ProjectId,
    organizationId: 'org-1' as OrganizationId,
    type: IntegrationType.Github,
    targetType: 'ORGANIZATION',
    name: 'GitHub Integration',
    description: 'Test GitHub integration',
    config: { token: 'github-token' },
    state: IntegrationState.Active,
    connectionStatus: IntegrationConnectionStatus.Pending,
    lastConnectionCheck: null,
    lastSuccessfulSync: null,
    errorMessage: null,
    createdBy: null,
    createdAt: '2023-12-01T12:00:00Z',
    updatedAt: '2023-12-01T12:00:00Z',
    deletedAt: null,
  };

  beforeEach(async () => {
    mockPaginate.mockReset();
    mockOctokitRest.repos.listForOrg.mockReset();
    mockOctokitRest.repos.listForAuthenticatedUser.mockReset();
    mockOctokitRest.repos.get.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubRepositoryService,
        {
          provide: IntegrationService,
          useValue: {
            findOneWithDecryptedConfig: jest.fn(),
            update: jest.fn(),
          },
        },
        redisProvider,
      ],
    }).compile();

    service = module.get<GitHubRepositoryService>(GitHubRepositoryService);
    integrationService = module.get<IntegrationService>(IntegrationService);
  });

  const getRedisClient = () =>
    redisProvider.useValue.getClient() as {
      get: jest.Mock;
      set: jest.Mock;
    };

  it('returns cached repositories when available', async () => {
    const cachedRepos = [
      {
        name: 'api',
        fullName: 'octocat/api',
        description: 'API repo',
        url: 'https://github.com/octocat/api',
        defaultBranch: 'main',
        owner: 'octocat',
      },
      {
        name: 'web',
        fullName: 'octocat/web',
        description: 'Web repo',
        url: 'https://github.com/octocat/web',
        defaultBranch: 'main',
        owner: 'octocat',
      },
      {
        name: 'infra',
        fullName: 'octocat/infra',
        description: null,
        url: 'https://github.com/octocat/infra',
        defaultBranch: 'main',
        owner: 'octocat',
      },
    ];

    jest
      .spyOn(integrationService, 'findOneWithDecryptedConfig')
      .mockResolvedValue(integrationBase);

    const redis = getRedisClient();
    redis.get.mockResolvedValue(JSON.stringify(cachedRepos));

    const result = await service.listRepositories({
      organizationId: 'org-1' as OrganizationId,
      projectId: 'project-1' as ProjectId,
      integrationId: 'integration-1' as IntegrationId,
      page: 1,
      limit: 2,
    });

    expect(mockPaginate).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(3);
    expect(result.pagination.totalPages).toBe(2);
  });

  it('fetches repositories for the authenticated user when cache is empty', async () => {
    const repos = [
      {
        name: 'api',
        full_name: 'octocat/api',
        description: 'API repo',
        html_url: 'https://github.com/octocat/api',
        default_branch: 'main',
        owner: { login: 'octocat' },
      },
    ];

    jest
      .spyOn(integrationService, 'findOneWithDecryptedConfig')
      .mockResolvedValue(integrationBase);

    const redis = getRedisClient();
    redis.get.mockResolvedValue(null);
    mockPaginate.mockResolvedValue(repos);

    const result = await service.listRepositories({
      organizationId: 'org-1' as OrganizationId,
      projectId: 'project-1' as ProjectId,
      integrationId: 'integration-1' as IntegrationId,
    });

    expect(mockPaginate).toHaveBeenCalledWith(
      mockOctokitRest.repos.listForAuthenticatedUser,
      expect.objectContaining({
        per_page: 100,
      }),
    );
    expect(redis.set).toHaveBeenCalled();
    expect(result.data[0]?.fullName).toBe('octocat/api');
  });

  it('fetches repositories for an organization when org is provided', async () => {
    const repos = [
      {
        name: 'platform',
        full_name: 'acme/platform',
        description: 'Platform',
        html_url: 'https://github.com/acme/platform',
        default_branch: 'main',
        owner: { login: 'acme' },
      },
    ];

    jest
      .spyOn(integrationService, 'findOneWithDecryptedConfig')
      .mockResolvedValue(integrationBase);

    const redis = getRedisClient();
    redis.get.mockResolvedValue(null);
    mockPaginate.mockResolvedValue(repos);

    const result = await service.listRepositories({
      organizationId: 'org-1' as OrganizationId,
      projectId: 'project-1' as ProjectId,
      integrationId: 'integration-1' as IntegrationId,
      org: 'acme',
    });

    expect(mockPaginate).toHaveBeenCalledWith(
      mockOctokitRest.repos.listForOrg,
      expect.objectContaining({
        org: 'acme',
        per_page: 100,
      }),
    );
    expect(result.data[0]?.owner).toBe('acme');
  });

  it('updates primary repository metadata after validation', async () => {
    const config: GitHubIntegrationConfig = {
      token: 'github-token',
    };
    const integration = { ...integrationBase, config };

    jest
      .spyOn(integrationService, 'findOneWithDecryptedConfig')
      .mockResolvedValue(integration);
    jest.spyOn(integrationService, 'update').mockResolvedValue(integration);
    mockOctokitRest.repos.get.mockResolvedValue({
      data: {
        full_name: 'octocat/api',
        html_url: 'https://github.com/octocat/api',
        default_branch: 'main',
        owner: { login: 'octocat' },
      },
    });

    await service.updatePrimaryRepository({
      organizationId: 'org-1' as OrganizationId,
      projectId: 'project-1' as ProjectId,
      integrationId: 'integration-1' as IntegrationId,
      payload: { fullName: 'octocat/api' },
    });

    expect(mockOctokitRest.repos.get).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'api',
    });
    expect(integrationService.update).toHaveBeenCalledWith(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      'integration-1' as IntegrationId,
      {
        config: expect.objectContaining({
          repositoryUrl: 'https://github.com/octocat/api',
          primaryRepository: {
            fullName: 'octocat/api',
            owner: 'octocat',
            defaultBranch: 'main',
          },
        }),
      },
    );
  });

  it('surfaces rate limit errors with a user-friendly message', async () => {
    jest
      .spyOn(integrationService, 'findOneWithDecryptedConfig')
      .mockResolvedValue(integrationBase);

    const redis = getRedisClient();
    redis.get.mockResolvedValue(null);
    mockPaginate.mockRejectedValue({
      status: 403,
      response: {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1700000000',
        },
      },
    });

    await expect(
      service.listRepositories({
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        integrationId: 'integration-1' as IntegrationId,
      }),
    ).rejects.toThrow('GitHub rate limit exceeded');
  });
});
