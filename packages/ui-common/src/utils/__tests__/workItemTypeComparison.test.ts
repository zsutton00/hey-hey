import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../api";
import { compareWorkItemTypeDefinitions } from "../workItemTypeComparison";

const base: WorkItemTypeDefinitionDto = {
  key: "GOAL",
  name: "Goal",
  role: "project-info",
  sections: [
    { key: "a", label: "A", writingStandard: "same" },
    { key: "b", label: "B", writingStandard: "same" },
  ],
  allowedStatuses: ["ACTIVE", "COMPLETED"],
} as WorkItemTypeDefinitionDto;

const compare = (project: WorkItemTypeDefinitionDto) =>
  compareWorkItemTypeDefinitions(
    project,
    base,
    (field) => field,
    (key) => key,
  );

const entryStatus = (
  result: ReturnType<typeof compare>,
  id: string,
): string | undefined =>
  result.groups.flatMap((g) => g.entries).find((e) => e.id === id)?.status;

describe("compareWorkItemTypeDefinitions", () => {
  it("reports no differences for identical definitions", () => {
    expect(compare(structuredClone(base)).hasDifferences).toBe(false);
  });

  it("matches sections by key so reordering and one addition stay local", () => {
    const result = compare({
      ...base,
      sections: [
        { key: "c", label: "C" },
        { key: "b", label: "B", writingStandard: "same" },
        { key: "a", label: "A", writingStandard: "same" },
      ],
    });

    expect(entryStatus(result, "sections.a.label")).toBe("unchanged");
    expect(entryStatus(result, "sections.b.writingStandard")).toBe("unchanged");
    expect(entryStatus(result, "sections.c.label")).toBe("added");
    expect(entryStatus(result, "sections.order")).toBe("changed");
  });

  it("separates a status-order change from a changed status set", () => {
    const reordered = compare({
      ...base,
      allowedStatuses: ["COMPLETED", "ACTIVE"],
    } as WorkItemTypeDefinitionDto);
    expect(entryStatus(reordered, "allowedStatuses")).toBe("unchanged");
    expect(entryStatus(reordered, "allowedStatuses.order")).toBe("changed");

    const missing = compare({
      ...base,
      allowedStatuses: ["ACTIVE"],
    } as WorkItemTypeDefinitionDto);
    expect(entryStatus(missing, "allowedStatuses")).toBe("changed");
  });

  it("marks guidance present only in canonical as removed", () => {
    const result = compareWorkItemTypeDefinitions(
      base,
      { ...base, maintenanceGuidance: "Keep it current." },
      (field) => field,
      (key) => key,
    );

    expect(entryStatus(result, "maintenanceGuidance")).toBe("removed");
  });
});
