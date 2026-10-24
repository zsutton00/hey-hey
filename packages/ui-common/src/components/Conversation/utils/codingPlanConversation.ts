import { MessageType, type MessageResponseDto } from "../../../api";

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
