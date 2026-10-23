import { getWorkflowEntryUiHints, getWorkflowNodeUiHints } from '../workflow-ui-hints.util';
import type { Flow } from '../../../types/flow-internal.types';

describe('workflow-ui-hints util', () => {
  it('returns the start-node uiHints for a workflow template', () => {
    const flow = {
      startNode: 'entry',
      nodes: {
        entry: {
          uiHints: {
            expectedElements: [],
            estimatedCount: 0,
            layoutHint: 'inline' as const,
          },
        },
        review: {},
      },
    } as unknown as Pick<Flow, 'nodes' | 'startNode'>;

    expect(getWorkflowEntryUiHints(flow)).toEqual({
      expectedElements: [],
      estimatedCount: 0,
      layoutHint: 'inline',
    });
  });

  it('returns the node uiHints unchanged when present', () => {
    const uiHints = {
      expectedElements: [],
      estimatedCount: 1,
      layoutHint: 'form' as const,
    };

    expect(getWorkflowNodeUiHints({ uiHints })).toBe(uiHints);
  });

  it('returns undefined when a node has no uiHints', () => {
    expect(getWorkflowNodeUiHints({ uiHints: undefined })).toBeUndefined();
  });
});
