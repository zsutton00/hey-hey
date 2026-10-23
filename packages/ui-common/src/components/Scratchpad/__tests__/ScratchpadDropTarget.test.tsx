import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { ScratchpadDropTarget } from "../ScratchpadDropTarget";

const mockDndState = {
  activeContent: null,
  activeSourceId: null,
  isDragging: false,
  setActiveContent: vi.fn(),
  setActiveSourceId: vi.fn(),
  setIsDragging: vi.fn(),
};

const measureDroppableContainersMock = vi.fn();

vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: vi.fn(() => mockDndState),
}));

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>(
    "@dnd-kit/core"
  );
  return {
    ...actual,
    useDndContext: () => ({
      ...actual.useDndContext(),
      measureDroppableContainers: measureDroppableContainersMock,
    }),
  };
});

vi.mock("../useScratchpad", () => ({
  useScratchpad: vi.fn(() => ({
    items: [],
    addFromDrag: vi.fn(),
    removeItem: vi.fn(),
    reorderItems: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

function renderTarget() {
  return render(
    <DndContext>
      <ScratchpadDropTarget />
    </DndContext>
  );
}

describe("ScratchpadDropTarget", () => {
  it("stays mounted but visually collapsed when not dragging so dnd-kit can pre-measure it", () => {
    mockDndState.isDragging = false;
    renderTarget();

    // The label remains in the DOM so the droppable is registered and
    // measurable before any drag begins — visual hiding is handled via CSS.
    expect(screen.getByText("Drop to scratchpad")).toBeInTheDocument();
    const wrapper = screen.getByTestId("scratchpad-drop-target-wrapper");
    expect(wrapper).toHaveStyle({
      opacity: "0",
      "pointer-events": "none",
    });
  });

  it("appears when dragging", async () => {
    mockDndState.isDragging = true;
    renderTarget();

    expect(await screen.findByText("Drop to scratchpad")).toBeInTheDocument();
    expect(screen.getByText(/Collect entities to review/)).toBeInTheDocument();
    const wrapper = screen.getByTestId("scratchpad-drop-target-wrapper");
    expect(wrapper).toHaveStyle({
      opacity: "1",
      "pointer-events": "auto",
    });
  });

  it("renders the drop target as a full-width slot so it stacks above the action buttons in column layout", async () => {
    mockDndState.isDragging = true;
    renderTarget();

    await screen.findByText("Drop to scratchpad");
    const wrapper = screen.getByTestId("scratchpad-drop-target-wrapper");
    expect(wrapper).toHaveStyle({ width: "100%" });
  });

  it("forces a droppable re-measure when the wrapper's max-height transition completes so collision detection tracks the expanded affordance instead of the pre-transition rect", async () => {
    mockDndState.isDragging = true;
    measureDroppableContainersMock.mockClear();
    renderTarget();

    const wrapper = await screen.findByTestId("scratchpad-drop-target-wrapper");

    await act(async () => {
      const event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "max-height" });
      wrapper.dispatchEvent(event);
    });

    expect(measureDroppableContainersMock).toHaveBeenCalledWith([
      "scratchpad-drop-target",
    ]);
  });
});
