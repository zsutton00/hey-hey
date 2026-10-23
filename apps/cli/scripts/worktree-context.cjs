const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const canonicalPath = (value) => {
  const absolutePath = path.resolve(value);
  return fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
};

const runGit = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const resolveWorktreeContext = (cwd = process.cwd(), environment = process.env) => {
  const repositoryRoot = canonicalPath(runGit(cwd, ['rev-parse', '--show-toplevel']));
  const gitDirectory = canonicalPath(
    runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']),
  );
  const commonGitDirectory = canonicalPath(
    runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  );
  const isLinkedWorktree = gitDirectory !== commonGitDirectory;
  const mainRepositoryRoot = canonicalPath(path.dirname(commonGitDirectory));
  const repositoriesRoot = path.dirname(mainRepositoryRoot);
  const configuredWorkspaceId = environment.HEY_HEY_WORKSPACE_ID?.trim();

  return {
    repositoryRoot,
    mainRepositoryRoot,
    repositoriesRoot,
    isLinkedWorktree,
    workspaceId: isLinkedWorktree ? configuredWorkspaceId || path.basename(repositoryRoot) : null,
  };
};

const resolveSiblingRepository = (context, repositoryName, configuredRoot) => {
  if (configuredRoot?.trim()) {
    return canonicalPath(configuredRoot.trim());
  }

  const mainSiblingRoot = path.join(context.repositoriesRoot, repositoryName);
  if (context.workspaceId) {
    const matchingWorktreeRoot = path.join(mainSiblingRoot, '.worktrees', context.workspaceId);
    if (fs.existsSync(matchingWorktreeRoot)) {
      return canonicalPath(matchingWorktreeRoot);
    }
  }

  return canonicalPath(mainSiblingRoot);
};

module.exports = {
  canonicalPath,
  resolveSiblingRepository,
  resolveWorktreeContext,
};
