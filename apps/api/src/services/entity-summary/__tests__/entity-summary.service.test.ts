import {
  SummaryCategory,
  EntityType,
  SubfacetStatus,
  type Subfacet,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import {
  isSummaryCreatedEvent,
  type ServiceEvent,
} from '../../../core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { EntitySummaryService } from '../entity-summary.service';
import { SubfacetService } from '../subfacet.service';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

const now = new Date('2024-01-01T00:00:00Z');

const getFirstCall = <T>(calls: T[] | undefined, label: string): T => {
  const firstCall = calls?.[0];
  if (!firstCall) {
    throw new Error(`Expected ${label} to have at least one call`);
  }
  return firstCall;
};

describe('EntitySummaryService', () => {
  type MockPrismaService = ReturnType<
    typeof TestUtils.createMockPrismaService
  > & {
    $transaction: jest.Mock;
  };

  type MockSubfacetService = jest.Mocked<
    Pick<SubfacetService, 'createSubfacetsWithDeduping'>
  >;

  const { testIds } = TestUtils;
  const projectId = testIds.project;
  const organizationId = testIds.organization;

  let prisma: MockPrismaService;
  let service: EntitySummaryService;
  let mockSubfacetService: MockSubfacetService;
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;

  const buildSubfacet = (overrides: Partial<Subfacet> = {}): Subfacet => ({
    id: 'sf-1',
    name: 'observability',
    slug: 'observability',
    category: SummaryCategory.technology,
    status: SubfacetStatus.ACTIVE,
    survivalCount: 0,
    lastSeenInConsolidationAt: null,
    deprecatedAt: null,
    summary: null,
    organizationId,
    projectId,
    lastSummarizedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(async () => {
    const basePrisma = TestUtils.createMockPrismaService();
    prisma = {
      ...basePrisma,
      $transaction: jest.fn(
        async (callback: (tx: typeof prisma.db) => Promise<unknown>) =>
          callback(prisma.db),
      ),
    };

    mockSubfacetService = {
      createSubfacetsWithDeduping: jest.fn(),
    };
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    const setup = await createServiceTestingModule({
      providers: [EntitySummaryService, PrismaService, SubfacetService],
      overrides: [
        [PrismaService, prisma],
        [SubfacetService, mockSubfacetService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
      ],
    });

    service = setup.module.get<EntitySummaryService>(EntitySummaryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates first summary version and links subfacets', async () => {
    prisma.db.entitySummary.findFirst.mockResolvedValue(null);
    mockSubfacetService.createSubfacetsWithDeduping.mockResolvedValue([
      buildSubfacet(),
    ]);

    prisma.db.entitySummary.create.mockResolvedValue({
      id: 'summary-1',
      entityType: EntityType.TASK,
      entityId: 'task-1',
      organizationId,
      projectId,
      summary: 'A summary',
      category: SummaryCategory.technology,
      version: 1,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    await service.createSummaryWithSubfacets({
      entityType: EntityType.TASK,
      entityId: 'task-1',
      organizationId,
      projectId,
      summary: 'A summary',
      category: SummaryCategory.technology,
      subfacets: ['observability'],
    });

    expect(prisma.db.entitySummary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          isCurrent: true,
        }),
      }),
    );
    expect(prisma.db.entitySubfacet.create).toHaveBeenCalledTimes(1);
    expect(prisma.db.entitySubfacet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rank: 1,
          subfacetId: 'sf-1',
        }),
      }),
    );
    expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
    const [, publishedEvent] = getFirstCall(
      mockEventPublisher.publishInTransaction.mock.calls,
      'publishInTransaction',
    );
    expect(publishedEvent).toMatchObject({
      type: EVENT_TYPES.SUMMARY.CREATED,
      aggregateId: 'summary-1',
      payload: expect.objectContaining({
        summary: {
          summary: 'A summary',
          category: SummaryCategory.technology,
          subfacets: ['observability'],
        },
        category: SummaryCategory.technology,
        subfacets: ['observability'],
        organizationId,
        projectId,
      }),
    });
  });

  it('increments version and flips current flag', async () => {
    prisma.db.entitySummary.findFirst.mockResolvedValue({
      id: 'summary-1',
      entityType: EntityType.TASK,
      entityId: 'task-1',
      organizationId,
      projectId,
      summary: 'old',
      category: SummaryCategory.technology,
      version: 2,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    mockSubfacetService.createSubfacetsWithDeduping.mockResolvedValue([]);

    prisma.db.entitySummary.create.mockResolvedValue({
      id: 'summary-2',
      entityType: EntityType.TASK,
      entityId: 'task-1',
      organizationId,
      projectId,
      summary: 'new',
      category: SummaryCategory.technology,
      version: 3,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    await service.createSummaryWithSubfacets({
      entityType: EntityType.TASK,
      entityId: 'task-1',
      organizationId,
      projectId,
      summary: 'new',
      category: SummaryCategory.technology,
      subfacets: [],
    });

    expect(prisma.db.entitySummary.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isCurrent: false },
      }),
    );
    expect(prisma.db.entitySummary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 3,
          isCurrent: true,
        }),
      }),
    );
    expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
  });

  it('caps linked subfacets to three', async () => {
    prisma.db.entitySummary.findFirst.mockResolvedValue(null);
    mockSubfacetService.createSubfacetsWithDeduping.mockResolvedValue([
      buildSubfacet({ id: 'sf-1', name: 'a', slug: 'a' }),
      buildSubfacet({ id: 'sf-2', name: 'b', slug: 'b' }),
      buildSubfacet({ id: 'sf-3', name: 'c', slug: 'c' }),
      buildSubfacet({ id: 'sf-4', name: 'd', slug: 'd' }),
    ]);

    prisma.db.entitySummary.create.mockResolvedValue({
      id: 'summary-3',
      entityType: EntityType.DESIGN_DOC,
      entityId: 'doc-1',
      organizationId,
      projectId,
      summary: 'doc summary',
      category: SummaryCategory.technology,
      version: 1,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    await service.createSummaryWithSubfacets({
      entityType: EntityType.DESIGN_DOC,
      entityId: 'doc-1',
      organizationId,
      projectId,
      summary: 'doc summary',
      category: SummaryCategory.technology,
      subfacets: ['a', 'b', 'c', 'd'],
    });

    expect(prisma.db.entitySubfacet.create).toHaveBeenCalledTimes(3);
    expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
    const call = mockEventPublisher.publishInTransaction.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('Expected publishInTransaction to be called');
    }
    const [, eventWithoutId] = call;
    const event = { ...eventWithoutId, id: 'event-1' } as ServiceEvent;
    expect(event.type).toBe(EVENT_TYPES.SUMMARY.CREATED);
    expect(isSummaryCreatedEvent(event)).toBe(true);
    if (isSummaryCreatedEvent(event)) {
      expect(event.payload.subfacets).toEqual(['a', 'b', 'c']);
    }
  });

  it('queries subfacet names case-insensitively with configurable statuses', async () => {
    prisma.db.entitySummary.findMany.mockResolvedValue([]);

    await service.getCurrentSummariesForSubfacetNames({
      organizationId,
      projectId,
      category: SummaryCategory.technology,
      subfacetNames: ['Old Facet'],
      statuses: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
    });

    expect(prisma.db.entitySummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subfacets: {
            some: {
              subfacet: expect.objectContaining({
                OR: [
                  {
                    name: {
                      equals: 'Old Facet',
                      mode: 'insensitive',
                    },
                  },
                ],
                status: {
                  in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
                },
              }),
            },
          },
        }),
        include: expect.objectContaining({
          subfacets: expect.objectContaining({
            where: {
              subfacet: {
                status: {
                  in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
                },
              },
            },
          }),
        }),
      }),
    );
  });

  it('returns total and changed current summary counts for a subfacet', async () => {
    (prisma.db.entitySummary as any).count = jest.fn();
    (prisma.db.entitySummary as any).count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(5);

    const result = await service.getSubfacetCurrentSummaryCounts({
      organizationId,
      projectId,
      subfacetId: 'sf-1',
      category: SummaryCategory.technology,
      since: new Date('2026-02-14T00:00:00.000Z'),
    });

    expect((prisma.db.entitySummary as any).count).toHaveBeenCalledTimes(2);
    expect((prisma.db.entitySummary as any).count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId,
          projectId,
          isCurrent: true,
          category: SummaryCategory.technology,
          subfacets: {
            some: { subfacetId: 'sf-1' },
          },
        }),
      }),
    );
    expect((prisma.db.entitySummary as any).count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: { gte: new Date('2026-02-14T00:00:00.000Z') },
        }),
      }),
    );
    expect(result).toEqual({ totalCurrent: 100, changedSinceCutoff: 5 });
  });
});
