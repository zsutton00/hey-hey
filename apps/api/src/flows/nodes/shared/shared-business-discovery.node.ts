import { Injectable } from '@nestjs/common';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { FlowContext, NodeResult } from '../../../types/flow-internal.types';
import { gatherNodeResponseSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Shared Business Discovery Node - LLM-based business context gathering
 *
 * Asks focused questions about business objectives, target market,
 * competitive landscape, and resource constraints.
 */
@Injectable()
export class SharedBusinessDiscoveryNode extends LlmQuestionsNodeBase {
  readonly id = SHARED_NODES.BUSINESS_DISCOVERY;
  readonly title = 'Business Context';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a senior business analyst helping to understand project requirements.

        Focus on business aspects:
        1. Business objectives and success metrics
        2. Target market and user segments
        3. Competitive landscape and differentiation
        4. Resource constraints and timeline
        5. Revenue model and monetization strategy

        Ask exactly 3 focused business questions to understand the strategic context.

        Conversation History: ${P.CONVERSATION_HISTORY_SIMPLE.insert()}`,

    responseSchema: gatherNodeResponseSchema,
    temperature: 0.7,
  };

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'SharedBusinessDiscoveryNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }
}
