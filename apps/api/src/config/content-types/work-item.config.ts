/**
 * Work Item Content Type Configuration
 *
 * Defines the configuration for work items (tasks and basic initiatives)
 * using the simple implementation type for direct controller logic.
 *
 * Maps existing work item refinement patterns to the staged content framework.
 */

import { ContentTypeDefinition } from '../../types/staged-content.types';

export const WORK_ITEM_CONTENT_TYPE: ContentTypeDefinition = {
  id: 'work-item',
  type: 'task', // Maps to existing EntityType
  displayName: 'Work Item',
  description: 'Generic work items including tasks and simple initiatives',
  version: '1.0.0',
  implementationType: 'simple', // Direct controller logic without complex workflows

  // Task STANDARD profile uses two-stage refinement: description -> acceptanceCriteria
  stages: [
    {
      id: 'description',
      name: 'description',
      displayName: 'Description',
      order: 1,
      contentFields: ['description'],
      nextStages: ['acceptanceCriteria'],
      validationRules: [
        {
          type: 'field_required',
          field: 'description',
          errorMessage: 'Description is required to proceed to the next stage',
          required: true,
        },
        {
          type: 'min_length',
          field: 'description',
          minLength: 10,
          errorMessage: 'Description must be at least 10 characters long',
        },
      ],
      interactionType: 'user_input',
      isTerminal: false,
      estimatedDuration: 15, // minutes
    },
    {
      id: 'acceptanceCriteria',
      name: 'acceptanceCriteria',
      displayName: 'Acceptance Criteria',
      order: 2,
      contentFields: ['acceptanceCriteria'],
      nextStages: [], // Terminal stage
      validationRules: [
        {
          type: 'field_required',
          field: 'acceptanceCriteria',
          errorMessage:
            'Acceptance criteria are required to complete the work item',
          required: true,
        },
        {
          type: 'min_length',
          field: 'acceptanceCriteria',
          minLength: 15,
          errorMessage:
            'Acceptance criteria should clearly define completion requirements',
        },
      ],
      interactionType: 'user_input',
      isTerminal: true,
      estimatedDuration: 20, // minutes
    },
  ],

  // Maps stages to existing work status values
  statusMappings: {
    description: 'description',
    acceptanceCriteria: 'acceptanceCriteria',
  },

  // Entity schema that matches existing RefinableEntity structure
  entitySchema: {
    entityType: 'WorkItem',
    statusMapping: {
      description: 'REFINING_DESCRIPTION',
      acceptanceCriteria: 'REFINING_ACCEPTANCE_CRITERIA',
    },
    progressCalculation: 'linear', // Simple linear progression through stages
  },

  // Basic refinement levels for compatibility with existing WorkItemTypeConfig
  refinementLevels: [
    {
      id: 'description',
      field: 'description',
      order: 1,
      displayName: 'Description',
      description: 'High-level description and scope of the work item',
    },
    {
      id: 'acceptanceCriteria',
      field: 'acceptanceCriteria',
      order: 2,
      displayName: 'Acceptance Criteria',
      description: 'Clear criteria for determining when the work is complete',
    },
  ],

  // No complex signals needed for simple implementation
  signalDefinitions: [],

  // Basic field mappings for entity compatibility
  fieldMappings: {
    acceptanceCriteria: 'acceptanceCriteria', // Database snake_case mapping
  },

  // Simple feature set for work items
  features: {
    messageClassification: false, // Simple workflow doesn't need complex classification
    changeDetection: false,
    workflowOrchestration: false,
    optimizationHints: false,
    autoProgression: false, // Manual progression only
    versionControl: false,
    collaborativeEditing: false,
  },
};

// Export helper function to validate work item configuration
export function validateWorkItemConfiguration(): void {
  const config = WORK_ITEM_CONTENT_TYPE;

  if (config.stages.length !== 2) {
    throw new Error('Work item must have exactly 2 stages');
  }

  const stageIds = config.stages.map((s) => s.id);
  const expectedStages = ['description', 'acceptanceCriteria'];

  for (const expectedStage of expectedStages) {
    if (!stageIds.includes(expectedStage)) {
      throw new Error(`Work item missing required stage: ${expectedStage}`);
    }
  }

  // Validate stage progression
  const descriptionStage = config.stages.find((s) => s.id === 'description');
  const acceptanceStage = config.stages.find(
    (s) => s.id === 'acceptanceCriteria',
  );

  if (!descriptionStage?.nextStages.includes('acceptanceCriteria')) {
    throw new Error('Description stage must progress to acceptanceCriteria');
  }

  if (acceptanceStage?.nextStages.length !== 0) {
    throw new Error('Acceptance criteria stage must be terminal');
  }
}
