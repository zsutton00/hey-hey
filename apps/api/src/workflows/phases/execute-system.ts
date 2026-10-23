import { condition } from '@temporalio/workflow';
import { NodeType } from '../../types/flow-internal.types';
import {
  hasUiElements,
  isErrorSystemMessageData,
} from '../../utils/type-checks';
import {
  AutoNodeExecutionWorkflowState,
  GenerationWorkflowState,
  StepTransitionResult,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  createStepTransition,
  determineNextStep,
  getActiveUserMessage,
  incrementInteractionCount,
  setCurrentExecutionId,
  transitionToNextNode,
} from '../conversation-workflow-utils';
import { loadNodeConfiguration } from './initialization';
import {
  executeFlowNode,
  generateNodeContent,
  log,
  saveFlowState,
} from './shared';

/**
 * Handles content generation (Phase 1 for two-phase nodes)
 * - LLM_QUESTIONS nodes: Generate questions for user input
 * - GENERATE nodes: Generate content for user review
 */
export async function handleGeneration(
  state: GenerationWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:Generation] Generating content (Phase 1)', {
    nodeId: state.currentNodeId,
    phase: state.phase,
    nodeType: state.nodeConfig.type,
  });

  // Use triggering message for first execution after routing
  let userMessage = getActiveUserMessage(state);
  if (
    state.triggeringUserMessage &&
    !state.context.currentNodeExecution?.questionsGenerated
  ) {
    userMessage = state.triggeringUserMessage;
    state.triggeringUserMessage = undefined; // Clear after use
  }

  // Generate content (questions for LLM_QUESTIONS, content for GENERATE)
  const result = await generateNodeContent({
    flowId: state.flowId,
    nodeId: state.currentNodeId,
    context: state.context,
    userMessage,
    lastUserMessageId: state.lastUserMessageId,
  });
  // Bind execution/request ids to this request (drives user response ownership)
  setCurrentExecutionId(state, result.requestId, 'handleGeneration');

  state.context = result.updatedContext;
  if (state.context.currentNodeExecution) {
    state.context.currentNodeExecution.questionsGenerated = true;
  }

  // EXTERNAL_AGENT nodes complete inline inside the activity (no worker job,
  // no signal round-trip). The activity returns the LLMResponsePayload the
  // worker would have signaled; surface it as state.pendingLLMResponse so
  // the existing wait condition below resolves on the first tick instead of
  // timing out after 5 minutes. See NodeExecutionService.startExternalAgentNode.
  if (result.immediateResponse) {
    state.pendingLLMResponse = result.immediateResponse;
    log.debug(
      '[Handler:Generation] Surfaced immediateResponse as pendingLLMResponse',
      {
        requestId: result.requestId,
        nodeId: state.currentNodeId,
        nodeType: state.nodeConfig.type,
      },
    );
  }

  log.debug('[Handler:Generation] Waiting for content generation response', {
    requestId: result.requestId,
    nodeId: state.currentNodeId,
    nodeType: state.nodeConfig.type,
  });

  // Wait for LLM response
  const responseReceived = await condition(
    () =>
      Boolean(
        state.isComplete ||
          state.skipInfo ||
          state.errorHolding?.isActive ||
          (state.pendingLLMResponse !== undefined &&
            state.pendingLLMResponse.requestId === result.requestId),
      ),
    '5m',
  );

  if (!responseReceived) {
    throw new Error(
      `Timeout waiting for question generation response for request ${result.requestId}`,
    );
  }

  if (state.isComplete) {
    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  }

  // Handle error holding signal
  if (state.errorHolding?.isActive) {
    log.debug(
      '[Handler:Generation] Error holding detected during content generation',
      {
        nodeId: state.currentNodeId,
        workflowId: state.workflowId,
      },
    );
    clearPendingLlmSignal(state, 'handleGeneration (errorHolding)');
    return createStepTransition(state.step, WorkflowStep.ERROR_HOLDING);
  }

  // Handle skip node signal
  if (state.skipInfo) {
    return createStepTransition(
      state.step,
      WorkflowStep.GENERATING_QUESTIONS_SKIPPED,
    );
  }

  // Save state after question generation
  await saveFlowState({
    workflowState: state,
    executionId: state.executionId,
  });

  // Check if the response contains questions or UI elements that require user input
  const responseData = state.pendingLLMResponse?.responseData;
  const hasUIElements = hasUiElements(responseData);

  // Check if there's a routing override AND no questions to answer
  if (state.pendingLLMResponse?.nextNodeId && !hasUIElements) {
    log.debug(
      '[Handler:Questions] No questions detected or routing override, proceeding with normal flow',
      {
        currentNodeId: state.currentNodeId,
        nextNodeId: state.pendingLLMResponse.nextNodeId,
        nodeType: state.nodeConfig.type,
        hasUIElements,
      },
    );

    if (
      state.nodeConfig.type === (NodeType.CLASSIFICATION as string) &&
      state.pendingLLMResponse
    ) {
      const responseData = state.pendingLLMResponse.responseData as {
        detectedIntent: string;
        intentConfidence?: number;
        reasoning?: string;
        classifierPayload?: Record<string, unknown>;
      };

      state.context.lastClassification = {
        nodeId: state.currentNodeId,
        transition: responseData.detectedIntent,
        timestamp: new Date().toISOString(),
        ...(responseData.intentConfidence !== undefined
          ? { confidence: responseData.intentConfidence }
          : {}),
        ...(responseData.reasoning !== undefined
          ? { reasoning: responseData.reasoning }
          : {}),
        ...(responseData.classifierPayload
          ? { payload: responseData.classifierPayload }
          : {}),
      };
    }

    const nextNodeId = state.pendingLLMResponse.nextNodeId;

    clearPendingLlmSignal(state, 'handleGeneration (first if)');
    incrementInteractionCount(state);

    // For FINALIZE nodes with no UI elements, complete the workflow
    if (
      state.nodeConfig.type === (NodeType.FINALIZE as string) &&
      !hasUIElements
    ) {
      return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
    }

    // Transition to the next node after action execution
    transitionToNextNode(
      state,
      nextNodeId,
      hasUIElements ? 'routing_override' : 'no_questions',
    );

    // Load new node configuration
    await loadNodeConfiguration(state);

    // Use determineNextStep to get the correct step based on node configuration
    const nextStep = determineNextStep(state);
    return createStepTransition(state.step, nextStep);
  }

  clearPendingLlmSignal(state, 'handleGeneration');
  incrementInteractionCount(state);

  const persistedState: WorkflowState = {
    ...state,
    step: WorkflowStep.WAITING_FOR_USER_INPUT,
  };

  await saveFlowState({
    workflowState: persistedState,
    executionId: state.executionId,
  });

  // Phase 1 complete, wait for user response
  return createStepTransition(state.step, WorkflowStep.WAITING_FOR_USER_INPUT);
}

/**
 * Handles execution of auto-continuing nodes
 */
export async function handleAutoNodeExecution(
  state: AutoNodeExecutionWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:AutoNode] Executing auto-continuing node', {
    nodeId: state.currentNodeId,
  });

  // Execute the node
  const result = await executeFlowNode({
    flowId: state.flowId,
    nodeId: state.currentNodeId,
    context: state.context,
    userMessage: getActiveUserMessage(state),
    lastUserMessageId: state.lastUserMessageId,
  });

  state.context = result.updatedContext;
  // Bind execution/request ids to this request (drives user response ownership)
  setCurrentExecutionId(state, result.requestId, 'handleAutoNodeExecution');

  log.debug('[Handler:AutoNode] Waiting for auto-node response', {
    requestId: result.requestId,
    nodeId: state.currentNodeId,
  });

  // Wait for LLM response with detailed condition debugging
  log.debug('[CONDITION_DEBUG] Starting condition wait for LLM response', {
    expectedRequestId: result.requestId,
    currentPendingLLMResponse: !!state.pendingLLMResponse,
    currentPendingRequestId: state.pendingLLMResponse?.requestId,
    workflowId: state.workflowId,
  });

  const responseReceived = await condition(() => {
    const hasResponse = state.pendingLLMResponse !== undefined;
    const requestIdMatches =
      state.pendingLLMResponse?.requestId === result.requestId;
    const isComplete = state.isComplete;
    const skipPending = state.skipInfo;
    const hasError = state.errorHolding?.isActive;

    log.debug('[CONDITION_DEBUG] Condition check', {
      hasResponse,
      requestIdMatches,
      isComplete,
      skipPending: !!skipPending,
      hasError,
      expectedRequestId: result.requestId,
      actualRequestId: state.pendingLLMResponse?.requestId,
      conditionMet:
        isComplete ||
        skipPending ||
        hasError ||
        (hasResponse && requestIdMatches),
    });

    return Boolean(
      isComplete ||
        skipPending ||
        hasError ||
        (hasResponse && requestIdMatches),
    );
  }, '5m');

  if (!responseReceived) {
    throw new Error(
      `Timeout waiting for auto-node execution response for request ${result.requestId}`,
    );
  }

  if (state.isComplete) {
    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  }

  // Handle error holding signal
  if (state.errorHolding?.isActive) {
    log.debug(
      '[Handler:AutoNode] Error holding detected during auto-node execution',
      {
        nodeId: state.currentNodeId,
        workflowId: state.workflowId,
      },
    );
    clearPendingLlmSignal(state, 'handleAutoNodeExecution (errorHolding)');
    return createStepTransition(state.step, WorkflowStep.ERROR_HOLDING);
  }

  // Handle skip node signal
  if (state.skipInfo) {
    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED,
    );
  }

  // Process response
  const response = state.pendingLLMResponse;
  if (!response) {
    throw new Error('No LLM response received for auto-node execution');
  }

  log.debug('[Handler:AutoNode] LLM response received', {
    hasResponse: !!response,
    nextNodeId: response?.nextNodeId,
    responseDataType: response?.responseData?.type,
  });

  if (
    !response.nextNodeId &&
    state.nodeConfig.type !== (NodeType.FINALIZE as string)
  ) {
    log.error('[Handler:AutoNode] CRITICAL: Auto-node has no nextNodeId!', {
      nodeId: state.currentNodeId,
      responseKeys: Object.keys(response || {}),
      responseData: response?.responseData,
    });
    throw new Error(
      `DEBUG: Auto-node ${state.currentNodeId} has no nextNodeId. Response: ${JSON.stringify(response)}`,
    );
  }

  // Validate response data
  if (isErrorSystemMessageData(response.responseData)) {
    const errorContext = response.responseData.context;
    throw new Error(
      typeof errorContext === 'string' ? errorContext : 'Unknown error',
    );
  }

  // Check if the auto-node response contains UI elements that require user input
  const responseData = response.responseData;
  const uiElements =
    responseData && 'uiElements' in responseData
      ? responseData.uiElements
      : undefined;
  const hasUIElements =
    Array.isArray(uiElements) && uiElements.filter(Boolean).length > 0;

  let transition = 'default';

  if (responseData) {
    const detectedIntent = (
      responseData as {
        detectedIntent?: unknown;
      }
    )?.detectedIntent;

    if (typeof detectedIntent === 'string') {
      transition = detectedIntent;
    }
  }

  log.debug('[Handler:AutoNode] Checking UI elements', {
    hasResponseData: !!responseData,
    hasUIElements,
    // typescript can't infer uiElements is defined from `hasUiElements` checks...
    uiElementsLength: uiElements?.length ?? 0,
    nextNodeId: response.nextNodeId,
  });

  if (
    hasUIElements &&
    (response.nextNodeId ||
      state.nodeConfig.type === (NodeType.FINALIZE as string))
  ) {
    // If auto-node has UI elements, wait for user input before transitioning
    log.debug(
      '[Handler:AutoNode] Auto-node has UI elements, waiting for user input',
      {
        nodeId: state.currentNodeId,
        uiElementsCount: uiElements?.length ?? 0,
        nextNodeId: response.nextNodeId,
        nodeType: state.nodeConfig.type,
      },
    );

    // Store the next node ID for later transition (or workflow completion for FINALIZE nodes)
    if (state.nodeConfig.type === (NodeType.FINALIZE as string)) {
      // FINALIZE nodes complete workflow after user confirmation - no next node needed
      log.debug(
        '[Handler:AutoNode] FINALIZE node will complete workflow after user confirmation',
      );
    } else if (response.nextNodeId) {
      // For regular nodes, store the next node ID for later transition
      state.context.pendingTransition = {
        nextNodeId: response.nextNodeId,
        reason: 'auto_node_complete',
      };
    }

    clearPendingLlmSignal(state, 'handleAutoNodeExecution (first if)');

    const persistedState: WorkflowState = {
      ...state,
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
    };

    // Save state after auto-node but don't transition yet
    await saveFlowState({
      workflowState: persistedState,
      executionId: state.executionId,
    });

    // Wait for user input on the auto-node message
    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT,
    );
  } else {
    // If no UI elements or no next node, proceed with immediate transition or completion
    log.debug(
      '[Handler:AutoNode] No UI elements - proceeding with immediate transition',
      {
        hasUIElements,
        nextNodeId: response.nextNodeId,
        currentNodeId: state.currentNodeId,
      },
    );

    // FINALIZE nodes without UI elements complete immediately
    if (state.nodeConfig.type === (NodeType.FINALIZE as string)) {
      log.debug(
        '[Handler:AutoNode] FINALIZE node with no UI elements - completing workflow',
        { nodeId: state.currentNodeId },
      );
      return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
    }

    // Save state after execution
    await saveFlowState({
      workflowState: state,
      executionId: state.executionId,
    });

    // Handle node transition if specified
    if (response.nextNodeId && response.nextNodeId !== state.currentNodeId) {
      log.debug('[Handler:AutoNode] Executing node transition', {
        from: state.currentNodeId,
        to: response.nextNodeId,
      });

      transitionToNextNode(state, response.nextNodeId, transition);

      // Load new node configuration
      await loadNodeConfiguration(state);
    }
    // Determine next step
    const nextStep = determineNextStep(state);

    clearPendingLlmSignal(state, 'handleAutoNodeExecution');
    incrementInteractionCount(state);

    log.debug('[Handler:AutoNode] Auto-node execution complete', {
      nextStep,
      currentNodeId: state.currentNodeId,
      iterations: state.iterations,
    });
    return createStepTransition(state.step, nextStep);
  }
}
