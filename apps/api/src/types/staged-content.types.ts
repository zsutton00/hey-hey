/**
 * Staged Content Framework Type Definitions
 *
 * This module defines the core types for the generic staged content pipeline system
 * that handles Work Items (3 stages), Documents (5 stages), and future content types
 * through configuration only.
 *
 * Extends existing RefinableEntity and WorkItemTypeConfig interfaces for compatibility.
 */

import { OrganizationId, ProjectId } from 'src/types';
import { RefinementLevel, WorkItemTypeConfig } from './refinable-entity.types';
import { StagedContentBase } from './staged-content-base.types';
import type {
  StageAction as StageActionModel,
  StageDefinition as StageDefinitionModel,
  StageOperationResult as StageOperationResultModel,
  StageValidationError as StageValidationErrorModel,
  StageValidationRule as StageValidationRuleModel,
  StageValidationRuleType as StageValidationRuleTypeModel,
  StagedContentAdvanceRequest as StagedContentAdvanceRequestModel,
  StagedContentContentUpdateRequest as StagedContentContentUpdateRequestModel,
  StagedContentEntity as StagedContentEntityModel,
  StagedContentEntitySchema as StagedContentEntitySchemaModel,
  StagedContentRefineRequest as StagedContentRefineRequestModel,
  StagedContentSession as StagedContentSessionModel,
  StagedContentTypeDefinition as StagedContentTypeDefinitionModel,
  StagedContentTypeFeatures as StagedContentTypeFeaturesModel,
  StageOperationOptions as StageOperationOptionsModel,
  StagedContentTypeId as StagedContentTypeIdModel,
  StageOperationType as StageOperationTypeModel,
} from '../generated';
import {
  StagedContentTypeId as StagedContentTypeIdEnum,
  StageOperationType as StageOperationTypeEnum,
} from '../generated';

// Content type identifiers
export type ContentTypeId = StagedContentTypeIdModel;

// Implementation strategy types
export type ImplementationType =
  StagedContentTypeDefinitionModel['implementationType'];

// Stage interaction types
export type InteractionType = StageDefinitionModel['interactionType'];

// Validation rule types
export type ValidationRuleType = StageValidationRuleTypeModel;

// Progress calculation strategies
export type ProgressCalculationType =
  StagedContentEntitySchemaModel['progressCalculation'];

// Operation types for stage operations
export type StageOperationType = StageOperationTypeModel;

/**
 * Staged content entity type - references the OpenAPI definition
 */
export type StagedContentEntity = StagedContentEntityModel;

/**
 * Individual stage definition within a content type
 * References the OpenAPI generated definition
 */
export type StageDefinition = StageDefinitionModel;

/**
 * Validation rule for stage transitions
 * References the OpenAPI generated definition
 */
export type StageValidationRule = StageValidationRuleModel;

/**
 * Schema definition for content entities
 * Maps staged content to specific entity types and database schemas
 */
export type ContentEntitySchema = StagedContentEntitySchemaModel;

/**
 * Complete content type definition that merges the generated schema with
 * the refinement-specific metadata we maintain locally.
 */
export type ContentTypeDefinition = Omit<
  StagedContentTypeDefinitionModel,
  'type'
> &
  WorkItemTypeConfig & {
    routingConfig?: RoutingConfig;
    features?: ContentTypeFeatures;
  };

/**
 * Routing configuration for workflow-based content types
 * Defines how operations are routed to workflow nodes
 */
export interface RoutingConfig {
  workflowId?: string;
  signalPrefix?: string;
  nodeMapping?: Record<string, string>; // stage -> workflow node
  errorHandling?: ErrorHandlingConfig;
}

/**
 * Features available for different content types
 * Enables/disables sophisticated functionality per content type
 */
export type ContentTypeFeatures = StagedContentTypeFeaturesModel;

/**
 * Error handling configuration for content types
 * Defines how errors are handled and recovered from
 */
export interface ErrorHandlingConfig {
  retryStrategy?: 'immediate' | 'backoff' | 'manual';
  maxRetries?: number;
  fallbackStrategy?: 'previous_stage' | 'error_state' | 'manual_intervention';
  errorNotification?: boolean;
}

/**
 * Stage transition record for audit and history tracking
 * Tracks how content progresses through stages
 */
export interface StageTransition {
  fromStage: string;
  toStage: string;
  timestamp: Date;
  triggeredBy: string; // User ID or system
  transitionType: 'advance' | 'rollback' | 'skip' | 'reset';
  metadata?: {
    automatedTransition?: boolean;
    validationResults?: string[];
    userAction?: string;
  };
  reason?: string;
}

/**
 * Session context for staged content operations
 * Contains all necessary information for processing operations
 * Now generic to support typed entities
 */
export type StagedContentSession = StagedContentSessionModel;

/**
 * Available actions for the current stage
 * Defines what operations can be performed in the current state
 */
export type StageAction = StageActionModel;

/**
 * Generic stage operation request
 * Unified format for all stage-related operations
 * Now generic to support typed payloads
 */
export interface StageOperation<
  T extends StagedContentBase = StagedContentBase,
> {
  contentTypeId: ContentTypeId;
  entityId: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  operationType: StageOperationType;
  payload: StageOperationPayload<T>;
  metadata?: StageOperationMetadata;
}

export interface StageOperationMetadata {
  requestId?: string;
  timestamp?: string;
  source?: string;
  classifiedIntent?: string;
  previousContent?: string;
  planId?: string;
}

/**
 * Payload for stage operations
 * Contains operation-specific data and parameters
 * Now generic to support typed content updates
 */
export interface StageOperationPayload<
  T extends StagedContentBase = StagedContentBase,
> {
  targetStage?: string;
  message?: string;
  options?: OperationOptions;
  validationOverride?: boolean;
}

/**
 * Options for stage operations
 * Controls how operations are processed
 */
export type OperationOptions = StageOperationOptionsModel;

/**
 * Result of a stage operation
 * Standardized response format for all stage operations
 * Now generic to support typed entities
 */
export type StageOperationResult = StageOperationResultModel;

/**
 * Validation errors for stage operations
 * Detailed error information for debugging and user feedback
 */
export type ValidationError = StageValidationErrorModel;

/**
 * Adapter interface for bridging specific entities to generic framework
 * Enables integration with existing entity types and services
 * Now generic to support typed entities with no forced translation
 */
export interface StagedContentAdapter<
  T extends StagedContentBase = StagedContentBase,
> {
  findEntity(entityId: string, organizationId: string): Promise<T | null>;

  updateEntity(
    entityId: string,
    updates: Partial<T>,
    organizationId: string,
  ): Promise<T>;

  createConversation?(
    entityId: string,
    organizationId: string,
    projectId: string,
  ): Promise<{ id: string; workflowId?: string }>;

  findActiveConversation?(
    entityId: string,
    organizationId: string,
  ): Promise<{ id: string; workflowId?: string } | null>;

  validateStageTransition?(
    entity: T,
    fromStage: string,
    toStage: string,
  ): Promise<ValidationError[]>;

  calculateProgress?(
    entity: T,
    contentType: ContentTypeDefinition,
  ): Promise<number>;
}

/**
 * Type guards for runtime type checking
 */
export function isStagedContentEntity(
  obj: unknown,
): obj is StagedContentEntity {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as StagedContentEntity).id === 'string' &&
    typeof (obj as StagedContentEntity).currentStage === 'string' &&
    typeof (obj as StagedContentEntity).organizationId === 'string'
  );
}

export function isValidContentTypeId(id: string): id is ContentTypeId {
  return Object.values(StagedContentTypeIdEnum).includes(id as ContentTypeId);
}

export function isValidImplementationType(
  type: string,
): type is ImplementationType {
  return type === 'simple' || type === 'workflow' || type === 'hybrid';
}

export function isValidInteractionType(type: string): type is InteractionType {
  return type === 'user_input' || type === 'ai_generation' || type === 'hybrid';
}

export function isValidStageOperationType(
  type: string,
): type is StageOperationType {
  return Object.values(StageOperationTypeEnum).includes(
    type as StageOperationType,
  );
}

/**
 * Utility functions for stage management
 */
export function getStageOrder(stage: StageDefinition): number {
  return stage.order;
}

export function getNextStages(currentStage: StageDefinition): string[] {
  return currentStage.nextStages;
}

export function isTerminalStage(stage: StageDefinition): boolean {
  return stage.isTerminal || stage.nextStages.length === 0;
}

export function calculateLinearProgress(
  currentStage: StageDefinition,
  totalStages: number,
): number {
  return Math.round((currentStage.order / totalStages) * 100);
}

export function calculateWeightedProgress(
  currentStage: StageDefinition,
  weightings: Record<string, number>,
): number {
  const totalWeight = Object.values(weightings).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const completedWeight = Object.entries(weightings)
    .filter(([stageId]) => parseInt(stageId) <= currentStage.order)
    .reduce((sum, [, weight]) => sum + weight, 0);

  return Math.round((completedWeight / totalWeight) * 100);
}

/**
 * Advanced stage operation types for sophisticated workflows
 */
export interface AdvancedStageOperation extends StageOperation {
  message?: string;
  context?: {
    previousLevel?: string;
    userFeedback?: string;
    validationOverrides?: string[];
  };
  currentLevel?: RefinementLevel;
  classifiedIntent?:
    | 'approve_level'
    | 'edit_content'
    | 'finalize'
    | 'general_response';
}

/**
 * Request types for unified controller endpoints
 */
export type AdvanceRequest = StagedContentAdvanceRequestModel;

export type RefineRequest = StagedContentRefineRequestModel;

export type ContentUpdateRequest = StagedContentContentUpdateRequestModel;

/**
 * Feature flags for gradual rollout
 */
export interface FeatureFlags {
  stagedContentFramework: boolean;
  useGenericFrameworkForWorkItems: boolean;
  useGenericFrameworkForInitiatives: boolean;
  enableDesignDocuments: boolean;
  enableAdvancedValidation: boolean;
  enableProgressTracking: boolean;
}
