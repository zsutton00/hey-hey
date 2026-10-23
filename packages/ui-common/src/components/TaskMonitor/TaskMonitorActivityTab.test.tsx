import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../api";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { TaskMonitorActivityTab } from "./TaskMonitorActivityTab";

vi.mock("../../data/hooks/useWorkItems", () => ({
  useWorkItems: vi.fn(),
}));

vi.mock("../Entity", () => ({
  EntityListItem: ({
    title,
    href,
    status,
    createdAt,
  }: {
    title: string;
    href?: string;
    status?: string;
    createdAt?: string;
  }) => (
    <a href={href} data-status={status} data-created-at={createdAt}>
      {title}
    </a>
  ),
}));

const mockUseWorkItems = vi.mocked(useWorkItems);

const workItem = (
  overrides: Partial<TaskResponseDto> = {}
): TaskResponseDto => ({
  id: "monitor-1",
  organizationId: "org-1",
  projectId: "project-1",
  name: "Monitor one",
  type: "TASK_MONITOR",
  sections: [],
  status: WorkStatus.Active,
  priority: null,
  source: TaskSource.System,
  createdAt: "2026-07-21T12:34:56.000Z",
  ...overrides,
});

const hookResult = (
  overrides: Partial<ReturnType<typeof useWorkItems>> = {}
): ReturnType<typeof useWorkItems> => ({
  workItems: [],
  data: null,
  items: [],
  currentItems: [],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  findItemByEntityId: vi.fn(),
  createTask: vi.fn(),
  createInitiative: vi.fn(),
  updateTask: vi.fn(),
  updateInitiative: vi.fn(),
  remove: vi.fn(),
  ...overrides,
});

const renderTab = () =>
  render(
    <MemoryRouter>
      <TaskMonitorActivityTab
        organizationId="org-1"
        projectId="project-1"
        buildTaskMonitorPath={(target) =>
          target.kind === "plan"
            ? `/projects/project-1/plans/${target.planId}/task-monitor/${target.taskId}`
            : `/projects/project-1/tasks/${target.taskId}`
        }
      />
    </MemoryRouter>
  );

describe("TaskMonitorActivityTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("task-monitors-active-only");
  });

  it("requests project-scoped Task Monitors and uses the canonical host route", () => {
    mockUseWorkItems.mockReturnValue(
      hookResult({
        workItems: [
          workItem(),
          workItem(),
          workItem({
            id: "standard-1",
            name: "Other work item",
            type: "STANDARD",
          }),
          workItem({
            id: "monitor-2",
            name: "Monitor two",
            sections: undefined,
          }),
        ],
      })
    );

    renderTab();

    expect(screen.getByText("Monitor one")).toBeInTheDocument();
    expect(screen.getByText("Monitor two")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Monitor one" })).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/monitor-1"
    );
    expect(screen.getByRole("link", { name: "Monitor one" })).toHaveAttribute(
      "data-status",
      WorkStatus.Active
    );
    expect(screen.getByRole("link", { name: "Monitor one" })).toHaveAttribute(
      "data-created-at",
      "2026-07-21T12:34:56.000Z"
    );
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      {
        edgeTypes: [AgentEdgeType.RelatedTo],
        includeEdges: true,
        taskType: "TASK_MONITOR",
      }
    );
  });

  it("routes a plan-owned Task Monitor through its canonical Plan surface", () => {
    mockUseWorkItems.mockReturnValue(
      hookResult({
        workItems: [
          workItem({
            edges: [
              {
                id: "edge-1",
                sourceNodeId: "monitor-1",
                sourceEntityType: AgentEdgeEndpointEntityType.Task,
                targetNodeId: "plan-1",
                targetEntityType: AgentEdgeEndpointEntityType.Task,
                targetNodeType: "PLAN",
                type: AgentEdgeType.RelatedTo,
              },
            ],
          }),
        ],
      })
    );

    renderTab();

    expect(screen.getByRole("link", { name: "Monitor one" })).toHaveAttribute(
      "href",
      "/projects/project-1/plans/plan-1/task-monitor/monitor-1"
    );
  });

  it("keeps loading, error, and empty states explicit", () => {
    mockUseWorkItems.mockReturnValue(
      hookResult({ isLoading: true, isFetched: false })
    );
    const { rerender } = renderTab();
    expect(
      screen.getByTestId("task-monitor-activity-loading")
    ).toBeInTheDocument();

    mockUseWorkItems.mockReturnValue(
      hookResult({ error: new Error("Work Items failed") })
    );
    rerender(
      <MemoryRouter>
        <TaskMonitorActivityTab
          organizationId="org-1"
          projectId="project-1"
          buildTaskMonitorPath={(target) =>
            `/projects/project-1/tasks/${target.taskId}`
          }
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("task-monitor-activity-error")).toHaveTextContent(
      "Work Items failed"
    );

    mockUseWorkItems.mockReturnValue(hookResult());
    rerender(
      <MemoryRouter>
        <TaskMonitorActivityTab
          organizationId="org-1"
          projectId="project-1"
          buildTaskMonitorPath={(target) =>
            `/projects/project-1/tasks/${target.taskId}`
          }
        />
      </MemoryRouter>
    );
    expect(
      screen.getByTestId("task-monitor-activity-empty")
    ).toBeInTheDocument();
  });

  it("does not expose mutation controls for the read-only activity entry", () => {
    mockUseWorkItems.mockReturnValue(hookResult({ workItems: [workItem()] }));

    renderTab();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("supports the persisted Active only filter with the canonical active status", () => {
    mockUseWorkItems.mockReturnValue(hookResult({ workItems: [workItem()] }));

    renderTab();

    const activeOnlySwitch = screen.getByRole("switch", {
      name: "Active only",
    });
    expect(activeOnlySwitch).not.toBeChecked();

    fireEvent.click(activeOnlySwitch);

    expect(activeOnlySwitch).toBeChecked();
    expect(localStorage.getItem("task-monitors-active-only")).toBe("true");
    expect(mockUseWorkItems).toHaveBeenLastCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      {
        edgeTypes: [AgentEdgeType.RelatedTo],
        includeEdges: true,
        status: WorkStatus.Active,
        taskType: "TASK_MONITOR",
      }
    );
  });
});
