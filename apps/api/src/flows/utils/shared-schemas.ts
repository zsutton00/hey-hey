import { z } from 'zod';
import {
  EntityType,
  TaskSummaryTaskTypeEnum,
} from 'src/generated/agents/models';
import { featureTagSchema } from 'src/types/feature-tag.types';

const entityTypeSchema = z.nativeEnum(EntityType);

const coerceNumericString = (value: unknown) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
};

/** Coerce a single string into a one-element array so LLM typos don't crash validation. */
const coerceToStringArray = (value: unknown): unknown => {
  if (value == null) return [];
  return typeof value === 'string' ? [value] : value;
};

const confidenceScoreSchema = z.preprocess(
  coerceNumericString,
  z.number().min(0).max(1),
);
const strictConfidenceScoreSchema = z.number().min(0).max(1);

const numericScoreSchema = z.preprocess(coerceNumericString, z.number());

// Shared schema for influence references - supports polymorphic entity types
export const influenceSchema = z.object({
  entityId: z.string().describe('UUID of the entity that influenced this item'),
  entityType: entityTypeSchema.describe(
    'Type of the influencing entity (e.g. ARTIFACT, INITIATIVE, TASK, MESSAGE)',
  ),
  taskType: z
    .string()
    .optional()
    .describe(
      'Optional opaque snapshot of the authoritative TASK work-item subtype',
    ),
  reasoning: z
    .string()
    .default('')
    .describe('Explanation of how this entity influenced the item'),
  reasonType: z
    .string()
    .describe(
      'Type of influence relationship - e.g. "explicit_mention", "implied", "derived"',
    ), // Accept any string instead of strict enum to prevent validation failures
  confidence: confidenceScoreSchema
    .nullable()
    .optional()
    .describe('Optional confidence score (0-1) for the influence relationship'),
});

export const apiInfluenceSchema = z.object({
  entityId: z.string().describe('UUID of the entity that influenced this item'),
  entityType: entityTypeSchema.describe(
    'Type of the influencing entity (e.g. ARTIFACT, INITIATIVE, TASK, MESSAGE)',
  ),
  taskType: z
    .string()
    .optional()
    .describe(
      'Optional opaque snapshot of the authoritative TASK work-item subtype',
    ),
  reasoning: z
    .string()
    .describe('Explanation of how this entity influenced the item'),
  reasonType: z
    .string()
    .describe(
      'Type of influence relationship - e.g. "explicit_mention", "implied", "derived"',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Optional confidence score (0-1) for the influence relationship'),
});

// TypeScript type inferred from the schema - matches OpenAPI Influence
export type InfluenceFromSchema = z.infer<typeof influenceSchema>;

// ArtifactInsight schema matching the OpenAPI spec and processor expectations
export const artifactInsightSchema = z.object({
  category: z.string().describe('userGoals'),
  title: z.string().describe('Primary Project Objective'),
  confidence: confidenceScoreSchema.describe('0.85'),
  reasoning: z
    .string()
    .default('')
    .describe(
      'User explicitly described the project goals and target audience',
    ),
  content: z
    .string()
    .describe(
      'Build a comprehensive knowledge management platform that helps teams find and share institutional knowledge',
    ),
  tags: z
    .array(z.string())
    .describe('[\"goal\", \"objective\"]')
    .nullable()
    .optional(),
  influences: z.array(influenceSchema).nullable().optional(),
});

export const responseSchema = z.object({
  response: z
    .string()
    .describe('Main response message to the user explaining the analysis'),
});

export const priorityHintSchema = z
  .object({
    urgency: z
      .enum(['low', 'medium', 'high'])
      .describe('How quickly the work should start')
      .catch('medium'),
    importance: z
      .enum(['low', 'medium', 'high'])
      .describe('How critical the work is to the broader objectives')
      .catch('medium'),
    effort: z
      .enum(['tiny', 'small', 'medium', 'large'])
      .describe('Relative size of the work')
      .catch('medium'),
    blocking_state: z
      .enum(['blocking', 'blocked', 'independent'])
      .describe('Dependency posture for the work')
      .catch('independent'),
  })
  .describe(
    'Priority guidance capturing urgency, importance, effort, and blocking state',
  );

export const entityClassificationSchema = z.object({
  category: z
    .enum(['technology', 'product', 'process', 'people'])
    .describe(
      'High-level category for the work request; must be one of technology, product, process, or people',
    ),
  selectedExistingSubfacetNames: z.preprocess(
    coerceToStringArray,
    z
      .array(z.string())
      .default([])
      .transform((arr) => arr.slice(0, 3))
      .describe(
        'Up to three existing subfacet names selected from the provided candidates',
      ),
  ),
  proposedNewSubfacetName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .nullable()
    .describe('Optional new subfacet name when no existing candidates fit'),
  proposedNewSubfacetConfidence: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe('Optional confidence score for the proposed new subfacet (0-1).'),
  proposedNewSubfacetRationale: z
    .string()
    .trim()
    .max(400)
    .nullable()
    .describe('Optional rationale for proposing a new subfacet.'),
  subfacets: z.preprocess(
    coerceToStringArray,
    z
      .array(z.string())
      .default([])
      .transform((arr) => arr.slice(0, 3))
      .describe('Free-text subfacet names (0-3) as fallback'),
  ),
  summary: z
    .string()
    .describe(
      'Short summary of the requested work that aligns with the chosen category',
    ),
});

export const relatedEntitySchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  entityName: z.string().min(1),
});

export const usageSummarySchema = z.object({
  modelId: z.string().nullable().optional(),
  promptTokens: z.number().min(0),
  completionTokens: z.number().min(0),
  totalTokens: z.number().min(0),
  estimatedCostUsd: z.number().nullable().optional(),
});

export const artifactsGenerationSchema = z.object({
  type: z
    .literal('ARTIFACTS_GENERATION')
    .describe('Response type identifier for artifact generation'),
  response: z
    .string()
    .describe('Main response message to the user explaining the analysis'),
  title: z
    .string()
    .nullable()
    .optional()
    .describe('Optional title for the analysis results'),
  detectedIntent: z
    .string()
    .describe(
      'Primary intent detected from the analysis - e.g. "generate_initiatives"',
    ),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score between 0 and 1 for the detected intent',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the analysis decisions'),
  insights: z
    .array(artifactInsightSchema)
    .describe('Array of structured insights extracted from the conversation'),
});

export const classificationResponseSchema = z.object({
  detectedIntent: z
    .enum(['need_questions', 'generate_adr', 'conversation'])
    .describe('Detected user intent - determines next flow step'),
  intentConfidence: confidenceScoreSchema.describe(
    'Confidence score for the detected intent',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional explanation for the classification decision'),
  inputAnalysis: z
    .object({
      hasArtifact: z
        .boolean()
        .describe('Whether the input contains artifact information'),
      hasDescription: z
        .boolean()
        .describe('Whether the input has sufficient description'),
      sufficiencyLevel: z
        .enum(['insufficient', 'partial', 'sufficient'])
        .describe('Assessment of input completeness'),
    })
    .describe('Analysis of the input quality and completeness'),
});

// TypeScript type inferred from the schema
export type ArtifactInsight = z.infer<typeof artifactInsightSchema>;

export const InitiativeSummarySchema = z.object({
  title: z.string().describe('Initiative title'),
  description: z.string(),
  details: z.string(),
  acceptanceCriteria: z.string(),
});

export type InitiativeSummary = z.infer<typeof InitiativeSummarySchema>;

export const TaskSummarySchema = z.object({
  taskType: z.nativeEnum(TaskSummaryTaskTypeEnum).optional(),
  title: z.string().describe('Task title'),
  description: z.string(),
  acceptanceCriteria: z.string().optional(),
});

export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const conversationMessageSchema = z.object({
  id: z.string().describe('Message identifier'),
  content: z.string().describe('Message content'),
  role: z.string().optional(),
});

export const mentionContextSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  messageId: z.string().min(1),
  summary: z.string().optional(),
});

export const refinerInfluenceSchema = z.object({
  entityId: z.string().min(1),
  entityType: entityTypeSchema,
  reasonType: z.string().min(1),
  reasoning: z.string().optional(),
  confidence: strictConfidenceScoreSchema.nullable().optional(),
});

export const replaceOpSchema = z.object({
  type: z.enum(['replace', 'insert', 'delete']).optional(),
  target: z.string().min(1).optional(),
  text: z.string(),
});

// Schema for UI element influences (uses same structure as influence schema)
const uiElementInfluenceSchema = influenceSchema;

// Schema for UI elements in LLM_QUESTIONS node responses, we only expect
// textarea when querying the llm
export const uiElementSchema = z.object({
  id: z.string().describe('Unique identifier for the UI element'),
  type: z
    .enum(['textarea'])
    .default('textarea')
    .catch('textarea')
    .describe('textarea'),
  label: z.string().describe('Display label for the UI element'),
  placeholder: z
    .string()
    .nullable()
    .optional()
    .describe('Optional placeholder text for the input field'),
  required: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether this field is required for form submission'),
  multiline: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether the textarea should support multiple lines'),
  influences: z
    .array(uiElementInfluenceSchema)
    .describe(
      'Array of artifacts that influenced the creation of this UI element',
    ),
});

// Schema for LLM_QUESTIONS nodes that only generate clarifying questions
// without entity classification (used early in flows before classification is meaningful)
export const questionsOnlyResponseSchema = z.object({
  type: z.literal('QUESTIONS'),
  response: z
    .string()
    .describe(
      'Short preamble or acknowledgment for the user; do not restate any questions included in uiElements',
    ),
  detectedIntent: z.string().describe('assess_current_implementation'),
  intentConfidence: numericScoreSchema.describe('0.85'),
  reasoning: z
    .string()
    .describe('Reasoning for the intent detection')
    .nullable()
    .optional(),
  uiElements: z
    .array(uiElementSchema)
    .describe('Array of UI elements for user interaction'),
  insights: z.array(artifactInsightSchema).nullable().optional(),
});

export const clarificationProviderResponseSchema =
  questionsOnlyResponseSchema.omit({ type: true });
export type ClarificationProviderResponse = z.infer<
  typeof clarificationProviderResponseSchema
>;

// Schema for LLM_QUESTIONS nodes that generate UI questions with entity classification
export const gatherNodeResponseSchema = entityClassificationSchema.extend({
  type: z.literal('QUESTIONS'),
  response: z
    .string()
    .describe(
      'Short preamble or acknowledgment for the user; do not restate any questions included in uiElements',
    ),
  detectedIntent: z.string().describe('assess_current_implementation'),
  intentConfidence: numericScoreSchema.describe('0.85'),
  reasoning: z
    .string()
    .describe('Reasoning for the intent detection')
    .nullable()
    .optional(),
  uiElements: z
    .array(uiElementSchema)
    .describe('Array of UI elements for user interaction'),
  insights: z.array(artifactInsightSchema).nullable().optional(),
});

// Schema for routing decisions based on user responses
export const routingDecisionSchema = z.object({
  nextNodeId: z.string().describe('The ID of the next node to route to'),
  reasoning: z
    .string()
    .default('')
    .describe('Explanation of why this routing decision was made'),
  confidence: confidenceScoreSchema.describe('Confidence in the decision'),
});

export const technicalAnalysisSchema = z.object({
  analysis: z
    .object({
      identifiedTechnologies: z
        .array(z.string())
        .describe('List of technologies mentioned or recommended'),
      integrationComplexity: z
        .enum(['low', 'medium', 'high'])
        .default('medium')
        .catch('medium')
        .describe('Assessment of integration complexity level'),
      potentialChallenges: z
        .array(
          z.object({
            area: z
              .string()
              .describe('Area or domain where the challenge exists'),
            description: z
              .string()
              .describe('Detailed description of the potential challenge'),
            mitigation: z
              .string()
              .describe(
                'Suggested approach to mitigate or solve the challenge',
              ),
          }),
        )
        .describe(
          'Array of potential technical challenges and their mitigations',
        ),
      recommendations: z
        .array(z.string())
        .describe('List of technical recommendations based on the analysis'),
    })
    .describe('Comprehensive technical analysis of the project'),
  feedback: z
    .string()
    .describe('Summary feedback message to present to the user'),
  conversationSummary: z
    .string()
    .describe('Brief summary of the technical conversation'),
  detectedIntent: z
    .string()
    .describe('Primary intent detected from the technical analysis'),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score for the detected intent (0-1)',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the analysis decisions'),
});

export const addressConcernsResponseSchema = gatherNodeResponseSchema.merge(
  technicalAnalysisSchema,
);

export const initiativeGenerationSchema = z.object({
  feedback: z
    .string()
    .describe('Summary feedback message about the generated initiatives'),
  initiatives: z
    .array(
      z.object({
        id: z.string().describe('Unique identifier for the initiative'),
        title: z.string().describe('Concise title for the initiative'),
        description: z
          .string()
          .describe('Detailed description of what the initiative entails'),
        status: z
          .string()
          .describe(
            'Current status of the initiative - e.g. "draft", "pending"',
          ),
        priority: z
          .enum(['low', 'medium', 'high', 'critical'])
          .default('medium')
          .catch('medium')
          .describe('Priority level of the initiative'),
        tags: z
          .array(z.string())
          .describe('Array of tags for categorizing the initiative'),
        estimatedEffort: z
          .enum(['small', 'medium', 'large'])
          .default('medium')
          .catch('medium')
          .describe(
            'Estimated effort level required to complete the initiative',
          ),
        dependencies: z
          .array(z.string())
          .describe(
            'List of dependencies or prerequisites for this initiative',
          ),
      }),
    )
    .describe('Array of generated project initiatives'),
  summary: z
    .object({
      totalInitiatives: z
        .number()
        .describe('Total number of initiatives generated'),
      estimatedTimeline: z
        .string()
        .describe('Overall estimated timeline for all initiatives'),
      criticalPath: z
        .array(z.string())
        .describe(
          'Array of critical path initiative IDs that determine project timeline',
        ),
    })
    .describe('Summary statistics and timeline information'),
  conversationSummary: z
    .string()
    .describe(
      'Brief summary of the conversation that led to these initiatives',
    ),
  interactionComplete: z
    .boolean()
    .describe('Whether the initiative generation process is complete'),
  detectedIntent: z.string().describe('Primary intent detected for next steps'),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score for the detected intent (0-1)',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the generation decisions'),
});

export const teamSetupSchema = z.object({
  feedback: z
    .string()
    .describe('Feedback message about the team setup process'),
  selectedMembers: z
    .array(z.string())
    .describe('Array of selected team member identifiers'),
  additionalEmails: z
    .array(z.string())
    .describe('Additional email addresses to invite to the project'),
  detectedIntent: z
    .string()
    .describe('Detected intent for team setup completion'),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score for the detected intent (0-1)',
  ),
  conversationSummary: z
    .string()
    .describe('Summary of the team setup conversation'),
});

// Initiative generation response used in onboarding flows
export const initiativeGenerationResponseSchema = z.object({
  type: z
    .literal('INITIATIVES')
    .describe('Response type identifier for initiative generation'),
  response: z
    .string()
    .describe('Main response message explaining the generated initiatives'),
  title: z
    .string()
    .nullable()
    .optional()
    .describe('Optional title for the initiative generation results'),
  detectedIntent: z
    .string()
    .describe('Primary intent detected for next workflow step'),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score for the detected intent (0-1)',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the initiative generation decisions'),
  initiatives: z
    .array(
      z.object({
        name: z.string().describe('Name of the initiative'),
        description: z
          .string()
          .describe('Brief description of the initiative purpose'),
        details: z
          .string()
          .describe('Detailed explanation of initiative implementation'),
        acceptanceCriteria: z
          .string()
          .describe(
            'Specific criteria that define when the initiative is complete',
          ),
        estimatedEffort: z
          .enum(['small', 'medium', 'large'])
          .default('medium')
          .catch('medium')
          .describe('Estimated effort required to complete this initiative'),
        priority: z
          .enum(['low', 'medium', 'high', 'critical'])
          .default('medium')
          .catch('medium')
          .describe('Priority level for this initiative'),
        tags: z
          .array(z.string())
          .describe('Tags for categorizing and organizing the initiative'),
        reasoning: z
          .string()
          .default('')
          .describe('Explanation of why this initiative was generated'),
        influences: z
          .array(influenceSchema)
          .describe('Entities that influenced the creation of this initiative'),
      }),
    )
    .describe('Array of generated initiatives with detailed specifications'),
});

export type InitiativeGenerationResponse = z.infer<
  typeof initiativeGenerationResponseSchema
>;

// Feature generation response used in onboarding flows.
// Produces a two-level hierarchy in a single pass: top-level features each
// carrying their own children, plus a narrative describing the shape of the
// overall proposal. The narrative is generated alongside the hierarchy so the
// wording reflects the actual bucketing.
const featureGenerationChildSchema = z.object({
  candidateId: z
    .string()
    .optional()
    .describe(
      'Retain the repository candidate identity for continuing Features; omit for additions.',
    ),
  name: z.string().describe('Name of the child feature'),
  description: z.string().describe('What this child feature delivers'),
  tag: featureTagSchema.describe(
    'Coarse-grained classification of what this child feature delivers. ' +
      'Required. Allowed values: product (user-facing product capability), ' +
      'frontend (client/UI delivery), backend (server/API/data), infra ' +
      '(platform, deployment, observability), design (design-system or UX ' +
      'research), AI (AI/agent-shaped delivery: prompts, agent ' +
      'orchestration, runners). Pick the tag that best matches what the ' +
      'feature delivers in the context of its top-level parent.',
  ),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'])
    .default('medium')
    .catch('medium')
    .describe('Priority level for this child feature'),
  reasoning: z
    .string()
    .default('')
    .describe('Explanation of why this child feature was generated'),
  influences: z
    .array(influenceSchema)
    .default([])
    .describe('Entities that influenced the creation of this child feature'),
});

const featureGenerationTopLevelSchema = z.object({
  candidateId: z
    .string()
    .optional()
    .describe(
      'Retain the repository candidate identity for continuing Features; omit for additions.',
    ),
  name: z.string().describe('Name of the top-level feature'),
  description: z.string().describe('What this top-level feature delivers'),
  tag: featureTagSchema.describe(
    'Coarse-grained classification of what this top-level feature delivers. ' +
      'Required. Allowed values: product (user-facing product capability), ' +
      'frontend (client/UI delivery), backend (server/API/data), infra ' +
      '(platform, deployment, observability), design (design-system or UX ' +
      'research), AI (AI/agent-shaped delivery: prompts, agent ' +
      'orchestration, runners). Pick the tag that best matches the ' +
      'top-level deliverable.',
  ),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'])
    .default('medium')
    .catch('medium')
    .describe('Priority level for this top-level feature'),
  reasoning: z
    .string()
    .default('')
    .describe('Explanation of why this top-level feature was generated'),
  influences: z
    .array(influenceSchema)
    .default([])
    .describe(
      'Entities that influenced the creation of this top-level feature',
    ),
  children: z
    .array(featureGenerationChildSchema)
    .min(2, {
      message:
        'Every top-level feature must group at least two meaningful children — earn-your-spot rule.',
    })
    .describe(
      'Child features grouped under this top-level; must contain at least two entries.',
    ),
});

export const featureGenerationResponseSchema = z.object({
  type: z
    .literal('FEATURES')
    .describe('Response type identifier for feature generation'),
  response: z
    .string()
    .describe('Main response message explaining the generated features'),
  detectedIntent: z
    .string()
    .describe('Primary intent detected for next workflow step'),
  intentConfidence: numericScoreSchema.describe(
    'Confidence score for the detected intent (0-1)',
  ),
  narrative: z
    .string()
    .min(1, { message: 'Narrative cannot be empty.' })
    .describe(
      'Short narrative describing the shape of the project as bucketed into the emitted top-level features (e.g. "Your project delivers two things: Widgets and Widget Factory…").',
    ),
  topLevels: z
    .array(featureGenerationTopLevelSchema)
    .min(1, {
      message: 'Must emit at least one top-level feature.',
    })
    .describe(
      'Ordered list of top-level features. Number of top-levels is shaped by the project, not hard-capped; a single-product project yields one top-level while a multi-product project yields several.',
    ),
});

export type FeatureGenerationResponse = z.infer<
  typeof featureGenerationResponseSchema
>;

export const conversationResponseSchema = gatherNodeResponseSchema.extend({
  suggestedActions: z
    .array(
      z.object({
        action: z
          .enum(['gather_more_info', 'create_adr', 'end_conversation'])
          .describe('Suggested action type'),
        description: z
          .string()
          .describe('Human-readable description of the suggested action'),
      }),
    )
    .describe('Array of suggested next actions for the user'),
});

// Initiative refinement conversational response schema
export const initiativeRefinementConversationalResponseSchema = z.object({
  response: z
    .string()
    .min(1, 'Response cannot be empty')
    .describe('Conversational response during initiative refinement'),
  needsFollowUp: z
    .boolean()
    .nullable()
    .optional()
    .default(false)
    .describe('Whether additional follow-up questions are needed'),
  clarification: z
    .string()
    .nullable()
    .optional()
    .describe('Optional clarification request for unclear user input'),
});

// Initiative refinement finalize schema
export const initiativeRefinementFinalizeSchema = z.object({
  detectedIntent: z
    .enum(['confirm_changes', 'make_more_changes', 'cancel_changes', 'default'])
    .describe('User intent for finalizing initiative changes'),
  response: z
    .string()
    .describe('Response message about the finalization process'),
  refinedInitiative: z
    .object({
      name: z.string().describe('Updated name of the initiative'),
      description: z
        .string()
        .nullable()
        .optional()
        .describe('Updated description of the initiative'),
      priority: z
        .enum(['low', 'medium', 'high', 'critical'])
        .nullable()
        .optional()
        .describe('Updated priority level'),
      tags: z
        .array(z.string())
        .nullable()
        .optional()
        .describe('Updated tags for the initiative'),
      changes: z
        .array(
          z.object({
            field: z.string().describe('Name of the field that was changed'),
            oldValue: z
              .union([z.string(), z.array(z.string()), z.null()])
              .describe('Previous value of the field'),
            newValue: z
              .union([z.string(), z.array(z.string()), z.null()])
              .describe('New value of the field'),
            reason: z.string().describe('Reason for making this change'),
          }),
        )
        .describe('Array of specific changes made to the initiative'),
    })
    .describe('The refined initiative with all changes applied'),
  changesSummary: z
    .string()
    .describe('Human-readable summary of all changes made'),
  uiElements: z
    .array(
      z.object({
        id: z.string().describe('Unique identifier for the UI element'),
        type: z
          .string()
          .describe('Type of UI element (e.g., input, select, textarea)'),
        label: z.string().describe('Display label for the UI element'),
        placeholder: z
          .string()
          .nullable()
          .optional()
          .describe('Placeholder text for input elements'),
        required: z
          .boolean()
          .nullable()
          .optional()
          .describe('Whether the field is required'),
        options: z
          .array(z.string())
          .nullable()
          .optional()
          .describe('Options for select elements'),
      }),
    )
    .nullable()
    .optional()
    .describe('Optional UI elements for additional user input'),
});

// Initiative refinement gather feedback schema
export const initiativeRefinementGatherFeedbackSchema =
  gatherNodeResponseSchema.extend({
    processedFeedback: z
      .object({
        changes_requested: z
          .string()
          .nullable()
          .describe('Specific changes requested by the user'),
        priority_adjustment: z
          .string()
          .nullable()
          .describe('Requested adjustments to initiative priority'),
        concerns: z
          .string()
          .nullable()
          .describe('User concerns about the initiative'),
        additional_requirements: z
          .string()
          .nullable()
          .describe('Additional requirements mentioned by user'),
        sentiment: z
          .string()
          .nullable()
          .describe(
            'Overall sentiment of the feedback (positive/negative/neutral)',
          ),
      })
      .describe('Structured analysis of user feedback'),
  });

// Initiative refinement classification schema creator
export const createInitiativeRefinementClassificationSchema = (
  currentLevel: string,
) => {
  const baseIntents = [
    'edit_content',
    'general_response',
    'accept_feedback',
    'reject_feedback',
  ];

  let levelSpecificIntents: string[];
  switch (currentLevel) {
    case 'description':
    case 'details':
      levelSpecificIntents = [
        'approve_level',
        'approve_with_edit',
        ...baseIntents,
      ];
      break;
    case 'acceptanceCriteria':
      levelSpecificIntents = ['finalize', ...baseIntents];
      break;
    default:
      levelSpecificIntents = [
        'approve_level',
        'approve_with_edit',
        'finalize',
        ...baseIntents,
      ];
  }

  return z.object({
    detectedIntent: z.enum(levelSpecificIntents as [string, ...string[]]),
    intentConfidence: confidenceScoreSchema,
    reasoning: z.string().nullable().optional(),
  });
};

// Task refinement classification schema
export const taskRefinementClassifyResponseSchema = z.object({
  detectedIntent: z
    .enum([
      'approve_level',
      'approve_with_edit',
      'edit_content',
      'finalize',
      'general_response',
      'accept_feedback',
      'reject_feedback',
    ])
    .describe('Detected user intent for task refinement flow'),
  intentConfidence: confidenceScoreSchema.describe(
    'Confidence score for the detected intent',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the classification decision'),
});

// Shared recovery response schema for flow recovery nodes
export const flowRecoveryResponseSchema = gatherNodeResponseSchema.extend({
  suggestedAction: z
    .enum(['retry_previous', 'start_over', 'conversation', 'end'])
    .describe('Suggested action for flow recovery'),
});

// ADR generation schema and types
export const adrQuestionsResponseSchema = gatherNodeResponseSchema.extend({
  questions: z
    .array(z.string())
    .max(5)
    .describe('Array of clarifying questions to ask the user'),
  currentUnderstanding: z
    .object({
      context: z
        .string()
        .nullable()
        .describe('Current understanding of the decision context'),
      decision: z
        .string()
        .nullable()
        .describe('Current understanding of the decision to be made'),
      options: z.array(z.string()).describe('Known options or alternatives'),
      constraints: z
        .array(z.string())
        .describe('Known constraints or limitations'),
    })
    .describe('Summary of current understanding before asking questions'),
});

export const adrResponseSchema = z.object({
  title: z.string().describe('Title of the Architecture Decision Record'),
  status: z
    .enum(['Proposed', 'Accepted', 'Deprecated', 'Superseded'])
    .describe('Current status of the ADR'),
  context: z.string().describe('Background context that led to this decision'),
  decision: z.string().describe('The actual architectural decision made'),
  alternatives: z
    .array(
      z.object({
        name: z.string().describe('Name of the alternative approach'),
        description: z.string().describe('Description of the alternative'),
        pros: z.array(z.string()).describe('Advantages of this alternative'),
        cons: z.array(z.string()).describe('Disadvantages of this alternative'),
      }),
    )
    .describe('Alternative approaches that were considered'),
  consequences: z
    .object({
      positive: z
        .array(z.string())
        .describe('Positive consequences of the decision'),
      negative: z
        .array(z.string())
        .describe('Negative consequences or trade-offs'),
      risks: z
        .array(z.string())
        .describe('Identified risks from this decision'),
    })
    .describe('Consequences and impacts of the decision'),
  constraints: z
    .array(z.string())
    .describe('Constraints that influenced the decision'),
  assumptions: z
    .array(z.string())
    .describe('Assumptions made when making the decision'),
  implementation: z
    .object({
      effort: z
        .enum(['Low', 'Medium', 'High'])
        .describe('Implementation effort level'),
      timeline: z.string().describe('Expected timeline for implementation'),
      dependencies: z
        .array(z.string())
        .describe('Dependencies required for implementation'),
    })
    .describe('Implementation details for the decision'),
  metadata: z
    .object({
      authors: z.array(z.string()).describe('Authors of the ADR'),
      reviewers: z
        .array(z.string())
        .optional()
        .describe('Reviewers of the ADR'),
      created: z.string().describe('Creation date'),
      lastModified: z.string().describe('Last modification date'),
    })
    .describe('Metadata about the ADR document'),
});

export type AdrResponse = z.infer<typeof adrResponseSchema>;

// RFC question and generation schemas
export const rfcQuestionsResponseSchema = gatherNodeResponseSchema.extend({
  questions: z.array(z.string()).max(5),
  currentUnderstanding: z.object({
    problemStatement: z.string().nullable(),
    proposal: z.string().nullable(),
    motivation: z.string().nullable(),
    designDetails: z.array(z.string()),
    alternatives: z.array(z.string()),
    impact: z.string().nullable(),
  }),
});

export const rfcResponseSchema = z.object({
  title: z.string(),
  status: z.enum(['Draft', 'In Review', 'Accepted', 'Rejected', 'Implemented']),
  summary: z.string(),
  problemStatement: z.string(),
  proposal: z.string(),
  motivation: z.string(),
  detailedDesign: z.object({
    overview: z.string(),
    implementation: z.array(
      z.object({
        step: z.string(),
        description: z.string(),
        technical_details: z.string().optional(),
      }),
    ),
    apiChanges: z.array(z.string()),
    dataChanges: z.array(z.string()),
  }),
  alternatives: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      reasoning: z.string().default(''),
    }),
  ),
  impact: z.object({
    users: z.array(z.string()),
    systems: z.array(z.string()),
    processes: z.array(z.string()),
    migration: z.string().nullable(),
  }),
  risks: z.array(
    z.object({
      risk: z.string(),
      impact: z.enum(['Low', 'Medium', 'High']),
      mitigation: z.string(),
    }),
  ),
  timeline: z.object({
    phases: z.array(
      z.object({
        phase: z.string(),
        duration: z.string(),
        deliverables: z.array(z.string()),
      }),
    ),
    totalEstimate: z.string(),
  }),
  metadata: z.object({
    authors: z.array(z.string()),
    reviewers: z.array(z.string()).optional(),
    created: z.string(),
    lastModified: z.string(),
  }),
});

export type RfcResponse = z.infer<typeof rfcResponseSchema>;

export const rfcConversationResponseSchema = gatherNodeResponseSchema.extend({
  message: z
    .string()
    .describe(
      'Conversational response message (duplicate of response for backward compatibility)',
    ),
  suggestedActions: z
    .array(
      z.object({
        action: z
          .enum(['gather_more_info', 'create_rfc', 'end_conversation'])
          .describe('Suggested action type'),
        description: z.string().describe('Description of the suggested action'),
      }),
    )
    .describe('Array of suggested next actions for the user'),
  confidence: confidenceScoreSchema.describe(
    'Confidence level in the response',
  ),
});

export const rfcClassificationResponseSchema = z.object({
  detectedIntent: z
    .enum(['need_questions', 'generate_rfc', 'conversation'])
    .describe('Detected intent for RFC flow direction'),
  intentConfidence: confidenceScoreSchema.describe(
    'Confidence score for the detected intent',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the classification decision'),
  inputAnalysis: z
    .object({
      hasProposal: z
        .boolean()
        .describe('Whether the input contains a proposal'),
      hasDescription: z
        .boolean()
        .describe('Whether the input has sufficient description'),
      sufficiencyLevel: z
        .enum(['insufficient', 'partial', 'sufficient'])
        .describe('Assessment of input completeness for RFC creation'),
    })
    .describe(
      'Analysis of the input quality and completeness for RFC generation',
    ),
});

// Task generation schemas
export const taskStubGenerationResponseSchema = z.object({
  stubs: z
    .array(
      z.object({
        title: z.string().describe('Concise title for the stub'),
        shortDescription: z
          .string()
          .describe('1-2 sentence description of the stub'),
        reasoning: z
          .string()
          .nullable()
          .optional()
          .describe('Optional rationale included by the LLM'),
        influences: z.array(influenceSchema).nullable().optional(),
      }),
    )
    .describe('Array of generated task stubs'),
  response: z
    .string()
    .describe('Response message explaining the stub suggestions'),
});

export const taskGenerationResponseSchema = z.object({
  tasks: z
    .array(
      z
        .object({
          taskType: z
            .nativeEnum(TaskSummaryTaskTypeEnum)
            .default(TaskSummaryTaskTypeEnum.STANDARD)
            .describe('Task profile type (STANDARD or BUG)'),
          title: z.string().describe('Concise title for the generated task'),
          description: z
            .string()
            .describe('Detailed description of what the task involves'),
          acceptanceCriteria: z
            .string()
            .optional()
            .describe(
              'Specific criteria that define when this task is complete (STANDARD tasks only)',
            ),
          influences: z
            .array(influenceSchema)
            .nullable()
            .optional()
            .default([]),
        })
        .superRefine((task, ctx) => {
          if (
            task.taskType === TaskSummaryTaskTypeEnum.STANDARD &&
            !task.acceptanceCriteria?.trim()
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                'STANDARD tasks require non-empty acceptanceCriteria content',
              path: ['acceptanceCriteria'],
            });
          }

          if (
            task.taskType === TaskSummaryTaskTypeEnum.BUG &&
            task.acceptanceCriteria !== undefined &&
            task.acceptanceCriteria.trim().length > 0
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'BUG tasks must not include acceptanceCriteria',
              path: ['acceptanceCriteria'],
            });
          }
        }),
    )
    .describe('Array of generated tasks'),
  response: z
    .string()
    .describe('Response message explaining the generated tasks'),
});

export const taskDependencyInferenceResponseSchema = z.object({
  dependencies: z
    .array(
      z.object({
        dependentTaskId: z
          .string()
          .describe('Task ID that depends on another task'),
        dependencyTaskId: z
          .string()
          .describe('Task ID that must be completed first'),
        relationType: z
          .enum(['DEPENDS_ON', 'BLOCKS'])
          .describe('Dependency relationship type'),
        reason: z
          .string()
          .nullable()
          .optional()
          .describe('Optional rationale for the dependency'),
      }),
    )
    .describe('Array of inferred task dependencies'),
});

export const designDocGenerationResponseSchema = z.object({
  designDoc: z.object({
    summary: z
      .string()
      .nullable()
      .optional()
      .describe('Optional summary for the generated design document'),
    sections: z
      .array(
        z.object({
          key: z
            .string()
            .describe('Section key identifier (e.g., context, decision)'),
          order: z
            .number()
            .int()
            .describe('Ordering index for rendering sections'),
          content: z.string().describe('Markdown content for the section'),
        }),
      )
      .min(1)
      .describe('Array of generated design doc sections'),
  }),
  response: z
    .string()
    .describe('Response message explaining the generated design doc'),
});

export const taskGenerationConversationResponseSchema = z.object({
  response: z
    .string()
    .describe('Conversational response during task generation flow'),
});

export const taskGenerationClassificationResponseSchema = z.object({
  detectedIntent: z
    .enum(['generate_tasks', 'conversation'])
    .describe('Detected intent for task generation flow direction'),
  intentConfidence: confidenceScoreSchema.describe(
    'Confidence score for the detected intent',
  ),
  reasoning: z
    .string()
    .nullable()
    .optional()
    .describe('Optional reasoning for the classification decision'),
});

// Shared polite redirect schema for consistent validation
export const politeRedirectResponseSchema = z.object({
  reasoning: z
    .string()
    .describe('Explanation for redirecting the user conversation'),
});
