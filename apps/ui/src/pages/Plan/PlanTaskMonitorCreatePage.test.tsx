import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTaskMonitorCreatePage } from "./PlanTaskMonitorCreatePage";
import { PLAN_TASK_MONITOR_CREATE_INTENT } from "./planSessionRoutes";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  createStep: vi.fn(),
}));

vi.mock("./PlanPage", () => ({
  PlanPage: (props: { automationContent: ReactNode }) => (
    <div data-testid="plan-shell">{props.automationContent}</div>
  ),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: mocks.identity,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  PlanStageTaskMonitorCreateOrReopen: (props: {
    organizationId: string;
    projectId: string;
    planId: string;
    stageId: string;
    onMonitorReady: (monitorId: string) => void;
  }) => {
    mocks.createStep(props);
    return (
      <button
        type="button"
        data-testid="plan-stage-task-monitor-create-step"
        onClick={() => props.onMonitorReady("monitor-1")}
      />
    );
  },
}));

const CREATE_PATH =
  "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/new";

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state)}>
      {`${location.pathname}${location.search}`}
    </div>
  );
};

const renderAt = (state: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: CREATE_PATH, state }]}>
      <Routes>
        <Route
          path="/projects/:projectId/plans/:planId/stages/:stageId/task-monitor/new"
          element={<PlanTaskMonitorCreatePage />}
        />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );

describe("PlanTaskMonitorCreatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockReturnValue({ currentOrgId: "org-1", userId: "user-1" });
  });

  it("creates for an Automate click inside the Plan chrome and lands on the workspace", async () => {
    renderAt(PLAN_TASK_MONITOR_CREATE_INTENT);

    expect(screen.getByTestId("plan-shell")).toBeInTheDocument();
    expect(mocks.createStep).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
      }),
    );
    // The click's intent is consumed, so a refresh of this entry cannot create again.
    expect(screen.getByTestId("location")).toHaveAttribute(
      "data-state",
      "null",
    );

    await userEvent.click(
      screen.getByTestId("plan-stage-task-monitor-create-step"),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/monitor-1",
    );
  });

  it("opens the Automation tab without creating when reached by refresh, bookmark or Back", () => {
    renderAt(null);

    expect(mocks.createStep).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-1?tab=automation",
    );
  });

  it("fails before mounting the create step when identity context is missing", () => {
    mocks.identity.mockReturnValue({ currentOrgId: "", userId: "user-1" });

    renderAt(PLAN_TASK_MONITOR_CREATE_INTENT);

    expect(
      screen.getByTestId("plan-task-monitor-missing-context"),
    ).toBeInTheDocument();
    expect(mocks.createStep).not.toHaveBeenCalled();
  });
});
