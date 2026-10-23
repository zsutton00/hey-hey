import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentedToggle, type Segment } from "./SegmentedToggle";

type View = "coding" | "conversations";

const segments: readonly Segment<View>[] = [
  { value: "coding", label: "Coding" },
  { value: "conversations", label: "Conversations" },
];

const setCompactViewport = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("SegmentedToggle", () => {
  beforeEach(() => {
    setCompactViewport(false);
  });

  it("keeps the pill presentation above the mobile breakpoint", () => {
    render(
      <SegmentedToggle
        mobileDropdown
        segments={segments}
        value="coding"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Coding" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the selected value and forwards mobile dropdown changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    setCompactViewport(true);

    render(
      <SegmentedToggle
        mobileDropdown
        segments={segments}
        value="coding"
        onChange={onChange}
      />,
    );

    const dropdown = screen.getByRole("combobox", { name: "Select view" });
    expect(dropdown).toHaveTextContent("Coding");

    fireEvent.mouseDown(dropdown);
    await user.click(screen.getByRole("option", { name: "Conversations" }));

    expect(onChange).toHaveBeenCalledWith("conversations");
  });
});
