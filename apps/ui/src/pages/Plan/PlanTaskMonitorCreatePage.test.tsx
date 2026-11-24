import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTaskMonitorCreatePage } from "./PlanTaskMonitorCreatePage";
import { PLAN_TASK_MONITOR_CREATE_INTENT } from "./planSessionRoutes";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  createStep: vi.fn(),
  finishCreate: vi.fn<() => string>(),
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
        onClick={() => props.onMonitorReady(mocks.finishCreate())}
      />
    );
  },
}));

const CREATE_PATH =
  "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/new";
const STAGE_PATH = "/projects/project-1/plans/plan-1/stages/stage-1";

const PlanRoutes = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button
        onClick={() =>
          navigate(CREATE_PATH, { state: PLAN_TASK_MONITOR_CREATE_INTENT })
        }
      >
        Launch automation
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      {/* Match the app layout, which remounts the page on location key changes. */}
      <Routes key={location.key}>
        <Route
          path="/projects/:projectId/plans/:planId/stages/:stageId/task-monitor/new"
          element={<PlanTaskMonitorCreatePage />}
        />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
};

const renderAt = (pathname: string, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname, state }]}>
      <PlanRoutes />
    </MemoryRouter>,
  );

describe("PlanTaskMonitorCreatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockReturnValue({ currentOrgId: "org-1", userId: "user-1" });
  });

  it("opens each fresh launch from the same stage in its returned workspace", async () => {
    renderAt(STAGE_PATH);
    const user = userEvent.setup();
    mocks.finishCreate
      .mockReturnValueOnce("monitor-1")
      .mockReturnValueOnce("monitor-2");

    await user.click(screen.getByRole("button", { name: "Launch automation" }));

    expect(screen.getByTestId("plan-shell")).toBeInTheDocument();
    expect(mocks.createStep).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
      }),
    );
    await user.click(screen.getByTestId("plan-stage-task-monitor-create-step"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      `${STAGE_PATH}/task-monitor/monitor-1`,
    );

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Launch automation" }));
    await user.click(screen.getByTestId("plan-stage-task-monitor-create-step"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      `${STAGE_PATH}/task-monitor/monitor-2`,
    );
    expect(mocks.createStep).toHaveBeenCalledTimes(2);
  });

  it.each([null, PLAN_TASK_MONITOR_CREATE_INTENT])(
    "opens the Automation tab when the create address is loaded directly with state %j",
    (state) => {
      renderAt(CREATE_PATH, state);

      expect(mocks.createStep).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${STAGE_PATH}?tab=automation`,
      );
    },
  );

  it("opens the Automation tab when history revisits an unfinished launch", async () => {
    renderAt(STAGE_PATH);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Launch automation" }));
    expect(
      screen.getByTestId("plan-stage-task-monitor-create-step"),
    ).toBeInTheDocument();
    mocks.createStep.mockClear();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Forward" }));

    expect(mocks.createStep).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `${STAGE_PATH}?tab=automation`,
    );
  });

  it("fails before mounting the create step when identity context is missing", async () => {
    mocks.identity.mockReturnValue({ currentOrgId: "", userId: "user-1" });

    renderAt(STAGE_PATH);
    await userEvent.click(
      screen.getByRole("button", { name: "Launch automation" }),
    );

    expect(
      screen.getByTestId("plan-task-monitor-missing-context"),
    ).toBeInTheDocument();
    expect(mocks.createStep).not.toHaveBeenCalled();
  });
});
