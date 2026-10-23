import type { ConversationPhaseEvent } from '../types';
import type { Run } from '../run';

export const handleConversationPhase = (event: ConversationPhaseEvent, ctx: Run): void => {
  ctx.observeConversationPhase(event.phase);
};
