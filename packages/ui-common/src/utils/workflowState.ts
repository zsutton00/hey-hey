import type { TFunction } from "i18next";
import type { ConversationResponseDto, MessageResponseDto } from "../api";
import { KEYS } from "../i18n/keys";
import type { WorkflowMetadata, WorkflowState } from "../types/WorkflowState";

type ConversationWithMetadata = ConversationResponseDto & {
  metadata?: WorkflowMetadata;
};

function deriveWorkflowState(
  conversation: ConversationResponseDto,
  messages: readonly MessageResponseDto[],
  t: TFunction<"translation", undefined>,
): WorkflowState {
  if (!messages || messages.length === 0) {
    return {
      status: "ready",
      message: "Ready to start",
      canSubmit: true,
      showLoader: false,
    };
  }

  const lastMessage = messages[messages.length - 1];

  // System is waiting for user response. This must override conversation-level
  // "completed" status because coding prompt projections can surface a follow-up
  // question in the latest message while conversation.status remains COMPLETED.
  if (
    lastMessage?.type === "SYSTEM" &&
    "awaitingResponse" in lastMessage &&
    lastMessage.awaitingResponse
  ) {
    return {
      status: "waiting_for_user",
      message: "Ready for your response",
      canSubmit: true,
      showLoader: false,
    };
  }

  // Conversation level status check — keep canSubmit true for COMPLETED
  // because genuinely submitted forms are already locked at the message level
  // via canEdit. Blocking here would lock timed-out but unsubmitted forms.
  if (conversation.status === "COMPLETED") {
    return {
      status: "completed",
      message: "Workflow completed",
      canSubmit: true,
      showLoader: false,
    };
  }

  if (conversation.status === "FAILED") {
    return {
      status: "failed",
      message: "Workflow failed",
      canSubmit: false,
      showLoader: false,
    };
  }

  // System is actively processing
  if (lastMessage?.status === "system_processing") {
    return {
      status: "system_processing",
      message: "Thinking...",
      canSubmit: false,
      showLoader: true,
    };
  }

  // User submitted, but no system response yet (or system response is still processing)
  if (lastMessage?.type === "USER" && lastMessage.status === "open") {
    return {
      status: "system_processing",
      message: t(KEYS.common.processing),
      canSubmit: false,
      showLoader: false,
    };
  }

  // User message failed
  if (lastMessage?.type === "USER" && lastMessage.status === "failed") {
    return {
      status: "failed",
      message: "Failed to process your response",
      canSubmit: true,
      showLoader: false,
    };
  }

  // Default to ready state
  return {
    status: "ready",
    message: "Ready",
    canSubmit: true,
    showLoader: false,
  };
}

export function getMultiplayerWorkflowState(
  conversation: ConversationResponseDto,
  messages: readonly MessageResponseDto[],
  currentUserId: string,
  t: TFunction<"translation", undefined>,
): WorkflowState {
  const baseState = deriveWorkflowState(conversation, messages, t);

  // Extract workflow metadata from conversation metadata
  const metadata =
    "metadata" in conversation
      ? (conversation as ConversationWithMetadata).metadata
      : undefined;
  const processor = metadata?.currentProcessor;

  // If system is processing and someone else submitted
  if (
    baseState.status === "system_processing" &&
    processor &&
    processor !== currentUserId
  ) {
    return {
      ...baseState,
      message: `AI is responding to another user's submission...`,
      canSubmit: false,
      processingUser: processor,
    };
  }

  return baseState;
}
