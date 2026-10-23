var startNonInteractiveNodeMock = jest.fn();
var getLatestSubfacetSummarizationRunMock = jest.fn();
var listSummarizableSubfacetsMock = jest.fn();
var conditionMock = jest.fn();
var patchedMock = jest.fn();
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
  patched: (...args: unknown[]) => patchedMock(...args),
  proxyActivities: () => ({
    startNonInteractiveNode: startNonInteractiveNodeMock,
    getLatestSubfacetSummarizationRun: getLatestSubfacetSummarizationRunMock,
    listSummarizableSubfacets: listSummarizableSubfacetsMock,
  }),
  setHandler: (_signal: string, handler: (payload: unknown) => void) => {
    llmResponseHandler = handler;
  },
  workflowInfo: () => ({ workflowId: 'wf-1' }),
}));

const {
  subfacetSummarizationWorkflow,
} = require('../subfacet-summarization.workflow');

describe('subfacetSummarizationWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    llmResponseHandler = undefined;
    conditionMock.mockImplementation(async (predicate: () => boolean) => {
      if (!predicate()) {
        throw new Error('condition predicate was false');
      }
      return true;
    });
    getLatestSubfacetSummarizationRunMock.mockResolvedValue(null);
  });

  it('passes since to listSummarizableSubfacets on patched path', async () => {
    patchedMock.mockReturnValue(true);
    listSummarizableSubfacetsMock.mockResolvedValue([
      {
        id: 'sf-1',
        name: 'Telemetry',
        slug: 'telemetry',
        category: 'technology',
      },
    ]);
    startNonInteractiveNodeMock.mockImplementation(async ({ requestId }) => {
      llmResponseHandler?.({
        requestId,
        responseData: {
          category: 'technology',
          subfacet: 'Telemetry',
          summary: 'Updated summary.',
          entities: ['task-1'],
          criticalInsights: ['Telemetry behavior stabilized'],
        },
      });
    });

    const result = await subfacetSummarizationWorkflow({
      organizationId: 'org-1',
      projectId: 'proj-1',
      workflowAboutType: 'project',
      workflowAboutId: 'proj-1',
      trigger: 'on_demand',
      since: '2026-02-14T00:00:00.000Z',
    });

    expect(listSummarizableSubfacetsMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      categories: undefined,
      subfacetIds: undefined,
      since: '2026-02-14T00:00:00.000Z',
    });
    expect(startNonInteractiveNodeMock).toHaveBeenCalledTimes(1);
    expect(result.subfacets).toHaveLength(1);
  });

  it('uses legacy listSummarizableSubfacets shape on unpatched path', async () => {
    patchedMock.mockReturnValue(false);
    listSummarizableSubfacetsMock.mockResolvedValue([]);

    const result = await subfacetSummarizationWorkflow({
      organizationId: 'org-1',
      projectId: 'proj-1',
      workflowAboutType: 'project',
      workflowAboutId: 'proj-1',
      trigger: 'on_demand',
      since: '2026-02-14T00:00:00.000Z',
    });

    expect(listSummarizableSubfacetsMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      categories: undefined,
      subfacetIds: undefined,
    });
    expect(startNonInteractiveNodeMock).not.toHaveBeenCalled();
    expect(result.subfacets).toEqual([]);
  });
});
