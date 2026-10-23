import { Test, TestingModule } from '@nestjs/testing';
import { UserSuggestionService } from '../user-suggestion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubIntegrationHandler } from '../../integration/handlers/github.integration.handler';
import { JiraIntegrationHandler } from '../../integration/handlers/jira.integration.handler';
import { OrganizationId, ProjectId } from '../../types';
import { Integration } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('UserSuggestionService', () => {
  let service: UserSuggestionService;
  let prismaService: PrismaService;
  let githubHandler: GitHubIntegrationHandler;
  let jiraHandler: JiraIntegrationHandler;

  const mockOrganizationId = 'org-123' as OrganizationId;
  const mockProjectId = 'proj-123' as ProjectId;

  const mockGitHubIntegration: Integration = {
    id: 'int-github-123',
    organizationId: mockOrganizationId,
    projectId: mockProjectId,
    type: 'github',
    name: 'GitHub Integration',
    description: null,
    config: {},
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

  const mockJiraIntegration: Integration = {
    id: 'int-jira-123',
    organizationId: mockOrganizationId,
    projectId: mockProjectId,
    type: 'jira',
    name: 'Jira Integration',
    description: null,
    config: {},
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

  const mockSuggestedUsers = [
    {
      name: 'John Doe',
      email: 'john@example.com',
      sources: ['github'],
      confidence: 0.8,
      lastSeen: new Date(),
      integrationMetadata: { githubLogin: 'johndoe' },
    },
    {
      name: 'Jane Smith',
      email: 'jane@example.com',
      sources: ['jira'],
      confidence: 0.7,
      lastSeen: new Date(),
      integrationMetadata: { jiraAccountId: 'jane-account' },
    },
  ];

  const mockStoredSuggestions = [
    {
      id: 'suggestion-1',
      organizationId: mockOrganizationId,
      projectId: mockProjectId,
      name: 'John Doe',
      email: 'john@example.com',
      sources: ['github'],
      confidence: new Decimal(0.8),
      lastSeen: new Date(),
      firstSeen: new Date(),
      integrationMetadata: { githubLogin: 'johndoe' },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrismaDb = {
    integration: {
      findMany: jest.fn(),
    },
    userSuggestion: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSuggestionService,
        {
          provide: PrismaService,
          useValue: {
            db: mockPrismaDb,
            $transaction: mockPrismaDb.$transaction,
          },
        },
        {
          provide: GitHubIntegrationHandler,
          useValue: {
            getSuggestedUsers: jest.fn(),
          },
        },
        {
          provide: JiraIntegrationHandler,
          useValue: {
            getSuggestedUsers: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserSuggestionService>(UserSuggestionService);
    prismaService = module.get<PrismaService>(PrismaService);
    githubHandler = module.get<GitHubIntegrationHandler>(
      GitHubIntegrationHandler,
    );
    jiraHandler = module.get<JiraIntegrationHandler>(JiraIntegrationHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSuggestedUsers', () => {
    it('should return cached suggestions when available and fresh', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue(
        mockStoredSuggestions,
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      const [user] = result.users;
      if (!user) {
        throw new Error('Expected suggested user');
      }
      expect(user.email).toBe('john@example.com');
      expect(result.cached).toBe(true);
      expect(mockPrismaDb.integration.findMany).not.toHaveBeenCalled();
    });

    it('should refresh suggestions when no stored data exists', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue([]);
      mockPrismaDb.integration.findMany.mockResolvedValue([
        mockGitHubIntegration,
      ]);
      (githubHandler.getSuggestedUsers as jest.Mock).mockResolvedValue([
        mockSuggestedUsers[0],
      ]);
      mockPrismaDb.$transaction.mockImplementation((callback) =>
        callback(mockPrismaDb),
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      const [user] = result.users;
      if (!user) {
        throw new Error('Expected suggested user');
      }
      expect(user.email).toBe('john@example.com');
      expect(result.cached).toBe(false);
      expect(githubHandler.getSuggestedUsers).toHaveBeenCalledWith(
        mockGitHubIntegration,
        mockProjectId,
      );
    });

    it('should refresh suggestions when stored data is stale', async () => {
      // Arrange
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const staleSuggestions = [
        {
          ...mockStoredSuggestions[0],
          lastSeen: staleDate,
        },
      ];
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };

      mockPrismaDb.userSuggestion.findMany.mockResolvedValue(staleSuggestions);
      mockPrismaDb.integration.findMany.mockResolvedValue([
        mockGitHubIntegration,
      ]);
      (githubHandler.getSuggestedUsers as jest.Mock).mockResolvedValue([
        mockSuggestedUsers[0],
      ]);
      mockPrismaDb.$transaction.mockImplementation((callback) =>
        callback(mockPrismaDb),
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      expect(result.cached).toBe(false);
      expect(mockPrismaDb.integration.findMany).toHaveBeenCalled();
    });

    it('should handle multiple integrations and deduplicate users', async () => {
      // Arrange
      const duplicateUser = {
        name: 'John Doe Updated',
        email: 'john@example.com', // Same email as first user
        sources: ['jira'],
        confidence: 0.9,
        lastSeen: new Date(),
        integrationMetadata: { jiraAccountId: 'john-jira' },
      };

      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue([]);
      mockPrismaDb.integration.findMany.mockResolvedValue([
        mockGitHubIntegration,
        mockJiraIntegration,
      ]);
      (githubHandler.getSuggestedUsers as jest.Mock).mockResolvedValue([
        mockSuggestedUsers[0],
      ]);
      (jiraHandler.getSuggestedUsers as jest.Mock).mockResolvedValue([
        duplicateUser,
      ]);
      mockPrismaDb.$transaction.mockImplementation((callback) =>
        callback(mockPrismaDb),
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      const [user] = result.users;
      if (!user) {
        throw new Error('Expected suggested user');
      }
      expect(user.email).toBe('john@example.com');
      expect(user.sources).toEqual(['github', 'jira']); // Merged sources
      expect(user.confidence).toBe(0.9); // Higher confidence chosen
    });

    it('should apply integration type filter', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        integrationType: 'github',
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue(
        mockStoredSuggestions,
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      const [user] = result.users;
      if (!user) {
        throw new Error('Expected suggested user');
      }
      expect(user.sources).toContain('github');
    });

    it('should apply search filter', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        search: 'jane',
      };
      const multipleUsers = [
        mockStoredSuggestions[0],
        {
          ...mockStoredSuggestions[0],
          id: 'suggestion-2',
          name: 'Jane Smith',
          email: 'jane@example.com',
        },
      ];
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue(multipleUsers);

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
      const [user] = result.users;
      if (!user) {
        throw new Error('Expected suggested user');
      }
      expect(user.name).toBe('Jane Smith');
    });

    it('should apply limit filter', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        limit: 1,
      };
      const multipleUsers = [
        mockStoredSuggestions[0],
        {
          ...mockStoredSuggestions[0],
          id: 'suggestion-2',
          name: 'Jane Smith',
          email: 'jane@example.com',
        },
      ];
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue(multipleUsers);

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(1);
    });

    it('should return empty array when no integrations are found', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue([]);
      mockPrismaDb.integration.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(0);
      expect(result.cached).toBe(false);
    });

    it('should handle integration handler errors gracefully', async () => {
      // Arrange
      const filters = {
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
      };
      mockPrismaDb.userSuggestion.findMany.mockResolvedValue([]);
      mockPrismaDb.integration.findMany.mockResolvedValue([
        mockGitHubIntegration,
      ]);
      (githubHandler.getSuggestedUsers as jest.Mock).mockRejectedValue(
        new Error('API Error'),
      );

      // Act
      const result = await service.getSuggestedUsers(filters);

      // Assert
      expect(result.users).toHaveLength(0);
      expect(result.cached).toBe(false);
    });
  });

  describe('deduplicateAndScore', () => {
    it('should merge users with same email and combine sources', () => {
      // Arrange
      const users = [
        {
          name: 'John Doe',
          email: 'john@example.com',
          sources: ['github'],
          confidence: 0.7,
          lastSeen: new Date('2023-01-01'),
        },
        {
          name: 'John Doe (Jira)',
          email: 'john@example.com',
          sources: ['jira'],
          confidence: 0.8,
          lastSeen: new Date('2023-01-02'),
        },
      ];

      // Act
      const result = (service as any).deduplicateAndScore(users);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].sources).toEqual(['github', 'jira']);
      expect(result[0].confidence).toBe(0.8); // Higher confidence
      expect(result[0].lastSeen).toEqual(new Date('2023-01-02')); // More recent date
    });

    it('should sort results by confidence descending', () => {
      // Arrange
      const users = [
        {
          name: 'Low Confidence User',
          email: 'low@example.com',
          sources: ['github'],
          confidence: 0.3,
          lastSeen: new Date(),
        },
        {
          name: 'High Confidence User',
          email: 'high@example.com',
          sources: ['jira'],
          confidence: 0.9,
          lastSeen: new Date(),
        },
      ];

      // Act
      const result = (service as any).deduplicateAndScore(users);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].confidence).toBe(0.9);
      expect(result[1].confidence).toBe(0.3);
    });
  });
});
