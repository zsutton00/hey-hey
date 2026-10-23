import { describe, it, expect, vi } from "vitest";
import { DataEventType } from "../dataEvents";
import { emitDataEvent } from "../relationshipRules";

describe("relationshipRules", () => {
  const createContext = () => ({
    invalidateWorkItem: vi.fn(),
    invalidateConversation: vi.fn(),
  });

  it("invalidates the task work item on coding session created", () => {
    const context = createContext();

    emitDataEvent(
      {
        type: DataEventType.AgentSessionCreated,
        organizationId: "org-1",
        taskId: "task-1",
        agentSessionId: "session-1",
      },
      context,
    );

    expect(context.invalidateWorkItem).toHaveBeenCalledWith("org-1", "task-1");
  });

  it("invalidates the task work item on coding session deleted", () => {
    const context = createContext();

    emitDataEvent(
      {
        type: DataEventType.AgentSessionDeleted,
        organizationId: "org-1",
        taskId: "task-1",
        agentSessionId: "session-1",
      },
      context,
    );

    expect(context.invalidateWorkItem).toHaveBeenCalledWith("org-1", "task-1");
  });

  it("invalidates the conversation on conversation updated", () => {
    const context = createContext();

    emitDataEvent(
      {
        type: DataEventType.ConversationUpdated,
        conversationId: "conv-1",
      },
      context,
    );

    expect(context.invalidateConversation).toHaveBeenCalledTimes(1);
    expect(context.invalidateConversation).toHaveBeenCalledWith("conv-1");
    expect(context.invalidateWorkItem).not.toHaveBeenCalled();
  });
});
