import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTaskMonitorSetupRedirectPage } from "./PlanTaskMonitorSetupRedirectPage";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  workItems: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: mocks.identity,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: mocks.workItems,
}));

const monitor = (
  id: string,
  status: string,
  archivedAt: string | null = null,
) => ({
  id,
  type: "TASK_MONITOR",
  status,
  archivedAt,
});

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
};

const renderOldLink = () =>
  render(
    <MemoryRouter
      initialEntries={[
        "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/setup",
      ]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/plans/:planId/stages/:stageId/task-monitor/setup"
          element={<PlanTaskMonitorSetupRedirectPage />}
        />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );

describe("PlanTaskMonitorSetupRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockReturnValue({ currentOrgId: "org-1", userId: "user-1" });
  });

  it("opens the stage's only unfinished monitor", () => {
    mocks.workItems.mockReturnValue({
      workItems: [
        monitor("monitor-open", "BACKLOG"),
        monitor("monitor-done", "COMPLETED"),
        monitor("monitor-archived", "ACTIVE", "2026-11-01T00:00:00Z"),
      ],
      isFetched: true,
      error: null,
    });

    renderOldLink();

    expect(mocks.workItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        taskType: "TASK_MONITOR",
        relatedEntityId: "stage-1",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/monitor-open",
    );
  });

  it.each([
    ["no unfinished monitor", [monitor("monitor-done", "COMPLETED")]],
    [
      "several unfinished monitors",
      [monitor("monitor-a", "ACTIVE"), monitor("monitor-b", "BACKLOG")],
    ],
  ])("opens the Automation tab when there is %s", (_label, workItems) => {
    mocks.workItems.mockReturnValue({
      workItems,
      isFetched: true,
      error: null,
    });

    renderOldLink();

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-1?tab=automation",
    );
  });

  it("waits for the related monitors before choosing", () => {
    mocks.workItems.mockReturnValue({
      workItems: [],
      isFetched: false,
      error: null,
    });

    renderOldLink();

    expect(
      screen.getByTestId("plan-task-monitor-setup-redirect-loading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/setup",
    );
  });
});
