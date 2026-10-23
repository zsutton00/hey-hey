import type { MessageResponseDto } from "../../api";
import { getConversationSystemThread } from "../../utils/conversationThread";

export function areConversationMessagesReady(
  messages: readonly MessageResponseDto[],
  options: { requireFirstMessage: boolean; requireUiElements: boolean }
): boolean {
  if (options.requireFirstMessage && messages.length === 0) return false;
  if (!options.requireUiElements) return true;
  const first = getConversationSystemThread([...messages]).firstSystemMessage;
  return (
    !!first &&
    "uiElements" in first.data &&
    Array.isArray(first.data.uiElements) &&
    first.data.uiElements.length > 0
  );
}
