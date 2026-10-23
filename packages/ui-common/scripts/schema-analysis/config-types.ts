/**
 * Types for the generated relationship configuration file.
 *
 * The configuration is the serialized, deduplicated output of the
 * schema analysis pipeline, suitable for consumption by the data
 * layer's cache invalidation system.
 */

import type {
  Confidence,
  DetectionSource,
  RelationshipTier,
  UnifiedCardinality,
} from "./types";

/** A single deduplicated relationship entry in the configuration. */
export interface ConfigRelationshipEntry {
  /** Target entity — canonical Prisma model name when resolved */
  targetEntity: string;
  /** Original DTO-derived name before resolution (traceability) */
  originalTargetEntity?: string;
  /** Field name on the source entity */
  field: string;
  /** Relationship classification tier */
  tier: RelationshipTier;
  /** Unified cardinality */
  cardinality: UnifiedCardinality;
  /** True when the nested object is a projected subset */
  isPartial: boolean;
  /** True for self-referential relationships */
  isSelfRelation: boolean;
  /**
   * Merged conditional query parameters across all endpoints
   * where this relationship was observed.
   */
  conditionals: string[];
  /** Detection confidence — boosted when both parsers agree */
  confidence: Confidence;
  /** Which parser(s) contributed to this entry */
  detectedBy: DetectionSource;
  /** Prisma relation metadata when available */
  prismaDetail?: {
    prismaCardinality: string;
    foreignKeyFields?: string[];
    isRequired: boolean;
    relationName?: string;
  };
  /**
   * When true, this entry requires manual developer review.
   * Set for entries with low detection confidence.
   */
  needsReview: boolean;
  /**
   * Optional developer annotation for this relationship.
   * Written manually and preserved across regeneration runs.
   */
  note?: string;
}

/** Top-level configuration file structure. */
export interface RelationshipConfig {
  /** Schema version for forward compatibility */
  version: 1;
  /** ISO 8601 timestamp of generation */
  generatedAt: string;
  /** Source file paths used for generation */
  sources: {
    openapi: string;
    prisma: string;
  };
  /** Summary statistics */
  summary: {
    entityCount: number;
    relationshipCount: number;
    needsReviewCount: number;
    byTier: Record<RelationshipTier, number>;
    byConfidence: Record<Confidence, number>;
    byDetectionSource: Record<DetectionSource, number>;
  };
  /**
   * Entity relationship graph keyed by source entity.
   * Each key maps to deduplicated relationship entries.
   */
  entities: Record<string, ConfigRelationshipEntry[]>;
}
