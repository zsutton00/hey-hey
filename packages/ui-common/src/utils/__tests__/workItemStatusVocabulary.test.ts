import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../api/api";
import {
  buildWorkItemStatusFilterOptions,
  getWorkItemStatusChoices,
  getWorkItemStatusLabel,
  getWorkItemStatusOrder,
  isRetainedRemovedStatus,
  matchesWorkItemStatusFilter,
} from "../workItemStatusVocabulary";

const recipe = {
  key: "RECIPE",
  name: "Recipe",
  statuses: [
    { name: "Idea", meaning: "NOT_STARTED" },
    { name: "Made", meaning: "FINISHED" },
    { name: "Rejected", meaning: "FINISHED" },
  ],
  capabilities: { supportsSupersession: false },
} as WorkItemTypeDefinitionDto;

const task = {
  key: "STANDARD",
  name: "Task",
  statuses: [
    { name: "BACKLOG", label: "Backlog", meaning: "NOT_STARTED" },
    { name: "Made", meaning: "FINISHED" },
  ],
  capabilities: { supportsSupersession: true },
} as WorkItemTypeDefinitionDto;

describe("work item status vocabulary", () => {
  it("flags a saved status the type removed, but never Archived or Superseded", () => {
    expect(isRetainedRemovedStatus("Testing", recipe)).toBe(true);
    expect(isRetainedRemovedStatus("Idea", recipe)).toBe(false);
    expect(isRetainedRemovedStatus("ARCHIVED", recipe)).toBe(false);
    expect(isRetainedRemovedStatus("SUPERSEDED", recipe)).toBe(false);
  });

  it("offers current ordinary statuses then Archived, never Superseded", () => {
    expect(getWorkItemStatusChoices(task)).toEqual([
      "BACKLOG",
      "Made",
      "ARCHIVED",
    ]);
  });

  it("shows the type's label, or the exact saved name when the type has none", () => {
    expect(getWorkItemStatusLabel("BACKLOG", task)).toBe("Backlog");
    expect(getWorkItemStatusLabel("Testing", recipe)).toBe("Testing");
    expect(getWorkItemStatusLabel("ACTIVE", recipe)).toBe("ACTIVE");
  });

  it("orders by the item's own type and puts unknown statuses last", () => {
    expect(getWorkItemStatusOrder("Made", recipe)).toBe(1);
    expect(getWorkItemStatusOrder("Made", task)).toBe(1);
    expect(getWorkItemStatusOrder("Testing", recipe)).toBe(4);
  });

  it("keeps type context for names shared across types and keeps removed saved statuses filterable", () => {
    const options = buildWorkItemStatusFilterOptions({
      definitions: [recipe, task],
      items: [
        { type: "RECIPE", status: "Testing" },
        { type: "STANDARD", status: "Made" },
      ],
    });

    expect(options.map((o) => o.value)).toEqual(
      expect.arrayContaining(["Idea", "Made", "Testing", "BACKLOG"]),
    );
    expect(options.find((o) => o.value === "Testing")?.label).toBe("Testing");
  });

  it("lists only the open tab's type statuses before any item has loaded", () => {
    const options = buildWorkItemStatusFilterOptions({
      definitions: [recipe, task],
      items: [{ type: "RECIPE" }],
    });

    expect(options.map((o) => o.value)).toEqual([
      "Idea",
      "Made",
      "Rejected",
      "ARCHIVED",
    ]);
  });

  it("splits a name that types present differently into per-type choices that match by type", () => {
    const legacyMade = {
      ...task,
      statuses: [{ name: "Made", label: "Shipped", meaning: "FINISHED" }],
    } as WorkItemTypeDefinitionDto;
    const options = buildWorkItemStatusFilterOptions({
      definitions: [recipe, legacyMade],
      items: [
        { type: "RECIPE", status: "Made" },
        { type: "STANDARD", status: "Made" },
      ],
      scopeByType: true,
    });
    const shipped = options.find((o) => o.label === "Shipped (Task)");

    expect(shipped).toBeDefined();
    expect(options.some((o) => o.label === "Made (Recipe)")).toBe(true);
    expect(
      matchesWorkItemStatusFilter(
        { type: "STANDARD", status: "Made" },
        shipped!.value,
      ),
    ).toBe(true);
    expect(
      matchesWorkItemStatusFilter(
        { type: "RECIPE", status: "Made" },
        shipped!.value,
      ),
    ).toBe(false);
  });
});
