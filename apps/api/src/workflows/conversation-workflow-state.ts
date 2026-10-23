import {
  ConversationId,
  FlowExecutionId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../types';
import {
  AgentExecutionResultPayload,
  FlowContext,
  FlowUserMessage,
} from '../types/flow-internal.types';
import { SystemMessageData, WorkflowName } from '../generated';
import { WorkflowDurationOptions } from '@temporalio/workflow';
import { ContextPatch } from '../utils/mutable-context';

type UserResponseTimeout = WorkflowDurationOptions['workflowRunTimeout'];

/**
 * Workflow execution steps - explicit state machine phases
 */
export enum WorkflowStep {
  INITIALIZING = 'initializing',
  EXECUTING_OPENER = 'executing_opener',
  WAITING_FOR_USER_INPUT = 'waiting_for_user_input',
  GENERATING_QUESTIONS = 'generating_questions',
  GENERATING_QUESTIONS_SKIPPED = 'generating_questions_skipped',
  PROCESSING_USER_RESPONSE = 'processing_user_response',
  EXECUTING_AUTO_NODE = 'executing_auto_node',
  EXECUTING_AGENT_WITH_SIGNALS = 'executing_agent_with_signals',
  EXECUTING_AGENT_WITH_SIGNALS_SKIPPED = 'executing_agent_with_signals_skipped',
  ERROR_HOLDING = 'error_holding',
  COMPLETING_FLOW = 'completing_flow',
  WAITING_FOR_USER_INPUT_SKIPPED = 'waiting_for_user_input_skipped',
}

export enum WorkflowPhase {
  INITIALIZING = 'initializing',
  EXECUTING = 'executing',
  WAITING_FOR_USER = 'waiting_for_user',
  OPENER = 'opener',
  PROCESSING_USER_RESPONSE = 'processing_user_response',
  ERROR = 'error',
  COMPLETING = 'completing',
}

export const WORKFLOW_STEP_TO_PHASE: Record<WorkflowStep, WorkflowPhase> = {
  [WorkflowStep.INITIALIZING]: WorkflowPhase.INITIALIZING,
  [WorkflowStep.EXECUTING_OPENER]: WorkflowPhase.OPENER,
  [WorkflowStep.WAITING_FOR_USER_INPUT]: WorkflowPhase.WAITING_FOR_USER,
  [WorkflowStep.WAITING_FOR_USER_INPUT_SKIPPED]: WorkflowPhase.WAITING_FOR_USER,
  [WorkflowStep.GENERATING_QUESTIONS]: WorkflowPhase.EXECUTING,
  [WorkflowStep.GENERATING_QUESTIONS_SKIPPED]: WorkflowPhase.EXECUTING,
  [WorkflowStep.PROCESSING_USER_RESPONSE]:
    WorkflowPhase.PROCESSING_USER_RESPONSE,
  [WorkflowStep.EXECUTING_AUTO_NODE]: WorkflowPhase.EXECUTING,
  [WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS]: WorkflowPhase.EXECUTING,
  [WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS_SKIPPED]: WorkflowPhase.EXECUTING,
  [WorkflowStep.ERROR_HOLDING]: WorkflowPhase.ERROR,
  [WorkflowStep.COMPLETING_FLOW]: WorkflowPhase.COMPLETING,
};
/**
 * LLM response payload received via signal
 */
export interface LLMResponsePayload {
  requestId: RequestId;
  responseData: SystemMessageData;
  nextNodeId?: string;
  errorHolding?: boolean;
  contextUpdates?: ContextPatch;
}

/**
 * Node configuration retrieved from flow template
 */
export interface NodeConfiguration {
  id: string;
  type: string; // NodeType enum value
  supportsPhases: boolean;
  enableSignalProcessing?: boolean;

  // Phase 2: Enhanced Node Configuration
  requiresNextNodeId?: boolean; // Validate nextNodeId is provided
  requiresUserConfirmation?: boolean; // Wait for explicit user confirmation
  validationRules?: NodeValidationRule[]; // Custom validation rules
  maxRetries?: number; // Max retry attempts for this node
  timeout?: number; // Node execution timeout in milliseconds
  // Add other node config properties as needed
}

export interface NodeValidationRule {
  type: 'NEXT_NODE_ID' | 'USER_CONFIRMATION' | 'SIGNAL_PROCESSING' | 'CUSTOM';
  required: boolean;
  errorMessage: string;
  customValidator?: (
    nodeConfig: NodeConfiguration,
    context: unknown,
  ) => boolean;
}

export interface WorkflowSignalQueueItem {
  id: string;
  type:
    | 'USER_MESSAGE'
    | 'LLM_RESPONSE'
    | 'AGENT_RESULT'
    | 'INITIATIVE_SIGNAL'
    | 'COMPLETION';
  payload: unknown;
  timestamp: Date;
  priority: SignalPriority;
  retries: number;
  maxRetries: number;
  dedupKey?: string; // For deduplication
}

export enum SignalPriority {
  IMMEDIATE = 1, // User messages, completion signals
  HIGH = 2, // Content updates, urgent user actions
  NORMAL = 3, // Standard agent results, LLM responses
  LOW = 4, // Background updates, metrics
}

export interface SignalProcessingState {
  isProcessing: boolean;
  currentSignalId?: string;
  lastProcessedTimestamp?: Date;
  failedSignals: WorkflowSignalQueueItem[];
  processingErrors: SignalProcessingError[];
}

export interface SignalProcessingError {
  signalId: string;
  error: string;
  timestamp: Date;
  retryCount: number;
}

/**
 * Phase 2: Error Recovery State (imported from error-recovery-manager)
 */
export interface ErrorRecoveryState {
  retryCount: number;
  lastErrorTime: Date;
  errorHistory: ErrorHistoryEntry[];
  circuitBreakerState: CircuitBreakerState;
}

export interface ErrorHistoryEntry {
  timestamp: Date;
  error: string;
  context: string;
  recovered: boolean;
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export type WriteableFlowContext = Writeable<FlowContext>;

/**
 * Centralized workflow state - single source of truth
 */
export interface WorkflowState {
  // Core workflow info
  step: WorkflowStep;
  workflowId: WorkflowId;
  projectId: ProjectId;
  organizationId: OrganizationId;
  flowId: WorkflowName;
  executionId: FlowExecutionId;
  conversationId: ConversationId;
  workflowAboutId: string | undefined;
  workflowAboutType: string | undefined;
  userId?: UserId;

  // Current execution state
  currentNodeId: string;
  nodeConfig: NodeConfiguration;
  phase: WorkflowPhase;
  context: WriteableFlowContext;

  // User messages tied to the current node execution
  userMessagesByExecution?: Record<string, FlowUserMessage>;
  currentNodeExecutionId?: string; // unique id for the node execution (e.g., requestId)

  // Pending signals
  pendingLLMResponse?: LLMResponsePayload;
  triggeringUserMessage?: FlowUserMessage;
  lastUserMessageId?: MessageId;

  pendingAgentResults?: AgentExecutionResultPayload[];

  // Phase 2: Enhanced Signal Queue Management
  signalQueue?: WorkflowSignalQueueItem[];
  signalProcessingState?: SignalProcessingState;

  // Per-phase ephemeral flags (consumed on transition)
  waitingForUserInputFlags?: {
    userMessageReceived?: boolean;
  };

  // Phase 2: Enhanced Error Recovery Management
  errorRecoveryState?: ErrorRecoveryState;

  // Agent execution tracking
  currentAgentExecution?: {
    executionId: string;
    agentId: string;
    startTime: Date;
    context: Record<string, unknown>;
  };
  lastProcessedSignalTimestamp?: Date;
  failedAgentAttempts?: number;
  agentExecutionStartTime?: Date;
  runningAgentExecutionId?: string;

  // Flow control flags
  isComplete: boolean;
  hasOpener: boolean;
  iterations: number;
  maxIterations: number;
  skipInfo?: {
    targetNodeId: string;
    systemMessageComplete?: boolean;
  };
  needsLastSystemMessageRefresh?: boolean;

  // Workflow metadata
  initiatedBy: 'SYSTEM' | 'USER';
  triggerEvent: string;
  title: string;
  workflowName?: string;
  userResponseTimeout?: UserResponseTimeout;

  // Error holding state
  errorHolding?: {
    isActive: boolean;
    errorMessage: string;
    errorCode: string;
    nodeId: string;
    timestamp: Date;
    compensationReason?: string;
    context?: Record<string, unknown>;
  };
}

/**
 * Initial workflow input
 */
export interface WorkflowInput {
  projectId: ProjectId;
  workflowId: WorkflowId;
  organizationId: OrganizationId;
  flowId: WorkflowName;
  userId: UserId;
  conversationId?: ConversationId;
  initiatedBy: 'SYSTEM' | 'USER';
  triggerEvent: string;
  title: string;
  workflowName?: string;
  workflowAboutType?: WorkflowAboutType; // Added to support proper workflow type tracking
  workflowAboutId?: string; // Added to support workflow entity tracking
  userResponseTimeout?: UserResponseTimeout;
  additionalContext?: Record<string, unknown>; // Additional flow context fields to merge
}

/**
 * Step transition result
 */
export interface StepTransitionResult {
  nextStep: WorkflowStep;
  shouldContinue: boolean;
}

type WorkflowStateWithoutPendingUserMessage = Omit<
  WorkflowState,
  'pendingUserMessage'
>;

/**
 * Workflow step handler function signature
 */
export type WorkflowStepHandler = (
  state: WorkflowState,
) => Promise<StepTransitionResult>;

export type MutablePendingUserMessageWorkflowState =
  WorkflowStateWithoutPendingUserMessage & {
    pendingUserMessage?: FlowUserMessage;
  };

type WithoutPendingUserMessage = WorkflowStateWithoutPendingUserMessage & {
  readonly pendingUserMessage?: undefined;
};

type WithPendingUserMessage = MutablePendingUserMessageWorkflowState & {
  pendingUserMessage: FlowUserMessage;
};

// Narrow workflow state types per execution phase
export type InitializationWorkflowState = WithoutPendingUserMessage & {
  step: WorkflowStep.INITIALIZING;
};

export type OpenerExecutionWorkflowState =
  MutablePendingUserMessageWorkflowState & {
    step: WorkflowStep.EXECUTING_OPENER;
  };

export type WaitingForUserWorkflowState =
  MutablePendingUserMessageWorkflowState & {
    step: WorkflowStep.WAITING_FOR_USER_INPUT;
  };

export type GenerationWorkflowState = MutablePendingUserMessageWorkflowState & {
  step: WorkflowStep.GENERATING_QUESTIONS;
};

export type UserResponseProcessingWorkflowState = WithPendingUserMessage & {
  step: WorkflowStep.PROCESSING_USER_RESPONSE;
};

export type AutoNodeExecutionWorkflowState =
  MutablePendingUserMessageWorkflowState & {
    step: WorkflowStep.EXECUTING_AUTO_NODE;
  };

export type AgentExecutionWorkflowState =
  MutablePendingUserMessageWorkflowState & {
    step: WorkflowStep.EXECUTING_AGENT_WITH_SIGNALS;
  };

export type ErrorHoldingWorkflowState = WithoutPendingUserMessage & {
  step: WorkflowStep.ERROR_HOLDING;
};

export type CompletionWorkflowState = WithoutPendingUserMessage & {
  step: WorkflowStep.COMPLETING_FLOW;
};

/**
 * Phases that are responsible for mutating pendingUserMessage.
 * Other steps see a readonly/cleared view to make accidental access a type error.
 */
export type PendingUserMessageMutableState =
  | OpenerExecutionWorkflowState
  | WaitingForUserWorkflowState
  | GenerationWorkflowState
  | UserResponseProcessingWorkflowState
  | AutoNodeExecutionWorkflowState
  | AgentExecutionWorkflowState;

/**
 * Serializable workflow state for persistence
 * Contains only what's needed to resume workflow execution
 */
export interface SerializableWorkflowState {
  // Workflow orchestration state
  step: WorkflowStep;
  phase: WorkflowPhase;
  nodeConfig: NodeConfiguration;
  iterations: number;

  // Flow context (already being saved)
  context: FlowContext;

  // Current execution position
  currentNodeId: string;

  // Per-instance execution id used as the bucket key in
  // userMessagesByExecution. Persisted so signal handlers wired up on
  // resume can enqueue user messages without racing the main loop's
  // node-load step (which sets the field for fresh runs). See
  // enqueueUserMessage in conversation-workflow-utils.ts.
  currentNodeExecutionId: string | undefined;

  lastSystemMessageId: MessageId | undefined;
  lastUserMessageId: MessageId | undefined;

  // Optional pending state (for mid-execution resumption)
  hasPendingLLMResponse?: boolean;

  // Error recovery state (if applicable)
  errorHolding?: {
    isActive: boolean;
    errorMessage: string;
    errorCode: string;
    nodeId: string;
  };

  // Metadata
  timestamp: string;
  version: number; // For schema evolution
}

/**
 * Type guard to check if an object is a SerializableWorkflowState
 */
export function isSerializableWorkflowState(
  obj: unknown,
): obj is SerializableWorkflowState {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'step' in obj &&
    'phase' in obj &&
    'nodeConfig' in obj &&
    'version' in obj &&
    'context' in obj
  );
}

/**
 * Convert legacy FlowContext to SerializableWorkflowState
 * Used for backward compatibility when reading old data from database
 *
 * @param flowContext - Legacy FlowContext from database
 * @param currentNodeId - The node ID where workflow should resume
 * @returns Complete SerializableWorkflowState with default orchestration values
 */
export function flowContextToSerializableState(
  flowContext: FlowContext,
  currentNodeId: string,
  lastUserMessageId: MessageId | undefined,
): SerializableWorkflowState {
  return {
    // Default orchestration state - will be overridden on next save
    step: WorkflowStep.INITIALIZING,
    phase: WorkflowPhase.INITIALIZING,
    nodeConfig: {
      id: currentNodeId,
      type: 'UNKNOWN',
      supportsPhases: false,
    },
    iterations: 0,
    lastSystemMessageId: flowContext.lastSystemMessageId,
    lastUserMessageId,

    // Preserve the actual business context
    context: flowContext,
    currentNodeId,
    currentNodeExecutionId: undefined,

    // Metadata
    timestamp: new Date().toISOString(),
    version: 1,
  };
}
