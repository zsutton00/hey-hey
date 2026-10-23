import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { QuestionsSystemMessageData, UIHints } from 'src/generated';
import { ClaudeModel, LLMProviderName } from '../../../services/llm/llm-shared';
import { StandardPlaceholders } from '../../../services/llm/placeholders';
import { LlmQuestionsNodeBase } from '../base/';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  NodeResult,
  OnboardingFlowContext,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import {
  artifactInsightSchema,
  entityClassificationSchema,
  uiElementSchema,
} from '../../utils/shared-schemas';

// Node-specific schema: early discovery has no entities to reference,
// so influences are stripped from UI elements and insights.
const discoveryUiElementSchema = uiElementSchema.omit({ influences: true });
const discoveryInsightSchema = artifactInsightSchema.omit({ influences: true });

const nativeCapabilityKeySchema = z.enum([
  'initiatives',
  'features',
  'goals',
  'plans',
  'design_docs',
  'services',
  'tasks',
  'bugs',
  'contracts',
  'workflows',
  'agent_sessions',
]);

const projectContextSchema = z.object({
  whatUserWantsToDo: z
    .string()
    .describe('What the user is trying to do or accomplish in their domain'),
  whatUserWantsToBuild: z
    .string()
    .nullable()
    .describe(
      'The concrete product, system, or capability the user wants to build, or null when the project is primarily work to organize',
    ),
  nativeCapabilities: z
    .array(
      z.object({
        capability: nativeCapabilityKeySchema.describe(
          'A built-in Hey Hey capability relevant to the user goal',
        ),
        rationale: z
          .string()
          .describe('How the built-in capability can help with the user goal'),
      }),
    )
    .min(1)
    .describe(
      'Relevant built-in Hey Hey capabilities; select them instead of inventing custom types',
    ),
});

const discoveryResponseBaseSchema = entityClassificationSchema.extend({
  type: z.literal('QUESTIONS'),
  response: z
    .string()
    .describe(
      'Short preamble or acknowledgment for the user; do not restate any questions included in uiElements',
    ),
  detectedIntent: z
    .string()
    .describe(
      'Use needs_more_information while asking follow-up questions, ready_to_proceed when discovery is sufficient, implementation_assessment for an existing implementation that needs assessment, technical_project for technical architecture planning, or not_applicable when the project is outside platform capabilities',
    ),
  intentConfidence: z.number().describe('0.85'),
  reasoning: z
    .string()
    .describe('Reasoning for the intent detection')
    .nullable()
    .optional(),
  uiElements: z
    .array(discoveryUiElementSchema)
    .describe('Array of UI elements for user interaction'),
  insights: z.array(discoveryInsightSchema).nullable().optional(),
  projectContext: projectContextSchema
    .optional()
    .describe(
      'The distinction between what the user wants to do, what they want to build, and how built-in Hey Hey capabilities can help; include when discovery is ready to proceed',
    ),
});

// Keep the schema used to process the model response identical to the schema
// sent to the structured-output provider. These legacy classification fields
// are not part of this node's response contract.
export const discoveryResponseSchema = discoveryResponseBaseSchema.omit({
  subfacets: true,
  selectedExistingSubfacetNames: true,
  proposedNewSubfacetName: true,
  proposedNewSubfacetConfidence: true,
  proposedNewSubfacetRationale: true,
});

export type OnboardingDiscoveryResponse = z.infer<
  typeof discoveryResponseSchema
>;

function formatNativeCapabilityLabel(capability: string): string {
  return capability
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function buildReadyDiscoveryResponse(
  response: string,
  projectContext: z.infer<typeof projectContextSchema>,
): string {
  const nativeCapabilitySummary = projectContext.nativeCapabilities
    .map(
      ({ capability, rationale }) =>
        `- ${formatNativeCapabilityLabel(capability)}: ${rationale}`,
    )
    .join('\n');

  return [
    response,
    '',
    'What you want to do',
    projectContext.whatUserWantsToDo,
    ...(projectContext.whatUserWantsToBuild
      ? ['', 'What you want to build', projectContext.whatUserWantsToBuild]
      : []),
    '',
    'How Hey Hey can help',
    nativeCapabilitySummary,
  ].join('\n');
}

/**
 * Onboarding Analyze Project Concept Node - bounded initial feature discovery.
 *
 * This node gathers only the context needed for the existing onboarding
 * feature-generation path. Materialization remains on that path; this node
 * does not create or propose new work-item types.
 */
@Injectable()
export class OnboardingAnalyzeProjectConceptNode extends LlmQuestionsNodeBase<OnboardingFlowContext> {
  readonly id = ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT;
  readonly title = 'Analyze Project Concept';

  startMessage = 'Thinking about your project concept...';

  readonly uiHints: UIHints = {
    expectedElements: [
      {
        type: 'textarea',
        count: 4,
      },
    ],
    estimatedCount: 4,
  };

  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_5_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    systemPromptTemplate: `You are conducting the final, bounded discovery pass for an onboarding project.

The user has already provided project context in the conversation history:
${StandardPlaceholders.CONVERSATION_HISTORY.insert()}

Your sole purpose is to gather the information needed to distinguish and describe the project's initial user-facing feature structure. A feature describes a capability or outcome users recognize, not an implementation detail. Infer the appropriate Hey Hey structure internally from the user's answers; do not ask the user which entity types to track or ask them to define Hey Hey's structure.

## Discovery questions

Review the full history before asking anything. Skip information the user already supplied and do not repeat questions from the earlier onboarding pass. Ask only the smallest set of ordinary-language follow-ups needed to clarify:

- Who are the intended users, and what needs or problems should the product address?
- What core capabilities or user workflows should the initial feature structure distinguish?
- What is the project's maturity, including whether anything already exists that affects the feature boundaries?
- What material constraints would change the scope or shape of those initial features?

Questions must be progressive, non-repetitive, concise, and conversational. Ask only feature-defining clarification questions. Do not ask about roadmap dates, milestones, phases, sequencing, prioritization, resourcing, release planning, delivery estimates, or other delivery-planning details. Do not ask the user to choose among Goals, Plans, Features, Tasks, or any other entity types. This is the final discovery pass in the existing one-or-two-round onboarding limit: ask at most four follow-up questions in this response and do not start a third round. If the context is sparse at the end of the allowed pass, make the most defensible summary from the facts provided and surface uncertainty in the response instead of fabricating details.

## Response format

Use the analyze_project_concept tool and include:

- type: "QUESTIONS"
- response: a short acknowledgment or the feature-discovery questions for the user. When ready, the processor appends the existing concise project summary sections.
- detectedIntent: use "needs_more_information" while asking the final follow-ups, "ready_to_proceed" when the context is sufficient for the existing feature/artifact path, "implementation_assessment" when an existing implementation needs assessment, "technical_project" when technical architecture planning is needed, or "not_applicable" when the project is outside platform capabilities.
- intentConfidence: a number between 0 and 1 indicating your confidence.
- reasoning: an optional explanation of the intent detection.
- insights: optional project insights gathered so far.
- projectContext: required whenever detectedIntent is "ready_to_proceed" or "technical_project". This is an internal synthesis for the existing response schema: set whatUserWantsToBuild to null when the work itself is the goal, and infer relevant existing Hey Hey capabilities in nativeCapabilities from the conversation without asking the user to select them.

Do not invent custom work-item types, definitions, or lifecycle fields. Do not ask questions whose answers are already in the conversation.`,

    responseSchema: discoveryResponseSchema,
    useToolCallSchema: true,
    toolName: 'onboarding_analyze_project_concept',
    temperature: 0.7,
  };

  readonly routingConfig = {
    description: `Review the complete conversation history to understand:
- what the user wants to do or accomplish,
- whether they want to build a separate product, system, or capability,
- which native Hey Hey capabilities can organize the work,
- what has already been answered, and
- whether existing implementation assessment or technical architecture planning is needed.`,
    placeholders: [StandardPlaceholders.CONVERSATION_HISTORY],
  };

  async processLlmResponse(
    systemMessageData:
      | IntermediateSystemMessageData
      | OnboardingDiscoveryResponse,
    userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<{
    modifiedResult: QuestionsSystemMessageData;
  }> {
    const parsed = discoveryResponseSchema.parse(systemMessageData);
    const isReadyToProceed =
      parsed.detectedIntent === 'ready_to_proceed' ||
      parsed.detectedIntent === 'technical_project';

    if (isReadyToProceed && !parsed.projectContext) {
      throw new Error(
        'Onboarding discovery marked itself ready without project context.',
      );
    }

    const modifiedResult: QuestionsSystemMessageData = {
      type: 'QUESTIONS',
      response:
        isReadyToProceed && parsed.projectContext
          ? buildReadyDiscoveryResponse(parsed.response, parsed.projectContext)
          : parsed.response,
      detectedIntent: parsed.detectedIntent,
      intentConfidence: parsed.intentConfidence,
      uiElements: parsed.uiElements.map((element) => ({
        id: element.id,
        type: element.type,
        label: element.label,
        ...(element.placeholder != null
          ? { placeholder: element.placeholder }
          : {}),
        ...(element.required != null ? { required: element.required } : {}),
        ...(element.multiline != null ? { multiline: element.multiline } : {}),
      })),
      ...(parsed.reasoning !== undefined
        ? { reasoning: parsed.reasoning ?? undefined }
        : {}),
    };

    // The first generation presents questions and must remain paused. The
    // triggering message can belong to the previous node, so userMessage alone
    // cannot distinguish the first generation from the response phase.
    const currentNodeExecution = tracker.getContext().currentNodeExecution;
    const isInitialGeneration =
      (currentNodeExecution?.nodeId === this.id &&
        currentNodeExecution.questionsGenerated === false) ||
      (currentNodeExecution === undefined && userMessage === undefined);

    if (
      isInitialGeneration &&
      parsed.detectedIntent === 'needs_more_information'
    ) {
      return { modifiedResult };
    }

    if (parsed.detectedIntent === 'needs_more_information') {
      throw new Error(
        'Onboarding discovery reached its final round without enough context to route.',
      );
    }

    return { modifiedResult };
  }

  /**
   * This node is processed by the LLM system. Execute is not called directly
   * for LLM_QUESTIONS nodes.
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'OnboardingAnalyzeProjectConceptNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by the LLM system.',
    );
  }

  /** Compensation strategy for analysis failures. */
  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    if (errorClassification.type === 'TIMEOUT' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 6000,
        reason: 'Project analysis timeout, retrying with extended delay',
      };
    }

    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 10000,
        reason: 'Project analysis rate limited, extended delay',
      };
    }

    return { action: 'FAIL' };
  }
}
