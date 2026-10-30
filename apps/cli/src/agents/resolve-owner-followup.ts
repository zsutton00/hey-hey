import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import {
  resolvePromptText,
  type InternalRunPromptRequest,
  type LocalAnyPromptPayload,
} from '../shared/agent-bridge-contract/contract';
import type { PromptTypeHandler } from './prompt-type-handler';

/**
 * An ordinary reply arrives as `coding_freeform`. The agent that owns the Run's
 * provider session keeps the conversation, so the reply goes back to it and the
 * session is resumed instead of rotated. Only these hand the reply on:
 * - a workflow parked on a user review, which routes its own reply;
 * - an owner that declares `handsOffOrdinaryReplies`.
 */
export function resolveOwnerFollowup(
  owner: PromptTypeHandler<unknown> | undefined,
  input: InternalRunPromptRequest,
): InternalRunPromptRequest {
  if (
    input.promptType !== LocalPromptType.CodingFreeform ||
    input.awaitingUserReview ||
    !owner ||
    owner.handsOffOrdinaryReplies ||
    owner.promptType === LocalPromptType.CodingFreeform
  ) {
    return input;
  }

  const userMessage = resolvePromptText(input);
  return {
    ...input,
    promptType: owner.promptType,
    // The payload union is discriminated by promptType, which is only known at
    // runtime here. Every handler accepts the userMessage-only turn that a
    // user_message follow-up already produces.
    payload: {
      promptType: owner.promptType,
      ...(userMessage !== null ? { userMessage } : {}),
    } as LocalAnyPromptPayload,
  };
}
