/**
 * Design Document Content Type Configuration
 *
 * Defines the configuration for design documents using the hybrid implementation type
 * to support sophisticated workflow orchestration and structured document creation.
 *
 * Maps design document patterns to the staged content framework.
 */

import { ADR_REFINEMENT_NODES } from 'src/flows/constants';
import { ContentTypeDefinition } from '../../types/staged-content.types';
import { AdrStatus, BrainstormStatus, DecisionStatus } from 'src/generated';

export const ADR_DESIGN_DOC_CONTENT_TYPE: ContentTypeDefinition = {
  id: 'adr',
  type: 'initiative',
  displayName: 'Architecture Decision Record',
  description:
    'Multi-stage authoring flow for ADRs using the staged content framework.',
  version: '1.0.0',
  implementationType: 'hybrid',

  stages: [
    {
      id: 'context',
      name: 'context',
      displayName: 'Context',
      order: 1,
      contentFields: ['context'],
      nextStages: ['decision'],
      validationRules: [
        {
          type: 'field_required',
          field: 'context',
          errorMessage: 'Context is required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'context',
          minLength: 80,
          errorMessage:
            'Context should include enough detail to explain the decision (minimum 80 characters)',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      workflowNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
      estimatedDuration: 30,
    },
    {
      id: 'decision',
      name: 'decision',
      displayName: 'Decision',
      order: 2,
      contentFields: ['decision'],
      nextStages: ['consequences'],
      validationRules: [
        {
          type: 'field_required',
          field: 'decision',
          errorMessage: 'Decision statement is required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'decision',
          minLength: 50,
          errorMessage:
            'Decision should articulate the outcome clearly (minimum 50 characters)',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      workflowNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
      estimatedDuration: 20,
    },
    {
      id: 'consequences',
      name: 'consequences',
      displayName: 'Consequences',
      order: 3,
      contentFields: ['consequences'],
      nextStages: ['review'],
      validationRules: [
        {
          type: 'field_required',
          field: 'consequences',
          errorMessage: 'Consequences must explain the impact of the decision',
          required: true,
        },
        {
          type: 'min_length',
          field: 'consequences',
          minLength: 80,
          errorMessage:
            'Consequences should cover both positive and negative effects (minimum 80 characters)',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      workflowNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
      estimatedDuration: 30,
    },
    {
      id: 'review',
      name: 'review',
      displayName: 'Status & Review',
      order: 4,
      contentFields: ['statusNotes'],
      nextStages: [],
      validationRules: [
        {
          type: 'field_required',
          field: 'statusNotes',
          errorMessage: 'Status notes must be provided before closing the ADR',
          required: true,
        },
        {
          type: 'min_length',
          field: 'statusNotes',
          minLength: 40,
          errorMessage:
            'Status notes should describe the current state (minimum 40 characters)',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: true,
      workflowNodeId: ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
      estimatedDuration: 15,
    },
  ],

  statusMappings: {
    context: 'context',
    decision: 'decision',
    consequences: 'consequences',
    review: 'review',
  },

  entitySchema: {
    entityType: 'DesignDoc',
    statusMapping: {
      context: AdrStatus.AdrContext,
      decision: AdrStatus.AdrDecision,
      consequences: AdrStatus.AdrConsequences,
      review: 'ADR_REVIEW',
    },
    progressCalculation: 'linear',
  },

  refinementLevels: [
    {
      id: 'context',
      field: 'context',
      order: 1,
      displayName: 'Context',
      description:
        'Problem space, forces, and background information for the decision.',
    },
    {
      id: 'decision',
      field: 'decision',
      order: 2,
      displayName: 'Decision',
      description: 'The architectural decision that resolves the forces.',
    },
    {
      id: 'consequences',
      field: 'consequences',
      order: 3,
      displayName: 'Consequences',
      description: 'Implications of the decision for systems and teams.',
    },
    {
      id: 'review',
      field: 'statusNotes',
      order: 4,
      displayName: 'Status & Review',
      description: 'The current status of the ADR and reviewer notes.',
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
    finalReview: 'final_review',
  },

  // Advanced feature set for design documents
  features: {
    messageClassification: true, // Sophisticated message classification
    changeDetection: true, // Enable optimization through change detection
    workflowOrchestration: true, // Full Temporal workflow integration
    optimizationHints: true, // Provide intelligent processing recommendations
    autoProgression: false, // Manual control over progression
    versionControl: true, // Track changes and history
    collaborativeEditing: true, // Support multiple contributors
  },
};

export const DECISION_DESIGN_DOC_CONTENT_TYPE: ContentTypeDefinition = {
  id: 'decision',
  type: 'initiative',
  displayName: 'Decision Document',
  description: 'Single-stage decision design document refinement.',
  version: '1.0.0',
  implementationType: 'hybrid',

  stages: [
    {
      id: 'content',
      name: 'content',
      displayName: 'Content',
      order: 1,
      contentFields: ['content'],
      nextStages: ['review'],
      validationRules: [
        {
          type: 'field_required',
          field: 'content',
          errorMessage: 'Content is required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'content',
          minLength: 10,
          errorMessage: 'Content must be at least 10 characters',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      estimatedDuration: 15,
    },
    {
      id: 'review',
      name: 'review',
      displayName: 'Review',
      order: 2,
      contentFields: ['content'],
      nextStages: ['ready'],
      validationRules: [],
      interactionType: 'hybrid',
      isTerminal: false,
      estimatedDuration: 10,
    },
    {
      id: 'ready',
      name: 'ready',
      displayName: 'Ready',
      order: 3,
      contentFields: ['content'],
      nextStages: [],
      validationRules: [],
      interactionType: 'hybrid',
      isTerminal: true,
      estimatedDuration: 5,
    },
  ],

  statusMappings: {
    content: 'content',
  },

  entitySchema: {
    entityType: 'DesignDoc',
    statusMapping: {
      content: DecisionStatus.RefiningContent,
      review: DecisionStatus.InReview,
      ready: DecisionStatus.Ready,
    },
    progressCalculation: 'linear',
  },

  refinementLevels: [
    {
      id: 'content',
      field: 'content',
      order: 1,
      displayName: 'Content',
      description: 'Decision content for the design document.',
    },
  ],

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

  fieldMappings: {},

  features: {
    messageClassification: true,
    changeDetection: true,
    workflowOrchestration: true,
    optimizationHints: true,
    autoProgression: false,
    versionControl: true,
    collaborativeEditing: true,
  },
};

export const BRAINSTORM_DESIGN_DOC_CONTENT_TYPE: ContentTypeDefinition = {
  id: 'brainstorm',
  type: 'initiative',
  displayName: 'Brainstorm Document',
  description: 'Single-stage brainstorm design document refinement.',
  version: '1.0.0',
  implementationType: 'hybrid',

  stages: [
    {
      id: 'content',
      name: 'content',
      displayName: 'Content',
      order: 1,
      contentFields: ['content'],
      nextStages: ['review'],
      validationRules: [
        {
          type: 'field_required',
          field: 'content',
          errorMessage: 'Content is required to proceed',
          required: true,
        },
        {
          type: 'min_length',
          field: 'content',
          minLength: 10,
          errorMessage: 'Content must be at least 10 characters',
        },
      ],
      interactionType: 'hybrid',
      isTerminal: false,
      estimatedDuration: 15,
    },
    {
      id: 'review',
      name: 'review',
      displayName: 'Review',
      order: 2,
      contentFields: ['content'],
      nextStages: ['ready'],
      validationRules: [],
      interactionType: 'hybrid',
      isTerminal: false,
      estimatedDuration: 10,
    },
    {
      id: 'ready',
      name: 'ready',
      displayName: 'Ready',
      order: 3,
      contentFields: ['content'],
      nextStages: [],
      validationRules: [],
      interactionType: 'hybrid',
      isTerminal: true,
      estimatedDuration: 5,
    },
  ],

  statusMappings: {
    content: 'content',
  },

  entitySchema: {
    entityType: 'DesignDoc',
    statusMapping: {
      content: BrainstormStatus.RefiningContent,
      review: BrainstormStatus.InReview,
      ready: BrainstormStatus.Ready,
    },
    progressCalculation: 'linear',
  },

  refinementLevels: [
    {
      id: 'content',
      field: 'content',
      order: 1,
      displayName: 'Content',
      description: 'Brainstorm content for the design document.',
    },
  ],

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

  fieldMappings: {},

  features: {
    messageClassification: true,
    changeDetection: true,
    workflowOrchestration: true,
    optimizationHints: true,
    autoProgression: false,
    versionControl: true,
    collaborativeEditing: true,
  },
};

// Export helper function to validate design document configuration
export function validateDesignDocConfiguration(): void {
  const config = ADR_DESIGN_DOC_CONTENT_TYPE;

  if (config.implementationType !== 'hybrid') {
    throw new Error('Design document must use hybrid implementation type');
  }

  if (config.stages.length !== 5) {
    throw new Error('Design document must have exactly 5 stages');
  }

  const expectedStages = [
    'concept',
    'requirements',
    'architecture',
    'implementation',
    'review',
  ];
  const stageIds = config.stages.map((s) => s.id);

  for (const expectedStage of expectedStages) {
    if (!stageIds.includes(expectedStage)) {
      throw new Error(
        `Design document missing required stage: ${expectedStage}`,
      );
    }
  }

  // Validate workflow node mappings
  for (const stage of config.stages) {
    if (!stage.workflowNodeId) {
      throw new Error(
        `Design document stage '${stage.id}' must have a workflow node mapping`,
      );
    }
  }

  // Validate signal definitions
  const requiredSignals = ['userMessage', 'skipToNode'];
  for (const signal of requiredSignals) {
    if (!config.signalDefinitions.some((s) => s.type === signal)) {
      throw new Error(`Design document must define '${signal}' signal`);
    }
  }
}

// Export configuration getter that includes validation
export function getValidatedDesignDocConfig(): ContentTypeDefinition {
  validateDesignDocConfiguration();
  return ADR_DESIGN_DOC_CONTENT_TYPE;
}
