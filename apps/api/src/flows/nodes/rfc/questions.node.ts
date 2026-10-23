import { Injectable } from '@nestjs/common';
import { LlmQuestionsNodeBase } from '../base/';
import {
  FlowContext,
  CompensationContext,
  CompensationResult,
} from '../../../types/flow-internal.types';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { RFC_NODES } from '../../constants/node-ids';
import { rfcQuestionsResponseSchema } from '../../utils/shared-schemas';

/**
 * RFC Questions Node - Information gathering for RFC creation
 *
 * Gathers necessary information to create a comprehensive RFC including
 * problem statement, proposal, motivation, design, alternatives, and impact.
 */
@Injectable()
export class RfcQuestionsNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id = RFC_NODES.QUESTIONS;
  readonly title = 'RFC Information Gathering';

  readonly promptConfig = {
    systemPromptTemplate: `You are an expert at creating Request for Comments (RFCs). Your role is to gather the necessary information to create a comprehensive RFC.

${P.CONVERSATION_HISTORY.insert()}

Based on the conversation so far, analyze what information you have and what questions you need to ask to create a high-quality RFC.

A good RFC typically includes:
1. **Problem Statement**: What problem are we solving? Why is change needed?
2. **Proposal**: What specific change or feature is being proposed?
3. **Motivation**: Why is this the right approach? What are the benefits?
4. **Detailed Design**: How will this be implemented? What are the specifics?
5. **Alternatives**: What other approaches were considered? Why not those?
6. **Impact**: How will this affect users, systems, or processes?

Analyze the current conversation and:
- Identify what information you already have
- Generate 0-5 focused questions to fill the most important gaps
- Prioritize questions that will have the biggest impact on RFC quality
- Keep questions clear and specific

If you already have sufficient information to create a quality RFC, return an empty questions array.

Respond using the gather node format:
- type must be "QUESTIONS"
- response should recap what you still need (or confirm you're ready to proceed)
- detectedIntent should be "need_questions" while you still require answers, or "generate_rfc" when the user is ready to draft the RFC
- intentConfidence must be between 0 and 1
- uiElements should include one textarea per follow-up question (use descriptive ids)
- questions must mirror the exact text presented to the user
- currentUnderstanding should summarise what you already know about the proposal

Remember: The goal is to gather enough context to make the RFC valuable for stakeholders who need to understand and provide feedback on this proposal.`,
    responseSchema: rfcQuestionsResponseSchema,
    temperature: 0.3,
  };

  readonly transitions = {
    default: () => RFC_NODES.GENERATE,
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
        reason: 'Questions generation timeout, retrying with backoff',
      };
    }

    // Rate limit: Retry with delay
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 8000,
        reason:
          'Questions generation rate limited, retrying with extended delay',
      };
    }

    // Questions failures fallback to direct generation
    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: RFC_NODES.GENERATE,
        reason:
          'Questions generation failed, proceeding to RFC generation with available information',
      };
    }

    return { action: 'FAIL' };
  }
}
