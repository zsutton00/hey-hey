import { createOpenItemEntity } from "@hey-hey/ui-common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenItemLocator } from "./openItemLocator";
import type { OpenItem } from "./openItemsModel";

const id = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const held: OpenItem = {
  entityType: "task",
  entityId: id,
  note: "Saved note",
  pinned: false,
  position: "A",
  groupId: null,
  memberPosition: null,
  revision: 1,
  lineage: [],
  presentation: { label: "Held task", workItemTypeKey: "STANDARD" },
  removedAt: null,
  updatedAt: "2026-10-07T00:00:00.000Z",
};

describe("Open Items locator", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scrolls to a held entry without activating it", () => {
    const row = document.createElement("div");
    row.dataset.openItemKey = `task:${id}`;
    const scrollIntoView = vi.fn();
    row.scrollIntoView = scrollIntoView;
    document.body.appendChild(row);
    const activate = vi.fn();

    createOpenItemLocator([held], activate).showInOpenItems({
      entity: createOpenItemEntity("task", id),
      label: "Menu label",
      taskType: "STANDARD",
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates an absent task with null lineage and a task snapshot", () => {
    const activate = vi.fn().mockResolvedValue(true);

    createOpenItemLocator([held], activate).showInOpenItems({
      entity: createOpenItemEntity("task", otherId),
      label: "New task",
      taskType: "FEATURE",
    });

    expect(activate).toHaveBeenCalledWith({
      entityType: "task",
      entityId: otherId,
      lineage: null,
      presentation: { kind: "task", label: "New task", taskType: "FEATURE" },
    });
  });

  it("activates an absent non-task entity with a label-only snapshot", () => {
    const activate = vi.fn().mockResolvedValue(true);

    createOpenItemLocator([], activate).showInOpenItems({
      entity: createOpenItemEntity("design_doc", otherId),
      label: "Design",
    });

    expect(activate).toHaveBeenCalledWith({
      entityType: "design_doc",
      entityId: otherId,
      lineage: null,
      presentation: { kind: "design_doc", label: "Design" },
    });
  });
});
