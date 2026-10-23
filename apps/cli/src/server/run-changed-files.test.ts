/** @vitest-environment node */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoMappingStore } from '../repo';
import type { CanonicalFileChangeFact, FileChangeProjection } from '../run/file-change-facts';
import type { AgenticSession, AgenticSessionContextMetadata } from '../session/types';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import { RunChangedFilesContextError, RunChangedFilesReader } from './run-changed-files';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

const createRun = (runId: string, repoPath: string): AgenticSession => ({
  entity: null,
  agentic_session_id: runId,
  services: [{ id: 'service-a', path: repoPath }],
  launchServiceId: 'service-a',
  provider: 'codex',
  provider_session_id: `provider-${runId}`,
  provider_conversation_id: `thread-${runId}`,
  status: 'idle',
  conversationId: `conversation-${runId}`,
  contextMetadata: {} as AgenticSessionContextMetadata,
  scope: { mode: 'default', workspaceRoot: repoPath, allowedRepositoryRoots: [repoPath] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  events: [],
});

const repoStore = new RepoMappingStore();
vi.spyOn(repoStore, 'getBinding').mockResolvedValue(null);

const createFact = (
  runId: string,
  overrides: Partial<CanonicalFileChangeFact> = {},
): CanonicalFileChangeFact => ({
  factId: `fact-${runId}`,
  runId,
  turnId: `turn-${runId}`,
  provider: 'codex',
  providerSessionId: `provider-${runId}`,
  providerThreadId: `thread-${runId}`,
  providerTurnId: `provider-turn-${runId}`,
  serviceId: 'service-a',
  repoRelativePath: 'foo.ts',
  occurredAt: '2026-01-01T00:00:00.000Z',
  evidence: {
    kind: 'patch',
    diff: 'persisted diff',
    preContent: 'persisted before\n',
    postContent: 'persisted after\n',
  },
  ...overrides,
});

const initializeRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), 'heyhey-run-changes-'));
  tempDirs.push(repoPath);
  await execFileAsync('git', ['init'], { cwd: repoPath });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
  await writeFile(path.join(repoPath, 'foo.ts'), 'before foo\n');
  await writeFile(path.join(repoPath, 'bar.ts'), 'before bar\n');
  await execFileAsync('git', ['add', 'foo.ts', 'bar.ts'], { cwd: repoPath });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoPath });
  return repoPath;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('getLiveRunChangedFiles', () => {
  it('renders canonical facts from persisted evidence instead of the current worktree', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'foo.ts'), 'later manual edit\n');
    const run = createRun('run-a', repoPath);
    const reader = new RunChangedFilesReader(repoStore);

    expect(await reader.getLiveRunChangedFiles(run, [createFact('run-a')])).toEqual([
      {
        serviceId: 'service-a',
        repoPath,
        filePath: 'foo.ts',
        diff: 'persisted diff',
        preContent: 'persisted before\n',
        postContent: 'persisted after\n',
      },
    ]);
  });

  it('intersects each Run membership with current uncommitted repository state', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'foo.ts'), 'after foo\n');
    await writeFile(path.join(repoPath, 'bar.ts'), 'after bar\n');
    const fooMembership: FileChangeProjection[] = [
      { serviceId: 'service-a', repoRelativePath: 'foo.ts' },
    ];
    const barMembership: FileChangeProjection[] = [
      { serviceId: 'service-a', repoRelativePath: 'bar.ts' },
    ];
    const reader = new RunChangedFilesReader(repoStore);

    expect(
      await reader.getLiveRunChangedFiles(createRun('run-a', repoPath), fooMembership),
    ).toMatchObject([
      { serviceId: 'service-a', repoPath, filePath: 'foo.ts', postContent: 'after foo\n' },
    ]);
    expect(
      await reader.getLiveRunChangedFiles(createRun('run-b', repoPath), barMembership),
    ).toMatchObject([
      { serviceId: 'service-a', repoPath, filePath: 'bar.ts', postContent: 'after bar\n' },
    ]);

    await execFileAsync('git', ['add', 'foo.ts'], { cwd: repoPath });
    await execFileAsync('git', ['commit', '-m', 'commit foo'], { cwd: repoPath });

    expect(
      await reader.getLiveRunChangedFiles(createRun('run-a', repoPath), fooMembership),
    ).toEqual([]);
    expect(
      await reader.getLiveRunChangedFiles(createRun('run-b', repoPath), barMembership),
    ).toHaveLength(1);
  });

  it('logs the membership, repository, and projected paths for a zero result', async () => {
    const repoPath = await initializeRepo();
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => NOOP_LOGGER),
    } satisfies ServerLogger;
    const reader = new RunChangedFilesReader(repoStore, logger);

    await expect(
      reader.getLiveRunChangedFiles(createRun('run-a', repoPath), [
        { serviceId: 'service-a', repoRelativePath: 'foo.ts' },
      ]),
    ).resolves.toEqual([]);

    expect(logger.info).toHaveBeenCalledWith('local.run_changed_files.git_projection.resolved', {
      runId: 'run-a',
      serviceId: 'service-a',
      workspaceIdentifier: expect.stringMatching(/^sha256:/),
      workspaceSource: 'service_directory',
      membershipCount: 1,
      changedFilesCount: 0,
      changedFiles: [],
      reason: 'membership_clean_or_absent',
    });
    expect(logger.info).toHaveBeenCalledWith('local.run_changed_files.projection.completed', {
      runId: 'run-a',
      membershipCount: 1,
      serviceCount: 1,
      changedFilesCount: 0,
      changedFiles: [],
    });
  });

  it('fails fast when canonical membership has no repository context', async () => {
    const run = createRun('run-a', '/repo');
    run.services = [{ id: 'service-a', path: '' }];
    delete run.scope;

    await expect(
      new RunChangedFilesReader(repoStore).getLiveRunChangedFiles(run, [
        { serviceId: 'service-a', repoRelativePath: 'foo.ts' },
      ]),
    ).rejects.toBeInstanceOf(RunChangedFilesContextError);
  });

  it('classifies a non-Git service directory without exposing its path', async () => {
    const serviceDirectory = await mkdtemp(path.join(os.tmpdir(), 'heyhey-non-git-'));
    tempDirs.push(serviceDirectory);
    const reader = new RunChangedFilesReader(repoStore);

    await expect(
      reader.getLiveRunChangedFilesInventory(createRun('run-non-git', serviceDirectory), [
        { serviceId: 'service-a', repoRelativePath: 'foo.ts' },
      ]),
    ).rejects.toMatchObject({
      code: 'GIT_READ_FAILED',
      details: {
        failureClassification: 'NOT_A_REPOSITORY',
        exitCode: expect.any(Number),
        workspace: {
          workspaceSource: 'service_directory',
          workspaceIdentifier: expect.stringMatching(/^sha256:/),
          sessionKind: 'service_bound',
          workspaceResolutionStatus: 'resolved',
          serviceId: 'service-a',
          repositoryIdentity: expect.stringMatching(/^sha256:/),
          worktreeIdentity: null,
          gitRootDetected: false,
        },
      },
    });
    let error: Error | null = null;
    try {
      await reader.getLiveRunChangedFilesInventory(
        createRun('run-non-git-again', serviceDirectory),
        [{ serviceId: 'service-a', repoRelativePath: 'foo.ts' }],
      );
    } catch (reason) {
      error = reason instanceof Error ? reason : new Error(String(reason));
    }
    expect(error).toBeInstanceOf(RunChangedFilesContextError);
    expect(error?.message).not.toContain(serviceDirectory);
  });

  it('treats a removed persisted worktree as unavailable without falling back to the base repo', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'foo.ts'), 'dirty in the base repo\n');
    const missingWorktreePath = path.join(repoPath, '.worktrees', 'removed-session');
    const run = createRun('run-worktree-removed', repoPath);
    run.worktreeState = {
      'service-a': {
        repoPath,
        worktreePath: missingWorktreePath,
        branch: 'removed-session',
      },
    };
    run.scope = {
      mode: 'default',
      workspaceRoot: missingWorktreePath,
      allowedRepositoryRoots: [missingWorktreePath],
    };
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => NOOP_LOGGER),
    } satisfies ServerLogger;
    const membership: FileChangeProjection[] = [
      { serviceId: 'service-a', repoRelativePath: 'foo.ts' },
    ];
    const reader = new RunChangedFilesReader(repoStore, logger);

    await expect(reader.getLiveRunChangedFiles(run, membership)).resolves.toEqual([]);
    await expect(reader.getLiveRunChangedFiles(run, membership)).resolves.toEqual([]);

    expect(logger.debug).toHaveBeenCalledWith('local.run_changed_files.worktree_unavailable', {
      runId: 'run-worktree-removed',
      serviceId: 'service-a',
      workspaceIdentifier: expect.stringMatching(/^sha256:/),
    });
    expect(
      logger.debug.mock.calls.filter(
        ([event]) => event === 'local.run_changed_files.worktree_unavailable',
      ),
    ).toHaveLength(1);
    expect(logger.trace).toHaveBeenCalledWith(
      'local.run_changed_files.worktree_still_unavailable',
      {
        runId: 'run-worktree-removed',
        serviceId: 'service-a',
        workspaceIdentifier: expect.stringMatching(/^sha256:/),
      },
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('getLiveRunChangedFileDetail', () => {
  it('returns complete before-and-after content for the exact service-qualified member', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'foo.ts'), 'after foo\n');
    const run = createRun('run-detail', repoPath);
    const reader = new RunChangedFilesReader(repoStore);

    await expect(
      reader.getLiveRunChangedFileDetail(
        run,
        [{ serviceId: 'service-a', repoRelativePath: 'foo.ts' }],
        { serviceId: 'service-a', repoPath, filePath: 'foo.ts' },
      ),
    ).resolves.toMatchObject({
      serviceId: 'service-a',
      repoPath,
      filePath: 'foo.ts',
      status: 'modify',
      preContent: 'before foo\n',
      postContent: 'after foo\n',
    });
  });

  it('rejects a path that is not in canonical Run membership', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'bar.ts'), 'after bar\n');
    const reader = new RunChangedFilesReader(repoStore);

    await expect(
      reader.getLiveRunChangedFileDetail(
        createRun('run-detail', repoPath),
        [{ serviceId: 'service-a', repoRelativePath: 'foo.ts' }],
        { serviceId: 'service-a', repoPath, filePath: 'bar.ts' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_MEMBERSHIP' });
  });

  it('rejects a repository path that does not own the selected Service', async () => {
    const repoPath = await initializeRepo();
    await writeFile(path.join(repoPath, 'foo.ts'), 'after foo\n');
    const reader = new RunChangedFilesReader(repoStore);

    await expect(
      reader.getLiveRunChangedFileDetail(
        createRun('run-detail', repoPath),
        [{ serviceId: 'service-a', repoRelativePath: 'foo.ts' }],
        { serviceId: 'service-a', repoPath: path.join(repoPath, '..'), filePath: 'foo.ts' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_MEMBERSHIP' });
  });
});
