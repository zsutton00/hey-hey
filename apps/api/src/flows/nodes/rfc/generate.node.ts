import { Injectable } from '@nestjs/common';
import { GenerateNodeBase } from '../base/';
import {
  FlowContext,
  CompensationContext,
  CompensationResult,
} from '../../../types/flow-internal.types';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { RFC_NODES } from '../../constants/node-ids';
import {
  rfcResponseSchema,
  type RfcResponse,
} from '../../utils/shared-schemas';

/**
 * RFC Generate Node - Creates comprehensive RFC document
 *
 * Generates a complete Request for Comments based on all
 * information gathered during the conversation.
 */
@Injectable()
export class RfcGenerateNode extends GenerateNodeBase<FlowContext> {
  readonly id = RFC_NODES.GENERATE;
  readonly title = 'RFC Generation';

  readonly promptConfig = {
    systemPromptTemplate: `You are an expert at creating comprehensive Request for Comments (RFCs). Create a high-quality RFC based on the conversation and information gathered.

${P.CONVERSATION_HISTORY.insert()}

Generate a complete RFC that includes:

1. **Title**: Clear, descriptive title for the proposed change
2. **Status**: Current status (typically "Draft" for new RFCs)
3. **Summary**: Brief overview of what is being proposed
4. **Problem Statement**: What problem are we solving? Why is change needed?
5. **Proposal**: What specific change or feature is being proposed?
6. **Motivation**: Why is this the right approach? What are the benefits?
7. **Detailed Design**: How will this be implemented? Include:
   - Overview of the approach
   - Step-by-step implementation plan
   - API changes if applicable
   - Data model changes if applicable
8. **Alternatives**: Other approaches considered, with pros/cons and reasoning for rejection
9. **Impact**: How will this affect users, systems, and processes?
10. **Risks**: Potential risks with impact level and mitigation strategies
11. **Timeline**: Implementation phases with deliverables and time estimates

Guidelines:
- Use clear, professional language suitable for stakeholder review
- Be specific and actionable where possible
- Include rationale for why the proposed approach is preferred
- Consider both technical and business implications
- Make it valuable for reviewers who need to understand and provide feedback
- Focus on enabling informed decision-making by stakeholders

Base the RFC on all information provided in the conversation. If some details are missing, make reasonable assumptions but note them explicitly.`,
    responseSchema: rfcResponseSchema,
    temperature: 0.3,
  };

  readonly transitions = {
    default: () => RFC_NODES.END,
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
        retryDelayMs: 10000,
        reason: 'RFC generation timeout, retrying with extended backoff',
      };
    }

    // Rate limit: Retry with delay
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'RFC generation rate limited, retrying with extended delay',
      };
    }

    // Generation failures fallback to conversation mode
    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: RFC_NODES.CONVERSATION,
        reason:
          'RFC generation failed, switching to conversation mode for manual assistance',
      };
    }

    return { action: 'FAIL' };
  }
}
