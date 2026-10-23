#!/usr/bin/env tsx
/**
 * CLI tool: generates a relationship configuration file.
 *
 * Reads the OpenAPI spec and Prisma schema, runs relationship
 * detection, deduplicates per-endpoint occurrences, and writes a
 * versioned configuration file to a specified output path.
 *
 * Usage:
 *   tsx generate-config.ts [--openapi <path>] [--prisma <path>] [--output <path>]
 *
 * Exits non-zero with a descriptive error when a required schema
 * source is missing or unparseable.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { detectRelationships } from "./detect-relationships";
import { parseOpenAPISpec } from "./parse-openapi";
import { parsePrismaSchema } from "./parse-prisma";
import { annotationKey, serializeConfig } from "./serialize-config";
import { formatValidationReport } from "./format-validation-report";
import { validateConfig } from "./validate-config";
import type { RelationshipConfig } from "./config-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OPENAPI_PATH = path.resolve(
  __dirname,
  "../../../../openapi/specs/api/openapi.yaml",
);
const DEFAULT_PRISMA_PATH = path.resolve(
  __dirname,
  "../../../../apps/api/prisma/schema.prisma",
);
const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  "../../src/data/relationships/relationship-config.generated.json",
);

interface CliArgs {
  openapi: string;
  prisma: string;
  output: string;
  skipValidation: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    openapi: DEFAULT_OPENAPI_PATH,
    prisma: DEFAULT_PRISMA_PATH,
    output: DEFAULT_OUTPUT_PATH,
    skipValidation: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--openapi":
        if (!argv[i + 1]) {
          console.error("Error: --openapi requires a path argument");
          process.exit(1);
        }
        args.openapi = path.resolve(argv[++i]);
        break;
      case "--prisma":
        if (!argv[i + 1]) {
          console.error("Error: --prisma requires a path argument");
          process.exit(1);
        }
        args.prisma = path.resolve(argv[++i]);
        break;
      case "--output":
        if (!argv[i + 1]) {
          console.error("Error: --output requires a path argument");
          process.exit(1);
        }
        args.output = path.resolve(argv[++i]);
        break;
      case "--skip-validation":
        args.skipValidation = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return args;
}

function printUsage(): void {
  console.error(
    `Usage: generate-config [--openapi <path>] [--prisma <path>] ` +
      `[--output <path>]`,
  );
  console.error(`\nOptions:`);
  console.error(`  --openapi  Path to OpenAPI YAML spec`);
  console.error(`  --prisma   Path to Prisma schema file`);
  console.error(`  --output   Output path for generated config`);
  console.error(
    `  --skip-validation  Skip diff validation against previous config`,
  );
  console.error(`  --help     Show this help message`);
}

function validateFile(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: ${label} not found at ${filePath}`);
    process.exit(1);
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    console.error(`Error: ${label} is not readable at ${filePath}`);
    process.exit(1);
  }
}

function ensureOutputDir(outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

/**
 * Read developer-written notes from an existing config file.
 * Returns a map from annotationKey → note string.
 * Returns an empty map if the file doesn't exist or can't be parsed.
 */
function readPriorAnnotations(outputPath: string): Map<string, string> {
  const annotations = new Map<string, string>();
  if (!fs.existsSync(outputPath)) return annotations;

  let existing: RelationshipConfig;
  try {
    const raw = fs.readFileSync(outputPath, "utf-8");
    existing = JSON.parse(raw) as RelationshipConfig;
  } catch {
    return annotations;
  }

  for (const [sourceEntity, entries] of Object.entries(existing.entities)) {
    for (const entry of entries) {
      if (entry.note !== undefined) {
        annotations.set(
          annotationKey(
            sourceEntity,
            entry.targetEntity,
            entry.field,
            entry.tier,
          ),
          entry.note,
        );
      }
    }
  }

  return annotations;
}

function main(): void {
  const args = parseArgs(process.argv);

  // Validate inputs exist
  validateFile(args.openapi, "OpenAPI spec");
  validateFile(args.prisma, "Prisma schema");

  // Parse sources
  console.error(`Parsing OpenAPI spec: ${args.openapi}`);
  let openApiMap;
  try {
    openApiMap = parseOpenAPISpec(args.openapi);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to parse OpenAPI spec: ${msg}`);
    process.exit(1);
  }

  console.error(`Parsing Prisma schema: ${args.prisma}`);
  let prismaMap;
  try {
    prismaMap = parsePrismaSchema(args.prisma);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to parse Prisma schema: ${msg}`);
    process.exit(1);
  }

  // Detect relationships
  console.error("Detecting relationships...");
  const graph = detectRelationships(prismaMap, openApiMap);

  // Carry forward any developer-written notes from the previous output
  const priorAnnotations = readPriorAnnotations(args.output);
  if (priorAnnotations.size > 0) {
    console.error(`  Preserving ${priorAnnotations.size} manual annotation(s)`);
  }

  // Serialize to config
  const config = serializeConfig(
    graph,
    { openapi: args.openapi, prisma: args.prisma },
    undefined,
    priorAnnotations,
  );

  // Validate against previous config if it exists
  if (!args.skipValidation && fs.existsSync(args.output)) {
    try {
      const raw = fs.readFileSync(args.output, "utf-8");
      const previousConfig = JSON.parse(raw) as RelationshipConfig;
      const report = validateConfig(previousConfig, config);

      if (report.summary.totalChanges > 0) {
        console.error("");
        console.error(formatValidationReport(report));
      }
    } catch {
      console.error("  Warning: Could not read previous config for validation");
    }
  }

  // Write output
  ensureOutputDir(args.output);
  const json = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(args.output, json, "utf-8");

  console.error(`\nConfiguration written to: ${args.output}`);
  console.error(`  Entities: ${config.summary.entityCount}`);
  console.error(`  Relationships: ${config.summary.relationshipCount}`);
  console.error(`  Needs review: ${config.summary.needsReviewCount}`);
}

main();
