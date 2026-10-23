import {
  createMockDomainEventPublisher,
  createMockPrismaService,
} from 'src/utils/testUtils';
import { ActivityCorrelationService } from '../activity-correlation.service';
import { ReportService } from '../reports/report.service';
import { GraphsClientService } from '../graphs-client.service';
import {
  EntityType,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from 'src/generated';
import { ActivityCorrelationSeedSelectorService } from '../activity-correlation/activity-correlation-seed-selector.service';
import { ActivityCorrelationTraversalService } from '../activity-correlation/activity-correlation-traversal.service';
import { ActivityCorrelationRecordAssemblerService } from '../activity-correlation/activity-correlation-record-assembler.service';
import { ActivityCorrelationAugmentationService } from '../activity-correlation/activity-correlation-augmentation.service';

describe('ActivityCorrelationService', () => {
  const organizationId = 'org-1' as any;
  const projectId = 'project-1' as any;
  const userId = 'user-1' as any;

  let prisma: ReturnType<typeof createMockPrismaService>;
  let eventPublisher: ReturnType<typeof createMockDomainEventPublisher>;
  let reportService: Pick<ReportService, 'getReportTitle'>;
  let graphsClientService: Pick<GraphsClientService, 'searchGraphAllPages'>;
  let recentSeedSelector: Pick<
    ActivityCorrelationSeedSelectorService,
    'selectSeeds'
  >;
  let recentTraversalService: Pick<
    ActivityCorrelationTraversalService,
    'fetchSeedNeighborhoods'
  >;
  let recentRecordAssembler: Pick<
    ActivityCorrelationRecordAssemblerService,
    'assembleRecentRecords'
  >;
  let recentAugmentationService: Pick<
    ActivityCorrelationAugmentationService,
    'augmentRecentRecords'
  >;
  let service: ActivityCorrelationService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.db.task.findMany.mockResolvedValue([]);
    prisma.db.project.findMany.mockResolvedValue([
      { id: projectId, name: 'Project One' },
    ]);
    eventPublisher = createMockDomainEventPublisher();
    reportService = {
      getReportTitle: jest.fn(),
    };
    graphsClientService = {
      searchGraphAllPages: jest.fn(),
    };
    recentSeedSelector = {
      selectSeeds: jest.fn(),
    };
    recentTraversalService = {
      fetchSeedNeighborhoods: jest.fn(),
    };
    recentRecordAssembler = {
      assembleRecentRecords: jest.fn(),
    };
    recentAugmentationService = {
      augmentRecentRecords: jest.fn(),
    };

    service = new ActivityCorrelationService(
      prisma as any,
      eventPublisher as any,
      reportService as any,
      graphsClientService as any,
      recentSeedSelector as any,
      recentTraversalService as any,
      recentRecordAssembler as any,
      recentAugmentationService as any,
    );
  });

  it('delegates recent feed assembly through the extracted services', async () => {
    const seedPage = {
      seeds: [{ entityId: 'task-1', entityType: EntityType.Task }],
      total: 6,
      nextOffset: 5,
      rankingMetadataBySeed: new Map([
        ['TASK:task-1', { timestamp: '2026-03-01T10:00:00.000Z' }],
      ]),
    };
    const traversal = {
      response: { results: [], seedResults: [], relationships: [] },
      seedResultsByKey: new Map(),
      titleHints: new Map(),
      statusHints: new Map(),
      updatedAtHints: new Map(),
    };
    const drafts = [
      {
        entityId: 'task-1',
        entityType: EntityType.Task,
        timestamp: '2026-03-01T10:00:00.000Z',
        linkedEntities: [],
        reportIds: [],
        reports: [],
      },
    ];
    const augmented = [
      {
        entityId: 'task-1',
        entityType: EntityType.Task,
        title: 'Task 1',
        timestamp: '2026-03-01T10:00:00.000Z',
        linkedEntities: [],
        reports: [],
      },
    ];

    (recentSeedSelector.selectSeeds as jest.Mock).mockResolvedValue(seedPage);
    (
      recentTraversalService.fetchSeedNeighborhoods as jest.Mock
    ).mockResolvedValue(traversal);
    (recentRecordAssembler.assembleRecentRecords as jest.Mock).mockReturnValue(
      drafts,
    );
    (
      recentAugmentationService.augmentRecentRecords as jest.Mock
    ).mockResolvedValue(augmented);

    const result = await service.listCorrelatedActivity(
      organizationId,
      {
        userId,
        projectId,
        mode: RecentActivityCorrelationMode.Task,
        sort: RecentActivityCorrelationSort.LastUpdated,
        limit: 5,
        offset: 0,
      },
      'token-1',
    );

    expect(recentSeedSelector.selectSeeds).toHaveBeenCalledWith(
      organizationId,
      {
        userId,
        projectId,
        mode: RecentActivityCorrelationMode.Task,
        sort: RecentActivityCorrelationSort.LastUpdated,
        limit: 5,
        offset: 0,
      },
    );
    expect(recentTraversalService.fetchSeedNeighborhoods).toHaveBeenCalledWith({
      organizationId,
      projectId,
      seedPage,
      userToken: 'token-1',
    });
    expect(recentRecordAssembler.assembleRecentRecords).toHaveBeenCalledWith(
      seedPage,
      traversal,
    );
    expect(recentAugmentationService.augmentRecentRecords).toHaveBeenCalledWith(
      organizationId,
      drafts,
      traversal.titleHints,
      traversal.statusHints,
      traversal.updatedAtHints,
    );
    expect(result).toEqual({
      records: augmented.map((record) => ({
        ...record,
        responsibleUser: null,
        entityCreatedAt: null,
        projectName: 'Project One',
      })),
      total: 6,
      nextOffset: 5,
    });
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('returns an empty recent feed without traversing the graph when no seeds match', async () => {
    (recentSeedSelector.selectSeeds as jest.Mock).mockResolvedValue({
      seeds: [],
      total: 0,
      rankingMetadataBySeed: new Map(),
    });

    const result = await service.listCorrelatedActivity(
      organizationId,
      {
        userId,
        projectId,
        limit: 5,
        offset: 0,
      },
      'token-1',
    );

    expect(result).toEqual({
      records: [],
      total: 0,
    });
    expect(
      recentTraversalService.fetchSeedNeighborhoods,
    ).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
