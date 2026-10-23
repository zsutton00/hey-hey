import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityHistoryFilters } from "./ActivityHistoryFilters";

const { members } = vi.hoisted(() => ({ members: vi.fn() }));
vi.mock("@hey-hey/ui-common/data", () => ({ useProjectMembers: members }));

const projectId = "550e8400-e29b-41d4-a716-446655440001";
const userId = "550e8400-e29b-41d4-a716-446655440002";
const query = {
  metricContinuation: {
    metric: "TASK_COMPLETED" as const,
    projectIds: [projectId],
    actorScope: { mode: "ORGANIZATION" as const },
    windowStart: "2026-09-01T00:00:00.000Z",
    windowEnd: "2026-09-02T00:00:00.000Z",
  },
  offset: 50,
};

describe("ActivityHistoryFilters", () => {
  beforeEach(() =>
    members.mockReturnValue({
      data: [{ user: { id: userId, name: "Alex" } }],
      isReady: true,
      isFetched: true,
      hasNext: false,
    }),
  );

  it("does not rewrite initial evidence and applies a named actor before requesting results", () => {
    const onChange = vi.fn();
    render(
      <ActivityHistoryFilters
        organizationId="org"
        query={query}
        onChange={onChange}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(members).toHaveBeenCalledWith("org", projectId, { enabled: true });
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Alex" }));
    fireEvent.click(screen.getByTestId("activity-history-apply"));
    expect(onChange).toHaveBeenCalledWith({
      historyFilter: {
        metric: "TASK_COMPLETED",
        projectIds: [projectId],
        windowStart: query.metricContinuation.windowStart,
        windowEnd: query.metricContinuation.windowEnd,
        userId,
      },
      limit: undefined,
      offset: 0,
    });
  });

  it("shows minute precision in both period controls", () => {
    render(
      <ActivityHistoryFilters
        organizationId="org"
        query={{
          ...query,
          metricContinuation: {
            ...query.metricContinuation,
            windowStart: "2026-09-01T12:34:56.789Z",
            windowEnd: "2026-09-02T12:34:56.789Z",
          },
        }}
        onChange={vi.fn()}
      />,
    );
    for (const testId of ["activity-history-start", "activity-history-end"]) {
      const input = screen.getByTestId<HTMLInputElement>(testId);
      expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(input).toHaveAttribute("step", "60");
    }
  });

  it("shows pending membership and a retryable failure without substituting user IDs", () => {
    members.mockReturnValue({ data: [], isFetched: false, isReady: false });
    const { rerender } = render(
      <ActivityHistoryFilters
        organizationId="org"
        query={query}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Loading project users/)).toBeInTheDocument();
    const refetch = vi.fn();
    members.mockReturnValue({
      data: [],
      isFetched: true,
      isReady: false,
      error: new Error("Unavailable"),
      refetch,
    });
    rerender(
      <ActivityHistoryFilters
        organizationId="org"
        query={query}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
