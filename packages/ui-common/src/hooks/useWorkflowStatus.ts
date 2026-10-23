import { useMemo } from "react";
import type { WorkflowState } from "../types/WorkflowState";
import { getMultiplayerWorkflowState } from "../utils/workflowState";
import type { ConversationResponseDto, MessageResponseDto } from "../api";
import { useTranslation } from "react-i18next";

interface UseWorkflowStatusProps {
  conversation?: ConversationResponseDto;
  messages: readonly MessageResponseDto[];
  currentUserId: string;
  isLoading?: boolean;
}

export function useWorkflowStatus({
  conversation,
  messages,
  currentUserId,
  isLoading = false,
}: UseWorkflowStatusProps): WorkflowState {
  const { t } = useTranslation();
  return useMemo(() => {
    if (isLoading || !conversation) {
      return {
        status: "loading",
        message: "Loading workflow status...",
        canSubmit: false,
        showLoader: true,
      };
    }

    return getMultiplayerWorkflowState(
      conversation,
      messages,
      currentUserId,
      t
    );
  }, [conversation, messages, currentUserId, isLoading, t]);
}
