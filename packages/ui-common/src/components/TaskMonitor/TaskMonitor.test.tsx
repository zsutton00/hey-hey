import type { WorkItemExecutionStateResult } from "../../data/hooks/useWorkItemExecutionState";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../api";
import { TaskMonitor } from "./TaskMonitor";

const mocks = vi.hoisted(() => ({
  trackingProvider: vi.fn(),
  useExecutionState: vi.fn(),
  useTaskMonitorProjection: vi.fn(),
  useTaskMonitorStart: vi.fn(),
  useTaskMonitorPauseResume: vi.fn(),
  workspaceProps: vi.fn(),
}));

interface TaskMonitorWorkspaceCallbacks {
  onStart: () => void;
  onPause: () => void;
}

const getWorkspaceCallbacks = (): TaskMonitorWorkspaceCallbacks => {
  const props = mocks.workspaceProps.mock.calls[0]?.[0];
  if (!props || typeof props !== "object") {
    throw new Error("Task Monitor workspace props were not captured.");
  }
  return props as TaskMonitorWorkspaceCallbacks;
};

vi.mock("../../data/hooks/useWorkItemExecutionState", () => ({
  useWorkItemExecutionState: mocks.useExecutionState,
}));
vi.mock("../../contexts", () => ({
  TrackingProvider: ({
    children,
    ...props
  }: {
    children: ReactNode;
    context: unknown;
  }) => {
    mocks.trackingProvider(props);
    return children;
  },
}));

vi.mock("./useTaskMonitorProjection", () => ({
  useTaskMonitorProjection: mocks.useTaskMonitorProjection,
}));

vi.mock("./useTaskMonitorStart", () => ({
  useTaskMonitorStart: mocks.useTaskMonitorStart,
}));

vi.mock("./useTaskMonitorPauseResume", () => ({
  useTaskMonitorPauseResume: mocks.useTaskMonitorPauseResume,
}));

vi.mock("./TaskMonitorWorkspaceView", () => ({
  TaskMonitorWorkspaceView: (props: unknown) => {
    mocks.workspaceProps(props);
    return <div data-testid="task-monitor-workspace-stub" />;
  },
}));

describe("TaskMonitor", () => {
  beforeEach(() => {
    mocks.useExecutionState.mockReturnValue({
      status: "missing",
      delivery: "LIVE",
    });
    mocks.trackingProvider.mockClear();
    mocks.useTaskMonitorProjection.mockReturnValue({
      definition: null,
      monitor: null,
      nodes: [],
      isLoading: false,
      isFetched: true,
      errorMessage: null,
      isSavingLaunchConfiguration: false,
      saveLaunchConfiguration: vi.fn(),
      reconcileAfterCommand: vi.fn(),
    });
    mocks.useTaskMonitorStart.mockReturnValue({
      isCatalogLoading: false,
      isCatalogFetched: true,
      isSubmitting: false,
      acceptedAwaitingRefresh: false,
      start: vi.fn(),
      errorMessage: null,
      commandOutcome: null,
    });
    mocks.useTaskMonitorPauseResume.mockReturnValue({
      pendingAction: null,
      pause: vi.fn(),
      resume: vi.fn(),
      errorMessage: null,
      commandOutcome: null,
    });
    mocks.workspaceProps.mockClear();
  });

  it("mounts tracking context for every Task Monitor surface", () => {
    render(
      <TaskMonitor
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        activePane="monitor"
      />,
    );

    expect(screen.getByTestId("task-monitor-workspace-stub")).toBeVisible();
    expect(mocks.trackingProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          page: expect.objectContaining({
            name: "task-monitor",
            section: "task-monitor",
          }),
          attentionEntity: {
            type: "task",
            id: "monitor-1",
            projectId: "project-1",
            name: "Task Monitor",
          },
        }),
      }),
    );
  });

  it("shares canonical reconciliation with Pause and Resume orchestration", () => {
    const reconcileAfterCommand = vi.fn();
    mocks.useTaskMonitorProjection.mockReturnValue({
      definition: null,
      monitor: null,
      nodes: [],
      isLoading: false,
      isFetched: true,
      errorMessage: null,
      isSavingLaunchConfiguration: false,
      saveLaunchConfiguration: vi.fn(),
      reconcileAfterCommand,
    });

    render(
      <TaskMonitor
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        activePane="monitor"
      />,
    );

    expect(mocks.useTaskMonitorPauseResume).toHaveBeenCalledWith(
      expect.objectContaining({ reconcileProjection: reconcileAfterCommand }),
    );
  });

  it.each([
    [WorkStatus.Backlog, "start"],
    [WorkStatus.OnHold, "resume"],
    [WorkStatus.Blocked, "start"],
  ] as const)(
    "routes setup or advertised recovery from %s to %s",
    async (status, expectedAction) => {
      const start = vi.fn().mockResolvedValue(true);
      const resume = vi.fn().mockResolvedValue(true);
      if (status !== WorkStatus.Backlog) {
        mocks.useExecutionState.mockReturnValue({
          status: "retained",
          delivery: "LIVE",
          revision: 2,
          ownerMachineId: "machine-1",
          acceptedAt: "2026-11-18T12:00:00Z",
          freshness: { status: "CURRENT", changedAt: "2026-11-18T12:00:00Z" },
          state: {
            type: "TASK_MONITOR",
            projection: {
              execution: {
                lifecycle: "RUNNING",
                control: "PAUSED",
                work:
                  expectedAction === "resume"
                    ? "AWAITING_REVIEW"
                    : "RETRYABLE_LAUNCH",
                intervention: "CLEAR",
              },
              availableActions: [
                {
                  kind:
                    expectedAction === "resume"
                      ? "PAUSED_CONTINUATION"
                      : "RETRYABLE_RECOVERY",
                  command: expectedAction === "resume" ? "RESUME" : "START",
                },
              ],
            },
          },
        } satisfies WorkItemExecutionStateResult);
      }
      mocks.useTaskMonitorStart.mockReturnValue({
        isCatalogLoading: false,
        isCatalogFetched: true,
        isSubmitting: false,
        acceptedAwaitingRefresh: false,
        start,
        errorMessage: null,
        commandOutcome: null,
      });
      mocks.useTaskMonitorPauseResume.mockReturnValue({
        pendingAction: null,
        pause: vi.fn(),
        resume,
        errorMessage: null,
        commandOutcome: null,
      });
      mocks.useTaskMonitorProjection.mockReturnValue({
        definition: null,
        monitor: { status },
        nodes: [],
        isLoading: false,
        isFetched: true,
        errorMessage: null,
        isSavingLaunchConfiguration: false,
        saveLaunchConfiguration: vi.fn(),
        reconcileAfterCommand: vi.fn(),
      });

      render(
        <TaskMonitor
          organizationId="org-1"
          projectId="project-1"
          monitorId="monitor-1"
          activePane="monitor"
        />,
      );

      getWorkspaceCallbacks().onStart();

      await vi.waitFor(() =>
        expect(
          expectedAction === "start" ? start : resume,
        ).toHaveBeenCalledTimes(1),
      );
      expect(
        expectedAction === "start" ? resume : start,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    WorkStatus.Generated,
    WorkStatus.Ready,
    WorkStatus.RefiningDescription,
    WorkStatus.RefiningDetails,
    WorkStatus.RefiningAcceptanceCriteria,
    WorkStatus.GeneratingDescription,
    WorkStatus.GeneratingDetails,
    WorkStatus.GeneratingDescriptionAndDetails,
    WorkStatus.GeneratingAcceptanceCriteria,
    WorkStatus.GeneratingAll,
    WorkStatus.Active,
    WorkStatus.Verifying,
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Archived,
    WorkStatus.Superseded,
  ])("does not route Start for non-startable canonical status %s", (status) => {
    const start = vi.fn().mockResolvedValue(true);
    const resume = vi.fn().mockResolvedValue(true);
    mocks.useTaskMonitorStart.mockReturnValue({
      isCatalogLoading: false,
      isCatalogFetched: true,
      isSubmitting: false,
      acceptedAwaitingRefresh: false,
      start,
      errorMessage: null,
      commandOutcome: null,
    });
    mocks.useTaskMonitorPauseResume.mockReturnValue({
      pendingAction: null,
      pause: vi.fn(),
      resume,
      errorMessage: null,
      commandOutcome: null,
    });
    mocks.useTaskMonitorProjection.mockReturnValue({
      definition: null,
      monitor: { status },
      nodes: [],
      isLoading: false,
      isFetched: true,
      errorMessage: null,
      isSavingLaunchConfiguration: false,
      saveLaunchConfiguration: vi.fn(),
      reconcileAfterCommand: vi.fn(),
    });

    render(
      <TaskMonitor
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        activePane="monitor"
      />,
    );

    getWorkspaceCallbacks().onStart();

    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
  it("treats a backlog monitor with a retained ABSENT snapshot as ready to start", () => {
    mocks.useTaskMonitorProjection.mockReturnValue({
      definition: { executionPlan: [], cursor: 0 },
      monitor: { status: WorkStatus.Backlog },
      nodes: [],
      isLoading: false,
      isFetched: true,
      errorMessage: null,
      isSavingLaunchConfiguration: false,
      saveLaunchConfiguration: vi.fn(),
      reconcileAfterCommand: vi.fn(),
    });
    mocks.useExecutionState.mockReturnValue({
      status: "retained",
      delivery: "LIVE",
      revision: 1,
      ownerMachineId: "machine-1",
      acceptedAt: "2026-11-18T12:00:00Z",
      freshness: { status: "CURRENT", changedAt: "2026-11-18T12:00:00Z" },
      state: {
        type: "TASK_MONITOR",
        projection: {
          execution: {
            lifecycle: "ABSENT",
            control: "RUNNING",
            work: "IDLE",
            intervention: "CLEAR",
          },
          availableActions: [],
        },
      },
    } satisfies WorkItemExecutionStateResult);

    render(
      <TaskMonitor
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
        activePane="monitor"
      />,
    );

    expect(mocks.workspaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ startPresentation: { status: "ready" } }),
    );
  });

  it("keeps the workspace mounted while the launch catalog reloads", () => {
    const props = {
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
      activePane: "monitor",
    } satisfies React.ComponentProps<typeof TaskMonitor>;
    const { rerender } = render(<TaskMonitor {...props} />);
    const workspace = screen.getByTestId("task-monitor-workspace-stub");
    const start = mocks.useTaskMonitorStart.mock.results.at(-1)?.value;
    mocks.useTaskMonitorStart.mockReturnValue({
      ...start,
      isCatalogLoading: true,
      isCatalogFetched: false,
    });
    rerender(<TaskMonitor {...props} />);
    expect(screen.getByTestId("task-monitor-workspace-stub")).toBe(workspace);
    expect(mocks.workspaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ isStartCatalogLoading: true }),
    );
  });
});
