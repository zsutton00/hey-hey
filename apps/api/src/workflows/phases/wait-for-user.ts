import { condition, patched } from '@temporalio/workflow';
import {
  StepTransitionResult,
  WaitingForUserWorkflowState,
  WorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  clearPendingUserSignals,
  createStepTransition,
  determineNextStep,
  getActiveUserMessage,
  hasPendingUserMessage,
  transitionToNextNode,
} from '../conversation-workflow-utils';
import { loadNodeConfiguration } from './initialization';
import {
  log,
  pauseFlow,
  processNodeUserResponseHook,
  saveFlowState,
} from './shared';

const PROCESS_USER_RESPONSE_PENDING_TRANSITION_PATCH_ID =
  'conversation-flow-process-user-response-pending-transition-v1';
const PRESERVE_PAUSED_USER_WAIT_PATCH_ID =
  'conversation-flow-preserve-paused-user-wait-v1';
// Why: pending-transition replies previously skipped node.processUserResponse.
// This patch enables side-effect hooks before consuming pending transitions while
// preserving existing routing ownership.
//
// Removal plan:
// 1) After all workers run code with this patch, switch to deprecatePatch with
//    the same ID for one rollout window.
// 2) After the maximum replay horizon has passed, remove patch calls entirely.
//    With a 1-hour conversation timeout, use >= 1 hour after full rollout (plus
//    a safety buffer if resets/retries are common).

function buildUserMessageDebugData(
  activeUserMessage: ReturnType<typeof getActiveUserMessage>,
): Record<string, unknown> {
  if (!activeUserMessage) {
    return {
      hasActiveUserMessage: false,
    };
  }

  const userMessageData = activeUserMessage.data as unknown;
  let userMessagePreview = '[empty]';
  try {
    if (typeof userMessageData === 'object' && userMessageData !== null) {
      userMessagePreview = JSON.stringify(userMessageData).slice(0, 200);
    } else if (userMessageData !== undefined && userMessageData !== null) {
      userMessagePreview = String(userMessageData).slice(0, 200);
    }
  } catch {
    userMessagePreview = '[unserializable data]';
  }

  return {
    hasActiveUserMessage: true,
    activeUserMessageId: activeUserMessage.id,
    activeUserMessageParentId: activeUserMessage.parentMessageId,
    userMessageDataType: typeof userMessageData,
    userMessagePreview,
  };
}

/**
 * Handles waiting for user input
 */
export async function handleUserWait(
  state: WaitingForUserWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:UserWait] Waiting for user input', {
    nodeId: state.currentNodeId,
    workflowId: state.workflowId,
  });

  clearPendingLlmSignal(state, 'handleUserWait');

  // Wait for user response
  const userMessageReceived = await condition(
    () =>
      Boolean(
        hasPendingUserMessage(state) || state.isComplete || state.skipInfo,
      ),
    state.userResponseTimeout ?? '1h', // Use configured timeout or default to 1 hour
  );

  log.debug('[Handler:AutoNode] userMessageReceived condition wait complete', {
    userMessageReceived: !!userMessageReceived,
    nodeId: state.currentNodeId,
    isComplete: state.isComplete,
    workflowId: state.workflowId,
    skipInfo: state.skipInfo,
    pendingUserMessage: getActiveUserMessage(state),
    pendingTransition: state.context.pendingTransition,
    supportsPhases: state.nodeConfig.supportsPhases,
    execId: state.currentNodeExecutionId,
    errorHolding: state.errorHolding,
  });

  if (state.isComplete) {
    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  }

  if (state.errorHolding?.isActive) {
    log.debug(
      '[Handler:AutoNode] Error holding detected, transitioning to holding state',
      {
        nodeId: state.currentNodeId,
        workflowId: state.workflowId,
      },
    );

    clearPendingLlmSignal(state, 'handleUserWait');
    return createStepTransition(state.step, WorkflowStep.ERROR_HOLDING);
  }

  // Handle skip node signal
  if (state.skipInfo) {
    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED,
    );
  }

  if (!userMessageReceived) {
    log.info(
      '[Handler:UserWait] Timeout - pausing workflow for later resumption',
      {
        nodeId: state.currentNodeId,
        workflowId: state.workflowId,
        projectId: state.projectId,
      },
    );

    // State is already saved on every step transition. Mark as paused so the
    // API layer knows to resume when the user sends a new message.
    await pauseFlow({
      workflowState: state,
      executionId: state.executionId,
    });

    // Preserve replay compatibility for histories that already followed the
    // old timeout-to-completion path. New and still-waiting runs record this
    // patch marker before stopping with the PAUSED snapshot intact.
    if (!patched(PRESERVE_PAUSED_USER_WAIT_PATCH_ID)) {
      return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
    }

    // pauseFlow has already persisted the exact waiting state and marked the
    // execution PAUSED. Stop this run without another transition/save, which
    // would otherwise overwrite PAUSED and destroy the resumable snapshot.
    return createStepTransition(state.step, state.step, false);
  }

  // Process user message if received
  const activeUserMessage = getActiveUserMessage(state);
  const userMessageDebugData = buildUserMessageDebugData(activeUserMessage);
  log.debug('[Handler:UserWait] Active user message payload debug', {
    nodeId: state.currentNodeId,
    workflowId: state.workflowId,
    ...userMessageDebugData,
  });

  // Mark receipt for transition computation; consumed on transition
  state.waitingForUserInputFlags = {
    userMessageReceived: !!activeUserMessage,
  };

  if (activeUserMessage) {
    // Check if there's a pending transition (from opener execution or END node completion)
    if (state.context.pendingTransition) {
      const pendingTransition = state.context.pendingTransition;

      if (patched(PROCESS_USER_RESPONSE_PENDING_TRANSITION_PATCH_ID)) {
        const { updatedContext } = await processNodeUserResponseHook({
          flowId: state.flowId,
          nodeId: state.currentNodeId,
          context: state.context,
          userMessage: activeUserMessage,
        });
        state.context = updatedContext;
        state.context.pendingTransition = pendingTransition;

        log.debug(
          '[Handler:UserWait] Applied current-node processUserResponse before pending transition',
          {
            currentNodeId: state.currentNodeId,
            nextNodeId: pendingTransition.nextNodeId,
            workflowId: state.workflowId,
            ...userMessageDebugData,
          },
        );
      } else {
        log.debug(
          '[Handler:UserWait] Pending transition path skips current-node processUserResponse',
          {
            currentNodeId: state.currentNodeId,
            nextNodeId: pendingTransition.nextNodeId,
            workflowId: state.workflowId,
            ...userMessageDebugData,
          },
        );
      }

      log.debug('[Handler:UserWait] Executing pending transition', {
        from: state.currentNodeId,
        to: pendingTransition.nextNodeId,
        reason: pendingTransition.reason,
        ...userMessageDebugData,
      });

      log.debug('[Handler:UserWait] Transitioning directly to next node', {
        currentNodeId: state.currentNodeId,
        nextNodeId: pendingTransition.nextNodeId,
        workflowId: state.workflowId,
        ...userMessageDebugData,
      });

      // Execute the pending transition
      transitionToNextNode(
        state,
        pendingTransition.nextNodeId,
        pendingTransition.reason,
      );

      // Clear the pending transition
      state.context.pendingTransition = undefined;
      log.debug('[Handler:UserWait] Cleared pending transition', {
        nodeId: state.currentNodeId,
      });

      // Save state after transition
      await saveFlowState({
        workflowState: state,
        executionId: state.executionId,
      });

      // Load new node configuration
      await loadNodeConfiguration(state);
    }
    if (!state.context.pendingTransition) {
      log.debug('[Handler:UserWait] No pending transition on user response', {
        nodeId: state.currentNodeId,
      });
    }
  }

  // If we just processed a user message and this is a single-phase node,
  // we should execute the node (unless there's a pending transition)
  if (
    activeUserMessage &&
    !state.nodeConfig.supportsPhases &&
    !state.context.pendingTransition
  ) {
    // Clear the processed user message
    clearPendingUserSignals(state, 'handleUserWait (single phase)');

    // Execute the node to process the user input
    return createStepTransition(state.step, WorkflowStep.EXECUTING_AUTO_NODE);
  }

  // Determine next step based on node configuration
  const nextStep = determineNextStep(state);
  return createStepTransition(state.step, nextStep);
}

/**
 * Handle skip to node signal with support for systemMessageComplete flag
 */
export async function handleSkipToNodeSignal(
  state: WorkflowState,
): Promise<StepTransitionResult> {
  const systemMessageComplete = state.skipInfo?.systemMessageComplete || false;

  log.debug('[handleSkipToNodeSignal] Processing skip signal', {
    currentNodeId: state.currentNodeId,
    systemMessageComplete,
    workflowId: state.workflowId,
  });

  if (systemMessageComplete) {
    // For conversation cloning: position workflow after node execution (node already executed)
    // The system message has already been generated (cloned), so we should wait for user input
    log.debug(
      '[handleSkipToNodeSignal] System message complete, transitioning to wait for user input',
      {
        currentNodeId: state.currentNodeId,
        workflowId: state.workflowId,
      },
    );

    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT,
    );
  } else {
    const nextStep = determineNextStep(state);
    return createStepTransition(state.step, nextStep);
  }
}
