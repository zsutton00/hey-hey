import { describe, it, expect } from "vitest";
import { annotationKey, serializeConfig } from "../serialize-config";
import type {
  UnifiedRelationshipEdge,
  UnifiedRelationshipGraph,
} from "../types";

function edge(
  overrides: Partial<UnifiedRelationshipEdge> = {},
): UnifiedRelationshipEdge {
  return {
    sourceEntity: "Task",
    targetEntity: "User",
    field: "assignee",
    tier: "entity_embed",
    cardinality: "one-to-one",
    isPartial: false,
    isSelfRelation: false,
    confidence: "high",
    detectedBy: "openapi",
    ...overrides,
  };
}

const SOURCES = { openapi: "/spec.yaml", prisma: "/schema.prisma" };
const FIXED_TS = "2026-01-01T00:00:00.000Z";

describe("serializeConfig", () => {
  it("deduplicates edges with same target, field, and tier", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ endpoint: "GET /tasks/{id}", conditional: "includeAssignee" }),
        edge({ endpoint: "GET /tasks", conditional: "includeDetails" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);

    expect(config.entities["Task"]).toHaveLength(1);
    const entry = config.entities["Task"][0];
    expect(entry.conditionals).toEqual([
      "includeAssignee",
      "includeDetails",
    ]);
    expect(config.summary.relationshipCount).toBe(1);
  });

  it("keeps edges with different fields as separate entries", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ field: "assignee" }),
        edge({ field: "reporter", targetEntity: "User" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.entities["Task"]).toHaveLength(2);
  });

  it("promotes confidence when merging edges from different sources", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ confidence: "needs_review", detectedBy: "openapi" }),
        edge({ confidence: "high", detectedBy: "prisma" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    const entry = config.entities["Task"][0];
    expect(entry.confidence).toBe("high");
    expect(entry.detectedBy).toBe("both");
    expect(entry.needsReview).toBe(false);
  });

  it("marks needs_review entries with needsReview flag", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [edge({ confidence: "needs_review" })],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.entities["Task"][0].needsReview).toBe(true);
    expect(config.summary.needsReviewCount).toBe(1);
  });

  it("produces deterministic output with sorted entity keys", () => {
    const graph: UnifiedRelationshipGraph = {
      Zebra: [
        edge({ sourceEntity: "Zebra", targetEntity: "Apple", field: "a" }),
      ],
      Apple: [
        edge({ sourceEntity: "Apple", targetEntity: "Zebra", field: "z" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    const keys = Object.keys(config.entities);
    expect(keys).toEqual(["Apple", "Zebra"]);
  });

  it("sorts entries within an entity by target, field, tier", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ targetEntity: "User", field: "reporter" }),
        edge({ targetEntity: "Project", field: "project" }),
        edge({ targetEntity: "User", field: "assignee" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    const fields = config.entities["Task"].map((e) => e.field);
    expect(fields).toEqual(["project", "assignee", "reporter"]);
  });

  it("preserves originalTargetEntity for traceability", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({
          targetEntity: "Service",
          originalTargetEntity: "CodingSessionService",
        }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.entities["Task"][0].originalTargetEntity).toBe(
      "CodingSessionService",
    );
  });

  it("deduplicates conditional params without duplicates", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ conditional: "includeAssignee" }),
        edge({ conditional: "includeAssignee" }),
        edge({ conditional: "includeDetails" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.entities["Task"][0].conditionals).toEqual([
      "includeAssignee",
      "includeDetails",
    ]);
  });

  it("produces correct summary statistics", () => {
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ tier: "entity_embed", confidence: "high" }),
        edge({
          targetEntity: "Project",
          field: "project",
          tier: "id_reference",
          confidence: "medium",
        }),
      ],
      User: [
        edge({
          sourceEntity: "User",
          targetEntity: "Organization",
          field: "org",
          tier: "id_reference",
          confidence: "needs_review",
        }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.summary.entityCount).toBe(2);
    expect(config.summary.relationshipCount).toBe(3);
    expect(config.summary.needsReviewCount).toBe(1);
    expect(config.summary.byTier.entity_embed).toBe(1);
    expect(config.summary.byTier.id_reference).toBe(2);
    expect(config.summary.byConfidence.high).toBe(1);
    expect(config.summary.byConfidence.medium).toBe(1);
    expect(config.summary.byConfidence.needs_review).toBe(1);
  });

  it("carries prismaDetail from the first edge when merging", () => {
    const prismaDetail = {
      prismaCardinality: "1:1" as const,
      isRequired: true,
      relationName: "TaskAssignee",
    };
    const graph: UnifiedRelationshipGraph = {
      Task: [
        edge({ detectedBy: "prisma", prismaDetail }),
        edge({ detectedBy: "openapi" }),
      ],
    };

    const config = serializeConfig(graph, SOURCES, FIXED_TS);
    expect(config.entities["Task"][0].prismaDetail).toEqual(prismaDetail);
  });

  it("re-running with same input produces identical output", () => {
    const graph: UnifiedRelationshipGraph = {
      B: [edge({ sourceEntity: "B", field: "x" })],
      A: [edge({ sourceEntity: "A", field: "y" })],
    };

    const run1 = JSON.stringify(
      serializeConfig(graph, SOURCES, FIXED_TS),
    );
    const run2 = JSON.stringify(
      serializeConfig(graph, SOURCES, FIXED_TS),
    );
    expect(run1).toBe(run2);
  });

  it("includes version and metadata", () => {
    const config = serializeConfig({}, SOURCES, FIXED_TS);
    expect(config.version).toBe(1);
    expect(config.generatedAt).toBe(FIXED_TS);
    expect(config.sources).toEqual(SOURCES);
  });

  it("handles empty graph", () => {
    const config = serializeConfig({}, SOURCES, FIXED_TS);
    expect(config.summary.entityCount).toBe(0);
    expect(config.summary.relationshipCount).toBe(0);
    expect(Object.keys(config.entities)).toHaveLength(0);
  });

  describe("annotation preservation", () => {
    it("embeds a prior note on the matching entry", () => {
      const graph: UnifiedRelationshipGraph = {
        Task: [edge()],
      };
      const annotations = new Map([
        [annotationKey("Task", "User", "assignee", "entity_embed"), "Verified manually — partial embed only"],
      ]);

      const config = serializeConfig(graph, SOURCES, FIXED_TS, annotations);
      expect(config.entities["Task"][0].note).toBe(
        "Verified manually — partial embed only",
      );
    });

    it("omits note field when no prior annotation exists for entry", () => {
      const graph: UnifiedRelationshipGraph = {
        Task: [edge()],
      };

      const config = serializeConfig(graph, SOURCES, FIXED_TS);
      expect(config.entities["Task"][0].note).toBeUndefined();
    });

    it("silently drops notes for entries no longer in the graph", () => {
      const graph: UnifiedRelationshipGraph = {
        Task: [edge()],
      };
      // Note keyed on a relationship that no longer exists
      const annotations = new Map([
        [annotationKey("Task", "Project", "project", "id_reference"), "stale note"],
      ]);

      const config = serializeConfig(graph, SOURCES, FIXED_TS, annotations);
      // The still-present entry has no note
      expect(config.entities["Task"][0].note).toBeUndefined();
    });

    it("preserves notes across deduplication when edges are merged", () => {
      const graph: UnifiedRelationshipGraph = {
        Task: [
          edge({ endpoint: "GET /tasks/{id}", conditional: "includeAssignee" }),
          edge({ endpoint: "GET /tasks", conditional: "includeDetails" }),
        ],
      };
      const annotations = new Map([
        [annotationKey("Task", "User", "assignee", "entity_embed"), "partial embed confirmed"],
      ]);

      const config = serializeConfig(graph, SOURCES, FIXED_TS, annotations);
      // Deduplicated to one entry — note must survive
      expect(config.entities["Task"]).toHaveLength(1);
      expect(config.entities["Task"][0].note).toBe("partial embed confirmed");
    });

    it("re-running with same input and same annotations produces identical output", () => {
      const graph: UnifiedRelationshipGraph = {
        Task: [edge()],
      };
      const annotations = new Map([
        [annotationKey("Task", "User", "assignee", "entity_embed"), "stable note"],
      ]);

      const run1 = JSON.stringify(serializeConfig(graph, SOURCES, FIXED_TS, annotations));
      const run2 = JSON.stringify(serializeConfig(graph, SOURCES, FIXED_TS, annotations));
      expect(run1).toBe(run2);
    });
  });
});
