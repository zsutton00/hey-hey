#!/usr/bin/env node
// Records what a locally built image was built from, for promotion review.
//
//   node scripts/image-build-evidence.mjs --image <ui|api> --image-id <sha256:...> --tag <ref>
//   ... --verify <evidence.json>   exit non-zero unless this checkout matches it
//   node scripts/image-build-evidence.mjs --repository <ui|api>
//
// Evidence describes one exact candidate revision. It is not publication: the
// registry name is the intended identity, and nothing here pushes or deploys.
// The publish workflow uses --verify to push only a candidate matching it.

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

// Builds the evidence for one image from the checkout as it is now.
export const collectEvidence = ({ image: name, imageId, tag }) => {
  const image = IMAGES[name];
  if (!image) throw new Error(`Unknown image ${name}`);
  // External base images, not references to the Dockerfile's own stages.
  const stages = [
    ...fs
      .readFileSync(path.join(checkoutRoot, image.dockerfile), "utf8")
      .matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim),
  ];
  const stageNames = new Set(
    stages.map(([, , stage]) => stage).filter(Boolean),
  );
  const baseImages = [
    ...new Set(stages.map(([, reference]) => reference)),
  ].filter((reference) => !stageNames.has(reference));
  return {
    image: name,
    intendedRepository: image.repository,
    candidateTag: tag,
    localImageId: imageId,
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
};

// Reasons a fresh build may not be published as the recorded candidate. The
// local image ID is not compared: rebuilds are not byte-reproducible, so the
// binding is revision, clean tree, identity and input digests.
export const evidenceMismatches = (recorded, fresh) => {
  const problems = [];
  if (recorded.published !== false) {
    problems.push("recorded evidence is not for an unpublished candidate");
  }
  if (recorded.source?.workingChanges !== false) {
    problems.push("recorded candidate was built with working changes");
  }
  if (fresh.source.workingChanges) {
    problems.push("this checkout has working changes");
  }
  for (const field of ["image", "intendedRepository", "candidateTag"]) {
    if (recorded[field] !== fresh[field]) {
      problems.push(
        `${field} differs: recorded ${recorded[field]}, now ${fresh[field]}`,
      );
    }
  }
  if (recorded.source?.revision !== fresh.source.revision) {
    problems.push(
      `revision differs: recorded ${recorded.source?.revision}, now ${fresh.source.revision}`,
    );
  }
  if (JSON.stringify(recorded.inputs) !== JSON.stringify(fresh.inputs)) {
    problems.push("input digests differ from the recorded candidate");
  }
  return problems;
};

const USAGE = [
  "Usage: image-build-evidence.mjs --image <ui|api> --image-id <id> --tag <ref> [--verify <evidence.json>]",
  "       image-build-evidence.mjs --repository <ui|api>",
].join("\n");

const parseArguments = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (
      !["image", "image-id", "tag", "verify", "repository"].includes(key) ||
      !argv[index + 1]
    ) {
      throw new Error(USAGE);
    }
    options[key] = argv[index + 1];
  }
  if (options.repository !== undefined) {
    if (Object.keys(options).length !== 1) throw new Error(USAGE);
    if (!IMAGES[options.repository]) {
      throw new Error(`Unknown image ${options.repository}`);
    }
    return options;
  }
  if (!options.image || !options["image-id"] || !options.tag) {
    throw new Error(USAGE);
  }
  if (!IMAGES[options.image]) throw new Error(`Unknown image ${options.image}`);
  return options;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.repository !== undefined) {
    process.stdout.write(`${IMAGES[options.repository].repository}\n`);
  } else {
    const evidence = collectEvidence({
      image: options.image,
      imageId: options["image-id"],
      tag: options.tag,
    });
    if (options.verify === undefined) {
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    } else {
      const recorded = JSON.parse(fs.readFileSync(options.verify, "utf8"));
      const problems = evidenceMismatches(recorded, evidence);
      if (problems.length > 0) {
        console.error(
          `Refusing to publish ${options.image}:\n- ${problems.join("\n- ")}`,
        );
        process.exitCode = 1;
      }
    }
  }
}
