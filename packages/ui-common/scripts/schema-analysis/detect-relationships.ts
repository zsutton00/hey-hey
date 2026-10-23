#!/usr/bin/env tsx
/**
 * Relationship Detection Algorithm
 *
 * Consumes the structured outputs of both the OpenAPI parser and the
 * Prisma schema parser, then produces a unified relationship graph
 * keyed by entity type. Each edge is annotated with:
 *  - Relationship tier (id_reference, entity_embed, derived_scalar)
 *  - Unified cardinality
 *  - Detection confidence (boosted when both parsers agree)
 *  - Detection source (prisma, openapi, or both)
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { parseOpenAPISpec } from "./parse-openapi";
import { parsePrismaSchema } from "./parse-prisma";
import type {
  Confidence,
  PrismaCardinality,
  PrismaRelation,
  PrismaSchemaMap,
  RelationshipMap,
  RelationshipTier,
  UnifiedCardinality,
  UnifiedRelationshipEdge,
  UnifiedRelationshipGraph,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Prisma ingestion
// ---------------------------------------------------------------------------

function prismaCardinalityToUnified(
  c: PrismaCardinality,
): UnifiedCardinality {
  switch (c) {
    case "1:1":
      return "one-to-one";
    case "1:many":
      return "one-to-many";
    case "many:many":
      return "many-to-many";
  }
}

function classifyPrismaTier(rel: PrismaRelation): RelationshipTier {
  // If the relation has foreign key fields on this model it's an
  // ID reference (scalar FK pointing at another entity).
  // List relations or object relations without FK fields on this
  // side are entity embeds from the Prisma perspective.
  if (rel.foreignKeyFields && rel.foreignKeyFields.length > 0) {
    return "id_reference";
  }
  return "entity_embed";
}

function ingestPrisma(
  prismaMap: PrismaSchemaMap,
): UnifiedRelationshipEdge[] {
  const edges: UnifiedRelationshipEdge[] = [];

  for (const [modelName, model] of Object.entries(prismaMap)) {
    for (const rel of model.relations) {
      edges.push({
        sourceEntity: modelName,
        targetEntity: rel.target,
        field: rel.field,
        tier: classifyPrismaTier(rel),
        cardinality: prismaCardinalityToUnified(rel.type),
        isPartial: false,
        isSelfRelation: rel.isSelfRelation,
        confidence: "high",
        detectedBy: "prisma",
        prismaDetail: {
          prismaCardinality: rel.type,
          foreignKeyFields: rel.foreignKeyFields,
          isRequired: rel.isRequired,
          relationName: rel.relationName,
        },
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// OpenAPI ingestion
// ---------------------------------------------------------------------------

function openApiCardinalityToUnified(
  c: "one" | "many" | "scalar",
): UnifiedCardinality {
  switch (c) {
    case "one":
      return "one-to-one";
    case "many":
      return "one-to-many";
    case "scalar":
      return "scalar";
  }
}

function classifyOpenApiTier(
  isDerived: boolean,
  cardinality: "one" | "many" | "scalar",
  isPartial: boolean,
  confidence: string,
): RelationshipTier {
  if (isDerived || cardinality === "scalar") {
    return "derived_scalar";
  }
  // Inline objects with an ID but no recognized DTO are flagged as
  // needs_review — they're likely partial embeds.
  // Full DTO refs and partial projections are both entity embeds.
  if (
    isPartial &&
    confidence === "needs_review" &&
    cardinality === "one"
  ) {
    // Inline object with id — could be an id_reference, but since
    // it's an object (not just a scalar FK) we classify as embed
    // and let confidence reflect the ambiguity.
    return "entity_embed";
  }
  return "entity_embed";
}

function ingestOpenApi(
  openApiMap: RelationshipMap,
): UnifiedRelationshipEdge[] {
  const edges: UnifiedRelationshipEdge[] = [];

  for (const [entityName, exposure] of Object.entries(openApiMap)) {
    for (const ep of exposure.apiExposures) {
      for (const nested of ep.nestedEntities) {
        const targetEntity =
          nested.targetEntity === "Self"
            ? entityName
            : nested.targetEntity;
        const isSelfRelation = targetEntity === entityName;

        edges.push({
          sourceEntity: entityName,
          targetEntity,
          field: nested.field,
          tier: classifyOpenApiTier(
            nested.isDerived,
            nested.cardinality,
            nested.isPartial,
            nested.confidence,
          ),
          cardinality: openApiCardinalityToUnified(nested.cardinality),
          isPartial: nested.isPartial,
          isSelfRelation,
          conditional: nested.conditional,
          confidence: nested.confidence,
          detectedBy: "openapi",
          endpoint: ep.endpoint,
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// DTO-to-model name resolution
// ---------------------------------------------------------------------------

/**
 * Builds a map from (sourceEntity, field) → Prisma target entity name.
 *
 * This is used to resolve OpenAPI DTO-derived names back to canonical
 * Prisma model names. For example, CodingSession.service → "Service"
 * in Prisma, but the OpenAPI parser sees the DTO "CodingSessionServiceDto"
 * and derives the target name "CodingSessionService". By matching on
 * (source, field), we can resolve "CodingSessionService" → "Service".
 */
function buildFieldTargetIndex(
  prismaEdges: UnifiedRelationshipEdge[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const edge of prismaEdges) {
    const key =
      `${edge.sourceEntity.toLowerCase()}::${edge.field.toLowerCase()}`;
    index.set(key, edge.targetEntity);
  }
  return index;
}

/**
 * Resolves OpenAPI target entity names to canonical Prisma model names.
 *
 * Strategy (in priority order):
 * 1. Field-level match: same (source, field) exists in Prisma — use
 *    the Prisma target. E.g. CodingSession.service → Service.
 * 2. Suffix match: the OpenAPI target ends with a known Prisma model
 *    name. E.g. "CodingSessionService" ends with "Service".
 * 3. No match: keep the original OpenAPI name.
 *
 * When resolved, the original DTO name is preserved in
 * `originalTargetEntity`.
 */
function resolveOpenApiTargets(
  openApiEdges: UnifiedRelationshipEdge[],
  prismaEdges: UnifiedRelationshipEdge[],
  prismaModelNames: Set<string>,
): void {
  const fieldIndex = buildFieldTargetIndex(prismaEdges);

  // Pre-sort model names longest-first so suffix matching prefers
  // the most specific match (e.g. "CodingSession" over "Session")
  const sortedModels = [...prismaModelNames].sort(
    (a, b) => b.length - a.length,
  );

  for (const edge of openApiEdges) {
    // Skip if the target already matches a Prisma model
    if (prismaModelNames.has(edge.targetEntity)) continue;

    const fieldKey =
      `${edge.sourceEntity.toLowerCase()}::${edge.field.toLowerCase()}`;
    const fieldMatch = fieldIndex.get(fieldKey);

    if (fieldMatch) {
      edge.originalTargetEntity = edge.targetEntity;
      edge.targetEntity = fieldMatch;
      continue;
    }

    // Suffix match: "CodingSessionService" → "Service"
    const lowerTarget = edge.targetEntity.toLowerCase();
    for (const model of sortedModels) {
      if (
        lowerTarget.endsWith(model.toLowerCase()) &&
        lowerTarget !== model.toLowerCase()
      ) {
        edge.originalTargetEntity = edge.targetEntity;
        edge.targetEntity = model;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-parser correlation and confidence boosting
// ---------------------------------------------------------------------------

function correlationKey(
  source: string,
  target: string,
  field: string,
): string {
  return `${source.toLowerCase()}::${target.toLowerCase()}::${field.toLowerCase()}`;
}

function entityPairKey(source: string, target: string): string {
  return `${source.toLowerCase()}::${target.toLowerCase()}`;
}

function boostConfidence(_existing: Confidence): Confidence {
  return "high";
}

/**
 * Merges Prisma-derived and OpenAPI-derived edges into a unified graph.
 *
 * Before correlation, OpenAPI target entity names are resolved to
 * canonical Prisma model names where possible (e.g.
 * "CodingSessionService" → "Service"). This dramatically increases
 * the match rate between parsers.
 *
 * Correlation strategy:
 * 1. Exact match on (source, target, field) — merge into a single
 *    edge with detectedBy="both" and boosted confidence.
 * 2. Entity-pair match (source, target) but different fields — both
 *    edges are kept, but confidence may be boosted for the OpenAPI
 *    edge since the Prisma parser confirms the relationship exists.
 * 3. Unmatched edges — kept with their original confidence.
 */
function mergeEdges(
  prismaEdges: UnifiedRelationshipEdge[],
  openApiEdges: UnifiedRelationshipEdge[],
  prismaModelNames: Set<string>,
): UnifiedRelationshipGraph {
  const graph: UnifiedRelationshipGraph = {};

  // Resolve OpenAPI DTO names to Prisma model names before correlating
  resolveOpenApiTargets(openApiEdges, prismaEdges, prismaModelNames);

  // Index Prisma edges by exact key and entity-pair key
  const prismaByExact = new Map<string, UnifiedRelationshipEdge[]>();
  const prismaByPair = new Set<string>();

  for (const edge of prismaEdges) {
    const exact = correlationKey(
      edge.sourceEntity,
      edge.targetEntity,
      edge.field,
    );
    if (!prismaByExact.has(exact)) {
      prismaByExact.set(exact, []);
    }
    prismaByExact.get(exact)!.push(edge);
    prismaByPair.add(
      entityPairKey(edge.sourceEntity, edge.targetEntity),
    );
  }

  // Track which Prisma edges get merged so we can add unmatched ones
  const mergedPrismaKeys = new Set<string>();

  // Process OpenAPI edges
  for (const oaEdge of openApiEdges) {
    const exact = correlationKey(
      oaEdge.sourceEntity,
      oaEdge.targetEntity,
      oaEdge.field,
    );
    const pairKey = entityPairKey(
      oaEdge.sourceEntity,
      oaEdge.targetEntity,
    );
    const prismaMatches = prismaByExact.get(exact);

    if (prismaMatches && prismaMatches.length > 0) {
      // Exact field match — merge
      const prismaEdge = prismaMatches[0];
      mergedPrismaKeys.add(exact);

      const merged: UnifiedRelationshipEdge = {
        ...oaEdge,
        confidence: boostConfidence(oaEdge.confidence),
        detectedBy: "both",
        isSelfRelation:
          oaEdge.isSelfRelation || prismaEdge.isSelfRelation,
        prismaDetail: prismaEdge.prismaDetail,
      };

      addToGraph(graph, merged);
    } else if (prismaByPair.has(pairKey)) {
      // Entity pair exists in Prisma but field name differs.
      // Boost confidence since the relationship is confirmed at the
      // entity level, but keep as separate edges.
      const boosted: UnifiedRelationshipEdge = {
        ...oaEdge,
        confidence:
          oaEdge.confidence === "needs_review"
            ? "medium"
            : oaEdge.confidence,
      };
      addToGraph(graph, boosted);
    } else {
      // OpenAPI-only relationship
      addToGraph(graph, { ...oaEdge });
    }
  }

  // Add unmatched Prisma edges
  for (const [exact, edges] of prismaByExact.entries()) {
    if (mergedPrismaKeys.has(exact)) continue;
    for (const edge of edges) {
      addToGraph(graph, { ...edge });
    }
  }

  return graph;
}

function addToGraph(
  graph: UnifiedRelationshipGraph,
  edge: UnifiedRelationshipEdge,
): void {
  if (!graph[edge.sourceEntity]) {
    graph[edge.sourceEntity] = [];
  }
  graph[edge.sourceEntity].push(edge);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectRelationships(
  prismaMap: PrismaSchemaMap,
  openApiMap: RelationshipMap,
): UnifiedRelationshipGraph {
  const prismaModelNames = new Set(Object.keys(prismaMap));
  const prismaEdges = ingestPrisma(prismaMap);
  const openApiEdges = ingestOpenApi(openApiMap);
  return mergeEdges(prismaEdges, openApiEdges, prismaModelNames);
}

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

function printSummary(graph: UnifiedRelationshipGraph): void {
  const entities = Object.keys(graph).sort();
  const totalEdges = Object.values(graph).reduce(
    (sum, edges) => sum + edges.length,
    0,
  );
  const byTier = { id_reference: 0, entity_embed: 0, derived_scalar: 0 };
  const bySource = { prisma: 0, openapi: 0, both: 0 };
  const byConfidence = { high: 0, medium: 0, needs_review: 0 };
  let selfRelCount = 0;

  for (const edges of Object.values(graph)) {
    for (const e of edges) {
      byTier[e.tier]++;
      bySource[e.detectedBy]++;
      byConfidence[e.confidence]++;
      if (e.isSelfRelation) selfRelCount++;
    }
  }

  console.error(`\n=== Unified Relationship Graph ===`);
  console.error(`Entity types: ${entities.length}`);
  console.error(`Total edges: ${totalEdges}`);
  console.error(
    `  By tier: id_reference=${byTier.id_reference}, ` +
      `entity_embed=${byTier.entity_embed}, ` +
      `derived_scalar=${byTier.derived_scalar}`,
  );
  console.error(
    `  By source: prisma=${bySource.prisma}, ` +
      `openapi=${bySource.openapi}, ` +
      `both=${bySource.both}`,
  );
  console.error(
    `  By confidence: high=${byConfidence.high}, ` +
      `medium=${byConfidence.medium}, ` +
      `needs_review=${byConfidence.needs_review}`,
  );
  console.error(`  Self-referential: ${selfRelCount}`);

  // Count resolved targets
  let resolvedCount = 0;
  for (const edges of Object.values(graph)) {
    for (const e of edges) {
      if (e.originalTargetEntity) resolvedCount++;
    }
  }
  if (resolvedCount > 0) {
    console.error(`  DTO names resolved to Prisma models: ${resolvedCount}`);
  }

  console.error(`\nPer-entity breakdown:`);
  for (const entity of entities) {
    const edges = graph[entity];
    const targets = edges
      .map((e) => {
        const flags = [e.tier];
        if (e.isSelfRelation) flags.push("self");
        if (e.isPartial) flags.push("partial");
        if (e.conditional) flags.push(`if:${e.conditional}`);
        flags.push(e.confidence);
        flags.push(e.detectedBy);
        return `${e.field} -> ${e.targetEntity} (${flags.join(", ")})`;
      })
      .join("\n    ");
    console.error(`  ${entity} [${edges.length} edges]`);
    console.error(`    ${targets}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  const openApiPath =
    process.argv[2] ||
    path.resolve(__dirname, "../../../openapi/specs/api/openapi.yaml");
  const prismaPath =
    process.argv[3] ||
    path.resolve(__dirname, "../../../api/prisma/schema.prisma");

  console.error(`Parsing OpenAPI spec: ${openApiPath}`);
  const openApiMap = parseOpenAPISpec(openApiPath);

  console.error(`Parsing Prisma schema: ${prismaPath}`);
  const prismaMap = parsePrismaSchema(prismaPath);

  const graph = detectRelationships(prismaMap, openApiMap);

  printSummary(graph);

  // Output JSON to stdout for piping
  console.log(JSON.stringify(graph, null, 2));
}

main();
