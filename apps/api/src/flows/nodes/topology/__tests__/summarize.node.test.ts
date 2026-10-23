import { SummarizeNode } from '../../topology/entity-summarize.node';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { FlowContext } from 'src/types/flow-internal.types';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import * as TestUtils from 'src/utils/testUtils';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { SubfacetLifecycleService } from 'src/services/entity-summary/subfacet-lifecycle.service';
import { NotFoundException } from '@nestjs/common';

const baseContext = createMutableContextHandle<FlowContext>(
  TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      workflowAboutId: 'entity-1',
      workflowAboutType: 'task',
      user: { id: TestUtils.testIds.user, role: 'system' },
    },
    flowId: 'entity-summarization',
  }),
);

describe('SummarizeNode.processLlmResponse', () => {
  it('normalizes and validates LLM output', async () => {
    const mockSummaryService = {
      createSummaryWithSubfacets: jest.fn().mockResolvedValue({
        summary: { id: 'summary-1', category: 'technology' },
        subfacets: [{ name: 'platform readiness' }],
      }),
    } as unknown as EntitySummaryService;

    const node = new SummarizeNode(mockSummaryService,
{} as InitiativeService,
{
        findOneForAdapter: jest.fn().mockResolvedValue({
          name: 'Migration',
          sections: [
            { materializedMarkdown: 'Completed migration with zero downtime.' },
          ],
        }),
      } as unknown as TaskService,
{} as DesignDocService,
{} as SubfacetService,
{
        handleProposedSubfacet: jest.fn(),
      } as unknown as SubfacetLifecycleService
    );
    baseContext.mutate((draft) => {
      (
        draft as FlowContext & {
          existingSubfacetCandidates?: Array<{
            id: string;
            name: string;
            category: 'technology' | 'product' | 'process' | 'people';
            status: 'ACTIVE' | 'PROVISIONAL' | 'DEPRECATED';
          }>;
        }
      ).existingSubfacetCandidates = [
        {
          id: 'sf-1',
          name: 'platform readiness',
          category: 'technology',
          status: 'ACTIVE',
        },
      ];
    });
    const { modifiedResult } = await node.processLlmResponse(
      {
        summary: '  Completed migration with zero downtime. ',
        category: 'technology',
        selectedExistingSubfacetNames: ['platform readiness'],
        subfacets: ['platform readiness', 'platform readiness', ''],
      } as any,
      undefined,
      baseContext,
    );

    expect(mockSummaryService.createSummaryWithSubfacets).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'TASK',
        entityId: 'entity-1',
        organizationId: TestUtils.testIds.organization,
        projectId: TestUtils.testIds.project,
        summary: 'Completed migration with zero downtime.',
        category: 'technology',
        subfacets: ['platform readiness'],
      }),
    );

    expect(modifiedResult).toEqual({
      summary: 'Completed migration with zero downtime.',
      category: 'technology',
      subfacets: ['platform readiness'],
      selectedExistingSubfacetNames: ['platform readiness'],
      proposedNewSubfacetName: null,
      proposedNewSubfacetRationale: null,
      proposedNewSubfacetConfidence: null,
      summaryId: 'summary-1',
      entityId: 'entity-1',
      entityType: 'TASK',
    });
  });

  it('throws on invalid categories', async () => {
    const node = new SummarizeNode({
        createSummaryWithSubfacets: jest.fn(),
      } as unknown as EntitySummaryService,
{} as InitiativeService,
{} as TaskService,
{} as DesignDocService,
{} as SubfacetService,
{
        handleProposedSubfacet: jest.fn(),
      } as unknown as SubfacetLifecycleService
    );
    await expect(
      node.processLlmResponse(
        {
          summary: 'Example',
          category: 'unknown',
          subfacets: [],
        } as any,
        undefined,
        baseContext,
      ),
    ).rejects.toThrow(/Invalid entity summary response/);
  });
});

describe('SummarizeNode.shouldRun', () => {
  const buildNode = (params?: {
    initiativeService?: InitiativeService;
    taskService?: TaskService;
    designDocService?: DesignDocService;
  }) =>
    new SummarizeNode({} as EntitySummaryService,
(params?.initiativeService ??
        ({} as InitiativeService)) as InitiativeService,
(params?.taskService ?? ({} as TaskService)) as TaskService,
(params?.designDocService ??
        ({} as DesignDocService)) as DesignDocService,
{} as SubfacetService,
{
        handleProposedSubfacet: jest.fn(),
      } as unknown as SubfacetLifecycleService
    );

  const buildContext = (
    workflowAboutType: FlowContext['core']['workflowAboutType'],
    workflowAboutId = 'entity-1',
  ) =>
    createMutableContextHandle<FlowContext>(
      TestUtils.createMockFlowContext({
        core: {
          ...TestUtils.createMockFlowContext().core,
          workflowAboutId,
          workflowAboutType,
          user: { id: TestUtils.testIds.user, role: 'system' },
        },
        flowId: 'entity-summarization',
      }),
    );

  it('skips message entity summarization', async () => {
    const node = buildNode();
    await expect(
      node.shouldRun(buildContext('message', TestUtils.testIds.message)),
    ).resolves.toMatchObject({
      run: false,
      reason: expect.stringContaining(
        'Message entity summarization is disabled',
      ),
    });
  });

  it('skips when task is missing', async () => {
    const taskService = TestUtils.createMockTaskService();
    taskService.findOneForAdapter.mockResolvedValue(null);
    const node = buildNode({
      taskService: taskService as unknown as TaskService,
    });

    await expect(
      node.shouldRun(buildContext('task', 'task-1')),
    ).resolves.toMatchObject({
      run: false,
      reason: expect.stringContaining('Task not found for summary'),
    });
  });

  it('skips when initiative is missing', async () => {
    const initiativeService = TestUtils.createMockInitiativeService();
    initiativeService.findOne.mockResolvedValue(null);
    const node = buildNode({
      initiativeService: initiativeService as unknown as InitiativeService,
    });

    await expect(
      node.shouldRun(buildContext('initiative', 'initiative-1')),
    ).resolves.toMatchObject({
      run: false,
      reason: expect.stringContaining('Initiative not found for summary'),
    });
  });

  it('skips when design doc is missing', async () => {
    const designDocService = TestUtils.createMockDesignDocService();
    designDocService.findOneForAdapter.mockResolvedValue(null);
    const node = buildNode({
      designDocService: designDocService as unknown as DesignDocService,
    });

    await expect(
      node.shouldRun(buildContext('design-doc', 'design-doc-1')),
    ).resolves.toMatchObject({
      run: false,
      reason: expect.stringContaining('Design doc not found for summary'),
    });
  });

});
