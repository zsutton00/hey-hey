#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveOpenapiRoot } = require('./openapi-root');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(resolveOpenapiRoot(), 'specs/schemas');
const REPORTS_YAML = path.join(SPECS_DIR, 'reports.yaml');
const PROPOSALS_YAML = path.join(SPECS_DIR, 'proposals.yaml');
const OUTPUT_PATH = path.resolve(
  PROJECT_ROOT,
  'src/mcp/tools/report-schemas.generated.ts',
);

function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Schema source not found: ${filePath}`);
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function parseRef(ref) {
  // Examples:
  //   "#/EvidencePipelineReportPayload"
  //   "./proposals.yaml#/RollupProposalReportPayload"
  //   "./common.yaml#/EntityType"
  const [filePart, fragment] = ref.split('#');
  if (!fragment || !fragment.startsWith('/')) {
    throw new Error(`Unsupported $ref shape: ${ref}`);
  }
  const segments = fragment.slice(1).split('/');
  return { filePart, segments };
}

function resolveDocument(filePart, ownerFile) {
  if (!filePart || filePart === '') {
    return { doc: ownerFile.doc, file: ownerFile.file };
  }
  const resolved = path.resolve(path.dirname(ownerFile.file), filePart);
  return { doc: loadYaml(resolved), file: resolved };
}

function getNode(doc, segments) {
  let current = doc;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') {
      throw new Error(
        `Cannot resolve segment "${segment}" in ref path ${segments.join('/')}`,
      );
    }
    current = current[segment];
  }
  if (current === undefined) {
    throw new Error(`Ref path resolved to undefined: ${segments.join('/')}`);
  }
  return current;
}

function inlineRefs(node, ownerFile, stack = new Set()) {
  if (Array.isArray(node)) {
    return node.map((item) => inlineRefs(item, ownerFile, stack));
  }
  if (node == null || typeof node !== 'object') {
    return node;
  }
  if (typeof node.$ref === 'string') {
    const { filePart, segments } = parseRef(node.$ref);
    const target = resolveDocument(filePart, ownerFile);
    const refKey = `${target.file}#${segments.join('/')}`;
    if (stack.has(refKey)) {
      throw new Error(`Cyclic $ref detected at ${refKey}`);
    }
    const resolved = getNode(target.doc, segments);
    const nextStack = new Set(stack);
    nextStack.add(refKey);
    const inlined = inlineRefs(resolved, target, nextStack);
    const { $ref: _drop, ...rest } = node;
    if (Object.keys(rest).length === 0) {
      return inlined;
    }
    // Merge sibling keys onto the inlined value (rare but valid).
    return { ...inlined, ...inlineRefs(rest, ownerFile, stack) };
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = inlineRefs(value, ownerFile, stack);
  }
  return out;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNullable(node) {
  if (Array.isArray(node)) {
    return node.map(normalizeNullable);
  }
  if (!isPlainObject(node)) {
    return node;
  }
  const normalized = Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'nullable')
      .map(([key, value]) => [key, normalizeNullable(value)]),
  );
  // Wrap the entire schema so null also bypasses allOf and enum constraints.
  return node.nullable ? { anyOf: [normalized, { type: 'null' }] } : normalized;
}

function collectAllOfProperties(allOf) {
  const properties = {};
  for (const schema of allOf) {
    if (!isPlainObject(schema.properties)) {
      continue;
    }
    for (const propertyName of Object.keys(schema.properties)) {
      properties[propertyName] = true;
    }
  }
  return properties;
}

function normalizeClosedAllOfBranches(node) {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeClosedAllOfBranches(item));
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(node)) {
    normalized[key] = normalizeClosedAllOfBranches(value);
  }

  if (!Array.isArray(normalized.allOf)) {
    return normalized;
  }

  const allOfProperties = collectAllOfProperties(normalized.allOf);
  normalized.allOf = normalized.allOf.map((schema) => {
    if (
      !isPlainObject(schema) ||
      schema.additionalProperties !== false ||
      !isPlainObject(schema.properties)
    ) {
      return schema;
    }

    const properties = { ...schema.properties };
    for (const propertyName of Object.keys(allOfProperties)) {
      if (!(propertyName in properties)) {
        properties[propertyName] = {};
      }
    }
    return { ...schema, properties };
  });

  return normalized;
}

function buildEntries() {
  const reportsDoc = loadYaml(REPORTS_YAML);
  // Force load + cache proposals.yaml so cross-file refs resolve deterministically.
  loadYaml(PROPOSALS_YAML);
  const reportsFile = { doc: reportsDoc, file: REPORTS_YAML };

  const reportPayload = reportsDoc.ReportPayload;
  if (!reportPayload?.discriminator?.mapping) {
    throw new Error(
      'reports.yaml ReportPayload.discriminator.mapping is missing',
    );
  }

  const mapping = reportPayload.discriminator.mapping;
  const entries = [];
  for (const [reportType, ref] of Object.entries(mapping)) {
    const { filePart, segments } = parseRef(ref);
    const target = resolveDocument(filePart, reportsFile);
    const variant = getNode(target.doc, segments);
    if (!variant || typeof variant !== 'object') {
      throw new Error(
        `Variant at ${ref} is not an object schema (reportType=${reportType})`,
      );
    }
    const description =
      typeof variant.description === 'string' ? variant.description.trim() : '';
    if (!description) {
      throw new Error(
        `Variant ${ref} (reportType=${reportType}) has no description`,
      );
    }
    const inlinedSchema = normalizeClosedAllOfBranches(
      normalizeNullable(inlineRefs(variant, target)),
    );
    entries.push({ reportType, schema: inlinedSchema, description });
  }
  entries.sort((a, b) => a.reportType.localeCompare(b.reportType));
  return entries;
}

function indent(text, prefix) {
  return text
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : `${prefix}${line}`))
    .join('\n');
}

function formatEntry(entry) {
  const schemaJson = indent(JSON.stringify(entry.schema, null, 2), '    ');
  const descriptionJson = JSON.stringify(entry.description);
  return (
    `  ${JSON.stringify(entry.reportType)}: {\n` +
    `    description: ${descriptionJson},\n` +
    `    schema: ${schemaJson},\n` +
    `  },`
  );
}

function buildFileContent(entries) {
  const header = [
    '// THIS FILE IS GENERATED BY scripts/generate-report-schemas.js',
    '// DO NOT EDIT BY HAND. Regenerate with `pnpm generate:report-schemas`.',
    '// Source of truth: openapi/specs/schemas/reports.yaml (and proposals.yaml).',
    '',
    'export interface ReportSchemaEntry {',
    "  /** Human-readable description sourced from the variant's yaml `description` field. */",
    '  description: string;',
    '  /** Self-contained JSON Schema for the report payload variant. */',
    '  schema: Record<string, unknown>;',
    '}',
    '',
    'export const REPORT_SCHEMAS = {',
  ].join('\n');

  const body = entries.map(formatEntry).join('\n');

  const footer = [
    '} satisfies Record<string, ReportSchemaEntry>;',
    '',
    'export type ReportSchemaKey = keyof typeof REPORT_SCHEMAS;',
    '',
  ].join('\n');

  return `${header}\n${body}\n${footer}`;
}

function main() {
  const entries = buildEntries();
  const content = buildFileContent(entries);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, content, 'utf8');
  console.log(
    `Wrote ${entries.length} report schema entries to ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
