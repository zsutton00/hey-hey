import { describe, expect, it } from "vitest";
import { buildEntityConversationPath } from "./entityConversationRoute";

describe("buildEntityConversationPath", () => {
  it("builds a canonical entity-conversation path from an owning session", () => {
    expect(
      buildEntityConversationPath("project-1", {
        agentSessionId: "session-1",
        conversationId: "conversation-1",
        entityId: "plan-1",
        entityType: "PLAN",
      }),
    ).toBe(
      "/projects/project-1/agent-sessions/session-1/entity-conversations/conversation-1?entityId=plan-1&entityType=PLAN",
    );
  });

  it("returns no canonical path when the session is not fully linked", () => {
    expect(
      buildEntityConversationPath("project-1", {
        agentSessionId: "session-1",
        conversationId: null,
        entityId: "plan-1",
        entityType: "PLAN",
      }),
    ).toBeNull();
  });
});
