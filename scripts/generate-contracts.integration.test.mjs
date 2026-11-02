import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceCoordinator = path.join(
  repositoryRoot,
  "scripts/generate-contracts.mjs",
);
const sourceResolver = path.join(repositoryRoot, "scripts/openapi-source.cjs");
const targetFixture = `const TARGETS = [
  {
    id: "base",
    commands: [["node", "scripts/dependency.cjs"]],
    inputSpecs: ["specs/local/openapi.yaml"],
    inputFiles: ["scripts/dependency.cjs"],
    outputs: ["artifacts/base.txt"],
  },
  {
    id: "fixture",
    dependsOn: ["base"],
    commands: [
      ["node", "scripts/generator.cjs"],
      ["node", "scripts/postprocess.cjs"],
    ],
    inputSpecs: ["specs/local/openapi.yaml"],
    inputFiles: ["input.txt", "scripts/generator.cjs", "scripts/postprocess.cjs"],
    outputs: ["artifacts/contracts.txt", "artifacts/model.json"],
  },
];`;

const generatorSource = `const fs = require("node:fs");
const path = require("node:path");

const appendEvent = (event) => {
  if (process.env.EVENT_PATH) fs.appendFileSync(process.env.EVENT_PATH, event + "\\n");
};

const incrementInvocationCount = () => {
  const countPath = process.env.INVOCATION_COUNT;
  if (!countPath) return;
  const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : 0);
  fs.writeFileSync(countPath, String(count + 1));
};

const main = async () => {
  appendEvent("generator-start");
  if (process.env.GENERATION_STARTED_FILE) {
    fs.writeFileSync(process.env.GENERATION_STARTED_FILE, "started");
  }
  incrementInvocationCount();

  const delay = Number(process.env.GENERATOR_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (process.env.FAIL_GENERATION === "1") process.exit(17);

  const sharedSchema = fs.readFileSync(path.join(process.env.HEY_HEY_OPENAPI_ROOT ?? "openapi", "specs/common.yaml"), "utf8").trim();
  if (process.env.SCHEMA_READ_FILE) fs.writeFileSync(process.env.SCHEMA_READ_FILE, "read");
  const afterReadDelay = Number(process.env.AFTER_READ_DELAY_MS ?? 0);
  if (afterReadDelay > 0) await new Promise((resolve) => setTimeout(resolve, afterReadDelay));
  const input = fs.readFileSync("input.txt", "utf8").trim();
  const dependency = fs.readFileSync(path.join("artifacts", "base.txt"), "utf8").trim();
  const outputPath = path.join("artifacts", "contracts.txt");
  const modelPath = path.join("artifacts", "model.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, input + ":" + sharedSchema + ":" + dependency);
  fs.writeFileSync(modelPath, JSON.stringify({ input, sharedSchema, dependency }));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

const postprocessorSource = `const fs = require("node:fs");
const path = require("node:path");

if (process.env.FAIL_POSTPROCESS === "1") process.exit(19);

const outputPath = path.join("artifacts", "contracts.txt");
const output = fs.readFileSync(outputPath, "utf8");
fs.writeFileSync(outputPath, output + ":postprocessed");
const modelPath = path.join("artifacts", "model.json");
const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
fs.writeFileSync(modelPath, JSON.stringify({ ...model, postprocessed: true }));
`;

const dependencySource = `const fs = require("node:fs");
const path = require("node:path");
const outputPath = path.join("artifacts", "base.txt");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, "base-v1");
`;

const createFixture = (testContext, sandboxRoot, checkoutName = "checkout") => {
  const root = path.join(sandboxRoot, checkoutName);
  const openapiRoot = path.join(root, "openapi");
  const hostTempRoot = path.join(sandboxRoot, "host-tmp");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(openapiRoot, "specs/local"), { recursive: true });
  fs.mkdirSync(path.join(openapiRoot, "specs/api"), { recursive: true });
  fs.mkdirSync(path.join(openapiRoot, "scripts"), { recursive: true });
  fs.mkdirSync(hostTempRoot, { recursive: true });

  let coordinator = fs.readFileSync(sourceCoordinator, "utf8");
  const targetStart = coordinator.indexOf("const TARGETS = [");
  const targetEnd = coordinator.indexOf("\n];", targetStart) + 3;
  assert.notEqual(targetStart, -1, "coordinator target list should exist");
  assert.ok(targetEnd > targetStart, "coordinator target list should close");
  coordinator = `${coordinator.slice(0, targetStart)}${targetFixture}${coordinator.slice(targetEnd)}`;
  fs.writeFileSync(
    path.join(root, "scripts/generate-contracts.mjs"),
    coordinator,
  );
  fs.copyFileSync(
    sourceResolver,
    path.join(root, "scripts/openapi-source.cjs"),
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      { name: "contracts-fixture", packageManager: "pnpm@10.18.1" },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(root, "input.txt"), "initial-input\n");
  fs.writeFileSync(path.join(root, "scripts/generator.cjs"), generatorSource);
  fs.writeFileSync(
    path.join(root, "scripts/postprocess.cjs"),
    postprocessorSource,
  );
  fs.writeFileSync(path.join(root, "scripts/dependency.cjs"), dependencySource);
  fs.writeFileSync(
    path.join(openapiRoot, "package.json"),
    JSON.stringify({
      name: "contracts-fixture-openapi",
      scripts: { "validate:local": "node scripts/validate.cjs" },
    }),
  );
  fs.writeFileSync(
    path.join(openapiRoot, "scripts/validate.cjs"),
    "process.exit(0);\n",
  );
  fs.writeFileSync(
    path.join(openapiRoot, "scripts/check-controller-schema-composition.js"),
    "process.exit(0);\n",
  );
  fs.writeFileSync(
    path.join(openapiRoot, "specs/api/openapi.yaml"),
    "openapi: 3.0.3\ninfo:\n  title: fixture\n  version: 1\npaths: {}\n",
  );
  fs.writeFileSync(
    path.join(openapiRoot, "specs/local/openapi.yaml"),
    "openapi: 3.0.3\ninfo:\n  title: fixture local\n  version: 1\npaths: {}\ncomponents:\n  schemas:\n    Fixture:\n      $ref: ../common.yaml#/components/schemas/Fixture\n",
  );
  fs.writeFileSync(
    path.join(openapiRoot, "specs/common.yaml"),
    "components:\n  schemas:\n    Fixture:\n      type: string\n      description: shared-v1\n",
  );

  execFileSync("git", ["init", "-q", root]);
  testContext.after(() =>
    fs.rmSync(sandboxRoot, { recursive: true, force: true }),
  );
  return { root, openapiRoot, hostTempRoot };
};

const startCoordinator = (
  fixture,
  args = ["--target=fixture"],
  extraEnvironment = {},
) => {
  const child = spawn(
    process.execPath,
    [path.join(fixture.root, "scripts/generate-contracts.mjs"), ...args],
    {
      cwd: fixture.root,
      env: {
        ...process.env,
        TMPDIR: fixture.hostTempRoot,
        NODE_PATH: path.join(repositoryRoot, "openapi/node_modules"),
        INVOCATION_COUNT: path.join(fixture.root, "invocations.txt"),
        ...extraEnvironment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const outputWaiters = [];
  const appendOutput = (chunk) => {
    output += chunk;
    for (const { pattern, resolve } of outputWaiters) {
      if (pattern.test(output)) resolve(output);
    }
  };
  child.stdout.setEncoding("utf8").on("data", appendOutput);
  child.stderr.setEncoding("utf8").on("data", appendOutput);
  const completion = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal, output }));
  });
  const waitForOutput = (pattern) => {
    if (pattern.test(output)) return Promise.resolve(output);
    return new Promise((resolve) => outputWaiters.push({ pattern, resolve }));
  };
  return { child, completion, waitForOutput };
};

const runCoordinator = async (fixture, args, extraEnvironment) =>
  startCoordinator(fixture, args, extraEnvironment).completion;

const readInvocationCount = (fixture) =>
  Number(fs.readFileSync(path.join(fixture.root, "invocations.txt"), "utf8"));

const waitForFile = async (filePath) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
};

const makeSandbox = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "contracts-coordinator-test-"));

test("termination before writing ownership does not strand the host lock", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const crashHook = path.join(fixture.root, "crash-before-owner.cjs");
  fs.writeFileSync(
    crashHook,
    `
    const fs = require("node:fs");
    const path = require("node:path");
    const write = fs.writeFileSync;
    fs.writeFileSync = function (file, ...args) {
      if (path.basename(String(file)) === "owner.json") process.kill(process.pid, "SIGKILL");
      return write.call(this, file, ...args);
    };
  `,
  );
  const crashed = await runCoordinator(fixture, ["--target=fixture"], {
    NODE_OPTIONS: `--require=${crashHook}`,
  });
  assert.equal(crashed.signal, "SIGKILL");
  assert.equal(
    fs.existsSync(
      path.join(fixture.hostTempRoot, "hey-hey-openapi-generation.lock"),
    ),
    false,
  );
  const next = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(next.code, 0, next.output);
  assert.equal(readInvocationCount(fixture), 1);
});

test("reuses valid outputs and invalidates transitive refs or corrupted artifacts", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);
  assert.equal(readInvocationCount(fixture), 1);

  const unchanged = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(unchanged.code, 0, unchanged.output);
  assert.equal(readInvocationCount(fixture), 1);

  const valid = await runCoordinator(fixture, ["--verify", "--target=fixture"]);
  assert.equal(valid.code, 0, valid.output);

  fs.writeFileSync(
    path.join(fixture.openapiRoot, "specs/common.yaml"),
    "components:\n  schemas:\n    Fixture:\n      type: string\n      description: shared-v2\n",
  );
  const changedReference = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(changedReference.code, 0);
  assert.match(changedReference.output, /generation inputs have changed/);

  const regenerated = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(regenerated.code, 0, regenerated.output);
  assert.equal(readInvocationCount(fixture), 2);

  fs.writeFileSync(
    path.join(fixture.root, "artifacts/contracts.txt"),
    "corrupt",
  );
  const corrupted = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(corrupted.code, 0);
  assert.match(
    corrupted.output,
    /outputs differ from what generation produced/,
  );

  const repaired = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(repaired.code, 0, repaired.output);
  assert.equal(readInvocationCount(fixture), 2);
  assert.match(repaired.output, /restored matching host artifact/);
});

test("shares matching artifacts between checkouts and regenerates a corrupt cache", async (t) => {
  const sandbox = makeSandbox();
  const first = createFixture(t, sandbox, "first");
  const second = createFixture(t, sandbox, "second");
  const generated = await runCoordinator(first, ["--target=fixture"]);
  assert.equal(generated.code, 0, generated.output);

  const restored = await runCoordinator(second, ["--target=fixture"]);
  assert.equal(restored.code, 0, restored.output);
  assert.equal(fs.existsSync(path.join(second.root, "invocations.txt")), false);
  assert.equal(
    fs.readFileSync(path.join(first.root, "artifacts/contracts.txt"), "utf8"),
    fs.readFileSync(path.join(second.root, "artifacts/contracts.txt"), "utf8"),
  );

  const cacheRoot = path.join(
    first.hostTempRoot,
    "hey-hey-openapi-artifacts",
    "fixture",
  );
  const artifact = path.join(cacheRoot, fs.readdirSync(cacheRoot)[0]);
  fs.writeFileSync(
    path.join(artifact, "checkout/artifacts/contracts.txt"),
    "corrupt",
  );
  fs.writeFileSync(
    path.join(second.root, "artifacts/contracts.txt"),
    "corrupt",
  );
  const repaired = await runCoordinator(second, ["--target=fixture"]);
  assert.equal(repaired.code, 0, repaired.output);
  assert.equal(readInvocationCount(second), 1);
  assert.match(repaired.output, /cached artifact is corrupt/);

  fs.writeFileSync(path.join(artifact, "metadata.json"), "{");
  fs.writeFileSync(
    path.join(second.root, "artifacts/contracts.txt"),
    "corrupt again",
  );
  const repairedMetadata = await runCoordinator(second, ["--target=fixture"]);
  assert.equal(repairedMetadata.code, 0, repairedMetadata.output);
  assert.equal(readInvocationCount(second), 2);
});

test("serializes identical requests and generates the shared target once", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const first = startCoordinator(fixture, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "400",
  });
  const second = startCoordinator(fixture, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "400",
  });
  const results = await Promise.all([first.completion, second.completion]);

  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.equal(readInvocationCount(fixture), 1);
  assert.match(
    results.map(({ output }) => output).join("\n"),
    /reusing generated artifacts|cached inputs and output match/i,
  );
});

test("postprocessing alone cannot certify stale contracts against changed inputs", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);
  const recordPath = path.join(fixture.root, "generated-contracts.json");
  const originalRecord = fs.readFileSync(recordPath, "utf8");
  fs.writeFileSync(path.join(fixture.root, "input.txt"), "changed input\n");

  const rejected = await runCoordinator(fixture, [
    "--target=fixture",
    "--postprocess-only",
  ]);
  assert.notEqual(rejected.code, 0);
  assert.equal(fs.readFileSync(recordPath, "utf8"), originalRecord);
  const verified = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(verified.code, 0);
});

test("regenerates a dependent when a dependency publishes different output", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);
  assert.match(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    /base-v1/,
  );

  fs.writeFileSync(
    path.join(fixture.root, "scripts/dependency.cjs"),
    dependencySource.replace("base-v1", "base-v2"),
  );
  const regenerated = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(regenerated.code, 0, regenerated.output);
  assert.equal(readInvocationCount(fixture), 2);
  assert.match(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    /base-v2/,
  );
});

test("preserves last published output on failure and blocks consumers until recovery", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const first = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(first.code, 0, first.output);
  const priorOutput = fs.readFileSync(
    path.join(fixture.root, "artifacts/contracts.txt"),
    "utf8",
  );
  const priorModel = fs.readFileSync(
    path.join(fixture.root, "artifacts/model.json"),
    "utf8",
  );

  const failed = await runCoordinator(fixture, ["--target=fixture"], {
    FAIL_GENERATION: "1",
    HEY_HEY_FORCE_OPENAPI_GENERATION: "1",
  });
  assert.notEqual(failed.code, 0);
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    priorOutput,
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/model.json"), "utf8"),
    priorModel,
  );

  const blocked = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.output, /last generation failed/);

  const recovered = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(recovered.code, 0, recovered.output);
  assert.equal(
    (await runCoordinator(fixture, ["--verify", "--target=fixture"])).code,
    0,
  );
});

test("preserves last published output when a postprocessor fails", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const first = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(first.code, 0, first.output);
  const priorOutput = fs.readFileSync(
    path.join(fixture.root, "artifacts/contracts.txt"),
    "utf8",
  );
  const priorModel = fs.readFileSync(
    path.join(fixture.root, "artifacts/model.json"),
    "utf8",
  );

  const failed = await runCoordinator(fixture, ["--target=fixture"], {
    FAIL_POSTPROCESS: "1",
    HEY_HEY_FORCE_OPENAPI_GENERATION: "1",
  });
  assert.notEqual(failed.code, 0);
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    priorOutput,
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/model.json"), "utf8"),
    priorModel,
  );

  const blocked = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.output, /last generation failed/);
});

test("discards staged output when an input changes during generation", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const first = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(first.code, 0, first.output);
  const previousOutput = fs.readFileSync(
    path.join(fixture.root, "artifacts/contracts.txt"),
    "utf8",
  );
  const previousModel = fs.readFileSync(
    path.join(fixture.root, "artifacts/model.json"),
    "utf8",
  );
  const startedFile = path.join(fixture.root, "generation-started.txt");
  const generation = startCoordinator(fixture, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "700",
    GENERATION_STARTED_FILE: startedFile,
    HEY_HEY_FORCE_OPENAPI_GENERATION: "1",
  });

  await waitForFile(startedFile);
  fs.writeFileSync(
    path.join(fixture.root, "input.txt"),
    "changed-during-generation\n",
  );
  const discarded = await generation.completion;
  assert.notEqual(discarded.code, 0);
  assert.match(discarded.output, /inputs changed during execution/);
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    previousOutput,
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/model.json"), "utf8"),
    previousModel,
  );

  const regenerated = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(regenerated.code, 0, regenerated.output);
  assert.match(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    /^changed-during-generation:/,
  );
});

test("generates from a private source snapshot when live source changes and returns", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const first = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(first.code, 0, first.output);
  const outputPath = path.join(fixture.root, "artifacts/contracts.txt");
  const expected = fs.readFileSync(outputPath, "utf8");
  const schemaPath = path.join(fixture.openapiRoot, "specs/common.yaml");
  const original = fs.readFileSync(schemaPath, "utf8");
  const startedFile = path.join(fixture.root, "generation-started.txt");
  const readFile = path.join(fixture.root, "schema-read.txt");
  const generation = startCoordinator(fixture, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "700",
    AFTER_READ_DELAY_MS: "700",
    GENERATION_STARTED_FILE: startedFile,
    SCHEMA_READ_FILE: readFile,
    HEY_HEY_FORCE_OPENAPI_GENERATION: "1",
  });
  await waitForFile(startedFile);
  fs.writeFileSync(schemaPath, original + "\n# transient live edit\n");
  await waitForFile(readFile);
  fs.writeFileSync(schemaPath, original);
  const result = await generation.completion;
  assert.equal(result.code, 0, result.output);
  assert.equal(fs.readFileSync(outputPath, "utf8"), expected);
});

test("rechecks source identity after a waiting request acquires the host lock", async (t) => {
  const fixture = createFixture(t, makeSandbox());
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);

  const startedFile = path.join(fixture.root, "generation-started.txt");
  const owner = startCoordinator(fixture, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "1500",
    GENERATION_STARTED_FILE: startedFile,
    HEY_HEY_FORCE_OPENAPI_GENERATION: "1",
  });
  await waitForFile(startedFile);

  const waiter = startCoordinator(fixture, ["--target=fixture"]);
  await waiter.waitForOutput(/Waiting for pid/);
  fs.writeFileSync(
    path.join(fixture.root, "input.txt"),
    "changed-while-waiting\n",
  );

  const [ownerResult, waiterResult] = await Promise.all([
    owner.completion,
    waiter.completion,
  ]);
  assert.notEqual(ownerResult.code, 0, ownerResult.output);
  assert.equal(waiterResult.code, 0, waiterResult.output);
  assert.equal(readInvocationCount(fixture), 3);
  assert.match(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    /^changed-while-waiting:/,
  );
});

test("restores an interrupted publication before recovering a dead owner lock", async (t) => {
  const sandbox = makeSandbox();
  const fixture = createFixture(t, sandbox);
  const backupRoot = path.join(sandbox, "interrupted-publication");
  const savedOutput = path.join(backupRoot, "fixture/artifacts/contracts.txt");
  const savedModel = path.join(backupRoot, "fixture/artifacts/model.json");
  const savedBase = path.join(backupRoot, "base/artifacts/base.txt");
  fs.mkdirSync(path.dirname(savedOutput), { recursive: true });
  fs.mkdirSync(path.dirname(savedBase), { recursive: true });
  fs.writeFileSync(savedOutput, "previous-complete-output");
  fs.writeFileSync(savedModel, "previous-complete-model");
  fs.writeFileSync(savedBase, "previous-complete-base");
  fs.mkdirSync(path.join(fixture.root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture.root, "artifacts/contracts.txt"),
    "partial-new-output",
  );
  fs.writeFileSync(
    path.join(fixture.root, "artifacts/model.json"),
    "partial-new-model",
  );
  fs.writeFileSync(
    path.join(fixture.root, "artifacts/base.txt"),
    "partial-new-base",
  );

  const lockPath = path.join(
    fixture.hostTempRoot,
    "hey-hey-openapi-generation.lock",
  );
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "child.pids"), "");
  fs.writeFileSync(
    path.join(lockPath, "owner.json"),
    JSON.stringify({
      pid: 2_147_483_647,
      token: "abandoned-owner",
      checkoutRoot: fixture.root,
      publication: {
        checkoutRoot: fixture.root,
        backupRoot,
        previousRecordExists: false,
        targets: [
          { id: "base", outputs: ["artifacts/base.txt"] },
          {
            id: "fixture",
            outputs: ["artifacts/contracts.txt", "artifacts/model.json"],
          },
        ],
      },
    }),
  );

  const recovered = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.notEqual(
    recovered.code,
    0,
    "the fixture has no prior generation record",
  );
  assert.match(
    recovered.output,
    /Restored the previous outputs after interrupted publication/,
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    "previous-complete-output",
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/model.json"), "utf8"),
    "previous-complete-model",
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.root, "artifacts/base.txt"), "utf8"),
    "previous-complete-base",
  );
  assert.equal(fs.existsSync(lockPath), false);
});

test("waits for a recorded live generator process group before recovering a dead owner lock", async (t) => {
  const sandbox = makeSandbox();
  const fixture = createFixture(t, sandbox);
  const eventPath = path.join(sandbox, "events.txt");
  const startedFile = path.join(sandbox, "survivor-started.txt");
  const survivorDone = path.join(sandbox, "survivor-done.txt");
  const survivorSource = `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(startedFile)}, "started");
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(eventPath)}, "child-finished\\n");
  fs.writeFileSync(${JSON.stringify(survivorDone)}, "done");
}, 1500);
`;
  const survivor = spawn(process.execPath, ["-e", survivorSource], {
    detached: true,
    stdio: "ignore",
  });
  survivor.unref();
  await waitForFile(startedFile);

  const lockPath = path.join(
    fixture.hostTempRoot,
    "hey-hey-openapi-generation.lock",
  );
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "child.pids"), `${survivor.pid}\n`);
  fs.writeFileSync(
    path.join(lockPath, "owner.json"),
    JSON.stringify({
      pid: 2_147_483_647,
      token: "dead-owner-with-live-child",
      checkoutRoot: fixture.root,
    }),
  );

  const startedAt = Date.now();
  const contender = await runCoordinator(fixture, ["--target=fixture"], {
    EVENT_PATH: eventPath,
  });
  assert.equal(contender.code, 0, contender.output);
  assert.ok(
    Date.now() - startedAt >= 700,
    "the contender should wait while the child process group lives",
  );
  assert.ok(fs.existsSync(survivorDone));
  const events = fs.readFileSync(eventPath, "utf8").trim().split(/\r?\n/);
  assert.ok(
    events.indexOf("child-finished") < events.indexOf("generator-start"),
    events.join(", "),
  );
  assert.equal(readInvocationCount(fixture), 1);
});

test("owner cancellation preserves published output and waits for its surviving generator", async (t) => {
  const sandbox = makeSandbox();
  const fixture = createFixture(t, sandbox);
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);
  const outputPath = path.join(fixture.root, "artifacts/contracts.txt");
  const previousOutput = fs.readFileSync(outputPath, "utf8");
  fs.writeFileSync(
    path.join(fixture.root, "input.txt"),
    "after-cancellation\n",
  );
  const startedFile = path.join(sandbox, "cancelled-generator-started.txt");
  const owner = startCoordinator(fixture, ["--target=fixture"], {
    GENERATION_STARTED_FILE: startedFile,
    GENERATOR_DELAY_MS: "1500",
  });
  await waitForFile(startedFile);
  owner.child.kill("SIGKILL");

  // The child works only in staging even after its coordinator has exited.
  assert.equal(fs.readFileSync(outputPath, "utf8"), previousOutput);
  const replacement = startCoordinator(fixture, ["--target=fixture"]);
  const recovered = await replacement.completion;
  await owner.completion;
  assert.equal(recovered.code, 0, recovered.output);
  assert.match(recovered.output, /Waiting for/);
  assert.match(recovered.output, /Recovered abandoned lock/);
  assert.equal(readInvocationCount(fixture), 3);
  assert.match(fs.readFileSync(outputPath, "utf8"), /^after-cancellation:/);
  const verified = await runCoordinator(fixture, [
    "--verify",
    "--target=fixture",
  ]);
  assert.equal(verified.code, 0, verified.output);
});

test("an unregistered child cannot start generation after its owner exits", async (t) => {
  const sandbox = makeSandbox();
  const fixture = createFixture(t, sandbox);
  const initial = await runCoordinator(fixture, ["--target=fixture"]);
  assert.equal(initial.code, 0, initial.output);
  fs.writeFileSync(path.join(fixture.root, "input.txt"), "owner-exited\n");
  const marker = path.join(sandbox, "before-registration.txt");
  const preload = path.join(sandbox, "delay-registration.cjs");
  fs.writeFileSync(
    preload,
    `
if (process.argv[1] === 'node') {
  require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}
`,
  );
  const owner = startCoordinator(fixture, ["--target=fixture"], {
    NODE_OPTIONS: `--require=${preload}`,
  });
  await waitForFile(marker);
  owner.child.kill("SIGKILL");
  const replacement = await runCoordinator(fixture, ["--target=fixture"]);
  await owner.completion;
  assert.equal(replacement.code, 0, replacement.output);
  assert.equal(readInvocationCount(fixture), 2);
  assert.match(
    fs.readFileSync(path.join(fixture.root, "artifacts/contracts.txt"), "utf8"),
    /^owner-exited:/,
  );
});

test("keeps linked-worktree source identities and generated outputs isolated", async (t) => {
  const sandbox = makeSandbox();
  const main = createFixture(t, sandbox, "main-checkout");
  const worktreeRoot = path.join(sandbox, "linked-worktree");
  execFileSync("git", [
    "-C",
    main.root,
    "config",
    "user.name",
    "Contracts Test",
  ]);
  execFileSync("git", [
    "-C",
    main.root,
    "config",
    "user.email",
    "contracts-test@example.invalid",
  ]);
  execFileSync("git", ["-C", main.root, "add", "."]);
  execFileSync("git", ["-C", main.root, "commit", "-qm", "fixture baseline"]);
  execFileSync("git", [
    "-C",
    main.root,
    "worktree",
    "add",
    "-q",
    "-b",
    "fixture-linked",
    worktreeRoot,
  ]);

  const linked = {
    ...main,
    root: worktreeRoot,
    openapiRoot: path.join(worktreeRoot, "openapi"),
  };
  fs.writeFileSync(path.join(main.root, "input.txt"), "main-source\n");
  fs.writeFileSync(path.join(linked.root, "input.txt"), "linked-source\n");
  const first = startCoordinator(main, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "400",
  });
  const second = startCoordinator(linked, ["--target=fixture"], {
    GENERATOR_DELAY_MS: "400",
  });
  const results = await Promise.all([first.completion, second.completion]);

  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.match(
    fs.readFileSync(path.join(main.root, "artifacts/contracts.txt"), "utf8"),
    /^main-source:/,
  );
  assert.match(
    fs.readFileSync(path.join(linked.root, "artifacts/contracts.txt"), "utf8"),
    /^linked-source:/,
  );
  assert.equal(readInvocationCount(main), 1);
  assert.equal(readInvocationCount(linked), 1);
});
