/**
 * node scripts/consolidation/capture-source-inputs.mjs --config /private/config.json
 * Config: { privateDirectory, manifestPath, sources: [{ key, path,
 *   includeUntracked: [], includeIgnored: [] }] }. All five keys are mandatory.
 * Selection arrays contain exact repository-relative files, never globs.
 * Private output must be new, outside Git or ignored by its enclosing repository.
 * Public identities bind private bytes, not source paths or publication decisions.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCES = Object.freeze({
  ui: "fe4cf998-335b-4818-ac55-4781024bdaff",
  "ui-common": "120a3e96-14e2-4fe9-9eaa-e6ef80697c64",
  api: "ad38d073-3d37-4a66-943e-dfccfa0729f3",
  cli: "fd9d0961-d3e9-4796-83ee-7720025c3dbe",
  openapi: "3ef90bdf-98c2-4010-a0bd-b1ca9001dc0a",
});
export const SCHEMA = "hey-hey.source-inputs.v1";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value);
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" };
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
])
  delete env[key];

function fileDigest(filename) {
  const hasher = createHash("sha256");
  const fd = fs.openSync(filename, "r");
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    let length;
    while ((length = fs.readSync(fd, chunk, 0, chunk.length, null)))
      hasher.update(chunk.subarray(0, length));
    return hasher.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function git(root, args, options = {}) {
  const result = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "-C", root, ...args],
    {
      env,
      maxBuffer: 512 * 1024 * 1024,
      ...options,
    },
  );
  if (result.error || result.status !== 0) throw new Error("git-read-failed");
  return result.stdout;
}
function lines(bytes, separator = "\n") {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes))
    throw new Error("unsupported-path-encoding");
  return text.split(separator).filter(Boolean);
}
function safeRelative(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    name
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git")
  ) {
    throw new Error("invalid-selection-path");
  }
  return name;
}
function readEntry(root, name) {
  safeRelative(name);
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i++) {
    let parent;
    try {
      parent = fs.lstatSync(path.join(root, ...parts.slice(0, i)));
    } catch (error) {
      if (error.code === "ENOENT") return { path: name, kind: "deleted" };
      throw error;
    }
    if (!parent.isDirectory()) {
      throw new Error("unsafe-parent-path");
    }
  }
  const full = path.join(root, name);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch (error) {
    if (error.code === "ENOENT") return { path: name, kind: "deleted" };
    throw new Error("file-read-failed");
  }
  if (stat.isSymbolicLink()) {
    const bytes = fs.readlinkSync(full, { encoding: "buffer" });
    return { path: name, kind: "symlink", digest: hash(bytes), bytes };
  }
  if (!stat.isFile()) throw new Error("unsupported-file-kind");
  const bytes = fs.readFileSync(full);
  return {
    path: name,
    kind: "file",
    mode: stat.mode & 0o777,
    digest: hash(bytes),
    bytes,
  };
}
function inspect(source) {
  const root = fs.realpathSync(source.path);
  if (
    fs.realpathSync(
      git(root, ["rev-parse", "--show-toplevel"]).toString().trim(),
    ) !== root
  ) {
    throw new Error("source-must-be-repository-root");
  }
  if (
    git(root, ["rev-parse", "--is-shallow-repository"]).toString().trim() !==
    "false"
  ) {
    throw new Error("shallow-history-incomplete");
  }
  const revision = git(root, ["rev-parse", "HEAD"]).toString().trim();
  const index = git(root, ["ls-files", "--stage", "-z"]);
  const indexLines = lines(index, "\0");
  if (indexLines.some((line) => !/^\d+ [a-f0-9]+ 0\t/.test(line)))
    throw new Error("unmerged-index");
  if (indexLines.some((line) => line.startsWith("160000 ")))
    throw new Error("submodule-capture-required");
  const tracked = lines(git(root, ["ls-files", "-z"]), "\0");
  const untracked = lines(
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    "\0",
  ).sort();
  const ignored = lines(
    git(root, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]),
    "\0",
  ).sort();
  const selections = [...source.includeUntracked, ...source.includeIgnored];
  for (const name of source.includeUntracked) {
    safeRelative(name);
    if (!untracked.includes(name))
      throw new Error("untracked-selection-mismatch");
  }
  for (const name of source.includeIgnored) {
    safeRelative(name);
    if (
      tracked.includes(name) ||
      spawnSync("git", ["-C", root, "check-ignore", "-q", "--", name], { env })
        .status !== 0
    ) {
      throw new Error("ignored-selection-mismatch");
    }
  }
  const entries = [...new Set([...tracked, ...selections])]
    .sort()
    .map((name) => readEntry(root, name));
  if (
    entries.some(
      (entry) => selections.includes(entry.path) && entry.kind === "deleted",
    )
  )
    throw new Error("selected-file-missing");
  const decisions = {
    untracked: {
      included: [...source.includeUntracked].sort(),
      excluded: untracked.filter((p) => !source.includeUntracked.includes(p)),
    },
    ignored: {
      included: [...source.includeIgnored].sort(),
      excludedInventory: ignored,
      inventoryFormat:
        "git ls-files --others --ignored --exclude-standard --directory; included files override directory entries",
    },
  };
  const staged = git(root, [
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  const unstaged = git(root, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "--",
  ]);
  const refs = git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  const objects = lines(
    git(root, [
      "cat-file",
      "--batch-all-objects",
      "--batch-check=%(objectname)",
    ]),
  ).sort();
  const facts = {
    revision,
    indexDigest: hash(index),
    stagedDigest: hash(staged),
    unstagedDigest: hash(unstaged),
    refsDigest: hash(refs),
    objectsDigest: hash(json(objects)),
    decisions,
    entries: entries.map(({ bytes: _bytes, ...entry }) => entry),
  };
  return {
    root,
    facts,
    entries,
    index,
    staged,
    unstaged,
    refs,
    objects,
    fingerprint: hash(json(facts)),
  };
}
function privateOutput(directory) {
  if (!path.isAbsolute(directory))
    throw new Error("private-directory-must-be-absolute");
  const parent = fs.realpathSync(path.dirname(directory));
  const resolved = path.join(parent, path.basename(directory));
  // An ignored directory is permitted, but never a tracked or public directory.
  const probe = spawnSync(
    "git",
    ["-C", parent, "rev-parse", "--show-toplevel"],
    { env },
  );
  if (
    probe.status === 0 &&
    spawnSync(
      "git",
      ["-C", parent, "check-ignore", "-q", "--", resolved + "/"],
      { env },
    ).status !== 0
  ) {
    throw new Error("private-directory-must-be-outside-git-or-ignored");
  }
  fs.mkdirSync(resolved, { mode: 0o700 }); // exclusive: never overwrite an earlier snapshot
  return resolved;
}
function artifact(directory, name, bytes) {
  fs.writeFileSync(path.join(directory, name), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  return { name, sha256: hash(bytes), size: bytes.length };
}

/** Verify content-addressed bytes and import the pack into a disposable repository.
 * Never consult the original source. Call again before consuming any capture.
 */
export function verifyCapture(source, privateDirectory) {
  if (source.status !== "complete" || SOURCES[source.key] !== source.serviceId)
    throw new Error("incomplete-or-invalid-source");
  const directory = path.join(privateDirectory, source.key);
  const receiptBytes = fs.readFileSync(path.join(directory, "receipt.json"));
  if (hash(receiptBytes) !== source.privateSnapshot.receiptSha256)
    throw new Error("receipt-digest-mismatch");
  const receipt = JSON.parse(receiptBytes);
  if (
    receipt.schemaVersion !== SCHEMA ||
    receipt.captureId !== source.captureId
  )
    throw new Error("receipt-identity-mismatch");
  const required = [
    "index.entries",
    "staged.patch",
    "unstaged.patch",
    "refs",
    "objects",
    "history.pack",
    "snapshot.json",
  ];
  if (
    json(receipt.artifacts.map((a) => a.name).sort()) !== json(required.sort())
  )
    throw new Error("invalid-artifact-inventory");
  for (const artifact of receipt.artifacts) {
    const filename = path.join(directory, artifact.name);
    if (
      fs.statSync(filename).size !== artifact.size ||
      fileDigest(filename) !== artifact.sha256
    )
      throw new Error("artifact-digest-mismatch");
  }
  const {
    schemaVersion,
    sourcePath: _sourcePath,
    ...facts
  } = JSON.parse(
    fs.readFileSync(path.join(directory, "snapshot.json"), "utf8"),
  );
  if (
    schemaVersion !== SCHEMA ||
    hash(json(facts)) !== source.contentDigest ||
    "sha256:" +
      hash(json({ schemaVersion, serviceId: source.serviceId, ...facts })) !==
      source.captureId ||
    facts.revision !== source.revision
  )
    throw new Error("snapshot-identity-mismatch");
  for (const [filename, expected] of [
    ["index.entries", facts.indexDigest],
    ["staged.patch", facts.stagedDigest],
    ["unstaged.patch", facts.unstagedDigest],
    ["refs", facts.refsDigest],
  ]) {
    if (fileDigest(path.join(directory, filename)) !== expected)
      throw new Error("snapshot-artifact-mismatch");
  }
  const objects = lines(fs.readFileSync(path.join(directory, "objects")));
  if (hash(json(objects)) !== facts.objectsDigest)
    throw new Error("object-inventory-mismatch");
  for (const entry of facts.entries) {
    safeRelative(entry.path);
    if (entry.kind !== "deleted") {
      if (
        !/^[a-f0-9]{64}$/.test(entry.digest) ||
        fileDigest(path.join(directory, "blobs", entry.digest)) !== entry.digest
      )
        throw new Error("blob-digest-mismatch");
    }
  }
  const scratch = fs.mkdtempSync(path.join(privateDirectory, ".verify-"));
  try {
    git(scratch, ["init", "--bare", "-q"]);
    const fd = fs.openSync(path.join(directory, "history.pack"), "r");
    try {
      git(scratch, ["index-pack", "--stdin", "--strict"], {
        stdio: [fd, "pipe", "pipe"],
      });
    } finally {
      fs.closeSync(fd);
    }
    const checked = lines(
      git(scratch, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
        input: objects.join("\n") + "\n",
      }),
    );
    if (
      checked.length !== objects.length ||
      checked.some(
        (line, i) =>
          !line.startsWith(objects[i] + " ") || line.endsWith(" missing"),
      )
    )
      throw new Error("missing-history-object");
    git(scratch, ["cat-file", "-e", source.revision + "^{commit}"]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return true;
}

export function captureInputs(config, { afterCapture = () => {} } = {}) {
  if (
    !Array.isArray(config.sources) ||
    config.sources.length !== 5 ||
    new Set(config.sources.map((s) => s.key)).size !== 5 ||
    config.sources.some((s) => !Object.hasOwn(SOURCES, s.key))
  )
    throw new Error("require-exactly-five-sources");
  if (!path.isAbsolute(config.manifestPath))
    throw new Error("manifest-path-must-be-absolute");
  const privateDirectory = privateOutput(config.privateDirectory);
  const sources = [];
  for (const source of [...config.sources].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    const result = {
      key: source.key,
      serviceId: SOURCES[source.key],
      status: "incomplete",
      assemblyEligible: false,
    };
    sources.push(result);
    try {
      if (
        typeof source.path !== "string" ||
        !path.isAbsolute(source.path) ||
        !Array.isArray(source.includeUntracked) ||
        !Array.isArray(source.includeIgnored)
      ) {
        throw new Error("require-explicit-paths-and-selection-arrays");
      }
      const before = inspect(source);
      const directory = path.join(privateDirectory, source.key);
      fs.mkdirSync(directory, { mode: 0o700 });
      const artifacts = [];
      artifacts.push(artifact(directory, "index.entries", before.index));
      artifacts.push(artifact(directory, "staged.patch", before.staged));
      artifacts.push(artifact(directory, "unstaged.patch", before.unstaged));
      artifacts.push(artifact(directory, "refs", before.refs));
      artifacts.push(
        artifact(
          directory,
          "objects",
          Buffer.from(before.objects.join("\n") + "\n"),
        ),
      );
      const packPath = path.join(directory, "history.pack");
      const fd = fs.openSync(packPath, "wx", 0o600);
      try {
        git(before.root, ["pack-objects", "--stdout"], {
          input: before.objects.join("\n") + "\n",
          stdio: ["pipe", fd, "pipe"],
        });
      } finally {
        fs.closeSync(fd);
      }
      artifacts.push({
        name: "history.pack",
        sha256: fileDigest(packPath),
        size: fs.statSync(packPath).size,
      });
      // Direct contents supplement patches: filters, assume-unchanged and skip-worktree
      // must not hide actual working bytes. Git index entries + pack preserve staging.
      fs.mkdirSync(path.join(directory, "blobs"), { mode: 0o700 });
      for (const entry of before.entries) {
        if (
          entry.bytes &&
          !fs.existsSync(path.join(directory, "blobs", entry.digest))
        ) {
          artifact(directory, "blobs/" + entry.digest, entry.bytes);
        }
      }
      artifacts.push(
        artifact(
          directory,
          "snapshot.json",
          Buffer.from(
            json({
              schemaVersion: SCHEMA,
              sourcePath: before.root,
              ...before.facts,
            }),
          ),
        ),
      );
      afterCapture(source);
      if (inspect(source).fingerprint !== before.fingerprint)
        throw new Error("source-drift-detected");
      const captureId =
        "sha256:" +
        hash(
          json({
            schemaVersion: SCHEMA,
            serviceId: result.serviceId,
            ...before.facts,
          }),
        );
      const receipt = { schemaVersion: SCHEMA, captureId, artifacts };
      const receiptArtifact = artifact(
        directory,
        "receipt.json",
        Buffer.from(json(receipt)),
      );
      const complete = {
        ...result,
        status: "complete",
        assemblyEligible: true,
        revision: before.facts.revision,
        captureId,
        contentDigest: before.fingerprint,
        inclusion: {
          tracked: "all-index-paths",
          untracked: "explicit-files",
          ignored: "explicit-files",
          decisionsDigest: hash(json(before.facts.decisions)),
          selectedUntrackedCount: source.includeUntracked.length,
          selectedIgnoredCount: source.includeIgnored.length,
        },
        privateSnapshot: {
          reference: `private-snapshot:${source.key}/${captureId}`,
          receiptSha256: receiptArtifact.sha256,
          receipt: `${source.key}/receipt.json`,
        },
        history:
          "all-local-git-objects-including-alternates; no-history-recipe-or-publication-approval",
      };
      verifyCapture(complete, privateDirectory);
      Object.assign(result, complete);
    } catch (error) {
      // Never copy subprocess diagnostics or filesystem messages into the public manifest.
      result.failure =
        error.message === "source-drift-detected"
          ? "source-drift-detected"
          : "capture-failed";
      artifact(
        privateDirectory,
        source.key + ".failure.json",
        Buffer.from(json({ message: error.message, code: error.code })),
      );
    }
  }
  const manifest = {
    schemaVersion: SCHEMA,
    captureSetId: "sha256:" + hash(json(sources)),
    complete: sources.every((s) => s.status === "complete"),
    assemblyAuthorized: false,
    verification:
      "Resolve private-snapshot references using the operator-supplied private directory; verify receipt SHA-256, every artifact, blob digest and capture identity before reconstruction. Layout, history and publication require separate reviews.",
    sources,
  };
  fs.writeFileSync(
    config.manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--config")
      throw new Error("usage");
    const manifest = captureInputs(
      JSON.parse(fs.readFileSync(process.argv[3], "utf8")),
    );
    console.log(
      `Capture ${manifest.complete ? "complete" : "incomplete"}; assembly remains unauthorized.`,
    );
    process.exitCode = manifest.complete ? 0 : 1;
  } catch {
    console.error(
      "Capture could not start. Require --config with five explicit sources, selection arrays, a new private directory and a manifest path.",
    );
    process.exitCode = 1;
  }
}
