import type { LocalTaskRefinerPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import {
  defaultAddUserMessage,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import type { AssistantDeltaEvent, AssistantCompleteEvent } from '../../run/types';
import type { UpdateMessageDto } from '../../shared/api/index';
import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import { buildTaskRefinerPrompt } from './task-refiner-prompt';
import { extractStructuredJsonPayload } from '../response-parser';
import { ExtendedUIFieldType } from '../../shared/api/index';

const parseTaskRefinerResponse = (text: string): string | null => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const response = typeof obj['response'] === 'string' ? obj['response'].trim() : null;
  return response && response.length > 0 ? response : null;
};

export const taskRefinerHandler: UserLaunchablePromptTypeHandler<LocalTaskRefinerPromptPayload> = {
  id: 'task_refiner',
  promptType: 'task_refiner',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  },
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  defaultReasoningEffort: 'high',

  buildPrompt(payload: LocalTaskRefinerPromptPayload): string {
    return buildTaskRefinerPrompt({ task: payload.task });
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(_payload: LocalTaskRefinerPromptPayload): string | null {
    return 'Setting up task refiner...';
  },

  transformOutput(event: AssistantDeltaEvent | AssistantCompleteEvent): UpdateMessageDto | null {
    const response = parseTaskRefinerResponse(event.summary);
    if (!response) return null;

    return {
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        title: 'Task Refinement',
        detectedIntent: 'task_refiner',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  },
};
