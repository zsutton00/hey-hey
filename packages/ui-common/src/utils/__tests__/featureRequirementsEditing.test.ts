import { describe, expect, it } from "vitest";
import type { FeatureRequirementRecord } from "../../api";
import {
  addRequirement,
  addRequirementCitation,
  buildRequirementEditorLayout,
  deleteRequirement,
  filterRequirementCitationResults,
  moveRequirement,
  nextRequirementGroupLabel,
  removeRequirementCitation,
  renameRequirementGroup,
  serializeFeatureRequirementsSection,
  setRequirementGroup,
  toRequirementSlotCitation,
  updateRequirementStatement,
} from "../featureRequirementsEditing";
import { readFeatureRequirementsSection } from "../featureRequirementsSection";

const uuid = (last: string): string =>
  `00000000-0000-4000-8000-00000000000${last}`;

const record = (
  id: string,
  statement: string,
  group?: string,
  overrides: Partial<FeatureRequirementRecord> = {},
): FeatureRequirementRecord => ({
  id,
  statement,
  ...(group === undefined ? {} : { group }),
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
  ...overrides,
});

const ids = (records: readonly FeatureRequirementRecord[]) =>
  records.map((r) => `${r.id.slice(-1)}:${r.group ?? "-"}`);

const records = [
  record(uuid("1"), "One", "Alpha"),
  record(uuid("2"), "Two", "Alpha"),
  record(uuid("3"), "Three", "Beta"),
  record(uuid("4"), "Four"),
];

describe("feature requirement record edits", () => {
  it("adds an empty ungrouped record with the given durable id", () => {
    const next = addRequirement(records, uuid("5"));
    expect(next.at(-1)).toEqual(record(uuid("5"), ""));
  });

  it("updates a statement without changing identity or other fields", () => {
    const next = updateRequirementStatement(records, uuid("2"), "Two!");
    expect(next[1]).toEqual({ ...records[1], statement: "Two!" });
    expect(next.map((r) => r.id)).toEqual(records.map((r) => r.id));
  });

  it("deletes only the addressed record", () => {
    expect(deleteRequirement(records, uuid("3")).map((r) => r.id)).toEqual([
      uuid("1"),
      uuid("2"),
      uuid("4"),
    ]);
  });

  it("adds a citation once and removes it by entity", () => {
    const cite = {
      entityType: "DESIGN_DOC" as const,
      entityId: uuid("9"),
      entityTitle: "Doc",
    };
    const added = addRequirementCitation(
      records,
      uuid("1"),
      "designedBy",
      cite,
    );
    expect(
      addRequirementCitation(added, uuid("1"), "designedBy", cite)[0]
        .designedBy,
    ).toEqual([cite]);
    expect(
      removeRequirementCitation(added, uuid("1"), "designedBy", cite)[0]
        .designedBy,
    ).toEqual([]);
  });

  it("serializes a section the shared adapter reads back unchanged", () => {
    const state = readFeatureRequirementsSection(
      serializeFeatureRequirementsSection(records),
    );
    expect(state).toMatchObject({ status: "valid", records });
  });
});

describe("feature requirement grouping and order", () => {
  it("lays out groups in first-occurrence order before ungrouped records", () => {
    const layout = buildRequirementEditorLayout([
      record(uuid("4"), "Four"),
      ...records.slice(0, 3),
    ]);
    expect(layout.groups.map((g) => g.label)).toEqual(["Alpha", "Beta"]);
    expect(layout.ungrouped.map((r) => r.id)).toEqual([uuid("4")]);
  });

  it("reorders inside a group and keeps the record identity", () => {
    const next = moveRequirement(records, uuid("2"), {
      group: "Alpha",
      index: 0,
    });
    expect(ids(next)).toEqual(["2:Alpha", "1:Alpha", "3:Beta", "4:-"]);
    expect(next[0]).toEqual(records[1]);
  });

  it("moves a record between groups as a group update, not delete and add", () => {
    const next = moveRequirement(records, uuid("1"), {
      group: "Beta",
      index: 1,
    });
    expect(ids(next)).toEqual(["2:Alpha", "3:Beta", "1:Beta", "4:-"]);
    expect(next[2]).toEqual({ ...records[0], group: "Beta" });
  });

  it("clears the group when moved to the ungrouped area", () => {
    const next = moveRequirement(records, uuid("3"), {
      group: undefined,
      index: 0,
    });
    expect(ids(next)).toEqual(["1:Alpha", "2:Alpha", "3:-", "4:-"]);
    expect(next[2]).not.toHaveProperty("group");
  });

  it("assigns a new group label and places the record at its end", () => {
    const label = nextRequirementGroupLabel(records);
    expect(label).toBe("Group 1");
    expect(ids(setRequirementGroup(records, uuid("4"), label))).toEqual([
      "1:Alpha",
      "2:Alpha",
      "3:Beta",
      "4:Group 1",
    ]);
    expect(nextRequirementGroupLabel([record(uuid("5"), "x", "Group 1")])).toBe(
      "Group 2",
    );
  });

  it("preserves every citation slot and unaffected records through group assignment and rename", () => {
    const cited = record(uuid("1"), "One", "Alpha", {
      designedBy: [
        {
          entityType: "DESIGN_DOC",
          entityId: uuid("a"),
          entityTitle: "Design",
        },
      ],
      fulfilledBy: [
        { entityType: "TASK", entityId: uuid("b"), entityTitle: "Build" },
      ],
      contracts: [
        {
          entityType: "CONTRACT",
          entityId: uuid("c"),
          entityTitle: "Boundary",
        },
      ],
    });
    const initial = [cited, ...records.slice(1)];
    const assigned = setRequirementGroup(initial, cited.id, "Beta");
    expect(assigned.find((r) => r.id === cited.id)).toEqual({
      ...cited,
      group: "Beta",
    });
    expect(assigned.filter((r) => r.id !== cited.id)).toEqual(initial.slice(1));
    const renamed = renameRequirementGroup(assigned, "Beta", "Core")!;
    expect(renamed.find((r) => r.id === cited.id)).toEqual({
      ...cited,
      group: "Core",
    });
    expect(initial[0]).toEqual(cited);
  });

  it("uses the first unused Group N label without renaming existing groups", () => {
    expect(
      nextRequirementGroupLabel([
        record(uuid("1"), "One", "Group 1"),
        record(uuid("2"), "Two", "Group 3"),
      ]),
    ).toBe("Group 2");
  });

  it("renames a group across its records and rejects unusable labels", () => {
    expect(
      ids(renameRequirementGroup(records, "Alpha", " Core ") ?? []),
    ).toEqual(["1:Core", "2:Core", "3:Beta", "4:-"]);
    expect(renameRequirementGroup(records, "Alpha", "Beta")).toBeNull();
    expect(renameRequirementGroup(records, "Alpha", "bad!")).toBeNull();
    expect(renameRequirementGroup(records, "Alpha", "")).toBeNull();
  });
});

describe("requirement citation search results", () => {
  const featureId = uuid("a");
  const parentId = uuid("b");
  const results = [
    { id: featureId, type: "feature", name: "Self" },
    { id: parentId, type: "feature", name: "Parent" },
    { id: uuid("c"), type: "feature", name: "Sibling" },
    {
      id: uuid("d"),
      type: "task",
      name: "Plan",
      metadata: { taskType: "PLAN" },
    },
    { id: uuid("e"), type: "design_doc", name: "Doc" },
    { id: uuid("f"), type: "diagram", name: "Diagram" },
  ];

  it("never offers the feature, its parent, already-cited, or wrong-type entities", () => {
    expect(
      filterRequirementCitationResults(
        "fulfilledBy",
        results,
        { featureId, parentId },
        [{ entityId: uuid("f") }],
      ).map((r) => r.name),
    ).toEqual(["Sibling", "Plan"]);
    expect(
      filterRequirementCitationResults(
        "designedBy",
        results,
        {
          featureId,
          parentId: null,
        },
        [],
      ).map((r) => r.name),
    ).toEqual(["Doc"]);
  });

  it("stores each slot's citation entity type", () => {
    expect(toRequirementSlotCitation("fulfilledBy", results[3])).toEqual({
      entityType: "PLAN",
      entityId: uuid("d"),
      entityTitle: "Plan",
    });
    expect(toRequirementSlotCitation("fulfilledBy", results[2])).toMatchObject({
      entityType: "TASK",
    });
    expect(toRequirementSlotCitation("designedBy", results[4])).toMatchObject({
      entityType: "DESIGN_DOC",
    });
    expect(
      toRequirementSlotCitation("contracts", {
        id: uuid("9"),
        type: "task",
        name: "Boundary",
        metadata: { taskType: "CONTRACT" },
      }),
    ).toMatchObject({ entityType: "CONTRACT" });
    expect(
      toRequirementSlotCitation("contracts", {
        id: uuid("9"),
        type: "task",
        name: "Plan",
        metadata: { taskType: "PLAN" },
      }),
    ).toBeNull();
  });
});
