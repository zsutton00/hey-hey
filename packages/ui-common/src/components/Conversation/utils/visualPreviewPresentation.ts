import {
  ExtendedUIFieldType,
  MessageType,
  SecondaryActionHandler,
  SystemMessageDataTypeEnum,
  type AgentSystemMessageData,
  type QuestionsSystemMessageData,
  type MessageResponseDto,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { isPlanGenerationVisualPreviewPayload } from "../../LlmForms/Registry/planGenerationVisualPreviewUtils";

const isVisualPreviewMessage = (message: MessageResponseDto): boolean =>
  message.type === MessageType.System &&
  Boolean(
    message.data.uiElements?.some(
      (element) =>
        element.type === ExtendedUIFieldType.PlanGenerationVisualPreview
    )
  );

const isVisualReviewMessage = (message: MessageResponseDto): boolean =>
  message.type === MessageType.System &&
  message.data.type === SystemMessageDataTypeEnum.Questions &&
  Boolean(
    (message.data as QuestionsSystemMessageData).secondaryActions?.some(
      (action) =>
        action.handler ===
          SecondaryActionHandler.PlanGenerationVisualPreviewApprove ||
        action.handler ===
          SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising
    )
  );

const isSubmittedVisualReview = (message: MessageResponseDto): boolean =>
  isVisualReviewMessage(message) &&
  Boolean(
    message.responses?.some((response) => response.type === MessageType.User)
  );

/** Follow persisted response links, never proposal ownership or timestamps. */
const isHistoricalVisualPreview = (message: MessageResponseDto): boolean => {
  if (!isVisualPreviewMessage(message)) return false;
  if (isSubmittedVisualReview(message)) return true;
  const hasCompletedPresentation = (response: MessageResponseDto): boolean => {
    if (isVisualPreviewMessage(response) || isSubmittedVisualReview(response)) {
      return true;
    }
    return response.responses?.some(hasCompletedPresentation) ?? false;
  };
  return message.responses?.some(hasCompletedPresentation) ?? false;
};

const hasSubmittedReview = (message: MessageResponseDto): boolean =>
  isSubmittedVisualReview(message) ||
  (message.responses?.some(hasSubmittedReview) ?? false);

/** Hidden completions can be roots; their explicit trigger reference joins the round. */
export const applyVisualPreviewPresentationState = (
  timeline: ConversationMessage[],
  messages: MessageResponseDto[]
): ConversationMessage[] => {
  const submittedTriggers = new Set<string>();
  const previewTriggers = new Map<string, string>();
  const visit = (message: MessageResponseDto, triggerId?: string): void => {
    if (message.type === MessageType.System) {
      if ("triggersAgent" in message.data && message.data.triggersAgent) {
        triggerId = message.id;
      }
      // A paginated history may omit the trigger row while retaining its
      // explicit parent reference on the preview and its completion record.
      const previewTriggerId = triggerId ?? message.parentMessageId;
      // Feedback gates own their current set, including a retry after a failed
      // approval. Submitting the external completion's earlier gate must not
      // retire a replacement gate that has not itself been answered.
      if (
        isVisualPreviewMessage(message) &&
        !isVisualReviewMessage(message) &&
        previewTriggerId
      ) {
        previewTriggers.set(message.id, previewTriggerId);
      }
      const completion =
        message.data.type === SystemMessageDataTypeEnum.Agent
          ? (message.data as AgentSystemMessageData).completesExternalAgentNode
          : undefined;
      if (completion && hasSubmittedReview(message)) {
        submittedTriggers.add(completion.completesTriggerMessageId);
      }
    }
    for (const response of message.responses ?? []) visit(response, triggerId);
  };
  for (const message of messages) visit(message);
  return timeline.map((entry) => {
    const triggerId = previewTriggers.get(entry.message.id);
    const historical =
      isHistoricalVisualPreview(entry.message) ||
      (triggerId !== undefined && submittedTriggers.has(triggerId));
    return historical ? { ...entry, canEdit: false } : entry;
  });
};

/**
 * Proposal IDs of the current visual-preview round, read from the presented
 * timeline so "current" follows the same rule that makes history read-only.
 */
export const resolveCurrentVisualPreviewProposalIds = (
  timeline: ConversationMessage[]
): string[] | undefined => {
  const proposalIds = new Set<string>();
  let hasCurrentPreview = false;
  for (const entry of timeline) {
    if (!entry.canEdit || !isVisualPreviewMessage(entry.message)) continue;
    for (const element of entry.message.data.uiElements ?? []) {
      if (
        element.type !== ExtendedUIFieldType.PlanGenerationVisualPreview ||
        !isPlanGenerationVisualPreviewPayload(element.payload)
      ) {
        continue;
      }
      hasCurrentPreview = true;
      for (const { proposalId } of element.payload.entries) {
        proposalIds.add(proposalId);
      }
    }
  }
  return hasCurrentPreview ? [...proposalIds] : undefined;
};
