#!/usr/bin/env tsx
/**
 * CLI tool: validates a relationship configuration against a previous version.
 *
 * Reads two RelationshipConfig JSON files, compares them, and prints a
 * human-readable diff report. Exits non-zero when breaking changes are found.
 *
 * Usage:
 *   tsx validate-config-cli.ts --previous <path> --next <path>
 *
 * When --previous is omitted, defaults to the committed generated config.
 * When --next is omitted, defaults to the same path (useful when piping
 * the new config after a generate run).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import type { RelationshipConfig } from "./config-types";
import { formatValidationReport } from "./format-validation-report";
import { validateConfig } from "./validate-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_PATH = path.resolve(
  __dirname,
  "../../src/data/relationships/relationship-config.generated.json",
);

interface CliArgs {
  previous: string;
  next: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    previous: DEFAULT_CONFIG_PATH,
    next: DEFAULT_CONFIG_PATH,
    json: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--previous":
        if (!argv[i + 1]) {
          console.error("Error: --previous requires a path argument");
          process.exit(1);
        }
        args.previous = path.resolve(argv[++i]);
        break;
      case "--next":
        if (!argv[i + 1]) {
          console.error("Error: --next requires a path argument");
          process.exit(1);
        }
        args.next = path.resolve(argv[++i]);
        break;
      case "--json":
        args.json = true;
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
    `Usage: validate-config-cli [--previous <path>] [--next <path>] [--json]`,
  );
  console.error(`\nOptions:`);
  console.error(`  --previous  Path to previous config JSON (default: generated config)`);
  console.error(`  --next      Path to new config JSON (default: generated config)`);
  console.error(`  --json      Output report as JSON instead of formatted text`);
  console.error(`  --help      Show this help message`);
}

function readConfig(filePath: string, label: string): RelationshipConfig {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: ${label} not found at ${filePath}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as RelationshipConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: Failed to parse ${label}: ${msg}`);
    process.exit(1);
  }
}

function main(): void {
  const args = parseArgs(process.argv);

  const previous = readConfig(args.previous, "previous config");
  const next = readConfig(args.next, "new config");

  const report = validateConfig(previous, next);
  report.previousSource = args.previous;
  report.newSource = args.next;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(formatValidationReport(report));
  }

  if (!report.isClean) {
    process.exit(1);
  }
}

main();
