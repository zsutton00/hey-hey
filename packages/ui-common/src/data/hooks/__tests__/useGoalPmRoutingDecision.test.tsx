import { act, renderHook } from "@testing-library/react";
import { AxiosHeaders } from "axios";
import type { GoalPmRoutingDecisionResponseDto } from "../../../api";
import { describe, expect, it, vi } from "vitest";
import { useGoalPmRoutingDecision } from "../useGoalPmRoutingDecision";
import { suggestionsClient } from "../../../clients/serviceClients";

vi.mock("../../../clients/serviceClients", () => ({
  suggestionsClient: { recordGoalPmRoutingDecision: vi.fn() },
}));

describe("useGoalPmRoutingDecision", () => {
  it("uses only the dedicated generated operation and returns its canonical outcome", async () => {
    const decision: GoalPmRoutingDecisionResponseDto = {
      sourceConversationId: "conversation",
      sourceMessageId: "message",
      uiElementId: "field",
      selectedOption: {
        optionId: "offered",
        kind: "startNewConversation",
        title: "New thread",
        rationale: "New topic",
        requiresConfirmation: true,
      },
      decidedBy: "user",
      createdAt: "2026-09-14T10:00:00Z",
    };
    vi.mocked(suggestionsClient.recordGoalPmRoutingDecision).mockResolvedValue({
      data: {
        success: true,
        message: "Saved",
        timestamp: decision.createdAt,
        statusCode: 200,
        data: decision,
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    const { result } = renderHook(useGoalPmRoutingDecision);
    const selection = {
      sourceMessageId: "message",
      uiElementId: "field",
      selectedOptionId: "offered",
    };
    await act(async () => {
      expect(
        await result.current.mutate({
          organizationId: "org",
          conversationId: "conversation",
          selection,
        })
      ).toEqual(decision);
    });
    expect(suggestionsClient.recordGoalPmRoutingDecision).toHaveBeenCalledWith({
      organizationId: "org",
      conversationId: "conversation",
      goalPmRoutingSelectionPayload: selection,
    });
    expect(result.current.isSuccess).toBe(true);
  });
  it("exposes an API failure for a retry rather than returning a resolved choice", async () => {
    vi.mocked(suggestionsClient.recordGoalPmRoutingDecision).mockRejectedValue(
      new Error("offline")
    );
    const { result } = renderHook(useGoalPmRoutingDecision);
    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org",
          conversationId: "conversation",
          selection: {
            sourceMessageId: "message",
            uiElementId: "field",
            selectedOptionId: "offered",
          },
        })
      ).rejects.toThrow("offline");
    });
    expect(result.current.isError).toBe(true);
  });
});
