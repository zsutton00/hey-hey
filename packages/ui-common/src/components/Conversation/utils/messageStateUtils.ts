import type { ConversationMessage } from "../../../types/conversation";
import {
  MessageStatus,
  MessageType,
  SecondaryActionConfigPresentationEnum,
  type MessageResponseDto,
  type SecondaryActionConfig,
} from "../../../api";
import { getFormVisibilityOverride } from "../../LlmForms/Registry/fieldResponseMetadata";
import { isEmptyExternalAgentCompletionMessage } from "../utils";
import type { SystemMessage } from "../../../api";

const hasButtonSecondaryActions = (data: unknown): boolean => {
  const actions = (data as { secondaryActions?: SecondaryActionConfig[] })
    ?.secondaryActions;
  if (!Array.isArray(actions)) {
    return false;
  }
  return actions.some(
    (action) =>
      !action.presentation ||
      action.presentation === SecondaryActionConfigPresentationEnum.Button
  );
};

const SYSTEM_PROCESSING_STATUS =
  MessageStatus?.SystemProcessing ?? "system_processing";
const STREAMING_READY_STATUS =
  MessageStatus?.StreamingReady ?? "streaming_ready";
const OPEN_STATUS = MessageStatus?.Open ?? "open";
const COMPLETED_STATUS = MessageStatus?.Completed ?? "completed";
const FAILED_STATUS = MessageStatus?.Failed ?? "failed";

/**
 * Determines whether a form should be displayed for a given message.
 * Extracted from ConversationViewer.tsx lines 1028-1052.
 *
 * @param conversationMessage - The conversation message to check
 * @param isQuestionsMessage - Whether the message is a questions type
 * @param isInitiativesMessage - Whether the message is an initiatives type
 * @returns Whether the form should be displayed
 */
export const shouldShowForm = (
  conversationMessage: ConversationMessage
): boolean => {
  const formVisibilityOverride = getFormVisibilityOverride(
    (conversationMessage.message.data as { uiElements?: unknown[] })?.uiElements
  );
  if (formVisibilityOverride) {
    return formVisibilityOverride({ conversationMessage });
  }

  const isStreamingReady =
    conversationMessage.message.status === STREAMING_READY_STATUS;

  // Don't show form if message is still processing
  // Exception: streaming_ready should show form with skeleton placeholders
  if (conversationMessage.state === "system_processing" && !isStreamingReady) {
    return false;
  }

  // streaming_ready should show form to display skeletons,
  // even before any uiElements have arrived
  if (isStreamingReady) {
    return true;
  }

  const hasUiElements = !!(
    conversationMessage.message.data as { uiElements?: unknown[] }
  )?.uiElements?.length;
  const hasButtonActions = hasButtonSecondaryActions(
    conversationMessage.message.data
  );

  if (conversationMessage.state === "completed") {
    // A workflow envelope (empty SYSTEM completion with only `agent_hidden`
    // ui and `completesExternalAgentNode`) is plumbing, not a real reply.
    // It arrives ~ms after the visible QUESTIONS message and flips its
    // `awaitingResponse` to false, dropping state to "completed". Treat
    // envelope-only followups as if the message were still awaiting —
    // otherwise the buttons on the just-emitted question disappear before
    // the user can click them.
    const responses = conversationMessage.message.responses ?? [];
    const onlyEnvelopeResponses =
      responses.length > 0 &&
      responses.every(
        (r) =>
          r.type === MessageType.System &&
          isEmptyExternalAgentCompletionMessage(r as SystemMessage)
      );
    if (onlyEnvelopeResponses) {
      return hasUiElements || hasButtonActions;
    }
    return (
      (hasUiElements || hasButtonActions) &&
      responses.some((r) => r.type === MessageType.User)
    );
  }

  // Show form for messages with UI elements or BUTTON-presentation secondary actions
  return hasUiElements || hasButtonActions;
};

/**
 * Determines message state from conversation message.
 * Extracted from ConversationViewer.tsx lines 124-145.
 *
 * @param message - The message response DTO
 * @returns The determined message state
 */
export const determineMessageState = (
  message: MessageResponseDto
): ConversationMessage["state"] => {
  const hasStatus = message.status !== undefined && message.status !== null;

  if (
    message.type === MessageType.System &&
    message.awaitingResponse &&
    hasStatus
  ) {
    return "awaiting_response";
  }

  const resolvedStatus = message.status;

  switch (resolvedStatus) {
    case SYSTEM_PROCESSING_STATUS:
      return "system_processing";
    case STREAMING_READY_STATUS:
      return "system_processing";
    case OPEN_STATUS:
      return "open";
    case COMPLETED_STATUS:
      return "completed";
    case FAILED_STATUS:
      return "error";
    default:
      return "error";
  }
};

/**
 * Helper function to check if a message is of questions type.
 *
 * @param message - The message to check
 * @returns Whether the message is a questions message
 */
export const isQuestionsMessage = (message: MessageResponseDto): boolean => {
  return (
    message.type === "SYSTEM" &&
    (message.data as { type?: string })?.type === "QUESTIONS"
  );
};
/**
 * Helper function to check if a message is of analysis type.
 *
 * @param message - The message to check
 * @returns Whether the message is an analysis message
 */
export const isAnalysisMessage = (message: MessageResponseDto): boolean => {
  return (
    message.type === "SYSTEM" &&
    (message.data as { type?: string })?.type === "ANALYSIS"
  );
};
