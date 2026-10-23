import { describe, it, expect } from "vitest";
import {
  resolveVisibleOpenItemSelection,
  resolveOpenItemDragContent,
  resolveOpenItemTargets,
} from "../openItemSelection";

const task = { entityId: "same", entityType: "task", entityName: "Task" };
const doc = { entityId: "same", entityType: "design_doc", entityName: "Doc" };
const other = { entityId: "other", entityType: "task", entityName: "Other" };
describe("temporary visible selection", () => {
  it("prunes hidden identities, deduplicates, and preserves visible order and types", () => {
    expect(
      resolveVisibleOpenItemSelection([task, doc, task], [doc, other, task])
    ).toEqual([task, doc]);
    expect(resolveVisibleOpenItemSelection([], [task])).toEqual([]);
  });
  it("carries the whole selected batch and falls back for an unselected source", () => {
    expect(
      resolveOpenItemDragContent(task, [task, doc], (item) => item)
    ).toEqual({ type: "entities", data: [task, doc] });
    expect(
      resolveOpenItemDragContent(other, [task, doc], (item) => item)
    ).toEqual({ type: "entity", data: other });
    expect(resolveOpenItemTargets(doc, [task, doc])).toEqual([task, doc]);
    expect(resolveOpenItemDragContent(task, [], (item) => item)).toEqual({
      type: "entity",
      data: task,
    });
  });
});
