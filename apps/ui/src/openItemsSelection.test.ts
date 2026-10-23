import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEntityActivation } from "@hey-hey/ui-common/context";
import { useOpenItemsSelection } from "./openItemsSelection";

const task = createEntityActivation("task", "same", null);
const doc = createEntityActivation("design_doc", "same", null);
describe("section-owned selection", () => {
  it("enters from a row, selects a visible range, and clears mode", () => {
    const third = createEntityActivation("task", "third", null);
    const { result } = renderHook(() => useOpenItemsSelection("first", [task, doc, third]));
    act(() => result.current.enter(task));
    expect(result.current.mode).toBe(true);
    expect(result.current.selected).toEqual([task]);
    act(() => result.current.toggle(third, true));
    expect(result.current.selected).toEqual([task, doc, third]);
    act(() => result.current.clear());
    expect(result.current.mode).toBe(false);
    expect(result.current.selected).toEqual([]);
  });
  it("prunes hidden rows permanently and resets when project scope changes", () => {
    const { result, rerender } = renderHook(
      ({ scope, visible }) => useOpenItemsSelection(scope, visible),
      { initialProps: { scope: "first", visible: [task, doc] } }
    );
    act(() => {
      result.current.toggle(task);
      result.current.toggle(doc);
    });
    expect(result.current.selected).toEqual([task, doc]);
    rerender({ scope: "first", visible: [doc] });
    expect(result.current.selected).toEqual([doc]);
    rerender({ scope: "first", visible: [task, doc] });
    expect(result.current.selected).toEqual([doc]);
    rerender({ scope: "second", visible: [task, doc] });
    expect(result.current.selected).toEqual([]);
    act(() => result.current.toggle(task));
    rerender({ scope: "second", visible: [] });
    rerender({ scope: "second", visible: [task, doc] });
    expect(result.current.selected).toEqual([]);
  });
});
