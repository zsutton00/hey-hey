import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../types';

/**
 * Message intent classification types for initiative refinement workflow routing
 */
export enum MessageIntent {
  INITIATIVE_FEEDBACK = 'initiative_feedback',
  CONTENT_UPDATE = 'content_update',
  REVIEW_REQUEST = 'review_request',
  APPROVAL = 'approval',
  REJECTION = 'rejection',
  GENERAL = 'general',
}

/**
 * Suggested actions based on message classification
 */
export enum InitiativeAction {
  REFINE = 'refine',
  UPDATE = 'update',
  REVIEW = 'review',
  APPROVE = 'approve',
  REJECT = 'reject',
}

/**
 * Initiative content levels that can be targeted by updates
 */
export type InitiativeLevel = 'description' | 'details' | 'acceptanceCriteria';

/**
 * Result of message classification analysis
 */
export interface MessageClassificationResult {
  /** Primary intent detected in the message */
  intent: MessageIntent;

  /** Confidence score from 0-1 indicating classification certainty */
  confidence: number;

  /** Target initiative ID if message relates to specific initiative */
  targetInitiativeId?: InitiativeId;

  /** Specific content level targeted for updates */
  targetLevel?: InitiativeLevel;

  /** Suggested action based on classification */
  suggestedAction?: InitiativeAction;

  /** Human-readable reasoning for the classification decision */
  reasoning: string;

  /** Additional metadata from classification process */
  metadata?: {
    /** Whether message was automatically classified */
    autoClassified?: boolean;

    /** Alternative classifications considered */
    alternatives?: Array<{
      intent: MessageIntent;
      confidence: number;
    }>;

    /** Model used for classification */
    model?: string;

    /** Whether classification used level-aware context */
    levelAware?: boolean;

    /** Current initiative level during classification */
    currentLevel?: InitiativeLevel;
  };
}

/**
 * Context information for message classification
 */
export interface ConversationContext {
  /** Conversation identifier */
  conversationId: ConversationId;

  /** Organization identifier for security boundaries */
  organizationId: OrganizationId;

  /** Project identifier if conversation is project-scoped */
  projectId?: ProjectId;

  /** Active workflow ID if conversation has workflow */
  workflowId?: WorkflowId;

  /** User who sent the message */
  userId?: UserId;

  /** Available initiatives in the conversation */
  availableInitiatives?: Array<{
    id: InitiativeId;
    name: string;
    description?: string;
    currentLevel?: InitiativeLevel;
    status?: string;
  }>;
}

/**
 * Result of initiative context extraction
 */
export interface InitiativeContextResult {
  /** Whether initiative context was found */
  hasInitiativeContext: boolean;

  /** Extracted initiative IDs mentioned in message */
  mentionedInitiativeIds: InitiativeId[];

  /** Confidence in initiative relevance */
  relevanceConfidence: number;

  /** Extracted entities and their types */
  extractedEntities?: Array<{
    text: string;
    type: 'initiative_name' | 'feature' | 'requirement' | 'status';
    confidence: number;
  }>;
}

/**
 * Payload for workflow signals generated from classified messages
 */
export interface WorkflowSignalPayload {
  /** Signal type identifier */
  type: string;

  /** Target initiative ID */
  initiativeId?: InitiativeId;

  /** Message content */
  content?: string;

  /** User who sent the message */
  userId?: UserId;

  /** Conversation context */
  conversationId?: ConversationId;

  /** Organization context */
  organizationId?: OrganizationId;

  /** Timestamp of message */
  timestamp?: Date;

  /** Classification metadata */
  metadata?: {
    confidence?: number;
    reasoning?: string;
    autoClassified?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Routing result after message processing
 */
export interface RoutingResult {
  /** Whether message was successfully routed */
  routed: boolean;

  /** Target workflow ID */
  workflowId?: WorkflowId;

  /** Signal name used for routing */
  signalName?: string;

  /** Signal payload sent */
  signalPayload?: WorkflowSignalPayload;

  /** Any routing errors encountered */
  error?: string;

  /** Timestamp of routing attempt */
  timestamp: Date;
}

/**
 * Configuration for message classification behavior
 */
export interface ClassificationConfig {
  /** Minimum confidence threshold for routing */
  confidenceThreshold: number;

  /** Whether to enable automatic routing */
  autoRoutingEnabled: boolean;

  /** Maximum message length to process */
  maxMessageLength: number;

  /** LLM model to use for classification */
  model: string;

  /** Temperature for LLM requests */
  temperature: number;

  /** Maximum number of recent messages to include */
  maxHistoryMessages: number;
}

/**
 * Default classification configuration
 */
export const DEFAULT_CLASSIFICATION_CONFIG: ClassificationConfig = {
  confidenceThreshold: 0.7,
  autoRoutingEnabled: true,
  maxMessageLength: 2000,
  model: 'claude-4-haiku',
  temperature: 0.1,
  maxHistoryMessages: 5,
};
