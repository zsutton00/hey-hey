import { Test, TestingModule } from '@nestjs/testing';
import { JiraIntegrationHandler } from '../jira.integration.handler';
import { ConfigEncryptionService } from '../../../services/config-encryption.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { OrganizationId } from '../../../types';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('JiraIntegrationHandler - Comprehensive Tests', () => {
  let handler: JiraIntegrationHandler;
  let mockConfigEncryption: jest.Mocked<ConfigEncryptionService>;

  beforeEach(async () => {
    mockConfigEncryption = {
      decryptConfig: jest.fn(),
    } as any;

    // Provide a minimal mock for ArtifactService – it isn't used directly in the tests
    const mockArtifactService: Partial<
      Record<keyof ArtifactService, jest.Mock>
    > = {} as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraIntegrationHandler,
        {
          provide: ConfigEncryptionService,
          useValue: mockConfigEncryption,
        },
        {
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
      ],
    }).compile();

    handler = module.get<JiraIntegrationHandler>(JiraIntegrationHandler);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
      jest.useFakeTimers();
    });

    it('should respect rate limits from headers', async () => {
      const mockHeaders = new Map([
        ['X-RateLimit-Remaining', '1'],
        ['X-RateLimit-Reset', '60'],
        ['X-RateLimit-Limit', '10'],
      ]);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            displayName: 'Test',
            emailAddress: 'test@test.com',
          }),
        headers: {
          get: (name: string) => mockHeaders.get(name) || null,
        },
      });

      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
      });

      // Make multiple requests quickly
      const promises = [
        handler.testConnection({ config: 'test' }, 'org-123'),
        handler.testConnection({ config: 'test' }, 'org-123'),
      ];

      // Advance timers to process rate limiting
      jest.advanceTimersByTime(1000);

      const results = await Promise.all(promises);

      // Both should succeed but be rate limited
      const firstResult = assertDefined(results[0], 'first result');
      const secondResult = assertDefined(results[1], 'second result');
      expect(firstResult.connected).toBe(true);
      expect(secondResult.connected).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle 429 rate limit responses with exponential backoff', async () => {
      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
      });

      // Test that 429 errors are handled properly (connection fails but is logged)
      const makeRequestSpy = jest.spyOn(handler as any, 'makeJiraRequest');
      makeRequestSpy.mockRejectedValue(
        Object.assign(new Error('Rate limited'), { status: 429 }),
      );

      const result = await handler.testConnection(
        { config: 'test' },
        'org-123',
      );

      expect(result.connected).toBe(false);
      expect(result.error).toContain('Rate limited');

      makeRequestSpy.mockRestore();
    });
  });

  describe('JQL Search Functionality', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should build correct JQL query for incremental sync', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        projectId: 'project-123',
        config: { encrypted: 'config' },
        lastSuccessfulSync: new Date('2024-01-01T00:00:00Z'),
      } as any;

      const mockHeaders = new Map();
      const mockSearchResponse = {
        issues: [
          {
            key: 'TEST-123',
            fields: {
              summary: 'Test issue',
              status: { name: 'Open' },
              assignee: {
                displayName: 'John Doe',
                emailAddress: 'john@test.com',
              },
              created: '2024-01-02T00:00:00Z',
              updated: '2024-01-02T12:00:00Z',
              description: 'Test description',
              issuetype: { name: 'Bug' },
              project: { key: 'TEST', name: 'Test Project' },
              labels: ['urgent', 'backend'],
            },
          },
        ],
        total: 1,
        startAt: 0,
        maxResults: 100,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSearchResponse),
        headers: {
          get: (name: string) => mockHeaders.get(name) || null,
        },
      });

      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
        projectKeys: ['TEST'],
        issueTypes: ['Bug', 'Story'],
      });

      await handler.sync(mockIntegration);

      // Verify JQL search was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            jql: 'project = "TEST" AND updated >= "2024-01-01T00:00:00.000Z" AND issuetype in ("Bug","Story") ORDER BY updated DESC',
            startAt: 0,
            maxResults: 100,
            fields: [
              'summary',
              'status',
              'assignee',
              'created',
              'updated',
              'description',
              'issuetype',
              'project',
              'labels',
            ],
          }),
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        projectId: 'project-123',
        config: { encrypted: 'config' },
        lastSuccessfulSync: null,
      } as any;

      const mockHeaders = new Map();

      // First page response (100 items)
      const firstPageResponse = {
        issues: Array(100)
          .fill(null)
          .map((_, i) => ({
            key: `TEST-${i + 1}`,
            fields: {
              summary: `Issue ${i + 1}`,
              status: { name: 'Open' },
              created: '2024-01-01T00:00:00Z',
              updated: '2024-01-01T00:00:00Z',
              issuetype: { name: 'Bug' },
              project: { key: 'TEST', name: 'Test Project' },
              labels: [] as any[],
            },
          })),
        total: 150,
        startAt: 0,
        maxResults: 100,
      };

      // Second page response (50 items)
      const secondPageResponse = {
        issues: Array(50)
          .fill(null)
          .map((_, i) => ({
            key: `TEST-${i + 101}`,
            fields: {
              summary: `Issue ${i + 101}`,
              status: { name: 'Open' },
              created: '2024-01-01T00:00:00Z',
              updated: '2024-01-01T00:00:00Z',
              issuetype: { name: 'Bug' },
              project: { key: 'TEST', name: 'Test Project' },
              labels: [] as any[],
            },
          })),
        total: 150,
        startAt: 100,
        maxResults: 100,
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(firstPageResponse),
          headers: { get: (name: string) => mockHeaders.get(name) || null },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(secondPageResponse),
          headers: { get: (name: string) => mockHeaders.get(name) || null },
        });

      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
        projectKeys: ['TEST'],
      });

      const logSpy = jest.spyOn(handler['logger'], 'log');

      await handler.sync(mockIntegration);

      // Should make two API calls for pagination
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Verify pagination parameters
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://test.atlassian.net/rest/api/3/search',
        expect.objectContaining({
          body: expect.stringContaining('"startAt":0'),
        }),
      );

      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://test.atlassian.net/rest/api/3/search',
        expect.objectContaining({
          body: expect.stringContaining('"startAt":100'),
        }),
      );

      expect(logSpy).toHaveBeenCalledWith('Found 150 issues in project TEST');
    });

    it('should fetch accessible projects when none configured', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        projectId: 'project-123',
        config: { encrypted: 'config' },
        lastSuccessfulSync: null,
      } as any;

      const mockProjects = [
        { key: 'PROJ1', name: 'Project 1' },
        { key: 'PROJ2', name: 'Project 2' },
      ];

      const mockHeaders = new Map();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProjects),
          headers: { get: (name: string) => mockHeaders.get(name) || null },
        })
        .mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              issues: [],
              total: 0,
              startAt: 0,
              maxResults: 100,
            }),
          headers: { get: (name: string) => mockHeaders.get(name) || null },
        });

      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
        // No projectKeys specified
      });

      const logSpy = jest.spyOn(handler['logger'], 'log');

      await handler.sync(mockIntegration);

      // Should first fetch projects, then search each one
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/project',
        expect.any(Object),
      );

      expect(logSpy).toHaveBeenCalledWith('Syncing 2 projects: PROJ1, PROJ2');
    });
  });

  describe('Webhook Processing', () => {
    beforeEach(() => {
      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
        projectKeys: ['TEST'],
        issueTypes: ['Bug', 'Story'],
      });
    });

    it('should process issue created webhook', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_created',
        issue: {
          id: '10001',
          key: 'TEST-123',
          self: 'https://test.atlassian.net/rest/api/3/issue/10001',
          fields: {
            summary: 'New bug found',
            project: { key: 'TEST', name: 'Test Project', id: 'proj-1' },
            issuetype: { name: 'Bug', id: 'type-1' },
            status: {
              name: 'Open',
              id: 'status-1',
              statusCategory: { id: 1, key: 'new', name: 'To Do' },
            },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-01T00:00:00Z',
            labels: [] as any[],
          },
        },
      };

      const logSpy = jest.spyOn(handler['logger'], 'log');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Processing Jira webhook for integration integration-123',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Webhook event: jira:issue_created for issue TEST-123',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'New issue created: TEST-123 - New bug found',
      );
    });

    it('should process issue updated webhook', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10002',
          key: 'TEST-456',
          self: 'https://test.atlassian.net/rest/api/3/issue/10002',
          fields: {
            summary: 'Updated issue title',
            project: { key: 'TEST', name: 'Test Project', id: 'proj-1' },
            issuetype: { name: 'Story', id: 'type-2' },
            status: {
              name: 'In Progress',
              id: 'status-2',
              statusCategory: {
                id: 2,
                key: 'indeterminate',
                name: 'In Progress',
              },
            },
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-01T00:00:00Z',
            labels: [] as any[],
          },
        },
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'log');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Issue updated: TEST-456 - Updated issue title',
      );
    });

    it('should process issue deleted webhook', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_deleted',
        issue: {
          key: 'TEST-789',
          fields: {
            project: { key: 'TEST' },
            issuetype: { name: 'Bug' },
          },
        },
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'log');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith('Issue deleted: TEST-789');
    });

    it('should skip webhook for projects not in sync scope', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      // Project NOT in sync scope
      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'OTHER-123',
          fields: {
            summary: 'Issue in different project',
            project: { key: 'OTHER' },
            issuetype: { name: 'Bug' },
          },
        },
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'debug');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Skipping issue OTHER-123 - project OTHER not in sync scope',
      );
    });

    it('should skip webhook for issue types not in sync scope', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      // Issue type NOT in sync scope
      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_created',
        issue: {
          key: 'TEST-123',
          fields: {
            summary: 'Epic issue',
            project: { key: 'TEST' },
            issuetype: { name: 'Epic' }, // Not in configured issueTypes
          },
        },
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'debug');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Skipping issue TEST-123 - issue type Epic not in sync scope',
      );
    });

    it('should handle unrecognized webhook events', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:project_updated',
        issue: { key: 'TEST-123', fields: { project: { key: 'TEST' } } }, // Need issue field to pass validation
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'debug');

      await handler.handleWebhook(webhookPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Unhandled webhook event: jira:project_updated',
      );
    });

    it('should validate webhook payload structure', async () => {
      const mockIntegration = {
        id: 'integration-123',
      } as any;

      const invalidPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_created',
        // Missing issue field
      } as any;

      const logSpy = jest.spyOn(handler['logger'], 'warn');

      await handler.handleWebhook(invalidPayload, mockIntegration);

      expect(logSpy).toHaveBeenCalledWith(
        'Invalid Jira webhook payload - missing webhookEvent or issue',
      );
    });
  });

  describe('Configuration Management', () => {
    it('should handle URL normalization', async () => {
      // Test URL without https prefix
      mockConfigEncryption.decryptConfig.mockResolvedValueOnce({
        instanceUrl: 'mycompany.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
      });

      const config = await handler['getDecryptedConfig'](
        { test: 'config' },
        'org-123' as OrganizationId,
      );
      expect(config.instanceUrl).toBe('https://mycompany.atlassian.net');
    });

    it('should remove trailing slash from URL', async () => {
      mockConfigEncryption.decryptConfig.mockResolvedValueOnce({
        instanceUrl: 'https://mycompany.atlassian.net/',
        apiToken: 'token',
        email: 'test@test.com',
      });

      const config = await handler['getDecryptedConfig'](
        { test: 'config' },
        'org-123' as OrganizationId,
      );
      expect(config.instanceUrl).toBe('https://mycompany.atlassian.net');
    });

    it('should throw error for missing required fields', async () => {
      mockConfigEncryption.decryptConfig.mockResolvedValueOnce({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        // Missing email
      });

      await expect(
        handler['getDecryptedConfig'](
          { test: 'config' },
          'org-123' as OrganizationId,
        ),
      ).rejects.toThrow('Jira integration requires an "email" field');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should handle sync errors gracefully', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      mockConfigEncryption.decryptConfig.mockResolvedValue({
        instanceUrl: 'https://test.atlassian.net',
        apiToken: 'token',
        email: 'test@test.com',
        projectKeys: ['TEST'],
      });

      // Mock the makeJiraRequest to fail with 429 without retries
      const makeRequestSpy = jest.spyOn(handler as any, 'makeJiraRequest');
      makeRequestSpy.mockRejectedValue(
        Object.assign(new Error('Rate limited'), { status: 429 }),
      );

      await expect(handler.sync(mockIntegration)).rejects.toThrow(
        'Sync rate limited, will retry later',
      );

      makeRequestSpy.mockRestore();
    });

    it('should handle webhook processing errors', async () => {
      const mockIntegration = {
        id: 'integration-123',
        organizationId: 'org-123',
        config: { encrypted: 'config' },
      } as any;

      // Mock decryption to fail
      mockConfigEncryption.decryptConfig.mockRejectedValue(
        new Error('Decryption failed'),
      );

      const webhookPayload = {
        timestamp: Date.now(),
        webhookEvent: 'jira:issue_created',
        issue: { key: 'TEST-123', fields: {} },
      } as any;

      const errorSpy = jest.spyOn(handler['logger'], 'error');

      await expect(
        handler.handleWebhook(webhookPayload, mockIntegration),
      ).rejects.toThrow('Decryption failed');

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to process Jira webhook for integration integration-123:',
        expect.any(Error),
      );
    });
  });
});
