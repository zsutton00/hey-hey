import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const worktreeMarker = `${path.sep}.worktrees${path.sep}`;
const isLinkedWorktree = repositoryRoot.includes(worktreeMarker);
const workspaceName = isLinkedWorktree ? path.basename(repositoryRoot) : null;
const repositoriesRoot = isLinkedWorktree
  ? path.resolve(repositoryRoot, "../../..")
  : path.dirname(repositoryRoot);
const linksRoot = path.join(repositoryRoot, ".worktree-links");

fs.mkdirSync(linksRoot, { recursive: true });

linkSibling("ui-common", "package.json");

function linkSibling(repositoryName, requiredPath) {
  const mainCheckout = path.join(repositoriesRoot, repositoryName);
  const worktreeCheckout = workspaceName
    ? path.join(mainCheckout, ".worktrees", workspaceName)
    : null;
  const target =
    worktreeCheckout && fs.existsSync(path.join(worktreeCheckout, requiredPath))
      ? worktreeCheckout
      : mainCheckout;

  if (!fs.existsSync(path.join(target, requiredPath))) {
    throw new Error(
      `Unable to resolve ${repositoryName}; expected ${requiredPath} under ${target}`,
    );
  }

  const linkPath = path.join(linksRoot, repositoryName);
  const existing = readLinkTarget(linkPath);
  if (existing === fs.realpathSync(target)) {
    return;
  }
  if (existing !== null) {
    fs.unlinkSync(linkPath);
  } else if (fs.existsSync(linkPath)) {
    throw new Error(`${linkPath} exists and is not a symbolic link`);
  }
  fs.symlinkSync(target, linkPath, "dir");
}

function readLinkTarget(linkPath) {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) {
      return null;
    }
    return fs.realpathSync(linkPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
