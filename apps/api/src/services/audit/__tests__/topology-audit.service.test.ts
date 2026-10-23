import { SummaryCategory } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { testIds } from '../../../utils/testUtils';
import { TopologyAuditService } from '../topology-audit.service';

describe('TopologyAuditService', () => {
  const prisma = {
    db: {
      subfacetConsolidationRun: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      categorySummarizationRun: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      subfacetSummarizationRun: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
  } as unknown as PrismaService;

  const service = new TopologyAuditService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records a consolidation run', async () => {
    const run = { id: 'run-id' };
    (prisma.db.subfacetConsolidationRun.create as jest.Mock).mockResolvedValue(
      run,
    );

    const result = await service.recordRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.technology,
      since: new Date('2024-01-01T00:00:00Z'),
      until: new Date('2024-02-01T00:00:00Z'),
      thresholdApplied: 7,
      accumulatedSnapshot: [{ name: 'sf' }],
      consolidatedBefore: [{ name: 'existing' }],
      consolidationResult: { merged: [] },
    });

    expect(result).toBe(run);
    expect(prisma.db.subfacetConsolidationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.technology,
        thresholdApplied: 7,
      }),
    });
  });

  it('records a category consolidation run', async () => {
    const run = { id: 'category-run-id' };
    (prisma.db.categorySummarizationRun.create as jest.Mock).mockResolvedValue(
      run,
    );

    const result = await service.recordCategoryRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.technology,
      since: new Date('2024-01-01T00:00:00Z'),
      until: new Date('2024-02-01T00:00:00Z'),
      thresholdApplied: 3,
      accumulatedSnapshot: [{ name: 'subfacet' }],
      consolidatedBefore: { summary: 'prior' },
      consolidationResult: { summary: 'next' },
    });

    expect(result).toBe(run);
    expect(prisma.db.categorySummarizationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.technology,
        thresholdApplied: 3,
      }),
    });
  });

  it('records a subfacet summarization run', async () => {
    const run = { id: 'subfacet-run-id' };
    (prisma.db.subfacetSummarizationRun.create as jest.Mock).mockResolvedValue(
      run,
    );

    const result = await service.recordSubfacetSummaryRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.people,
      subfacetId: 'sf-1',
      since: new Date('2024-01-01T00:00:00Z'),
      until: new Date('2024-01-02T00:00:00Z'),
      thresholdApplied: 2,
      accumulatedSnapshot: [],
      consolidatedBefore: null,
      consolidationResult: { summary: 'next' },
    });

    expect(result).toBe(run);
    expect(prisma.db.subfacetSummarizationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.people,
        subfacetId: 'sf-1',
      }),
    });
  });

  it('returns the latest run for a category', async () => {
    (
      prisma.db.subfacetConsolidationRun.findFirst as jest.Mock
    ).mockResolvedValue({ id: 'latest' });

    const latest = await service.getLatestRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.process,
    });

    expect(latest).toEqual({ id: 'latest' });
    expect(prisma.db.subfacetConsolidationRun.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.process,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns the latest category run for a category', async () => {
    (
      prisma.db.categorySummarizationRun.findFirst as jest.Mock
    ).mockResolvedValue({ id: 'latest-category' });

    const latest = await service.getLatestCategoryRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.process,
    });

    expect(latest).toEqual({ id: 'latest-category' });
    expect(prisma.db.categorySummarizationRun.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.process,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns the latest subfacet summarization run for a category', async () => {
    (
      prisma.db.subfacetSummarizationRun.findFirst as jest.Mock
    ).mockResolvedValue({ id: 'latest-subfacet' });

    const latest = await service.getLatestSubfacetSummaryRun({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.process,
      subfacetId: 'sf-1',
    });

    expect(latest).toEqual({ id: 'latest-subfacet' });
    expect(prisma.db.subfacetSummarizationRun.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.process,
        subfacetId: 'sf-1',
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lists recent runs with defaults and overrides', async () => {
    (
      prisma.db.subfacetConsolidationRun.findMany as jest.Mock
    ).mockResolvedValue([]);

    await service.listRecentRuns({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.people,
    });

    expect(prisma.db.subfacetConsolidationRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.people,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await service.listRecentRuns({
      organizationId: testIds.organization,
      projectId: testIds.project,
      limit: 5,
    });

    expect(prisma.db.subfacetConsolidationRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('lists recent category runs with defaults and overrides', async () => {
    (
      prisma.db.categorySummarizationRun.findMany as jest.Mock
    ).mockResolvedValue([]);

    await service.listRecentCategoryRuns({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.people,
    });

    expect(prisma.db.categorySummarizationRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.people,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    await service.listRecentCategoryRuns({
      organizationId: testIds.organization,
      projectId: testIds.project,
      limit: 5,
    });

    expect(prisma.db.categorySummarizationRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('lists recent subfacet summary runs with filters', async () => {
    (
      prisma.db.subfacetSummarizationRun.findMany as jest.Mock
    ).mockResolvedValue([]);

    await service.listRecentSubfacetSummaryRuns({
      organizationId: testIds.organization,
      projectId: testIds.project,
      category: SummaryCategory.people,
      limit: 2,
    });

    expect(prisma.db.subfacetSummarizationRun.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        category: SummaryCategory.people,
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
  });
});
