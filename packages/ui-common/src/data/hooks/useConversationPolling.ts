import { useConversationMessages } from "./useConversationMessages";
import { useEffect, useRef, useCallback } from "react";
import { MessageStatus, type ConversationResponseDto } from "../../api";
import { logger } from "../../utils/logger";
import { getConversationSystemThread } from "../../utils/conversationThread";

export interface UseConversationPollingOptions {
  enabled?: boolean;
  interval?: number;
  onPoll?: () => Promise<void>;
}

export interface UseConversationPollingReturn {
  isWaitingForFirstMessage: boolean;
}

/**
 * Custom hook for polling conversation data until the first message is properly initialized.
 * Replaces TanStack Query polling logic with a simpler React-based approach.
 */
export const useConversationPolling = (
  conversation: ConversationResponseDto | null | undefined,
  options: UseConversationPollingOptions = {}
): UseConversationPollingReturn => {
  const { enabled = true, interval = 3000, onPoll } = options;
  const messageQuery = useConversationMessages(
    conversation?.organizationId,
    conversation?.projectId,
    conversation?.id,
    { enabled }
  );
  const messages = messageQuery.data;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Determine if we're waiting for the first message to be properly initialized
  const isWaitingForFirstMessage = useCallback(() => {
    if (!messages) return true;
    if (messages.length === 0) return true;

    const firstMessage =
      getConversationSystemThread(messages).firstSystemMessage;
    if (!firstMessage) {
      return true;
    }

    const hasResponse = firstMessage.data?.response;
    const hasUIElements =
      (firstMessage.data as Record<string, unknown>)?.uiElements &&
      Array.isArray(
        (firstMessage.data as Record<string, unknown>).uiElements
      ) &&
      ((firstMessage.data as Record<string, unknown>).uiElements as unknown[])
        .length > 0;
    const isCompleted = firstMessage.status === MessageStatus.Completed;

    // We're still waiting if the message exists but isn't ready to display
    return !(hasResponse || hasUIElements || isCompleted);
  }, [messages]);

  const waiting = isWaitingForFirstMessage();
  const shouldPoll = enabled && waiting;

  useEffect(() => {
    if (!shouldPoll || !onPoll) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start polling
    intervalRef.current = setInterval(() => {
      const refresh = conversation ? messageQuery.refetch() : onPoll();
      refresh.catch((error) => {
        logger.warn(
          "data_hooks",
          "[useConversationPolling] Conversation polling failed",
          { error }
        );
      });
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [shouldPoll, onPoll, interval]);

  return {
    isWaitingForFirstMessage: waiting,
  };
};
