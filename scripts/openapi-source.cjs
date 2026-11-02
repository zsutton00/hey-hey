#!/usr/bin/env node
// Single resolver for the OpenAPI source every in-checkout consumer generates from.
//
// Default: the `openapi/` directory of the combined checkout that contains the
// caller (a linked worktree resolves to its own `openapi/`). An explicit
// HEY_HEY_OPENAPI_ROOT pin is honored verbatim and must be valid; it never falls
// back to another checkout, and nothing here ever looks at sibling repositories.

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_SPEC = path.join("specs", "api", "openapi.yaml");
// Everything a consumer recipe may read from the source: specs, shared schema
// helpers and the builder scripts consumers execute from the source root.
const CLOSURE_DIRECTORIES = ["specs", "shared", "scripts"];

const canonicalPath = (value) => fs.realpathSync(path.resolve(value));

const runGit = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const tryGit = (cwd, args) => {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
};

const assertOpenapiRoot = (openapiRoot, origin) => {
  if (!fs.existsSync(path.join(openapiRoot, REQUIRED_SPEC))) {
    throw new Error(
      `${origin} ${openapiRoot} is not an OpenAPI source: ${REQUIRED_SPEC} is missing.`,
    );
  }
};

const resolveOpenapiSource = ({
  cwd = process.cwd(),
  environment = process.env,
} = {}) => {
  const pinned = environment.HEY_HEY_OPENAPI_ROOT?.trim();
  if (pinned) {
    if (!fs.existsSync(pinned)) {
      throw new Error(`HEY_HEY_OPENAPI_ROOT=${pinned} does not exist.`);
    }
    const openapiRoot = canonicalPath(pinned);
    assertOpenapiRoot(openapiRoot, "HEY_HEY_OPENAPI_ROOT");
    return { openapiRoot, selection: "explicit_pin" };
  }

  const checkoutRoot = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!checkoutRoot) {
    throw new Error(
      `${cwd} is not inside a Git checkout. Run from the combined checkout or set HEY_HEY_OPENAPI_ROOT.`,
    );
  }
  const openapiRoot = canonicalPath(path.join(checkoutRoot, "openapi"));
  assertOpenapiRoot(openapiRoot, "Combined checkout OpenAPI directory");
  return { openapiRoot, selection: "combined_checkout" };
};

const resolveOpenapiRoot = (options) =>
  resolveOpenapiSource(options).openapiRoot;

const listClosureFiles = (openapiRoot) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile())
        files.push(
          path.relative(openapiRoot, entryPath).split(path.sep).join("/"),
        );
    }
  };
  for (const directory of CLOSURE_DIRECTORIES) {
    const absolute = path.join(openapiRoot, directory);
    if (fs.existsSync(absolute)) visit(absolute);
  }
  return files.sort();
};

// Content digest of the source closure as it exists on disk, so uncommitted
// spec edits produce a different identity than the commit they sit on.
const digestClosure = (openapiRoot) => {
  const hash = createHash("sha256");
  const files = listClosureFiles(openapiRoot);
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(
      createHash("sha256")
        .update(fs.readFileSync(path.join(openapiRoot, file)))
        .digest("hex"),
    );
    hash.update("\n");
  }
  return {
    closureDigest: `sha256:${hash.digest("hex")}`,
    closureFileCount: files.length,
  };
};

const parsedSpecDocuments = new Map();

const listSpecReferenceClosure = (openapiRoot, entrySpec) => {
  let yaml;
  try {
    yaml = require(require.resolve("js-yaml", { paths: [openapiRoot] }));
  } catch {
    yaml = require("js-yaml");
  }
  const pending = [path.resolve(openapiRoot, entrySpec)];
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    const relative = path.relative(openapiRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`OpenAPI reference escapes its source root: ${file}`);
    }
    if (!fs.existsSync(file)) {
      throw new Error(`OpenAPI reference does not exist: ${file}`);
    }
    visited.add(file);

    const sourceText = fs.readFileSync(file, "utf8");
    const cached = parsedSpecDocuments.get(file);
    const document =
      cached?.sourceText === sourceText
        ? cached.document
        : yaml.load(sourceText);
    parsedSpecDocuments.set(file, { sourceText, document });
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string") {
          if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(child)) continue;
          const referenceFile = decodeURIComponent(child.split("#", 1)[0]);
          if (referenceFile) {
            pending.push(path.resolve(path.dirname(file), referenceFile));
          }
          continue;
        }
        visit(child);
      }
    };
    visit(document);
  }

  return [...visited]
    .map((file) => path.relative(openapiRoot, file).split(path.sep).join("/"))
    .sort();
};

const digestSpecClosure = (openapiRoot, entrySpec) => {
  const hash = createHash("sha256");
  const files = listSpecReferenceClosure(openapiRoot, entrySpec);
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(
      createHash("sha256")
        .update(fs.readFileSync(path.join(openapiRoot, file)))
        .digest("hex"),
    );
    hash.update("\n");
  }
  return {
    closureDigest: `sha256:${hash.digest("hex")}`,
    closureFileCount: files.length,
    files,
  };
};

const describeOpenapiSource = (options) => {
  const source = resolveOpenapiSource(options);
  const { openapiRoot } = source;
  const repositoryRoot = tryGit(openapiRoot, ["rev-parse", "--show-toplevel"]);
  const revision = repositoryRoot
    ? tryGit(openapiRoot, ["rev-parse", "HEAD"])
    : null;
  const workingChanges = repositoryRoot
    ? tryGit(openapiRoot, [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ...CLOSURE_DIRECTORIES,
      ])
    : null;
  return {
    ...source,
    repositoryRoot: repositoryRoot ? canonicalPath(repositoryRoot) : null,
    subdirectory: repositoryRoot
      ? path.relative(canonicalPath(repositoryRoot), openapiRoot) || "."
      : null,
    revision,
    workingChanges: workingChanges === null ? null : workingChanges.length > 0,
    ...digestClosure(openapiRoot),
  };
};

if (require.main === module) {
  const [command] = process.argv.slice(2);
  try {
    if (command === "--identity") {
      process.stdout.write(
        `${JSON.stringify(describeOpenapiSource(), null, 2)}\n`,
      );
    } else if (command === undefined) {
      process.stdout.write(resolveOpenapiRoot());
    } else {
      throw new Error("Usage: openapi-source.cjs [--identity]");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  describeOpenapiSource,
  digestClosure,
  digestSpecClosure,
  listSpecReferenceClosure,
  resolveOpenapiRoot,
  resolveOpenapiSource,
};
