import { patched } from '@temporalio/workflow';
import { NodeType } from 'src/types/flow-internal.types';
import {
  StepTransitionResult,
  UserResponseProcessingWorkflowState,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  createStepTransition,
  determineNextStep,
  getActiveUserMessage,
  incrementInteractionCount,
  resetUserMessageStoreOnReplay,
  transitionToNextNode,
} from '../conversation-workflow-utils';
import { loadNodeConfiguration } from './initialization';
import { log, processNodeResponse, saveFlowState } from './shared';

// Why: an EXTERNAL_AGENT completion whose resolved transition is marked
// `parkOnUserResponse` must NOT re-enter its node and re-run generation — the
// agent already emitted the user-facing artifact during the turn that produced
// the completion, so routing back emits a duplicate (for example, an iterate
// REVISED review artifact). Under this patch such completions park on the current node
// in WAITING_FOR_USER; the next genuine user message resumes normal routing.
//
// Removal plan:
// 1) After all workers run code with this patch, switch to deprecatePatch with
//    the same ID for one rollout window.
// 2) After the maximum replay horizon has passed, remove patch calls entirely.
//    With a 1-hour conversation timeout, use >= 1 hour after full rollout.
const PARK_ON_USER_RESPONSE_PATCH_ID =
  'conversation-flow-external-agent-park-on-user-response-v1';

export async function handleUserResponseProcessing(
  state: UserResponseProcessingWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[handleUserResponseProcessing] Processing user response', {
    nodeId: state.currentNodeId,
    phase: state.phase,
    hasUserMessage: !!getActiveUserMessage(state),
  });

  const activeUserMessage = getActiveUserMessage(state);

  if (!activeUserMessage) {
    throw new Error('No user message available for processing');
  }

  // Show routing feedback to user
  // TODO: this should only be created when an explicit routing prompt is sent
  // await createSystemMessage({
  //   conversationId: state.conversationId,
  //   organizationId: state.organizationId,
  //   nodeResult: {
  //     type: NodeType.ROUTING,
  //     message: 'Pondering about what to ask next...',
  //     data: {
  //       temporary: true,
  //     },
  //   },
  //   nodeId: state.currentNodeId,
  //   flowId: state.flowId,
  //   context: state.context,
  // });

  // Process user response and get routing decision
  const routingResult = await processNodeResponse({
    flowId: state.flowId,
    nodeId: state.currentNodeId,
    context: state.context,
    userMessage: activeUserMessage,
  });
  log.debug('[handleUserResponseProcessing] Routing result received', {
    nodeId: state.currentNodeId,
    requestedNextNodeId: routingResult.nextNodeId,
    currentStep: state.step,
    currentPhase: state.phase,
  });

  // Store the user message that triggered this transition
  state.triggeringUserMessage = activeUserMessage;

  // Update context and transition to next node
  state.context = routingResult.updatedContext;

  // Save state before routing
  await saveFlowState({
    workflowState: state,
    executionId: state.executionId,
  });

  // For FINALIZE nodes, user confirmation means workflow completion
  if (state.nodeConfig.type === (NodeType.FINALIZE as string)) {
    log.debug(
      '[handleUserResponseProcessing] FINALIZE node confirmed, completing workflow',
      {
        nodeId: state.currentNodeId,
        workflowId: state.workflowId,
      },
    );

    clearPendingLlmSignal(state, 'handleUserResponseProcessing (first if)');
    return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW);
  }

  // EXTERNAL_AGENT completion marked `parkOnUserResponse`: the agent already
  // emitted its user-facing artifact this turn, so park on the current node and
  // wait for the next user message instead of re-running generation (which would
  // emit a duplicate). The completion is dropped so UserWait does not
  // immediately re-wake on it.
  if (
    patched(PARK_ON_USER_RESPONSE_PATCH_ID) &&
    routingResult.parkOnUserResponse
  ) {
    log.debug(
      '[handleUserResponseProcessing] Parking on current node without regeneration',
      {
        nodeId: state.currentNodeId,
        requestedNextNodeId: routingResult.nextNodeId,
      },
    );
    resetUserMessageStoreOnReplay(
      state,
      'handleUserResponseProcessing (parkOnUserResponse)',
    );
    state.waitingForUserInputFlags = undefined;
    clearPendingLlmSignal(
      state,
      'handleUserResponseProcessing (parkOnUserResponse)',
    );
    return createStepTransition(
      state.step,
      WorkflowStep.WAITING_FOR_USER_INPUT,
    );
  }

  // Transition to next node if routing determined one (allow self-loop for iterative nodes)
  if (routingResult.nextNodeId) {
    transitionToNextNode(state, routingResult.nextNodeId, 'phase2_routing');

    // Load new node configuration
    await loadNodeConfiguration(state);

    incrementInteractionCount(state);

    // Determine next step for new (or same) node
    const nextStep = determineNextStep(state);
    log.debug('[handleUserResponseProcessing] Routing to node', {
      nodeId: state.currentNodeId,
      nextNodeId: routingResult.nextNodeId,
      nextStep,
    });
    clearPendingLlmSignal(state, 'handleUserResponseProcessing');
    return createStepTransition(state.step, nextStep);
  }

  // If no routing transition, something went wrong
  log.error(
    '[handleUserResponseProcessing] No next node returned after routing',
    {
      nodeId: state.currentNodeId,
      currentStep: state.step,
      currentPhase: state.phase,
      routingResult,
    },
  );
  throw new Error('Phase 2 processing completed without node transition');
}
