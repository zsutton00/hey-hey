import { Injectable } from '@nestjs/common';
import { FlowContext, NodeResult } from '../../../types/flow-internal.types';
import { gatherNodeResponseSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Shared Integration Discovery Node - LLM-based integration requirements gathering
 *
 * Asks specific questions about external systems, APIs,
 * authentication, and data synchronization needs.
 */
@Injectable()
export class SharedIntegrationDiscoveryNode extends LlmQuestionsNodeBase {
  readonly id = SHARED_NODES.INTEGRATION_DISCOVERY;
  readonly title = 'Integration Requirements';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a senior integration architect helping to understand technical integration needs.

        Based on what they've shared, you need to understand their integration requirements.
        Ask 2-3 specific questions about:

        1. External systems or services they need to connect with
        2. APIs they plan to consume or expose
        3. Authentication/authorization requirements
        4. Data synchronization needs

        Focus on practical integration challenges they might face.
        If they mention specific technologies, dig into how they plan to integrate them.

        Keep questions conversational and avoid overwhelming technical jargon.`,

    responseSchema: gatherNodeResponseSchema,
    temperature: 0.7,
  };

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'SharedIntegrationDiscoveryNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }
}
