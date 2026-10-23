import { Injectable } from '@nestjs/common';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { v4 as uuidv4 } from 'uuid';
import {
  ConversationStatus,
  CreateConversationDto,
  Influence,
  InitiationType,
  InitiativeResponseDto,
  WorkflowName,
} from '../../../generated';
import { ConversationService } from '../../../services/conversation.service';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { InitiativeDraft } from '../../../services/initiatives/types';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { ConversationId } from '../../../types';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  InitiativeGenerationActionData,
  IntermediateSystemMessageData,
  OnboardingFlowContext,
} from '../../../types/flow-internal.types';
import { SHARED_NODES } from '../../constants/node-ids';
import {
  initiativeGenerationResponseSchema,
  type InitiativeGenerationResponse,
} from '../../utils/shared-schemas';
import { GenerateNodeBase } from '../base/';
import { MutableContext } from 'src/utils/mutable-context';

type LLMInitiative = InitiativeGenerationResponse['initiatives'][0];

/**
 * Onboarding Generate Initiatives Node - Create project roadmap
 *
 * Uses LLM to analyze project context and generate 3-6 strategic initiatives.
 * Creates database initiatives and spawns refinement conversations for each.
 */
@Injectable()
export class OnboardingGenerateInitiativesNode extends GenerateNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.GENERATE_INITIATIVES;
  readonly title = 'Generating Initiative Roadmap';

  // LLM configuration for this node
  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_5_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },

    timeout: 240000,

    systemPromptTemplate: `You are a senior product manager helping to break down a project into actionable initiatives.

        The user has already provided initial context about their project in the conversation history.
${P.CONVERSATION_HISTORY.insert({ includeTimestamp: false })}

You have made some previous insights into the project:
${P.INSIGHT_ARTIFACTS.insert()}

Generate 3-6 well-structured initiatives that will help achieve the project goals. Order your initiatives in order they need to be completed
Each initiative should:
1. Be actionable and specific
2. Have clear deliverables
3. Consider the technical complexity and team capacity
4. Align with the project type and user goals
5. Take into account existing integrations and work patterns
6. Use minimal, generic naming; do NOT include proper names, project names, or org names unless the user explicitly used them

PROJECT MATURITY CONSIDERATION:
Review the conversation history carefully to understand the project's current state and tailor initiatives accordingly:

${P.PROJECT_MATURITY.insert()}

IMPORTANT: Never generate initiatives that duplicate work already mentioned as completed in the conversation history. Always reference what's already been built and create initiatives that logically build upon or improve existing work.

RESPONSE FORMAT: Each initiative must have exactly these fields:
- name: A clear, concise name for the initiative
- description: High-level explanation of what needs to be done
- details: Implementation plan including technical specifications, assumptions, and approach. Reference technologies that have been discussed but don't assume any implementation details not yet specified.
- acceptanceCriteria: Clear, measurable criteria that define when this initiative is complete
- estimatedEffort: Must be one of "small", "medium", or "large" (not time-based estimates)
- priority: Must be one of "low", "medium", "high", or "critical"
- tags: Array of relevant technical or domain tags
- reasoning: Explanation of why this initiative is important

ARTIFACT REFERENCING:
When generating initiatives, you SHOULD include an "influences" array for each initiative that references specific entities from the conversation history that influenced or informed that initiative. For each influence, use the entityId and entityType from the evidence item you are referencing — both values come from the same source entity. Include:
- entityId: The UUID of the entity that influenced your choice
- entityType: The type of that same entity (as provided in the evidence)
- reasoning: Explanation of how this entity influenced the initiative
- reasonType: Type of influence (e.g., "previous_conversation", "related_initiative", "depends_on", "similar_to", "blocks", "references")

Example influences structure:
"influences": [
  {
    "entityId": "message_uuid_here",
    "entityType": "MESSAGE",
    "reasoning": "Initiative generation context informed this initiative priority",
    "reasonType": "previous_conversation"
  }
]

EXAMPLE JSON STRUCTURE:
{
  "type": "INITIATIVES",
  "response": "Based on your project analysis, I've created a comprehensive roadmap with strategic initiatives.",
  "detectedIntent": "initiative_generation_complete",
  "intentConfidence": 0.95,
  "initiatives": [
    {
      "name": "Core Game Mechanics Prototype",
      "description": "Develop a functional prototype demonstrating the core gameplay loop",
      "details": "Build a Unity-based prototype featuring resource gathering, basic combat, and progression systems. Assumes players will engage with resource mechanics based on similar games in the genre. Include placeholder assets and focus on mechanics validation rather than visual polish.",
      "acceptanceCriteria": "- Playable demo with 10 minutes of gameplay\\n- Resource gathering mechanic implemented and functional\\n- Basic combat system allows player vs enemy interactions\\n- Player progression system shows experience/level gains\\n- Core game loop can be completed end-to-end",
      "estimatedEffort": "medium",
      "priority": "high",
      "tags": ["prototype", "gameplay", "core-mechanics"],
      "reasoning": "Essential foundation for all future development and user testing",
      "influences": [
        {
          "entityId": "example-message-id",
          "entityType": "MESSAGE",
          "reasoning": "User requirements informed this initiative scope",
          "reasonType": "previous_conversation"
        }
      ]
    }
  ]
}

ARTIFACT REFERENCING: When generating initiatives, you SHOULD include an "influences" array that references specific Q&A exchanges and other entities (using entityId and entityType) from the conversation history that influenced each initiative, along with reasoning for how those exchanges shaped the initiative.`,
    responseSchema: initiativeGenerationResponseSchema,
    temperature: 0.7,
    maxTokens: 25000,
  };

  constructor(
    private initiativeService: InitiativeService,
    private conversationService: ConversationService,
  ) {
    super();
  }

  /**
   * Process LLM response to create initiatives and refinement conversations
   */
  async processLlmResponse(
    initiativeData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<OnboardingFlowContext>,
  ): Promise<{ modifiedResult: InitiativeGenerationActionData }> {
    const context = tracker.getContext();
    const onboardingContext = context;
    const { initiatives, ...remainingData } = initiativeData as {
      initiatives: LLMInitiative[];
    };

    // Convert LLM initiatives to drafts
    const initiativeDrafts = this.convertLLMInitiativesToDrafts(initiatives);

    // Create database initiatives
    const realInitiatives = await this.initiativeService.createFromDrafts(
      initiativeDrafts,
      onboardingContext.core.organizationId,
      onboardingContext.core.projectId,
      onboardingContext.core.conversationId,
    );

    // Create refinement conversations for each initiative
    const conversationIds: ConversationId[] = [];
    for (let i = 0; i < initiativeDrafts.length; i++) {
      const initiative = realInitiatives[i];
      if (!initiative) {
        throw new Error(
          `Missing initiative for draft index ${i} during onboarding generation`,
        );
      }
      const conversationId = await this.createRefinementConversation(
        initiative,
        onboardingContext,
      );
      conversationIds.push(conversationId);
    }

    // Create properly typed response data
    const modifiedResult = {
      ...remainingData,
      ...this.createInitiativeGenerationActionData({
        initiatives: realInitiatives,
        conversationIds,
      }),
    } as InitiativeGenerationActionData;

    return { modifiedResult };
  }

  /**
   * Compensation strategy for initiative generation failures
   */
  async compensate(
    _context: OnboardingFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Initiative generation often needs more attempts due to complexity
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 10000 + attemptCount * 3000; // Progressive delay
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Initiative generation timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 3) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason:
          'Initiative generation rate limited, extended delay before retry',
      };
    }

    // For other error types, fail immediately
    return { action: 'FAIL' };
  }

  /**
   * Convert LLM response initiatives to InitiativeDraft format
   */
  private convertLLMInitiativesToDrafts(
    llmInitiatives: LLMInitiative[],
  ): InitiativeDraft[] {
    if (!llmInitiatives || !Array.isArray(llmInitiatives)) {
      return [];
    }

    return llmInitiatives.map((initiative) => ({
      id: uuidv4(),
      name: initiative.name,
      description: initiative.description,
      details: initiative.details,
      acceptanceCriteria: initiative.acceptanceCriteria,
      estimatedEffort: initiative.estimatedEffort,
      priority: initiative.priority,
      tags: initiative.tags,
      reasoning: initiative.reasoning,
      influences: initiative.influences.map((influence) => ({
        entityId: influence.entityId,
        entityType: influence.entityType,
        reasoning: influence.reasoning,
        reasonType: influence.reasonType,
        confidence: influence.confidence,
      })) as Influence[],
      currentLevel: 'description' as const,
      reviewStatus: 'unreviewed' as const,
    }));
  }

  /**
   * Create refinement conversation for an initiative
   */
  private async createRefinementConversation(
    realInitiative: InitiativeResponseDto,
    context: OnboardingFlowContext,
  ): Promise<ConversationId> {
    try {
      const conversationDto: CreateConversationDto = {
        projectId: context.core.projectId,
        organizationId: context.core.organizationId,
        initiatedBy: InitiationType.System,
        triggerEvent: 'initiative_reasoning_created',
        workflowAboutType: 'initiative',
        workflowAboutId: realInitiative.id,
        title: `Initiative: ${realInitiative.name}`,
        workflowName: 'initiative-refinement',
        status: ConversationStatus.Started,
        context: {},
      };

      const conversation = await this.conversationService.createConversation(
        conversationDto,
        context.core.organizationId,
      );

      if (!conversation) {
        throw new Error(
          `Failed to create refinement conversation for initiative ${realInitiative.id}`,
        );
      }

      return conversation.id;
    } catch (err) {
      console.log('[createRefinementConversation] error', {
        message: (err as Error).message,
        name: (err as Error).name,
        stack: (err as Error).stack,
      });

      throw err;
    }
  }

  /**
   * Create properly typed initiative generation data for response
   */
  private createInitiativeGenerationActionData(result: {
    initiatives: Array<{ id: string }>;
    conversationIds: string[];
  }): InitiativeGenerationActionData {
    return {
      type: 'INITIATIVES',
      response: `Great! I've analyzed your project and created ${result.initiatives.length} workstreams for your roadmap. Let's review them together to make sure they're exactly what you need.`,
      detectedIntent: 'initiative_generation_complete',
      intentConfidence: 1.0,
      generatedInitiativeIds: result.initiatives.map((i) => i.id),
      conversationIds: result.conversationIds,
      uiElements: [
        {
          id: 'initiative-1',
          type: 'initiative_list',
          label: 'Generated Initiatives',
          required: true,
          influences: [],
        },
      ],
    };
  }
}
