import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LocalDiffFilePatch } from '../shared/agent-bridge-contract/runtime-types';
import type {
  CliReadChangedFileDetail,
  CliReadChangedFileInventoryEntry,
} from '../shared/agent-bridge-contract/generated/api';

const execFileAsync = promisify(execFile);

/** 50 MB — large worktrees can produce diffs well beyond Node's 1 MB default. */
const MAX_DIFF_BUFFER = 50 * 1024 * 1024;

export interface GetGitDiffOptions {
  /** Absolute path to the repository or worktree directory. */
  repoPath: string;
  /** Optional base ref to diff against (e.g. a merge-base SHA). Defaults to HEAD. */
  base?: string;
  /** When non-empty, restrict the diff to only these file paths. */
  paths?: string[];
}

type RawFilePatch = { filePath: string; diff: string };

/**
 * Splits unified diff output into per-file patches.
 * Each patch starts with a "diff --git" header line.
 */
const splitIntoPatchesByFile = (diffOutput: string): RawFilePatch[] => {
  const patches: RawFilePatch[] = [];
  const sections = diffOutput.split(/(?=^diff --git )/mu);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) {
      continue;
    }

    // Extract file path from "diff --git a/<path> b/<path>".
    // Non-greedy on the a/ side to avoid mis-parsing paths containing " b/".
    const headerMatch = /^diff --git a\/.+? b\/(.+)$/mu.exec(trimmed);
    if (!headerMatch || !headerMatch[1]) {
      continue;
    }

    const filePath = headerMatch[1].trim();

    // Reject paths that attempt to escape the repo root.
    if (filePath.startsWith('/') || filePath.split('/').includes('..')) {
      continue;
    }

    patches.push({ filePath, diff: trimmed });
  }

  return patches;
};

/**
 * Reads file contents at a given git ref. Returns null when the path does not
 * exist at that ref (e.g. the file was added on the current branch).
 */
const readContentAtRef = async (
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
      cwd: repoPath,
      maxBuffer: MAX_DIFF_BUFFER,
    });
    return stdout;
  } catch {
    return null;
  }
};

/**
 * Reads file contents from the working tree. Returns null when the file does
 * not exist on disk (e.g. it was deleted).
 */
const readContentFromDisk = async (repoPath: string, filePath: string): Promise<string | null> => {
  try {
    return await readFile(path.join(repoPath, filePath), 'utf8');
  } catch {
    return null;
  }
};

const pathExistsAtRef = async (
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<boolean> => {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${ref}:${filePath}`], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
};

const pathExistsOnDisk = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const stats = await stat(path.join(repoPath, filePath));
    return stats.isFile();
  } catch {
    return false;
  }
};

const resolveChangedFileStatus = async (
  repoPath: string,
  filePath: string,
  ref = 'HEAD',
): Promise<CliReadChangedFileInventoryEntry['status']> => {
  const [existsBefore, existsAfter] = await Promise.all([
    pathExistsAtRef(repoPath, ref, filePath),
    pathExistsOnDisk(repoPath, filePath),
  ]);
  if (!existsBefore && existsAfter) return 'create';
  if (existsBefore && !existsAfter) return 'delete';
  return 'modify';
};

/**
 * Detect which of the given paths are untracked by git.
 */
const findUntrackedPaths = async (repoPath: string, paths: string[]): Promise<Set<string>> => {
  if (paths.length === 0) return new Set();
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '--', ...paths],
      { cwd: repoPath },
    );
    return new Set(stdout.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
};

/**
 * Lists every currently dirty path relative to `repoPath`, including staged,
 * unstaged, deleted, renamed, and untracked files.
 */
export const listGitChangedFilePaths = async (repoPath: string): Promise<string[]> => {
  const [{ stdout: trackedOutput }, { stdout: untrackedOutput }] = await Promise.all([
    execFileAsync('git', ['diff', '--name-only', '-z', 'HEAD'], {
      cwd: repoPath,
      maxBuffer: MAX_DIFF_BUFFER,
    }),
    execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: repoPath,
      maxBuffer: MAX_DIFF_BUFFER,
    }),
  ]);
  return [...new Set(`${trackedOutput}${untrackedOutput}`.split('\0').filter(Boolean))];
};

const listIgnoredPaths = (repoPath: string, paths: readonly string[]): Promise<Set<string>> => {
  if (paths.length === 0) return Promise.resolve(new Set());

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(
          new Error(Buffer.concat(stderr).toString('utf8').trim() || 'git check-ignore failed'),
        );
        return;
      }
      resolve(new Set(Buffer.concat(stdout).toString('utf8').split('\0').filter(Boolean)));
    });
    child.stdin.end(`${paths.join('\0')}\0`);
  });
};

/**
 * Lists dirty paths except those matched by the repository's effective Git
 * ignore rules. `--no-index` intentionally applies those rules to tracked
 * paths as well as untracked paths for diagnostic observers.
 */
export const listGitChangedFilePathsExcludingIgnored = async (
  repoPath: string,
): Promise<string[]> => {
  const changedPaths = await listGitChangedFilePaths(repoPath);
  const ignoredPaths = await listIgnoredPaths(repoPath, changedPaths);
  return changedPaths.filter((filePath) => !ignoredPaths.has(filePath));
};

/**
 * Returns metadata for dirty members without reading blobs or working-tree file bodies.
 */
export const getGitChangedFilesInventory = async (options: {
  repoPath: string;
  paths: readonly string[];
}): Promise<Array<Pick<CliReadChangedFileInventoryEntry, 'filePath' | 'status'>>> => {
  if (options.paths.length === 0) return [];
  const membership = new Set(options.paths);
  const changedPaths = (await listGitChangedFilePaths(options.repoPath)).filter((filePath) =>
    membership.has(filePath),
  );
  return Promise.all(
    changedPaths.map(async (filePath) => ({
      filePath,
      status: await resolveChangedFileStatus(options.repoPath, filePath),
    })),
  );
};

/** Reads complete before/after context for exactly one selected dirty file. */
export const getGitChangedFileDetail = async (options: {
  repoPath: string;
  filePath: string;
}): Promise<Omit<CliReadChangedFileDetail, 'serviceId' | 'repoPath'> | null> => {
  const patches = await getGitDiff({ repoPath: options.repoPath, paths: [options.filePath] });
  const patch = patches.find((candidate) => candidate.filePath === options.filePath);
  if (!patch) return null;
  return {
    ...patch,
    status: await resolveChangedFileStatus(options.repoPath, options.filePath),
  };
};

/**
 * Generate a "new file" diff for an untracked file using git diff --no-index.
 */
const diffUntrackedFile = async (
  repoPath: string,
  filePath: string,
): Promise<RawFilePatch | null> => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-index', '--unified=3', '/dev/null', filePath],
      { cwd: repoPath },
    );
    const trimmed = stdout.trim();
    return trimmed ? { filePath, diff: trimmed } : null;
  } catch (error: unknown) {
    // git diff --no-index exits with code 1 when files differ (normal case).
    const execError = error as { code?: number; stdout?: string };
    if (execError.code === 1 && execError.stdout) {
      const trimmed = execError.stdout.trim();
      return trimmed ? { filePath, diff: trimmed } : null;
    }
    return null;
  }
};

/**
 * Returns git diff output for the given repository path, split into per-file patches.
 *
 * With a base ref, the diff follows the worktree-session modal semantics:
 * committed changes in `<base>..HEAD` plus synthetic patches for untracked
 * files in `paths`. Without a base, it compares the working tree to `HEAD`.
 *
 * Also handles untracked (new) files that are in the paths list by generating
 * synthetic diffs via `git diff --no-index`.
 */
export const getGitDiff = async (options: GetGitDiffOptions): Promise<LocalDiffFilePatch[]> => {
  const { repoPath, base, paths } = options;

  const args: string[] = ['diff', '--unified=3', base ? `${base}..HEAD` : 'HEAD'];

  if (paths && paths.length > 0) {
    args.push('--', ...paths);
  }

  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    maxBuffer: MAX_DIFF_BUFFER,
  });
  const rawPatches = splitIntoPatchesByFile(stdout);

  // Determine which requested paths are untracked so we can:
  //   - generate synthetic diffs for them (no entry in the tracked diff output)
  //   - mark their preContent as null (they don't exist at the base ref)
  const untrackedPaths =
    paths && paths.length > 0 ? await findUntrackedPaths(repoPath, paths) : new Set<string>();

  if (untrackedPaths.size > 0) {
    const untrackedDiffs = await Promise.all(
      [...untrackedPaths].map((p) => diffUntrackedFile(repoPath, p)),
    );
    for (const diff of untrackedDiffs) {
      if (diff) rawPatches.push(diff);
    }
  }

  // Resolve the ref to read pre-content from. With a base ref, that's the base
  // (e.g. merge-base for worktree sessions); without one, HEAD.
  const preRef = base ?? 'HEAD';

  const patches = await Promise.all(
    rawPatches.map(async ({ filePath, diff }): Promise<LocalDiffFilePatch> => {
      const isUntracked = untrackedPaths.has(filePath);
      const [preContent, postContent] = await Promise.all([
        isUntracked ? Promise.resolve(null) : readContentAtRef(repoPath, preRef, filePath),
        readContentFromDisk(repoPath, filePath),
      ]);
      return { filePath, diff, preContent, postContent };
    }),
  );

  return patches;
};

/**
 * Resolves the git repository root for the given file path.
 * Returns null if the path is not inside a git repository.
 */
export const resolveGitRoot = async (filePath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(filePath),
    });
    const root = stdout.trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
};

/**
 * Attempts to resolve the merge-base SHA between HEAD and origin/HEAD.
 * Returns null if the repository has no remote or the command fails.
 */
const resolveRemoteMergeBase = async (repoPath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', 'origin/HEAD'], {
      cwd: repoPath,
    });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
};

/**
 * Counts files in `paths` that have changed inside `repoPath`.
 *
 * Without a base ref, this preserves the existing working-tree behavior by using
 * `git status --porcelain` to count modified, added, deleted, renamed, or
 * untracked files.
 *
 * With a base ref, this matches the worktree diff modal's file set by counting
 * files changed in `<base>..HEAD`, unioned with untracked files in `paths`.
 *
 * Returns 0 on git failure rather than throwing; the tick should keep emitting
 * even when one run's repo is in a transient bad state.
 */
export const countChangedFilesInPaths = async (opts: {
  repoPath: string;
  paths: readonly string[];
  base?: string;
}): Promise<number> => {
  if (opts.paths.length === 0) return 0;
  try {
    if (opts.base) {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-only', `${opts.base}..HEAD`, '--', ...opts.paths],
        { cwd: opts.repoPath, maxBuffer: MAX_DIFF_BUFFER },
      );
      const changedFiles = new Set(stdout.trim().split('\n').filter(Boolean));
      const untrackedFiles = await findUntrackedPaths(opts.repoPath, [...opts.paths]);
      for (const filePath of untrackedFiles) {
        changedFiles.add(filePath);
      }
      return changedFiles.size;
    }

    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', ...opts.paths],
      { cwd: opts.repoPath, maxBuffer: MAX_DIFF_BUFFER },
    );
    if (stdout.length === 0) return 0;
    let count = 0;
    for (const line of stdout.split('\n')) {
      if (line.length > 0) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
};
