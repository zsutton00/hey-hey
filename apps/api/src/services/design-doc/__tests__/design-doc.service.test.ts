import { DesignDocParentEntityType, Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DesignDocService } from '../design-doc.service';
import { PlanDesignDocLinksService } from '../plan-design-doc-links.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateDesignDocDto,
  DesignDocSectionUpdateSource,
  UpdateDesignDocDto,
} from '../../../generated';
import { CreateDesignDocLinkDto } from '../../../generated/model/createDesignDocLinkDto';
import {
  DesignDocSectionRecord,
  DesignDocWithSectionsRecord,
} from '../../../types/design-doc.types';
import { OrganizationId } from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { ArchiveOrchestrationService } from '../../archive-orchestration/archive-orchestration.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { RedisService } from '../../../core/redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';

type DomainEventPublisherMock = jest.Mocked<
  Pick<DomainEventPublisher, 'publish' | 'publishInTransaction'>
>;
type ArchiveOrchestrationServiceMock = jest.Mocked<
  Pick<
    ArchiveOrchestrationService,
    'archiveDesignDocDependencies' | 'restoreDesignDocDependencies'
  >
>;
type MockPrismaService = ReturnType<typeof TestUtils.createMockPrismaService>;

const mockSections: DesignDocSectionRecord[] = [
  {
    id: 'section-context',
    key: 'context',
    order: 0,
    materializedMarkdown: 'Context section',
  },
  {
    id: 'section-decision',
    key: 'decision',
    order: 1,
    materializedMarkdown: 'Decision section',
  },
  {
    id: 'section-consequences',
    key: 'consequences',
    order: 2,
    materializedMarkdown: 'Consequences section',
  },
  {
    id: 'section-status',
    key: 'statusNotes',
    order: 3,
    materializedMarkdown: 'Status notes',
  },
];

describe('DesignDocService (template sections)', () => {
  let planDesignDocLinks: { resolve: jest.Mock };
  let service: DesignDocService;
  let prismaService: MockPrismaService;
  let eventPublisher: DomainEventPublisherMock;
  let archiveOrchestrationService: ArchiveOrchestrationServiceMock;
  const organizationId = TestUtils.testIds.organization;

  beforeEach(async () => {
    prismaService = TestUtils.createMockPrismaService();
    prismaService.$transaction.mockImplementation(async (callback) =>
      callback(prismaService.db as unknown as Prisma.TransactionClient),
    );
    prismaService.db.designDocSectionUpdate.findMany.mockResolvedValue([]);
    eventPublisher =
      TestUtils.createMockDomainEventPublisher() as DomainEventPublisherMock;
    archiveOrchestrationService = {
      archiveDesignDocDependencies: jest.fn(),
      restoreDesignDocDependencies: jest.fn(),
    };
    const redisProvider = createRedisServiceMock();
    planDesignDocLinks = { resolve: jest.fn().mockResolvedValue([]) };

    const setup = await createServiceTestingModule({
      providers: [
        DesignDocService,
        PrismaService,
        ArchiveOrchestrationService,
        RedisService,
      ],
      overrides: [[PrismaService, prismaService],
[PlanDesignDocLinksService, planDesignDocLinks],
[DOMAIN_EVENT_PUBLISHER_TOKEN, eventPublisher],
[ArchiveOrchestrationService, archiveOrchestrationService],
[RedisService, redisProvider.useValue]],
    });

    service = setup.module.get(DesignDocService);
    archiveOrchestrationService = setup.module.get(ArchiveOrchestrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('persists an explicit identity when created inside a grouped transaction', async () => {
      const reservedDesignDocId =
        '123e4567-e89b-42d3-a456-426614174250' as typeof TestUtils.testIds.designDoc;
      const dto: CreateDesignDocDto & { organizationId: OrganizationId } = {
        name: 'Reserved Doc',
        template: 'ADR',
        organizationId,
        projectId: TestUtils.testIds.project,
      };
      prismaService.db.designDoc.create.mockResolvedValue({
        id: reservedDesignDocId,
        name: dto.name,
        template: 'ADR',
        status: 'ADR_CONTEXT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      });

      const result = await service.createInTransaction(
        prismaService.db as unknown as Prisma.TransactionClient,
        dto,
        reservedDesignDocId,
      );

      expect(prismaService.db.designDoc.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id: reservedDesignDocId }),
        }),
      );
      expect(result.id).toBe(reservedDesignDocId);
    });

    it('creates a design doc using default ADR sections when none provided', async () => {
      const dto: CreateDesignDocDto & { organizationId: OrganizationId } = {
        name: 'New Doc',
        template: 'ADR',
        organizationId,
      };

      prismaService.db.designDoc.create.mockResolvedValue({
        id: TestUtils.testIds.designDoc,
        name: dto.name,
        template: 'ADR',
        status: 'ADR_CONTEXT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      });

      await service.create(dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.db.designDoc.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Doc',
          template: 'ADR',
          status: 'ADR_CONTEXT',
          sections: {
            create: expect.arrayContaining([
              expect.objectContaining({ key: 'context' }),
              expect.objectContaining({ key: 'decision' }),
              expect.objectContaining({ key: 'consequences' }),
              expect.objectContaining({ key: 'statusNotes' }),
            ]),
          },
        }),
        include: {
          sections: expect.objectContaining({
            orderBy: { order: 'asc' },
            select: expect.objectContaining({
              id: true,
              key: true,
              order: true,
              materializedMarkdown: true,
            }),
          }),
        },
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.CREATED,
          aggregateId: TestUtils.testIds.designDoc,
          payload: expect.objectContaining({
            organizationId,
            projectId: TestUtils.testIds.project,
            designDoc: expect.objectContaining({
              id: TestUtils.testIds.designDoc,
              name: 'New Doc',
            }),
          }),
        }),
      );
    });

    it('uses provided sections verbatim when supplied', async () => {
      const dto: CreateDesignDocDto & { organizationId: OrganizationId } = {
        name: 'ADR Doc',
        organizationId,
        template: 'ADR',
        sections: [
          { key: 'context', order: 0, content: 'context' },
          { key: 'decision', order: 1, content: 'decision' },
        ],
      };

      const sections = dto.sections ?? [];
      const createdSections: DesignDocSectionRecord[] = sections.map(
        (section, index) => ({
          id: `section-${section.key}`,
          key: section.key,
          order: index,
          materializedMarkdown: section.content ?? '',
        }),
      );

      prismaService.db.designDoc.create.mockResolvedValue({
        id: TestUtils.testIds.designDoc,
        name: dto.name,
        template: 'ADR',
        status: 'draft',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: createdSections,
      });

      await service.create(dto);

      expect(prismaService.db.designDoc.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          template: 'ADR',
          sections: {
            create: [
              expect.objectContaining({
                key: 'context',
                order: 0,
                materializedMarkdown: 'context',
              }),
              expect.objectContaining({
                key: 'decision',
                order: 1,
                materializedMarkdown: 'decision',
              }),
            ],
          },
        }),
        include: {
          sections: expect.objectContaining({
            orderBy: { order: 'asc' },
            select: expect.objectContaining({
              id: true,
              key: true,
              order: true,
              materializedMarkdown: true,
            }),
          }),
        },
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.CREATED,
          payload: expect.objectContaining({
            projectId: TestUtils.testIds.project,
            designDoc: expect.objectContaining({
              sections: expect.arrayContaining([
                expect.objectContaining({ key: 'context' }),
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('finds a Feature-owned seed via the migrated Plan graph link without a legacy Plan row', async () => {
      prismaService.db.task.findFirst.mockResolvedValue({
        projectId: TestUtils.testIds.project,
      });
      planDesignDocLinks.resolve.mockResolvedValue(['doc-1']);
      prismaService.db.designDoc.findMany.mockResolvedValue([
        { ...baseDoc, parentEntityType: 'TASK', parentEntityId: 'feature' },
      ]);
      const result = await service.findAll(organizationId, {
        projectId: TestUtils.testIds.project,
        planId: 'plan-1',
      });
      expect(result.map((doc) => doc.id)).toEqual(['doc-1']);
      expect(planDesignDocLinks.resolve).toHaveBeenCalledWith(
        organizationId,
        TestUtils.testIds.project,
        'plan-1',
      );
      expect(prismaService.db.planRelationship.findMany).not.toHaveBeenCalled();
      expect(prismaService.db.designDoc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['doc-1'] },
            organizationId,
            projectId: TestUtils.testIds.project,
          }),
        }),
      );
    });
    const baseDoc: DesignDocWithSectionsRecord = {
      id: 'doc-1',
      name: 'Linked Doc',
      template: 'ADR',
      status: 'ADR_CONTEXT',
      organizationId,
      projectId: TestUtils.testIds.project,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      summary: null,
      parentEntityId: null,
      parentEntityType: null,
      sections: [],
    };

    it('throws when multiple link filters are provided', async () => {
      await expect(
        service.findAll(organizationId, {
          taskId: 'task-1',
          planId: 'plan-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('filters design docs whose parent is a task', async () => {
      prismaService.db.designDoc.findMany.mockResolvedValue([baseDoc]);

      const result = await service.findAll(organizationId, {
        taskId: 'task-1',
      });

      expect(prismaService.db.designDoc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentEntityType: 'TASK',
            parentEntityId: 'task-1',
            organizationId,
            archivedAt: null,
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(baseDoc.id);
    });

    it('filters design docs whose parent is a design doc', async () => {
      prismaService.db.designDoc.findMany.mockResolvedValue([
        { ...baseDoc, id: 'doc-2' },
      ]);

      const result = await service.findAll(organizationId, {
        designDocId: 'doc-1',
      });

      expect(prismaService.db.designDoc.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentEntityType: 'DESIGN_DOC',
            parentEntityId: 'doc-1',
            organizationId,
            archivedAt: null,
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('doc-2');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when document missing', async () => {
      prismaService.db.designDoc.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'Updated' }, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('publishes status changed event when status updates', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
      prismaService.db.designDoc.update.mockResolvedValue({
        ...existing,
        status: 'READY',
        updatedAt: new Date(),
      });

      await service.update(
        TestUtils.testIds.designDoc,
        { status: 'READY' } as UpdateDesignDocDto,
        organizationId,
      );

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED,
          aggregateId: TestUtils.testIds.designDoc,
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED,
            organizationId,
            projectId: TestUtils.testIds.project,
            previousStatus: 'DRAFT_CONCEPT',
            newStatus: 'READY',
          }),
        }),
      );
    });

    it('publishes metadata-only design_doc.updated payloads', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
      prismaService.db.designDoc.update.mockResolvedValue({
        ...existing,
        name: 'Renamed',
        updatedAt: new Date(),
      });

      await service.update(
        TestUtils.testIds.designDoc,
        { name: 'Renamed' } as UpdateDesignDocDto,
        organizationId,
      );

      const updatedEventCall =
        eventPublisher.publishInTransaction.mock.calls.find(
          ([, event]) =>
            (event as { type?: string })?.type ===
            EVENT_TYPES.DESIGN_DOC.UPDATED,
        )?.[1] as
          | { payload?: { designDoc?: { sections?: unknown } } }
          | undefined;

      expect(updatedEventCall).toBeDefined();
      expect(updatedEventCall?.payload?.designDoc?.sections).toBeUndefined();
    });

    it('ignores sectionUpdateSource when no metadata fields are updated', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);

      const result = await service.update(
        TestUtils.testIds.designDoc,
        {
          sectionUpdateSource: DesignDocSectionUpdateSource.AgentSuggested,
        } as UpdateDesignDocDto,
        organizationId,
      );

      expect(prismaService.db.designDoc.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
      expect(result.id).toBe(TestUtils.testIds.designDoc);
    });

    it('persists section updates from PATCH payload and emits content changed', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
      prismaService.db.designDocSection.findMany.mockResolvedValue([
        { id: 'section-context', key: 'context' },
      ]);

      await service.update(
        TestUtils.testIds.designDoc,
        {
          sections: [
            {
              key: 'context',
              content: 'Updated context section',
            },
          ],
        } as UpdateDesignDocDto,
        organizationId,
      );

      expect(prismaService.db.designDocSection.update).toHaveBeenCalledWith({
        where: { id: 'section-context' },
        data: {
          materializedMarkdown: 'Updated context section',
        },
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
          aggregateId: TestUtils.testIds.designDoc,
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
            organizationId,
            projectId: TestUtils.testIds.project,
          }),
        }),
      );
    });

    describe('parent reassignment', () => {
      const buildExistingDoc = (
        overrides: Partial<DesignDocWithSectionsRecord> = {},
      ): DesignDocWithSectionsRecord => ({
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
        ...overrides,
      });

      const targetTaskId = '123e4567-e89b-42d3-a456-426614174777';
      const targetDocId = '123e4567-e89b-42d3-a456-426614174888';

      it('persists the new parent when reparenting to a task and emits one DESIGN_DOC.UPDATED event', async () => {
        const existing = buildExistingDoc();
        prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
        prismaService.db.task.findFirst.mockResolvedValueOnce({
          id: targetTaskId,
        });
        prismaService.db.designDoc.update.mockResolvedValue({
          ...existing,
          parentEntityId: targetTaskId,
          parentEntityType: DesignDocParentEntityType.TASK,
          updatedAt: new Date(),
        });

        await service.update(
          TestUtils.testIds.designDoc,
          {
            parentEntityId: targetTaskId,
            parentEntityType: DesignDocParentEntityType.TASK,
          } as UpdateDesignDocDto,
          organizationId,
        );

        expect(prismaService.db.designDoc.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: TestUtils.testIds.designDoc },
            data: expect.objectContaining({
              parentEntityId: targetTaskId,
              parentEntityType: DesignDocParentEntityType.TASK,
            }),
          }),
        );

        const updatedEvents =
          eventPublisher.publishInTransaction.mock.calls.filter(
            ([, event]) =>
              (event as { type?: string })?.type ===
              EVENT_TYPES.DESIGN_DOC.UPDATED,
          );
        expect(updatedEvents).toHaveLength(1);
        const payload = updatedEvents[0]![1] as {
          payload: {
            designDoc: { parentEntityId?: string; parentEntityType?: string };
          };
        };
        expect(payload.payload.designDoc.parentEntityId).toBe(targetTaskId);
        expect(payload.payload.designDoc.parentEntityType).toBe(
          DesignDocParentEntityType.TASK,
        );
      });

      it('persists the new parent when reparenting to a design doc with no ancestors', async () => {
        const existing = buildExistingDoc();
        prismaService.db.designDoc.findFirst
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce({
            id: targetDocId,
            parentEntityId: null,
            parentEntityType: null,
          });
        prismaService.db.designDoc.update.mockResolvedValue({
          ...existing,
          parentEntityId: targetDocId,
          parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
          updatedAt: new Date(),
        });

        await service.update(
          TestUtils.testIds.designDoc,
          {
            parentEntityId: targetDocId,
            parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
          } as UpdateDesignDocDto,
          organizationId,
        );

        expect(prismaService.db.designDoc.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              parentEntityId: targetDocId,
              parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
            }),
          }),
        );
      });

      it('rejects an unpaired parentEntityId with BadRequestException', async () => {
        await expect(
          service.update(
            TestUtils.testIds.designDoc,
            { parentEntityId: targetTaskId } as UpdateDesignDocDto,
            organizationId,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'parentEntityId and parentEntityType must be provided together',
          ),
        );
        expect(prismaService.db.designDoc.update).not.toHaveBeenCalled();
      });

      it('rejects an unsupported parentEntityType with BadRequestException', async () => {
        await expect(
          service.update(
            TestUtils.testIds.designDoc,
            {
              parentEntityId: targetTaskId,
              parentEntityType:
                'INITIATIVE' as unknown as DesignDocParentEntityType,
            } as UpdateDesignDocDto,
            organizationId,
          ),
        ).rejects.toThrow(
          new BadRequestException('Unsupported parentEntityType: INITIATIVE'),
        );
      });

      it('rejects parenting a design doc to itself with BadRequestException', async () => {
        const existing = buildExistingDoc();
        prismaService.db.designDoc.findFirst.mockResolvedValue(existing);

        await expect(
          service.update(
            TestUtils.testIds.designDoc,
            {
              parentEntityId: TestUtils.testIds.designDoc,
              parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
            } as UpdateDesignDocDto,
            organizationId,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'Design document cannot be parented to itself',
          ),
        );
        expect(prismaService.db.designDoc.update).not.toHaveBeenCalled();
      });

      it('rejects reparenting to a descendant design doc with BadRequestException', async () => {
        const existing = buildExistingDoc();
        const descendantId = '123e4567-e89b-42d3-a456-426614174999';
        prismaService.db.designDoc.findFirst
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce({
            id: descendantId,
            parentEntityId: TestUtils.testIds.designDoc,
            parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
          });

        await expect(
          service.update(
            TestUtils.testIds.designDoc,
            {
              parentEntityId: descendantId,
              parentEntityType: DesignDocParentEntityType.DESIGN_DOC,
            } as UpdateDesignDocDto,
            organizationId,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'Cannot reparent design document to one of its own descendants',
          ),
        );
        expect(prismaService.db.designDoc.update).not.toHaveBeenCalled();
      });

      it('rejects when the proposed parent does not exist with NotFoundException', async () => {
        const existing = buildExistingDoc();
        prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
        prismaService.db.task.findFirst.mockResolvedValueOnce(null);

        await expect(
          service.update(
            TestUtils.testIds.designDoc,
            {
              parentEntityId: targetTaskId,
              parentEntityType: DesignDocParentEntityType.TASK,
            } as UpdateDesignDocDto,
            organizationId,
          ),
        ).rejects.toThrow(NotFoundException);
        expect(prismaService.db.designDoc.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove', () => {
    it('marks the document archived', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
      const archived = { ...existing, archivedAt: new Date() };
      prismaService.db.designDoc.update.mockResolvedValue(archived);

      await service.remove(TestUtils.testIds.designDoc, organizationId);

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.db.designDoc.update).toHaveBeenCalledWith({
        where: { id: TestUtils.testIds.designDoc },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
        include: {
          sections: expect.objectContaining({
            orderBy: { order: 'asc' },
            select: expect.objectContaining({
              id: true,
              key: true,
              order: true,
              materializedMarkdown: true,
            }),
          }),
        },
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
          aggregateId: TestUtils.testIds.designDoc,
          payload: expect.objectContaining({
            organizationId,
            projectId: TestUtils.testIds.project,
            designDoc: expect.objectContaining({
              id: TestUtils.testIds.designDoc,
            }),
          }),
        }),
      );

      expect(
        archiveOrchestrationService.archiveDesignDocDependencies,
      ).toHaveBeenCalledWith({
        designDocId: TestUtils.testIds.designDoc,
        organizationId,
      });
    });
  });

  describe('restore', () => {
    it('restores an archived document', async () => {
      const existing: DesignDocWithSectionsRecord = {
        id: TestUtils.testIds.designDoc,
        name: 'Existing',
        template: 'CLASSIC',
        status: 'DRAFT_CONCEPT',
        organizationId,
        projectId: TestUtils.testIds.project,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: new Date(),
        summary: null,
        parentEntityId: null,
        parentEntityType: null,
        sections: mockSections,
      };

      prismaService.db.designDoc.findFirst.mockResolvedValue(existing);
      const restored: DesignDocWithSectionsRecord = {
        ...existing,
        archivedAt: null,
      };
      prismaService.db.designDoc.update.mockResolvedValue(restored);

      await service.restore(TestUtils.testIds.designDoc, organizationId);

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.db.designDoc.update).toHaveBeenCalledWith({
        where: { id: TestUtils.testIds.designDoc },
        data: expect.objectContaining({ archivedAt: null }),
        include: expect.any(Object),
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.DESIGN_DOC.RESTORED,
          aggregateId: TestUtils.testIds.designDoc,
        }),
      );

      expect(
        archiveOrchestrationService.restoreDesignDocDependencies,
      ).toHaveBeenCalledWith({
        designDocId: TestUtils.testIds.designDoc,
        organizationId,
      });
    });
  });

  describe('applySectionUpdates', () => {
    beforeEach(() => {
      prismaService.db.designDoc.findFirst
        .mockResolvedValueOnce({
          id: TestUtils.testIds.designDoc,
        })
        .mockResolvedValue({
          id: TestUtils.testIds.designDoc,
          name: 'Existing',
          template: 'CLASSIC',
          status: 'DRAFT_CONCEPT',
          organizationId,
          projectId: TestUtils.testIds.project,
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null,
          summary: null,
          parentEntityId: null,
          parentEntityType: null,
          sections: mockSections,
        });
    });

    it('updates snapshot content for matching sections', async () => {
      prismaService.db.designDocSection.findMany.mockResolvedValue([
        { id: 'section-decision', key: 'decision' },
      ]);

      await service.applySectionUpdates(
        TestUtils.testIds.designDoc,
        organizationId,
        [{ key: 'decision', content: 'Generated decision content' }],
      );

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.db.designDocSection.update).toHaveBeenCalledWith({
        where: { id: 'section-decision' },
        data: {
          materializedMarkdown: 'Generated decision content',
        },
      });
    });

    it('throws for unknown sections', async () => {
      prismaService.db.designDocSection.findMany.mockResolvedValue([]);

      await expect(
        service.applySectionUpdates(
          TestUtils.testIds.designDoc,
          organizationId,
          [{ key: 'decision', content: 'generated' }],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('parent management', () => {
    const designDocId = TestUtils.testIds.designDoc;

    beforeEach(() => {
      prismaService.db.task.findFirst.mockResolvedValue({ id: 'task_123' });
      prismaService.db.designDoc.update.mockImplementation((args: any) =>
        Promise.resolve({
          id: designDocId,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
        }),
      );
    });

    describe('getLinks', () => {
      it('returns the single parent when set', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: 'task_123',
          parentEntityType: 'TASK',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        });
        prismaService.db.task.findFirst.mockResolvedValueOnce({
          id: 'task_123',
        });

        const result = await service.getLinks(designDocId, organizationId);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
          expect.objectContaining({
            entityType: 'task',
            entityId: 'task_123',
          }),
        );
      });

      it('returns an empty array when no parent is set', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: null,
          parentEntityType: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const result = await service.getLinks(designDocId, organizationId);

        expect(result).toEqual([]);
      });

      it('throws NotFoundException when the design doc is missing', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce(null);

        await expect(
          service.getLinks(designDocId, organizationId),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('createLinks', () => {
      it('sets the parent column when provided a single task link', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: null,
          parentEntityType: null,
        });

        const payload: CreateDesignDocLinkDto[] = [
          { entityType: 'task', entityId: 'task_123', linkType: 'context' },
        ];

        const result = await service.createLinks(
          designDocId,
          organizationId,
          payload,
        );

        expect(prismaService.db.designDoc.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: designDocId },
            data: expect.objectContaining({
              parentEntityId: 'task_123',
              parentEntityType: 'TASK',
            }),
          }),
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
          expect.objectContaining({
            entityType: 'task',
            entityId: 'task_123',
          }),
        );
      });

      it('rejects when a parent is already set', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: 'task_other',
          parentEntityType: 'TASK',
        });

        await expect(
          service.createLinks(designDocId, organizationId, [
            { entityType: 'task', entityId: 'task_123' },
          ]),
        ).rejects.toThrow(ConflictException);
      });

      it('requires at least one link', async () => {
        await expect(
          service.createLinks(designDocId, organizationId, []),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects more than one link', async () => {
        await expect(
          service.createLinks(designDocId, organizationId, [
            { entityType: 'task', entityId: 'task_123' },
            { entityType: 'design-doc', entityId: 'doc_other' },
          ]),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects unsupported entity types', async () => {
        await expect(
          service.createLinks(designDocId, organizationId, [
            { entityType: 'artifact' as any, entityId: 'art_1' },
          ]),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('removeLink', () => {
      it('clears the parent when the linkId matches', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: 'task_123',
          parentEntityType: 'TASK',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const result = await service.removeLink(
          designDocId,
          organizationId,
          `parent:${designDocId}`,
        );

        expect(prismaService.db.designDoc.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: designDocId },
            data: expect.objectContaining({
              parentEntityId: null,
              parentEntityType: null,
            }),
          }),
        );
        expect(result).toEqual(
          expect.objectContaining({ entityId: 'task_123' }),
        );
      });

      it('throws NotFoundException when no parent is set', async () => {
        prismaService.db.designDoc.findFirst.mockResolvedValueOnce({
          id: designDocId,
          parentEntityId: null,
          parentEntityType: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await expect(
          service.removeLink(
            designDocId,
            organizationId,
            `parent:${designDocId}`,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('EntityRegistry Integration', () => {
      it('should register design doc with name in EntityRegistry when created', async () => {
        const createDto: CreateDesignDocDto & {
          organizationId: OrganizationId;
        } = {
          name: 'Architecture Decision Record',
          template: 'ADR',
          organizationId,
        };

        const mockDesignDoc: DesignDocWithSectionsRecord = {
          id: TestUtils.testIds.designDoc,
          name: 'Architecture Decision Record',
          template: 'ADR',
          status: 'ADR_CONTEXT',
          organizationId,
          projectId: TestUtils.testIds.project,
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null,
          summary: null,
          parentEntityId: null,
          parentEntityType: null,
          sections: mockSections,
        };

        prismaService.db.designDoc.create.mockResolvedValue(mockDesignDoc);

        await service.create(createDto);
      });

      it('should pass transaction context to EntityRegistry during creation', async () => {
        const createDto: CreateDesignDocDto & {
          organizationId: OrganizationId;
        } = {
          name: 'Technical Design',
          template: 'ADR',
          organizationId,
        };

        const mockDesignDoc: DesignDocWithSectionsRecord = {
          id: TestUtils.testIds.designDoc,
          name: 'Technical Design',
          template: 'ADR',
          status: 'ADR_CONTEXT',
          organizationId,
          projectId: TestUtils.testIds.project,
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null,
          summary: null,
          parentEntityId: null,
          parentEntityType: null,
          sections: mockSections,
        };

        const mockTx = {
          designDoc: {
            create: jest.fn().mockResolvedValue(mockDesignDoc),
          },
        } as unknown as Prisma.TransactionClient;

        prismaService.$transaction.mockImplementation((callback) =>
          callback(mockTx),
        );

        await service.create(createDto);
      });
    });
  });
});
