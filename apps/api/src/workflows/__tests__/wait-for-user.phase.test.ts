import { condition, patched } from '@temporalio/workflow';
import * as TestUtils from '../../utils/testUtils';
import { WorkflowPhase, WorkflowStep } from '../conversation-workflow-state';
import * as workflowUtils from '../conversation-workflow-utils';
import { loadNodeConfiguration } from '../phases/initialization';
import { handleUserWait } from '../phases/wait-for-user';
import {
  pauseFlow,
  processNodeUserResponseHook,
  saveFlowState,
} from '../phases/shared';

// Mock Temporal workflow primitives and shared helpers to keep tests fast
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

jest.mock('../phases/initialization', () => ({
  loadNodeConfiguration: jest.fn(),
}));

jest.mock('../phases/shared', () => ({
  pauseFlow: jest.fn(),
  processNodeUserResponseHook: jest.fn(async ({ context }) => ({
    updatedContext: context,
  })),
  saveFlowState: jest.fn(),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('handleUserWait phase logic', () => {
  const mockedCondition = condition as jest.Mock;
  const mockedPatched = patched as jest.Mock;
  const mockedProcessNodeUserResponseHook =
    processNodeUserResponseHook as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPatched.mockReturnValue(false);
  });

  it('returns skipped step immediately when skip intent is present', async () => {
    mockedCondition.mockImplementation((predicate: () => boolean) =>
      Promise.resolve(predicate()),
    );

    const state = TestUtils.createMockWorkflowState({
      pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      skipInfo: { targetNodeId: 'skip-target' },
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      }),
    });

    const result = await handleUserWait(state as any);

    expect(state.pendingLLMResponse).toBeUndefined(); // cleared before waiting
    expect(state.skipInfo).toEqual({ targetNodeId: 'skip-target' });
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED);
  });

  it('executes pending transitions then clears handled user input for single-phase nodes', async () => {
    mockedCondition.mockResolvedValue(true);
    (loadNodeConfiguration as jest.Mock).mockImplementation((incomingState) => {
      incomingState.nodeConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      });
    });
    const execId = 'exec-1';

    const state = TestUtils.createMockWorkflowState({
      currentNodeId: 'opener-node',
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      }),
      currentNodeExecutionId: execId,
      userMessagesByExecution: {
        [execId]: TestUtils.createMockFlowUserMessage(),
      },
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: ['opener-node'] },
        pendingTransition: {
          nextNodeId: 'next-node-id',
          reason: 'opener_complete',
        },
      }),
    });

    const result = await handleUserWait(state as any);

    expect(saveFlowState).toHaveBeenCalled(); // state persisted after applying pending transition
    expect(loadNodeConfiguration).toHaveBeenCalled(); // configuration refreshed for the new node
    expect(state.context.pendingTransition).toBeUndefined(); // transition consumed
    expect(state.currentNodeId).toBe('next-node-id');
    expect(state.context.flowPath.previousTransition).toBe('opener_complete');
    expect(state.userMessagesByExecution?.[execId]).toBeDefined(); // cleanup deferred to centralized transition handling
    expect(result.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
  });

  it('completes immediately when workflow is already marked complete', async () => {
    mockedCondition.mockResolvedValue(true);

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      isComplete: true,
      pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
    });

    const result = await handleUserWait(state as any);

    expect(state.pendingLLMResponse).toBeUndefined(); // cleared on entry
    expect(result.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
  });

  it('transitions to ERROR_HOLDING when errorHolding is active', async () => {
    mockedCondition.mockResolvedValue(true);

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      errorHolding: {
        isActive: true,
        errorMessage: 'oops',
        nodeId: 'n1',
      } as any,
      pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
    });

    const result = await handleUserWait(state as any);

    expect(state.pendingLLMResponse).toBeUndefined(); // cleared before holding
    expect(result.nextStep).toBe(WorkflowStep.ERROR_HOLDING);
  });

  it('times out when no user response arrives', async () => {
    mockedPatched.mockReturnValue(true);
    mockedCondition
      .mockResolvedValueOnce(false) // first wait for user message
      .mockResolvedValueOnce(true); // wait for completion

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      nodeConfig: TestUtils.createMockNodeConfiguration(),
    });

    const result = await handleUserWait(state as any);

    expect(pauseFlow).toHaveBeenCalled();
    expect(result).toEqual({
      nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
      shouldContinue: false,
    });
  });

  it('processes pending transition, saves state, and loads configuration', async () => {
    mockedCondition.mockResolvedValue(true);
    (loadNodeConfiguration as jest.Mock).mockImplementation(() => {});
    const determineNextStepSpy = jest
      .spyOn(workflowUtils, 'determineNextStep')
      .mockReturnValue(WorkflowStep.PROCESSING_USER_RESPONSE);

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      currentNodeId: 'opener',
      currentNodeExecutionId: 'exec-opener',
      userMessagesByExecution: {
        'exec-opener': TestUtils.createMockFlowUserMessage(),
      },
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: ['opener'] },
        pendingTransition: {
          nextNodeId: 'next-node',
          reason: 'opener_complete',
        },
      }),
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
    });

    const result = await handleUserWait(state as any);

    expect(saveFlowState).toHaveBeenCalled();
    expect(loadNodeConfiguration).toHaveBeenCalled();
    expect(determineNextStepSpy).toHaveBeenCalledWith(state);
    expect(state.currentNodeId).toBe('next-node');
    expect(state.context.pendingTransition).toBeUndefined();
    expect(result.nextStep).toBe(WorkflowStep.PROCESSING_USER_RESPONSE);
  });

  it('calls processUserResponse hook before pending transition when patch is enabled', async () => {
    mockedCondition.mockResolvedValue(true);
    mockedPatched.mockReturnValue(true);
    (loadNodeConfiguration as jest.Mock).mockImplementation(() => {});
    mockedProcessNodeUserResponseHook.mockImplementation(
      async ({ context }: { context: Record<string, unknown> }) => ({
        updatedContext: {
          ...context,
          planGoal: 'captured from opener response',
        },
      }),
    );

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      currentNodeId: 'opener',
      currentNodeExecutionId: 'exec-opener',
      userMessagesByExecution: {
        'exec-opener': TestUtils.createMockFlowUserMessage({
          data: { plan_update_user_journey: 'A -> B -> C' },
        }),
      },
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: ['opener'] },
        pendingTransition: {
          nextNodeId: 'next-node',
          reason: 'opener_complete',
        },
      }),
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
    });

    await handleUserWait(state as any);

    expect(mockedProcessNodeUserResponseHook).toHaveBeenCalledWith({
      flowId: state.flowId,
      nodeId: 'opener',
      context: expect.objectContaining({
        pendingTransition: {
          nextNodeId: 'next-node',
          reason: 'opener_complete',
        },
      }),
      userMessage: expect.objectContaining({
        data: { plan_update_user_journey: 'A -> B -> C' },
      }),
    });
    expect((state.context as Record<string, unknown>).planGoal).toBe(
      'captured from opener response',
    );
  });

  it('executes single-phase nodes immediately after receiving user input', async () => {
    mockedCondition.mockResolvedValue(true);

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      currentNodeExecutionId: 'exec-1',
      userMessagesByExecution: {
        'exec-1': TestUtils.createMockFlowUserMessage(),
      },
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      }),
      context: TestUtils.createMockFlowContext({
        pendingTransition: undefined,
      }),
    });

    const result = await handleUserWait(state as any);

    expect(
      state.userMessagesByExecution?.[state.currentNodeExecutionId as string],
    ).toBeDefined();
    expect(result.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
  });

  it('falls back to determineNextStep when no special cases are hit', async () => {
    mockedCondition.mockResolvedValue(true);
    const determineNextStepSpy = jest
      .spyOn(workflowUtils, 'determineNextStep')
      .mockReturnValue(WorkflowStep.GENERATING_QUESTIONS);

    const state = TestUtils.createMockWorkflowState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
      phase: WorkflowPhase.WAITING_FOR_USER,
    });

    const result = await handleUserWait(state as any);

    expect(determineNextStepSpy).toHaveBeenCalledWith(state);
    expect(result.nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS);
  });
});
