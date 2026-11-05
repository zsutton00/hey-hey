/** @vitest-environment node */

import { ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countChangedFilesInPaths,
  captureChangesSinceCommit,
  getGitDiff,
  listGitChangedFilePathsExcludingIgnored,
} from './diff';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

const execFileAsync = promisify(execFile);

const tempRoots: string[] = [];

const createTempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-diff-test-'));
  tempRoots.push(root);
  await runGit(root, ['init', '-q', '-b', 'main']);
  await runGit(root, ['config', 'user.email', 'test@example.com']);
  await runGit(root, ['config', 'user.name', 'Test User']);
  await runGit(root, ['config', 'commit.gpgsign', 'false']);
  return root;
};

const runGit = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
};

const writeFile = async (root: string, relPath: string, contents: string): Promise<void> => {
  const abs = path.join(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, 'utf8');
};

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

describe('listGitChangedFilePathsExcludingIgnored', () => {
  it('rejects when Git closes stdin early instead of emitting an unhandled error', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'seed.txt', 'seed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);
    await writeFile(repo, 'visible.ts', 'change\n');

    const brokenPipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(brokenPipe);
      },
    });
    const child = Object.assign(new ChildProcess(), {
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    stdin.on('close', () => child.emit('close', 128));
    vi.mocked(spawn).mockReturnValueOnce(child);

    await expect(listGitChangedFilePathsExcludingIgnored(repo)).rejects.toBe(brokenPipe);
  });

  it('excludes untracked paths matched by nested Git ignore rules', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, '.gitignore', '.jest-cache/\n');
    await writeFile(repo, 'seed.txt', 'seed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'src/.jest-cache/generated.map', 'cache\n');
    await writeFile(repo, 'src/real-change.ts', 'change\n');

    await expect(listGitChangedFilePathsExcludingIgnored(repo)).resolves.toEqual([
      'src/real-change.ts',
    ]);
  });

  it('applies ignore rules to previously tracked paths for observer diagnostics', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'cache/generated.map', 'original\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'track cache']);
    await writeFile(repo, '.gitignore', 'cache/\n');
    await runGit(repo, ['add', '.gitignore']);
    await runGit(repo, ['commit', '-q', '-m', 'ignore cache']);

    await writeFile(repo, 'cache/generated.map', 'modified\n');
    await writeFile(repo, 'visible.ts', 'change\n');

    await expect(listGitChangedFilePathsExcludingIgnored(repo)).resolves.toEqual(['visible.ts']);
  });
});

describe('getGitDiff', () => {
  it('returns preContent from HEAD and postContent from disk for a tracked-modified file', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'a.txt', 'one\ntwo\nthree\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'a.txt', 'one\nTWO\nthree\n');

    const patches = await getGitDiff({ repoPath: repo, paths: ['a.txt'] });
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.filePath).toBe('a.txt');
    expect(patch.preContent).toBe('one\ntwo\nthree\n');
    expect(patch.postContent).toBe('one\nTWO\nthree\n');
    expect(patch.diff).toContain('-two');
    expect(patch.diff).toContain('+TWO');
  });

  it('returns preContent=null and postContent from disk for an untracked new file', async () => {
    const repo = await createTempRepo();
    // Need at least one commit so HEAD resolves.
    await writeFile(repo, 'seed.txt', 'seed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'new.txt', 'fresh contents\n');

    const patches = await getGitDiff({ repoPath: repo, paths: ['new.txt'] });
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.filePath).toBe('new.txt');
    expect(patch.preContent).toBeNull();
    expect(patch.postContent).toBe('fresh contents\n');
    expect(patch.diff).toContain('+fresh contents');
  });

  it('returns preContent from HEAD and postContent=null for a deleted file', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'gone.txt', 'doomed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await fs.unlink(path.join(repo, 'gone.txt'));

    const patches = await getGitDiff({ repoPath: repo, paths: ['gone.txt'] });
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.filePath).toBe('gone.txt');
    expect(patch.preContent).toBe('doomed\n');
    expect(patch.postContent).toBeNull();
    expect(patch.diff).toContain('-doomed');
  });

  it('uses base-to-HEAD diff while reading postContent from the working tree when base is supplied', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 't.txt', 'base\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    const baseSha = await runGit(repo, ['rev-parse', 'HEAD']);

    // A committed change on top of base...
    await writeFile(repo, 't.txt', 'committed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'mid']);

    // ...plus an uncommitted edit on top of that.
    await writeFile(repo, 't.txt', 'uncommitted\n');

    const patches = await getGitDiff({ repoPath: repo, base: baseSha, paths: ['t.txt'] });
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.preContent).toBe('base\n');
    expect(patch.postContent).toBe('uncommitted\n');
    expect(patch.diff).toContain('+committed');
    expect(patch.diff).not.toContain('+uncommitted');
  });

  it('reads preContent from the base ref when base is supplied (worktree session)', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'b.txt', 'base-version\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    const baseSha = await runGit(repo, ['rev-parse', 'HEAD']);

    await writeFile(repo, 'b.txt', 'mid-version\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'mid']);

    await writeFile(repo, 'b.txt', 'head-version\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'head']);

    const patches = await getGitDiff({ repoPath: repo, base: baseSha, paths: ['b.txt'] });
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.filePath).toBe('b.txt');
    expect(patch.preContent).toBe('base-version\n');
    expect(patch.postContent).toBe('head-version\n');
  });
});

describe('countChangedFilesInPaths', () => {
  it('returns 0 for an empty path list', async () => {
    const repo = await createTempRepo();
    expect(await countChangedFilesInPaths({ repoPath: repo, paths: [] })).toBe(0);
  });

  it('counts modified, untracked, and deleted files within the path filter', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'a.txt', 'a\n');
    await writeFile(repo, 'b.txt', 'b\n');
    await writeFile(repo, 'c.txt', 'c\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'a.txt', 'a-modified\n');
    await fs.unlink(path.join(repo, 'b.txt'));
    await writeFile(repo, 'd.txt', 'd-untracked\n');

    const count = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['a.txt', 'b.txt', 'c.txt', 'd.txt'],
    });
    expect(count).toBe(3);
  });

  it('drops to 0 once the touched files are committed', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'seed.txt', 'seed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'seed.txt', 'changed\n');
    await writeFile(repo, 'new.txt', 'new\n');

    const before = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['seed.txt', 'new.txt'],
    });
    expect(before).toBe(2);

    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'next']);

    const after = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['seed.txt', 'new.txt'],
    });
    expect(after).toBe(0);
  });

  it('counts base-to-HEAD committed changes plus untracked files when base is supplied', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'tracked.txt', 'base\n');
    await writeFile(repo, 'unchanged.txt', 'stable\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    const baseSha = await runGit(repo, ['rev-parse', 'HEAD']);

    await writeFile(repo, 'tracked.txt', 'committed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'change']);
    await writeFile(repo, 'new.txt', 'untracked\n');

    const count = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['tracked.txt', 'unchanged.txt', 'new.txt'],
      base: baseSha,
    });
    expect(count).toBe(2);
  });

  it('does not double-count files that are changed since base and untracked is empty for that path', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'tracked.txt', 'base\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    const baseSha = await runGit(repo, ['rev-parse', 'HEAD']);

    await writeFile(repo, 'tracked.txt', 'committed\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'change']);

    const count = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['tracked.txt'],
      base: baseSha,
    });
    expect(count).toBe(1);
  });

  it('only counts files inside the supplied path filter', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'a.txt', 'a\n');
    await writeFile(repo, 'b.txt', 'b\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'init']);

    await writeFile(repo, 'a.txt', 'a-modified\n');
    await writeFile(repo, 'b.txt', 'b-modified\n');

    const count = await countChangedFilesInPaths({
      repoPath: repo,
      paths: ['a.txt'],
    });
    expect(count).toBe(1);
  });

  it('returns 0 when git fails (path is not a repo)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-norepo-'));
    tempRoots.push(tmp);
    const count = await countChangedFilesInPaths({
      repoPath: tmp,
      paths: ['anything.txt'],
    });
    expect(count).toBe(0);
  });
});

describe('captureChangesSinceCommit', () => {
  it('reports a rename as a deletion plus an addition with correct line counts', async () => {
    const repo = await createTempRepo();
    const body = 'line1\nline2\nline3\nline4\n';
    await writeFile(repo, 'old.txt', body);
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-qm', 'base']);
    const commit = await runGit(repo, ['rev-parse', 'HEAD']);
    await runGit(repo, ['mv', 'old.txt', 'new.txt']);

    const files = await captureChangesSinceCommit({ repoPath: repo, commit });

    expect(
      files.map(({ path: file, status, additions, deletions }) => ({
        file,
        status,
        additions,
        deletions,
      })),
    ).toEqual([
      { file: 'new.txt', status: 'added', additions: 4, deletions: 0 },
      { file: 'old.txt', status: 'deleted', additions: 0, deletions: 4 },
    ]);
  });

  it('counts hunk lines that look like diff headers, and handles new, deleted, empty and binary files', async () => {
    const repo = await createTempRepo();
    await writeFile(repo, 'q.sql', 'keep\n-- drop me\nkeep2\n');
    await writeFile(repo, 'gone.txt', 'a\nb\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-qm', 'base']);
    const commit = await runGit(repo, ['rev-parse', 'HEAD']);
    await writeFile(repo, 'q.sql', 'keep\n++plus\nkeep2\n');
    await fs.rm(path.join(repo, 'gone.txt'));
    await writeFile(repo, 'fresh.txt', 'x\ny\n');
    await writeFile(repo, 'empty.txt', '');
    await fs.writeFile(path.join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));

    const files = await captureChangesSinceCommit({ repoPath: repo, commit });
    const byPath = Object.fromEntries(
      files.map(({ path: file, status, additions, deletions }) => [
        file,
        { status, additions, deletions },
      ]),
    );

    expect(byPath).toEqual({
      'q.sql': { status: 'modified', additions: 1, deletions: 1 },
      'gone.txt': { status: 'deleted', additions: 0, deletions: 2 },
      'fresh.txt': { status: 'added', additions: 2, deletions: 0 },
      'empty.txt': { status: 'added', additions: 0, deletions: 0 },
      'blob.bin': { status: 'added', additions: 0, deletions: 0 },
    });
  });
});
