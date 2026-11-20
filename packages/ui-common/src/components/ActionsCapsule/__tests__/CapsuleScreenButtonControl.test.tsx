import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskMonitorIcon } from "../../../utils/icons/TaskMonitor";
import { CapsuleScreenButtonControl } from "../CapsuleScreenButtonControl";

describe("CapsuleScreenButtonControl", () => {
  it("shows the label below the icon square, progress on the square, and explains the state on hover", async () => {
    const onClick = vi.fn();
    render(
      <CapsuleScreenButtonControl
        button={{
          key: "task-monitor:1",
          label: "Monitor",
          icon: TaskMonitorIcon,
          accessibleName: "Open Task Monitor",
          tooltip: "Task Monitor: running. 1 of 4 tasks done. Click to open.",
          status: { state: "running", text: "1/4" },
          onClick,
        }}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Open Task Monitor" });
    const square = screen.getByTestId("capsule-screen-button-square");
    expect(square).toContainElement(
      screen.getByTestId("capsule-screen-button-progress"),
    );
    expect(square).toHaveTextContent("1/4");
    expect(screen.getByTestId("capsule-screen-button-label")).toHaveTextContent(
      "Monitor",
    );
    expect(square).not.toContainElement(
      screen.getByTestId("capsule-screen-button-label"),
    );

    await userEvent.hover(button);
    expect(
      await screen.findByText(
        "Task Monitor: running. 1 of 4 tasks done. Click to open.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables a pending button, shows a spinner and still explains why on hover", async () => {
    const onClick = vi.fn();
    render(
      <CapsuleScreenButtonControl
        button={{
          key: "task-monitor-lifecycle:1",
          label: "Start",
          icon: TaskMonitorIcon,
          accessibleName: "Start",
          tooltip: "Waiting for the monitor to confirm the command.",
          disabled: true,
          pending: true,
          onClick,
        }}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Start" });
    expect(button).toBeDisabled();
    expect(screen.getByTestId("capsule-screen-button-pending")).toBeVisible();

    await userEvent.hover(button.parentElement as HTMLElement);
    expect(
      await screen.findByText(
        "Waiting for the monitor to confirm the command.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
