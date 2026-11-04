import { describe, expect, it } from "vitest";
import { routeJourneyConnectors } from "../routeJourneyConnectors";

const geometry = { columnGap: 160, inset: 8, maxAnchorOffset: 180 };
const box = (column: number, row: number) => ({
  x: column * 760,
  y: row * 600,
  width: 600,
  height: 450,
});

describe("routeJourneyConnectors", () => {
  it("routes a return across columns through the gutter instead of over a middle screen", () => {
    const cells = new Map([
      ["a", { column: 0, row: 0 }],
      ["b", { column: 1, row: 0 }],
      ["c", { column: 2, row: 0 }],
    ]);
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(1, 0)],
      ["c", box(2, 0)],
    ]);
    const [route] = routeJourneyConnectors(
      cells,
      boxes,
      [{ id: "back", sourceId: "c", targetId: "a" }],
      geometry,
    );

    expect(route.path.split("L").length).toBeGreaterThan(4);
    const gutterY = Number(route.path.split(" L ")[2].split(" ")[1]);
    expect(gutterY).toBeGreaterThan(450);
  });

  it("separates parallel edges and keeps self-loops visible", () => {
    const cells = new Map([
      ["a", { column: 0, row: 0 }],
      ["b", { column: 1, row: 0 }],
    ]);
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(1, 0)],
    ]);
    const routes = routeJourneyConnectors(
      cells,
      boxes,
      [
        { id: "1", sourceId: "a", targetId: "b" },
        { id: "2", sourceId: "a", targetId: "b" },
        { id: "3", sourceId: "a", targetId: "a" },
      ],
      geometry,
    );

    expect(routes).toHaveLength(3);
    expect(routes[0].path).not.toBe(routes[1].path);
    expect(routes[2].path).toContain("C");
  });

  it("draws a return to the neighbouring column straight through the gap", () => {
    const cells = new Map([
      ["a", { column: 0, row: 1 }],
      ["b", { column: 1, row: 0 }],
    ]);
    const boxes = new Map([
      ["a", box(0, 1)],
      ["b", box(1, 0)],
    ]);
    const [route] = routeJourneyConnectors(
      cells,
      boxes,
      [{ id: "retry", sourceId: "b", targetId: "a" }],
      geometry,
    );

    expect(route.path.split("L")).toHaveLength(1);
    expect(route.label.y).toBeLessThan(box(0, 1).y + 450);
    expect(route.label.y).toBeGreaterThan(0);
  });
});
