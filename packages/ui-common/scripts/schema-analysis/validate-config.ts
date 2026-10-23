/**
 * Configuration validation module.
 *
 * Compares a newly generated RelationshipConfig against a previous
 * committed version and produces a structured diff report that
 * identifies removed relationships, type mismatches, and potential
 * breaking changes.
 */

import type {
  ConfigRelationshipEntry,
  RelationshipConfig,
} from "./config-types";
import type {
  DiffEntry,
  DiffSeverity,
  ValidationReport,
  ValidationSummary,
} from "./validate-config-types";

/**
 * Stable key for matching relationship entries across config versions.
 * Mirrors the deduplication key used in serialize-config.ts.
 */
function entryKey(entry: ConfigRelationshipEntry): string {
  return `${entry.targetEntity}::${entry.field}::${entry.tier}`;
}

/**
 * Looser key for matching entries that may have changed tier.
 * Used to detect tier changes that would otherwise appear as remove + add.
 */
function fieldKey(entry: ConfigRelationshipEntry): string {
  return `${entry.targetEntity}::${entry.field}`;
}

/** Index entries by their stable key for O(1) lookup. */
function indexEntries(
  entries: ConfigRelationshipEntry[],
): Map<string, ConfigRelationshipEntry> {
  const map = new Map<string, ConfigRelationshipEntry>();
  for (const entry of entries) {
    map.set(entryKey(entry), entry);
  }
  return map;
}

/** Index entries by field key (without tier) for cross-tier matching. */
function indexByField(
  entries: ConfigRelationshipEntry[],
): Map<string, ConfigRelationshipEntry[]> {
  const map = new Map<string, ConfigRelationshipEntry[]>();
  for (const entry of entries) {
    const fk = fieldKey(entry);
    const group = map.get(fk);
    if (group) {
      group.push(entry);
    } else {
      map.set(fk, [entry]);
    }
  }
  return map;
}

/** Severity ordering for sorting: breaking > warning > info. */
const SEVERITY_ORDER: Record<DiffSeverity, number> = {
  breaking: 0,
  warning: 1,
  info: 2,
};

/**
 * Detect differences in individual relationship entry fields
 * between the previous and new version of the same relationship.
 */
function diffEntry(
  entity: string,
  prev: ConfigRelationshipEntry,
  next: ConfigRelationshipEntry,
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const base = {
    entity,
    field: prev.field,
    targetEntity: prev.targetEntity,
    tier: prev.tier,
  };

  // Cardinality change
  if (prev.cardinality !== next.cardinality) {
    const isNarrowing =
      prev.cardinality === "one-to-many" &&
      next.cardinality === "one-to-one";
    diffs.push({
      ...base,
      kind: "cardinality_change",
      severity: isNarrowing ? "breaking" : "warning",
      message:
        `Cardinality changed from "${prev.cardinality}" to ` +
        `"${next.cardinality}" on ${entity}.${prev.field} → ` +
        `${prev.targetEntity}`,
      previousValue: prev.cardinality,
      newValue: next.cardinality,
    });
  }

  // Tier change
  if (prev.tier !== next.tier) {
    diffs.push({
      ...base,
      tier: next.tier,
      kind: "tier_change",
      severity: "warning",
      message:
        `Tier changed from "${prev.tier}" to "${next.tier}" on ` +
        `${entity}.${prev.field} → ${prev.targetEntity}`,
      previousValue: prev.tier,
      newValue: next.tier,
    });
  }

  // Required ↔ optional transition (prismaDetail)
  const prevRequired = prev.prismaDetail?.isRequired;
  const nextRequired = next.prismaDetail?.isRequired;
  if (
    prevRequired !== undefined &&
    nextRequired !== undefined &&
    prevRequired !== nextRequired
  ) {
    const becameOptional = prevRequired && !nextRequired;
    diffs.push({
      ...base,
      kind: "required_change",
      severity: becameOptional ? "breaking" : "warning",
      message: becameOptional
        ? `Required field became optional: ${entity}.${prev.field} → ${prev.targetEntity}`
        : `Optional field became required: ${entity}.${prev.field} → ${prev.targetEntity}`,
      previousValue: prevRequired ? "required" : "optional",
      newValue: nextRequired ? "required" : "optional",
    });
  }

  // Confidence downgrade
  const CONFIDENCE_RANK = { high: 2, medium: 1, needs_review: 0 } as const;
  if (
    CONFIDENCE_RANK[next.confidence] < CONFIDENCE_RANK[prev.confidence]
  ) {
    diffs.push({
      ...base,
      kind: "confidence_change",
      severity: "info",
      message:
        `Confidence downgraded from "${prev.confidence}" to ` +
        `"${next.confidence}" on ${entity}.${prev.field} → ` +
        `${prev.targetEntity}`,
      previousValue: prev.confidence,
      newValue: next.confidence,
    });
  }

  return diffs;
}

/**
 * Compare two RelationshipConfig objects and produce a ValidationReport.
 */
export function validateConfig(
  previous: RelationshipConfig,
  next: RelationshipConfig,
): ValidationReport {
  const entries: DiffEntry[] = [];

  const prevEntities = new Set(Object.keys(previous.entities));
  const nextEntities = new Set(Object.keys(next.entities));

  // Removed entities
  for (const entity of prevEntities) {
    if (!nextEntities.has(entity)) {
      const relCount = previous.entities[entity].length;
      entries.push({
        kind: "removed_entity",
        severity: "breaking",
        entity,
        message:
          `Entity "${entity}" removed (had ${relCount} ` +
          `relationship${relCount === 1 ? "" : "s"})`,
      });
    }
  }

  // Added entities
  for (const entity of nextEntities) {
    if (!prevEntities.has(entity)) {
      const relCount = next.entities[entity].length;
      entries.push({
        kind: "added_entity",
        severity: "info",
        entity,
        message:
          `Entity "${entity}" added (${relCount} ` +
          `relationship${relCount === 1 ? "" : "s"})`,
      });
    }
  }

  // Shared entities — compare relationships
  for (const entity of prevEntities) {
    if (!nextEntities.has(entity)) continue;

    const prevIndex = indexEntries(previous.entities[entity]);
    const nextIndex = indexEntries(next.entities[entity]);
    const prevByField = indexByField(previous.entities[entity]);
    const nextByField = indexByField(next.entities[entity]);

    // Track keys that matched cross-tier (tier changed)
    const crossTierMatched = new Set<string>();

    // Exact matches — compare fields on matching entries
    for (const [key, prevEntry] of prevIndex) {
      const nextEntry = nextIndex.get(key);
      if (!nextEntry) continue;
      entries.push(...diffEntry(entity, prevEntry, nextEntry));
    }

    // Unmatched previous entries: check for cross-tier match before
    // reporting as removed
    for (const [key, prevEntry] of prevIndex) {
      if (nextIndex.has(key)) continue;

      const fk = fieldKey(prevEntry);
      const nextCandidates = nextByField.get(fk) ?? [];
      // Find a next entry with the same target+field but different tier
      // that isn't already an exact match in the previous config
      const crossMatch = nextCandidates.find(
        (c) => !prevIndex.has(entryKey(c)),
      );
      if (crossMatch) {
        crossTierMatched.add(entryKey(crossMatch));
        entries.push(...diffEntry(entity, prevEntry, crossMatch));
      } else {
        entries.push({
          kind: "removed_relationship",
          severity: "breaking",
          entity,
          field: prevEntry.field,
          targetEntity: prevEntry.targetEntity,
          tier: prevEntry.tier,
          message:
            `Relationship removed: ${entity}.${prevEntry.field} → ` +
            `${prevEntry.targetEntity} (${prevEntry.tier})`,
        });
      }
    }

    // Unmatched new entries: skip cross-tier matches already reported
    for (const [key, nextEntry] of nextIndex) {
      if (prevIndex.has(key)) continue;
      if (crossTierMatched.has(key)) continue;

      entries.push({
        kind: "added_relationship",
        severity: "info",
        entity,
        field: nextEntry.field,
        targetEntity: nextEntry.targetEntity,
        tier: nextEntry.tier,
        message:
          `Relationship added: ${entity}.${nextEntry.field} → ` +
          `${nextEntry.targetEntity} (${nextEntry.tier})`,
      });
    }
  }

  // Sort by severity (breaking first), then entity, then field
  entries.sort((a, b) => {
    const sevCmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevCmp !== 0) return sevCmp;
    const entCmp = a.entity.localeCompare(b.entity);
    if (entCmp !== 0) return entCmp;
    return (a.field ?? "").localeCompare(b.field ?? "");
  });

  const summary = buildSummary(entries);

  return {
    validatedAt: new Date().toISOString(),
    isClean: summary.breaking === 0,
    summary,
    entries,
  };
}

/** Aggregate counts from diff entries. */
function buildSummary(entries: DiffEntry[]): ValidationSummary {
  const summary: ValidationSummary = {
    totalChanges: entries.length,
    breaking: 0,
    warning: 0,
    info: 0,
    removedEntities: 0,
    addedEntities: 0,
    removedRelationships: 0,
    addedRelationships: 0,
    typeChanges: 0,
  };

  for (const entry of entries) {
    summary[entry.severity]++;
    switch (entry.kind) {
      case "removed_entity":
        summary.removedEntities++;
        break;
      case "added_entity":
        summary.addedEntities++;
        break;
      case "removed_relationship":
        summary.removedRelationships++;
        break;
      case "added_relationship":
        summary.addedRelationships++;
        break;
      case "cardinality_change":
      case "tier_change":
      case "required_change":
      case "confidence_change":
        summary.typeChanges++;
        break;
    }
  }

  return summary;
}
