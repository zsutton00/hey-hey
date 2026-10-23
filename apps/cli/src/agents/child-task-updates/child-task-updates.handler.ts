import type { LocalChildTaskUpdatesPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandler } from '../prompt-type-handler';
import { buildChildTaskUpdatesPrompt } from '../prompts/child-task-updates';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

export const childTaskUpdatesHandler: PromptTypeHandler<LocalChildTaskUpdatesPromptPayload> = {
  id: 'child_task_updates',
  promptType: 'child_task_updates',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  expectedResponseTypes: ['child_task_description_update_v1'],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  buildPrompt(payload: LocalChildTaskUpdatesPromptPayload): string {
    return buildChildTaskUpdatesPrompt(payload);
  },

  buildStartingMessage(payload: LocalChildTaskUpdatesPromptPayload): string | null {
    return buildStartingMessageForPromptType('child_task_updates', payload);
  },
};
