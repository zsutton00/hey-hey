import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalPmRoutingEnactmentResponse } from "../../../api";
import { useGoalPmRoutingEnactment } from "../useGoalPmRoutingEnactment";

const mocks = vi.hoisted(() => ({
  enact: vi.fn(),
  complete: vi.fn(),
  start: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  suggestionsClient: {
    enactGoalPmRoutingChoice: mocks.enact,
    completeGoalPmRoutingChoice: mocks.complete,
  },
}));
vi.mock(
  "../../../components/AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({
      getAccess: () => ({
        isDeviceEnabled: true,
        interactions: {
          startSession: mocks.start,
          submitMessage: mocks.submit,
        },
      }),
    }),
  }),
);
const receipt: GoalPmRoutingEnactmentResponse = {
  sourceConversationId: "source",
  sourceMessageId: "source-message",
  uiElementId: "route",
  answerMessageId: "answer",
  answer: {
    type: "GOAL_PM_ROUTING",
    operationId: "stable-operation",
    state: "PENDING",
    requestedAt: "2026-09-27T00:00:00Z",
    pendingRequest: "Discuss the launch",
    selectedOption: {
      kind: "startNewConversation",
      optionId: "new",
      title: "Launch",
      rationale: "New topic",
      requiresConfirmation: true,
    },
    creation: {
      provider: "claude",
      machineId: "machine",
      config: {
        type: "ENTITY_CONVERSATION",
        version: "v1",
        model: "selected-model",
        effort: "medium",
      },
    },
    outcome: {
      entityType: "CONVERSATION",
      entityId: "destination",
      agentSessionId: "session",
      title: "Launch",
    },
  },
};
const variables = {
  organizationId: "org",
  projectId: "project",
  goalId: "goal",
  sourceConversationId: "source",
  input: {
    selection: {
      sourceMessageId: "source-message",
      uiElementId: "route",
      selectedOptionId: "new",
    },
  },
};
describe("useGoalPmRoutingEnactment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enact.mockResolvedValue({ data: { data: receipt } });
    mocks.complete.mockResolvedValue({
      data: {
        data: { ...receipt, answer: { ...receipt.answer, state: "COMPLETED" } },
      },
    });
    mocks.start.mockResolvedValue({ state: "succeeded" });
    mocks.submit.mockResolvedValue({ state: "succeeded" });
  });
  it.each(["succeeded", "accepted"])(
    "uses the Discuss launcher boundary with persisted settings and the actual destination (%s)",
    async (state) => {
      mocks.start.mockResolvedValue({ state });
      const { result } = renderHook(useGoalPmRoutingEnactment);
      await act(async () => {
        await result.current.mutate(variables);
      });
      expect(mocks.start).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "destination",
          agentSessionId: "session",
          operationId: "stable-operation",
          intent: expect.objectContaining({
            payload: expect.objectContaining({
              userMessage: "Discuss the launch",
            }),
            model: "selected-model",
            initialMessage: { role: "USER" },
          }),
        }),
      );
      expect(mocks.complete).toHaveBeenCalledTimes(1);
      expect(mocks.submit).not.toHaveBeenCalled();
    },
  );
  it("recovers after a lost completion response and remount using exactly the same request identity and payload", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("Response lost"));
    const first = renderHook(useGoalPmRoutingEnactment);
    await act(async () => {
      await expect(first.result.current.mutate(variables)).rejects.toThrow(
        "Response lost",
      );
    });
    first.unmount();
    const second = renderHook(useGoalPmRoutingEnactment);
    await act(async () => {
      await second.result.current.mutate(variables);
    });
    expect(mocks.start.mock.calls[0]).toEqual(mocks.start.mock.calls[1]);
  });
  it("does not execute completed history again", async () => {
    mocks.enact.mockResolvedValue({
      data: {
        data: { ...receipt, answer: { ...receipt.answer, state: "COMPLETED" } },
      },
    });
    const { result } = renderHook(useGoalPmRoutingEnactment);
    await act(async () => {
      await result.current.mutate(variables);
    });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("retains the pending result when controller authorization is cancelled", async () => {
    mocks.start.mockResolvedValue({ state: "cancelled" });
    const { result } = renderHook(useGoalPmRoutingEnactment);
    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "conversation is saved",
      );
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each(["succeeded", "accepted"])(
    "sends refinement to the persisted standing conversation through normal input admission (%s)",
    async (state) => {
      mocks.submit.mockResolvedValue({ state });
      mocks.enact.mockResolvedValue({
        data: {
          data: {
            ...receipt,
            answer: {
              ...receipt.answer,
              selectedOption: {
                kind: "refineSearch",
                optionId: "refine",
                title: "Refine",
                prompt: "Search by customer",
                rationale: "Narrow results",
              },
              outcome: {
                entityType: "CONVERSATION",
                entityId: "source",
                agentSessionId: "pm-session",
                title: "Goal PM",
              },
            },
          },
        },
      });
      const { result } = renderHook(useGoalPmRoutingEnactment);
      await act(async () => {
        await result.current.mutate(variables);
      });
      expect(mocks.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "source",
          agentSessionId: "pm-session",
          intent: expect.objectContaining({
            data: {
              agentInput: {
                promptType: "goal_pm",
                entity: {
                  entityType: "TASK",
                  entityId: "goal",
                  taskType: "GOAL",
                },
                userMessage: "Search by customer",
              },
            },
          }),
        }),
      );
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );
});
