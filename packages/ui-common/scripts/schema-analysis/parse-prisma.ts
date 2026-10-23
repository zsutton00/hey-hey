#!/usr/bin/env tsx
/**
 * Prisma Schema Parser for Entity Relationship Extraction
 *
 * Reads a Prisma schema file and extracts:
 *  - Model definitions with field names and types
 *  - Foreign key relationships via @relation directives
 *  - Relationship cardinality (1:1, 1:many, many:many)
 *  - Self-referential relationships
 *  - Indexes and unique constraints
 *
 * Output: a PrismaSchemaMap JSON structure mapping model names to their definitions.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import type {
  PrismaSchemaMap,
  PrismaModel,
  PrismaFieldDescriptor,
  PrismaRelation,
  PrismaIndex,
  PrismaCardinality,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Raw parsed structures (before relation resolution)
// ---------------------------------------------------------------------------

interface RawField {
  name: string;
  type: string;
  isList: boolean;
  isOptional: boolean;
  attributes: string[];
  fullLine: string;
}

interface RawModel {
  name: string;
  fields: RawField[];
  blockAttributes: string[];
}

// ---------------------------------------------------------------------------
// Schema file tokenization
// ---------------------------------------------------------------------------

function readSchema(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    console.error(`Prisma schema not found at: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Extract all `model Foo { ... }` blocks from the schema text.
 */
function extractModelBlocks(schema: string): RawModel[] {
  const models: RawModel[] = [];
  const lines = schema.split("\n");

  let currentModel: RawModel | null = null;
  let braceDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (line.startsWith("//") || line.startsWith("///") || line === "") {
      continue;
    }

    // Detect model start
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = {
        name: modelMatch[1],
        fields: [],
        blockAttributes: [],
      };
      braceDepth = 1;
      continue;
    }

    if (!currentModel) continue;

    // Track brace depth
    if (line === "{") {
      braceDepth++;
      continue;
    }
    if (line === "}" || line.startsWith("}")) {
      braceDepth--;
      if (braceDepth === 0) {
        models.push(currentModel);
        currentModel = null;
      }
      continue;
    }

    // Block-level attributes (@@index, @@unique, @@map, @@id)
    if (line.startsWith("@@")) {
      currentModel.blockAttributes.push(line);
      continue;
    }

    // Parse field line
    const field = parseFieldLine(line);
    if (field) {
      currentModel.fields.push(field);
    }
  }

  return models;
}

/**
 * Parse a single field line like:
 *   organizationId String  @map("organization_id")
 *   messages       Message[] @relation(...)
 *   status         WorkStatus @default(BACKLOG)
 */
function parseFieldLine(line: string): RawField | null {
  // Field lines start with an identifier followed by a type
  // Skip lines that are just comments or attributes
  if (line.startsWith("@") || line.startsWith("//")) return null;

  // Match: fieldName  Type(?)([])?  [@attributes...]
  // Prisma optional forms: Type?, Type[]? (rare), Type?[] (not valid but defensive)
  const match = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?(\?)?/);
  if (!match) return null;

  const name = match[1];
  const type = match[2];
  const isList = match[4] === "[]";
  // ? can appear before [] (Type?[]) or after [] (Type[]?) or standalone (Type?)
  const isOptional = match[3] === "?" || match[5] === "?";

  // Extract all @attribute(...) sequences, handling nested parens
  // (e.g. @default(dbgenerated("gen_random_uuid()")))
  const attributes: string[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "@") continue;
    // Read attribute name
    const nameStart = i;
    i++; // skip @
    while (i < line.length && /\w/.test(line[i])) i++;
    const attrName = line.slice(nameStart, i);
    // Check for parenthesized arguments
    if (i < line.length && line[i] === "(") {
      let depth = 0;
      const argStart = i;
      for (; i < line.length; i++) {
        if (line[i] === "(") depth++;
        if (line[i] === ")") depth--;
        if (depth === 0) {
          i++; // include closing paren
          break;
        }
      }
      attributes.push(line.slice(nameStart, i));
    } else {
      attributes.push(attrName);
    }
    i--; // compensate for loop increment
  }

  return {
    name,
    type,
    isList,
    isOptional,
    attributes,
    fullLine: line,
  };
}

// ---------------------------------------------------------------------------
// Attribute parsing helpers
// ---------------------------------------------------------------------------

function hasAttribute(field: RawField, attr: string): boolean {
  return field.attributes.some((a) => a.startsWith(`@${attr}`));
}

function getAttributeArg(field: RawField, attr: string): string | undefined {
  const found = field.attributes.find((a) => a.startsWith(`@${attr}(`));
  if (!found) return undefined;
  // Extract content between balanced parens (handles nested parens)
  const start = found.indexOf("(");
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < found.length; i++) {
    if (found[i] === "(") depth++;
    if (found[i] === ")") depth--;
    if (depth === 0) return found.slice(start + 1, i);
  }
  return undefined;
}

/**
 * Parse @relation("Name", fields: [fk1, fk2], references: [id1, id2])
 */
function parseRelationDirective(field: RawField): {
  name?: string;
  fields?: string[];
  references?: string[];
} | null {
  const relAttr = field.attributes.find((a) => a.startsWith("@relation"));
  if (!relAttr) return null;

  // Extract the full argument string (balanced parens)
  const start = relAttr.indexOf("(");
  if (start === -1) return {};
  let depth = 0;
  let end = relAttr.length;
  for (let i = start; i < relAttr.length; i++) {
    if (relAttr[i] === "(") depth++;
    if (relAttr[i] === ")") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const argStr = relAttr.slice(start + 1, end);
  if (!argStr) return {};

  const result: { name?: string; fields?: string[]; references?: string[] } =
    {};

  // Extract relation name (first quoted string argument)
  const nameMatch = argStr.match(/^"([^"]+)"/);
  if (nameMatch) {
    result.name = nameMatch[1];
  }

  // Extract fields: [...]
  const fieldsMatch = argStr.match(/fields:\s*\[([^\]]*)\]/);
  if (fieldsMatch) {
    result.fields = fieldsMatch[1]
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Extract references: [...]
  const refsMatch = argStr.match(/references:\s*\[([^\]]*)\]/);
  if (refsMatch) {
    result.references = refsMatch[1]
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  return result;
}

/**
 * Parse @@index([field1, field2], map: "name") or @@unique([field1, field2])
 */
function parseBlockAttribute(attr: string): PrismaIndex | null {
  const isUnique = attr.startsWith("@@unique");
  const isIndex = attr.startsWith("@@index");
  if (!isUnique && !isIndex) return null;

  // Extract field list
  const fieldsMatch = attr.match(/\[([^\]]*)\]/);
  if (!fieldsMatch) return null;

  const fields = fieldsMatch[1]
    .split(",")
    .map((f) => f.trim())
    // Strip sort modifiers like (sort: Desc)
    .map((f) => f.replace(/\(.*\)/, "").trim())
    .filter(Boolean);

  // Extract map name
  let mappedName: string | undefined;
  const mapMatch = attr.match(/map:\s*"([^"]+)"/);
  if (mapMatch) {
    mappedName = mapMatch[1];
  }

  return { fields, isUnique, mappedName };
}

function parseTableMap(attrs: string[]): string | undefined {
  for (const attr of attrs) {
    if (attr.startsWith("@@map")) {
      const match = attr.match(/@@map\("([^"]+)"\)/);
      if (match) return match[1];
    }
  }
  return undefined;
}

function parseDefaultValue(field: RawField): string | undefined {
  const arg = getAttributeArg(field, "default");
  return arg ?? undefined;
}

function parseMappedName(field: RawField): string | undefined {
  const arg = getAttributeArg(field, "map");
  if (!arg) return undefined;
  // Strip quotes
  return arg.replace(/"/g, "");
}

// ---------------------------------------------------------------------------
// Model & relation resolution
// ---------------------------------------------------------------------------

/** Set of all model names for distinguishing relation fields from scalar fields */
function buildModelNameSet(rawModels: RawModel[]): Set<string> {
  return new Set(rawModels.map((m) => m.name));
}

function buildFieldDescriptor(
  field: RawField,
  modelNames: Set<string>,
): PrismaFieldDescriptor {
  const isRelation = modelNames.has(field.type);
  const isId = hasAttribute(field, "id");
  // Only mark as unique for field-level @unique, not composite @@unique
  const fieldUnique = hasAttribute(field, "unique");

  return {
    name: field.name,
    type: field.isList ? `${field.type}[]` : field.type,
    isList: field.isList,
    isOptional: field.isOptional,
    isId,
    isUnique: fieldUnique,
    isRelation,
    defaultValue: parseDefaultValue(field),
    mappedName: parseMappedName(field),
  };
}

/**
 * Determine cardinality for a relation field by examining both sides.
 *
 * - Both sides list → many:many
 * - This side list, other singular → 1:many (this model is the "many" container)
 * - This side singular, other list → 1:1 from this field's perspective (we hold FK to one)
 * - Both sides singular → 1:1
 */
function resolveCardinality(
  sourceModel: string,
  field: RawField,
  relationName: string | undefined,
  rawModels: Map<string, RawModel>,
): PrismaCardinality {
  const targetRaw = rawModels.get(field.type);
  if (!targetRaw) {
    // Can't resolve — default based on list-ness
    return field.isList ? "1:many" : "1:1";
  }

  // Find the back-reference field(s) on the target model
  const backRefs = targetRaw.fields.filter((f) => {
    if (f.type !== sourceModel) return false;
    if (relationName) {
      const parsed = parseRelationDirective(f);
      return parsed?.name === relationName;
    }
    return true;
  });

  if (backRefs.length === 0) {
    return field.isList ? "1:many" : "1:1";
  }

  const backRef = backRefs[0];

  if (field.isList && backRef.isList) return "many:many";
  if (field.isList && !backRef.isList) return "1:many";
  if (!field.isList && backRef.isList) return "1:1"; // We're the "one" side
  // Both singular
  return "1:1";
}

function buildRelations(
  rawModel: RawModel,
  modelNames: Set<string>,
  allModels: Map<string, RawModel>,
): PrismaRelation[] {
  const relations: PrismaRelation[] = [];

  for (const field of rawModel.fields) {
    if (!modelNames.has(field.type)) continue;

    const relDirective = parseRelationDirective(field);
    const cardinality = resolveCardinality(
      rawModel.name,
      field,
      relDirective?.name,
      allModels,
    );

    relations.push({
      target: field.type,
      type: cardinality,
      field: field.name,
      foreignKeyFields: relDirective?.fields,
      isSelfRelation: field.type === rawModel.name,
      isRequired: !field.isOptional && !field.isList,
      relationName: relDirective?.name,
    });
  }

  return relations;
}

function buildIndexes(blockAttributes: string[]): {
  indexes: PrismaIndex[];
  uniqueConstraints: PrismaIndex[];
} {
  const indexes: PrismaIndex[] = [];
  const uniqueConstraints: PrismaIndex[] = [];

  for (const attr of blockAttributes) {
    const parsed = parseBlockAttribute(attr);
    if (!parsed) continue;
    if (parsed.isUnique) {
      uniqueConstraints.push(parsed);
    } else {
      indexes.push(parsed);
    }
  }

  return { indexes, uniqueConstraints };
}

// ---------------------------------------------------------------------------
// Main parse pipeline
// ---------------------------------------------------------------------------

export function parsePrismaSchema(filePath: string): PrismaSchemaMap {
  const schema = readSchema(filePath);
  const rawModels = extractModelBlocks(schema);
  const modelNames = buildModelNameSet(rawModels);
  const modelMap = new Map(rawModels.map((m) => [m.name, m]));

  const result: PrismaSchemaMap = {};

  for (const raw of rawModels) {
    const fields = raw.fields.map((f) => buildFieldDescriptor(f, modelNames));
    const relations = buildRelations(raw, modelNames, modelMap);
    const { indexes, uniqueConstraints } = buildIndexes(raw.blockAttributes);
    const tableName = parseTableMap(raw.blockAttributes);

    const model: PrismaModel = {
      name: raw.name,
      ...(tableName && { tableName }),
      fields,
      relations,
      indexes,
      uniqueConstraints,
    };

    result[raw.name] = model;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Human-readable summary
// ---------------------------------------------------------------------------

function printSummary(schemaMap: PrismaSchemaMap): void {
  const modelCount = Object.keys(schemaMap).length;
  const relationCount = Object.values(schemaMap).reduce(
    (sum, m) => sum + m.relations.length,
    0,
  );
  const selfRelCount = Object.values(schemaMap).reduce(
    (sum, m) => sum + m.relations.filter((r) => r.isSelfRelation).length,
    0,
  );

  console.error(`\nParsed ${modelCount} models, ${relationCount} relations`);
  console.error(`  Self-referential: ${selfRelCount}`);
  console.error(`\nRelationship summary:`);

  for (const [name, model] of Object.entries(schemaMap)) {
    for (const rel of model.relations) {
      const reqStr = rel.isRequired ? "" : " (optional)";
      const selfStr = rel.isSelfRelation ? " [self]" : "";
      const namedStr = rel.relationName ? ` "${rel.relationName}"` : "";
      console.error(
        `  ${name} -> ${rel.target} (${rel.type})${reqStr}${selfStr}${namedStr}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const schemaPath =
    process.argv[2] ||
    path.resolve(__dirname, "../../../../apps/api/prisma/schema.prisma");

  console.error(`Parsing Prisma schema: ${schemaPath}`);
  const result = parsePrismaSchema(schemaPath);

  printSummary(result);

  // Output JSON to stdout for piping
  console.log(JSON.stringify(result, null, 2));
}

// Only run when executed directly, not when imported
const isDirectRun =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main();
}
