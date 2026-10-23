import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import { ArtifactService } from '../../artifacts/artifact.service';
import { TagService } from '../../tag.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import { InitiativeService } from '../initiative.service';
import { InitiativeDraft } from '../types';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';
import { Influence } from '../../../generated';

describe('InitiativeService - Influence Extraction', () => {
  let service: InitiativeService;
  let mockArtifactService: jest.Mocked<ArtifactService>;
  let mockInitiativeArtifactService: jest.Mocked<InitiativeArtifactService>;
  let mockPrismaService: any;

  const { testIds } = TestUtils;
  const createInitiativeSectionRecords = (initiativeId: string) =>
    TestUtils.createMockMaterializedWorkItemSections({
      description: 'Test description',
      details: 'Test details',
      acceptanceCriteria: 'Test acceptance criteria',
    }).map((section) => ({
      id: `${initiativeId}-${section.key}`,
      initiativeId,
      key: section.key,
      order: section.order,
      materializedMarkdown: section.materializedMarkdown,
    }));

  beforeEach(async () => {
    const mockModule: TestingModule = await Test.createTestingModule({
      providers: [
        InitiativeService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              initiative: {
                create: jest.fn(),
                findMany: jest.fn(),
                findUnique: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
              },
              projectInitiative: {
                create: jest.fn(),
                findMany: jest.fn(),
                delete: jest.fn(),
              },
              initiativeSection: {
                createMany: jest.fn(),
                findMany: jest.fn(),
              },
              initiativeSectionUpdate: {
                findMany: jest.fn().mockResolvedValue([]),
              },
              task: {
                groupBy: jest.fn().mockResolvedValue([]),
              },
              $transaction: jest.fn((fn) => fn({})),
            },
          },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: {
            publish: jest.fn(),
          },
        },
        {
          provide: TagService,
          useValue: {
            createTagsForEntity: jest.fn(),
            getTagsForEntity: jest.fn(),
            addTagsToInitiative: jest.fn(),
          },
        },
        {
          provide: InitiativeArtifactService,
          useValue: {
            storeOriginalGeneration: jest.fn(),
          },
        },
        {
          provide: ArtifactService,
          useValue: {
            findMany: jest.fn(),
          },
        },
        {
          provide: EntityRegistryService,
          useValue: {
            registerEntity: jest.fn(),
            registerEntities: jest.fn(),
          },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = mockModule.get<InitiativeService>(InitiativeService);
    mockArtifactService = mockModule.get(ArtifactService);
    mockInitiativeArtifactService = mockModule.get(InitiativeArtifactService);
    mockPrismaService = mockModule.get(PrismaService);

    mockPrismaService.db.initiativeSection.findMany.mockImplementation(
      (args: { where?: { initiativeId?: { in: string[] } } } = {}) => {
        const ids = args.where?.initiativeId?.in ?? [];
        return ids.flatMap((id: string) => createInitiativeSectionRecords(id));
      },
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConversationInfluences', () => {
    it('should extract conversation influences correctly', async () => {
      // Arrange
      const conversationId = testIds.conversation;
      const organizationId = testIds.organization;
      const projectId = testIds.project;

      const mockArtifacts = [
        TestUtils.createMockArtifact({
          id: 'artifact-1',
          title: 'User Goals',
          category: 'userGoals',
          data: {
            type: 'INSIGHT',
            content: 'Build a knowledge management system',
          } as any,
          projectId,
          sourceId: conversationId,
          status: 'ACTIVE' as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        TestUtils.createMockArtifact({
          id: 'artifact-2',
          title: 'Technical Requirements',
          category: 'requirements',
          data: {
            type: 'INSIGHT',
            content: 'System should support real-time collaboration',
          } as any,
          projectId,
          sourceId: conversationId,
          status: 'ACTIVE' as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        TestUtils.createMockArtifact({
          id: 'artifact-3',
          title: 'Design Constraints',
          category: 'constraints',
          data: {
            type: 'INSIGHT',
            content: 'Must be mobile-responsive',
          } as any,
          projectId,
          sourceId: conversationId,
          status: 'ACTIVE' as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ];

      mockArtifactService.findMany.mockResolvedValue({
        data: mockArtifacts,
        total: 3,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      const influences = await (service as any).getConversationInfluences(
        conversationId,
        organizationId,
      );

      // Assert
      expect(mockArtifactService.findMany).toHaveBeenCalledWith(
        {
          sourceId: conversationId,
          sourceType: 'CONVERSATION',
          status: 'ACTIVE',
          limit: 50,
        },
        organizationId,
      );

      expect(influences).toEqual([
        {
          artifactId: 'artifact-1',
          reasoning: 'Conversation context informed initiative design',
          reasonType: 'context',
        },
        {
          artifactId: 'artifact-2',
          reasoning: 'Conversation context informed initiative design',
          reasonType: 'context',
        },
        {
          artifactId: 'artifact-3',
          reasoning: 'Conversation context informed initiative design',
          reasonType: 'context',
        },
      ]);
    });

    it('should handle empty artifacts gracefully', async () => {
      // Arrange
      const conversationId = testIds.conversation;
      const organizationId = testIds.organization;

      mockArtifactService.findMany.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      const influences = await (service as any).getConversationInfluences(
        conversationId,
        organizationId,
      );

      // Assert
      expect(influences).toEqual([]);
      expect(mockArtifactService.findMany).toHaveBeenCalledTimes(1);
    });

    it('should handle service errors gracefully', async () => {
      // Arrange
      const conversationId = testIds.conversation;
      const organizationId = testIds.organization;

      mockArtifactService.findMany.mockRejectedValue(
        new Error('Database connection failed'),
      );

      // Act
      const influences = await (service as any).getConversationInfluences(
        conversationId,
        organizationId,
      );

      // Assert
      expect(influences).toEqual([]);
    });

    it('should filter only ACTIVE artifacts', async () => {
      // Arrange
      const conversationId = testIds.conversation;
      const organizationId = testIds.organization;

      const mockArtifacts = [
        TestUtils.createMockArtifact({
          id: 'active-artifact',
          title: 'Active Artifact',
          status: 'ACTIVE' as any,
          sourceId: conversationId,
        }),
      ];

      mockArtifactService.findMany.mockResolvedValue({
        data: mockArtifacts,
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      await (service as any).getConversationInfluences(
        conversationId,
        organizationId,
      );

      // Assert
      expect(mockArtifactService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
        }),
        organizationId,
      );
    });

    it('should limit results to 50 artifacts', async () => {
      // Arrange
      const conversationId = testIds.conversation;
      const organizationId = testIds.organization;

      mockArtifactService.findMany.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });

      // Act
      await (service as any).getConversationInfluences(
        conversationId,
        organizationId,
      );

      // Assert
      expect(mockArtifactService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 50,
        }),
        organizationId,
      );
    });
  });

  describe('createFromDrafts with influences', () => {
    it('should pass influences to artifact service when creating from drafts', async () => {
      // Arrange
      const mockLLMInfluences: Influence[] = [
        {
          entityId: 'artifact-1',
          entityType: 'ARTIFACT',
          reasoning: 'LLM-generated influence',
          reasonType: 'references',
          confidence: 0.95,
        },
        {
          entityId: 'artifact-2',
          entityType: 'ARTIFACT',
          reasoning: 'LLM-generated requirement',
          reasonType: 'depends_on',
          confidence: 0.88,
        },
      ];

      const mockDrafts = [
        {
          id: 'draft-1',
          name: 'Test Initiative',
          description: 'Test description',
          details: 'Detailed test information',
          acceptanceCriteria: 'Test acceptance criteria',
          reasoning: 'Test reasoning for initiative',
          priority: 'high' as const,
          tags: ['test'],
          estimatedEffort: 'medium' as const,
          influences: mockLLMInfluences,
        },
      ];

      const organizationId = testIds.organization;
      const projectId = testIds.project;
      const sourceConversationId = testIds.conversation;

      // Mock storeOriginalArtifactIfNeeded
      const storeOriginalSpy = jest
        .spyOn(service as any, 'storeOriginalArtifactIfNeeded')
        .mockResolvedValue(undefined);

      // Mock database operations
      const mockCreatedInitiative = {
        id: 'created-initiative-123',
        name: 'Test Initiative',
        description: 'Test description',
        priority: 'high',
        originatingProjectId: projectId,
        organizationId,
        projectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.db.initiative.create.mockResolvedValue(
        mockCreatedInitiative,
      );

      // Act
      await service.createFromDrafts(
        mockDrafts,
        organizationId,
        projectId,
        sourceConversationId,
      );

      // Assert: Should pass initiatives with embedded influences
      expect(storeOriginalSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: 'Test Initiative',
            influences: [
              {
                entityId: 'artifact-1',
                entityType: 'ARTIFACT',
                reasoning: 'LLM-generated influence',
                reasonType: 'references',
                confidence: 0.95,
              },
              {
                entityId: 'artifact-2',
                entityType: 'ARTIFACT',
                reasoning: 'LLM-generated requirement',
                reasonType: 'depends_on',
                confidence: 0.88,
              },
            ],
            status: 'REFINING_DESCRIPTION',
          }),
        ]),
        organizationId,
        projectId,
        expect.objectContaining({
          sourceId: sourceConversationId,
          generationModel: 'llm-generated',
          generationPrompt: 'initiative-generation',
          originalRequestContext: { source: 'onboarding-flow' },
        }),
        'createFromDrafts',
      );
    });

    it('should handle creation without source conversation', async () => {
      // Arrange
      const mockDrafts = [
        {
          id: 'draft-1',
          name: 'Test Initiative',
          description: 'Test description',
          details: 'Detailed test information',
          acceptanceCriteria: 'Test acceptance criteria',
          reasoning: 'Test reasoning for initiative',
          priority: 'high' as const,
          tags: ['test'],
          estimatedEffort: 'medium' as const,
          influences: [] as InitiativeDraft['influences'],
        },
      ];

      const organizationId = testIds.organization;
      const projectId = testIds.project;
      // No sourceConversationId provided

      // Mock storeOriginalArtifactIfNeeded
      const storeOriginalSpy = jest
        .spyOn(service as any, 'storeOriginalArtifactIfNeeded')
        .mockResolvedValue(undefined);

      const getConversationInfluencesSpy = jest
        .spyOn(service as any, 'getConversationInfluences')
        .mockResolvedValue([]);

      const mockCreatedInitiative = {
        id: 'created-initiative-123',
        name: 'Test Initiative',
        organizationId,
        projectId,
        originatingProjectId: projectId,
        priority: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.db.initiative.create.mockResolvedValue(
        mockCreatedInitiative,
      );

      // Act
      await service.createFromDrafts(mockDrafts, organizationId, projectId);

      // Assert
      expect(getConversationInfluencesSpy).not.toHaveBeenCalled();

      expect(storeOriginalSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: 'Test Initiative',
            influences: [],
            status: 'REFINING_DESCRIPTION',
          }),
        ]),
        organizationId,
        projectId,
        expect.objectContaining({
          generationModel: 'llm-generated',
          generationPrompt: 'initiative-generation',
          originalRequestContext: { source: 'onboarding-flow' },
        }),
        'createFromDrafts',
      );
    });

    it('should handle influence extraction failures gracefully', async () => {
      // Arrange
      const mockDrafts = [
        {
          id: 'draft-1',
          name: 'Test Initiative',
          description: 'Test description',
          details: 'Detailed test information',
          acceptanceCriteria: 'Test acceptance criteria',
          reasoning: 'Test reasoning for initiative',
          priority: 'high' as const,
          tags: [] as string[],
          estimatedEffort: 'small' as const,
          influences: [] as InitiativeDraft['influences'],
        },
      ];

      const organizationId = testIds.organization;
      const projectId = testIds.project;
      const sourceConversationId = testIds.conversation;

      // Mock influence extraction failure - should return empty array, not throw
      jest
        .spyOn(service as any, 'getConversationInfluences')
        .mockResolvedValue([]); // Returns empty array instead of throwing

      // Mock storeOriginalArtifactIfNeeded
      const storeOriginalSpy = jest
        .spyOn(service as any, 'storeOriginalArtifactIfNeeded')
        .mockResolvedValue(undefined);

      const mockCreatedInitiative = {
        id: 'created-initiative-123',
        organizationId,
        projectId,
        originatingProjectId: projectId,
        priority: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.db.initiative.create.mockResolvedValue(
        mockCreatedInitiative,
      );

      // Act & Assert - should not throw
      await expect(
        service.createFromDrafts(
          mockDrafts,
          organizationId,
          projectId,
          sourceConversationId,
        ),
      ).resolves.not.toThrow();

      // Should still create initiatives even if influence extraction fails
      expect(mockPrismaService.db.initiative.create).toHaveBeenCalled();
      expect(storeOriginalSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            influences: [],
            status: 'REFINING_DESCRIPTION',
          }),
        ]),
        organizationId,
        projectId,
        expect.objectContaining({
          sourceId: sourceConversationId,
          generationModel: 'llm-generated',
          generationPrompt: 'initiative-generation',
          originalRequestContext: { source: 'onboarding-flow' },
        }),
        'createFromDrafts',
      );
    });

    it('should create proper generation context with influences', async () => {
      // Arrange
      const mockLLMInfluences: Influence[] = [
        {
          entityId: 'context-artifact-1',
          entityType: 'ARTIFACT',
          reasoning: 'Key requirement artifact',
          reasonType: 'references',
          confidence: 0.92,
        },
      ];

      const mockDrafts = [
        {
          id: 'draft-1',
          name: 'Initiative with Context',
          description: 'Description with context',
          details: 'Detailed context information',
          acceptanceCriteria: 'Context acceptance criteria',
          reasoning: 'Context reasoning for initiative',
          priority: 'critical' as const,
          tags: ['important', 'urgent'],
          estimatedEffort: 'large' as const,
          influences: mockLLMInfluences,
        },
      ];

      const organizationId = testIds.organization;
      const projectId = testIds.project;
      const sourceConversationId = testIds.conversation;

      // Mock storeOriginalArtifactIfNeeded
      const storeOriginalSpy = jest
        .spyOn(service as any, 'storeOriginalArtifactIfNeeded')
        .mockResolvedValue(undefined);

      const mockCreatedInitiative = {
        id: 'initiative-with-context-123',
        organizationId,
        projectId,
        originatingProjectId: projectId,
        priority: 'critical',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.db.initiative.create.mockResolvedValue(
        mockCreatedInitiative,
      );

      // Act
      await service.createFromDrafts(
        mockDrafts,
        organizationId,
        projectId,
        sourceConversationId,
      );

      // Assert: Should use LLM influences embedded in initiatives
      const [firstCall] = storeOriginalSpy.mock.calls;
      if (!firstCall) {
        throw new Error('Expected storeOriginalGeneration call');
      }
      const initiativesArray = firstCall[0];
      const generationContext = firstCall[3];

      // Check that influences are properly embedded in the initiative
      expect(initiativesArray).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Initiative with Context',
            influences: [
              {
                entityId: 'context-artifact-1',
                entityType: 'ARTIFACT',
                reasoning: 'Key requirement artifact',
                reasonType: 'references',
                confidence: 0.92,
              },
            ],
            status: 'REFINING_DESCRIPTION',
          }),
        ]),
      );

      // Check generation context structure (no longer includes influences)
      expect(generationContext).toMatchObject({
        generationModel: 'llm-generated',
        generationPrompt: 'initiative-generation',
        originalRequestContext: {
          source: 'onboarding-flow',
        },
        sourceId: sourceConversationId,
      });
    });
  });
});
