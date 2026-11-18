import type { Run } from '../../run/run';

const ENTITY_CONVERSATION_PROMPT_TYPE = 'entity_conversation';

/**
 * Entity Conversations commit under their Agent Session and Services whatever
 * their subject is. The fact comes from the Run's persisted started handlers,
 * never from the commit payload.
 */
export const isEntityConversationRun = (run: Pick<Run, 'session'>): boolean =>
  run.session.startedPromptTypes?.includes(ENTITY_CONVERSATION_PROMPT_TYPE) ?? false;

/** True when the commit is recorded against the Agent Session, not a Task. */
export const commitsAsAgentSession = (run: Pick<Run, 'session' | 'taskId'>): boolean =>
  isEntityConversationRun(run) || !run.taskId;
