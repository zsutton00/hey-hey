import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanStageTaskMonitorCreateOrReopen } from "./PlanStageTaskMonitorCreateOrReopen";

const mocks = vi.hoisted(() => ({
  usePlanStageTaskMonitorSetup: vi.fn(),
  usePlanStageTaskMonitorCreateOrReopen: vi.fn(),
}));

vi.mock("./usePlanStageTaskMonitorSetup", () => ({
  usePlanStageTaskMonitorSetup: mocks.usePlanStageTaskMonitorSetup,
}));
vi.mock("./usePlanStageTaskMonitorCreateOrReopen", () => ({
  usePlanStageTaskMonitorCreateOrReopen:
    mocks.usePlanStageTaskMonitorCreateOrReopen,
}));
vi.mock("./PlanStageTaskMonitorSetupReview/index.tsx", () => ({
  PlanStageTaskMonitorSetupReview: ({
    onConfirm,
  }: {
    onConfirm: (definition: object, userMessage: string) => void;
  }) => (
    <button
      type="button"
      data-testid="confirm-plan-monitor-setup"
      onClick={() => onConfirm({}, "")}
    >
      Confirm
    </button>
  ),
}));

const props = {
  organizationId: "org-1",
  projectId: "project-1",
  planId: "11111111-1111-4111-8111-111111111111",
  stageId: "22222222-2222-4222-8222-222222222222",
  onMonitorReady: vi.fn(),
};

describe("PlanStageTaskMonitorCreateOrReopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePlanStageTaskMonitorSetup.mockReturnValue({
      state: {
        status: "ready",
        draft: {
          provenance: {
            organizationId: props.organizationId,
            projectId: props.projectId,
            planId: props.planId,
            planParentTaskId: "55555555-5555-4555-8555-555555555555",
            stageId: props.stageId,
            planLabel: "Release plan",
            stageLabel: "Ship stage",
          },
          definition: {},
        },
      },
      isLoading: false,
      isFetched: true,
      isRefreshingTaskServices: false,
      refetchTaskServices: vi.fn(),
    });
    mocks.usePlanStageTaskMonitorCreateOrReopen.mockReturnValue({
      state: { status: "idle" },
    });
  });

  it.each([
    { isLoading: false, isFetched: false },
    { isLoading: true, isFetched: false },
    { isLoading: true, isFetched: true },
  ])(
    "shows loading instead of a setup error for loading=$isLoading and fetched=$isFetched",
    ({ isLoading, isFetched }) => {
      mocks.usePlanStageTaskMonitorSetup.mockReturnValue({
        state: { status: "read-error", message: "Catalog is still loading" },
        isLoading,
        isFetched,
        isRefreshingTaskServices: false,
        refetchTaskServices: vi.fn(),
      });

      render(<PlanStageTaskMonitorCreateOrReopen {...props} />);

      expect(screen.getByTestId("data-state-boundary-loading")).toBeVisible();
      expect(
        screen.queryByTestId("plan-stage-task-monitor-read-error")
      ).not.toBeInTheDocument();
    }
  );

  it("shows a setup error after all setup reads settle", () => {
    mocks.usePlanStageTaskMonitorSetup.mockReturnValue({
      state: { status: "read-error", message: "Read failed" },
      isLoading: false,
      isFetched: true,
      isRefreshingTaskServices: false,
      refetchTaskServices: vi.fn(),
    });

    render(<PlanStageTaskMonitorCreateOrReopen {...props} />);

    expect(
      screen.getByTestId("plan-stage-task-monitor-read-error")
    ).toHaveTextContent("Read failed");
  });

  it("navigates with the identity returned by fresh creation", () => {
    const createdMonitorId = "33333333-3333-4333-8333-333333333333";
    mocks.usePlanStageTaskMonitorCreateOrReopen.mockImplementation(
      ({ definition }: { definition: object | null }) => ({
        state: definition
          ? { status: "created", monitorId: createdMonitorId }
          : { status: "idle" },
      })
    );

    render(<PlanStageTaskMonitorCreateOrReopen {...props} />);
    fireEvent.click(screen.getByTestId("confirm-plan-monitor-setup"));

    expect(props.onMonitorReady).toHaveBeenCalledWith(createdMonitorId);
  });

  it("passes the ready draft's Plan parent into fresh creation", () => {
    render(<PlanStageTaskMonitorCreateOrReopen {...props} />);

    expect(mocks.usePlanStageTaskMonitorCreateOrReopen).toHaveBeenCalledWith(
      expect.objectContaining({
        planParentTaskId: "55555555-5555-4555-8555-555555555555",
      })
    );
  });
});
