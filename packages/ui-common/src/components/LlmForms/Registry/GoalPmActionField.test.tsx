import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { MemoryRouter } from "react-router-dom";
import type { GoalPmRoutingAnswer, GoalPmRoutingOption } from "../../../api";
import { GoalPmActionField } from "./GoalPmActionField";
const option = {
  optionId: "new",
  kind: "startNewConversation",
  title: "New thread",
  rationale: "Distinct topic",
  requiresConfirmation: true,
} satisfies GoalPmRoutingOption;
const answer: GoalPmRoutingAnswer = {
  type: "GOAL_PM_ROUTING",
  selectedOption: option,
  operationId: "operation",
  state: "COMPLETED",
  requestedAt: "2026-09-27T00:00:00Z",
  pendingRequest: "Discuss it",
  outcome: {
    entityType: "CONVERSATION",
    entityId: "destination",
    title: "New thread",
  },
};
const creation = {
  config: {
    type: "ENTITY_CONVERSATION" as const,
    version: "v1" as const,
    model: "model-1",
  },
  provider: "claude" as const,
  machineId: "machine-1",
};
vi.mock("./GoalPmNewConversationAction", () => ({
  GoalPmNewConversationAction: ({
    disabled,
    label,
    optionId,
    onStart,
  }: {
    disabled: boolean;
    label: string;
    optionId: string;
    onStart: (creation: unknown) => void;
  }) => (
    <button
      data-testid="goal-pm-record-choice"
      data-option-id={optionId}
      disabled={disabled}
      onClick={() => onStart(creation)}
    >
      {label}
    </button>
  ),
}));
describe("GoalPmActionField", () => {
  it("selects creation immediately without a confirmation or saved-choice continuation", () => {
    const onSelect = vi.fn();
    render(
      <GoalPmActionField
        organizationId="org"
        projectId="project"
        payload={{ goalId: "goal", options: [option] }}
        onSelect={onSelect}
      />,
    );
    const card = screen.getByRole("region", { name: "New thread" });
    expect(within(card).getByText("New Conversation")).toBeInTheDocument();
    expect(
      within(card).getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Distinct topic")).toBeInTheDocument();
    fireEvent.click(
      within(card).getByRole("button", {
        name: "Start Conversation",
      }),
    );
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(option, creation);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Continue with saved choice"),
    ).not.toBeInTheDocument();
  });
  it.each([
    {
      option: {
        kind: "existingConversation",
        optionId: "existing",
        conversationId: "conversation",
        title: "Research",
        rationale: "Relevant findings",
        evidence: [],
      },
      type: "Existing Conversation",
      title: "Research",
      action: "Continue Conversation",
    },
    {
      option: {
        kind: "refineSearch",
        optionId: "refine",
        title: "Find customer research",
        prompt: "Search customers",
        rationale: "Narrow the search",
      },
      type: "Refine Search",
      title: "Find customer research",
      action: "Refine Search",
    },
    {
      option: {
        kind: "trackExistingWork",
        optionId: "track",
        target: {
          entityType: "TASK",
          entityId: "task",
          title: "Customer interviews",
        },
        rationale: "Supports the goal",
        requiresSelection: true,
      },
      type: "Existing Work",
      title: "Customer interviews",
      action: "Track Work",
    },
    {
      option: {
        kind: "createMissingWork",
        optionId: "create",
        title: "Interview customers",
        parentFeatureId: "feature",
        workItemType: "TASK",
        description: "Gather feedback",
        acceptanceCriteria: "Record findings",
        authoringMode: "PROPOSAL",
        rationale: "Missing research",
        requiresSelection: true,
      },
      type: "New Task",
      title: "Interview customers",
      action: "Review Proposed Task",
    },
    {
      option: {
        kind: "proposal",
        optionId: "proposal",
        proposalId: "proposal",
        title: "Research scope",
        rationale: "Review scope",
        requiresSelection: true,
      },
      type: "Proposal",
      title: "Research scope",
      action: "Review Proposal",
    },
  ] satisfies Array<{
    option: GoalPmRoutingOption;
    type: string;
    title: string;
    action: string;
  }>)(
    "presents $type with a separate title and action",
    ({ option, type, title, action }) => {
      const onSelect = vi.fn();
      render(
        <GoalPmActionField
          payload={{ goalId: "goal", options: [option] }}
          onSelect={onSelect}
        />,
      );
      const card = within(screen.getByRole("region", { name: title }));
      expect(card.getAllByText(type).length).toBeGreaterThan(0);
      expect(card.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(card.getByText(option.rationale)).toBeInTheDocument();
      fireEvent.click(card.getByRole("button", { name: action }));
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(option);
    },
  );
  it("restores the actual destination and keeps completed history immutable", () => {
    const onSelect = vi.fn();
    render(
      <GoalPmActionField
        payload={{
          goalId: "goal",
          options: [
            option,
            { ...option, optionId: "alternative", title: "Another thread" },
          ],
        }}
        answer={answer}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId("goal-pm-recorded-choice")).toHaveTextContent(
      "Selected: New thread. Completed.",
    );
    expect(
      screen.getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
    const created = screen.getByRole("button", { name: "Created" });
    expect(created).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Start Conversation" }),
    ).toBeDisabled();
    fireEvent.click(created);
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("goal-pm-retry-handoff"),
    ).not.toBeInTheDocument();
  });
  it("links a restored completed answer to the conversation it created", () => {
    const onOpenConversation = vi.fn();
    render(
      <GoalPmActionField
        payload={{ goalId: "goal", options: [option] }}
        answer={answer}
        conversationHref={(id) => `/goals/goal?tab=goal&conversation=${id}`}
        onOpenConversation={onOpenConversation}
        onSelect={vi.fn()}
      />,
    );
    const link = screen.getByTestId("goal-pm-created-conversation-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute(
      "href",
      "/goals/goal?tab=goal&conversation=destination",
    );
    expect(link).toHaveTextContent("Open conversation");
    expect(
      screen.queryByTestId("goal-pm-recorded-choice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Created" }),
    ).not.toBeInTheDocument();
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpenConversation).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onOpenConversation).toHaveBeenCalledExactlyOnceWith("destination");
  });
  it("renders mentions in the rationale as mention badges, not raw tokens", () => {
    render(
      <MemoryRouter>
        <GoalPmActionField
          payload={{
            goalId: "goal",
            options: [
              {
                ...option,
                rationale:
                  "Discuss the crafting system for @[task:5dc54af0-7074-413f-89b1-b11fe54661c2|test].",
              },
            ],
          }}
          onSelect={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/@\[task:/)).not.toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
  });
  it("does not link a pending answer", () => {
    render(
      <GoalPmActionField
        payload={{ goalId: "goal", options: [option] }}
        answer={{ ...answer, state: "PENDING" }}
        conversationHref={(id) => `/goal?conversation=${id}`}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("goal-pm-created-conversation-link"),
    ).not.toBeInTheDocument();
  });
  it("retains evidence and offers recovery only for an unfinished request", () => {
    const existing = {
      kind: "existingConversation",
      optionId: "existing",
      conversationId: "other",
      title: "Research",
      rationale: "Relevant",
      evidence: [
        {
          messageId: "evidence",
          excerpt: "Customer findings",
          rationale: "Same subject",
        },
      ],
    } satisfies GoalPmRoutingOption;
    const onSelect = vi.fn();
    render(
      <GoalPmActionField
        payload={{ goalId: "goal", options: [existing, option] }}
        answer={{ ...answer, state: "PENDING" }}
        canRetry
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("“Customer findings”")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Created" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("goal-pm-recorded-choice")).toHaveTextContent(
      "Request completion is pending.",
    );
    fireEvent.click(screen.getByTestId("goal-pm-retry-handoff"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(option);
  });
  it("does not replay legacy decisions", () => {
    const onSelect = vi.fn();
    render(
      <GoalPmActionField
        payload={{ goalId: "goal", options: [option] }}
        legacy
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText(/cannot be replayed/)).toBeInTheDocument();
    expect(screen.getByTestId("goal-pm-record-choice")).toBeDisabled();
  });
});
