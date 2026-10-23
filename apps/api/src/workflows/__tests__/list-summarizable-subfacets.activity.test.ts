import { INestApplicationContext } from '@nestjs/common';
import { SubfacetStatus, SummaryCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubfacetService } from '../../services/entity-summary/subfacet.service';
import { getAppContextForWorker } from '../../utils';
import * as activities from '../activities';
import * as TestUtils from '../../utils/testUtils';

jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils'),
  getAppContextForWorker: jest.fn(),
}));

describe('listSummarizableSubfacets activity', () => {
  const mockSubfacetService = {
    listSubfacets: jest.fn(),
  };
  const mockPrismaService = {
    db: {
      entitySubfacet: {
        findMany: jest.fn(),
      },
    },
  };
  const mockAppContext = {
    get: jest.fn((service) => {
      if (service === SubfacetService) {
        return mockSubfacetService;
      }
      if (service === PrismaService) {
        return mockPrismaService;
      }
      throw new Error(`Unknown service: ${String(service)}`);
    }),
  } as unknown as INestApplicationContext;

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppContextForWorker as jest.Mock).mockResolvedValue(mockAppContext);
    mockSubfacetService.listSubfacets.mockResolvedValue([
      {
        id: 'sf-1',
        name: 'Telemetry',
        slug: 'telemetry',
        category: SummaryCategory.technology,
        status: SubfacetStatus.ACTIVE,
      },
      {
        id: 'sf-2',
        name: 'Alerting',
        slug: 'alerting',
        category: SummaryCategory.technology,
        status: SubfacetStatus.ACTIVE,
      },
      {
        id: 'sf-3',
        name: 'Roadmap',
        slug: 'roadmap',
        category: SummaryCategory.product,
        status: SubfacetStatus.ACTIVE,
      },
    ]);
    mockPrismaService.db.entitySubfacet.findMany.mockResolvedValue([]);
  });

  it('filters by category/subfacetIds without since prefilter', async () => {
    const result = await activities.listSummarizableSubfacets({
      organizationId: TestUtils.testIds.organization,
      projectId: TestUtils.testIds.project,
      categories: [SummaryCategory.technology],
      subfacetIds: ['sf-2', 'sf-3'],
    });

    expect(mockPrismaService.db.entitySubfacet.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: 'sf-2',
        name: 'Alerting',
        slug: 'alerting',
        category: SummaryCategory.technology,
      },
    ]);
  });

  it('applies since prefilter using changed current summaries', async () => {
    mockPrismaService.db.entitySubfacet.findMany.mockResolvedValue([
      { subfacetId: 'sf-2' },
    ]);

    const result = await activities.listSummarizableSubfacets({
      organizationId: TestUtils.testIds.organization,
      projectId: TestUtils.testIds.project,
      since: '2026-02-14T00:00:00.000Z',
    });

    expect(mockPrismaService.db.entitySubfacet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          summary: expect.objectContaining({
            isCurrent: true,
            updatedAt: { gte: new Date('2026-02-14T00:00:00.000Z') },
          }),
        }),
        distinct: ['subfacetId'],
      }),
    );
    expect(result).toEqual([
      {
        id: 'sf-2',
        name: 'Alerting',
        slug: 'alerting',
        category: SummaryCategory.technology,
      },
    ]);
  });

  it('throws on invalid since input', async () => {
    await expect(
      activities.listSummarizableSubfacets({
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
        since: 'not-a-date',
      }),
    ).rejects.toThrow('[listSummarizableSubfacets] Invalid since value');
  });
});
