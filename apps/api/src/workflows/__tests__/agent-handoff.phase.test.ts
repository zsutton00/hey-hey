import { condition } from '@temporalio/workflow';
import {
  createMockWorkflowState,
  createMockNodeConfiguration,
} from '../../utils/testUtils';
import { NodeType } from '../../types/flow-internal.types';
import { handleAutoNodeExecution } from '../phases/execute-system';
import { executeFlowNode, saveFlowState } from '../phases/shared';
import { WorkflowStep } from '../conversation-workflow-state';

jest.mock('@temporalio/workflow', () => ({
  condition: jest.fn(),
  patched: jest.fn(() => false),
  proxyActivities: () => new Proxy({}, { get: () => jest.fn() }),
  defineSignal: (name: string) => name,
  defineQuery: (name: string) => name,
  setHandler: jest.fn(),
  workflowInfo: () => ({ workflowId: 'workflow-test' }),
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../phases/initialization', () => ({
  loadNodeConfiguration: jest.fn(),
}));
jest.mock('../phases/shared', () => ({
  executeFlowNode: jest.fn(),
  saveFlowState: jest.fn(),
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

it('persists the terminal handoff cursor and completes without waiting for a CLI answer', async () => {
  const state = createMockWorkflowState({
    currentNodeId: 'repository-import-feature-enrichment',
    nodeConfig: createMockNodeConfiguration({
      id: 'repository-import-feature-enrichment',
      type: NodeType.FINALIZE,
      supportsPhases: false,
    }),
    step: WorkflowStep.EXECUTING_AUTO_NODE,
  });
  (executeFlowNode as unknown as jest.Mock).mockResolvedValue({
    requestId: 'handoff-request',
    updatedContext: state.context,
    immediateResponse: {
      requestId: 'handoff-request',
      responseData: {
        type: 'ANALYSIS',
        response: 'Continue in the CLI conversation',
      },
      contextUpdates: [],
    },
  });
  (condition as jest.Mock).mockImplementation(async (predicate) => predicate());
  const result = await handleAutoNodeExecution(state as never);
  expect(saveFlowState).toHaveBeenCalledWith(
    expect.objectContaining({
      workflowState: expect.objectContaining({
        currentNodeId: 'repository-import-feature-enrichment',
      }),
    }),
  );
  expect(result.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
  expect(condition).toHaveBeenCalledTimes(1);
});
