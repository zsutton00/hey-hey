import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../api";
import { TaskMonitor } from "./TaskMonitor";

const mocks = vi.hoisted(() => ({
  trackingProvider: vi.fn(),
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
      />
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
      })
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
      />
    );

    expect(mocks.useTaskMonitorPauseResume).toHaveBeenCalledWith(
      expect.objectContaining({ reconcileProjection: reconcileAfterCommand })
    );
  });

  it.each([
    [WorkStatus.Backlog, "start"],
    [WorkStatus.OnHold, "resume"],
  ] as const)(
    "routes the visible Start action for canonical %s status to %s",
    async (status, expectedAction) => {
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
        />
      );

      getWorkspaceCallbacks().onStart();

      await vi.waitFor(() =>
        expect(
          expectedAction === "start" ? start : resume
        ).toHaveBeenCalledTimes(1)
      );
      expect(
        expectedAction === "start" ? resume : start
      ).not.toHaveBeenCalled();
    }
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
      />
    );

    getWorkspaceCallbacks().onStart();

    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
