import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { IntegrationService } from '../integrations/integration.service';
import { ConfigEncryptionService } from '../config-encryption.service';
import { GitHubWebhookService } from '../integrations/github-webhook.service';
import { GitHubOAuthService } from '../integrations/github-oauth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobEnqueueingService } from '../job-enqueuing.service';
import {
  IntegrationType,
  IntegrationState,
  IntegrationConnectionStatus,
  ProjectStatus,
} from '../../generated';
import { IntegrationTargetType } from '@prisma/client';
import {
  OrganizationId,
  ProjectId,
  IntegrationId,
  UserId,
  RequestId,
  ConversationId,
  MessageId,
  WorkflowId,
} from '../../types';

describe('IntegrationService', () => {
  let service: IntegrationService;
  let prismaService: PrismaService;
  let configEncryptionService: ConfigEncryptionService;
  let jobEnqueringService: JobEnqueueingService;
  let githubOAuthService: GitHubOAuthService;

  const mockProject = {
    maturity: 'ESTABLISHED' as const,
    id: 'project-1' as ProjectId,
    organizationId: 'org-1' as OrganizationId,
    name: 'Test Project',
    description: 'Test project description',
    status: ProjectStatus.Active,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    deletedAt: null as Date | null,
    config: null,
  };

  const mockIntegration = {
    id: 'integration-1' as IntegrationId,
    projectId: 'project-1' as ProjectId,
    organizationId: 'org-1' as OrganizationId,
    type: IntegrationType.Github,
    name: 'GitHub Integration',
    description: 'Test GitHub integration',
    config: { token: 'encrypted-token' },
    state: IntegrationState.Active,
    targetType: IntegrationTargetType.ORGANIZATION,
    connectionStatus: IntegrationConnectionStatus.Pending,
    lastConnectionCheck: null as Date | null,
    lastSuccessfulSync: null as Date | null,
    errorMessage: null as string | null,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null as Date | null,
    project: mockProject,
    organization: { id: 'org-1' as OrganizationId, name: 'Test Org' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findFirst: jest.fn(),
            },
            integration: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: ConfigEncryptionService,
          useValue: {
            encryptConfig: jest.fn(),
            decryptConfig: jest.fn(),
            maskConfigForResponse: jest.fn(),
          },
        },
        {
          provide: JobEnqueueingService,
          useValue: {
            queueIntegrationSync: jest.fn(),
            queueIntegrationConnectionTest: jest.fn(),
          },
        },
        {
          provide: GitHubWebhookService,
          useValue: {
            registerWebhook: jest.fn(),
            cleanupAllWebhooks: jest.fn(),
            updateWebhook: jest.fn(),
            listWebhooks: jest.fn().mockResolvedValue([]),
            validateWebhookAccess: jest.fn(),
          },
        },
        {
          provide: GitHubOAuthService,
          useValue: {
            refreshAccessToken: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IntegrationService>(IntegrationService);
    prismaService = module.get<PrismaService>(PrismaService);
    configEncryptionService = module.get<ConfigEncryptionService>(
      ConfigEncryptionService,
    );
    jobEnqueringService =
      module.get<JobEnqueueingService>(JobEnqueueingService);
    githubOAuthService = module.get<GitHubOAuthService>(GitHubOAuthService);
  });

  describe('create', () => {
    it('should create an integration successfully', async () => {
      const createDto = {
        type: IntegrationType.Github,
        name: 'Test Integration',
        description: 'Test description',
        config: { token: 'test-token' },
        state: IntegrationState.Active,
        targetType: IntegrationTargetType.ORGANIZATION,
      };

      const encryptedConfig = {
        token: { _encrypted: true, data: 'encrypted' },
      };

      jest
        .spyOn(prismaService.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);
      jest
        .spyOn(configEncryptionService, 'encryptConfig')
        .mockResolvedValue(encryptedConfig);
      jest
        .spyOn(prismaService.integration, 'create')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.create(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        createDto,
        'user-1' as UserId,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('integration-1');
      expect(configEncryptionService.encryptConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ...createDto.config,
          webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        createDto.type,
        'org-1',
      );
      expect(prismaService.integration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          config: encryptedConfig,
          type: createDto.type,
          name: createDto.name,
        }),
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if project not found', async () => {
      const createDto = {
        type: IntegrationType.Github,
        name: 'Test Integration',
        config: { token: 'test-token' },
        targetType: IntegrationTargetType.ORGANIZATION,
      };

      jest.spyOn(prismaService.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.create(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          createDto,
          'user-1' as UserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if integration name already exists', async () => {
      const createDto = {
        type: IntegrationType.Github,
        name: 'Existing Integration',
        config: { token: 'test-token' },
        targetType: IntegrationTargetType.ORGANIZATION,
      };

      jest
        .spyOn(prismaService.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);

      await expect(
        service.create(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          createDto,
          'user-1' as UserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('storeGitHubOAuthTokens', () => {
    it('stores encrypted OAuth tokens and activates the integration', async () => {
      const decryptedConfig = {
        repositoryUrl: 'https://github.com/test/repo',
        token: 'old-token',
      };
      const encryptedConfig = { token: { _encrypted: true, data: 'enc' } };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(decryptedConfig);
      jest
        .spyOn(configEncryptionService, 'encryptConfig')
        .mockResolvedValue(encryptedConfig);
      jest.spyOn(prismaService.integration, 'update').mockResolvedValue({
        ...mockIntegration,
        config: encryptedConfig,
        state: IntegrationState.Active,
        connectionStatus: IntegrationConnectionStatus.Connected,
      });
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.storeGitHubOAuthTokens(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        {
          accessToken: 'new-token',
          refreshToken: 'refresh-token',
          expiresIn: 3600,
          scope: 'repo',
          tokenType: 'bearer',
        },
      );

      expect(configEncryptionService.encryptConfig).toHaveBeenCalled();
      expect(prismaService.integration.update).toHaveBeenCalledWith({
        where: { id: 'integration-1' },
        data: expect.objectContaining({
          state: IntegrationState.Active,
          connectionStatus: IntegrationConnectionStatus.Connected,
        }),
        include: expect.any(Object),
      });
      expect(result.id).toBe('integration-1');
    });

    it('throws when integration is not GitHub', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue({ ...mockIntegration, type: IntegrationType.Jira });

      await expect(
        service.storeGitHubOAuthTokens(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          { accessToken: 'new-token' },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshGitHubAccessTokenIfNeeded', () => {
    it('refreshes access token when expired', async () => {
      const expiredConfig = {
        token: 'old-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      const refreshedConfig = {
        ...expiredConfig,
        token: 'new-token',
      };

      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(expiredConfig);
      jest.spyOn(githubOAuthService, 'refreshAccessToken').mockResolvedValue({
        accessToken: 'new-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      });
      jest
        .spyOn(configEncryptionService, 'encryptConfig')
        .mockResolvedValue({ token: { _encrypted: true, data: 'enc' } });
      jest.spyOn(prismaService.integration, 'update').mockResolvedValue({
        ...mockIntegration,
        config: refreshedConfig,
      });

      const result =
        await service.refreshGitHubAccessTokenIfNeeded(mockIntegration);

      expect(githubOAuthService.refreshAccessToken).toHaveBeenCalledWith(
        'refresh-token',
      );
      expect(result.config).toEqual(refreshedConfig);
    });

    it('returns integration when token is not expired', async () => {
      const validConfig = {
        token: 'old-token',
        refreshToken: 'refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };

      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(validConfig);

      const result =
        await service.refreshGitHubAccessTokenIfNeeded(mockIntegration);

      expect(result).toBe(mockIntegration);
    });
  });

  describe('findAll', () => {
    it('should return all integrations for a project', async () => {
      jest
        .spyOn(prismaService.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.integration, 'findMany')
        .mockResolvedValue([mockIntegration]);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.findAll(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
      );

      expect(result).toHaveLength(1);
      const [integration] = result;
      if (!integration) {
        throw new Error('Expected integration result');
      }
      expect(integration.id).toBe('integration-1');
      expect(integration.config).toEqual({ token: '***MASKED***' });
    });

    it('should apply filters correctly', async () => {
      const filters = {
        type: IntegrationType.Github,
        state: IntegrationState.Active,
        targetType: IntegrationTargetType.ORGANIZATION,
        page: 1,
        limit: 10,
      };

      jest
        .spyOn(prismaService.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest.spyOn(prismaService.integration, 'findMany').mockResolvedValue([]);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({});

      await service.findAll(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        filters,
      );

      expect(prismaService.integration.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          type: IntegrationType.Github,
          state: IntegrationState.Active,
          targetType: IntegrationTargetType.ORGANIZATION,
        }),
        orderBy: expect.any(Object),
        skip: 0,
        take: 10,
        include: expect.any(Object),
      });
    });
  });

  describe('findOne', () => {
    it('should return an integration by id', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.findOne(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(result).toBeDefined();
      expect(result.id).toBe('integration-1');
      expect(result.config).toEqual({ token: '***MASKED***' });
    });

    it('should throw NotFoundException if integration not found', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.findOne(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'non-existent' as IntegrationId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneWithDecryptedConfig', () => {
    it('should return integration with decrypted config', async () => {
      const decryptedConfig = { token: 'decrypted-token' };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(decryptedConfig);

      const result = await service.findOneWithDecryptedConfig(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(result.config).toEqual(decryptedConfig);
      expect(configEncryptionService.decryptConfig).toHaveBeenCalledWith(
        mockIntegration.config,
        mockIntegration.type,
        'org-1',
      );
    });
  });

  describe('findActiveGitHubIntegrationWithDecryptedConfig', () => {
    it('binds route identity to an active GitHub integration and live project', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest.spyOn(configEncryptionService, 'decryptConfig').mockResolvedValue({
        token: 'token',
        webhookSecret: 'secret',
        repositoryUrl: 'https://github.com/hey-hey/api',
      });
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result =
        await service.findActiveGitHubIntegrationWithDecryptedConfig(
          'integration-1' as IntegrationId,
        );

      expect(prismaService.integration.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'integration-1',
          type: IntegrationType.Github,
          state: IntegrationState.Active,
          deletedAt: null,
          project: { deletedAt: null },
          organization: { isActive: true },
        },
        include: { project: true, organization: true },
      });
      expect(result.config).toEqual({
        token: 'token',
        webhookSecret: 'secret',
        repositoryUrl: 'https://github.com/hey-hey/api',
      });
    });

    it('rejects an inactive or absent integration identity', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.findActiveGitHubIntegrationWithDecryptedConfig(
          'integration-1' as IntegrationId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update an integration successfully', async () => {
      const updateDto = {
        name: 'Updated Integration',
        config: { token: 'new-token' },
      };

      const encryptedConfig = {
        token: { _encrypted: true, data: 'encrypted-new' },
      };
      const updatedIntegration = {
        ...mockIntegration,
        ...updateDto,
        config: encryptedConfig,
      };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValueOnce(mockIntegration)
        .mockResolvedValueOnce(null); // No name conflict
      jest
        .spyOn(configEncryptionService, 'encryptConfig')
        .mockResolvedValue(encryptedConfig);
      jest
        .spyOn(prismaService.integration, 'update')
        .mockResolvedValue(updatedIntegration);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.update(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        updateDto,
      );

      expect(result).toBeDefined();
      expect(configEncryptionService.encryptConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ...updateDto.config,
          webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        mockIntegration.type,
        'org-1',
      );
    });

    it('should throw NotFoundException if integration not found', async () => {
      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.update(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'non-existent' as IntegrationId,
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete an integration', async () => {
      const deletedIntegration = { ...mockIntegration, deletedAt: new Date() };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(prismaService.integration, 'update')
        .mockResolvedValue(deletedIntegration);
      jest
        .spyOn(configEncryptionService, 'maskConfigForResponse')
        .mockReturnValue({ token: '***MASKED***' });

      const result = await service.remove(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
      );

      expect(result).toBeDefined();
      expect(prismaService.integration.update).toHaveBeenCalledWith({
        where: { id: 'integration-1' },
        data: { deletedAt: expect.any(Date) },
        include: expect.any(Object),
      });
    });
  });

  describe('updateConnectionStatus', () => {
    it('should update connection status', async () => {
      jest
        .spyOn(prismaService.integration, 'update')
        .mockResolvedValue(mockIntegration);

      await service.updateConnectionStatus(
        'integration-1' as IntegrationId,
        IntegrationConnectionStatus.Connected,
      );

      expect(prismaService.integration.update).toHaveBeenCalledWith({
        where: { id: 'integration-1' },
        data: expect.objectContaining({
          connectionStatus: IntegrationConnectionStatus.Connected,
          lastConnectionCheck: expect.any(Date),
          lastSuccessfulSync: expect.any(Date),
          errorMessage: null as string | null,
        }),
      });
    });

    it('should handle error status with message', async () => {
      jest
        .spyOn(prismaService.integration, 'update')
        .mockResolvedValue(mockIntegration);

      await service.updateConnectionStatus(
        'integration-1' as IntegrationId,
        IntegrationConnectionStatus.Error,
        'Connection failed',
      );

      expect(prismaService.integration.update).toHaveBeenCalledWith({
        where: { id: 'integration-1' },
        data: expect.objectContaining({
          connectionStatus: IntegrationConnectionStatus.Error,
          errorMessage: 'Connection failed',
        }),
      });
    });
  });

  describe('sync', () => {
    it('should queue sync job for active integration', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      const mockJob = { id: 'job-123' };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(jobEnqueringService, 'queueIntegrationSync')
        .mockResolvedValue(mockJob as any);

      const result = await service.sync(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        mockExecutionContext,
      );

      expect(result).toEqual({ jobId: 'job-123' });
      expect(jobEnqueringService.queueIntegrationSync).toHaveBeenCalledWith(
        {
          integrationId: 'integration-1',
          integrationType: IntegrationType.Github,
        },
        mockExecutionContext,
      );
    });

    it('should throw NotFoundException if integration not found', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.sync(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'non-existent' as IntegrationId,
          mockExecutionContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if integration is not active', async () => {
      const inactiveIntegration = {
        ...mockIntegration,
        state: IntegrationState.Inactive,
      };

      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(inactiveIntegration);

      await expect(
        service.sync(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          mockExecutionContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('testConnection', () => {
    it('should queue connection test job', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      const mockJob = { id: 'job-456' };
      const testConfig = { token: 'test-token' };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(jobEnqueringService, 'queueIntegrationConnectionTest')
        .mockResolvedValue(mockJob as any);

      const result = await service.testConnection(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        mockExecutionContext,
        testConfig,
      );

      expect(result).toEqual({ jobId: 'job-456' });
      expect(
        jobEnqueringService.queueIntegrationConnectionTest,
      ).toHaveBeenCalledWith(
        {
          integrationId: 'integration-1',
          config: testConfig,
        },
        mockExecutionContext,
      );
    });

    it('should use existing config if none provided', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      const mockJob = { id: 'job-789' };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(mockIntegration);
      jest
        .spyOn(jobEnqueringService, 'queueIntegrationConnectionTest')
        .mockResolvedValue(mockJob as any);

      const result = await service.testConnection(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'integration-1' as IntegrationId,
        mockExecutionContext,
      );

      expect(result).toEqual({ jobId: 'job-789' });
      expect(
        jobEnqueringService.queueIntegrationConnectionTest,
      ).toHaveBeenCalledWith(
        {
          integrationId: 'integration-1',
          config: mockIntegration.config,
        },
        mockExecutionContext,
      );
    });

    it('should throw NotFoundException if integration not found', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.testConnection(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'non-existent' as IntegrationId,
          mockExecutionContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid config', async () => {
      const mockExecutionContext = {
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        conversationId: 'conv-1' as ConversationId,
        messageId: 'msg-1' as MessageId,
        requestId: 'req-1' as RequestId,
        workflowId: 'wf-1' as WorkflowId,
        userId: 'user-1' as UserId,
      };

      const integrationWithNullConfig = {
        ...mockIntegration,
        config: null as any,
      };

      jest
        .spyOn(prismaService.integration, 'findFirst')
        .mockResolvedValue(integrationWithNullConfig);

      await expect(
        service.testConnection(
          'org-1' as OrganizationId,
          'project-1' as ProjectId,
          'integration-1' as IntegrationId,
          mockExecutionContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
