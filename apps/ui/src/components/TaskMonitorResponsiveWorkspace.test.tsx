import { render, screen } from "@testing-library/react";
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
  it("leaves state-dependent pane navigation with the canonical workspace", () => {
    render(
      <TaskMonitorResponsiveWorkspace
        organizationId="org-1"
        projectId="project-1"
        monitorId="monitor-1"
      />,
    );

    expect(screen.getByTestId("task-monitor")).toHaveTextContent("session");
    expect(
      screen.queryByRole("button", { name: "Active Session" }),
    ).not.toBeInTheDocument();
    expect(taskMonitorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        activePane: "session",
        renderPaneNavigation: expect.any(Function),
      }),
    );
  });
});
