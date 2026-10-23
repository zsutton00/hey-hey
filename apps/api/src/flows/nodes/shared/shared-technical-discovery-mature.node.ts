import { Injectable } from '@nestjs/common';
import { FlowContext, NodeResult } from '../../../types/flow-internal.types';
import { gatherNodeResponseSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Shared Technical Discovery Mature Node - LLM-based technical context for mature projects
 *
 * Focuses on understanding the current state of ongoing projects,
 * including technologies, products, and decisions already made.
 */
@Injectable()
export class SharedTechnicalDiscoveryMatureNode extends LlmQuestionsNodeBase {
  readonly id = SHARED_NODES.TECHNICAL_DISCOVERY_MATURE;
  readonly title = 'Technical Details';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a senior technical architect helping to understand the current state of an ongoing project.
        You want to know what technologies, products and decisions have already been made.

        Dig deeper into:
        1. Technical architecture and technology choices
        2. Integration points with existing systems
        3. Data flows and storage requirements
        4. Performance and scaling considerations

        Based on their answers so far, focus on the areas that seem most critical to their success.
        If they mention specific technologies, explore why they chose them.
        If they seem uncertain, provide gentle guidance without being prescriptive.

        Ask 2-3 focused technical questions based on their project type and complexity.`,

    responseSchema: gatherNodeResponseSchema,
    temperature: 0.7,
  };

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'SharedTechnicalDiscoveryMatureNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }
}
