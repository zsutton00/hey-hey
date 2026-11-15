import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../../../run/run';
import { createTestRun } from '../../../run/run.test-support';
import { CommitReportTool } from '../../submission-tools/create-commit-report-tool';
import { makeCreateReportProxy } from '../../submission-tools/create-report-proxy.test-support';
import { failureMessage } from '../../../run/failure-message';
import { CommitGitError } from '../commit-git-error';
import { executeCanonicalCommit } from '../commit-executor';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

const git = async (cwd: string, args: string[]): Promise<string> =>
  (await execFileAsync('git', args, { cwd })).stdout.trim();

const createRepo = async (): Promise<string> => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'heyhey-commit-executor-'));
  tempDirs.push(repo);
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'tests@heyhey.dev']);
  await git(repo, ['config', 'user.name', 'Hey Hey Tests']);
  await writeFile(path.join(repo, 'a.ts'), 'export const value = 1;\n');
  await writeFile(path.join(repo, 'b.ts'), 'export const other = 1;\n');
  await writeFile(path.join(repo, 'unrelated.ts'), 'export const unrelated = 1;\n');
  await git(repo, ['add', 'a.ts', 'b.ts', 'unrelated.ts']);
  await git(repo, ['commit', '-m', 'initial']);
  await writeFile(path.join(repo, 'a.ts'), 'export const value = 2;\n');
  return repo;
};

const makeRun = (
  repo: string,
  overrides: {
    services?: Array<{ id: string; path: string }>;
    taskId?: string | null;
    worktreeState?: Record<string, { repoPath: string; worktreePath: string; branch: string }>;
    projections?: Array<{ serviceId: string; repoRelativePath: string }>;
  } = {},
): Run => {
  const run = createTestRun({ runId: 'session-1' });
  run.session.services = overrides.services ?? [{ id: 'service-1', path: repo }];
  run.session.launchServiceId = 'service-1';
  if (overrides.worktreeState !== undefined) {
    run.session.worktreeState = overrides.worktreeState;
  }
  run.session.contextMetadata = {
    ...run.session.contextMetadata,
    launchPlanId: 'plan-1',
  };
  const taskId = overrides.taskId === undefined ? 'task-1' : overrides.taskId;
  run.session.entity =
    taskId === null
      ? { entityType: 'SERVICE', entityId: 'service-1' }
      : { entityType: 'TASK', entityId: taskId };
  vi.spyOn(run, 'getFileChangeProjection').mockReturnValue(
    overrides.projections ?? [{ serviceId: 'service-1', repoRelativePath: 'a.ts' }],
  );
  return run;
};

const makeCommitReportTool = (
  execute: CommitReportTool['execute'] = vi
    .fn<CommitReportTool['execute']>()
    .mockResolvedValue({ content: [] }),
): CommitReportTool => {
  const tool = new CommitReportTool(makeCreateReportProxy());
  vi.spyOn(tool, 'execute').mockImplementation(execute);
  return tool;
};

const makeLogger = () => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('executeCanonicalCommit', () => {
  it('claims only new same-Run and same-Service records across durable commits', async () => {
    const repo = await createRepo();
    const run = makeRun(repo);
    run.session.promptType = 'commit';
    const append = (reportId: string, sourceRunId: string, serviceId: string) =>
      run.appendReportChainEntry({
        reportId,
        sourceRunId,
        serviceId,
        reportType: 'IMPLEMENT',
        phase: 'implement',
        createdAt: new Date().toISOString(),
        summary: 'Changed canonical file',
        audience: 'EXTERNAL',
      });
    append('11111111-1111-4111-8111-111111111111', run.runId, 'service-1');
    append('22222222-2222-4222-8222-222222222222', 'another-run', 'service-1');
    append('33333333-3333-4333-8333-333333333333', run.runId, 'service-2');
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create)
      .mockResolvedValueOnce({ content: [], reportId: 'commit-report-1' })
      .mockResolvedValue({ content: [], reportId: 'commit-report-2' });
    const tool = new CommitReportTool(proxy);
    const input = {
      run,
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: run.runId },
      liveFiles: [path.join(repo, 'a.ts')],
      message: 'Update file',
      commitReportTool: tool,
      logger: makeLogger() as never,
    };
    await executeCanonicalCommit(input);
    expect(run.readReportChain().at(-1)?.commitHashes?.[0]?.implementReportIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
    append('44444444-4444-4444-8444-444444444444', run.runId, 'service-1');
    await writeFile(path.join(repo, 'a.ts'), 'export const value = 3;\n');
    await executeCanonicalCommit(input);
    expect(run.readReportChain().at(-1)?.commitHashes?.[0]?.implementReportIds).toEqual([
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('reports a successful Service when a later Service fails', async () => {
    const first = await createRepo();
    const second = await createRepo();
    await git(second, ['config', 'core.hooksPath', '/dev/null']);
    await git(second, ['config', 'user.name', '']);
    const run = makeRun(first, {
      services: [
        { id: 'service-1', path: first },
        { id: 'service-2', path: second },
      ],
      projections: [
        { serviceId: 'service-1', repoRelativePath: 'a.ts' },
        { serviceId: 'service-2', repoRelativePath: 'a.ts' },
      ],
    });
    const tool = makeCommitReportTool();
    await expect(
      executeCanonicalCommit({
        run,
        payload: { userMessage: '', taskId: 'task-1', codingSessionId: run.runId },
        liveFiles: [path.join(first, 'a.ts'), path.join(second, 'a.ts')],
        message: 'Update files',
        commitReportTool: tool,
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow();
    expect(tool.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          hashes: [expect.objectContaining({ service: 'service-1', implementReportIds: [] })],
        }),
      }),
    );
  });

  it('retries failed durable reporting without producing a second git commit', async () => {
    const repo = await createRepo();
    const run = makeRun(repo);
    run.session.promptType = 'commit';
    const proxy = makeCreateReportProxy();
    vi.mocked(proxy.create)
      .mockRejectedValueOnce(new Error('lost report response'))
      .mockResolvedValue({ content: [], reportId: 'recovered-report' });
    const input = {
      run,
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: run.runId },
      liveFiles: [path.join(repo, 'a.ts')],
      message: 'Update file',
      commitReportTool: new CommitReportTool(proxy),
      logger: makeLogger() as never,
    };
    await expect(executeCanonicalCommit(input)).rejects.toThrow('lost report response');
    const head = await git(repo, ['rev-parse', 'HEAD']);
    expect(run.reportProvenance.pending?.hashes[0]?.hash).toBe(head.slice(0, 7));
    await executeCanonicalCommit(input);
    expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(head);
    expect(run.reportProvenance.pending).toBeUndefined();
    expect(proxy.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(proxy.create).mock.calls[1]?.[0]).toEqual(
      vi.mocked(proxy.create).mock.calls[0]?.[0],
    );
  });

  it('commits only canonical files with runtime-owned trailers and emits COMMIT evidence', async () => {
    const repo = await createRepo();
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const reportTool = makeCommitReportTool(execute);
    const run = makeRun(repo);
    await writeFile(path.join(repo, 'unrelated.ts'), 'export const unrelated = 2;\n');
    await git(repo, ['add', 'unrelated.ts']);

    await executeCanonicalCommit({
      run,
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: 'session-1' },
      liveFiles: [path.join(repo, 'a.ts')],
      message: 'fix: update canonical value',
      commitReportTool: reportTool,
      logger: makeLogger() as never,
    });

    const body = await git(repo, ['show', '-s', '--format=%B', 'HEAD']);
    expect(body).toContain('fix: update canonical value');
    expect(body).toContain('Task-Id: task-1');
    expect(body).toContain('Plan-Id: plan-1');
    expect(body).toContain('Coding-Session-Id: session-1');
    expect(await git(repo, ['show', '--format=', '--name-only', 'HEAD'])).toBe('a.ts');
    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('unrelated.ts');
    const hash = await git(repo, ['rev-parse', '--short', 'HEAD']);
    const branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(execute).toHaveBeenCalledWith({
      runId: 'session-1',
      run,
      args: {
        summary: 'fix: update canonical value',
        files: ['a.ts'],
        hashes: [{ service: 'service-1', hash, branch, implementReportIds: [] }],
      },
    });
    const args = execute.mock.calls[0]![0].args;
    expect(JSON.stringify(args)).not.toContain(repo);
  });

  it.each([
    { staged: false, withEdit: false },
    { staged: true, withEdit: false },
    { staged: false, withEdit: true },
    { staged: true, withEdit: true },
  ])(
    'commits deletion (staged=$staged, withEdit=$withEdit) without unrelated staged changes',
    async ({ staged, withEdit }) => {
      const repo = await createRepo();
      await rm(path.join(repo, 'b.ts'));
      if (staged) {
        await git(repo, ['add', '--', 'b.ts']);
      }
      await rm(path.join(repo, 'unrelated.ts'));
      await git(repo, ['add', '--', 'unrelated.ts']);
      const files = withEdit ? ['a.ts', 'b.ts'] : ['b.ts'];
      const execute = vi.fn().mockResolvedValue({ content: [] });
      await executeCanonicalCommit({
        run: makeRun(repo, {
          projections: files.map((repoRelativePath) => ({
            serviceId: 'service-1',
            repoRelativePath,
          })),
        }),
        payload: { userMessage: '' },
        liveFiles: files.map((file) => path.join(repo, file)),
        message: 'Remove obsolete file',
        commitReportTool: makeCommitReportTool(execute),
        logger: makeLogger(),
      });
      expect(await git(repo, ['show', '--format=', '--name-status', 'HEAD'])).toBe(
        withEdit ? 'M\ta.ts\nD\tb.ts' : 'D\tb.ts',
      );
      expect(await git(repo, ['diff', '--cached', '--name-status'])).toBe('D\tunrelated.ts');
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.objectContaining({ files }) }),
      );
    },
  );

  it('stages a recreated file even when its deletion was previously staged', async () => {
    const repo = await createRepo();
    await rm(path.join(repo, 'a.ts'));
    await git(repo, ['add', '--', 'a.ts']);
    await writeFile(path.join(repo, 'a.ts'), 'recreated\n');
    await executeCanonicalCommit({
      run: makeRun(repo),
      payload: { userMessage: '' },
      liveFiles: [path.join(repo, 'a.ts')],
      message: 'Recreate file',
      commitReportTool: makeCommitReportTool(),
      logger: makeLogger(),
    });
    expect(await git(repo, ['show', 'HEAD:a.ts'])).toBe('recreated');
  });

  it('exposes the missing path and Git reason without publishing a successful report', async () => {
    const repo = await createRepo();
    const execute = vi.fn();
    const error = await executeCanonicalCommit({
      run: makeRun(repo, {
        projections: [{ serviceId: 'service-1', repoRelativePath: 'missing.ts' }],
      }),
      payload: { userMessage: '' },
      liveFiles: [path.join(repo, 'missing.ts')],
      message: 'Private generated commit message',
      commitReportTool: makeCommitReportTool(execute),
      logger: makeLogger(),
    }).catch((error) => error);
    expect(error).toBeInstanceOf(CommitGitError);
    const response = failureMessage('EXECUTION_FAILED', [], { cause: error.message });
    expect(response).toContain("pathspec 'missing.ts' did not match any files");
    expect(response).not.toContain('Private generated commit message');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports the files recorded in the resulting commit rather than every validated path', async () => {
    const repo = await createRepo();
    const execute = vi.fn().mockResolvedValue({ content: [] });

    await executeCanonicalCommit({
      run: makeRun(repo, {
        projections: [
          { serviceId: 'service-1', repoRelativePath: 'a.ts' },
          { serviceId: 'service-1', repoRelativePath: 'b.ts' },
        ],
      }),
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: 'session-1' },
      liveFiles: [path.join(repo, 'a.ts'), path.join(repo, 'b.ts')],
      message: 'fix: report committed files',
      commitReportTool: makeCommitReportTool(execute),
      logger: makeLogger() as never,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ files: ['a.ts'] }),
      }),
    );
  });

  it('commits a taskless Service Run with Agent Session and Service traceability', async () => {
    const repo = await createRepo();
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const run = makeRun(repo, { taskId: null });

    await executeCanonicalCommit({
      run,
      payload: { userMessage: '', codingSessionId: 'session-1' },
      liveFiles: [path.join(repo, 'a.ts')],
      message: 'fix: update service value',
      commitReportTool: makeCommitReportTool(execute),
      logger: makeLogger() as never,
    });

    const body = await git(repo, ['show', '-s', '--format=%B', 'HEAD']);
    expect(body).not.toContain('Task-Id:');
    expect(body).toContain('Plan-Id: plan-1');
    expect(body).toContain('Coding-Session-Id: session-1');
    expect(body).toContain('Service-Id: service-1');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ runId: 'session-1', run }));
  });

  it('emits one report after committing every selected service', async () => {
    const firstRepo = await createRepo();
    const secondRepo = await createRepo();
    await git(secondRepo, ['checkout', '-b', 'second-checkout']);
    const execute = vi.fn().mockResolvedValue({ content: [] });

    const run = makeRun(firstRepo, {
      services: [
        { id: 'service-1', path: firstRepo },
        { id: 'service-2', path: secondRepo },
      ],
      projections: [
        { serviceId: 'service-1', repoRelativePath: 'a.ts' },
        { serviceId: 'service-2', repoRelativePath: 'a.ts' },
      ],
    });

    await executeCanonicalCommit({
      run,
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: 'session-1' },
      liveFiles: [path.join(firstRepo, 'a.ts'), path.join(secondRepo, 'a.ts')],
      message: 'fix: commit all selected services',
      commitReportTool: makeCommitReportTool(execute),
      logger: makeLogger() as never,
    });

    const firstHash = await git(firstRepo, ['rev-parse', '--short', 'HEAD']);
    const secondHash = await git(secondRepo, ['rev-parse', '--short', 'HEAD']);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      runId: 'session-1',
      run,
      args: {
        summary: 'fix: commit all selected services',
        files: ['a.ts', 'a.ts'],
        hashes: [
          {
            service: 'service-1',
            hash: firstHash,
            branch: await git(firstRepo, ['rev-parse', '--abbrev-ref', 'HEAD']),
            implementReportIds: [],
          },
          {
            service: 'service-2',
            hash: secondHash,
            branch: 'second-checkout',
            implementReportIds: [],
          },
        ],
      },
    });
  });

  it('commits canonical files in the active worktree without mutating the host checkout', async () => {
    const repo = await createRepo();
    const worktree = await mkdtemp(path.join(os.tmpdir(), 'heyhey-commit-worktree-'));
    tempDirs.push(worktree);
    await rm(worktree, { recursive: true, force: true });
    await git(repo, ['worktree', 'add', '-b', 'session-worktree', worktree]);
    await writeFile(path.join(worktree, 'a.ts'), 'export const value = 3;\n');
    await writeFile(path.join(worktree, 'unrelated.ts'), 'export const unrelated = 3;\n');
    await git(worktree, ['add', 'unrelated.ts']);
    const hostHead = await git(repo, ['rev-parse', 'HEAD']);
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const logger = makeLogger();
    const run = makeRun(repo, {
      worktreeState: {
        'service-1': {
          repoPath: repo,
          worktreePath: worktree,
          branch: 'session-worktree',
        },
      },
    });

    await executeCanonicalCommit({
      run,
      payload: { userMessage: '', taskId: 'task-1', codingSessionId: 'session-1' },
      liveFiles: [path.join(worktree, 'a.ts')],
      message: 'fix: commit active worktree',
      commitReportTool: makeCommitReportTool(execute),
      logger: logger as never,
    });

    expect(await git(worktree, ['show', '--format=', '--name-only', 'HEAD'])).toBe('a.ts');
    expect(await git(worktree, ['diff', '--cached', '--name-only'])).toBe('unrelated.ts');
    expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(hostHead);
    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await git(repo, ['status', '--short', '--', 'a.ts'])).toBe('M a.ts');
    const hash = await git(worktree, ['rev-parse', '--short', 'HEAD']);
    expect(execute).toHaveBeenCalledWith({
      runId: 'session-1',
      run,
      args: {
        summary: 'fix: commit active worktree',
        files: ['a.ts'],
        hashes: [
          { service: 'service-1', hash, branch: 'session-worktree', implementReportIds: [] },
        ],
      },
    });
    const args = execute.mock.calls[0]![0].args;
    expect(JSON.stringify(args)).not.toContain(worktree);
    expect(JSON.stringify(args)).not.toContain(repo);
    expect(logger.debug).toHaveBeenCalledWith(
      'local.commit_runtime.live_file_canonical_membership_checked',
      expect.objectContaining({
        runId: 'session-1',
        liveFile: path.join(worktree, 'a.ts'),
        serviceId: 'service-1',
        repositoryRoot: worktree,
        repoRelativePath: 'a.ts',
        canonicalMatch: true,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'local.commit_runtime.git_operation_started',
      expect.objectContaining({
        runId: 'session-1',
        serviceId: 'service-1',
        repositoryRoot: worktree,
        operation: 'commit',
        files: ['a.ts'],
      }),
    );
  });

  it('rejects a live file outside the active worktree before staging', async () => {
    const repo = await createRepo();
    const worktree = await mkdtemp(path.join(os.tmpdir(), 'heyhey-commit-worktree-'));
    tempDirs.push(worktree);
    await rm(worktree, { recursive: true, force: true });
    await git(repo, ['worktree', 'add', '-b', 'session-worktree', worktree]);

    const logger = makeLogger();
    await expect(
      executeCanonicalCommit({
        run: makeRun(repo, {
          worktreeState: {
            'service-1': {
              repoPath: repo,
              worktreePath: worktree,
              branch: 'session-worktree',
            },
          },
        }),
        payload: { userMessage: '' },
        liveFiles: [path.join(repo, 'a.ts')],
        message: 'fix: reject host checkout path',
        commitReportTool: makeCommitReportTool(),
        logger: logger as never,
      }),
    ).rejects.toThrow('outside the selected service workspaces');

    expect(logger.warn).toHaveBeenCalledWith(
      'local.commit_runtime.live_file_resolution_failed',
      expect.objectContaining({
        runId: 'session-1',
        liveFile: path.join(repo, 'a.ts'),
        serviceWorkspaces: [
          expect.objectContaining({
            serviceId: 'service-1',
            configuredRepositoryRoot: repo,
            activeRepositoryRoot: worktree,
          }),
        ],
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'local.commit_runtime.failed',
      expect.objectContaining({
        runId: 'session-1',
        canonicalFileCount: 1,
        serviceWorkspaces: [expect.objectContaining({ activeRepositoryRoot: worktree })],
      }),
    );
    expect(await git(worktree, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await git(worktree, ['status', '--short', '--', 'a.ts'])).toBe('');
    expect(await git(repo, ['status', '--short', '--', 'a.ts'])).toBe('M a.ts');
  });

  it('fails before staging when canonical Run facts reference an unavailable service', async () => {
    const repo = await createRepo();

    await expect(
      executeCanonicalCommit({
        run: makeRun(repo, { services: [{ id: 'different-service', path: repo }] }),
        payload: { userMessage: '' },
        liveFiles: [path.join(repo, 'a.ts')],
        message: 'fix: update canonical value',
        commitReportTool: makeCommitReportTool(),
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow('canonical Run facts reference unavailable service service-1');

    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await git(repo, ['status', '--short', '--', 'a.ts'])).toBe('M a.ts');
  });

  it('fails before staging when caller traceability disagrees with Run context', async () => {
    const repo = await createRepo();

    await expect(
      executeCanonicalCommit({
        run: makeRun(repo),
        payload: { userMessage: '', taskId: 'different-task' },
        liveFiles: [path.join(repo, 'a.ts')],
        message: 'fix: update canonical value',
        commitReportTool: makeCommitReportTool(),
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow('caller task identifier disagrees');

    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('rejects caller task attribution for a taskless Service Run before staging', async () => {
    const repo = await createRepo();

    await expect(
      executeCanonicalCommit({
        run: makeRun(repo, { taskId: null }),
        payload: { userMessage: '', taskId: 'caller-task' },
        liveFiles: [path.join(repo, 'a.ts')],
        message: 'fix: reject caller task attribution',
        commitReportTool: makeCommitReportTool(),
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow('taskless Run cannot accept caller task traceability');

    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('rejects invalid taskless Service scope before staging', async () => {
    const repo = await createRepo();
    const run = makeRun(repo, { taskId: null });
    run.session.entity = { entityType: 'SERVICE', entityId: 'unselected-service' };

    await expect(
      executeCanonicalCommit({
        run,
        payload: { userMessage: '' },
        liveFiles: [path.join(repo, 'a.ts')],
        message: 'fix: reject invalid service scope',
        commitReportTool: makeCommitReportTool(),
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow('taskless Run has no valid Service execution scope');

    expect(await git(repo, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('does not emit a report when the validated scope has no current commit', async () => {
    const repo = await createRepo();
    const execute = vi.fn();

    await expect(
      executeCanonicalCommit({
        run: makeRun(repo, {
          projections: [{ serviceId: 'service-1', repoRelativePath: 'b.ts' }],
        }),
        payload: { userMessage: '' },
        liveFiles: [path.join(repo, 'b.ts')],
        message: 'fix: do not report empty commit',
        commitReportTool: makeCommitReportTool(execute),
        logger: makeLogger() as never,
      }),
    ).rejects.toThrow();

    expect(execute).not.toHaveBeenCalled();
  });
});
