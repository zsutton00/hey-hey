import { condition } from '@temporalio/workflow';
import { NodeType } from '../../../types/flow-internal.types';
import {
  GenerationWorkflowState,
  WorkflowPhase,
  WorkflowStep,
} from '../../conversation-workflow-state';
import * as workflowUtils from '../../conversation-workflow-utils';
import * as TestUtils from '../../../utils/testUtils';
import { handleGeneration } from '../execute-system';

// Mock Temporal workflow primitives
jest.mock('@temporalio/workflow', () => ({
  condition: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  proxyActivities: jest.fn(() => ({})),
  defineSignal: jest.fn(() => jest.fn()),
  defineQuery: jest.fn((name: string) => name),
  setHandler: jest.fn(),
  patched: jest.fn(() => false),
  sleep: jest.fn(() => Promise.resolve()),
}));

// Mock shared activities/helpers
jest.mock('../shared', () => ({
  generateNodeContent: jest.fn(),
  saveFlowState: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../initialization', () => ({
  loadNodeConfiguration: jest.fn(),
}));

jest.mock('../../conversation-workflow-utils', () => ({
  ...jest.requireActual('../../conversation-workflow-utils'),
  setCurrentExecutionId: jest.fn(),
  clearPendingLlmSignal: jest.fn(),
  incrementInteractionCount: jest.fn(),
  transitionToNextNode: jest.fn(),
  determineNextStep: jest.fn(),
  getActiveUserMessage: jest.fn(),
}));

import * as shared from '../shared';
import * as init from '../initialization';

describe('execute-system', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (condition as unknown as jest.Mock).mockReset();
  });

  describe('handleGeneration', () => {
    it('surfaces immediateResponse so the condition resolves on the first tick', async () => {
      const requestId = TestUtils.testIds.request;
      const immediateResponse = TestUtils.createMockLLMResponsePayload({
        requestId,
        nextNodeId: 'next-node',
        responseData: {
          type: 'AGENT',
          response: 'Immediate agent response',
          detectedIntent: 'test_intent',
          intentConfidence: 0.9,
          uiElements: [],
          actions: [],
        },
      });

      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.GENERATING_QUESTIONS,
        phase: WorkflowPhase.EXECUTING,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          type: NodeType.EXTERNAL_AGENT,
          supportsPhases: true,
        }),
        context: TestUtils.createMockFlowContext({
          currentNodeExecution: { nodeId: 'agent-node', questionsGenerated: false },
          flowPath: { pathTaken: [] },
        }),
      }) as GenerationWorkflowState;

      (shared.generateNodeContent as unknown as jest.Mock).mockResolvedValue({
        requestId,
        updatedContext: state.context,
        immediateResponse,
      });

      // Mock condition to evaluate the predicate synchronously.
      // If immediateResponse is NOT surfaced to state.pendingLLMResponse,
      // the predicate will be false and condition resolves false,
      // causing a timeout error to be thrown.
      (condition as unknown as jest.Mock).mockImplementation(
        async (predicate: () => boolean) => predicate(),
      );

      (shared.saveFlowState as unknown as jest.Mock).mockResolvedValue(undefined);
      (init.loadNodeConfiguration as unknown as jest.Mock).mockResolvedValue(undefined);
      (workflowUtils.determineNextStep as jest.Mock).mockReturnValue(
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );

      const result = await handleGeneration(state);

      // Verify immediateResponse was surfaced
      expect(state.pendingLLMResponse).toEqual(immediateResponse);

      // Verify condition evaluated to true because pendingLLMResponse was pre-populated
      expect(condition).toHaveBeenCalledWith(
        expect.any(Function),
        '5m',
      );
      expect(shared.saveFlowState).toHaveBeenCalled();
      expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    });
  });
});
