/** @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorktree,
  createWorktree,
  getBranchWorktreeState,
  isBranchRegisteredToWorktree,
} from './worktree';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

type PromisifiedExecFileCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

const mockGitSuccess = (stdout = ''): void => {
  execFileMock.mockImplementation((_command, _args, _options, callback) => {
    const promisifiedCallback = callback as PromisifiedExecFileCallback;
    promisifiedCallback(null, { stdout, stderr: '' });
    return {};
  });
};

beforeEach(() => {
  execFileMock.mockReset();
  mockGitSuccess();
});

describe('createWorktree', () => {
  it('creates a worktree with -b for a new branch', async () => {
    const result = await createWorktree({
      repoPath: '/repo',
      worktreePath: '/repo/.worktrees/feature',
      branch: 'feature/branch',
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '/repo/.worktrees/feature', '-b', 'feature/branch'],
      { cwd: '/repo' },
      expect.any(Function),
    );
    expect(result).toEqual({
      repoPath: '/repo',
      worktreePath: '/repo/.worktrees/feature',
      branch: 'feature/branch',
    });
  });
});

describe('attachWorktree', () => {
  it('attaches a worktree to an existing branch without -b', async () => {
    const result = await attachWorktree({
      repoPath: '/repo',
      worktreePath: '/repo/.worktrees/feature',
      branch: 'feature/branch',
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '/repo/.worktrees/feature', 'feature/branch'],
      { cwd: '/repo' },
      expect.any(Function),
    );
    const attachArgs = execFileMock.mock.calls[0]?.[1];
    expect(attachArgs).not.toContain('-b');
    expect(result).toEqual({
      repoPath: '/repo',
      worktreePath: '/repo/.worktrees/feature',
      branch: 'feature/branch',
    });
  });
});

describe('isBranchRegisteredToWorktree', () => {
  it('returns true when listWorktrees reports a matching branch', async () => {
    mockGitSuccess(
      [
        'worktree /repo',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        'worktree /repo/.worktrees/feature',
        'HEAD 2222222222222222222222222222222222222222',
        'branch refs/heads/feature/branch',
        '',
      ].join('\n'),
    );

    await expect(isBranchRegisteredToWorktree('/repo', 'feature/branch')).resolves.toBe(true);
  });

  it('returns false when no registered worktree branch matches', async () => {
    mockGitSuccess(
      [
        'worktree /repo',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
      ].join('\n'),
    );

    await expect(isBranchRegisteredToWorktree('/repo', 'feature/branch')).resolves.toBe(false);
  });
});

describe('getBranchWorktreeState', () => {
  it('reports an existing branch that is not checked out in any worktree', async () => {
    execFileMock.mockImplementation((_command, args, _options, callback) => {
      const promisifiedCallback = callback as PromisifiedExecFileCallback;
      if ((args as string[])[0] === 'worktree') {
        promisifiedCallback(null, {
          stdout: [
            'worktree /repo',
            'HEAD 1111111111111111111111111111111111111111',
            'branch refs/heads/main',
            '',
          ].join('\n'),
          stderr: '',
        });
        return {};
      }
      promisifiedCallback(null, { stdout: '', stderr: '' });
      return {};
    });

    await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toEqual({
      branchExists: true,
      checkedOutWorktree: null,
      worktrees: [
        {
          worktreePath: '/repo',
          head: '1111111111111111111111111111111111111111',
          branch: 'main',
          bare: false,
          prunable: false,
        },
      ],
    });
  });

  it('reports the worktree where a branch is already checked out', async () => {
    mockGitSuccess(
      [
        'worktree /repo',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        'worktree /repo/.worktrees/feature',
        'HEAD 2222222222222222222222222222222222222222',
        'branch refs/heads/feature/branch',
        '',
      ].join('\n'),
    );

    await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toMatchObject({
      branchExists: true,
      checkedOutWorktree: {
        worktreePath: '/repo/.worktrees/feature',
        branch: 'feature/branch',
      },
    });
  });

  it('reports a missing branch when no local ref or checked-out worktree exists', async () => {
    execFileMock.mockImplementation((_command, args, _options, callback) => {
      const promisifiedCallback = callback as PromisifiedExecFileCallback;
      if ((args as string[])[0] === 'worktree') {
        promisifiedCallback(null, {
          stdout: [
            'worktree /repo',
            'HEAD 1111111111111111111111111111111111111111',
            'branch refs/heads/main',
            '',
          ].join('\n'),
          stderr: '',
        });
        return {};
      }
      promisifiedCallback(new Error('missing branch'), { stdout: '', stderr: '' });
      return {};
    });

    await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toMatchObject({
      branchExists: false,
      checkedOutWorktree: null,
    });
  });
});

describe('getBranchWorktreeState during an in-progress rebase', () => {
  let gitDir: string;

  beforeEach(async () => {
    gitDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-worktree-git-dir-'));
  });

  afterEach(async () => {
    await rm(gitDir, { recursive: true, force: true });
  });

  const mockDetachedFeatureWorktree = (): void => {
    execFileMock.mockImplementation((_command, args, _options, callback) => {
      const promisifiedCallback = callback as PromisifiedExecFileCallback;
      const gitArgs = args as string[];
      if (gitArgs[0] === 'worktree') {
        promisifiedCallback(null, {
          stdout: [
            'worktree /repo',
            'HEAD 1111111111111111111111111111111111111111',
            'branch refs/heads/main',
            '',
            'worktree /repo/.worktrees/feature',
            'HEAD 2222222222222222222222222222222222222222',
            'detached',
            '',
          ].join('\n'),
          stderr: '',
        });
        return {};
      }
      if (gitArgs[0] === 'rev-parse') {
        promisifiedCallback(null, { stdout: `${gitDir}\n`, stderr: '' });
        return {};
      }
      promisifiedCallback(null, { stdout: '', stderr: '' });
      return {};
    });
  };

  it.each(['rebase-merge', 'rebase-apply'])(
    'reports the worktree rebasing the branch as holding it (%s)',
    async (rebaseDir) => {
      await mkdir(path.join(gitDir, rebaseDir));
      await writeFile(path.join(gitDir, rebaseDir, 'head-name'), 'refs/heads/feature/branch\n');
      mockDetachedFeatureWorktree();

      await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toMatchObject({
        branchExists: true,
        checkedOutWorktree: {
          worktreePath: '/repo/.worktrees/feature',
          branch: 'feature/branch',
        },
      });
      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--absolute-git-dir'],
        { cwd: '/repo/.worktrees/feature' },
        expect.any(Function),
      );
    },
  );

  it('leaves a detached worktree with no rebase unassigned to any branch', async () => {
    mockDetachedFeatureWorktree();

    await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toMatchObject({
      checkedOutWorktree: null,
      worktrees: [
        { worktreePath: '/repo', branch: 'main' },
        { worktreePath: '/repo/.worktrees/feature', branch: null },
      ],
    });
  });

  it('does not inspect a prunable worktree whose directory is gone', async () => {
    mockGitSuccess(
      [
        'worktree /repo/.worktrees/gone',
        'HEAD 3333333333333333333333333333333333333333',
        'detached',
        'prunable gitdir file points to non-existent location',
        '',
      ].join('\n'),
    );

    await expect(getBranchWorktreeState('/repo', 'feature/branch')).resolves.toMatchObject({
      checkedOutWorktree: null,
      worktrees: [{ worktreePath: '/repo/.worktrees/gone', branch: null, prunable: true }],
    });
    expect(execFileMock).not.toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--absolute-git-dir'],
      expect.anything(),
      expect.any(Function),
    );
  });
});
