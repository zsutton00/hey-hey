import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTheme, ThemeProvider } from "@mui/material";
import { describe, expect, it, vi } from "vitest";
import { TaskMonitorIcon } from "../../../utils/icons/TaskMonitor";
import { CapsuleActionButton } from "../CapsuleActionButton";
import { CapsuleScreenButtonControl } from "../CapsuleScreenButtonControl";
import { CAPSULE_CHIP_SIZE, GRID_ICON_CHIP_SIZE } from "../capsuleChipSize";

const baseButton = {
  key: "k",
  label: "Start",
  icon: TaskMonitorIcon,
  accessibleName: "Start",
  onClick: () => {},
};

function renderSquare(
  button: Partial<typeof baseButton> & Record<string, unknown>,
  mode: "light" | "dark",
  gridCell = false,
) {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <CapsuleScreenButtonControl
        button={{ ...baseButton, ...button }}
        onClick={() => {}}
        gridCell={gridCell}
      />
    </ThemeProvider>,
  );
  return screen.getByTestId("capsule-screen-button-square");
}

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

  it.each(["light", "dark"] as const)(
    "draws a solid opaque purple square with a white icon in %s mode",
    (mode) => {
      const square = renderSquare({}, mode);
      expect(square).toHaveStyle({
        backgroundColor: "rgb(91, 63, 160)",
        color: "rgb(255, 255, 255)",
      });
    },
  );

  it("draws a solid amber square with the theme's contrast colour when the monitor needs you", () => {
    const theme = createTheme({ palette: { mode: "light" } });
    const square = renderSquare(
      { status: { state: "needs-you", text: "2/3" } },
      "light",
    );
    expect(square).toHaveStyle({
      backgroundColor: theme.palette.warning.main,
      color: theme.palette.warning.contrastText,
    });
  });

  it("is exactly as large as the round chip on desktop and in the mobile grid", () => {
    const desktop = renderSquare({}, "light");
    expect(desktop).toHaveStyle({
      width: `${CAPSULE_CHIP_SIZE}px`,
      height: `${CAPSULE_CHIP_SIZE}px`,
    });
    cleanup();

    const grid = renderSquare({}, "light", true);
    expect(grid).toHaveStyle({
      width: `${GRID_ICON_CHIP_SIZE}px`,
      height: `${GRID_ICON_CHIP_SIZE}px`,
    });
  });

  it("lines the square up with the round chips: same box, same padding, same label metrics", () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <CapsuleActionButton
          action={{
            id: "discuss",
            label: "Discuss",
            icon: TaskMonitorIcon,
            behavior: "click",
            actionGroup: "site",
            tier: "site",
            order: 0,
            onClick: () => {},
          }}
          idx={0}
          isActive={false}
          isAnyExpanded={false}
          onClick={() => {}}
        />
        <CapsuleScreenButtonControl
          button={{ ...baseButton, status: undefined }}
          onClick={() => {}}
        />
      </ThemeProvider>,
    );

    const roundButton = screen.getByTestId("capsule-action-discuss");
    const roundChip = roundButton.querySelector(".MuiButton-startIcon");
    const roundIcon = roundChip?.querySelector("svg");
    const squareButton = screen.getByTestId("capsule-screen-button");
    const square = screen.getByTestId("capsule-screen-button-square");
    const squareIcon = square.querySelector("svg");
    const squareLabel = screen.getByTestId("capsule-screen-button-label");

    const chip = getComputedStyle(roundChip as Element);
    const box = getComputedStyle(square);
    expect(box.height).toBe(chip.height);
    expect(box.width).toBe(chip.width);

    expect(getComputedStyle(squareIcon as Element).fontSize).toBe(
      getComputedStyle(roundIcon as Element).fontSize,
    );

    const roundMetrics = getComputedStyle(roundButton);
    const squareMetrics = getComputedStyle(squareButton);
    expect(squareMetrics.paddingTop).toBe(roundMetrics.paddingTop);
    expect(squareMetrics.paddingBottom).toBe(roundMetrics.paddingBottom);
    expect(getComputedStyle(squareLabel).fontSize).toBe(roundMetrics.fontSize);
  });
});
