import { Injectable } from '@nestjs/common';
import { ExtendedUIFieldType } from '../../../generated';
import type { SystemMessageData } from '../../../generated';
import type {
  IntermediateSystemMessageData,
  NodeResult,
  ProcessLlmResult,
} from '../../../types/flow-internal.types';
import { SHARED_NODES } from '../../constants/node-ids';
import { addressConcernsResponseSchema } from '../../utils/shared-schemas';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Shared Address Concerns Node - LLM-based concern resolution
 *
 * Addresses user concerns about technical analysis by clarifying
 * misunderstandings and adjusting recommendations based on feedback.
 */
@Injectable()
export class SharedAddressConcernsNode extends LlmQuestionsNodeBase {
  readonly id = SHARED_NODES.ADDRESS_CONCERNS;
  readonly title = 'Address Concerns';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `The user has concerns about the technical analysis.

        Address their concerns by:
        1. Clarifying any misunderstandings
        2. Providing additional context or alternatives
        3. Adjusting recommendations based on their feedback
        4. Helping them feel confident about the path forward

        Respond using the gather node format:
        - type must be "QUESTIONS"
        - response should explain how you are addressing their concern
        - detectedIntent should map to the most appropriate next node (e.g. "address_concerns_resolved", "needs_follow_up")
        - intentConfidence must be between 0 and 1
        - uiElements should include one textarea (id: "concern_feedback") asking the user if they need further clarification
        - Include the updated technical analysis fields (analysis, feedback, conversationSummary, detectedIntent, intentConfidence, reasoning) so we can persist the revised guidance.

        Be collaborative and responsive to their specific concerns.`,

    responseSchema: addressConcernsResponseSchema,
    temperature: 0.8,
  };

  /**
   * Process LLM response to ensure proper UI element structure
   */
  async processLlmResponse(
    systemMessage: IntermediateSystemMessageData,
  ): Promise<ProcessLlmResult> {
    const data = systemMessage as SystemMessageData & {
      uiElements?: Array<{
        id: string;
        type: ExtendedUIFieldType;
        label?: string;
        placeholder?: string | null;
        required?: boolean | null;
        influences?: unknown[];
      }>;
    };

    const feedbackElement = {
      id: 'concern_feedback',
      type: ExtendedUIFieldType.Textarea,
      label: 'Is there anything else you would like us to adjust?',
      placeholder:
        'Share additional feedback or confirm if the updated recommendations look good...',
      required: false,
      influences: [] as never[],
    };

    data.uiElements = [feedbackElement];

    return {
      modifiedResult: data,
    };
  }

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'SharedAddressConcernsNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }
}
