import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityType, SummaryCategory, SubfacetStatus } from '@prisma/client';
import { TopologyQueryController } from '../topology.controller';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { TopologyCategorySummaryService } from 'src/services/topology/topology-category-summary.service';
import { GraphsClientService } from 'src/services/graphs-client.service';

describe('TopologyQueryController', () => {
  let controller: TopologyQueryController;
  const mockEntitySummaryService = {
    getCurrentSummariesByCategory: jest.fn().mockResolvedValue([]),
  };
  const mockSubfacetService = {
    listSubfacets: jest.fn().mockResolvedValue([]),
  };
  const mockCategorySummaryService = {
    listSummaries: jest.fn().mockResolvedValue([]),
  };
  const mockAuditService = {
    listRecentRuns: jest.fn().mockResolvedValue([]),
    listRecentCategoryRuns: jest.fn().mockResolvedValue([]),
    listRecentSubfacetSummaryRuns: jest.fn().mockResolvedValue([]),
  };
  const mockGraphsClientService = {
    getTopologyGraph: jest.fn(),
    getEntityGraph: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TopologyQueryController],
      providers: [
        { provide: ProjectAccessService, useValue: { assertOrganization: jest.fn(), assertProject: jest.fn() } },
        { provide: ProjectResourceAccessService, useValue: { assertResource: jest.fn() } },
        { provide: EntitySummaryService, useValue: mockEntitySummaryService },
        { provide: SubfacetService, useValue: mockSubfacetService },
        {
          provide: TopologyCategorySummaryService,
          useValue: mockCategorySummaryService,
        },
        { provide: TopologyAuditService, useValue: mockAuditService },
        { provide: GraphsClientService, useValue: mockGraphsClientService },
      ],
    }).compile();

    controller = module.get(TopologyQueryController);
    jest.clearAllMocks();
  });

  it('lists entity summaries with filters', async () => {
    await controller.listEntitySummaries(
      undefined as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.technology,
      ['sf-1', 'sf-2'],
      ['TASK:task-1', 'INITIATIVE:init-2'],
      '2025-01-01T00:00:00Z',
      '3',
    );

    expect(
      mockEntitySummaryService.getCurrentSummariesByCategory,
    ).toHaveBeenCalledTimes(1);

    const [call] =
      mockEntitySummaryService.getCurrentSummariesByCategory.mock.calls[0];
    expect(call.organizationId).toBe('org-1');
    expect(call.projectId).toBe('proj-1');
    expect(call.category).toBe(SummaryCategory.technology);
    expect(call.subfacetIds).toEqual(['sf-1', 'sf-2']);
    expect(call.entities).toEqual([
      { entityType: EntityType.TASK, entityId: 'task-1' },
      { entityType: EntityType.INITIATIVE, entityId: 'init-2' },
    ]);
    expect(call.limitPerSubfacet).toBe(3);
    expect(call.since.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('rejects invalid categories', async () => {
    await expect(
      controller.listEntitySummaries(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        'proj-1',
        'invalid',
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow('category must be one of');
  });

  it('lists subfacets with status filters', async () => {
    mockSubfacetService.listSubfacets.mockResolvedValueOnce([
      {
        id: 'sf1',
        name: 'Infra',
        slug: 'infra',
        category: SummaryCategory.technology,
        status: SubfacetStatus.ACTIVE,
        summary: 'Current summary',
        lastSummarizedAt: new Date('2025-01-01T00:00:00Z'),
        createdAt: new Date('2024-12-01T00:00:00Z'),
        updatedAt: new Date('2024-12-02T00:00:00Z'),
      },
    ]);

    const result = await controller.listSubfacets(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.people,
      SubfacetStatus.ACTIVE,
    );

    expect(mockSubfacetService.listSubfacets).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      category: SummaryCategory.people,
      status: SubfacetStatus.ACTIVE,
    });

    expect(result[0]).toMatchObject({
      id: 'sf1',
      name: 'Infra',
      summary: 'Current summary',
      lastSummarizedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('defaults subfacet status to active when not provided', async () => {
    await controller.listSubfacets(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.people,
      undefined,
    );

    expect(mockSubfacetService.listSubfacets).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      category: SummaryCategory.people,
      status: SubfacetStatus.ACTIVE,
    });
  });

  it('lists category summaries', async () => {
    await controller.listCategorySummaries(
      undefined as any,
      { currentOrgId: 'org-2' } as any,
      'proj-2',
      SummaryCategory.product,
    );

    expect(mockCategorySummaryService.listSummaries).toHaveBeenCalledWith({
      organizationId: 'org-2',
      projectId: 'proj-2',
      category: SummaryCategory.product,
    });
  });

  it('gets entity graph with entityId and depth', async () => {
    mockGraphsClientService.getEntityGraph.mockResolvedValueOnce({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 1,
          pathCount: 1,
          node: { id: 'node-1' },
          scoreBreakdown: {},
          path: {},
        },
      ],
      relationships: [{ type: 'MENTIONS' }],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 1,
    });

    const result = await controller.getEntityGraph(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      'task-1',
      '2',
      'token-1',
    );

    expect(mockGraphsClientService.getEntityGraph).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'task-1',
      2,
      'token-1',
    );
    expect(result.totalElements).toBe(1);
    expect(result.results?.[0]?.entityId).toBe('task-1');
    expect(result.relationships).toEqual([{ type: 'MENTIONS' }]);
  });

  it('rejects entity graph requests without entityId', async () => {
    await expect(
      controller.getEntityGraph(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        'proj-1',
        undefined,
        '1',
        'token-1',
      ),
    ).rejects.toThrow('entityId is required');
  });

  it('rejects entity graph requests with invalid depth', async () => {
    await expect(
      controller.getEntityGraph(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        'proj-1',
        'task-1',
        '-1',
        'token-1',
      ),
    ).rejects.toThrow('depth must be a non-negative integer');
  });

  it('lists audits with limits', async () => {
    await controller.listSubfacetAudits(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.process,
      '5',
    );

    expect(mockAuditService.listRecentRuns).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      category: SummaryCategory.process,
      limit: 5,
    });

    await controller.listCategoryAudits(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.process,
      '7',
    );

    expect(mockAuditService.listRecentCategoryRuns).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      category: SummaryCategory.process,
      limit: 7,
    });

    await controller.listSubfacetSummaryAudits(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      'proj-1',
      SummaryCategory.process,
      'sf-1',
      '3',
    );

    expect(mockAuditService.listRecentSubfacetSummaryRuns).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        projectId: 'proj-1',
        category: SummaryCategory.process,
        subfacetId: 'sf-1',
        limit: 3,
      },
    );
  });
});
