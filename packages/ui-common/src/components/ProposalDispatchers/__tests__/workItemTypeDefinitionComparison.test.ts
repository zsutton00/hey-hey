import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import { compareWorkItemTypeDefinitions } from "../workItemTypeDefinitionComparison";

const current: WorkItemTypeDefinitionDto = {
  key: "JOB_APPLICATION_RECORD",
  name: "Job application record",
  role: "work-item",
  allowedStatuses: ["NOT_STARTED"],
  sections: [
    {
      key: "overview",
      label: "Overview",
      writingStandard: "Describe the role.",
    },
    { key: "notes", label: "Notes" },
  ],
};

describe("complete type definition comparison", () => {
  it("shows independent role additions, edits and removals", () => {
    const before = {
      ...current,
      sessionRoleGuidance: { implementation: "Old", review: "Check" },
    };
    const after = {
      ...current,
      sessionRoleGuidance: { implementation: "New", research: "Learn" },
    };
    expect(compareWorkItemTypeDefinitions(before, after).fields).toEqual([
      {
        label: "Session-role guidance — implementation",
        before: "Old",
        after: "New",
      },
      { label: "Session-role guidance — research", before: "", after: "Learn" },
      { label: "Session-role guidance — review", before: "Check", after: "" },
    ]);
  });
  it("shows maintenance advice separately from authoring guidance", () => {
    const addition = compareWorkItemTypeDefinitions(current, {
      ...current,
      maintenanceGuidance:
        "Review visible behavior against approved requirements.",
    }).fields;
    expect(addition).toEqual([
      {
        label: "Maintenance guidance",
        before: "",
        after: "Review visible behavior against approved requirements.",
      },
    ]);
    expect(
      compareWorkItemTypeDefinitions(
        { ...current, maintenanceGuidance: "Old advice" },
        current,
      ).fields,
    ).toEqual([
      { label: "Maintenance guidance", before: "Old advice", after: "" },
    ]);
  });
  it("names purpose and type-level writing standards without changing values", () => {
    const result = compareWorkItemTypeDefinitions(current, {
      ...current,
      description: "Capture the application.",
      writingStandards: { create: "Check evidence.", edit: "Keep history." },
    });
    expect(result.fields).toEqual([
      { label: "Purpose", before: "", after: "Capture the application." },
      {
        label: "Writing standard — Create",
        before: "",
        after: "Check evidence.",
      },
      { label: "Writing standard — Edit", before: "", after: "Keep history." },
    ]);
  });
  it("pairs declaration edits by stable key, including schema and requiredness", () => {
    const result = compareWorkItemTypeDefinitions(current, {
      ...current,
      sections: [
        {
          key: "overview",
          label: "Application",
          kind: "json",
          schemaRef: "#/components/schemas/Application",
          required: false,
          writingStandard: "Record the application.",
        },
        current.sections[1],
      ],
    });
    expect(result.sections.map((s) => s.change)).toEqual([
      "modified",
      "unchanged",
    ]);
    expect(result.sections[0].fields).toEqual([
      { label: "Label", before: "Overview", after: "Application" },
      { label: "Kind", before: "markdown", after: "json" },
      {
        label: "Section writing standard",
        before: "Describe the role.",
        after: "Record the application.",
      },
      {
        label: "Schema reference",
        before: "",
        after: "#/components/schemas/Application",
      },
      { label: "Required", before: "true", after: "false" },
    ]);
  });
  it("does not turn insertion or removal into edits to subsequent declarations", () => {
    const result = compareWorkItemTypeDefinitions(current, {
      ...current,
      sections: [{ key: "contact", label: "Contact" }, current.sections[1]],
    });
    expect(result.sections.map((s) => [s.key, s.change])).toEqual([
      ["contact", "added"],
      ["notes", "unchanged"],
      ["overview", "removed"],
    ]);
    expect(result.order).toBeNull();
  });
  it("keeps cloned definitions and explicit defaults unchanged", () => {
    const proposed: WorkItemTypeDefinitionDto = {
      ...structuredClone(current),
      description: null,
      requiredScalars: [],
      tracking: { allowedSourceEntityTypes: [], allowedSourceTaskTypes: [] },
      writingStandards: null,
      capabilities: { showsInExplorerSidebar: false },
      sections: current.sections.map((s) => ({
        ...s,
        kind: "markdown",
        required: true,
        schemaRef: null,
        writingStandard: s.writingStandard ?? null,
      })),
    };
    const result = compareWorkItemTypeDefinitions(current, proposed);
    expect(result.fields).toEqual([]);
    expect(result.sections.every((s) => s.change === "unchanged")).toBe(true);
    expect(result.order).toBeNull();
  });
  it("ignores object property insertion order", () => {
    const result = compareWorkItemTypeDefinitions(
      {
        ...current,
        capabilities: { planEligible: true, requiresParent: true },
      },
      {
        ...current,
        capabilities: { requiresParent: true, planEligible: true },
      },
    );
    expect(result.fields).toEqual([]);
  });
  it("shows genuine reorder separately from declaration changes", () => {
    const result = compareWorkItemTypeDefinitions(current, {
      ...current,
      sections: [...current.sections].reverse(),
    });
    expect(result.sections.every((s) => s.change === "unchanged")).toBe(true);
    expect(result.order).toEqual({
      label: "Section order",
      before: "Overview\nNotes",
      after: "Notes\nOverview",
    });
  });
  it("preserves policy array order and exposes other definition changes", () => {
    const result = compareWorkItemTypeDefinitions(current, {
      ...current,
      name: "Applications",
      allowedStatuses: ["IN_PROGRESS", "NOT_STARTED"],
      writingStandards: { create: "Check evidence", edit: "Keep history" },
    });
    expect(result.fields.map((f) => f.label)).toEqual([
      "Name",
      "Allowed statuses",
      "Writing standard — Create",
      "Writing standard — Edit",
    ]);
  });
  it("rejects duplicate section identities and changed type keys", () => {
    expect(() =>
      compareWorkItemTypeDefinitions(current, {
        ...current,
        sections: [current.sections[0], current.sections[0]],
      }),
    ).toThrow();
    expect(() =>
      compareWorkItemTypeDefinitions(current, { ...current, key: "OTHER" }),
    ).toThrow();
  });
});
