import { describe, expect, it, vi } from "vitest";
import { MessageType } from "../../../api/index";
import {
  dispatchMethodAction,
  type MethodActionContext,
} from "../methodActionDispatch";
import type { AgentSessionInteractions } from "../operations/AgentOperationCoordinator";

const createMockInteractions = (): {
  interactions: AgentSessionInteractions;
  submitMessage: ReturnType<typeof vi.fn>;
} => {
  const submitMessage = vi.fn().mockResolvedValue({
    operationId: "operation-1",
    fingerprint: "a".repeat(64),
    kind: "submit_message",
    state: "succeeded",
    messageId: "message-1",
    triggerMessageId: "trigger-1",
  });
  return {
    interactions: {
      startSession: vi.fn(),
      submitMessage,
    },
    submitMessage,
  };
};

const createContext = (
  overrides?: Partial<MethodActionContext>
): MethodActionContext => ({
  organizationId: "org-1",
  projectId: "proj-1",
  conversationId: "conv-1",
  agentSessionId: "agent-session-1",
  ...overrides,
});

describe("dispatchMethodAction", () => {
  it("dispatches final_assessment as a payload-free agentInput arm", async () => {
    const { interactions, submitMessage } = createMockInteractions();
    const context = createContext();

    await dispatchMethodAction(
      "final_assessment",
      interactions,
      "run-1",
      context
    );

    expect(submitMessage).toHaveBeenCalledTimes(1);
    const {
      organizationId: orgId,
      projectId,
      intent: message,
    } = submitMessage.mock.calls[0]![0];
    expect(orgId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    const body = message as Record<string, unknown>;
    expect(body.projectId).toBe("proj-1");
    expect(body.conversationId).toBe("conv-1");
    expect(body.type).toBe(MessageType.User);
    expect(body.parentMessageId).toBeNull();
    // `final_assessment` is a payload-free arm: the dispatch envelope rides
    // `data.agentInput` and carries only the routing `promptType`. No top-level
    // `promptType`/`payload`, and no `data.triggersAgent`.
    expect(body.data).toEqual({
      agentInput: { promptType: "final_assessment" },
      references: { resolved: [], unresolved: [] },
    });
    const data = body.data as Record<string, unknown>;
    expect(data.triggersAgent).toBeUndefined();
  });

  it("throws for unknown method names", async () => {
    const { interactions, submitMessage } = createMockInteractions();
    const context = createContext();

    await expect(
      dispatchMethodAction("nonexistent_method", interactions, "run-1", context)
    ).rejects.toThrow("Unknown method action: nonexistent_method");

    expect(submitMessage).not.toHaveBeenCalled();
  });

  it("propagates errors from postMessage", async () => {
    const { interactions, submitMessage } = createMockInteractions();
    const context = createContext();
    const error = new Error("Network failure");
    submitMessage.mockRejectedValue(error);

    await expect(
      dispatchMethodAction("final_assessment", interactions, "run-1", context)
    ).rejects.toThrow("Network failure");
  });
});
