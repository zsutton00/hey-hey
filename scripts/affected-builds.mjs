#!/usr/bin/env node
// Selects the checks and image builds a change affects.
//
//   node scripts/affected-builds.mjs --base <ref> [--head <ref>] [--github-output]
//   node scripts/affected-builds.mjs -- <changed path>...
//
// A changed path selects the target that owns it plus every workspace package
// that depends on that target (from workspace manifests and declared source inputs, so the
// selection follows dependencies as they actually exist). OpenAPI and root
// workspace/build inputs select everything. Documentation selects nothing. Any
// other path outside a target is treated as a build input and selects
// everything, so an unrecognised change can never skip a check.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checkoutRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Each target's checks run in CI when it is selected; `image` names the
// distinct image it builds. OpenAPI validation and generation drift are owned
// by the Contracts workflow (pnpm generate:check), not repeated here.
export const TARGETS = [
  {
    id: "ui-common",
    directory: "packages/ui-common",
    checks: [
      "pnpm --filter @hey-hey/ui-common type-check",
      "pnpm --filter @hey-hey/ui-common test",
    ],
  },
  {
    id: "ui",
    directory: "apps/ui",
    checks: ["pnpm --filter hey-hey type-check", "pnpm --filter hey-hey test"],
    image: "ui-service",
  },
  {
    id: "api",
    directory: "apps/api",
    checks: ["pnpm --filter hey-hey-api typecheck"],
    image: "api-service",
  },
  {
    id: "cli",
    directory: "apps/cli",
    // The CLI bundles shared source without a distributable package dependency.
    sourceDependencies: ["ui-common"],
    checks: [
      "pnpm --filter @hey-hey/cli typecheck",
      "pnpm --filter @hey-hey/cli test",
      "pnpm --filter @hey-hey/cli build",
    ],
  },
  { id: "openapi", directory: "openapi", checks: [] },
];

const DOCUMENTATION = [/^docs\//, /^[^/]+\.md$/, /^LICENSE$/];

const ownerOf = (file) =>
  TARGETS.find(({ directory }) => file.startsWith(`${directory}/`));

// target id -> ids of targets whose manifests depend on it (workspace:*).
export const readDependents = (root = checkoutRoot) => {
  const byName = new Map();
  const manifests = TARGETS.map((target) => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, target.directory, "package.json"),
        "utf8",
      ),
    );
    byName.set(manifest.name, target.id);
    return { target, manifest };
  });
  const dependents = new Map(TARGETS.map(({ id }) => [id, new Set()]));
  for (const { target, manifest } of manifests) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (byName.has(name) && String(range).startsWith("workspace:")) {
          dependents.get(byName.get(name)).add(target.id);
        }
      }
    }
  }
  for (const target of TARGETS) {
    for (const dependency of target.sourceDependencies ?? []) {
      dependents.get(dependency).add(target.id);
    }
  }
  return dependents;
};

export const selectAffected = (changedFiles, dependents = readDependents()) => {
  const selected = new Set();
  const reasons = [];
  let everything = false;
  const selectWithDependents = (id) => {
    if (selected.has(id)) return;
    selected.add(id);
    for (const dependent of dependents.get(id)) selectWithDependents(dependent);
  };

  for (const file of changedFiles) {
    const owner = ownerOf(file);
    if (owner?.id === "openapi") {
      everything = true;
      reasons.push(`${file}: specification change`);
    } else if (owner) {
      selectWithDependents(owner.id);
    } else if (!DOCUMENTATION.some((pattern) => pattern.test(file))) {
      everything = true;
      reasons.push(`${file}: root workspace or build input`);
    }
  }
  if (everything) for (const { id } of TARGETS) selected.add(id);

  const targets = TARGETS.filter(({ id }) => selected.has(id));
  return {
    targets: targets.map(({ id }) => id),
    checks: targets.flatMap(({ id, checks }) =>
      checks.map((command) => ({ target: id, command })),
    ),
    images: targets.filter(({ image }) => image).map(({ id }) => id),
    // Graph and Embeddings pin their own spec closure; they are told, never rebuilt.
    externalConsumerHandoff: selected.has("openapi"),
    reasons,
  };
};

const ZERO_REVISION = /^0+$/;

const changedBetween = (base, head) =>
  execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", `${base}...${head}`],
    { cwd: checkoutRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

const parseArguments = (argv) => {
  const options = { head: "HEAD", files: null, githubOutput: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base") options.base = argv[++index];
    else if (argument === "--head") options.head = argv[++index];
    else if (argument === "--github-output") options.githubOutput = true;
    else if (argument === "--") options.files = argv.slice(index + 1);
    else throw new Error(`Unknown argument ${argument}`);
    if (options.files) break;
  }
  return options;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  let files = options.files;
  if (!files) {
    if (!options.base) {
      throw new Error("Pass --base <ref> or -- <changed path>...");
    }
    // A new branch has no previous revision to compare with: select everything.
    files = ZERO_REVISION.test(options.base)
      ? ["<no base revision>"]
      : changedBetween(options.base, options.head);
  }
  const result = selectAffected(files);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (options.githubOutput) {
    const lines = [
      `targets=${JSON.stringify(result.targets)}`,
      `checks=${JSON.stringify(result.checks)}`,
      `images=${JSON.stringify(result.images)}`,
      `external_consumer_handoff=${result.externalConsumerHandoff}`,
    ];
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}
