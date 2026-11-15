import { test } from "node:test";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { candidateSelection } from "./image-candidate-selection.mjs";
import { publicationEvidence } from "./image-publication-evidence.mjs";
const push = {
  event: "push",
  before: "a".repeat(40),
  revision: "b".repeat(40),
};
test("release pushes always select the complete CLI image bundle", () => {
  for (const ref of [
    "refs/heads/release/2026-11-11",
    "refs/heads/release-1-3-2",
  ]) {
    for (const files of [[], ["CHANGELOG.md"], ["apps/api/src/a.ts"]]) {
      assert.deepEqual(
        candidateSelection({ ...push, ref }, () => files).images,
        ["ui", "api", "graph-search"],
      );
    }
  }
});

test("release builds merge both architectures and declare them in the CLI manifest", () => {
  const workflow = fs.readFileSync(
    new URL("../.github/workflows/publish-images.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /REF: \$\{\{ github.ref \}\}/);
  assert.match(
    workflow,
    /platform: .*startsWith\(github.ref, 'refs\/heads\/release\/'\).*\["linux\/amd64","linux\/arm64"\]/,
  );
  assert.match(workflow, /EXPECTED_PLATFORMS: .*&& '2' \|\| '1'/);
  assert.match(
    workflow,
    /REQUIRED_ARCHITECTURES: .*&& 'amd64 arm64' \|\| 'amd64'/,
  );
  assert.match(
    workflow,
    /RELEASE_IMAGE_PLATFORMS: .*&& '\["linux\/amd64","linux\/arm64"\]' \|\| '\["linux\/amd64"\]'/,
  );
  for (const key of [
    "platform",
    "EXPECTED_PLATFORMS",
    "REQUIRED_ARCHITECTURES",
    "RELEASE_IMAGE_PLATFORMS",
  ]) {
    const line = workflow
      .split("\n")
      .find((line) => line.trim().startsWith(`${key}:`));
    assert.ok(
      line?.includes(
        "startsWith(github.ref, 'refs/heads/release/') || startsWith(github.ref, 'refs/heads/release-')",
      ),
    );
  }
});

test("CLI publication accepts both release conventions and rejects other refs", () => {
  const workflow = fs.readFileSync(
    new URL("../.github/workflows/release-cli.yml", import.meta.url),
    "utf8",
  );
  const guard = workflow.match(/run: '(\[\[ .* \]\])'/)?.[1];
  assert.ok(guard);

  for (const ref of [
    "refs/heads/release/2026-11-11",
    "refs/heads/release-1-3-2",
  ]) {
    execFileSync("bash", ["-c", guard], { env: { ...process.env, REF: ref } });
  }

  for (const ref of [
    "refs/heads/dev",
    "refs/heads/main",
    "refs/tags/release-1-3-2",
    "refs/heads/release-",
  ]) {
    assert.throws(() =>
      execFileSync("bash", ["-c", guard], {
        env: { ...process.env, REF: ref },
      }),
    );
  }
});

test("the CLI manifest writer and verifier preserve all image digests and both architectures", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-manifest-"));
  const cliRoot = fileURLToPath(new URL("../apps/cli/", import.meta.url));
  const references = Object.fromEntries(
    ["api", "ui", "graphSearch", "postgres", "redis"].map((image, index) => [
      image,
      `example.test/${image.toLowerCase()}@sha256:${String(index + 1).repeat(64)}`,
    ]),
  );
  const platforms = ["linux/amd64", "linux/arm64"];
  const digestsFile = path.join(directory, "digests.json");
  const manifestFile = path.join(directory, "release-manifest.json");
  fs.writeFileSync(digestsFile, JSON.stringify(references));
  try {
    const tsx = path.join(cliRoot, "node_modules", ".bin", "tsx");
    execFileSync(
      tsx,
      ["scripts/write-release-manifest.ts", digestsFile, manifestFile],
      {
        cwd: cliRoot,
        env: {
          ...process.env,
          RELEASE_IMAGE_PLATFORMS: JSON.stringify(platforms),
        },
      },
    );
    execFileSync(tsx, ["scripts/verify-release-manifest.ts", manifestFile], {
      cwd: cliRoot,
    });
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const cliPackage = JSON.parse(
      fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
    );
    assert.equal(manifest.cliVersion, cliPackage.version);
    assert.deepEqual(
      manifest.images,
      Object.fromEntries(
        Object.entries(references).map(([image, reference]) => [
          image,
          { reference, platforms },
        ]),
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("manual runs select images regardless of branch", () => {
  assert.deepEqual(
    candidateSelection({ ...push, event: "workflow_dispatch", target: "API" })
      .images,
    ["api"],
  );
});
test("push selection uses exact endpoints and handles empty and missing history", () => {
  assert.deepEqual(
    candidateSelection(push, (base, head) => {
      assert.equal(base, push.before);
      assert.equal(head, push.revision);
      return ["apps/ui/src/a.ts"];
    }).images,
    ["ui"],
  );
  assert.deepEqual(
    candidateSelection({ ...push, before: "0".repeat(40) }).images,
    ["ui", "api", "graph-search"],
  );
  assert.deepEqual(
    candidateSelection(push, () => {
      throw new Error("missing");
    }).images,
    ["ui", "api", "graph-search"],
  );
  assert.deepEqual(
    candidateSelection(push, () => ["packages/ui-common/src/a.ts"]).targets,
    ["ui-common", "ui", "cli"],
  );
  for (const file of ["openapi/a.yaml", "pnpm-lock.yaml"])
    assert.deepEqual(candidateSelection(push, () => [file]).images, [
      "ui",
      "api",
      "graph-search",
    ]);
});
test("publication evidence preserves the verified build and refuses missing smoke or digest", () => {
  const built = {
    image: "ui",
    intendedRepository: "ghcr.io/zsutton00/ui-service",
    localImageId: "sha256:local",
    source: { revision: push.revision, workingChanges: false },
    inputs: { lockfile: "same" },
    published: false,
  };
  assert.throws(() =>
    publicationEvidence(built, "published", `sha256:${"c".repeat(64)}`),
  );
  const verified = publicationEvidence(built, "verified");
  assert.equal(verified.published, false);
  assert.throws(() => publicationEvidence(verified, "published", ""));
  const published = publicationEvidence(
    verified,
    "published",
    `sha256:${"c".repeat(64)}`,
  );
  assert.equal(published.localImageId, built.localImageId);
  assert.equal(published.source.revision, push.revision);
  assert.equal(
    published.immutableReference,
    `${built.intendedRepository}@sha256:${"c".repeat(64)}`,
  );
});
test("single workflow gates publication on one build and smoke", () => {
  const workflow = fs.readFileSync(
    new URL("../.github/workflows/publish-images.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /branches: \["release\/\*\*", "release-\*\*"\]/);
  assert.match(workflow, /needs: select\n/);
  assert.match(workflow, /outputs.images != '\[\]'/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(
    (workflow.match(/uses: docker\/build-push-action/g) ?? []).length,
    1,
  );
  assert.match(workflow, /push: false\n          load: true/);
  assert.ok(
    workflow.indexOf("Check API runtime") <
      workflow.indexOf("docker/login-action"),
  );
  assert.ok(
    workflow.indexOf("Record verified build") <
      workflow.indexOf("Publish image"),
  );
  assert.match(workflow, /set -euo pipefail/);
});

test("manual retries can select graph/search while Both keeps its existing scope", () => {
  assert.deepEqual(
    candidateSelection({
      ...push,
      event: "workflow_dispatch",
      target: "Graph Search",
    }).images,
    ["graph-search"],
  );
  assert.deepEqual(
    candidateSelection({ ...push, event: "workflow_dispatch", target: "Both" })
      .images,
    ["ui", "api"],
  );
  assert.deepEqual(
    candidateSelection({ ...push, event: "workflow_dispatch", target: "All" })
      .images,
    ["ui", "api", "graph-search"],
  );
});

test("CLI staging requires human npm approval before public verification", () => {
  const require = createRequire(import.meta.url);
  const yaml = require("../openapi/node_modules/js-yaml");
  const workflow = yaml.load(
    fs.readFileSync(
      new URL("../.github/workflows/release-cli.yml", import.meta.url),
      "utf8",
    ),
  );
  const jobs = workflow.jobs;
  assert.equal(jobs.approve.if, "inputs.operation == 'stage'");
  assert.equal(jobs.approve.environment, "release");
  assert.equal(jobs.publish.needs, "approve");
  assert.equal(jobs.publish.permissions["id-token"], "write");
  assert.equal(jobs["verification-context"].if, "inputs.operation == 'verify'");
  for (const name of ["verify-pull", "verify-install"]) {
    assert.equal(jobs[name].needs, "verification-context");
    assert.deepEqual(jobs[name].permissions, {});
  }
  assert.deepEqual(
    jobs["verify-pull"].strategy.matrix.include
      .map(({ platform }) => platform)
      .sort(),
    ["linux/amd64", "linux/arm64"],
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cli-stage-"));
  try {
    const candidate = path.join(directory, "candidate");
    fs.mkdirSync(candidate);
    const manifest = JSON.stringify({
      images: {
        api: { reference: `example.test/api@sha256:${"a".repeat(64)}` },
      },
    });
    fs.writeFileSync(path.join(candidate, "release-manifest.json"), manifest);
    fs.writeFileSync(
      path.join(directory, "npm"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGUMENTS"\n',
      { mode: 0o755 },
    );
    const stage = jobs.publish.steps.find(
      ({ name }) => name === "Stage on npm with the candidate manifest",
    );
    execFileSync("bash", ["-eu", "-c", stage.run], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        NPM_ARGUMENTS: path.join(directory, "arguments"),
      },
    });
    assert.deepEqual(
      fs
        .readFileSync(path.join(directory, "arguments"), "utf8")
        .trim()
        .split("\n"),
      ["stage", "publish", "--provenance", "--access", "public"],
    );
    assert.equal(
      fs.readFileSync(path.join(directory, "release-manifest.json"), "utf8"),
      manifest,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("post-approval verification uses the successful staging run identity", () => {
  const require = createRequire(import.meta.url);
  const yaml = require("../openapi/node_modules/js-yaml");
  const workflow = yaml.load(
    fs.readFileSync(
      new URL("../.github/workflows/release-cli.yml", import.meta.url),
      "utf8",
    ),
  );
  const steps = workflow.jobs["verification-context"].steps;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cli-verify-"));
  try {
    fs.writeFileSync(
      path.join(directory, "gh"),
      '#!/bin/sh\ncat "$RUN_RESPONSE"\n',
      { mode: 0o755 },
    );
    const revision = "b".repeat(40);
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      RUN_ID: "12345",
      GITHUB_REPOSITORY: "zsutton00/hey-hey",
      GITHUB_ENV: path.join(directory, "env"),
      GITHUB_OUTPUT: path.join(directory, "output"),
      RUN_RESPONSE: path.join(directory, "response"),
      STAGED_REVISION: revision,
    };
    const guard = steps.find(
      ({ name }) => name === "Require a successful staging run",
    ).run;
    const run = {
      path: ".github/workflows/release-cli.yml",
      conclusion: "success",
      head_sha: revision,
    };
    fs.writeFileSync(env.RUN_RESPONSE, JSON.stringify(run));
    execFileSync("bash", ["-c", guard], { cwd: directory, env });
    assert.equal(
      fs.readFileSync(env.GITHUB_ENV, "utf8"),
      `STAGED_REVISION=${revision}\n`,
    );
    for (const invalid of [
      { ...run, conclusion: "failure" },
      { ...run, path: ".github/workflows/publish-images.yml" },
    ]) {
      fs.writeFileSync(env.RUN_RESPONSE, JSON.stringify(invalid));
      assert.throws(() =>
        execFileSync("bash", ["-c", guard], {
          cwd: directory,
          env,
          stdio: "pipe",
        }),
      );
    }
    const identity = steps.find(({ id }) => id === "identity").run;
    fs.writeFileSync(
      path.join(directory, "release-metadata.json"),
      JSON.stringify({ version: "4.4.1", revision }),
    );
    execFileSync("bash", ["-c", identity], { cwd: directory, env });
    assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "version=4.4.1\n");
    assert.throws(() =>
      execFileSync("bash", ["-c", identity], {
        cwd: directory,
        env: { ...env, STAGED_REVISION: "c".repeat(40) },
        stdio: "pipe",
      }),
    );
    const download = steps.find(
      ({ uses }) => uses === "actions/download-artifact@v4",
    );
    assert.equal(download.with["run-id"], "${{ inputs.staging_run_id }}");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI release install includes the owners of prepack contract checks", () => {
  const require = createRequire(import.meta.url);
  const yaml = require("../openapi/node_modules/js-yaml");
  const workflow = yaml.load(
    fs.readFileSync(
      new URL("../.github/workflows/release-cli.yml", import.meta.url),
      "utf8",
    ),
  );
  const install = workflow.jobs.publish.steps
    .find(({ run }) => run?.startsWith("pnpm install "))
    .run.split(/\s+/);
  const filters = install.flatMap((argument, index) =>
    argument === "--filter" ? [argument, install[index + 1]] : [],
  );
  const selected = JSON.parse(
    execFileSync("pnpm", ["list", "--depth", "-1", "--json", ...filters], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
    }),
  );
  const names = selected.map(({ name }) => name);
  for (const name of [
    "@hey-hey/cli",
    "@hey-hey/contracts",
    "hey-hey-openapi",
  ]) {
    assert.ok(
      names.includes(name),
      `Release install omits ${name}, required by CLI prepack`,
    );
  }
});
