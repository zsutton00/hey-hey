import { log, patched } from '@temporalio/workflow';
import {
  FlowUserMessage,
  NodeType,
  StartRunKickoffSignalPayload,
} from '../types/flow-internal.types';
import {
  NodeConfiguration,
  PendingUserMessageMutableState,
  StepTransitionResult,
  WORKFLOW_STEP_TO_PHASE,
  WorkflowPhase,
  WorkflowState,
  WorkflowStep,
} from './conversation-workflow-state';
import {
  REPOSITORY_IMPORT_FIRST_WORK_PATCH_ID,
  routeRepositoryImportAfterFinalize,
} from './repository-import-legacy-compatibility';

/**
 * Creates a step transition result
 */
export function createStepTransition(
  currentStep: WorkflowStep,
  nextStep: WorkflowStep,
  shouldContinue = true,
): StepTransitionResult {
  log.debug('[createStepTransition] creating...', {
    currentStep,
    nextStep,
    shouldContinue,
  });

  return {
    nextStep,
    shouldContinue,
  };
}

/**
 * Transitions workflow to next step and logs the change
 */
export function transitionToStep(
  state: WorkflowState,
  nextStep: WorkflowStep,
  reason?: string,
): void {
  const previousStep = state.step;
  state.step = nextStep;

  log.debug('[transitionToStep] Step transition', {
    from: previousStep,
    to: nextStep,
    reason,
    nodeId: state.currentNodeId,
    workflowId: state.workflowId,
  });
}

/**
 * Transitions to next node and resets execution state
 */
export function transitionToNextNode(
  state: WorkflowState,
  requestedNextNodeId: string,
  transition: string,
): void {
  const nextNodeId = routeRepositoryImportAfterFinalize({
    currentNodeId: state.currentNodeId,
    nextNodeId: requestedNextNodeId,
    firstWorkPatched: () => patched(REPOSITORY_IMPORT_FIRST_WORK_PATCH_ID),
    context: state.context,
  });
  log.debug('[transitionToNextNode] starting', {
    currentNodeId: state.currentNodeId,
    previousNode: state.context.flowPath.previousNode,
    previousTransition: state.context.flowPath.previousTransition,
    nextNodeId,
    transition,
  });
  // Update flow path tracking
  state.context.flowPath.previousNode = state.currentNodeId;
  state.context.flowPath.previousTransition = transition;

  if (!state.context.flowPath.pathTaken.includes(state.currentNodeId)) {
    state.context.flowPath.pathTaken.push(state.currentNodeId);
  }

  // Update current node
  state.currentNodeId = nextNodeId;

  // Reset execution state for new node
  state.context.currentNodeExecution = {
    nodeId: nextNodeId,
    questionsGenerated: false,
  };

  // Reset phase tracking to execution for new node until config is loaded
  state.phase = WorkflowPhase.EXECUTING;

  log.debug('[Workflow] Node transition', {
    from: state.context.flowPath.previousNode,
    to: nextNodeId,
    transition,
    pathTaken: state.context.flowPath.pathTaken,
    workflowId: state.workflowId,
  });
}

/**
 * Determines the execution phase for a node
 */
export function determineNodePhase(
  nodeConfig: NodeConfiguration,
  currentExecution: { questionsGenerated: boolean } | undefined,
): WorkflowPhase {
  if (!nodeConfig.supportsPhases) {
    return WorkflowPhase.EXECUTING;
  }

  return currentExecution?.questionsGenerated
    ? WorkflowPhase.WAITING_FOR_USER
    : WorkflowPhase.EXECUTING;
}

export interface NextStepAndPhaseResult {
  nextStep: WorkflowStep;
  nextPhase: WorkflowPhase;
  reason: string;
}

export interface NextStepInputs {
  currentStep: WorkflowStep;
  currentPhase: WorkflowPhase;
  nodeConfig: NodeConfiguration;
  hasUserMessage: boolean;
  userMessageReceivedFlag?: boolean;
  skipInfo: WorkflowState['skipInfo'] | null;
  pendingLLMResponse?: WorkflowState['pendingLLMResponse'];
  pendingAgentResults?: WorkflowState['pendingAgentResults'];
  isComplete: boolean;
  currentNodeExecution?: WorkflowState['context']['currentNodeExecution'];
}

/**
 * Pure transition computation based on explicit inputs. No mutations.
 */
export function computeNextStepAndPhase(
  state: WorkflowState,
  inputs: NextStepInputs,
): NextStepAndPhaseResult {
  const {
    currentPhase,
    nodeConfig,
    hasUserMessage,
    skipInfo,
    isComplete,
    currentNodeExecution,
  } = inputs;
  const questionsGenerated = !!currentNodeExecution?.questionsGenerated;
  const userMessageReady = !!inputs.userMessageReceivedFlag;

  let result: NextStepAndPhaseResult;
  const autoContinuingTypes = new Set<NodeType>([
    NodeType.ACTION,
    NodeType.AGENT,
    NodeType.ANALYZE,
    NodeType.GENERATE,
    NodeType.ROUTING,
    NodeType.CLASSIFICATION,
    NodeType.NON_INTERACTIVE,
    NodeType.NOOP,
    NodeType.FINALIZE,
  ]);

  const singlePhaseAutoExec: NextStepAndPhaseResult = {
    nextStep: WorkflowStep.EXECUTING_AUTO_NODE,
    nextPhase: WorkflowPhase.EXECUTING,
    reason: 'default single-phase execution',
  };

  const singlePhaseUserWaiting: NextStepAndPhaseResult = {
    nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
    nextPhase: WorkflowPhase.WAITING_FOR_USER,
    reason: 'single-phase node waiting for user input',
  };

  if (isComplete) {
    result = {
      nextStep: WorkflowStep.COMPLETING_FLOW,
      nextPhase: WorkflowPhase.COMPLETING,
      reason: 'flow marked complete',
    };
  } else if (skipInfo) {
    // Skip intent takes precedence and relies on the target node config being loaded beforehand
    if (skipInfo.systemMessageComplete) {
      result = {
        nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
        nextPhase: WorkflowPhase.WAITING_FOR_USER,
        reason: 'skip applied with existing system message',
      };
    } else if (nodeConfig.enableSignalProcessing) {
      result = {
        nextStep: WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS,
        nextPhase: WorkflowPhase.EXECUTING,
        reason: 'skip applied to signal-processing node',
      };
    } else if (nodeConfig.supportsPhases) {
      result = {
        nextStep: WorkflowStep.GENERATING_QUESTIONS,
        nextPhase: WorkflowPhase.EXECUTING,
        reason: 'skip applied to phased node',
      };
    } else {
      const isAutoContinuing = autoContinuingTypes.has(
        nodeConfig.type as NodeType,
      );
      result = isAutoContinuing
        ? {
            ...singlePhaseAutoExec,
            reason: 'skip applied to single-phase auto node',
          }
        : {
            ...singlePhaseUserWaiting,
            reason: 'skip applied to single-phase user node',
          };
    }
  } else if (nodeConfig.enableSignalProcessing) {
    result = {
      nextStep: WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS,
      nextPhase: WorkflowPhase.EXECUTING,
      reason: 'signal-processing node',
    };
  } else if (nodeConfig.supportsPhases) {
    if (!questionsGenerated) {
      result = {
        nextStep: WorkflowStep.GENERATING_QUESTIONS,
        nextPhase: WorkflowPhase.EXECUTING,
        reason: 'phased node in execution phase',
      };
    } else if (userMessageReady) {
      result = {
        nextStep: WorkflowStep.PROCESSING_USER_RESPONSE,
        nextPhase: WorkflowPhase.PROCESSING_USER_RESPONSE,
        reason: 'phased node processing user response',
      };
    } else {
      result = {
        nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
        nextPhase: WorkflowPhase.WAITING_FOR_USER,
        reason: 'phased node waiting for user input',
      };
    }
  } else {
    const isAutoContinuing = autoContinuingTypes.has(
      nodeConfig.type as NodeType,
    );
    result = isAutoContinuing ? singlePhaseAutoExec : singlePhaseUserWaiting;
  }

  log.debug('[computeNextStepAndPhase] decision', {
    inputs: {
      currentStep: inputs.currentStep,
      currentPhase,
      nodeType: nodeConfig.type,
      supportsPhases: nodeConfig.supportsPhases,
      enableSignalProcessing: nodeConfig.enableSignalProcessing,
      hasUserMessage,
      userMessageReady,
      skipInfo: !!skipInfo,
      isComplete,
      questionsGenerated,
    },
    result,
    workflowId: state.workflowId,
    nodeId: state.currentNodeId,
  });

  return result;
}

/**
 * Determines the next step based on current state
 */
export function determineNextStep(state: WorkflowState): WorkflowStep {
  const decision = computeNextStepAndPhase(state, {
    currentStep: state.step,
    currentPhase: state.phase,
    nodeConfig: state.nodeConfig,
    hasUserMessage: hasPendingUserMessage(state),
    userMessageReceivedFlag:
      state.waitingForUserInputFlags?.userMessageReceived,
    skipInfo: state.skipInfo ?? null,
    pendingLLMResponse: state.pendingLLMResponse,
    pendingAgentResults: state.pendingAgentResults,
    isComplete: state.isComplete,
    currentNodeExecution: state.context.currentNodeExecution,
  });

  log.debug(`[determineNextStep] computed next step`, {
    currentNodeId: state.currentNodeId,
    nodeType: state.nodeConfig.type,
    hasPendingUserMessage: hasPendingUserMessage(state),
    currentStep: state.step,
    nextStep: decision.nextStep,
    nextPhase: decision.nextPhase,
    reason: decision.reason,
  });

  return decision.nextStep;
}

type LoadNodeConfig = (state: WorkflowState) => Promise<void>;

export async function applyTransition(
  state: WorkflowState,
  transition: NextStepAndPhaseResult,
  startPhase: WorkflowPhase,
): Promise<void> {
  const endPhase =
    transition.nextPhase ?? WORKFLOW_STEP_TO_PHASE[transition.nextStep];

  transitionToStep(state, transition.nextStep, transition.reason);
  state.phase = endPhase;

  if (startPhase !== endPhase) {
    switch (startPhase) {
      case WorkflowPhase.WAITING_FOR_USER:
        // waiting-phase owns skip intent/condition waits; clear its transients
        state.skipInfo = undefined;
        state.waitingForUserInputFlags = undefined;
        break;
      case WorkflowPhase.EXECUTING:
        // executing-phase owns pending LLM/agent results; clear them when exiting
        state.pendingLLMResponse = undefined;
        state.pendingAgentResults = undefined;
        break;
      default:
        break;
    }
  }
}

export async function applySkipIntent(
  state: WorkflowState,
  options?: {
    loadNodeConfiguration?: LoadNodeConfig;
  },
): Promise<NextStepAndPhaseResult> {
  if (!state.skipInfo) {
    throw new Error('applySkipIntent called without skipInfo');
  }

  const targetNodeId = state.skipInfo.targetNodeId;

  state.currentNodeId = targetNodeId;
  state.currentNodeExecutionId = undefined;
  state.pendingLLMResponse = undefined;
  state.pendingAgentResults = undefined;
  state.context.currentNodeExecution = {
    nodeId: targetNodeId,
    questionsGenerated: false,
  };

  if (options?.loadNodeConfiguration) {
    await options.loadNodeConfiguration(state);
  }

  const nextStep = determineNextStep(state);
  const nextPhase = WORKFLOW_STEP_TO_PHASE[nextStep];

  // Clear skip intent after applying
  state.skipInfo = undefined;

  return {
    nextStep,
    nextPhase,
    reason: 'skip applied via explicit step',
  };
}

/**
 * User message helpers keyed by node execution id (single source of truth).
 */
function getCurrentExecutionId(state: WorkflowState): string | undefined {
  return state.currentNodeExecutionId;
}

/**
 * User message helpers keyed by node execution id (single source of truth).
 */
export function setCurrentExecutionId(
  state: WorkflowState,
  nextNodeExecutionId: string,
  callSite: string,
): string | undefined {
  log.debug(
    `[setCurrentExecutionId] setting currentNodeExecutionId from ${callSite}`,
    {
      currentNodeExecutionId: state.currentNodeExecutionId,
      nextNodeExecutionId,
      step: state.step,
    },
  );
  return (state.currentNodeExecutionId = nextNodeExecutionId);
}

export function enqueueUserMessage(
  state: WorkflowState,
  message: FlowUserMessage,
): void {
  const execId = getCurrentExecutionId(state);
  log.debug('[userMessageStore] enqueue', {
    messageId: message.id,
    execId,
  });

  if (!execId) {
    log.error(
      '[userMessageStore] enqueue called without currentNodeExecutionId; ignoring message',
    );
    throw new Error('enqueue called without currentNodeExecutionId');
  }

  state.userMessagesByExecution = state.userMessagesByExecution || {};
  state.userMessagesByExecution[execId] = message;
}

export function recordStartRunKickoff(
  state: WorkflowState,
  handledOperationIds: Set<string>,
  kickoff: StartRunKickoffSignalPayload,
): boolean {
  if (handledOperationIds.has(kickoff.operationId)) return false;
  enqueueUserMessage(state, kickoff.message);
  state.lastUserMessageId = kickoff.message.id;
  handledOperationIds.add(kickoff.operationId);
  return true;
}

export function prepareStartRunKickoffGate(
  state: WorkflowState,
  required: boolean,
): void {
  if (required) {
    state.currentNodeExecutionId = `startRunKickoff:${state.workflowId}`;
  }
}

export function getActiveUserMessage(
  state: WorkflowState,
): FlowUserMessage | undefined {
  const execId = getCurrentExecutionId(state);
  if (!execId) {
    log.debug(
      '[userMessageStore] getActiveUserMessage: no current execution id',
    );
    return undefined;
  }

  const store = state.userMessagesByExecution || {};
  const active = store[execId];

  log.debug('[userMessageStore] getActiveUserMessage', {
    execId,
    hasMessage: !!active,
  });

  return active;
}

export function resetUserMessageStoreOnReplay(
  state: WorkflowState,
  callSite: string,
) {
  log.debug('[userMessageStore] reset', {
    callSite,
    currentExecId: state.currentNodeExecutionId,
  });
  if (state.currentNodeExecutionId && state.userMessagesByExecution) {
    delete state.userMessagesByExecution[state.currentNodeExecutionId];
  }
}

export function hasPendingUserMessage(state: WorkflowState): boolean {
  const execId = getCurrentExecutionId(state);
  if (!execId) {
    return false;
  }
  return !!state.userMessagesByExecution?.[execId];
}

/**
 * Clears pending signals after processing
 */
export function clearPendingUserSignals(
  state: PendingUserMessageMutableState,
  callSite: string,
): void {
  log.debug('[userMessageStore] clearPendingUserSignals (noop for per-exec)', {
    callSite,
    currentExecId: (state as WorkflowState).currentNodeExecutionId,
  });
  // No-op: messages are retained by execution id; leaving this hook for compatibility.
}

export function clearPendingLlmSignal(
  state: WorkflowState,
  callSite: string,
): void {
  console.log('[clearPendingLlmSignal] callSite', callSite);
  state.pendingLLMResponse = undefined;
}

/**
 * Increments interaction count
 */
export function incrementInteractionCount(state: WorkflowState): void {
  state.context.core.session.interactionCount++;
  log.debug('[Workflow] Interaction count incremented', {
    count: state.context.core.session.interactionCount,
    nodeId: state.currentNodeId,
    workflowId: state.workflowId,
  });
}

/**
 * Validates workflow state consistency
 */
export function validateWorkflowState(state: WorkflowState): void {
  if (!state.currentNodeId) {
    throw new Error('WorkflowState: currentNodeId is required');
  }

  if (!state.context) {
    throw new Error('WorkflowState: context is required');
  }

  if (!state.nodeConfig) {
    throw new Error('WorkflowState: nodeConfig is required');
  }

  if (state.iterations >= state.maxIterations) {
    throw new Error(
      `WorkflowState: Maximum iterations (${state.maxIterations}) exceeded`,
    );
  }
}

/**
 * Creates a default node configuration
 */
export function createDefaultNodeConfig(nodeId: string): NodeConfiguration {
  return {
    id: nodeId,
    type: 'LLM_QUESTIONS', // Default to LLM_QUESTIONS type
    supportsPhases: false,
  };
}

/**
 * Utility class for workflow signal naming and isolation
 */
export class WorkflowSignals {
  static getWorkflowUserMessageSignalName(workflowId: string): string {
    return `userMessage-${workflowId}`;
  }

  static getLLMResponseSignalName(workflowId: string): string {
    return `llmResponse-${workflowId}`;
  }

  static getWorkflowCompletionSignalName(workflowId: string): string {
    return `completion-${workflowId}`;
  }
}
