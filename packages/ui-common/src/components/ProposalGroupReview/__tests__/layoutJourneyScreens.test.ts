import { describe, expect, it } from "vitest";
import type { WorkflowTransitionRole } from "../../../api";
import {
  layoutJourneyScreens,
  type LayoutTransition,
} from "../layoutJourneyScreens";

const none = new Map<string, { x: number; y: number }>();
const roles = {
  p: "PRIMARY_PROGRESSION",
  e: "ERROR_PATH",
  r: "RECOVERY",
  b: "RETURN",
  u: null,
} as const satisfies Record<string, WorkflowTransitionRole | null>;

const screens = (...names: string[]) =>
  names.map((name) => ({ id: `id-${name}`, name }));
const link = (
  role: keyof typeof roles,
  source: string,
  target: string,
  label = `${source}-${target}`,
): LayoutTransition => ({
  id: `edge-${role}-${source}-${target}-${label}`,
  sourceId: `id-${source}`,
  targetId: `id-${target}`,
  role: roles[role],
  actionLabel: label,
});
const at = (cells: ReturnType<typeof layoutJourneyScreens>, name: string) =>
  cells.get(`id-${name}`)!;

describe("layoutJourneyScreens", () => {
  it("moves successive primary steps left to right and keeps errors beside their source", () => {
    const cells = layoutJourneyScreens(
      screens("A", "B", "C", "E1", "E2", "E3"),
      [
        link("p", "A", "B"),
        link("p", "B", "C"),
        link("e", "A", "E1"),
        link("e", "A", "E2"),
        link("e", "B", "E3"),
      ],
      none,
    );

    expect([at(cells, "A").column, at(cells, "B").column]).toEqual([0, 1]);
    expect(at(cells, "C").column).toBe(2);
    expect(at(cells, "C").row).toBe(at(cells, "A").row);
    expect(at(cells, "E1")).toEqual({ column: 0, row: at(cells, "A").row + 1 });
    expect(at(cells, "E2").row).toBe(at(cells, "E1").row + 1);
    expect(at(cells, "E3").column).toBe(1);
    const keys = [...cells.values()].map(
      (cell) => `${cell.column},${cell.row}`,
    );
    expect(new Set(keys).size).toBe(6);
  });

  it("gives primary alternatives their own lanes and converges after both", () => {
    const cells = layoutJourneyScreens(
      screens("Start", "Card", "Wallet", "Done"),
      [
        link("p", "Start", "Card"),
        link("p", "Start", "Wallet"),
        link("p", "Card", "Done"),
        link("p", "Wallet", "Done"),
      ],
      none,
    );

    expect(at(cells, "Card").column).toBe(1);
    expect(at(cells, "Wallet").column).toBe(1);
    expect(at(cells, "Card").row).not.toBe(at(cells, "Wallet").row);
    expect(at(cells, "Done").column).toBe(2);
  });

  it("does not move progression when error, recovery or return edges are added", () => {
    const base = [link("p", "A", "B"), link("p", "B", "C")];
    const plain = layoutJourneyScreens(screens("A", "B", "C"), base, none);
    const withSide = layoutJourneyScreens(
      screens("A", "B", "C"),
      [...base, link("e", "A", "C"), link("r", "C", "A"), link("b", "C", "B")],
      none,
    );

    expect(withSide).toEqual(plain);
  });

  it("places a shared error target once, with every transition retained by the caller", () => {
    const cells = layoutJourneyScreens(
      screens("A", "B", "Oops"),
      [link("p", "A", "B"), link("e", "A", "Oops"), link("e", "B", "Oops")],
      none,
    );

    expect(at(cells, "Oops")).toEqual({ column: 0, row: 1 });
  });

  it("terminates on primary cycles and places every screen", () => {
    const cells = layoutJourneyScreens(
      screens("A", "B", "C"),
      [link("p", "A", "B"), link("p", "B", "C"), link("p", "C", "A")],
      none,
    );

    expect(cells.size).toBe(3);
    expect(at(cells, "A").column).toBeLessThan(at(cells, "B").column);
    expect(at(cells, "B").column).toBeLessThan(at(cells, "C").column);
  });

  it("keeps saved positions and places the rest around them", () => {
    const cells = layoutJourneyScreens(
      screens("A", "B", "C"),
      [link("p", "A", "B"), link("p", "B", "C")],
      new Map([["id-B", { x: 400, y: 900 }]]),
    );

    expect(cells.size).toBe(3);
    const keys = [...cells.values()].map(
      (cell) => `${cell.column},${cell.row}`,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("renders legacy unclassified transitions and disconnected screens without inventing roles", () => {
    const cells = layoutJourneyScreens(
      screens("A", "B", "Lonely"),
      [link("u", "A", "B")],
      none,
    );

    expect(at(cells, "B")).toEqual({
      column: at(cells, "A").column + 1,
      row: at(cells, "A").row,
    });
    expect(cells.has("id-Lonely")).toBe(true);
  });

  it("keeps unclassified edges from overriding established primary progression", () => {
    const base = [link("p", "A", "B"), link("p", "B", "C")];
    const plain = layoutJourneyScreens(screens("A", "B", "C"), base, none);
    const withLegacy = layoutJourneyScreens(
      screens("A", "B", "C"),
      [...base, link("u", "C", "A")],
      none,
    );

    expect(withLegacy).toEqual(plain);
  });

  it("is independent of input order and of identity form", () => {
    const names = ["A", "B", "C", "E"];
    const edges = [
      link("p", "A", "B"),
      link("p", "B", "C"),
      link("e", "B", "E"),
      link("b", "C", "A"),
    ];
    const reference = layoutJourneyScreens(screens(...names), edges, none);
    const shuffled = layoutJourneyScreens(
      screens(...[...names].reverse()),
      [...edges].reverse(),
      none,
    );
    const renamed = layoutJourneyScreens(
      names.map((name) => ({ id: `temporary:${name}`, name })),
      edges.map((edge) => ({
        ...edge,
        sourceId: edge.sourceId.replace("id-", "temporary:"),
        targetId: edge.targetId.replace("id-", "temporary:"),
      })),
      none,
    );

    names.forEach((name) => {
      expect(shuffled.get(`id-${name}`)).toEqual(reference.get(`id-${name}`));
      expect(renamed.get(`temporary:${name}`)).toEqual(
        reference.get(`id-${name}`),
      );
    });
  });
});
