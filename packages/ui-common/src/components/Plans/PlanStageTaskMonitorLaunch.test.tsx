import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanStageTaskMonitorLaunch } from "./PlanStageTaskMonitorLaunch";

const mocks = vi.hoisted(() => ({
  usePlanStageTaskMonitorSetup: vi.fn(),
}));

vi.mock("./usePlanStageTaskMonitorSetup", () => ({
  usePlanStageTaskMonitorSetup: mocks.usePlanStageTaskMonitorSetup,
}));

const props = {
  organizationId: "org-1",
  projectId: "project-1",
  planId: "plan-1",
  stageId: "stage-1",
  onContinue: vi.fn(),
};

describe("PlanStageTaskMonitorLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { isLoading: false, isFetched: false },
    { isLoading: true, isFetched: false },
    { isLoading: true, isFetched: true },
  ])(
    "gates domain state for loading=$isLoading and fetched=$isFetched",
    ({ isLoading, isFetched }) => {
      mocks.usePlanStageTaskMonitorSetup.mockReturnValue({
        state: { status: "read-error", message: "Read failed" },
        isLoading,
        isFetched,
      });

      render(<PlanStageTaskMonitorLaunch {...props} />);

      expect(screen.getByTestId("data-state-boundary-loading")).toBeVisible();
      expect(
        screen.queryByTestId("plan-stage-task-monitor-read-error")
      ).not.toBeInTheDocument();
    }
  );

  it("passes the explicit read error through when all reads have settled", () => {
    mocks.usePlanStageTaskMonitorSetup.mockReturnValue({
      state: { status: "read-error", message: "Read failed" },
      isLoading: false,
      isFetched: true,
    });

    render(<PlanStageTaskMonitorLaunch {...props} />);

    expect(
      screen.getByTestId("plan-stage-task-monitor-read-error")
    ).toHaveTextContent("Read failed");
    expect(
      screen.queryByTestId("data-state-boundary-loading")
    ).not.toBeInTheDocument();
  });
});
