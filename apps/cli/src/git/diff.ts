import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { stripCredentialEnvironment } from '../agent-runtime/node/credential-environment';
import type { LocalDiffFilePatch } from '../shared/agent-bridge-contract/runtime-types';
import type { EvalRecordedFileChange } from '@hey-hey/contracts/api/models';
import type {
  CliReadChangedFileDetail,
  CliReadChangedFileInventoryEntry,
} from '@hey-hey/contracts/agent-bridge';

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
    // Whitespace at the end is part of the patch: a trailing blank context line
    // or the final newline, and `git apply` rejects a hunk that lacks either.
    if (!section.trim()) {
      continue;
    }

    // Extract file path from "diff --git a/<path> b/<path>".
    // Non-greedy on the a/ side to avoid mis-parsing paths containing " b/".
    const headerMatch = /^diff --git a\/.+? b\/(.+)$/mu.exec(section);
    if (!headerMatch || !headerMatch[1]) {
      continue;
    }

    const filePath = headerMatch[1].trim();

    // Reject paths that attempt to escape the repo root.
    if (filePath.startsWith('/') || filePath.split('/').includes('..')) {
      continue;
    }

    patches.push({ filePath, diff: section });
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

/** Safe, loggable description of a failed git invocation. */
export interface GitFailureDetail {
  command: string;
  exitCode: number | string | null;
  message: string;
}

const MAX_GIT_FAILURE_MESSAGE_LENGTH = 500;

const isExecFailure = (
  error: unknown,
): error is Error & { code?: number | string; cmd?: string; stderr?: string } =>
  error instanceof Error;

/** Extracts the git operation, exit code and error text from a failed `execFile` call. */
export const describeGitFailure = (error: unknown): GitFailureDetail => {
  if (!isExecFailure(error)) {
    return { command: 'git', exitCode: null, message: String(error) };
  }

  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const message = (stderr || error.message).slice(0, MAX_GIT_FAILURE_MESSAGE_LENGTH);

  return { command: error.cmd ?? 'git', exitCode: error.code ?? null, message };
};

const gitSucceeds = async (repoPath: string, args: string[]): Promise<boolean> => {
  try {
    await execFileAsync('git', args, { cwd: repoPath });
    return true;
  } catch (error) {
    if (isExecFailure(error) && error.code === 1) {
      return false;
    }

    throw error;
  }
};

/**
 * True only when `HEAD` names a branch that has no commits yet. Any other
 * failure to resolve `HEAD` (corrupt repository, detached bad ref, not a
 * repository) is not an unborn branch and propagates with its original cause.
 */
const isUnbornBranch = async (repoPath: string): Promise<boolean> => {
  let branchRef: string;
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', 'HEAD'], {
      cwd: repoPath,
    });
    branchRef = stdout.trim();
  } catch (error) {
    if (isExecFailure(error) && error.code === 1) {
      return false;
    }

    throw error;
  }

  const branchExists = await gitSucceeds(repoPath, ['show-ref', '--verify', '--quiet', branchRef]);

  return !branchExists;
};

/**
 * Ref that working-tree changes are measured against. A repository whose
 * branch has no commits has no `HEAD` commit, so it uses the empty tree and
 * every indexed file counts as added. Other `HEAD` failures are rethrown.
 */
const resolveWorkingTreeBaseRef = async (repoPath: string): Promise<string> => {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: repoPath });
    return 'HEAD';
  } catch (headError) {
    if (!(await isUnbornBranch(repoPath))) {
      throw headError;
    }

    const { stdout } = await execFileAsync('git', ['hash-object', '-t', 'tree', '/dev/null'], {
      cwd: repoPath,
    });
    return stdout.trim();
  }
};

/**
 * Lists every currently dirty path relative to `repoPath`, including staged,
 * unstaged, deleted, renamed, and untracked files.
 */
export const listGitChangedFilePaths = async (repoPath: string): Promise<string[]> => {
  const baseRef = await resolveWorkingTreeBaseRef(repoPath);
  const [{ stdout: trackedOutput }, { stdout: untrackedOutput }] = await Promise.all([
    execFileAsync('git', ['diff', '--name-only', '-z', baseRef], {
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
 * Runs git in a checkout an agent has had a shell in. Everything in its `.git`
 * is untrusted, so nothing it configured may run on the host: credentials are
 * stripped, an external diff program from the environment is dropped, fsmonitor
 * and hooks are switched off, and every filter driver it defined is emptied.
 * Diff commands also pass `--no-ext-diff --no-textconv` themselves.
 */
export const untrustedCheckoutGit = async (
  repoPath: string,
  args: readonly string[],
  options: { input?: string; env?: Readonly<Record<string, string>> } = {},
): Promise<string> => {
  const env = { ...stripCredentialEnvironment(process.env), ...options.env };
  delete env['GIT_EXTERNAL_DIFF'];
  const overrides = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hooksPath=/dev/null',
    ...(await disabledFilterOverrides(repoPath, env)),
  ];
  const execution = execFileAsync('git', [...overrides, ...args], {
    cwd: repoPath,
    env,
    maxBuffer: MAX_DIFF_BUFFER,
  });
  if (options.input !== undefined) {
    execution.child.stdin?.end(options.input);
  }
  const { stdout } = await execution;

  return stdout;
};

/**
 * `-c` overrides that empty every clean/smudge/process filter the checkout's own
 * configuration defines, including filters it pulls in through `include` and
 * `includeIf` files, which git applies when it diffs. Filters from the machine's
 * system and global configuration are the user's own and stay.
 */
const disabledFilterOverrides = async (
  repoPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> => {
  let configured: string;
  try {
    ({ stdout: configured } = await execFileAsync(
      'git',
      ['config', '--show-scope', '--includes', '--name-only', '--get-regexp', '^filter\\.'],
      { cwd: repoPath, env },
    ));
  } catch (error) {
    // `git config --get-regexp` exits 1 when nothing matches.
    if ((error as { code?: number }).code === 1) {
      return [];
    }
    throw error;
  }
  const drivers = new Set<string>();
  for (const line of configured.split('\n')) {
    const [scope, key = ''] = line.split('\t');
    if (scope !== 'local' && scope !== 'worktree') {
      continue;
    }
    const driver = /^filter\.(.+)\.(?:clean|smudge|process|required)$/iu.exec(key)?.[1];
    if (driver) {
      drivers.add(driver);
    }
  }

  return [...drivers].flatMap((driver) => [
    '-c',
    `filter.${driver}.clean=`,
    '-c',
    `filter.${driver}.smudge=`,
    '-c',
    `filter.${driver}.process=`,
    '-c',
    `filter.${driver}.required=false`,
  ]);
};

/**
 * Generate a "new file" diff for an untracked file using git diff --no-index.
 * `untrusted` is for checkouts an agent has had a shell in (see `untrustedCheckoutGit`).
 */
const diffUntrackedFile = async (
  repoPath: string,
  filePath: string,
  options: { untrusted?: boolean } = {},
): Promise<RawFilePatch | null> => {
  // `--` keeps a file named like an option (`--output=...`) from being read as one.
  const diffArgs = options.untrusted
    ? [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-index',
        '--unified=3',
        '--',
        '/dev/null',
        filePath,
      ]
    : ['diff', '--no-index', '--unified=3', '/dev/null', filePath];
  try {
    const stdout = options.untrusted
      ? await untrustedCheckoutGit(repoPath, diffArgs)
      : (await execFileAsync('git', diffArgs, { cwd: repoPath })).stdout;
    return stdout.trim() ? { filePath, diff: stdout } : null;
  } catch (error: unknown) {
    // git diff --no-index exits with code 1 when files differ (normal case).
    const execError = error as { code?: number; stdout?: string };
    if (execError.code === 1 && execError.stdout) {
      return execError.stdout.trim() ? { filePath, diff: execError.stdout } : null;
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

  const diffTarget = base ? `${base}..HEAD` : await resolveWorkingTreeBaseRef(repoPath);
  const args: string[] = ['diff', '--unified=3', diffTarget];

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

/** Counts hunk lines only: everything before the first `@@` is the file header, whatever it starts with. */
const countPatchLines = (patch: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (!inHunk) {
      inHunk = line.startsWith('@@');
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

const patchStatus = (patch: string): EvalRecordedFileChange['status'] => {
  if (/^new file mode /mu.test(patch)) {
    return 'added';
  }
  if (/^deleted file mode /mu.test(patch)) {
    return 'deleted';
  }

  return 'modified';
};

/**
 * Everything changed in the working tree relative to `commit`, including new
 * untracked files (which `git diff` alone omits). Ignored files are left out.
 * Throws when git cannot produce the diff, so callers never record a partial
 * result as complete.
 */
export const captureChangesSinceCommit = async (options: {
  repoPath: string;
  commit: string;
}): Promise<EvalRecordedFileChange[]> => {
  const { repoPath, commit } = options;
  const trackedDiff = await untrustedCheckoutGit(repoPath, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--unified=3',
    commit,
  ]);
  const untrackedList = await untrustedCheckoutGit(repoPath, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const files: EvalRecordedFileChange[] = splitIntoPatchesByFile(trackedDiff).map(
    ({ filePath, diff }) => ({
      path: filePath,
      status: patchStatus(diff),
      ...countPatchLines(diff),
      patch: diff,
    }),
  );

  for (const untrackedPath of untrackedList.split('\0').filter(Boolean)) {
    const patch = await diffUntrackedFile(repoPath, untrackedPath, { untrusted: true });
    if (patch) {
      files.push({
        path: patch.filePath,
        status: 'added',
        ...countPatchLines(patch.diff),
        patch: patch.diff,
      });
      continue;
    }

    // git prints no diff for an empty new file; anything else missing is a failed capture.
    const { size } = await stat(path.join(repoPath, untrackedPath));
    if (size > 0) {
      throw new Error(`The new file ${untrackedPath} could not be captured.`);
    }
    files.push({ path: untrackedPath, status: 'added', additions: 0, deletions: 0, patch: '' });
  }

  return files;
};
