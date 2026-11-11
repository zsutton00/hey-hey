import { test } from "node:test";
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
  for (const files of [[], ["CHANGELOG.md"], ["apps/api/src/a.ts"]]) {
    assert.deepEqual(
      candidateSelection(
        { ...push, ref: "refs/heads/release/2026-11-11" },
        () => files,
      ).images,
      ["ui", "api", "graph-search"],
    );
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
  assert.match(workflow, /branches: \["release\/\*\*"\]/);
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
