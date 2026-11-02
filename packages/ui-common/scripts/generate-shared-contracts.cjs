const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const { resolveOpenapiRoot } = require("../../../scripts/openapi-source.cjs");

if (process.env.HEY_HEY_OPENAPI_STAGING !== "1") {
  throw new Error(
    "Custom contract generation must run through the contracts coordinator.",
  );
}

const run = (command, args, cwd = packageRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status ?? 1}.`,
    );
  }
};

const apiRoot = path.join(packageRoot, "src/api");
fs.rmSync(apiRoot, { recursive: true, force: true });
fs.mkdirSync(apiRoot, { recursive: true });
fs.writeFileSync(
  path.join(apiRoot, "api.ts"),
  "export * from '@hey-hey/contracts/api';\n",
);
fs.writeFileSync(path.join(apiRoot, "index.ts"), "export * from './api';\n");
fs.rmSync(path.join(packageRoot, "src/local-agent-api/generated"), {
  recursive: true,
  force: true,
});
for (const obsoleteSchema of [
  "src/generated/task-monitor-contract.schema.ts",
  "src/generated/project-mode-contract.schema.ts",
]) {
  fs.rmSync(path.join(packageRoot, obsoleteSchema), { force: true });
}

const openapiScripts = path.join(resolveOpenapiRoot(), "scripts");
run(process.execPath, ["scripts/generate-entity-prompt-template-language.cjs"]);
run(process.execPath, ["scripts/generate-private-beta-access-contract.cjs"]);
run(process.execPath, ["scripts/generate-browser-session-contract.cjs"]);
run(process.execPath, ["scripts/generate-activity-history-contract.cjs"]);
run(process.execPath, ["scripts/generate-open-items-contract.cjs"]);
runOpenapi("generate-controller-action-contract.js", [
  "--browser",
  "src/generated/controller-action-inputs.ts",
  "@hey-hey/contracts/api/models",
]);
run("pnpm", [
  "exec",
  "prettier",
  "--write",
  "src/api",
  "src/generated",
  "src/clients/private-beta-access-contract.generated.ts",
]);

function runOpenapi(name, args) {
  run(process.execPath, [path.join(openapiScripts, name), ...args]);
}
