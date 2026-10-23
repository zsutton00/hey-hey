import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";
import { TaskMonitorControlDock } from "../TaskMonitorControlDock";

describe("TaskMonitorControlDock", () => {
  it("offers Start while ready and shows control-owned progress while starting", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const { rerender } = render(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.Backlog}
        presentation={{ status: "ready" }}
        pendingAction={null}
        onStart={onStart}
        onPause={vi.fn()}
      />
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByTestId("task-monitor-start")).toBeEnabled();
    expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-start")).toHaveAccessibleName(
      "Start"
    );
    expect(screen.getByTestId("task-monitor-pause")).toHaveAccessibleName(
      "Pause"
    );
    expect(screen.getByTestId("task-monitor-start")).not.toHaveTextContent(
      "Start"
    );
    expect(screen.getByTestId("task-monitor-pause")).not.toHaveTextContent(
      "Pause"
    );
    const startButton = screen.getByTestId("task-monitor-start");
    const startButtonStyle = window.getComputedStyle(startButton);
    expect(startButtonStyle.width).toBe("40px");
    expect(startButtonStyle.minWidth).toBe("40px");
    expect(startButtonStyle.paddingLeft).toBe("0px");
    expect(startButtonStyle.paddingRight).toBe("0px");
    expect(startButtonStyle.justifyContent).toBe("center");
    expect(startButton.querySelector(".MuiButton-startIcon")).toBeNull();
    expect(startButton.querySelector(".MuiSvgIcon-root")).not.toBeNull();
    expect(screen.queryByTestId("task-monitor-resume")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-monitor-stop")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("task-monitor-start"));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.Backlog}
        presentation={{ status: "starting" }}
        pendingAction={null}
        onStart={onStart}
        onPause={vi.fn()}
      />
    );
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-start-progress")).toBeVisible();
  });

  it("enables only Pause from canonical active state", () => {
    render(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.Active}
        presentation={{ status: "active" }}
        pendingAction={null}
        onStart={vi.fn()}
        onPause={vi.fn()}
      />
    );

    expect(screen.getByTestId("task-monitor-pause")).toBeEnabled();
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.queryByTestId("task-monitor-resume")).not.toBeInTheDocument();
  });

  it("offers Start for canonical on-hold state", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.OnHold}
        presentation={{ status: "ready" }}
        pendingAction={null}
        onStart={onStart}
        onPause={vi.fn()}
      />
    );

    expect(screen.getByTestId("task-monitor-start")).toBeEnabled();
    expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
    await user.click(screen.getByTestId("task-monitor-start"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("renders Resume progress on Start from canonical on-hold state", () => {
    render(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.OnHold}
        presentation={{ status: "ready" }}
        pendingAction="RESUME"
        onStart={vi.fn()}
        onPause={vi.fn()}
      />
    );

    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-start-progress")).toBeVisible();
    expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
    expect(screen.queryByTestId("task-monitor-resume")).not.toBeInTheDocument();
  });

  it.each([
    WorkStatus.Verifying,
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Archived,
    WorkStatus.Superseded,
  ])(
    "renders disabled lifecycle actions for terminal status %s",
    (monitorStatus) => {
      render(
        <TaskMonitorControlDock
          monitorStatus={monitorStatus}
          presentation={{ status: "active" }}
          pendingAction={null}
          onStart={vi.fn()}
          onPause={vi.fn()}
        />
      );

      expect(screen.getByTestId("task-monitor-control-dock")).toBeVisible();
      expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
      expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
      expect(
        screen.queryByTestId("task-monitor-resume")
      ).not.toBeInTheDocument();
    }
  );

  it("disables the projected lifecycle action without an authorized machine", () => {
    render(
      <TaskMonitorControlDock
        monitorStatus={WorkStatus.Active}
        presentation={{ status: "active" }}
        pendingAction={null}
        controlsDisabled
        onStart={vi.fn()}
        onPause={vi.fn()}
      />
    );

    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
    expect(screen.queryByTestId("task-monitor-resume")).not.toBeInTheDocument();
  });
});
