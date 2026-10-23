/**
 * Types for configuration validation — comparing a newly generated
 * RelationshipConfig against a previous committed version to detect
 * removed relationships, type mismatches, and breaking changes.
 */

import type { RelationshipTier } from "./types";

/** Classification of a detected difference. */
export type DiffKind =
  | "removed_entity"
  | "added_entity"
  | "removed_relationship"
  | "added_relationship"
  | "cardinality_change"
  | "tier_change"
  | "required_change"
  | "confidence_change";

/** How serious a diff entry is for downstream consumers. */
export type DiffSeverity = "breaking" | "warning" | "info";

/** A single difference detected between two config versions. */
export interface DiffEntry {
  kind: DiffKind;
  severity: DiffSeverity;
  /** Source entity where the change was detected */
  entity: string;
  /** Field path on the entity (omitted for entity-level changes) */
  field?: string;
  /** Target entity of the relationship (omitted for entity-level changes) */
  targetEntity?: string;
  /** Relationship tier (when applicable) */
  tier?: RelationshipTier;
  /** Human-readable description of the change */
  message: string;
  /** Previous value (for type-mismatch / change entries) */
  previousValue?: string;
  /** New value (for type-mismatch / change entries) */
  newValue?: string;
}

/** Summary counts for a validation report. */
export interface ValidationSummary {
  totalChanges: number;
  breaking: number;
  warning: number;
  info: number;
  removedEntities: number;
  addedEntities: number;
  removedRelationships: number;
  addedRelationships: number;
  typeChanges: number;
}

/** Top-level validation report comparing two config versions. */
export interface ValidationReport {
  /** ISO 8601 timestamp of when validation was run */
  validatedAt: string;
  /** Path to the previous config (if known) */
  previousSource?: string;
  /** Path to the new config (if known) */
  newSource?: string;
  /** True when no breaking changes were detected */
  isClean: boolean;
  /** Aggregate counts */
  summary: ValidationSummary;
  /** All detected differences, ordered by severity (breaking first) */
  entries: DiffEntry[];
}
