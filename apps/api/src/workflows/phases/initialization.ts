import { z } from 'zod';
import { WorkflowName } from '../../generated';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../types';
import { branded } from '../../utils/zod-branded';
import {
  createDefaultNodeConfig,
  createStepTransition,
  determineNextStep,
  determineNodePhase,
} from '../conversation-workflow-utils';
import {
  InitializationWorkflowState,
  StepTransitionResult,
  WorkflowInput,
  WorkflowState,
  WorkflowPhase,
  WorkflowStep,
} from '../conversation-workflow-state';
import {
  getNodeInfo,
  initializeConversationFlow,
  nodeNeedsTwoPhaseExecution,
  log,
} from './shared';

/**
 * Initializes workflow state from input
 */
export async function initializeWorkflowState(
  input: WorkflowInput,
  additionalContext?: Record<string, unknown>,
): Promise<WorkflowState> {
  log.debug('[Handler:Initialize] Starting workflow initialization', {
    input,
  });

  // Validate input
  const inputSchema = z.object({
    projectId: branded<ProjectId>(),
    workflowId: branded<WorkflowId>(),
    organizationId: branded<OrganizationId>(),
    flowId: z.string(),
    userId: branded<UserId>().nullable().optional(),
    conversationId: branded<ConversationId>().nullable().optional(),
    initiatedBy: z.enum(['SYSTEM', 'USER']),
    triggerEvent: z.string(),
    triggerData: z.record(z.unknown()).nullable().optional(),
    title: z.string(),
    workflowName: z.string().nullable().optional(),
    workflowAboutType: z.string().nullable().optional(), // Add workflowAboutType validation
    workflowAboutId: z.string().nullable().optional(), // Add workflowAboutId validation
    additionalContext: z.record(z.unknown()).nullable().optional(),
  });

  const validatedInput = inputSchema.parse(input) as WorkflowInput;

  // Semantic validation: If workflowAboutId is not defined, workflowAboutType should also not be defined
  if (!validatedInput.workflowAboutId && validatedInput.workflowAboutType) {
    throw new Error(
      `workflowAboutType (${validatedInput.workflowAboutType}) should not be defined when workflowAboutId is not provided`,
    );
  }

  // Validate workflowName against known flow templates
  if (validatedInput.workflowName) {
    const validWorkflowNames = Object.values(WorkflowName);
    if (
      !validWorkflowNames.includes(validatedInput.workflowName as WorkflowName)
    ) {
      throw new Error(
        `Invalid workflowName: ${validatedInput.workflowName}. Valid options: ${validWorkflowNames.join(', ')}`,
      );
    }
  }

  // Initialize conversation flow
  const result = await initializeConversationFlow({
    projectId: validatedInput.projectId,
    organizationId: validatedInput.organizationId,
    workflowId: validatedInput.workflowId,
    flowId: validatedInput.flowId,
    userId: validatedInput.userId,
    conversationId: validatedInput.conversationId,
    initiatedBy: validatedInput.initiatedBy,
    workflowAboutType: validatedInput.workflowAboutType,
    workflowAboutId: validatedInput.workflowAboutId,
    additionalContext,
  });

  // A resumable repository import's saved context is authoritative:
  // applying caller context here would silently overwrite accepted
  // repository-grounding choices on retry or reconnect. Preserve the historic
  // merge behavior for other flow families.
  const shouldMergeAdditionalContext =
    additionalContext &&
    (!result.isResuming ||
      (validatedInput.flowId !== WorkflowName.RepositoryImport &&
        validatedInput.flowId !== WorkflowName.WorkTrackerImport));
  if (shouldMergeAdditionalContext) {
    log.debug('[Handler:Initialize] Merging additional context', {
      additionalContext,
      existingContextKeys: Object.keys(result.context),
    });

    // Merge additional context into the flow context
    Object.assign(result.context, additionalContext);

    log.debug('[Handler:Initialize] Context merged', {
      mergedContextKeys: Object.keys(result.context),
    });
  }

  // Check if resuming incomplete workflow
  if (result.isResuming && result.savedWorkflowState) {
    log.debug('[Handler:Initialize] Restoring saved workflow state', {
      savedStep: result.savedWorkflowState.step,
      savedPhase: result.savedWorkflowState.phase,
      currentNodeId: result.savedWorkflowState.currentNodeId,
      iterations: result.savedWorkflowState.iterations,
    });

    // Restore workflow state from saved data
    const state: WorkflowState = {
      // Restore orchestration state
      step: result.savedWorkflowState.step,
      phase: result.savedWorkflowState.phase,
      nodeConfig: result.savedWorkflowState.nodeConfig,
      iterations: result.savedWorkflowState.iterations,
      currentNodeId: result.savedWorkflowState.currentNodeId,
      context: result.savedWorkflowState.context,

      // Restore core workflow info
      workflowId: validatedInput.workflowId,
      projectId: validatedInput.projectId,
      organizationId: validatedInput.organizationId,
      flowId: validatedInput.flowId,
      executionId: result.executionId,
      conversationId: result.context.core.conversationId,
      userId: validatedInput.userId,
      workflowAboutId: validatedInput.workflowAboutId,
      workflowAboutType: validatedInput.workflowAboutType,

      // Restore error state if present
      errorHolding: result.savedWorkflowState.errorHolding
        ? {
            ...result.savedWorkflowState.errorHolding,
            timestamp: new Date(), // Use current time for restored error state
          }
        : undefined,

      userMessagesByExecution: {},
      // Restore the per-instance bucket key for userMessagesByExecution.
      // Required for signal handlers wired up immediately after init to
      // enqueue messages without throwing — handlers can fire before the
      // main loop runs setCurrentExecutionId.
      currentNodeExecutionId: result.savedWorkflowState.currentNodeExecutionId,
      pendingLLMResponse: undefined,
      triggeringUserMessage: undefined,
      lastUserMessageId: result.savedWorkflowState.lastUserMessageId,
      pendingAgentResults: [],

      // Restore flow control flags
      isComplete: false, // Always false when resuming
      hasOpener: result.hasOpener,
      maxIterations: 100,

      // Restore metadata
      initiatedBy: validatedInput.initiatedBy,
      triggerEvent: validatedInput.triggerEvent,
      title: validatedInput.title,
      workflowName: validatedInput.workflowName,
      userResponseTimeout: validatedInput.userResponseTimeout,
    };

    // Legacy-state fallback: pre-persistence snapshots (and the legacy
    // FlowContext converter) don't carry currentNodeExecutionId. Use the
    // last system message id as the bucket key — it's the trigger id for
    // the EXTERNAL_AGENT node we're resuming on, which matches what the
    // main loop would set once it re-enters the node.
    if (
      !state.currentNodeExecutionId &&
      result.savedWorkflowState.lastSystemMessageId
    ) {
      state.currentNodeExecutionId =
        result.savedWorkflowState.lastSystemMessageId;
    }

    log.debug('[Handler:Initialize] Workflow state restored', {
      step: state.step,
      currentNodeId: state.currentNodeId,
      phase: state.phase,
      iterations: state.iterations,
    });

    return state;
  }

  // Create initial workflow state for new workflows
  const state: WorkflowState = {
    step: WorkflowStep.INITIALIZING,
    workflowId: validatedInput.workflowId,
    projectId: validatedInput.projectId,
    organizationId: validatedInput.organizationId,
    flowId: validatedInput.flowId,
    executionId: result.executionId,
    conversationId: result.context.core.conversationId,
    userId: validatedInput.userId,
    workflowAboutId: validatedInput.workflowAboutId,
    workflowAboutType: validatedInput.workflowAboutType,

    currentNodeId: result.startNode,
    nodeConfig: createDefaultNodeConfig(result.startNode),
    phase: WorkflowPhase.INITIALIZING,
    context: result.context,

    lastUserMessageId: undefined,
    userMessagesByExecution: {},
    currentNodeExecutionId: undefined,

    isComplete: false,
    hasOpener: result.hasOpener,
    iterations: 0,
    maxIterations: 100,

    initiatedBy: validatedInput.initiatedBy,
    triggerEvent: validatedInput.triggerEvent,
    title: validatedInput.title,
    workflowName: validatedInput.workflowName,
    userResponseTimeout: validatedInput.userResponseTimeout,
  };

  // Add starting node to path
  if (state.context.flowPath?.pathTaken) {
    state.context.flowPath.pathTaken.push(state.currentNodeId);
  }

  log.debug('[Handler:Initialize] Workflow state initialized', {
    currentNodeId: state.currentNodeId,
    hasOpener: state.hasOpener,
    executionId: state.executionId,
  });

  return state;
}

/**
 * Handles workflow initialization and determines first step
 */
export async function handleInitialization(
  state: InitializationWorkflowState,
): Promise<StepTransitionResult> {
  log.debug('[Handler:Initialize] Processing initialization step', {
    initiatedBy: state.initiatedBy,
    hasOpener: state.hasOpener,
    currentNodeId: state.currentNodeId,
  });

  // For flows with opener, execute opener first regardless of who initiated
  if (state.hasOpener) {
    return createStepTransition(state.step, WorkflowStep.EXECUTING_OPENER);
  }

  // For flows without opener, load node config and determine next step
  await loadNodeConfiguration(state);
  const nextStep = determineNextStep(state);
  return createStepTransition(state.step, nextStep);
}

/**
 * Loads node configuration and updates state
 */
export async function loadNodeConfiguration(
  state: WorkflowState,
): Promise<void> {
  // Get node configuration
  const nodeInfo = await getNodeInfo({
    flowId: state.flowId,
    nodeId: state.currentNodeId,
  });

  // Check if node supports two-phase execution
  const supportsPhases = await nodeNeedsTwoPhaseExecution({
    flowId: state.flowId,
    nodeId: state.currentNodeId,
  });

  // Update node configuration
  state.nodeConfig = {
    id: state.currentNodeId,
    type: nodeInfo?.nodeType || 'UNKNOWN',
    supportsPhases,
  };

  // Update execution phase
  state.phase = determineNodePhase(
    state.nodeConfig,
    state.context.currentNodeExecution || { questionsGenerated: false },
  );

  // Reset execution state if we moved to a new node
  if (
    !state.context.currentNodeExecution ||
    state.context.currentNodeExecution.nodeId !== state.currentNodeId
  ) {
    state.context.currentNodeExecution = {
      nodeId: state.currentNodeId,
      questionsGenerated: false,
    };
  }

  log.debug('[Handler:LoadConfig] Node configuration loaded', {
    nodeId: state.currentNodeId,
    supportsPhases: state.nodeConfig.supportsPhases,
    phase: state.phase,
  });
}
