import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        ...workspace.environment,
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

  it('holds credentials out of the environment it hands back', async () => {
    process.env['GH_TOKEN'] = 'secret';
    try {
      const workspace = await workspaces().acquire(request('a'), signal);
      expect(workspace.environment['GH_TOKEN']).toBeUndefined();
      await workspace.release();
    } finally {
      delete process.env['GH_TOKEN'];
    }
  });

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

  describe('prepared dependencies', () => {
    let preparations: string;
    let originalPath: string | undefined;

    // A stand-in `pnpm` at the process boundary: it records each call and, like an
    // install, writes git-ignored dependency output.
    beforeEach(async () => {
      const bin = path.join(temp, 'bin');
      preparations = path.join(temp, 'preparations.log');
      await mkdir(bin);
      await writeFile(
        path.join(bin, 'pnpm'),
        `#!/bin/sh\necho "$@" >> "${preparations}"\nwhile [ -f "${temp}/gate" ]; do sleep 0.02; done\n[ -f "${temp}/fail" ] && { echo 'registry unreachable' >&2; exit 1; }\nmkdir -p node_modules && echo dep > node_modules/dep.txt\n`,
        { mode: 0o755 },
      );
      originalPath = process.env['PATH'];
      process.env['PATH'] = `${bin}:${originalPath}`;
      await writeFile(path.join(source, '.gitignore'), 'node_modules/\n');
      await writeFile(path.join(source, 'pnpm-lock.yaml'), '');
      await writeFile(
        path.join(source, 'package.json'),
        JSON.stringify({ scripts: { bootstrap: 'x', 'generate:contracts': 'y' } }),
      );
      git(source, 'add', '.');
      git(source, 'commit', '-qm', 'two');
      sha = git(source, 'rev-parse', 'HEAD').trim();
    });

    afterEach(async () => {
      process.env['PATH'] = originalPath;
      // Prepared output is read-only; let the temp directory be deleted.
      await chmod(temp, 0o755);
    });

    const calls = async (): Promise<string[]> =>
      (await readFile(preparations, 'utf8').catch(() => '')).split('\n').filter(Boolean);

    it('prepares once for concurrent first attempts and reuses it for a later one', async () => {
      const owner = workspaces(3);
      const concurrent = await Promise.all([
        owner.acquire(request('a'), signal),
        owner.acquire(request('b'), signal),
      ]);
      expect(await calls()).toEqual(['run bootstrap', 'run generate:contracts']);

      await concurrent[0]!.release();
      const later = await owner.acquire(request('c'), signal);
      expect(await calls()).toHaveLength(2);
      expect(await readFile(path.join(later.directory, 'node_modules/dep.txt'), 'utf8')).toBe(
        'dep\n',
      );

      await concurrent[1]!.release();
      await later.release();
      await owner.removePreparedBases();
    });

    it('never lets an attempt change the prepared output, and keeps it out of the captured changes', async () => {
      const owner = workspaces();
      const first = await owner.acquire(request('a'), signal);
      const target = path.join(first.directory, 'node_modules/dep.txt');

      await expect(writeFile(target, 'changed')).rejects.toThrow();
      await writeFile(path.join(first.directory, 'new.txt'), 'edit');
      expect(git(first.directory, 'status', '--porcelain').trim()).toBe('?? new.txt');

      const second = await owner.acquire(request('b'), signal);
      expect(existsSync(path.join(second.directory, 'new.txt'))).toBe(false);
      expect(await readFile(path.join(second.directory, 'node_modules/dep.txt'), 'utf8')).toBe(
        'dep\n',
      );

      await first.release();
      await second.release();
      await owner.removePreparedBases();
      expect(await readdir(path.join(temp, 'eval-prepared'))).toEqual([]);
    });

    it('fails every attempt from a commit whose preparation failed, with the reason, and only that commit', async () => {
      await writeFile(path.join(temp, 'fail'), '');
      const owner = workspaces();

      await expect(owner.acquire(request('a'), signal)).rejects.toThrow('registry unreachable');
      await expect(owner.acquire(request('b'), signal)).rejects.toThrow('registry unreachable');
      expect(await calls()).toHaveLength(1);

      await writeFile(path.join(source, 'other.txt'), 'x');
      git(source, 'add', '.');
      git(source, 'commit', '-qm', 'three');
      await rm(path.join(temp, 'fail'));
      const other = await owner.acquire(
        {
          attemptId: 'c',
          serviceId: 'service',
          commitSha: git(source, 'rev-parse', 'HEAD').trim(),
        },
        signal,
      );
      await other.release();
      await owner.removePreparedBases();
    });

    it('frees the slot of a cancelled attempt while the preparation carries on for the others', async () => {
      await writeFile(path.join(temp, 'gate'), '');
      const waits: string[] = [];
      const logger: typeof NOOP_LOGGER = Object.assign(Object.create(NOOP_LOGGER), {
        child: () => logger,
        info: (event: string) => waits.push(event),
      });
      const owner = new EvalWorkspaces({ resolvePathForService: async () => source }, logger, {
        rootDirectory: root,
        maxOpen: 2,
      });
      const first = owner.acquire(request('a'), signal);
      const controller = new AbortController();
      const cancelled = owner.acquire(request('b'), controller.signal);
      const cancelledOutcome = cancelled.catch((error: Error) => error.message);
      await vi.waitFor(async () => expect(await calls()).toHaveLength(1));

      controller.abort();
      expect(await cancelledOutcome).toContain('Stopped while waiting for dependencies');

      // The slot is free again: a new attempt takes it without queueing, though the preparation is still running.
      const third = owner.acquire(request('c'), signal);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(waits).not.toContain('run_eval.workspace.waiting');
      expect(await calls()).toHaveLength(1);

      await rm(path.join(temp, 'gate'));
      const [a, c] = await Promise.all([first, third]);
      expect(await calls()).toEqual(['run bootstrap', 'run generate:contracts']);
      await a.release();
      await c.release();
      await owner.removePreparedBases();
    });

    it('keeps bases an open workspace still uses when another run ends or starts', async () => {
      const owner = workspaces(3);
      const inUse = await owner.acquire(request('a'), signal);
      await writeFile(path.join(temp, 'gate'), '');

      // Another run's start sweep and end cleanup, while this one's attempt is open.
      await owner.sweep();
      await owner.removePreparedBases();
      expect(await readFile(path.join(inUse.directory, 'node_modules/dep.txt'), 'utf8')).toBe(
        'dep\n',
      );
      expect(await readdir(path.join(temp, 'eval-prepared'))).toHaveLength(1);

      await rm(path.join(temp, 'gate'));
      await inUse.release();
      await owner.removePreparedBases();
      expect(await readdir(path.join(temp, 'eval-prepared'))).toEqual([]);
    });

    it('only discourages writes to the prepared output: a command that restores permission can still change it', async () => {
      const owner = workspaces();
      const first = await owner.acquire(request('a'), signal);
      const target = path.join(first.directory, 'node_modules/dep.txt');

      await expect(writeFile(target, 'changed')).rejects.toThrow();
      // Accepted limit: the base belongs to the same user, so chmod undoes the guard.
      await chmod(target, 0o644);
      await writeFile(target, 'changed');

      const second = await owner.acquire(request('b'), signal);
      expect(await readFile(path.join(second.directory, 'node_modules/dep.txt'), 'utf8')).toBe(
        'changed',
      );
      // It still cannot reach the attempt's captured changes or the source repository.
      expect(git(first.directory, 'status', '--porcelain').trim()).toBe('');
      expect(await readFile(path.join(source, 'a.txt'), 'utf8')).toBe('uncommitted edit');

      await first.release();
      await second.release();
      await owner.removePreparedBases();
    });

    it('sweeps prepared bases an interrupted run left behind', async () => {
      const owner = workspaces();
      const first = await owner.acquire(request('a'), signal);
      await first.release();

      await workspaces().sweep();

      expect(await readdir(path.join(temp, 'eval-prepared'))).toEqual([]);
    });
  });

  describe.skipIf(spawnSync('pnpm', ['--version']).status !== 0)(
    'with a real pnpm workspace',
    () => {
      it("lets a dependent package see an edit made to a shared package in the attempt's workspace", async () => {
        const files: Record<string, string> = {
          '.gitignore': 'node_modules/\n',
          'package.json': JSON.stringify({ name: 'root', private: true }),
          'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
          'packages/a/package.json': JSON.stringify({
            name: 'a',
            version: '1.0.0',
            main: 'index.js',
          }),
          'packages/a/index.js': 'module.exports = "original";\n',
          'packages/b/package.json': JSON.stringify({
            name: 'b',
            version: '1.0.0',
            dependencies: { a: 'workspace:*' },
          }),
          'packages/b/run.js': 'process.stdout.write(require("a"));\n',
        };
        await rm(path.join(source, 'a.txt'));
        for (const [file, content] of Object.entries(files)) {
          await mkdir(path.dirname(path.join(source, file)), { recursive: true });
          await writeFile(path.join(source, file), content);
        }
        execFileSync('pnpm', ['install', '--lockfile-only', '--offline'], { cwd: source });
        git(source, 'add', '-A');
        git(source, 'commit', '-qm', 'workspace');
        sha = git(source, 'rev-parse', 'HEAD').trim();

        const owner = workspaces();
        const workspace = await owner.acquire(request('a'), signal);
        await writeFile(
          path.join(workspace.directory, 'packages/a/index.js'),
          'module.exports = "edited";\n',
        );

        const output = execFileSync('node', ['run.js'], {
          cwd: path.join(workspace.directory, 'packages/b'),
          encoding: 'utf8',
        });
        expect(output).toBe('edited');

        await workspace.release();
        await owner.removePreparedBases();
      });
    },
  );
});
