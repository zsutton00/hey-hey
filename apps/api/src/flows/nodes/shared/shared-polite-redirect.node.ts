import { Injectable } from '@nestjs/common';
import { ActionNodeBase } from '../base/';
import { SHARED_NODES } from '../../constants/node-ids';
import {
  OnboardingFlowContext,
  NodeResult,
  NodeType,
  GenericActionData,
} from '../../../types/flow-internal.types';
import { politeRedirectResponseSchema } from '../../utils/shared-schemas';

/**
 * Shared Polite Redirect Node - Off-topic handling
 *
 * Used when user input doesn't relate to organizational projects.
 * Politely redirects user back to project management topics.
 */
@Injectable()
export class SharedPoliteRedirectNode extends ActionNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.POLITE_REDIRECT;
  readonly title = 'Polite Redirect';

  // LLM configuration for generating polite redirect messages
  readonly promptConfig = {
    systemPromptTemplate: `The user has provided input that doesn't appear to be related to organizational projects or initiatives.

        You should:
        1. Politely acknowledge their input
        2. Clarify that this platform is for organizational project management
        3. Give them an opportunity to provide project-related information
        4. If they continue with off-topic responses, guide them to end the conversation

        Be professional, helpful, and non-judgmental. Some users may have misunderstood the platform's purpose.`,

    responseSchema: politeRedirectResponseSchema,
    temperature: 0.7,
  };

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.ACTION,
      message:
        "I think there might be some confusion - this platform is designed for managing organizational projects and initiatives. Could you tell me more about what you're trying to accomplish?",
      data: {
        type: 'GENERIC',
        detectedIntent: 'not_applicable',
        intentConfidence: 0.9,
        redirected: true,
      } as GenericActionData,
    };
  }
}
