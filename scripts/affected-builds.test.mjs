import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readDependents, selectAffected } from "./affected-builds.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "affected-builds.mjs",
);
const ALL = ["ui-common", "ui", "api", "cli", "openapi"];

const select = (...files) => selectAffected(files);

test("a UI-only change selects the UI checks and UI image", () => {
  const result = select("apps/ui/src/pages/Project/ProjectPage.tsx");
  assert.deepEqual(result.targets, ["ui"]);
  assert.deepEqual(result.images, ["ui"]);
  assert.equal(result.externalConsumerHandoff, false);
});

test("an API-only change selects the API checks and API image", () => {
  const result = select("apps/api/db/flyway/V1__init.sql");
  assert.deepEqual(result.targets, ["api"]);
  assert.deepEqual(result.images, ["api"]);
});

test("a UI Common change reaches every package that depends on it", () => {
  const result = select("packages/ui-common/src/index.ts");
  // The CLI still depends on UI Common directly; its checks follow until that
  // dependency is removed from its manifest.
  assert.deepEqual(result.targets, ["ui-common", "ui", "cli"]);
  assert.deepEqual(result.images, ["ui"]);
  assert.ok(result.checks.some(({ target }) => target === "cli"));
});

test("an OpenAPI change selects every target and the external handoff", () => {
  const result = select("openapi/specs/schemas/proposals.yaml");
  assert.deepEqual(result.targets, ALL);
  assert.deepEqual(result.images, ["ui", "api"]);
  assert.equal(result.externalConsumerHandoff, true);
});

for (const file of [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  ".nvmrc",
  ".dockerignore",
  "generated-contracts.json",
  "scripts/generate-contracts.mjs",
  ".github/workflows/images.yml",
  "an-unrecognised-root-file",
]) {
  test(`root build input ${file} selects every target`, () => {
    const result = select(file);
    assert.deepEqual(result.targets, ALL);
    assert.deepEqual(result.images, ["ui", "api"]);
  });
}

test("documentation alone selects nothing", () => {
  const result = select("README.md", "docs/architecture.md");
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.checks, []);
  assert.deepEqual(result.images, []);
});

test("dependents come from the workspace manifests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "affected-builds-"));
  const write = (directory, manifest) => {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(
      path.join(root, directory, "package.json"),
      JSON.stringify(manifest),
    );
  };
  try {
    write("packages/ui-common", { name: "@hey-hey/ui-common" });
    write("apps/ui", {
      name: "hey-hey",
      dependencies: { "@hey-hey/ui-common": "workspace:*" },
    });
    write("apps/api", { name: "hey-hey-api" });
    // A CLI that no longer depends on UI Common is no longer selected by it.
    write("apps/cli", { name: "@hey-hey/cli" });
    write("openapi", { name: "hey-hey-openapi" });
    const result = selectAffected(
      ["packages/ui-common/src/index.ts"],
      readDependents(root),
    );
    assert.deepEqual(result.targets, ["ui-common", "ui"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing base revision selects every target", () => {
  const output = execFileSync(
    process.execPath,
    [script, "--base", "0000000000000000000000000000000000000000"],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output).targets, ALL);
});

test("GitHub outputs carry the selection for workflow jobs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "affected-output-"));
  const outputFile = path.join(directory, "output");
  try {
    execFileSync(
      process.execPath,
      [script, "--github-output", "--", "apps/api/src/main.ts"],
      { env: { ...process.env, GITHUB_OUTPUT: outputFile }, encoding: "utf8" },
    );
    const lines = fs.readFileSync(outputFile, "utf8").trim().split("\n");
    assert.deepEqual(lines, [
      'targets=["api"]',
      'checks=[{"target":"api","command":"pnpm --filter hey-hey-api typecheck"}]',
      'images=["api"]',
      "external_consumer_handoff=false",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
