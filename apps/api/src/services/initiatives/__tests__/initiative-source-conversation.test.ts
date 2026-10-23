import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InitiativeService } from '../initiative.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TagService } from '../../tag.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import * as TestUtils from '../../../utils/testUtils';
import {
  CreateInitiativeDto,
  WorkStatus,
  Priority,
  InitiativeCreatorType,
} from '../../../generated';
import { OrganizationId, ConversationId, InitiativeId } from '../../../types';

const { testIds } = TestUtils;
const createInitiativeSectionRecords = (
  initiativeId: InitiativeId,
  contentOverrides: Parameters<
    typeof TestUtils.createMockMaterializedWorkItemSections
  >[0] = {},
) =>
  TestUtils.createMockMaterializedWorkItemSections(contentOverrides).map(
    (section) => ({
      ...section,
      id: `${initiativeId}-${section.key}`,
      initiativeId,
      materializedMarkdown: section.materializedMarkdown ?? '',
    }),
  );

describe('InitiativeService - sourceConversationId', () => {
  let service: InitiativeService;
  let mockPrismaService: jest.Mocked<PrismaService>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;
  let mockTagService: jest.Mocked<TagService>;
  let mockInitiativeArtifactService: jest.Mocked<InitiativeArtifactService>;
  let mockArtifactService: jest.Mocked<ArtifactService>;
  let mockEntityRegistryService: jest.Mocked<EntityRegistryService>;

  beforeEach(async () => {
    mockPrismaService = TestUtils.createMockPrismaServiceWithTypes();
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();
    mockTagService =
      TestUtils.createMockTagService() as unknown as jest.Mocked<TagService>;
    mockInitiativeArtifactService =
      TestUtils.createMockInitiativeArtifactService() as unknown as jest.Mocked<InitiativeArtifactService>;
    mockArtifactService =
      TestUtils.createMockArtifactService() as unknown as jest.Mocked<ArtifactService>;
    mockEntityRegistryService = {
      registerEntity: jest.fn(),
      registerEntities: jest.fn(),
    } as unknown as jest.Mocked<EntityRegistryService>;
    if (!mockPrismaService.db.task.groupBy) {
      mockPrismaService.db.task.groupBy = jest.fn();
    }
    (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

    if (!mockPrismaService.db.initiativeSection) {
      mockPrismaService.db.initiativeSection = {
        findMany: jest.fn(),
      } as any;
    } else if (!mockPrismaService.db.initiativeSection.findMany) {
      mockPrismaService.db.initiativeSection.findMany = jest.fn();
    }
    (
      mockPrismaService.db.initiativeSection.findMany as jest.Mock
    ).mockImplementation(
      async (args?: { where?: { initiativeId?: { in?: string[] } } }) => {
        const ids = args?.where?.initiativeId?.in ?? [testIds.initiative];
        return ids.flatMap((id) =>
          createInitiativeSectionRecords(id as InitiativeId, {
            description: 'Test Description',
            details: 'Test Details',
            acceptanceCriteria: 'Test Acceptance Criteria',
          }),
        );
      },
    );
    if (!mockPrismaService.db.initiativeSectionUpdate) {
      mockPrismaService.db.initiativeSectionUpdate = {
        findMany: jest.fn(),
      } as any;
    } else if (!mockPrismaService.db.initiativeSectionUpdate.findMany) {
      mockPrismaService.db.initiativeSectionUpdate.findMany = jest.fn();
    }
    (
      mockPrismaService.db.initiativeSectionUpdate.findMany as jest.Mock
    ).mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InitiativeService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        {
          provide: TagService,
          useValue: mockTagService,
        },
        {
          provide: InitiativeArtifactService,
          useValue: mockInitiativeArtifactService,
        },
        {
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
        {
          provide: EntityRegistryService,
          useValue: mockEntityRegistryService,
        },
      ],
    }).compile();

    service = module.get<InitiativeService>(InitiativeService);
  });

  describe('createForAdapter with sourceConversationId', () => {
    const mockInitiativeData = {
      id: testIds.initiative,
      name: 'Test Initiative',
      status: WorkStatus.RefiningDescription,
      priority: Priority.Medium,
      organizationId: testIds.organization,
      originatingProjectId: testIds.project,
      sourceConversationId: testIds.conversation,
      creatorType: InitiativeCreatorType.User,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [] as string[],
      reasoning: null as string | null,
      assigneeId: null as string | null,
      dueDate: null as string | null,
      archivedAt: null as Date | null,
      lastModifiedAt: null as Date | null,
      lastModifiedBy: null as string | null,
    };

    it('should create initiative with valid sourceConversationId', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: testIds.conversation,
        projectId: testIds.project,
      };

      (
        mockPrismaService.db.conversation.findFirst as jest.Mock
      ).mockResolvedValueOnce({
        id: testIds.conversation,
        status: 'ACTIVE',
        category: 'ONBOARDING',
      });

      (
        mockPrismaService.db.initiative.create as jest.Mock
      ).mockResolvedValueOnce(mockInitiativeData);
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);
      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: any) => any) => {
          return callback(mockPrismaService.db);
        },
      );

      // Act
      const result = await service.createForAdapter(
        createDto,
        testIds.organization,
      );

      // Assert
      expect(mockPrismaService.db.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          id: testIds.conversation,
          project: {
            organizationId: testIds.organization,
          },
        },
        select: {
          id: true,
          status: true,
          workflowName: true,
          project: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: testIds.initiative,
          name: 'Test Initiative',
          sourceConversationId: testIds.conversation,
        }),
      );
    });

    it('should reject sourceConversationId from different organization', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: testIds.conversation,
        projectId: testIds.project,
      };

      (
        mockPrismaService.db.conversation.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.createForAdapter(createDto, testIds.organization),
      ).rejects.toThrow(
        `Source conversation ${testIds.conversation} not found in organization ${testIds.organization}`,
      );

      expect(mockPrismaService.db.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          id: testIds.conversation,
          project: {
            organizationId: testIds.organization,
          },
        },
        select: {
          id: true,
          status: true,
          workflowName: true,
          project: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      // Ensure initiative creation wasn't attempted
      expect(mockPrismaService.db.initiative.create).not.toHaveBeenCalled();
    });

    it('should reject invalid conversation ID', async () => {
      // Arrange
      const invalidConversationId = 'invalid-uuid-format';
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: invalidConversationId,
        projectId: testIds.project,
      };

      (
        mockPrismaService.db.conversation.findFirst as jest.Mock
      ).mockResolvedValueOnce(null);

      // Act & Assert
      await expect(
        service.createForAdapter(createDto, testIds.organization),
      ).rejects.toThrow(
        `Source conversation ${invalidConversationId} not found in organization ${testIds.organization}`,
      );
    });

    it('should handle null sourceConversationId gracefully', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: null as unknown as string,
        projectId: testIds.project,
      };

      const mockInitiativeWithoutSourceConv = {
        ...mockInitiativeData,
        sourceConversationId: null as string | null,
      };

      (
        mockPrismaService.db.initiative.create as jest.Mock
      ).mockResolvedValueOnce(mockInitiativeWithoutSourceConv);
      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: any) => any) => {
          return callback(mockPrismaService.db);
        },
      );

      // Act
      const result = await service.createForAdapter(
        createDto,
        testIds.organization,
      );

      // Assert
      expect(
        mockPrismaService.db.conversation.findFirst,
      ).not.toHaveBeenCalled();
      expect(result.sourceConversationId).toBeUndefined();
    });

    it('should handle undefined sourceConversationId gracefully', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        // sourceConversationId is undefined
        projectId: testIds.project,
      };

      const mockInitiativeWithoutSourceConv = {
        ...mockInitiativeData,
        sourceConversationId: null as string | null,
      };

      (
        mockPrismaService.db.initiative.create as jest.Mock
      ).mockResolvedValueOnce(mockInitiativeWithoutSourceConv);
      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: any) => any) => {
          return callback(mockPrismaService.db);
        },
      );

      // Act
      const result = await service.createForAdapter(
        createDto,
        testIds.organization,
      );

      // Assert
      expect(
        mockPrismaService.db.conversation.findFirst,
      ).not.toHaveBeenCalled();
      expect(result.sourceConversationId).toBeUndefined();
    });

    it('should handle database errors during conversation validation', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: testIds.conversation,
        projectId: testIds.project,
      };

      const dbError = new Error('Database connection failed');
      (
        mockPrismaService.db.conversation.findFirst as jest.Mock
      ).mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(
        service.createForAdapter(createDto, testIds.organization),
      ).rejects.toThrow('Database connection failed');

      expect(mockPrismaService.db.initiative.create).not.toHaveBeenCalled();
    });
  });

  describe('findByConversation', () => {
    it('should find initiatives by source conversation', async () => {
      // Arrange
      const mockInitiatives = [
        TestUtils.createMockInitiative({
          sourceConversationId: testIds.conversation,
          organizationId: testIds.organization,
        }),
        TestUtils.createMockInitiative({
          sourceConversationId: testIds.conversation,
          organizationId: testIds.organization,
        }),
      ];

      (
        mockPrismaService.db.initiative.findMany as jest.Mock
      ).mockResolvedValueOnce(mockInitiatives);

      // Act
      const result = await service.findByConversationForAdapter(
        testIds.conversation,
        testIds.organization,
      );

      // Assert
      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          sourceConversationId: testIds.conversation,
          organizationId: testIds.organization,
          archivedAt: null,
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 100,
      });

      expect(result).toHaveLength(2);
      const [first, second] = result;
      if (!first || !second) {
        throw new Error('Expected initiative results');
      }
      expect(first.sourceConversationId).toBe(testIds.conversation);
      expect(second.sourceConversationId).toBe(testIds.conversation);
    });

    it('should respect organization boundaries', async () => {
      // Arrange
      (
        mockPrismaService.db.initiative.findMany as jest.Mock
      ).mockResolvedValueOnce([]);

      // Act
      const result = await service.findByConversationForAdapter(
        testIds.conversation,
        testIds.organization,
      );

      // Assert
      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          sourceConversationId: testIds.conversation,
          organizationId: testIds.organization,
          archivedAt: null,
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 100,
      });

      expect(result).toEqual([]);
    });
  });

  describe('Integration scenarios', () => {
    it('should create initiative and allow finding by conversation', async () => {
      // Arrange
      const createDto: CreateInitiativeDto = {
        name: 'Integration Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        sourceConversationId: testIds.conversation,
        projectId: testIds.project,
      };

      const mockInitiative = TestUtils.createMockInitiative({
        sourceConversationId: testIds.conversation,
        organizationId: testIds.organization,
        name: 'Integration Test Initiative',
      });

      // Mock conversation validation
      (
        mockPrismaService.db.conversation.findFirst as jest.Mock
      ).mockResolvedValueOnce({
        id: testIds.conversation,
        status: 'ACTIVE',
        category: 'ONBOARDING',
      });

      // Mock initiative creation
      (
        mockPrismaService.db.initiative.create as jest.Mock
      ).mockResolvedValueOnce(mockInitiative);
      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: any) => any) => {
          return callback(mockPrismaService.db);
        },
      );

      // Mock finding by conversation
      (
        mockPrismaService.db.initiative.findMany as jest.Mock
      ).mockResolvedValueOnce([mockInitiative]);

      // Act
      const createdInitiative = await service.createForAdapter(
        createDto,
        testIds.organization,
      );
      const foundInitiatives = await service.findByConversationForAdapter(
        testIds.conversation,
        testIds.organization,
      );

      // Assert
      expect(createdInitiative.sourceConversationId).toBe(testIds.conversation);
      expect(foundInitiatives).toHaveLength(1);
      const [initiative] = foundInitiatives;
      if (!initiative) {
        throw new Error('Expected initiative result');
      }
      expect(initiative.sourceConversationId).toBe(testIds.conversation);
      expect(initiative.name).toBe('Integration Test Initiative');
    });
  });
});
