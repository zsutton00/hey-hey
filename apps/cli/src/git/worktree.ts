import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
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

const execGit = (
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<GitCommandOutput> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, ...(env ? { env } : {}) }, (error, stdout, stderr) => {
      if (error) {
        // The callback form hands stderr over separately; keep git's message on the error.
        reject(Object.assign(error, { stderr: toText(stderr) }));
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

// Puts an already-registered worktree back on `branch`. `git switch` refuses to
// overwrite uncommitted changes, so a dirty worktree surfaces git's own error
// instead of losing work.
export const switchWorktreeToBranch = async (
  options: AttachWorktreeOptions,
): Promise<WorktreeInfo> => {
  await execGit(['switch', options.branch], options.worktreePath);

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

export interface RegisteredWorktree {
  /** Null when the worktree's HEAD is detached. */
  branch: string | null;
  worktreePath: string;
}

export interface WorktreeInventory {
  /** The repository's own folder: git always lists it first, whichever worktree `repoPath` is. */
  mainFolder: RegisteredWorktree;
  /** Linked worktrees only. Prunable ones (folder gone) are not places to work in. */
  linkedWorktrees: RegisteredWorktree[];
}

/**
 * Reads the main folder and linked worktrees from one `git worktree list`, so a
 * folder is never both. Works when `repoPath` is itself a linked worktree.
 * Read-only.
 */
export const readWorktreeInventory = async (repoPath: string): Promise<WorktreeInventory> => {
  const [main, ...linkedEntries] = await listWorktrees(repoPath);
  if (!main) {
    throw new Error(`git listed no worktrees for ${repoPath}`);
  }

  return {
    mainFolder: { branch: main.branch, worktreePath: main.worktreePath },
    linkedWorktrees: linkedEntries
      .filter((entry) => !entry.bare && !entry.prunable)
      .map((entry) => ({ branch: entry.branch, worktreePath: entry.worktreePath })),
  };
};

export interface BranchSearchResult {
  branches: string[];
  /** True when more branches matched than `limit`. */
  truncated: boolean;
}

/**
 * Searches local branch names. Matching is case-insensitive; an empty query
 * matches every branch. A branch named exactly the query, or under it, stops a
 * new branch of that name, so those come first and are never lost to the limit.
 * The other matches follow, most recently committed first. Git's output is
 * streamed, so a huge branch list does not overflow a buffer. Read-only.
 */
export const searchLocalBranches = async (
  repoPath: string,
  query: string,
  limit: number,
): Promise<BranchSearchResult> => {
  const needle = query.trim().toLowerCase();
  const blocking: string[] = [];
  const others: string[] = [];
  let matchCount = 0;
  const child = spawn(
    'git',
    ['for-each-ref', '--sort=-committerdate', '--format=%(refname:lstrip=2)', 'refs/heads'],
    { cwd: repoPath, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const exitCode = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  // A spawn failure must not surface as unhandled before the await below.
  exitCode.catch(() => undefined);

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    const branch = line.trim();
    const name = branch.toLowerCase();
    if (branch === '' || !name.includes(needle)) {
      continue;
    }
    matchCount += 1;
    if (name === needle) {
      blocking.unshift(branch);
    } else if (name.startsWith(`${needle}/`)) {
      blocking.push(branch);
    } else if (others.length < limit) {
      others.push(branch);
    }
  }

  const code = await exitCode;
  if (code !== 0) {
    throw new Error(`git for-each-ref failed (exit ${String(code)}): ${stderr.trim()}`);
  }

  return { branches: [...blocking, ...others].slice(0, limit), truncated: matchCount > limit };
};

/**
 * Reads the branch checked out in a folder without changing it.
 * Returns null for a detached HEAD.
 */
export async function readCheckedOutBranch(folder: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(['symbolic-ref', '--short', '-q', 'HEAD'], folder);
    const branch = stdout.trim();

    return branch === '' ? null : branch;
  } catch (error) {
    // `-q` exits 1 with no output when HEAD is detached; any other failure is real.
    if (isExitCode(error, 1)) {
      return null;
    }
    throw error;
  }
}

export interface CheckedOutPlace {
  kind: 'MAIN_FOLDER' | 'WORKTREE';
  /** Null means detached HEAD. */
  branch: string | null;
  /** Top-level folder of the worktree; absent for the main folder. */
  worktreePath?: string;
}

/**
 * Reads where `folder` is checked out: the branch (null when detached) and
 * whether it is the main folder or a linked worktree. A linked worktree's git
 * dir differs from the repository's common git dir. Read-only; throws git's own
 * error when the folder cannot be read.
 */
export async function readCheckedOutPlace(folder: string): Promise<CheckedOutPlace> {
  const branch = await readCheckedOutBranch(folder);
  const { stdout } = await execGit(
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
    folder,
  );
  const [gitDir, commonDir, topLevel] = stdout.split('\n').map((line) => line.trim());

  if (gitDir === undefined || commonDir === undefined || gitDir === commonDir) {
    return { kind: 'MAIN_FOLDER', branch };
  }

  return { kind: 'WORKTREE', branch, worktreePath: topLevel ?? folder };
}

const isExitCode = (error: unknown, code: number): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

/**
 * True when `folder` is inside a git work tree; false only when git itself says
 * it is not a repository. A missing folder, a permissions failure, an unsafe
 * (dubious ownership) repository or a git that cannot run all throw, with git's
 * own message, so the caller can report the real cause. Read-only.
 */
export const isGitRepository = async (folder: string): Promise<boolean> => {
  try {
    const { stdout } = await execGit(['rev-parse', '--is-inside-work-tree'], folder, {
      ...process.env,
      // Git's non-repository message is only stable in the C locale.
      LC_ALL: 'C',
    });

    return stdout.trim() === 'true';
  } catch (error) {
    if (isNotAGitRepositoryError(error)) {
      return false;
    }
    throw error;
  }
};

const isNotAGitRepositoryError = (error: unknown): boolean =>
  error instanceof Error &&
  'stderr' in error &&
  typeof error.stderr === 'string' &&
  error.stderr.includes('not a git repository');
