import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRunServiceRoots } from '../run/file-change-facts';
import { createTestRun } from '../run/run.test-support';
import type { ResolvedRunWorkspace } from './run-scope';
import {
  RunWorkspaceWriteBoundary,
  WorkspaceWriteOutsideRunError,
} from './workspace-write-boundary';

const tempDirectories: string[] = [];

const makeDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-boundary-test-'));
  tempDirectories.push(directory);
  return directory;
};

const makeWorkspace = (cwd: string, allowedRepositoryRoots: string[]): ResolvedRunWorkspace => ({
  ok: true,
  runMode: 'default',
  repositoryPathForRunStarted: cwd,
  cwd,
  allowedRepositoryRoots,
  bindingRepositoryPath: cwd,
  workspaceRoot: null,
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories
      .splice(0, tempDirectories.length)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('RunWorkspaceWriteBoundary', () => {
  it('allows new Review files in resolved worktrees while denying host and other-Service writes', async () => {
    const base = await makeDirectory();
    const host = path.join(base, 'host');
    const worktree = path.join(base, 'worktree');
    const other = path.join(base, 'other-service');
    for (const directory of [host, worktree, other]) await fs.mkdir(directory);
    const run = createTestRun();
    await run.ensureSeeded();
    run.refreshSessionFields({
      services: [{ id: 'service-1', path: host }],
      launchServiceId: 'service-1',
      worktreeState: { 'service-1': { repoPath: host, worktreePath: worktree, branch: 'review' } },
    });
    const roots = resolveRunServiceRoots(run.session).map((entry) => entry.root);
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(worktree, roots));
    try {
      const target = path.join(worktree, 'new-regression.ts');
      expect(await boundary.assertWriteTargets([target])).toEqual([
        await boundary.resolveWriteTarget(target),
      ]);
      await fs.writeFile(await boundary.resolveWriteTarget(target), 'required repair');
      expect(await fs.readFile(target, 'utf8')).toBe('required repair');
      await expect(
        boundary.assertWriteTargets([path.join(host, 'new-regression.ts')]),
      ).rejects.toBeInstanceOf(WorkspaceWriteOutsideRunError);
      await expect(
        boundary.assertWriteTargets([path.join(other, 'new-regression.ts')]),
      ).rejects.toBeInstanceOf(WorkspaceWriteOutsideRunError);
      expect(run.getFileChangeProjection()).toEqual([]);
    } finally {
      await boundary.dispose();
    }
  });
  it('uses a short writable tmp directory for normal and read-only sandbox launches', async () => {
    const base = await makeDirectory();
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(base, [base]));
    try {
      const launch = boundary.processContainment();
      const tmp = launch.env['TMPDIR']!;
      expect(path.basename(tmp)).toBe('t');
      expect(path.basename(path.dirname(tmp))).toMatch(/^hh-.{6}$/);
      expect(launch.env).not.toHaveProperty('CLAUDE_CODE_TMPDIR');
      expect(launch.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
      expect(boundary.readOnlyProcessContainment().env['TMPDIR']).toBe(tmp);
      await expect(fs.stat(tmp)).resolves.toMatchObject({});
      for (const containment of [launch, boundary.readOnlyProcessContainment()]) {
        const settings = JSON.parse(await fs.readFile(containment.argsPrefix[1]!, 'utf8'));
        expect(settings.filesystem.allowWrite).toContain(tmp);
        expect(settings.filesystem.allowWrite).not.toContain(path.dirname(tmp));
        expect(settings.network.allowUnixSockets).toEqual([tmp]);
        expect(settings.network.allowAllUnixSockets).toBeUndefined();
      }
    } finally {
      await boundary.dispose();
    }
  });

  it.runIf(process.platform === 'darwin' || process.platform === 'linux')(
    "enforces Claude's native sandbox config on Bash writes and host Unix sockets",
    async () => {
      const base = await makeDirectory();
      const allowed = path.join(base, 'allowed');
      const outside = path.join(base, 'outside');
      await fs.mkdir(allowed);
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(allowed, 'escape'));
      const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(allowed, [allowed]));
      const hostDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hs-'));
      tempDirectories.push(hostDirectory);
      const hostSocket = path.join(hostDirectory, 'host.sock');
      const server = createServer((socket) => socket.end());
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(hostSocket, resolve);
        });
        for (const readOnly of [false, true]) {
          const sandbox = readOnly
            ? boundary.claudeReadOnlyContainment().settings.sandbox
            : boundary.claudeContainment().settings.sandbox;
          expect(sandbox).toMatchObject({
            enabled: true,
            failIfUnavailable: true,
            allowUnsandboxedCommands: false,
            network: { allowUnixSockets: [] },
          });
          // Claude's native sandbox is built on @anthropic-ai/sandbox-runtime;
          // run its exact filesystem/network policy through that engine.
          const settingsPath = path.join(hostDirectory, `claude-native-${readOnly}.json`);
          await fs.writeFile(
            settingsPath,
            JSON.stringify({
              filesystem: {
                allowWrite: sandbox.filesystem.allowWrite,
                allowRead: sandbox.filesystem.allowRead,
                denyWrite: [],
                denyRead: [],
              },
              network: {
                allowedDomains: [],
                deniedDomains: [],
                allowUnixSockets: sandbox.network.allowUnixSockets,
              },
            }),
          );
          const launcherPath = boundary.processContainment().argsPrefix[0]!;
          const run = (command: string, args: string[]) =>
            spawnSync(process.execPath, [launcherPath, settingsPath, command, ...args], {
              cwd: boundary.cwd,
              env: process.env,
              encoding: 'utf8',
              timeout: 15000,
              killSignal: 'SIGKILL',
            });
          const sockets = run(process.execPath, [
            '-e',
            `
          const net = require('node:net');
          const denied = net.connect(process.argv[1]);
          denied.on('connect', () => { console.error('Host socket unexpectedly accessible'); process.exit(3); });
          denied.on('error', () => process.exit(0));
        `,
            hostSocket,
          ]);
          expect(sockets.error).toBeUndefined();
          expect(sockets.status, sockets.stderr).toBe(0);
          const bash = run('/bin/bash', [
            '-c',
            `set -eu
          if [ "$4" = false ]; then printf allowed > "$1"; else ! (printf blocked > "$1"); fi
          ! (printf blocked > "$2")
          ! (printf blocked > "$3")
          printf bash-ok`,
            'probe',
            path.join(allowed, readOnly ? 'readonly.txt' : 'inside.txt'),
            path.join(outside, 'outside.txt'),
            path.join(allowed, 'escape', 'escape.txt'),
            String(readOnly),
          ]);
          expect(bash.error).toBeUndefined();
          expect(bash.status, 'readOnly=' + readOnly + ': ' + bash.stderr).toBe(0);
          expect(bash.stdout).toContain('bash-ok');
        }
        await expect(fs.readFile(path.join(allowed, 'inside.txt'), 'utf8')).resolves.toBe(
          'allowed',
        );
        for (const target of [
          path.join(allowed, 'readonly.txt'),
          path.join(outside, 'outside.txt'),
          path.join(outside, 'escape.txt'),
        ]) {
          await expect(fs.access(target)).rejects.toThrow();
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await boundary.dispose();
      }
    },
    70000,
  );

  it.each([
    ['ASCII', 'a'.repeat(65)],
    ['UTF-8', 'é'.repeat(33)],
  ])(
    'rejects oversized %s socket paths and cleans up the runtime directory',
    async (_label, suffix) => {
      const base = await makeDirectory();
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      const runtimeDirectory = `/${suffix}`;
      vi.spyOn(fs, 'mkdtemp').mockResolvedValue(runtimeDirectory);
      const remove = vi.spyOn(fs, 'rm').mockResolvedValue();
      await expect(RunWorkspaceWriteBoundary.create(makeWorkspace(base, [base]))).rejects.toThrow(
        /Sandbox temporary directory .* is too long:.*limit 103.*Set TMPDIR/,
      );
      expect(remove).toHaveBeenCalledWith(runtimeDirectory, { recursive: true, force: true });
    },
  );

  it('canonicalizes multiple roots and resolves non-existent descendants', async () => {
    const base = await makeDirectory();
    const launchRoot = path.join(base, 'launch');
    const otherRoot = path.join(base, 'other');
    await fs.mkdir(launchRoot);
    await fs.mkdir(otherRoot);

    const boundary = await RunWorkspaceWriteBoundary.create(
      makeWorkspace(launchRoot, [launchRoot, otherRoot, launchRoot]),
    );
    const canonicalLaunchRoot = await fs.realpath(launchRoot);
    const canonicalOtherRoot = await fs.realpath(otherRoot);
    await expect(boundary.resolveWriteTarget('src/new/file.ts')).resolves.toBe(
      path.join(canonicalLaunchRoot, 'src/new/file.ts'),
    );
    await expect(boundary.resolveWriteTarget(path.join(otherRoot, 'new.ts'))).resolves.toBe(
      path.join(canonicalOtherRoot, 'new.ts'),
    );
    expect(boundary.allowedRepositoryRoots).toEqual([canonicalLaunchRoot, canonicalOtherRoot]);
    await boundary.dispose();
  });

  it('rejects an ordinary checkout and an absolute sibling target', async () => {
    const base = await makeDirectory();
    const ordinaryCheckout = path.join(base, 'service');
    const worktree = path.join(base, 'service-worktree');
    const sibling = path.join(base, 'sibling');
    await Promise.all([ordinaryCheckout, worktree, sibling].map((dir) => fs.mkdir(dir)));
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(worktree, [worktree]));

    await expect(
      boundary.resolveWriteTarget(path.join(ordinaryCheckout, 'src/file.ts')),
    ).rejects.toBeInstanceOf(WorkspaceWriteOutsideRunError);
    await expect(
      boundary.resolveWriteTarget(path.join(sibling, 'src/file.ts')),
    ).rejects.toBeInstanceOf(WorkspaceWriteOutsideRunError);
    await boundary.dispose();
  });

  it('rejects traversal through existing and dangling symlinks', async () => {
    const base = await makeDirectory();
    const allowed = path.join(base, 'allowed');
    const outside = path.join(base, 'outside');
    await fs.mkdir(allowed);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(allowed, 'existing-link'));
    await fs.symlink(path.join(outside, 'not-created'), path.join(allowed, 'dangling-link'));
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(allowed, [allowed]));

    await expect(boundary.resolveWriteTarget('existing-link/file.ts')).rejects.toBeInstanceOf(
      WorkspaceWriteOutsideRunError,
    );
    await expect(boundary.resolveWriteTarget('dangling-link/file.ts')).rejects.toBeInstanceOf(
      WorkspaceWriteOutsideRunError,
    );
    await boundary.dispose();
  });

  it('derives Claude and process containment from the same canonical roots', async () => {
    const base = await makeDirectory();
    const launchRoot = path.join(base, 'launch');
    const additionalRoot = path.join(base, 'additional');
    await fs.mkdir(launchRoot);
    await fs.mkdir(additionalRoot);
    const boundary = await RunWorkspaceWriteBoundary.create(
      makeWorkspace(launchRoot, [launchRoot, additionalRoot]),
    );
    const canonicalLaunchRoot = await fs.realpath(launchRoot);
    const canonicalAdditionalRoot = await fs.realpath(additionalRoot);
    expect(boundary.claudeContainment()).toEqual({
      additionalDirectories: [canonicalAdditionalRoot],
      settings: {
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          excludedCommands: ['ssh', 'scp', 'rsync'],
          filesystem: { allowWrite: [canonicalLaunchRoot, canonicalAdditionalRoot], allowRead: [] },
          network: { allowUnixSockets: [] },
        },
      },
      settingSources: ['user', 'project', 'local'],
    });
    expect(boundary.claudeReadOnlyContainment()).toEqual({
      additionalDirectories: [canonicalAdditionalRoot],
      settings: {
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          excludedCommands: [],
          filesystem: { allowWrite: [], allowRead: [] },
          network: { allowUnixSockets: [] },
        },
      },
      settingSources: ['user', 'project', 'local'],
    });
    expect(boundary.processContainment().argsPrefix).toEqual([
      expect.stringContaining('sandbox-launcher.mjs'),
      expect.stringContaining('srt-settings.json'),
    ]);
    await boundary.dispose();
  });

  it.each(['darwin', 'linux'] as const)(
    'keeps Claude native Bash sandboxing enabled and fail-closed on %s',
    async (platform) => {
      const base = await makeDirectory();
      const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(base, [base]));
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);

      for (const containment of [
        boundary.claudeContainment(),
        boundary.claudeReadOnlyContainment(),
      ]) {
        expect(containment.settings.sandbox).toMatchObject({
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          network: { allowUnixSockets: [] },
        });
        expect(containment).not.toHaveProperty('processLaunch');
      }

      await boundary.dispose();
    },
  );

  it('does not copy Claude credentials or create a private Claude config directory', async () => {
    const base = await makeDirectory();
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(base, [base]));
    try {
      const runtimeDirectory = path.dirname(boundary.processContainment().env['TMPDIR']!);
      const providerState = path.join(runtimeDirectory, 'provider-state');
      expect((await fs.readdir(providerState)).sort()).toEqual(['cache', 'data', 'state']);
      const listing = await fs.readdir(runtimeDirectory, { recursive: true });
      expect(listing.some((entry) => String(entry).includes('.credentials.json'))).toBe(false);
    } finally {
      await boundary.dispose();
    }
  });

  it('preserves isolated provider state across Run boundary re-materialization', async () => {
    const base = await makeDirectory();
    const allowed = path.join(base, 'allowed');
    const providerStateRoot = path.join(base, 'provider-state');
    await fs.mkdir(allowed);
    const workspace = makeWorkspace(allowed, [allowed]);
    const options = { runScopeId: 'stable-run-id', providerStateRoot };

    const firstBoundary = await RunWorkspaceWriteBoundary.create(workspace, options);
    const firstDataHome = firstBoundary.processContainment().env['XDG_DATA_HOME'];
    expect(firstDataHome).toBeDefined();
    const sessionDatabase = path.join(firstDataHome!, 'opencode', 'opencode.db');
    await fs.writeFile(sessionDatabase, 'persisted-session');
    await firstBoundary.dispose();

    const secondBoundary = await RunWorkspaceWriteBoundary.create(workspace, options);
    expect(secondBoundary.processContainment().env['XDG_DATA_HOME']).toBe(firstDataHome);
    await expect(fs.readFile(sessionDatabase, 'utf8')).resolves.toBe('persisted-session');
    await secondBoundary.dispose();
  });

  it('OS-enforces shell and nested-process writes against the same roots', async () => {
    const base = await makeDirectory();
    const allowed = path.join(base, 'allowed');
    const outside = path.join(base, 'outside');
    await fs.mkdir(allowed);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(allowed, 'escape'));
    const boundary = await RunWorkspaceWriteBoundary.create(makeWorkspace(allowed, [allowed]));
    const containment = boundary.processContainment();
    const run = (command: string, args: string[]) =>
      spawnSync(containment.command, [...containment.argsPrefix, command, ...args], {
        cwd: boundary.cwd,
        env: { ...process.env, ...containment.env },
        encoding: 'utf8',
      });

    const insideFile = path.join(allowed, 'inside.txt');
    expect(
      run(process.execPath, [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1], 'inside')",
        insideFile,
      ]).status,
    ).toBe(0);
    await expect(fs.readFile(insideFile, 'utf8')).resolves.toBe('inside');

    const shellEscape = run('/bin/sh', [
      '-c',
      `printf blocked > ${JSON.stringify(path.join(outside, 'shell.txt'))}`,
    ]);
    expect(shellEscape.status).not.toBe(0);
    await expect(fs.access(path.join(outside, 'shell.txt'))).rejects.toThrow();

    const nestedEscape = run(process.execPath, [
      '-e',
      "const {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath,['-e',\"require('node:fs').writeFileSync(process.argv[1], 'blocked')\",process.argv[1]],{stdio:'inherit'}); process.exit(r.status ?? 1)",
      path.join(outside, 'nested.txt'),
    ]);
    expect(nestedEscape.status).not.toBe(0);
    await expect(fs.access(path.join(outside, 'nested.txt'))).rejects.toThrow();

    const symlinkEscape = run(process.execPath, [
      '-e',
      "require('node:fs').writeFileSync(process.argv[1], 'blocked')",
      path.join(allowed, 'escape', 'symlink.txt'),
    ]);
    expect(symlinkEscape.status).not.toBe(0);
    await expect(fs.access(path.join(outside, 'symlink.txt'))).rejects.toThrow();
    await boundary.dispose();
  });

  it('OS-enforces the repository-research boundary for parent and child processes', async () => {
    const base = await makeDirectory();
    const repository = path.join(base, 'repository');
    await fs.mkdir(repository);
    await fs.writeFile(path.join(repository, 'evidence.txt'), 'readable');
    const boundary = await RunWorkspaceWriteBoundary.create(
      makeWorkspace(repository, [repository]),
    );
    const containment = boundary.readOnlyProcessContainment();
    const result = spawnSync(
      containment.command,
      [
        ...containment.argsPrefix,
        process.execPath,
        '-e',
        "const fs=require('node:fs'); fs.readFileSync(process.argv[1]); const child=require('node:child_process').spawnSync(process.execPath,['-e',\"require('node:fs').writeFileSync(process.argv[1], 'blocked')\",process.argv[2]]); process.exit(child.status ?? 1)",
        path.join(repository, 'evidence.txt'),
        path.join(repository, 'child-write.txt'),
      ],
      { cwd: boundary.cwd, env: { ...process.env, ...containment.env }, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    await expect(fs.access(path.join(repository, 'child-write.txt'))).rejects.toThrow();
    await boundary.dispose();
  });
});
