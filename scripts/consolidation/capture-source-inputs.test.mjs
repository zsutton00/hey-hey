import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  captureInputs,
  SOURCES,
  verifyCapture,
} from "./capture-source-inputs.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function fixtures(t) {
  const base = path.resolve(".worktrees");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "capture-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = Object.keys(SOURCES).map((key) => {
    const directory = path.join(root, key);
    fs.mkdirSync(directory);
    git(directory, "init", "-q");
    git(directory, "config", "user.name", "Fixture");
    git(directory, "config", "user.email", "fixture@example.invalid");
    for (const name of [
      "partial",
      "deleted",
      "executable",
      "binary",
      "hidden",
    ]) {
      fs.writeFileSync(path.join(directory, name), "base\n");
    }
    fs.symlinkSync("partial", path.join(directory, "link"));
    fs.mkdirSync(path.join(directory, "removed-directory"));
    fs.writeFileSync(
      path.join(directory, "removed-directory", "unstaged-deletion"),
      "base\n",
    );
    fs.writeFileSync(path.join(directory, ".gitignore"), "ignored*\n");
    git(directory, "add", ".");
    git(directory, "commit", "-qm", "base");
    git(directory, "tag", "base");
    git(
      directory,
      "commit-tree",
      "HEAD^{tree}",
      "-m",
      "unreferenced history object",
    );
    fs.writeFileSync(path.join(directory, "partial"), "staged\n");
    fs.writeFileSync(path.join(directory, "binary"), Buffer.from([0, 255, 1]));
    fs.rmSync(path.join(directory, "deleted"));
    fs.chmodSync(path.join(directory, "executable"), 0o755);
    git(directory, "add", "-A");
    fs.rmSync(path.join(directory, "removed-directory"), { recursive: true });
    fs.writeFileSync(path.join(directory, "partial"), "unstaged\n");
    fs.writeFileSync(path.join(directory, "binary"), Buffer.from([0, 254, 2]));
    fs.unlinkSync(path.join(directory, "link"));
    fs.symlinkSync("../outside", path.join(directory, "link"));
    git(directory, "update-index", "--assume-unchanged", "hidden");
    fs.writeFileSync(path.join(directory, "hidden"), "hidden working change\n");
    fs.writeFileSync(path.join(directory, "selected"), "untracked\n");
    fs.writeFileSync(path.join(directory, "omitted"), "not selected\n");
    fs.writeFileSync(path.join(directory, "ignored-selected"), "private\n");
    fs.writeFileSync(
      path.join(directory, "ignored-omitted"),
      "omitted private\n",
    );
    return {
      key,
      path: directory,
      includeUntracked: ["selected"],
      includeIgnored: ["ignored-selected"],
    };
  });
  return {
    sources,
    root,
    privateDirectory: path.join(root, "private"),
    manifestPath: path.join(root, "source-inputs.json"),
  };
}
function originalState(root) {
  // Include Git internals (index, refs, object bytes) as well as every working file.
  const entries = [];
  function walk(directory, prefix = "") {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix + name;
      const full = path.join(directory, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full, relative + "/");
      else
        entries.push([
          relative,
          stat.mode,
          stat.isSymbolicLink()
            ? fs.readlinkSync(full)
            : digest(fs.readFileSync(full)),
        ]);
    }
  }
  walk(root);
  return entries;
}

test("five captures reconstruct staged and actual working bytes without changing originals", (t) => {
  const config = fixtures(t);
  const originals = config.sources.map((s) => originalState(s.path));
  const manifest = captureInputs(config);
  assert.equal(manifest.complete, true);
  assert.equal(manifest.assemblyAuthorized, false);
  const publicText = JSON.stringify(manifest);
  for (const sensitive of [
    config.root,
    "ignored-selected",
    "omitted",
    "outside",
    "private\\n",
  ]) {
    assert.equal(publicText.includes(sensitive), false);
  }
  for (const source of config.sources) {
    const captured = manifest.sources.find((s) => s.key === source.key);
    assert.equal(verifyCapture(captured, config.privateDirectory), true);
    const directory = path.join(config.privateDirectory, source.key);
    const receiptBytes = fs.readFileSync(path.join(directory, "receipt.json"));
    assert.equal(digest(receiptBytes), captured.privateSnapshot.receiptSha256);
    const receipt = JSON.parse(receiptBytes);
    for (const artifact of receipt.artifacts) {
      const bytes = fs.readFileSync(path.join(directory, artifact.name));
      assert.equal(digest(bytes), artifact.sha256);
      assert.equal(bytes.length, artifact.size);
    }
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(directory, "snapshot.json")),
    );
    const { schemaVersion, sourcePath: _sourcePath, ...facts } = snapshot;
    assert.equal(digest(JSON.stringify(facts)), captured.contentDigest);
    assert.equal(
      "sha256:" +
        digest(
          JSON.stringify({
            schemaVersion,
            serviceId: captured.serviceId,
            ...facts,
          }),
        ),
      captured.captureId,
    );
    const reconstructed = path.join(config.root, "restored-" + source.key);
    fs.mkdirSync(reconstructed);
    git(reconstructed, "init", "-q");
    const pack = spawnSync(
      "git",
      ["-C", reconstructed, "index-pack", "--stdin"],
      {
        input: fs.readFileSync(path.join(directory, "history.pack")),
      },
    );
    assert.equal(pack.status, 0, pack.stderr.toString());
    for (const oid of fs
      .readFileSync(path.join(directory, "objects"), "utf8")
      .trim()
      .split("\n")) {
      git(reconstructed, "cat-file", "-e", oid);
    }
    git(reconstructed, "checkout", "--detach", captured.revision);
    const staged = fs.readFileSync(path.join(directory, "staged.patch"));
    const apply = spawnSync(
      "git",
      ["-C", reconstructed, "apply", "--index", "--binary", "-"],
      { input: staged },
    );
    assert.equal(apply.status, 0, apply.stderr.toString());
    assert.equal(git(reconstructed, "show", ":partial"), "staged\n");
    assert.equal(
      git(reconstructed, "ls-files", "--stage"),
      git(source.path, "ls-files", "--stage"),
    );
    const unstaged = spawnSync(
      "git",
      ["-C", reconstructed, "apply", "--binary", "-"],
      {
        input: fs.readFileSync(path.join(directory, "unstaged.patch")),
      },
    );
    assert.equal(unstaged.status, 0, unstaged.stderr.toString());
    assert.equal(
      fs.readFileSync(path.join(reconstructed, "partial"), "utf8"),
      "unstaged\n",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(reconstructed, "binary")),
      Buffer.from([0, 254, 2]),
    );
    for (const entry of snapshot.entries) {
      const full = path.join(reconstructed, entry.path);
      fs.rmSync(full, { force: true });
      if (entry.kind === "deleted") {
        assert.equal(fs.existsSync(full), false);
        continue;
      }
      const bytes = fs.readFileSync(
        path.join(directory, "blobs", entry.digest),
      );
      assert.equal(digest(bytes), entry.digest);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (entry.kind === "symlink") fs.symlinkSync(bytes.toString(), full);
      else {
        fs.writeFileSync(full, bytes);
        fs.chmodSync(full, entry.mode);
      }
      const original = path.join(source.path, entry.path);
      if (entry.kind === "symlink")
        assert.equal(fs.readlinkSync(full), fs.readlinkSync(original));
      else {
        assert.deepEqual(fs.readFileSync(full), fs.readFileSync(original));
        assert.equal(
          fs.statSync(full).mode & 0o777,
          fs.statSync(original).mode & 0o777,
        );
      }
    }
    assert.equal(fs.existsSync(path.join(reconstructed, "omitted")), false);
    assert.equal(
      fs.existsSync(path.join(reconstructed, "ignored-omitted")),
      false,
    );
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  }
  assert.deepEqual(
    config.sources.map((s) => originalState(s.path)),
    originals,
  );
  const repeated = captureInputs({
    ...config,
    privateDirectory: path.join(config.root, "second"),
  });
  assert.deepEqual(
    repeated.sources.map((s) => s.captureId),
    manifest.sources.map((s) => s.captureId),
  );
  const first = manifest.sources[0];
  const snapshotDirectory = path.join(config.privateDirectory, first.key);
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(snapshotDirectory, "snapshot.json")),
  );
  const blob = snapshot.entries.find((entry) => entry.kind === "file").digest;
  fs.writeFileSync(path.join(snapshotDirectory, "blobs", blob), "tampered");
  assert.throws(
    () => verifyCapture(first, config.privateDirectory),
    /blob-digest-mismatch/,
  );
  fs.appendFileSync(path.join(snapshotDirectory, "receipt.json"), " ");
  assert.throws(
    () => verifyCapture(first, config.privateDirectory),
    /receipt-digest-mismatch/,
  );
});

test("unreadable source is incomplete while all healthy sources complete", (t) => {
  const config = fixtures(t);
  config.sources[0].path = path.join(config.root, "absent");
  const manifest = captureInputs(config);
  assert.equal(manifest.complete, false);
  assert.equal(
    manifest.sources.filter((s) => s.status === "complete").length,
    4,
  );
  const failed = manifest.sources.find((s) => s.status === "incomplete");
  assert.equal(failed.assemblyEligible, false);
  assert.equal(failed.captureId, undefined);
  assert.equal(JSON.stringify(manifest).includes(config.root), false);
});

test("source drift invalidates only that capture", (t) => {
  const config = fixtures(t);
  const manifest = captureInputs(config, {
    afterCapture(source) {
      if (source.key === "api")
        fs.writeFileSync(path.join(source.path, "partial"), "drift\n");
    },
  });
  const failed = manifest.sources.find((s) => s.key === "api");
  assert.equal(failed.failure, "source-drift-detected");
  assert.equal(failed.assemblyEligible, false);
  assert.equal(
    manifest.sources.filter((s) => s.status === "complete").length,
    4,
  );
});

test("invalid configuration belongs to its source and does not block healthy sources", (t) => {
  const config = fixtures(t);
  delete config.sources[0].includeUntracked;
  const manifest = captureInputs(config);
  assert.equal(
    manifest.sources.find((s) => s.key === config.sources[0].key)
      .assemblyEligible,
    false,
  );
  assert.equal(
    manifest.sources.filter((s) => s.status === "complete").length,
    4,
  );
});

test("explicit inputs, private output, safe selections and immutable snapshot directory are required", (t) => {
  const config = fixtures(t);
  assert.throws(
    () => captureInputs({ ...config, sources: [] }),
    /five-sources/,
  );
  assert.throws(
    () =>
      captureInputs({
        ...config,
        privateDirectory: path.join(config.sources[0].path, "public"),
      }),
    /outside-git-or-ignored/,
  );
  config.sources[0].includeIgnored = ["../escape"];
  const manifest = captureInputs(config);
  assert.equal(
    manifest.sources.find((s) => s.key === config.sources[0].key).status,
    "incomplete",
  );
  assert.throws(() => captureInputs(config), /EEXIST/);
});
