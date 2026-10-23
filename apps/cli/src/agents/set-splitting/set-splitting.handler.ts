import type { LocalSetSplittingPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandler, PromptTypeHandlerContext } from '../prompt-type-handler';
import { buildSetSplittingPrompt } from '../prompts/set-splitting';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

export const setSplittingHandler: PromptTypeHandler<LocalSetSplittingPromptPayload> = {
  id: 'set_splitting',
  promptType: 'set_splitting',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  expectedResponseTypes: ['set_splitting_v1'],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  buildPrompt(payload: LocalSetSplittingPromptPayload, ctx?: PromptTypeHandlerContext): string {
    return buildSetSplittingPrompt(
      payload,
      ctx?.entity?.entityId ? { focalEntityId: ctx.entity.entityId } : {},
    );
  },

  buildStartingMessage(payload: LocalSetSplittingPromptPayload): string | null {
    return buildStartingMessageForPromptType('set_splitting', payload);
  },
};
