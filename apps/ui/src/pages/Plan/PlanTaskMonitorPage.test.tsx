import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTaskMonitorPage } from "./PlanTaskMonitorPage";

const mocks = vi.hoisted(() => ({
  canonicalBoundary: vi.fn(),
  canonicalDescriptor: vi.fn(),
  navigationLineageEntry: vi.fn(),
  identity: vi.fn(),
  params: vi.fn(),
  planPage: vi.fn(),
  taskMonitor: vi.fn(),
  useWorkItem: vi.fn(),
}));

vi.mock("./PlanPage", () => ({
  PlanPage: (props: {
    organizationId: string;
    projectId: string;
    planId: string;
    stageId?: string;
    view: "automation";
    automationHeightMode: "remaining-viewport";
    automationContent: ReactNode;
  }) => {
    mocks.planPage(props);
    return <div data-testid="plan-shell">{props.automationContent}</div>;
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: mocks.identity,
}));

vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: mocks.navigationLineageEntry,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: (props: {
    children: ReactNode;
    composition: unknown;
  }) => {
    mocks.canonicalBoundary(props);
    return <>{props.children}</>;
  },
  createCanonicalPageDescriptor: mocks.canonicalDescriptor,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItem: mocks.useWorkItem,
}));

vi.mock("react-router-dom", () => ({
  useParams: mocks.params,
}));

vi.mock("../../components/TaskMonitorResponsiveWorkspace", () => ({
  TaskMonitorResponsiveWorkspace: (props: {
    organizationId: string;
    projectId: string;
    monitorId: string;
  }) => {
    mocks.taskMonitor(props);
    return <div data-testid="task-monitor" />;
  },
}));

describe("PlanTaskMonitorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockReturnValue({ currentOrgId: "org-1" });
    mocks.params.mockReturnValue({
      projectId: "project-1",
      planId: "plan-1",
      stageId: "stage-1",
      monitorId: "monitor-1",
    });
    mocks.useWorkItem.mockReturnValue({
      workItem: {
        id: "monitor-1",
        name: "Release monitor",
        type: "TASK_MONITOR",
      },
      isLoading: false,
      error: null,
    });
    mocks.navigationLineageEntry.mockImplementation(
      (entityType: string, entityId: string) => ({ entityType, entityId }),
    );
    mocks.canonicalDescriptor.mockImplementation(
      (
        entityType: string,
        entityId: string,
        lineage: unknown,
        presentation: unknown,
      ) => ({ entityType, entityId, lineage, presentation }),
    );
  });

  it("renders the Task Monitor inside the originating Plan automation view", () => {
    render(<PlanTaskMonitorPage />);

    expect(screen.getByTestId("plan-shell")).toBeInTheDocument();
    expect(screen.getByTestId("task-monitor")).toBeInTheDocument();
    expect(mocks.planPage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        stageId: "stage-1",
        view: "automation",
        automationHeightMode: "remaining-viewport",
        automationContent: expect.anything(),
      }),
    );
    expect(mocks.taskMonitor).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
    });
    expect(mocks.useWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "monitor-1",
      { projectId: "project-1", enabled: true },
    );
    expect(mocks.canonicalDescriptor).toHaveBeenCalledWith(
      "task",
      "monitor-1",
      [
        { entityType: "plan", entityId: "plan-1" },
        { entityType: "plan_stage", entityId: "stage-1" },
      ],
      { kind: "task", label: "Release monitor", taskType: "TASK_MONITOR" },
    );
    expect(mocks.canonicalBoundary).toHaveBeenCalledWith(
      expect.objectContaining({
        composition: expect.objectContaining({ kind: "canonical" }),
      }),
    );
  });

  it("supports Plan-level monitor links when no stage is selected", () => {
    mocks.params.mockReturnValue({
      projectId: "project-1",
      planId: "plan-1",
      monitorId: "monitor-1",
    });

    render(<PlanTaskMonitorPage />);

    expect(mocks.planPage).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        stageId: undefined,
        view: "automation",
        automationHeightMode: "remaining-viewport",
      }),
    );
    expect(screen.getByTestId("task-monitor")).toBeInTheDocument();
    expect(mocks.canonicalDescriptor).toHaveBeenCalledWith(
      "task",
      "monitor-1",
      [{ entityType: "plan", entityId: "plan-1" }],
      { kind: "task", label: "Release monitor", taskType: "TASK_MONITOR" },
    );
  });

  it.each([
    ["loading", { workItem: null, isLoading: true, error: null }],
    ["error", { workItem: null, isLoading: false, error: new Error("boom") }],
    [
      "wrong type",
      {
        workItem: { id: "monitor-1", name: "Not a monitor", type: "STANDARD" },
        isLoading: false,
        error: null,
      },
    ],
    ["missing", { workItem: null, isLoading: false, error: null }],
  ])(
    "does not compose the Plan shell when monitor context is %s",
    (_label, query) => {
      mocks.useWorkItem.mockReturnValue(query);

      render(<PlanTaskMonitorPage />);

      if (query.isLoading) {
        expect(
          screen.getByTestId("plan-task-monitor-loading"),
        ).toBeInTheDocument();
      } else {
        expect(
          screen.getByTestId("plan-task-monitor-unavailable"),
        ).toBeInTheDocument();
      }
      expect(mocks.planPage).not.toHaveBeenCalled();
      expect(mocks.taskMonitor).not.toHaveBeenCalled();
      expect(mocks.canonicalBoundary).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["organization", { currentOrgId: "" }, undefined],
    ["project", undefined, { projectId: "" }],
    ["plan", undefined, { planId: "" }],
    ["monitor", undefined, { monitorId: "" }],
  ])(
    "does not mount either surface when %s context is missing",
    (_label, identity, params) => {
      if (identity) {
        mocks.identity.mockReturnValue(identity);
      }
      if (params) {
        mocks.params.mockReturnValue({
          projectId: "project-1",
          planId: "plan-1",
          stageId: "stage-1",
          monitorId: "monitor-1",
          ...params,
        });
      }

      render(<PlanTaskMonitorPage />);

      expect(
        screen.getByTestId("plan-task-monitor-missing-context"),
      ).toBeInTheDocument();
      expect(mocks.planPage).not.toHaveBeenCalled();
      expect(mocks.taskMonitor).not.toHaveBeenCalled();
    },
  );
});
