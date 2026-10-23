import { condition } from '@temporalio/workflow';
import { SystemMessageResponseType } from '../../generated';
import {
  AgentExecutionResultPayload,
  NodeType,
} from '../../types/flow-internal.types';
import {
  hasUiElements,
  isErrorSystemMessageData,
} from '../../utils/type-checks';
import {
  AgentExecutionWorkflowState,
  StepTransitionResult,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  createStepTransition,
  determineNextStep,
  incrementInteractionCount,
  getActiveUserMessage,
  transitionToNextNode,
  setCurrentExecutionId,
} from '../conversation-workflow-utils';
import { loadNodeConfiguration } from './initialization';
import {
  createSystemMessage,
  executeFlowNode,
  log,
  saveFlowState,
} from './shared';

/**
 * Handles agent execution with signal-driven cancel-and-restart behavior
 */
export async function handleAgentExecutionWithSignals(
  state: AgentExecutionWorkflowState,
): Promise<StepTransitionResult> {
  log.debug(
    '[Handler:AgentWithSignals] Starting agent execution with signals',
    {
      nodeId: state.currentNodeId,
      workflowId: state.workflowId,
    },
  );

  try {
    // Validate state and node configuration
    if (!state.nodeConfig) {
      throw new Error('Invalid node configuration for agent execution');
    }

    // Clear previous signals and prepare state
    state.pendingAgentResults = [];
    const initialUserMessage = getActiveUserMessage(state);
    const preserveUserMessage = !!initialUserMessage;

    // Agent execution loop with cancel-and-restart behavior
    const maxRestarts = 3;
    let currentAttempt = 0;

    while (currentAttempt < maxRestarts) {
      currentAttempt++;

      log.debug('[Handler:AgentWithSignals] Starting agent execution attempt', {
        attempt: currentAttempt,
        maxRestarts,
        nodeId: state.currentNodeId,
      });

      // Execute auto node which handles agent execution
      const result = await executeFlowNode({
        flowId: state.flowId,
        nodeId: state.currentNodeId,
        context: state.context,
        userMessage: getActiveUserMessage(state),
        lastUserMessageId: state.lastUserMessageId,
      });

      // Bind execution/request ids to this request (drives user response ownership)
      setCurrentExecutionId(
        state,
        result.requestId,
        'handleAgentExecutionWithSignals',
      );

      state.context = result.updatedContext;
      state.runningAgentExecutionId = result.requestId;
      state.agentExecutionStartTime = new Date();

      log.debug(
        '[Handler:AgentWithSignals] Waiting for agent response or signals',
        {
          requestId: result.requestId,
          nodeId: state.currentNodeId,
        },
      );

      // Wait for signals with timeout (10 minutes)
      const signalReceived = await condition(() => {
        const hasAgentResult =
          state.pendingAgentResults && state.pendingAgentResults.length > 0;
        const hasLLMResponse =
          state.pendingLLMResponse !== undefined &&
          state.pendingLLMResponse.requestId === result.requestId;
        const hasUserMessage =
          getActiveUserMessage(state) !== undefined &&
          (!preserveUserMessage ||
            getActiveUserMessage(state)?.id !== initialUserMessage?.id);
        const isComplete = state.isComplete;
        const skipPending = state.skipInfo;

        log.debug('[Handler:AgentWithSignals] Signal condition check', {
          hasAgentResult,
          hasLLMResponse,
          hasUserMessage,
          isComplete,
          skipPending: !!skipPending,
          pendingAgentResultsCount: state.pendingAgentResults?.length || 0,
        });

        return Boolean(
          hasAgentResult ||
            hasLLMResponse ||
            hasUserMessage ||
            isComplete ||
            skipPending,
        );
      }, '10m');

      // Handle timeout
      if (!signalReceived) {
        await handleAgentTimeout(state, result.requestId);
        return createStepTransition(
          state.step,
          WorkflowStep.WAITING_FOR_USER_INPUT,
        );
      }

      // Handle completion signal
      if (state.isComplete) {
        return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
      }

      // Handle skip node signal
      if (state.skipInfo) {
        return createStepTransition(
          state.step,
          WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS_SKIPPED,
        );
      }

      // Process user input signal (cancel and restart)
      if (
        getActiveUserMessage(state) &&
        (!preserveUserMessage ||
          getActiveUserMessage(state)?.id !== initialUserMessage?.id)
      ) {
        const incomingUserMessage = getActiveUserMessage(state);
        log.debug(
          '[Handler:AgentWithSignals] User input received, cancelling and restarting',
          {
            nodeId: state.currentNodeId,
            attempt: currentAttempt,
          },
        );
        // Structured cancel-and-restart event — fires once per loop re-entry
        // triggered by an in-flight user message. Carries the IDs needed to
        // pair this restart with the next executeFlowNode parent-choice log.
        log.info('[Handler:AgentWithSignals] Cancel-and-restart triggered', {
          event: 'workflow.execute_agent.cancel_and_restart',
          incomingUserMessageId: incomingUserMessage?.id ?? null,
          currentNodeId: state.currentNodeId,
          nextRequestId: result.requestId,
          attempt: currentAttempt,
        });

        state.runningAgentExecutionId = undefined;
        continue; // Restart loop with new user input
      }

      // Process LLM response (standard execution completion)
      if (
        state.pendingLLMResponse &&
        state.pendingLLMResponse.requestId !== result.requestId
      ) {
        log.debug(
          '[Handler:AgentWithSignals] LLM response requestId mismatch',
          {
            pendingRequestId: state.pendingLLMResponse.requestId,
            resultRequestId: result.requestId,
            nodeId: state.currentNodeId,
          },
        );
      } else if (
        state.pendingLLMResponse &&
        state.pendingLLMResponse.requestId === result.requestId
      ) {
        log.debug('[Handler:AgentWithSignals] LLM response received', {
          requestId: result.requestId,
          hasNextNodeId: !!state.pendingLLMResponse.nextNodeId,
        });

        state.runningAgentExecutionId = undefined;

        // Handle the response like a normal auto-node execution
        const response = state.pendingLLMResponse;
        log.debug('[Handler:AgentWithSignals] LLM response details', {
          requestId: response.requestId,
          nextNodeId: response.nextNodeId,
          responseDataKeys:
            response.responseData && typeof response.responseData === 'object'
              ? Object.keys(response.responseData)
              : [],
          hasUiElements: hasUiElements(response.responseData),
        });

        // Validate response data
        if (isErrorSystemMessageData(response.responseData)) {
          const errorContext = response.responseData.context;
          throw new Error(
            typeof errorContext === 'string'
              ? errorContext
              : 'Agent execution error',
          );
        }

        // Check if the response contains UI elements that require user input
        const responseData = response.responseData;
        if (hasUiElements(responseData) && response.nextNodeId) {
          // Store the next node ID for later transition
          state.context.pendingTransition = {
            nextNodeId: response.nextNodeId,
            reason: 'agent_complete',
          };
          log.debug('[Handler:AgentWithSignals] pendingTransition set', {
            nodeId: state.currentNodeId,
            nextNodeId: response.nextNodeId,
            reason: 'agent_complete',
            requestId: response.requestId,
          });

          clearPendingLlmSignal(
            state,
            'handleAgentExecutionWithSignals (hasUIElements && response.nextNodeId)',
          );

          const persistedState: WorkflowState = {
            ...state,
            step: WorkflowStep.WAITING_FOR_USER_INPUT,
          };

          // Save state after agent completion but don't transition yet
          await saveFlowState({
            workflowState: persistedState,
            executionId: state.executionId,
          });

          // Wait for user input on the agent response
          return createStepTransition(
            state.step,
            WorkflowStep.WAITING_FOR_USER_INPUT,
          );
        } else if (
          response.nextNodeId &&
          response.nextNodeId !== state.currentNodeId
        ) {
          // Handle node transition
          transitionToNextNode(state, response.nextNodeId, 'agent_complete');

          // Load new node configuration
          await loadNodeConfiguration(state);
        }

        // Save state after execution
        await saveFlowState({
          workflowState: state,
          executionId: state.executionId,
        });
        clearPendingLlmSignal(
          state,
          'handleAgentExecutionWithSignals !(hasUIElements && response.nextNodeId)',
        );
        incrementInteractionCount(state);

        // Determine next step
        const nextStep = determineNextStep(state);
        return createStepTransition(state.step, nextStep);
      }

      // Process agent result payload
      if (state.pendingAgentResults && state.pendingAgentResults.length > 0) {
        const agentResult = state.pendingAgentResults.shift();
        state.runningAgentExecutionId = undefined;

        if (agentResult && agentResult.status === 'completed') {
          return await processAgentCompletion(state, agentResult);
        } else if (agentResult) {
          return await handleAgentFailure(state, agentResult);
        }
      }
    }

    // Max restarts exceeded
    throw new Error('Maximum agent execution restarts exceeded');
  } catch (error) {
    return await handleAgentExecutionError(state, error as Error);
  }
}

// Agent execution helper functions
async function handleAgentTimeout(
  state: AgentExecutionWorkflowState,
  executionId: string,
): Promise<void> {
  log.error('[Handler:AgentWithSignals] Agent execution timed out', {
    nodeId: state.currentNodeId,
    executionId,
    duration: Date.now() - (state.agentExecutionStartTime?.getTime() || 0),
  });

  // Clean up running execution
  if (state.runningAgentExecutionId) {
    state.runningAgentExecutionId = undefined;
  }

  // Create user-facing error message
  await createSystemMessage({
    conversationId: state.conversationId,
    organizationId: state.organizationId,
    nodeResult: {
      type: NodeType.ERROR,
      message:
        'Agent analysis timed out. Please try again or provide more specific guidance.',
      data: {
        context: 'timeout',
        errorType: 'agent_timeout',
        temporary: true,
        detectedIntent: 'agent_timeout',
        intentConfidence: 1,
      },
    },
    nodeId: state.currentNodeId,
    flowId: state.flowId,
    context: state.context,
  });

  // Increment failed attempts
  state.failedAgentAttempts = (state.failedAgentAttempts || 0) + 1;
}

async function processAgentCompletion(
  state: AgentExecutionWorkflowState,
  agentResult: AgentExecutionResultPayload,
): Promise<StepTransitionResult> {
  log.debug('[Handler:AgentWithSignals] Processing agent completion', {
    nodeId: state.currentNodeId,
    agentId: agentResult.agentId,
    executionId: agentResult.executionId,
  });

  try {
    // Create system message with agent findings
    await createSystemMessage({
      conversationId: state.conversationId,
      organizationId: state.organizationId,
      nodeResult: {
        type: NodeType.ANALYZE,
        message: agentResult.result?.text || 'Agent analysis completed',
        data: {
          detectedIntent: 'agent_analysis',
          intentConfidence: agentResult.result?.confidence || 0.8,
          reasoning:
            agentResult.result?.reasoning || 'Agent analysis completed',
          analysis: {
            identifiedTechnologies: [],
            integrationComplexity: 'medium' as const,
            potentialChallenges: [],
            recommendations: [],
          },
        },
      },
      nodeId: state.currentNodeId,
      flowId: state.flowId,
      context: state.context,
    });

    // Clean up state
    clearAgentExecutionState(state);
    clearPendingLlmSignal(state, 'processAgentCompletion');
    incrementInteractionCount(state);

    // Save state after processing
    await saveFlowState({
      workflowState: state,
      executionId: state.executionId,
    });

    // Continue waiting for more signals or transition if needed
    const nextStep = determineNextStep(state);
    return createStepTransition(state.step, nextStep);
  } catch (error) {
    log.error('[Handler:AgentWithSignals] Failed to process agent completion', {
      agentId: agentResult.agentId,
      executionId: agentResult.executionId,
      error: (error as Error).message,
    });

    return await handleAgentExecutionError(state, error as Error);
  }
}

async function handleAgentFailure(
  state: AgentExecutionWorkflowState,
  agentResult: AgentExecutionResultPayload,
): Promise<StepTransitionResult> {
  log.error('[Handler:AgentWithSignals] Agent execution failed', {
    nodeId: state.currentNodeId,
    agentId: agentResult.agentId,
    executionId: agentResult.executionId,
    error: agentResult.error,
  });

  // Increment failed attempts
  state.failedAgentAttempts = (state.failedAgentAttempts || 0) + 1;

  // Create error message for user
  await createSystemMessage({
    conversationId: state.conversationId,
    organizationId: state.organizationId,
    nodeResult: {
      type: NodeType.ERROR,
      message: `Agent analysis encountered an error: ${agentResult.error}. ${
        state.failedAgentAttempts < 3
          ? "I'll try again with a different approach."
          : 'Please provide more specific guidance or try a different approach.'
      }`,
      data: {
        context: 'agent_failure',
        errorType: 'agent_execution_failed',
        temporary: state.failedAgentAttempts < 3,
        detectedIntent: 'agent_failure',
        intentConfidence: 1,
      },
    },
    nodeId: state.currentNodeId,
    flowId: state.flowId,
    context: state.context,
  });

  // Determine recovery strategy
  if (state.failedAgentAttempts >= 3) {
    // Max attempts reached, transition to completion
    clearAgentExecutionState(state);
    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  } else {
    // Allow retry - transition back to user input wait
    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT,
    );
  }
}

async function handleAgentExecutionError(
  state: AgentExecutionWorkflowState,
  error: Error,
): Promise<StepTransitionResult> {
  log.error('[Handler:AgentWithSignals] Agent execution handler error', {
    error: error.message,
    stack: error.stack,
    workflowId: state.workflowId,
    nodeId: state.currentNodeId,
  });

  // Clean up any running execution
  if (state.runningAgentExecutionId) {
    state.runningAgentExecutionId = undefined;
  }

  // Create error message for user
  await createSystemMessage({
    conversationId: state.conversationId,
    organizationId: state.organizationId,
    nodeResult: {
      type: NodeType.ERROR,
      message:
        'I encountered an unexpected error during analysis. Please try again or contact support if the problem persists.',
      data: {
        context: 'handler_error',
        errorType: 'unexpected_error',
        temporary: true,
        detectedIntent: 'handler_error',
        intentConfidence: 1,
      },
    },
    nodeId: state.currentNodeId,
    flowId: state.flowId,
    context: state.context,
  });

  // Clean up state and transition to completion
  clearAgentExecutionState(state);
  return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
}

// State management helpers
function clearAgentExecutionState(state: AgentExecutionWorkflowState): void {
  state.runningAgentExecutionId = undefined;
  state.agentExecutionStartTime = undefined;
  state.currentAgentExecution = undefined;
  state.failedAgentAttempts = undefined;
}
