import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResponsiveTabs } from "../ResponsiveTabs";
import type { ResponsiveTab } from "../types";

const mediaQueryState = { matches: false };

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual<typeof import("@mui/material")>(
    "@mui/material"
  );
  return {
    ...actual,
    useMediaQuery: () => mediaQueryState.matches,
  };
});

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;
const resizeCallbacks = new Set<ResizeCallback>();

const fireResize = (): void => {
  resizeCallbacks.forEach((cb) => cb([] as unknown as ResizeObserverEntry[]));
};

class MockResizeObserver {
  callback: ResizeCallback;
  constructor(cb: ResizeCallback) {
    this.callback = cb;
    resizeCallbacks.add(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }
}

beforeEach(() => {
  mediaQueryState.matches = false;
  resizeCallbacks.clear();
  global.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

const TABS: ResponsiveTab[] = [
  { value: "task", label: "Task" },
  { value: "coding-sessions", label: "Coding Sessions (3)" },
  { value: "child-tasks", label: "Child Tasks (5)" },
  { value: "design-docs", label: "Design Docs (2)" },
  { value: "conversations", label: "Conversations (4)" },
  { value: "admin", label: "Admin" },
  { value: "data-debug", label: "Data Debug" },
];

const stubClientWidth = (el: HTMLElement, width: number): void => {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: width,
  });
};

describe("ResponsiveTabs", () => {
  it("renders all tabs inline above md breakpoint", () => {
    mediaQueryState.matches = false;
    const onChange = vi.fn();
    render(<ResponsiveTabs value="task" onChange={onChange} tabs={TABS} />);
    for (const tab of TABS) {
      expect(screen.getByRole("tab", { name: tab.label })).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId("responsive-tabs-more")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("responsive-tabs-scroll")
    ).not.toBeInTheDocument();
  });

  it("fires onChange when a tab is clicked above md", () => {
    mediaQueryState.matches = false;
    const onChange = vi.fn();
    render(<ResponsiveTabs value="task" onChange={onChange} tabs={TABS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Admin" }));
    expect(onChange).toHaveBeenCalledWith("admin");
  });

  it("scroll mode reveals right fade when content overflows and left fade when scrolled", () => {
    mediaQueryState.matches = true;
    render(
      <ResponsiveTabs
        value="task"
        onChange={vi.fn()}
        tabs={TABS}
        overflow="scroll"
      />
    );
    const container = screen.getByTestId("responsive-tabs-scroll");
    const scroller = container.querySelector(
      ".MuiTabs-scroller"
    ) as HTMLDivElement;
    expect(scroller).not.toBeNull();

    stubClientWidth(scroller, 200);
    Object.defineProperty(scroller, "scrollWidth", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });

    act(() => {
      fireResize();
    });

    const leftFade = screen.getByTestId("responsive-tabs-fade-left");
    const rightFade = screen.getByTestId("responsive-tabs-fade-right");

    expect(leftFade).toHaveStyle({ opacity: "0" });
    expect(rightFade).toHaveStyle({ opacity: "1" });

    act(() => {
      (scroller as unknown as { scrollLeft: number }).scrollLeft = 150;
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(leftFade).toHaveStyle({ opacity: "1" });
    expect(rightFade).toHaveStyle({ opacity: "1" });

    act(() => {
      (scroller as unknown as { scrollLeft: number }).scrollLeft = 400;
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(rightFade).toHaveStyle({ opacity: "0" });
  });

  it("menu mode collapses overflow tabs into a More popover and preserves selection", () => {
    mediaQueryState.matches = true;

    const originalGetClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    const originalGetOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth"
    );

    // Stub default offsetWidth for measured tabs/More button via per-element setup below.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute("data-measure-tab")) return 80;
        if (this.hasAttribute("data-measure-more")) return 60;
        return 0;
      },
    });

    try {
      const { rerender } = render(
        <ResponsiveTabs
          value="task"
          onChange={vi.fn()}
          tabs={TABS}
          overflow="menu"
        />
      );

      const container = screen.getByTestId("responsive-tabs-menu");
      stubClientWidth(container, 260);
      act(() => {
        fireResize();
      });

      // Budget = 260 - 60 = 200; tab width 80 each → 2 inline + 5 overflow.
      const inlineTabs = within(container).getAllByRole("tab");
      expect(inlineTabs).toHaveLength(2);
      expect(inlineTabs[0]).toHaveTextContent("Task");
      expect(inlineTabs[1]).toHaveTextContent("Coding Sessions (3)");

      const moreButton = screen.getByTestId("responsive-tabs-more");
      expect(moreButton).toHaveAttribute("aria-expanded", "false");

      // Active tab "task" is inline, so More button should not be in primary color state.
      // Switch to a value that lives in overflow.
      rerender(
        <ResponsiveTabs
          value="data-debug"
          onChange={vi.fn()}
          tabs={TABS}
          overflow="menu"
        />
      );

      const moreButtonAfter = screen.getByTestId("responsive-tabs-more");
      // When active tab is in overflow we mark More as primary/outlined.
      expect(moreButtonAfter.className).toMatch(/MuiButton-outlined/);

      fireEvent.click(moreButtonAfter);
      const menu = screen.getByRole("menu");
      const overflowItems = within(menu).getAllByRole("menuitem");
      const overflowLabels = overflowItems.map((el) => el.textContent);
      expect(overflowLabels).toEqual([
        "Child Tasks (5)",
        "Design Docs (2)",
        "Conversations (4)",
        "Admin",
        "Data Debug",
      ]);

      const selectedItem = within(menu).getByText("Data Debug").closest("li");
      expect(selectedItem).toHaveClass("Mui-selected");

      const onChange = vi.fn();
      rerender(
        <ResponsiveTabs
          value="data-debug"
          onChange={onChange}
          tabs={TABS}
          overflow="menu"
        />
      );
      fireEvent.click(screen.getByTestId("responsive-tabs-more"));
      fireEvent.click(within(screen.getByRole("menu")).getByText("Admin"));
      expect(onChange).toHaveBeenCalledWith("admin");
    } finally {
      if (originalGetClientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          originalGetClientWidth
        );
      }
      if (originalGetOffsetWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetWidth",
          originalGetOffsetWidth
        );
      } else {
        // remove the override we added
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .offsetWidth;
      }
    }
  });
});
