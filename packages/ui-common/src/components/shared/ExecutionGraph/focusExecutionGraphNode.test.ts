import { describe, expect, it, vi } from "vitest";
import { focusExecutionGraphNode } from "./focusExecutionGraphNode";

describe("focusExecutionGraphNode", () => {
  it("centers the measured node when the graph fits in the viewport", () => {
    const setCenter = vi.fn();
    const node = {
      id: "target",
      position: { x: 120, y: 240 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const reactFlow = {
      getNode: vi.fn(() => node),
      getNodes: vi.fn(() => [node]),
      getZoom: vi.fn(() => 0.8),
      setCenter,
    };

    expect(
      focusExecutionGraphNode(reactFlow, "target", {
        width: 1000,
        height: 800,
      })
    ).toBe(true);
    expect(setCenter).toHaveBeenCalledWith(320, 330, {
      duration: 0,
      zoom: 0.8,
    });
  });

  it("clamps the first column and top row to the viewport edges", () => {
    const setCenter = vi.fn();
    const active = {
      id: "active",
      position: { x: 0, y: 0 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const sibling = {
      id: "sibling",
      position: { x: 520, y: 900 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const reactFlow = {
      getNode: vi.fn(() => active),
      getNodes: vi.fn(() => [active, sibling]),
      getZoom: vi.fn(() => 1),
      setCenter,
    };

    expect(
      focusExecutionGraphNode(reactFlow, "active", {
        width: 800,
        height: 600,
      })
    ).toBe(true);
    expect(setCenter).toHaveBeenCalledWith(400, 300, {
      duration: 0,
      zoom: 1,
    });
  });

  it("centers an interior node without using sibling branch bounds as its target", () => {
    const setCenter = vi.fn();
    const active = {
      id: "active",
      position: { x: 520, y: 360 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const sibling = {
      id: "sibling",
      position: { x: 0, y: 0 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const farNode = {
      id: "far",
      position: { x: 1040, y: 900 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const reactFlow = {
      getNode: vi.fn(() => active),
      getNodes: vi.fn(() => [active, sibling, farNode]),
      getZoom: vi.fn(() => 1),
      setCenter,
    };

    expect(
      focusExecutionGraphNode(reactFlow, "active", {
        width: 800,
        height: 600,
      })
    ).toBe(true);
    expect(setCenter).toHaveBeenCalledWith(720, 450, {
      duration: 0,
      zoom: 1,
    });
  });

  it("uses the active node's center when a sibling branch is taller", () => {
    const setCenter = vi.fn();
    const active = {
      id: "active",
      position: { x: 120, y: 240 },
      data: { node: {} },
      width: 400,
      height: 180,
    };
    const sibling = {
      id: "sibling",
      position: { x: 120, y: 0 },
      data: { node: {} },
      width: 400,
      height: 900,
    };
    const reactFlow = {
      getNode: vi.fn(() => active),
      getNodes: vi.fn(() => [active, sibling]),
      getZoom: vi.fn(() => 1),
      setCenter,
    };

    expect(
      focusExecutionGraphNode(reactFlow, "active", {
        width: 800,
        height: 600,
      })
    ).toBe(true);
    expect(setCenter).toHaveBeenCalledWith(320, 330, {
      duration: 0,
      zoom: 1,
    });
  });

  it("does not focus an unmeasured node", () => {
    const setCenter = vi.fn();
    const node = {
      id: "target",
      position: { x: 120, y: 240 },
      data: { node: {} },
      width: null,
      height: null,
    };
    const reactFlow = {
      getNode: vi.fn(() => node),
      getNodes: vi.fn(() => [node]),
      getZoom: vi.fn(() => 1),
      setCenter,
    };

    expect(
      focusExecutionGraphNode(reactFlow, "target", {
        width: 800,
        height: 600,
      })
    ).toBe(false);
    expect(setCenter).not.toHaveBeenCalled();
  });
});
