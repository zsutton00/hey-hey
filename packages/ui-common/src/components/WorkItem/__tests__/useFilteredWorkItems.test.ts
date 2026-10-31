import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkStatus } from "../../../api";
import { useFilteredWorkItems } from "../useFilteredWorkItems";

const items = [
  { name: "Active task", status: WorkStatus.Active },
  { name: "Superseded task", status: WorkStatus.Superseded },
  { name: "Completed task", status: WorkStatus.Completed },
];

describe("useFilteredWorkItems — SUPERSEDED", () => {
  it("excludes superseded items from default views (no status filter)", () => {
    const { result } = renderHook(() =>
      useFilteredWorkItems(items, "", "", "", new Map()),
    );

    expect(result.current.map((i) => i.name)).toEqual([
      "Active task",
      "Completed task",
    ]);
  });

  it("keeps superseded items when the SUPERSEDED filter is explicitly selected", () => {
    const { result } = renderHook(() =>
      useFilteredWorkItems(items, "", WorkStatus.Superseded, "", new Map()),
    );

    expect(result.current.map((i) => i.name)).toEqual(["Superseded task"]);
  });

  it("still excludes superseded items when sorting a default view by status", () => {
    const { result } = renderHook(() =>
      useFilteredWorkItems(items, "", "", "status", new Map()),
    );

    expect(result.current.some((i) => i.status === WorkStatus.Superseded)).toBe(
      false,
    );
  });
});

describe("useFilteredWorkItems — per-type status order", () => {
  const vocabularies = new Map([
    [
      "RECIPE",
      {
        statuses: [
          { name: "Idea", meaning: "NOT_STARTED" },
          { name: "Made", meaning: "FINISHED" },
        ],
      },
    ],
  ]) as never;

  it("sorts by the type's configured order and keeps a removed status visible after it", () => {
    const recipes = [
      { name: "Retained", type: "RECIPE", status: "Testing" },
      { name: "Made", type: "RECIPE", status: "Made" },
      { name: "Idea", type: "RECIPE", status: "Idea" },
    ];
    const { result } = renderHook(() =>
      useFilteredWorkItems(recipes, "", "", "status", vocabularies),
    );

    expect(result.current.map((i) => i.name)).toEqual([
      "Idea",
      "Made",
      "Retained",
    ]);
  });
});
