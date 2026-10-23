import type { INestApplicationContext } from '@nestjs/common';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { z } from 'zod';
import {
  JourneyStep,
  LocalPromptType,
  PhaseBreakdownPlan,
  PlanShapingApprovedVisual,
} from '../generated/local';
import type {
  PlanGenerationStageReviewPayload,
  PlanGenerationVisualPreviewEntry,
  AgentTrigger,
  AnalysisSystemMessageData,
  ArtifactResponseDto,
  ArtifactType,
  DesignDocTemplate,
  ErrorSystemMessageData,
  ExternalAgentNodeCompletion,
  FlowAction,
  GenerationSystemMessageData,
  MessageClassificationResult,
  NoopSystemMessageData,
  PlanGapAddedEntity,
  QuestionsSystemMessageData,
  SystemMessageData,
  UIElement,
  UIHints,
  UserMessage,
  EntityType,
  RecentActivityCorrelationRecordDto,
  ImplementationReadinessDisposition,
  RepositoryGroundingAnalysisConfiguration,
  RepositoryGroundingCompletion,
  RepositoryGroundingConversationSeed,
  RepositoryGroundingPrerequisites,
  RepositoryGroundingWorkflowContext,
  RepositoryGroundingSuccess,
  RepositoryFeatureEnrichmentAnswerBatch,
  RepositoryFeatureEnrichmentCompletion,
  RepositoryFeatureEnrichmentSuccess,
  RepositoryPlacementPendingHolder,
  RepositoryPlacementCompletionTarget,
  RepositoryPlacementStrategySubmission,
  RepositoryPlacementSuccess,
  RepositoryPlacementRetryableFailure,
  RepositoryPlacementTerminalFailure,
  PlanShapingFeatureSyncItemDecision,
} from '../generated';
import type {
  InitiativeSummary,
  PlanGapCategory as ApiPlanGapCategory,
  PlanGapDiscoveryUserFeedback,
  PlanGapItem as ApiPlanGapItem,
  PlanScopeRequestClarifyingAnswersInner,
  PlanProposalResponse,
  PlanSize,
  TaskSummary,
} from '../generated/agents/models';
import type {
  AgentResponseShape,
  MastraAgentResponse,
} from '../services/agents/mastra-client.service';
import { InitiativeDraft } from '../services/initiatives/types';
import type { FeatureGenerationResponse } from '../flows/utils/shared-schemas';
import type { FeatureTag } from '../generated/model/featureTag';
import type { ModelSelectionCriteria } from '../services/llm/llm-types';
import type {
  AgentSessionId,
  ConversationId,
  InitiativeId,
  MessageId,
  MockLlmSessionId,
  OrganizationId,
  PlanId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../types';
import { MutableContextHandle } from '../utils/mutable-context';
import type { DesignDocId } from './design-doc.types';
import { PromptBuilderStrategyType } from './prompt-builder-strategy.types';
import type { TaskStubSessionState } from './task-generation.types';

export type { MutableContextHandle };

/**
 * Result type for agent node processAgentResponse method
 * Success returns the next node and system message data; error allows an error message and optional routing override
 */
type AgentQuestionsSystemMessage = Partial<
  Omit<QuestionsSystemMessageData, 'response' | 'type' | 'uiElements' | 'title'>
> &
  Required<
    Pick<
      QuestionsSystemMessageData,
      'response' | 'type' | 'uiElements' | 'title'
    >
  >;

export type ProcessAgentResponseResult =
  | {
      nextNodeId: string;
      systemMessageData: AgentQuestionsSystemMessage;
    }
  | {
      nextNodeId?: string;
      errorMsg: string;
      systemMessageData?: Partial<SystemMessageData>;
    };

export type Intent = {
  type: string;
  confidence: number;
  userData: Record<string, string | boolean | number>;
  metadata?: Record<string, unknown>;
};

export type ConversationEntry = {
  type: 'user' | 'system' | 'assistant';
  userData: Record<string, string | number | boolean>;
  timestamp: Date;
  nodeId?: string; // Added for conversation history reconstruction
};

export type FlowArtifact = Pick<
  ArtifactResponseDto,
  'id' | 'type' | 'title' | 'data' | 'createdAt'
>;

export type FlowUserMessage = UserMessage & {
  nodeId?: string;
  timestamp: string;
  classification?: MessageClassificationResult;
  workflowId?: WorkflowId;
  workflowAnswerOperationId?: string;
};

export interface WorkflowAnswerSignalPayload {
  operationId: string;
  nodeId: string;
  message: FlowUserMessage;
}

export interface StartRunKickoffSignalPayload {
  operationId: string;
  message: FlowUserMessage;
}

export type FlowClassificationSnapshot = {
  nodeId: string;
  transition: string;
  timestamp: string;
  intent?: string;
  confidence?: number;
  reasoning?: string;
  payload?: Record<string, unknown> | null;
};

/**
 * Lightweight descriptor used by prompt builders to request prior artifacts.
 * Kept for compatibility with existing tests and tooling.
 */
export interface ArtifactRequest {
  type: ArtifactType;
  limit?: number;
  query?: string;
  filters?: Record<string, unknown>;
  includeDataSections?: boolean;
  metadata?: Record<string, unknown>;
}

// Data types for each node type's result
export type OpenerNodeData = {
  nodeId: string;
  nodeType: string;
};

export type GatherNodeData = {
  questions: Array<{
    id: string;
    description: string;
    type: string;
    required?: boolean;
  }>;
  understanding?: {
    projectType?: string;
    complexity?: 'simple' | 'moderate' | 'complex';
    keyTerms: string[];
  };
};

export type AnalyzeNodeData = {
  analysis: {
    identifiedTechnologies: string[];
    integrationComplexity: 'low' | 'medium' | 'high';
    potentialChallenges: Array<{
      area: string;
      description: string;
      mitigation: string;
    }>;
    recommendations: string[];
  } | null;
};

export type GenerateNodeData = {
  initiatives: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    tags: string[];
    estimatedEffort: 'small' | 'medium' | 'large';
    dependencies: string[];
  }>;
  summary: string | null;
};

export type ClassificationNodeData = {
  type: 'CLASSIFICATION';
  detectedIntent: string;
  intentConfidence: number;
  reasoning?: string;
  currentLevel?: string;
  nextLevel?: string;
  levelProgress?: number;
  suggestedNextStep?: string;
};

// Properly typed data for CONFIRM nodes
export type ConfirmNodeData =
  | RefinementCompleteConfirmData
  | GenericConfirmData;

// Initiative refinement completion confirmation data
export interface RefinementCompleteConfirmData {
  type: 'REFINEMENT_COMPLETE';
  detectedIntent: string;
  intentConfidence: number;
  initiativeId: InitiativeId;
  changesApplied: number;
  refinementComplete: boolean;
}

// Generic confirmation data for other confirm actions
export interface GenericConfirmData {
  type: 'GENERIC_CONFIRM';
  detectedIntent: string;
  intentConfidence: number;
  [key: string]: unknown;
}

// Properly typed data for ACTION nodes - discriminated union
export type ActionNodeData =
  | ApprovalActionData
  | InitiativeGenerationActionData
  | FeatureGenerationActionData
  | FinalizeActionData
  | GenericActionData;

// Initiative approval level progression data
export interface ApprovalActionData {
  type: 'ACTION_COMPLETE' | 'ACTION_ERROR';
  currentLevel?: string;
  nextLevel?: string | null;
  targetLevel?: string;
  generatingContent?: boolean;
  initiativeReady?: boolean;
  nextNodeId?: string; // For dynamic routing
  error?: string;
}

// Initiative generation data (for shared_generate_initiatives)
export interface InitiativeGenerationActionData {
  type: 'INITIATIVES';
  response: string;
  detectedIntent: string;
  intentConfidence: number;
  generatedInitiativeIds: string[];
  conversationIds: string[];
  uiElements: UIElement[];
}

// Feature generation data (for shared_generate_features)
export interface FeatureGenerationActionData {
  type: 'FEATURE_LIST';
  response: string;
  detectedIntent: string;
  intentConfidence: number;
  generatedProposalIds: string[];
  uiElements: UIElement[];
}

// Finalization action data
export interface FinalizeActionData {
  type: 'REFINEMENT_COMPLETE' | 'FINALIZATION_ERROR';
  finalizationResult?: unknown;
  initiativeId?: string;
  conversationId?: string;
  error?: string;
}

// Generic fallback for unknown action types
export interface GenericActionData {
  type: string;
  nextNodeId?: string; // For dynamic routing
  [key: string]: unknown;
}

export type AgentNodeData = {
  agentId: string;
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: {
    text: string;
    changes: Array<{
      type:
        | 'initiative_update'
        | 'priority_change'
        | 'tag_addition'
        | 'content_refinement';
      field: string;
      oldValue?: unknown;
      newValue: unknown;
      reasoning: string;
    }>;
    reasoning: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
    type: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED' | 'TIMEOUT';
    retryAfter?: number;
  };
  executionTime?: number;
  cost?: number;
};

export type InitiativesNodeData = {
  generatedInitiatives: Array<{
    id: string;
    title: string;
    description: string;
    details?: string;
    acceptanceCriteria?: string;
    currentLevel: 'description' | 'details' | 'acceptanceCriteria';
    reviewStatus: 'unreviewed' | 'in_progress' | 'approved';
    originalAssumptions: string[];
    userCorrections: string[];
    systemSuggestions: string[];
    priority?: 'low' | 'medium' | 'high' | 'critical';
    tags: string[];
    estimatedEffort?: 'small' | 'medium' | 'large';
    dependencies: string[];
    relatedIntegrationData?: Array<{
      type: string;
      source: string;
      relevance: number;
      data: Record<string, unknown>;
    }>;
    teamSuggestions?: Array<{
      userId: string;
      name: string;
      role: string;
      confidence: number;
    }>;
  }>;
  conversationId: string;
  initiativeCount: number;
  projectId: string;
  summary: {
    totalInitiatives: number;
    projectType?: string;
    complexity?: 'simple' | 'moderate' | 'complex';
  };
  nextSteps: string[];
  detectedIntent: string;
  intentConfidence: number;
  type?: string;
};

/**
 * AgentTrigger with `triggerMessageId` stripped — the shape producer nodes
 * return from `buildTriggerMessage` / a `NodeResult.triggersAgent`. The
 * persistence seam (`createSystemMessage` activity and the inline
 * `startExternalAgentNode` path) is the one place that pre-generates the
 * SYSTEM message id and stamps it onto the trigger before persisting, so
 * producers never have to know the id of the row they're about to land on.
 * The distributive conditional preserves the per-variant discriminated
 * union — each AgentTrigger variant keeps its own promptType narrowing.
 */
export type UnstampedAgentTrigger = AgentTrigger extends infer T
  ? T extends AgentTrigger
    ? Omit<T, 'triggerMessageId'>
    : never
  : never;

// Base result type
type BaseNodeResult = {
  nodeId?: string; // Optional - backend can add this when sending to UI
  message: string;
  archive?: boolean;
  uiElements?: UIElement[];
  uiHints?: UIHints;
  actions?: FlowAction[];
  // Structured marker that this node's emitted SYSTEM message is a trigger
  // for the CLI to dispatch a PromptHandler. Lands on the persisted message's
  // `data.triggersAgent` via createSystemMessage in activities.ts — same
  // MessageService ingress as POST /message, so conversation.updated fan-out
  // covers both directions uniformly. `triggerMessageId` is stamped at
  // persistence time, not by the producer node. See openapi AgentTrigger schema.
  triggersAgent?: UnstampedAgentTrigger;
};

// Typed NodeResult with discriminated union
export type TypedNodeResult =
  | (BaseNodeResult & {
      type: NodeType.OPENER;
      data: Omit<
        QuestionsSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.QUESTIONS;
      data: Omit<
        QuestionsSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.LLM_QUESTIONS;
      data: Omit<
        QuestionsSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.ANALYZE;
      data: Omit<
        AnalysisSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.GENERATE;
      data: Omit<
        GenerationSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.CLASSIFICATION;
      data: ClassificationNodeData;
    })
  | (BaseNodeResult & {
      type: NodeType.ERROR;
      data: Omit<
        ErrorSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & { type: NodeType.CONFIRM; data: ConfirmNodeData })
  | (BaseNodeResult & { type: NodeType.FINALIZE; data?: ConfirmNodeData })
  | (BaseNodeResult & {
      type: NodeType.ACTION;
      data: ActionNodeData | InitiativesNodeData;
    })
  | (BaseNodeResult & { type: NodeType.AGENT; data: AgentNodeData })
  | (BaseNodeResult & {
      type: NodeType.EXTERNAL_AGENT;
      data: Omit<
        QuestionsSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >;
    })
  | (BaseNodeResult & {
      type: NodeType.ROUTING;
      data: { temporary: boolean };
    })
  | (BaseNodeResult & {
      type: NodeType.NON_INTERACTIVE;
      data: { temporary: boolean };
    })
  | (BaseNodeResult & {
      type: NodeType.NOOP;
      data: Omit<NoopSystemMessageData, 'type' | 'response'>;
    });

// Union type that supports both typed and legacy formats
export type NodeResult = TypedNodeResult;

// Flexible return type for action nodes - allows separation of UI response and routing
export interface ActionNodeResult {
  nodeResult?: NodeResult; // Optional - UI/message response
  nextNodeId?: string; // Optional - routing override
}

// Constraint: action nodes must return at least one field
export type ValidActionNodeResult = ActionNodeResult &
  (
    | { nodeResult: NodeResult } // Has UI/message response
    | { nextNodeId: string } // Has routing decision
    | { nodeResult: NodeResult; nextNodeId: string } // Has both
  );

// Type guard functions
export function isTypedNodeResult(
  result: NodeResult,
): result is TypedNodeResult {
  return 'type' in result && typeof result.type === 'string';
}

export function isOpenerNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.OPENER } {
  return isTypedNodeResult(result) && result.type === NodeType.OPENER;
}

export function isQuestionsNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.QUESTIONS } {
  return isTypedNodeResult(result) && result.type === NodeType.QUESTIONS;
}

export function isLLMQuestionsNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.LLM_QUESTIONS } {
  return isTypedNodeResult(result) && result.type === NodeType.LLM_QUESTIONS;
}

export function isAnalyzeNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.ANALYZE } {
  return isTypedNodeResult(result) && result.type === NodeType.ANALYZE;
}

export function isGenerateNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.GENERATE } {
  return isTypedNodeResult(result) && result.type === NodeType.GENERATE;
}

export function isClassificationNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.CLASSIFICATION } {
  return isTypedNodeResult(result) && result.type === NodeType.CLASSIFICATION;
}

export function isConfirmNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.CONFIRM } {
  return isTypedNodeResult(result) && result.type === NodeType.CONFIRM;
}

export function isFinalizeNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.FINALIZE } {
  return isTypedNodeResult(result) && result.type === NodeType.FINALIZE;
}

export function isActionNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.ACTION } {
  return isTypedNodeResult(result) && result.type === NodeType.ACTION;
}

export function isAgentNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.AGENT } {
  return isTypedNodeResult(result) && result.type === NodeType.AGENT;
}

export function isExternalAgentNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.EXTERNAL_AGENT } {
  return isTypedNodeResult(result) && result.type === NodeType.EXTERNAL_AGENT;
}

export function isNonInteractiveNodeResult(
  result: NodeResult,
): result is TypedNodeResult & { type: NodeType.NON_INTERACTIVE } {
  return isTypedNodeResult(result) && result.type === NodeType.NON_INTERACTIVE;
}

// Type guard for ActionNodeResult
export function isValidActionNodeResult(
  result: unknown,
): result is ValidActionNodeResult {
  if (!result || typeof result !== 'object') {
    return false;
  }
  const actionResult = result as ActionNodeResult;
  return !!(actionResult.nodeResult || actionResult.nextNodeId);
}

// Internal flow system types that define the execution engine
// These types are for the flow engine implementation and are not part of the public API

/**
 * NodeType enum defines the different types of nodes in the conversation flow system.
 *
 * Node types and their purposes:
 * - OPENER: Initial node that starts the conversation (no user input wait)
 * - QUESTIONS: Static UI questions with hardcoded elements (ALWAYS waits for user input, no LLM needed)
 * - LLM_QUESTIONS: AI-generated contextual questions (ALWAYS waits for user input, requires LLM)
 * - ANALYZE: Analysis/processing node that evaluates data
 * - GENERATE: Content generation node
 * - CONFIRM: User confirmation node
 * - FINALIZE: Final processing/completion node
 * - NOOP: No operation/silent transition
 * - ACTION: Processing/logic node (continues immediately by default)
 * - AGENT: Agent-based processing node
 * - EXTERNAL_AGENT: Paused node whose completion message is produced by an
 *   external agent (e.g., the CLI) via POST /message with type=SYSTEM. Emits
 *   a standard NodeResult on entry like QUESTIONS; resumes only when an
 *   agent-authored message arrives, not on user-authored replies.
 * - ERROR: Error state node
 * - ROUTING: Classification/routing decision node
 * - CLASSIFICATION: Message classification node
 */
export enum NodeType {
  OPENER = 'opener',
  QUESTIONS = 'questions',
  LLM_QUESTIONS = 'llm_questions',
  ANALYZE = 'analyze',
  GENERATE = 'generate',
  CONFIRM = 'confirm',
  FINALIZE = 'finalize',
  NOOP = 'noop',
  ACTION = 'action',
  AGENT = 'agent',
  EXTERNAL_AGENT = 'external_agent',
  ERROR = 'error',
  ROUTING = 'routing',
  CLASSIFICATION = 'classification',
  NON_INTERACTIVE = 'non_interactive',
}

// TypeEnum for workflow structure validation
export const TypeEnum = z.enum([
  NodeType.QUESTIONS,
  NodeType.LLM_QUESTIONS,
  NodeType.ANALYZE,
  NodeType.GENERATE,
  NodeType.FINALIZE,
  NodeType.NOOP,
  NodeType.ACTION,
  NodeType.AGENT,
  NodeType.EXTERNAL_AGENT,
  NodeType.CLASSIFICATION,
  NodeType.NON_INTERACTIVE,
]);
export type TypeEnum = z.infer<typeof TypeEnum>;

// ============================================================================
// Injectable Node System - New DI-based node architecture
// ============================================================================

/**
 * Base interface for all Injectable flow nodes
 *
 * Nodes are NestJS services that encapsulate flow logic with proper dependency injection.
 * This replaces the factory function pattern with proper OOP and DI.
 */
export interface INode<TContext extends FlowContext = FlowContext> {
  /**
   * Unique identifier for this node within the flow
   */
  readonly id: string;

  /**
   * Node type discriminator
   */
  readonly type: NodeType;

  /**
   * When true nodes behave like question/answer nodes, requiring a user response
   */
  readonly twoPhase: boolean;

  /**
   * Optional node-level override for whether free-text USER messages landing
   * while this node is the currently-paused node should signal the workflow.
   * When unset, the resolver falls through to the workflow-level default and
   * finally to `true`. Resolution is performed in
   * `MessageProcessor.handleUserMessageCreated`.
   */
  readonly acceptsUserMessages?: boolean;

  /**
   * Optional display title for the node
   * Can be a static string or a function that returns a string based on context
   */
  readonly title?:
    | string
    | ((context: MutableContextHandle<TContext>) => string);

  /**
   * Optional message shown when the node begins processing.
   */
  readonly startMessage?: string;

  /**
   * Optional UI hints for frontend rendering
   */
  readonly uiHints?: UIHints;

  /**
   * Execute the node's main logic
   *
   * @param context - The current flow context
   * @param userMessage - Optional user message (for nodes that process user input)
   * @returns NodeResult with the outcome of execution
   */
  execute(
    context: MutableContextHandle<TContext>,
    userMessage?: FlowUserMessage,
  ): Promise<NodeResult>;

  /**
   * Optional lifecycle hook: Execute before the main node logic
   * Used for validation, data preparation, etc.
   *
   * @param context - The current flow context
   */
  preProcess?(context: MutableContextHandle<TContext>): Promise<void>;

  /**
   * Optional lifecycle hook: Execute after the main node logic
   * Used for side effects, analytics, cleanup, etc.
   *
   * @param context - The current flow context
   * @param result - The result from execute()
   */
  postProcess?(
    context: MutableContextHandle<TContext>,
    result: NodeResult,
  ): Promise<void>;

  /**
   * Optional routing logic to determine next node dynamically.
   * ONLY works with transition-based routing configurations.
   *
   * If your node uses static nextNode in the flow template, this method will
   * never be called and will throw a runtime error if defined.
   *
   * @param context - The current flow context
   * @param result - The result from execute()
   * @param transitions - Available transitions from flow config (required)
   * @returns Next node ID or undefined to fall back to intent-based routing
   */
  determineRouting?(
    context: Readonly<TContext>,
    result: NodeResult,
    transitions: TwoOrMoreTransitions,
  ): Promise<string | undefined>;

  /**
   * Optional routing logic to determine next node dynamically.
   * ONLY works with transition-based routing configurations.
   *
   * @param context - The current flow context
   * @param userMessage - The user response
   * @param transitions - Available transitions from flow config (required)
   * @returns Next node ID or undefined to fall back to intent-based routing
   */
  determineRoutingFromUserMessage?(
    context: Readonly<TContext>,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined>;

  /**
   * Optional saga-aware compensation for error handling
   *
   * @param context - The current flow context
   * @param error - The error that occurred
   * @param compensationContext - Metadata about the failure
   * @returns Compensation strategy (RETRY, SKIP_TO_NODE, or FAIL)
   */
  compensate?(
    context: Readonly<TContext>,
    error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult>;

  /**
   * Optional pre-classification for ClassificationNode types
   *
   * Allows nodes to bypass LLM calls for known patterns/magic strings.
   * Used by CLASSIFY nodes to provide fast-path routing.
   *
   * @param userMessage - The user's message to pre-classify
   * @param context - The current flow context
   * @returns RoutingResult with optional routing override, or undefined to continue with LLM
   */
  preClassify?(
    userMessage: FlowUserMessage,
    context: Readonly<TContext>,
  ): Promise<RoutingResult | undefined>;

  /**
   * Optional preparation before LLM generation (phase-1).
   *
   * Allows nodes to perform side effects or setup before calling the LLM.
   * Used by nodes that need to prepare context, fetch data, etc.
   *
   * @param context - The current flow context
   * @param userMessage - Optional user message being processed
   */
  beforeGeneration?(
    context: MutableContextHandle<TContext>,
    previousUserMessage?: FlowUserMessage,
  ): Promise<void>;

  /**
   * Optional response source for nodes that already have an authoritative,
   * typed result. Returning a value bypasses provider generation while keeping
   * the normal response-processing, publication, and routing path.
   */
  getPrecomputedResponse?(
    context: MutableContextHandle<TContext>,
    previousUserMessage?: FlowUserMessage,
  ): Promise<IntermediateSystemMessageData | undefined>;

  /**
   * Optional processing of user responses (phase-2).
   *
   * Allows nodes to persist user feedback or apply context updates before
   * routing decisions are made.
   *
   * @param context - The current flow context
   * @param userMessage - The user response being processed
   * @return void Promise, this method may not return a value
   */
  processUserResponse?(
    context: MutableContextHandle<TContext>,
    userMessage: FlowUserMessage,
  ): Promise<void>;

  /**
   * Optional post-processing of LLM response
   *
   * Allows nodes to modify or enrich the SystemMessageData returned by the LLM.
   * Used by nodes that need to transform responses, add additional data, etc.
   *
   * @param systemMessageData - The LLM response data to process
   * @param userMessage - Optional user message that triggered the LLM call
   * @param context - The current flow context
   * @returns Modified SystemMessageData and optional routing override
   */
  processLlmResponse?(
    systemMessageData: IntermediateSystemMessageData,
    userMessage: FlowUserMessage | undefined,
    context: MutableContextHandle<TContext>,
  ): Promise<{
    modifiedResult?: SystemMessageData;
    routingOverride?: string;
  }>;
}

/**
 * Abstract base class for OPENER nodes
 *
 * OPENER nodes:
 * - Start a conversation flow
 * - Don't wait for user input
 * - Have a fixed nextNode (no transitions)
 * - Execute immediately when flow starts
 */
export abstract class OpenerNodeBase<TContext extends FlowContext = FlowContext>
  implements INode<TContext>
{
  abstract readonly id: string;
  abstract readonly title: string;

  readonly type = NodeType.OPENER;

  /**
   * Optional prompt configuration for LLM-based analysis
   * Allows OPENER nodes to perform optional LLM analysis while still
   * showing UI elements to the user
   */
  readonly promptConfig?: PromptConfig;

  twoPhase = false;

  /**
   * The next node to transition to after this opener completes
   * Set via setNextNode() method during flow assembly
   */
  nextNode?: string;

  /**
   * Set the next node for this opener
   * Used during flow template construction
   *
   * @param nodeId - The ID of the next node
   * @returns this for method chaining
   */
  setNextNode(nodeId: string): this {
    this.nextNode = nodeId;
    return this;
  }

  /**
   * Get the next node ID for routing
   */
  getNextNode(): string | undefined {
    return this.nextNode;
  }

  /**
   * Execute the opener node logic
   * Must be implemented by subclasses
   */
  abstract execute(
    context: MutableContextHandle<TContext>,
  ): Promise<NodeResult>;
}

/**
 * Abstract base class for QUESTIONS nodes
 *
 * QUESTIONS nodes:
 * - Present static UI elements to gather user input
 * - ALWAYS wait for user response
 * - Can have either nextNode or transitions for routing
 * - Don't require LLM (questions are hardcoded)
 */
export abstract class QuestionsNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.QUESTIONS;

  twoPhase = true;

  /**
   * Execute the questions node logic
   * Must be implemented by subclasses
   */
  abstract execute(
    context: MutableContextHandle<TContext>,
  ): Promise<NodeResult>;
}

/**
 * Map of action-name → { Zod schema validating that action's payload,
 * waitForUser flag controlling whether completion parks on user input }.
 *
 * EXTERNAL_AGENT nodes declare one entry per action they accept. The engine
 * uses this map as the source of truth for the completion-message contract:
 * an inbound agent-authored message's `data.action` must be a key in this
 * map, and `data.payload` must parse against the corresponding schema.
 *
 * `waitForUser` is carried on each action so the engine can distinguish
 * iterating completions (which hand back to the user before the node
 * re-runs) from terminal/advancing ones. Omitting it is a TypeScript
 * compile error by design — EXTERNAL_AGENT authors must decide per action
 * whether the completion should park the flow.
 */
export type ExternalAgentActionSchemas = Record<
  string,
  { schema: z.ZodTypeAny; waitForUser: boolean }
>;

/**
 * Structured error thrown by the signing bridge when a persisted SYSTEM
 * trigger message arrives without `triggerMessageId` stamped, or with an id
 * that does not match the row it was loaded from. Mirrors
 * `ExternalAgentValidationError` symmetry from the completion side: instead
 * of silently emitting an envelope with a missing/bogus id, the bridge
 * raises this so the leak is visible. See Trigger Payload Context design doc.
 */
export class ExternalAgentTriggerError extends Error {
  readonly reason: 'missing_trigger_message_id' | 'trigger_message_id_mismatch';
  readonly nodeId: string | undefined;
  readonly messageId: string;
  readonly stampedMessageId: string | undefined;

  constructor(params: {
    reason: 'missing_trigger_message_id' | 'trigger_message_id_mismatch';
    nodeId: string | undefined;
    messageId: string;
    stampedMessageId: string | undefined;
    message?: string;
  }) {
    super(
      params.message ??
        `[EXTERNAL_AGENT] trigger validation failed reason=${params.reason} node=${params.nodeId ?? '(none)'} messageId=${params.messageId} stamped=${params.stampedMessageId ?? '(none)'}`,
    );
    this.name = 'ExternalAgentTriggerError';
    this.reason = params.reason;
    this.nodeId = params.nodeId;
    this.messageId = params.messageId;
    this.stampedMessageId = params.stampedMessageId;
  }
}

/**
 * Structured error returned when an EXTERNAL_AGENT completion message fails
 * validation. The engine leaves the node paused and surfaces this so
 * downstream producers (CLI) can retry with a well-formed message.
 */
export class ExternalAgentValidationError extends Error {
  readonly action: string | undefined;
  readonly reason: 'unknown_action' | 'invalid_payload' | 'missing_action';
  readonly issues?: z.ZodIssue[];
  readonly nodeId: string;

  constructor(params: {
    nodeId: string;
    action: string | undefined;
    reason: 'unknown_action' | 'invalid_payload' | 'missing_action';
    issues?: z.ZodIssue[];
    message?: string;
  }) {
    super(
      params.message ??
        `[EXTERNAL_AGENT] validation failed reason=${params.reason} node=${params.nodeId} action=${params.action ?? '(none)'}`,
    );
    this.name = 'ExternalAgentValidationError';
    this.action = params.action;
    this.reason = params.reason;
    this.issues = params.issues;
    this.nodeId = params.nodeId;
  }
}

/**
 * Abstract base class for EXTERNAL_AGENT nodes.
 *
 * EXTERNAL_AGENT nodes:
 * - Emit a standard NodeResult on entry (message + uiElements), exactly like
 *   QUESTIONS — the engine does not push anything to an external agent.
 * - Pause (`twoPhase = true`) and wait for a completion message to arrive.
 * - Only treat agent-authored messages (POST /message with type=SYSTEM, i.e.
 *   `userId === 'system'`) as legitimate completions; user-authored replies
 *   leave the node paused unless an explicit routing transition accepts them
 *   (configured in a follow-up task).
 * - Declare an `actions` map of Zod schemas for each action they accept. The
 *   engine validates incoming completion-message `data` against this map and
 *   routes via `transitions[action]` (falling back to `transitions.default`
 *   when no per-action entry is declared). Malformed or unknown actions
 *   leave the node paused and raise an `ExternalAgentValidationError`.
 *
 * The `uiElement` emitted on entry may carry a `promptType` that the CLI-side
 * handler picks up when the user submits their reply; that wiring lives in
 * the CLI task, not this foundation task.
 */
/**
 * Shape returned by `ExternalAgentNodeBase.buildTriggerMessage`. The base
 * class lifts this into a fully-formed `NodeResult` (for the `execute`
 * adapter) and into the `SystemMessageData` written to the SYSTEM trigger
 * message at create time.
 *
 * `triggersAgent` is **required**: external-agent nodes exist solely to emit
 * a trigger envelope to the CLI. Making it required at the type level is the
 * contract that prevents trigger payloads from being smuggled in via a later
 * `updateMessage` — `buildTriggerMessage` is the only call site that owns
 * trigger construction.
 */
export interface ExternalAgentTriggerMessage {
  /** Conversation message body shown in the UI. */
  response: string;
  /** UI elements to render on the trigger message. */
  uiElements: UIElement[];
  /**
   * Full trigger envelope without `triggerMessageId`. The persistence seam
   * (`startExternalAgentNode` / `createSystemMessage` activity) stamps the
   * pre-generated SYSTEM message id onto the trigger before writing to the
   * row, so this surface stays free of an id the producer cannot know.
   */
  triggersAgent: UnstampedAgentTrigger;
  /**
   * Sidecar SystemMessageData fields (detectedIntent, intentConfidence,
   * reasoning, ragEnabled, …). Spread onto the persisted message data.
   */
  data?: Record<string, unknown>;
}

export abstract class ExternalAgentNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.EXTERNAL_AGENT;

  readonly startMessage: string | undefined = 'Calling your local agent...';

  twoPhase = true;

  /**
   * Node-level override for whether free-text USER messages landing while
   * this node is the currently-paused node should signal the workflow. When
   * unset, the resolver falls through to the workflow-level default and
   * finally to `true` (current behavior). See
   * `MessageProcessor.handleUserMessageCreated` for the resolution chain.
   */
  readonly acceptsUserMessages?: boolean;

  /**
   * LocalPromptType this node emits on `data.triggersAgent.promptType` when
   * it fires. Declared on the base so both trigger emission and the
   * prompt-type lookup endpoint read from a single source of truth — node
   * implementations must route `this.promptType` through their
   * `triggersAgent` payload rather than re-hardcoding the literal.
   */
  abstract readonly promptType: LocalPromptType;

  /**
   * Per-action Zod schemas validating the `payload` carried on completion
   * messages. Subclasses MUST declare one entry per accepted action.
   */
  abstract readonly actions: ExternalAgentActionSchemas;

  /**
   * Build the trigger envelope and surrounding message data for this node.
   *
   * Runs at message-create time inside `startFlowNode` so the SYSTEM trigger
   * message is born with `data.triggersAgent` already populated — the
   * websocket bridge's create-only emit gate then fires once on
   * `messageAdded` and the CLI receives a single trigger frame. This is the
   * sole contract for trigger construction; the worker path is bypassed for
   * EXTERNAL_AGENT nodes, so `triggersAgent` can never land via a later
   * `updateMessage` (the failure mode this method was introduced to retire).
   */
  abstract buildTriggerMessage(
    tracker: MutableContextHandle<TContext>,
  ): Promise<ExternalAgentTriggerMessage>;

  /**
   * INode-required `execute` is a thin adapter over `buildTriggerMessage`.
   * Subclasses MUST NOT override this — override `buildTriggerMessage`. The
   * adapter exists so anything that historically reached for `node.execute()`
   * (tests, defensive fallbacks) keeps working without re-implementing the
   * trigger contract.
   */
  async execute(
    tracker: MutableContextHandle<TContext>,
    _userMessage?: FlowUserMessage,
  ): Promise<NodeResult> {
    const built = await this.buildTriggerMessage(tracker);
    return {
      type: NodeType.EXTERNAL_AGENT,
      message: built.response,
      uiElements: built.uiElements,
      triggersAgent: built.triggersAgent,
      data: (built.data ?? {
        detectedIntent: '',
        intentConfidence: 0,
      }) as Omit<
        QuestionsSystemMessageData,
        'type' | 'response' | 'uiElements' | 'actions'
      >,
    };
  }

  /**
   * Optional per-action routing override for agent-authored completion
   * messages. Called by the engine's `resolveExternalAgentRouting`
   * after the action has been validated but before falling back to the
   * static transition map. Returning a node id overrides the
   * transition table for this completion; returning `undefined` lets
   * the engine fall through to `transitions[action] ?? transitions.default`.
   *
   * Used by EXTERNAL_AGENT nodes that need to branch on FlowContext
   * state the static transition map cannot express — e.g. the
   * phase-breakdown self-loop, where the choice between looping back
   * to PHASE_BREAKDOWN and advancing to FINALIZE depends on how many
   * phases have accumulated on `FlowContext.accumulatedPhases`
   * relative to `journeySteps.length`, rather than the action
   * discriminator alone.
   *
   * @param context - The current flow context (after processUserResponse)
   * @param action - The validated action discriminator from the completion
   */
  determineRoutingFromAgentCompletion?(
    context: Readonly<TContext>,
    action: string,
  ): Promise<string | undefined>;

  /**
   * Optional routing hook for user-authored controls rendered on an external
   * agent status surface. The workflow engine calls this only after the
   * node's own admission validator has accepted the typed user action.
   */
  determineRoutingFromUserMessage?(
    context: Readonly<TContext>,
    userMessage: FlowUserMessage,
  ): Promise<string>;
}

/**
 * Engine-side wire shape of an EXTERNAL_AGENT completion message's `data`.
 *
 * The API layer carries completions under the typed discriminator
 * `AgentSystemMessageData.completesExternalAgentNode`
 * (`ExternalAgentNodeCompletion`). The MessageProcessor bridge flattens that
 * nested object to top-level `action` / `payload` on `FlowUserMessage.data`
 * before signaling Temporal, so that nodes and the validator below can
 * continue to read a stable engine-local shape regardless of how the API
 * envelope evolves. The open index signature preserves passthrough of the
 * other `AgentSystemMessageData` fields (e.g. `detectedIntent`,
 * `intentConfidence`) for debugging without typing each one here.
 */
export type ExternalAgentFlowData = Pick<
  ExternalAgentNodeCompletion,
  'action' | 'payload'
> & { [key: string]: unknown };

/**
 * Validate an incoming agent-authored completion message against a node's
 * declared action schemas.
 *
 * Returns the validated action on success. Throws
 * `ExternalAgentValidationError` for missing/unknown actions or payloads
 * that fail schema validation, so callers in the engine can leave the node
 * paused without advancing.
 */
export function validateExternalAgentCompletion(params: {
  nodeId: string;
  actions: ExternalAgentActionSchemas;
  message: FlowUserMessage;
}): { action: string } {
  const { nodeId, actions, message } = params;
  const data = (message.data ?? {}) as Partial<ExternalAgentFlowData>;
  const action = typeof data.action === 'string' ? data.action : undefined;

  if (!action) {
    throw new ExternalAgentValidationError({
      nodeId,
      action: undefined,
      reason: 'missing_action',
    });
  }

  const entry = actions[action];
  if (!entry) {
    throw new ExternalAgentValidationError({
      nodeId,
      action,
      reason: 'unknown_action',
    });
  }

  const parsed = entry.schema.safeParse(data.payload);
  if (!parsed.success) {
    throw new ExternalAgentValidationError({
      nodeId,
      action,
      reason: 'invalid_payload',
      issues: parsed.error.issues,
    });
  }

  return { action };
}

/**
 * Engine-side wire shape of a QUESTIONS field-action submission's `data`.
 *
 * The browser submits a button click against a rendered `UIElement` as
 * `data: { [fieldId]: { action, payload } }` — the action discriminator is
 * embedded inside an entry keyed by the field's id, not at the top level.
 * The MessageProcessor bridge flattens that single field-keyed entry to
 * top-level `action` / `payload` on `FlowUserMessage.data` before signaling
 * Temporal, so QUESTIONS nodes read a stable engine-local shape regardless
 * of how the submission envelope evolves on the wire. The open index
 * signature preserves passthrough of the original field-keyed entries (so
 * downstream code that needs the per-field values can still find them).
 */
export type QuestionsActionFlowData = {
  action?: string;
  payload?: unknown;
  [key: string]: unknown;
};

/**
 * Per-action Zod schemas validating the `payload` carried on QUESTIONS
 * field-action submissions. QUESTIONS nodes that surface SecondaryAction
 * buttons declare one entry per accepted action.
 *
 * Unlike `ExternalAgentActionSchemas` there is no `waitForUser` flag — a
 * QUESTIONS gate by definition parks on user input until the next
 * submission, so the question of "iterating vs terminal" is expressed
 * purely through the routing return value.
 */
export type QuestionsActionSchemas = Record<string, { schema: z.ZodTypeAny }>;

/**
 * Structured error returned when a QUESTIONS field-action submission fails
 * validation against the node's declared `actions` map. Mirrors
 * `ExternalAgentValidationError` so engine-side handling can be uniform.
 */
export class QuestionsActionValidationError extends Error {
  readonly action: string | undefined;
  readonly reason: 'unknown_action' | 'invalid_payload' | 'missing_action';
  readonly issues?: z.ZodIssue[];
  readonly nodeId: string;

  constructor(params: {
    nodeId: string;
    action: string | undefined;
    reason: 'unknown_action' | 'invalid_payload' | 'missing_action';
    issues?: z.ZodIssue[];
    message?: string;
  }) {
    super(
      params.message ??
        `[QUESTIONS] validation failed reason=${params.reason} node=${params.nodeId} action=${params.action ?? '(none)'}`,
    );
    this.name = 'QuestionsActionValidationError';
    this.action = params.action;
    this.reason = params.reason;
    this.issues = params.issues;
    this.nodeId = params.nodeId;
  }
}

/**
 * Validate an incoming QUESTIONS field-action submission against a node's
 * declared action schemas, and return the typed action + payload.
 *
 * Assumes `MessageProcessor.classifyAndBuildQuestionsActionSignalMessage`
 * has already lifted the field-keyed `{action, payload}` entry to top-level
 * `data.action` / `data.payload`. Throws on missing/unknown actions or
 * payloads that fail schema validation, leaving the node paused.
 */
export function validateQuestionsAction<
  TActions extends QuestionsActionSchemas,
>(params: {
  nodeId: string;
  actions: TActions;
  message: FlowUserMessage;
}): { action: keyof TActions & string; payload: unknown } {
  const { nodeId, actions, message } = params;
  const data = (message.data ?? {}) as Partial<QuestionsActionFlowData>;
  const action = typeof data.action === 'string' ? data.action : undefined;

  if (!action) {
    throw new QuestionsActionValidationError({
      nodeId,
      action: undefined,
      reason: 'missing_action',
    });
  }

  const entry = actions[action];
  if (!entry) {
    throw new QuestionsActionValidationError({
      nodeId,
      action,
      reason: 'unknown_action',
    });
  }

  const parsed = entry.schema.safeParse(data.payload);
  if (!parsed.success) {
    throw new QuestionsActionValidationError({
      nodeId,
      action,
      reason: 'invalid_payload',
      issues: parsed.error.issues,
    });
  }

  return { action: action as keyof TActions & string, payload: parsed.data };
}

/**
 * Abstract base class for ACTION nodes
 *
 * ACTION nodes:
 * - Perform processing/logic without user input
 * - Continue immediately (don't wait for user)
 * - Can return routing decisions along with UI response
 * - Flexible return type: NodeResult or ActionNodeResult
 */
export abstract class ActionNodeBase<TContext extends FlowContext = FlowContext>
  implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.ACTION;

  twoPhase = false;

  /**
   * Execute the action node logic
   * Must be implemented by subclasses
   */
  abstract execute(
    context: MutableContextHandle<TContext>,
  ): Promise<NodeResult>;
}

/**
 * Abstract base class for FINALIZE nodes
 *
 * FINALIZE nodes:
 * - Mark the completion of a flow
 * - Execute immediately (don't wait for user)
 * - Terminal nodes with no routing (end of flow)
 * - Typically present completion messages and summary data
 */
export abstract class FinalizeNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;
  abstract readonly title: string;

  readonly type = NodeType.FINALIZE;

  twoPhase = false;

  /**
   * Execute the finalize node logic
   * Must be implemented by subclasses
   */
  abstract execute(
    context: MutableContextHandle<TContext>,
  ): Promise<NodeResult>;
}

export type PromptConfig<TContext extends FlowContext = FlowContext> = {
  promptStrategy?: PromptBuilderStrategyType;
  systemPromptTemplate?:
    | string
    | ((context: TContext, userMessage?: FlowUserMessage) => string);
  responseSchema?: z.ZodSchema;
  temperature?: number;
  topP?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'json_object' | 'text' | null;
  useToolCallSchema?: boolean;
  toolName?: string;
  maxTokens?: number;
  modelCriteria?: ModelSelectionCriteria;
  exampleResponse?: string;
  nodeInstructions?: string;
  skipTransitionInstructions?: boolean;
  timeout?: number;
};

/**
 * Abstract base class for CLASSIFICATION nodes
 *
 * CLASSIFICATION nodes:
 * - Use promptConfig to classify user input via LLM
 * - Process immediately (don't wait for user input)
 * - ALWAYS have transitions for routing based on classification
 * - Can optionally have preClassify() for fast-path routing without LLM
 * - execute() returns default result, actual classification done by LLM system
 */
export abstract class ClassificationNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.CLASSIFICATION;

  twoPhase = true;

  /**
   * Configuration for LLM prompt generation
   * Nodes can define this to customize LLM behavior
   */
  readonly promptConfig?: PromptConfig;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.CLASSIFICATION,
      message: 'Analyzing your message...',
      data: {
        type: 'CLASSIFICATION',
        detectedIntent: 'unknown',
        intentConfidence: 0,
      },
    };
  }

  async determineRouting(
    _context: TContext,
    nodeResult: TypedNodeResult,
    transitions: TwoOrMoreTransitions,
  ): Promise<string | undefined> {
    // Extract intent from the standard SystemMessageData structure
    const intent = nodeResult.data as { intent?: string };

    if (!intent || typeof intent !== 'string') {
      return undefined;
    }

    // Use the transitions mapping to determine next node
    const transitionFunction = transitions[intent];
    if (transitionFunction) {
      return transitionFunction.nextNodeId;
    }

    // Fallback for unknown intents
    return undefined;
  }
}

/**
 * Abstract base class for LLM_QUESTIONS nodes
 *
 * LLM_QUESTIONS nodes:
 * - Use promptConfig to generate questions via LLM
 * - ALWAYS wait for user response
 * - Can have transitions for routing based on LLM response
 * - execute() should throw error as processing is done by LLM system
 */
export abstract class LlmQuestionsNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.LLM_QUESTIONS;

  twoPhase = true;

  /**
   * Configuration for LLM prompt generation
   * Nodes can define this to customize LLM behavior
   */
  readonly promptConfig?: PromptConfig;

  /**
   * Execute should not be called directly for LLM_QUESTIONS nodes
   * The LLM system processes these nodes using promptConfig
   */
  async execute(_context: MutableContextHandle<TContext>): Promise<NodeResult> {
    throw new Error(
      `${this.constructor.name}.execute() should not be called directly. ` +
        `This is an LLM_QUESTIONS node processed by the LLM system via promptConfig.`,
    );
  }
}

/**
 * Abstract base class for NonInteractive nodes
 *
 * NON_INTERACTIVE nodes:
 * - Use promptConfig to generate data via LLM
 * - execute() should throw error as processing is done by LLM system
 */
export abstract class NonInteractiveNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.NON_INTERACTIVE;

  twoPhase = false;

  /**
   * Configuration for LLM prompt generation
   * Nodes can define this to customize LLM behavior
   */
  readonly promptConfig?: PromptConfig;

  /**
   * Execute should not be called directly for NON_INTERACTIVE nodes
   * The LLM system processes these nodes using promptConfig
   */
  async execute(_context: MutableContextHandle<TContext>): Promise<NodeResult> {
    throw new Error(
      `${this.constructor.name}.execute() should not be called directly. ` +
        `This is an NON_INTERACTIVE node processed by the LLM system via promptConfig.`,
    );
  }
}

/**
 * Abstract base class for ANALYZE nodes
 *
 * ANALYZE nodes:
 * - Use promptConfig to perform analysis via LLM
 * - Process immediately (don't wait for user input)
 * - Can have transitions for routing
 * - execute() should throw error as processing is done by LLM system
 */
export abstract class AnalyzeNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.ANALYZE;

  twoPhase = false;

  /**
   * Configuration for LLM prompt generation
   * Nodes can define this to customize LLM behavior
   */
  readonly promptConfig?: PromptConfig;

  /**
   * Execute should not be called directly for ANALYZE nodes
   * The LLM system processes these nodes using promptConfig
   */
  async execute(_context: MutableContextHandle<TContext>): Promise<NodeResult> {
    throw new Error(
      `${this.constructor.name}.execute() should not be called directly. ` +
        `This is an ANALYZE node processed by the LLM system via promptConfig.`,
    );
  }
}

/**
 * Abstract base class for GENERATE nodes
 *
 * GENERATE nodes:
 * - Use promptConfig to generate content via LLM
 * - Process immediately (don't wait for user input)
 * - Can have transitions for routing
 * - execute() should throw error as processing is done by LLM system
 */
export abstract class GenerateNodeBase<
  TContext extends FlowContext = FlowContext,
> implements INode<TContext>
{
  abstract readonly id: string;

  readonly type = NodeType.GENERATE;

  twoPhase = true;

  /**
   * Configuration for LLM prompt generation
   * Nodes can define this to customize LLM behavior
   */
  readonly promptConfig?: PromptConfig<TContext>;

  /**
   * Execute should not be called directly for GENERATE nodes
   * The LLM system processes these nodes using promptConfig
   */
  async execute(_context: MutableContextHandle<TContext>): Promise<NodeResult> {
    throw new Error(
      `${this.constructor.name}.execute() should not be called directly. ` +
        `This is a GENERATE node processed by the LLM system via promptConfig.`,
    );
  }
}

/**
 * Abstract base class for AGENT nodes
 *
 * AGENT nodes:
 * - Execute generative AI agents for complex reasoning
 * - Support dynamic agent selection, prompts, and context
 * - Handle agent-specific response processing and routing
 * - Can have transitions for routing based on agent output
 */
export abstract class AgentNodeBase<
  TContext extends FlowContext = FlowContext,
  TAgentInput extends object | undefined = undefined,
> implements INode<TContext>
{
  abstract readonly id: string;
  abstract readonly title?:
    | string
    | ((context: MutableContextHandle<TContext>) => string);

  readonly type = NodeType.AGENT;

  twoPhase = true;

  /**
   * Agent ID or function to determine agent ID dynamically
   */
  abstract readonly agentId:
    | string
    | ((context: MutableContextHandle<TContext>) => Promise<string>);

  /**
   * User prompt for the agent (static or dynamic)
   */
  abstract readonly userPrompt?:
    | string
    | ((
        context: MutableContextHandle<TContext>,
        userMessage?: FlowUserMessage,
      ) => string | Promise<string>);

  /**
   * Response schema for agent output validation
   */
  abstract readonly responseSchema?: z.ZodSchema;

  /**
   * Optional structured agent input builder. When defined, the agent processor
   * will prefer the structured payload over a prompt-derived message.
   */
  readonly agentInput?: (
    context: MutableContextHandle<TContext>,
    latestUserMessage?: FlowUserMessage,
  ) => Promise<TAgentInput>;

  /**
   * Build context data for the agent execution
   */
  abstract buildContext?(
    context: MutableContextHandle<TContext>,
  ): Promise<Record<string, unknown>>;

  /**
   * Optional post-processing of agent response (AGENT nodes only)
   *
   * Allows AGENT nodes to process the agent execution result, determine next routing,
   * and optionally provide custom SystemMessageData for UI display.
   *
   * @param agentResponse - The agent execution response (wrapped in MastraAgentResponse)
   * @param context - The current flow context
   * @returns Object containing nextNodeId and optional custom SystemMessageData
   */
  abstract processAgentResponse(
    agentResponse: MastraAgentResponse<AgentResponseShape>,
    context: MutableContextHandle<TContext>,
  ): Promise<ProcessAgentResponseResult>;

  protected async loadRecentConversationMessages<
    TArtifact extends {
      id: string;
      data?: { type?: string; userMessageId?: string };
    },
  >({
    context,
    latestUserMessageId,
    fetchArtifacts,
    formatArtifact,
    logger,
  }: {
    context: FlowContext;
    latestUserMessageId?: string;
    fetchArtifacts: (args: {
      projectId: ProjectId;
      conversationId: ConversationId;
      organizationId: OrganizationId;
      limit: number;
    }) => Promise<TArtifact[]>;
    formatArtifact: (artifact: TArtifact) => string;
    logger?: {
      warn: (message: string, meta?: Record<string, unknown>) => void;
    };
  }): Promise<
    Array<{ id: string; content: string; role?: string }> | undefined
  > {
    try {
      const artifacts = await fetchArtifacts({
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        organizationId: context.core.organizationId,
        limit: 3,
      });

      const conversationEntries: Array<{
        id: string;
        content: string;
        role?: string;
      }> = [];

      for (const artifact of artifacts ?? []) {
        if (artifact.data?.type !== 'QA_PAIR') {
          continue;
        }
        if (artifact.data.userMessageId === latestUserMessageId) {
          continue;
        }

        conversationEntries.push({
          id: artifact.id,
          content: formatArtifact(artifact),
        });
      }

      return conversationEntries.length
        ? conversationEntries.slice(0, 3)
        : undefined;
    } catch (error) {
      logger?.warn?.('Failed to fetch recent conversation messages', {
        conversationId: context.core.conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  /**
   * Execute should not be called directly for AGENT nodes
   * AGENT nodes are processed through the agent pipeline
   */
  async execute(_context: MutableContextHandle<TContext>): Promise<NodeResult> {
    throw new Error(
      `${this.constructor.name}.execute() should not be called directly. ` +
        `This is an AGENT node processed through the agent execution pipeline.`,
    );
  }
}

// ============================================================================
// End Injectable Node System
// ============================================================================

// Type for node-scoped gathered data
// The outer keys are node IDs, inner keys are field names from that node
export type NodeScopedGatheredData<
  TNodeData extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
> = TNodeData;

type BaseFlowContext = {
  core: {
    workflowId: WorkflowId;
    projectId: ProjectId;
    organizationId: OrganizationId;
    conversationId: ConversationId;
    workflowAboutId: string;
    workflowAboutType: WorkflowAboutType;
    planId?: PlanId;
    user: {
      id: UserId;
      role: string;
    };
    session: {
      startTime: Date;
      interactionCount: number;
    };
  };
  /** Test-only provider routing identity, accepted only by onboarding ingress. */
  mockLlmSessionId?: MockLlmSessionId;
  /**
   * Additional ID values that may be relevant to this workflow.
   * Never add non-ID values here!
   */
  flowId: string;
  lastIntent?: Intent;
  lastClassification?: FlowClassificationSnapshot;
  lastSystemMessageId?: MessageId; // Track the last system message for parentMessageId linking
  flowPath: {
    pathTaken: string[]; // Array of node IDs visited in order
    previousNode?: string; // ID of the previous node
    previousTransition?: string; // Which transition was taken to get here
  };
  // Explicit phase tracking for two-phase node execution
  currentNodeExecution?: {
    nodeId: string; // Which node we're currently executing
    questionsGenerated: boolean; // Have we sent questions for this node visit?
  };
  // Agent execution tracking
  lastAgentExecution?: {
    agentId: string;
    executionId: string;
    timestamp: string;
    changes: Array<{
      type: string;
      field: string;
      oldValue?: unknown;
      newValue: unknown;
      reasoning: string;
    }>;
    summary?: string;
    confidence?: number;
    reasoning?: string;
    status?: 'completed' | 'failed' | 'timeout';
    iterations?: number;
    nodeId?: string;
  };

  // Enhanced agent context propagation
  agentExecutionHistory?: Record<
    string,
    {
      executionId: string;
      timestamp: string;
      result: unknown;
      status: 'completed' | 'failed' | 'timeout';
      iterations: number;
    }
  >;

  // Agent analysis results by type
  analysisResults?: {
    feedbackAnalysis?: unknown;
    lastAnalysisTimestamp?: string;
  };

  changeAnalysis?: {
    riskAssessment?: unknown;
    lastChangeAnalysisTimestamp?: string;
  };

  presentationResults?: {
    findings?: unknown;
    lastPresentationTimestamp?: string;
  };

  // User context for agents
  userInputs?: Record<string, unknown>;

  userPreferences?: Record<string, unknown>;
  metadata?: Record<string, unknown>;

  // Initiative tracking
  currentInitiativeId?: string;
  projectData?: Record<string, unknown>;
  // Pending transition after opener execution
  pendingTransition?: {
    nextNodeId: string;
    reason: string;
  };
  // Do not add 'custom', 'metadata' or other fields. See claude.md
};

export type FlowContext = Readonly<BaseFlowContext>;

export type LLMPrompt = {
  systemPrompt: string;
  userPrompt: string;
  fullPrompt: string;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  responseFormat?: 'json_object' | 'text';
};

// Pre-processing result type
export type ProcessLlmResult = {
  modifiedResult?: SystemMessageData;
  routingOverride?: string;
};

// Post-processing result type
export type RoutingResult = {
  routingOverride?: {
    nextNodeId: string;
    reason: string;
  };
};

// ============================================================================
// Initiative signal payloads (legacy exports preserved for compatibility)
// ============================================================================

export interface InitiativeRefinementFeedbackPayload {
  initiativeId: InitiativeId;
  message: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId: ConversationId;
  timestamp: Date;
  metadata: {
    source: string;
    requestType: string;
    classifiedIntent?: string;
    currentLevel?: string;
    classificationConfidence?: number;
  };
}

export interface InitiativeContentUpdatePayload {
  initiativeId: InitiativeId;
  contentUpdate: {
    content: string;
    level: 'description' | 'details' | 'acceptanceCriteria';
    previousContent: string;
  };
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId: ConversationId;
  timestamp: Date;
  metadata: {
    source: string;
    requestType: string;
  };
}

export interface InitiativeReviewPayload {
  initiativeId: InitiativeId;
  approved: boolean;
  level: 'description' | 'details' | 'acceptanceCriteria';
  organizationId: OrganizationId;
  conversationId: ConversationId;
  timestamp: Date;
  metadata: {
    source: string;
    requestType: string;
  };
}

/**
 * Extended system message data that may include drafts before processing.
 * All SystemMessageData types already have detectedIntent, intentConfidence, and reasoning fields
 * for routing decisions.
 */
export type IntermediateSystemMessageData =
  | SystemMessageData
  | { initiatives: InitiativeDraft[]; nodeId: string }
  | {
      narrative: FeatureGenerationResponse['narrative'];
      topLevels: FeatureGenerationResponse['topLevels'];
      nodeId: string;
    };

/**
 * Transition definition with self-documenting description
 * Used for LLM-based routing decisions
 */
export type TransitionDefinition = {
  /** LLM-readable description of when to use this transition */
  description: string;
  /** Target node ID for this transition */
  nextNodeId: string;
  /** Optional human-readable condition for documentation */
  condition?: string;
  /**
   * EXTERNAL_AGENT only. When true, an agent-authored completion that resolves
   * to this transition parks the flow on the *current* node in
   * WAITING_FOR_USER instead of routing to `nextNodeId` and re-running its
   * generation. Use this for a self-loop whose generation already produced the
   * user-facing artifact during the turn that emitted the completion: routing
   * back would re-emit a duplicate (e.g. an iterate REVISED self-loop
   * re-emitting its review artifact). The next genuine user message resumes normal
   * routing. Has no effect on non-EXTERNAL_AGENT routing or on free-text user
   * messages (which never carry a completion action).
   */
  parkOnUserResponse?: boolean;
};

/**
 * Transitions map with at least 2 options
 * Each transition has a key (intent name) and definition (description + nextNodeId)
 */
export type TwoOrMoreTransitions = Record<string, TransitionDefinition> & {
  // Require at least one transition with explicit 'default' key
  default: TransitionDefinition;
};

// Skip validation result type
export type SkipValidationResult = {
  canSkip: boolean;
  reason?: string;
};

// Services available for skip validation
export interface SkipValidationServices {
  initiativeService: InitiativeService; // Will be typed when used
  taskService: TaskService;
  // Add more services as needed
}

// Skip-to-node configuration
export type SkipToNodeConfig = {
  allowed: boolean;
  validPreviousNodes: '*' | string[];
  validateState?: (
    context: FlowContext,
    services: SkipValidationServices,
  ) => Promise<SkipValidationResult> | SkipValidationResult;
};

// Node routing configuration union type
export type NodeRoutingConfig =
  | { nextNode: string; transitions?: never; skipToNode?: SkipToNodeConfig }
  | {
      nextNode?: never;
      transitions: TwoOrMoreTransitions;
      skipToNode?: SkipToNodeConfig;
    }
  | { nextNode?: never; transitions?: never; skipToNode?: never }; // For END nodes with no routing

// ============================================================================
// Type Guards for Injectable Nodes
// ============================================================================

export function isOpenerNode(node: INode): node is OpenerNodeBase {
  return node.type === NodeType.OPENER;
}

export function isQuestionsNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is QuestionsNodeBase<T> {
  return node.type === NodeType.QUESTIONS;
}

export function isLLMQuestionsNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is LlmQuestionsNodeBase<T> {
  return node.type === NodeType.LLM_QUESTIONS;
}

export function isClassificationNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is ClassificationNodeBase<T> {
  return node.type === NodeType.CLASSIFICATION;
}

export function isActionNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is ActionNodeBase<T> {
  return node.type === NodeType.ACTION;
}

/**
 * Type guard to check if a node has LLM prompt configuration
 * Returns true for nodes that extend base classes with promptConfig
 */
export function hasPromptConfig<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is INode<T> & {
  readonly promptConfig: PromptConfig;
} {
  return (
    'promptConfig' in node &&
    node.promptConfig !== null &&
    node.promptConfig !== undefined
  );
}

export function hasBeforeGeneration<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is INode<T> & {
  beforeGeneration: (
    context: MutableContextHandle<T>,
    previousUserMessage?: FlowUserMessage,
  ) => Promise<void>;
} {
  return (
    'beforeGeneration' in node && typeof node.beforeGeneration === 'function'
  );
}

export function hasPrecomputedResponse<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is INode<T> & {
  getPrecomputedResponse: (
    context: MutableContextHandle<T>,
    previousUserMessage?: FlowUserMessage,
  ) => Promise<IntermediateSystemMessageData | undefined>;
} {
  return (
    'getPrecomputedResponse' in node &&
    typeof node.getPrecomputedResponse === 'function'
  );
}

export function hasProcessLlmResponse<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is INode<T> & {
  processLlmResponse: (
    systemMessageData: IntermediateSystemMessageData,
    userMessage: FlowUserMessage | undefined,
    context: MutableContextHandle<T>,
  ) => Promise<{
    modifiedResult?: SystemMessageData;
    routingOverride?: string;
  }>;
} {
  return (
    'processLlmResponse' in node &&
    typeof node.processLlmResponse === 'function'
  );
}

export type ShouldRunResult = {
  run: boolean;
  reason?: string;
  gate?: string;
};

export function hasShouldRun<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is INode<T> & {
  shouldRun: (context: MutableContextHandle<T>) => Promise<ShouldRunResult>;
} {
  return 'shouldRun' in node && typeof node.shouldRun === 'function';
}

export function isAnalyzeNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is AnalyzeNodeBase<T> {
  return node.type === NodeType.ANALYZE;
}

export function isAgentNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is AgentNodeBase<T> {
  return node.type === NodeType.AGENT;
}

export function isExternalAgentNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is ExternalAgentNodeBase<T> {
  return node.type === NodeType.EXTERNAL_AGENT;
}

export function isGenerateNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is GenerateNodeBase<T> {
  return node.type === NodeType.GENERATE;
}

/**
 * Flow node configuration returned by getNode()
 * Contains node ID and routing configuration only
 */
export type FlowNodeConfig = {
  id: string;
  routing: NodeRoutingConfig;
};

/**
 * New simplified flow template structure
 * Nodes are pure routing configuration - behavior comes from Injectable classes
 */
export type FlowTemplate<TContext extends FlowContext = FlowContext> = {
  id: string;
  name: string;
  description: string;
  version: number;
  nodes: Record<string, NodeRoutingConfig>;
  startNode: string;
  /**
   * LocalPromptType the conversation-level prompt-type lookup endpoint
   * returns when this flow has completed (workflow gone / terminated /
   * status.isComplete) and when the conversation parks on a non-
   * EXTERNAL_AGENT node. For flows that terminate on an EXTERNAL_AGENT
   * node this matches that node's `promptType`; for non-agent flows this
   * defaults to `startup_session` (the CLI's neutral entry type). Required
   * so every flow declares an explicit terminal dispatch — no inference.
   */
  terminalPromptType: LocalPromptType;
  /**
   * Workflow-level default for whether free-text USER messages landing on
   * this workflow should signal advancement. Individual nodes may override
   * via `ExternalAgentNodeBase.acceptsUserMessages`. Resolution order in
   * `MessageProcessor.handleUserMessageCreated` is
   * `node ?? workflow ?? true`.
   */
  acceptsUserMessages?: boolean;
  contextTransforms?: Record<string, ContextTransform<TContext>>;
  initialContextTransform?: (
    baseContext: FlowContext,
    workflowAboutId: string | undefined,
    workflowAboutType: string | undefined,
    appContext: INestApplicationContext,
  ) => Promise<TContext>;
  onComplete?: (
    context: TContext,
    appContext: INestApplicationContext,
  ) => Promise<void>;
};

export type ContextTransform<T extends FlowContext = FlowContext> = (
  prev: T,
) => T | Promise<T>;

// Strongly typed context for buildContext return values
// This enforces that buildContext can only return IDs and essential metadata
export interface NodeBuildContext {
  // Required IDs that should always be present
  readonly initiativeId?: string;
  readonly taskId?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly conversationId?: string;
  readonly workflowId?: string;

  // Level information (string enum)
  readonly currentLevel?:
    | 'description'
    | 'details'
    | 'acceptanceCriteria'
    | 'unknown';

  // Numeric metadata
  readonly levelProgress?: number;
  readonly interactionCount?: number;

  // No other properties allowed - this prevents accidental data leaks
}

export type OnboardingPlanCandidate = {
  id: string;
  title: string;
  description: string;
  outcome: string;
  evidenceWeight: number;
  rationale: string;
};

export type OnboardingPlanProposalState = {
  round: number;
  response: string;
  candidates: OnboardingPlanCandidate[];
  acceptedCandidateIds?: string[];
  feedbackError?: string;
};

// Specific context types for different flows

export type OnboardingFeaturePriority = 'low' | 'medium' | 'high' | 'critical';

export interface OnboardingFeatureInfluence {
  entityId: string;
  entityType: string;
  reasoning: string;
  reasonType: string;
  confidence?: number | null;
}

export interface OnboardingPendingChildFeature {
  candidateId?: string;
  localId: string;
  proposalId: string;
  proposalGroupMemberId: string;
  reservedFeatureId: string;
  name: string;
  description: string;
  tag: FeatureTag;
  priority: OnboardingFeaturePriority;
  reasoning: string;
  influences: OnboardingFeatureInfluence[];
}

export interface OnboardingPendingTopLevelFeature {
  candidateId?: string;
  rootKey: string;
  proposalId: string;
  proposalGroupMemberId: string;
  reservedFeatureId: string;
  name: string;
  description: string;
  tag: FeatureTag;
  priority: OnboardingFeaturePriority;
  reasoning: string;
  influences: OnboardingFeatureInfluence[];
  children: OnboardingPendingChildFeature[];
}

export interface OnboardingFeatureRefinement {
  sections: Record<string, string>;
  overall: string;
}

export interface OnboardingPlacementAssignment {
  rootKey: string;
  target: RepositoryPlacementCompletionTarget;
  rationale?: string;
  confidence?: number;
}

export interface OnboardingFeatureProposalState {
  repositoryReviewPhase?: 'outline' | 'enriched';
  proposalGroupId: string;
  proposalGroupRevision: number;
  narrative: string;
  topLevels: OnboardingPendingTopLevelFeature[];
  placementStrategy?: RepositoryPlacementStrategySubmission;
  pendingHolder?: RepositoryPlacementPendingHolder & {
    proposalId: string;
    proposalGroupMemberId: string;
    reservedFeatureId: string;
  };
  placementAssignments?: OnboardingPlacementAssignment[];
  structuredRefinement?: OnboardingFeatureRefinement;
}

export type OnboardingFlowContext = FlowContext & {
  onboardingPlanProposal?: OnboardingPlanProposalState;
  onboardingFeatureProposal?: OnboardingFeatureProposalState;
  /** Internal ingress marker used only by the onboarding existing-work gate. */
  repositoryGroundingIntentRequired?: boolean;
};

export type RepositoryImportFlowContext = OnboardingFlowContext & {
  /** Accepted repository-grounding choices once both review gates pass. */
  repositoryGrounding?: RepositoryGroundingWorkflowContext;
  /** Partial repository-grounding seed supplied by the Services Import entry. */
  repositoryGroundingSeed?: RepositoryGroundingConversationSeed;
  /** Validated prerequisite draft while configuration is still pending. */
  repositoryGroundingPrerequisites?: RepositoryGroundingPrerequisites;
  /** Validated configuration draft before the explicit start answer. */
  repositoryGroundingAnalysisConfiguration?: RepositoryGroundingAnalysisConfiguration;
  /** Typed result from the paired CLI; failures never materialize features. */
  repositoryGroundingCompletion?: RepositoryGroundingCompletion;
  /** Latest accepted enrichment analysis snapshot used for the next round. */
  repositoryFeatureEnrichmentAcceptedAnalysis?: RepositoryGroundingSuccess;
  /** @deprecated Read-only compatibility for contexts serialized before snapshot evolution. */
  repositoryGroundingBaseline?: RepositoryGroundingSuccess;
  repositoryFeatureEnrichmentChoice?: import('../generated').RepositoryFeatureEnrichmentChoice;
  repositoryFeatureEnrichmentReviewedCandidates?: RepositoryGroundingSuccess['hierarchy'];
  repositoryFeatureEnrichmentCompletedRounds?: number;
  repositoryFeatureEnrichmentAnswerBatches?: RepositoryFeatureEnrichmentAnswerBatch[];
  repositoryFeatureEnrichmentLatestOutcome?: RepositoryFeatureEnrichmentCompletion;
  repositoryFeatureEnrichmentFinal?: RepositoryFeatureEnrichmentSuccess;
  /** Typed result from existing-project intelligent root placement. */
  repositoryPlacementCompletion?:
    | RepositoryPlacementSuccess
    | RepositoryPlacementRetryableFailure
    | RepositoryPlacementTerminalFailure;
  /** True when the user has explicitly deferred an in-flight analysis. */
  repositoryGroundingPaused?: boolean;
  /**
   * Feature ids created by final approval. Absent on imports materialized
   * before the first-work stage existed, which keeps them on their old path.
   */
  repositoryImportMaterializedFeatureIds?: string[];
  repositoryFirstWorkRequest?: string;
  repositoryFirstWorkFollowUpRoundCount?: number;
  repositoryFirstWorkFollowUpAnswers?: import('../generated').RepositoryFeatureEnrichmentAnswer[];
  repositoryFirstWorkLatestOutcome?: import('../generated').RepositoryFirstWorkCompletion;
  repositoryFirstWorkFinal?: import('../generated').RepositoryFirstWorkSuccess;
};

export type WorkTrackerImportFlowContext = RepositoryImportFlowContext & {
  /** Entry choices carried from conversation creation. */
  workTrackerImportEntry?: import('../generated').CreateWorkTrackerImportConversationContext;
  /** Accepted source and runtime choices; never carries credentials. */
  workTrackerImportConfiguration?: import('../generated').WorkTrackerImportConfiguration;
  /** Set only from an explicit user action, never from agent output. */
  workTrackerConnectionConfirmed?: boolean;
  workTrackerConnectionOutcome?: import('../generated').WorkTrackerConnectionCompletion['outcome'];
  workTrackerImportAccepted?: import('../generated').WorkTrackerImportSuccess;
};

// Add initiatives flow types
export type AddInitiativesFlowContext = FlowContext & {
  // The user's initiative request details
  initiativeRequest?: string;
  requestType?: string;
  urgency?: string;
};

export type InitiativeRefinementFlowContext = FlowContext & {
  // The initiative being refined
  initiativeId: InitiativeId;
};

export type TaskRefinementFlowContext = FlowContext & {
  // The task being refined
  taskId: TaskId;
  // Parent initiative ID for context awareness — null for standard tasks
  initiativeId: InitiativeId | null;
};

export type TaskGenerationFlowContext = FlowContext & {
  // Parent initiative ID for context awareness — null for standard tasks
  initiativeId: InitiativeId | null;
  parentTaskId?: TaskId;
  designDocId?: DesignDocId;
  stubSession?: TaskStubSessionState;
};

export type TaskDependencyInferenceFlowContext = FlowContext & {
  initiativeId: InitiativeId | null;
  targetTaskIds: TaskId[];
};

export type SuggestedTaskFlowContext = FlowContext & {
  initiativeId: InitiativeId;
  parentTaskId?: TaskId;
  sourceConversationId: ConversationId;
  sourceMessageId: MessageId;
  taskName: string;
  taskDescription?: string;
};

export type SuggestedDesignDocFlowContext = FlowContext & {
  designDocName: string;
  designDocDescription?: string;
  template: DesignDocTemplate;
  initiativeId?: InitiativeId;
  taskId?: TaskId;
  sourceConversationId: ConversationId;
  sourceMessageId: MessageId;
};

export type SuggestedActionsFlowContext = FlowContext & {
  initiativeId?: InitiativeId;
  parentTaskId?: TaskId;
  designDocId?: DesignDocId;
};

export type AdrRefinementFlowContext = FlowContext & {
  // The design document (ADR) being refined
  designDocId: DesignDocId;
  // Optional related initiatives (cross-cutting decisions)
  initiativeIds?: InitiativeId[];
  // Optional related tasks
  taskIds?: TaskId[];
};

export type BrainstormRefinementFlowContext = FlowContext & {
  // The design document (Brainstorm) being refined
  designDocId: DesignDocId;
  // Optional related initiatives
  initiativeIds?: InitiativeId[];
  // Optional related tasks
  taskIds?: TaskId[];
  /** Workflow run identifier for suspended brainstorm refinements */
  clarifyingRunId?: string;
  /** Clarifying questions asked when the brainstorm workflow is suspended */
  clarifyingQuestions?: string[];
};

export type DecisionRefinementFlowContext = FlowContext & {
  // The design document (Decision) being refined
  designDocId: DesignDocId;
  // Optional related initiatives
  initiativeIds?: InitiativeId[];
  // Optional related tasks
  taskIds?: TaskId[];
};

export type CodingPromptResearchFlowContext = FlowContext & {
  taskId?: TaskId;
  initiativeId?: InitiativeId;
  designDocId?: DesignDocId;
  planId?: PlanId;
  research?: {
    status: 'STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    startedAt?: string;
    completedAt?: string;
    request?: Record<string, unknown>;
    result?: Record<string, unknown>;
    rawResult?: Record<string, unknown>;
    error?: {
      code: string;
      message: string;
    };
  };
};

export type EntityConversationFlowContext = SuggestedActionsFlowContext;
export type ProjectConversationFlowContext = SuggestedActionsFlowContext;

export type ActivityDeltaStatusChange = {
  entityId: string;
  entityType: EntityType;
  title?: string;
  previousStatus: string;
  currentStatus: string;
  changedAt: string;
};

export type ActivityDeltaItemCompletion = {
  entityId: string;
  entityType: EntityType;
  title?: string;
  completedAt: string;
};

export type ActivityDeltaNewSignal = {
  entityId: string;
  entityType: EntityType;
  title?: string;
  signalType: string;
  summary?: string;
  receivedAt: string;
};

export type ActivityDelta = {
  statusChanges: ActivityDeltaStatusChange[];
  itemCompletions: ActivityDeltaItemCompletion[];
  newSignals: ActivityDeltaNewSignal[];
  computedAt: string;
};

export type DailySessionSessionContext = {
  lastSystemMessage?: string;
  lastUserActivities?: RecentActivityCorrelationRecordDto[];
  lastActivityDelta?: ActivityDelta;
};

export type DailySessionFlowContext = FlowContext & {
  sessionContext?: DailySessionSessionContext;
  activityDelta?: ActivityDelta;
};

export type FeatureSyncDiscrepancy = {
  id?: string;
  summary: string;
  rationale: string;
  entityType?: 'FEATURE' | 'TASK' | 'DESIGN_DOC' | 'SERVICE' | 'OTHER';
  entityId?: string;
  proposal?: string;
};

/**
 * The analyze/iterate discrepancy state both feature-sync flows park on
 * the flow context. Composed onto the task-anchored
 * {@link FeatureSyncFlowContext} and the plan-anchored
 * {@link PlanFromDesignDocFlowContext} so the two flows share one field
 * contract. Uses the context-side {@link FeatureSyncDiscrepancy} twin
 * (not the Zod-inferred type from the shared schema module) to keep this
 * file free of an import back into the node/schema graph — the two shapes
 * are structurally identical, so Zod-parsed values assign cleanly.
 *
 * - `featureSyncDiscrepancies` — the outstanding drift the last analyze
 *   (or iterate) turn surfaced; the iterate node reads it to build its
 *   trigger. Cleared once the agent reports the set resolved.
 * - `featureSyncResolved` — true once analyze/iterate report no
 *   outstanding drift, so the graph can advance past the sync stage.
 * - `featureSyncSourceMessageId` — the `id` of the agent completion
 *   message that last wrote `featureSyncDiscrepancies` (the DISCREPANCY
 *   completion from analyze, or the REVISED completion from iterate).
 *   Used by the review gate's dismiss branch to scope proposal rejection
 *   to exactly the proposals authored by that message, rather than all
 *   DRAFT proposals in the conversation.
 */
export type WithFeatureSyncContext = {
  featureSyncDiscrepancies?: FeatureSyncDiscrepancy[];
  featureSyncResolved?: boolean;
  featureSyncSourceMessageId?: string;
  implementationReadiness?: ImplementationReadinessDisposition;
  implementationReadinessSourceMessageId?: string;
};

export type FeatureSyncFlowContext = FlowContext &
  WithFeatureSyncContext & {
    implementRuntime?: import('src/generated').ImplementRuntimeSelection;
    implementApprovalOperationId?: string;
    taskId?: TaskId;
    initiativeId?: InitiativeId;
    /**
     * Free-text prompt the user typed on the agent setup page before the
     * coding session UI was rendered. Captured by the opener gate node and
     * folded into the `analyze` trigger so the CLI agent sees it as extra
     * context when walking the feature tree.
     */
    featureSyncInitialPrompt?: string;
    /**
     * Free-text clarification submitted from the implementation-readiness
     * review field's shared composer. The review node stores it while the
     * flow is parked; the next analyze trigger consumes and clears it so the
     * CLI agent receives the clarification as turn input.
     */
    featureSyncPendingUserReply?: string;
  };

/**
 * Tightened `metadata` shape for the plan-from-design-doc workflow.
 * Stays a `Record<string, unknown>` so generic metadata reads/writes
 * keep type-checking, but surfaces the typed `planExecutionGuidance`
 * handle the execution-guidance trigger node stashes and the wait node
 * reads — mirroring `PlanGenerationMetadata`.
 */
type PlanShapingMetadata = Record<string, unknown>;

/**
 * FlowContext for the plan-from-design-doc workflow — the post-design-doc
 * plan-shaping subgraph that runs after the design-doc and plan are
 * materialized at conversation creation time.
 *
 * The graph is composed of EXTERNAL_AGENT nodes (PROPOSED_STAGES,
 * VISUAL_PREVIEW, PHASE_BREAKDOWN, STEP_REVIEW) plus user-driven
 * QUESTIONS gates (PROPOSED_STAGES_FEEDBACK, VISUAL_PREVIEW_FEEDBACK,
 * FINALIZE). Each node reads and writes platform
 * proposals directly (plan stages, plan steps); the source of truth for
 * everything the agent produces lives in platform storage, not on this
 * context.
 *
 * The entity facts the plan-shaping nodes need at runtime (the plan id,
 * the linked design-doc id, the parent feature id) are resolved per-node
 * via {@link PlanFromDesignDocSeedService}, which reads them from the
 * conversation (`workflowAboutId` = planId), the plan (`parentTaskId`),
 * and the plan's LINKED PlanRelationship (design-doc id). They are not
 * mirrored onto this context — that mirror used to be seeded at
 * conversation-create time and forwarded as Temporal `additionalContext`,
 * which silently broke when the start path was decoupled (NOT_STARTED →
 * POST /start). Reading from the persisted entities at execution time has
 * the same correctness whether start happens 5 ms or 5 hours after create.
 */
export type PlanFromDesignDocFlowContext = Omit<FlowContext, 'metadata'> &
  WithFeatureSyncContext & {
    /**
     * Workflow metadata. Tightened to {@link PlanShapingMetadata} so the
     * execution-guidance trigger node can stash a typed
     * `planExecutionGuidance` handle for the wait node to read.
     */
    metadata?: PlanShapingMetadata;
    /**
     * Free-form feedback the user typed into the proposed-stages-feedback
     * gate when they clicked Continue Revising. The next entry into
     * `proposed-stages` consumes this value as the trigger payload's
     * `userMessage` so the agent revises with the user's notes in hand,
     * then clears it. Mirrors the consume-and-clear pattern
     * `scope-constraints` uses for `responseMessage`.
     */
    proposedStagesFeedback?: string;
    /** Accepted completion total; cleared before each new stage generation. */
    proposedStagesReview?: PlanGenerationStageReviewPayload;
    /** Ordered persistent visual proposals carried between preview rounds. */
    visualPreviewEntries?: PlanGenerationVisualPreviewEntry[];
    /** Current visual-preview refinement round. */
    visualPreviewRound?: number;
    /** Feedback consumed by the next visual-preview trigger. */
    visualPreviewFeedback?: string;
    /** Shown on the re-rendered visual gate after Approve Visual Set could not approve every remaining draft. */
    visualPreviewApprovalFailure?: string;
    /** Complete accepted visual identity set handed to phase breakdown. */
    visualPreviewAcceptedProposalIds?: string[];
    /**
     * The approved visual set's Mockup/Diagram work items, resolved when the
     * user approves the set. Carried on every later plan-shaping trigger.
     */
    visualPreviewApprovedVisuals?: PlanShapingApprovedVisual[];
    /**
     * Per-stage handoff steps seeded by the `visual-preview` node and
     * consumed by each subsequent `phase-breakdown` entry (one entry per
     * step). Not a persisted platform entity; it only lives on FlowContext.
     */
    journeySteps?: JourneyStep[];
    /**
     * Per-phase plan payloads accumulated across the phase-breakdown
     * self-loop. Keyed by the 2-D `(stageIdx, phaseIdx)` cursor:
     * `accumulatedPhases[stageIdx][phaseIdx]` holds the steps-only
     * `{ steps }` plan the agent authored for that phase via the
     * `submit_phase_breakdown` payload. `stageIdx` indexes the plan's
     * durable stages (in the order they first appear across
     * `journeySteps`); `phaseIdx` indexes the journey step within that
     * stage's journey.
     *
     * Phase identity is owned by this map: there is no separate counter
     * field. The phase-breakdown node groups `journeySteps` by
     * `stageId` into one ordered journey per stage, then derives the
     * next expected `(stageIdx, phaseIdx)` cursor as the first slot in
     * that flattened sequence not yet present here — both when stamping
     * the trigger payload (in `execute`) and when deciding whether to
     * loop or materialize (in `determineRoutingFromAgentCompletion`).
     * The agent's emitted cursor must equal the expected value (or the
     * most recent slot, for the idempotent-overwrite retry case);
     * divergence synthesizes an ERROR-class completion and leaves this
     * map unchanged.
     *
     * Write surface: the phase-breakdown node's `processUserResponse`
     * stamps `accumulatedPhases[stageIdx][phaseIdx] = payload.plan` on
     * every validated `DONE` completion (the field is additive — earlier
     * phases remain in place while later phases are appended). The
     * step-review node's `processUserResponse` also writes here on a
     * validated `STEP_REVIEW_DONE` completion: it overwrites the whole
     * stage bucket with a single synthetic phase
     * `{ 0: { steps: tightened } }`, because
     * `PhaseBreakdownMaterializationService` walks
     * `[stageIdx][phaseIdx]` and groups by each step's `stageId`, so the
     * single-phase write-back produces identical-shape output without
     * any service-side change.
     *
     * Read surface: the batched-materialization step is invoked by the
     * step-review node's `determineRoutingFromAgentCompletion` on its
     * loop-exit branch — immediately before the
     * `STEP_REVIEW_DONE → EXECUTION_GUIDANCE_TRIGGER` transition fires —
     * walking every accumulated phase's steps, grouped by the durable
     * `stageId` each step names, and creating them as auto-approved
     * PLAN_STEP proposals (only PLAN_STEP proposals, since the stage
     * backbone already exists) against the conversation's resolved
     * `planId` ({@link PlanFromDesignDocSeedService}) within a single
     * transaction. Phase-breakdown's loop-exit no longer materializes —
     * it returns `undefined` so the engine takes the static
     * `DONE → STEP_REVIEW` transition, handing the accumulated steps
     * off to the per-stage tightening pass first. No other node reads
     * or writes this field — it is owned by the phase-breakdown /
     * step-review pair, mirroring how `journeySteps` is owned by the
     * journey-map / phase-breakdown pair.
     */
    accumulatedPhases?: Record<number, Record<number, PhaseBreakdownPlan>>;
    /**
     * Per-stage review marks accumulated across the step-review
     * self-loop. Keys are stage indices (the first half of the
     * phase-breakdown cursor) whose drafted steps have already been
     * tightened by `step-review`; the value is `true` only as a
     * presence marker.
     *
     * The step-review cursor is owned by this map: the next expected
     * `stageIdx` is the first integer in `0..totalStages` not present
     * here. A stage that fell through on a genuine ERROR is marked
     * reviewed here without its `accumulatedPhases` bucket changing —
     * the un-tightened drafted steps then materialize as-is so a stuck
     * stage can never strand the plan.
     *
     * Write surface: the `step-review` node's `processUserResponse`
     * marks `reviewedStages[stageIdx] = true` on every validated
     * `STEP_REVIEW_DONE` completion (alongside overwriting
     * `accumulatedPhases[stageIdx]` with the tightened single
     * synthetic phase), and on the genuine-ERROR fall-through path
     * (without touching `accumulatedPhases`).
     *
     * Read surface: the `step-review` node's
     * `determineRoutingFromAgentCompletion` derives the next
     * expected `stageIdx` to decide whether to loop or materialize;
     * no other node reads or writes this field.
     */
    reviewedStages?: Record<number, true>;
    /**
     * Free-text reply the user typed into the textarea the CLI attaches to a
     * plan-shaping feature-sync EXTERNAL_AGENT trigger (analyze or iterate)
     * when the agent paused mid-conversation for clarification. Node-local
     * state bridging two engine ticks on the same node: `processUserResponse`
     * stashes the reply when it sees an actionless USER message, then the
     * next entry's `buildTriggerMessage` consumes the value as the trigger
     * payload's `userMessage` and clears it so the agent reads the reply
     * before calling its submission tool. NOT a signal read by the routing
     * layer — `processNodeResponse` self-loops these nodes by checking
     * `acceptsUserMessages` + actionless message at the routing entry, so no
     * code outside the two plan-shaping feature-sync nodes reads this field.
     * Mirrors `proposedStagesFeedback`'s consume-and-clear pattern.
     */
    featureSyncPendingUserReply?: string;
    /**
     * Per-item choices from the latest "Revise" submission. Consumed and
     * cleared by the next iterate trigger alongside the pending reply; they
     * guide the agent only and never approve proposals.
     */
    featureSyncPendingDecisions?: PlanShapingFeatureSyncItemDecision[];
  };

export type TaskPrioritizationFlowContext = FlowContext & {
  initiativeTaskSnapshot?: InitiativeTaskSnapshot[];
};

export type InitiativeTaskSnapshot = {
  initiativeId: InitiativeId;
  name: string;
  description: string;
  status: string;
  priority?: string | null;
  acceptanceCriteria?: string;
  tasks: Array<{
    id: TaskId;
    title: string;
    description: string;
    status: string;
    acceptanceCriteria?: string;
  }>;
};

// Routing decision schema with strict validation
export const routingDecisionSchema = z.object({
  nextNodeId: z.string().min(1, 'nextNodeId must not be empty'),
  reasoning: z.string().min(1, 'just say something'),
  confidence: z.number().min(0).max(1),
});

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

// Runtime validation function
export function validateRoutingDecision(
  decision: unknown,
  availableOptions: Array<{ nodeId: string }>,
): RoutingDecision | null {
  try {
    // 1. Schema validation
    const parseResult = routingDecisionSchema.safeParse(decision);
    if (!parseResult.success) {
      console.warn('Routing decision schema validation failed', {
        errors: parseResult.error.errors,
        decision,
      });
      return null;
    }

    // 2. NodeId existence validation
    const validNodeIds = availableOptions.map(
      (opt: { nodeId: string }) => opt.nodeId,
    );
    if (!validNodeIds.includes(parseResult.data.nextNodeId)) {
      console.warn('Selected nodeId not in available options', {
        selectedNodeId: parseResult.data.nextNodeId,
        availableNodeIds: validNodeIds,
      });
      return null;
    }

    return parseResult.data;
  } catch (error) {
    console.error('Routing decision validation error', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

// Template variable interface for type safety
export interface RoutingTemplateVariables {
  userResponses: string;
  routingOptions: string;
}

// Message types for workflow communication
export type FlowMessage<T = unknown> = {
  type: 'user_message' | 'system_message' | 'flow_complete';
  data: T;
  timestamp: Date;
  metadata?: Record<string, unknown>;
};

// Level-aware classification context
export interface LevelAwareClassificationContext {
  currentLevel: 'description' | 'details' | 'acceptanceCriteria';
  nextLevel?: 'description' | 'details' | 'acceptanceCriteria';
  levelProgress: number; // 0-1 completion percentage
}

// Action-specific payload types for level-aware workflow
export interface ApprovalActionPayload {
  initiativeId: string;
  level: 'description' | 'details' | 'acceptanceCriteria';
  approved: boolean;
  feedback?: string;
}

export interface ContentUpdateActionPayload {
  initiativeId: string;
  level: 'description' | 'details' | 'acceptanceCriteria';
  content: string;
  previousContent: string;
}

export interface AgentExecutionResultPayload {
  readonly agentId: string;
  readonly executionId: string;
  readonly initiativeId: string;
  readonly status: 'completed' | 'failed' | 'timeout';
  readonly result?: {
    readonly text: string;
    readonly changes: Array<{
      readonly type: string;
      readonly field: string;
      readonly oldValue?: unknown;
      readonly newValue: unknown;
      readonly reasoning: string;
    }>;
    readonly confidence: number;
    readonly reasoning: string;
  };
  readonly error?: string;
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly conversationId: ConversationId;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}

// Retry payload for failed message retry functionality
export interface MessageRetryPayload {
  readonly messageId: MessageId;
  readonly nodeId: string;
  readonly workflowStep: string;
  readonly retryCount: number;
  readonly organizationId: OrganizationId;
}

// Compensation types for saga-aware error handling
export interface CompensationContext {
  nodeId: string;
  requestId: string;
  failurePhase: 'preparation' | 'execution' | 'processing' | 'completion';
  attemptCount: number;
  errorClassification: {
    type: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED' | 'TIMEOUT';
    permanent: boolean;
    circuitBreakerTriggered: boolean;
  };
  transactionState: {
    messageCreated: boolean;
    jobQueued: boolean;
    contextModified: boolean;
    artifactsCreated: boolean;
  };
  timestamp: Date;
}

export interface CompensationResult {
  action: 'RETRY' | 'SKIP_TO_NODE' | 'FAIL';
  nextNodeId?: string; // Required for SKIP_TO_NODE
  retryDelayMs?: number; // Optional delay for RETRY
  reason?: string; // Optional explanation for decision
}

// ============================================================================
// Legacy Type Aliases for Backwards Compatibility
// ============================================================================

/**
 * @deprecated Use INode instead
 * Alias for backwards compatibility with existing flow templates
 */
export type ConversationNode<T extends FlowContext = FlowContext> = INode<T>;

/**
 * Legacy Flow type that stores full node objects (not just routing config)
 * Used by existing flow templates and visualization services
 *
 * This is distinct from FlowTemplate which stores only routing configuration.
 * Eventually all flows should migrate to FlowTemplate + NodeRegistry pattern.
 */
export type Flow<T extends FlowContext = FlowContext> = {
  id: string;
  name: string;
  description: string;
  version: number;
  startNode: string;
  nodes: Record<string, ConversationNode<T>> & {
    end: ConversationNode<T>;
    recovery: ConversationNode<T>;
  };
  contextTransforms?: Record<
    string,
    (
      context: T,
      result: SystemMessageData,
      userMessage: FlowUserMessage,
    ) => Partial<T>
  >;
  onComplete?: (context: T) => Promise<void>;
};

/**
 * @deprecated Use NodeRoutingConfig instead
 * Alias for backwards compatibility with existing code
 */
export type RoutingConfig = NodeRoutingConfig;

// ============================================================================
// Additional Type Guards
// ============================================================================

/**
 * Type guard to check if a node uses LLM processing
 * Includes CLASSIFICATION, ANALYZE, and GENERATE nodes
 */
export function isLLMNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is
  | LlmQuestionsNodeBase<T>
  | AnalyzeNodeBase<T>
  | GenerateNodeBase<T>
  | ClassificationNodeBase<T>
  | AgentNodeBase<T> {
  return (
    node.type === NodeType.LLM_QUESTIONS ||
    node.type === NodeType.ANALYZE ||
    node.type === NodeType.GENERATE ||
    node.type === NodeType.FINALIZE ||
    node.type === NodeType.CONFIRM ||
    node.type === NodeType.AGENT ||
    node.type === NodeType.CLASSIFICATION
  );
}

export function isPromptConfigurableNode<T extends FlowContext = FlowContext>(
  node: INode<T>,
): node is
  | LlmQuestionsNodeBase<T>
  | AnalyzeNodeBase<T>
  | GenerateNodeBase<T>
  | ClassificationNodeBase<T> {
  return (
    node.type === NodeType.OPENER ||
    node.type === NodeType.LLM_QUESTIONS ||
    node.type === NodeType.ANALYZE ||
    node.type === NodeType.GENERATE ||
    node.type === NodeType.NON_INTERACTIVE ||
    node.type === NodeType.FINALIZE ||
    node.type === NodeType.CONFIRM ||
    node.type === NodeType.CLASSIFICATION
  );
}

// ============================================================================
// Message Authorship (twoPhase resume predicate)
// ============================================================================

/**
 * Returns true if a message is eligible to complete an EXTERNAL_AGENT pause.
 *
 * Authorship is deliberately NOT the discriminator. The real completion
 * contract is enforced elsewhere and independently of who wrote the row:
 * `acceptsUserMessages` (message-processor) drops non-action-bearing USER
 * messages before the workflow signal fires, and
 * `validateExternalAgentCompletion` rejects missing/unknown actions or
 * payloads that fail the node's action schema. An action-bearing USER click
 * (Approve / Continue Refining) carries the same `action` discriminator the
 * actions map declares, so it is a legitimate completion candidate even
 * though its `userId` is a human uuid rather than `'system'`.
 *
 * The one exclusion that remains: synthetic control messages
 * (`data.type === 'CONTROL'`) are internal workflow-steering signals, not
 * completion candidates, and follow a separate path — they are excluded here
 * so CONTROL messages keep their existing behavior.
 */
export function isCompletionCandidateMessage(
  message: FlowUserMessage,
): boolean {
  const messageData = message.data as { type?: string } | undefined;
  return messageData?.type !== 'CONTROL';
}

/**
 * Returns true if the given message should complete the current twoPhase
 * pause for a node of the given type.
 *
 * - EXTERNAL_AGENT nodes accept any non-CONTROL completion candidate; the
 *   action map (`validateExternalAgentCompletion`) and `acceptsUserMessages`
 *   enforce the real contract, so an action-bearing USER button click
 *   advances the node while CONTROL messages are still excluded.
 * - All other node types preserve today's behavior — any message received
 *   while paused is treated as a completion candidate.
 */
export function isNodeCompletionMessage(
  nodeType: string,
  message: FlowUserMessage,
): boolean {
  if (nodeType === NodeType.EXTERNAL_AGENT) {
    return isCompletionCandidateMessage(message);
  }
  return true;
}
