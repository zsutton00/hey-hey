import { AgentSessionType, type AgentSessionDto } from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import { buildAgentSessionPresentation } from "./agentSessionPresentation";

describe("buildAgentSessionPresentation", () => {
  it("keeps only row-critical Agent Session fields", () => {
    const agentSession = {
      id: "session-1",
      title: "Discuss retries",
      type: AgentSessionType.EntityConversation,
      conversationId: "conversation-1",
      entityId: "task-1",
      entityType: "TASK",
      service: { id: "service-1", name: "API" },
      launchServiceId: "service-1",
      messages: [{ content: "must not persist" }],
    } as unknown as AgentSessionDto;

    expect(buildAgentSessionPresentation(agentSession)).toEqual({
      kind: "agent_session",
      label: "API - Discuss retries",
      sessionType: AgentSessionType.EntityConversation,
      entityConversationRoute: {
        conversationId: "conversation-1",
        entityId: "task-1",
        entityType: "TASK",
      },
    });
  });

  it("does not label a session from a non-launch embedded service", () => {
    const agentSession = {
      title: "Fix retries",
      type: AgentSessionType.Coding,
      launchServiceId: "launch-service",
      service: { id: "linked-service", name: "Wrong service" },
    } as unknown as AgentSessionDto;

    expect(buildAgentSessionPresentation(agentSession).label).toBe(
      "Fix retries",
    );
  });
});
