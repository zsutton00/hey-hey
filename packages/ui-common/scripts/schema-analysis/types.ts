/**
 * Output types for the schema analysis parsers (OpenAPI + Prisma).
 *
 * Aligns with the RelationshipMap interface from the
 * Schema Analysis & Relationship Detection Design doc.
 */

export type Cardinality = "one" | "many" | "scalar";
export type Confidence = "high" | "medium" | "needs_review";

export interface NestedEntityDescriptor {
  /** Field name on the parent DTO (e.g. "messages", "service", "childrenCount") */
  field: string;
  /** Target entity type derived from the referenced DTO (e.g. "Message", "Service") */
  targetEntity: string;
  /** Relationship cardinality */
  cardinality: Cardinality;
  /** True when the nested object is a projected subset (summary/ref type) */
  isPartial: boolean;
  /** True for derived scalar fields like counts */
  isDerived: boolean;
  /** Query parameter that triggers inclusion, if conditional (e.g. "includeService") */
  conditional?: string;
  /** Detection confidence */
  confidence: Confidence;
}

export interface EndpointExposure {
  /** HTTP method + path (e.g. "GET /organizations/{orgId}/tasks/{id}") */
  endpoint: string;
  /** HTTP method */
  method: string;
  /** Path template */
  path: string;
  /** The top-level response DTO name */
  responseDto: string;
  /** Entity type IDs extracted from path parameters */
  pathEntities: PathEntity[];
  /** Nested entity relationships found in the response schema */
  nestedEntities: NestedEntityDescriptor[];
}

export interface PathEntity {
  /** Parameter name (e.g. "taskId", "orgId") */
  param: string;
  /** Inferred entity type (e.g. "Task", "Organization") */
  entityType: string;
}

export interface EntityExposure {
  /** What endpoints actually expose for this entity */
  apiExposures: EndpointExposure[];
}

/**
 * Top-level parser output: maps entity type names to their API exposures.
 *
 * Keys are entity type names derived from response DTO names
 * (e.g. "Task" from "TaskResponseDto", "Conversation" from "ConversationResponseDto").
 */
export type RelationshipMap = Record<string, EntityExposure>;

// ---------------------------------------------------------------------------
// Prisma schema parser types
// ---------------------------------------------------------------------------

export type PrismaCardinality = "1:1" | "1:many" | "many:many";

export interface PrismaFieldDescriptor {
  /** Field name as declared in the model (e.g. "organizationId", "messages") */
  name: string;
  /** Raw Prisma type (e.g. "String", "Int", "Organization", "Message[]") */
  type: string;
  /** True when the field is a list (e.g. Message[]) */
  isList: boolean;
  /** True when the field is optional (? modifier) */
  isOptional: boolean;
  /** True when this field is an @id or part of @@id */
  isId: boolean;
  /** True when this field has @unique or is part of a @@unique */
  isUnique: boolean;
  /** True when this field references another model (relation field) */
  isRelation: boolean;
  /** @default value if present */
  defaultValue?: string;
  /** @map column name if different from field name */
  mappedName?: string;
}

export interface PrismaRelation {
  /** Target model name (e.g. "Message", "Task") */
  target: string;
  /** Relationship cardinality */
  type: PrismaCardinality;
  /** Field name on this model that holds the relation (e.g. "messages", "parentTask") */
  field: string;
  /** Foreign key field(s) on this model, if this is the owning side */
  foreignKeyFields?: string[];
  /** Whether this is a self-referential relationship */
  isSelfRelation: boolean;
  /** Whether the relation field is required (non-optional) */
  isRequired: boolean;
  /** Named relation label from @relation("Name") if present */
  relationName?: string;
}

export interface PrismaIndex {
  /** Fields included in the index */
  fields: string[];
  /** True if this is a @@unique constraint */
  isUnique: boolean;
  /** Custom index name from map parameter */
  mappedName?: string;
}

export interface PrismaModel {
  /** Model name as declared (e.g. "User", "Task") */
  name: string;
  /** Database table name from @@map, if different */
  tableName?: string;
  /** All fields on the model */
  fields: PrismaFieldDescriptor[];
  /** Detected relationships to other models */
  relations: PrismaRelation[];
  /** Indexes declared with @@index */
  indexes: PrismaIndex[];
  /** Unique constraints declared with @@unique */
  uniqueConstraints: PrismaIndex[];
}

/**
 * Top-level Prisma parser output: maps model names to their parsed definitions.
 *
 * Keys are model names as declared in the Prisma schema
 * (e.g. "Task", "Conversation", "User").
 */
export type PrismaSchemaMap = Record<string, PrismaModel>;

// ---------------------------------------------------------------------------
// Unified relationship graph types (relationship detection algorithm output)
// ---------------------------------------------------------------------------

/** Which tier a detected relationship falls into */
export type RelationshipTier =
  | "id_reference"
  | "entity_embed"
  | "derived_scalar";

/** Unified cardinality across both parser outputs */
export type UnifiedCardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-many"
  | "scalar";

/** Which parser(s) detected a relationship */
export type DetectionSource = "prisma" | "openapi" | "both";

/** A single edge in the unified relationship graph */
export interface UnifiedRelationshipEdge {
  /** Source entity type (e.g. "Task") */
  sourceEntity: string;
  /** Target entity type — canonical Prisma model name when resolved */
  targetEntity: string;
  /** Original OpenAPI DTO-derived name before resolution (set only when
   *  the target was rewritten to match a Prisma model) */
  originalTargetEntity?: string;
  /** Field name on the source entity */
  field: string;
  /** Relationship classification tier */
  tier: RelationshipTier;
  /** Unified cardinality */
  cardinality: UnifiedCardinality;
  /** True when the nested object is a projected subset */
  isPartial: boolean;
  /** True for self-referential relationships (e.g. Task→Task) */
  isSelfRelation: boolean;
  /** Query parameter that triggers conditional inclusion */
  conditional?: string;
  /** Detection confidence — boosted to "high" when both parsers agree */
  confidence: Confidence;
  /** Which parser(s) contributed to this edge */
  detectedBy: DetectionSource;
  /** The endpoint where this relationship was observed (OpenAPI only) */
  endpoint?: string;
  /** Prisma relation metadata when available */
  prismaDetail?: {
    prismaCardinality: PrismaCardinality;
    foreignKeyFields?: string[];
    isRequired: boolean;
    relationName?: string;
  };
}

/**
 * Unified relationship graph keyed by source entity type.
 *
 * Each key maps to an array of edges describing that entity's
 * relationships to other entity types.
 */
export type UnifiedRelationshipGraph = Record<
  string,
  UnifiedRelationshipEdge[]
>;
