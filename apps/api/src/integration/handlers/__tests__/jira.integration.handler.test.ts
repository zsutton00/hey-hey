import { Test, TestingModule } from '@nestjs/testing';
import { JiraIntegrationHandler } from '../jira.integration.handler';
import { ConfigEncryptionService } from '../../../services/config-encryption.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { Integration } from '@prisma/client';
import { OrganizationId } from '../../../types';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

// Mock fetch globally
global.fetch = jest.fn();

describe('JiraIntegrationHandler - getSuggestedUsers', () => {
  let handler: JiraIntegrationHandler;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  const mockOrganizationId = 'org-123' as OrganizationId;
  const mockIntegration: Integration = {
    id: 'int-123',
    organizationId: mockOrganizationId,
    projectId: 'proj-123',
    type: 'jira',
    name: 'Jira Integration',
    description: null,
    config: {
      instanceUrl: 'https://company.atlassian.net',
      email: 'test@company.com',
      apiToken: 'encrypted-token',
      projectKeys: ['PROJ'],
    },
    state: 'ACTIVE',
    targetType: 'ORGANIZATION',
    connectionStatus: 'CONNECTED',
    lastConnectionCheck: new Date(),
    lastSuccessfulSync: new Date(),
    errorMessage: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockDecryptedConfig = {
    instanceUrl: 'https://company.atlassian.net',
    email: 'test@company.com',
    apiToken: 'jira-token-123',
    projectKeys: ['PROJ'],
  };

  beforeEach(async () => {
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraIntegrationHandler,
        {
          provide: ConfigEncryptionService,
          useValue: {
            decryptConfig: jest.fn(),
          },
        },
        {
          provide: ArtifactService,
          useValue: {
            createMany: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<JiraIntegrationHandler>(JiraIntegrationHandler);

    // Mock the getDecryptedConfig method
    jest
      .spyOn(handler as any, 'getDecryptedConfig')
      .mockResolvedValue(mockDecryptedConfig);

    // Mock the rateLimiter methods
    const mockRateLimiter = {
      acquireToken: jest.fn().mockResolvedValue(undefined),
      updateFromHeaders: jest.fn(),
    };

    // Replace the rateLimiter instance
    (handler as any).rateLimiter = mockRateLimiter;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSuggestedUsers', () => {
    it('should successfully get suggested users from assignable users', async () => {
      // Arrange
      const mockAssignableUsersResponse = [
        {
          accountId: 'user-1',
          displayName: 'John Doe',
          emailAddress: 'john@company.com',
        },
      ];

      const mockRecentActivityResponse = {
        issues: [] as any[],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockAssignableUsersResponse),
        } as Response) // Assignable users
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRecentActivityResponse),
        } as Response); // Recent activity

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'John Doe',
        email: 'john@company.com',
        sources: ['jira'],
        confidence: 0.8,
        integrationMetadata: {
          jiraAccountId: 'user-1',
          source: 'assignable_user',
          projectKey: 'PROJ',
        },
      });
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert
      expect(result).toHaveLength(0); // Should return empty array, not throw
    });

    it('should handle missing email addresses by filtering them out', async () => {
      // Arrange
      const mockAssignableUsersResponse = [
        {
          accountId: 'user-with-email',
          displayName: 'User With Email',
          emailAddress: 'user@company.com',
        },
        {
          accountId: 'user-without-email',
          displayName: 'User Without Email',
          // No emailAddress
        },
      ];

      const mockRecentActivityResponse = {
        issues: [] as any[],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockAssignableUsersResponse),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRecentActivityResponse),
        } as Response);

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert
      expect(result).toHaveLength(1);
      const firstUser = assertDefined(result[0], 'first suggested user');
      expect(firstUser.email).toBe('user@company.com');
    });
  });
});
