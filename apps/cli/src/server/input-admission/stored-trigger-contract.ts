import type { StoredInput } from './input-admission-codec';
import type {
  ConversationPromptEvent,
  StartRunRequestSource,
} from '../trigger-verification/dispatch';
import {
  materializationRequest,
  taskMonitorLaunchConfigFromInput,
} from '../trigger-verification/task-monitor-launch-config';
import { toOpenApiMessageId } from '../../shared/api/identifierAdapters';

type StoredTriggerEvent = Extract<StoredInput, { kind: 'trigger_frame' }>['payload']['event'];

/** Adapt validated frozen records without revalidating or rewriting their stored bytes. */
export function startRunRequestFromStored(
  input: Extract<StoredTriggerEvent, { promptType: 'start_run' }>['payload'],
): StartRunRequestSource {
  const { worktree, ...payload } = input;
  const request = materializationRequest(worktree);
  return { ...payload, ...(request === undefined ? {} : { worktree: request }) };
}

export function promptEventFromStored(
  event: Exclude<StoredTriggerEvent, { promptType: 'start_run' }>,
): ConversationPromptEvent {
  if (event.promptType !== 'user_message') {
    return event;
  }

  const { taskMonitorPayload, ...payload } = event.payload;
  if (!taskMonitorPayload) {
    return { ...event, payload };
  }

  const { judgment, launchConfig, ...monitorPayload } = taskMonitorPayload;
  return {
    ...event,
    payload: {
      ...payload,
      taskMonitorPayload: {
        ...monitorPayload,
        ...(launchConfig ? { launchConfig: taskMonitorLaunchConfigFromInput(launchConfig) } : {}),
        ...(judgment
          ? {
              judgment: {
                ...judgment,
                requestMessageId: toOpenApiMessageId(judgment.requestMessageId),
              },
            }
          : {}),
      },
    },
  };
}
