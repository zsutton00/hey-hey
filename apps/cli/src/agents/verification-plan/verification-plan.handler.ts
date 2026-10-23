import type { LocalVerificationPlanPromptPayload } from '../../shared/agent-bridge-contract/index';
import {
  defaultAddUserMessage,
  type PromptTypeHandlerContext,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildVerificationPlanPrompt } from '../prompts/verification-plan';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

export const verificationPlanHandler: UserLaunchablePromptTypeHandler<LocalVerificationPlanPromptPayload> =
  {
    id: 'verification_plan',
    promptType: 'verification_plan',
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'none',
    expectedResponseTypes: ['verification_plan_v1'],
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    buildPrompt(payload: LocalVerificationPlanPromptPayload): string {
      return buildVerificationPlanPrompt(payload);
    },

    buildStartingMessage(
      payload: LocalVerificationPlanPromptPayload,
      ctx?: PromptTypeHandlerContext,
    ): string | null {
      return buildStartingMessageForPromptType('verification_plan', payload, ctx);
    },

    addUserMessage: defaultAddUserMessage,
  };
