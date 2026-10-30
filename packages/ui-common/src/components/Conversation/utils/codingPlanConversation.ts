import {
  MessageStatus,
  MessageType,
  type MessageResponseDto,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";

/** Keep the planner's closing review message ahead of the document it introduces. */
export function placeCodingPlanReviewMessage(
  timeline: ConversationMessage[],
): ConversationMessage[] {
  const presented = [...timeline];
  for (let index = 0; index < presented.length - 1; index += 1) {
    const plan = presented[index];
    const review = presented[index + 1];
    if (
      !plan ||
      !review ||
      plan.message.type !== MessageType.System ||
      !plan.message.data.uiElements?.some(
        (element) => element.type === "coding_plan_version",
      ) ||
      review.message.type !== MessageType.System ||
      review.message.status !== MessageStatus.Completed ||
      review.message.data.type !== "AGENT" ||
      review.message.data.promptHandler !== "startup_session" ||
      !review.message.data.response?.trim() ||
      review.message.data.uiElements?.length ||
      review.message.reports?.length
    )
      continue;
    presented[index] = review;
    presented[index + 1] = plan;
    index += 1;
  }
  return presented;
}

/** A user reply invalidates review until a complete replacement is emitted. */
export function latestCodingPlanVersionMessageId(
  messages: readonly MessageResponseDto[],
): string | null {
  const rows = new Map<string, MessageResponseDto>();
  const visit = (messages: readonly MessageResponseDto[]) => {
    for (const message of messages) {
      rows.set(message.id, message);
      visit(message.responses ?? []);
    }
  };
  visit(messages);
  let eligible: string | null = null;
  for (const message of [...rows.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    if (message.type === MessageType.User) {
      // Workflow-answer evidence is separate from ordinary discussion.
      if (
        !message.data.workflowAnswerOperationId &&
        (message.data.agentInput?.userMessage ||
          message.data.comment ||
          message.data.response)
      )
        eligible = null;
    } else if (
      message.type === MessageType.System &&
      message.data.uiElements?.some(
        (element) => element.type === "coding_plan_version",
      )
    ) {
      eligible = message.id;
    }
  }
  return eligible;
}
