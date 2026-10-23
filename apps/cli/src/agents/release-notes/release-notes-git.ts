import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServerLogger } from '../../server/logger';

const execFileAsync = promisify(execFile);

/** A hung remote (unreachable host, credential prompt) must not stall the report. */
const FETCH_TIMEOUT_MS = 60_000;

/** Default-branch commits read per repository; older ones become a coverage limitation. */
const MAX_COMMITS_PER_REPOSITORY = 200;
/** Branch commits listed per merge so COMMIT report hashes can be matched. */
const MAX_MERGED_COMMITS_PER_MERGE = 50;
const MAX_FILES_PER_COMMIT = 40;
const RECORD = '\x1e';
const FIELD = '\x1f';

export interface ReleaseNotesMergedCommit {
  hash: string;
  subject: string;
}

export interface ReleaseNotesCommit {
  hash: string;
  committedAt: string;
  author: string;
  subject: string;
  /** Files changed relative to the default branch's previous commit. */
  files: string[];
  filesTruncated: boolean;
  /** For a merge commit, the branch commits it brought onto the default branch. */
  mergedCommits: ReleaseNotesMergedCommit[];
}

export type ReleaseNotesRepository =
  | {
      serviceId: string;
      repositoryName: string;
      repositoryPath: string;
      status: 'READ';
      /** The remote HEAD ref, for example `origin/main`. */
      defaultBranch: string;
      defaultBranchHead: string;
      /** Export of `defaultBranchHead`; the agent reads code here, never the checkout. */
      codeDirectory: string;
      commits: ReleaseNotesCommit[];
      commitsTruncated: boolean;
      refresh: { status: 'REFRESHED' } | { status: 'FAILED'; reason: string };
    }
  | {
      serviceId: string;
      repositoryName: string;
      repositoryPath: string;
      status: 'UNREADABLE';
      reason: string;
    };

const git = async (
  repositoryPath: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
  return stdout;
};

const gitErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null) {
    const failure = error as { killed?: boolean; signal?: string | null; stderr?: unknown };
    if (failure.killed && failure.signal) return 'timed out';
    if (typeof failure.stderr === 'string' && failure.stderr.trim().length > 0) {
      return failure.stderr.trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
};

/**
 * Writes the tree at `commit` into `destination` with `git archive | tar -x`.
 * Nothing is checked out and no worktree is registered, so the checkout's
 * files, index, local branches and worktree list are untouched.
 */
const exportCommit = async (
  repositoryPath: string,
  commit: string,
  destination: string,
): Promise<void> => {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const archive = spawn('git', ['-C', repositoryPath, 'archive', '--format=tar', commit], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const extract = spawn('tar', ['-x', '-f', '-', '-C', destination], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    archive.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    extract.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    archive.stdout.pipe(extract.stdin);
    // The two 'close' events can arrive in either order; settle only after both.
    const exitCode = (child: typeof archive | typeof extract) =>
      new Promise<number | null>((resolveCode, rejectCode) => {
        child.on('error', rejectCode);
        child.on('close', resolveCode);
      });
    Promise.all([exitCode(archive), exitCode(extract)]).then(([archiveCode, extractCode]) => {
      if (archiveCode === 0 && extractCode === 0) resolve();
      else
        reject(
          new Error(
            stderr.trim() ||
              `git archive exited ${String(archiveCode)}, tar ${String(extractCode)}`,
          ),
        );
    }, reject);
  });
};

/**
 * Reads what shipped on one repository's default branch in the window. The
 * default branch is the remote HEAD (`origin/HEAD`), never an assumed name, and
 * only its first-parent history counts: a merge commit is one shipped change,
 * and work that never reached the default branch is never read. A fetch that
 * changes only the remote-tracking ref precedes the read, and the branch tip
 * is exported to `snapshotRoot` so code evidence matches the history.
 */
export const readReleaseNotesRepository = async (input: {
  serviceId: string;
  repositoryPath: string;
  windowStart: string;
  windowEnd: string;
  /** Run-owned read-only directory; this repository exports into a child named by serviceId. */
  snapshotRoot: string;
  logger: ServerLogger;
}): Promise<ReleaseNotesRepository> => {
  const { serviceId, repositoryPath, logger } = input;
  const repositoryName = path.basename(repositoryPath);
  let defaultBranch: string;
  try {
    defaultBranch = (
      await git(repositoryPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    ).trim();
  } catch {
    return {
      serviceId,
      repositoryName,
      repositoryPath,
      status: 'UNREADABLE',
      reason:
        'The repository has no origin/HEAD, so its default branch is unknown. Running `git remote set-head origin --auto` sets it.',
    };
  }
  let refresh: Extract<ReleaseNotesRepository, { status: 'READ' }>['refresh'];
  try {
    const branch = defaultBranch.replace(/^origin\//u, '');
    await git(
      repositoryPath,
      [
        'fetch',
        '--no-tags',
        '--no-prune',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        'origin',
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      { timeoutMs: FETCH_TIMEOUT_MS },
    );
    refresh = { status: 'REFRESHED' };
  } catch (error) {
    const gitError = gitErrorMessage(error);
    logger.warn('release_notes.git.refresh_failed', {
      serviceId,
      repositoryName,
      repositoryPath,
      defaultBranch,
      error: gitError,
    });
    refresh = {
      status: 'FAILED',
      reason: `Refreshing ${defaultBranch} from origin failed (${gitError}); ${repositoryName} was read from the last fetched ${defaultBranch}, so its coverage may be stale.`,
    };
  }
  try {
    const defaultBranchHead = (await git(repositoryPath, ['rev-parse', defaultBranch])).trim();
    const log = await git(repositoryPath, [
      'log',
      defaultBranch,
      '--first-parent',
      '--diff-merges=first-parent',
      '--name-only',
      `--since=${input.windowStart}`,
      `--until=${input.windowEnd}`,
      `--max-count=${String(MAX_COMMITS_PER_REPOSITORY + 1)}`,
      `--format=${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%cI${FIELD}%s`,
    ]);
    const records = log.split(RECORD).filter((record) => record.trim().length > 0);
    const commitsTruncated = records.length > MAX_COMMITS_PER_REPOSITORY;
    const commits: ReleaseNotesCommit[] = [];
    for (const record of records.slice(0, MAX_COMMITS_PER_REPOSITORY)) {
      const [header = '', ...fileLines] = record.split('\n');
      const [hash = '', parents = '', author = '', committedAt = '', subject = ''] =
        header.split(FIELD);
      const files = fileLines.map((line) => line.trim()).filter((line) => line.length > 0);
      const [firstParent, ...mergedParents] = parents.split(' ').filter(Boolean);
      const mergedCommits =
        firstParent && mergedParents.length > 0
          ? (
              await git(repositoryPath, [
                'log',
                `--max-count=${String(MAX_MERGED_COMMITS_PER_MERGE)}`,
                `--format=%H${FIELD}%s`,
                ...mergedParents,
                `^${firstParent}`,
              ])
            )
              .split('\n')
              .filter((line) => line.length > 0)
              .map((line) => {
                const [mergedHash = '', mergedSubject = ''] = line.split(FIELD);
                return { hash: mergedHash, subject: mergedSubject };
              })
          : [];
      commits.push({
        hash,
        committedAt,
        author,
        subject,
        files: files.slice(0, MAX_FILES_PER_COMMIT),
        filesTruncated: files.length > MAX_FILES_PER_COMMIT,
        mergedCommits,
      });
    }
    const codeDirectory = path.join(input.snapshotRoot, serviceId);
    try {
      await exportCommit(repositoryPath, defaultBranchHead, codeDirectory);
    } catch (error) {
      const exportError = gitErrorMessage(error);
      logger.error('release_notes.git.export_failed', {
        serviceId,
        repositoryName,
        repositoryPath,
        defaultBranch,
        error: exportError,
      });
      await fs.rm(codeDirectory, { recursive: true, force: true });
      return {
        serviceId,
        repositoryName,
        repositoryPath,
        status: 'UNREADABLE',
        reason: `Exporting ${defaultBranch} of ${repositoryName} for reading failed: ${exportError}`,
      };
    }
    return {
      serviceId,
      repositoryName,
      repositoryPath,
      status: 'READ',
      defaultBranch,
      defaultBranchHead,
      codeDirectory,
      commits,
      commitsTruncated,
      refresh,
    };
  } catch (error) {
    return {
      serviceId,
      repositoryName,
      repositoryPath,
      status: 'UNREADABLE',
      reason: `Reading ${defaultBranch} failed: ${gitErrorMessage(error)}`,
    };
  }
};
