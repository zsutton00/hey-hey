import type {
  ConversationMessage,
  OptimisticMessageState,
} from "../../../types/conversation";
import { MessageType } from "../../../api";

export interface MessageStatusParams {
  conversationMessage: ConversationMessage;
  isSubmitting: boolean;
  optimisticMessage?: OptimisticMessageState | null;
}

export type MessageStatus = "complete" | "saving" | "submitting" | "draft";

/**
 * Calculates message display status based on conversation state and UI state.
 * Extracted from ConversationViewer.tsx lines 804-815.
 *
 * @param params - The parameters for status calculation
 * @returns The calculated message status
 */
export const calculateMessageStatus = ({
  conversationMessage,
  isSubmitting,
  optimisticMessage = null,
}: MessageStatusParams): MessageStatus => {
  // Handle completed state or messages with responses
  if (
    conversationMessage.state === "completed" ||
    conversationMessage.message.responses?.some(
      (response) => response.type === MessageType.User
    )
  ) {
    return "complete";
  }

  // Handle awaiting_response state with submission in progress
  if (conversationMessage.state === "awaiting_response") {
    if (isSubmitting) {
      return "saving";
    }
  }

  if (optimisticMessage) {
    return "submitting";
  }

  // Default state
  return "draft";
};
