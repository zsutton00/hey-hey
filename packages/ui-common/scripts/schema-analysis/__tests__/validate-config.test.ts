import { describe, it, expect } from "vitest";
import { validateConfig } from "../validate-config";
import { formatValidationReport } from "../format-validation-report";
import type { RelationshipConfig } from "../config-types";
import type { ConfigRelationshipEntry } from "../config-types";

function entry(
  overrides: Partial<ConfigRelationshipEntry> = {},
): ConfigRelationshipEntry {
  return {
    targetEntity: "User",
    field: "assignee",
    tier: "entity_embed",
    cardinality: "one-to-one",
    isPartial: false,
    isSelfRelation: false,
    conditionals: [],
    confidence: "high",
    detectedBy: "openapi",
    needsReview: false,
    ...overrides,
  };
}

function config(
  entities: Record<string, ConfigRelationshipEntry[]>,
): RelationshipConfig {
  const count = Object.values(entities).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    sources: { openapi: "/spec.yaml", prisma: "/schema.prisma" },
    summary: {
      entityCount: Object.keys(entities).length,
      relationshipCount: count,
      needsReviewCount: 0,
      byTier: { id_reference: 0, entity_embed: count, derived_scalar: 0 },
      byConfidence: { high: count, medium: 0, needs_review: 0 },
      byDetectionSource: { prisma: 0, openapi: count, both: 0 },
    },
    entities,
  };
}

describe("validateConfig", () => {
  it("returns clean report when configs are identical", () => {
    const c = config({ Task: [entry()] });
    const report = validateConfig(c, c);

    expect(report.isClean).toBe(true);
    expect(report.summary.totalChanges).toBe(0);
    expect(report.entries).toHaveLength(0);
  });

  it("detects removed entities", () => {
    const prev = config({
      Task: [entry()],
      Project: [entry({ targetEntity: "Organization", field: "org" })],
    });
    const next = config({ Task: [entry()] });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(false);
    expect(report.summary.removedEntities).toBe(1);
    const removed = report.entries.find(
      (e) => e.kind === "removed_entity",
    );
    expect(removed).toBeDefined();
    expect(removed!.entity).toBe("Project");
    expect(removed!.severity).toBe("breaking");
  });

  it("detects added entities", () => {
    const prev = config({ Task: [entry()] });
    const next = config({
      Task: [entry()],
      Project: [entry({ targetEntity: "Organization", field: "org" })],
    });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(true); // additions are info, not breaking
    expect(report.summary.addedEntities).toBe(1);
    const added = report.entries.find((e) => e.kind === "added_entity");
    expect(added).toBeDefined();
    expect(added!.entity).toBe("Project");
    expect(added!.severity).toBe("info");
  });

  it("detects removed relationships within a shared entity", () => {
    const prev = config({
      Task: [
        entry(),
        entry({ targetEntity: "Project", field: "project", tier: "id_reference" }),
      ],
    });
    const next = config({ Task: [entry()] });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(false);
    expect(report.summary.removedRelationships).toBe(1);
    const removed = report.entries.find(
      (e) => e.kind === "removed_relationship",
    );
    expect(removed).toBeDefined();
    expect(removed!.entity).toBe("Task");
    expect(removed!.field).toBe("project");
    expect(removed!.targetEntity).toBe("Project");
    expect(removed!.severity).toBe("breaking");
  });

  it("detects added relationships within a shared entity", () => {
    const prev = config({ Task: [entry()] });
    const next = config({
      Task: [
        entry(),
        entry({ targetEntity: "Project", field: "project", tier: "id_reference" }),
      ],
    });

    const report = validateConfig(prev, next);

    expect(report.summary.addedRelationships).toBe(1);
    const added = report.entries.find(
      (e) => e.kind === "added_relationship",
    );
    expect(added).toBeDefined();
    expect(added!.severity).toBe("info");
  });

  it("detects cardinality changes", () => {
    const prev = config({
      Task: [entry({ cardinality: "one-to-many" })],
    });
    const next = config({
      Task: [entry({ cardinality: "one-to-one" })],
    });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(false);
    const change = report.entries.find(
      (e) => e.kind === "cardinality_change",
    );
    expect(change).toBeDefined();
    expect(change!.severity).toBe("breaking"); // narrowing
    expect(change!.previousValue).toBe("one-to-many");
    expect(change!.newValue).toBe("one-to-one");
  });

  it("treats cardinality widening as warning, not breaking", () => {
    const prev = config({
      Task: [entry({ cardinality: "one-to-one" })],
    });
    const next = config({
      Task: [entry({ cardinality: "one-to-many" })],
    });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(true);
    const change = report.entries.find(
      (e) => e.kind === "cardinality_change",
    );
    expect(change!.severity).toBe("warning");
  });

  it("detects tier changes without spurious remove/add", () => {
    const prev = config({
      Task: [entry({ tier: "entity_embed" })],
    });
    const next = config({
      Task: [entry({ tier: "id_reference" })],
    });

    const report = validateConfig(prev, next);

    const change = report.entries.find((e) => e.kind === "tier_change");
    expect(change).toBeDefined();
    expect(change!.severity).toBe("warning");
    expect(change!.previousValue).toBe("entity_embed");
    expect(change!.newValue).toBe("id_reference");
    // Must not produce spurious removed/added entries
    expect(
      report.entries.find((e) => e.kind === "removed_relationship"),
    ).toBeUndefined();
    expect(
      report.entries.find((e) => e.kind === "added_relationship"),
    ).toBeUndefined();
  });

  it("handles multiple tiers on the same target+field correctly", () => {
    const prev = config({
      Task: [
        entry({ tier: "entity_embed" }),
        entry({ tier: "id_reference" }),
      ],
    });
    const next = config({
      Task: [
        entry({ tier: "derived_scalar" }),
        entry({ tier: "id_reference" }),
      ],
    });

    const report = validateConfig(prev, next);

    // id_reference is unchanged (exact match)
    // entity_embed → derived_scalar is a cross-tier match
    const tierChange = report.entries.find(
      (e) => e.kind === "tier_change",
    );
    expect(tierChange).toBeDefined();
    expect(tierChange!.previousValue).toBe("entity_embed");
    expect(tierChange!.newValue).toBe("derived_scalar");
    // No spurious remove/add for the cross-tier match
    expect(
      report.entries.find((e) => e.kind === "removed_relationship"),
    ).toBeUndefined();
    expect(
      report.entries.find((e) => e.kind === "added_relationship"),
    ).toBeUndefined();
  });

  it("detects required → optional transition as breaking", () => {
    const prev = config({
      Task: [
        entry({
          prismaDetail: {
            prismaCardinality: "1:1",
            isRequired: true,
            relationName: "TaskAssignee",
          },
        }),
      ],
    });
    const next = config({
      Task: [
        entry({
          prismaDetail: {
            prismaCardinality: "1:1",
            isRequired: false,
            relationName: "TaskAssignee",
          },
        }),
      ],
    });

    const report = validateConfig(prev, next);

    expect(report.isClean).toBe(false);
    const change = report.entries.find(
      (e) => e.kind === "required_change",
    );
    expect(change).toBeDefined();
    expect(change!.severity).toBe("breaking");
    expect(change!.previousValue).toBe("required");
    expect(change!.newValue).toBe("optional");
  });

  it("detects optional → required transition as warning", () => {
    const prev = config({
      Task: [
        entry({
          prismaDetail: {
            prismaCardinality: "1:1",
            isRequired: false,
          },
        }),
      ],
    });
    const next = config({
      Task: [
        entry({
          prismaDetail: {
            prismaCardinality: "1:1",
            isRequired: true,
          },
        }),
      ],
    });

    const report = validateConfig(prev, next);

    const change = report.entries.find(
      (e) => e.kind === "required_change",
    );
    expect(change).toBeDefined();
    expect(change!.severity).toBe("warning");
  });

  it("detects confidence downgrades as info", () => {
    const prev = config({
      Task: [entry({ confidence: "high" })],
    });
    const next = config({
      Task: [entry({ confidence: "medium" })],
    });

    const report = validateConfig(prev, next);

    const change = report.entries.find(
      (e) => e.kind === "confidence_change",
    );
    expect(change).toBeDefined();
    expect(change!.severity).toBe("info");
  });

  it("does not flag confidence upgrades", () => {
    const prev = config({
      Task: [entry({ confidence: "needs_review" })],
    });
    const next = config({
      Task: [entry({ confidence: "high" })],
    });

    const report = validateConfig(prev, next);
    expect(
      report.entries.find((e) => e.kind === "confidence_change"),
    ).toBeUndefined();
  });

  it("sorts entries by severity, then entity, then field", () => {
    const prev = config({
      B: [
        entry({ targetEntity: "X", field: "x" }),
        entry({ targetEntity: "Y", field: "y", tier: "id_reference" }),
      ],
      A: [entry({ targetEntity: "Z", field: "z" })],
    });
    const next = config({
      B: [entry({ targetEntity: "X", field: "x" })],
      // A removed entirely — breaking
      // B.y removed — breaking
    });

    const report = validateConfig(prev, next);

    // All breaking entries should come first
    const severities = report.entries.map((e) => e.severity);
    expect(severities).toEqual(
      [...severities].sort(
        (a, b) =>
          ["breaking", "warning", "info"].indexOf(a) -
          ["breaking", "warning", "info"].indexOf(b),
      ),
    );

    // Among same-severity, sorted by entity
    const breakingEntities = report.entries
      .filter((e) => e.severity === "breaking")
      .map((e) => e.entity);
    expect(breakingEntities).toEqual([...breakingEntities].sort());
  });

  it("handles empty configs", () => {
    const empty = config({});
    const report = validateConfig(empty, empty);

    expect(report.isClean).toBe(true);
    expect(report.summary.totalChanges).toBe(0);
  });

  it("handles transition from empty to populated config", () => {
    const empty = config({});
    const populated = config({
      Task: [entry()],
      Project: [entry({ targetEntity: "Org", field: "org" })],
    });

    const report = validateConfig(empty, populated);

    expect(report.isClean).toBe(true);
    expect(report.summary.addedEntities).toBe(2);
  });

  it("reports multiple change types on the same relationship", () => {
    const prev = config({
      Task: [
        entry({
          cardinality: "one-to-many",
          tier: "entity_embed",
          prismaDetail: {
            prismaCardinality: "1:many",
            isRequired: true,
          },
        }),
      ],
    });
    const next = config({
      Task: [
        entry({
          cardinality: "one-to-one",
          tier: "id_reference",
          prismaDetail: {
            prismaCardinality: "1:1",
            isRequired: false,
          },
        }),
      ],
    });

    const report = validateConfig(prev, next);

    const kinds = report.entries.map((e) => e.kind).sort();
    expect(kinds).toContain("cardinality_change");
    expect(kinds).toContain("tier_change");
    expect(kinds).toContain("required_change");
    expect(report.summary.typeChanges).toBe(3);
  });
});

describe("formatValidationReport", () => {
  it("returns no-changes message for clean identical configs", () => {
    const c = config({ Task: [entry()] });
    const report = validateConfig(c, c);
    const output = formatValidationReport(report);

    expect(output).toContain("No changes detected");
  });

  it("shows breaking section header when breaking changes exist", () => {
    const prev = config({ Task: [entry()] });
    const next = config({});
    const report = validateConfig(prev, next);
    const output = formatValidationReport(report);

    expect(output).toContain("BREAKING");
    expect(output).toContain("breaking change(s) detected");
  });

  it("shows summary counts", () => {
    const prev = config({
      Task: [entry()],
      Project: [entry({ targetEntity: "Org", field: "org" })],
    });
    const next = config({});
    const report = validateConfig(prev, next);
    const output = formatValidationReport(report);

    expect(output).toContain("Total changes: 2");
    expect(output).toContain("2 removed");
  });

  it("shows no-breaking footer when only info changes exist", () => {
    const prev = config({});
    const next = config({ Task: [entry()] });
    const report = validateConfig(prev, next);
    const output = formatValidationReport(report);

    expect(output).toContain("No breaking changes detected");
  });
});
