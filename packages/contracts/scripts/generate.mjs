#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveOpenapiRoot } = require("../../../scripts/openapi-source.cjs");
const postprocessModelBarrels = require("./postprocess-model-barrels.cjs");
const postprocessAllOfOverrides = require("./postprocess-allof-overrides.cjs");
const postprocessInterfaceIntersections = require("./postprocess-interface-intersections.cjs");
const checkoutRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliRoot = path.join(checkoutRoot, "apps/cli");
const openapiRoot = resolveOpenapiRoot();
const generatedRoot = path.resolve(
  process.env.HEY_HEY_GENERATED_ROOT ??
    path.join(checkoutRoot, "packages/contracts/src/generated"),
);
const axiosProperties = [
  "supportsES6=true",
  "withInterfaces=true",
  "modelPropertyNaming=camelCase",
  "typescriptThreePlus=true",
  "useSingleRequestParameter=true",
  "withSeparateModelsAndApi=true",
  "modelPackage=models",
  "apiPackage=apis",
].join(",");
const globalProperties = [
  "apiDocs=false",
  "modelDocs=false",
  // The generator defaults to 200 names with five-second expiry. Large
  // specifications otherwise repeatedly sanitize and camelize the same names.
  "org.openapitools.codegen.utils.namecache.cachesize=100000",
  "org.openapitools.codegen.utils.namecache.expireafter.seconds=3600",
].join(",");

const postprocessQuerySerialization = (directory) => {
  const activityApi = path.join(
    directory,
    "apis",
    "activity-correlation-api.ts",
  );
  const original = fs.readFileSync(activityApi, "utf8");
  const generatedAssignment =
    "localVarQueryParameter['historyFilter'] = historyFilter;";
  const jsonAssignment =
    "localVarQueryParameter['historyFilter'] = JSON.stringify(historyFilter);";
  if (!original.includes(jsonAssignment)) {
    if (!original.includes(generatedAssignment)) {
      throw new Error("Generated activity history query parameter is missing.");
    }
    fs.writeFileSync(
      activityApi,
      original.replace(generatedAssignment, jsonAssignment),
    );
  }
};

const run = (command, args, cwd = checkoutRoot) => {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const warnings = output
    .split(/\r?\n/)
    .filter((line) => /^\[main\]\s+(?:WARN|ERROR)\b/.test(line));
  const inputIndex = args.indexOf("-i");
  const label =
    inputIndex >= 0
      ? path.basename(path.dirname(args[inputIndex + 1]))
      : path.basename(args.at(-1) ?? command);
  process.stdout.write(
    `[contracts] ${label} finished in ${Math.round(performance.now() - startedAt)}ms; ${warnings.length} generator warnings.\n`,
  );
  for (const warning of [...new Set(warnings)].slice(0, 10)) {
    process.stderr.write(`[contracts] ${warning}\n`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(output.split(/\r?\n/).slice(-60).join("\n"));
    throw new Error(`${command} exited with status ${result.status ?? 1}.`);
  }
};

const copyTypeScript = (source, destination) => {
  fs.rmSync(destination, { recursive: true, force: true });
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = path.join(directory, entry.name);
      const relativePath = path.relative(source, sourcePath);
      const destinationPath = path.join(destination, relativePath);
      if (entry.isDirectory()) {
        visit(sourcePath);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }
  };
  fs.mkdirSync(destination, { recursive: true });
  visit(source);
};

const targets = [
  { id: "api", spec: "api/openapi.yaml", destination: "api" },
  {
    id: "agent-bridge",
    spec: "agent-bridge/openapi.yaml",
    destination: "agent-bridge",
  },
  { id: "local", spec: "local/openapi.yaml", destination: "local" },
];
const requestedTargets = process.env.HEY_HEY_CONTRACTS_TARGETS
  ? new Set(process.env.HEY_HEY_CONTRACTS_TARGETS.split(","))
  : null;
const selectedTargets = requestedTargets
  ? targets.filter((target) => requestedTargets.has(target.id))
  : targets;
if (requestedTargets && selectedTargets.length !== requestedTargets.size) {
  throw new Error(
    `Unknown contracts target: ${[...requestedTargets].join(", ")}`,
  );
}

for (const target of selectedTargets) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `hey-hey-contracts-${target.id}-`),
  );
  try {
    run("pnpm", [
      "--dir",
      cliRoot,
      "exec",
      "openapi-generator-cli",
      "generate",
      "-i",
      path.join(openapiRoot, "specs", target.spec),
      "-g",
      "typescript-axios",
      "-o",
      temporaryRoot,
      `--additional-properties=${axiosProperties}`,
      `--global-property=${globalProperties}`,
      "--inline-schema-options",
      "REFACTOR_ALLOF_INLINE_SCHEMAS=true",
    ]);
    run("pnpm", [
      "--dir",
      cliRoot,
      "exec",
      "bash",
      "scripts/postprocess-generated-api.sh",
      temporaryRoot,
    ]);
    run("node", [
      path.join(
        checkoutRoot,
        "packages/ui-common/scripts/align-cli-source-types.cjs",
      ),
      temporaryRoot,
    ]);
    if (target.id === "api") {
      postprocessQuerySerialization(temporaryRoot);
    }
    copyTypeScript(temporaryRoot, path.join(generatedRoot, target.destination));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

for (const target of selectedTargets) {
  postprocessModelBarrels(
    path.join(generatedRoot, target.destination),
    target.destination,
  );
}

for (const target of selectedTargets) {
  const customRoot = path.join(generatedRoot, target.destination, "custom");
  if (target.id === "api") {
    run("node", [
      path.join(
        openapiRoot,
        "scripts/generate-proposal-reconciliation-schema.js",
      ),
      path.join(customRoot, "proposal-reconciliation.schema.ts"),
    ]);
  }

  if (target.id === "agent-bridge") {
    run("node", [
      path.join(openapiRoot, "scripts/task-monitor-contract.js"),
      "--validate-fixture",
      "--typescript-output",
      path.join(customRoot, "task-monitor-contract.schema.ts"),
    ]);
    run("node", [
      path.join(openapiRoot, "scripts/project-mode-contract.js"),
      "--typescript-output",
      path.join(customRoot, "project-mode-contract.schema.ts"),
    ]);
  }
}

if (selectedTargets.some((target) => target.id === "agent-bridge")) {
  const runtimeSchemaGenerator = path.join(
    openapiRoot,
    "scripts/generate-repository-feature-enrichment-runtime-schema.js",
  );
  const { generateRuntimeSchema } = require(runtimeSchemaGenerator);
  await generateRuntimeSchema([
    path.join(
      generatedRoot,
      "agent-bridge/repository-feature-enrichment-runtime-schema.ts",
    ),
  ]);
}
run("node", [
  path.join(checkoutRoot, "packages/contracts/scripts/postprocess-brands.cjs"),
  generatedRoot,
  selectedTargets.map((target) => target.destination).join(","),
]);
for (const target of selectedTargets) {
  if (target.id === "api" || target.id === "agent-bridge") {
    postprocessAllOfOverrides(
      path.join(generatedRoot, target.destination),
      openapiRoot,
    );
  }
  const rewrittenCount = postprocessInterfaceIntersections(
    path.join(generatedRoot, target.destination, "models"),
  );
  process.stdout.write(
    `[contracts] ${target.id}: rewrote ${rewrittenCount} multi-parent model interfaces.\n`,
  );
}
