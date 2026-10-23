#!/usr/bin/env node
// Records what a locally built image was built from, for promotion review.
//
//   node scripts/image-build-evidence.mjs --image <ui|api> --image-id <sha256:...> --tag <ref>
//
// Evidence describes one exact candidate revision. It is not publication: the
// registry name is the intended identity, and nothing here pushes or deploys.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { digestClosure } = require("./openapi-source.cjs");

const checkoutRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Registry names stay those current deployments reference; changing them is a
// separately reviewed deployment-reference change.
export const IMAGES = {
  ui: {
    repository: "ghcr.io/zsutton00/ui-service",
    dockerfile: "apps/ui/Dockerfile",
  },
  api: {
    repository: "ghcr.io/zsutton00/api-service",
    dockerfile: "apps/api/Dockerfile",
  },
};

const sha256 = (file) =>
  `sha256:${createHash("sha256")
    .update(fs.readFileSync(path.join(checkoutRoot, file)))
    .digest("hex")}`;

const git = (...args) =>
  execFileSync("git", args, { cwd: checkoutRoot, encoding: "utf8" }).trim();

const parseArguments = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (!["image", "image-id", "tag"].includes(key) || !argv[index + 1]) {
      throw new Error(
        "Usage: image-build-evidence.mjs --image <ui|api> --image-id <id> --tag <ref>",
      );
    }
    options[key] = argv[index + 1];
  }
  if (!IMAGES[options.image]) throw new Error(`Unknown image ${options.image}`);
  return options;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const image = IMAGES[options.image];
  // External base images, not references to the Dockerfile's own stages.
  const stages = [
    ...fs
      .readFileSync(path.join(checkoutRoot, image.dockerfile), "utf8")
      .matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim),
  ];
  const stageNames = new Set(stages.map(([, , name]) => name).filter(Boolean));
  const baseImages = [
    ...new Set(stages.map(([, reference]) => reference)),
  ].filter((reference) => !stageNames.has(reference));
  const evidence = {
    image: options.image,
    intendedRepository: image.repository,
    candidateTag: options.tag,
    localImageId: options["image-id"],
    published: false,
    source: {
      revision: git("rev-parse", "HEAD"),
      workingChanges:
        git("status", "--porcelain", "--untracked-files=all").length > 0,
    },
    inputs: {
      dockerfile: { path: image.dockerfile, digest: sha256(image.dockerfile) },
      dockerignore: sha256(".dockerignore"),
      lockfile: sha256("pnpm-lock.yaml"),
      workspace: sha256("pnpm-workspace.yaml"),
      generatedContracts: sha256("generated-contracts.json"),
      openapiClosure: digestClosure(path.join(checkoutRoot, "openapi")),
      baseImages,
    },
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
