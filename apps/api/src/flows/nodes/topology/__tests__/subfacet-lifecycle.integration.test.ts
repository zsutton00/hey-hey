import { SummaryCategory } from '@prisma/client';
import { createMutableContextHandle } from 'src/utils/mutable-context';
import { FlowContext } from 'src/types/flow-internal.types';
import * as TestUtils from 'src/utils/testUtils';
import { SummarizeNode } from '../entity-summarize.node';
import { SubfacetConsolidationNode } from '../subfacet-consolidation.node';

describe('Topology Subfacet Lifecycle Integration', () => {
  const baseContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      workflowAboutId: 'task-1',
      workflowAboutType: 'task',
      user: { id: TestUtils.testIds.user, role: 'system' },
    },
  });

  it('direct-creates PROVISIONAL subfacet when below dynamic provisional budget', async () => {
    const mockEntitySummaryService = {
      createSummaryWithSubfacets: jest.fn().mockResolvedValue({
        summary: { id: 'summary-1', category: 'technology' },
        subfacets: [{ name: 'runtime isolation' }],
      }),
    };
    const mockSubfacetService = {};
    const mockSubfacetLifecycleService = {
      handleProposedSubfacet: jest.fn().mockResolvedValue({
        selectedSubfacetName: 'runtime isolation',
        activeCount: 20,
        provisionalCount: 8,
        directCreatesThisRunForCategory: 2,
      }),
    };

    const node = new SummarizeNode(mockEntitySummaryService as any,
{} as any,
{
        findOneForAdapter: jest.fn().mockResolvedValue({ id: 'task-1' }),
      } as any,
{} as any,
mockSubfacetService as any,
mockSubfacetLifecycleService as any
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      subfacetCountsByCategory: {
        technology: { activeCount: 20, provisionalCount: 7 },
        product: { activeCount: 0, provisionalCount: 0 },
        process: { activeCount: 0, provisionalCount: 0 },
        people: { activeCount: 0, provisionalCount: 0 },
      },
      bootstrapDirectCreatesByCategory: {
        technology: 1,
        product: 0,
        process: 0,
        people: 0,
      },
      existingSubfacetCandidates: [],
    } as any);

    await node.processLlmResponse(
      {
        summary: 'Adds tenant runtime controls for process isolation.',
        category: 'technology',
        selectedExistingSubfacetNames: [],
        subfacets: [],
        proposedNewSubfacetName: 'runtime isolation',
      } as any,
      undefined,
      tracker,
    );

    expect(
      mockSubfacetLifecycleService.handleProposedSubfacet,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        proposedNewSubfacetName: 'runtime isolation',
      }),
    );
    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        subfacets: ['runtime isolation'],
      }),
    );
  });

  it('records candidate once dynamic provisional budget is full (active=20, provisional=8)', async () => {
    const mockEntitySummaryService = {
      createSummaryWithSubfacets: jest.fn().mockResolvedValue({
        summary: { id: 'summary-2', category: 'technology' },
        subfacets: [],
      }),
    };
    const mockSubfacetService = {};
    const mockSubfacetLifecycleService = {
      handleProposedSubfacet: jest.fn().mockResolvedValue({
        activeCount: 20,
        provisionalCount: 8,
        directCreatesThisRunForCategory: 0,
      }),
    };

    const node = new SummarizeNode(mockEntitySummaryService as any,
{} as any,
{
        findOneForAdapter: jest.fn().mockResolvedValue({ id: 'task-1' }),
      } as any,
{} as any,
mockSubfacetService as any,
mockSubfacetLifecycleService as any
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      subfacetCountsByCategory: {
        technology: { activeCount: 20, provisionalCount: 8 },
        product: { activeCount: 0, provisionalCount: 0 },
        process: { activeCount: 0, provisionalCount: 0 },
        people: { activeCount: 0, provisionalCount: 0 },
      },
      bootstrapDirectCreatesByCategory: {
        technology: 0,
        product: 0,
        process: 0,
        people: 0,
      },
      existingSubfacetCandidates: [],
    } as any);

    await node.processLlmResponse(
      {
        summary: 'Adds tenant runtime controls for process isolation.',
        category: 'technology',
        selectedExistingSubfacetNames: [],
        subfacets: [],
        proposedNewSubfacetName: 'runtime isolation',
      } as any,
      undefined,
      tracker,
    );

    expect(
      mockSubfacetLifecycleService.handleProposedSubfacet,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        proposedNewSubfacetName: 'runtime isolation',
      }),
    );
  });

  it('consolidation remaps summaries, deprecates merged-from, marks seen, and promotes provisionals', async () => {
    const mockEntitySummaryService = {
      getCurrentSummariesForSubfacetNames: jest.fn().mockResolvedValue([
        {
          entityType: 'TASK',
          entityId: 'task-22',
          summary: 'Current summary',
          category: 'technology',
          updatedAt: new Date('2026-02-10T00:00:00.000Z'),
          subfacets: [
            { id: 'sf-old', name: 'Old Facet', updatedAt: new Date() },
          ],
        },
      ]),
      createSummaryWithSubfacets: jest.fn().mockResolvedValue({}),
      getCurrentSummariesForSubfacet: jest.fn().mockResolvedValue([]),
      removeDeprecatedSubfacetsFromCurrentSummaries: jest
        .fn()
        .mockResolvedValue({ updated: 0, skipped: 0 }),
    };

    const mockSubfacetService = {
      createSubfacets: jest.fn().mockResolvedValue([]),
      listByStatusAndCategory: jest.fn().mockResolvedValue([
        {
          id: 'sf-target',
          name: 'New Facet',
          category: SummaryCategory.technology,
        },
        {
          id: 'sf-kept',
          name: 'Keep Facet',
          category: SummaryCategory.technology,
        },
        {
          id: 'sf-old',
          name: 'Old Facet',
          category: SummaryCategory.technology,
        },
      ]),
      updateSummary: jest.fn().mockResolvedValue({}),
      deprecateSubfacetsWithMetadata: jest.fn().mockResolvedValue({ count: 1 }),
      markSeenInConsolidation: jest.fn().mockResolvedValue({ count: 2 }),
      promoteProvisionalsToActive: jest
        .fn()
        .mockResolvedValue({ count: 1, promotedIds: ['sf-target'] }),
    };
    const mockAuditService = {
      recordRun: jest.fn(),
    };

    const node = new SubfacetConsolidationNode(
      mockEntitySummaryService as any,
      mockSubfacetService as any,
      mockAuditService as any,
    );

    const tracker = createMutableContextHandle<FlowContext>({
      ...baseContext,
      consolidationCategory: 'technology' as SummaryCategory,
      consolidationSince: '2026-02-01T00:00:00.000Z',
      consolidationThreshold: 1,
      consolidationRunGate: 'threshold',
      accumulatedSubfacetCount: 5,
      selectedSubfacetNames: ['Old Facet'],
      hasMoreSubfacets: false,
      processedSubfacets: [],
      accumulatedSubfacetsJson: '[]',
    } as any);

    await node.processLlmResponse(
      {
        category: 'technology',
        mergedSubfacets: [
          {
            name: 'New Facet',
            mergedFrom: ['Old Facet'],
            summary: 'Merged summary',
            justification: 'overlap',
          },
        ],
        keptSubfacets: [{ name: 'Keep Facet', reasonKept: 'distinct' }],
      } as any,
      undefined,
      tracker,
    );

    expect(
      mockSubfacetService.deprecateSubfacetsWithMetadata,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
        names: ['Old Facet'],
      }),
    );
    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'task-22',
        subfacets: ['New Facet'],
      }),
    );
    expect(mockSubfacetService.markSeenInConsolidation).toHaveBeenCalledWith(
      expect.objectContaining({
        subfacetIds: expect.arrayContaining(['sf-target', 'sf-kept']),
      }),
    );
    expect(
      mockSubfacetService.promoteProvisionalsToActive,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'technology',
      }),
    );
  });
});
