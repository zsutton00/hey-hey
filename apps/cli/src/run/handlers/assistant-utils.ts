/**
 * Shared utilities for assistant handlers.
 */

import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { UpdateMessageDto, AgentSystemMessageData } from '../../shared/api/index';
import type { PromptTypeHandler } from '../../agents/prompt-type-handler';
import type { AssistantDeltaEvent, AssistantCompleteEvent, MessageStamp } from '../types';
import type { Run } from '../run';
import type { Turn } from '../../turn/turn';

type AssistantEvent = AssistantDeltaEvent | AssistantCompleteEvent;

/**
 * Provenance stamp for a message authored by `eventTurn`. A subagent Turn's
 * messages carry its own isolated provider session; every other Turn's carry
 * the Run-owned provider session.
 */
export const buildTurnMessageStamp = (ctx: Run, eventTurn: Turn): MessageStamp => ({
  providerSessionId:
    eventTurn.handler.runnerKind === 'subagent'
      ? eventTurn.subagentProviderSessionId
      : ctx.providerSessionId,
  promptHandler: eventTurn.handler.promptType,
});

/**
 * Build the update/complete data for an assistant message.
 *
 * If a prompt-type handler is registered, it transforms the event first.
 * Otherwise builds an AgentSystemMessageData with the summary. Provenance
 * stamping (`providerSessionId`, `promptHandler`) is applied at the poster
 * seam — handlers no longer thread those fields here, so the same builder
 * works whether the body is plain text, a structured-response payload, or a
 * handler-shaped output.
 */
const buildUpdateData = (
  event: AssistantEvent,
  handler: PromptTypeHandler<unknown> | null,
): UpdateMessageDto => {
  if (handler?.transformOutput) {
    const result = handler.transformOutput(event);
    if (result) return result;
  }

  const data: AgentSystemMessageData = {
    type: SystemMessageDataTypeEnum.Agent,
    response: event.summary,
    detectedIntent: 'agent_response',
    intentConfidence: 1,
  };

  return { data };
};

export const buildCompletionData = (
  event: AssistantCompleteEvent,
  handler: PromptTypeHandler<unknown> | null,
  payload?: unknown,
): UpdateMessageDto => {
  const transformed = handler?.transformCompletionOutput?.(event, payload);
  return transformed ?? buildUpdateData(event, handler);
};
