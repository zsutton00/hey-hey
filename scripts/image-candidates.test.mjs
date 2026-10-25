import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { candidateSelection } from "./image-candidate-selection.mjs";
import { publicationEvidence } from "./image-publication-evidence.mjs";
const push = {
  ref: "refs/heads/release/2026-10-24",
  event: "push",
  before: "a".repeat(40),
  revision: "b".repeat(40),
};
test("only release branches permit image work, including manual retries", () => {
  for (const branch of ["main", "dev", "feature/new", "release"])
    for (const event of ["push", "workflow_dispatch"])
      assert.throws(() =>
        candidateSelection({
          ...push,
          ref: `refs/heads/${branch}`,
          event,
          target: "Both",
        }),
      );
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
  assert.deepEqual(candidateSelection(push, () => ["docs/a.md"]).checks, []);
  assert.deepEqual(
    candidateSelection({ ...push, before: "0".repeat(40) }).images,
    ["ui", "api"],
  );
  assert.deepEqual(
    candidateSelection(push, () => {
      throw new Error("missing");
    }).images,
    ["ui", "api"],
  );
  assert.deepEqual(
    candidateSelection(push, () => ["packages/ui-common/src/a.ts"]).targets,
    ["ui-common", "ui", "cli"],
  );
  for (const file of ["openapi/a.yaml", "pnpm-lock.yaml"])
    assert.deepEqual(candidateSelection(push, () => [file]).images, [
      "ui",
      "api",
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
test("single workflow gates publication after checks, one build and smoke", () => {
  const workflow = fs.readFileSync(
    new URL("../.github/workflows/publish-images.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /branches: \["release\/\*\*"\]/);
  assert.match(workflow, /needs: \[select, checks\]/);
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
