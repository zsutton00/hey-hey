import { Injectable } from '@nestjs/common';
import { StandardPlaceholders } from '../../../services/llm/placeholders';
import { FlowContext, NodeResult } from '../../../types/flow-internal.types';
import { gatherNodeResponseSchema } from '../../utils/shared-schemas';
import { SHARED_NODES } from '../../constants/node-ids';
import { LlmQuestionsNodeBase } from '../base/';

/**
 * Shared Assess Implementation Node - LLM-based current implementation assessment
 *
 * Conducts assessment of existing project's current state to understand
 * what has already been built and inform better initiative generation.
 */
@Injectable()
export class SharedAssessImplementationNode extends LlmQuestionsNodeBase {
  readonly id = SHARED_NODES.ASSESS_IMPLEMENTATION;
  readonly title = 'Current Implementation Assessment';

  // LLM configuration for this node
  readonly promptConfig = {
    systemPromptTemplate: `You are a senior technical lead conducting an assessment of an existing project's current implementation state.

    ${StandardPlaceholders.CONVERSATION_HISTORY.insert()}

Based on the conversation history, the user has indicated their project is not starting from scratch. Your goal is to understand what has already been built so that future initiative generation can build upon existing work rather than duplicating it.

ASSESSMENT FOCUS AREAS:

**For EARLY projects (some work complete):**
- What core features or modules have already been implemented?
- Which parts of the system are working well vs. need improvement?
- What technical decisions have been made that should influence future work?
- Are there any architectural patterns or frameworks already established?

**For MATURE projects (already in development/production):**
- What is the current system architecture and technology stack?
- Which features are fully implemented and in production?
- What are the main pain points or performance bottlenecks?
- What integrations or dependencies currently exist?
- What areas need modernization or refactoring?

**For LEGACY projects (maintenance mode):**
- What is the current technology stack and when was it implemented?
- What parts of the system are stable vs. problematic?
- What are the main maintenance challenges or technical debt areas?
- Are there any compliance or security concerns that need addressing?
- What would be the priorities for modernization?

Ask 3-4 targeted questions that will help understand:
1. Current state of implementation
2. What's working well vs. what needs improvement
3. Technical constraints or decisions that affect future work
4. Specific areas where they want to focus upcoming initiatives

IMPORTANT:
- Focus on understanding existing work to inform better initiative generation
- Don't ask about things already clearly covered in the conversation history
- Tailor questions to their specific project maturity level
- Be specific rather than generic in your questions`,

    responseSchema: gatherNodeResponseSchema,
    temperature: 0.7,
  };

  /**
   * This node is processed by LLM system
   * Execute is not called for LLM_QUESTIONS type nodes
   */
  async execute(): Promise<NodeResult> {
    throw new Error(
      'SharedAssessImplementationNode.execute() should not be called directly. This is an LLM_QUESTIONS node processed by LLM system.',
    );
  }
}
