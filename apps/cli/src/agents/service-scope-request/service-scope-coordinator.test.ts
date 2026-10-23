import { describe, expect, it, vi } from 'vitest';

import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunStore,
} from '../../run/run.test-support';
import { Run, type RunCollaborators } from '../../run/run';
import {
  LOCAL_RUN_MODE,
  type InternalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import type { AgentSessionServiceScopeRequest } from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import { toRepositoryPath, toServiceId } from '../../repo';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import {
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunnerPicker,
} from '../../run/run.test-support';

const request: AgentSessionServiceScopeRequest = {
  id: 'scope-request-1',
  runId: 'run-1',
  sessionId: 'run-1',
  agentId: 'coding_freeform',
  agentType: 'claude',
  timestamp: '2026-07-01T00:00:00.000Z',
  idempotencyToken: 'scope-token-1',
  currentServiceIds: ['svc-1'],
  requestedServiceIds: ['svc-1', 'svc-2'],
  reason: 'The implementation spans both Services.',
};

const continuation: InternalRunPromptRequest = {
  promptType: LocalPromptType.CodingFreeform,
  payload: {
    promptType: LocalPromptType.CodingFreeform,
    userMessage: 'continue the implementation',
  } as NonNullable<InternalRunPromptRequest['payload']>,
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
};

const makeSession = (input?: {
  invalidWorkspace?: boolean;
  missingContinuation?: boolean;
  withoutPendingRequest?: boolean;
  taskMonitorId?: string;
}): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    provider_session_agent_id: 'coding_freeform',
    status: 'ACTIVE',
    services: [{ id: 'svc-1', path: '/tmp' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'run-1',
      ...(input?.taskMonitorId ? { taskMonitorId: input.taskMonitorId } : {}),
    },
    serviceScopeRequestPresentations: input?.withoutPendingRequest
      ? []
      : [{ request, messageId: 'scope-message-1' }],
    ...(input?.missingContinuation
      ? {}
      : { serviceScopeContinuationInput: continuation }),
    ...(input?.invalidWorkspace
      ? { scope: { mode: LOCAL_RUN_MODE.default, allowedRepositoryRoots: ['/elsewhere'] } }
      : {}),
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    events: [],
  }) as unknown as AgenticSession;

const makeHarness = (input?: {
  missingServiceId?: string;
  invalidWorkspace?: boolean;
  missingContinuation?: boolean;
  withoutPendingRequest?: boolean;
  discardFailure?: Error;
  idempotencyPersistenceFailure?: Error;
  continuationPersistenceFailure?: Error;
  servicePersistenceFailure?: Error;
  machineId?: string | null;
  machineIdReadFailure?: Error;
  fetchImpl?: typeof fetch;
  taskMonitorId?: string;
}) => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'hasIdempotencyToken').mockResolvedValue(false);
  const persistIdempotencyToken = vi.spyOn(runStore, 'persistIdempotencyToken');
  if (input?.idempotencyPersistenceFailure) {
    persistIdempotencyToken.mockRejectedValue(input.idempotencyPersistenceFailure);
  } else {
    persistIdempotencyToken.mockResolvedValue(undefined);
  }
  vi.spyOn(runStore, 'updateRunServiceScopeRequestPresentations').mockResolvedValue(
    makeSession(input),
  );
  vi.spyOn(runStore, 'updateRunServiceScopeContinuationInput').mockResolvedValue(
    makeSession(input),
  );
  const updateRunServiceScopeContinuation = vi.spyOn(runStore, 'updateRunServiceScopeContinuation');
  if (input?.continuationPersistenceFailure) {
    updateRunServiceScopeContinuation.mockRejectedValue(input.continuationPersistenceFailure);
  } else {
    updateRunServiceScopeContinuation.mockResolvedValue(makeSession(input));
  }
  const updateRunServices = vi.spyOn(runStore, 'updateRunServices');
  if (input?.servicePersistenceFailure) {
    updateRunServices.mockRejectedValue(input.servicePersistenceFailure);
  } else {
    updateRunServices.mockResolvedValue(makeSession(input));
  }
  vi.spyOn(runStore, 'updateRunProviderIdentity').mockResolvedValue(makeSession(input));
  vi.spyOn(runStore, 'updateRunPromptType').mockResolvedValue(makeSession(input));
  vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue(makeSession(input));
  vi.spyOn(runStore, 'getTouchedFiles').mockResolvedValue([]);

  const repoStore = createTestRepoMappingStore(async (serviceId) =>
    serviceId === toServiceId(input?.missingServiceId ?? '')
      ? null
      : {
          serviceId,
          repositoryPath: toRepositoryPath('/tmp'),
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
  );
  const poster = createTestMessagePoster();
  const broadcaster = createTestRunEventPublisher();
  const logger = {
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];
  const fetchImpl =
    input?.fetchImpl ??
    (vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch);
  const handlerDeps = {
    runStore,
    fetchImpl,
    auth: { getAccessToken: vi.fn(async () => 'access-token') },
    apiBaseUrl: 'https://api.example.test/api/v1',
    logger,
  } as unknown as PromptTypeHandlerDeps;
  const keyPairStore = createTestKeyPairStore({
    currentMachineId: input?.machineId === undefined ? 'machine-1' : input.machineId,
  });
  if (input?.machineIdReadFailure) {
    vi.spyOn(keyPairStore, 'loadCurrentMachineId').mockRejectedValue(input.machineIdReadFailure);
  }
  const ownership = createTestRunOwnership();
  const runnerPicker = createTestRunnerPicker(() => ({ run: async () => undefined }));
  const run = new Run(
    {
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      provider: 'claude',
      session: makeSession(input),
      skipProjectAssistant: true,
    },
    {
      runStore,
      repoStore,
      poster,
      broadcaster,
      keyPairStore,
      handlerDeps,
      promptTypeRegistry: ownership.promptTypeRegistry,
      submissionToolRegistry: ownership.submissionToolRegistry,
      runFollowUpAdmission: ownership.runFollowUpAdmission,
      runnerPicker,
      logger,
    },
  );
  const discardProviderSession = vi.spyOn(run, 'discardProviderSessionForScopeChange');
  if (input?.discardFailure) {
    discardProviderSession.mockRejectedValue(input.discardFailure);
  } else {
    discardProviderSession.mockResolvedValue(undefined);
  }
  return { run, runStore, poster, broadcaster, fetchImpl, logger };
};

const decision = (value: 'approve' | 'deny') => ({
  requestId: request.id,
  sessionId: request.sessionId,
  agentType: request.agentType,
  decision: value,
  reason: value === 'approve' ? 'Approved' : 'Denied',
  idempotencyToken: request.idempotencyToken,
});

describe('AgentSessionServiceScopeCoordinator settlement', () => {
  it('auto-approves an authorized Task Monitor request without publishing user waiting', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 200 });
      return Response.json({
        data: [
          { id: 'svc-1', name: 'CLI' },
          { id: 'svc-2', name: 'API' },
        ],
      });
    }) as unknown as typeof fetch;
    const { run, broadcaster } = makeHarness({
      fetchImpl,
      taskMonitorId: 'task-monitor-1',
      withoutPendingRequest: true,
    });
    vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval').mockResolvedValue(undefined);
    run.setTaskMonitorAutomationAuthorization(true);

    await expect(
      run.serviceScopeCoordinator.request({
        serviceIds: ['svc-2'],
        reason: 'The implementation also requires the API Service.',
      }),
    ).resolves.toMatchObject({ status: 'requested' });

    const states = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map(([observation]) => observation.currentState);
    expect(states).not.toContain('AWAITING_APPROVAL');
    expect(states).toContain('STARTING');
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(run.session.services).toEqual([
      { id: 'svc-1', path: '/tmp' },
      { id: 'svc-2', path: '/tmp' },
    ]);
  });

  it('keeps a non-Task-Monitor request awaiting human approval despite runner authorization', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [{ id: 'svc-2', name: 'API' }] }),
    ) as unknown as typeof fetch;
    const { run, broadcaster } = makeHarness({ fetchImpl, withoutPendingRequest: true });
    run.setTaskMonitorAutomationAuthorization(true);

    await run.serviceScopeCoordinator.request({
      serviceIds: ['svc-2'],
      reason: 'The implementation also requires the API Service.',
    });

    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
  });

  it('names only Services that are additional to the current scope', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'svc-1', name: 'Already Approved Service' },
          { id: 'svc-2', name: 'Payments API' },
          { id: 'svc-3', name: 'Customer Portal' },
        ],
      }),
    ) as unknown as typeof fetch;
    const { run, poster } = makeHarness({ fetchImpl, withoutPendingRequest: true });

    await expect(
      run.serviceScopeCoordinator.request({
        serviceIds: ['svc-2', 'svc-3'],
        reason: 'The implementation spans three Services.',
      }),
    ).resolves.toMatchObject({ status: 'requested' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/organizations/org-1/services?projectId=proj-1',
      { headers: { Authorization: 'Bearer access-token' } },
    );
    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: expect.objectContaining({
          data: expect.objectContaining({
            response:
              'The coding session needs access to additional project Services: Payments API, Customer Portal. User review is required before repository changes continue.',
          }),
        }),
      }),
    );
  });

  it('does not post a scope request when an additional Service cannot be resolved', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [{ id: 'svc-1', name: 'Already Approved Service' }] }),
    ) as unknown as typeof fetch;
    const { run, poster } = makeHarness({ fetchImpl, withoutPendingRequest: true });

    await expect(
      run.serviceScopeCoordinator.request({
        serviceIds: ['svc-2'],
        reason: 'The implementation spans both Services.',
      }),
    ).rejects.toThrow('Project Service lookup did not return requested Service: svc-2.');

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('publishes STARTING before the saved continuation and does not need provider thinking', async () => {
    const { run, broadcaster, poster, fetchImpl, runStore } = makeHarness();
    const resumeAfterApproval = vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval');

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });
    await run.awaitIdle();

    const states = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map(([observation]) => observation.currentState);
    expect(states).toContain('AWAITING_APPROVAL');
    expect(states.indexOf('STARTING')).toBeGreaterThan(states.indexOf('AWAITING_APPROVAL'));
    expect(states).not.toContain('THINKING');
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/v1/organizations/org-1/projects/proj-1/agent-sessions/run-1/service-grants',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer access-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId: 'machine-1',
          serviceIds: ['svc-2'],
          launchServiceId: 'svc-1',
        }),
      },
    );
    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services: [
        { id: 'svc-1', path: '/tmp' },
        { id: 'svc-2', path: '/tmp' },
      ],
      launchServiceId: 'svc-1',
    });
    expect(run.session.services).toEqual([
      { id: 'svc-1', path: '/tmp' },
      { id: 'svc-2', path: '/tmp' },
    ]);
    expect(resumeAfterApproval).toHaveBeenCalledOnce();
    expect(poster.complete).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'scope-message-1',
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Additional Service access',
          detectedIntent: 'agent_request_service_scope',
        }),
      }),
      null,
    );
  });

  it('clears denial to IDLE without changing Service scope', async () => {
    const { run, broadcaster, runStore } = makeHarness();

    await expect(run.serviceScopeCoordinator.decide(decision('deny'))).resolves.toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });

    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
  });

  it('clears denial to IDLE when idempotency persistence fails after settlement', async () => {
    const { run, broadcaster } = makeHarness({
      idempotencyPersistenceFailure: new Error('idempotency persistence failed'),
    });

    await expect(run.serviceScopeCoordinator.decide(decision('deny'))).rejects.toThrow(
      'idempotency persistence failed',
    );

    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('publishes STARTING and resumes approval when idempotency persistence fails', async () => {
    const { run, broadcaster } = makeHarness({
      idempotencyPersistenceFailure: new Error('idempotency persistence failed'),
    });
    const resumeAfterApproval = vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval');

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).rejects.toThrow(
      'idempotency persistence failed',
    );

    expect(resumeAfterApproval).toHaveBeenCalledOnce();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'STARTING' }),
    );
  });

  it('does not resume when the durable continuation cannot be cleared', async () => {
    const { run } = makeHarness({
      continuationPersistenceFailure: new Error('continuation clear failed'),
    });
    run.setHasProviderSession(true, 'test-compatible-provider-session');

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).rejects.toThrow(
      'continuation clear failed',
    );

    expect(run.serviceScope.hasServiceScopeContinuation()).toBe(true);
  });

  it('settles missing Service resolution to IDLE and leaves scope unchanged', async () => {
    const { run, broadcaster, runStore } = makeHarness({ missingServiceId: 'svc-2' });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'Approved Coding Plan scope has no repository mapping for Service svc-2.',
    });

    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('settles workspace resolution failure to IDLE and leaves scope unchanged', async () => {
    const { run, broadcaster, runStore } = makeHarness({ invalidWorkspace: true });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'Run run-1 scope excludes its service repository root.',
    });

    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('preserves platform error detail and does not roll back a rejected initial update', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { message: ['machineId must be a UUID'], error: 'Bad Request' },
        { status: 400 },
      ),
    ) as unknown as typeof fetch;
    const { run, broadcaster, logger } = makeHarness({ fetchImpl });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason:
        'AgentSession Service grant failed with status 400: {"message":["machineId must be a UUID"],"error":"Bad Request"}',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalledWith(
      'local.service_scope.rollback.failed',
      expect.anything(),
    );
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('keeps the compatible provider session after the complete Service union is committed', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    const { run } = makeHarness({ fetchImpl });
    const discard = vi.spyOn(run, 'discardProviderSessionForScopeChange');

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          machineId: 'machine-1',
          serviceIds: ['svc-2'],
          launchServiceId: 'svc-1',
        }),
      }),
    );
    expect(discard).not.toHaveBeenCalled();
    expect(run.session.services.map((service) => service.id)).toEqual(['svc-1', 'svc-2']);
  });

  it('treats a replay whose Service union is already local as an idempotent grant', async () => {
    const { run, fetchImpl } = makeHarness();
    run.session.services.push({ id: 'svc-2', path: '/tmp' });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.session.services.map((service) => service.id)).toEqual(['svc-1', 'svc-2']);
  });

  it('keeps the approval retryable when local persistence fails after the platform grant', async () => {
    const fetchImpl = vi.fn(
      () => Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;
    const { run } = makeHarness({
      fetchImpl,
      servicePersistenceFailure: new Error('local Run persistence failed'),
    });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'local Run persistence failed',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
    expect(run.serviceScope.hasServiceScopeContinuation()).toBe(true);
    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
  });

  it('settles a missing verified machine binding before calling the platform', async () => {
    const { run, fetchImpl } = makeHarness({ machineId: null });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'Approved Service scope requires a verified machine binding.',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
  });

  it('settles a machine-binding read failure instead of remaining awaiting approval', async () => {
    const { run, broadcaster, fetchImpl } = makeHarness({
      machineIdReadFailure: new Error('keychain is unavailable'),
    });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'keychain is unavailable',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('settles a missing saved continuation before changing Service scope', async () => {
    const { run, broadcaster, runStore } = makeHarness({ missingContinuation: true });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'Approved Service scope continuation is unavailable.',
    });

    expect(runStore.updateRunServices).not.toHaveBeenCalled();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });
});
