/** @vitest-environment node */

import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ServicePlaceChoice } from '@hey-hey/contracts/api/models';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoMappingStore } from '../repo/index';
import type { AgenticSession } from '../session/index';
import {
  resolveRunWorkspace,
  RunWorktreeBranchMissingError,
  RunWorktreeCollisionError,
  RunWorktreeNewBranchExistsError,
  type ResolvedRunWorkspace,
} from './run-scope';

const SERVICE_A = '00000000-0000-4000-8000-00000000000a';
const SERVICE_B = '00000000-0000-4000-8000-00000000000b';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const initRepo = (repoPath: string, branch: string): void => {
  execFileSync('git', ['init', '-q', '-b', branch, repoPath]);
  git(repoPath, 'config', 'user.email', 'test@example.com');
  git(repoPath, 'config', 'user.name', 'Test');
  git(repoPath, 'commit', '-q', '--allow-empty', '-m', 'initial');
};

let root: string;
let repoA: string;
let repoB: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'service-places-')));
  repoA = path.join(root, 'service-a');
  repoB = path.join(root, 'service-b');
  initRepo(repoA, 'main');
  initRepo(repoB, 'develop');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const makeSession = (overrides: Partial<AgenticSession>): AgenticSession => ({
  entity: null,
  agentic_session_id: 'session-places-1',
  services: [
    { id: SERVICE_A, path: repoA },
    { id: SERVICE_B, path: repoB },
  ],
  launchServiceId: SERVICE_A,
  provider: 'codex',
  provider_session_id: 'pending_abc',
  provider_conversation_id: null,
  status: 'idle',
  conversationId: 'conversation-1',
  contextMetadata: {
    capturedAt: '2026-11-20T00:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'project-1',
    agentSessionId: 'session-places-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  } as unknown as AgenticSession['contextMetadata'],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  events: [],
  ...overrides,
});

const resolve = async (session: AgenticSession): Promise<ResolvedRunWorkspace> => {
  const result = await resolveRunWorkspace({ session, repoStore: new RepoMappingStore() });
  if (!result.ok) {
    throw new Error(`workspace did not resolve: ${result.code} ${result.message}`);
  }
  return result;
};

const worktreeChoice = (
  serviceId: string,
  branch: string,
  newBranch?: boolean,
): ServicePlaceChoice => ({
  serviceId,
  kind: 'WORKTREE',
  branch,
  ...(newBranch === undefined ? {} : { newBranch }),
});

const mainFolderChoice = (serviceId: string): ServicePlaceChoice => ({
  serviceId,
  kind: 'MAIN_FOLDER',
});

describe('resolveRunWorkspace with per-Service place choices', () => {
  it('keeps a MAIN_FOLDER Service in its folder while another opens a new worktree from HEAD', async () => {
    const headA = git(repoA, 'rev-parse', 'HEAD');

    const result = await resolve(
      makeSession({
        worktree: { enabled: true, branch: 'feature/x' },
        servicePlaceChoices: [
          worktreeChoice(SERVICE_A, 'feature/x', true),
          mainFolderChoice(SERVICE_B),
        ],
      }),
    );

    const worktreeA = path.join(repoA, '.worktrees', 'feature-x');
    expect(result.worktree).toEqual({
      [SERVICE_A]: { repoPath: repoA, worktreePath: worktreeA, branch: 'feature/x' },
    });
    expect(result.cwd).toBe(worktreeA);
    expect(result.allowedRepositoryRoots).toEqual(expect.arrayContaining([worktreeA, repoB]));
    expect(git(worktreeA, 'rev-parse', 'HEAD')).toBe(headA);
    expect(git(repoA, 'branch', '--show-current')).toBe('main');
    expect(git(repoB, 'branch', '--show-current')).toBe('develop');
  });

  it('starts in the launch Service main folder when only another Service opens a worktree', async () => {
    const result = await resolve(
      makeSession({
        servicePlaceChoices: [
          mainFolderChoice(SERVICE_A),
          worktreeChoice(SERVICE_B, 'feature/b', true),
        ],
      }),
    );

    const worktreeB = path.join(repoB, '.worktrees', 'feature-b');
    expect(result.cwd).toBe(repoA);
    expect(result.worktree).toEqual({
      [SERVICE_B]: { repoPath: repoB, worktreePath: worktreeB, branch: 'feature/b' },
    });
    expect(result.allowedRepositoryRoots).toEqual(expect.arrayContaining([repoA, worktreeB]));
    expect(result.allowedRepositoryRoots).not.toContain(repoB);
  });

  it('starts in the launch Service main folder when it has no choice and only another Service opens a worktree', async () => {
    const result = await resolve(
      makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_B, 'feature/b', true)] }),
    );

    expect(result.cwd).toBe(repoA);
    expect(result.worktree?.[SERVICE_A]).toBeUndefined();
  });

  it('starts a new branch from a detached main folder without moving it', async () => {
    const detachedAt = git(repoA, 'rev-parse', 'HEAD');
    git(repoA, 'commit', '-q', '--allow-empty', '-m', 'second');
    git(repoA, 'checkout', '-q', '--detach', detachedAt);

    const result = await resolve(
      makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'feature/y', true)] }),
    );

    const worktreeA = result.worktree?.[SERVICE_A]?.worktreePath;
    expect(worktreeA).toBeDefined();
    expect(git(worktreeA!, 'rev-parse', 'HEAD')).toBe(detachedAt);
    expect(git(repoA, 'rev-parse', 'HEAD')).toBe(detachedAt);
    expect(git(repoA, 'branch', '--show-current')).toBe('');
    expect(result.worktree?.[SERVICE_B]).toBeUndefined();
  });

  it('attaches an existing branch that no folder has checked out', async () => {
    git(repoB, 'branch', 'feature/z');

    const result = await resolve(
      makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_B, 'feature/z')] }),
    );

    const worktreeB = path.join(repoB, '.worktrees', 'feature-z');
    expect(result.worktree).toEqual({
      [SERVICE_B]: { repoPath: repoB, worktreePath: worktreeB, branch: 'feature/z' },
    });
    expect(git(worktreeB, 'branch', '--show-current')).toBe('feature/z');
  });

  it('reuses a worktree that already has the chosen branch checked out', async () => {
    const existing = path.join(root, 'elsewhere');
    git(repoA, 'worktree', 'add', '-q', '-b', 'feature/w', existing);

    const result = await resolve(
      makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'feature/w')] }),
    );

    expect(result.worktree?.[SERVICE_A]).toEqual({
      repoPath: repoA,
      worktreePath: existing,
      branch: 'feature/w',
    });
  });

  it('refuses a new-branch choice for a branch that already exists', async () => {
    git(repoA, 'branch', 'feature/taken');

    await expect(
      resolve(
        makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'feature/taken', true)] }),
      ),
    ).rejects.toBeInstanceOf(RunWorktreeNewBranchExistsError);
    expect(git(repoA, 'worktree', 'list', '--porcelain')).not.toContain('feature/taken');
  });

  it('refuses an existing-branch choice whose branch no longer exists', async () => {
    await expect(
      resolve(makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'feature/gone')] })),
    ).rejects.toBeInstanceOf(RunWorktreeBranchMissingError);
    expect(git(repoA, 'branch', '--list', 'feature/gone')).toBe('');
  });

  it('raises the collision error for a worktree on the branch the main folder has checked out', async () => {
    await expect(
      resolve(makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'main')] })),
    ).rejects.toBeInstanceOf(RunWorktreeCollisionError);
    expect(git(repoA, 'branch', '--show-current')).toBe('main');
  });

  it('raises the collision error for a new-branch choice on the branch the main folder has checked out', async () => {
    await expect(
      resolve(makeSession({ servicePlaceChoices: [worktreeChoice(SERVICE_A, 'main', true)] })),
    ).rejects.toBeInstanceOf(RunWorktreeCollisionError);
  });

  it('applies the session-wide worktree to every Service when there are no choices', async () => {
    const result = await resolve(
      makeSession({ worktree: { enabled: true, branch: 'feature/all' } }),
    );

    expect(Object.keys(result.worktree ?? {}).sort()).toEqual([SERVICE_A, SERVICE_B].sort());
    expect(result.worktree?.[SERVICE_B]?.worktreePath).toBe(
      path.join(repoB, '.worktrees', 'feature-all'),
    );
  });

  it('works in the main folders when there are no choices and no session-wide worktree', async () => {
    const result = await resolve(makeSession({}));

    expect(result.worktree).toBeUndefined();
    expect(result.cwd).toBe(repoA);
  });

  it('resolves the same places again after a restart, including a new-branch choice', async () => {
    const choices = [
      worktreeChoice(SERVICE_A, 'feature/resume', true),
      mainFolderChoice(SERVICE_B),
    ];
    const first = await resolve(makeSession({ servicePlaceChoices: choices }));

    const resumed = await resolve(
      makeSession({
        servicePlaceChoices: choices,
        ...(first.worktree ? { worktreeState: first.worktree } : {}),
      }),
    );

    expect(resumed.worktree).toEqual(first.worktree);
    expect(resumed.cwd).toBe(first.cwd);
    expect(resumed.allowedRepositoryRoots).toEqual(first.allowedRepositoryRoots);
  });
});
