import {
  MessageStatus,
  MessageType,
  type MessageResponseDto,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";

const isCodingPlanVersion = (item: ConversationMessage): boolean =>
  item.message.type === MessageType.System &&
  !!item.message.data.uiElements?.some(
    (element) => element.type === "coding_plan_version",
  );

const isPlannerClosingMessage = (item: ConversationMessage): boolean =>
  item.message.type === MessageType.System &&
  item.message.status === MessageStatus.Completed &&
  item.message.data.type === "AGENT" &&
  item.message.data.promptHandler === "startup_session" &&
  !!item.message.data.response?.trim() &&
  !item.message.data.uiElements?.length &&
  !item.message.reports?.length;

/**
 * Show the planner's closing message, then the plan it introduces. Progress
 * messages may sit between them, so the plan moves behind the last closing
 * message before the next plan version or user message.
 */
export function placeCodingPlanReviewMessage(
  timeline: ConversationMessage[],
): ConversationMessage[] {
  const presented = [...timeline];

  for (let planIndex = 0; planIndex < presented.length; planIndex += 1) {
    const plan = presented[planIndex];
    if (!plan || !isCodingPlanVersion(plan)) {
      continue;
    }

    let closingIndex = -1;
    for (let next = planIndex + 1; next < presented.length; next += 1) {
      const candidate = presented[next];
      if (
        !candidate ||
        isCodingPlanVersion(candidate) ||
        candidate.message.type === MessageType.User
      ) {
        break;
      }
      if (isPlannerClosingMessage(candidate)) {
        closingIndex = next;
      }
    }
    if (closingIndex === -1) {
      continue;
    }

    presented.splice(planIndex, 1);
    presented.splice(closingIndex, 0, plan);
    planIndex = closingIndex;
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
