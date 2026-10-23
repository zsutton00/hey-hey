import { condition } from '@temporalio/workflow';
import {
  CompletionWorkflowState,
  ErrorHoldingWorkflowState,
  StepTransitionResult,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  clearPendingLlmSignal,
  createStepTransition,
} from '../conversation-workflow-utils';
import { completeFlow, log } from './shared';

/**
 * Handles workflow completion
 */
export async function handleCompletion(
  state: CompletionWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:Completion] Completing workflow', {
    nodeId: state.currentNodeId,
    totalIterations: state.iterations,
    flowId: state.flowId,
  });

  // Complete the flow
  await completeFlow({
    context: state.context,
    finalNodeId: state.currentNodeId,
    flowId: state.flowId,
    totalIterations: state.iterations,
    executionId: state.executionId,
  });

  log.debug('[Handler:Completion] Workflow completed successfully', {
    flowId: state.flowId,
    projectId: state.projectId,
    organizationId: state.organizationId,
    workflowId: state.workflowId,
    totalIterations: state.iterations,
    finalNodeId: state.currentNodeId,
  });

  return createStepTransition(state.step, WorkflowStep.COMPLETING_FLOW, false);
}

export async function handleErrorHolding(
  state: ErrorHoldingWorkflowState,
): Promise<StepTransitionResult> {
  log.error('[Handler:ErrorHolding] Workflow in error holding state', {
    nodeId: state.currentNodeId,
    errorMessage: state.errorHolding?.errorMessage,
    errorCode: state.errorHolding?.errorCode,
    workflowId: state.workflowId,
  });

  // Clear pending signals
  clearPendingLlmSignal(state, 'handleErrorHolding');

  // Wait for replay signal or completion
  await condition(() =>
    Boolean(
      state.isComplete || state.skipInfo || !state.errorHolding?.isActive,
    ),
  );

  if (state.isComplete) {
    return { nextStep: WorkflowStep.COMPLETING_FLOW, shouldContinue: true };
  }

  if (state.skipInfo) {
    // Replay was triggered, clear error holding and continue
    log.debug(
      '[Handler:ErrorHolding] Replay signal received, clearing error state',
      {
        workflowId: state.workflowId,
        nodeId: state.currentNodeId,
      },
    );

    state.errorHolding = undefined;
    state.skipInfo = undefined;

    return { nextStep: WorkflowStep.EXECUTING_AUTO_NODE, shouldContinue: true };
  }

  // If error holding was cleared but not via skip, stay in error holding
  return { nextStep: WorkflowStep.ERROR_HOLDING, shouldContinue: true };
}
