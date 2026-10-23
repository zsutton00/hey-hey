import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { SummaryCategory } from '@prisma/client';
import { Client } from '@temporalio/client';
import { TEMPORAL_CLIENT } from '../../prisma/temporal.module';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphsClientService } from '../../services/graphs-client.service';
import { TopologyConsolidationSchedulerService } from '../../services/topology/topology-consolidation-scheduler.service';
import { SubfacetCandidateService } from '../../services/entity-summary/subfacet-candidate.service';
import { TopologyController } from '../topology.controller';

describe('TopologyController', () => {
  let controller: TopologyController;
  const mockTemporalClient = {
    workflow: {
      start: jest.fn(),
    },
  } as unknown as Client;
  const mockPrismaService = {} as PrismaService;
  const mockGraphsClientService = {} as GraphsClientService;
  const mockTopologyScheduler = {} as TopologyConsolidationSchedulerService;
  const mockSubfacetCandidateService = {} as SubfacetCandidateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TopologyController],
      providers: [
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TEMPORAL_CLIENT, useValue: mockTemporalClient },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: GraphsClientService, useValue: mockGraphsClientService },
        {
          provide: TopologyConsolidationSchedulerService,
          useValue: mockTopologyScheduler,
        },
        {
          provide: SubfacetCandidateService,
          useValue: mockSubfacetCandidateService,
        },
      ],
    }).compile();

    controller = module.get(TopologyController);
    jest.clearAllMocks();
  });

  it('starts subfacet consolidation workflow with provided inputs', async () => {
    const user = {
      currentOrgId: 'org-1',
    } as any;

    await controller.runConsolidation('org-1' as any, user, {
      projectId: 'proj-1' as any,
      since: '2024-01-01T00:00:00Z',
      categories: [SummaryCategory.people],
      threshold: 3,
      workflowId: 'custom-wf' as any,
    });

    expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
      'subfacetConsolidationWorkflow',
      {
        args: [
          expect.objectContaining({
            organizationId: 'org-1',
            projectId: 'proj-1',
            since: '2024-01-01T00:00:00Z',
            categories: [SummaryCategory.people],
            threshold: 3,
          }),
        ],
        taskQueue: 'conversation-queue',
        workflowId: 'custom-wf',
      },
    );
  });

  it('rejects entity summarization requests without starting a workflow', async () => {
    await expect(
      controller.runSingleEntitySummarization(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        { taskId: 'task-1' },
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('rejects topology reset while entity summarization is disabled', async () => {
    await expect(
      controller.reset('org-1' as any, { currentOrgId: 'org-1' } as any, {
        projectId: 'project-1' as any,
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
  });

  it('throws when since is missing for subfacet consolidation', async () => {
    await expect(
      controller.runConsolidation(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        {
          projectId: 'proj-1' as any,
          since: '' as any,
        },
      ),
    ).rejects.toThrow('since is required');
  });

  it('throws when organizationId is missing for subfacet consolidation', async () => {
    await expect(
      controller.runConsolidation(undefined as any, {} as any, {
        projectId: 'proj-1' as any,
        since: '2024-01-01T00:00:00Z',
      }),
    ).rejects.toThrow('organizationId is required');
  });

  it('starts category consolidation workflow with provided inputs', async () => {
    const user = {
      currentOrgId: 'org-1',
    } as any;

    await controller.runCategorySummarization('org-1' as any, user, {
      projectId: 'proj-1' as any,
      since: '2024-01-01T00:00:00Z',
      categories: [SummaryCategory.technology],
      maxPerCategory: 10,
      maxPerSubfacet: 5,
      workflowId: 'custom-category-wf' as any,
    });

    expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
      'categorySummarizationWorkflow',
      {
        args: [
          expect.objectContaining({
            organizationId: 'org-1',
            projectId: 'proj-1',
            since: '2024-01-01T00:00:00Z',
            categories: [SummaryCategory.technology],
            maxPerCategory: 10,
            maxPerSubfacet: 5,
          }),
        ],
        taskQueue: 'conversation-queue',
        workflowId: 'custom-category-wf',
      },
    );
  });

  it('throws when since is missing for category consolidation', async () => {
    await expect(
      controller.runCategorySummarization(
        'org-1' as any,
        { currentOrgId: 'org-1' } as any,
        {
          projectId: 'proj-1' as any,
          since: '' as any,
        },
      ),
    ).rejects.toThrow('since is required');
  });

  it('throws when organizationId is missing for category consolidation', async () => {
    await expect(
      controller.runCategorySummarization(undefined as any, {} as any, {
        projectId: 'proj-1' as any,
        since: '2024-01-01T00:00:00Z',
      }),
    ).rejects.toThrow('organizationId is required');
  });
});
