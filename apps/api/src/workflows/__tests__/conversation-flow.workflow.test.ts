import { condition } from '@temporalio/workflow';
import * as TestUtils from '../../utils/testUtils';
import {
  WorkflowPhase,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import { handleInitialization } from '../phases/initialization';
import { handleOpenerExecution } from '../phases/opener';
import {
  executeFlowNode,
  saveFlowState,
  createSystemMessage,
} from '../phases/shared';
import { loadNodeConfiguration } from '../phases/initialization';
import { SystemMessageResponseType } from '../../generated';
import { ExtendedUIFieldType } from '../../generated';
import { determineNextStep } from '../conversation-workflow-utils';

jest.mock('@temporalio/workflow', () => ({
  condition: jest.fn(),
  patched: jest.fn(() => false),
  proxyActivities: () => new Proxy({}, { get: () => jest.fn() }),
  defineSignal: (name: string) => name,
  defineQuery: (name: string) => name,
  setHandler: jest.fn(),
  workflowInfo: () => ({ workflowId: 'wf-test' }),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../phases/shared', () => ({
  executeFlowNode: jest.fn(),
  saveFlowState: jest.fn(),
  createSystemMessage: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../phases/initialization', () => {
  const actual = jest.requireActual('../phases/initialization');
  return {
    ...actual,
    loadNodeConfiguration: jest.fn(),
  };
});

// We rely on determineNextStep staying pure; keep the real implementation.
jest.mock('../conversation-workflow-utils', () => {
  const actual = jest.requireActual('../conversation-workflow-utils');
  return {
    ...actual,
  };
});

describe('conversationFlowWorkflow (unitized handlers)', () => {
  const mockedCondition = condition as jest.Mock;
  const mockedExecuteFlowNode = executeFlowNode as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initialization keeps opener first when present', async () => {
    const state = TestUtils.createMockWorkflowState({
      hasOpener: true,
      currentNodeId: 'welcome-opener',
      step: WorkflowStep.INITIALIZING,
      phase: WorkflowPhase.INITIALIZING,
    });

    const transition = await handleInitialization(state as any);

    expect(transition.nextStep).toBe(WorkflowStep.EXECUTING_OPENER);
    expect(loadNodeConfiguration).not.toHaveBeenCalled();
  });

  it('opener honors skip signal without executing the opener node', async () => {
    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.EXECUTING_OPENER,
      phase: WorkflowPhase.EXECUTING,
      currentNodeId: 'adr-refinement-welcome',
      skipInfo: {
        targetNodeId: 'adr-refinement-welcome',
        systemMessageComplete: true,
      },
    });

    const result = await handleOpenerExecution(state as any);

    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED);
    expect(mockedExecuteFlowNode).not.toHaveBeenCalled();
  });

  it('opener with UI elements waits for user input and persists pending transition', async () => {
    mockedCondition.mockImplementation((predicate: () => boolean) =>
      Promise.resolve(predicate()),
    );
    mockedExecuteFlowNode.mockResolvedValue({
      requestId: TestUtils.testIds.request,
      updatedContext: TestUtils.createMockFlowContext(),
    });

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.EXECUTING_OPENER,
      phase: WorkflowPhase.EXECUTING,
      hasOpener: true,
      currentNodeId: 'welcome-opener',
      pendingLLMResponse: {
        requestId: TestUtils.testIds.request,
        responseData: {
          type: 'QUESTIONS',
          response: 'Test prompt',
          detectedIntent: 'test_intent',
          intentConfidence: 0.9,
          uiElements: [
            {
              type: ExtendedUIFieldType.TextInput,
              id: 'ui',
              label: 'Test input',
              influences: [],
            },
          ],
        },
        nextNodeId: 'next-node',
      },
    });

    const result = await handleOpenerExecution(state as any);

    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    expect(saveFlowState).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowState: expect.objectContaining({
          step: WorkflowStep.WAITING_FOR_USER_INPUT,
          context: expect.objectContaining({
            pendingTransition: expect.objectContaining({
              nextNodeId: 'next-node',
              reason: 'opener_complete',
            }),
          }),
        }),
      }),
    );
    expect(state.currentNodeExecutionId).toBe(TestUtils.testIds.request);
  });

  it('opener without UI elements transitions immediately to next step', async () => {
    mockedCondition.mockImplementation((predicate: () => boolean) =>
      Promise.resolve(predicate()),
    );
    mockedExecuteFlowNode.mockResolvedValue({
      requestId: TestUtils.testIds.request,
      updatedContext: TestUtils.createMockFlowContext(),
    });
    (loadNodeConfiguration as jest.Mock).mockImplementation((incoming) => {
      incoming.nodeConfig = TestUtils.createMockNodeConfiguration({
        id: 'next-node',
        type: 'action', // auto-continue
        supportsPhases: false,
      });
    });

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.EXECUTING_OPENER,
      phase: WorkflowPhase.EXECUTING,
      currentNodeId: 'welcome-opener',
      pendingLLMResponse: {
        requestId: TestUtils.testIds.request,
        responseData: {
          type: 'QUESTIONS',
          response: 'Test prompt',
          detectedIntent: 'test_intent',
          intentConfidence: 0.9,
          uiElements: [],
        },
        nextNodeId: 'next-node',
      },
    });

    const result = await handleOpenerExecution(state as any);

    expect(loadNodeConfiguration).toHaveBeenCalled();
    expect(result.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
    expect(saveFlowState).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowState: expect.objectContaining({
          step: WorkflowStep.EXECUTING_AUTO_NODE,
          currentNodeId: 'next-node',
        }),
      }),
    );
    expect(state.pendingLLMResponse).toBeUndefined();
  });

  it('respects skip intent during opener and keeps execution loop running', async () => {
    mockedCondition.mockImplementation((predicate: () => boolean) =>
      Promise.resolve(predicate()),
    );
    mockedExecuteFlowNode.mockResolvedValue({
      requestId: TestUtils.testIds.request,
      updatedContext: TestUtils.createMockFlowContext(),
    });

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.EXECUTING_OPENER,
      skipInfo: { targetNodeId: 'target' },
      pendingLLMResponse: {
        requestId: TestUtils.testIds.request,
        responseData: {
          type: 'QUESTIONS',
          response: 'Test prompt',
          detectedIntent: 'test_intent',
          intentConfidence: 0.9,
          uiElements: [],
        },
        nextNodeId: 'next-node',
      },
    });

    const result = await handleOpenerExecution(state as any);

    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED);
    expect(saveFlowState).not.toHaveBeenCalled();
  });

  it('sends error system message and transitions to completion on opener failure', async () => {
    mockedCondition.mockImplementation((predicate: () => boolean) =>
      Promise.resolve(predicate()),
    );
    mockedExecuteFlowNode.mockRejectedValue(new Error('opener failure'));

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.EXECUTING_OPENER,
      phase: WorkflowPhase.EXECUTING,
      currentNodeId: 'welcome-opener',
      hasOpener: true,
    });

    const result = await handleOpenerExecution(state as any);

    expect(createSystemMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'welcome-opener',
        nodeResult: expect.objectContaining({
          data: expect.objectContaining({ errorType: 'opener_error' }),
        }),
      }),
    );
    expect(result.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
  });
});
