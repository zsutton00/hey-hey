import { describe, expect, it } from "vitest";
import {
  adaptFeatureRequirementsSection,
  isCanonicalFeatureRequirementsDefinition,
  readFeatureRequirementsSection,
} from "../featureRequirementsSection";
import {
  buildRequirementPresentationChanges,
  buildRequirementPresentationModel,
  type FeatureRequirementRecord,
} from "../structuredRequirements";

const uuid = (last: string): string =>
  `00000000-0000-4000-8000-00000000000${last}`;

const requirement = (
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

const canonicalDefinition = {
  key: "requirements",
  label: "Requirements",
  kind: "json" as const,
  schemaRef: "#/components/schemas/FeatureRequirementsSection",
};

describe("feature requirements section adapter", () => {
  it("distinguishes an absent section from a valid empty collection", () => {
    expect(readFeatureRequirementsSection(undefined)).toEqual({
      status: "absent",
    });
    expect(readFeatureRequirementsSection('{"records":[]}')).toEqual({
      status: "valid-empty",
      value: { records: [] },
      records: [],
    });
  });

  it.each(["MOCKUP", "DIAGRAM"] as const)("accepts %s citations in designedBy and rejects them elsewhere", (entityType) => {
    const mockup = { entityType, entityId: uuid("3"), entityTitle: "Design" } as const;
    expect(
      readFeatureRequirementsSection({
        records: [requirement(uuid("1"), "First", undefined, { designedBy: [mockup] })],
      }).status,
    ).toBe("valid");
    expect(
      readFeatureRequirementsSection({
        records: [
          requirement(uuid("1"), "First", undefined, {
            fulfilledBy: [mockup as never],
          }),
        ],
      }).status,
    ).toBe("invalid");
  });

  it("preserves canonical IDs, record order, groups, and typed citation slots", () => {
    const firstId = uuid("1");
    const secondId = uuid("2");
    const section = readFeatureRequirementsSection({
      records: [
        requirement(firstId, "First", "Access", {
          designedBy: [
            { entityType: "DESIGN_DOC", entityId: uuid("3"), entityTitle: "Design" },
          ],
        }),
        requirement(secondId, "Second", undefined, {
          fulfilledBy: [{ entityType: "PLAN", entityId: uuid("4"), entityTitle: `Title ${uuid("4")}` }],
          contracts: [{ entityType: "CONTRACT", entityId: uuid("5"), entityTitle: `Title ${uuid("5")}` }],
        }),
      ],
    });

    expect(section.status).toBe("valid");
    if (section.status !== "valid") return;
    expect(section.records.map((record) => record.id)).toEqual([
      firstId,
      secondId,
    ]);
    expect(section.records[0]?.group).toBe("Access");
    expect(section.records[0]?.designedBy[0]).toMatchObject({
      entityType: "DESIGN_DOC",
      entityTitle: "Design",
    });
    expect(section.records[1]?.fulfilledBy[0]?.entityType).toBe("PLAN");
    expect(section.records[1]?.contracts[0]?.entityType).toBe("CONTRACT");
  });

  it("returns an explicit invalid state for malformed canonical content", () => {
    expect(readFeatureRequirementsSection("not-json").status).toBe("invalid");
    expect(
      readFeatureRequirementsSection({
        records: [
          requirement(uuid("1"), "Duplicate"),
          requirement(uuid("1"), "Duplicate again"),
        ],
      }),
    ).toMatchObject({ status: "invalid" });
    expect(
      readFeatureRequirementsSection({
        records: [
          requirement(uuid("2"), "Wrong role", undefined, {
            contracts: [{ entityType: "TASK", entityId: uuid("3"), entityTitle: `Title ${uuid("3")}` }],
          }),
        ],
      }),
    ).toMatchObject({ status: "invalid" });
  });

  it("specializes only the effective FEATURE JSON section", () => {
    expect(
      isCanonicalFeatureRequirementsDefinition("FEATURE", canonicalDefinition),
    ).toBe(true);
    expect(
      isCanonicalFeatureRequirementsDefinition("CUSTOM", canonicalDefinition),
    ).toBe(false);
    expect(
      isCanonicalFeatureRequirementsDefinition("FEATURE", {
        ...canonicalDefinition,
        schemaRef: "#/components/schemas/Other",
      }),
    ).toBe(false);
    for (const schemaRef of [
      "./tasks.yaml#/FeatureRequirementsSection",
      "FeatureRequirementsSection",
      null,
    ]) {
      expect(
        isCanonicalFeatureRequirementsDefinition("FEATURE", {
          ...canonicalDefinition,
          schemaRef,
        }),
      ).toBe(true);
    }
    expect(
      adaptFeatureRequirementsSection({
        typeKey: "CUSTOM",
        definition: canonicalDefinition,
        value: { records: [] },
      }).status,
    ).toBe("invalid");
  });
});

describe("structured requirement presentation", () => {
  it("keeps ungrouped records unlabeled and preserves source order", () => {
    const model = buildRequirementPresentationModel([
      requirement(uuid("1"), "Ungrouped"),
      requirement(uuid("2"), "Access one", "Access"),
      requirement(uuid("3"), "Access two", "Access"),
      requirement(uuid("4"), "Billing", "Billing"),
    ]);

    expect(model.blocks.map((block) => block.kind)).toEqual([
      "ungrouped",
      "group",
      "group",
    ]);
    expect(model.blocks[1]).toMatchObject({ label: "Access" });
    expect(model.blocks[0]?.requirements[0]).not.toHaveProperty("group");
    expect(model.blocks[1]?.requirements.map((item) => item.id)).toEqual([
      uuid("2"),
      uuid("3"),
    ]);
  });

  it("classifies simultaneous statement, citation, and group edits by UUID", () => {
    const id = uuid("1");
    const changes = buildRequirementPresentationChanges(
      [requirement(id, "Original", "Old", {
        fulfilledBy: [{ entityType: "TASK", entityId: uuid("2"), entityTitle: `Title ${uuid("2")}` }],
      })],
      [requirement(id, "Updated", "New", {
        fulfilledBy: [{ entityType: "PLAN", entityId: uuid("3"), entityTitle: `Title ${uuid("3")}` }],
      })],
    );

    expect(changes).toEqual([
      expect.objectContaining({ id, kind: "group-changed" }),
    ]);
    expect(changes[0]?.before?.id).toBe(id);
    expect(changes[0]?.after?.id).toBe(id);
  });

  it("does not treat reordering as replacement when IDs remain the same", () => {
    const first = requirement(uuid("1"), "First");
    const second = requirement(uuid("2"), "Second");
    expect(
      buildRequirementPresentationChanges([first, second], [second, first]).map(
        (change) => [change.id, change.kind],
      ),
    ).toEqual([
      [second.id, "unchanged"],
      [first.id, "unchanged"],
    ]);
  });

  it("does not treat a differing stored citation title as an edit", () => {
    const id = uuid("1");
    const cite = (entityTitle: string) => ({
      entityType: "TASK" as const,
      entityId: uuid("2"),
      entityTitle,
    });
    expect(
      buildRequirementPresentationChanges(
        [requirement(id, "Same", undefined, { fulfilledBy: [cite("Before")] })],
        [requirement(id, "Same", undefined, { fulfilledBy: [cite("After")] })],
      ).map((change) => change.kind),
    ).toEqual(["unchanged"]);
  });
});
