import { describe, expect, it } from "vitest";
import { buildEntityConversationPageComposition } from "./entityConversationPageComposition";

const presentation = {
  kind: "agent_session" as const,
  label: "Discuss task",
  sessionType: "ENTITY_CONVERSATION" as const,
  entityConversationRoute: {
    conversationId: "conversation-1",
    entityId: "task-1",
    entityType: "task",
  },
};

describe("buildEntityConversationPageComposition", () => {
  it("activates a non-coding entity conversation through its owning session", () => {
    expect(
      buildEntityConversationPageComposition({
        preview: false,
        agentSessionId: "session-1",
        entityType: "task",
        entityId: "task-1",
        presentation,
      }),
    ).toEqual({
      kind: "canonical",
      descriptor: {
        entityType: "agent_session",
        entityId: "session-1",
        lineage: [{ entityType: "task", entityId: "task-1" }],
        presentation,
      },
    });
  });

  it("uses plan lineage when the conversation is owned by a plan", () => {
    expect(
      buildEntityConversationPageComposition({
        preview: false,
        agentSessionId: "session-1",
        entityType: "PLAN",
        entityId: "plan-1",
        presentation,
      }),
    ).toMatchObject({
      kind: "canonical",
      descriptor: {
        lineage: [{ entityType: "plan", entityId: "plan-1" }],
      },
    });
  });

  it("keeps preview mounts observational", () => {
    expect(
      buildEntityConversationPageComposition({
        preview: true,
        agentSessionId: "session-1",
        entityType: "task",
        entityId: "task-1",
        presentation,
      }),
    ).toEqual({ kind: "observational" });
  });
});
