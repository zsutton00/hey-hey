/**
 * Staged Content Adapter Interface
 *
 * Defines the contract for adapters that bridge specific entity types
 * to the generic staged content framework. Each entity type (Initiative, Task, etc.)
 * should have an adapter that implements this interface.
 */

import {
  ContentTypeDefinition,
  StageDefinition,
  ValidationError,
} from '../types/staged-content.types';
import { StagedContentBase } from '../types/staged-content-base.types';

/**
 * Core adapter interface for entity integration
 * Now generic to support typed entities with no forced translation
 */
export interface StagedContentAdapter<
  T extends StagedContentBase = StagedContentBase,
> {
  /**
   * Find an entity by ID and organization
   * @param entityId - The entity identifier
   * @param organizationId - The organization identifier for access control
   * @returns The entity as a staged content entity, or null if not found
   */
  findEntity(entityId: string, organizationId: string): Promise<T | null>;

  /**
   * Update an entity with partial updates
   * @param entityId - The entity identifier
   * @param updates - Partial entity updates to apply
   * @param organizationId - The organization identifier for access control
   * @returns The updated entity as a staged content entity
   */
  updateEntity(
    entityId: string,
    updates: Partial<T>,
    organizationId: string,
  ): Promise<T>;

  /**
   * Create a conversation for the entity (optional)
   * @param entityId - The entity identifier
   * @param organizationId - The organization identifier
   * @param projectId - The project identifier
   * @returns Conversation details including ID and optional workflow ID
   */
  createConversation?(
    entityId: string,
    organizationId: string,
    projectId: string,
    planId?: string,
  ): Promise<{ id: string; workflowId?: string }>;

  /**
   * Find active conversation for the entity (optional)
   * @param entityId - The entity identifier
   * @param organizationId - The organization identifier
   * @returns Active conversation details, or null if none exists
   */
  findActiveConversation?(
    entityId: string,
    organizationId: string,
  ): Promise<{ id: string; workflowId?: string } | null>;

  /**
   * Validate a stage transition (optional)
   * @param entity - The entity being transitioned
   * @param fromStage - The current stage ID
   * @param toStage - The target stage ID
   * @returns Array of validation errors, empty if valid
   */
  validateStageTransition?(
    entity: T,
    fromStage: string,
    toStage: string,
  ): Promise<ValidationError[]>;

  /**
   * Calculate progress for the entity (optional)
   * @param entity - The entity to calculate progress for
   * @param contentType - The content type definition
   * @returns Progress percentage (0-100)
   */
  calculateProgress?(
    entity: T,
    contentType: ContentTypeDefinition,
  ): Promise<number>;

  /**
   * Get the current stage for the entity
   * @param entity - The entity to get the stage for
   * @param contentType - The content type definition
   * @returns Current stage definition
   */
  getCurrentStage?(
    entity: T,
    contentType: ContentTypeDefinition,
  ): StageDefinition;

  /**
   * Determine if the entity can advance to the next stage
   * @param entity - The entity to check
   * @param currentStage - The current stage definition
   * @param targetStage - The target stage definition
   * @returns True if advancement is allowed
   */
  canAdvanceToStage?(
    entity: T,
    currentStage: StageDefinition,
    targetStage: StageDefinition,
  ): Promise<boolean>;
}

/**
 * Enhanced adapter interface for sophisticated entity types
 * Extends the basic adapter with advanced features
 */
export interface AdvancedStagedContentAdapter extends StagedContentAdapter {
  /**
   * Process advanced operations with message classification and optimization
   * @param operation - The advanced operation to process
   * @returns Operation result with enhanced metadata
   */
  processAdvancedOperation(
    operation: AdvancedStageOperation,
  ): Promise<AdvancedStageOperationResult>;

  /**
   * Classify user message intent for the current context
   * @param message - The user message to classify
   * @param entity - The current entity context
   * @param currentStage - The current stage context
   * @returns Classified intent and confidence score
   */
  classifyMessageIntent?(
    message: string,
    entity: StagedContentBase,
    currentStage: StageDefinition,
  ): Promise<{
    intent: 'approve_level' | 'edit_content' | 'finalize' | 'general_response';
    confidence: number;
    reasoning: string;
  }>;

  /**
   * Detect changes in entity content for optimization
   * @param entity - The current entity state
   * @param proposedUpdates - The proposed changes
   * @returns Change detection result with optimization hints
   */
  detectChanges?(
    entity: StagedContentBase,
    proposedUpdates: Partial<StagedContentBase>,
  ): Promise<{
    hasChanges: boolean;
    changesSummary: string;
    confidenceScore: number;
    affectedFields: string[];
    changeType: 'minor' | 'major' | 'structural';
    optimizationHints: string[];
  }>;

  /**
   * Route operation to workflow system
   * @param operation - The operation to route
   * @param workflowContext - Current workflow context
   * @returns Workflow routing decision
   */
  routeToWorkflow?(
    operation: AdvancedStageOperation,
    workflowContext: Record<string, unknown>,
  ): Promise<{
    shouldRoute: boolean;
    workflowNodeId?: string;
    routingReason: string;
    estimatedDuration?: number;
  }>;
}

/**
 * Advanced stage operation for sophisticated workflows
 */
export interface AdvancedStageOperation {
  entityId: string;
  organizationId: string;
  projectId: string;
  operationType: 'refine' | 'optimize' | 'analyze' | 'generate';
  message?: string;
  context?: Record<string, unknown>;
  currentLevel?: 'description' | 'details' | 'acceptanceCriteria';
  classifiedIntent?:
    | 'approve_level'
    | 'edit_content'
    | 'finalize'
    | 'general_response';
  metadata?: Record<string, unknown>;
}

/**
 * Advanced operation result with enhanced metadata
 */
export interface AdvancedStageOperationResult {
  success: boolean;
  message: string;
  entity: StagedContentBase;
  newStage: string;
  progress: number;
  workflowTriggered?: boolean;
  workflowId?: string;
  optimizationApplied?: boolean;
  changesSummary?: string;
  errors?: ValidationError[];
  warnings?: string[];
  metadata?: {
    operationDuration?: number;
    validationResults?: string[];
    artifactsGenerated?: string[];
  };
  timestamp: Date;
}

/**
 * Adapter registry interface for managing multiple adapters
 */
export interface StagedContentAdapterRegistry {
  /**
   * Register an adapter for a specific entity type
   * @param entityType - The entity type identifier
   * @param adapter - The adapter implementation
   */
  register(entityType: string, adapter: StagedContentAdapter): void;

  /**
   * Get an adapter for a specific entity type
   * @param entityType - The entity type identifier
   * @returns The registered adapter
   * @throws Error if no adapter is registered for the entity type
   */
  get(entityType: string): StagedContentAdapter;

  /**
   * Check if an adapter is registered for an entity type
   * @param entityType - The entity type identifier
   * @returns True if an adapter is registered
   */
  has(entityType: string): boolean;

  /**
   * Get all registered entity types
   * @returns Array of registered entity type identifiers
   */
  getRegisteredEntityTypes(): string[];
}
