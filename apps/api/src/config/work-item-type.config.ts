/**
 * Work Item Type Configuration System
 *
 * Defines the configuration for each work item type (initiative, task) including
 * refinement levels, signal definitions, and processing behaviors.
 */

import {
  WorkItemTypeConfig,
  RefinementLevelConfig,
  SignalDefinition,
  EntityType,
  RefinementLevel,
} from '../types/refinable-entity.types';

/**
 * Signal name generators for workflow isolation
 * Each work item type gets its own signal namespace to prevent cross-workflow interference
 */
export const WorkItemSignals = {
  // Initiative signals (preserve existing patterns)
  getInitiativeRefinementFeedbackSignalName: (workflowId: string) =>
    `InitiativeRefinementFeedback-${workflowId}`,
  getInitiativeContentUpdateSignalName: (workflowId: string) =>
    `InitiativeContentUpdate-${workflowId}`,
  getInitiativeReviewSignalName: (workflowId: string) =>
    `InitiativeReview-${workflowId}`,
  getInitiativeFeedbackRequestSignalName: (workflowId: string) =>
    `InitiativeFeedbackRequest-${workflowId}`,

  // Task signals (new, isolated namespace)
  getTaskRefinementFeedbackSignalName: (workflowId: string) =>
    `TaskRefinementFeedback-${workflowId}`,
  getTaskContentUpdateSignalName: (workflowId: string) =>
    `TaskContentUpdate-${workflowId}`,
  getTaskReviewSignalName: (workflowId: string) => `TaskReview-${workflowId}`,
  getTaskFeedbackRequestSignalName: (workflowId: string) =>
    `TaskFeedbackRequest-${workflowId}`,

  // Generic workflow control signals
  getSkipToNodeSignalName: (workflowId: string) => `SkipToNode-${workflowId}`,
} as const;

/**
 * Common refinement level configurations
 * Shared structure but can be customized per work item type
 */
const createRefinementLevelConfig = (
  id: RefinementLevel,
  order: number,
  displayName: string,
  description: string,
): RefinementLevelConfig => ({
  id,
  field: id === 'acceptanceCriteria' ? 'acceptanceCriteria' : id,
  order,
  displayName,
  description,
});

/**
 * Initiative refinement levels configuration
 * Matches existing initiative refinement system
 */
const INITIATIVE_REFINEMENT_LEVELS: RefinementLevelConfig[] = [
  createRefinementLevelConfig(
    'description',
    1,
    'Description',
    'High-level overview of the initiative including objectives and scope',
  ),
  createRefinementLevelConfig(
    'details',
    2,
    'Details',
    'Technical approach, implementation plan, timeline, and resource requirements',
  ),
  createRefinementLevelConfig(
    'acceptanceCriteria',
    3,
    'Acceptance Criteria',
    'Success metrics, testing criteria, and completion definition',
  ),
];

/**
 * Task refinement levels configuration
 * Same structure as initiatives but adapted for task-specific language
 */
const TASK_REFINEMENT_LEVELS: RefinementLevelConfig[] = [
  createRefinementLevelConfig(
    'description',
    1,
    'Description',
    'Clear task description including what needs to be accomplished and why',
  ),
  createRefinementLevelConfig(
    'acceptanceCriteria',
    2,
    'Acceptance Criteria',
    'Definition of done, testing requirements, and quality standards',
  ),
];

/**
 * Signal definitions for initiative workflows
 * Preserves existing signal patterns and naming
 */
const INITIATIVE_SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    type: 'refinement_feedback',
    nameGenerator: WorkItemSignals.getInitiativeRefinementFeedbackSignalName,
    payloadType: 'InitiativeRefinementFeedbackPayload',
  },
  {
    type: 'content_update',
    nameGenerator: WorkItemSignals.getInitiativeContentUpdateSignalName,
    payloadType: 'InitiativeContentUpdatePayload',
  },
  {
    type: 'review',
    nameGenerator: WorkItemSignals.getInitiativeReviewSignalName,
    payloadType: 'InitiativeReviewPayload',
  },
  {
    type: 'feedback_request',
    nameGenerator: WorkItemSignals.getInitiativeFeedbackRequestSignalName,
    payloadType: 'InitiativeFeedbackRequestPayload',
  },
];

/**
 * Signal definitions for task workflows
 * Follows same patterns as initiatives but with task-specific naming
 */
const TASK_SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    type: 'refinement_feedback',
    nameGenerator: WorkItemSignals.getTaskRefinementFeedbackSignalName,
    payloadType: 'TaskRefinementFeedbackPayload',
  },
  {
    type: 'content_update',
    nameGenerator: WorkItemSignals.getTaskContentUpdateSignalName,
    payloadType: 'TaskContentUpdatePayload',
  },
  {
    type: 'review',
    nameGenerator: WorkItemSignals.getTaskReviewSignalName,
    payloadType: 'TaskReviewPayload',
  },
  {
    type: 'feedback_request',
    nameGenerator: WorkItemSignals.getTaskFeedbackRequestSignalName,
    payloadType: 'TaskFeedbackRequestPayload',
  },
];

/**
 * Initiative work item type configuration
 * Preserves all existing initiative refinement behavior
 */
const INITIATIVE_CONFIG: WorkItemTypeConfig = {
  type: 'initiative',
  displayName: 'Initiative',
  refinementLevels: INITIATIVE_REFINEMENT_LEVELS,

  // Initiative status mappings to refinement levels
  // These map the existing initiative statuses to refinement levels
  statusMappings: {
    REFINING_DESCRIPTION: 'description',
    REFINING_DETAILS: 'details',
    REFINING_ACCEPTANCE_CRITERIA: 'acceptanceCriteria',
    DRAFT: 'description',
    UNDER_REVIEW: 'acceptanceCriteria',
  },

  signalDefinitions: INITIATIVE_SIGNAL_DEFINITIONS,

  // Field mappings for API compatibility
  fieldMappings: {
    acceptanceCriteria: 'acceptanceCriteria',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    organizationId: 'organization_id',
    assigneeId: 'assignee_id',
  },
};

/**
 * Task work item type configuration
 * New configuration following initiative patterns
 */
const TASK_CONFIG: WorkItemTypeConfig = {
  type: 'task',
  displayName: 'Task',
  refinementLevels: TASK_REFINEMENT_LEVELS,

  // Task status mappings - note that tasks don't change status during refinement
  // Task status (BACKLOG, TODO, etc.) serves workflow management, not refinement state
  statusMappings: {
    BACKLOG: 'description',
    TODO: 'description',
    IN_PROGRESS: 'description',
    REFINING_DESCRIPTION: 'description',
    GENERATING_DESCRIPTION: 'description',
    REFINING_DETAILS: 'acceptanceCriteria',
    GENERATING_DETAILS: 'acceptanceCriteria',
    GENERATING_DESCRIPTION_AND_DETAILS: 'acceptanceCriteria',
    REFINING_ACCEPTANCE_CRITERIA: 'acceptanceCriteria',
    GENERATING_ACCEPTANCE_CRITERIA: 'acceptanceCriteria',
    GENERATING_ALL: 'acceptanceCriteria',
    READY_FOR_REVIEW: 'acceptanceCriteria',
    DONE: 'acceptanceCriteria',
    ACTIVE: 'acceptanceCriteria',
    COMPLETED: 'acceptanceCriteria',
  },

  signalDefinitions: TASK_SIGNAL_DEFINITIONS,

  // Field mappings for API compatibility
  fieldMappings: {
    acceptanceCriteria: 'acceptanceCriteria',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    organizationId: 'organization_id',
    assigneeId: 'assignee_id',
    initiativeId: 'initiative_id',
    parentTaskId: 'parent_task_id',
  },
};

/**
 * Registry of all work item type configurations
 */
const WORK_ITEM_CONFIGS: Record<EntityType, WorkItemTypeConfig> = {
  initiative: INITIATIVE_CONFIG,
  task: TASK_CONFIG,
} as const;

/**
 * Work Item Type Configuration Service
 * Provides type-safe access to work item configurations
 */
export class WorkItemTypeConfigService {
  /**
   * Get configuration for a specific work item type
   */
  static getConfig(entityType: EntityType): WorkItemTypeConfig {
    const config = WORK_ITEM_CONFIGS[entityType];
    if (!config) {
      throw new Error(`Unknown work item type: ${entityType}`);
    }
    return config;
  }

  /**
   * Get all available work item types
   */
  static getAllTypes(): EntityType[] {
    return Object.keys(WORK_ITEM_CONFIGS) as EntityType[];
  }

  /**
   * Get refinement levels for a work item type
   */
  static getRefinementLevels(entityType: EntityType): RefinementLevelConfig[] {
    return this.getConfig(entityType).refinementLevels;
  }

  /**
   * Get signal definitions for a work item type
   */
  static getSignalDefinitions(entityType: EntityType): SignalDefinition[] {
    return this.getConfig(entityType).signalDefinitions;
  }

  /**
   * Map a status to refinement level for a work item type
   */
  static mapStatusToLevel(
    entityType: EntityType,
    status: string,
  ): RefinementLevel {
    const config = this.getConfig(entityType);
    const level = config.statusMappings[status];
    if (!level) {
      // Default to description level if no mapping found
      return 'description';
    }
    return level;
  }

  /**
   * Get field mappings for a work item type
   */
  static getFieldMappings(entityType: EntityType): Record<string, string> {
    return this.getConfig(entityType).fieldMappings;
  }

  /**
   * Validate if an entity type is supported
   */
  static isValidEntityType(entityType: string): entityType is EntityType {
    return entityType in WORK_ITEM_CONFIGS;
  }

  /**
   * Get signal name for a specific signal type and workflow
   */
  static getSignalName(
    entityType: EntityType,
    signalType: string,
    workflowId: string,
  ): string {
    const config = this.getConfig(entityType);
    const signalDef = config.signalDefinitions.find(
      (def) => def.type === signalType,
    );
    if (!signalDef) {
      throw new Error(
        `Unknown signal type: ${signalType} for entity type: ${entityType}`,
      );
    }
    return signalDef.nameGenerator(workflowId);
  }

  /**
   * Get the next refinement level for a work item type
   */
  static getNextLevel(
    entityType: EntityType,
    currentLevel: RefinementLevel,
  ): RefinementLevel | null {
    const levels = this.getRefinementLevels(entityType);
    const currentIndex = levels.findIndex((level) => level.id === currentLevel);
    if (currentIndex === -1 || currentIndex === levels.length - 1) {
      return null;
    }
    const nextLevel = levels[currentIndex + 1];
    if (!nextLevel) {
      return null;
    }
    return nextLevel.id;
  }

  /**
   * Get the previous refinement level for a work item type
   */
  static getPreviousLevel(
    entityType: EntityType,
    currentLevel: RefinementLevel,
  ): RefinementLevel | null {
    const levels = this.getRefinementLevels(entityType);
    const currentIndex = levels.findIndex((level) => level.id === currentLevel);
    if (currentIndex <= 0) {
      return null;
    }
    const previousLevel = levels[currentIndex - 1];
    if (!previousLevel) {
      return null;
    }
    return previousLevel.id;
  }
}

// Export individual configurations for direct access when needed
export { INITIATIVE_CONFIG, TASK_CONFIG, WORK_ITEM_CONFIGS };
