import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';

const DATABASE_PREFIX = 'hey_hey_wt_';
const DATABASE_HASH_LENGTH = 8;
const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

export interface WorktreeContext {
  repositoryRoot: string;
  mainRepositoryRoot: string;
  repositoriesRoot: string;
  isLinkedWorktree: boolean;
  workspaceId: string | null;
  expectedDatabaseName: string | null;
}

interface GitPaths {
  repositoryRoot: string;
  gitDirectory: string;
  commonGitDirectory: string;
}

const runGit = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const canonicalPath = (path: string): string => {
  const absolutePath = resolve(path);
  return existsSync(absolutePath) ? realpathSync(absolutePath) : absolutePath;
};

export const hasGitMetadata = (cwd = process.cwd()): boolean => {
  let currentPath = resolve(cwd);
  const filesystemRoot = parse(currentPath).root;

  while (true) {
    if (existsSync(join(currentPath, '.git'))) {
      return true;
    }
    if (currentPath === filesystemRoot) {
      return false;
    }
    currentPath = dirname(currentPath);
  }
};

const resolveGitPaths = (cwd: string): GitPaths => ({
  repositoryRoot: runGit(cwd, ['rev-parse', '--show-toplevel']),
  gitDirectory: runGit(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
  ]),
  commonGitDirectory: runGit(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]),
});

export const normalizeWorkspaceId = (workspaceId: string): string => {
  const normalized = workspaceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    throw new Error(
      `Workspace ID ${JSON.stringify(workspaceId)} has no database-safe characters.`,
    );
  }

  return normalized;
};

export const createWorktreeDatabaseName = (workspaceId: string): string => {
  const normalized = normalizeWorkspaceId(workspaceId);
  const hash = createHash('sha256')
    .update(workspaceId)
    .digest('hex')
    .slice(0, DATABASE_HASH_LENGTH);
  const slugMaxLength =
    POSTGRES_IDENTIFIER_MAX_LENGTH -
    DATABASE_PREFIX.length -
    DATABASE_HASH_LENGTH -
    1;
  const slug = normalized.slice(0, slugMaxLength).replace(/_+$/g, '');

  return `${DATABASE_PREFIX}${slug}_${hash}`;
};

export const resolveWorktreeContext = (
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): WorktreeContext => {
  const gitPaths = resolveGitPaths(cwd);
  const repositoryRoot = canonicalPath(gitPaths.repositoryRoot);
  const gitDirectory = canonicalPath(gitPaths.gitDirectory);
  const commonGitDirectory = canonicalPath(gitPaths.commonGitDirectory);
  const isLinkedWorktree = gitDirectory !== commonGitDirectory;
  const mainRepositoryRoot = canonicalPath(dirname(commonGitDirectory));
  const configuredWorkspaceId = environment.HEY_HEY_WORKSPACE_ID?.trim();
  const workspaceId = isLinkedWorktree
    ? configuredWorkspaceId || basename(repositoryRoot)
    : null;

  return {
    repositoryRoot,
    mainRepositoryRoot,
    repositoriesRoot: dirname(mainRepositoryRoot),
    isLinkedWorktree,
    workspaceId,
    expectedDatabaseName: workspaceId
      ? createWorktreeDatabaseName(workspaceId)
      : null,
  };
};

export const resolveSiblingRepository = (
  context: WorktreeContext,
  repositoryName: string,
  configuredRoot?: string,
): string => {
  if (configuredRoot?.trim()) {
    return canonicalPath(configuredRoot.trim());
  }

  const mainSiblingRoot = join(context.repositoriesRoot, repositoryName);
  if (context.workspaceId) {
    const matchingWorktreeRoot = join(
      mainSiblingRoot,
      '.worktrees',
      context.workspaceId,
    );
    if (existsSync(matchingWorktreeRoot)) {
      return canonicalPath(matchingWorktreeRoot);
    }
  }

  return canonicalPath(mainSiblingRoot);
};
