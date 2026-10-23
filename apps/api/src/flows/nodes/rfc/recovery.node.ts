import { Injectable } from '@nestjs/common';
import { LlmQuestionsNodeBase } from '../base/';
import {
  FlowContext,
  CompensationContext,
  CompensationResult,
} from '../../../types/flow-internal.types';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { RFC_NODES } from '../../constants/node-ids';
import { flowRecoveryResponseSchema } from '../../utils/shared-schemas';

/**
 * RFC Recovery Node - Handles flow recovery after errors
 *
 * Helps users recover gracefully when something goes wrong in the RFC flow.
 * Provides options to retry, start over, continue conversation, or end.
 */
@Injectable()
export class RfcRecoveryNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id = RFC_NODES.RECOVERY;
  readonly title = 'RFC Flow Recovery';

  readonly promptConfig = {
    systemPromptTemplate: `You are a recovery assistant for the RFC (Request for Comments) creation flow. Something went wrong in the previous step, and you need to help the user recover gracefully.

${P.CONVERSATION_HISTORY.insert()}

Your role is to:
1. **Acknowledge the issue**: Let the user know something went wrong without being too technical
2. **Provide options**: Suggest how to proceed based on where they were in the flow
3. **Stay positive**: Keep the experience smooth and helpful

Recovery options:
- "retry_previous": If the issue was likely temporary (timeout, network), suggest trying the last step again
- "start_over": If the context is corrupted or unclear, suggest starting the RFC flow from the beginning
- "conversation": If they want to discuss what went wrong or need help understanding the process
- "end": If they want to stop the RFC creation process

Guidelines:
- Be helpful and reassuring
- Don't expose technical error details to the user
- Focus on getting them back on track
- Suggest the most appropriate recovery path based on the context

Respond using the gather node format:
- type must be "QUESTIONS"
- response should acknowledge the issue and outline the suggested recovery path
- detectedIntent should be whichever recovery action you recommend (retry_previous, start_over, conversation, or end)
- intentConfidence must be between 0 and 1
- uiElements should include a single optional textarea (id: "recovery_notes") so the user can share extra detail if they want
- suggestedAction must match the value you set in detectedIntent
- Encourage the user to confirm the recommendation in your response message.`,
    responseSchema: flowRecoveryResponseSchema,
    temperature: 0.3,
  };

  readonly transitions = {
    retry_previous: () => RFC_NODES.CLASSIFY,
    start_over: () => RFC_NODES.CLASSIFY, // Start over from classification since we removed welcome
    conversation: () => RFC_NODES.CONVERSATION,
    end: () => RFC_NODES.END,
    default: () => RFC_NODES.CONVERSATION,
  };

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { attemptCount } = compensationContext;

    // If recovery itself fails, end gracefully
    if (attemptCount >= 1) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: RFC_NODES.END,
        reason: 'Recovery processing failed, ending flow gracefully',
      };
    }

    return { action: 'FAIL' };
  }
}
