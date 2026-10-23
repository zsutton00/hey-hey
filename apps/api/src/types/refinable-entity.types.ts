/**
 * Core interfaces for unified work item refinement system
 *
 * This module defines the shared abstractions that enable both initiatives and tasks
 * to use the same refinement logic while preserving their domain-specific differences.
 */

// Work item type discriminator
export type EntityType = 'initiative' | 'task';

/**
 * Core interface that all refinable entities must implement
 * Contains the minimal set of fields required for refinement processing
 */
export interface RefinableEntity {
  id: string;
  name: string;
  description: string;
  details: string;
  acceptanceCriteria: string;
  status: string;
  priority?: string | null;
  assigneeId?: string | null;
  organizationId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  tags?: string[];
  reasoning?: string;
}

/**
 * Context information for refinement operations
 * Provides the necessary identifiers and metadata for refinement processing
 */
export interface RefinementContext {
  entityId: string;
  entityType: EntityType;
  organizationId: string;
  projectId?: string;
  conversationId?: string;
  workflowId?: string;
}

/**
 * Refinement levels supported by the system
 * These correspond to the three-level refinement process
 */
export type RefinementLevel =
  | 'description'
  | 'content'
  | 'details'
  | 'acceptanceCriteria'
  | 'context'
  | 'decision'
  | 'consequences'
  | 'status'
  | 'review';

/**
 * Configuration for a refinement level
 * Defines how each level maps to entity fields and processing rules
 */
export interface RefinementLevelConfig {
  id: RefinementLevel;
  field: string;
  order: number;
  displayName: string;
  description: string;
}

/**
 * Signal definitions for workflow communication
 * Provides type-safe signal naming and isolation
 */
export interface SignalDefinition {
  type: string;
  nameGenerator: (workflowId: string) => string;
  payloadType: string;
}

/**
 * Configuration for a specific work item type
 * Encapsulates all the type-specific behavior and mappings
 */
export interface WorkItemTypeConfig {
  type: EntityType;
  displayName: string;
  refinementLevels: RefinementLevelConfig[];
  statusMappings: Record<string, RefinementLevel>;
  signalDefinitions: SignalDefinition[];
  fieldMappings: Record<string, string>;
}

/**
 * Result of change detection operation
 * Used by optimization services to determine processing requirements
 */
export interface ChangeDetectionResult {
  hasChanges: boolean;
  changesSummary?: string;
  confidenceScore: number;
  affectedFields?: string[];
  changeType?: 'minor' | 'major' | 'structural';
}

/**
 * Context for optimization decisions
 * Generated from change detection to guide processing flow
 */
export interface OptimizationContext {
  shouldSkipLlm: boolean;
  optimizationHints: string[];
  processingRecommendation: 'generate' | 'skip' | 'review';
  estimatedProcessingTime?: number;
}

/**
 * Content updates for refinement operations
 * Structured format for field-specific updates
 */
export interface ContentUpdates {
  description?: string;
  details?: string;
  acceptanceCriteria?: string;
  priority?: string | null;
  assigneeId?: string | null;
}

/**
 * Result of a refinement session creation
 * Contains the conversation context and initial state
 */
export interface RefinementSession {
  conversationId: string;
  workflowId: string;
  currentLevel: RefinementLevel;
  entitySnapshot: RefinableEntity;
  sessionMetadata: Record<string, unknown>;
}

/**
 * Refinement operation result
 * Standardized response format for all refinement operations
 */
export interface RefinementOperationResult {
  success: boolean;
  message: string;
  status: string;
  entityId: string;
  currentLevel: RefinementLevel;
  workflowId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Generic refinement request structure
 * Unified format for refinement operations across entity types
 */
export interface WorkItemRefinementRequest {
  message?: string;
  contentUpdate?: {
    content: string;
    level: RefinementLevel;
    previousContent: string;
  };
  classifiedIntent?:
    | 'approve_level'
    | 'edit_content'
    | 'finalize'
    | 'general_response';
  metadata?: Record<string, unknown>;
}

/**
 * Type guards for runtime type checking
 */
export function isRefinableEntity(obj: unknown): obj is RefinableEntity {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as RefinableEntity).id === 'string' &&
    typeof (obj as RefinableEntity).name === 'string' &&
    typeof (obj as RefinableEntity).description === 'string' &&
    typeof (obj as RefinableEntity).organizationId === 'string'
  );
}

export function isValidEntityType(type: string): type is EntityType {
  return type === 'initiative' || type === 'task';
}

export function isValidRefinementLevel(
  level: string,
): level is RefinementLevel {
  return (
    level === 'description' ||
    level === 'content' ||
    level === 'details' ||
    level === 'acceptanceCriteria' ||
    level === 'context' ||
    level === 'decision' ||
    level === 'consequences' ||
    level === 'status' ||
    level === 'review'
  );
}

/**
 * Utility functions for refinement level management
 */
export function getRefinementLevelOrder(level: RefinementLevel): number {
  const orderMap: Record<RefinementLevel, number> = {
    description: 1,
    content: 1,
    details: 2,
    acceptanceCriteria: 3,
    context: 1,
    decision: 2,
    consequences: 3,
    status: 4,
    review: 5,
  };
  return orderMap[level];
}

export function getNextRefinementLevel(
  currentLevel: RefinementLevel,
): RefinementLevel | null {
  const levels: RefinementLevel[] = [
    'description',
    'details',
    'acceptanceCriteria',
    'context',
    'decision',
    'consequences',
    'status',
    'review',
  ];
  const currentIndex = levels.indexOf(currentLevel);
  if (currentIndex === -1) {
    return null;
  }
  return levels[currentIndex + 1] ?? null;
}

export function getPreviousRefinementLevel(
  currentLevel: RefinementLevel,
): RefinementLevel | null {
  const levels: RefinementLevel[] = [
    'description',
    'details',
    'acceptanceCriteria',
  ];
  const currentIndex = levels.indexOf(currentLevel);
  if (currentIndex <= 0) {
    return null;
  }
  return levels[currentIndex - 1] ?? null;
}
