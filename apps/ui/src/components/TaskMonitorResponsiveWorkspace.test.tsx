import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMonitorResponsiveWorkspace } from "./TaskMonitorResponsiveWorkspace";

const taskMonitorMock = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/components", () => ({
  TaskMonitor: (props: {
    organizationId: string;
    projectId: string;
    monitorId: string;
    activePane: string;
  }) => {
    taskMonitorMock(props);
    return <div data-testid="task-monitor">{props.activePane}</div>;
  },
}));

describe("TaskMonitorResponsiveWorkspace", () => {
  it("uses the shared pane selector to control the compact workspace", () => {
    render(
      <TaskMonitorResponsiveWorkspace
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
      />
    );

    expect(screen.getByTestId("task-monitor")).toHaveTextContent("monitor");
    fireEvent.click(screen.getByRole("button", { name: "Active Session" }));
    expect(screen.getByTestId("task-monitor")).toHaveTextContent("session");
    expect(taskMonitorMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
      activePane: "session",
    });
  });
});
