import React from "react";
import type { SxProps, Theme } from "@mui/material";
import { useTranslation } from "react-i18next";
import { SystemMessage } from "./SystemMessage";
import { useMessageRetry } from "../../../hooks/useMessageRetry";
import { KEYS } from "../../../i18n/keys";
import type {
  MessageResponseDto,
  ProjectResponseDto,
  UIHints,
  SystemMessageData,
  ReportDto,
} from "../../../api";
import { MessageStatus } from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";

interface SystemMessageWithRetryProps {
  animationType: "fun" | "minimal";
  enableTypingAnimation?: boolean;
  message: MessageResponseDto;
  state: ConversationMessage["state"];
  project: ProjectResponseDto;
  onRetrySuccess: () => Promise<void>;
  uiHints?: UIHints;
  /** Preserve data-testid for existing tests */
  "data-testid"?: string;
  renderTimestamp: boolean;
  sx?: SxProps<Theme>;
  /** Inline reports to render inside the SystemMessage */
  inlineReports?: ReportDto[];
}

/**
 * System message component with retry functionality for failed messages.
 * Extracted from ConversationViewer.tsx - handles retry functionality for failed messages.
 *
 * @param props - Component props
 * @returns JSX element with system message and retry capability
 */
export const SystemMessageWithRetry: React.FC<SystemMessageWithRetryProps> = ({
  animationType,
  enableTypingAnimation = true,
  message,
  state,
  project,
  uiHints,
  onRetrySuccess,
  "data-testid": dataTestId,
  renderTimestamp,
  sx,
  inlineReports,
}) => {
  const { t } = useTranslation();
  const isFailed = state === "error";
  const showStreamingSkeleton = message.status === MessageStatus.StreamingReady;

  // Use retry hook for failed system messages
  const retryState = useMessageRetry({
    organizationId: project.organizationId,
    projectId: project.id,
    messageId: message.id,
    onRetrySuccess,
    onRetryError: (error) => {
      console.error("Failed to retry message:", error);
    },
  });

  return (
    <SystemMessage
      animationType={animationType}
      enableTypingAnimation={enableTypingAnimation}
      text={message.data?.response || ""}
      isThinking={state === "system_processing" && !message.responses?.length}
      isCompleted={state === "completed"}
      awaitingResponse={state === "awaiting_response"}
      isFailed={isFailed}
      thinkingMessage={t(KEYS.common.processing)}
      retryState={isFailed ? retryState : undefined}
      showLoadingGames={(uiHints?.estimatedDelayMs ?? 0) > 15000}
      type={message.data.type ?? "N/A"}
      errorMessage={
        isFailed ? t(KEYS.conversation.systemMessageFailed) : undefined
      }
      messageData={message.data as SystemMessageData | undefined}
      showStreamingSkeleton={showStreamingSkeleton}
      data-testid={dataTestId}
      renderTimestamp={renderTimestamp}
      sx={sx}
      inlineReports={inlineReports}
    />
  );
};
