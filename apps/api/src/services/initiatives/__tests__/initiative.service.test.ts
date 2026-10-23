/* eslint-disable @typescript-eslint/unbound-method */
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { InitiativeService } from '../initiative.service';
import { TagService } from '../../tag.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import {
  CreateInitiativeDto,
  InitiativeSectionUpdateSource,
  WorkStatus,
  Priority,
  InitiativeCreatorType,
} from '../../../generated';
import {
  InitiativeId,
  OrganizationId,
  ProjectId,
  ConversationId,
} from 'src/types';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import * as TestUtils from '../../../utils/testUtils';
import { materializedSectionsToContentMap } from '../../../utils/work-item-section.util';
import { InitiativeDraft } from '../types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { RedisService } from '../../../core/redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';

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

// Mock the EventContextManager
jest.mock('../../../core/events/observable-event.context', () => ({
  EventContextManager: {
    getInstance: jest.fn(() => ({
      getCurrentContext: jest.fn(() => ({
        correlationId: 'test-correlation-id',
        organizationId: 'test-org-id',
        metadata: {},
      })),
    })),
  },
  WithEventContext: () => () => {},
  WithWorkflowContext: () => () => {},
}));

// const mockEventPublisher = { publish: jest.fn() };

describe('InitiativeService', () => {
  let service: InitiativeService;

  let mockPrismaService: jest.Mocked<PrismaService>;
  let mockEventPublisher: jest.Mocked<any>;
  let mockTagService: jest.Mocked<TagService>;
  let mockInitiativeArtifactService: jest.Mocked<InitiativeArtifactService>;
  let mockArtifactService: jest.Mocked<ArtifactService>;

  const organizationId = testIds.organization;
  const initiativeId = testIds.initiative;
  const defaultProjectId = testIds.project;

  beforeEach(async () => {
    mockPrismaService =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;

    mockPrismaService.$transaction = jest
      .fn()
      .mockImplementation(async (callback) =>
        callback(mockPrismaService.db as any),
      );

    // Add missing table mocks that are needed for initiative service tests
    if (!mockPrismaService.db.projectInitiative) {
      mockPrismaService.db.projectInitiative = {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      } as any;
    }
    if (!mockPrismaService.db.projectInitiative.findMany) {
      mockPrismaService.db.projectInitiative.findMany = jest.fn();
    }
    (
      mockPrismaService.db.projectInitiative.findMany as jest.Mock
    ).mockResolvedValue([]);

    // Add missing methods to initiative table mock
    if (!mockPrismaService.db.initiative.createMany) {
      mockPrismaService.db.initiative.createMany = jest.fn();
    }

    if (!mockPrismaService.db.conversation) {
      mockPrismaService.db.conversation = {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      } as any;
    }

    // Ensure updateMany is available on existing conversation mock
    if (!mockPrismaService.db.conversation.updateMany) {
      mockPrismaService.db.conversation.updateMany = jest.fn();
    }

    if (!mockPrismaService.db.task.groupBy) {
      mockPrismaService.db.task.groupBy = jest.fn();
    }
    (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

    if (!mockPrismaService.db.initiativeSection) {
      mockPrismaService.db.initiativeSection = {
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      } as any;
    } else {
      if (!mockPrismaService.db.initiativeSection.createMany) {
        mockPrismaService.db.initiativeSection.createMany = jest.fn();
      }
      if (!mockPrismaService.db.initiativeSection.findMany) {
        mockPrismaService.db.initiativeSection.findMany = jest.fn();
      }
      if (!mockPrismaService.db.initiativeSection.update) {
        mockPrismaService.db.initiativeSection.update = jest.fn();
      }
    }
    (
      mockPrismaService.db.initiativeSection.findMany as jest.Mock
    ).mockImplementation(
      async (args?: {
        where?: {
          initiativeId?: string | { in?: string[] };
          key?: { in?: string[] };
        };
      }) => {
        const initiativeIdFilter = args?.where?.initiativeId;
        const ids = Array.isArray((initiativeIdFilter as { in?: string[] })?.in)
          ? ((initiativeIdFilter as { in?: string[] }).in as string[])
          : typeof initiativeIdFilter === 'string'
            ? [initiativeIdFilter]
            : [initiativeId];
        const keyFilter = args?.where?.key?.in;
        return ids.flatMap((id) => {
          const rows = createInitiativeSectionRecords(id as InitiativeId, {
            description: 'Test description',
            details: 'Some details',
            acceptanceCriteria: 'Some criteria',
          });
          if (!keyFilter?.length) {
            return rows;
          }
          return rows.filter((row) => keyFilter.includes(row.key));
        });
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

    mockEventPublisher = TestUtils.createMockDomainEventPublisher();
    mockTagService =
      TestUtils.createMockTagService() as unknown as jest.Mocked<TagService>;
    // Augment the mock TagService with methods the helper does not seed but
    // the service relies on.
    (mockTagService as unknown as {
      syncInitiativeTags: jest.Mock;
    }).syncInitiativeTags = jest.fn().mockResolvedValue(undefined);
    mockInitiativeArtifactService =
      TestUtils.createMockInitiativeArtifactService() as unknown as jest.Mocked<InitiativeArtifactService>;
    mockArtifactService =
      TestUtils.createMockArtifactService() as unknown as jest.Mocked<ArtifactService>;
    const redisProvider = createRedisServiceMock();

    const setup = await createServiceTestingModule({
      providers: [
        InitiativeService,
        PrismaService,
        TagService,
        InitiativeArtifactService,
        ArtifactService,
        RedisService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [TagService, mockTagService],
        [InitiativeArtifactService, mockInitiativeArtifactService],
        [ArtifactService, mockArtifactService],
        [RedisService, redisProvider.useValue],
      ],
    });

    service = setup.module.get<InitiativeService>(InitiativeService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an initiative successfully', async () => {
      const createDto: CreateInitiativeDto & {
        organizationId: OrganizationId;
      } = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        organizationId,
        projectId: defaultProjectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: ['test', 'initiative'],
      };

      const mockInitiative = TestUtils.createMockInitiative({
        id: initiativeId,
        name: createDto.name,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Test Description',
        }),
        organizationId: createDto.organizationId,
        status: createDto.status,
        priority: createDto.priority,
        tags: createDto.tags,
        creatorType: createDto.creatorType,
        reasoning: createDto.reasoning,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        dueDate: undefined,
        sourceConversationId: undefined,
        linkedProjectIds: [defaultProjectId],
      });

      (
        mockPrismaService.db.projectInitiative.findMany as jest.Mock
      ).mockResolvedValue([{ projectId: mockInitiative.originatingProjectId }]);
      (mockPrismaService.db.initiative.create as jest.Mock).mockResolvedValue(
        mockInitiative,
      );
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue(
        createInitiativeSectionRecords(initiativeId, {
          description: 'Test Description',
        }),
      );

      const result = await service.create(createDto, defaultProjectId);

      expect(mockPrismaService.db.initiative.create).toHaveBeenCalledWith({
        data: {
          name: createDto.name,
          assignee: createDto.assigneeId
            ? { connect: { id: createDto.assigneeId } }
            : undefined,
          organization: { connect: { id: createDto.organizationId } },
          reasoning: createDto.reasoning,
          creatorType: createDto.creatorType,
          status: createDto.status,
          priority: createDto.priority,
          dueDate: createDto.dueDate ? new Date(createDto.dueDate) : null,
          sourceConversation: createDto.sourceConversationId
            ? { connect: { id: createDto.sourceConversationId } }
            : undefined,
          originatingProject: { connect: { id: defaultProjectId } },
          projects: {
            create: {
              projectId: defaultProjectId,
            },
          },
          sections: expect.any(Object),
        },
      });

      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining('initiative.created'),
          aggregateId: initiativeId,
        }),
      );
      expect(result).toEqual(mockInitiative);

      // The project-linked path should NOT call publishInTransaction
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(0);
    });

    it('should create an initiative and link to a project when projectId is provided', async () => {
      const projectId = 'project-42' as ProjectId;
      const createDto: CreateInitiativeDto & {
        organizationId: OrganizationId;
      } = {
        name: 'Initiative With Project',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Linked to project',
        }),
        organizationId,
        projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.Low,
        tags: [] as string[],
        creatorType: InitiativeCreatorType.User,
      };

      const mockInitiative = TestUtils.createMockInitiative({
        id: initiativeId,
        name: createDto.name,
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Linked to project',
        }),
        organizationId: createDto.organizationId,
        status: createDto.status,
        priority: createDto.priority,
        tags: createDto.tags,
        creatorType: createDto.creatorType,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        dueDate: undefined,
        sourceConversationId: undefined,
        linkedProjectIds: [projectId],
      });

      (
        mockPrismaService.db.initiative.create as jest.Mock
      ).mockResolvedValueOnce(mockInitiative);

      (
        mockPrismaService.db.projectInitiative.findMany as jest.Mock
      ).mockResolvedValue([{ projectId }]);
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue(
        createInitiativeSectionRecords(initiativeId, {
          description: 'Linked to project',
        }),
      );

      const result = await service.create(createDto, projectId);

      expect(mockPrismaService.db.initiative.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: createDto.name,
          organization: { connect: { id: createDto.organizationId } },
          projects: {
            create: { projectId },
          },
        }),
      });

      expect(result).toEqual(mockInitiative);

      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining('initiative.created'),
          aggregateId: initiativeId,
        }),
      );
    });
  });

  describe('createMany', () => {
    it('should create multiple initiatives with batch insert and outbox events', async () => {
      const initiatives = [
        {
          name: 'Initiative 1',
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'Description 1',
          }),
          organizationId,
          projectId: defaultProjectId,
          status: WorkStatus.RefiningDescription,
          priority: Priority.High,
          tags: ['tag1'] as string[],
        },
        {
          name: 'Initiative 2',
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'Description 2',
          }),
          organizationId,
          projectId: defaultProjectId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          tags: ['tag2'] as string[],
        },
      ];

      const mockCreatedInitiatives = [
        TestUtils.createMockInitiative({
          id: 'initiative-1' as InitiativeId,
          name: 'Initiative 1',
          sections: TestUtils.createMockMaterializedWorkItemSections({
            description: 'Description 1',
          }),
          organizationId,
          status: WorkStatus.RefiningDescription,
          priority: Priority.High,
          tags: ['tag1'],
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          dueDate: undefined,
          sourceConversationId: undefined,
        }),
        TestUtils.createMockInitiative({
          id: 'initiative-2' as InitiativeId,
          name: 'Initiative 2',
          sections: TestUtils.createMockMaterializedWorkItemSections({
            description: 'Description 2',
          }),
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          tags: ['tag2'],
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          dueDate: undefined,
          sourceConversationId: undefined,
        }),
      ];

      // Mock the transaction
      const mockTransaction = {
        initiative: {
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
          findMany: jest.fn().mockResolvedValue(mockCreatedInitiatives),
        },
        projectInitiative: {
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };

      (mockPrismaService.$transaction as jest.Mock) = jest
        .fn()
        .mockImplementation((callback) => callback(mockTransaction));
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue([
        ...createInitiativeSectionRecords('initiative-1' as InitiativeId, {
          description: 'Description 1',
        }),
        ...createInitiativeSectionRecords('initiative-2' as InitiativeId, {
          description: 'Description 2',
        }),
      ]);

      const result = await service.createMany(
        initiatives,
        organizationId,
        defaultProjectId,
      );

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockTransaction.initiative.createMany).toHaveBeenCalledWith({
        data: initiatives.map((init) => ({
          name: init.name,
          assigneeId: (init as any).assigneeId as string | undefined,
          organizationId: init.organizationId,
          reasoning: (init as any).reasoning || undefined,
          creatorType: (init as any).creatorType || undefined,
          status: init.status,
          priority: init.priority,
          dueDate: (init as any).dueDate
            ? new Date((init as any).dueDate)
            : null,
          originatingProjectId: defaultProjectId,
          // tags are managed separately by TagService, not included in createMany
        })),
      });

      expect(mockTransaction.initiative.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          name: { in: ['Initiative 1', 'Initiative 2'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });

      // Should publish events for each initiative
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);

      expect(result).toEqual(mockCreatedInitiatives);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.createMany(
        [],
        organizationId,
        defaultProjectId,
      );
      expect(result).toEqual([]);
    });

    it('should create multiple initiatives and link each to a project when projectId is provided', async () => {
      const projectId = 'project-99' as ProjectId;

      const createDtos: CreateInitiativeDto[] = [
        {
          name: 'Init 1',
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'd1',
          }),
          projectId,
          priority: Priority.Medium,
          status: WorkStatus.RefiningDescription,
          tags: [] as string[],
        },
        {
          name: 'Init 2',
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'd2',
          }),
          projectId,
          priority: Priority.High,
          status: WorkStatus.RefiningDescription,
          tags: [] as string[],
        },
      ];

      const mockInitiatives = createDtos.map((dto, idx) =>
        TestUtils.createMockInitiative({
          id: `init-${idx}` as InitiativeId,
          name: dto.name,
          sections: TestUtils.createMockMaterializedWorkItemSections({
            description: idx === 0 ? 'd1' : 'd2',
          }),
          priority: dto.priority,
          status: dto.status,
          tags: dto.tags,
          organizationId,
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          dueDate: undefined,
          sourceConversationId: undefined,
          linkedProjectIds: [projectId],
        }),
      );

      // Mock the transaction that will call tx.initiative.createMany and findMany
      const mockTransaction = {
        initiative: {
          create: jest.fn(),
          createMany: jest.fn().mockResolvedValue({ count: createDtos.length }),
          findMany: jest.fn().mockResolvedValue(mockInitiatives),
        },
        projectInitiative: {
          createMany: jest.fn().mockResolvedValue({ count: createDtos.length }),
        },
      };

      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback) => {
          await callback(mockTransaction);
          return mockInitiatives;
        },
      );

      (
        mockPrismaService.db.projectInitiative.findMany as jest.Mock
      ).mockResolvedValue(mockInitiatives.map(() => ({ projectId })));
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue([
        ...createInitiativeSectionRecords('init-0' as InitiativeId, {
          description: 'd1',
        }),
        ...createInitiativeSectionRecords('init-1' as InitiativeId, {
          description: 'd2',
        }),
      ]);

      // Attach organizationId to each DTO and pass projectId to createMany
      const result = await service.createMany(
        createDtos,
        organizationId,
        projectId,
      );

      // Ensure $transaction was called
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);

      // Validate tx.initiative.createMany was called with correct data
      expect(mockTransaction.initiative.createMany).toHaveBeenCalledWith({
        data: createDtos.map((dto) =>
          expect.objectContaining({
            name: dto.name,
            organizationId,
            priority: dto.priority,
            status: dto.status,
          }),
        ),
      });

      // Validate tx.initiative.findMany was called to fetch created records
      expect(mockTransaction.initiative.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          name: { in: createDtos.map((dto) => dto.name) },
        },
        orderBy: { createdAt: 'desc' },
        take: createDtos.length,
      });

      // Validate tx.projectInitiative.createMany was called to link projects
      expect(mockTransaction.projectInitiative.createMany).toHaveBeenCalledWith(
        {
          data: mockInitiatives.map((initiative) => ({
            initiativeId: initiative.id,
            projectId,
          })),
        },
      );

      expect(result).toEqual(mockInitiatives);

      // expect publishInTransaction called for each initiative (not publish)
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(
        createDtos.length,
      );
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(0);
    });
  });

  describe('findAll', () => {
    it('should find all initiatives with default pagination', async () => {
      const mockInitiatives = [
        TestUtils.createMockInitiative({
          id: 'initiative-1' as InitiativeId,
          name: 'Initiative 1',
          organizationId,
          linkedProjectIds: ['project-1'],
          status: WorkStatus.Active,
          tags: ['tag1'],
          createdAt: '2023-01-01T00:00:00.000Z',
        }),
        TestUtils.createMockInitiative({
          id: 'initiative-2' as InitiativeId,
          name: 'Initiative 2',
          organizationId,
          linkedProjectIds: ['project-1'],
          status: WorkStatus.RefiningDescription,
          tags: ['tag2'],
          createdAt: '2023-01-01T00:00:00.000Z',
        }),
      ];

      (mockPrismaService.db.initiative.findMany as jest.Mock).mockResolvedValue(
        mockInitiatives,
      );

      const result = await service.findAll(organizationId, {
        projectId: defaultProjectId,
      });

      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null as Date | null,
          status: {
            not: WorkStatus.Cancelled,
          },
          projects: {
            some: {
              projectId: defaultProjectId,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 0,
        take: 20,
      });

      expect(result).toEqual(mockInitiatives);
    });

    it('should find initiatives with filters', async () => {
      const filters = {
        statuses: [WorkStatus.Active],
        priority: Priority.High,
        tags: ['important'],
        projectId: defaultProjectId,
        page: 2,
        limit: 10,
      };

      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'Important Initiative',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.High,
          tags: ['important'],
          createdAt: new Date(),
        },
      ];

      (mockPrismaService.db.initiative.findMany as jest.Mock).mockResolvedValue(
        mockInitiatives,
      );

      const result = await service.findAll(organizationId, filters);

      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null as Date | null,
          status: { in: [WorkStatus.Active] },
          priority: Priority.High,
          tags: {
            hasEvery: ['important'],
          },
          projects: {
            some: {
              projectId: defaultProjectId,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 10, // (page 2 - 1) * limit 10
        take: 10,
      });

      expect(result).toEqual(mockInitiatives);
    });

    it('should filter initiatives by projectId', async () => {
      const projectId = 'project-123' as ProjectId;
      const filters = {
        projectId,
        page: 1,
        limit: 20,
      };

      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'Project Initiative',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          tags: ['project-related'],
          createdAt: new Date(),
        },
      ];

      (mockPrismaService.db.initiative.findMany as jest.Mock).mockResolvedValue(
        mockInitiatives,
      );

      const result = await service.findAll(organizationId, filters);

      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null as Date | null,
          status: {
            not: WorkStatus.Cancelled,
          },
          projects: {
            some: {
              projectId,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 0,
        take: 20,
      });

      expect(result).toEqual(mockInitiatives);
    });
  });

  describe('findOne', () => {
    it('should find an initiative by id', async () => {
      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
        status: WorkStatus.Active,
        createdAt: new Date(),
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(mockInitiative);

      const result = await service.findOne(initiativeId, organizationId);

      expect(mockPrismaService.db.initiative.findFirst).toHaveBeenCalledWith({
        where: {
          id: initiativeId,
          organizationId,
          archivedAt: null as Date | null,
        },
      });

      expect(result).toEqual(mockInitiative);
    });

    it('should return null if initiative not found', async () => {
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.findOne('non-existent-id', organizationId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update an initiative successfully', async () => {
      const updateDto = {
        name: 'Updated Initiative',
        status: WorkStatus.Active,
        priority: Priority.Critical,
      };

      const existingInitiative = {
        id: initiativeId,
        name: 'Old Name',
        description: 'Old Description',
        organizationId,
        status: WorkStatus.RefiningDescription,
        createdAt: new Date(),
        originatingProjectId: 'proj-123' as ProjectId,
      };

      const updatedInitiative = {
        ...existingInitiative,
        ...updateDto,
        updatedAt: new Date(),
        linkedProjectIds: [] as ProjectId[],
      };

      // Mock the transaction
      const mockTransaction = {
        initiative: {
          update: jest.fn().mockResolvedValue(updatedInitiative),
        },
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(existingInitiative);
      (mockPrismaService.db.$transaction as jest.Mock) = jest
        .fn()
        .mockImplementation((callback) => callback(mockTransaction));

      const result = await service.update(
        initiativeId,
        updateDto,
        organizationId,
      );

      expect(mockPrismaService.db.initiative.findFirst).toHaveBeenCalledWith({
        where: {
          id: initiativeId,
          organizationId,
          archivedAt: null as Date | null,
        },
      });

      expect(mockPrismaService.db.$transaction).toHaveBeenCalled();
      expect(mockTransaction.initiative.update).toHaveBeenCalledWith({
        where: { id: initiativeId },
        data: {
          name: updateDto.name,
          status: updateDto.status,
          priority: updateDto.priority,
        },
      });

      // Should be called twice: UPDATED and STATUS_CHANGED
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);

      // Verify STATUS_CHANGED event
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        mockTransaction,
        expect.objectContaining({
          type: EVENT_TYPES.INITIATIVE.STATUS_CHANGED,
          aggregateId: initiativeId,
          payload: expect.objectContaining({
            previousStatus: WorkStatus.RefiningDescription,
            newStatus: WorkStatus.Active,
            originatingProjectId: 'proj-123',
          }),
        }),
      );

      expect(result).toEqual(updatedInitiative);
    });

    it('should throw NotFoundException if initiative does not exist', async () => {
      const updateDto = {
        name: 'Updated Initiative',
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.update(initiativeId, updateDto, organizationId),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.db.initiative.update).not.toHaveBeenCalled();
    });
  });

  describe('updateInTransaction', () => {
    function makeTx(existing: Record<string, unknown> | null) {
      const updateMock = jest.fn().mockImplementation(async ({ data }) => ({
        ...(existing ?? {}),
        ...data,
      }));
      const findFirstMock = jest.fn().mockResolvedValue(existing);
      const sectionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      return {
        tx: {
          initiative: {
            findFirst: findFirstMock,
            update: updateMock,
          },
          initiativeSection: {
            updateMany: sectionUpdateMany,
          },
        } as unknown as Parameters<
          InitiativeService['updateInTransaction']
        >[0],
        updateMock,
        findFirstMock,
        sectionUpdateMany,
      };
    }

    const baseExisting = {
      id: initiativeId,
      organizationId,
      archivedAt: null as Date | null,
      name: 'Old',
      status: WorkStatus.RefiningDescription,
      originatingProjectId: defaultProjectId,
    };

    it('applies name and section updates inside the caller tx and returns a postCommit payload', async () => {
      const { tx, updateMock, sectionUpdateMany } = makeTx(baseExisting);

      const result = await service.updateInTransaction(
        tx,
        initiativeId,
        {
          name: 'Renamed',
          sections: [{ key: 'description', content: 'New body' }],
        },
        organizationId,
      );

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: initiativeId },
        data: expect.objectContaining({ name: 'Renamed' }),
      });
      expect(sectionUpdateMany).toHaveBeenCalledWith({
        where: { initiativeId, key: 'description' },
        data: { materializedMarkdown: 'New body' },
      });
      expect(result.initiative.name).toBe('Renamed');
      expect(result.postCommit).toEqual({
        tagsToSync: undefined,
        statusChange: undefined,
      });
    });

    it('emits a statusChange in postCommit when status actually changes', async () => {
      const { tx } = makeTx(baseExisting);
      const result = await service.updateInTransaction(
        tx,
        initiativeId,
        { status: WorkStatus.Active },
        organizationId,
      );
      expect(result.postCommit.statusChange).toEqual({
        previousStatus: WorkStatus.RefiningDescription,
        newStatus: WorkStatus.Active,
      });
    });

    it('skips the initiative row update when only sections change', async () => {
      const { tx, updateMock, sectionUpdateMany } = makeTx(baseExisting);
      await service.updateInTransaction(
        tx,
        initiativeId,
        { sections: [{ key: 'details', content: 'd' }] },
        organizationId,
      );
      expect(updateMock).not.toHaveBeenCalled();
      expect(sectionUpdateMany).toHaveBeenCalledWith({
        where: { initiativeId, key: 'details' },
        data: { materializedMarkdown: 'd' },
      });
    });

    it('returns tagsToSync in postCommit when tags are present', async () => {
      const { tx } = makeTx(baseExisting);
      const result = await service.updateInTransaction(
        tx,
        initiativeId,
        { tags: ['alpha', 'beta'] },
        organizationId,
      );
      expect(result.postCommit.tagsToSync).toEqual(['alpha', 'beta']);
    });

    it('throws NotFoundException when the initiative does not exist in the tx', async () => {
      const { tx } = makeTx(null);
      await expect(
        service.updateInTransaction(
          tx,
          initiativeId,
          { name: 'noop' },
          organizationId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('runUpdatePostCommit', () => {
    it('syncs initiative tags when tagsToSync is set', async () => {
      await service.runUpdatePostCommit(
        organizationId,
        initiativeId as InitiativeId,
        { tagsToSync: ['a', 'b'] },
      );
      expect(mockTagService.syncInitiativeTags).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
        [
          { name: 'a', source: 'USER' },
          { name: 'b', source: 'USER' },
        ],
        'USER',
      );
    });

    it('does nothing when the post-commit payload is empty', async () => {
      await service.runUpdatePostCommit(
        organizationId,
        initiativeId as InitiativeId,
        {},
      );
      expect(mockTagService.syncInitiativeTags).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft delete an initiative successfully', async () => {
      const existingInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
        status: WorkStatus.Active,
        createdAt: new Date(),
        archivedAt: null as Date | null,
        originatingProjectId: defaultProjectId,
      };

      const archivedInitiative = {
        ...existingInitiative,
        archivedAt: new Date(),
      };

      // Mock the transaction
      const mockTransaction = {
        initiative: {
          update: jest.fn().mockResolvedValue(archivedInitiative),
        },
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(existingInitiative);
      (mockPrismaService.$transaction as jest.Mock) = jest
        .fn()
        .mockImplementation((callback) => callback(mockTransaction));

      const result = await service.remove(initiativeId, organizationId);

      expect(mockPrismaService.db.initiative.findFirst).toHaveBeenCalledWith({
        where: {
          id: initiativeId,
          organizationId,
          archivedAt: null as Date | null,
        },
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockTransaction.initiative.update).toHaveBeenCalledWith({
        where: { id: initiativeId },
        data: {
          archivedAt: expect.any(Date),
        },
      });

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(archivedInitiative);
    });

    it('should throw NotFoundException if initiative does not exist', async () => {
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.remove(initiativeId, organizationId),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.db.initiative.update).not.toHaveBeenCalled();
    });
  });

  describe('linkProject', () => {
    const projectId = 'project-123' as ProjectId;

    it('should link a project to an initiative successfully', async () => {
      const role = 'primary';

      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
      };

      const mockProject = {
        id: projectId,
        name: 'Test Project',
        organizationId,
        deletedAt: null as Date | null,
      };

      const mockProjectInitiative = {
        id: 'link-123',
        projectId,
        initiativeId,
        role,
        createdAt: new Date(),
      };

      // Mock the transaction
      const mockTransaction = {
        initiative: {
          update: jest.fn(),
        },
        projectInitiative: {
          create: jest.fn().mockResolvedValue(mockProjectInitiative),
        },
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(mockInitiative);
      (mockPrismaService.db.project.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrismaService.$transaction as jest.Mock) = jest
        .fn()
        .mockImplementation((callback) => callback(mockTransaction));

      const result = await service.linkProject(
        initiativeId,
        projectId,
        organizationId,
        role,
      );

      expect(mockPrismaService.db.initiative.findFirst).toHaveBeenCalledWith({
        where: {
          id: initiativeId,
          organizationId,
          archivedAt: null as Date | null,
        },
      });

      expect(mockPrismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: projectId,
          organizationId,
          deletedAt: null,
        },
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockTransaction.projectInitiative.create).toHaveBeenCalledWith({
        data: {
          projectId,
          initiativeId,
          role,
        },
      });

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockProjectInitiative);
    });

    it('should throw NotFoundException if initiative does not exist', async () => {
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.linkProject(initiativeId, projectId, organizationId),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.db.project.findFirst).not.toHaveBeenCalled();
      expect(
        mockPrismaService.db.projectInitiative.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if project does not exist', async () => {
      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(mockInitiative);
      (mockPrismaService.db.project.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.linkProject(initiativeId, projectId, organizationId),
      ).rejects.toThrow(NotFoundException);

      expect(
        mockPrismaService.db.projectInitiative.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('unlinkProject', () => {
    const projectId = 'project-123' as ProjectId;

    it('should unlink a project from an initiative successfully', async () => {
      const deleteResult = { count: 1 };

      // Mock the transaction
      const mockTransaction = {
        projectInitiative: {
          deleteMany: jest.fn().mockResolvedValue(deleteResult),
        },
      };

      (mockPrismaService.$transaction as jest.Mock) = jest
        .fn()
        .mockImplementation((callback) => callback(mockTransaction));

      const result = await service.unlinkProject(
        initiativeId,
        projectId,
        organizationId,
      );

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockTransaction.projectInitiative.deleteMany).toHaveBeenCalledWith(
        {
          where: {
            projectId,
            initiativeId,
          },
        },
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual(deleteResult);
    });
  });

  describe('getLinkedProjects', () => {
    it('should get all projects linked to an initiative', async () => {
      const mockProjectLinks = [
        {
          id: 'link-1',
          projectId: 'project-1',
          initiativeId,
          role: 'primary',
          project: {
            id: 'project-1',
            name: 'Project 1',
            organizationId,
          },
        },
        {
          id: 'link-2',
          projectId: 'project-2',
          initiativeId,
          role: 'supporting',
          project: {
            id: 'project-2',
            name: 'Project 2',
            organizationId,
          },
        },
      ];

      (
        mockPrismaService.db.projectInitiative.findMany as jest.Mock
      ).mockResolvedValue(mockProjectLinks);

      const result = await service.getLinkedProjects(
        initiativeId,
        organizationId,
      );

      expect(
        mockPrismaService.db.projectInitiative.findMany,
      ).toHaveBeenCalledWith({
        where: {
          initiativeId,
          project: {
            organizationId,
            deletedAt: null,
          },
          initiative: {
            organizationId,
            archivedAt: null as Date | null,
          },
        },
        include: {
          project: true,
        },
      });

      expect(result).toEqual(mockProjectLinks);
    });
  });

  describe('getProjectInitiatives', () => {
    it('should get all initiatives linked to a project', async () => {
      const projectId = 'project-123';

      const mockInitiativeLinks = [
        {
          id: 'link-1',
          projectId,
          initiativeId: 'initiative-1',
          role: 'primary',
          initiative: {
            id: 'initiative-1',
            name: 'Initiative 1',
            organizationId,
          },
        },
        {
          id: 'link-2',
          projectId,
          initiativeId: 'initiative-2',
          role: 'supporting',
          initiative: {
            id: 'initiative-2',
            name: 'Initiative 2',
            organizationId,
          },
        },
      ];

      (
        mockPrismaService.db.projectInitiative.findMany as jest.Mock
      ).mockResolvedValue(mockInitiativeLinks);

      const result = await service.getProjectInitiatives(
        projectId,
        organizationId,
      );

      expect(
        mockPrismaService.db.projectInitiative.findMany,
      ).toHaveBeenCalledWith({
        where: {
          projectId,
          initiative: {
            organizationId,
            archivedAt: null as Date | null,
          },
        },
        include: {
          initiative: true,
        },
      });

      expect(result).toEqual(mockInitiativeLinks);
    });
  });

  describe('adapter methods', () => {
    it('should transform response correctly in createForAdapter', async () => {
      const createDto: CreateInitiativeDto & {
        organizationId: OrganizationId;
      } = {
        name: 'Test Initiative',
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Test Description',
        }),
        organizationId,
        projectId: defaultProjectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: ['test', 'initiative'],
      };

      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        assigneeId: null as string | null,
        organizationId,
        status: WorkStatus.RefiningDescription,
        priority: createDto.priority,
        tags: [] as string[],
        creatorType: null as string | null,
        reasoning: null as string | null,
        createdAt: new Date('2023-01-01T00:00:00Z'),
        updatedAt: new Date('2023-01-01T00:00:00Z'),
        archivedAt: null as Date | null,
        dueDate: null as Date | null,
        originatingProjectId: defaultProjectId,
      };

      (mockPrismaService.db.initiative.create as jest.Mock).mockResolvedValue(
        mockInitiative,
      );
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue(
        createInitiativeSectionRecords(initiativeId, {
          description: 'Test Description',
        }),
      );

      const result = await service.createForAdapter(createDto, organizationId);

      expect(result).toEqual(
        expect.objectContaining({
          id: mockInitiative.id,
          name: mockInitiative.name,
          status: mockInitiative.status,
          priority: mockInitiative.priority,
          tags: mockInitiative.tags,
          organizationId: mockInitiative.organizationId,
          originatingProjectId: defaultProjectId,
          linkedProjectIds: [defaultProjectId],
          sourceConversationId: undefined,
          creatorType: null,
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
        }),
      );
      const content = materializedSectionsToContentMap(result.sections);
      expect(content.description).toBe('Test Description');
    });

    it('should return null in findOneForAdapter when initiative not found', async () => {
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.findOneForAdapter(
        initiativeId,
        organizationId,
      );

      expect(result).toBeNull();
    });
  });

  describe('createFromDrafts', () => {
    const projectId = 'project-123' as ProjectId;
    const conversationId = 'conv-456' as ConversationId;

    it('should create initiatives from drafts and store original artifacts', async () => {
      const drafts: InitiativeDraft[] = [
        {
          id: 'draft-1',
          name: 'Initiative One',
          description: 'First initiative description',
          details: 'First initiative details',
          acceptanceCriteria: 'First initiative criteria',
          priority: 'high',
          estimatedEffort: 'large',
          tags: ['tag1', 'tag2'],
          reasoning: 'This is needed for the project',
          influences: [],
        },
        {
          id: 'draft-2',
          name: 'Initiative Two',
          description: 'Second initiative description',
          details: 'Second initiative details',
          acceptanceCriteria: 'Second initiative criteria',
          priority: 'medium',
          estimatedEffort: 'small',
          tags: ['tag3'],
          reasoning: 'Also needed',
          influences: [],
        },
      ];

      const mockCreatedInitiatives = [
        {
          id: 'init-1',
          name: 'Initiative One',
          reasoning: 'This is needed for the project',
          organizationId,
          originatingProjectId: projectId,
          status: WorkStatus.RefiningDescription,
          priority: Priority.High,
          sourceConversationId: conversationId,
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          tags: [] as string[],
          assigneeId: null as string | null,
          creatorType: null as string | null,
        },
        {
          id: 'init-2',
          name: 'Initiative Two',
          reasoning: 'Also needed',
          organizationId,
          originatingProjectId: projectId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          sourceConversationId: conversationId,
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          tags: [] as string[],
          assigneeId: null as string | null,
          creatorType: null as string | null,
        },
      ];

      // Mock database calls
      (mockPrismaService.db.initiative.create as jest.Mock)
        .mockResolvedValueOnce(mockCreatedInitiatives[0])
        .mockResolvedValueOnce(mockCreatedInitiatives[1]);

      (
        mockPrismaService.db.projectInitiative.create as jest.Mock
      ).mockResolvedValue({
        id: 'link-1',
        projectId,
        initiativeId: 'init-1',
      });

      // Mock artifact service
      const mockArtifacts = [
        TestUtils.createMockArtifact({
          id: 'artifact-1',
          type: 'INITIATIVE_ORIGINAL' as any,
          projectId: testIds.project,
        }),
        TestUtils.createMockArtifact({
          id: 'artifact-2',
          type: 'INITIATIVE_ORIGINAL' as any,
          projectId: testIds.project,
        }),
      ];
      (
        mockInitiativeArtifactService.storeOriginalGeneration as jest.Mock
      ).mockResolvedValue(mockArtifacts);
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue([
        ...createInitiativeSectionRecords('init-1' as InitiativeId, {
          description: 'First initiative description',
          details: 'First initiative details',
          acceptanceCriteria: 'First initiative criteria',
        }),
        ...createInitiativeSectionRecords('init-2' as InitiativeId, {
          description: 'Second initiative description',
          details: 'Second initiative details',
          acceptanceCriteria: 'Second initiative criteria',
        }),
      ]);

      const result = await service.createFromDrafts(
        drafts,
        organizationId,
        projectId,
        conversationId,
      );

      // Verify initiatives were created
      expect(mockPrismaService.db.initiative.create).toHaveBeenCalledTimes(2);

      // Verify first initiative creation
      expect(mockPrismaService.db.initiative.create).toHaveBeenNthCalledWith(
        1,
        {
          data: {
            name: 'Initiative One',
            reasoning: 'This is needed for the project',
            organizationId,
            originatingProjectId: projectId,
            status: 'REFINING_DESCRIPTION',
            priority: Priority.High,
            sourceConversationId: conversationId,
            sections: {
              create: expect.any(Array),
            },
          },
        },
      );

      // Verify second initiative creation
      expect(mockPrismaService.db.initiative.create).toHaveBeenNthCalledWith(
        2,
        {
          data: {
            name: 'Initiative Two',
            reasoning: 'Also needed',
            organizationId,
            originatingProjectId: projectId,
            status: 'REFINING_DESCRIPTION',
            priority: Priority.Medium,
            sourceConversationId: conversationId,
            sections: {
              create: expect.any(Array),
            },
          },
        },
      );

      // Verify project linking
      expect(
        mockPrismaService.db.projectInitiative.create,
      ).toHaveBeenCalledTimes(2);

      // Verify tags were created
      expect(mockTagService.addTagsToInitiative).toHaveBeenCalledTimes(2);
      expect(mockTagService.addTagsToInitiative).toHaveBeenNthCalledWith(
        1,
        'init-1',
        organizationId,
        [
          { name: 'tag1', source: 'SYSTEM_FAST' },
          { name: 'tag2', source: 'SYSTEM_FAST' },
        ],
      );

      // Verify original artifacts were stored (THE CRITICAL TEST)
      // Only Planning status initiatives qualify for artifact storage
      expect(
        mockInitiativeArtifactService.storeOriginalGeneration,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockInitiativeArtifactService.storeOriginalGeneration,
      ).toHaveBeenCalledWith(
        [
          {
            name: 'Initiative One',
            description: 'First initiative description',
            details: 'First initiative details',
            acceptanceCriteria: 'First initiative criteria',
            priority: 'high',
            estimatedEffort: undefined,
            influences: [],
            tags: ['tag1', 'tag2'],
            reasoning: 'This is needed for the project',
          },
          {
            name: 'Initiative Two',
            description: 'Second initiative description',
            details: 'Second initiative details',
            acceptanceCriteria: 'Second initiative criteria',
            priority: 'medium',
            estimatedEffort: undefined,
            influences: [],
            tags: ['tag3'],
            reasoning: 'Also needed',
          },
        ],
        [{ id: 'init-1' }, { id: 'init-2' }],
        organizationId,
        projectId,
        {
          sourceId: conversationId,
          generationModel: 'llm-generated',
          generationPrompt: 'initiative-generation',
          originalRequestContext: { source: 'onboarding-flow' },
        },
      );

      // Verify domain events were published
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2);
      const [firstEvent] = mockEventPublisher.publish.mock.calls.map(
        ([event]: [unknown]) => event,
      );
      expect(firstEvent).toEqual(
        expect.objectContaining({
          type: EVENT_TYPES.INITIATIVE.CREATED,
          aggregateId: 'init-1',
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.INITIATIVE.CREATED,
            organizationId,
            projectId,
            initiative: expect.objectContaining({
              id: 'init-1',
              name: 'Initiative One',
              organizationId,
              status: WorkStatus.RefiningDescription,
              priority: Priority.High,
              tags: [],
              originatingProjectId: projectId,
              linkedProjectIds: [projectId],
            }),
          }),
        }),
      );

      // Verify return value
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'init-1',
          name: 'Initiative One',
          organizationId,
          status: WorkStatus.RefiningDescription,
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'init-2',
          name: 'Initiative Two',
          organizationId,
          status: WorkStatus.Active,
        }),
      );
    });

    it('should handle empty drafts array', async () => {
      await expect(
        service.createFromDrafts([], organizationId, projectId),
      ).rejects.toThrow('Drafts array cannot be empty');

      expect(mockPrismaService.db.initiative.create).not.toHaveBeenCalled();
      expect(
        mockInitiativeArtifactService.storeOriginalGeneration,
      ).not.toHaveBeenCalled();
    });

    it('should continue creating initiatives even if artifact storage fails', async () => {
      const drafts: InitiativeDraft[] = [
        {
          id: 'draft-1',
          name: 'Initiative One',
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
          priority: 'medium',
          tags: [],
          reasoning: 'Test reasoning',
          influences: [],
        },
      ];

      const mockCreatedInitiative = {
        id: 'init-1',
        name: 'Initiative One',
        reasoning: 'Test reasoning',
        organizationId,
        originatingProjectId: projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.Medium,
        sourceConversationId: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null as Date | null,
        dueDate: null as Date | null,
        tags: [] as string[],
        assigneeId: null as string | null,
        creatorType: null as string | null,
      };

      (mockPrismaService.db.initiative.create as jest.Mock).mockResolvedValue(
        mockCreatedInitiative,
      );

      // Mock artifact storage failure
      mockInitiativeArtifactService.storeOriginalGeneration.mockRejectedValue(
        new Error('Artifact storage failed'),
      );
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue(
        createInitiativeSectionRecords('init-1' as InitiativeId, {
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
        }),
      );

      const result = await service.createFromDrafts(
        drafts,
        organizationId,
        projectId,
      );

      // Should still create initiatives despite artifact failure
      expect(mockPrismaService.db.initiative.create).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      const [initiative] = result;
      if (!initiative) {
        throw new Error('Expected initiative result');
      }
      expect(initiative.id).toBe('init-1');

      // Should attempt artifact storage but not fail the whole operation
      expect(
        mockInitiativeArtifactService.storeOriginalGeneration,
      ).toHaveBeenCalledTimes(1);
    });

    it('should map draft properties correctly', async () => {
      const draft: InitiativeDraft = {
        id: 'draft-1',
        name: 'Test Initiative',
        description: 'Base description',
        details: 'Additional details',
        acceptanceCriteria: 'Acceptance criteria',
        priority: 'critical',
        tags: ['important'],
        reasoning: 'Critical for success',
        influences: [],
      };

      const mockInitiative = {
        id: 'init-1',
        name: 'Test Initiative',
        reasoning: 'Critical for success',
        organizationId,
        originatingProjectId: projectId,
        status: WorkStatus.Active,
        priority: Priority.Critical,
        sourceConversationId: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null as Date | null,
        dueDate: null as Date | null,
        tags: [] as string[],
        assigneeId: null as string | null,
        creatorType: null as string | null,
      };

      (mockPrismaService.db.initiative.create as jest.Mock).mockResolvedValue(
        mockInitiative,
      );
      (
        mockPrismaService.db.initiativeSection.findMany as jest.Mock
      ).mockResolvedValue(
        createInitiativeSectionRecords('init-1' as InitiativeId, {
          description: 'Base description',
          details: 'Additional details',
          acceptanceCriteria: 'Acceptance criteria',
        }),
      );

      await service.createFromDrafts([draft], organizationId, projectId);

      // Check that fields are passed correctly
      expect(mockPrismaService.db.initiative.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Initiative',
          reasoning: 'Critical for success',
          organizationId,
          originatingProjectId: projectId,
          status: 'REFINING_DESCRIPTION', // All createFromDrafts use REFINING_DESCRIPTION status
          priority: Priority.Critical, // 'critical' mapped to Priority.Critical
          sourceConversationId: undefined,
          sections: {
            create: expect.any(Array),
          },
        },
      });
    });
  });

  describe('findByConversation', () => {
    it('should find initiatives by conversation ID', async () => {
      const conversationId = 'conv-123';
      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'Initiative 1',
          organizationId,
          sourceConversationId: conversationId,
          status: WorkStatus.Active,
          createdAt: new Date('2023-01-01'),
        },
        {
          id: 'initiative-2',
          name: 'Initiative 2',
          organizationId,
          sourceConversationId: conversationId,
          status: WorkStatus.RefiningDescription,
          createdAt: new Date('2023-01-02'),
        },
      ];

      (mockPrismaService.db.initiative.findMany as jest.Mock).mockResolvedValue(
        mockInitiatives,
      );

      const result = await service.findByConversation(
        conversationId,
        organizationId,
      );

      expect(mockPrismaService.db.initiative.findMany).toHaveBeenCalledWith({
        where: {
          sourceConversationId: conversationId,
          organizationId,
          archivedAt: null as Date | null,
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 100,
      });

      expect(result).toEqual(mockInitiatives);
    });

    it('should return empty array when no initiatives found for conversation', async () => {
      const conversationId = 'conv-nonexistent';

      (mockPrismaService.db.initiative.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const result = await service.findByConversation(
        conversationId,
        organizationId,
      );

      expect(result).toEqual([]);
    });
  });

  describe('adapter methods - comprehensive coverage', () => {
    describe('findAllForAdapter', () => {
      it('should transform all initiatives correctly', async () => {
        const filters = {
          statuses: [WorkStatus.Active],
          projectId: defaultProjectId,
          page: 1,
          limit: 10,
        };

        const mockInitiatives = [
          {
            id: 'initiative-1',
            name: 'Test Initiative',
            assigneeId: null as string | null,
            status: WorkStatus.Active,
            priority: Priority.High,
            dueDate: new Date('2024-01-01'),
            tags: ['tag1', 'tag2'],
            organizationId,
            originatingProjectId: defaultProjectId,
            creatorType: 'user',
            reasoning: 'Test reasoning',
            createdAt: new Date('2023-01-01T00:00:00Z'),
            updatedAt: new Date('2023-01-02T00:00:00Z'),
          },
        ];

        (
          mockPrismaService.db.initiative.findMany as jest.Mock
        ).mockResolvedValue(mockInitiatives);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockResolvedValue(
          createInitiativeSectionRecords('initiative-1' as InitiativeId, {
            description: '',
            details: 'Some details',
            acceptanceCriteria: '',
          }),
        );

        const result = await service.findAllForAdapter(organizationId, filters);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
          expect.objectContaining({
            id: 'initiative-1',
            name: 'Test Initiative',
            assigneeId: undefined,
            status: WorkStatus.Active,
            priority: Priority.High,
            dueDate: '2024-01-01T00:00:00.000Z',
            tags: ['tag1', 'tag2'],
            organizationId,
            originatingProjectId: defaultProjectId,
            linkedProjectIds: [] as ProjectId[],
            sourceConversationId: undefined,
            creatorType: 'user',
            reasoning: 'Test reasoning',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-02T00:00:00.000Z',
            childCounts: {
              total: 0,
              done: 0,
              inProgress: 0,
              backlog: 0,
            },
          }),
        );
        const content = materializedSectionsToContentMap(result[0]?.sections);
        expect(content.description).toBe('');
        expect(content.details).toBe('');
        expect(content.acceptanceCriteria).toBe('');
      });

      it('should handle status-based field filtering for RefiningDescription', async () => {
        const filters = {
          projectId: defaultProjectId,
        };
        const mockInitiatives = [
          {
            id: 'initiative-1',
            name: 'Test Initiative',
            assigneeId: null as string | null,
            status: WorkStatus.RefiningDescription,
            priority: Priority.Medium,
            dueDate: null as Date | null,
            tags: [] as string[],
            organizationId,
            originatingProjectId: defaultProjectId,
            creatorType: null as string | null,
            reasoning: null as string | null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        (
          mockPrismaService.db.initiative.findMany as jest.Mock
        ).mockResolvedValue(mockInitiatives);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockResolvedValue(
          createInitiativeSectionRecords('initiative-1' as InitiativeId, {
            description: 'Description text',
            details: 'These should be hidden',
            acceptanceCriteria: 'These should be hidden',
          }),
        );

        const result = await service.findAllForAdapter(organizationId, filters);

        const [initiative] = result;
        if (!initiative) {
          throw new Error('Expected initiative result');
        }
        const content = materializedSectionsToContentMap(initiative.sections);
        expect(content.details).toBe(''); // Should be null for RefiningDescription status
        expect(content.acceptanceCriteria).toBe(''); // Should be null for RefiningDescription status
      });
    });

    describe('findByIdForAdapter', () => {
      it('should return transformed initiative when found', async () => {
        const mockInitiative = {
          id: initiativeId,
          name: 'Test Initiative',
          assigneeId: null as string | null,
          status: WorkStatus.RefiningDescription,
          priority: Priority.Low,
          dueDate: null as Date | null,
          tags: ['test'],
          organizationId,
          originatingProjectId: defaultProjectId,
          creatorType: null as string | null,
          reasoning: null as string | null,
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01'),
        };

        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(mockInitiative);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockResolvedValue(
          createInitiativeSectionRecords(initiativeId, {
            description: 'Test description',
          }),
        );

        const result = await service.findByIdForAdapter(
          initiativeId,
          organizationId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            id: initiativeId,
            name: 'Test Initiative',
            status: WorkStatus.RefiningDescription,
          }),
        );
        const content = materializedSectionsToContentMap(result?.sections);
        expect(content.description).toBe('Test description');
      });

      it('should return null when initiative not found', async () => {
        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(null);

        const result = await service.findByIdForAdapter(
          'nonexistent-id',
          organizationId,
        );

        expect(result).toBeNull();
      });
    });

    describe('findByConversationForAdapter', () => {
      it('should return transformed initiatives for conversation', async () => {
        const conversationId = 'conv-123';
        const mockInitiatives = [
          {
            id: 'initiative-1',
            name: 'Initiative 1',
            assigneeId: null as string | null,
            status: WorkStatus.Active,
            priority: Priority.High,
            dueDate: null as Date | null,
            tags: [] as string[],
            organizationId,
            sourceConversationId: conversationId,
            originatingProjectId: defaultProjectId,
            creatorType: null as string | null,
            reasoning: null as string | null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'initiative-2',
            name: 'Initiative 2',
            assigneeId: null as string | null,
            status: WorkStatus.RefiningDescription,
            priority: Priority.Medium,
            dueDate: null as Date | null,
            tags: [] as string[],
            organizationId,
            sourceConversationId: conversationId,
            originatingProjectId: defaultProjectId,
            creatorType: null as string | null,
            reasoning: null as string | null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        (
          mockPrismaService.db.initiative.findMany as jest.Mock
        ).mockResolvedValue(mockInitiatives);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockResolvedValue([
          ...createInitiativeSectionRecords('initiative-1' as InitiativeId, {
            description: 'Description 1',
          }),
          ...createInitiativeSectionRecords('initiative-2' as InitiativeId, {
            description: 'Description 2',
          }),
        ]);

        const result = await service.findByConversationForAdapter(
          conversationId,
          organizationId,
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(
          expect.objectContaining({
            id: 'initiative-1',
            name: 'Initiative 1',
            status: WorkStatus.Active,
          }),
        );
        expect(result[1]).toEqual(
          expect.objectContaining({
            id: 'initiative-2',
            name: 'Initiative 2',
            status: WorkStatus.RefiningDescription,
          }),
        );
      });

      it('should return empty array when no initiatives found for conversation', async () => {
        (
          mockPrismaService.db.initiative.findMany as jest.Mock
        ).mockResolvedValue([]);

        const result = await service.findByConversationForAdapter(
          'conv-nonexistent',
          organizationId,
        );

        expect(result).toEqual([]);
      });
    });

    describe('updateForAdapter', () => {
      it('should update and transform initiative successfully', async () => {
        const updateDto = {
          name: 'Updated Name',
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'Updated Description',
          }).filter((section) => section.key === 'description'),
          status: WorkStatus.Active,
          priority: Priority.Critical,
        };

        const existingInitiative = {
          id: initiativeId,
          name: 'Old Name',
          organizationId,
          status: WorkStatus.RefiningDescription,
          priority: Priority.Low,
          createdAt: new Date(),
          assigneeId: null as string | null,
          dueDate: null as Date | null,
          tags: [] as string[],
          creatorType: null as string | null,
          reasoning: null as string | null,
          originatingProjectId: defaultProjectId,
        };

        const updatedInitiative = {
          ...existingInitiative,
          name: updateDto.name,
          status: updateDto.status,
          priority: updateDto.priority,
          updatedAt: new Date(),
        };

        // Mock the transaction
        const mockTransaction = {
          initiative: {
            update: jest.fn().mockResolvedValue(updatedInitiative),
          },
        };

        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(existingInitiative);
        (
          mockPrismaService.db.initiative.findUnique as jest.Mock
        ).mockResolvedValue(updatedInitiative);
        mockPrismaService.db.$transaction = jest
          .fn()
          .mockImplementation((callback) => callback(mockTransaction));
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockImplementation(
          (args?: { where?: { key?: { in?: string[] } } }) => {
            const rows = createInitiativeSectionRecords(initiativeId, {
              description: 'Updated Description',
            });
            const keys = args?.where?.key?.in;
            return keys?.length
              ? rows.filter((section) => keys.includes(section.key))
              : rows;
          },
        );

        const result = await service.updateForAdapter(
          initiativeId,
          updateDto,
          organizationId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            id: initiativeId,
            name: 'Updated Name',
            status: WorkStatus.Active,
            priority: Priority.Critical,
          }),
        );
        const content = materializedSectionsToContentMap(result.sections);
        expect(content.description).toBe('Updated Description');

        expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(
          3,
        );
      });

      it('should treat sectionUpdateSource as control metadata for section-only updates', async () => {
        const updateDto = {
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'Updated Description',
          }).filter((section) => section.key === 'description'),
          sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
        };

        const expectedResponse = TestUtils.createMockInitiative({
          id: initiativeId,
          organizationId,
          originatingProjectId: defaultProjectId,
          sections: TestUtils.createMockMaterializedWorkItemSections({
            description: 'Updated Description',
          }),
        });

        const applySectionUpdatesSpy = jest
          .spyOn(service, 'applySectionUpdates')
          .mockResolvedValue(expectedResponse);
        const updateSpy = jest.spyOn(service, 'update');

        const result = await service.updateForAdapter(
          initiativeId,
          updateDto,
          organizationId,
        );

        expect(applySectionUpdatesSpy).toHaveBeenCalledWith(
          organizationId,
          initiativeId,
          [{ key: 'description', content: 'Updated Description' }],
          {
            sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
          },
        );
        expect(updateSpy).not.toHaveBeenCalled();
        expect(result).toBe(expectedResponse);
      });

      it('should update ORIGINAL_INITIATIVE for agent-suggested hidden section refreshes', async () => {
        const updatedDescription = 'Updated Description';
        const updatedDetails = 'Updated Details';
        const updatedAcceptanceCriteria = 'Updated Acceptance Criteria';

        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue({
          id: initiativeId,
          status: WorkStatus.RefiningDescription,
          originatingProjectId: defaultProjectId,
        });
        (
          mockPrismaService.db.initiative.findUnique as jest.Mock
        ).mockResolvedValue(
          TestUtils.createMockInitiative({
            id: initiativeId,
            organizationId,
            status: WorkStatus.RefiningDescription,
            originatingProjectId: defaultProjectId,
            sections: TestUtils.createMockMaterializedWorkItemSections({
              description: updatedDescription,
              details: updatedDetails,
              acceptanceCriteria: updatedAcceptanceCriteria,
            }),
          }),
        );
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockImplementation(
          (args?: { where?: { key?: { in?: string[] } } }) => {
            const rows = createInitiativeSectionRecords(initiativeId, {
              description: updatedDescription,
              details: updatedDetails,
              acceptanceCriteria: updatedAcceptanceCriteria,
            });
            const keys = args?.where?.key?.in;
            return keys?.length
              ? rows.filter((section) => keys.includes(section.key))
              : rows;
          },
        );

        const result = await service.applySectionUpdates(
          organizationId,
          initiativeId,
          [
            { key: 'description', content: updatedDescription },
            { key: 'details', content: updatedDetails },
            { key: 'acceptanceCriteria', content: updatedAcceptanceCriteria },
          ],
          {
            sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested,
          },
        );

        expect(
          mockInitiativeArtifactService.updateOriginalArtifactFields,
        ).toHaveBeenCalledWith(initiativeId, organizationId, {
          description: updatedDescription,
          details: updatedDetails,
          acceptanceCriteria: updatedAcceptanceCriteria,
        });
        expect(result.id).toBe(initiativeId);
      });

      it('should throw NotFoundException when initiative not found', async () => {
        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(null);

        await expect(
          service.updateForAdapter(
            'nonexistent-id' as InitiativeId,
            { name: 'Updated' },
            organizationId,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('removeForAdapter', () => {
      it('should remove and transform initiative successfully', async () => {
        const existingInitiative = {
          id: initiativeId,
          name: 'Test Initiative',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null as Date | null,
          assigneeId: null as string | null,
          dueDate: null as Date | null,
          tags: [] as string[],
          creatorType: null as string | null,
          reasoning: null as string | null,
          originatingProjectId: defaultProjectId,
        };

        const archivedInitiative = {
          ...existingInitiative,
          archivedAt: new Date(),
        };

        // Mock the transaction
        const mockTransaction = {
          initiative: {
            update: jest.fn().mockResolvedValue(archivedInitiative),
          },
        };

        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(existingInitiative);
        mockPrismaService.$transaction = jest
          .fn()
          .mockImplementation((callback) => callback(mockTransaction));
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockResolvedValue(
          createInitiativeSectionRecords(initiativeId, {
            description: 'Test Description',
          }),
        );

        const result = await service.removeForAdapter(
          initiativeId,
          organizationId,
        );

        expect(result).toEqual(
          expect.objectContaining({
            id: initiativeId,
            name: 'Test Initiative',
            status: WorkStatus.Active,
          }),
        );
        const content = materializedSectionsToContentMap(result.sections);
        expect(content.description).toBe('Test Description');

        expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(
          1,
        );
      });

      it('should throw NotFoundException when initiative not found', async () => {
        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue(null);

        await expect(
          service.removeForAdapter('nonexistent-id', organizationId),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('refinement workflow methods', () => {
    describe('getActiveRefinementConversation', () => {
      it('should return conversation ID when active refinement conversation exists', async () => {
        const mockConversation = {
          id: 'conv-123',
          category: 'initiative_refinement',
          status: 'IN_PROGRESS',
          project: {
            organizationId,
          },
        };

        // Mock the findMany call that happens first for debugging
        (
          mockPrismaService.db.conversation.findMany as jest.Mock
        ).mockResolvedValue([mockConversation]);

        // Mock the findFirst call that actually finds the active conversation
        (
          mockPrismaService.db.conversation.findFirst as jest.Mock
        ).mockResolvedValue(mockConversation);

        const result = await service.getActiveRefinementConversation(
          initiativeId,
          organizationId,
        );

        expect(
          mockPrismaService.db.conversation.findFirst,
        ).toHaveBeenCalledWith({
          where: {
            workflowAboutId: initiativeId,
            workflowName: 'initiative-refinement',
            organizationId,
          },
          select: {
            id: true,
            status: true,
            title: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });

        expect(result).toBe('conv-123');
      });

      it('should return null when no active refinement conversation exists', async () => {
        // Mock the findMany call that happens first for debugging
        (
          mockPrismaService.db.conversation.findMany as jest.Mock
        ).mockResolvedValue([]);

        // Mock the findFirst call that returns null
        (
          mockPrismaService.db.conversation.findFirst as jest.Mock
        ).mockResolvedValue(null);

        const result = await service.getActiveRefinementConversation(
          initiativeId,
          organizationId,
        );

        expect(result).toBeNull();
      });
    });

    describe('clearActiveRefinementConversation', () => {
      it('should close active refinement conversations', async () => {
        const mockConversations = [{ id: 'conv-1' }, { id: 'conv-2' }];

        mockPrismaService.db.conversation.findMany = jest
          .fn()
          .mockResolvedValue(mockConversations);
        mockPrismaService.db.conversation.update = jest
          .fn()
          .mockResolvedValue({});

        await service.clearActiveRefinementConversation(
          initiativeId,
          organizationId,
        );

        expect(mockPrismaService.db.conversation.findMany).toHaveBeenCalledWith(
          {
            where: {
              workflowAboutId: initiativeId,
              workflowName: 'initiative-refinement',
              organizationId,
              status: {
                in: ['STARTED', 'IN_PROGRESS', 'GENERATING_RESPONSE'],
              },
            },
            select: { id: true },
            take: 20,
            orderBy: { createdAt: 'desc' },
          },
        );

        // Should first do bulk status update
        expect(
          mockPrismaService.db.conversation.updateMany,
        ).toHaveBeenCalledWith({
          where: {
            id: { in: ['conv-1', 'conv-2'] },
          },
          data: {
            status: 'COMPLETED',
            updatedAt: expect.any(Date),
          },
        });

        // Then do individual version updates (for small batches <= 10)
        expect(mockPrismaService.db.conversation.update).toHaveBeenCalledTimes(
          2,
        );
        expect(
          mockPrismaService.db.conversation.update,
        ).toHaveBeenNthCalledWith(1, {
          where: { id: 'conv-1' },
          data: {
            version: { increment: 1 },
          },
        });
        expect(
          mockPrismaService.db.conversation.update,
        ).toHaveBeenNthCalledWith(2, {
          where: { id: 'conv-2' },
          data: {
            version: { increment: 1 },
          },
        });
      });

      it('should handle case when no active conversations exist', async () => {
        mockPrismaService.db.conversation.findMany = jest
          .fn()
          .mockResolvedValue([]);
        mockPrismaService.db.conversation.update = jest.fn();

        await service.clearActiveRefinementConversation(
          initiativeId,
          organizationId,
        );

        expect(mockPrismaService.db.conversation.update).not.toHaveBeenCalled();
      });
    });

    describe('applyRefinementChanges', () => {
      it('should apply changes and publish event successfully', async () => {
        const changes = {
          name: 'Refined Name',
          description: 'Refined Description',
          details: 'Refined Details',
          priority: Priority.High,
          tags: ['refined', 'updated'],
        };

        const updatedInitiative = {
          id: initiativeId,
          name: 'Refined Name',
          assigneeId: null as string | null,
          status: WorkStatus.Active,
          priority: Priority.High,
          dueDate: null as Date | null,
          tags: ['refined', 'updated'],
          organizationId,
          creatorType: null as string | null,
          reasoning: null as string | null,
          originatingProjectId: defaultProjectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        (mockPrismaService.db.initiative.update as jest.Mock).mockResolvedValue(
          updatedInitiative,
        );
        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue({
          id: initiativeId,
          originatingProjectId: defaultProjectId,
        });
        (
          mockPrismaService.db.initiative.findUnique as jest.Mock
        ).mockResolvedValue(updatedInitiative);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockImplementation(
          (args?: { where?: { key?: { in?: string[] } } }) => {
            const rows = createInitiativeSectionRecords(initiativeId, {
              description: 'Refined Description',
              details: 'Refined Details',
            });
            const keys = args?.where?.key?.in;
            return keys?.length
              ? rows.filter((section) => keys.includes(section.key))
              : rows;
          },
        );

        const result = await service.applyRefinementChanges(
          initiativeId,
          changes,
          organizationId,
        );

        expect(mockPrismaService.db.initiative.update).toHaveBeenCalledWith({
          where: {
            id: initiativeId,
            organizationId,
          },
          data: {
            name: 'Refined Name',
            priority: Priority.High,
            tags: ['refined', 'updated'],
            updatedAt: expect.any(Date),
          },
        });

        expect(mockEventPublisher.publish).toHaveBeenCalledWith({
          type: expect.stringContaining('initiative.updated'),
          aggregateId: initiativeId,
          payload: expect.objectContaining({
            organizationId,
            projectId: defaultProjectId,
            originatingProjectId: defaultProjectId,
            linkedProjectIds: [],
          }),
        });

        expect(result).toEqual(
          expect.objectContaining({
            id: initiativeId,
            name: 'Refined Name',
            priority: Priority.High,
          }),
        );
        const content = materializedSectionsToContentMap(result.sections);
        expect(content.description).toBe('Refined Description');
        expect(content.details).toBe('Refined Details');
      });

      it('should throw NotFoundException when initiative not found', async () => {
        (mockPrismaService.db.initiative.update as jest.Mock).mockResolvedValue(
          null,
        );

        await expect(
          service.applyRefinementChanges(
            'nonexistent-id' as InitiativeId,
            { name: 'Updated' },
            organizationId,
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('should handle partial updates correctly', async () => {
        const changes = {
          description: 'Only description updated',
        };

        const updatedInitiative = {
          id: initiativeId,
          name: 'Existing Name',
          assigneeId: null as string | null,
          status: WorkStatus.RefiningDescription,
          priority: Priority.Medium,
          dueDate: null as Date | null,
          tags: [] as string[],
          organizationId,
          creatorType: null as string | null,
          reasoning: null as string | null,
          originatingProjectId: defaultProjectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        (mockPrismaService.db.initiative.update as jest.Mock).mockResolvedValue(
          updatedInitiative,
        );
        (
          mockPrismaService.db.initiative.findFirst as jest.Mock
        ).mockResolvedValue({
          id: initiativeId,
          originatingProjectId: defaultProjectId,
        });
        (
          mockPrismaService.db.initiative.findUnique as jest.Mock
        ).mockResolvedValue(updatedInitiative);
        (
          mockPrismaService.db.initiativeSection.findMany as jest.Mock
        ).mockImplementation(
          (args?: { where?: { key?: { in?: string[] } } }) => {
            const rows = createInitiativeSectionRecords(initiativeId, {
              description: 'Only description updated',
            });
            const keys = args?.where?.key?.in;
            return keys?.length
              ? rows.filter((section) => keys.includes(section.key))
              : rows;
          },
        );

        const result = await service.applyRefinementChanges(
          initiativeId,
          changes,
          organizationId,
        );

        expect(mockPrismaService.db.initiative.update).toHaveBeenCalledWith({
          where: {
            id: initiativeId,
            organizationId,
          },
          data: {
            updatedAt: expect.any(Date),
          },
        });

        const content = materializedSectionsToContentMap(result.sections);
        expect(content.description).toBe('Only description updated');
      });
    });
  });

  describe('EntityRegistry Integration', () => {
    it('registers via events (handled by lifecycle processor) – no direct calls', () => {
      expect(true).toBe(true);
    });
  });
});
