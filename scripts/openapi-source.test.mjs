import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const resolver = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "openapi-source.cjs",
);
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const canonical = (value) => fs.realpathSync(value);

const spec = (marker) =>
  `openapi: 3.0.0\ninfo: {title: fixture, version: 1.0.0}\npaths: {}\nx-marker: ${marker}\n`;

const writeSpec = (openapiRoot, marker) => {
  fs.mkdirSync(path.join(openapiRoot, "specs/api"), { recursive: true });
  fs.writeFileSync(
    path.join(openapiRoot, "specs/api/openapi.yaml"),
    spec(marker),
  );
};

// A combined checkout with its own openapi/ plus a decoy sibling repository
// named openapi, which must never be selected.
const createFixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const checkout = path.join(root, "hey-hey");
  fs.mkdirSync(path.join(checkout, "apps/cli"), { recursive: true });
  writeSpec(path.join(checkout, "openapi"), "combined");
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "config", "user.email", "tests@example.com");
  git(checkout, "config", "user.name", "resolver tests");
  git(checkout, "add", ".");
  git(checkout, "commit", "-q", "-m", "initial");
  writeSpec(path.join(root, "openapi"), "decoy-sibling");
  return { root, checkout };
};

const resolve = (cwd, environment = {}, args = []) => {
  const env = { ...process.env, ...environment };
  if (!("HEY_HEY_OPENAPI_ROOT" in environment)) delete env.HEY_HEY_OPENAPI_ROOT;
  return spawnSync(process.execPath, [resolver, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
};

test("defaults to the combined checkout openapi directory, never a sibling repository", (t) => {
  const { checkout } = createFixture(t);
  const result = resolve(path.join(checkout, "apps/cli"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, canonical(path.join(checkout, "openapi")));
});

test("a linked worktree resolves its own openapi directory", (t) => {
  const { root, checkout } = createFixture(t);
  const worktree = path.join(root, "worktree-a");
  git(checkout, "worktree", "add", "-q", "-b", "worktree-a", worktree);
  writeSpec(path.join(worktree, "openapi"), "worktree");
  fs.mkdirSync(path.join(worktree, "apps/cli"), { recursive: true });
  const result = resolve(path.join(worktree, "apps/cli"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, canonical(path.join(worktree, "openapi")));
});

test("an explicit pin is honored", (t) => {
  const { root, checkout } = createFixture(t);
  const pinned = path.join(root, "pinned-openapi");
  writeSpec(pinned, "pinned");
  const result = resolve(checkout, { HEY_HEY_OPENAPI_ROOT: pinned });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, canonical(pinned));
});

test("an invalid pin fails instead of falling back", (t) => {
  const { root, checkout } = createFixture(t);
  const missing = resolve(checkout, {
    HEY_HEY_OPENAPI_ROOT: path.join(root, "absent"),
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/);
  const notASpec = resolve(checkout, { HEY_HEY_OPENAPI_ROOT: checkout });
  assert.notEqual(notASpec.status, 0);
  assert.match(notASpec.stderr, /is not an OpenAPI source/);
});

test("identity records revision, subdirectory and the on-disk closure digest", (t) => {
  const { checkout } = createFixture(t);
  const before = JSON.parse(resolve(checkout, {}, ["--identity"]).stdout);
  assert.equal(before.selection, "combined_checkout");
  assert.equal(before.subdirectory, "openapi");
  assert.equal(before.revision, git(checkout, "rev-parse", "HEAD"));
  assert.equal(before.workingChanges, false);

  writeSpec(path.join(checkout, "openapi"), "edited");
  const after = JSON.parse(resolve(checkout, {}, ["--identity"]).stdout);
  assert.equal(after.revision, before.revision);
  assert.equal(after.workingChanges, true);
  assert.notEqual(after.closureDigest, before.closureDigest);
});

test("a pin outside any Git checkout still reports a content identity", (t) => {
  const { root, checkout } = createFixture(t);
  const pinned = path.join(root, "exported-openapi");
  writeSpec(pinned, "combined");
  const pinnedIdentity = JSON.parse(
    resolve(checkout, { HEY_HEY_OPENAPI_ROOT: pinned }, ["--identity"]).stdout,
  );
  const defaultIdentity = JSON.parse(
    resolve(checkout, {}, ["--identity"]).stdout,
  );
  assert.equal(pinnedIdentity.selection, "explicit_pin");
  assert.equal(pinnedIdentity.revision, null);
  assert.equal(pinnedIdentity.closureDigest, defaultIdentity.closureDigest);
});
