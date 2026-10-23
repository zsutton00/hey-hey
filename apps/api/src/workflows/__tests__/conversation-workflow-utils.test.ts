import * as TestUtils from '../../utils/testUtils';
import { WorkflowAboutType } from '../../types';
import { WorkflowPhase, WorkflowStep } from '../conversation-workflow-state';
import * as workflowUtils from '../conversation-workflow-utils';
import {
  applySkipIntent,
  applyTransition,
  computeNextStepAndPhase,
  createDefaultNodeConfig,
  createStepTransition,
  determineNextStep,
  determineNodePhase,
  incrementInteractionCount,
  transitionToNextNode,
  transitionToStep,
  validateWorkflowState,
  WorkflowSignals,
  clearPendingLlmSignal,
  getActiveUserMessage,
  prepareStartRunKickoffGate,
  recordStartRunKickoff,
} from '../conversation-workflow-utils';

const { testIds, testNodeIds, testWorkflowIds } = TestUtils;

// Mock the @temporalio/workflow module without circular reference
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

// Import the mocked log for use in tests
import { log } from '@temporalio/workflow';
const mockLog = log as jest.Mocked<typeof log>;

describe('ConversationWorkflowUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records a START_RUN kickoff correlation exactly once, including CONTROL input', () => {
    const state = TestUtils.createMockWorkflowState({
      currentNodeExecutionId: undefined,
      userMessagesByExecution: {},
    });
    prepareStartRunKickoffGate(state, true);
    const handled = new Set<string>();
    const kickoff = {
      operationId: 'operation-1',
      message: {
        id: testIds.message,
        type: 'USER' as const,
        projectId: state.projectId,
        conversationId: state.conversationId,
        userId: state.userId!,
        status: 'completed' as const,
        data: { type: 'CONTROL' as const, comment: ' ' },
        createdAt: '2026-08-22T00:00:00.000Z',
        timestamp: '2026-08-22T00:00:00.000Z',
      },
    };

    expect(recordStartRunKickoff(state, handled, kickoff)).toBe(true);
    expect(recordStartRunKickoff(state, handled, kickoff)).toBe(false);
    expect(handled).toEqual(new Set(['operation-1']));
    expect(
      state.userMessagesByExecution![`startRunKickoff:${state.workflowId}`],
    ).toEqual(
      kickoff.message,
    );
    expect(getActiveUserMessage(state)).toEqual(kickoff.message);
    expect(state.lastUserMessageId).toBe(testIds.message);
  });

  describe('createStepTransition', () => {
    it('should create transition with default shouldContinue true', () => {
      const transition = createStepTransition(
        WorkflowStep.EXECUTING_AUTO_NODE,
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );

      expect(transition).toEqual({
        nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
        shouldContinue: true,
      });
    });

    it('should create transition with custom shouldContinue', () => {
      const transition = createStepTransition(
        WorkflowStep.EXECUTING_AUTO_NODE,
        WorkflowStep.COMPLETING_FLOW,
        false,
      );

      expect(transition).toEqual({
        nextStep: WorkflowStep.COMPLETING_FLOW,
        shouldContinue: false,
      });
    });

    it('should handle all workflow steps', () => {
      const steps = Object.values(WorkflowStep);

      steps
        .filter((step) => step !== WorkflowStep.EXECUTING_AUTO_NODE)
        .forEach((step) => {
          const transition = createStepTransition(
            WorkflowStep.EXECUTING_AUTO_NODE,
            step,
          );
          expect(transition.nextStep).toBe(step);
          expect(transition.shouldContinue).toBe(true);
        });
    });
  });

  describe('transitionToStep', () => {
    it('should update workflow state step and log transition', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
      });

      transitionToStep(
        state,
        WorkflowStep.WAITING_FOR_USER_INPUT,
        'test transition',
      );

      expect(state.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
      expect(mockLog.debug).toHaveBeenCalledWith(
        '[transitionToStep] Step transition',
        {
          from: WorkflowStep.INITIALIZING,
          to: WorkflowStep.WAITING_FOR_USER_INPUT,
          reason: 'test transition',
          nodeId: state.currentNodeId,
          workflowId: state.workflowId,
        },
      );
    });

    it('should handle transitions without reason', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.EXECUTING_OPENER,
      });

      transitionToStep(state, WorkflowStep.GENERATING_QUESTIONS);

      expect(state.step).toBe(WorkflowStep.GENERATING_QUESTIONS);
      expect(mockLog.debug).toHaveBeenCalledWith(
        '[transitionToStep] Step transition',
        expect.objectContaining({
          from: WorkflowStep.EXECUTING_OPENER,
          to: WorkflowStep.GENERATING_QUESTIONS,
          reason: undefined,
        }),
      );
    });

    it('should preserve other state properties', () => {
      const originalState = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
        iterations: 5,
        isComplete: false,
        currentNodeId: testNodeIds.gather,
      });

      const stateCopy = { ...originalState };

      transitionToStep(stateCopy, WorkflowStep.COMPLETING_FLOW);

      expect(stateCopy.step).toBe(WorkflowStep.COMPLETING_FLOW);
      expect(stateCopy.iterations).toBe(originalState.iterations);
      expect(stateCopy.isComplete).toBe(originalState.isComplete);
      expect(stateCopy.currentNodeId).toBe(originalState.currentNodeId);
    });
  });

  describe('transitionToNextNode', () => {
    it('should update node tracking and reset execution state', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: testNodeIds.opener,
        context: TestUtils.createMockFlowContext({
          flowPath: {
            pathTaken: [testNodeIds.opener],
          },
        }),
      });

      transitionToNextNode(state, testNodeIds.gather, 'opener_complete');

      expect(state.currentNodeId).toBe(testNodeIds.gather);
      expect(state.context.flowPath.previousNode).toBe(testNodeIds.opener);
      expect(state.context.flowPath.previousTransition).toBe('opener_complete');
      expect(state.context.flowPath.pathTaken).toContain(testNodeIds.opener);
      expect(state.phase).toBe(WorkflowPhase.EXECUTING);

      expect(state.context.currentNodeExecution).toEqual({
        nodeId: testNodeIds.gather,
        questionsGenerated: false,
      });
    });

    it('should avoid duplicate entries in pathTaken', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: testNodeIds.gather,
        context: TestUtils.createMockFlowContext({
          flowPath: {
            pathTaken: [testNodeIds.opener, testNodeIds.gather],
          },
        }),
      });

      transitionToNextNode(state, testNodeIds.auto, 'routing_complete');

      // Should not duplicate gather node in path
      const gatherCount = state.context.flowPath.pathTaken.filter(
        (node) => node === testNodeIds.gather,
      ).length;

      expect(gatherCount).toBe(1);
      expect(state.context.flowPath.pathTaken).toEqual([
        testNodeIds.opener,
        testNodeIds.gather,
      ]);
    });

    it('should log node transition details', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: testNodeIds.opener,
        context: TestUtils.createMockFlowContext({
          flowPath: { pathTaken: [] },
        }),
      });

      transitionToNextNode(state, testNodeIds.gather, 'user_response');

      expect(mockLog.debug).toHaveBeenCalledWith('[Workflow] Node transition', {
        from: testNodeIds.opener,
        to: testNodeIds.gather,
        transition: 'user_response',
        pathTaken: [testNodeIds.opener],
        workflowId: state.workflowId,
      });
    });

    it('should handle circular node transitions', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: testNodeIds.gather,
        context: TestUtils.createMockFlowContext({
          flowPath: {
            pathTaken: [
              testNodeIds.opener,
              testNodeIds.gather,
              testNodeIds.auto,
            ],
          },
        }),
      });

      // Transition back to gather node
      transitionToNextNode(state, testNodeIds.gather, 'retry');

      expect(state.currentNodeId).toBe(testNodeIds.gather);
      expect(state.context.flowPath.previousNode).toBe(testNodeIds.gather);
      expect(state.context.flowPath.previousTransition).toBe('retry');

      // Path should contain only one instance of each node traversed
      const pathCounts = state.context.flowPath.pathTaken.reduce(
        (counts, node) => {
          counts[node] = (counts[node] || 0) + 1;
          return counts;
        },
        {} as Record<string, number>,
      );

      expect(pathCounts[testNodeIds.gather]).toBe(1);
    });
  });

  describe('determineNodePhase', () => {
    it('should return executing for non-phase supporting nodes', () => {
      const nodeConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: false,
      });

      const execution = { questionsGenerated: false };

      const phase = determineNodePhase(nodeConfig, execution);

      expect(phase).toBe(WorkflowPhase.EXECUTING);
    });

    it('should return executing for phase nodes without questions', () => {
      const nodeConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      });

      const execution = { questionsGenerated: false };

      const phase = determineNodePhase(nodeConfig, execution);

      expect(phase).toBe(WorkflowPhase.EXECUTING);
    });

    it('should return waiting_for_user for phase nodes with questions', () => {
      const nodeConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      });

      const execution = { questionsGenerated: true };

      const phase = determineNodePhase(nodeConfig, execution);

      expect(phase).toBe(WorkflowPhase.WAITING_FOR_USER);
    });

    it('should handle edge cases in execution state', () => {
      const nodeConfig = TestUtils.createMockNodeConfiguration({
        supportsPhases: true,
      });

      // Undefined execution
      const undefinedPhase = determineNodePhase(nodeConfig, undefined as any);
      expect(undefinedPhase).toBe('executing');

      // Missing questionsGenerated property
      const missingPropPhase = determineNodePhase(nodeConfig, {} as any);
      expect(missingPropPhase).toBe('executing');
    });
  });

  describe('computeNextStepAndPhase', () => {
    it('routes to processing only when questions are generated and a user message exists', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: true,
        }),
        context: TestUtils.createMockFlowContext({
          currentNodeExecution: {
            nodeId: 'n1',
            questionsGenerated: true,
          },
        }),
      });

      const decisionWithMessage = computeNextStepAndPhase(state, {
        currentStep: state.step,
        currentPhase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: state.nodeConfig,
        hasUserMessage: true,
        userMessageReceivedFlag: true,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
        currentNodeExecution: state.context.currentNodeExecution,
      });

      expect(decisionWithMessage.nextStep).toBe(
        WorkflowStep.PROCESSING_USER_RESPONSE,
      );
      expect(decisionWithMessage.nextPhase).toBe(
        WorkflowPhase.PROCESSING_USER_RESPONSE,
      );
      expect(state.step).toBe(WorkflowStep.INITIALIZING);

      const decisionWithoutMessage = computeNextStepAndPhase(state, {
        currentStep: state.step,
        currentPhase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: state.nodeConfig,
        hasUserMessage: false,
        userMessageReceivedFlag: false,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
        currentNodeExecution: state.context.currentNodeExecution,
      });

      expect(decisionWithoutMessage.nextStep).toBe(
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );
      expect(decisionWithoutMessage.nextPhase).toBe(
        WorkflowPhase.WAITING_FOR_USER,
      );
    });

    it('computes defaults for phased and single-phase nodes without mutation', () => {
      const phasedState = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.EXECUTING,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: true,
        }),
      });

      const phasedDecision = computeNextStepAndPhase(phasedState, {
        currentStep: phasedState.step,
        currentPhase: phasedState.phase,
        nodeConfig: phasedState.nodeConfig,
        hasUserMessage: false,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
      });

      expect(phasedDecision.nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS);
      expect(phasedDecision.nextPhase).toBe(WorkflowPhase.EXECUTING);

      const autoState = TestUtils.createMockWorkflowState({
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: false,
          type: 'action',
        }),
      });

      const autoDecision = computeNextStepAndPhase(autoState, {
        currentStep: autoState.step,
        currentPhase: autoState.phase,
        nodeConfig: autoState.nodeConfig,
        hasUserMessage: false,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
      });

      expect(autoDecision.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
      expect(autoDecision.nextPhase).toBe(WorkflowPhase.EXECUTING);

      const finalizeState = TestUtils.createMockWorkflowState({
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: false,
          type: 'finalize',
        }),
      });

      const finalizeDecision = computeNextStepAndPhase(finalizeState, {
        currentStep: finalizeState.step,
        currentPhase: finalizeState.phase,
        nodeConfig: finalizeState.nodeConfig,
        hasUserMessage: false,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
      });

      expect(finalizeDecision.nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
      expect(finalizeDecision.nextPhase).toBe(WorkflowPhase.EXECUTING);

      const singlePhaseState = TestUtils.createMockWorkflowState({
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: false,
          type: 'unknown' as any,
        }),
      });

      const singlePhaseDecision = computeNextStepAndPhase(singlePhaseState, {
        currentStep: singlePhaseState.step,
        currentPhase: singlePhaseState.phase,
        nodeConfig: singlePhaseState.nodeConfig,
        hasUserMessage: false,
        skipInfo: null,
        pendingLLMResponse: undefined,
        pendingAgentResults: undefined,
        isComplete: false,
      });

      expect(singlePhaseDecision.nextStep).toBe(
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );
      expect(singlePhaseDecision.nextPhase).toBe(
        WorkflowPhase.WAITING_FOR_USER,
      );
      expect(autoState.step).toBe(WorkflowStep.INITIALIZING);
    });
  });

  describe('determineNextStep', () => {
    it('should return GENERATING_QUESTIONS for questions phase', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.EXECUTING,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: true,
        }),
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.GENERATING_QUESTIONS);
    });

    it('should return PROCESSING_USER_RESPONSE when questions generated and message present', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: true,
        }),
        userMessagesByExecution: {
          exec1: TestUtils.createMockFlowUserMessage(),
        },
        currentNodeExecutionId: 'exec1',
        context: TestUtils.createMockFlowContext({
          currentNodeExecution: {
            nodeId: 'node-1',
            questionsGenerated: true,
          },
        }),
        waitingForUserInputFlags: {
          userMessageReceived: true,
        },
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.PROCESSING_USER_RESPONSE);
    });

    it('should return WAITING_FOR_USER_INPUT when questions generated but no user message', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.WAITING_FOR_USER,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: true,
        }),
        context: TestUtils.createMockFlowContext({
          currentNodeExecution: {
            nodeId: 'node-1',
            questionsGenerated: true,
          },
        }),
        waitingForUserInputFlags: {
          userMessageReceived: false,
        },
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    });

    it('should return WAITING_FOR_USER_INPUT as default for single phase nodes', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.EXECUTING,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: false,
        }),
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    });

    it('should return EXECUTING_AGENT_WITH_SIGNALS for signal processing nodes', () => {
      const state = TestUtils.createMockWorkflowState({
        nodeConfig: TestUtils.createMockNodeConfiguration({
          enableSignalProcessing: true,
          supportsPhases: false,
        }),
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS);
    });

    it('should prioritize signal processing over phased execution', () => {
      const state = TestUtils.createMockWorkflowState({
        nodeConfig: TestUtils.createMockNodeConfiguration({
          enableSignalProcessing: true,
          supportsPhases: true,
        }),
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS);
    });

    it('should auto-execute known single-phase types', () => {
      const state = TestUtils.createMockWorkflowState({
        phase: WorkflowPhase.EXECUTING,
        nodeConfig: TestUtils.createMockNodeConfiguration({
          supportsPhases: false,
          type: 'action',
        }),
      });

      const nextStep = determineNextStep(state);

      expect(nextStep).toBe(WorkflowStep.EXECUTING_AUTO_NODE);
    });
  });

  describe('applyTransition', () => {
    it('preserves skip intent and transients when phase is unchanged', () => {
      const execId = 'exec-apply';
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
        skipInfo: { targetNodeId: 'next' },
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
        pendingAgentResults: [{ id: 'pending-agent' } as any],
        userMessagesByExecution: {
          [execId]: TestUtils.createMockFlowUserMessage(),
        },
        currentNodeExecutionId: execId,
      });

      applyTransition(
        state,
        {
          nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
          nextPhase: WorkflowPhase.WAITING_FOR_USER,
          reason: 'skip applied',
        },
        WorkflowPhase.WAITING_FOR_USER,
      );

      expect(state.skipInfo).toEqual({ targetNodeId: 'next' });
      expect(state.pendingLLMResponse).toBeDefined();
      expect(state.pendingAgentResults).toBeDefined();
      expect(
        state.userMessagesByExecution?.[state.currentNodeExecutionId as string],
      ).toBeDefined();
    });

    it('cleans executing transients on phase change', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.EXECUTING_AUTO_NODE,
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
        pendingAgentResults: [{ id: 'pending' } as any],
      });

      applyTransition(
        state,
        {
          nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
          nextPhase: WorkflowPhase.WAITING_FOR_USER,
          reason: 'phase change',
        },
        WorkflowPhase.EXECUTING,
      );

      expect(state.pendingLLMResponse).toBeUndefined();
      expect(state.pendingAgentResults).toBeUndefined();
      expect(state.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
    });

    it('clears skip intent when leaving waiting phase', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
        phase: WorkflowPhase.WAITING_FOR_USER,
        skipInfo: { targetNodeId: 'next' },
      });

      applyTransition(
        state,
        {
          nextStep: WorkflowStep.GENERATING_QUESTIONS,
          nextPhase: WorkflowPhase.EXECUTING,
          reason: 'phase change to executing',
        },
        WorkflowPhase.WAITING_FOR_USER,
      );

      expect(state.skipInfo).toBeUndefined();
      expect(state.phase).toBe(WorkflowPhase.EXECUTING);
      expect(state.step).toBe(WorkflowStep.GENERATING_QUESTIONS);
    });

    it('preserves executing transients when phase is unchanged and derives nextPhase', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.GENERATING_QUESTIONS,
        phase: WorkflowPhase.EXECUTING,
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
        pendingAgentResults: [{ id: 'pending' } as any],
      });

      applyTransition(
        state,
        {
          nextStep: WorkflowStep.GENERATING_QUESTIONS,
          nextPhase: WorkflowPhase.EXECUTING,
          reason: 'stay executing',
        },
        WorkflowPhase.EXECUTING,
      );

      expect(state.phase).toBe(WorkflowPhase.EXECUTING);
      expect(state.pendingLLMResponse).toBeDefined();
      expect(state.pendingAgentResults).toBeDefined();
    });
  });

  describe('applySkipIntent', () => {
    it('applies skip intent, reloads config, and clears transients', async () => {
      const loadNodeConfiguration = jest.fn().mockResolvedValue(undefined);
      const state = TestUtils.createMockWorkflowState({
        skipInfo: { targetNodeId: 'next-node' },
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
        pendingAgentResults: [{ id: 'pending' } as any],
      });

      jest
        .spyOn(workflowUtils, 'determineNextStep')
        .mockReturnValue(WorkflowStep.WAITING_FOR_USER_INPUT);

      const result = await applySkipIntent(state, { loadNodeConfiguration });

      expect(loadNodeConfiguration).toHaveBeenCalledWith(state);
      expect(state.currentNodeId).toBe('next-node');
      expect(state.currentNodeExecutionId).toBeUndefined();
      expect(state.pendingLLMResponse).toBeUndefined();
      expect(state.pendingAgentResults).toBeUndefined();
      expect(state.context.currentNodeExecution?.nodeId).toBe('next-node');
      expect(state.skipInfo).toBeUndefined();
      expect(result).toEqual({
        nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
        nextPhase: WorkflowPhase.WAITING_FOR_USER,
        reason: 'skip applied via explicit step',
      });
    });

    it('throws when called without skipInfo', async () => {
      const state = TestUtils.createMockWorkflowState({
        skipInfo: undefined,
      });

      await expect(applySkipIntent(state)).rejects.toThrow(
        'applySkipIntent called without skipInfo',
      );
    });
  });

  describe('clearPendingSignals', () => {
    it('should clear all pending signals by default', () => {
      const execId = 'exec-1';
      const state = TestUtils.createMockWorkflowState({
        currentNodeExecutionId: execId,
        userMessagesByExecution: {
          [execId]: TestUtils.createMockFlowUserMessage(),
        },
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      });

      clearPendingLlmSignal(state, '');

      expect(state.userMessagesByExecution?.[execId]).toBeDefined();
      expect(state.pendingLLMResponse).toBeUndefined();
    });

    it('should preserve triggering message when preserveTriggeringMessage is true', () => {
      const execId = 'exec-1';
      const userMessage = TestUtils.createMockFlowUserMessage();
      const state = TestUtils.createMockWorkflowState({
        currentNodeExecutionId: execId,
        userMessagesByExecution: {
          [execId]: userMessage,
        },
        pendingLLMResponse: TestUtils.createMockLLMResponsePayload(),
      });

      clearPendingLlmSignal(state, '');

      expect(state.userMessagesByExecution?.[execId]).toBe(userMessage);
      expect(state.pendingLLMResponse).toBeUndefined();
    });

    it('should allow preserving pending user message while clearing LLM response', () => {
      const userMessage = TestUtils.createMockFlowUserMessage();
      const llmResponse = TestUtils.createMockLLMResponsePayload();
      const execId = 'exec-1';
      const state = TestUtils.createMockWorkflowState({
        currentNodeExecutionId: execId,
        userMessagesByExecution: {
          [execId]: userMessage,
        },
        pendingLLMResponse: llmResponse,
      });

      clearPendingLlmSignal(state, '');

      expect(state.userMessagesByExecution?.[execId]).toBe(userMessage);
      expect(state.pendingLLMResponse).toBeUndefined();
    });
  });

  // updateContextWithUserData function has been removed as gatheredData no longer exists in FlowContext

  describe('incrementInteractionCount', () => {
    it('should increment interaction count in context', () => {
      const state = TestUtils.createMockWorkflowState({
        context: TestUtils.createMockFlowContext({
          core: {
            projectId: testIds.project,
            organizationId: testIds.organization,
            conversationId: testIds.conversation,
            workflowId: testIds.workflow,
            workflowAboutId: testIds.initiative,
            workflowAboutType: 'initiative' as WorkflowAboutType,
            user: { id: testIds.user, role: 'member' },
            session: { startTime: new Date(), interactionCount: 5 },
          },
        }),
      });

      incrementInteractionCount(state);

      expect(state.context.core.session.interactionCount).toBe(6);
      expect(mockLog.debug).toHaveBeenCalledWith(
        '[Workflow] Interaction count incremented',
        {
          count: 6,
          nodeId: state.currentNodeId,
          workflowId: state.workflowId,
        },
      );
    });

    it('should handle zero initial count', () => {
      const state = TestUtils.createMockWorkflowState({
        context: TestUtils.createMockFlowContext({
          core: {
            projectId: testIds.project,
            organizationId: testIds.organization,
            conversationId: testIds.conversation,
            workflowId: testIds.workflow,
            workflowAboutId: testIds.initiative,
            workflowAboutType: 'initiative' as WorkflowAboutType,
            user: { id: testIds.user, role: 'member' },
            session: { startTime: new Date(), interactionCount: 0 },
          },
        }),
      });

      incrementInteractionCount(state);

      expect(state.context.core.session.interactionCount).toBe(1);
    });

    it('should maintain other session properties', () => {
      const startTime = new Date('2024-01-01');

      const state = TestUtils.createMockWorkflowState({
        context: TestUtils.createMockFlowContext({
          core: {
            projectId: testIds.project,
            organizationId: testIds.organization,
            conversationId: testIds.conversation,
            workflowId: testIds.workflow,
            workflowAboutId: testIds.initiative,
            workflowAboutType: 'initiative' as WorkflowAboutType,
            user: { id: testIds.user, role: 'member' },
            session: { startTime, interactionCount: 3 },
          },
        }),
      });

      incrementInteractionCount(state);

      expect(state.context.core.session.startTime).toBe(startTime);
      expect(state.context.core.session.interactionCount).toBe(4);
    });
  });

  describe('validateWorkflowState', () => {
    it('should pass validation for valid state', () => {
      const state = TestUtils.createMockWorkflowState();

      expect(() => validateWorkflowState(state)).not.toThrow();
    });

    it('should throw for missing currentNodeId', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: '',
      });

      expect(() => validateWorkflowState(state)).toThrow(
        'WorkflowState: currentNodeId is required',
      );
    });

    it('should throw for missing context', () => {
      const state = TestUtils.createMockWorkflowState({
        context: null as any,
      });

      expect(() => validateWorkflowState(state)).toThrow(
        'WorkflowState: context is required',
      );
    });

    it('should throw for missing nodeConfig', () => {
      const state = TestUtils.createMockWorkflowState({
        nodeConfig: null as any,
      });

      expect(() => validateWorkflowState(state)).toThrow(
        'WorkflowState: nodeConfig is required',
      );
    });

    it('should throw for exceeded iterations', () => {
      const state = TestUtils.createMockWorkflowState({
        iterations: 25,
        maxIterations: 20,
      });

      expect(() => validateWorkflowState(state)).toThrow(
        'WorkflowState: Maximum iterations (20) exceeded',
      );
    });

    it('should handle edge case of exactly max iterations', () => {
      const state = TestUtils.createMockWorkflowState({
        iterations: 20,
        maxIterations: 20,
      });

      expect(() => validateWorkflowState(state)).toThrow(
        'WorkflowState: Maximum iterations (20) exceeded',
      );
    });

    it('should pass when iterations is below max', () => {
      const state = TestUtils.createMockWorkflowState({
        iterations: 19,
        maxIterations: 20,
      });

      expect(() => validateWorkflowState(state)).not.toThrow();
    });
  });

  describe('createDefaultNodeConfig', () => {
    it('should create basic node configuration', () => {
      const nodeId = testNodeIds.gather;

      const config = createDefaultNodeConfig(nodeId);

      expect(config).toEqual({
        id: nodeId,
        type: 'LLM_QUESTIONS',
        supportsPhases: false,
      });
    });

    it('should handle different node IDs', () => {
      const nodeIds = [
        testNodeIds.opener,
        testNodeIds.gather,
        testNodeIds.auto,
        testNodeIds.completion,
        'custom-node-123',
      ];

      nodeIds.forEach((nodeId) => {
        const config = createDefaultNodeConfig(nodeId);
        expect(config.id).toBe(nodeId);
        expect(config.type).toBe('LLM_QUESTIONS');
        expect(config.supportsPhases).toBe(false);
      });
    });

    it('should create consistent configuration structure', () => {
      const config = createDefaultNodeConfig('test-node');

      expect(typeof config.id).toBe('string');
      expect(typeof config.supportsPhases).toBe('boolean');

      expect(Object.keys(config)).toEqual(['id', 'type', 'supportsPhases']);
    });
  });

  describe('WorkflowSignals', () => {
    it('should generate workflow-scoped user message signal names', () => {
      const workflowId1 = testWorkflowIds.systemDriven;
      const workflowId2 = testWorkflowIds.userDriven;

      const signal1 =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId1);
      const signal2 =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId2);

      expect(signal1).toBe(`userMessage-${workflowId1}`);
      expect(signal2).toBe(`userMessage-${workflowId2}`);
      expect(signal1).not.toBe(signal2);
    });

    it('should generate workflow-scoped LLM response signal names', () => {
      const workflowId1 = testWorkflowIds.gatherNode;
      const workflowId2 = testWorkflowIds.autoNode;

      const signal1 = WorkflowSignals.getLLMResponseSignalName(workflowId1);
      const signal2 = WorkflowSignals.getLLMResponseSignalName(workflowId2);

      expect(signal1).toBe(`llmResponse-${workflowId1}`);
      expect(signal2).toBe(`llmResponse-${workflowId2}`);
      expect(signal1).not.toBe(signal2);
    });

    it('should generate workflow-scoped completion signal names', () => {
      const workflowId = testWorkflowIds.systemDriven;

      const signal =
        WorkflowSignals.getWorkflowCompletionSignalName(workflowId);

      expect(signal).toBe(`completion-${workflowId}`);
    });

    it('should prevent signal name collisions across workflows', () => {
      const workflows = Object.values(testWorkflowIds);
      const allSignals = new Set<string>();

      workflows.forEach((workflowId) => {
        const userSignal =
          WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
        const llmSignal = WorkflowSignals.getLLMResponseSignalName(workflowId);
        const completionSignal =
          WorkflowSignals.getWorkflowCompletionSignalName(workflowId);

        expect(allSignals.has(userSignal)).toBe(false);
        expect(allSignals.has(llmSignal)).toBe(false);
        expect(allSignals.has(completionSignal)).toBe(false);

        allSignals.add(userSignal);
        allSignals.add(llmSignal);
        allSignals.add(completionSignal);
      });

      expect(allSignals.size).toBe(workflows.length * 3);
    });

    it('should maintain consistent signal naming patterns', () => {
      const workflowId = 'test-workflow-123';

      const userSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(workflowId);
      const llmSignal = WorkflowSignals.getLLMResponseSignalName(workflowId);
      const completionSignal =
        WorkflowSignals.getWorkflowCompletionSignalName(workflowId);

      expect(userSignal).toMatch(/^userMessage-/);
      expect(llmSignal).toMatch(/^llmResponse-/);
      expect(completionSignal).toMatch(/^completion-/);

      expect(userSignal.endsWith(workflowId)).toBe(true);
      expect(llmSignal.endsWith(workflowId)).toBe(true);
      expect(completionSignal.endsWith(workflowId)).toBe(true);
    });

    it('should handle special characters in workflow IDs', () => {
      const specialWorkflowId = 'workflow_123-test.special';

      const userSignal =
        WorkflowSignals.getWorkflowUserMessageSignalName(specialWorkflowId);
      const llmSignal =
        WorkflowSignals.getLLMResponseSignalName(specialWorkflowId);
      const completionSignal =
        WorkflowSignals.getWorkflowCompletionSignalName(specialWorkflowId);

      expect(userSignal).toBe(`userMessage-${specialWorkflowId}`);
      expect(llmSignal).toBe(`llmResponse-${specialWorkflowId}`);
      expect(completionSignal).toBe(`completion-${specialWorkflowId}`);
    });
  });

  describe('utility function integration', () => {
    it('should support complete workflow state transitions', () => {
      const state = TestUtils.createMockWorkflowState({
        step: WorkflowStep.INITIALIZING,
        currentNodeId: testNodeIds.opener,
        phase: WorkflowPhase.EXECUTING,
        iterations: 0,
      });

      // Simulate a complete workflow progression

      // 1. Initialize
      validateWorkflowState(state);

      // 2. Transition to opener execution
      transitionToStep(
        state,
        WorkflowStep.EXECUTING_OPENER,
        'initialization_complete',
      );
      incrementInteractionCount(state);

      // 3. Transition to next node
      transitionToNextNode(state, testNodeIds.gather, 'opener_complete');
      state.nodeConfig = TestUtils.createMockNodeConfiguration({
        id: testNodeIds.gather,
        supportsPhases: true,
      });
      state.phase = determineNodePhase(state.nodeConfig, {
        questionsGenerated: false,
      });

      // 4. Determine next step and execute
      const nextStep = determineNextStep(state);
      transitionToStep(state, nextStep, 'node_transition');

      // 5. Clear signals and validate final state
      clearPendingLlmSignal(state, '');
      validateWorkflowState(state);

      // Verify complete progression
      expect(state.step).toBe(WorkflowStep.WAITING_FOR_USER_INPUT);
      expect(state.currentNodeId).toBe(testNodeIds.gather);
      expect(state.phase).toBe('executing');
      expect(state.context.core.session.interactionCount).toBe(2);
      expect(
        state.currentNodeExecutionId
          ? state.userMessagesByExecution?.[state.currentNodeExecutionId]
          : undefined,
      ).toBeUndefined();
      expect(state.pendingLLMResponse).toBeUndefined();
    });

    it('should handle error scenarios gracefully', () => {
      const state = TestUtils.createMockWorkflowState({
        currentNodeId: '',
        context: null as any,
        nodeConfig: null as any,
      });

      // Validation should catch errors
      expect(() => validateWorkflowState(state)).toThrow();

      // Fix the state
      state.currentNodeId = testNodeIds.gather;
      state.context = TestUtils.createMockFlowContext();
      state.nodeConfig = createDefaultNodeConfig(testNodeIds.gather);

      // Should now pass validation
      expect(() => validateWorkflowState(state)).not.toThrow();
    });
  });
});
