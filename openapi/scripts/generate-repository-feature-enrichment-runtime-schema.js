#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const ROOT_DEFINITIONS = [
  "WorkTrackerImportRequest",
  "WorkTrackerImportCompletion",
  "RepositoryGroundingCompletion",
  "RepositoryGroundingSuccess",
  "RepositoryGroundingRetryableFailure",
  "RepositoryGroundingTerminalFailure",
  "RepositoryFeatureEnrichmentCompletion",
  "RepositoryFeatureEnrichmentDecisionCompletion",
  "RepositoryFeatureEnrichmentQuestions",
  "RepositoryFeatureEnrichmentSuccess",
  "RepositoryFeatureEnrichmentSuccessDecision",
  "RepositoryFeatureEnrichmentRetryableFailure",
  "RepositoryFeatureEnrichmentTerminalFailure",
  "RepositoryPlacementCompletion",
  "RepositoryFirstWorkCompletion",
  "RepositoryFirstWorkQuestions",
  "RepositoryFirstWorkSuccess",
  "RepositoryFirstWorkRetryableFailure",
  "RepositoryFirstWorkTerminalFailure",
];

const usage = () =>
  "Usage: node scripts/generate-repository-feature-enrichment-runtime-schema.js <output.ts> [output.ts ...]";

const componentNameFromRef = (ref) => {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  return ref.slice(prefix.length).split("/")[0];
};

const collectDefinitionNames = (schemas, rootDefinitions) => {
  const names = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string") {
      const name = componentNameFromRef(value.$ref);
      if (name && !names.has(name)) {
        names.add(name);
        visit(schemas[name]);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };

  for (const name of rootDefinitions) {
    if (!schemas[name]) throw new Error(`Missing OpenAPI schema: ${name}`);
    if (!names.has(name)) {
      names.add(name);
      visit(schemas[name]);
    }
  }
  return names;
};

const rewriteSchemaReferences = (value) => {
  if (Array.isArray(value)) return value.map(rewriteSchemaReferences);
  if (!value || typeof value !== "object") return value;

  const nullable = value.nullable === true;
  const rewritten = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "nullable") continue;
    // OpenAPI 3.0 uses boolean exclusive bounds; draft-07 uses numeric bounds.
    if ((key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof child === "boolean") {
      if (child) rewritten[key] = value[key === "exclusiveMinimum" ? "minimum" : "maximum"];
      continue;
    }
    if (key === "$ref" && typeof child === "string") {
      const name = componentNameFromRef(child);
      rewritten[key] = name
        ? `#/definitions/${child.slice("#/components/schemas/".length)}`
        : child;
    } else if (key === "discriminator") {
      // OpenAPI's discriminator is already represented by oneOf and is not a
      // JSON Schema validation keyword.
      continue;
    } else if (
      key === "format" &&
      typeof child === "string" &&
      child.startsWith("branded-")
    ) {
      // Branded formats are compile-time identity markers. Their adjacent
      // OpenAPI pattern, when present, remains the runtime constraint.
      continue;
    } else {
      rewritten[key] = rewriteSchemaReferences(child);
    }
  }
  if (!nullable) return rewritten;
  if (typeof rewritten.type === "string") {
    rewritten.type = [rewritten.type, "null"];
    return rewritten;
  }
  return { anyOf: [{ type: "null" }, rewritten] };
};

async function generateRuntimeSchema(
  outputPaths,
  rootDefinitions = ROOT_DEFINITIONS,
  exportName = "repositoryFeatureEnrichmentRuntimeSchema",
  typeImportPath,
) {
  const inputPath = path.join(
    __dirname,
    "..",
    "specs",
    "agent-bridge",
    "openapi.yaml",
  );
  const bundled = await SwaggerParser.bundle(inputPath);
  const schemas = bundled.components?.schemas;
  if (!schemas)
    throw new Error("Agent Bridge OpenAPI document has no component schemas.");

  const definitionNames = collectDefinitionNames(schemas, rootDefinitions);
  const definitions = {};
  for (const name of definitionNames) {
    definitions[name] = rewriteSchemaReferences(schemas[name]);
  }

  const typeMapName = `${exportName[0].toUpperCase()}${exportName.slice(1)}Types`;
  const typeMap = typeImportPath
    ? `import type { ${rootDefinitions.join(", ")} } from '${typeImportPath}';\n` +
      `export type ${typeMapName} = {\n${rootDefinitions.map((name) => `  ${name}: ${name};`).join("\n")}\n};\n`
    : "";
  const generated = `${typeImportPath ? "" : "/* eslint-disable */\n"}/**
 * Auto-generated from specs/agent-bridge/openapi.yaml.
 * Do not edit manually; regenerate from the OpenAPI source.
 */
${typeMap}export const ${exportName} = ${JSON.stringify(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions,
    },
    null,
    2,
  )};
`;

  for (const outputPath of outputPaths) {
    const absolutePath = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, generated);
    process.stdout.write(`Generated ${absolutePath}\n`);
  }
}

if (require.main === module) {
  const outputPaths = process.argv.slice(2);
  if (outputPaths.length === 0) throw new Error(usage());
  generateRuntimeSchema(outputPaths).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { generateRuntimeSchema, rewriteSchemaReferences };
