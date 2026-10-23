import { condition } from '@temporalio/workflow';
import { NodeType } from '../../types/flow-internal.types';
import {
  OpenerExecutionWorkflowState,
  StepTransitionResult,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  createStepTransition,
  determineNextStep,
  incrementInteractionCount,
  setCurrentExecutionId,
  transitionToNextNode,
} from '../conversation-workflow-utils';
import { hasUiElements } from '../../utils/type-checks';
import { loadNodeConfiguration } from './initialization';
import {
  log,
  createSystemMessage,
  executeFlowNode,
  saveFlowState,
} from './shared';

/**
 * Handles opener execution for flows with opening nodes
 */
export async function handleOpenerExecution(
  state: OpenerExecutionWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:Opener] Executing opener node', {
    nodeId: state.currentNodeId,
    flowId: state.flowId,
  });

  if (state.skipInfo) {
    log.debug('[Handler:Opener] Skip signal received before execution', {
      nodeId: state.currentNodeId,
      workflowId: state.workflowId,
      systemMessageComplete: state.skipInfo.systemMessageComplete,
    });

    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED,
    );
  }

  try {
    // Execute opener node
    const { requestId, updatedContext } = await executeFlowNode({
      flowId: state.flowId,
      nodeId: state.currentNodeId,
      context: state.context,
      userMessage: undefined, // No user message for opener
      lastUserMessageId: undefined,
    });

    // Bind execution/request ids to this request (drives user response ownership)
    setCurrentExecutionId(state, requestId, 'handleOpenerExecution');

    state.context = updatedContext;

    log.debug('[Handler:Opener] Waiting for opener response', {
      requestId,
      nodeId: state.currentNodeId,
    });

    // Wait for opener execution response
    const responseReceived = await condition(
      () =>
        Boolean(
          state.isComplete ||
            state.skipInfo ||
            (state.pendingLLMResponse !== undefined &&
              state.pendingLLMResponse.requestId === requestId),
        ),
      '30s',
    );

    if (!responseReceived) {
      throw new Error('Timeout waiting for opener node response');
    }

    if (state.isComplete) {
      return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
    }

    // Handle skip node signal
    if (state.skipInfo) {
      return createStepTransition(
        state.step,
        WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED,
      );
    }

    // Process opener response
    const response = state.pendingLLMResponse;
    if (!response?.nextNodeId) {
      throw new Error('Opener response missing nextNodeId');
    }

    // Check if the opener response contains UI elements that require user input
    const responseData = response.responseData;
    const responseDataForLog = responseData as typeof responseData & {
      triggersAgent?: {
        promptType?: unknown;
        nodeId?: unknown;
        triggerMessageId?: unknown;
      };
      uiElements?: Array<{ type?: unknown }>;
      response?: unknown;
    };
    const triggerForLog = responseDataForLog.triggersAgent;
    const uiElementsForLog = Array.isArray(responseDataForLog.uiElements)
      ? responseDataForLog.uiElements
      : [];
    log.debug('[Handler:Opener] Opener response diagnostic', {
      event: 'workflow.opener.response_diagnostic',
      requestId: response.requestId,
      nodeId: state.currentNodeId,
      nextNodeId: response.nextNodeId,
      responseType: responseDataForLog.type,
      responseLength:
        typeof responseDataForLog.response === 'string'
          ? responseDataForLog.response.length
          : undefined,
      uiElementTypes: uiElementsForLog.map((element) => element?.type),
      hasUiElements: hasUiElements(responseData),
      hasTriggersAgent: !!triggerForLog,
      triggerPromptType: triggerForLog?.promptType,
      triggerNodeId: triggerForLog?.nodeId,
      triggerMessageId: triggerForLog?.triggerMessageId,
    });
    if (hasUiElements(responseData)) {
      // If opener has UI elements, wait for user input before transitioning
      log.debug(
        '[Handler:Opener] Opener has UI elements, waiting for user input',
        {
          nodeId: state.currentNodeId,
          uiElementsCount: responseData.uiElements.length,
          nextNodeId: response.nextNodeId,
          requestId: response.requestId,
        },
      );

      // Store the next node ID for later transition
      state.context.pendingTransition = {
        nextNodeId: response.nextNodeId,
        reason: 'opener_complete',
      };

      clearPendingLlmSignal(state, 'handleOpenerExecution (first if)');

      const persistedState: WorkflowState = {
        ...state,
        step: WorkflowStep.WAITING_FOR_USER_INPUT,
      };

      // Save state after opener but don't transition yet
      await saveFlowState({
        workflowState: persistedState,
        executionId: state.executionId,
      });

      // Wait for user input on the opener message
      return createStepTransition(
        state.step,
        WorkflowStep.WAITING_FOR_USER_INPUT,
      );
    } else {
      // If no UI elements, proceed with immediate transition
      log.info('[Handler:Opener] Opener advancing immediately', {
        event: 'workflow.opener.advance_immediately',
        requestId: response.requestId,
        nodeId: state.currentNodeId,
        nextNodeId: response.nextNodeId,
      });
      transitionToNextNode(state, response.nextNodeId, 'opener_complete');

      clearPendingLlmSignal(state, 'handleOpenerExecution');
      incrementInteractionCount(state);

      // Load new node config and determine next step
      await loadNodeConfiguration(state);
      const nextStep = determineNextStep(state);

      // Persist a coherent snapshot where step and node align
      const persistedState: WorkflowState = {
        ...state,
        step: nextStep,
      };

      await saveFlowState({
        workflowState: persistedState,
        executionId: state.executionId,
      });

      return createStepTransition(state.step, nextStep);
    }
  } catch (error) {
    log.error('[Handler:Opener] Error executing opener', {
      error: (error as Error).message,
      nodeId: state.currentNodeId,
    });

    // Send error message
    await createSystemMessage({
      conversationId: state.conversationId,
      organizationId: state.organizationId,
      nodeResult: {
        type: NodeType.ERROR,
        message:
          'I encountered an issue starting our conversation. Please try again later.',
        data: {
          context: (error as Error).name,
          errorType: 'opener_error',
          temporary: false,
          intentConfidence: 1,
          detectedIntent: '',
        },
      },
      nodeId: state.currentNodeId,
      flowId: state.flowId,
      context: state.context,
    });

    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  }
}
