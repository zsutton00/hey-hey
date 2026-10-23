import { Injectable } from '@nestjs/common';
import { QuestionsSystemMessageData } from '../../../generated';
import { ClaudeModel, LLMProviderName } from '../../../services/llm/llm-shared';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  IntermediateSystemMessageData,
  MutableContextHandle,
  NodeResult,
  OnboardingFlowContext,
} from '../../../types/flow-internal.types';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  ClarificationProviderResponse,
  clarificationProviderResponseSchema,
} from '../../utils/shared-schemas';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Onboarding Clarify Concept Node - LLM-based clarification
 *
 * Evaluates initial project concept and asks targeted questions
 * only when there are specific gaps or ambiguities.
 */
@Injectable()
export class OnboardingClarifyConceptNode extends LlmQuestionsNodeBase<OnboardingFlowContext> {
  readonly id = ONBOARDING_NODES.CLARIFY_CONCEPT;
  readonly title = 'Clarify Concept';
  // Note: type is NodeType.QUESTIONS from base class, but this node
  // uses LLM via promptConfig so it's treated as LLM_QUESTIONS at runtime
  startMessage = 'A couple more questions...';

  // LLM configuration for this node
  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_5_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    systemPromptTemplate: `Evaluate the user's initial project concept for completeness. Only ask clarifying questions if there are specific gaps or ambiguities that would prevent understanding the project's viability and scope.

    The user has already provided initial context about their project

    
    ${P.CONVERSATION_HISTORY.insert({ header: '## INTRO QA SESSION' })}

**Evaluation Criteria:**
First assess if the initial description provides sufficient clarity on:
- Product concept: What it does, core functionality, and primary use cases
- Target users: Who will use it and what problems it solves for them
- Product scope: Boundaries of what's included/excluded
- Technical context: Rough sense of complexity and constraints

**When to Ask Questions:**
Only proceed with questions if you identify specific deficiencies:

**Product Concept Deficiencies:**
- Vague functionality: "productivity tool" without explaining what it actually does
- Missing use cases: Technical description without clear user workflows
- Unclear scope: Ambitious vision without defined boundaries
- Abstract concepts: High-level ideas without concrete implementation details

**Target User Deficiencies:**
- Generic audiences: "businesses" or "people" without specific segments
- Missing user context: No indication of when/where/how users would engage
- Unclear value proposition: Product features without corresponding user benefits
- Assumption gaps: User needs that aren't explicitly validated

**When NOT to Ask Questions:**
- Initial description is comprehensive and specific
- Core concept and users are clearly defined
- Minor details can be reasonably inferred or addressed later
- User has already demonstrated deep thinking about their project

**Question Guidelines (only when deficiencies exist):**
- Ask about the most critical gaps first (usually product concept over user details)
- Reference specific aspects of their description that need clarification
- Limit to 2-4 targeted questions to address only the identified deficiencies
- Frame questions to fill specific knowledge gaps, not gather nice-to-have details

**Valid Outcomes:**
- Ask targeted questions addressing specific deficiencies
- Ask no questions if the initial description is sufficiently complete`,

    responseSchema: clarificationProviderResponseSchema,
    temperature: 0.7,
    useToolCallSchema: true,
    toolName: 'onboarding_clarify_concept',
  };

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(
    _context: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<NodeResult> {
    throw new Error(
      'OnboardingClarifyConceptNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }

  async processLlmResponse(
    systemMessageData:
      | IntermediateSystemMessageData
      | ClarificationProviderResponse,
  ): Promise<{ modifiedResult: QuestionsSystemMessageData }> {
    const parsed = clarificationProviderResponseSchema.parse(systemMessageData);
    const { reasoning, uiElements, ...modelOwnedFields } = parsed;

    return {
      modifiedResult: {
        ...modelOwnedFields,
        type: 'QUESTIONS',
        uiElements: uiElements.map((element) => ({
          id: element.id,
          type: element.type,
          label: element.label,
          influences: element.influences.map((influence) => ({
            entityId: influence.entityId,
            entityType: influence.entityType,
            reasoning: influence.reasoning,
            reasonType: influence.reasonType,
            ...(influence.confidence != null
              ? { confidence: influence.confidence }
              : {}),
          })),
          ...(element.placeholder != null
            ? { placeholder: element.placeholder }
            : {}),
          ...(element.required != null ? { required: element.required } : {}),
          ...(element.multiline != null
            ? { multiline: element.multiline }
            : {}),
        })),
        ...(reasoning != null ? { reasoning } : {}),
      },
    };
  }

  /**
   * Compensation strategy for clarification failures
   */
  async compensate(
    _context: OnboardingFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    const isRecoverable = ['TIMEOUT', 'RATE_LIMITED', 'RETRYABLE'].includes(
      errorClassification.type,
    );

    if (!isRecoverable) {
      return {
        action: 'FAIL',
        reason: `Concept clarification failed with non-recoverable ${errorClassification.type}`,
      };
    }

    if (attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: errorClassification.type === 'RATE_LIMITED' ? 8000 : 5000,
        reason: `Concept clarification attempt ${attemptCount + 1}/2 failed with ${errorClassification.type}; retrying`,
      };
    }

    return {
      action: 'SKIP_TO_NODE',
      nextNodeId: ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT,
      reason: `Concept clarification could not be recovered after ${attemptCount + 1} attempts; continuing to project analysis`,
    };
  }
}
