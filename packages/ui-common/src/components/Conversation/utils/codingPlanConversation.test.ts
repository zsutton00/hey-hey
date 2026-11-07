import { describe, expect, it } from "vitest";
import {
  MessageStatus,
  MessageType,
  type MessageResponseDto,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { placeCodingPlanReviewMessage } from "./codingPlanConversation";

const system = (
  id: string,
  data: Record<string, unknown>,
): ConversationMessage => ({
  message: {
    id,
    projectId: "project",
    conversationId: "conversation",
    createdAt: "2026-09-28T00:00:00Z",
    type: MessageType.System,
    status: MessageStatus.Completed,
    responses: [],
    data,
  } as unknown as MessageResponseDto,
  state: "completed",
  canEdit: false,
});
const plan = system("plan", {
  type: "QUESTIONS",
  uiElements: [{ id: "plan", type: "coding_plan_version" }],
});
const agent = (id: string) =>
  system(id, { type: "AGENT", promptHandler: "startup_session", response: id });
const ids = (timeline: ConversationMessage[]) =>
  timeline.map((item) => item.message.id);

describe("placeCodingPlanReviewMessage", () => {
  it("shows the closing message before the plan even with a progress message between them", () => {
    const placed = placeCodingPlanReviewMessage([
      plan,
      agent("progress"),
      agent("closing"),
    ]);

    expect(ids(placed)).toEqual(["progress", "closing", "plan"]);
  });

  it("keeps a plan with no closing message where it is", () => {
    expect(ids(placeCodingPlanReviewMessage([plan]))).toEqual(["plan"]);
  });
});
