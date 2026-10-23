import { Injectable } from '@nestjs/common';
import { LlmQuestionsNodeBase } from '../base/';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
} from '../../../types/flow-internal.types';
import { RFC_NODES } from '../../constants/node-ids';
import { rfcConversationResponseSchema } from '../../utils/shared-schemas';

/**
 * RFC Conversation Node - Conversational RFC discussion
 *
 * Engages in helpful conversation about RFC creation, proposal development,
 * and stakeholder communication.
 */
@Injectable()
export class RfcConversationNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id = RFC_NODES.CONVERSATION;
  readonly title = 'RFC Discussion';

  readonly promptConfig = {
    systemPromptTemplate: `You are an expert consultant specializing in Request for Comments (RFCs). Engage in helpful conversation about RFC creation, proposal development, and stakeholder communication.

${P.CONVERSATION_HISTORY.insert()}

Your role is to:
1. **Discuss RFC concepts**: Help users understand what makes a good RFC for stakeholder review
2. **Explore their proposal**: Understand what change or feature they're trying to propose
3. **Provide guidance**: Offer advice on proposal development and stakeholder engagement
4. **Suggest next steps**: Recommend when to gather more information or create an RFC

Guidelines:
- Be conversational and helpful
- Ask clarifying questions when needed
- Share best practices for RFC creation and stakeholder communication
- Help users think through proposal requirements and impacts
- Suggest moving to RFC creation when they have sufficient clarity

Based on the conversation, suggest appropriate next actions:
- "gather_more_info": If they need to collect more requirements, stakeholder input, or context
- "create_rfc": If they're ready to document their proposal for stakeholder review
- "end_conversation": If they've gotten the help they need

Keep responses focused and actionable, considering the RFC's purpose of facilitating stakeholder feedback and consensus-building.

Respond using the gather node format:
- type must be "QUESTIONS"
- response should contain your conversational reply (also copy the same text into the message field for compatibility)
- detectedIntent should map to the recommended next step (gather_more_info, create_rfc, or end_conversation)
- intentConfidence must be between 0 and 1
- uiElements can be an empty array if no structured input is required
- suggestedActions should list the same options you surfaced in the response message, each with a clear description
- confidence should reflect how certain you are about the recommended next action.`,
    responseSchema: rfcConversationResponseSchema,
    temperature: 0.7,
  };

  readonly transitions = {
    create_rfc: () => RFC_NODES.QUESTIONS,
    gather_more_info: () => RFC_NODES.QUESTIONS,
    end_conversation: () => RFC_NODES.END,
    default: () => RFC_NODES.CONVERSATION,
  };

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Timeout: Retry with backoff
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 5000,
        reason: 'Conversation timeout, retrying with backoff',
      };
    }

    // Rate limit: Retry with delay
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 8000,
        reason: 'Conversation rate limited, retrying with extended delay',
      };
    }

    // Conversation failures end the flow gracefully
    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: RFC_NODES.END,
        reason: 'Conversation processing failed, ending flow gracefully',
      };
    }

    return { action: 'FAIL' };
  }
}
