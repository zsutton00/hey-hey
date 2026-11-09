import type { LocalPromptTaskInput } from '@hey-hey/contracts/agent-bridge';

/**
 * Internal input passed to the prompt builder.
 * The task fields are always present (required on the payload).
 * The agent calls get_context on its first turn to retrieve
 * feature hierarchy, topology, and proposal history.
 */
export interface TaskRefinerPromptInput {
  task: LocalPromptTaskInput;
}
