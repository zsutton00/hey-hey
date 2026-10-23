import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ConversationResponseDto,
  GoalPmRoutingDecisionResponseDto,
} from "../../../api";
import { useSuggestionDecisions } from "./useSuggestionDecisions";

const decision: GoalPmRoutingDecisionResponseDto = {
  sourceConversationId: "first",
  sourceMessageId: "message",
  uiElementId: "field",
  selectedOption: {
    optionId: "new",
    kind: "startNewConversation",
    title: "New conversation",
    rationale: "New topic",
    requiresConfirmation: true,
  },
  decidedBy: "user",
  createdAt: "2026-09-14T10:00:00Z",
};
const conversation = (
  id: string,
  decisions: GoalPmRoutingDecisionResponseDto[] = []
): ConversationResponseDto => ({
  id,
  projectId: "project",
  organizationId: "org",
  initiatedBy: "USER",
  status: "STARTED",
  workflowName: "goal_pm",
  version: 1,
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:00Z",
  goalPmRoutingDecisions: decisions,
});
describe("routing decision history", () => {
  it("hydrates exact message and field identities on fresh mount", () => {
    const { result } = renderHook(() =>
      useSuggestionDecisions(conversation("first", [decision]))
    );
    expect(result.current.getRoutingDecision("message", "field")).toEqual(
      decision
    );
    expect(
      result.current.getRoutingDecision("message", "other")
    ).toBeUndefined();
    expect(result.current.getRoutingDecision("other", "field")).toBeUndefined();
  });
  it("never leaks an in-flight result into another conversation", () => {
    const { result, rerender } = renderHook(
      ({ current }) => useSuggestionDecisions(current),
      { initialProps: { current: conversation("first") } }
    );
    const complete = result.current.upsertRoutingDecision;
    rerender({ current: conversation("second") });
    act(() => complete(decision));
    expect(
      result.current.getRoutingDecision("message", "field")
    ).toBeUndefined();
    rerender({ current: conversation("first") });
    expect(result.current.getRoutingDecision("message", "field")).toEqual(
      decision
    );
  });
});
