import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MentionPopup } from "../SmarterTextAreaCard/MentionPopup";
import type { SearchEntity } from "../SmarterTextAreaCard/types";
import { INLINE_SEARCH_RESULTS_FRESHNESS } from "../SmarterTextAreaCard/inlineSearchResults";

vi.mock("../../contexts/ModalService", () => ({
  useModalService: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | { defaultValue?: string }
    ) => {
      if (typeof fallbackOrOptions === "string") {
        return fallbackOrOptions;
      }
      if (
        fallbackOrOptions &&
        typeof fallbackOrOptions === "object" &&
        "defaultValue" in fallbackOrOptions
      ) {
        return fallbackOrOptions.defaultValue ?? key;
      }
      return key;
    },
  }),
}));

const mockSearchResults: SearchEntity[] = [
  {
    id: "1",
    type: "task",
    name: "John Doe",
    description: "Software Engineer",
  },
  {
    id: "2",
    type: "initiative",
    name: "Project Alpha",
    description: "Main project",
  },
  {
    id: "3",
    type: "task",
    name: "Jane Smith",
    description: "Product Manager",
  },
];

const settledResultsFreshness = INLINE_SEARCH_RESULTS_FRESHNESS.settled;

describe("MentionPopup", () => {
  it("renders with type dropdown defaulted to task", () => {
    render(
      <MentionPopup
        query=""
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={[]}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /advanced search/i })
    ).toBeInTheDocument();
  });

  it("displays search results as clickable list items", async () => {
    const handleSelect = vi.fn();

    render(
      <MentionPopup
        query="john"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={mockSearchResults}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={handleSelect}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();

    const firstResult = screen.getByText("John Doe");
    expect(firstResult).toBeInTheDocument();

    await userEvent.click(firstResult);
    expect(handleSelect).toHaveBeenCalledWith(mockSearchResults[0]);
  });

  it("shows loading spinner during search", () => {
    render(
      <MentionPopup
        query="test"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={[]}
        isLoading={true}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("keeps common matches visible while primary search is loading", () => {
    const commonMatches: SearchEntity[] = [
      { id: "svc-api", type: "service", name: "API" },
    ];

    render(
      <MentionPopup
        query="API"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={[]}
        commonMatches={commonMatches}
        isLoading={true}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("mention-common-matches")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("keeps stale results visible during refinement while blocking row selection", () => {
    const handleSelect = vi.fn();
    const handleSelectionChange = vi.fn();

    render(
      <MentionPopup
        query="john d"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={mockSearchResults}
        isLoading={true}
        resultsFreshness={INLINE_SEARCH_RESULTS_FRESHNESS.staleWhileUpdating}
        onSelectEntity={handleSelect}
        selectedIndex={0}
        onSelectedIndexChange={handleSelectionChange}
      />
    );

    expect(screen.getByTestId("mention-popup-updating")).toBeInTheDocument();
    expect(screen.queryByText("No matches found")).not.toBeInTheDocument();

    const firstResult = screen.getAllByTestId("mention-result-row")[0];
    expect(firstResult).toHaveAttribute(
      "data-result-freshness",
      "stale-while-updating"
    );
    expect(firstResult).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(firstResult);
    fireEvent.mouseEnter(screen.getByText("John Doe"));

    expect(handleSelect).not.toHaveBeenCalled();
    expect(handleSelectionChange).not.toHaveBeenCalled();
  });

  it("displays no matches message when results are empty", () => {
    render(
      <MentionPopup
        query="nonexistent"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={[]}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });

  it("filters results by entity type via dropdown", () => {
    render(
      <MentionPopup
        query=""
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={mockSearchResults.filter((r) => r.type === "task")}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    // Should show only tasks when filtered to task
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.queryByText("Project Alpha")).not.toBeInTheDocument();
  });

  it("does not render entity descriptions inline in the results list", () => {
    render(
      <MentionPopup
        query=""
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={mockSearchResults}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.queryByText("Software Engineer")).not.toBeInTheDocument();
    expect(screen.queryByText("Product Manager")).not.toBeInTheDocument();
    expect(screen.queryByText("Main project")).not.toBeInTheDocument();
  });

  it("renders an inline type indicator for feature results using the human-readable label", () => {
    const featureResult: SearchEntity[] = [
      { id: "feat-1", type: "feature", name: "Onboarding" },
    ];

    render(
      <MentionPopup
        query=""
        selectedTypeFilter="all"
        onTypeFilterChange={vi.fn()}
        results={featureResult}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.queryByText("feature")).not.toBeInTheDocument();
  });

  it("renders an inline type indicator for task results", () => {
    const taskResult: SearchEntity[] = [
      { id: "t-1", type: "task", name: "Write tests" },
    ];

    render(
      <MentionPopup
        query=""
        selectedTypeFilter="all"
        onTypeFilterChange={vi.fn()}
        results={taskResult}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("renders an inline type indicator for workflow results", () => {
    const workflowResult: SearchEntity[] = [
      { id: "wf-1", type: "workflow", name: "Plan review workflow" },
    ];

    render(
      <MentionPopup
        query=""
        selectedTypeFilter="all"
        onTypeFilterChange={vi.fn()}
        results={workflowResult}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
      />
    );

    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(screen.queryByText("workflow")).not.toBeInTheDocument();
  });

  it("updates selection on hover", () => {
    const handleSelectionChange = vi.fn();

    render(
      <MentionPopup
        query="john"
        selectedTypeFilter="task"
        onTypeFilterChange={vi.fn()}
        results={mockSearchResults}
        isLoading={false}
        resultsFreshness={settledResultsFreshness}
        onSelectEntity={vi.fn()}
        selectedIndex={-1}
        onSelectedIndexChange={handleSelectionChange}
      />
    );

    fireEvent.mouseEnter(screen.getByText("John Doe"));

    expect(handleSelectionChange).toHaveBeenCalledWith(0);
  });
});
