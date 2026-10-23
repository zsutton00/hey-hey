import {
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  WorkflowDurationOptions,
} from '@temporalio/workflow';
import { type SystemMessageData } from '../generated';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../types';
import {
  FlowUserMessage,
  isNodeCompletionMessage,
  StartRunKickoffSignalPayload,
  WorkflowAnswerSignalPayload,
} from '../types/flow-internal.types';
import { isErrorSystemMessageData } from '../utils/type-checks';
import { WorkflowSignals } from '../utils/workflow-signals.util';
import { normalizeRepositoryGroundingAdditionalContext } from '../flows/nodes/onboarding/repository-grounding.contract';
import {
  handleAgentExecutionWithSignals,
  handleAutoNodeExecution,
  handleCompletion,
  handleErrorHolding,
  handleGeneration,
  handleInitialization,
  handleOpenerExecution,
  handleUserResponseProcessing,
  handleUserWait,
  loadNodeConfiguration,
  initializeWorkflowState,
} from './conversation-workflow-handlers';
import { resolveOnboardingAdditionalContext } from './conversation-flow-compatibility';
import { resolveRepositoryImportFlowIdentity } from './repository-import-legacy-compatibility';
import {
  AgentExecutionWorkflowState,
  AutoNodeExecutionWorkflowState,
  CompletionWorkflowState,
  ErrorHoldingWorkflowState,
  GenerationWorkflowState,
  InitializationWorkflowState,
  LLMResponsePayload,
  OpenerExecutionWorkflowState,
  StepTransitionResult,
  UserResponseProcessingWorkflowState,
  WaitingForUserWorkflowState,
  WORKFLOW_STEP_TO_PHASE,
  WorkflowInput,
  WorkflowState,
  WorkflowStep,
  WorkflowPhase,
} from './conversation-workflow-state';
import { applyContextPatch, ContextPatch } from '../utils/mutable-context';
import type * as activities from './activities';
import { ContextSharingManager } from './context/context-sharing-manager';
import { ContextTransformationPipeline } from './context/context-transformation-pipeline';
import { ContextVersionManager } from './context/context-version-manager';
import { AgentCoordinationSystem } from './coordination/agent-coordination-system';
import { WorkflowHealthChecker } from './monitoring/workflow-health-checker';
import { WorkflowMetricsCollector } from './monitoring/workflow-metrics-collector';
import {
  StepExecutionStatus,
  TraceOperationType,
  TraceStatus,
  WorkflowExecutionStatus,
} from './monitoring/workflow-metrics.types';
import {
  enqueueUserMessage,
  hasPendingUserMessage,
  prepareStartRunKickoffGate,
  recordStartRunKickoff,
  resetUserMessageStoreOnReplay,
  transitionToStep,
  applyTransition,
  applySkipIntent,
  type NextStepAndPhaseResult,
} from './conversation-workflow-utils';
// Proxy activities for database queries
const { getLastSystemMessage, saveFlowState } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '30 seconds',
});

type UserResponseTimeout = WorkflowDurationOptions['workflowRunTimeout'];

// Strongly-typed input for conversational flow workflow
export interface StartConversationFlowWorkflowInput {
  projectId: ProjectId;
  workflowId: WorkflowId;
  organizationId: OrganizationId;
  flowId: string;
  userId?: UserId; // Optional: system-initiated workflows may not have a user initially
  conversationId?: ConversationId; // Optional: use existing conversation for resumption
  initiatedBy: 'SYSTEM' | 'USER';
  triggerEvent: string;
  title: string;
  workflowName?: string;
  workflowAboutType: WorkflowAboutType;
  workflowAboutId: string;
  userResponseTimeout?: UserResponseTimeout;
  additionalContext?: Record<string, unknown>; // Additional flow context fields to merge
}

export type LLMResponseWorkflowPayload = {
  requestId: RequestId;
  responseData: SystemMessageData;
  nextNodeId: string;
  contextUpdates?: ContextPatch;
};

// Workflow state information that can be queried from outside
export interface WorkflowStatusInfo {
  step: WorkflowStep;
  currentNodeId: string;
  phase: string;
  isComplete: boolean;
  iterations: number;
  hasOpener: boolean;
  currentNodeExecutionId: string | undefined;
  userMessageSignalReady: boolean;
  currentNodeQuestionsGenerated: boolean | undefined;
  pendingUserMessage: boolean;
  lastActivity: string;
  pathTaken: string[];
  errorHolding?: {
    isActive: boolean;
    errorMessage: string;
    nodeId: string;
    timestamp: string;
  };
}

// Define query to expose workflow status
export const getWorkflowStatus =
  defineQuery<WorkflowStatusInfo>('getWorkflowStatus');
export const hasHandledWorkflowAnswer = defineQuery<boolean, [string]>(
  'hasHandledWorkflowAnswer',
);
export const hasHandledStartRunKickoff = defineQuery<boolean, [string]>(
  'hasHandledStartRunKickoff',
);

// Signals will be defined dynamically inside the workflow function using workflowId

export async function conversationFlowWorkflow(
  input: StartConversationFlowWorkflowInput,
): Promise<void> {
  log.debug('[conversationFlowWorkflow] Workflow started', {
    input,
  });

  // Note: Using static imports for better test environment compatibility

  const startRunKickoffRequired =
    input.additionalContext?.['startRunKickoffRequired'] === true;
  const workflowAdditionalContext = input.additionalContext
    ? Object.fromEntries(
        Object.entries(input.additionalContext).filter(
          ([key]) => key !== 'startRunKickoffRequired',
        ),
      )
    : undefined;
  const resolvedAdditionalContext = resolveOnboardingAdditionalContext({
    flowId: input.flowId,
    conversationId: input.conversationId,
    additionalContext: workflowAdditionalContext,
  });
  const effectiveAdditionalContext = resolvedAdditionalContext;
  const normalizedAdditionalContext =
    input.flowId === 'repository-import'
      ? normalizeRepositoryGroundingAdditionalContext(
          effectiveAdditionalContext,
        )
      : effectiveAdditionalContext;

  // Initialize workflow state from input
  const state = await initializeWorkflowState(
    input as WorkflowInput,
    normalizedAdditionalContext,
  );
  const resolvedRepositoryImportIdentity = resolveRepositoryImportFlowIdentity({
    conversationWorkflowName: input.flowId,
    executionFlowId: input.flowId,
    currentNode: state.currentNodeId,
    flowState: { context: state.context },
  });
  if (resolvedRepositoryImportIdentity && input.flowId === 'onboarding') {
    state.flowId = resolvedRepositoryImportIdentity;
    state.context = normalizeRepositoryGroundingAdditionalContext(
      state.context,
    ) as typeof state.context;
  }
  prepareStartRunKickoffGate(state, startRunKickoffRequired);

  // Initialize Phase 3 Systems
  const metricsCollector = new WorkflowMetricsCollector();
  const healthChecker = new WorkflowHealthChecker(metricsCollector, {
    maxExecutionTime: 300000, // 5 minutes
    maxErrorRate: 5, // 5%
    maxMemoryUtilization: 80, // 80%
    maxSignalQueueLength: 100,
    minAgentSuccessRate: 90, // 90%
    healthCheckInterval: 30000, // 30 seconds
    metricsAggregationWindow: 300000, // 5 minutes
    alertCooldownPeriod: 60000, // 1 minute
    maxActiveAlerts: 50,
  });
  const versionManager = new ContextVersionManager();
  const sharingManager = new ContextSharingManager();
  const transformationPipeline = new ContextTransformationPipeline();
  const coordinationSystem = new AgentCoordinationSystem();

  // Initialize workflow metrics tracking
  const workflowMetrics = metricsCollector.initializeWorkflowMetrics(state);

  log.debug('[conversationFlowWorkflow] Phase 3 systems initialized', {
    workflowId: state.workflowId,
    metricsInitialized: !!workflowMetrics,
    healthCheckerReady: !!healthChecker,
    systemsCount: 6,
  });

  // Set up signal handlers with dynamic names for isolation
  const setUserMessage = defineSignal<[FlowUserMessage]>(
    WorkflowSignals.getWorkflowUserMessageSignalName(state.workflowId),
  );
  const setWorkflowAnswer = defineSignal<[WorkflowAnswerSignalPayload]>(
    WorkflowSignals.getWorkflowAnswerSignalName(state.workflowId),
  );
  const setStartRunKickoff = defineSignal<[StartRunKickoffSignalPayload]>(
    WorkflowSignals.getStartRunKickoffSignalName(state.workflowId),
  );
  const setLLMResponse = defineSignal<[LLMResponsePayload]>(
    WorkflowSignals.getLLMResponseSignalName(state.workflowId),
  );
  const setSkipToNode = defineSignal<
    [{ nodeId: string; systemMessageComplete?: boolean } | string]
  >(WorkflowSignals.getSkipToNodeSignalName(state.workflowId));
  const setReplayNode = defineSignal(
    WorkflowSignals.getReplayNodeSignalName(state.workflowId),
  );
  const setCompleteFlow = defineSignal(`completeFlow-${state.workflowId}`);

  // Configure signal handlers
  setHandler(setUserMessage, (message: FlowUserMessage) => {
    log.debug('[conversationFlowWorkflow] Received user message signal', {
      messageType: message.type,
      hasResponses:
        message.data && typeof message.data === 'object'
          ? Object.keys(message.data).length > 0
          : false,
      nodeId: state.currentNodeId,
      nodeType: state.nodeConfig?.type,
      workflowId: state.workflowId,
      userId: message.userId, // Log the userId from the message
    });

    // Completion-candidate resume predicate: drop only synthetic CONTROL
    // messages, which steer the workflow through a separate path. Authorship
    // is no longer the discriminator — an action-bearing USER button click
    // (Approve / Continue Refining) is a legitimate completion for an
    // EXTERNAL_AGENT node, and the action map
    // (`validateExternalAgentCompletion`) plus `acceptsUserMessages` enforce
    // the real contract downstream. All other node types preserve today's
    // behavior.
    const currentNodeType = state.nodeConfig?.type;
    if (currentNodeType && !isNodeCompletionMessage(currentNodeType, message)) {
      log.debug(
        '[conversationFlowWorkflow] Ignoring user message; not a completion candidate (CONTROL)',
        {
          currentNodeType,
          userId: message.userId,
          nodeId: state.currentNodeId,
          workflowId: state.workflowId,
        },
      );
      return;
    }

    // Update context with new userId if present (for multi-user support)
    if (message.userId && state.context?.core?.user) {
      log.debug('[conversationFlowWorkflow] Updating context userId', {
        previousUserId: state.context.core.user.id,
        newUserId: message.userId,
        workflowId: state.workflowId,
      });
      state.context.core.user.id = message.userId as UserId;
    }

    enqueueUserMessage(state, message);
    state.lastUserMessageId = message.id;
  });

  const handledWorkflowAnswerOperationIds = new Set<string>();
  setHandler(hasHandledWorkflowAnswer, (operationId: string) =>
    handledWorkflowAnswerOperationIds.has(operationId),
  );
  setHandler(setWorkflowAnswer, (answer: WorkflowAnswerSignalPayload) => {
    if (handledWorkflowAnswerOperationIds.has(answer.operationId)) return;
    if (answer.nodeId !== state.currentNodeId) {
      log.warn(
        '[conversationFlowWorkflow] Ignoring mismatched workflow answer',
        {
          operationId: answer.operationId,
          expectedNodeId: state.currentNodeId,
          receivedNodeId: answer.nodeId,
        },
      );
      return;
    }
    handledWorkflowAnswerOperationIds.add(answer.operationId);
    enqueueUserMessage(state, answer.message);
    state.lastUserMessageId = answer.message.id;
  });

  const handledStartRunKickoffOperationIds = new Set<string>();
  let awaitingStartRunKickoff = startRunKickoffRequired;
  setHandler(hasHandledStartRunKickoff, (operationId: string) =>
    handledStartRunKickoffOperationIds.has(operationId),
  );
  setHandler(setStartRunKickoff, (kickoff: StartRunKickoffSignalPayload) => {
    recordStartRunKickoff(state, handledStartRunKickoffOperationIds, kickoff);
  });

  setHandler(setLLMResponse, (response: LLMResponsePayload) => {
    log.debug('[SIGNAL_DEBUG] LLM response signal received', {
      signalReceived: true,
      requestId: response?.requestId,
      hasResponseData: !!response?.responseData,
      responseDataType: typeof response?.responseData,
      nextNodeId: response?.nextNodeId,
      errorHolding: response?.errorHolding,
      workflowId: state.workflowId,
      currentStep: state.step,
      currentNodeId: state.currentNodeId,
      currentNodeExecutionId: state.currentNodeExecutionId,
    });

    if (response.contextUpdates && state.context) {
      applyContextPatch(state.context, response.contextUpdates);
    }

    // Check for error holding signal
    if (response.errorHolding) {
      log.debug('[conversationFlowWorkflow] Error holding signal received', {
        currentNodeId: state.currentNodeId,
        errorMessage: response.responseData?.response,
        workflowId: state.workflowId,
      });

      // Set error holding state
      const errorData = response.responseData;
      const errorContext = isErrorSystemMessageData(errorData)
        ? errorData.context
        : undefined;
      const errorType = isErrorSystemMessageData(errorData)
        ? errorData.errorType
        : undefined;

      state.errorHolding = {
        isActive: true,
        errorMessage: response.responseData?.response || 'Unknown error',
        errorCode:
          typeof errorType === 'string' && errorType.length
            ? errorType
            : 'UNKNOWN_ERROR',
        nodeId: state.currentNodeId,
        timestamp: new Date(),
        compensationReason: errorContext,
        context: { requestId: response.requestId },
      };
    } else {
      state.pendingLLMResponse = response;

      log.debug('[SIGNAL_DEBUG] State updated with LLM response', {
        statePendingLLMResponseSet: !!state.pendingLLMResponse,
        statePendingRequestId: state.pendingLLMResponse?.requestId,
        workflowId: state.workflowId,
      });
    }
  });

  setHandler(
    setSkipToNode,
    (params: { nodeId: string; systemMessageComplete?: boolean } | string) => {
      // Support legacy string format for backwards compatibility
      const nodeId = typeof params === 'string' ? params : params.nodeId;
      const systemMessageComplete =
        typeof params === 'object' ? params.systemMessageComplete : false;

      log.debug('[conversationFlowWorkflow] Received skip to node signal', {
        nodeId,
        systemMessageComplete,
        currentNodeId: state.currentNodeId,
        workflowId: state.workflowId,
      });

      state.skipInfo = {
        targetNodeId: nodeId,
        systemMessageComplete,
      };
    },
  );

  setHandler(setReplayNode, () => {
    log.debug('[conversationFlowWorkflow] Received replay node signal', {
      currentNodeId: state.currentNodeId,
      currentPhase: state.phase,
      workflowId: state.workflowId,
    });

    // Completely reset node execution state by creating new execution object
    // This ensures loadNodeConfiguration doesn't recalculate the phase incorrectly
    state.context.currentNodeExecution = {
      nodeId: state.currentNodeId,
      questionsGenerated: false,
    };

    // Reset phase to executing so the replayed node can re-enter its normal execution path
    state.phase = WorkflowPhase.EXECUTING;

    // Clear any pending messages and responses that might interfere with replay
    resetUserMessageStoreOnReplay(state, 'replay');
    state.pendingLLMResponse = undefined; // old LLM responses can misalign with the replayed node
    state.triggeringUserMessage = undefined; // ensure downstream logic doesn't attribute the replay to a prior trigger

    // Clear error holding state if present (for recovery)
    if (state.errorHolding?.isActive) {
      log.debug(
        '[conversationFlowWorkflow] Clearing error holding state for replay',
        {
          previousErrorMessage: state.errorHolding.errorMessage,
          workflowId: state.workflowId,
        },
      );
      state.errorHolding = undefined;
    }

    // Set flag to refresh lastSystemMessageId from database
    state.needsLastSystemMessageRefresh = true;

    // Trigger workflow loop to process the reset node
    state.skipInfo = {
      targetNodeId: state.currentNodeId,
      systemMessageComplete: false,
    };

    log.debug('[conversationFlowWorkflow] Node replay state reset complete', {
      currentNodeId: state.currentNodeId,
      newPhase: state.phase,
      questionsGenerated:
        state.context.currentNodeExecution?.questionsGenerated,
      pendingLLMResponse: !!state.pendingLLMResponse,
      pendingUserMessage: hasPendingUserMessage(state),
      lastSystemMessageIdCleared: !state.context.lastSystemMessageId,
      workflowId: state.workflowId,
    });
  });

  setHandler(setCompleteFlow, () => {
    log.debug('[conversationFlowWorkflow] Received flow completion signal', {
      workflowId: state.workflowId,
    });
    state.isComplete = true;
  });

  // Set up query handler to expose workflow status
  setHandler(getWorkflowStatus, (): WorkflowStatusInfo => {
    return {
      step: state.step,
      currentNodeId: state.currentNodeId,
      phase: state.phase,
      isComplete: state.isComplete,
      iterations: state.iterations,
      hasOpener: state.hasOpener,
      currentNodeExecutionId: state.currentNodeExecutionId,
      userMessageSignalReady:
        awaitingStartRunKickoff || state.currentNodeExecutionId !== undefined,
      currentNodeQuestionsGenerated:
        state.context.currentNodeExecution?.questionsGenerated,
      pendingUserMessage: hasPendingUserMessage(state),
      lastActivity: new Date().toISOString(),
      pathTaken: state.context.flowPath.pathTaken,
      errorHolding: state.errorHolding?.isActive
        ? {
            isActive: state.errorHolding.isActive,
            errorMessage: state.errorHolding.errorMessage,
            nodeId: state.errorHolding.nodeId,
            timestamp: state.errorHolding.timestamp.toISOString(),
          }
        : undefined,
    };
  });

  if (awaitingStartRunKickoff) {
    await condition(() => handledStartRunKickoffOperationIds.size > 0);
    awaitingStartRunKickoff = false;
  }

  log.debug('[conversationFlowWorkflow] Starting main execution loop', {
    initialStep: state.step,
    currentNodeId: state.currentNodeId,
    maxIterations: state.maxIterations,
  });

  // Main execution loop - step-based state machine with Phase 3 monitoring
  while (state.step !== WorkflowStep.COMPLETING_FLOW && !state.isComplete) {
    state.iterations++;

    log.debug('[conversationFlowWorkflow] Processing step', {
      step: state.step,
      iteration: state.iterations,
      nodeId: state.currentNodeId,
      maxIterations: state.maxIterations,
    });

    // Check for error holding signal and transition if needed
    if (
      state.errorHolding?.isActive &&
      state.step !== WorkflowStep.ERROR_HOLDING
    ) {
      log.debug('[conversationFlowWorkflow] Transitioning to ERROR_HOLDING', {
        currentStep: state.step,
        errorMessage: state.errorHolding.errorMessage,
        workflowId: state.workflowId,
      });
      transitionToStep(
        state,
        WorkflowStep.ERROR_HOLDING,
        'Error holding signal received',
      );
    }

    // Start step execution tracking
    metricsCollector.startStepExecution(
      state.workflowId,
      state.step,
      state.currentNodeId,
    );

    // Create context version snapshot for critical steps
    if (
      [
        'INITIALIZING',
        'PROCESSING_USER_RESPONSE',
        'EXECUTING_AGENT_WITH_SIGNALS',
      ].includes(state.step)
    ) {
      try {
        versionManager.createSnapshot(
          state.workflowId,
          state.context,
          `Auto-snapshot before ${state.step}`,
          'system',
          [`step:${state.step}`, `iteration:${state.iterations}`],
        );
      } catch (snapshotError) {
        log.warn(
          '[conversationFlowWorkflow] Failed to create context snapshot',
          {
            error: (snapshotError as Error).message,
            step: state.step,
          },
        );
      }
    }

    // Check for max iterations before validation
    if (state.iterations > state.maxIterations) {
      log.warn(
        '[conversationFlowWorkflow] Maximum iterations exceeded, force completing',
        {
          iterations: state.iterations,
          maxIterations: state.maxIterations,
          step: state.step,
          nodeId: state.currentNodeId,
        },
      );

      // Record metrics for max iterations reached
      metricsCollector.recordError(
        state.workflowId,
        new Error('Maximum iterations exceeded'),
        { step: state.step, iterations: state.iterations },
        false, // not recoverable
        0,
      );

      metricsCollector.completeStepExecution(state, StepExecutionStatus.FAILED);

      transitionToStep(
        state,
        WorkflowStep.COMPLETING_FLOW,
        'Max iterations exceeded',
      );
      break;
    }

    // Validate state before processing (but skip iteration check since we handle it above)
    try {
      if (!state.currentNodeId) {
        throw new Error('WorkflowState: currentNodeId is required');
      }
      if (!state.context) {
        throw new Error('WorkflowState: context is required');
      }
      if (!state.nodeConfig) {
        throw new Error('WorkflowState: nodeConfig is required');
      }
    } catch (validationError) {
      log.error('[conversationFlowWorkflow] State validation failed', {
        error: (validationError as Error).message,
        state: {
          currentNodeId: state.currentNodeId,
          hasContext: !!state.context,
          hasNodeConfig: !!state.nodeConfig,
        },
      });

      // Record validation error in metrics
      metricsCollector.recordError(
        state.workflowId,
        validationError as Error,
        { step: state.step, validation: 'state' },
        false, // not recoverable
        0,
      );

      metricsCollector.completeStepExecution(state, StepExecutionStatus.FAILED);

      throw validationError;
    }

    // Handle lastSystemMessageId refresh after node replay
    // this code is bad! we should be restoring saved state
    if (state.needsLastSystemMessageRefresh) {
      await refreshSystemMessageId(state);
    }

    try {
      const result = await processWorkflowStep(state, metricsCollector);

      // Complete step tracking successfully
      metricsCollector.completeStepExecution(
        state,
        StepExecutionStatus.COMPLETED,
      );

      // Check if we should continue
      if (!result.shouldContinue) {
        break;
      }

      // Transition to next step
      if (result.nextStep !== state.step) {
        transitionToStep(
          state,
          result.nextStep,
          `Step ${state.step} completed successfully`,
        );
      }
    } catch (error) {
      log.error('[conversationFlowWorkflow] Error processing step', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        step: state.step,
        nodeId: state.currentNodeId,
        iteration: state.iterations,
      });

      // Record error in Phase 3 metrics
      metricsCollector.recordError(
        state.workflowId,
        error as Error,
        {
          step: state.step,
          nodeId: state.currentNodeId,
          iteration: state.iterations,
        },
        true, // potentially recoverable
        state.errorRecoveryState?.retryCount || 0,
      );

      // Complete step tracking as failed
      metricsCollector.completeStepExecution(state, StepExecutionStatus.FAILED);

      state.errorHolding = {
        isActive: true,
        errorMessage: (error as Error).message || 'Unknown error',
        errorCode: (error as Error).name || 'UNKNOWN_ERROR',
        nodeId: state.currentNodeId,
        timestamp: new Date(),
        compensationReason: undefined,
        context: {},
      };

      // For now, complete the flow on error
      // In production, you might want to retry or transfer to human
      transitionToStep(state, WorkflowStep.ERROR_HOLDING, 'Error encountered');
    }
  }

  // Handle completion if we reached max iterations
  if (state.iterations >= state.maxIterations) {
    log.warn('[conversationFlowWorkflow] Reached maximum iterations', {
      flowId: state.flowId,
      projectId: state.projectId,
      iterations: state.iterations,
    });

    // Update workflow status to indicate max iterations reached
    metricsCollector.updateWorkflowStatus(
      state.workflowId,
      WorkflowExecutionStatus.FAILED,
      new Date(),
    );
  } else {
    // Update workflow status to completed
    metricsCollector.updateWorkflowStatus(
      state.workflowId,
      WorkflowExecutionStatus.COMPLETED,
      new Date(),
    );
  }

  // Complete the workflow
  if (state.step !== WorkflowStep.COMPLETING_FLOW) {
    transitionToStep(state, WorkflowStep.COMPLETING_FLOW, 'Loop completed');
  }

  await handleCompletion(state as CompletionWorkflowState);

  // Perform Phase 3 cleanup and final metrics export
  try {
    // Export final metrics before cleanup
    const finalMetrics = metricsCollector.exportMetrics(state.workflowId);
    log.debug('[conversationFlowWorkflow] Final metrics exported', {
      workflowId: state.workflowId,
      metricsExported: !!finalMetrics,
      completedSteps: finalMetrics?.metrics?.completedSteps,
      totalDuration: finalMetrics?.metrics?.duration,
    });

    // Cleanup Phase 3 systems
    versionManager.cleanup(state.workflowId);
    sharingManager.cleanup(state.workflowId);
    transformationPipeline.cleanup(state.workflowId);
    coordinationSystem.cleanup(state.workflowId);
    // Note: Keep metrics in collector for potential export by monitoring APIs

    log.debug('[conversationFlowWorkflow] Phase 3 systems cleanup completed', {
      workflowId: state.workflowId,
    });
  } catch (cleanupError) {
    log.warn('[conversationFlowWorkflow] Phase 3 cleanup failed', {
      error: (cleanupError as Error).message,
      workflowId: state.workflowId,
    });
  }

  log.debug('[conversationFlowWorkflow] Workflow completed successfully', {
    flowId: state.flowId,
    projectId: state.projectId,
    organizationId: state.organizationId,
    workflowId: state.workflowId,
    totalIterations: state.iterations,
    finalNodeId: state.currentNodeId,
  });
}

// Helper function to process workflow steps with Phase 3 systems integration
export async function processWorkflowStep(
  state: WorkflowState,
  metricsCollector: WorkflowMetricsCollector,
) {
  // Create trace for step execution
  const traceSpanId = metricsCollector.createTrace(
    state.workflowId,
    `step_${state.step}`,
    'STEP_EXECUTION' as TraceOperationType,
  );

  try {
    let result: StepTransitionResult;
    let decisionOverride: NextStepAndPhaseResult | undefined;

    const startStep = state.step;
    const startPhase = WORKFLOW_STEP_TO_PHASE[startStep];

    switch (state.step) {
      case WorkflowStep.INITIALIZING:
        result = await handleInitialization(
          state as InitializationWorkflowState,
        );
        break;

      case WorkflowStep.EXECUTING_OPENER:
        result = await handleOpenerExecution(
          state as OpenerExecutionWorkflowState,
        );
        break;

      case WorkflowStep.WAITING_FOR_USER_INPUT:
        result = await handleUserWait(state as WaitingForUserWorkflowState);
        // Record user interaction metric
        if (hasPendingUserMessage(state)) {
          metricsCollector.recordBusinessMetric(
            state.workflowId,
            'user_interaction',
            1,
          );
        }
        break;

      case WorkflowStep.GENERATING_QUESTIONS:
        result = await handleGeneration(state as GenerationWorkflowState);
        break;

      case WorkflowStep.PROCESSING_USER_RESPONSE:
        result = await handleUserResponseProcessing(
          state as UserResponseProcessingWorkflowState,
        );
        // Record user interaction processing
        metricsCollector.recordBusinessMetric(
          state.workflowId,
          'user_response_processed',
          1,
        );
        break;

      case WorkflowStep.EXECUTING_AUTO_NODE:
        result = await handleAutoNodeExecution(
          state as AutoNodeExecutionWorkflowState,
        );
        break;

      case WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS: {
        // Enhanced agent execution with coordination system integration
        const agentStartTime = Date.now();

        try {
          result = await handleAgentExecutionWithSignals(
            state as AgentExecutionWorkflowState,
          );

          // Record successful agent execution metrics
          const agentDuration = Date.now() - agentStartTime;
          metricsCollector.recordAgentExecution(
            state.workflowId,
            'conversation-agent',
            agentDuration,
            true, // success
            150, // estimated tokens used
            0.05, // estimated cost
          );

          // Record business metrics for agent results
          if (state.pendingAgentResults?.length) {
            metricsCollector.recordBusinessMetric(
              state.workflowId,
              'agent_results_processed',
              state.pendingAgentResults.length,
            );
          }
        } catch (agentError) {
          // Record failed agent execution
          const agentDuration = Date.now() - agentStartTime;
          metricsCollector.recordAgentExecution(
            state.workflowId,
            'conversation-agent',
            agentDuration,
            false, // failed
          );
          throw agentError;
        }
        break;
      }
      case WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED:
      case WorkflowStep.GENERATING_QUESTIONS_SKIPPED:
      case WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS_SKIPPED: {
        const transition = await applySkipIntent(state, {
          loadNodeConfiguration,
        });
        decisionOverride = transition;
        result = {
          nextStep: transition.nextStep,
          shouldContinue: true,
        };
        break;
      }
      case WorkflowStep.ERROR_HOLDING:
        result = await handleErrorHolding(state as ErrorHoldingWorkflowState);
        break;

      case WorkflowStep.COMPLETING_FLOW:
        result = await handleCompletion(state as CompletionWorkflowState);
        // Record completion metrics
        metricsCollector.recordBusinessMetric(
          state.workflowId,
          'workflow_completed',
          1,
        );
        break;

      default:
        throw new Error(`Unknown workflow step: ${state.step as string}`);
    }

    // Complete trace successfully
    metricsCollector.completeTrace(
      state.workflowId,
      traceSpanId,
      'SUCCESS' as TraceStatus,
    );

    // Some handlers persist a terminal run-local condition themselves. In
    // particular, the user-wait timeout has already saved the precise waiting
    // snapshot and marked the execution PAUSED. Do not apply or persist a
    // follow-up transition that would overwrite that resumable state.
    if (!result.shouldContinue) {
      return result;
    }

    const decision: NextStepAndPhaseResult =
      decisionOverride ??
      ({
        nextStep: result.nextStep,
        nextPhase: WORKFLOW_STEP_TO_PHASE[result.nextStep],
        reason: 'handler_result',
      } as NextStepAndPhaseResult);

    await applyTransition(state, decision, startPhase);

    await saveFlowState({
      workflowState: state,
      executionId: state.executionId,
    });

    log.debug(`[processWorkflowStep] completed`, {
      startStep,
      endStep: decision.nextStep,
      startPhase,
      endPhase: decision.nextPhase,
      reason: decision.reason,
    });

    return {
      nextStep: decision.nextStep,
      shouldContinue: result?.shouldContinue ?? true,
    };
  } catch (stepError) {
    // Complete trace with error
    metricsCollector.completeTrace(
      state.workflowId,
      traceSpanId,
      'ERROR' as TraceStatus,
    );
    throw stepError;
  }
}

async function refreshSystemMessageId(state: WorkflowState) {
  log.debug(
    '[conversationFlowWorkflow] Refreshing lastSystemMessageId from database',
    {
      conversationId: state.conversationId,
      currentLastSystemMessageId: state.context.lastSystemMessageId,
    },
  );

  try {
    const lastSystemMessage = await getLastSystemMessage({
      conversationId: state.conversationId,
      organizationId: state.organizationId,
    });

    state.context.lastSystemMessageId = lastSystemMessage?.id || undefined;
    state.needsLastSystemMessageRefresh = false;

    log.debug(
      '[conversationFlowWorkflow] Successfully refreshed lastSystemMessageId',
      {
        newLastSystemMessageId: state.context.lastSystemMessageId,
        conversationId: state.conversationId,
      },
    );
  } catch (refreshError) {
    log.error(
      '[conversationFlowWorkflow] Failed to refresh lastSystemMessageId',
      {
        error: (refreshError as Error).message,
        conversationId: state.conversationId,
      },
    );
    // Don't throw - continue with current state but log the failure
    state.needsLastSystemMessageRefresh = false;
  }
}
