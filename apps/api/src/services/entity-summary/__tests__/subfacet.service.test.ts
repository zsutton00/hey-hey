import { SummaryCategory, SubfacetStatus } from '@prisma/client';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { SubfacetService } from '../subfacet.service';
import * as TestUtils from '../../../utils/testUtils';
import { createMockPrismaService } from '../../../utils/testUtils';

describe('SubfacetService', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const organizationId = TestUtils.testIds.organization;
  const projectId = TestUtils.testIds.project;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: SubfacetService;
  let eventPublisher: {
    publish: jest.Mock;
    publishInTransaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    eventPublisher = {
      publish: jest.fn().mockResolvedValue(null),
      publishInTransaction: jest.fn().mockResolvedValue(null),
    };
    service = new SubfacetService(prisma as any, eventPublisher as any);
  });

  it('reuses exact slug matches', async () => {
    prisma.db.subfacet.findMany.mockResolvedValue([
      {
        id: 'sf-1',
        name: 'Event System',
        slug: 'event',
        category: SummaryCategory.technology,
        status: SubfacetStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
        organizationId,
        projectId,
      },
    ]);

    const result = await service.createSubfacetsWithDeduping({
      names: ['events'],
      category: SummaryCategory.technology,
      organizationId,
      projectId,
    });

    expect(result).toHaveLength(1);
    const [subfacet] = result;
    if (!subfacet) {
      throw new Error('Expected subfacet result');
    }
    expect(subfacet.id).toBe('sf-1');
    expect(prisma.db.subfacet.create).not.toHaveBeenCalled();
  });

  it('fuzzy matches similar tokens', async () => {
    prisma.db.subfacet.findMany.mockResolvedValue([
      {
        id: 'sf-2',
        name: 'event',
        slug: 'event',
        category: SummaryCategory.technology,
        status: SubfacetStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
        organizationId,
        projectId,
      },
    ]);

    const result = await service.createSubfacetsWithDeduping({
      names: ['event-based system'],
      category: SummaryCategory.technology,
      organizationId,
      projectId,
    });

    expect(result).toHaveLength(1);
    const [subfacet] = result;
    if (!subfacet) {
      throw new Error('Expected subfacet result');
    }
    expect(subfacet.id).toBe('sf-2');
    expect(prisma.db.subfacet.create).not.toHaveBeenCalled();
  });

  it('creates new subfacets and enforces max cap', async () => {
    prisma.db.subfacet.findMany.mockResolvedValue([]);
    prisma.db.subfacet.create.mockImplementation(async ({ data }) => ({
      id: `sf-created-${data.slug}`,
      name: data.name,
      slug: data.slug,
      category: data.category,
      status: data.status ?? SubfacetStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      organizationId,
      projectId,
    }));

    const result = await service.createSubfacetsWithDeduping({
      names: ['Observability', 'Logging', 'Tracing', 'Backend'],
      category: SummaryCategory.technology,
      organizationId,
      projectId,
    });

    expect(result).toHaveLength(3); // capped at default max
    expect(prisma.db.subfacet.create).toHaveBeenCalledTimes(3);
    expect(eventPublisher.publish).toHaveBeenCalledTimes(3);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.SUBFACET.CREATED,
      }),
    );
  });

  it('promotes provisionals without exceeding ACTIVE cap per category', async () => {
    (prisma.db.subfacet as any).count = jest.fn().mockResolvedValue(24);
    (prisma.db.subfacet as any).findMany = jest.fn();
    (prisma.db.subfacet as any).updateMany = jest.fn();

    const result = await service.promoteProvisionalsToActive({
      organizationId,
      projectId,
      category: SummaryCategory.technology,
    });

    expect(result).toEqual({ count: 0, promotedIds: [] });
    expect((prisma.db.subfacet as any).findMany).not.toHaveBeenCalled();
    expect((prisma.db.subfacet as any).updateMany).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('emits subfacet.created when provisional subfacets are promoted', async () => {
    (prisma.db.subfacet as any).count = jest.fn().mockResolvedValue(0);
    (prisma.db.subfacet as any).findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'sf-provisional-1' }])
      .mockResolvedValueOnce([
        {
          id: 'sf-provisional-1',
          name: 'Observability',
          slug: 'observability',
          category: SummaryCategory.technology,
          status: SubfacetStatus.ACTIVE,
          summary: 'Observed across entities',
          lastSummarizedAt: null,
          deprecatedAt: null,
          survivalCount: 2,
          lastSeenInConsolidationAt: now,
          createdAt: now,
          updatedAt: now,
          organizationId,
          projectId,
        },
      ]);
    (prisma.db.subfacet as any).updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });

    const result = await service.promoteProvisionalsToActive({
      organizationId,
      projectId,
      category: SummaryCategory.technology,
      minSurvivalCount: 2,
      limit: 1,
    });

    expect(result).toEqual({ count: 1, promotedIds: ['sf-provisional-1'] });
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.SUBFACET.CREATED,
        aggregateId: 'sf-provisional-1',
      }),
    );
  });

  it('emits subfacet.deprecated only for active subfacets', async () => {
    (prisma.db.subfacet as any).findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'sf-active-1',
          name: 'Legacy',
          slug: 'legacy',
          category: SummaryCategory.technology,
          status: SubfacetStatus.ACTIVE,
          summary: null,
          lastSummarizedAt: null,
          deprecatedAt: null,
          survivalCount: 5,
          lastSeenInConsolidationAt: now,
          createdAt: now,
          updatedAt: now,
          organizationId,
          projectId,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sf-active-1',
          name: 'Legacy',
          slug: 'legacy',
          category: SummaryCategory.technology,
          status: SubfacetStatus.DEPRECATED,
          summary: null,
          lastSummarizedAt: null,
          deprecatedAt: now,
          survivalCount: 5,
          lastSeenInConsolidationAt: now,
          createdAt: now,
          updatedAt: now,
          organizationId,
          projectId,
        },
      ]);
    (prisma.db.subfacet as any).updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });

    const result = await service.deprecateSubfacetsWithMetadata({
      ids: ['sf-active-1'],
      organizationId,
      projectId,
    });

    expect(result).toEqual({ count: 1 });
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.SUBFACET.DEPRECATED,
        aggregateId: 'sf-active-1',
      }),
    );
  });
});
