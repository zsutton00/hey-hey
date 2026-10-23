import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IMAGES, evidenceMismatches } from "./image-build-evidence.mjs";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "image-build-evidence.mjs",
);

const evidence = (overrides = {}) => ({
  image: "api",
  intendedRepository: IMAGES.api.repository,
  candidateTag: "candidate-abc",
  localImageId: "sha256:one",
  published: false,
  source: { revision: "abc", workingChanges: false },
  inputs: {
    lockfile: "sha256:lock",
    openapiClosure: { closureDigest: "sha256:spec" },
  },
  ...overrides,
});

test("a clean rebuild of the recorded candidate matches despite a new image ID", () => {
  assert.deepEqual(
    evidenceMismatches(evidence(), evidence({ localImageId: "sha256:two" })),
    [],
  );
});

test("a different revision or changed inputs are refused", () => {
  const fresh = evidence({
    source: { revision: "def", workingChanges: false },
    inputs: {
      lockfile: "sha256:other",
      openapiClosure: { closureDigest: "sha256:spec" },
    },
  });
  const problems = evidenceMismatches(evidence(), fresh);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /revision differs/);
  assert.match(problems[1], /input digests differ/);
});

test("dirty or already-published evidence is refused", () => {
  assert.match(
    evidenceMismatches(
      evidence({ source: { revision: "abc", workingChanges: true } }),
      evidence(),
    )[0],
    /working changes/,
  );
  assert.match(
    evidenceMismatches(
      evidence(),
      evidence({ source: { revision: "abc", workingChanges: true } }),
    )[0],
    /this checkout has working changes/,
  );
  assert.match(
    evidenceMismatches(evidence({ published: true }), evidence())[0],
    /unpublished/,
  );
});

test("a different image or intended repository is refused", () => {
  const problems = evidenceMismatches(
    evidence({ image: "ui", intendedRepository: IMAGES.ui.repository }),
    evidence(),
  );
  assert.equal(problems.length, 2);
});

test("--repository prints the existing registry name", () => {
  assert.equal(
    execFileSync("node", [script, "--repository", "ui"], {
      encoding: "utf8",
    }).trim(),
    "ghcr.io/zsutton00/ui-service",
  );
  assert.throws(() =>
    execFileSync("node", [script, "--repository", "graph"], { stdio: "pipe" }),
  );
});

test("--verify exits non-zero for evidence from another revision", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-evidence-"));
  const file = path.join(directory, "evidence.json");
  fs.writeFileSync(
    file,
    JSON.stringify(
      evidence({ source: { revision: "0".repeat(40), workingChanges: false } }),
    ),
  );
  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          script,
          "--image",
          "api",
          "--image-id",
          "sha256:x",
          "--tag",
          "candidate-abc",
          "--verify",
          file,
        ],
        { stdio: "pipe" },
      ),
    /Refusing to publish api/,
  );
});
