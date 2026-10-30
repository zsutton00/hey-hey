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
  it("exposes overflow controls and reveals selected and keyboard-focused types", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedToggle
        scrollable
        segments={segments}
        value="coding"
        onChange={onChange}
      />,
    );
    const first = screen.getByRole("button", { name: "Coding" });
    const last = screen.getByRole("button", { name: "Conversations" });
    const viewport = first.parentElement!.parentElement!;
    const scrollBy = vi.fn();
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
      scrollBy: { configurable: true, value: scrollBy },
    });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
    } as DOMRect);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 100,
    } as DOMRect);
    vi.spyOn(last, "getBoundingClientRect").mockReturnValue({
      left: 450,
      right: 600,
    } as DOMRect);
    fireEvent(window, new Event("resize"));

    expect(
      screen.getByRole("button", { name: "Previous types" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next types" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 160, behavior: "smooth" });
    fireEvent.focus(last);
    expect(viewport.scrollLeft).toBe(400);
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "Next types" })).toBeDisabled();
    fireEvent.click(last);
    expect(onChange).toHaveBeenCalledWith("conversations");

    viewport.scrollLeft = 0;
    rerender(
      <SegmentedToggle
        scrollable
        segments={segments}
        value="conversations"
        onChange={onChange}
      />,
    );
    expect(viewport.scrollLeft).toBe(400);
    expect(last).toHaveAttribute("aria-pressed", "true");
    viewport.scrollLeft = 0;
    fireEvent(window, new Event("resize"));
    expect(viewport.scrollLeft).toBe(400);
  });

  it("keeps the mobile dropdown when scrolling is enabled", () => {
    setCompactViewport(true);
    render(
      <SegmentedToggle
        scrollable
        mobileDropdown
        segments={segments}
        value="conversations"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Conversations");
    expect(
      screen.queryByRole("button", { name: "Next types" }),
    ).not.toBeInTheDocument();
  });
});
