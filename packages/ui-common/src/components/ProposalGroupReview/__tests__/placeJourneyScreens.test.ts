import { describe, expect, it } from "vitest";
import { placeJourneyScreens } from "../placeJourneyScreens";

const link = (sourceId: string, targetId: string) => ({ sourceId, targetId });
const none = new Map<string, { x: number; y: number }>();

describe("placeJourneyScreens", () => {
  it("puts a transition's target to the east of its source", () => {
    const cells = placeJourneyScreens(
      ["in", "home"],
      [link("in", "home")],
      none,
    );

    expect(cells.get("in")).toEqual({ column: 0, row: 0 });
    expect(cells.get("home")).toEqual({ column: 1, row: 0 });
  });

  it("fans onward screens east, south, north, west, then spills without overlap", () => {
    const targets = ["e", "s", "n", "w", "spill"];
    const cells = placeJourneyScreens(
      ["hub", ...targets],
      targets.map((target) => link("hub", target)),
      none,
    );
    const hub = cells.get("hub")!;
    const offset = (id: string) => {
      const cell = cells.get(id)!;
      return [cell.column - hub.column, cell.row - hub.row];
    };

    expect(offset("e")).toEqual([1, 0]);
    expect(offset("s")).toEqual([0, 1]);
    expect(offset("n")).toEqual([0, -1]);
    expect(offset("w")).toEqual([-1, 0]);
    const keys = [...cells.values()].map(
      ({ column, row }) => `${column},${row}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves screens in place for a transition back to an already-placed screen", () => {
    const forward = placeJourneyScreens(
      ["in", "home"],
      [link("in", "home")],
      none,
    );
    const withReturn = placeJourneyScreens(
      ["in", "home"],
      [link("in", "home"), link("home", "in")],
      none,
    );

    expect(withReturn).toEqual(forward);
  });

  it("keeps saved positions and auto-places only the rest", () => {
    const cells = placeJourneyScreens(
      ["a", "b", "c"],
      [link("a", "b"), link("b", "c")],
      new Map([
        ["a", { x: 0, y: 500 }],
        ["b", { x: 0, y: 0 }],
      ]),
    );

    expect(cells.get("b")).toEqual({ column: 0, row: 0 });
    expect(cells.get("a")).toEqual({ column: 0, row: 1 });
    expect(cells.get("c")).toEqual({ column: 1, row: 0 });
  });

  it("gives the same placement every time", () => {
    const run = () =>
      placeJourneyScreens(
        ["a", "b", "c", "d"],
        [link("a", "b"), link("a", "c"), link("c", "d"), link("d", "a")],
        none,
      );

    expect(run()).toEqual(run());
  });
});
