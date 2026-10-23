import { resolveDiagramExplorationTarget } from "../workflowGraphInteractions";
import { describe, expect, it, vi } from "vitest";
import {
  getVisibleCanvasCenter,
  resolveEmptyCanvasContextMenu,
  resolveConnectionCompletion,
  resolveNodeContextMenu,
  resolveNodeDragCompletion,
  resolveReconnectCompletion,
} from "../workflowGraphInteractions";

const source = { refType: "existing", id: "source" } as const;
const target = { refType: "existing", id: "target" } as const;
const replacement = { refType: "existing", id: "replacement" } as const;
const relationship = { refType: "existing", id: "relationship" } as const;

describe("workflow graph interactions", () => {
  it("keeps a finite node context-menu position and screen anchor", () => {
    expect(
      resolveNodeContextMenu({
        child: source,
        position: { x: 640, y: 360 },
        menuPosition: { x: 240, y: 180 },
        allowContextMenu: true,
      })
    ).toEqual({
      child: source,
      position: { x: 640, y: 360 },
      menuPosition: { x: 240, y: 180 },
    });
  });

  it.each([
    { name: "authoring is disabled", allowContextMenu: false },
    {
      name: "the logical position is not finite",
      allowContextMenu: true,
      position: { x: Number.NaN, y: 360 },
    },
    {
      name: "the screen anchor is not finite",
      allowContextMenu: true,
      menuPosition: { x: 240, y: Number.POSITIVE_INFINITY },
    },
  ])("ignores a node context menu when $name", (input) => {
    expect(
      resolveNodeContextMenu({
        child: source,
        position: input.position ?? { x: 640, y: 360 },
        menuPosition: input.menuPosition ?? { x: 240, y: 180 },
        allowContextMenu: input.allowContextMenu,
      })
    ).toBeUndefined();
  });

  it("keeps an empty-canvas context menu at its logical position", () => {
    expect(
      resolveEmptyCanvasContextMenu({
        position: { x: 900, y: 700 },
        menuPosition: { x: 300, y: 220 },
        allowContextMenu: true,
      })
    ).toEqual({
      position: { x: 900, y: 700 },
      menuPosition: { x: 300, y: 220 },
    });
  });

  it("completes an editable node drag at its released logical position", () => {
    expect(
      resolveNodeDragCompletion({
        child: source,
        position: { x: 640, y: 360 },
        allowNodeDragging: true,
        isConnecting: false,
        isReconnecting: false,
      })
    ).toEqual({
      child: source,
      position: { x: 640, y: 360 },
    });
  });

  it.each([
    {
      name: "dragging is disabled",
      allowNodeDragging: false,
      isConnecting: false,
      isReconnecting: false,
      position: { x: 10, y: 20 },
    },
    {
      name: "a connection is active",
      allowNodeDragging: true,
      isConnecting: true,
      isReconnecting: false,
      position: { x: 10, y: 20 },
    },
    {
      name: "a reconnection is active",
      allowNodeDragging: true,
      isConnecting: false,
      isReconnecting: true,
      position: { x: 10, y: 20 },
    },
    {
      name: "the released position is not finite",
      allowNodeDragging: true,
      isConnecting: false,
      isReconnecting: false,
      position: { x: Number.NaN, y: 20 },
    },
  ])("ignores node drag completion when $name", (input) => {
    expect(
      resolveNodeDragCompletion({ child: source, ...input })
    ).toBeUndefined();
  });

  it("projects the visible viewport center through the current screen transform", () => {
    const screenToFlowPosition = vi.fn(
      ({ x, y }: { x: number; y: number }) => ({
        x: x + 320,
        y: y + 180,
      })
    );
    const viewport = {
      clientWidth: 600,
      clientHeight: 400,
      getBoundingClientRect: () => ({
        left: -120,
        top: -40,
      }),
    } as HTMLElement;

    expect(getVisibleCanvasCenter(viewport, screenToFlowPosition)).toEqual({
      x: 500,
      y: 340,
    });
    expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 180, y: 160 });
  });

  it("prefers an existing target over the empty-canvas fallback", () => {
    expect(
      resolveConnectionCompletion({
        source,
        target,
        isValid: false,
        isReconnecting: false,
        emptyCanvasPosition: { x: 900, y: 700 },
      })
    ).toEqual({
      kind: "connect",
      gesture: { source, target },
    });
  });

  it("cancels a connection released without a target or canvas position", () => {
    expect(
      resolveConnectionCompletion({
        source,
        isValid: false,
        isReconnecting: false,
      })
    ).toEqual({ kind: "handled" });
  });

  it("retains empty-canvas creation when no existing target resolves", () => {
    expect(
      resolveConnectionCompletion({
        source,
        isValid: false,
        isReconnecting: false,
        emptyCanvasPosition: { x: 900, y: 700 },
      })
    ).toEqual({
      kind: "empty-canvas",
      drop: { source, position: { x: 900, y: 700 } },
    });
  });

  it("does not duplicate a connection React Flow already accepted", () => {
    expect(
      resolveConnectionCompletion({
        source,
        target,
        isValid: true,
        isReconnecting: false,
        emptyCanvasPosition: { x: 900, y: 700 },
      })
    ).toEqual({ kind: "handled" });
  });

  it("does not create a step when React Flow also ends a reconnection", () => {
    expect(
      resolveConnectionCompletion({
        source,
        isValid: false,
        isReconnecting: true,
        emptyCanvasPosition: { x: 900, y: 700 },
      })
    ).toEqual({ kind: "handled" });
  });

  it("swaps the target endpoint when the source endpoint stayed fixed", () => {
    expect(
      resolveReconnectCompletion({
        relationship,
        currentSource: source,
        currentTarget: target,
        stationaryEndpoint: "source",
        dropTarget: replacement,
      })
    ).toEqual({
      kind: "reconnect",
      gesture: {
        relationship,
        source,
        target: replacement,
      },
    });
  });

  it("swaps the source endpoint when the target endpoint stayed fixed", () => {
    expect(
      resolveReconnectCompletion({
        relationship,
        currentSource: source,
        currentTarget: target,
        stationaryEndpoint: "target",
        dropTarget: replacement,
      })
    ).toEqual({
      kind: "reconnect",
      gesture: {
        relationship,
        source: replacement,
        target,
      },
    });
  });

  it("does nothing when a reconnect ends outside a step", () => {
    expect(
      resolveReconnectCompletion({
        relationship,
        currentSource: source,
        currentTarget: target,
        stationaryEndpoint: "source",
      })
    ).toEqual({ kind: "handled" });
  });
});

describe("Diagram exploration eligibility", () => {
  it.each([
    ["element", "target", false, "TASK", "DIAGRAM_REFERENCE", "target"],
    [
      "temporary:element",
      "target",
      false,
      "TASK",
      "DIAGRAM_REFERENCE",
      undefined,
    ],
    [
      "element",
      "temporary:target",
      false,
      "TASK",
      "DIAGRAM_REFERENCE",
      undefined,
    ],
    ["element", "target", true, "TASK", "DIAGRAM_REFERENCE", undefined],
    ["element", "target", false, "SERVICE", "DIAGRAM_REFERENCE", undefined],
    ["element", "target", false, "TASK", "CONTAINER", undefined],
  ] as const)(
    "resolves only navigable Diagram references (%s, %s, %s, %s, %s)",
    (element, target, disabled, entityType, role, expected) => {
      expect(
        resolveDiagramExplorationTarget(
          { role, canonicalReference: { entityType, entityId: target } },
          element,
          disabled,
        ),
      ).toBe(expected);
    },
  );
});
