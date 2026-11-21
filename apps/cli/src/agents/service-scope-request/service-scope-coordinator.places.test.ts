/** @vitest-environment node */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentSessionServiceScopeRequest } from '@hey-hey/contracts/api/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRepoMappingStore } from '../../run/run.test-support';
import { toRepositoryPath, toServiceId } from '../../repo';
import type { ServiceScopeRequestEntry } from '../../run/run-service-scope';
import type { AgenticSession } from '../../session/types';
import { AgentSessionServiceScopeCoordinator } from './service-scope-coordinator';

const SERVICE_A = '00000000-0000-4000-8000-00000000000a';
const SERVICE_B = '00000000-0000-4000-8000-00000000000b';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const initRepo = (repoPath: string): void => {
  execFileSync('git', ['init', '-q', '-b', 'main', repoPath]);
  git(repoPath, 'config', 'user.email', 'test@example.com');
  git(repoPath, 'config', 'user.name', 'Test');
  git(repoPath, 'commit', '-q', '--allow-empty', '-m', 'initial');
};

let root: string;
let repoA: string;
let repoB: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'scope-places-')));
  repoA = path.join(root, 'service-a');
  repoB = path.join(root, 'service-b');
  initRepo(repoA);
  initRepo(repoB);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const makeHarness = (sessionOverrides: Partial<AgenticSession> = {}) => {
  const session = {
    agentic_session_id: 'run-1',
    services: [{ id: SERVICE_A, path: repoA }],
    launchServiceId: SERVICE_A,
    ...sessionOverrides,
  } as AgenticSession;
  let pending: ServiceScopeRequestEntry | undefined;
  const serviceScope = {
    findPendingServiceScopeRequest: vi.fn(() => undefined),
    recordServiceScopeRequest: vi.fn(
      (request: AgentSessionServiceScopeRequest, messageId: string, data: unknown) => {
        pending = { request, messageId, data } as ServiceScopeRequestEntry;
      },
    ),
    pauseForServiceScopeRequest: vi.fn(async () => undefined),
    getServiceScopeRequest: vi.fn(() => pending),
    isServiceScopeRequestSettled: vi.fn(() => false),
    settleServiceScopeRequest: vi.fn(),
    settleServiceScopeApprovalWait: vi.fn(),
    hasServiceScopeContinuation: vi.fn(() => true),
    clearServiceScopeContinuation: vi.fn(async () => undefined),
    resumeAfterServiceScopeApproval: vi.fn(async () => undefined),
  };
  const grants: string[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      grants.push(String(init.body));
      return new Response(null, { status: 200 });
    }
    return Response.json({ data: [{ id: SERVICE_B, name: 'B' }] });
  }) as unknown as typeof fetch;
  const applyApprovedServiceScope = vi.fn(async () => undefined);
  const logger = {
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const repoStore = createTestRepoMappingStore(async (serviceId) => {
    const repositoryPath = serviceId === toServiceId(SERVICE_A) ? repoA : repoB;
    return {
      serviceId,
      repositoryPath: toRepositoryPath(repositoryPath),
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    };
  });
  const coordinator = new AgentSessionServiceScopeCoordinator({
    runStore: {
      hasIdempotencyToken: vi.fn(async () => false),
      persistIdempotencyToken: vi.fn(async () => undefined),
    },
    repoStore,
    poster: { createOutOfBand: vi.fn(async () => 'message-1'), complete: vi.fn() },
    auth: { getAccessToken: vi.fn(async () => 'token') },
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl,
    keyPairStore: { loadCurrentMachineId: vi.fn(async () => 'machine-1') },
    logger,
    serviceScope,
    runId: 'run-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    provider: 'claude',
    session: () => session,
    taskMonitorId: () => null,
    currentAgentId: () => 'coding_freeform',
    canAutoResolveTaskMonitorScopeRequest: () => false,
    applyApprovedServiceScope,
    recordResolvedServiceWorktree: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof AgentSessionServiceScopeCoordinator>[0]);

  const requestB = async (): Promise<AgentSessionServiceScopeRequest> => {
    const result = await coordinator.request({ serviceIds: [SERVICE_B], reason: 'needs B' });
    if (result.status !== 'requested') {
      throw new Error(`unexpected request status ${result.status}`);
    }
    return result.request;
  };
  const approve = (
    request: AgentSessionServiceScopeRequest,
    servicePlaceChoices?: AgentSessionServiceScopeRequest['proposedPlaces'],
  ) =>
    coordinator.decide({
      requestId: request.id,
      sessionId: request.sessionId,
      agentType: request.agentType,
      decision: 'approve',
      reason: null,
      idempotencyToken: request.idempotencyToken,
      ...(servicePlaceChoices ? { servicePlaceChoices } : {}),
    });

  return { requestB, approve, grants, applyApprovedServiceScope, serviceScope };
};

describe('service access requests and the place they open', () => {
  it('proposes the main folder for a session that launched without a worktree', async () => {
    const { requestB } = makeHarness();

    const request = await requestB();

    expect(request.proposedPlaces).toEqual([{ serviceId: SERVICE_B, kind: 'MAIN_FOLDER' }]);
  });

  it('proposes the launch worktree branch for a session that launched in one', async () => {
    const { requestB } = makeHarness({
      worktree: { enabled: true, branch: 'feature/x' },
      worktreeState: {
        [SERVICE_A]: {
          repoPath: repoA,
          worktreePath: path.join(repoA, '.worktrees', 'feature-x'),
          branch: 'feature/x',
        },
      },
    });

    const request = await requestB();

    expect(request.proposedPlaces).toEqual([
      { serviceId: SERVICE_B, kind: 'WORKTREE', branch: 'feature/x', newBranch: false },
    ]);
  });

  it('proposes each Service its own launch branch when launch branches differ', async () => {
    const { requestB } = makeHarness({
      worktree: { enabled: true, branch: 'feature/x' },
      servicePlaceChoices: [
        { serviceId: SERVICE_A, kind: 'WORKTREE', branch: 'feature/a', newBranch: false },
        { serviceId: SERVICE_B, kind: 'WORKTREE', branch: 'feature/b', newBranch: false },
      ],
    });

    const request = await requestB();

    expect(request.proposedPlaces).toEqual([
      { serviceId: SERVICE_B, kind: 'WORKTREE', branch: 'feature/b', newBranch: false },
    ]);
  });

  it('never proposes the main folder for a worktree session with an unknown branch, and fails an approval that sends no choice', async () => {
    const { requestB, approve, grants, applyApprovedServiceScope } = makeHarness({
      servicePlaceChoices: [
        { serviceId: SERVICE_A, kind: 'WORKTREE', branch: 'feature/a', newBranch: false },
        { serviceId: SERVICE_A, kind: 'WORKTREE', branch: 'feature/other', newBranch: false },
      ],
    });
    const request = await requestB();

    expect(request.proposedPlaces).toEqual([]);

    const result = await approve(request);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(result.outcome === 'failed' ? result.reason : '').toContain(SERVICE_B);
    expect(grants).toEqual([]);
    expect(applyApprovedServiceScope).not.toHaveBeenCalled();
  });

  it('opens a worktree the approver chose before the grant is recorded', async () => {
    const { requestB, approve, grants, applyApprovedServiceScope } = makeHarness();
    const request = await requestB();
    const choice = {
      serviceId: SERVICE_B,
      kind: 'WORKTREE' as const,
      branch: 'feature/new',
      newBranch: true,
    };
    const worktreePath = path.join(repoB, '.worktrees', 'feature-new');
    let existedAtGrant = false;
    grants.push = (body: string) => {
      existedAtGrant = existsSync(worktreePath);
      return Array.prototype.push.call(grants, body);
    };

    await expect(approve(request, [choice])).resolves.toMatchObject({ outcome: 'delivered' });

    expect(existedAtGrant).toBe(true);
    expect(git(worktreePath, 'branch', '--show-current')).toBe('feature/new');
    expect(git(repoB, 'branch', '--show-current')).toBe('main');
    expect(applyApprovedServiceScope).toHaveBeenCalledWith(
      expect.objectContaining({ servicePlaceChoices: [choice] }),
    );
  });

  it('opens the proposed place when the approval sends no choices', async () => {
    git(repoB, 'branch', 'feature/x');
    const { requestB, approve, applyApprovedServiceScope } = makeHarness({
      worktree: { enabled: true, branch: 'feature/x' },
      worktreeState: {
        [SERVICE_A]: {
          repoPath: repoA,
          worktreePath: path.join(repoA, '.worktrees', 'feature-x'),
          branch: 'feature/x',
        },
      },
    });
    const request = await requestB();

    await expect(approve(request)).resolves.toMatchObject({ outcome: 'delivered' });

    expect(git(path.join(repoB, '.worktrees', 'feature-x'), 'branch', '--show-current')).toBe(
      'feature/x',
    );
    expect(applyApprovedServiceScope).toHaveBeenCalledWith(
      expect.objectContaining({ servicePlaceChoices: request.proposedPlaces }),
    );
  });

  it('fails the approval with the reason and records no grant when the worktree cannot open', async () => {
    const { requestB, approve, grants, applyApprovedServiceScope } = makeHarness();
    const request = await requestB();

    const result = await approve(request, [
      { serviceId: SERVICE_B, kind: 'WORKTREE', branch: 'no/such-branch', newBranch: false },
    ]);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(result.outcome === 'failed' ? result.reason : '').toContain('no/such-branch');
    expect(grants).toEqual([]);
    expect(applyApprovedServiceScope).not.toHaveBeenCalled();
  });

  it('accepts an approval that chooses only the added Service while another stays granted', async () => {
    const { requestB, approve, applyApprovedServiceScope } = makeHarness({
      servicePlaceChoices: [{ serviceId: SERVICE_A, kind: 'MAIN_FOLDER' }],
    });
    const request = await requestB();
    expect(request.requestedServiceIds).toEqual([SERVICE_A, SERVICE_B]);
    const choice = { serviceId: SERVICE_B, kind: 'MAIN_FOLDER' as const };

    await expect(approve(request, [choice])).resolves.toMatchObject({ outcome: 'delivered' });

    expect(applyApprovedServiceScope).toHaveBeenCalledWith(
      expect.objectContaining({
        servicePlaceChoices: [{ serviceId: SERVICE_A, kind: 'MAIN_FOLDER' }, choice],
      }),
    );
  });

  it('rejects a choice for a Service the request does not add', async () => {
    const { requestB, approve, grants } = makeHarness();
    const request = await requestB();

    const result = await approve(request, [
      { serviceId: '00000000-0000-4000-8000-0000000000ff', kind: 'MAIN_FOLDER' },
    ]);

    expect(result).toEqual({
      outcome: 'dropped',
      reason: 'service_scope_decision_place_choice_rejected',
    });
    expect(grants).toEqual([]);
  });
});
