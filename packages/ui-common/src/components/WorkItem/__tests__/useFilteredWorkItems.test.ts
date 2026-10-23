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
      useFilteredWorkItems(items, "", "", "")
    );

    expect(result.current.map((i) => i.name)).toEqual([
      "Active task",
      "Completed task",
    ]);
  });

  it("keeps superseded items when the SUPERSEDED filter is explicitly selected", () => {
    const { result } = renderHook(() =>
      useFilteredWorkItems(items, "", WorkStatus.Superseded, "")
    );

    expect(result.current.map((i) => i.name)).toEqual(["Superseded task"]);
  });

  it("still excludes superseded items when sorting a default view by status", () => {
    const { result } = renderHook(() =>
      useFilteredWorkItems(items, "", "", "status")
    );

    expect(result.current.some((i) => i.status === WorkStatus.Superseded)).toBe(
      false
    );
  });
});
