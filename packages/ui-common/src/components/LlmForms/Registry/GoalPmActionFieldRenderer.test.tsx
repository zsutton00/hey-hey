import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../../../i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalPmRoutingEnactmentResponse } from "../../../api";
import { GoalPmActionFieldRenderer } from "./GoalPmActionFieldRenderer";
const mocks = vi.hoisted(() => ({
  enact: vi.fn(),
  getRoutingDecision: vi.fn(),
  openConversation: vi.fn(),
}));
const creation = vi.hoisted(() => ({
  config: {
    type: "ENTITY_CONVERSATION" as const,
    version: "v1" as const,
    model: "model-1",
    effort: "high" as const,
  },
  provider: "claude" as const,
  machineId: "machine-1",
  fastMode: true,
}));
vi.mock("./GoalPmNewConversationAction", () => ({
  GoalPmNewConversationAction: ({
    disabled,
    optionId,
    label,
    onStart,
  }: {
    disabled: boolean;
    optionId: string;
    label: string;
    onStart: (creation: typeof creation) => void;
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
vi.mock("../../Conversation/Components/ConversationContext", () => ({
  useConversationContext: () => ({
    activeConversation: { id: "conversation" },
    onGoalPmAction: mocks.enact,
    suggestionDecisions: { getRoutingDecision: mocks.getRoutingDecision },
    goalPmConversationLink: {
      href: (id: string) => `/goal?tab=goal&conversation=${id}`,
      onOpen: mocks.openConversation,
    },
  }),
}));
const option = {
  optionId: "new",
  kind: "startNewConversation" as const,
  title: "New thread",
  rationale: "New topic",
  requiresConfirmation: true as const,
};
const result: GoalPmRoutingEnactmentResponse = {
  sourceConversationId: "conversation",
  sourceMessageId: "message",
  uiElementId: "route",
  answerMessageId: "answer",
  answer: {
    type: "GOAL_PM_ROUTING",
    selectedOption: option,
    operationId: "operation",
    state: "COMPLETED",
    requestedAt: "2026-09-27T00:00:00Z",
    pendingRequest: "Discuss",
    outcome: {
      entityType: "CONVERSATION",
      entityId: "destination",
      title: "New thread",
    },
  },
};
const props = {
  config: {
    field: "route",
    description: "",
    type: "goal_pm_action",
    payload: { goalId: "goal", options: [option] },
  },
  context: {
    conversationId: "conversation",
    messageId: "message",
    projectId: "project",
    organizationId: "org",
    interaction: { proposals: [] },
  },
};
describe("GoalPmActionFieldRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoutingDecision.mockReturnValue(undefined);
  });
  it("passes canonical source identity, prevents double clicks, and returns the actual answer to the form", async () => {
    let resolve!: (result: GoalPmRoutingEnactmentResponse) => void;
    mocks.enact.mockImplementation(
      () =>
        new Promise<GoalPmRoutingEnactmentResponse>((done) => {
          resolve = done;
        }),
    );
    const onChange = vi.fn();
    const view = render(
      <GoalPmActionFieldRenderer {...props} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    expect(mocks.enact).toHaveBeenCalledExactlyOnceWith(
      {
        sourceMessageId: "message",
        uiElementId: "route",
        selectedOptionId: "new",
      },
      "conversation",
      creation,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Applying");
    resolve(result);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(result.answer));
    view.rerender(
      <GoalPmActionFieldRenderer
        {...props}
        value={result.answer}
        onChange={onChange}
        isSubmitted
      />,
    );
    expect(
      await screen.findByTestId("goal-pm-created-conversation-link"),
    ).toHaveAttribute("href", "/goal?tab=goal&conversation=destination");
  });
  it("shows failure and retries the same source identity without claiming success", async () => {
    mocks.enact
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(result);
    render(<GoalPmActionFieldRenderer {...props} />);
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    await screen.findByText("Response lost");
    expect(
      screen.queryByTestId("goal-pm-recorded-choice"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("goal-pm-record-choice"));
    await waitFor(() => expect(mocks.enact).toHaveBeenCalledTimes(2));
    expect(mocks.enact.mock.calls[0]).toEqual(mocks.enact.mock.calls[1]);
  });
  it("opens the created conversation through the host link from a restored answer", () => {
    render(<GoalPmActionFieldRenderer {...props} value={result.answer} />);
    const link = screen.getByTestId("goal-pm-created-conversation-link");
    expect(link).toHaveAttribute(
      "href",
      "/goal?tab=goal&conversation=destination",
    );
    fireEvent.click(link);
    expect(mocks.openConversation).toHaveBeenCalledExactlyOnceWith(
      "destination",
    );
  });
  it("renders the runtime-start action only for new-conversation options", () => {
    const refine = {
      optionId: "refine",
      kind: "refineSearch" as const,
      title: "Refine",
      rationale: "Narrow it",
      requiresConfirmation: true as const,
    };
    render(
      <GoalPmActionFieldRenderer
        {...props}
        config={{
          ...props.config,
          payload: { goalId: "goal", options: [option, refine] },
        }}
      />,
    );
    const buttons = screen.getAllByTestId("goal-pm-record-choice");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(mocks.enact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ selectedOptionId: "refine" }),
      "conversation",
      undefined,
    );
  });

  it("disables the start action once a choice is recorded", () => {
    render(
      <GoalPmActionFieldRenderer
        {...props}
        value={{ ...result.answer, state: "PENDING", outcome: undefined }}
      />,
    );
    expect(screen.getByTestId("goal-pm-record-choice")).toBeDisabled();
  });
});
