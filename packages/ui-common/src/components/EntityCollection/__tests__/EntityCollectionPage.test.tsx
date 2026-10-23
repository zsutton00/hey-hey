import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import type {
  PaginatedWorkItemReferenceResponseDto,
  WorkItemTypeDefinitionDto,
} from "../../../api";
import type { WorkItemResponseDto } from "../../../data/collections/workItems";
import { EntityCollectionPage } from "../EntityCollectionPage";
import { GoalProgressChip } from "../../Goals/GoalProgressChip";

const referencePageMock = vi.fn();
const workItemsMock = vi.fn();

vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferencePage: (input: unknown) => referencePageMock(input),
}));
vi.mock("../../../data/hooks/useWorkItems", () => ({
  useWorkItems: (...args: unknown[]) => workItemsMock(...args),
}));
vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const goalDefinition = {
  key: "GOAL",
  name: "Goal",
  allowedStatuses: ["COMPLETED", "ACTIVE", "CANCELLED"],
} as unknown as WorkItemTypeDefinitionDto;

const referencePage = (
  ids: string[],
  pagination: Partial<PaginatedWorkItemReferenceResponseDto["pagination"]> = {}
): PaginatedWorkItemReferenceResponseDto => ({
  items: ids.map((id) => ({
    id,
    name: `Goal ${id}`,
    type: "GOAL",
    parentTaskId: null,
  })),
  pagination: {
    page: 1,
    limit: 25,
    total: ids.length,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
    ...pagination,
  },
});

const goal = (id: string): WorkItemResponseDto =>
  ({
    id,
    name: `Goal ${id}`,
    type: "GOAL",
    status: "ACTIVE",
    organizationId: "org-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasProposalSupport: true,
  } as unknown as WorkItemResponseDto);

const lastReferenceInput = () =>
  referencePageMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
const lastWorkItemsOptions = () =>
  workItemsMock.mock.calls.at(-1)?.[4] as Record<string, unknown>;

const renderPage = (
  props: Partial<React.ComponentProps<typeof EntityCollectionPage>> = {}
) =>
  render(
    <BrowserRouter>
      <EntityCollectionPage
        organizationId="org-1"
        projectId="project-1"
        typeDefinition={goalDefinition}
        {...props}
      />
    </BrowserRouter>
  );

describe("EntityCollectionPage", () => {
  beforeEach(() => {
    referencePageMock.mockReset();
    workItemsMock.mockReset();
    referencePageMock.mockReturnValue({
      status: "ready",
      page: referencePage(["b", "a"]),
      isFetching: false,
    });
    workItemsMock.mockReturnValue({
      workItems: [goal("a"), goal("b")],
      isLoading: false,
      error: null,
    });
  });

  it("hydrates only the page's rows without tracked snapshots, in reference order", () => {
    renderPage({
      includeTrackedWorkSummary: true,
      renderRowAttention: (item) => <span>attention-{item.id}</span>,
    });

    expect(lastWorkItemsOptions()).toMatchObject({
      taskType: "GOAL",
      taskIds: ["b", "a"],
      includeTrackedEntities: false,
      includeTrackedWorkSummary: true,
    });
    const rows = within(screen.getByTestId("entity-collection-rows"));
    const titles = rows
      .getAllByText(/^Goal [ab]$/)
      .map((node) => node.textContent);
    expect(titles).toEqual(["Goal b", "Goal a"]);
    expect(screen.getByText("attention-a")).toBeInTheDocument();
  });

  it("groups calculated Goal progress beside the lifecycle status", () => {
    const atRiskGoal: WorkItemResponseDto = {
      ...goal("a"),
      trackedWorkSummary: {
        totalCount: 2,
        completedCount: 0,
        cancelledCount: 1,
        pastDueCount: 0,
        openUndatedCount: 0,
      },
    };
    workItemsMock.mockReturnValue({
      workItems: [atRiskGoal],
      isLoading: false,
      error: null,
    });
    referencePageMock.mockReturnValue({
      status: "ready",
      page: referencePage(["a"]),
      isFetching: false,
    });
    renderPage({ renderRowAttention: (item) => <GoalProgressChip goal={item} /> });

    const indicators = screen.getByTestId("entity-list-item-indicators");
    expect(indicators).toContainElement(screen.getByTestId("goal-progress-chip"));
    expect(indicators).toContainElement(screen.getByTestId("entity-list-item-status"));
    expect(indicators).not.toContainElement(screen.getByText("Goal a"));
    expect(screen.getByTestId("goal-progress-chip")).toHaveAttribute(
      "data-goal-progress", "at-risk"
    );
    expect(indicators).toHaveStyle({ flexDirection: "row", flexShrink: "0" });
  });

  it("derives status tabs from the type's declared statuses and filters by tab", () => {
    renderPage();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "In progress",
      "Completed",
      "Cancelled",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "All" })).not.toBeInTheDocument();
    expect(lastReferenceInput().statuses).toEqual(["ACTIVE"]);

    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));

    expect(lastReferenceInput()).toMatchObject({
      workItemType: "GOAL",
      statuses: ["COMPLETED"],
      page: 1,
    });
  });

  it("makes the search field fill the available width", () => {
    renderPage();

    expect(
      screen.getByTestId("entity-collection-search").closest(".MuiFormControl-root")
    ).toHaveStyle({ width: "100%" });
  });

  it("selects In Progress when the type definition arrives after the first render", () => {
    const { rerender } = renderPage({ typeDefinition: undefined });
    rerender(
      <BrowserRouter>
        <EntityCollectionPage
          organizationId="org-1"
          projectId="project-1"
          typeDefinition={goalDefinition}
        />
      </BrowserRouter>
    );

    expect(screen.getAllByRole("tab")[0]).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(lastReferenceInput().statuses).toEqual(["ACTIVE"]);
  });

  it("searches the complete collection and resets to the first page", () => {
    vi.useFakeTimers();
    try {
      referencePageMock.mockReturnValue({
        status: "ready",
        page: referencePage(["a", "b"], {
          total: 60,
          totalPages: 3,
          hasNext: true,
        }),
        isFetching: false,
      });
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: /page 2/i }));
      expect(lastReferenceInput().page).toBe(2);

      fireEvent.change(screen.getByTestId("entity-collection-search"), {
        target: { value: "  launch " },
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(lastReferenceInput()).toMatchObject({ filter: "launch", page: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("paginates through the references read without showing a search count", () => {
    referencePageMock.mockReturnValue({
      status: "ready",
      page: referencePage(["a", "b"], {
        total: 60,
        totalPages: 3,
        hasNext: true,
      }),
      isFetching: false,
    });
    renderPage({ pageSize: 2 });

    expect(lastReferenceInput()).toMatchObject({ page: 1, limit: 2 });
    expect(
      screen.queryByTestId("entity-collection-total")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("60 total")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /page 3/i }));
    expect(lastReferenceInput().page).toBe(3);
  });

  it("shows errors from either read instead of an empty list", () => {
    referencePageMock.mockReturnValue({
      status: "error",
      page: null,
      isFetching: false,
      error: new Error("references unavailable"),
    });
    workItemsMock.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: new Error("rows unavailable"),
    });
    renderPage();

    expect(screen.getByText("references unavailable")).toBeInTheDocument();
    expect(screen.getByText("rows unavailable")).toBeInTheDocument();
  });

  it("disables row hydration when the page has no references", () => {
    referencePageMock.mockReturnValue({
      status: "empty",
      page: referencePage([]),
      isFetching: false,
    });
    workItemsMock.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: null,
    });
    renderPage({ emptyMessage: "No goals yet." });

    expect(lastWorkItemsOptions().enabled).toBe(false);
    expect(screen.getByTestId("entity-collection-empty")).toHaveTextContent(
      "No goals yet."
    );
  });
});
