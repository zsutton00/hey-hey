/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoMappingStore, toRepositoryPath, toServiceId } from '../repo/index';
import type { ServerLogger } from '../server/logger';
import type { AgenticSession } from '../session/index';
import { LOCAL_RUN_MODE } from '../shared/agent-bridge-contract/contract';
import {
  resolveRunWorkspace,
  resolveServiceBindingsForIds,
  RunWorktreeCollisionError,
} from './run-scope';

const createWorktreeMock = vi.hoisted(() => vi.fn());
const attachWorktreeMock = vi.hoisted(() => vi.fn());
const getBranchWorktreeStateMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  default: {
    access: (...args: Parameters<typeof accessMock>) => accessMock(...args),
  },
}));

vi.mock('../git/index', async () => {
  const actual = await vi.importActual<typeof import('../git/index')>('../git/index');
  return {
    ...actual,
    createWorktree: (...args: Parameters<typeof createWorktreeMock>) => createWorktreeMock(...args),
    attachWorktree: (...args: Parameters<typeof attachWorktreeMock>) => attachWorktreeMock(...args),
    getBranchWorktreeState: (...args: Parameters<typeof getBranchWorktreeStateMock>) =>
      getBranchWorktreeStateMock(...args),
  };
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession => {
  const base: AgenticSession = {
    entity: null,
    agentic_session_id: 'agentic-session-1',
    services: [
      { id: 'svc-a', path: '/repos/service-a' },
      { id: 'svc-b', path: '/repos/service-b' },
    ],
    launchServiceId: 'svc-a',
    provider: 'codex',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    status: 'idle',
    conversationId: 'conversation-1',
    contextMetadata: {
      capturedAt: '2026-02-20T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: 'agentic-session-1',
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    } as AgenticSession['contextMetadata'],
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    events: [],
  };

  return { ...base, ...overrides };
};

const makeRepoStore = (
  getBinding: RepoMappingStore['getBinding'] = vi.fn(async () => null),
): RepoMappingStore => {
  const store = new RepoMappingStore();
  vi.spyOn(store, 'getBinding').mockImplementation(getBinding);
  return store;
};

const makeLogger = (): ServerLogger => {
  let logger!: ServerLogger;
  logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
};

beforeEach(() => {
  createWorktreeMock.mockReset();
  attachWorktreeMock.mockReset();
  getBranchWorktreeStateMock.mockReset();
  accessMock.mockReset();

  createWorktreeMock.mockImplementation(
    async (options: { repoPath: string; worktreePath: string; branch?: string }) => ({
      repoPath: options.repoPath,
      worktreePath: options.worktreePath,
      branch: options.branch ?? 'generated-branch',
    }),
  );
  attachWorktreeMock.mockImplementation(
    async (options: { repoPath: string; worktreePath: string; branch: string }) => ({
      repoPath: options.repoPath,
      worktreePath: options.worktreePath,
      branch: options.branch,
    }),
  );
  getBranchWorktreeStateMock.mockResolvedValue({
    branchExists: false,
    checkedOutWorktree: null,
    worktrees: [],
  });
  accessMock.mockResolvedValue(undefined);
});

describe('resolveRunWorkspace', () => {
  it('materializes a worktree per selected service and uses non-launch worktrees as allowed roots', async () => {
    const logger = makeLogger();
    getBranchWorktreeStateMock.mockImplementation(async (repoPath: string) => ({
      branchExists: repoPath.endsWith('service-b'),
      checkedOutWorktree: null,
      worktrees: [],
    }));

    const result = await resolveRunWorkspace({
      session: makeSession({ worktree: { enabled: true, branch: 'feature/branch' } }),
      repoStore: makeRepoStore(),
      logger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(createWorktreeMock).toHaveBeenCalledWith({
      repoPath: '/repos/service-a',
      worktreePath: '/repos/service-a/.worktrees/feature-branch',
      branch: 'feature/branch',
    });
    expect(attachWorktreeMock).toHaveBeenCalledWith({
      repoPath: '/repos/service-b',
      worktreePath: '/repos/service-b/.worktrees/feature-branch',
      branch: 'feature/branch',
    });
    expect(result.cwd).toBe('/repos/service-a/.worktrees/feature-branch');
    expect(result.repositoryPathForRunStarted).toBe('/repos/service-a/.worktrees/feature-branch');
    expect(result.allowedRepositoryRoots).toEqual([
      '/repos/service-a/.worktrees/feature-branch',
      '/repos/service-b/.worktrees/feature-branch',
    ]);
    expect(result.worktree).toEqual({
      'svc-a': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature/branch',
      },
      'svc-b': {
        repoPath: '/repos/service-b',
        worktreePath: '/repos/service-b/.worktrees/feature-branch',
        branch: 'feature/branch',
      },
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.worktree.service.create_succeeded',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        serviceId: 'svc-a',
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature/branch',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.worktree.service.attach_succeeded',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        serviceId: 'svc-b',
        repoPath: '/repos/service-b',
        worktreePath: '/repos/service-b/.worktrees/feature-branch',
        branch: 'feature/branch',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.workspace.resolve.succeeded',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        runMode: 'default',
        cwd: '/repos/service-a/.worktrees/feature-branch',
        allowedRepositoryRoots: [
          '/repos/service-a/.worktrees/feature-branch',
          '/repos/service-b/.worktrees/feature-branch',
        ],
        worktreeServiceIds: ['svc-a', 'svc-b'],
      }),
    );
  });

  it('reuses persisted per-service worktree state on relaunch', async () => {
    const logger = makeLogger();
    getBranchWorktreeStateMock.mockImplementation(async (repoPath: string) => ({
      branchExists: true,
      checkedOutWorktree: {
        worktreePath: repoPath.endsWith('service-a')
          ? '/worktrees/service-a'
          : '/worktrees/service-b',
        head: 'abc',
        branch: 'feature/branch',
        bare: false,
      },
      worktrees: [
        {
          worktreePath: repoPath.endsWith('service-a')
            ? '/worktrees/service-a'
            : '/worktrees/service-b',
          head: 'abc',
          branch: 'feature/branch',
          bare: false,
        },
      ],
    }));

    const result = await resolveRunWorkspace({
      session: makeSession({
        worktree: { enabled: true, branch: 'feature/branch' },
        worktreeState: {
          'svc-a': {
            repoPath: '/repos/service-a',
            worktreePath: '/worktrees/service-a',
            branch: 'feature/branch',
          },
          'svc-b': {
            repoPath: '/repos/service-b',
            worktreePath: '/worktrees/service-b',
            branch: 'feature/branch',
          },
        },
      }),
      repoStore: makeRepoStore(),
      logger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getBranchWorktreeStateMock).toHaveBeenCalledTimes(2);
    expect(createWorktreeMock).not.toHaveBeenCalled();
    expect(attachWorktreeMock).not.toHaveBeenCalled();
    expect(result.cwd).toBe('/worktrees/service-a');
    expect(result.allowedRepositoryRoots).toEqual(['/worktrees/service-a', '/worktrees/service-b']);
    expect(result.worktree).toEqual({
      'svc-a': {
        repoPath: '/repos/service-a',
        worktreePath: '/worktrees/service-a',
        branch: 'feature/branch',
      },
      'svc-b': {
        repoPath: '/repos/service-b',
        worktreePath: '/worktrees/service-b',
        branch: 'feature/branch',
      },
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.worktree.service.persisted_state_reused',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        serviceId: 'svc-a',
        repoPath: '/repos/service-a',
        worktreePath: '/worktrees/service-a',
        branch: 'feature/branch',
      }),
    );
  });

  it('reattaches when persisted worktree state points at a stale path', async () => {
    const logger = makeLogger();
    accessMock.mockRejectedValue(new Error('missing'));
    getBranchWorktreeStateMock.mockResolvedValue({
      branchExists: true,
      checkedOutWorktree: null,
      worktrees: [],
    });

    const result = await resolveRunWorkspace({
      session: makeSession({
        worktree: { enabled: true, branch: 'feature/branch' },
        worktreeState: {
          'svc-a': {
            repoPath: '/repos/service-a',
            worktreePath: '/deleted/service-a',
            branch: 'feature/branch',
          },
          'svc-b': {
            repoPath: '/repos/service-b',
            worktreePath: '/deleted/service-b',
            branch: 'feature/branch',
          },
        },
      }),
      repoStore: makeRepoStore(),
      logger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(attachWorktreeMock).toHaveBeenCalledTimes(2);
    expect(result.cwd).toBe('/repos/service-a/.worktrees/feature-branch');
    expect(result.worktree).toEqual({
      'svc-a': {
        repoPath: '/repos/service-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
        branch: 'feature/branch',
      },
      'svc-b': {
        repoPath: '/repos/service-b',
        worktreePath: '/repos/service-b/.worktrees/feature-branch',
        branch: 'feature/branch',
      },
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.worktree.service.persisted_state_unusable',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        serviceId: 'svc-a',
        persistedWorktreePath: '/deleted/service-a',
        reason: 'worktree_path_missing',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run_scope.worktree.service.attach_succeeded',
      expect.objectContaining({
        sessionId: 'agentic-session-1',
        serviceId: 'svc-a',
        worktreePath: '/repos/service-a/.worktrees/feature-branch',
      }),
    );
  });

  it('reuses the existing checked-out worktree path when git already has the branch checked out', async () => {
    getBranchWorktreeStateMock.mockImplementation(async (repoPath: string) => ({
      branchExists: true,
      checkedOutWorktree: {
        worktreePath: `${repoPath}/../existing-feature`,
        head: 'abc',
        branch: 'feature/branch',
        bare: false,
      },
      worktrees: [
        {
          worktreePath: `${repoPath}/../existing-feature`,
          head: 'abc',
          branch: 'feature/branch',
          bare: false,
        },
      ],
    }));

    const result = await resolveRunWorkspace({
      session: makeSession({ worktree: { enabled: true, branch: 'feature/branch' } }),
      repoStore: makeRepoStore(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(createWorktreeMock).not.toHaveBeenCalled();
    expect(attachWorktreeMock).not.toHaveBeenCalled();
    expect(result.cwd).toBe('/repos/service-a/../existing-feature');
    expect(result.allowedRepositoryRoots).toEqual([
      '/repos/service-a/../existing-feature',
      '/repos/service-b/../existing-feature',
    ]);
  });

  it('does not treat a branch checked out in the host repository as an isolated worktree', async () => {
    getBranchWorktreeStateMock.mockImplementation(async (repoPath: string) => ({
      branchExists: true,
      checkedOutWorktree: {
        worktreePath: repoPath,
        head: 'abc',
        branch: 'feature/branch',
        bare: false,
      },
      worktrees: [
        {
          worktreePath: repoPath,
          head: 'abc',
          branch: 'feature/branch',
          bare: false,
        },
      ],
    }));

    const userEditableSession = makeSession({
      worktree: { enabled: true, branch: 'feature/branch' },
    });
    await expect(
      resolveRunWorkspace({
        session: userEditableSession,
        repoStore: makeRepoStore(),
      }),
    ).rejects.toMatchObject({
      name: 'RunWorktreeCollisionError',
      code: 'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY',
      serviceId: 'svc-a',
      repositoryPath: '/repos/service-a',
      branch: 'feature/branch',
      authority: 'TASK_MONITOR',
      correctionMode: 'USER_EDITABLE',
      correctiveAction:
        'Choose a different editable worktree or branch in Task Monitor settings, then press Start to retry.',
      failure: {
        code: 'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY',
        authority: 'TASK_MONITOR',
        correctionMode: 'USER_EDITABLE',
        fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
      message:
        'Branch feature/branch is already checked out in repository /repos/service-a; cannot materialize an isolated worktree for this service.',
    });

    const planSession = makeSession({
      worktree: { enabled: true, branch: 'feature/branch' },
      contextMetadata: {
        ...userEditableSession.contextMetadata,
        launchPlanId: 'plan-1',
      },
    });
    await expect(
      resolveRunWorkspace({
        session: planSession,
        repoStore: makeRepoStore(),
      }),
    ).rejects.toMatchObject({
      authority: 'PLAN',
      correctionMode: 'PLAN_LOCKED',
      correctiveAction:
        'Resolve the checkout in the named repository while keeping the plan branch and worktree unchanged, then press Start to retry.',
      failure: {
        authority: 'PLAN',
        correctionMode: 'PLAN_LOCKED',
      },
    });
  });

  it('keeps the collision fingerprint stable while preserving the original diagnostic', () => {
    const first = new RunWorktreeCollisionError({
      serviceId: 'svc-a',
      repositoryPath: '/repos/../repos/service-a',
      branch: 'feature/branch',
      authority: 'TASK_MONITOR',
    });
    const second = new RunWorktreeCollisionError({
      serviceId: 'svc-a',
      repositoryPath: '/repos/service-a',
      branch: 'feature/branch',
      authority: 'TASK_MONITOR',
    });

    expect(first.message).toBe(
      'Branch feature/branch is already checked out in repository /repos/service-a; cannot materialize an isolated worktree for this service.',
    );
    expect(first.failure).toEqual({
      code: 'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY',
      message: first.message,
      serviceId: 'svc-a',
      repositoryPath: '/repos/service-a',
      branch: 'feature/branch',
      authority: 'TASK_MONITOR',
      correctionMode: 'USER_EDITABLE',
      correctiveAction:
        'Choose a different editable worktree or branch in Task Monitor settings, then press Start to retry.',
      fingerprint: first.fingerprint,
    });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('keeps scoped default worktree roots on worktree paths and preserves non-service roots', async () => {
    const result = await resolveRunWorkspace({
      session: makeSession({
        worktree: { enabled: true, branch: 'feature/branch' },
        scope: {
          mode: LOCAL_RUN_MODE.default,
          allowedRepositoryRoots: [
            '/repos',
            '/repos/service-a/src',
            '/repos/service-b',
            '/repos/tools',
            '/shared/tools',
          ],
        },
      }),
      repoStore: makeRepoStore(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cwd).toBe('/repos/service-a/.worktrees/feature-branch');
    expect(result.allowedRepositoryRoots).toEqual([
      '/repos/service-a/.worktrees/feature-branch',
      '/repos/service-b/.worktrees/feature-branch',
      '/repos/tools',
      '/shared/tools',
    ]);
  });

  it('fails when any selected service cannot resolve a repository path', async () => {
    const result = await resolveRunWorkspace({
      session: makeSession({
        services: [
          { id: 'svc-a', path: '/repos/service-a' },
          { id: 'svc-b', path: '' },
        ],
        worktree: { enabled: true, branch: 'feature/branch' },
      }),
      repoStore: makeRepoStore(
        vi.fn(async (serviceId) =>
          serviceId === toServiceId('svc-b')
            ? null
            : {
                serviceId,
                repositoryPath: toRepositoryPath('/repos/service-a'),
                createdAt: '2026-02-20T00:00:00.000Z',
                updatedAt: '2026-02-20T00:00:00.000Z',
              },
        ),
      ),
    });

    expect(result).toEqual({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      message: 'Session has no resolved repository mapping for selected service svc-b.',
    });
  });
});

describe('resolveServiceBindingsForIds', () => {
  it('deduplicates the approved union and resolves every Service workspace', async () => {
    const result = await resolveServiceBindingsForIds({
      serviceIds: ['svc-a', 'svc-b', 'svc-a'],
      repoStore: makeRepoStore(
        vi.fn(async (serviceId) => ({
          serviceId,
          repositoryPath: toRepositoryPath(`/repos/${serviceId}`),
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        })),
      ),
    });

    expect(result).toEqual({
      ok: true,
      services: [
        { id: 'svc-a', path: '/repos/svc-a' },
        { id: 'svc-b', path: '/repos/svc-b' },
      ],
    });
    expect(accessMock).toHaveBeenCalledTimes(2);
    expect(accessMock).toHaveBeenNthCalledWith(1, '/repos/svc-a', 5);
    expect(accessMock).toHaveBeenNthCalledWith(2, '/repos/svc-b', 5);
  });

  it('returns no partial scope when a Service binding is unknown', async () => {
    const result = await resolveServiceBindingsForIds({
      serviceIds: ['svc-a', 'svc-missing'],
      repoStore: makeRepoStore(
        vi.fn(async (serviceId) =>
          serviceId === toServiceId('svc-missing')
            ? null
            : {
                serviceId,
                repositoryPath: toRepositoryPath('/repos/svc-a'),
                createdAt: '2026-07-12T00:00:00.000Z',
                updatedAt: '2026-07-12T00:00:00.000Z',
              },
        ),
      ),
    });

    expect(result).toEqual({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      serviceId: 'svc-missing',
      message: 'Approved Coding Plan scope has no repository mapping for Service svc-missing.',
    });
    expect(accessMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an inaccessible workspace before returning the scope', async () => {
    accessMock.mockRejectedValueOnce(new Error('permission denied'));

    const result = await resolveServiceBindingsForIds({
      serviceIds: ['svc-a'],
      repoStore: makeRepoStore(
        vi.fn(async (serviceId) => ({
          serviceId,
          repositoryPath: toRepositoryPath('/repos/svc-a'),
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        })),
      ),
    });

    expect(result).toEqual({
      ok: false,
      code: 'REPO_BINDING_MISSING',
      serviceId: 'svc-a',
      message: 'Approved Coding Plan scope cannot access the workspace for Service svc-a.',
    });
  });
});
