import { describe, expect, it, vi } from 'vitest';

import type { RunStore } from '../run-store/run-store';
import { NOOP_LOGGER } from '../server/logger';
import type { AgenticSession, ServiceScopeContinuation } from '../session/types';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgentSessionServiceScopeRequest } from '../shared/api/generated/api';
import type { SystemMessageData } from '../shared/api/index';
import {
  RunServiceScope,
  type InputAdmission,
  type InputSettlementEvidence,
  type RunServiceScopeDeps,
} from './run-service-scope';

const input = {
  promptType: 'coding_freeform',
  prompt: 'build it',
} as unknown as InternalRunPromptRequest;
const checkpoint: ServiceScopeContinuation['checkpoint'] = {
  completedActions: ['read files'],
  discoveries: [],
  toolResults: [],
  changedFiles: [],
  nextAction: 'Resume the interrupted request after applying the approved Service scope.',
};
const request = (id: string): AgentSessionServiceScopeRequest =>
  ({
    id,
    reason: 'needs api',
    currentServiceIds: ['svc-1'],
    requestedServiceIds: ['svc-1', 'svc-2'],
  }) as unknown as AgentSessionServiceScopeRequest;
const admission = (turnId: string): InputAdmission => ({
  turnId,
  onStarted: vi.fn(() => Promise.resolve()),
  onRejected: vi.fn(() => Promise.resolve()),
  onSettled: vi.fn(() => Promise.resolve()),
});
const evidence = (turnId: string): InputSettlementEvidence => ({
  turnId,
  terminalOutcome: 'ABORTED',
  completedAssistantMessageId: null,
  reports: [],
  settledAt: '2026-10-20T00:00:00.000Z',
});

const makeHarness = (
  sessionOverrides: Partial<AgenticSession> = {},
  depOverrides: Partial<RunServiceScopeDeps> = {},
) => {
  const calls: string[] = [];
  const state = {
    session: { updatedAt: '2026-10-19T00:00:00.000Z', ...sessionOverrides } as AgenticSession,
    activeTurn: { turnId: 'turn-1' } as { turnId: string } | null,
    activeInput: input as InternalRunPromptRequest | null,
    hasProviderSession: true,
    hasInputAdmission: true,
  };
  const updateRunServiceScopeContinuation = vi.fn((_runId: string, _value: unknown) => {
    calls.push('store');
    return Promise.resolve();
  });
  const runStore = {
    updateRunServiceScopeContinuation,
    updateRunServiceScopeRequestPresentations: vi.fn(() => Promise.resolve()),
  } as unknown as RunStore;
  const deps: RunServiceScopeDeps = {
    runId: 'run-1',
    logger: NOOP_LOGGER,
    runStore,
    session: () => state.session,
    patchSession: vi.fn((patch: Partial<AgenticSession>) => {
      calls.push('patch');
      state.session = { ...state.session, ...patch };
    }),
    hasProviderSession: () => state.hasProviderSession,
    taskMonitorId: () => null,
    activeTurn: () => state.activeTurn,
    activeInput: () => state.activeInput,
    abortSignal: () => undefined,
    hasInputAdmission: () => state.hasInputAdmission,
    captureCheckpoint: vi.fn(() => checkpoint),
    observeProviderPhase: vi.fn((phase: string) => {
      calls.push(`phase:${phase}`);
    }),
    readStateChanged: vi.fn(),
    requestSettled: vi.fn(),
    abort: vi.fn(() => {
      calls.push('abort');
    }),
    resumeInput: vi.fn(),
    releaseHeldAdmission: vi.fn(() => Promise.resolve()),
    postAgentSystemMessage: vi.fn(() => Promise.resolve()),
    ...depOverrides,
  };
  const scope = new RunServiceScope(deps);
  return { scope, deps, state, calls, updateRunServiceScopeContinuation };
};

const recordRequest = (scope: RunServiceScope, id: string): void => {
  scope.recordServiceScopeRequest(request(id), `message-${id}`, {} as SystemMessageData);
};

describe('RunServiceScope pause', () => {
  it('persists the checkpoint, then waits for the user and aborts the Turn', async () => {
    const { scope, deps, calls, updateRunServiceScopeContinuation } = makeHarness();
    recordRequest(scope, 'req-1');
    calls.length = 0;

    await scope.pauseForServiceScopeRequest('req-1', 'human');

    expect(deps.captureCheckpoint).toHaveBeenCalledWith('turn-1');
    expect(updateRunServiceScopeContinuation).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        input,
        checkpoint,
        delivery: 'pending',
        interruptedTurnId: 'turn-1',
      }),
    );
    expect(calls).toEqual(['store', 'patch', 'phase:awaiting_approval', 'abort']);
    expect(scope.isWaitingForApproval()).toBe(true);
    expect(scope.isServiceScopeApprovalPauseActive()).toBe(true);
    expect(scope.hasServiceScopeContinuation()).toBe(true);
  });

  it('resolves automatically without entering the approval wait', async () => {
    const controller = new AbortController();
    const { scope, deps, calls } = makeHarness({}, { abortSignal: () => controller.signal });
    recordRequest(scope, 'req-1');
    calls.length = 0;

    await scope.pauseForServiceScopeRequest('req-1', 'automatic');
    controller.abort();

    expect(calls).toEqual(['store', 'patch', 'abort']);
    expect(scope.isWaitingForApproval()).toBe(false);
    expect(scope.consumeExpectedServiceScopeTurnAbort(controller.signal)).toBe(true);
    expect(scope.consumeExpectedServiceScopeTurnAbort(controller.signal)).toBe(false);
    expect(scope.settleServiceScopeApprovalWait('req-1', 'starting')).toBe(true);
    expect(deps.observeProviderPhase).toHaveBeenLastCalledWith('starting');
  });

  it('rejects a second request taking over the pause', async () => {
    const { scope } = makeHarness();
    recordRequest(scope, 'req-1');
    recordRequest(scope, 'req-2');
    await scope.pauseForServiceScopeRequest('req-1', 'human');

    await expect(scope.pauseForServiceScopeRequest('req-2', 'human')).rejects.toThrow(
      'A different approval request already owns the Run pause.',
    );
  });

  it('ignores settling a request that does not own the wait', async () => {
    const { scope, deps } = makeHarness();
    recordRequest(scope, 'req-1');
    await scope.pauseForServiceScopeRequest('req-1', 'human');
    vi.mocked(deps.observeProviderPhase).mockClear();

    expect(scope.settleServiceScopeApprovalWait('other', 'idle')).toBe(false);
    expect(scope.isWaitingForApproval()).toBe(true);
    expect(deps.observeProviderPhase).not.toHaveBeenCalled();

    expect(scope.settleServiceScopeApprovalWait('req-1', 'idle')).toBe(true);
    expect(scope.isWaitingForApproval()).toBe(false);
    expect(deps.observeProviderPhase).toHaveBeenCalledWith('idle');
  });
});

describe('RunServiceScope turn-end input settlement', () => {
  it('settles now for a Turn that was not paused', () => {
    const { scope } = makeHarness();
    expect(scope.settleTurnInput('turn-1', admission('turn-1'), evidence('turn-1'))).toBe(
      'settle-now',
    );
  });

  it('holds the paused Turn input until the decision arrives, and clearing releases it', async () => {
    const { scope, deps } = makeHarness();
    recordRequest(scope, 'req-1');
    await scope.pauseForServiceScopeRequest('req-1', 'human');
    const held = admission('turn-1');

    expect(scope.settleTurnInput('turn-1', held, evidence('turn-1'))).toBe('held');
    expect(deps.releaseHeldAdmission).not.toHaveBeenCalled();

    await scope.clearServiceScopeContinuation();

    expect(deps.releaseHeldAdmission).toHaveBeenCalledWith({
      admission: held,
      evidence: evidence('turn-1'),
    });
    expect(scope.hasServiceScopeContinuation()).toBe(false);
  });

  it('hands the input to the continuation when approval arrived before the Turn ended', async () => {
    const { scope, deps } = makeHarness();
    recordRequest(scope, 'req-1');
    await scope.pauseForServiceScopeRequest('req-1', 'human');

    await scope.resumeAfterServiceScopeApproval();

    expect(deps.resumeInput).toHaveBeenCalledWith(input);
    expect(scope.settleTurnInput('turn-1', admission('turn-1'), evidence('turn-1'))).toBe(
      'handed-to-continuation',
    );
  });

  it('lets the paused Turn settle its own input when denial arrived before it ended', async () => {
    const { scope, deps } = makeHarness();
    recordRequest(scope, 'req-1');
    await scope.pauseForServiceScopeRequest('req-1', 'human');

    await scope.clearServiceScopeContinuation();

    expect(scope.settleTurnInput('turn-1', admission('turn-1'), evidence('turn-1'))).toBe(
      'settle-now',
    );
    expect(deps.releaseHeldAdmission).not.toHaveBeenCalled();
  });

  it('drops the held settlement when approval resumes the continuation', async () => {
    const { scope, deps } = makeHarness();
    recordRequest(scope, 'req-1');
    await scope.pauseForServiceScopeRequest('req-1', 'human');
    scope.settleTurnInput('turn-1', admission('turn-1'), evidence('turn-1'));

    await scope.resumeAfterServiceScopeApproval();
    await scope.clearServiceScopeContinuation();

    expect(deps.releaseHeldAdmission).not.toHaveBeenCalled();
  });
});

describe('RunServiceScope rehydration', () => {
  it('restores the pending request, begins the wait and keeps the continuation', () => {
    const continuation: ServiceScopeContinuation = {
      input,
      checkpoint,
      delivery: 'pending',
      interruptedTurnId: 'turn-1',
      capturedAt: '2026-10-19T00:00:00.000Z',
    };
    const { scope, deps, state } = makeHarness({
      serviceScopeRequestPresentations: [{ request: request('req-1'), messageId: 'message-1' }],
      serviceScopeContinuation: continuation,
    });
    state.hasProviderSession = false;

    expect(deps.observeProviderPhase).toHaveBeenCalledWith('awaiting_approval');
    expect(scope.isServiceScopeApprovalPauseActive()).toBe(true);
    expect(scope.getServiceScopeRequest('req-1')).toEqual({
      request: request('req-1'),
      messageId: 'message-1',
      data: null,
    });
    expect(scope.pendingRecovery()).toBe(continuation);
  });

  it('rebuilds a legacy continuation from its persisted input', () => {
    const { scope } = makeHarness({ serviceScopeContinuationInput: input });

    expect(scope.hasServiceScopeContinuation()).toBe(true);
    expect(scope.isWaitingForApproval()).toBe(false);
  });
});
