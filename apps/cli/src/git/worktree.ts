import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface GitCommandOutput {
  stdout: string;
  stderr: string;
}

const toText = (value: string | Buffer | undefined): string =>
  typeof value === 'string' ? value : (value?.toString('utf8') ?? '');

const isPromisifiedOutput = (
  value: string | Buffer | GitCommandOutput | undefined,
): value is GitCommandOutput =>
  typeof value === 'object' &&
  value !== null &&
  'stdout' in value &&
  typeof value.stdout === 'string' &&
  'stderr' in value &&
  typeof value.stderr === 'string';

const execGit = (args: readonly string[], cwd: string): Promise<GitCommandOutput> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      // Node returns stdout/stderr as separate callback arguments. The object
      // branch also accepts the shape exposed by Node's custom promisifier,
      // which keeps this process boundary deterministic under test doubles.
      if (isPromisifiedOutput(stdout)) {
        resolve(stdout);
        return;
      }
      resolve({ stdout: toText(stdout), stderr: toText(stderr) });
    });
  });

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  repoPath: string;
}

interface WorktreeEntry {
  worktreePath: string;
  head: string;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

export interface BranchWorktreeState {
  branchExists: boolean;
  checkedOutWorktree: WorktreeEntry | null;
  worktrees: WorktreeEntry[];
}

export interface CreateWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  branch?: string;
  baseBranch?: string;
}

export interface AttachWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  branch: string;
}

interface RemoveWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  force?: boolean;
}

const generateWorktreeBranch = (shortId: string): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const timestamp = [
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  return `heyhey/run-${shortId}-${timestamp}`;
};

const toBranchSafeName = (branch: string): string => branch.replace(/[/\\]/gu, '-');

export const createWorktree = async (options: CreateWorktreeOptions): Promise<WorktreeInfo> => {
  const branch =
    options.branch ??
    generateWorktreeBranch(options.worktreePath.split('/').pop()?.slice(0, 8) ?? 'unknown');

  const args = ['worktree', 'add', options.worktreePath, '-b', branch];
  if (options.baseBranch) {
    args.push(options.baseBranch);
  }

  await execGit(args, options.repoPath);

  return {
    worktreePath: options.worktreePath,
    branch,
    repoPath: options.repoPath,
  };
};

export const attachWorktree = async (options: AttachWorktreeOptions): Promise<WorktreeInfo> => {
  await execGit(['worktree', 'add', options.worktreePath, options.branch], options.repoPath);

  return {
    worktreePath: options.worktreePath,
    branch: options.branch,
    repoPath: options.repoPath,
  };
};

const removeWorktree = async (options: RemoveWorktreeOptions): Promise<void> => {
  const args = ['worktree', 'remove', options.worktreePath];
  if (options.force) {
    args.push('--force');
  }

  await execGit(args, options.repoPath);
};

const parseWorktreeListPorcelain = (output: string): WorktreeEntry[] => {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      if (current.worktreePath) {
        entries.push({
          worktreePath: current.worktreePath,
          head: current.head ?? '',
          branch: current.branch ?? null,
          bare: current.bare ?? false,
          prunable: current.prunable ?? false,
        });
      }
      current = {};
      continue;
    }

    if (line.startsWith('worktree ')) {
      current.worktreePath = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true;
    }
  }

  if (current.worktreePath) {
    entries.push({
      worktreePath: current.worktreePath,
      head: current.head ?? '',
      branch: current.branch ?? null,
      bare: current.bare ?? false,
      prunable: current.prunable ?? false,
    });
  }

  return entries;
};

const REBASE_HEAD_NAME_PATHS = ['rebase-merge/head-name', 'rebase-apply/head-name'] as const;

const readFileIfPresent = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

// While a rebase is in progress the worktree's HEAD is detached and
// `git worktree list` omits the branch, yet git still treats the branch as
// held by that worktree. The branch being rebased is recorded in head-name.
const readRebasingBranch = async (worktreePath: string): Promise<string | null> => {
  const { stdout } = await execGit(['rev-parse', '--absolute-git-dir'], worktreePath);
  const gitDir = stdout.trim();
  for (const relativePath of REBASE_HEAD_NAME_PATHS) {
    const headName = (await readFileIfPresent(path.join(gitDir, relativePath)))?.trim();
    if (headName?.startsWith('refs/heads/')) return headName.slice('refs/heads/'.length);
  }
  return null;
};

const listWorktrees = async (repoPath: string): Promise<WorktreeEntry[]> => {
  const { stdout } = await execGit(['worktree', 'list', '--porcelain'], repoPath);
  const entries = parseWorktreeListPorcelain(stdout);
  return Promise.all(
    entries.map(async (entry) =>
      entry.branch === null && !entry.bare && !entry.prunable
        ? { ...entry, branch: await readRebasingBranch(entry.worktreePath) }
        : entry,
    ),
  );
};

const doesLocalBranchExist = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath);
    return true;
  } catch {
    return false;
  }
};

export const getBranchWorktreeState = async (
  repoPath: string,
  branch: string,
): Promise<BranchWorktreeState> => {
  const worktrees = await listWorktrees(repoPath);
  const checkedOutWorktree = worktrees.find((entry) => entry.branch === branch) ?? null;
  return {
    branchExists: checkedOutWorktree !== null || (await doesLocalBranchExist(repoPath, branch)),
    checkedOutWorktree,
    worktrees,
  };
};

export const isBranchRegisteredToWorktree = async (
  repoPath: string,
  branch: string,
): Promise<boolean> => {
  const worktrees = await listWorktrees(repoPath);
  return worktrees.some((entry) => entry.branch === branch);
};

export { toBranchSafeName };
