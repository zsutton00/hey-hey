import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import {
  PlanAutomationTab,
  selectUniqueTaskMonitors,
} from "./PlanAutomationTab";

vi.mock("../../data/hooks/useWorkItems", () => ({
  useWorkItems: vi.fn(),
}));

vi.mock("../Entity", () => ({
  EntityListItem: ({
    title,
    href,
    createdAt,
    onDelete,
  }: {
    title: string;
    href?: string;
    createdAt?: string;
    onDelete?: () => void;
  }) => (
    <>
      <a href={href} data-created-at={createdAt}>
        {title}
      </a>
      {onDelete && (
        <button type="button" aria-label="Delete" onClick={onDelete}>
          Delete
        </button>
      )}
    </>
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
      <PlanAutomationTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
        buildTaskMonitorPath={(monitorId) =>
          `/projects/project-1/plans/plan-1/task-monitor/${monitorId}`
        }
      />
    </MemoryRouter>
  );

describe("selectUniqueTaskMonitors", () => {
  it("excludes other work-item types and returns repeated monitors once", () => {
    const monitor = workItem();

    expect(
      selectUniqueTaskMonitors([
        monitor,
        workItem({
          id: "standard-1",
          name: "Other work item",
          type: "STANDARD",
        }),
        monitor,
        workItem({ id: "monitor-2", name: "Monitor two" }),
      ])
    ).toEqual([monitor, expect.objectContaining({ id: "monitor-2" })]);
  });
});

describe("PlanAutomationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the Graph-filtered Task Monitor collection and uses the host-provided routes", () => {
    mockUseWorkItems.mockReturnValue(
      hookResult({
        workItems: [
          workItem(),
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
      "/projects/project-1/plans/plan-1/task-monitor/monitor-1"
    );
    expect(
      screen.getByRole("link", { name: "Monitor one" })
    ).not.toHaveAttribute("data-status");
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
        taskType: "TASK_MONITOR",
        relatedEntityId: "plan-1",
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [AgentEdgeType.RelatedTo],
      }
    );
  });

  it("keeps loading, error, and empty states explicit", () => {
    mockUseWorkItems.mockReturnValue(
      hookResult({ isLoading: true, isFetched: false })
    );
    const { rerender } = renderTab();
    expect(screen.getByTestId("plan-automation-loading")).toBeInTheDocument();

    mockUseWorkItems.mockReturnValue(
      hookResult({ error: new Error("Work Items failed") })
    );
    rerender(
      <MemoryRouter>
        <PlanAutomationTab
          organizationId="org-1"
          projectId="project-1"
          planId="plan-1"
          buildTaskMonitorPath={(monitorId) =>
            `/projects/project-1/plans/plan-1/task-monitor/${monitorId}`
          }
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("plan-automation-error")).toHaveTextContent(
      "Work Items failed"
    );

    mockUseWorkItems.mockReturnValue(hookResult());
    rerender(
      <MemoryRouter>
        <PlanAutomationTab
          organizationId="org-1"
          projectId="project-1"
          planId="plan-1"
          buildTaskMonitorPath={(monitorId) =>
            `/projects/project-1/plans/plan-1/task-monitor/${monitorId}`
          }
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("plan-automation-empty")).toBeInTheDocument();
  });

  it("archives a monitor through Work Items and refreshes the filtered collection", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const refetch = vi.fn().mockResolvedValue([]);
    mockUseWorkItems.mockReturnValue(
      hookResult({ workItems: [workItem()], remove, refetch })
    );

    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("monitor-1");
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces a failed archive", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("Archive failed"));
    const refetch = vi.fn().mockResolvedValue([]);
    mockUseWorkItems.mockReturnValue(
      hookResult({ workItems: [workItem()], remove, refetch })
    );

    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByTestId("plan-automation-delete-error")
    ).toHaveTextContent("Archive failed");
    expect(refetch).not.toHaveBeenCalled();
  });
});
