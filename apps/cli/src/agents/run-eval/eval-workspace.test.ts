import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stripCredentialEnvironment } from '../../agent-runtime/node/credential-environment';
import { NOOP_LOGGER } from '../../server/logger';
import { EvalWorkspaces } from './eval-workspace';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

const ghInstalled = spawnSync('gh', ['--version']).status === 0;

describe('EvalWorkspaces', () => {
  let temp: string;
  let source: string;
  let root: string;
  let sha: string;
  const signal = new AbortController().signal;

  const workspaces = (maxOpen = 2): EvalWorkspaces =>
    new EvalWorkspaces({ resolvePathForService: async () => source }, NOOP_LOGGER, {
      rootDirectory: root,
      maxOpen,
    });
  const request = (attemptId: string) => ({ attemptId, serviceId: 'service', commitSha: sha });
  const sourceSnapshot = (): string =>
    [
      git(source, 'for-each-ref'),
      git(source, 'remote', '-v'),
      git(source, 'status', '--porcelain'),
    ].join('|');

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'eval-workspace-'));
    source = path.join(temp, 'source');
    root = path.join(temp, 'workspaces');
    await mkdir(source);
    git(source, 'init', '-q');
    git(source, 'config', 'user.email', 't@example.com');
    git(source, 'config', 'user.name', 't');
    await writeFile(path.join(source, 'a.txt'), 'one');
    git(source, 'add', '.');
    git(source, 'commit', '-qm', 'one');
    sha = git(source, 'rev-parse', 'HEAD').trim();
    await writeFile(path.join(source, 'a.txt'), 'uncommitted edit');
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('gives each attempt its own checkout at the pinned commit and removes it on release', async () => {
    const owner = workspaces();
    const first = await owner.acquire(request('a'), signal);
    const second = await owner.acquire(request('b'), signal);

    expect(first.directory).not.toBe(second.directory);
    expect(git(first.directory, 'rev-parse', 'HEAD').trim()).toBe(sha);

    await first.release();
    await second.release();
    expect(existsSync(first.directory)).toBe(false);
    expect(existsSync(second.directory)).toBe(false);
  });

  it('cannot push, and leaves the source repository untouched', async () => {
    const before = sourceSnapshot();
    const workspace = await workspaces().acquire(request('a'), signal);
    await writeFile(path.join(workspace.directory, 'a.txt'), 'attempt change');
    git(workspace.directory, 'commit', '-qam', 'attempt');

    expect(() => git(workspace.directory, 'push')).toThrow();
    expect(() => git(workspace.directory, 'push', 'origin', 'HEAD')).toThrow();
    expect(git(workspace.directory, 'remote').trim()).toBe('');

    await workspace.release();
    expect(sourceSnapshot()).toBe(before);
  });

  it.skipIf(!ghInstalled)(
    'cannot open a pull request with gh, for lack of a git remote',
    async () => {
      const workspace = await workspaces().acquire(request('a'), signal);
      await writeFile(path.join(workspace.directory, 'a.txt'), 'attempt change');
      git(workspace.directory, 'commit', '-qam', 'attempt');
      const emptyHome = path.join(temp, 'empty-home');
      await mkdir(emptyHome);
      const isolated = {
        ...stripCredentialEnvironment(process.env),
        HOME: emptyHome,
        GH_CONFIG_DIR: emptyHome,
        GH_PROMPT_DISABLED: '1',
      };
      const createPr = (env: NodeJS.ProcessEnv) =>
        spawnSync('gh', ['pr', 'create', '--title', 'x', '--body', 'y'], {
          cwd: workspace.directory,
          env,
          encoding: 'utf8',
        });

      // With nothing to log in with, gh stops at authentication.
      const withoutLogin = createPr(isolated);
      expect(withoutLogin.status).not.toBe(0);
      expect(withoutLogin.stderr).toContain('gh auth login');

      // A placeholder token takes login out of the picture; the missing remote is what stops it.
      const withLogin = createPr({ ...isolated, GH_TOKEN: 'placeholder-token' });
      expect(withLogin.status).not.toBe(0);
      expect(withLogin.stderr).toContain('no git remotes found');

      await workspace.release();
    },
  );

  it('makes an extra attempt wait for a free slot', async () => {
    const owner = workspaces(1);
    const first = await owner.acquire(request('a'), signal);
    let acquired = false;
    const pending = owner.acquire(request('b'), signal).then((workspace) => {
      acquired = true;

      return workspace;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(acquired).toBe(false);

    await first.release();
    const second = await pending;
    expect(acquired).toBe(true);
    await second.release();
  });

  it('hands a freed slot straight to the first waiter, so a new attempt cannot take it', async () => {
    let holders = 0;
    let peak = 0;
    let newcomer: Promise<unknown> | undefined;
    let newcomerAcquired = false;
    const logger = {
      ...NOOP_LOGGER,
      child: () => logger,
      info: (event: string) => {
        // The slot has just been freed; a new attempt arrives before the waiter resumes.
        if (event === 'run_eval.workspace.released' && !newcomer) {
          newcomer = owner.acquire(request('c'), signal).then((workspace) => {
            newcomerAcquired = true;

            return workspace;
          });
        }
      },
    } as unknown as typeof NOOP_LOGGER;
    const owner = new EvalWorkspaces(
      {
        resolvePathForService: async () => {
          holders += 1;
          peak = Math.max(peak, holders);

          return source;
        },
      },
      logger,
      { rootDirectory: root, maxOpen: 1 },
    );
    const first = await owner.acquire(request('a'), signal);
    const waiter = owner.acquire(request('b'), signal);

    holders -= 1;
    await first.release();
    const second = await waiter;
    expect(newcomerAcquired).toBe(false);
    expect(peak).toBe(1);

    holders -= 1;
    await second.release();
    const third = await newcomer;
    expect(newcomerAcquired).toBe(true);
    expect(peak).toBe(1);
    holders -= 1;
    await (third as Awaited<ReturnType<typeof owner.acquire>>).release();
  });

  it('stops waiting when the attempt is cancelled', async () => {
    const owner = workspaces(1);
    const first = await owner.acquire(request('a'), signal);
    const controller = new AbortController();
    const pending = owner.acquire(request('b'), controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow('Stopped while waiting');
    await first.release();
  });

  it('fails only that attempt, leaving nothing behind, when the checkout cannot be made', async () => {
    const owner = workspaces();

    await expect(owner.acquire({ ...request('a'), commitSha: 'deadbeef' }, signal)).rejects.toThrow(
      'workspace could not be created',
    );
    expect(await readdir(root)).toEqual([]);
    const ok = await owner.acquire(request('b'), signal);
    await ok.release();
  });

  it('sweeps directories an interrupted run left behind', async () => {
    await mkdir(path.join(root, 'leftover'), { recursive: true });
    const owner = workspaces();
    const live = await owner.acquire(request('a'), signal);

    await owner.sweep();

    expect(await readdir(root)).toEqual([path.basename(live.directory)]);
    await live.release();
  });

  it('prepares nothing: no install runs, and the checkout holds only the repository', async () => {
    const bin = path.join(temp, 'bin');
    const calls = path.join(temp, 'package-manager-calls.log');
    await mkdir(bin);
    await writeFile(path.join(bin, 'pnpm'), `#!/bin/sh\necho "$@" >> "${calls}"\n`, {
      mode: 0o755,
    });
    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${originalPath}`;
    try {
      await writeFile(path.join(source, '.gitignore'), 'node_modules/\n');
      await writeFile(path.join(source, 'pnpm-lock.yaml'), '');
      await writeFile(
        path.join(source, 'package.json'),
        JSON.stringify({ scripts: { bootstrap: 'x', 'generate:contracts': 'y' } }),
      );
      git(source, 'add', '.');
      git(source, 'commit', '-qm', 'two');
      sha = git(source, 'rev-parse', 'HEAD').trim();

      const workspace = await workspaces().acquire(request('a'), signal);

      expect(existsSync(calls)).toBe(false);
      expect((await readdir(workspace.directory)).sort()).toEqual([
        '.git',
        '.gitignore',
        'a.txt',
        'package.json',
        'pnpm-lock.yaml',
      ]);
      expect(existsSync(path.join(temp, 'eval-prepared'))).toBe(false);
      await workspace.release();
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('removes a workspace whose files the attempt made read-only', async () => {
    const owner = workspaces();
    const workspace = await owner.acquire(request('a'), signal);
    const locked = path.join(workspace.directory, 'locked');
    await mkdir(locked);
    await writeFile(path.join(locked, 'cache.txt'), 'x');
    await chmod(path.join(locked, 'cache.txt'), 0o444);
    await chmod(locked, 0o555);

    await workspace.release();

    expect(existsSync(workspace.directory)).toBe(false);
    const next = await owner.acquire(request('b'), signal);
    await next.release();
  });

  it('sweeps the prepared bases older versions kept, read-only contents included', async () => {
    const legacy = path.join(temp, 'eval-prepared', 'abc123');
    await mkdir(path.join(legacy, 'node_modules'), { recursive: true });
    await writeFile(path.join(legacy, 'node_modules', 'dep.txt'), 'dep');
    execFileSync('chmod', ['-R', 'a-w', legacy]);

    await workspaces().sweep();

    expect(existsSync(path.join(temp, 'eval-prepared'))).toBe(false);
  });
});
