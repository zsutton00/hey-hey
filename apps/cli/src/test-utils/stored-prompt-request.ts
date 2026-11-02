import type { StoredInput } from '../server/input-admission/input-admission-codec';
import { promptEventFromStored } from '../server/input-admission/stored-trigger-contract';
import { toRunPromptRequest } from '../server/trigger-verification/dispatch';

type StoredTriggerEvent = Extract<StoredInput, { kind: 'trigger_frame' }>['payload']['event'];

/** Mirrors the storage-to-contract identity adaptation performed by input admission. */
export const toRunPromptRequestFromStoredEvent = (event: StoredTriggerEvent) => {
  if (event.promptType === 'start_run') {
    throw new Error('Start-run events create runs instead of prompt requests.');
  }
  return toRunPromptRequest(promptEventFromStored(event));
};
