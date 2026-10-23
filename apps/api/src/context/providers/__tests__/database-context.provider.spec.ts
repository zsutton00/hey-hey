import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ArtifactStatus as PrismaArtifactStatus,
  ArtifactType as PrismaArtifactType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
} from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
import {
  ArtifactWithMetadata,
  ContextFilters,
  ContextRequest,
  ContextScope,
  ContextType,
} from '../../interfaces';
import { ProviderPriority } from '../../types/context.types';
import { DatabaseContextProvider } from '../database-context.provider';

describe('DatabaseContextProvider', () => {
  let provider: DatabaseContextProvider;
  let prismaService: {
    db: {
      artifact: {
        findMany: jest.Mock;
        count: jest.Mock;
      };
    };
  };

  const { testIds } = TestUtils;

  const mockArtifacts = [
    {
      id: 'artifact-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: PrismaArtifactType.QA_PAIR,
      title: 'Test Artifact 1',
      data: {
        question: 'What is testing?',
        answer: 'Testing is verification',
      },
      tags: ['testing', 'qa'],
      category: 'development',
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-02'),
      sourceType: 'conversation',
      sourceId: 'conv-1',
      parentId: undefined,
      priority: 'HIGH',
      status: PrismaArtifactStatus.ACTIVE,
      isPublic: false,
      project: { id: 'project-1', name: 'Test Project' },
      parent: null as any,
      children: [] as any[],
    },
    {
      id: 'artifact-2',
      organizationId: 'org-1',
      projectId: 'project-1',
      type: PrismaArtifactType.DECISION,
      title: 'Test Decision',
      data: { decision: 'Use TypeScript', rationale: 'Better type safety' },
      tags: ['architecture'],
      category: 'decision',
      createdAt: new Date('2023-01-03'),
      updatedAt: new Date('2023-01-04'),
      sourceType: 'initiative',
      sourceId: 'init-1',
      parentId: undefined,
      priority: 'MEDIUM',
      status: PrismaArtifactStatus.ACTIVE,
      isPublic: true,
      project: { id: 'project-1', name: 'Test Project' },
      parent: null as any,
      children: [] as any[],
    },
  ];

  beforeEach(async () => {
    const mockPrismaService = {
      db: {
        artifact: {
          findMany: jest.fn(),
          count: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseContextProvider,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    provider = module.get<DatabaseContextProvider>(DatabaseContextProvider);
    prismaService = module.get(PrismaService);

    // Spy on logger methods
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should have correct name and priority', () => {
      // Tests that the provider has the expected static configuration values
      // Expects: name = 'database-context-provider' and priority = HIGH (1)
      expect(provider.name).toBe('database-context-provider');
      expect(provider.priority).toBe(ProviderPriority.HIGH);
    });

    it('should support all context types', () => {
      // Tests that the provider declares support for all expected context types
      // Expects: supportedTypes array contains CONVERSATION, PROJECT, RELATED, INITIATIVE
      expect(provider.supportedTypes).toEqual([
        ContextType.CONVERSATION,
        ContextType.PROJECT,
        ContextType.RELATED,
        ContextType.INITIATIVE,
      ]);
    });
  });

  describe('canHandle', () => {
    it('should return true for supported context types', () => {
      // Tests that canHandle returns true for context types the provider supports
      // Expects: returns true for CONVERSATION type and logs debug information
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: testIds.project,
        correlationId: 'test-correlation',
      };

      const result = provider.canHandle(request);

      expect(result).toBe(true);
    });

    it('should return false for unsupported context types', () => {
      // Tests that canHandle returns false for context types not in supportedTypes
      // Expects: returns false for unknown/unsupported context type
      const request: ContextRequest = {
        type: 'UNSUPPORTED_TYPE' as ContextType,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: testIds.project,
        correlationId: 'test-correlation',
      };

      const result = provider.canHandle(request);

      expect(result).toBe(false);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      prismaService.db.artifact.findMany.mockResolvedValue(mockArtifacts);
      prismaService.db.artifact.count.mockResolvedValue(2);
    });

    it('should resolve conversation context successfully', async () => {
      // Tests that resolve() can fetch conversation-specific artifacts from database
      // Expects: returns artifacts with conversation filter, proper metadata, and logs execution
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: testIds.project,
        conversationId: 'conv-1' as ConversationId,
        maxResults: 10,
        correlationId: 'test-correlation',
      };

      const result = await provider.resolve(request);

      expect(result).toEqual({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            id: 'artifact-1',
            type: PrismaArtifactType.QA_PAIR,
            data: {
              question: 'What is testing?',
              answer: 'Testing is verification',
            },
            relevanceScore: expect.any(Number),
            selectionReason: expect.any(String),
          }),
          expect.objectContaining({
            id: 'artifact-2',
            type: PrismaArtifactType.DECISION,
            data: {
              decision: 'Use TypeScript',
              rationale: 'Better type safety',
            },
          }),
        ]),
        totalCount: 2,
        tokenEstimate: expect.any(Number),
        providerName: 'database-context-provider',
        executionTimeMs: expect.any(Number),
        metadata: expect.objectContaining({
          queryStrategy: 'conversation_artifacts',
          databaseQuery: expect.any(Object),
        }),
      });

      expect(prismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: 'org-1' as OrganizationId,
          sourceType: 'CONVERSATION',
          sourceId: 'conv-1',
          status: PrismaArtifactStatus.ACTIVE,
        }),
        orderBy: { createdAt: 'asc' },
        take: 10,
        include: {
          project: true,
          parent: true,
          children: true,
        },
      });
    });

    it('should resolve project context successfully', async () => {
      // Tests that resolve() can fetch project-specific artifacts with correct query strategy
      // Expects: uses 'project_artifacts' strategy, filters by projectId, orders by createdAt desc
      const request: ContextRequest = {
        type: ContextType.PROJECT,
        scope: ContextScope.PROJECT,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      const result = await provider.resolve(request);

      expect(result.metadata?.queryStrategy).toBe('project_artifacts');
      expect(prismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          status: PrismaArtifactStatus.ACTIVE,
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: true,
          parent: true,
          children: true,
        },
      });
    });

    it('should resolve initiative context with OR conditions', async () => {
      // Tests that resolve() builds complex OR query for initiative artifacts
      // Expects: finds artifacts by sourceType='initiative' OR by initiative tag
      const request: ContextRequest = {
        type: ContextType.INITIATIVE,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        projectId: testIds.project,
        initiativeId: 'init-1' as InitiativeId,
        correlationId: 'test-correlation',
      };

      await provider.resolve(request);

      expect(prismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          organizationId: 'org-1' as OrganizationId,
          status: PrismaArtifactStatus.ACTIVE,
          OR: [
            { sourceType: 'INITIATIVE', sourceId: 'init-1' },
            { tags: { hasSome: ['initiative-init-1'] } },
          ],
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: true,
          parent: true,
          children: true,
        },
      });
    });

    it('should apply artifact type filters', async () => {
      // Tests that resolve() applies artifactTypes filter to limit result types
      // Expects: adds 'type: { in: [...] }' condition to WHERE clause
      const request: ContextRequest = {
        type: ContextType.PROJECT,
        scope: ContextScope.PROJECT,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        artifactTypes: ['QA_PAIR', 'DECISION'],
        correlationId: 'test-correlation',
      };

      await provider.resolve(request);

      expect(prismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          type: { in: ['QA_PAIR', 'DECISION'] },
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: true,
          parent: true,
          children: true,
        },
      });
    });

    it('should apply additional filters', async () => {
      // Tests that resolve() applies complex ContextFilters (tags, categories, dates, exclusions)
      // Expects: combines all filter conditions in WHERE clause with proper operators
      const request: ContextRequest = {
        type: ContextType.PROJECT,
        scope: ContextScope.PROJECT,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      const filters: ContextFilters = {
        tags: ['testing', 'qa'],
        categories: ['development'],
        dateRange: {
          start: new Date('2023-01-01'),
          end: new Date('2023-01-31'),
        },
        excludeArtifactIds: ['exclude-1', 'exclude-2'],
      };

      await provider.resolve(request, filters);

      expect(prismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tags: { hasSome: ['testing', 'qa'] },
          category: { in: ['development'] },
          createdAt: {
            gte: new Date('2023-01-01'),
            lte: new Date('2023-01-31'),
          },
          id: { notIn: ['exclude-1', 'exclude-2'] },
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: true,
          parent: true,
          children: true,
        },
      });
    });

    it('should handle errors and log them', async () => {
      // Tests that resolve() properly handles database errors and logs failure details
      // Expects: throws original error and logs error message with context
      const error = new Error('Database connection failed');
      prismaService.db.artifact.findMany.mockRejectedValue(error);

      const request: ContextRequest = {
        type: ContextType.PROJECT,
        scope: ContextScope.PROJECT,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        correlationId: 'test-correlation',
      };

      await expect(provider.resolve(request)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('estimateTokens', () => {
    it('should calculate token estimates correctly', () => {
      // Tests that estimateTokens() calculates rough token count from artifact data
      // Expects: returns positive number based on JSON.stringify length / 4 + overhead
      const artifacts: ArtifactWithMetadata[] = [
        {
          id: 'artifact-1',
          organizationId: 'org-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          type: 'QA_PAIR',
          title: 'Test',
          data: { question: 'What?', answer: 'This' },
          tags: ['test'],
          category: 'test',
          createdAt: new Date(),
          updatedAt: new Date(),
          sourceType: 'test',
          sourceId: 'test',
          parentId: undefined,
          priority: 'HIGH',
          status: 'ACTIVE',
          isPublic: false,
        },
      ];

      const tokens = provider.estimateTokens(artifacts);

      // Should be roughly (JSON.stringify length + metadata overhead) / 4
      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });
  });

  describe('Private Methods', () => {
    it('should calculate relevance scores correctly', () => {
      // Tests that calculateRelevanceScore() assigns higher scores for better matches
      // Expects: base score (0.5) + conversation match + project match + recency bonus
      const artifact = mockArtifacts[0];
      if (!artifact) {
        throw new Error('Expected mock artifact');
      }
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        conversationId: 'conv-1' as ConversationId,
        projectId: 'project-1' as ProjectId,
      };

      // Access private method through any cast for testing
      const score = provider['calculateRelevanceScore'](artifact, request);

      // Should have base score (0.5) + conversation match (0.3) + project match (0.2) + recent bonus (0.1) = 1.0
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('should generate selection reasons correctly', () => {
      // Tests that getSelectionReason() generates descriptive reason strings
      // Expects: comma-separated reasons like 'from_target_conversation,from_target_project'
      const artifact = mockArtifacts[0];
      if (!artifact) {
        throw new Error('Expected mock artifact');
      }
      const request: ContextRequest = {
        type: ContextType.CONVERSATION,
        scope: ContextScope.ORGANIZATION,
        organizationId: 'org-1' as OrganizationId,
        conversationId: 'conv-1' as ConversationId,
        projectId: 'project-1' as ProjectId,
        artifactTypes: ['QA_PAIR'],
      };

      const reason = provider['getSelectionReason'](artifact, request);

      expect(reason).toContain('from_target_conversation');
      expect(reason).toContain('from_target_project');
      expect(reason).toContain('matching_artifact_type');
    });
  });
});
