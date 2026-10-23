/**
 * Serialization module: transforms a UnifiedRelationshipGraph into a
 * deduplicated RelationshipConfig suitable for the data layer.
 *
 * Deduplication strategy:
 *   Per-endpoint occurrences of the same relationship (same source,
 *   target, and field) are collapsed into a single config entry.
 *   Conditional query parameters from all endpoints are merged into
 *   a single sorted array on the deduplicated entry.
 *
 * Determinism:
 *   Entity keys and relationship entries are sorted alphabetically
 *   so re-running with unchanged inputs produces identical output.
 */

import type {
  Confidence,
  DetectionSource,
  RelationshipTier,
  UnifiedRelationshipEdge,
  UnifiedRelationshipGraph,
} from "./types";
import type {
  ConfigRelationshipEntry,
  RelationshipConfig,
} from "./config-types";

/** Stable key for deduplicating edges across endpoints (within one source entity). */
function dedupeKey(edge: UnifiedRelationshipEdge): string {
  return `${edge.targetEntity}::${edge.field}::${edge.tier}`;
}

/**
 * Stable key for looking up prior annotations.
 * Includes the source entity so the map spans the full config.
 */
export function annotationKey(
  sourceEntity: string,
  targetEntity: string,
  field: string,
  tier: string,
): string {
  return `${sourceEntity}::${targetEntity}::${field}::${tier}`;
}

/** Merge a new edge into an existing deduplicated entry. */
function mergeInto(
  entry: ConfigRelationshipEntry,
  edge: UnifiedRelationshipEdge,
): void {
  // Merge conditional parameters (sorting deferred to sortEntries)
  if (edge.conditional && !entry.conditionals.includes(edge.conditional)) {
    entry.conditionals.push(edge.conditional);
  }

  // Promote confidence: high > medium > needs_review
  const rank: Record<Confidence, number> = {
    high: 2,
    medium: 1,
    needs_review: 0,
  };
  if (rank[edge.confidence] > rank[entry.confidence]) {
    entry.confidence = edge.confidence;
  }

  // Promote detectedBy to "both" if sources differ
  if (entry.detectedBy !== edge.detectedBy) {
    entry.detectedBy = "both";
  }

  // Carry prismaDetail if we didn't have it yet
  if (!entry.prismaDetail && edge.prismaDetail) {
    entry.prismaDetail = { ...edge.prismaDetail };
  }

  // Update needsReview based on final confidence
  entry.needsReview = entry.confidence === "needs_review";
}

/** Convert a single edge into a fresh config entry. */
function edgeToEntry(
  edge: UnifiedRelationshipEdge,
): ConfigRelationshipEntry {
  const entry: ConfigRelationshipEntry = {
    targetEntity: edge.targetEntity,
    field: edge.field,
    tier: edge.tier,
    cardinality: edge.cardinality,
    isPartial: edge.isPartial,
    isSelfRelation: edge.isSelfRelation,
    conditionals: edge.conditional ? [edge.conditional] : [],
    confidence: edge.confidence,
    detectedBy: edge.detectedBy,
    needsReview: edge.confidence === "needs_review",
  };

  if (edge.originalTargetEntity) {
    entry.originalTargetEntity = edge.originalTargetEntity;
  }

  if (edge.prismaDetail) {
    entry.prismaDetail = { ...edge.prismaDetail };
  }

  return entry;
}

/**
 * Sort entries deterministically by target, then field, then tier.
 * Also finalizes conditional parameter sorting deferred from mergeInto.
 */
function sortEntries(
  entries: ConfigRelationshipEntry[],
): ConfigRelationshipEntry[] {
  for (const entry of entries) {
    entry.conditionals.sort();
  }
  return entries.sort((a, b) => {
    const cmp1 = a.targetEntity.localeCompare(b.targetEntity);
    if (cmp1 !== 0) return cmp1;
    const cmp2 = a.field.localeCompare(b.field);
    if (cmp2 !== 0) return cmp2;
    return a.tier.localeCompare(b.tier);
  });
}

/**
 * Serialize a unified relationship graph into a deterministic
 * configuration file structure.
 *
 * @param priorAnnotations - Notes extracted from a previous config run,
 *   keyed by annotationKey(). Matching entries have their note preserved.
 */
export function serializeConfig(
  graph: UnifiedRelationshipGraph,
  sources: { openapi: string; prisma: string },
  generatedAt?: string,
  priorAnnotations?: Map<string, string>,
): RelationshipConfig {
  const entities: Record<string, ConfigRelationshipEntry[]> = {};

  // Deduplicate per entity
  for (const sourceEntity of Object.keys(graph)) {
    const edges = graph[sourceEntity];
    const deduped = new Map<string, ConfigRelationshipEntry>();

    for (const edge of edges) {
      const key = dedupeKey(edge);
      const existing = deduped.get(key);

      if (existing) {
        mergeInto(existing, edge);
      } else {
        deduped.set(key, edgeToEntry(edge));
      }
    }

    const entries = sortEntries([...deduped.values()]);

    // Re-attach prior notes after deduplication and sorting
    if (priorAnnotations) {
      for (const entry of entries) {
        const key = annotationKey(
          sourceEntity,
          entry.targetEntity,
          entry.field,
          entry.tier,
        );
        const note = priorAnnotations.get(key);
        if (note !== undefined) {
          entry.note = note;
        }
      }
    }

    entities[sourceEntity] = entries;
  }

  // Sort entity keys for determinism
  const sortedEntities: Record<string, ConfigRelationshipEntry[]> = {};
  for (const key of Object.keys(entities).sort()) {
    sortedEntities[key] = entities[key];
  }

  // Build summary
  const byTier: Record<RelationshipTier, number> = {
    id_reference: 0,
    entity_embed: 0,
    derived_scalar: 0,
  };
  const byConfidence: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    needs_review: 0,
  };
  const byDetectionSource: Record<DetectionSource, number> = {
    prisma: 0,
    openapi: 0,
    both: 0,
  };
  let relationshipCount = 0;
  let needsReviewCount = 0;

  for (const entries of Object.values(sortedEntities)) {
    for (const entry of entries) {
      relationshipCount++;
      byTier[entry.tier]++;
      byConfidence[entry.confidence]++;
      byDetectionSource[entry.detectedBy]++;
      if (entry.needsReview) needsReviewCount++;
    }
  }

  return {
    version: 1,
    generatedAt: generatedAt ?? new Date().toISOString(),
    sources,
    summary: {
      entityCount: Object.keys(sortedEntities).length,
      relationshipCount,
      needsReviewCount,
      byTier,
      byConfidence,
      byDetectionSource,
    },
    entities: sortedEntities,
  };
}
