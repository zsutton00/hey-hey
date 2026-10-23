#!/usr/bin/env node
// Coordinated contract generation for every in-checkout OpenAPI consumer.
//
//   pnpm generate:contracts           validate the source, regenerate every target, record identity
//   pnpm generate:contracts --check   regenerate, then fail if any tracked output drifted
//   pnpm generate:contracts --verify  no generation; fail if recorded outputs do not match the
//                                     current source or a target's last generation failed
//
// Each target keeps its owner's generator version, options and postprocessors by
// running the owner's own recipe. Targets are independent: one failing does not
// stop the others, its previous outputs are restored, and the recorded failure
// blocks --verify (and therefore builds) until it is regenerated successfully.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  describeOpenapiSource,
  digestClosure,
} = require("./openapi-source.cjs");

const checkoutRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const recordPath = path.join(checkoutRoot, "generated-contracts.json");
const lockPath = path.join(checkoutRoot, ".generate-contracts.lock");

// Outputs are every path the owner's recipe writes, relative to the checkout root.
const TARGETS = [
  {
    id: "ui-common",
    commands: [["pnpm", "--filter", "@hey-hey/ui-common", "generate:all"]],
    outputs: [
      "packages/ui-common/src/api",
      "packages/ui-common/src/generated",
      "packages/ui-common/src/local-agent-api/generated",
      "packages/ui-common/src/clients/private-beta-access-contract.generated.ts",
    ],
  },
  {
    id: "cli",
    commands: [["pnpm", "--filter", "./apps/cli", "generate:all"]],
    outputs: [
      "apps/cli/src/generated",
      "apps/cli/src/shared/api/generated",
      "apps/cli/src/shared/agent-bridge-contract/generated",
      "apps/cli/src/shared/local-agent-api/generated",
    ],
  },
  {
    id: "api",
    // Prisma client types are a separate (database) source the API models build on.
    commands: [
      ["pnpm", "--filter", "./apps/api", "db:generate"],
      ["pnpm", "--filter", "./apps/api", "generate:all"],
    ],
    outputs: [
      "apps/api/src/generated",
      "apps/api/src/contracts/repository-feature-enrichment-runtime-schema.ts",
      "apps/api/src/mcp/tools/report-schemas.generated.ts",
    ],
  },
];

const log = (message) =>
  process.stderr.write(`[generate:contracts] ${message}\n`);

const run = ([command, ...args], environment) =>
  spawnSync(command, args, {
    cwd: checkoutRoot,
    env: environment,
    stdio: "inherit",
  }).status === 0;

const listFiles = (absolute) => {
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(absolute, entry.name)))
    .sort();
};

const digestOutputs = (outputs) => {
  const hash = createHash("sha256");
  for (const output of outputs) {
    for (const file of listFiles(path.join(checkoutRoot, output))) {
      hash.update(path.relative(checkoutRoot, file));
      hash.update("\0");
      hash.update(fs.readFileSync(file));
      hash.update("\n");
    }
  }
  return `sha256:${hash.digest("hex")}`;
};

const backupOutputs = (target, backupRoot) => {
  for (const output of target.outputs) {
    const source = path.join(checkoutRoot, output);
    if (fs.existsSync(source))
      fs.cpSync(source, path.join(backupRoot, target.id, output), {
        recursive: true,
      });
  }
};

const restoreOutputs = (target, backupRoot) => {
  for (const output of target.outputs) {
    const live = path.join(checkoutRoot, output);
    const saved = path.join(backupRoot, target.id, output);
    fs.rmSync(live, { recursive: true, force: true });
    if (fs.existsSync(saved)) fs.cpSync(saved, live, { recursive: true });
  }
};

const readRecord = () =>
  fs.existsSync(recordPath)
    ? JSON.parse(fs.readFileSync(recordPath, "utf8"))
    : null;

const verify = () => {
  const record = readRecord();
  if (!record) {
    log("No generated-contracts.json record. Run pnpm generate:contracts.");
    return false;
  }
  const source = describeOpenapiSource();
  const problems = [];
  if (source.closureDigest !== record.source.closureDigest) {
    problems.push(
      `OpenAPI source ${source.openapiRoot} is ${source.closureDigest}; outputs were generated from ${record.source.closureDigest}.`,
    );
  }
  for (const target of TARGETS) {
    const recorded = record.targets[target.id];
    if (!recorded || recorded.status !== "generated") {
      problems.push(
        `${target.id}: last generation ${recorded?.status ?? "missing"}.`,
      );
    } else if (digestOutputs(target.outputs) !== recorded.outputDigest) {
      problems.push(
        `${target.id}: outputs differ from what generation produced.`,
      );
    }
  }
  for (const problem of problems) log(problem);
  if (problems.length > 0) log("Regenerate with pnpm generate:contracts.");
  return problems.length === 0;
};

const acquireLock = () => {
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Another generation run holds ${lockPath}. Remove it only if no run is active.`,
      );
    }
    throw error;
  }
  return () => fs.rmSync(lockPath, { recursive: true, force: true });
};

const generate = ({ check }) => {
  const source = describeOpenapiSource();
  log(
    `source=${source.openapiRoot} selection=${source.selection} revision=${source.revision ?? "none"}` +
      ` workingChanges=${source.workingChanges} closure=${source.closureDigest}`,
  );
  const environment = {
    ...process.env,
    HEY_HEY_OPENAPI_ROOT: source.openapiRoot,
  };

  const release = acquireLock();
  const backupRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "generate-contracts-"),
  );
  try {
    log("Validating OpenAPI specifications");
    if (
      !run(
        ["npm", "run", "--prefix", source.openapiRoot, "validate:all"],
        environment,
      )
    ) {
      log("OpenAPI validation failed; no target was generated.");
      return false;
    }

    const previous = readRecord();
    const results = {};
    for (const target of TARGETS) {
      log(`Generating ${target.id}`);
      backupOutputs(target, backupRoot);
      const succeeded = target.commands.every((command) =>
        run(command, environment),
      );
      if (succeeded) {
        results[target.id] = {
          status: "generated",
          outputDigest: digestOutputs(target.outputs),
        };
      } else {
        restoreOutputs(target, backupRoot);
        results[target.id] = {
          status: "failed",
          outputDigest: previous?.targets?.[target.id]?.outputDigest ?? null,
        };
        log(`${target.id} failed; its previous outputs were restored.`);
      }
    }

    const after = digestClosure(source.openapiRoot);
    if (after.closureDigest !== source.closureDigest) {
      log(
        `OpenAPI source changed during generation (${after.closureDigest}); outputs are not recorded.`,
      );
      return false;
    }

    // The record holds only content identity so it is stable across commits;
    // the revision and selection are reported above for each run.
    const record = {
      source: {
        closureDigest: source.closureDigest,
        closureFileCount: source.closureFileCount,
      },
      targets: results,
    };
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

    const failed = Object.entries(results).filter(
      ([, result]) => result.status !== "generated",
    );
    for (const [id, result] of Object.entries(results))
      log(`${id}: ${result.status}`);
    if (failed.length > 0) return false;

    if (check) {
      const paths = [
        "generated-contracts.json",
        ...TARGETS.flatMap((target) => target.outputs),
      ];
      // Compare against the index so a reviewed, staged regeneration counts as
      // the baseline; in a clean CI checkout the index is the commit.
      const git = (args) =>
        spawnSync("git", [...args, "--", ...paths], {
          cwd: checkoutRoot,
          encoding: "utf8",
        });
      const changed = git(["diff", "--name-only"]);
      const untracked = git(["ls-files", "--others", "--exclude-standard"]);
      const drift = `${changed.stdout}${untracked.stdout}`.trim();
      if (changed.status !== 0 || untracked.status !== 0 || drift) {
        log(`Generated outputs drifted from the committed files:\n${drift}`);
        return false;
      }
      log("No drift.");
    }
    return true;
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
    release();
  }
};

const mode = process.argv[2];
try {
  if (mode !== undefined && mode !== "--check" && mode !== "--verify") {
    throw new Error("Usage: generate-contracts.mjs [--check|--verify]");
  }
  const ok =
    mode === "--verify" ? verify() : generate({ check: mode === "--check" });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
