import { GitHubWebhookService } from '../integrations/github-webhook.service';
import { ConfigEncryptionService } from '../config-encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';
import { IntegrationType } from '../../generated';
import { createServiceTestingModule } from '../../../test/setup/testing-module.factory';

// Mock Octokit
const mockOctokitMethods = {
  repos: {
    createWebhook: jest.fn(),
    updateWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
    listWebhooks: jest.fn(),
    get: jest.fn(),
  },
  orgs: {
    createWebhook: jest.fn(),
    updateWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
    listWebhooks: jest.fn(),
    getMembershipForAuthenticatedUser: jest.fn(),
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: mockOctokitMethods,
  })),
}));

describe('GitHubWebhookService', () => {
  let service: GitHubWebhookService;
  let configEncryptionService: ConfigEncryptionService;
  let prismaService: PrismaService;

  const mockIntegration = {
    id: 'integration-1',
    organizationId: 'org-1' as OrganizationId,
    type: IntegrationType.Github,
    name: 'Test Integration',
    config: {
      token: 'encrypted-token',
      repositoryUrl: 'https://github.com/owner/repo',
    },
  };

  const mockDecryptedConfig = {
    token: 'github-token',
    repositoryUrl: 'https://github.com/owner/repo',
    webhookSecret: 'test-webhook-secret',
  };

  beforeEach(async () => {
    // Set environment variable for webhook URL
    process.env.WEBHOOK_BASE_URL = 'https://test-api.example.com';
    Object.values(mockOctokitMethods.repos).forEach((fn: any) =>
      fn.mockReset(),
    );
    Object.values(mockOctokitMethods.orgs).forEach((fn: any) => fn.mockReset());
    mockOctokitMethods.repos.listWebhooks.mockResolvedValue({ data: [] });
    mockOctokitMethods.orgs.listWebhooks.mockResolvedValue({ data: [] });

    const prismaMock = {
      integrationWebhook: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as any;

    const setup = await createServiceTestingModule({
      providers: [GitHubWebhookService, PrismaService, ConfigEncryptionService],
      overrides: [
        [PrismaService, prismaMock],
        [ConfigEncryptionService, { decryptConfig: jest.fn() }],
      ],
    });

    service = setup.module.get<GitHubWebhookService>(GitHubWebhookService);
    prismaService = setup.module.get<PrismaService>(PrismaService);
    configEncryptionService = setup.module.get<ConfigEncryptionService>(
      ConfigEncryptionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.WEBHOOK_BASE_URL;
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('registerWebhook', () => {
    it('should successfully register a repository webhook', async () => {
      const mockWebhook = {
        id: 12345,
        config: {
          url: 'https://test-api.example.com/webhooks/github/integration-1',
        },
      };

      const mockWebhookRecord = {
        id: 'webhook-record-1',
        integrationId: 'integration-1',
        webhookType: 'github_repository',
        externalWebhookId: '12345',
        webhookUrl:
          'https://test-api.example.com/webhooks/github/integration-1',
        events: [
          'pull_request',
          'issues',
          'issue_comment',
          'pull_request_review_comment',
        ],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);

      mockOctokitMethods.repos.createWebhook.mockResolvedValue({
        data: mockWebhook,
      });
      mockOctokitMethods.repos.listWebhooks.mockResolvedValue({ data: [] });

      (prismaService.integrationWebhook.create as jest.Mock).mockResolvedValue(
        mockWebhookRecord,
      );

      const result = await service.registerWebhook(mockIntegration as any);

      expect(result.success).toBe(true);
      expect(result.webhookId).toBe('webhook-record-1');
      expect(result.externalWebhookId).toBe(12345);
      expect(result.webhookUrl).toBe(
        'https://test-api.example.com/webhooks/github/integration-1',
      );
      expect(mockOctokitMethods.repos.createWebhook).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        name: 'web',
        active: true,
        events: [
          'pull_request',
          'issues',
          'issue_comment',
          'pull_request_review_comment',
        ],
        config: {
          url: 'https://test-api.example.com/webhooks/github/integration-1',
          content_type: 'json',
          secret: 'test-webhook-secret',
          insecure_ssl: '0',
        },
      });
    });

    it('should successfully register an organization webhook', async () => {
      const orgIntegration = {
        ...mockIntegration,
        config: {
          token: 'encrypted-token',
          organizationName: 'test-org',
        },
      };

      const orgDecryptedConfig = {
        token: 'github-token',
        organization: 'test-org',
        webhookSecret: 'test-webhook-secret',
      };

      const mockWebhook = {
        id: 67890,
        config: {
          url: 'https://test-api.example.com/webhooks/github/integration-1',
        },
      };

      const mockWebhookRecord = {
        id: 'webhook-record-2',
        integrationId: 'integration-1',
        webhookType: 'github_organization',
        externalWebhookId: '67890',
        webhookUrl:
          'https://test-api.example.com/webhooks/github/integration-1',
        events: [
          'pull_request',
          'issues',
          'issue_comment',
          'pull_request_review_comment',
        ],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(orgDecryptedConfig);

      mockOctokitMethods.orgs.createWebhook.mockResolvedValue({
        data: mockWebhook,
      });
      mockOctokitMethods.orgs.listWebhooks.mockResolvedValue({ data: [] });

      (prismaService.integrationWebhook.create as jest.Mock).mockResolvedValue(
        mockWebhookRecord,
      );

      const result = await service.registerWebhook(orgIntegration as any);

      expect(result.success).toBe(true);
      expect(result.webhookId).toBe('webhook-record-2');
      expect(result.externalWebhookId).toBe(67890);
      expect(mockOctokitMethods.orgs.createWebhook).toHaveBeenCalledWith({
        org: 'test-org',
        name: 'web',
        active: true,
        events: [
          'pull_request',
          'issues',
          'issue_comment',
          'pull_request_review_comment',
        ],
        config: {
          url: 'https://test-api.example.com/webhooks/github/integration-1',
          content_type: 'json',
          secret: 'test-webhook-secret',
          insecure_ssl: '0',
        },
      });
    });

    it('should handle webhook registration failure gracefully', async () => {
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);

      mockOctokitMethods.repos.listWebhooks.mockResolvedValue({ data: [] });
      mockOctokitMethods.repos.createWebhook.mockRejectedValue(
        new Error('GitHub API error'),
      );

      const result = await service.registerWebhook(mockIntegration as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('GitHub API error');
      expect(result.webhookId).toBe('');
      expect(result.externalWebhookId).toBe('');
    });

    it('does not fall back to a process-wide webhook secret', async () => {
      process.env.GITHUB_WEBHOOK_SECRET = 'global-secret-must-not-be-used';
      jest.spyOn(configEncryptionService, 'decryptConfig').mockResolvedValue({
        token: 'github-token',
        repositoryUrl: 'https://github.com/owner/repo',
      });

      const result = await service.registerWebhook(mockIntegration as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'GitHub webhook secret is required to register webhooks',
      );
      expect(mockOctokitMethods.repos.createWebhook).not.toHaveBeenCalled();
    });

    it('should return error when neither repository nor organization is specified', async () => {
      const invalidIntegration = {
        ...mockIntegration,
        config: {
          token: 'encrypted-token',
        },
      };

      const invalidDecryptedConfig = {
        token: 'github-token',
        webhookSecret: 'test-webhook-secret',
      };
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(invalidDecryptedConfig);
      const result = await service.registerWebhook(invalidIntegration as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Integration must specify either repositoryUrl or organizationName',
      );
    });
  });

  describe('deleteWebhook', () => {
    it('should successfully delete a repository webhook', async () => {
      const mockWebhookRecord = {
        id: 'internal-webhook-id',
        externalWebhookId: '12345',
        webhookType: 'github_repository',
      };
      (
        prismaService.integrationWebhook.findFirst as jest.Mock
      ).mockResolvedValue(mockWebhookRecord);
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);
      mockOctokitMethods.repos.deleteWebhook.mockResolvedValue({});

      await service.deleteWebhook(mockIntegration as any, mockWebhookRecord.id);

      expect(prismaService.integrationWebhook.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockWebhookRecord.id,
          integrationId: mockIntegration.id,
        },
      });
      expect(mockOctokitMethods.repos.deleteWebhook).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        hook_id: 12345,
      });
      expect(prismaService.integrationWebhook.delete).toHaveBeenCalledWith({
        where: { id: mockWebhookRecord.id },
      });
    });

    it('should handle webhook deletion failure from GitHub gracefully', async () => {
      const mockWebhookRecord = {
        id: 'internal-webhook-id',
        externalWebhookId: '12345',
        webhookType: 'github_repository',
      };
      (
        prismaService.integrationWebhook.findFirst as jest.Mock
      ).mockResolvedValue(mockWebhookRecord);
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);
      mockOctokitMethods.repos.deleteWebhook.mockRejectedValue(
        new Error('Webhook not found'),
      );
      await expect(
        service.deleteWebhook(mockIntegration as any, mockWebhookRecord.id),
      ).resolves.toBeUndefined();
      expect(prismaService.integrationWebhook.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupAllWebhooks', () => {
    it('should find all webhooks for an integration and attempt to delete them', async () => {
      const mockWebhookRecords = [{ id: 'webhook-1' }, { id: 'webhook-2' }];
      (
        prismaService.integrationWebhook.findMany as jest.Mock
      ).mockResolvedValue(mockWebhookRecords);
      const deleteWebhookSpy = jest
        .spyOn(service, 'deleteWebhook')
        .mockResolvedValue(undefined);
      await service.cleanupAllWebhooks(mockIntegration as any);
      expect(prismaService.integrationWebhook.findMany).toHaveBeenCalledWith({
        where: { integrationId: mockIntegration.id },
      });
      expect(deleteWebhookSpy).toHaveBeenCalledTimes(2);
      expect(deleteWebhookSpy).toHaveBeenCalledWith(
        mockIntegration as any,
        'webhook-1',
      );
      expect(deleteWebhookSpy).toHaveBeenCalledWith(
        mockIntegration as any,
        'webhook-2',
      );
    });
  });

  describe('listWebhooks', () => {
    it('should successfully list webhooks from the database', async () => {
      const mockWebhookRecords = [
        {
          id: 'webhook-record-1',
          integrationId: 'integration-1',
          webhookType: 'github_repository',
          externalWebhookId: '12345',
          webhookUrl:
            'https://test-api.example.com/webhooks/github/integration-1',
          events: ['pull_request', 'issues'],
          isActive: true,
          lastTriggered: null as Date | null,
          errorCount: 0,
        },
      ];
      (
        prismaService.integrationWebhook.findMany as jest.Mock
      ).mockResolvedValue(mockWebhookRecords);
      const result = await service.listWebhooks(mockIntegration as any);
      expect(prismaService.integrationWebhook.findMany).toHaveBeenCalledWith({
        where: { integrationId: mockIntegration.id, isActive: true },
      });
      expect(result).toHaveLength(1);
      const [webhook] = result;
      if (!webhook) {
        throw new Error('Expected webhook result');
      }
      expect(webhook.id).toBe('webhook-record-1');
      expect(webhook.url).toBe(
        'https://test-api.example.com/webhooks/github/integration-1',
      );
      expect(webhook.webhookType).toBe('github_repository');
    });

    it('should return empty array when database call fails', async () => {
      (
        prismaService.integrationWebhook.findMany as jest.Mock
      ).mockRejectedValue(new Error('DB error'));
      const result = await service.listWebhooks(mockIntegration as any);
      expect(result).toEqual([]);
    });
  });

  describe('validateWebhookAccess', () => {
    it('should validate repository admin access successfully', async () => {
      const mockRepo = { permissions: { admin: true } };
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);
      mockOctokitMethods.repos.get.mockResolvedValue({ data: mockRepo });
      const result = await service.validateWebhookAccess(
        mockIntegration as any,
      );
      expect(result.hasAccess).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockOctokitMethods.repos.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should return false when user lacks admin access', async () => {
      const mockRepo = {
        permissions: { admin: false, push: true, pull: true },
      };
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);
      mockOctokitMethods.repos.get.mockResolvedValue({ data: mockRepo });
      const result = await service.validateWebhookAccess(
        mockIntegration as any,
      );
      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('Admin access required to manage webhooks');
    });

    it('should handle validation errors gracefully', async () => {
      jest
        .spyOn(configEncryptionService, 'decryptConfig')
        .mockResolvedValue(mockDecryptedConfig);
      mockOctokitMethods.repos.get.mockRejectedValue(
        new Error('Repository not found'),
      );
      const result = await service.validateWebhookAccess(
        mockIntegration as any,
      );
      expect(result.hasAccess).toBe(false);
      expect(result.error).toContain('Failed to validate webhook access');
    });
  });

  describe('parseRepositoryUrl', () => {
    it('should parse HTTPS GitHub URLs correctly', () => {
      // Access private method for testing
      const parseUrl = (service as any).parseRepositoryUrl.bind(service);
      const result = parseUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH GitHub URLs correctly', () => {
      const parseUrl = (service as any).parseRepositoryUrl.bind(service);
      const result = parseUrl('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw error for invalid URLs', () => {
      const parseUrl = (service as any).parseRepositoryUrl.bind(service);
      expect(() => parseUrl('invalid-url')).toThrow(
        'Invalid GitHub repository URL',
      );
    });
  });

  describe('buildWebhookUrl', () => {
    it('should build webhook URL from WEBHOOK_BASE_URL', () => {
      process.env.WEBHOOK_BASE_URL = 'https://api.example.com';
      const buildUrl = (service as any).buildWebhookUrl.bind(service);
      const result = buildUrl('integration-1');
      expect(result).toBe(
        'https://api.example.com/webhooks/github/integration-1',
      );
    });

    it('should fallback to API_BASE_URL if WEBHOOK_BASE_URL not set', () => {
      delete process.env.WEBHOOK_BASE_URL;
      process.env.API_BASE_URL = 'https://fallback.example.com';
      const buildUrl = (service as any).buildWebhookUrl.bind(service);
      const result = buildUrl('integration-1');
      expect(result).toBe(
        'https://fallback.example.com/webhooks/github/integration-1',
      );
    });

    it('should throw error when no base URL is configured', () => {
      delete process.env.WEBHOOK_BASE_URL;
      delete process.env.API_BASE_URL;
      const buildUrl = (service as any).buildWebhookUrl.bind(service);
      expect(() => buildUrl('integration-1')).toThrow(
        'WEBHOOK_BASE_URL or API_BASE_URL environment variable is required',
      );
    });
  });
});
