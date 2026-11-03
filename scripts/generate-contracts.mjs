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
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  describeOpenapiSource,
  digestClosure,
  digestSpecClosure,
} = require("./openapi-source.cjs");

const checkoutRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const recordPath = path.join(checkoutRoot, "generated-contracts.json");
const lockPath = path.join(os.tmpdir(), "hey-hey-openapi-generation.lock");

// Outputs are every path the owner's recipe writes, relative to the checkout root.
const TARGETS = [
  {
    id: "contracts-api",
    commands: [
      ["pnpm", "--dir", "packages/contracts", "run", "generate:all:unlocked"],
    ],
    env: { HEY_HEY_CONTRACTS_TARGETS: "api" },
    inputSpecs: ["specs/api/openapi.yaml"],
    openapiFiles: [
      "scripts/generate-proposal-reconciliation-schema.js",
      "scripts/postprocess-project-report-models.js",
      "specs/schemas/proposals.yaml",
    ],
    inputFiles: [
      "packages/contracts/scripts/generate.mjs",
      "packages/contracts/scripts/postprocess-model-barrels.cjs",
      "packages/contracts/scripts/postprocess-allof-overrides.cjs",
      "packages/contracts/scripts/postprocess-brands.cjs",
      "packages/contracts/scripts/postprocess-interface-intersections.cjs",
      "apps/cli/openapitools.json",
      "apps/cli/scripts/postprocess-generated-api.sh",
      "apps/cli/scripts/postprocess-generated-api.cjs",
      "packages/ui-common/scripts/align-cli-source-types.cjs",
    ],
    packageScripts: [
      {
        path: "packages/contracts/package.json",
        names: ["generate:all:unlocked"],
      },
    ],
    formatFiles: ["apps/cli/.prettierrc.json"],
    toolPackages: [
      {
        path: "apps/cli/package.json",
        names: ["@openapitools/openapi-generator-cli"],
      },
      { path: "openapi/package.json", names: ["js-yaml"] },
    ],
    outputs: ["packages/contracts/src/generated/api"],
  },
  {
    id: "contracts-agent-bridge",
    commands: [
      ["pnpm", "--dir", "packages/contracts", "run", "generate:all:unlocked"],
    ],
    env: { HEY_HEY_CONTRACTS_TARGETS: "agent-bridge" },
    inputSpecs: ["specs/agent-bridge/openapi.yaml"],
    openapiFiles: [
      "scripts/generate-repository-feature-enrichment-runtime-schema.js",
      "scripts/project-mode-contract.js",
      "scripts/task-monitor-contract.js",
      "specs/fixtures/task-monitor-contract.json",
    ],
    inputFiles: [
      "packages/contracts/scripts/generate.mjs",
      "packages/contracts/scripts/postprocess-model-barrels.cjs",
      "packages/contracts/scripts/postprocess-brands.cjs",
      "packages/contracts/scripts/postprocess-allof-overrides.cjs",
      "packages/contracts/scripts/postprocess-interface-intersections.cjs",
      "apps/cli/openapitools.json",
      "apps/cli/scripts/postprocess-generated-api.sh",
      "apps/cli/scripts/postprocess-generated-api.cjs",
      "packages/ui-common/scripts/align-cli-source-types.cjs",
    ],
    packageScripts: [
      {
        path: "packages/contracts/package.json",
        names: ["generate:all:unlocked"],
      },
    ],
    formatFiles: ["apps/cli/.prettierrc.json"],
    toolPackages: [
      {
        path: "apps/cli/package.json",
        names: ["@openapitools/openapi-generator-cli"],
      },
      {
        path: "openapi/package.json",
        names: ["@apidevtools/swagger-parser", "ajv", "ajv-formats"],
      },
    ],
    outputs: ["packages/contracts/src/generated/agent-bridge"],
  },
  {
    id: "contracts-local",
    commands: [
      ["pnpm", "--dir", "packages/contracts", "run", "generate:all:unlocked"],
    ],
    env: { HEY_HEY_CONTRACTS_TARGETS: "local" },
    inputSpecs: ["specs/local/openapi.yaml"],
    inputFiles: [
      "packages/contracts/scripts/generate.mjs",
      "packages/contracts/scripts/postprocess-model-barrels.cjs",
      "packages/contracts/scripts/postprocess-brands.cjs",
      "packages/contracts/scripts/postprocess-interface-intersections.cjs",
      "apps/cli/openapitools.json",
      "apps/cli/scripts/postprocess-generated-api.sh",
      "apps/cli/scripts/postprocess-generated-api.cjs",
      "packages/ui-common/scripts/align-cli-source-types.cjs",
    ],
    packageScripts: [
      {
        path: "packages/contracts/package.json",
        names: ["generate:all:unlocked"],
      },
    ],
    formatFiles: ["apps/cli/.prettierrc.json"],
    toolPackages: [
      {
        path: "apps/cli/package.json",
        names: ["@openapitools/openapi-generator-cli"],
      },
    ],
    outputs: ["packages/contracts/src/generated/local"],
  },
  {
    id: "api-custom",
    dependsOn: ["contracts-api", "contracts-agent-bridge"],
    commands: [
      ["pnpm", "--dir", "apps/api", "run", "generate:api:unlocked"],
      ["pnpm", "--dir", "apps/api", "run", "generate:report-schemas:unlocked"],
    ],
    inputSpecs: ["specs/api/openapi.yaml", "specs/agent-bridge/openapi.yaml"],
    openapiFiles: [
      "scripts/generate-controller-action-contract.js",
      "scripts/generate-repository-feature-enrichment-runtime-schema.js",
      "specs/fixtures/entity-prompt-template-language-v1.json",
    ],
    inputFiles: [
      "apps/api/scripts/generate-api-atomically.js",
      "apps/api/scripts/openapi-generation-cache.js",
      "apps/api/scripts/generate-workflow-review-schemas.js",
      "apps/api/scripts/generate-report-schemas.js",
      "apps/api/scripts/generate-path-constants.js",
      "apps/api/scripts/generate-activity-history-contract.js",
      "apps/api/scripts/generate-project-report-schemas.js",
      "apps/api/scripts/generate-goal-pm-decision-schema.js",
      "apps/api/scripts/generate-feature-requirements-schema.js",
      "apps/api/scripts/generate-future-revision-schema.js",
      "apps/api/scripts/generate-private-beta-access-schema.js",
      "apps/api/scripts/generate-demo-sandbox-schema.js",
      "apps/api/scripts/generate-open-items-schemas.js",
      "apps/api/scripts/generate-diagram-schemas.js",
      "apps/api/scripts/generate-entity-prompt-template-language.js",
      "scripts/entity-prompt-template-parser-source.cjs",
      "apps/api/scripts/post-process-generated-types.ts",
      "apps/api/scripts/openapi-root.js",
      "apps/api/scripts/generated-root.js",
    ],
    packageScripts: [
      {
        path: "apps/api/package.json",
        names: ["generate:api:unlocked", "generate:report-schemas:unlocked"],
      },
    ],
    toolPackages: [
      {
        path: "apps/api/package.json",
        names: ["prettier", "js-yaml", "ts-node"],
      },
      { path: "packages/contracts/package.json", names: ["typescript"] },
      { path: "openapi/package.json", names: ["js-yaml"] },
    ],
    formatFiles: ["apps/api/.prettierrc", "apps/api/.prettierignore"],
    outputs: [
      "apps/api/src/generated/activity-history-contract.ts",
      "apps/api/src/generated/controller-action-contract.ts",
      "apps/api/src/generated/demo-sandbox.schema.ts",
      "apps/api/src/generated/diagram.schemas.ts",
      "apps/api/src/generated/entity-prompt-template-language.ts",
      "apps/api/src/generated/feature-requirements.schema.ts",
      "apps/api/src/generated/future-revision.schema.ts",
      "apps/api/src/generated/goal-pm-decision.schema.ts",
      "apps/api/src/generated/open-items.schemas.ts",
      "apps/api/src/generated/private-beta-access-request-decision.schema.ts",
      "apps/api/src/generated/private-beta-access-request-submission.schema.ts",
      "apps/api/src/generated/project-mode-contract.schema.ts",
      "apps/api/src/generated/project-report.schemas.ts",
      "apps/api/src/generated/proposal-reconciliation.schema.ts",
      "apps/api/src/generated/task-monitor-execution-definition.schema.ts",
      "apps/api/src/generated/workflow-review.schemas.ts",
      "apps/api/src/generated/api/path-constants.ts",
      "apps/api/src/generated/model",
      "apps/api/src/generated/local",
      "apps/api/src/generated/index.ts",
      "apps/api/src/generated/configuration.ts",
      "apps/api/src/generated/variables.ts",
      "apps/api/src/mcp/tools/report-schemas.generated.ts",
      "apps/api/src/contracts/repository-feature-enrichment-runtime-schema.ts",
    ],
  },
  {
    id: "api-agents",
    commands: [
      ["pnpm", "--dir", "apps/api", "run", "generate:agents:unlocked"],
    ],
    inputSpecs: ["specs/agents/openapi.yaml"],
    inputFiles: [
      "apps/api/openapitools.json",
      "apps/api/scripts/generate-openapi-models.js",
      "apps/api/scripts/post-process-agents-types.js",
      "apps/api/scripts/openapi-root.js",
    ],
    packageScripts: [
      { path: "apps/api/package.json", names: ["generate:agents:unlocked"] },
    ],
    toolPackages: [
      {
        path: "apps/api/package.json",
        names: ["@openapitools/openapi-generator-cli", "prettier"],
      },
    ],
    outputs: ["apps/api/src/generated/agents"],
  },
  {
    id: "api-embeddings",
    commands: [
      ["pnpm", "--dir", "apps/api", "run", "generate:embeddings:unlocked"],
    ],
    inputSpecs: ["specs/embeddings/openapi.yaml"],
    inputFiles: [
      "apps/api/openapitools.json",
      "apps/api/scripts/generate-embeddings-types.js",
      "apps/api/scripts/post-process-embeddings-types.ts",
      "apps/api/scripts/openapi-root.js",
    ],
    packageScripts: [
      {
        path: "apps/api/package.json",
        names: ["generate:embeddings:unlocked"],
      },
    ],
    toolPackages: [
      {
        path: "apps/api/package.json",
        names: ["@openapitools/openapi-generator-cli", "prettier"],
      },
    ],
    formatFiles: ["apps/api/.prettierrc", "apps/api/.prettierignore"],
    outputs: ["apps/api/src/generated/embeddings"],
  },
  {
    id: "api-graphs",
    commands: [
      ["pnpm", "--dir", "apps/api", "run", "generate:graphs:unlocked"],
    ],
    inputSpecs: ["specs/graphs/openapi.yaml"],
    inputFiles: [
      "apps/api/openapitools.json",
      "apps/api/scripts/generate-graphs-types.js",
      "apps/api/scripts/openapi-root.js",
      "apps/api/scripts/openapi-templates/typescript-nestjs-graphs/api.service.mustache",
    ],
    packageScripts: [
      { path: "apps/api/package.json", names: ["generate:graphs:unlocked"] },
    ],
    toolPackages: [
      {
        path: "apps/api/package.json",
        names: ["@openapitools/openapi-generator-cli", "prettier"],
      },
    ],
    formatFiles: ["apps/api/.prettierrc", "apps/api/.prettierignore"],
    outputs: ["apps/api/src/generated/graphs"],
  },
  {
    id: "api-event-schemas",
    dependsOn: ["contracts-api"],
    commands: [
      ["pnpm", "--dir", "packages/contracts", "run", "build:unlocked"],
      ["pnpm", "--dir", "apps/api", "run", "generate:event-schemas:unlocked"],
    ],
    inputSpecs: ["specs/api/openapi.yaml"],
    inputFiles: [
      "apps/api/scripts/generate-event-schemas.js",
      "apps/api/src/core/events/types/domain-events.ts",
      "apps/api/tsconfig.json",
      "packages/contracts/src/brands.ts",
      "packages/contracts/src/index.ts",
      "packages/contracts/tsconfig.cjs.json",
      "packages/contracts/tsconfig.esm.json",
      "packages/contracts/scripts/write-cjs-package.cjs",
    ],
    packageScripts: [
      {
        path: "apps/api/package.json",
        names: ["generate:event-schemas:unlocked"],
      },
      { path: "packages/contracts/package.json", names: ["build:unlocked"] },
    ],
    toolPackages: [
      { path: "apps/api/package.json", names: ["ts-json-schema-generator"] },
      { path: "packages/contracts/package.json", names: ["typescript"] },
    ],
    outputs: ["apps/api/schemas/events"],
  },
  {
    id: "ui-common",
    dependsOn: ["contracts-api", "contracts-agent-bridge", "contracts-local"],
    commands: [
      ["pnpm", "--dir", "packages/ui-common", "run", "generate:all:unlocked"],
    ],
    openapiFiles: [
      "scripts/generate-controller-action-contract.js",
      "scripts/generate-repository-feature-enrichment-runtime-schema.js",
      "specs/fixtures/entity-prompt-template-language-v1.json",
    ],
    inputFiles: [
      "packages/ui-common/scripts/generate-shared-contracts.cjs",
      "packages/ui-common/scripts/openapi-root.cjs",
      "packages/ui-common/scripts/generate-private-beta-access-contract.cjs",
      "packages/ui-common/scripts/generate-browser-session-contract.cjs",
      "packages/ui-common/scripts/generate-activity-history-contract.cjs",
      "packages/ui-common/scripts/generate-open-items-contract.cjs",
      "packages/ui-common/scripts/generate-entity-prompt-template-language.cjs",
      "scripts/entity-prompt-template-parser-source.cjs",
    ],
    // Browser controller-action schemas read Agent Bridge; the shared schema builders
    // are generated by contracts-agent-bridge and arrive through its output digest.
    inputSpecs: [
      "specs/api/openapi.yaml",
      "specs/local/openapi.yaml",
      "specs/agent-bridge/openapi.yaml",
    ],
    packageScripts: [
      {
        path: "packages/ui-common/package.json",
        names: ["generate:all:unlocked"],
      },
    ],
    toolPackages: [
      {
        path: "packages/ui-common/package.json",
        names: ["js-yaml", "prettier"],
      },
      { path: "openapi/package.json", names: ["js-yaml"] },
    ],
    formatFiles: [
      "packages/ui-common/.prettierrc",
      "packages/ui-common/.prettierignore",
    ],
    outputs: [
      "packages/ui-common/src/api",
      "packages/ui-common/src/generated",
      "packages/ui-common/src/local-agent-api/generated",
      "packages/ui-common/src/clients/private-beta-access-contract.generated.ts",
    ],
  },
  {
    id: "cli",
    dependsOn: ["contracts-api", "contracts-agent-bridge", "contracts-local"],
    commands: [["pnpm", "--dir", "apps/cli", "run", "generate:all:unlocked"]],
    inputSpecs: [
      "specs/api/openapi.yaml",
      "specs/agent-bridge/openapi.yaml",
      "specs/local/openapi.yaml",
    ],
    openapiFiles: [
      "scripts/generate-controller-action-contract.js",
      "scripts/generate-repository-feature-enrichment-runtime-schema.js",
      "specs/fixtures/entity-prompt-template-language-v1.json",
    ],
    inputFiles: [
      "apps/cli/scripts/generate-custom-contracts.cjs",
      "apps/cli/scripts/postprocess-generated-api.cjs",
      "apps/cli/scripts/openapi-root.cjs",
      "apps/cli/scripts/generate-entity-prompt-template-language.cjs",
      "scripts/entity-prompt-template-parser-source.cjs",
      "apps/cli/scripts/generate-report-error-schemas.cjs",
      "apps/api/scripts/generate-workflow-review-schemas.js",
    ],
    packageScripts: [
      { path: "apps/cli/package.json", names: ["generate:all:unlocked"] },
    ],
    toolPackages: [
      { path: "apps/cli/package.json", names: ["prettier"] },
      { path: "apps/api/package.json", names: ["js-yaml"] },
      { path: "openapi/package.json", names: ["js-yaml"] },
    ],
    formatFiles: ["apps/cli/.prettierrc.json"],
    outputs: [
      "apps/cli/src/generated",
      "apps/cli/src/shared/api/generated",
      "apps/cli/src/shared/agent-bridge-contract/generated",
      "apps/cli/src/shared/local-agent-api/generated",
    ],
  },
  {
    id: "graph-search",
    commands: [
      [
        "pnpm",
        "--dir",
        "apps/graph-search",
        "run",
        "generate:graph-contracts:unlocked",
      ],
    ],
    inputSpecs: ["specs/graphs/openapi.yaml"],
    inputFiles: [
      "apps/graph-search/scripts/generate-graph-models.cjs",
      "scripts/require-openapi-staging.cjs",
    ],
    toolPackages: [{ path: "apps/graph-search/package.json", names: ["yaml"] }],
    packageScripts: [
      {
        path: "apps/graph-search/package.json",
        names: ["generate:graph-contracts:unlocked"],
      },
    ],
    outputs: ["apps/graph-search/src/graph/generated/mod.rs"],
  },
];

const log = (message) =>
  process.stderr.write(`[generate:contracts] ${message}\n`);

const run = (
  [command, ...args],
  environment,
  cwd = checkoutRoot,
  overrides = {},
) => {
  const childEnvironment = { ...environment, ...overrides };
  const childRunner = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pidFile = process.env.HEY_HEY_OPENAPI_CHILD_PID_FILE;
if (pidFile) {
  try {
    fs.appendFileSync(pidFile, process.pid + '\\n');
    const owner = JSON.parse(fs.readFileSync(path.join(path.dirname(pidFile), 'owner.json'), 'utf8'));
    if (owner.token !== process.env.HEY_HEY_OPENAPI_LOCK_TOKEN) process.exit(1);
    try { process.kill(owner.pid, 0); }
    catch (error) { if (error.code !== 'EPERM') process.exit(1); }
  } catch { process.exit(1); }
}
const result = spawnSync(process.argv[1], process.argv.slice(2), { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`;
  const result = spawnSync(
    process.execPath,
    ["-e", childRunner, command, ...args],
    {
      cwd,
      env: childEnvironment,
      stdio: "inherit",
      detached: true,
    },
  );
  if (result.error) throw result.error;
  if (childEnvironment.HEY_HEY_OPENAPI_CHILD_PID_FILE) {
    pruneChildProcessGroups(childEnvironment.HEY_HEY_OPENAPI_CHILD_PID_FILE);
  }
  return result.status === 0;
};

const listFiles = (absolute) => {
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(absolute, entry.name)))
    .sort();
};

const digestOutputs = (outputs) => {
  return digestOutputsAt(checkoutRoot, outputs);
};

const digestOutputsAt = (root, outputs) => {
  const hash = createHash("sha256");
  for (const output of outputs) {
    for (const file of listFiles(path.join(root, output))) {
      hash.update(path.relative(root, file));
      hash.update("\0");
      hash.update(fs.readFileSync(file));
      hash.update("\n");
    }
  }
  return `sha256:${hash.digest("hex")}`;
};

const artifactDirectory = (target, inputDigest, dependencyDigests) => {
  const key = createHash("sha256")
    .update(JSON.stringify({ inputDigest, dependencyDigests }))
    .digest("hex");
  return path.join(os.tmpdir(), "hey-hey-openapi-artifacts", target.id, key);
};

const restoreArtifact = (
  target,
  inputDigest,
  dependencyDigests,
  stagingRoot,
) => {
  const directory = artifactDirectory(target, inputDigest, dependencyDigests);
  const metadataPath = path.join(directory, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    return false;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const artifactRoot = path.join(directory, "checkout");
    if (
      metadata.inputDigest !== inputDigest ||
      JSON.stringify(metadata.dependencyDigests) !==
        JSON.stringify(dependencyDigests) ||
      metadata.outputDigest !== digestOutputsAt(artifactRoot, target.outputs)
    ) {
      log(`${target.id}: cached artifact is corrupt; regenerating.`);
      return false;
    }

    for (const output of target.outputs) {
      const destination = path.join(stagingRoot, output);
      const source = path.join(artifactRoot, output);
      fs.rmSync(destination, { recursive: true, force: true });
      if (fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(source, destination, { recursive: true });
      }
    }
    log(`${target.id}: restored matching host artifact into private staging.`);
    return true;
  } catch (error) {
    if (!(error instanceof SyntaxError) && error.code !== "ENOENT") {
      throw error;
    }
    log(`${target.id}: cached artifact is incomplete; regenerating.`);
    return false;
  }
};

// Called only with verified published output while holding the host lock. The
// temporary directory and final artifact are on the same filesystem, so an
// interrupted cache write cannot expose a half-written reusable artifact.
const rememberArtifact = (target, generated) => {
  const dependencyDigests = generated.dependencyDigests ?? {};
  const directory = artifactDirectory(
    target,
    generated.inputDigest,
    dependencyDigests,
  );
  if (fs.existsSync(path.join(directory, "metadata.json"))) {
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(directory, "metadata.json"), "utf8"),
      );
      if (
        metadata.outputDigest === generated.outputDigest &&
        digestOutputsAt(path.join(directory, "checkout"), target.outputs) ===
          generated.outputDigest
      ) {
        return;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const temporary = fs.mkdtempSync(`${directory}.tmp-`);
  try {
    for (const output of target.outputs) {
      const source = path.join(checkoutRoot, output);
      if (fs.existsSync(source)) {
        const destination = path.join(temporary, "checkout", output);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(source, destination, { recursive: true });
      }
    }
    fs.writeFileSync(
      path.join(temporary, "metadata.json"),
      JSON.stringify({
        inputDigest: generated.inputDigest,
        dependencyDigests,
        outputDigest: generated.outputDigest,
      }),
    );
    fs.rmSync(directory, { recursive: true, force: true });
    fs.renameSync(temporary, directory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
};

const digestTargetInputs = (
  openapiRoot,
  target,
  projectRoot = checkoutRoot,
) => {
  const hash = createHash("sha256");
  const add = (name, content) => {
    hash.update(name);
    hash.update("\0");
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  };

  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  add("node-version", process.version);
  add("package-manager", rootPackage.packageManager ?? "unknown");
  for (const file of ["scripts/openapi-source.cjs"]) {
    add(`file:${file}`, fs.readFileSync(path.join(projectRoot, file)));
  }
  add(
    `target:${target.id}`,
    JSON.stringify({
      commands: target.commands,
      environment: target.env ?? {},
      dependencies: target.dependsOn ?? [],
      outputs: target.outputs,
    }),
  );
  for (const file of [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.cjs",
    ".prettierrc.js",
    "prettier.config.cjs",
    "prettier.config.js",
    "prettier.config.mjs",
    ".prettierignore",
  ]) {
    const absolute = path.join(projectRoot, file);
    if (fs.existsSync(absolute))
      add(`format:${file}`, fs.readFileSync(absolute));
  }

  for (const entrySpec of target.inputSpecs ?? []) {
    const digest = digestSpecClosure(openapiRoot, entrySpec);
    add(`openapi:${entrySpec}`, digest.closureDigest);
  }
  for (const file of target.openapiFiles ?? []) {
    const absolute = path.join(openapiRoot, file);
    if (!fs.existsSync(absolute)) {
      throw new Error(`OpenAPI generation input does not exist: ${file}`);
    }
    add(`openapi-file:${file}`, fs.readFileSync(absolute));
  }
  for (const file of target.inputFiles ?? []) {
    const absolute = path.join(projectRoot, file);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Generation input does not exist: ${file}`);
    }
    add(`file:${file}`, fs.readFileSync(absolute));
  }
  for (const file of target.formatFiles ?? []) {
    const absolute = path.join(projectRoot, file);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Formatting input does not exist: ${file}`);
    }
    add(`format:${file}`, fs.readFileSync(absolute));
  }
  for (const { path: packagePath, names } of target.packageScripts ?? []) {
    const absolute = path.join(projectRoot, packagePath);
    const packageJson = JSON.parse(fs.readFileSync(absolute, "utf8"));
    for (const name of names) {
      add(
        `script:${packagePath}:${name}`,
        packageJson.scripts?.[name] ?? "missing",
      );
    }
  }
  for (const { path: packagePath, names } of target.toolPackages ?? []) {
    const absolute = path.join(projectRoot, packagePath);
    const packageJson = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };
    for (const name of names) {
      add(`dependency:${packagePath}:${name}`, dependencies[name] ?? "missing");
    }
  }

  for (const [command, ...args] of target.toolCommands ?? []) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `Could not read generator tool version: ${command} ${args.join(" ")}`,
      );
    }
    add(
      `tool:${command}:${args.join(" ")}`,
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  if ((target.toolPackages ?? []).length > 0) {
    // `yaml` is a dependency of apps/graph-search only; pnpm does not hoist it
    // to the root, so resolve it from the package that declares it.
    const yaml = createRequire(
      path.join(projectRoot, "apps/graph-search/package.json"),
    )("yaml");
    const lockfile = yaml.parse(
      fs.readFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "utf8"),
    );
    const visited = new Set();
    const visitTool = (name, version) => {
      if (!version) return;
      const keyPrefix = `${name}@${version.split("(", 1)[0]}`;
      const snapshotKey = lockfile.snapshots[`${name}@${version}`]
        ? `${name}@${version}`
        : Object.keys(lockfile.snapshots).find((key) =>
            key.startsWith(keyPrefix),
          );
      if (!snapshotKey || visited.has(snapshotKey)) return;
      visited.add(snapshotKey);
      const packageKey = Object.keys(lockfile.packages).find((key) =>
        key.startsWith(keyPrefix),
      );
      add(
        `tool-lock:${snapshotKey}`,
        JSON.stringify({
          package: packageKey ? lockfile.packages[packageKey] : null,
          snapshot: lockfile.snapshots[snapshotKey],
        }),
      );
      const childDependencies =
        lockfile.snapshots[snapshotKey].dependencies ?? {};
      for (const [childName, childVersion] of Object.entries(
        childDependencies,
      )) {
        visitTool(childName, childVersion);
      }
    };

    for (const { path: packagePath, names } of target.toolPackages) {
      const importerPath = packagePath.replace(/\/package\.json$/, "") || ".";
      const importer = lockfile.importers[importerPath];
      for (const name of names) {
        const dependency =
          importer?.dependencies?.[name] ??
          importer?.devDependencies?.[name] ??
          importer?.optionalDependencies?.[name];
        add(
          `tool-importer:${importerPath}:${name}`,
          JSON.stringify(dependency ?? null),
        );
        visitTool(name, dependency?.version);
      }
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

const ignoredStageDirectories = new Set([
  ".boostgraph",
  ".git",
  ".next",
  ".turbo",
  ".vscode",
  ".tmp",
  ".worktrees",
  ".cache",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const createStagingCheckout = (stagingRoot, openapiRoot) => {
  fs.mkdirSync(stagingRoot, { recursive: true });
  const copyCheckout = (source, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (ignoredStageDirectories.has(entry.name)) continue;
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        copyCheckout(sourcePath, destinationPath);
      } else if (entry.isSymbolicLink()) {
        fs.symlinkSync(fs.readlinkSync(sourcePath), destinationPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }
  };
  copyCheckout(checkoutRoot, stagingRoot);

  const restoreDependencyLinks = (sourceDirectory, stagedDirectory) => {
    for (const entry of fs.readdirSync(sourceDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || ignoredStageDirectories.has(entry.name))
        continue;
      const sourceChild = path.join(sourceDirectory, entry.name);
      const stagedChild = path.join(stagedDirectory, entry.name);
      if (!fs.existsSync(stagedChild)) continue;
      restoreDependencyLinks(sourceChild, stagedChild);
    }

    const dependencies = path.join(sourceDirectory, "node_modules");
    if (fs.existsSync(dependencies)) {
      fs.symlinkSync(
        dependencies,
        path.join(stagedDirectory, "node_modules"),
        "dir",
      );
    }
  };

  restoreDependencyLinks(checkoutRoot, stagingRoot);
  const stagedOpenapiRoot = path.join(stagingRoot, "openapi");
  if (path.resolve(openapiRoot) !== path.join(checkoutRoot, "openapi")) {
    fs.rmSync(stagedOpenapiRoot, { recursive: true, force: true });
    copyCheckout(openapiRoot, stagedOpenapiRoot);
    restoreDependencyLinks(openapiRoot, stagedOpenapiRoot);
  }
  return stagedOpenapiRoot;
};

const publishOutputs = (target, stagingRoot, backupRoot) => {
  for (const output of target.outputs) {
    const live = path.join(checkoutRoot, output);
    const staged = path.join(stagingRoot, output);
    const retired = path.join(backupRoot, "retired", target.id, output);
    fs.mkdirSync(path.dirname(live), { recursive: true });
    if (fs.existsSync(live)) {
      fs.mkdirSync(path.dirname(retired), { recursive: true });
      fs.renameSync(live, retired);
    }
    try {
      if (fs.existsSync(staged)) fs.renameSync(staged, live);
    } catch (error) {
      if (fs.existsSync(retired)) fs.renameSync(retired, live);
      throw error;
    }
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

const writeOwnerState = (updates) => {
  const ownerPath = path.join(lockPath, "owner.json");
  const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  const temporaryPath = `${ownerPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify({ ...owner, ...updates })}\n`,
    {
      flag: "wx",
    },
  );
  fs.renameSync(temporaryPath, ownerPath);
};

const restoreInterruptedPublication = (publication) => {
  if (!publication) return;
  const {
    checkoutRoot: root,
    backupRoot,
    targets,
    previousRecordExists,
  } = publication;
  for (const target of targets) {
    for (const output of target.outputs) {
      const live = path.join(root, output);
      const saved = path.join(backupRoot, target.id, output);
      fs.rmSync(live, { recursive: true, force: true });
      if (fs.existsSync(saved)) fs.cpSync(saved, live, { recursive: true });
    }
  }

  const record = path.join(root, "generated-contracts.json");
  const previousRecord = path.join(
    backupRoot,
    "previous-generated-contracts.json",
  );
  if (previousRecordExists && fs.existsSync(previousRecord)) {
    fs.copyFileSync(previousRecord, record);
  } else {
    fs.rmSync(record, { force: true });
  }
};

const readRecord = () =>
  fs.existsSync(recordPath)
    ? JSON.parse(fs.readFileSync(recordPath, "utf8"))
    : null;

const verify = (requestedIds) => {
  const release = acquireLock();
  const selectedTargets = selectTargets(requestedIds);
  const environment = {
    ...process.env,
    HEY_HEY_OPENAPI_CHILD_PID_FILE: path.join(lockPath, "child.pids"),
    HEY_HEY_OPENAPI_LOCK_TOKEN: process.env.HEY_HEY_OPENAPI_LOCK_TOKEN,
  };
  try {
    const source = describeOpenapiSource();
    if (
      !run(
        [
          "node",
          path.join(
            source.openapiRoot,
            "scripts/check-controller-schema-composition.js",
          ),
        ],
        environment,
      )
    )
      return false;
    const record = readRecord();
    if (!record) {
      log("No generated-contracts.json record. Run pnpm generate:contracts.");
      return false;
    }
    const problems = [];
    for (const target of selectedTargets) {
      const recorded = record.targets[target.id];
      const inputDigest = digestTargetInputs(source.openapiRoot, target);
      if (!recorded || recorded.status !== "generated") {
        problems.push(
          `${target.id}: last generation ${recorded?.status ?? "missing"}.`,
        );
      } else if (recorded.inputDigest !== inputDigest) {
        problems.push(`${target.id}: generation inputs have changed.`);
      } else if (
        JSON.stringify(recorded.dependencyDigests ?? {}) !==
        JSON.stringify(dependencyOutputDigests(target, record.targets, true))
      ) {
        problems.push(
          `${target.id}: generated dependency outputs have changed.`,
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
  } finally {
    release();
  }
};

const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const ownerIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

const processGroupIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

const pruneChildProcessGroups = (pidFile) => {
  if (!fs.existsSync(pidFile)) return;
  const active = fs
    .readFileSync(pidFile, "utf8")
    .split(/\r?\n/)
    .map(Number)
    .filter((pid) => processGroupIsAlive(pid));
  fs.writeFileSync(pidFile, active.length > 0 ? `${active.join("\n")}\n` : "");
};

const recoverDeadOwner = () => {
  const ownerPath = path.join(lockPath, "owner.json");
  if (!fs.existsSync(ownerPath)) return false;

  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    return false;
  }
  let childProcessGroups = [];
  try {
    const groupsPath = path.join(lockPath, "child.pids");
    const legacyPath = path.join(lockPath, "child.pid");
    const contents = fs.readFileSync(
      fs.existsSync(groupsPath) ? groupsPath : legacyPath,
      "utf8",
    );
    childProcessGroups = contents
      .split(/\r?\n/)
      .map(Number)
      .filter(Number.isSafeInteger);
  } catch {}
  if (ownerIsAlive(owner.pid) || childProcessGroups.some(processGroupIsAlive))
    return false;

  if (owner.publication) {
    restoreInterruptedPublication(owner.publication);
    fs.rmSync(owner.publication.backupRoot, { recursive: true, force: true });
    log(
      `Restored the previous outputs after interrupted publication by pid ${owner.pid}.`,
    );
  }

  const abandonedPath = `${lockPath}.abandoned-${process.pid}-${randomUUID()}`;
  try {
    fs.renameSync(lockPath, abandonedPath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EEXIST") return true;
    throw error;
  }
  fs.rmSync(abandonedPath, { recursive: true, force: true });
  log(`Recovered abandoned lock from pid ${owner.pid}.`);
  return true;
};

const acquireLock = () => {
  const inheritedToken = process.env.HEY_HEY_OPENAPI_LOCK_TOKEN;
  if (inheritedToken) {
    try {
      const owner = JSON.parse(
        fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
      );
      if (owner.token === inheritedToken) {
        log(`Reusing the generation lock owned by pid ${owner.pid}.`);
        return () => {};
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
  }

  const token = randomUUID();
  for (;;) {
    const candidatePath = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
    try {
      // Publish a populated directory atomically: termination during preparation
      // leaves only a private candidate, never an ownerless shared lock.
      fs.mkdirSync(candidatePath);
      try {
        fs.writeFileSync(
          path.join(candidatePath, "owner.json"),
          `${JSON.stringify({ pid: process.pid, token, checkoutRoot, startedAt: new Date().toISOString() })}\n`,
          { flag: "wx" },
        );
        fs.renameSync(candidatePath, lockPath);
      } finally {
        fs.rmSync(candidatePath, { recursive: true, force: true });
      }
      process.env.HEY_HEY_OPENAPI_LOCK_TOKEN = token;
      log(`Generation lock acquired by pid ${process.pid}.`);
      return () => {
        try {
          const owner = JSON.parse(
            fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
          );
          if (owner.token === token)
            fs.rmSync(lockPath, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        } finally {
          if (process.env.HEY_HEY_OPENAPI_LOCK_TOKEN === token) {
            delete process.env.HEY_HEY_OPENAPI_LOCK_TOKEN;
          }
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
    }

    recoverDeadOwner();
    if (fs.existsSync(lockPath)) {
      let owner = "an active generation";
      try {
        const details = JSON.parse(
          fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
        );
        const childGroupsPath = path.join(lockPath, "child.pids");
        const legacyChildPath = path.join(lockPath, "child.pid");
        const childGroups = fs.existsSync(childGroupsPath)
          ? fs.readFileSync(childGroupsPath, "utf8").trim()
          : fs.existsSync(legacyChildPath)
            ? fs.readFileSync(legacyChildPath, "utf8").trim()
            : "";
        const child = childGroups
          ? `, active process groups ${childGroups.replace(/\n/g, ", ")}`
          : "";
        const progress = details.progress ? `, ${details.progress}` : "";
        owner = `pid ${details.pid} (${details.checkoutRoot}${child}${progress})`;
      } catch {
        owner = "a generation starting up";
      }
      log(`Waiting for ${owner} to release the host generation lock.`);
      pause(1000);
    }
  }
};

const dependencyOutputDigests = (
  target,
  results = {},
  usePublishedOutputs = false,
) =>
  Object.fromEntries(
    (target.dependsOn ?? []).map((dependency) => {
      if (!usePublishedOutputs) {
        return [dependency, results[dependency]?.outputDigest ?? null];
      }

      const dependencyTarget = TARGETS.find(({ id }) => id === dependency);
      if (!dependencyTarget) {
        throw new Error(`Unknown generation dependency: ${dependency}`);
      }
      return [dependency, digestOutputs(dependencyTarget.outputs)];
    }),
  );

const outputsMatchRecord = (record, inputDigests, targets = TARGETS) =>
  targets.every((target) => {
    const generated = record?.targets?.[target.id];
    const dependencies = dependencyOutputDigests(target, record?.targets, true);
    return (
      generated?.status === "generated" &&
      generated?.inputDigest === inputDigests.get(target.id) &&
      JSON.stringify(generated.dependencyDigests ?? {}) ===
        JSON.stringify(dependencies) &&
      digestOutputs(target.outputs) === generated.outputDigest
    );
  });

const selectTargets = (requestedIds) => {
  if (!requestedIds || requestedIds.length === 0) return TARGETS;
  const byId = new Map(TARGETS.map((target) => [target.id, target]));
  const selected = new Set();
  const include = (id) => {
    const target = byId.get(id);
    if (!target) throw new Error(`Unknown generation target: ${id}`);
    if (selected.has(id)) return;
    selected.add(id);
    for (const dependency of target.dependsOn ?? []) include(dependency);
  };
  for (const id of requestedIds) include(id);
  return TARGETS.filter((target) => selected.has(target.id));
};

const validateSelectedSpecs = (source, targets, environment) => {
  const specs = new Set(targets.flatMap((target) => target.inputSpecs ?? []));
  const names = new Map([
    ["specs/api/openapi.yaml", "api"],
    ["specs/agents/openapi.yaml", "agents"],
    ["specs/agent-bridge/openapi.yaml", "agent-bridge"],
    ["specs/local/openapi.yaml", "local"],
    ["specs/graphs/openapi.yaml", "graphs"],
    ["specs/embeddings/openapi.yaml", "embeddings"],
  ]);
  const selected = [...specs].map((spec) => {
    const name = names.get(spec);
    if (!name) throw new Error(`No validator is configured for ${spec}.`);
    return name;
  });

  for (const name of selected) {
    if (
      !run(
        ["npm", "run", `validate:${name}`, "--prefix", source.openapiRoot],
        environment,
      )
    ) {
      return false;
    }
  }

  if (specs.has("specs/api/openapi.yaml")) {
    const compositionCheck = path.join(
      source.openapiRoot,
      "scripts/check-controller-schema-composition.js",
    );
    if (
      fs.existsSync(compositionCheck) &&
      !run(["node", compositionCheck], environment)
    ) {
      return false;
    }
  }
  return true;
};

const hasCurrentLockToken = () => {
  const token = process.env.HEY_HEY_OPENAPI_LOCK_TOKEN;
  if (!token) return false;
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
    );
    return owner.token === token;
  } catch {
    return false;
  }
};

const withLock = (command, requestedIds, buildContracts) => {
  if (command.length === 0) {
    throw new Error(
      "Usage: generate-contracts.mjs --with-lock [--target=<id>] -- <command> [args...]",
    );
  }
  const inheritedLock = hasCurrentLockToken();
  const release = acquireLock();
  try {
    if (!inheritedLock && !verify(requestedIds)) return false;
    if (inheritedLock) {
      const result = spawnSync(command[0], command.slice(1), {
        cwd: checkoutRoot,
        env: process.env,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      return result.status === 0;
    }
    const environment = {
      ...process.env,
      HEY_HEY_OPENAPI_CHILD_PID_FILE: path.join(lockPath, "child.pids"),
    };
    if (
      buildContracts &&
      !run(
        ["pnpm", "--dir", "packages/contracts", "run", "build:unlocked"],
        environment,
      )
    ) {
      return false;
    }
    return run(command, environment);
  } finally {
    release();
  }
};

const generate = ({ check, requestedIds }) => {
  const invocationStartedAt = performance.now();
  const selectedTargets = selectTargets(requestedIds);
  const release = acquireLock();
  let backupRoot;
  try {
    // Waiters fingerprint only after acquiring the host lock. This makes a
    // request recheck completed artifacts against the source it will actually
    // generate from, even when that source changed while it was waiting.
    const source = describeOpenapiSource();
    const inputDigests = new Map(
      selectedTargets.map((target) => [
        target.id,
        digestTargetInputs(source.openapiRoot, target),
      ]),
    );
    log(
      `source=${source.openapiRoot} selection=${source.selection} revision=${source.revision ?? "none"}` +
        ` workingChanges=${source.workingChanges} closure=${source.closureDigest}`,
    );
    const environment = {
      ...process.env,
      HEY_HEY_OPENAPI_ROOT: source.openapiRoot,
      HEY_HEY_OPENAPI_STAGING: "1",
      HEY_HEY_OPENAPI_CHILD_PID_FILE: path.join(lockPath, "child.pids"),
      HEY_HEY_OPENAPI_LOCK_TOKEN: process.env.HEY_HEY_OPENAPI_LOCK_TOKEN,
    };
    const previous = readRecord();
    const forceGeneration = ["1", "true"].includes(
      String(process.env.HEY_HEY_FORCE_OPENAPI_GENERATION).toLowerCase(),
    );
    if (
      !forceGeneration &&
      outputsMatchRecord(previous, inputDigests, selectedTargets)
    ) {
      log(
        "Source identity and output digests match; reusing generated artifacts.",
      );
      for (const target of selectedTargets) {
        rememberArtifact(target, previous.targets[target.id]);
      }
      if (!check) return true;
      const paths = [
        "generated-contracts.json",
        ...selectedTargets.flatMap((target) => target.outputs),
      ];
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
      return true;
    }
    const temporaryRoot = path.join(checkoutRoot, ".tmp");
    fs.mkdirSync(temporaryRoot, { recursive: true });
    backupRoot = fs.mkdtempSync(
      path.join(temporaryRoot, "generate-contracts-"),
    );
    const stagingRoot = path.join(backupRoot, "checkout");
    const stagedOpenapiRoot = createStagingCheckout(
      stagingRoot,
      source.openapiRoot,
    );
    environment.HEY_HEY_OPENAPI_ROOT = stagedOpenapiRoot;
    environment.HEY_HEY_OPENAPI_STAGING_ROOT = stagingRoot;
    try {
      for (const target of selectedTargets) {
        if (
          digestTargetInputs(stagedOpenapiRoot, target, stagingRoot) !==
          inputDigests.get(target.id)
        ) {
          throw new Error(
            "Generation inputs changed while creating the private snapshot; retry generation.",
          );
        }
      }
      log("Validating selected OpenAPI specifications");
      writeOwnerState({ progress: "validating specifications" });
      const validationStartedAt = performance.now();
      if (
        !validateSelectedSpecs(
          { ...source, openapiRoot: stagedOpenapiRoot },
          selectedTargets,
          environment,
        )
      ) {
        log("OpenAPI validation failed; no target was generated.");
        return false;
      }
      log(
        `Selected specification validation finished in ${Math.round(performance.now() - validationStartedAt)}ms.`,
      );

      const results = { ...previous?.targets };
      const targetsToPublish = new Set();
      for (const target of selectedTargets) {
        const inputDigest = inputDigests.get(target.id);
        const generated = previous?.targets?.[target.id];
        const failedDependencies = (target.dependsOn ?? []).filter(
          (dependency) => results[dependency]?.status !== "generated",
        );
        if (failedDependencies.length > 0) {
          const dependencyDigests = dependencyOutputDigests(target, results);
          results[target.id] = {
            status: "blocked",
            inputDigest,
            outputDigest: generated?.outputDigest ?? null,
            dependencyDigests,
          };
          log(
            `${target.id} blocked because ${failedDependencies.join(", ")} did not generate successfully.`,
          );
          continue;
        }
        if (
          !forceGeneration &&
          generated?.status === "generated" &&
          generated.inputDigest === inputDigest &&
          JSON.stringify(generated.dependencyDigests ?? {}) ===
            JSON.stringify(dependencyOutputDigests(target, results)) &&
          digestOutputs(target.outputs) === generated.outputDigest
        ) {
          results[target.id] = generated;
          log(
            `${target.id}: cached inputs and output match; skipping generation.`,
          );
          continue;
        }

        const dependencyDigests = dependencyOutputDigests(target, results);
        if (
          !forceGeneration &&
          restoreArtifact(target, inputDigest, dependencyDigests, stagingRoot)
        ) {
          targetsToPublish.add(target.id);
          results[target.id] = {
            status: "generated",
            inputDigest,
            outputDigest: digestOutputsAt(stagingRoot, target.outputs),
            dependencyDigests,
          };
          continue;
        }

        log(`Generating ${target.id}`);
        writeOwnerState({ progress: `generating ${target.id}` });
        const generationStartedAt = performance.now();
        const targetEnvironment = { ...target.env };
        const succeeded = target.commands.every((command) =>
          run(command, environment, stagingRoot, targetEnvironment),
        );
        log(
          `${target.id} staging finished in ${Math.round(performance.now() - generationStartedAt)}ms.`,
        );
        if (succeeded) {
          const dependencyDigests = dependencyOutputDigests(target, results);
          targetsToPublish.add(target.id);
          results[target.id] = {
            status: "generated",
            inputDigest,
            outputDigest: digestOutputsAt(stagingRoot, target.outputs),
            dependencyDigests,
          };
        } else {
          const dependencyDigests = dependencyOutputDigests(target, results);
          results[target.id] = {
            status: "failed",
            inputDigest,
            outputDigest: previous?.targets?.[target.id]?.outputDigest ?? null,
            dependencyDigests,
          };
          log(`${target.id} failed; its previous outputs were restored.`);
        }
      }

      const changedTargets = selectedTargets.filter(
        (target) =>
          digestTargetInputs(source.openapiRoot, target) !==
          inputDigests.get(target.id),
      );
      if (changedTargets.length > 0) {
        log(
          `Generation inputs changed during execution (${changedTargets.map((target) => target.id).join(", ")}); private target outputs were discarded.`,
        );
        return false;
      }

      const publicationTargets = selectedTargets.filter((target) =>
        targetsToPublish.has(target.id),
      );
      for (const target of publicationTargets)
        backupOutputs(target, backupRoot);
      const previousRecordExists = fs.existsSync(recordPath);
      if (previousRecordExists) {
        fs.copyFileSync(
          recordPath,
          path.join(backupRoot, "previous-generated-contracts.json"),
        );
      }
      const publication = {
        checkoutRoot,
        backupRoot,
        previousRecordExists,
        targets: publicationTargets.map(({ id, outputs }) => ({ id, outputs })),
      };
      if (publicationTargets.length > 0) writeOwnerState({ publication });

      for (const target of publicationTargets) {
        const publicationStartedAt = performance.now();
        writeOwnerState({ progress: `publishing ${target.id}` });
        try {
          publishOutputs(target, stagingRoot, backupRoot);
          results[target.id].outputDigest = digestOutputs(target.outputs);
          log(
            `${target.id} publication and digest finished in ${Math.round(performance.now() - publicationStartedAt)}ms.`,
          );
        } catch (error) {
          restoreOutputs(target, backupRoot);
          results[target.id] = {
            status: "failed",
            inputDigest: inputDigests.get(target.id),
            outputDigest: previous?.targets?.[target.id]?.outputDigest ?? null,
          };
          log(
            `${target.id} publication failed; its previous outputs were restored: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const inputsChangedBeforeCommit = selectedTargets.filter(
        (target) =>
          digestTargetInputs(source.openapiRoot, target) !==
          inputDigests.get(target.id),
      );
      if (inputsChangedBeforeCommit.length > 0) {
        if (publicationTargets.length > 0) {
          restoreInterruptedPublication(publication);
          writeOwnerState({ publication: null });
        }
        log(
          `Generation inputs changed during publication (${inputsChangedBeforeCommit.map((target) => target.id).join(", ")}); prior outputs were restored.`,
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
      const recordTemporaryPath = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
      let recordFile;
      try {
        recordFile = fs.openSync(recordTemporaryPath, "wx");
        fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
        fs.fsyncSync(recordFile);
        fs.closeSync(recordFile);
        recordFile = undefined;
        fs.renameSync(recordTemporaryPath, recordPath);
      } catch (error) {
        if (recordFile !== undefined) fs.closeSync(recordFile);
        fs.rmSync(recordTemporaryPath, { force: true });
        if (publicationTargets.length > 0) {
          restoreInterruptedPublication(publication);
          writeOwnerState({ publication: null });
        }
        throw error;
      }
      if (publicationTargets.length > 0) writeOwnerState({ publication: null });

      for (const target of selectedTargets) {
        if (results[target.id]?.status === "generated") {
          rememberArtifact(target, results[target.id]);
        }
      }

      const failed = selectedTargets.filter(
        (target) => results[target.id]?.status !== "generated",
      );
      for (const target of selectedTargets)
        log(`${target.id}: ${results[target.id].status}`);
      if (failed.length > 0) return false;

      if (check) {
        const paths = [
          "generated-contracts.json",
          ...selectedTargets.flatMap((target) => target.outputs),
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
      log(
        `Generation invocation finished in ${Math.round(performance.now() - invocationStartedAt)}ms.`,
      );
      return true;
    } finally {
      if (backupRoot) fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  } finally {
    release();
  }
};

const mode = process.argv[2];
try {
  const separatorIndex = process.argv.indexOf("--");
  const targetArgument = process.argv.find((argument) =>
    argument.startsWith("--target="),
  );
  const buildContracts = process.argv.includes("--build-contracts");
  if (process.argv.includes("--postprocess-only")) {
    throw new Error(
      "Postprocessing alone cannot establish current contract generation. Run generation without --postprocess-only.",
    );
  }
  const requestedIds = targetArgument
    ? targetArgument.slice("--target=".length).split(",").filter(Boolean)
    : undefined;
  if (
    mode !== undefined &&
    mode !== "--check" &&
    mode !== "--verify" &&
    mode !== "--with-lock" &&
    !mode.startsWith("--target=")
  ) {
    throw new Error(
      "Usage: generate-contracts.mjs [--check|--verify|--target=<id>[,<id>...]] | --with-lock [--target=<id>[,<id>...]] -- <command> [args...]]",
    );
  }
  const ok =
    mode === "--with-lock"
      ? withLock(
          separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [],
          requestedIds,
          buildContracts,
        )
      : mode === "--verify"
        ? verify(requestedIds)
        : generate({
            check: mode === "--check",
            requestedIds,
          });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
