import type { ConversationResponseTarget } from "../Conversation/Components/conversationFormTypes";

export type ExternalReplyAvailability =
  | { available: true }
  | {
      available: false;
      reason: "read-only" | "unavailable" | "submitting";
    };

export interface ReplyComposerState {
  hidden: boolean;
  availability: ExternalReplyAvailability;
}

export const resolveReplyComposerState = (input: {
  target: ConversationResponseTarget;
  /** The target has been published for the displayed conversation. */
  targetSettled: boolean;
  hideComposer: boolean;
  readOnly: boolean;
  canSubmit: boolean;
  submitting: boolean;
}): ReplyComposerState => {
  const availability: ExternalReplyAvailability = input.readOnly
    ? { available: false, reason: "read-only" }
    : !input.canSubmit
      ? { available: false, reason: "unavailable" }
      : input.submitting
        ? { available: false, reason: "submitting" }
        : { available: true };
  if (input.hideComposer || input.readOnly) {
    return { hidden: true, availability };
  }
  const ownsResponse =
    input.target.ownership === "exclusive" &&
    input.target.usable &&
    !input.submitting;
  // Stay hidden until the target is known so a usable response never flashes
  // a competing composer.
  return { hidden: !input.targetSettled || ownsResponse, availability };
};
