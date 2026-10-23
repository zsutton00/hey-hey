#!/usr/bin/env tsx
/**
 * OpenAPI Spec Parser for Entity Relationship Extraction
 *
 * Reads the OpenAPI YAML spec and extracts:
 *  - Endpoint-to-entity type mappings from response schemas
 *  - Nested entity relationships (full embeds, partial projections, derived scalars)
 *  - Path parameter entity references
 *  - Query parameters indicating conditional joins
 *
 * Output: a RelationshipMap JSON structure mapping entity types to their API exposures.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type {
  RelationshipMap,
  EndpointExposure,
  NestedEntityDescriptor,
  PathEntity,
} from "./types";

// ---------------------------------------------------------------------------
// OpenAPI type helpers (minimal, just enough for traversal)
// ---------------------------------------------------------------------------

interface OpenAPISpec {
  paths: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, SchemaObject> };
}

interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: { content?: Record<string, { schema?: SchemaObject }> };
  responses?: Record<string, ResponseObject>;
}

interface ParameterObject {
  name: string;
  in: string;
  schema?: SchemaObject;
  required?: boolean;
}

interface ResponseObject {
  content?: Record<string, { schema?: SchemaObject }>;
}

interface SchemaObject {
  $ref?: string;
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  required?: string[];
  nullable?: boolean;
  format?: string;
  enum?: string[];
  description?: string;
}

// ---------------------------------------------------------------------------
// YAML loading with cross-file $ref resolution
// ---------------------------------------------------------------------------

const fileCache = new Map<string, Record<string, unknown>>();

function loadYamlFile(filePath: string): Record<string, unknown> {
  const abs = path.resolve(filePath);
  if (fileCache.has(abs)) return fileCache.get(abs)!;
  const raw = fs.readFileSync(abs, "utf-8");
  const doc = yaml.load(raw) as Record<string, unknown>;
  fileCache.set(abs, doc);
  return doc;
}

/**
 * Resolve a $ref string relative to a base file path.
 * Handles:
 *  - "#/components/schemas/Foo"  (local)
 *  - "#/Foo"                     (local, schema-level files)
 *  - "./file.yaml#/Foo"          (cross-file)
 *  - "../schemas/file.yaml#/Foo" (cross-file)
 */
function resolveRef(
  ref: string,
  baseFile: string,
): { schema: SchemaObject; resolvedFile: string; refName: string } {
  const [filePart, pointer] = ref.split("#");
  const targetFile = filePart
    ? path.resolve(path.dirname(baseFile), filePart)
    : baseFile;

  const doc = loadYamlFile(targetFile);
  const segments = pointer.split("/").filter(Boolean);

  let current: unknown = doc;
  for (const seg of segments) {
    if (
      current &&
      typeof current === "object" &&
      seg in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      throw new Error(
        `Cannot resolve $ref "${ref}" — segment "${seg}" not found in ${targetFile}`,
      );
    }
  }

  const refName = segments[segments.length - 1] || "";
  return {
    schema: current as SchemaObject,
    resolvedFile: targetFile,
    refName,
  };
}

/**
 * Fully resolve a schema, following $ref chains and merging allOf.
 * Returns the resolved schema, the "leaf" ref name (the DTO name),
 * and the file where the resolved schema originates (for resolving
 * internal refs within its properties).
 */
function resolveSchema(
  schema: SchemaObject,
  baseFile: string,
  depth = 0,
): { resolved: SchemaObject; dtoName: string | null; sourceFile: string } {
  if (depth > 20) return { resolved: schema, dtoName: null, sourceFile: baseFile };

  if (schema.$ref) {
    const {
      schema: refSchema,
      resolvedFile,
      refName,
    } = resolveRef(schema.$ref, baseFile);
    const inner = resolveSchema(refSchema, resolvedFile, depth + 1);
    return {
      resolved: inner.resolved,
      dtoName: inner.dtoName ?? refName,
      sourceFile: inner.sourceFile,
    };
  }

  if (schema.allOf) {
    const merged: SchemaObject = {
      type: "object",
      properties: {},
      required: [],
    };
    let dtoName: string | null = null;
    let lastSourceFile = baseFile;
    for (const part of schema.allOf) {
      const { resolved, dtoName: partName, sourceFile } = resolveSchema(
        part,
        baseFile,
        depth + 1,
      );
      if (partName) {
        dtoName = partName;
        lastSourceFile = sourceFile;
      }
      if (resolved.properties) {
        merged.properties = { ...merged.properties, ...resolved.properties };
      }
      if (resolved.required) {
        merged.required = [...(merged.required || []), ...resolved.required];
      }
    }
    return { resolved: merged, dtoName, sourceFile: lastSourceFile };
  }

  return { resolved: schema, dtoName: null, sourceFile: baseFile };
}

// ---------------------------------------------------------------------------
// Entity name extraction heuristics
// ---------------------------------------------------------------------------

const RESPONSE_DTO_SUFFIXES = ["ResponseDto", "Dto", "Response"];

const SUMMARY_INDICATORS = ["Summary", "Ref", "Brief"];

function dtoToEntityName(dtoName: string): string | null {
  for (const suffix of RESPONSE_DTO_SUFFIXES) {
    if (dtoName.endsWith(suffix) && dtoName.length > suffix.length) {
      return dtoName.slice(0, -suffix.length);
    }
  }
  return null;
}

function isSummaryType(dtoName: string): boolean {
  return SUMMARY_INDICATORS.some((ind) => dtoName.includes(ind));
}

/**
 * Known DTO names collected during spec traversal.
 * Used to determine whether a nested object is an entity reference.
 */
const knownDtoNames = new Set<string>();

// ---------------------------------------------------------------------------
// Path parameter → entity type mapping
// ---------------------------------------------------------------------------

function extractPathEntities(pathTemplate: string): PathEntity[] {
  const paramRe = /\{(\w+)\}/g;
  const entities: PathEntity[] = [];
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(pathTemplate)) !== null) {
    const param = match[1];
    // Only consider params ending in "Id" (orgId, taskId, planId, etc.)
    if (param.endsWith("Id")) {
      const raw = param.slice(0, -2); // "orgId" → "org", "taskId" → "task"
      const entityType = raw.charAt(0).toUpperCase() + raw.slice(1);
      entities.push({ param, entityType });
    }
  }
  return entities;
}

// ---------------------------------------------------------------------------
// Conditional join detection (include* query params)
// ---------------------------------------------------------------------------

function extractConditionalParams(
  params: ParameterObject[] | undefined,
): Map<string, string> {
  const conditionals = new Map<string, string>();
  if (!params) return conditionals;
  for (const p of params) {
    if (p.in === "query" && p.name.startsWith("include")) {
      // "includeService" → "service", "includeEntities" → "entities"
      const fieldHint = p.name.slice("include".length);
      const normalized = fieldHint.charAt(0).toLowerCase() + fieldHint.slice(1);
      conditionals.set(normalized, p.name);
    }
  }
  return conditionals;
}

// ---------------------------------------------------------------------------
// Nested entity extraction from a resolved response schema
// ---------------------------------------------------------------------------

/** Well-known count field patterns */
const COUNT_FIELD_RE = /^(\w+)(Count|Counts)$/;

function extractNestedEntities(
  schema: SchemaObject,
  baseFile: string,
  conditionals: Map<string, string>,
): NestedEntityDescriptor[] {
  const results: NestedEntityDescriptor[] = [];
  if (!schema.properties) return results;

  for (const [field, propSchema] of Object.entries(schema.properties)) {
    const descriptor = analyzeProperty(
      field,
      propSchema,
      baseFile,
      conditionals,
    );
    if (descriptor) results.push(descriptor);
  }

  return results;
}

function analyzeProperty(
  field: string,
  schema: SchemaObject,
  baseFile: string,
  conditionals: Map<string, string>,
): NestedEntityDescriptor | null {
  // Skip primitive metadata fields
  if (isPrimitiveMetadata(field, schema)) return null;

  // Check for derived scalar (count fields)
  const countMatch = field.match(COUNT_FIELD_RE);
  if (countMatch) {
    return buildCountDescriptor(field, countMatch[1], conditionals);
  }

  // Check if this is a childCounts-style aggregation object
  if (field.endsWith("Counts") && !schema.$ref && schema.type === "object") {
    return buildCountDescriptor(
      field,
      field.replace("Counts", ""),
      conditionals,
    );
  }

  // Unwrap allOf wrappers (e.g. allOf: [ { $ref: "#/SomeDto" } ])
  // Common pattern for adding description to a $ref
  if (schema.allOf && !schema.$ref) {
    const refPart = schema.allOf.find((p) => p.$ref);
    if (refPart) {
      return analyzeRefProperty(field, refPart, baseFile, conditionals);
    }
  }

  // Follow $ref to see what this property points to
  if (schema.$ref) {
    return analyzeRefProperty(field, schema, baseFile, conditionals);
  }

  // Array of objects
  if (schema.type === "array" && schema.items) {
    return analyzeArrayProperty(field, schema.items, baseFile, conditionals);
  }

  // Inline object with properties — could be a nested structure
  if (schema.type === "object" && schema.properties) {
    // Check if it looks like an entity (has an "id" field)
    if (schema.properties.id) {
      const entityName = field.charAt(0).toUpperCase() + field.slice(1);
      return {
        field,
        targetEntity: entityName,
        cardinality: "one",
        isPartial: true,
        isDerived: false,
        confidence: "needs_review",
        ...resolveConditional(field, conditionals),
      };
    }
  }

  return null;
}

function analyzeRefProperty(
  field: string,
  schema: SchemaObject,
  baseFile: string,
  conditionals: Map<string, string>,
): NestedEntityDescriptor | null {
  try {
    const {
      schema: refSchema,
      resolvedFile,
      refName,
    } = resolveRef(schema.$ref!, baseFile);
    const { resolved } = resolveSchema(refSchema, resolvedFile);

    // Is this a known entity DTO?
    const entityName = dtoToEntityName(refName);
    if (entityName) {
      const isPartial = isSummaryType(refName);
      return {
        field,
        targetEntity: entityName,
        cardinality: "one",
        isPartial,
        isDerived: false,
        confidence: isPartial ? "medium" : "high",
        ...resolveConditional(field, conditionals),
      };
    }

    // Is it a non-DTO object with an "id" field? (summary/ref pattern)
    if (resolved.properties?.id) {
      const entityGuess = refName.replace(/Summary$|Ref$|Brief$/, "");
      const isSummary = refName !== entityGuess;
      return {
        field,
        targetEntity: entityGuess,
        cardinality: "one",
        isPartial: isSummary,
        isDerived: false,
        confidence: isSummary ? "medium" : "needs_review",
        ...resolveConditional(field, conditionals),
      };
    }

    // Enum or scalar ref — skip
    if (resolved.enum || (resolved.type && resolved.type !== "object")) {
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

function analyzeArrayProperty(
  field: string,
  itemsSchema: SchemaObject,
  baseFile: string,
  conditionals: Map<string, string>,
): NestedEntityDescriptor | null {
  if (itemsSchema.$ref) {
    try {
      const { refName } = resolveRef(itemsSchema.$ref, baseFile);
      const entityName = dtoToEntityName(refName);
      if (entityName) {
        const isPartial = isSummaryType(refName);
        return {
          field,
          targetEntity: entityName,
          cardinality: "many",
          isPartial,
          isDerived: false,
          confidence: isPartial ? "medium" : "high",
          ...resolveConditional(field, conditionals),
        };
      }
      // Non-DTO array item with an "id" — treat as entity
      const { schema: refSchema, resolvedFile } = resolveRef(
        itemsSchema.$ref,
        baseFile,
      );
      const { resolved } = resolveSchema(refSchema, resolvedFile);
      if (resolved.properties?.id) {
        const entityGuess = refName.replace(/Summary$|Ref$|Brief$/, "");
        return {
          field,
          targetEntity: entityGuess,
          cardinality: "many",
          isPartial: isSummaryType(refName),
          isDerived: false,
          confidence: "medium",
          ...resolveConditional(field, conditionals),
        };
      }
    } catch {
      // skip unresolvable
    }
  }

  // Inline array of objects with id
  if (itemsSchema.type === "object" && itemsSchema.properties?.id) {
    const entityName = field.charAt(0).toUpperCase() + field.slice(1);
    return {
      field,
      targetEntity: entityName,
      cardinality: "many",
      isPartial: true,
      isDerived: false,
      confidence: "needs_review",
      ...resolveConditional(field, conditionals),
    };
  }

  return null;
}

function buildCountDescriptor(
  field: string,
  entityHint: string,
  conditionals: Map<string, string>,
): NestedEntityDescriptor {
  // Try to map "designDoc" → "DesignDoc", "codingSession" → "CodingSession", etc.
  const targetEntity = entityHint.charAt(0).toUpperCase() + entityHint.slice(1);
  // Count fields pointing to "child" typically mean self-referential
  const isSelfRef = entityHint === "child" || entityHint === "children";
  return {
    field,
    targetEntity: isSelfRef ? "Self" : targetEntity,
    cardinality: "scalar",
    isPartial: false,
    isDerived: true,
    confidence: isSelfRef ? "medium" : "needs_review",
    ...resolveConditional(field, conditionals),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConditional(
  field: string,
  conditionals: Map<string, string>,
): { conditional?: string } {
  // Check exact match: field "service" → conditional "includeService"
  const exact = conditionals.get(field);
  if (exact) return { conditional: exact };

  // Check plural/singular variants
  const singular = field.endsWith("s") ? field.slice(0, -1) : field;
  const plural = field.endsWith("s") ? field : field + "s";

  for (const [hint, param] of conditionals) {
    if (
      hint === singular ||
      hint === plural ||
      hint.toLowerCase() === field.toLowerCase() ||
      field.toLowerCase().startsWith(hint.toLowerCase())
    ) {
      return { conditional: param };
    }
  }
  return {};
}

const PRIMITIVE_FIELDS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "title",
  "name",
  "description",
  "status",
  "type",
  "priority",
  "order",
  "isPublic",
  "content",
]);

function isPrimitiveMetadata(field: string, schema: SchemaObject): boolean {
  if (PRIMITIVE_FIELDS.has(field)) return true;
  // Fields that are just IDs referencing parents are handled as path entities
  if (
    field.endsWith("Id") &&
    !schema.$ref &&
    (schema.type === "string" || schema.format)
  ) {
    return true;
  }
  // Simple string/number/boolean scalars
  if (
    !schema.$ref &&
    !schema.items &&
    !schema.properties &&
    !schema.allOf &&
    !schema.oneOf &&
    !schema.anyOf
  ) {
    const t = schema.type;
    if (
      t === "string" ||
      t === "number" ||
      t === "integer" ||
      t === "boolean"
    ) {
      // But not count fields — those are handled separately
      if (COUNT_FIELD_RE.test(field)) return false;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Response schema extraction from an operation
// ---------------------------------------------------------------------------

function extractResponseDto(
  operation: OperationObject,
  specFile: string,
): { dtoName: string; schema: SchemaObject; resolvedFile: string } | null {
  // Look for 200 or 201 response
  const successCodes = ["200", "201"];
  for (const code of successCodes) {
    const resp = operation.responses?.[code];
    if (!resp?.content) continue;

    const jsonContent = resp.content["application/json"] || resp.content["*/*"];
    if (!jsonContent?.schema) continue;

    const responseSchema = jsonContent.schema;

    // Handle ApiResponse wrapper: allOf [ ApiResponse, { properties: { data: <actual> } } ]
    if (responseSchema.allOf) {
      for (const part of responseSchema.allOf) {
        const { resolved } = resolveSchema(part, specFile);
        if (resolved.properties?.data) {
          const dataProp = resolved.properties.data;
          if (dataProp.$ref) {
            const { schema, resolvedFile, refName } = resolveRef(
              dataProp.$ref,
              specFile,
            );
            return { dtoName: refName, schema, resolvedFile };
          }
          // Inline data with items (array response)
          if (dataProp.type === "array" && dataProp.items?.$ref) {
            const { schema, resolvedFile, refName } = resolveRef(
              dataProp.items.$ref,
              specFile,
            );
            return { dtoName: refName, schema, resolvedFile };
          }
          // Inline data object
          if (dataProp.type === "object" || dataProp.properties) {
            return {
              dtoName: "InlineResponse",
              schema: dataProp,
              resolvedFile: specFile,
            };
          }
        }
      }
    }

    // Direct $ref response
    if (responseSchema.$ref) {
      const { schema, resolvedFile, refName } = resolveRef(
        responseSchema.$ref,
        specFile,
      );
      return { dtoName: refName, schema, resolvedFile };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseOpenAPISpec(specPath: string): RelationshipMap {
  const absPath = path.resolve(specPath);
  const spec = loadYamlFile(absPath) as unknown as OpenAPISpec;

  if (!spec.paths) {
    throw new Error(`No paths found in OpenAPI spec at ${specPath}`);
  }

  // First pass: collect all known DTO names from components/schemas
  if (spec.components?.schemas) {
    for (const name of Object.keys(spec.components.schemas)) {
      knownDtoNames.add(name);
    }
  }

  const relationshipMap: RelationshipMap = {};

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
    const methods = ["get", "post", "put", "patch", "delete"] as const;
    for (const method of methods) {
      const operation = pathItem[method] as OperationObject | undefined;
      if (!operation) continue;

      const result = extractResponseDto(operation, absPath);
      if (!result) continue;

      const { dtoName, schema: rawSchema, resolvedFile } = result;
      const entityName = dtoToEntityName(dtoName);
      if (!entityName) continue;

      // Skip pagination wrappers — look inside for the actual entity
      const { resolved, sourceFile } = resolveSchema(rawSchema, resolvedFile);

      // Extract conditional join params
      const conditionals = extractConditionalParams(operation.parameters);

      // Extract path entities
      const pathEntities = extractPathEntities(pathTemplate);

      // Extract nested entities from resolved response schema
      // Use sourceFile (where the schema originates) for resolving internal refs
      const nestedEntities = extractNestedEntities(
        resolved,
        sourceFile,
        conditionals,
      );

      const exposure: EndpointExposure = {
        endpoint: `${method.toUpperCase()} ${pathTemplate}`,
        method: method.toUpperCase(),
        path: pathTemplate,
        responseDto: dtoName,
        pathEntities,
        nestedEntities,
      };

      if (!relationshipMap[entityName]) {
        relationshipMap[entityName] = { apiExposures: [] };
      }
      relationshipMap[entityName].apiExposures.push(exposure);
    }
  }

  return relationshipMap;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  const specPath =
    process.argv[2] ||
    path.resolve(__dirname, "../../../openapi/specs/api/openapi.yaml");

  if (!fs.existsSync(specPath)) {
    console.error(`OpenAPI spec not found at: ${specPath}`);
    process.exit(1);
  }

  console.error(`Parsing OpenAPI spec: ${specPath}`);
  const result = parseOpenAPISpec(specPath);

  const entityCount = Object.keys(result).length;
  const exposureCount = Object.values(result).reduce(
    (sum, e) => sum + e.apiExposures.length,
    0,
  );
  const nestedCount = Object.values(result).reduce(
    (sum, e) =>
      sum + e.apiExposures.reduce((s, ex) => s + ex.nestedEntities.length, 0),
    0,
  );

  console.error(
    `Found ${entityCount} entity types, ${exposureCount} endpoint exposures, ${nestedCount} nested entity relationships`,
  );

  // Output JSON to stdout for piping
  console.log(JSON.stringify(result, null, 2));
}

// Only run when executed directly, not when imported
const isDirectRun =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main();
}
