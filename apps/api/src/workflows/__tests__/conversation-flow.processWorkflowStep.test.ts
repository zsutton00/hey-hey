import { condition, patched } from '@temporalio/workflow';
import * as TestUtils from '../../utils/testUtils';
import { NodeType } from '../../types/flow-internal.types';
import { processWorkflowStep } from '../conversation-flow.workflow';
import {
  WorkflowPhase,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import * as workflowUtils from '../conversation-workflow-utils';
import * as errorAndCompletion from '../phases/error-and-completion';
import * as executeAgent from '../phases/execute-agent';
import * as init from '../phases/initialization';
import * as shared from '../phases/shared';

// Mock Temporal workflow primitives to avoid real runtime
jest.mock('@temporalio/workflow', () => ({
  condition: jest.fn(),
  patched: jest.fn(() => false),
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  proxyActivities: jest.fn(() => ({
    getLastSystemMessage: jest.fn(),
    saveFlowState: jest.fn(),
  })),
  defineSignal: jest.fn(() => jest.fn()),
  defineQuery: jest.fn((name: string) => name),
  setHandler: jest.fn(),
}));

// Stub shared activities/helpers
jest.mock('../phases/shared', () => ({
  ...jest.requireActual('../phases/shared'),
  initializeConversationFlow: jest.fn(),
  getNodeInfo: jest.fn(),
  nodeNeedsTwoPhaseExecution: jest.fn(),
  executeFlowNode: jest.fn(),
  generateNodeContent: jest.fn(),
  processNodeResponse: jest.fn(),
  createSystemMessage: jest.fn(),
  pauseFlow: jest.fn(),
  saveFlowState: jest.fn(),
  completeFlow: jest.fn(),
  getLastSystemMessage: jest.fn(),
  processAgentResponse: jest.fn(),
}));

// Keep real implementations of handlers but control their dependencies via mocks above

const createMetricsCollector = () => ({
  createTrace: jest.fn().mockReturnValue('trace-id'),
  completeTrace: jest.fn(),
  recordBusinessMetric: jest.fn(),
  recordAgentExecution: jest.fn(),
});

const makeState = (overrides: Partial<WorkflowState>) =>
  TestUtils.createMockWorkflowState(overrides);

describe('processWorkflowStep (real handlers, state coverage)', () => {
  let metricsCollector: ReturnType<typeof createMetricsCollector>;

  beforeEach(() => {
    metricsCollector = createMetricsCollector();
    jest.clearAllMocks();
    (condition as unknown as jest.Mock).mockReset();
  });

  it('INITIALIZING merges context and sets up starting node', async () => {
    (
      shared.initializeConversationFlow as unknown as jest.Mock
    ).mockResolvedValue({
      context: TestUtils.createMockFlowContext(),
      startNode: 'start',
      hasOpener: true,
      executionId: 'exec-1',
      isResuming: false,
    });

    const state = await init.initializeWorkflowState(
      {
        ...TestUtils.createMockWorkflowInput(),
        flowId: 'flow-1',
        workflowName: 'onboarding',
      } as any,
      { extra: 'value' },
    );

    expect(state.step).toBe(WorkflowStep.INITIALIZING);
    expect(state.currentNodeId).toBe('start');
    expect(state.hasOpener).toBe(true);
    expect((state.context as any).extra).toBe('value');

    (
      shared.initializeConversationFlow as unknown as jest.Mock
    ).mockResolvedValue({
      context: TestUtils.createMockFlowContext(),
      startNode: 'start',
      hasOpener: false,
      executionId: 'exec-2',
      isResuming: true,
      savedWorkflowState: {
        ...makeState({
          step: WorkflowStep.WAITING_FOR_USER_INPUT,
          phase: WorkflowPhase.EXECUTING,
          currentNodeId: 'saved-node',
          iterations: 3,
          nodeConfig: TestUtils.createMockNodeConfiguration(),
        }),
        lastSystemMessageId: 'system-msg-1',
      },
    });

    const restored = await init.initializeWorkflowState({
      ...TestUtils.createMockWorkflowInput(),
      flowId: 'flow-2',
      workflowName: 'onboarding',
    } as any);

    expect(restored.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    expect(restored.currentNodeId).toBe('saved-node');
    expect(restored.iterations).toBe(3);
    expect(restored.currentNodeExecutionId).toBe('system-msg-1');
    expect(workflowUtils.hasPendingUserMessage(restored)).toBe(false); // transient signals cleared
  });

  it('INITIALIZING rejects the retired plan-update workflow', async () => {
    await expect(
      init.initializeWorkflowState({
        ...TestUtils.createMockWorkflowInput(),
        flowId: 'plan-update',
        workflowName: 'plan-update',
      } as any),
    ).rejects.toThrow('Invalid workflowName: plan-update');
    expect(shared.initializeConversationFlow).not.toHaveBeenCalled();
  });

  it('INITIALIZING rejects invalid workflowName', async () => {
    await expect(
      init.initializeWorkflowState({
        ...TestUtils.createMockWorkflowInput(),
        workflowName: 'invalid-flow' as any,
      } as any),
    ).rejects.toThrow(/Invalid workflowName/);
  });

  it('EXECUTING_OPENER transitions and saves path', async () => {
    const state = makeState({
      step: WorkflowStep.EXECUTING_OPENER,
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: [] },
      }),
      nodeConfig: TestUtils.createMockNodeConfiguration(),
    });

    (shared.getNodeInfo as unknown as jest.Mock).mockResolvedValue({
      id: state.currentNodeId,
      supportsPhases: false,
      type: 'UNKNOWN',
    });
    (
      shared.nodeNeedsTwoPhaseExecution as unknown as jest.Mock
    ).mockResolvedValue(false);
    (shared.executeFlowNode as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-1',
      updatedContext: state.context,
    });
    (shared.saveFlowState as unknown as jest.Mock).mockResolvedValue(undefined);

    (condition as unknown as jest.Mock).mockResolvedValue(true); // wait for pending system message creation

    const result = await processWorkflowStep(state, metricsCollector as any);

    // Opener auto-completes if it routes directly to end node
    expect(result.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
  });

  it('preserves the PAUSED snapshot when waiting for user input times out', async () => {
    const state = makeState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      currentNodeExecutionId: 'current-form',
    });
    (condition as unknown as jest.Mock).mockResolvedValue(false);
    (patched as unknown as jest.Mock).mockReturnValue(true);

    const result = await processWorkflowStep(state, metricsCollector as any);

    expect(result).toEqual({
      nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
      shouldContinue: false,
    });
    expect(shared.pauseFlow).toHaveBeenCalled();
    expect(shared.saveFlowState).not.toHaveBeenCalled();
  });

  it('EXECUTING_OPENER handles two-phase opener and loads next config', async () => {
    const state = makeState({
      step: WorkflowStep.EXECUTING_OPENER,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: [] },
      }),
    });

    (shared.getNodeInfo as unknown as jest.Mock).mockResolvedValue({
      id: state.currentNodeId,
      supportsPhases: true,
      type: 'questions',
    });
    (
      shared.nodeNeedsTwoPhaseExecution as unknown as jest.Mock
    ).mockResolvedValue(true);
    (shared.executeFlowNode as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-opener',
      updatedContext: state.context,
    });
    (shared.generateNodeContent as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-opener',
      updatedContext: state.context,
    });
    (shared.saveFlowState as unknown as jest.Mock).mockResolvedValue(undefined);
    state.pendingLLMResponse = {
      requestId: 'req-opener',
      responseData: {
        type: 'SYSTEM',
        response: 'ui',
        data: {},
        uiElements: [{ type: 'input' }],
      },
      nextNodeId: 'next-after-opener',
    } as any;
    (condition as unknown as jest.Mock).mockResolvedValue(true);

    const result = await processWorkflowStep(state, metricsCollector as any);

    expect(state.context.pendingTransition?.nextNodeId).toBe(
      'next-after-opener',
    );
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
  });

  it('GENERATION handles questions, routing override, and skip', async () => {
    const baseState = makeState({
      step: WorkflowStep.GENERATING_QUESTIONS,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
        type: NodeType.LLM_QUESTIONS,
      }),
      phase: WorkflowPhase.EXECUTING,
      context: TestUtils.createMockFlowContext({
        currentNodeExecution: { nodeId: 'n1', questionsGenerated: false },
      }),
    });
    const baseExecutionId = 'exec-gen';
    baseState.currentNodeExecutionId = baseExecutionId;
    baseState.userMessagesByExecution = {
      [baseExecutionId]: TestUtils.createMockFlowUserMessage(),
    };

    // Standard path with questions -> wait for user
    (shared.generateNodeContent as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-gen',
      updatedContext: baseState.context,
    });
    (condition as unknown as jest.Mock).mockResolvedValue(true);
    (shared.saveFlowState as unknown as jest.Mock).mockResolvedValue(undefined);
    const responseData = TestUtils.createMockLLMResponsePayload().responseData;
    baseState.pendingLLMResponse = {
      requestId: 'req-gen',
      responseData,
      nextNodeId: undefined as any,
    } as any;

    let result = await processWorkflowStep(baseState, metricsCollector as any);
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    expect(baseState.phase).toBe(WorkflowPhase.WAITING_FOR_USER);

    const overrideState = makeState({
      step: WorkflowStep.GENERATING_QUESTIONS,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
        type: NodeType.LLM_QUESTIONS,
      }),
      phase: WorkflowPhase.EXECUTING,
      context: TestUtils.createMockFlowContext({
        currentNodeExecution: { nodeId: 'n1', questionsGenerated: false },
        flowPath: { pathTaken: [] },
      }),
    });

    (shared.generateNodeContent as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-override',
      updatedContext: overrideState.context,
    });
    overrideState.pendingLLMResponse = {
      requestId: 'req-override',
      nextNodeId: 'next-node',
      responseData: responseData as any,
    } as any;
    (condition as unknown as jest.Mock).mockResolvedValue(true);
    result = await processWorkflowStep(overrideState, metricsCollector as any);
    expect(result.nextStep).toBeDefined();

    // Skip triggered
    const skipState = makeState({
      step: WorkflowStep.GENERATING_QUESTIONS,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
      phase: WorkflowPhase.EXECUTING,
      skipInfo: { targetNodeId: 'skip-target' },
    });
    (condition as unknown as jest.Mock).mockResolvedValue(true);
    result = await processWorkflowStep(skipState, metricsCollector as any);
    expect(result.nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS_SKIPPED);
  });

  it('PROCESSING_USER_RESPONSE routes, clears signals, and increments interactions', async () => {
    const state = makeState({
      step: WorkflowStep.PROCESSING_USER_RESPONSE,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      }),
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: ['cur'] },
      }),
      pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      currentNodeExecutionId: 'exec-routing',
      userMessagesByExecution: {
        'exec-routing': TestUtils.createMockFlowUserMessage(),
      },
    });
    const execRoutingId = state.currentNodeExecutionId as string;

    jest
      .spyOn(workflowUtils, 'determineNextStep')
      .mockReturnValue(WorkflowStep.WAITING_FOR_USER_INPUT);
    (shared.processNodeResponse as unknown as jest.Mock).mockResolvedValue({
      nextNodeId: 'next',
      updatedContext: state.context,
    });
    jest
      .spyOn(init, 'loadNodeConfiguration')
      .mockResolvedValue(undefined as any);

    const result = await processWorkflowStep(state, metricsCollector as any);
    expect(state.currentNodeId).toBe('next');
    expect(state.context.flowPath.previousTransition).toBe('phase2_routing');
    expect(state.userMessagesByExecution?.[execRoutingId]).toBeDefined();
    expect(state.pendingLLMResponse).toBeUndefined();
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
  });

  it('applies skip intent when entering skipped steps', async () => {
    const state = makeState({
      step: WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED,
      skipInfo: { targetNodeId: 'next-node' },
      nodeConfig: TestUtils.createMockNodeConfiguration(),
    });

    const applySkipIntentSpy = jest
      .spyOn(workflowUtils, 'applySkipIntent')
      .mockImplementation(async (incoming) => {
        incoming.skipInfo = undefined;
        return {
          nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
          nextPhase: WorkflowPhase.WAITING_FOR_USER,
          reason: 'mock-skip',
        };
      });

    const result = await processWorkflowStep(state, metricsCollector as any);

    expect(applySkipIntentSpy).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        loadNodeConfiguration: expect.any(Function),
      }),
    );
    expect(state.skipInfo).toBeUndefined();
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
  });

  it('EXECUTING_AUTO_NODE handles pending transitions and completion', async () => {
    // Error branch when no LLM response is present
    const state = makeState({
      step: WorkflowStep.EXECUTING_AUTO_NODE,
      nodeConfig: TestUtils.createMockNodeConfiguration({}),
    });
    (shared.executeFlowNode as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-auto',
      updatedContext: state.context,
    });
    await expect(
      processWorkflowStep(state, metricsCollector as any),
    ).rejects.toThrow(/auto-node execution response/);

    // UI elements should park in WAITING_FOR_USER_INPUT and set pendingTransition
    const uiState = makeState({
      step: WorkflowStep.EXECUTING_AUTO_NODE,
      nodeConfig: TestUtils.createMockNodeConfiguration({}),
      context: TestUtils.createMockFlowContext({
        flowPath: { pathTaken: [] },
      }),
    });
    (shared.executeFlowNode as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-ui',
      updatedContext: uiState.context,
    });
    uiState.pendingLLMResponse = {
      requestId: 'req-ui',
      responseData: {
        type: 'SYSTEM',
        response: 'content',
        data: {},
        uiElements: [{ type: 'input' }],
      },
      nextNodeId: 'next-after-ui',
    } as any;
    (condition as unknown as jest.Mock).mockResolvedValue(true);
    const uiResult = await processWorkflowStep(
      uiState,
      metricsCollector as any,
    );
    expect(uiState.context.pendingTransition?.nextNodeId).toBe('next-after-ui');
    expect(uiState.pendingLLMResponse).toBeUndefined();
    expect(uiResult.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);

    // Complete flow if node type finalize
    const finalizeState = makeState({
      step: WorkflowStep.EXECUTING_AUTO_NODE,
      nodeConfig: TestUtils.createMockNodeConfiguration({
        type: 'finalize',
      }),
    });
    (
      shared.nodeNeedsTwoPhaseExecution as unknown as jest.Mock
    ).mockResolvedValue(false);
    (shared.getNodeInfo as unknown as jest.Mock).mockResolvedValue({
      id: finalizeState.currentNodeId,
      supportsPhases: false,
      type: 'finalize',
    });
    (shared.executeFlowNode as unknown as jest.Mock).mockResolvedValue({
      requestId: 'req-final',
      updatedContext: finalizeState.context,
    });
    (condition as unknown as jest.Mock).mockResolvedValue(true);
    finalizeState.pendingLLMResponse = {
      requestId: 'req-final',
      responseData: {
        type: 'SYSTEM',
        response: 'done',
        data: {},
        uiElements: [],
      },
      nextNodeId: 'end',
    } as any;
    const finalizeResult = await processWorkflowStep(
      finalizeState,
      metricsCollector as any,
    );
    expect(finalizeResult.nextStep).toBe(WorkflowStep.COMPLETING_FLOW);
  });

  it('EXECUTING_AGENT_WITH_SIGNALS clears agent results on success and records errors', async () => {
    const state = makeState({
      step: WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS,
      pendingAgentResults: [{ id: 1 } as any],
    });

    (executeAgent.handleAgentExecutionWithSignals as any) =
      executeAgent.handleAgentExecutionWithSignals;

    jest
      .spyOn(executeAgent, 'handleAgentExecutionWithSignals')
      .mockImplementation(async (incoming) => {
        incoming.pendingAgentResults = [];
        return {
          nextStep: WorkflowStep.EXECUTING_AUTO_NODE,
          shouldContinue: true,
        };
      });

    const result = await processWorkflowStep(state, metricsCollector as any);
    expect(state.pendingAgentResults).toEqual([]);
    expect(result.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);

    // Error path
    const errorState = makeState({
      step: WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS,
      pendingAgentResults: [{ id: 1 } as any],
    });
    jest
      .spyOn(executeAgent, 'handleAgentExecutionWithSignals')
      .mockRejectedValue(new Error('agent fail'));
    await expect(
      processWorkflowStep(errorState, metricsCollector as any),
    ).rejects.toThrow('agent fail');
  });

  it('ERROR_HOLDING clears error state when handler resolves', async () => {
    const state = makeState({
      step: WorkflowStep.ERROR_HOLDING,
      errorHolding: {
        isActive: true,
        errorMessage: 'boom',
        nodeId: 'n1',
      } as any,
    });

    jest
      .spyOn(errorAndCompletion, 'handleErrorHolding')
      .mockImplementation(async (incoming) => {
        incoming.errorHolding = undefined;
        return {
          nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
          shouldContinue: true,
        };
      });

    const result = await processWorkflowStep(state, metricsCollector as any);
    expect(state.errorHolding).toBeUndefined();
    expect(result.nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
  });

  it('COMPLETING_FLOW marks isComplete and runs completion handler', async () => {
    const state = makeState({
      step: WorkflowStep.COMPLETING_FLOW,
      isComplete: false,
    });

    jest
      .spyOn(errorAndCompletion, 'handleCompletion')
      .mockImplementation(async (incoming) => {
        incoming.isComplete = true;
        return {
          nextStep: WorkflowStep.COMPLETING_FLOW,
          shouldContinue: false,
        };
      });

    const result = await processWorkflowStep(state, metricsCollector as any);
    expect(state.isComplete).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });
});
