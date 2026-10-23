/**
 * Initiative Content Type Configuration
 *
 * Defines the configuration for initiatives using the hybrid implementation type
 * to preserve sophisticated features like message classification, workflow orchestration,
 * and optimization while providing staged content framework compatibility.
 *
 * Maps existing InitiativeRefinementController patterns to the staged content framework.
 */

import { ContentTypeDefinition } from '../../types/staged-content.types';

export const INITIATIVE_CONTENT_TYPE: ContentTypeDefinition = {
  id: 'initiative',
  type: 'initiative', // Maps to existing EntityType
  displayName: 'Initiative',
  description:
    'Strategic initiatives with sophisticated workflow orchestration and message classification',
  version: '1.0.0',
  implementationType: 'hybrid', // Combines controller logic with workflow orchestration

  // Three-stage refinement process with workflow integration
  stages: [
    {
      id: 'description',
      name: 'description',
      displayName: 'Description',
      order: 1,
      contentFields: ['description'],
      nextStages: ['details'],
      validationRules: [
        {
          type: 'field_required',
          field: 'description',
          errorMessage: 'Initiative description is required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'description',
          minLength: 25,
          errorMessage:
            'Initiative description should provide sufficient strategic context (minimum 25 characters)',
        },
      ],
      interactionType: 'hybrid', // Supports both user input and AI assistance
      isTerminal: false,
      workflowNodeId: 'agent_next_level_analysis', // Maps to existing workflow node
      estimatedDuration: 30, // minutes
    },
    {
      id: 'details',
      name: 'details',
      displayName: 'Details',
      order: 2,
      contentFields: ['details'],
      nextStages: ['acceptanceCriteria'],
      validationRules: [
        {
          type: 'field_required',
          field: 'details',
          errorMessage: 'Implementation details are required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'details',
          minLength: 50,
          errorMessage:
            'Details should provide comprehensive implementation guidance (minimum 50 characters)',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      workflowNodeId: 'agent_next_level_analysis', // Reuses workflow logic
      estimatedDuration: 45, // minutes
    },
    {
      id: 'acceptanceCriteria',
      name: 'acceptanceCriteria',
      displayName: 'Acceptance Criteria',
      order: 3,
      contentFields: ['acceptanceCriteria'],
      nextStages: [], // Terminal stage
      validationRules: [
        {
          type: 'field_required',
          field: 'acceptanceCriteria',
          errorMessage:
            'Acceptance criteria are required to finalize the initiative',
          required: true,
        },
        {
          type: 'min_length',
          field: 'acceptanceCriteria',
          minLength: 30,
          errorMessage:
            'Acceptance criteria should clearly define measurable success indicators',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: true,
      workflowNodeId: 'agent_next_level_analysis',
      estimatedDuration: 35, // minutes
    },
  ],

  // Maps stages to existing initiative status values
  statusMappings: {
    description: 'description',
    details: 'details',
    acceptanceCriteria: 'acceptanceCriteria',
  },

  // Entity schema that matches existing Initiative structure
  entitySchema: {
    entityType: 'Initiative',
    statusMapping: {
      description: 'REFINING_DESCRIPTION',
      details: 'REFINING_DETAILS',
      acceptanceCriteria: 'REFINING_ACCEPTANCE_CRITERIA',
    },
    progressCalculation: 'linear',
  },

  // Refinement levels for compatibility with existing WorkItemTypeConfig
  refinementLevels: [
    {
      id: 'description',
      field: 'description',
      order: 1,
      displayName: 'Description',
      description: 'Strategic overview and high-level goals of the initiative',
    },
    {
      id: 'details',
      field: 'details',
      order: 2,
      displayName: 'Details',
      description: 'Detailed implementation plan and technical requirements',
    },
    {
      id: 'acceptanceCriteria',
      field: 'acceptanceCriteria',
      order: 3,
      displayName: 'Acceptance Criteria',
      description: 'Measurable success criteria and completion indicators',
    },
  ],

  // Signal definitions for workflow integration
  signalDefinitions: [
    {
      type: 'userMessage',
      nameGenerator: (workflowId: string) => `userMessage-${workflowId}`,
      payloadType: 'UserMessagePayload',
    },
    {
      type: 'skipToNode',
      nameGenerator: (workflowId: string) => `skipToNode-${workflowId}`,
      payloadType: 'SkipToNodePayload',
    },
    {
      type: 'pauseWorkflow',
      nameGenerator: (workflowId: string) => `pauseWorkflow-${workflowId}`,
      payloadType: 'PauseWorkflowPayload',
    },
  ],

  // Field mappings for database compatibility
  fieldMappings: {
    acceptanceCriteria: 'acceptanceCriteria',
  },

  // Routing configuration for workflow orchestration
  routingConfig: {
    workflowId: 'initiative-refinement',
    signalPrefix: 'initiative',
    nodeMapping: {
      description: 'agent_next_level_analysis',
      details: 'agent_next_level_analysis',
      acceptanceCriteria: 'agent_next_level_analysis',
    },
    errorHandling: {
      retryStrategy: 'backoff',
      maxRetries: 3,
      fallbackStrategy: 'previous_stage',
      errorNotification: true,
    },
  },

  // Advanced feature set for initiatives
  features: {
    messageClassification: true, // Preserve sophisticated message classification
    changeDetection: true, // Enable optimization through change detection
    workflowOrchestration: true, // Full Temporal workflow integration
    optimizationHints: true, // Provide intelligent processing recommendations
    autoProgression: false, // Manual control over progression
    versionControl: true, // Track changes and history
    collaborativeEditing: false, // Individual refinement for now
  },
};

// Advanced configuration for initiative-specific behavior
export const INITIATIVE_ADVANCED_CONFIG = {
  // Message classification intents specific to initiatives
  supportedIntents: [
    'approve_level',
    'edit_content',
    'finalize',
    'general_response',
    'deepen_analysis',
    'request_optimization',
  ],

  // Workflow node mappings for different operations
  workflowNodes: {
    classification: 'classify_message',
    nextLevelAnalysis: 'agent_next_level_analysis',
    contentGeneration: 'agent_generate_content',
    optimization: 'agent_optimize_content',
    finalization: 'finalize_refinement',
  },

  // Change detection thresholds
  changeDetection: {
    minorChangeThreshold: 0.1, // 10% change
    majorChangeThreshold: 0.3, // 30% change
    structuralChangeThreshold: 0.5, // 50% change
  },

  // Optimization settings
  optimization: {
    enableSkipLlm: true,
    confidenceThreshold: 0.8,
    maxProcessingTime: 300000, // 5 minutes in milliseconds
  },
};

// Export helper function to validate initiative configuration
export function validateInitiativeConfiguration(): void {
  const config = INITIATIVE_CONTENT_TYPE;

  if (config.implementationType !== 'hybrid') {
    throw new Error('Initiative must use hybrid implementation type');
  }

  if (!config.features?.messageClassification) {
    throw new Error('Initiative must support message classification');
  }

  if (!config.features?.workflowOrchestration) {
    throw new Error('Initiative must support workflow orchestration');
  }

  if (!config.routingConfig) {
    throw new Error('Initiative must have routing configuration');
  }

  // Validate workflow node mappings
  for (const stage of config.stages) {
    if (!stage.workflowNodeId) {
      throw new Error(
        `Initiative stage '${stage.id}' must have a workflow node mapping`,
      );
    }
  }

  // Validate signal definitions
  const requiredSignals = ['userMessage', 'skipToNode'];
  for (const signal of requiredSignals) {
    if (!config.signalDefinitions.some((s) => s.type === signal)) {
      throw new Error(`Initiative must define '${signal}' signal`);
    }
  }
}

// Export configuration getter that includes validation
export function getValidatedInitiativeConfig(): ContentTypeDefinition {
  validateInitiativeConfiguration();
  return INITIATIVE_CONTENT_TYPE;
}
