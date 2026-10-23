import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import { readReleaseNotesRepository } from './release-notes-git';

const roots: string[] = [];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();

const commit = (cwd: string, file: string, message: string): string => {
  writeFileSync(path.join(cwd, file), message);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
};

/** A clone whose origin default branch is `trunk`, with one merged and one unmerged branch. */
const makeClone = (): { clone: string; branchCommit: string } => {
  const root = mkdtempSync(path.join(tmpdir(), 'release-notes-git-'));
  roots.push(root);
  const origin = path.join(root, 'origin');
  execFileSync('git', ['init', '-q', '-b', 'trunk', origin]);
  commit(origin, 'base.txt', 'base');
  git(origin, 'checkout', '-q', '-b', 'feature');
  const branchCommit = commit(origin, 'feature.txt', 'feature work');
  git(origin, 'checkout', '-q', 'trunk');
  git(origin, 'merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature');
  git(origin, 'checkout', '-q', '-b', 'unmerged');
  commit(origin, 'unmerged.txt', 'unmerged work');
  git(origin, 'checkout', '-q', 'trunk');
  const clone = path.join(root, 'clone');
  execFileSync('git', ['clone', '-q', origin, clone]);
  return { clone, branchCommit };
};

const snapshotRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'release-notes-snapshots-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readReleaseNotesRepository', () => {
  it('fetches new remote history without changing dirty files or the local branch tip', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'release-notes-refresh-'));
    roots.push(root);
    const remote = path.join(root, 'remote.git');
    const author = path.join(root, 'author');
    const clone = path.join(root, 'clone');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'trunk', remote]);
    execFileSync('git', ['clone', '-q', remote, author]);
    commit(author, 'base.txt', 'base');
    git(author, 'push', '-q', 'origin', 'trunk');
    execFileSync('git', ['clone', '-q', remote, clone]);
    const localHead = git(clone, 'rev-parse', 'HEAD');
    writeFileSync(path.join(clone, 'base.txt'), 'dirty local work');
    git(author, 'checkout', '-q', '-b', 'feature');
    commit(author, 'new.txt', 'new capability');
    git(author, 'checkout', '-q', 'trunk');
    git(author, 'merge', '-q', '--no-ff', 'feature', '-m', 'Ship capability');
    git(author, 'push', '-q', 'origin', 'trunk');
    const localBranches = git(clone, 'for-each-ref', 'refs/heads');
    const worktrees = git(clone, 'worktree', 'list', '--porcelain');
    const result = await readReleaseNotesRepository({
      serviceId: 'selected',
      repositoryPath: clone,
      windowStart: '2000-01-01T00:00:00Z',
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
      snapshotRoot: snapshotRoot(),
      logger: NOOP_LOGGER,
    });
    if (result.status !== 'READ') throw new Error(result.reason);
    expect(result.refresh.status).toBe('REFRESHED');
    expect(result.commits[0]?.subject).toBe('Ship capability');
    // Code is read from the exported remote tip, which has the remote-only file and no local edits.
    expect(readFileSync(path.join(result.codeDirectory, 'new.txt'), 'utf8')).toBe('new capability');
    expect(readFileSync(path.join(result.codeDirectory, 'base.txt'), 'utf8')).toBe('base');
    expect(existsSync(path.join(clone, 'new.txt'))).toBe(false);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(localHead);
    expect(readFileSync(path.join(clone, 'base.txt'), 'utf8')).toBe('dirty local work');
    expect(git(clone, 'for-each-ref', 'refs/heads')).toBe(localBranches);
    expect(git(clone, 'worktree', 'list', '--porcelain')).toBe(worktrees);
    git(clone, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    const warn = vi.fn();
    const logger: ServerLogger = Object.assign(Object.create(NOOP_LOGGER) as ServerLogger, {
      warn,
    });
    const cached = await readReleaseNotesRepository({
      serviceId: 'selected',
      repositoryPath: clone,
      windowStart: '2000-01-01T00:00:00Z',
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
      snapshotRoot: snapshotRoot(),
      logger,
    });
    if (cached.status !== 'READ') throw new Error(cached.reason);
    if (cached.refresh.status !== 'FAILED') throw new Error('expected a failed refresh');
    expect(cached.refresh.reason).toContain('clone');
    expect(cached.refresh.reason).toContain('may be stale');
    expect(cached.refresh.reason).toContain('missing.git');
    expect(warn).toHaveBeenCalledWith(
      'release_notes.git.refresh_failed',
      expect.objectContaining({
        repositoryName: 'clone',
        error: expect.stringContaining('missing.git') as unknown,
      }),
    );
    expect(cached.commits).toEqual(result.commits);
    expect(existsSync(path.join(cached.codeDirectory, 'new.txt'))).toBe(true);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(localHead);
  });
  it('reads only the remote default branch and lists commits each merge brought in', async () => {
    const { clone, branchCommit } = makeClone();
    const result = await readReleaseNotesRepository({
      serviceId: 'service-1',
      repositoryPath: clone,
      windowStart: '2000-01-01T00:00:00Z',
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
      snapshotRoot: snapshotRoot(),
      logger: NOOP_LOGGER,
    });
    if (result.status !== 'READ') throw new Error(result.reason);
    expect(result.defaultBranch).toBe('origin/trunk');
    expect(result.commits.map((entry) => entry.subject)).toEqual(['Merge feature', 'base']);
    expect(result.commits[0]?.files).toEqual(['feature.txt']);
    expect(result.commits[0]?.mergedCommits).toEqual([
      { hash: branchCommit, subject: 'feature work' },
    ]);
    expect(JSON.stringify(result)).not.toContain('unmerged work');
  });

  it('reports a repository without origin/HEAD as unreadable', async () => {
    const { clone } = makeClone();
    git(clone, 'remote', 'set-head', 'origin', '--delete');
    const result = await readReleaseNotesRepository({
      serviceId: 'service-1',
      repositoryPath: clone,
      windowStart: '2000-01-01T00:00:00Z',
      windowEnd: new Date(Date.now() + 86_400_000).toISOString(),
      snapshotRoot: snapshotRoot(),
      logger: NOOP_LOGGER,
    });
    expect(result.status).toBe('UNREADABLE');
  });
});
