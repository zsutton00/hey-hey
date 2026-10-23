import { SummaryCategory } from '@prisma/client';

var startNonInteractiveNodeMock = jest.fn();
var getLatestSubfacetConsolidationRunMock = jest.fn();
var conditionMock = jest.fn();
let llmResponseHandler: ((payload: unknown) => void) | undefined;

jest.mock('@temporalio/workflow', () => ({
  condition: (...args: unknown[]) => conditionMock(...args),
  defineSignal: (name: string) => name,
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  proxyActivities: () => ({
    startNonInteractiveNode: startNonInteractiveNodeMock,
    getLatestSubfacetConsolidationRun: getLatestSubfacetConsolidationRunMock,
  }),
  setHandler: (_signal: string, handler: (payload: unknown) => void) => {
    llmResponseHandler = handler;
  },
  workflowInfo: () => ({ workflowId: 'wf-1' }),
}));

const {
  subfacetConsolidationWorkflow,
} = require('../subfacet-consolidation.workflow');

describe('subfacetConsolidationWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    llmResponseHandler = undefined;
    conditionMock.mockImplementation(async (predicate: () => boolean) => {
      if (!predicate()) {
        throw new Error('condition predicate was false');
      }
      return true;
    });
    getLatestSubfacetConsolidationRunMock.mockResolvedValue(null);
  });

  it('continues iterating while hasMoreSubfacets is true even if a batch has no merges', async () => {
    let runCount = 0;
    startNonInteractiveNodeMock.mockImplementation(async ({ requestId }) => {
      runCount += 1;
      const hasMoreSubfacets = runCount === 1;
      llmResponseHandler?.({
        requestId,
        responseData: {
          category: 'technology',
          mergedSubfacets: [],
          keptSubfacets: [],
        },
        contextUpdates: [
          {
            op: 'set',
            path: ['processedSubfacets'],
            value: [`batch-${runCount}`],
          },
          {
            op: 'set',
            path: ['hasMoreSubfacets'],
            value: hasMoreSubfacets,
          },
        ],
      });
    });

    const result = await subfacetConsolidationWorkflow({
      organizationId: 'org-1' as any,
      projectId: 'proj-1' as any,
      workflowAboutType: 'project',
      workflowAboutId: 'proj-1',
      trigger: 'on_demand',
      since: '2026-02-14T00:00:00.000Z',
      categories: ['technology' as SummaryCategory],
      maxIterations: 3,
    });

    expect(startNonInteractiveNodeMock).toHaveBeenCalledTimes(2);
    expect(
      startNonInteractiveNodeMock.mock.calls[0][0].contextOverrides,
    ).toEqual(
      expect.objectContaining({
        consolidationCategory: 'technology',
        processedSubfacets: [],
      }),
    );
    expect(
      startNonInteractiveNodeMock.mock.calls[1][0].contextOverrides,
    ).toEqual(
      expect.objectContaining({
        consolidationCategory: 'technology',
        processedSubfacets: ['batch-1'],
      }),
    );
    expect(result.categories[0].response).toEqual(
      expect.objectContaining({
        category: 'technology',
      }),
    );
  });
});
