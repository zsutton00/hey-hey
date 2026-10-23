import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTaskMonitorSetupPage } from "./PlanTaskMonitorSetupPage";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  params: vi.fn(),
  navigate: vi.fn(),
  createOrReopen: vi.fn(),
  planPage: vi.fn(),
}));

vi.mock("./PlanPage", () => ({
  PlanPage: (props: {
    organizationId: string;
    projectId: string;
    planId: string;
    stageId: string;
    view: "automation";
    automationHeightMode: "auto";
    automationContent: ReactNode;
  }) => {
    mocks.planPage(props);
    return <div data-testid="plan-shell">{props.automationContent}</div>;
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: mocks.identity,
}));

vi.mock("react-router-dom", () => ({
  useParams: mocks.params,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  PlanStageTaskMonitorCreateOrReopen: (
    props: ComponentProps<"div"> & {
      organizationId: string;
      projectId: string;
      planId: string;
      stageId: string;
      onMonitorReady: (monitorId: string) => void;
    },
  ) => {
    mocks.createOrReopen(props);
    return (
      <button
        type="button"
        data-testid="shared-plan-stage-monitor-create-or-reopen"
        onClick={() => props.onMonitorReady("monitor-1")}
      />
    );
  },
}));

describe("PlanTaskMonitorSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockReturnValue({
      currentOrgId: "org-1",
      userId: "user-1",
    });
    mocks.params.mockReturnValue({
      projectId: "project-1",
      planId: "plan-1",
      stageId: "stage-1",
    });
  });

  it("binds authenticated and route context to the shared lifecycle surface", () => {
    render(<PlanTaskMonitorSetupPage />);

    expect(
      screen.getByTestId("shared-plan-stage-monitor-create-or-reopen"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("plan-shell")).toBeInTheDocument();
    expect(mocks.planPage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
        view: "automation",
        automationHeightMode: "auto",
        automationContent: expect.anything(),
      }),
    );
    expect(mocks.createOrReopen).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
        onMonitorReady: expect.any(Function),
      }),
    );
    expect(mocks.createOrReopen.mock.calls[0]?.[0]).not.toHaveProperty(
      "monitorId",
    );
  });

  it("keeps create and reopen results inside the originating Plan chrome", () => {
    render(<PlanTaskMonitorSetupPage />);

    screen.getByTestId("shared-plan-stage-monitor-create-or-reopen").click();

    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project-1/plans/plan-1/stages/stage-1/task-monitor/monitor-1",
    );
  });

  it.each([
    ["organization", { currentOrgId: "", userId: "user-1" }, undefined],
    ["user", { currentOrgId: "org-1", userId: "" }, undefined],
    ["project", undefined, { projectId: "" }],
    ["plan", undefined, { planId: "" }],
    ["stage", undefined, { stageId: "" }],
  ])(
    "fails before mounting the read-owning launch surface when %s context is missing",
    (_label, identity, params) => {
      if (identity) {
        mocks.identity.mockReturnValue(identity);
      }
      if (params) {
        mocks.params.mockReturnValue({
          projectId: "project-1",
          planId: "plan-1",
          stageId: "stage-1",
          ...params,
        });
      }

      render(<PlanTaskMonitorSetupPage />);

      expect(
        screen.getByTestId("plan-task-monitor-missing-context"),
      ).toBeInTheDocument();
      expect(mocks.planPage).not.toHaveBeenCalled();
      expect(mocks.createOrReopen).not.toHaveBeenCalled();
    },
  );
});
