import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ResolvedRunWorkspace } from '../run-scope';
import {
  RunWorkspaceWriteBoundary,
  WorkspaceWriteOutsideRunError,
} from '../workspace-write-boundary';
import type { ValidatedProjectModeSnapshot } from './project-mode-snapshot';
import {
  ProjectModeBundleMaterializer,
  ProjectModeBundleValidationError,
} from './project-mode-bundle-materializer';

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-mode-runtime-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

const snapshotWithFiles = (files: Record<string, string>): ValidatedProjectModeSnapshot =>
  ({
    schemaVersion: 'project-mode-snapshot.v1',
    modeId: '11111111-1111-4111-8111-111111111111',
    catalogDescription: 'Captured test mode',
    applicableWorkItemTypeKeys: ['STANDARD'],
    files: { schemaVersion: 'project-mode-files.v1', files },
    snapshotHash: 'a'.repeat(64),
  }) as unknown as ValidatedProjectModeSnapshot;

const workspaceAt = (repositoryRoot: string): ResolvedRunWorkspace => ({
  ok: true,
  runMode: 'default',
  repositoryPathForRunStarted: repositoryRoot,
  cwd: repositoryRoot,
  allowedRepositoryRoots: [repositoryRoot],
  bindingRepositoryPath: repositoryRoot,
  workspaceRoot: null,
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0, temporaryDirectories.length)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('project-mode materialization and workspace read boundary', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['/absolute.md', 'relative POSIX'],
    ['C:\\absolute.md', 'relative POSIX'],
    ['../escape.md', 'traversal'],
    ['nested/../../escape.md', 'traversal'],
  ])('rejects unsafe path %j before exposing a bundle', async (unsafePath, issue) => {
    const base = await makeTemporaryDirectory();
    const runtimeRoot = path.join(base, 'bundles');
    const materializer = new ProjectModeBundleMaterializer({ runtimeRoot });

    await expect(
      materializer.materialize(
        'session-unsafe',
        snapshotWithFiles({ 'MODE.md': 'safe entry', [unsafePath]: 'unsafe' }),
      ),
    ).rejects.toThrow(issue);
    await expect(fs.access(runtimeRoot)).rejects.toThrow();
  });

  it.each([
    [{ 'MODE.md': 'entry', './MODE.md': 'duplicate' }, 'duplicate normalized path'],
    [
      { 'MODE.md': 'entry', references: 'file', 'references/checklist.md': 'child' },
      'collides with file',
    ],
    [{ 'other.md': 'missing entry' }, 'must contain MODE.md'],
  ])('rejects ambiguous bundle topology without partial writes', async (files, issue) => {
    const base = await makeTemporaryDirectory();
    const runtimeRoot = path.join(base, 'bundles');
    const materializer = new ProjectModeBundleMaterializer({ runtimeRoot });

    await expect(
      materializer.materialize('session-invalid', snapshotWithFiles(files)),
    ).rejects.toBeInstanceOf(ProjectModeBundleValidationError);
    await expect(
      materializer.materialize('session-invalid', snapshotWithFiles(files)),
    ).rejects.toThrow(issue);
    await expect(fs.access(runtimeRoot)).rejects.toThrow();
  });

  it('atomically reuses captured files and admits reads without write authority', async () => {
    const base = await makeTemporaryDirectory();
    const repositoryRoot = path.join(base, 'repository');
    const runtimeRoot = path.join(base, 'bundles');
    await fs.mkdir(repositoryRoot);
    const materializer = new ProjectModeBundleMaterializer({ runtimeRoot });
    const captured = snapshotWithFiles({
      'MODE.md': 'Use the captured entry.',
      'references/checklist.md': 'Check the evidence.',
    });

    const firstDirectory = await materializer.materialize('session-valid', captured);
    const secondDirectory = await materializer.materialize(
      'session-valid',
      snapshotWithFiles({ 'MODE.md': 'live work item changed' }),
    );
    expect(secondDirectory).toBe(firstDirectory);
    await expect(fs.readFile(path.join(firstDirectory, 'MODE.md'), 'utf8')).resolves.toBe(
      'Use the captured entry.',
    );
    await expect(
      fs.readFile(path.join(firstDirectory, 'references/checklist.md'), 'utf8'),
    ).resolves.toBe('Check the evidence.');
    expect((await fs.readdir(runtimeRoot)).some((entry) => entry.startsWith('.staging-'))).toBe(
      false,
    );

    const boundary = await RunWorkspaceWriteBoundary.create(workspaceAt(repositoryRoot), {
      runScopeId: 'session-valid',
      providerStateRoot: path.join(base, 'provider-state'),
      readOnlyDirectories: [firstDirectory],
    });
    expect(boundary.allowedRepositoryRoots).toEqual([await fs.realpath(repositoryRoot)]);
    expect(boundary.readOnlyDirectories).toEqual([firstDirectory]);
    await expect(
      boundary.resolveWriteTarget(path.join(firstDirectory, 'blocked.md')),
    ).rejects.toBeInstanceOf(WorkspaceWriteOutsideRunError);
    expect(boundary.claudeContainment()).toMatchObject({
      additionalDirectories: [firstDirectory],
      settings: {
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          filesystem: {
            allowWrite: [await fs.realpath(repositoryRoot)],
            allowRead: [firstDirectory],
          },
        },
      },
    });
    expect(boundary.claudeContainment()).not.toHaveProperty('processLaunch');

    const containment = boundary.processContainment();
    const readResult = spawnSync(
      containment.command,
      [
        ...containment.argsPrefix,
        process.execPath,
        '-e',
        "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))",
        path.join(firstDirectory, 'references/checklist.md'),
      ],
      {
        cwd: boundary.cwd,
        env: { ...process.env, ...containment.env },
        encoding: 'utf8',
      },
    );
    expect(readResult.status).toBe(0);
    expect(readResult.stdout).toBe('Check the evidence.');

    await boundary.dispose();
    await materializer.dispose();
    await expect(fs.access(runtimeRoot)).rejects.toThrow();
  });
});
