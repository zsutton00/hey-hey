/** @vitest-environment node */

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoMappingStore } from '../repo';
import { ServicePlacesReader } from './service-places-reader';
import type { ServerLogger } from './logger';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });

const serviceIdFor = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('ServicePlacesReader', () => {
  let root: string;
  let store: RepoMappingStore;
  let reader: ServicePlacesReader;

  const makeRepo = async (name: string): Promise<string> => {
    const repo = path.join(root, name);
    await mkdir(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    return realpath(repo);
  };

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'service-places-')));
    store = new RepoMappingStore({
      mappingPath: path.join(root, 'repos.json'),
      lockPath: path.join(root, 'repos.lock'),
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    reader = new ServicePlacesReader(store, logger as unknown as ServerLogger);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports the main folder branch, linked worktrees and branch matches without changing the checkout', async () => {
    const repo = await makeRepo('app');
    git(repo, 'branch', 'feature/login');
    const wtOne = path.join(root, 'wt-one');
    const wtTwo = path.join(root, 'wt-two');
    git(repo, 'worktree', 'add', '-q', wtOne, '-b', 'feature/one');
    git(repo, 'worktree', 'add', '-q', '--detach', wtTwo);
    await store.setBinding(serviceIdFor(1) as never, repo);

    const [entry] = await reader.read({ serviceIds: [serviceIdFor(1)], branchQuery: 'FEATURE' });

    expect(entry).toMatchObject({
      serviceId: serviceIdFor(1),
      status: 'ok',
      mainFolder: { path: repo, branch: 'main' },
      branchMatchesTruncated: false,
    });
    if (entry?.status !== 'ok') {
      throw new Error('expected ok entry');
    }
    expect(entry.worktrees).toHaveLength(2);
    expect(entry.worktrees).toEqual(
      expect.arrayContaining([
        { branch: 'feature/one', worktreePath: await realpath(wtOne) },
        { branch: null, worktreePath: await realpath(wtTwo) },
      ]),
    );
    expect([...entry.branchMatches].sort()).toEqual(['feature/login', 'feature/one']);
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('reports a detached main folder as a null branch', async () => {
    const repo = await makeRepo('detached');
    git(repo, 'checkout', '-q', '--detach');
    await store.setBinding(serviceIdFor(2) as never, repo);

    const [entry] = await reader.read({ serviceIds: [serviceIdFor(2)] });

    expect(entry).toMatchObject({ status: 'ok', mainFolder: { path: repo, branch: null } });
  });

  it('caps branch matches at 20 and flags truncation, never returning the full list', async () => {
    const repo = await makeRepo('many');
    for (let i = 0; i < 55; i += 1) {
      git(repo, 'branch', `topic/b${i}`);
    }
    await store.setBinding(serviceIdFor(3) as never, repo);

    const [capped] = await reader.read({ serviceIds: [serviceIdFor(3)], branchQuery: 'topic' });
    const [exact] = await reader.read({ serviceIds: [serviceIdFor(3)], branchQuery: 'topic/b5' });
    const [none] = await reader.read({ serviceIds: [serviceIdFor(3)], branchQuery: 'nomatch' });

    expect(capped).toMatchObject({ status: 'ok', branchMatchesTruncated: true });
    expect(capped?.status === 'ok' && capped.branchMatches).toHaveLength(20);
    expect(exact).toMatchObject({ status: 'ok', branchMatchesTruncated: false });
    expect(exact?.status === 'ok' && exact.branchMatches.sort()).toEqual(
      ['topic/b5', 'topic/b50', 'topic/b51', 'topic/b52', 'topic/b53', 'topic/b54'].sort(),
    );
    expect(none).toMatchObject({ status: 'ok', branchMatches: [], branchMatchesTruncated: false });
  });

  it('gives each failing Service its own error entry while others still return', async () => {
    const repo = await makeRepo('good');
    const plain = path.join(root, 'plain');
    await mkdir(plain);
    await store.setBinding(serviceIdFor(4) as never, repo);
    await store.setBinding(serviceIdFor(5) as never, plain);

    const entries = await reader.read({
      serviceIds: [serviceIdFor(6), serviceIdFor(4), serviceIdFor(5)],
    });

    expect(entries.map((e) => [e.serviceId, e.status])).toEqual([
      [serviceIdFor(6), 'error'],
      [serviceIdFor(4), 'ok'],
      [serviceIdFor(5), 'error'],
    ]);
    expect(entries[0]).toMatchObject({ code: 'NO_REPOSITORY_PATH' });
    expect(entries[2]).toMatchObject({ code: 'NOT_A_GIT_REPOSITORY' });
  });

  it('reports the real main folder and the other worktrees when the Service is bound to a linked worktree', async () => {
    const repo = await makeRepo('bound-linked');
    const linked = path.join(root, 'linked');
    const other = path.join(root, 'other');
    git(repo, 'worktree', 'add', '-q', linked, '-b', 'feature/linked');
    git(repo, 'worktree', 'add', '-q', other, '-b', 'feature/other');
    await store.setBinding(serviceIdFor(7) as never, linked);

    const [entry] = await reader.read({ serviceIds: [serviceIdFor(7)] });

    if (entry?.status !== 'ok') {
      throw new Error('expected ok entry');
    }
    expect(entry.mainFolder).toEqual({ path: repo, branch: 'main' });
    expect(entry.worktrees).toHaveLength(2);
    expect(entry.worktrees).toEqual(
      expect.arrayContaining([
        { branch: 'feature/linked', worktreePath: await realpath(linked) },
        { branch: 'feature/other', worktreePath: await realpath(other) },
      ]),
    );
  });

  it('applies the 20-result cap when the branch list is larger than a process output buffer', async () => {
    const repo = await makeRepo('huge');
    // ~1.4 MB of branch names: more than Node's default 1 MB execFile buffer.
    // Written straight into packed-refs because creating that many refs one by one is slow.
    const names = Array.from(
      { length: 10_000 },
      (_, i) => `bulk/${String(i).padStart(5, '0')}-${'x'.repeat(120)}`,
    );
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    await writeFile(
      path.join(repo, '.git', 'packed-refs'),
      `# pack-refs with: \n${names.map((name) => `${head} refs/heads/${name}\n`).join('')}`,
    );
    await store.setBinding(serviceIdFor(8) as never, repo);

    const [narrow] = await reader.read({
      serviceIds: [serviceIdFor(8)],
      branchQuery: 'bulk/09999',
    });
    const [broad] = await reader.read({ serviceIds: [serviceIdFor(8)], branchQuery: 'bulk' });

    expect(narrow).toMatchObject({ status: 'ok', branchMatchesTruncated: false });
    expect(narrow?.status === 'ok' && narrow.branchMatches).toHaveLength(1);
    expect(broad).toMatchObject({ status: 'ok', branchMatchesTruncated: true });
    expect(broad?.status === 'ok' && broad.branchMatches).toHaveLength(20);
  });

  it('reports the plain branch name when a tag shares it', async () => {
    const repo = await makeRepo('tagged');
    git(repo, 'branch', 'release');
    git(repo, 'tag', 'release');
    const wt = path.join(root, 'wt-release');
    git(repo, 'worktree', 'add', '-q', wt, 'release');
    await store.setBinding(serviceIdFor(9) as never, repo);

    const [entry] = await reader.read({ serviceIds: [serviceIdFor(9)], branchQuery: 'release' });

    if (entry?.status !== 'ok') {
      throw new Error('expected ok entry');
    }
    expect(entry.branchMatches).toEqual(['release']);
    expect(entry.worktrees).toEqual([{ branch: 'release', worktreePath: await realpath(wt) }]);
  });

  it('reports an unreadable or missing repository folder as READ_FAILED with the cause, not as a non-repository', async () => {
    const locked = await makeRepo('locked');
    await store.setBinding(serviceIdFor(10) as never, locked);
    await chmod(locked, 0o000);

    try {
      const [entry] = await reader.read({ serviceIds: [serviceIdFor(10)] });

      expect(entry).toMatchObject({ status: 'error', code: 'READ_FAILED' });
      expect(entry?.status === 'error' && entry.message).toMatch(/EACCES|permission denied/i);
    } finally {
      await chmod(locked, 0o755);
    }

    const gone = await makeRepo('gone');
    await store.setBinding(serviceIdFor(11) as never, gone);
    await rm(gone, { recursive: true });

    const [missing] = await reader.read({ serviceIds: [serviceIdFor(11)] });

    expect(missing).toMatchObject({ status: 'error', code: 'READ_FAILED' });
  });
});
