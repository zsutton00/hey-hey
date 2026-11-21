import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaneToggle } from "../PaneToggle";

const mediaQueryState = { matches: false };

vi.mock("@mui/material", async () => {
  const actual =
    await vi.importActual<typeof import("@mui/material")>("@mui/material");
  return {
    ...actual,
    useMediaQuery: () => mediaQueryState.matches,
  };
});

type Pane = "tasks" | "monitor" | "session";

const SEGMENTS = [
  { value: "tasks", label: "Tasks" },
  { value: "monitor", label: "Task Monitor" },
  { value: "session", label: "Active Session" },
] as const;

const segment = (value: Pane): HTMLElement =>
  screen
    .getAllByTestId("pane-toggle-segment")
    .find((el) => el.getAttribute("data-value") === value)!;

const renderToggle = (visible: readonly Pane[], onChange = vi.fn()) => {
  render(
    <PaneToggle<Pane>
      segments={SEGMENTS}
      visibleValues={visible}
      onChange={onChange}
      ariaLabel="Show panes"
    />,
  );
  return onChange;
};

beforeEach(() => {
  mediaQueryState.matches = false;
});

describe("PaneToggle", () => {
  it("reports a hidden pane switched on, keeping the others", () => {
    const onChange = renderToggle(["tasks"]);

    fireEvent.click(segment("session"));

    expect(onChange).toHaveBeenCalledWith(["tasks", "session"]);
  });

  it("reports a showing pane switched off when others remain", () => {
    const onChange = renderToggle(["tasks", "monitor"]);

    fireEvent.click(segment("monitor"));

    expect(onChange).toHaveBeenCalledWith(["tasks"]);
  });

  it("announces each segment as pressed or not pressed", () => {
    renderToggle(["tasks", "session"]);

    expect(segment("tasks")).toHaveAttribute("aria-pressed", "true");
    expect(segment("monitor")).toHaveAttribute("aria-pressed", "false");
    expect(segment("session")).toHaveAttribute("aria-pressed", "true");
  });

  it("does not switch off the last showing pane", () => {
    const onChange = renderToggle(["monitor"]);

    fireEvent.click(segment("monitor"));

    expect(onChange).not.toHaveBeenCalled();
    expect(segment("monitor")).toHaveAttribute("aria-disabled", "true");
    expect(segment("monitor")).toHaveAttribute("aria-pressed", "true");
    expect(segment("tasks")).toHaveAttribute("aria-disabled", "false");
  });

  it("treats a showing pane that is no longer available as not showing", () => {
    const onChange = vi.fn();
    render(
      <PaneToggle<Pane>
        segments={[SEGMENTS[0], SEGMENTS[1]]}
        visibleValues={["tasks", "session"]}
        onChange={onChange}
        ariaLabel="Show panes"
      />,
    );

    expect(segment("tasks")).toHaveAttribute("aria-pressed", "true");
    expect(segment("tasks")).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(segment("tasks"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("becomes a pick-one dropdown on narrow screens", () => {
    mediaQueryState.matches = true;
    const onChange = renderToggle(["tasks"]);

    expect(screen.queryByTestId("pane-toggle")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    const listbox = within(screen.getByRole("listbox"));
    expect(listbox.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Tasks",
      "Task Monitor",
      "Active Session",
    ]);

    fireEvent.click(listbox.getByText("Task Monitor"));

    expect(onChange).toHaveBeenCalledWith(["monitor"]);
  });

  it("lists every showing pane in the closed dropdown", () => {
    mediaQueryState.matches = true;
    renderToggle(["tasks", "monitor"]);

    expect(screen.getByRole("combobox")).toHaveTextContent(
      "Tasks + Task Monitor",
    );
  });
});
