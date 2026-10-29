import { describe, expect, it } from "vitest";
import {
  resolutionItems,
  resolutionConflictPaths,
  preserveUnaffectedRequirements,
  writeResolution,
  records,
} from "../scopedResolution";
import { serializeFeatureRequirementsSection as section } from "../../../utils/featureRequirementsEditing";
import type { FeatureRequirementRecord } from "../../../api";
const requirement = (
  id: string,
  statement: string,
): FeatureRequirementRecord => ({
  id,
  statement,
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
});
const a = requirement("11111111-1111-4111-8111-111111111111", "Original");
const b = requirement("22222222-2222-4222-8222-222222222222", "Unrelated");
const c = requirement("33333333-3333-4333-8333-333333333333", "Addition");
const content = (rows: FeatureRequirementRecord[]) => ({
  type: "FEATURE",
  name: "Feature",
  sections: {
    description: "Unchanged description",
    requirements: section(rows),
  },
});
describe("scoped manual resolution", () => {
  it.each(["New text", { value: "Structured addition" }])(
    "restores an array-backed addition after removing it (%j)",
    (proposed) => {
      const untouched = {
        key: "description",
        materializedMarkdown: "Keep me",
        order: 1,
      };
      const item = { path: "sections.extra", current: undefined, proposed };
      const serialized =
        typeof proposed === "string" ? proposed : JSON.stringify(proposed);
      const initial = {
        sections: [
          untouched,
          { key: "extra", materializedMarkdown: serialized },
        ],
      };
      const removed = writeResolution(initial, item, undefined);
      expect(removed.sections).toEqual([untouched]);
      const restored = writeResolution(removed, item, proposed);
      expect(restored.sections).toEqual(initial.sections);
      expect(writeResolution(restored, item, proposed)).toEqual(restored);
      expect(writeResolution(restored, item, undefined)).toEqual(removed);
    },
  );
  it("limits decisions to the overlapping requirement and carries clean changes forward", () => {
    const liveB = { ...b, statement: "Live only" };
    const projection = {
      original: content([a, b]),
      live: content([{ ...a, statement: "Live" }, liveB]),
      intended: content([{ ...a, statement: "Proposed" }, b, c]),
    };
    expect(
      resolutionItems(projection, [
        `sections.requirements.records.${a.id}`,
      ]).map((item) => item.requirementId),
    ).toEqual([a.id]);
    const carried = preserveUnaffectedRequirements(
      projection.intended,
      projection,
    );
    expect(records(carried.sections.requirements)).toEqual([
      { ...a, statement: "Proposed" },
      liveB,
      c,
    ]);
  });
  it.each([
    { conflictingPaths: [] },
    { conflictingPaths: ["sections.requirements.records"] },
  ])(
    "does not offer a live-only requirement as a decision when overlap details are absent (%j)",
    ({ conflictingPaths }) => {
      const projection = {
        original: content([a, b]),
        live: content([{ ...a, statement: "Live" }, b]),
        intended: content([a, b, c]),
      };
      const paths = resolutionConflictPaths(projection, {
        status: "RECONCILIATION_REQUIRED",
        overlaps: [],
        conflictingPaths,
      });
      expect(
        resolutionItems(projection, paths).map((item) => item.requirementId),
      ).toEqual([c.id]);
      expect(
        resolutionItems(projection, paths).some(
          (item) => item.path === "sections.description",
        ),
      ).toBe(false);
    },
  );
  it("does not broaden editing when reconciliation is already ready", () => {
    const projection = {
      original: content([a, b]),
      live: content([{ ...a, statement: "Live" }, b]),
      intended: content([a, b, c]),
    };
    expect(
      resolutionItems(
        projection,
        resolutionConflictPaths(projection, {
          status: "READY_FOR_REVIEW",
          overlaps: [],
          conflictingPaths: [],
        }),
      ).map((item) => item.requirementId),
    ).toEqual([c.id]);
  });
  it("preserves current-only edits and supports use current, keep proposal and remove addition", () => {
    const liveB = { ...b, statement: "Current-only change" };
    const proposedA = { ...a, statement: "Proposal" };
    const projection = {
      original: content([a, b]),
      live: content([a, liveB]),
      intended: content([proposedA, b, c]),
    };
    let result = preserveUnaffectedRequirements(
      projection.intended,
      projection,
    );
    const items = resolutionItems(projection);
    result = writeResolution(result, items[0], items[0].current);
    result = writeResolution(result, items[1], undefined);
    expect(
      records((result.sections as Record<string, unknown>).requirements),
    ).toEqual([a, liveB]);
    result = writeResolution(result, items[0], items[0].proposed);
    expect(
      records((result.sections as Record<string, unknown>).requirements),
    ).toEqual([proposedA, liveB]);
    expect((result.sections as Record<string, unknown>).description).toBe(
      "Unchanged description",
    );
  });
  it("does not offer task-only fields on Features", () => {
    const original = {
      ...content([]),
      priority: "LOW",
      assigneeId: null,
      dueDate: null,
    };
    expect(
      resolutionItems({
        original,
        live: original,
        intended: {
          ...original,
          priority: "HIGH",
          assigneeId: "user",
          dueDate: "tomorrow",
        },
      }),
    ).toEqual([]);
  });
});
