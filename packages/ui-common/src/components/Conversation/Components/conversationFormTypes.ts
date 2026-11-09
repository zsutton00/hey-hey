import type { UIElement } from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import type { FormValue } from "../../LlmForms/types";

declare const canonicalMessageId: unique symbol;
/** Identity of a persisted Message from the canonical conversation collection. */
export type CanonicalMessageId = string & {
  readonly [canonicalMessageId]: true;
};

/** Narrows a message identity to one confirmed in the canonical conversation collection. */
export const canonicalMessageIdFromCollection = (
  value: string,
  canonicalIds: ReadonlySet<string>,
): CanonicalMessageId | null =>
  canonicalIds.has(value) ? (value as CanonicalMessageId) : null;

export type ResponseSubmissionKind = "field" | "report" | "owner-command";
export type ResponseBehavior =
  | { ownership: "display-only" }
  | {
      ownership: "exclusive" | "contribution";
      submissionKind: ResponseSubmissionKind;
    };
export type ConversationResponseDeclaration =
  | { ownership: "display-only" }
  | {
      ownership: "exclusive" | "contribution";
      currentFieldId: string;
      submissionKind: ResponseSubmissionKind;
    };
export type ConversationResponseTarget =
  | { ownership: "none" }
  | {
      ownership: "exclusive" | "contribution";
      messageId: CanonicalMessageId;
      currentFieldId: string;
      submissionKind: ResponseSubmissionKind;
      /** False while the target's controls are disabled, read-only or waiting. */
      usable: boolean;
    };
export type ResponseTargetChangeHandler = (
  target: ConversationResponseTarget,
  conversationId: string,
  /** The canonical message load has settled, successfully or not. */
  messagesSettled: boolean,
) => void;

export interface ConversationFormResolution {
  responseDeclarations: readonly ConversationResponseDeclaration[];
  uiElements: UIElement[];
  disabled: boolean;
  /** Completion evidence from the owner, never temporary command readiness. */
  isSubmitted: boolean;
  submit: (data: Record<string, FormValue>) => Promise<void>;
}

export type ConversationFormResolver = (
  conversationMessage: ConversationMessage,
) => ConversationFormResolution | null;
