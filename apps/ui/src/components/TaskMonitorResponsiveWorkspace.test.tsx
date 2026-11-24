import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMonitorResponsiveWorkspace } from "./TaskMonitorResponsiveWorkspace";

const taskMonitorMock = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/components", () => ({
  TaskMonitor: (props: Record<string, unknown>) => {
    taskMonitorMock(props);
    return <div data-testid="task-monitor" />;
  },
}));

describe("TaskMonitorResponsiveWorkspace", () => {
  it("renders the canonical workspace, which owns its own pane control", () => {
    render(
      <TaskMonitorResponsiveWorkspace
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
      />,
    );

    expect(screen.getByTestId("task-monitor")).toBeInTheDocument();
    expect(taskMonitorMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
    });
  });
});
