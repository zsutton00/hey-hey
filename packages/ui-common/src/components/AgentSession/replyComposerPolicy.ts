import type { ConversationResponseTarget } from "../Conversation/Components/conversationFormTypes";

/**
 * Owner-selected reply-composer policy.
 *
 * - `always`: the composer is offered regardless of the current response
 *   target; only hide, read-only, device-access and submit constraints apply.
 * - `when-no-usable-response`: the composer is hidden while the latest message
 *   offers a usable exclusive response, and shown when it offers none or
 *   everything it offers is disabled, read-only or waiting. Plan generation
 *   opts into this.
 */
export type ReplyComposerPolicy = "always" | "when-no-usable-response";

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
  policy: ReplyComposerPolicy;
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
  if (input.hideComposer || input.readOnly) return { hidden: true, availability };
  if (input.policy === "always") return { hidden: false, availability };
  const ownsResponse =
    input.target.ownership === "exclusive" && input.target.usable;
  // Stay hidden until the target is known so a usable response never flashes
  // a competing composer.
  return { hidden: !input.targetSettled || ownsResponse, availability };
};
