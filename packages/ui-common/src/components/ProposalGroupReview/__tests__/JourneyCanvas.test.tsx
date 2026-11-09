import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JourneyCanvas } from "../JourneyCanvas";
import type { WorkflowGraphSurfaceData } from "../../shared/WorkflowMentionInlineRenderer";

type Steps = WorkflowGraphSurfaceData["steps"];
type Edges = WorkflowGraphSurfaceData["edges"];

const step = (id: string, name: string) => ({ id, name }) as Steps[number];
const edge = (
  id: string,
  source: string,
  target: string,
  actionLabel: string,
  transitionRole: string | null,
) =>
  ({
    id,
    sourceNodeId: source,
    targetNodeId: target,
    actionLabel,
    transitionRole,
  }) as unknown as Edges[number];

describe("JourneyCanvas", () => {
  it("shows every screen and labelled transition, with roles from the edges", () => {
    render(
      <JourneyCanvas
        steps={[
          step("cart", "Cart"),
          step("pay", "Pay"),
          step("declined", "Declined"),
          step("done", "Done"),
        ]}
        edges={[
          edge("e1", "cart", "pay", "Check out", "PRIMARY_PROGRESSION"),
          edge("e2", "pay", "done", "Confirm", "PRIMARY_PROGRESSION"),
          edge("e3", "pay", "declined", "Card fails", "ERROR_PATH"),
          edge("e4", "declined", "pay", "Try again", "RECOVERY"),
          edge("e5", "done", "cart", "Shop again", "RETURN"),
          edge("e6", "cart", "done", "Legacy skip", null),
        ]}
        savedPositions={new Map()}
        renderScreen={(s) => <div>{s.name}</div>}
      />,
    );

    expect(screen.getAllByTestId("journey-screen")).toHaveLength(4);
    const transitions = screen.getAllByTestId("journey-transition");
    expect(transitions).toHaveLength(6);
    [
      "Check out",
      "Confirm",
      "Card fails",
      "Try again",
      "Shop again",
      "Legacy skip",
    ].forEach((label) => {
      expect(
        within(
          transitions.find((t) => t.textContent === label) as HTMLElement,
        ).getByText(label),
      ).toBeTruthy();
    });
    const left = (name: string) =>
      parseFloat(
        getComputedStyle(
          screen.getByText(name).closest('[data-testid="journey-screen"]')!,
        ).left,
      );
    expect(left("Cart")).toBeLessThan(left("Pay"));
    expect(left("Pay")).toBeLessThan(left("Done"));
  });

  describe("dragging with the mouse", () => {
    const mouse = { button: 0 };
    beforeEach(() => {
      // jsdom has no PointerEvent, so events would carry no coordinates.
      class MousePointerEvent extends MouseEvent {
        pointerType = "mouse";
      }
      vi.stubGlobal("PointerEvent", MousePointerEvent);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const renderCanvas = (onClick: () => void) => {
      render(
        <JourneyCanvas
          steps={[step("cart", "Cart")]}
          edges={[]}
          savedPositions={new Map()}
          renderScreen={(s) => (
            <button type="button" onClick={onClick}>
              {s.name}
            </button>
          )}
        />,
      );
      return screen.getByTestId("journey-canvas");
    };

    it("scrolls the flow and does not click the screen it ends on", () => {
      const onClick = vi.fn();
      const canvas = renderCanvas(onClick);
      canvas.scrollLeft = 200;
      const target = screen.getByText("Cart");

      fireEvent.pointerDown(target, { ...mouse, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { ...mouse, clientX: 60, clientY: 100 });
      fireEvent.pointerUp(window, mouse);
      fireEvent.click(target);

      expect(canvas.scrollLeft).toBe(240);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("still clicks a screen when the pointer did not travel", () => {
      const onClick = vi.fn();
      renderCanvas(onClick);
      const target = screen.getByText("Cart");

      fireEvent.pointerDown(target, { ...mouse, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(window, mouse);
      fireEvent.click(target);

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
