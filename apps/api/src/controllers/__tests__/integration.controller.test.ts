import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CreateIntegrationDto,
  IntegrationConnectionStatus,
  IntegrationResponseDto,
  IntegrationState,
  IntegrationType,
  PaginatedGitHubRepositoryResponse,
  UpdateGitHubPrimaryRepositoryDto,
  UpdateIntegrationDto,
} from '../../generated';
import {
  ConnectionTestResult,
  ConnectionTestService,
} from '../../services/connection-test.service';
import { IntegrationService } from '../../services/integrations/integration.service';
import { GitHubOAuthService } from '../../services/integrations/github-oauth.service';
import { GitHubRepositoryService } from '../../services/integrations/github-repository.service';
import { IntegrationId, OrganizationId, ProjectId, UserId } from '../../types';
import { IntegrationController } from '../integration.controller';
import { UserSuggestionService } from '../../services/user-suggestion.service';

describe('IntegrationController', () => {
  let controller: IntegrationController;
  let integrationService: IntegrationService;
  let connectionTestService: ConnectionTestService;
  let githubOAuthService: GitHubOAuthService;
  let githubRepositoryService: GitHubRepositoryService;

  const mockIntegration: IntegrationResponseDto = {
    id: 'integration-1' as IntegrationId,
    projectId: 'project-1' as ProjectId,
    organizationId: 'org-1' as OrganizationId,
    type: IntegrationType.Github,
    targetType: 'ORGANIZATION',
    name: 'GitHub Integration',
    description: 'Test GitHub integration',
    config: { token: '***MASKED***' },
    state: IntegrationState.Active,
    connectionStatus: IntegrationConnectionStatus.Pending,
    lastConnectionCheck: null,
    lastSuccessfulSync: null,
    errorMessage: null,
    createdBy: 'user-1' as UserId,
    createdAt: '2023-12-01T12:00:00Z',
    updatedAt: '2023-12-01T12:00:00Z',
    deletedAt: null,
  };

  const mockDecryptedIntegration: IntegrationResponseDto = {
    ...mockIntegration,
    config: { token: 'real-github-token' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationController],
      providers: [
        {
          provide: IntegrationService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            findOneWithDecryptedConfig: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            updateConnectionStatus: jest.fn(),
            sync: jest.fn(),
            testConnection: jest.fn(),
            storeGitHubOAuthTokens: jest.fn(),
          },
        },
        {
          provide: ConnectionTestService,
          useValue: {
            testConnection: jest.fn(),
          },
        },
        {
          provide: UserSuggestionService,
          useValue: {
            suggestUsers: jest.fn(),
            getSuggestionHistory: jest.fn(),
          },
        },
        {
          provide: GitHubOAuthService,
          useValue: {
            buildState: jest.fn(),
            buildAuthorizeUrl: jest.fn(),
            parseState: jest.fn(),
            exchangeCodeForToken: jest.fn(),
          },
        },
        {
          provide: GitHubRepositoryService,
          useValue: {
            listRepositories: jest.fn(),
            updatePrimaryRepository: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntegrationController>(IntegrationController);
    integrationService = module.get<IntegrationService>(IntegrationService);
    connectionTestService = module.get<ConnectionTestService>(
      ConnectionTestService,
    );
    githubOAuthService = module.get<GitHubOAuthService>(GitHubOAuthService);
    githubRepositoryService = module.get<GitHubRepositoryService>(
      GitHubRepositoryService,
    );
  });

  describe('createIntegration', () => {
    it('should create an integration successfully', async () => {
      const createDto: CreateIntegrationDto = {
        type: IntegrationType.Github,
        targetType: 'ORGANIZATION',
        name: 'Test Integration',
        description: 'Test description',
        config: { token: 'github-token' },
        state: IntegrationState.Active,
      };

      jest
        .spyOn(integrationService, 'create')
        .mockResolvedValue(mockIntegration);

      const result = await controller.createIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      expect(integrationService.create).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      expect(result).toEqual(mockIntegration);
    });

    it('should trigger automatic sync for active integrations', async () => {
      const createDto: CreateIntegrationDto = {
        type: IntegrationType.Github,
        name: 'Test Integration',
        targetType: 'ORGANIZATION',
        description: 'Test description',
        config: { token: 'github-token' },
        state: IntegrationState.Active,
      };

      const activeIntegration = {
        ...mockIntegration,
        state: IntegrationState.Active,
      };

      jest
        .spyOn(integrationService, 'create')
        .mockResolvedValue(activeIntegration);
      jest
        .spyOn(integrationService, 'sync')
        .mockResolvedValue({ jobId: 'sync-job-123' });

      const result = await controller.createIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      expect(integrationService.sync).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        activeIntegration.id,
        {
          organizationId: 'org-1' as OrganizationId,
          userId: 'user-1' as UserId,
          projectId: 'project-1' as ProjectId,
        },
      );

      expect(result).toEqual(activeIntegration);
    });

    it('should not trigger sync for inactive integrations', async () => {
      const createDto: CreateIntegrationDto = {
        type: IntegrationType.Github,
        name: 'Test Integration',
        description: 'Test description',
        targetType: 'ORGANIZATION',
        config: { token: 'github-token' },
        state: IntegrationState.Inactive,
      };

      const inactiveIntegration = {
        ...mockIntegration,
        state: IntegrationState.Inactive,
      };

      jest
        .spyOn(integrationService, 'create')
        .mockResolvedValue(inactiveIntegration);
      const syncSpy = jest.spyOn(integrationService, 'sync');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await controller.createIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      expect(syncSpy).not.toHaveBeenCalled();

      // Should still return the integration
      expect(result).toEqual(inactiveIntegration);

      // Should have logged the warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to trigger initial sync'),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should handle sync failure gracefully during creation', async () => {
      const createDto: CreateIntegrationDto = {
        type: IntegrationType.Github,
        name: 'Test Integration',
        description: 'Test description',
        targetType: 'ORGANIZATION',
        config: { token: 'github-token' },
        state: IntegrationState.Active,
      };

      const activeIntegration = {
        ...mockIntegration,
        state: IntegrationState.Active,
      };

      jest
        .spyOn(integrationService, 'create')
        .mockResolvedValue(activeIntegration);
      jest
        .spyOn(integrationService, 'sync')
        .mockRejectedValue(new Error('Sync failed'));

      // Mock console.warn to avoid test output noise
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await controller.createIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      // Should still return the integration
      expect(result).toEqual(activeIntegration);

      // Should have logged the warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to trigger initial sync'),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('authorizeGitHubIntegration', () => {
    it('should build the GitHub OAuth redirect URL', async () => {
      const previousApiBaseUrl = process.env.API_BASE_URL;
      process.env.API_BASE_URL = 'http://api.test';

      jest
        .spyOn(integrationService, 'findOne')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(githubOAuthService, 'buildState')
        .mockReturnValue({ state: 'state-token', nonce: 'nonce' });
      jest
        .spyOn(githubOAuthService, 'buildAuthorizeUrl')
        .mockReturnValue('https://github.com/oauth');

      const result = await controller.authorizeGitHubIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(integrationService.findOne).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );
      expect(githubOAuthService.buildAuthorizeUrl).toHaveBeenCalled();
      expect(result).toEqual({ url: 'https://github.com/oauth' });

      if (previousApiBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = previousApiBaseUrl;
      }
    });
  });

  describe('handleGitHubOAuthCallback', () => {
    it('should exchange the code and store tokens', async () => {
      const previousApiBaseUrl = process.env.API_BASE_URL;
      const previousAppBaseUrl = process.env.APP_BASE_URL;
      process.env.API_BASE_URL = 'http://api.test';
      process.env.APP_BASE_URL = 'http://app.test';

      jest.spyOn(githubOAuthService, 'parseState').mockReturnValue({
        integrationId: 'integration-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        nonce: 'nonce',
        issuedAt: Date.now(),
      });

      jest
        .spyOn(githubOAuthService, 'exchangeCodeForToken')
        .mockResolvedValue({ accessToken: 'token' });

      jest
        .spyOn(integrationService, 'storeGitHubOAuthTokens')
        .mockResolvedValue(mockIntegration);

      const result = await controller.handleGitHubOAuthCallback(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'code-123',
        'state-123',
      );

      expect(githubOAuthService.exchangeCodeForToken).toHaveBeenCalled();
      expect(integrationService.storeGitHubOAuthTokens).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        expect.objectContaining({ accessToken: 'token' }),
      );
      expect(result).toEqual({
        url: 'http://app.test/projects/project-1',
      });

      if (previousApiBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = previousApiBaseUrl;
      }

      if (previousAppBaseUrl === undefined) {
        delete process.env.APP_BASE_URL;
      } else {
        process.env.APP_BASE_URL = previousAppBaseUrl;
      }
    });
  });

  describe('findAllIntegrations', () => {
    it('should return all integrations with default filters', async () => {
      const integrations = [mockIntegration];

      jest.spyOn(integrationService, 'findAll').mockResolvedValue(integrations);

      const result = await controller.findAllIntegrations(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
      );

      expect(integrationService.findAll).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          type: undefined,
          state: undefined,
          connectionStatus: undefined,
          page: undefined,
          limit: undefined,
          sortBy: undefined,
          sortOrder: undefined,
        },
      );

      expect(result).toEqual(integrations);
    });

    it('should return integrations with filters applied', async () => {
      const integrations = [mockIntegration];

      jest.spyOn(integrationService, 'findAll').mockResolvedValue(integrations);

      const result = await controller.findAllIntegrations(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        IntegrationType.Github,
        IntegrationState.Active,
        IntegrationConnectionStatus.Connected,
        1,
        10,
        'name',
        'asc',
      );

      expect(integrationService.findAll).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        {
          type: IntegrationType.Github,
          state: IntegrationState.Active,
          connectionStatus: IntegrationConnectionStatus.Connected,
          page: 1,
          limit: 10,
          sortBy: 'name',
          sortOrder: 'asc',
        },
      );

      expect(result).toEqual(integrations);
    });
  });

  describe('findOneIntegration', () => {
    it('should return a specific integration', async () => {
      jest
        .spyOn(integrationService, 'findOne')
        .mockResolvedValue(mockIntegration);

      const result = await controller.findOneIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(integrationService.findOne).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(result).toEqual(mockIntegration);
    });
  });

  describe('updateIntegration', () => {
    it('should update an integration successfully', async () => {
      const updateDto: UpdateIntegrationDto = {
        name: 'Updated Integration',
        description: 'Updated description',
      };

      const updatedIntegration = {
        ...mockIntegration,
        ...updateDto,
      };

      jest
        .spyOn(integrationService, 'update')
        .mockResolvedValue(updatedIntegration);

      const result = await controller.updateIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        updateDto,
      );

      expect(integrationService.update).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        updateDto,
      );

      expect(result).toEqual(updatedIntegration);
    });

    describe('listGitHubRepositories', () => {
      it('should list repositories with pagination params', async () => {
        const repositories: PaginatedGitHubRepositoryResponse = {
          data: [
            {
              name: 'api',
              fullName: 'octocat/api',
              description: 'API repo',
              url: 'https://github.com/octocat/api',
              defaultBranch: 'main',
              owner: 'octocat',
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
          },
        };

        jest
          .spyOn(githubRepositoryService, 'listRepositories')
          .mockResolvedValue(repositories);

        const result = await controller.listGitHubRepositories(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          '1',
          '20',
          'my-org',
        );

        expect(githubRepositoryService.listRepositories).toHaveBeenCalledWith({
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          integrationId: 'integration-1' as IntegrationId,
          page: 1,
          limit: 20,
          org: 'my-org',
        });
        expect(result).toEqual(repositories);
      });
    });

    describe('updateGitHubPrimaryRepository', () => {
      it('should update primary repository via service', async () => {
        const payload: UpdateGitHubPrimaryRepositoryDto = {
          fullName: 'octocat/api',
        };

        jest
          .spyOn(githubRepositoryService, 'updatePrimaryRepository')
          .mockResolvedValue(mockIntegration);

        const result = await controller.updateGitHubPrimaryRepository(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          payload,
        );

        expect(
          githubRepositoryService.updatePrimaryRepository,
        ).toHaveBeenCalledWith({
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          integrationId: 'integration-1' as IntegrationId,
          payload,
        });
        expect(result).toEqual(mockIntegration);
      });
    });
  });

  describe('removeIntegration', () => {
    it('should delete an integration successfully', async () => {
      const deletedIntegration = {
        ...mockIntegration,
        deletedAt: '2023-12-01T15:00:00Z',
      };

      jest
        .spyOn(integrationService, 'remove')
        .mockResolvedValue(deletedIntegration);

      const result = await controller.removeIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(integrationService.remove).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(result).toEqual(deletedIntegration);
    });
  });

  describe('testIntegrationConnection', () => {
    it('should test connection successfully', async () => {
      const testResult: ConnectionTestResult = {
        connectionStatus: IntegrationConnectionStatus.Connected,
        message: 'Successfully connected to GitHub',
        testedAt: '2023-12-01T12:30:00Z',
        details: { username: 'testuser' },
      };

      jest
        .spyOn(integrationService, 'findOneWithDecryptedConfig')
        .mockResolvedValue(mockDecryptedIntegration);
      jest
        .spyOn(connectionTestService, 'testConnection')
        .mockResolvedValue(testResult);
      jest
        .spyOn(integrationService, 'updateConnectionStatus')
        .mockResolvedValue();

      const result = await controller.testIntegrationConnection(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(
        integrationService.findOneWithDecryptedConfig,
      ).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );
      expect(connectionTestService.testConnection).toHaveBeenCalledWith(
        mockDecryptedIntegration,
      );
      expect(integrationService.updateConnectionStatus).toHaveBeenCalledWith(
        'integration-1' as IntegrationId,
        IntegrationConnectionStatus.Connected,
        'Successfully connected to GitHub',
      );

      expect(result).toEqual({
        connectionStatus: IntegrationConnectionStatus.Connected,
        message: 'Successfully connected to GitHub',
        testedAt: '2023-12-01T12:30:00Z',
        details: { username: 'testuser' },
      });
    });

    it('should handle connection test failure', async () => {
      const testResult: ConnectionTestResult = {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: 'GitHub token is invalid',
        testedAt: '2023-12-01T12:30:00Z',
        details: { error: 'Unauthorized' },
      };

      jest
        .spyOn(integrationService, 'findOneWithDecryptedConfig')
        .mockResolvedValue(mockDecryptedIntegration);
      jest
        .spyOn(connectionTestService, 'testConnection')
        .mockResolvedValue(testResult);
      jest
        .spyOn(integrationService, 'updateConnectionStatus')
        .mockResolvedValue();

      const result = await controller.testIntegrationConnection(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(integrationService.updateConnectionStatus).toHaveBeenCalledWith(
        'integration-1' as IntegrationId,
        IntegrationConnectionStatus.Error,
        'GitHub token is invalid',
      );

      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.Error);
      expect(result.message).toBe('GitHub token is invalid');
    });
  });

  describe('syncIntegration', () => {
    it('should queue sync job successfully', async () => {
      const mockJobResult = { jobId: 'job-123' };

      jest.spyOn(integrationService, 'sync').mockResolvedValue(mockJobResult);

      const result = await controller.syncIntegration(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        'user-1' as UserId,
      );

      expect(integrationService.sync).toHaveBeenCalledWith(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        {
          organizationId: 'org-1' as OrganizationId,
          userId: 'user-1' as UserId,
          projectId: 'project-1' as ProjectId,
        },
      );

      expect(result).toEqual(mockJobResult);
    });

    it('should handle sync job failure', async () => {
      jest
        .spyOn(integrationService, 'sync')
        .mockRejectedValue(new Error('Integration not found'));

      await expect(
        controller.syncIntegration(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          'user-1' as UserId,
        ),
      ).rejects.toThrow('Integration not found');
    });
  });
});
