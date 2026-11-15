import { untrustedCheckoutGit } from './diff';

/**
 * Keeps file versions recorded for a Run in the repository's own object store.
 *
 * Versions are written as loose blobs and anchored under a Hey Hey-owned ref,
 * `refs/heyhey/runs/<runId>`, so routine `git gc` keeps them. The ref points at
 * a commit chain whose trees hold each emission's blobs; branches, the index
 * and the working tree are never touched. Linked worktrees share the main
 * object store and refs, so the ids resolve from any checkout of the
 * repository.
 *
 * Every command goes through `untrustedCheckoutGit` because the agent has had a
 * shell in the checkout.
 */

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface BlobDiffRanges {
  beforeRanges: LineRange[];
  afterRanges: LineRange[];
}

const ANCHOR_IDENTITY = {
  GIT_AUTHOR_NAME: 'Hey Hey',
  GIT_AUTHOR_EMAIL: 'heyhey@localhost',
  GIT_COMMITTER_NAME: 'Hey Hey',
  GIT_COMMITTER_EMAIL: 'heyhey@localhost',
};

export const runAnchorRef = (runId: string): string => `refs/heyhey/runs/${runId}`;

/** Writes exact content bytes as a blob; `--no-filters` keeps repository filters from running. */
export const writeBlob = async (repoPath: string, content: string): Promise<string> =>
  (
    await untrustedCheckoutGit(repoPath, ['hash-object', '-w', '--no-filters', '--stdin'], {
      input: content,
    })
  ).trim();

const readRef = async (repoPath: string, ref: string): Promise<string | null> => {
  try {
    const value = (
      await untrustedCheckoutGit(repoPath, ['rev-parse', '--verify', '-q', ref])
    ).trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    // `rev-parse --verify -q` exits 1 when the ref does not exist yet.
    if ((error as { code?: number }).code === 1) {
      return null;
    }
    throw error;
  }
};

/**
 * Adds one commit to the Run's anchor chain whose tree holds `objectIds`, so
 * they stay reachable. The tree is flat and names each blob by its own id.
 */
export const anchorBlobs = async (
  repoPath: string,
  runId: string,
  message: string,
  objectIds: readonly string[],
): Promise<void> => {
  const unique = [...new Set(objectIds)].sort();
  if (unique.length === 0) {
    return;
  }

  const treeInput = unique.map((objectId) => `100644 blob ${objectId}\t${objectId}\n`).join('');
  const tree = (await untrustedCheckoutGit(repoPath, ['mktree'], { input: treeInput })).trim();

  const ref = runAnchorRef(runId);
  const parent = await readRef(repoPath, ref);
  const commit = (
    await untrustedCheckoutGit(
      repoPath,
      ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message],
      { env: ANCHOR_IDENTITY },
    )
  ).trim();

  // The old value guards against a concurrent emission moving the anchor.
  await untrustedCheckoutGit(repoPath, ['update-ref', ref, commit, parent ?? '']);
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

const rangeFrom = (start: string, count: string | undefined): LineRange | null => {
  const lines = count === undefined ? 1 : Number(count);
  if (lines === 0) {
    return null;
  }
  const startLine = Number(start);
  return { startLine, endLine: startLine + lines - 1 };
};

/** Parses zero-context hunk headers; a side with no lines in a hunk adds no range. */
export const parseZeroContextHunks = (diff: string): BlobDiffRanges => {
  const ranges: BlobDiffRanges = { beforeRanges: [], afterRanges: [] };
  for (const line of diff.split('\n')) {
    const match = HUNK_HEADER.exec(line);
    if (!match) {
      continue;
    }
    const before = rangeFrom(match[1]!, match[2]);
    const after = rangeFrom(match[3]!, match[4]);
    if (before) {
      ranges.beforeRanges.push(before);
    }
    if (after) {
      ranges.afterRanges.push(after);
    }
  }
  return ranges;
};

/** Changed line ranges between two stored blobs. */
export const diffBlobs = async (
  repoPath: string,
  beforeObjectId: string,
  afterObjectId: string,
): Promise<BlobDiffRanges> => {
  if (beforeObjectId === afterObjectId) {
    return { beforeRanges: [], afterRanges: [] };
  }
  const diff = await untrustedCheckoutGit(repoPath, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--unified=0',
    beforeObjectId,
    afterObjectId,
  ]);
  return parseZeroContextHunks(diff);
};
