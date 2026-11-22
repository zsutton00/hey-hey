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
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { AgentSessionServiceScopeRequest } from '@hey-hey/contracts/api/models';
import type { AgenticSession } from '../../session/types';
import { toRepositoryPath, toServiceId } from '../../repo';
import { TaskMonitorServiceScopeAdmission } from '../../server/task-monitor-service-scope-admission';
import type { TaskMonitorStateMachineInputAdapter } from '../../server/state-machine-input-adapter';
import type { TaskMonitorStateStore } from '../task-monitor/state-machine/machine';
import { NOOP_LOGGER } from '../../server/logger';
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
  serviceless?: boolean;
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
    ...(input?.serviceless
      ? { services: [], launchServiceId: null }
      : { services: [{ id: 'svc-1', path: '/tmp' }], launchServiceId: 'svc-1' }),
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
    ...(input?.missingContinuation ? {} : { serviceScopeContinuationInput: continuation }),
    ...(input?.invalidWorkspace
      ? { scope: { mode: LOCAL_RUN_MODE.default, allowedRepositoryRoots: ['/elsewhere'] } }
      : {}),
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    events: [],
  }) as unknown as AgenticSession;

const makeHarness = (input?: {
  serviceless?: boolean;
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
  taskMonitorServiceScopeAdmission?: () => TaskMonitorServiceScopeAdmission | null;
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
  vi.spyOn(runStore, 'updateRunServicePlaceChoices').mockResolvedValue(makeSession(input));
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
      ...(input?.taskMonitorServiceScopeAdmission
        ? { taskMonitorServiceScopeAdmission: input.taskMonitorServiceScopeAdmission }
        : {}),
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
  const scopeFetch = () =>
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 200 });
      return Response.json({
        data: [
          { id: 'svc-1', name: 'CLI' },
          { id: 'svc-2', name: 'API' },
        ],
      });
    }) as unknown as typeof fetch;
  const monitoredHarness = (admission: Pick<TaskMonitorServiceScopeAdmission, 'admit'>) =>
    makeHarness({
      fetchImpl: scopeFetch(),
      taskMonitorId: 'task-monitor-1',
      withoutPendingRequest: true,
      taskMonitorServiceScopeAdmission: () => admission as TaskMonitorServiceScopeAdmission,
    });
  const requestApi = (run: Run) =>
    run.serviceScopeCoordinator.request({
      serviceIds: ['svc-2'],
      reason: 'The implementation also requires the API Service.',
    });
  const observedStates = (broadcaster: ReturnType<typeof makeHarness>['broadcaster']) =>
    vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map(([observation]) => observation.currentState);

  it('sends a monitored Run request to the Task Monitor and waits for its decision, not a person', async () => {
    const admit = vi.fn(async () => ({ status: 'admitted' as const }));
    const { run, broadcaster } = monitoredHarness({ admit });

    const result = await requestApi(run);

    expect(result).toMatchObject({ status: 'requested' });
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskMonitorId: 'task-monitor-1',
        runId: 'run-1',
        additionalServiceNames: ['API'],
        request: expect.objectContaining({
          requestedServiceIds: ['svc-1', 'svc-2'],
          reason: 'The implementation also requires the API Service.',
        }),
      }),
    );
    expect(observedStates(broadcaster)).not.toContain('AWAITING_APPROVAL');
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
  });

  it('grants the Services when the Task Monitor approves, through the request owner', async () => {
    const { run, broadcaster } = monitoredHarness({
      admit: vi.fn(async () => ({ status: 'admitted' as const })),
    });
    vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval').mockResolvedValue(undefined);
    const result = await requestApi(run);
    if (result.status !== 'requested') throw new Error('Expected a requested outcome.');

    await expect(
      run.serviceScopeCoordinator.decideByMonitor({
        requestId: result.request.id,
        decision: 'approve',
        reason: null,
      }),
    ).resolves.toEqual({ outcome: 'delivered', callbackType: 'service_scope_decision' });

    expect(observedStates(broadcaster)).toContain('STARTING');
    expect(observedStates(broadcaster)).not.toContain('AWAITING_APPROVAL');
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(run.session.services).toEqual([
      { id: 'svc-1', path: '/tmp' },
      { id: 'svc-2', path: '/tmp' },
    ]);
  });

  it('denies without granting when the Task Monitor denies', async () => {
    const { run } = monitoredHarness({
      admit: vi.fn(async () => ({ status: 'admitted' as const })),
    });
    const result = await requestApi(run);
    if (result.status !== 'requested') throw new Error('Expected a requested outcome.');

    await run.serviceScopeCoordinator.decideByMonitor({
      requestId: result.request.id,
      decision: 'deny',
      reason: 'Denied by Task Monitor: not needed.',
    });

    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);
  });

  it('hands the request to a person when the Task Monitor escalates, and the person can still decide it', async () => {
    const { run, broadcaster } = monitoredHarness({
      admit: vi.fn(async () => ({ status: 'admitted' as const })),
    });
    vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval').mockResolvedValue(undefined);
    const result = await requestApi(run);
    if (result.status !== 'requested') throw new Error('Expected a requested outcome.');

    run.serviceScopeCoordinator.handToHuman(result.request.id, 'Needs a person to judge.');

    expect(observedStates(broadcaster)).toContain('AWAITING_APPROVAL');
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
    await expect(
      run.serviceScopeCoordinator.decide({
        requestId: result.request.id,
        sessionId: result.request.sessionId,
        agentType: result.request.agentType,
        decision: 'approve',
        reason: null,
        idempotencyToken: result.request.idempotencyToken,
      }),
    ).resolves.toMatchObject({ outcome: 'delivered' });
  });

  it.each([
    ['is not running', () => null, 'local.service_scope.request.handed_to_human'],
    [
      'rejects the request',
      () => ({
        admit: vi.fn(async () => ({
          status: 'rejected' as const,
          code: 'transition_rejected',
          reason: 'Task Monitor is not accepting requests.',
        })),
      }),
      'local.service_scope.request.task_monitor_rejected',
    ],
    [
      'cannot be reached',
      () => ({
        admit: vi.fn(async () => {
          throw new Error('adapter down');
        }),
      }),
      'local.service_scope.request.task_monitor_admission_failed',
    ],
  ])(
    'waits for a person and logs the cause when the Task Monitor %s',
    async (_name, make, logEvent) => {
      const admission = make() as TaskMonitorServiceScopeAdmission | null;
      const { run, broadcaster, logger } = makeHarness({
        fetchImpl: scopeFetch(),
        taskMonitorId: 'task-monitor-1',
        withoutPendingRequest: true,
        taskMonitorServiceScopeAdmission: () => admission,
      });

      await requestApi(run);

      expect(observedStates(broadcaster)).toContain('AWAITING_APPROVAL');
      expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
      expect(
        [
          ...vi.mocked(logger.info).mock.calls,
          ...vi.mocked(logger.warn).mock.calls,
          ...vi.mocked(logger.error).mock.calls,
        ].some(([event]) => event === logEvent),
      ).toBe(true);
    },
  );

  describe('who may answer a request', () => {
    const monitoredRequest = async (input?: { servicePersistenceFailure?: Error }) => {
      const fetchImpl = scopeFetch();
      const harness = makeHarness({
        fetchImpl,
        taskMonitorId: 'task-monitor-1',
        withoutPendingRequest: true,
        taskMonitorServiceScopeAdmission: () =>
          ({
            admit: vi.fn(async () => ({ status: 'admitted' as const })),
          }) as unknown as TaskMonitorServiceScopeAdmission,
        ...(input?.servicePersistenceFailure
          ? { servicePersistenceFailure: input.servicePersistenceFailure }
          : {}),
      });
      const resume = vi
        .spyOn(harness.run.serviceScope, 'resumeAfterServiceScopeApproval')
        .mockResolvedValue(undefined);
      const result = await requestApi(harness.run);
      if (result.status !== 'requested') throw new Error('Expected a requested outcome.');
      const { request: created } = result;
      const personAnswer = (value: 'approve' | 'deny') => ({
        requestId: created.id,
        sessionId: created.sessionId,
        agentType: created.agentType,
        decision: value,
        reason: null,
        idempotencyToken: created.idempotencyToken,
      });
      const monitorAnswer = (value: 'approve' | 'deny') => ({
        requestId: created.id,
        decision: value,
        reason: null,
      });

      return { ...harness, fetchImpl, resume, created, personAnswer, monitorAnswer };
    };
    const grantCalls = (fetchImpl: typeof fetch) =>
      vi.mocked(fetchImpl).mock.calls.filter(([, init]) => init?.method === 'POST');

    it('does not let a person settle a request the Task Monitor still owns', async () => {
      const { run, personAnswer, monitorAnswer } = await monitoredRequest();

      await expect(run.serviceScopeCoordinator.decide(personAnswer('approve'))).resolves.toEqual({
        outcome: 'dropped',
        reason: 'service_scope_request_owned_by_monitor',
      });
      expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
      expect(run.session.services).toEqual([{ id: 'svc-1', path: '/tmp' }]);

      await expect(
        run.serviceScopeCoordinator.decideByMonitor(monitorAnswer('deny')),
      ).resolves.toMatchObject({ outcome: 'delivered' });
    });

    it('does not report an opposite Task Monitor answer as delivered once the person settled the request', async () => {
      const { run, created, personAnswer, monitorAnswer } = await monitoredRequest();
      run.serviceScopeCoordinator.handToHuman(created.id, 'Needs a person to judge.');

      await expect(run.serviceScopeCoordinator.decide(personAnswer('approve'))).resolves.toEqual({
        outcome: 'delivered',
        callbackType: 'service_scope_decision',
      });
      await expect(
        run.serviceScopeCoordinator.decideByMonitor(monitorAnswer('deny')),
      ).resolves.toEqual({ outcome: 'dropped', reason: 'service_scope_request_already_decided' });
      expect(run.session.services.map((service) => service.id)).toEqual(['svc-1', 'svc-2']);
    });

    it('settles opposite answers that arrive together once, in arrival order', async () => {
      const { run, created, personAnswer, monitorAnswer, resume } = await monitoredRequest();
      run.serviceScopeCoordinator.handToHuman(created.id, 'Needs a person to judge.');

      const [person, monitor] = await Promise.all([
        run.serviceScopeCoordinator.decide(personAnswer('approve')),
        run.serviceScopeCoordinator.decideByMonitor(monitorAnswer('deny')),
      ]);

      expect(person).toMatchObject({ outcome: 'delivered' });
      expect(monitor).toMatchObject({ outcome: 'dropped' });
      expect(resume).toHaveBeenCalledOnce();
      expect(run.session.services.map((service) => service.id)).toEqual(['svc-1', 'svc-2']);
    });

    it('hands a monitored approval that only partly applied to the person, who retries without granting twice', async () => {
      const { run, runStore, fetchImpl, created, personAnswer, monitorAnswer, resume } =
        await monitoredRequest({
          servicePersistenceFailure: new Error('local persistence failed'),
        });

      await expect(
        run.serviceScopeCoordinator.decideByMonitor(monitorAnswer('approve')),
      ).resolves.toEqual({ outcome: 'failed', reason: 'local persistence failed' });

      expect(run.serviceScope.serviceScopeDecisionOwner(created.id)).toBe('person');
      expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
      expect(resume).not.toHaveBeenCalled();

      vi.mocked(runStore.updateRunServices).mockResolvedValue(makeSession());
      await expect(run.serviceScopeCoordinator.decide(personAnswer('approve'))).resolves.toEqual({
        outcome: 'delivered',
        callbackType: 'service_scope_decision',
      });

      expect(grantCalls(fetchImpl)).toHaveLength(1);
      expect(resume).toHaveBeenCalledOnce();
      expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    });

    describe('after a restart', () => {
      /** The Task Monitor machine's durable record of this request, as a restarted process reads it. */
      const machineRecord = (owner: 'MONITOR' | 'HUMAN' | 'GONE') => {
        const held = {
          interventionId: 'intervention-scope-1',
          providerActionId: request.id,
          providerSessionId: request.sessionId,
          runId: 'run-1',
          agentSessionId: 'run-1',
          action: 'Give the coding session access to additional project Services',
          target: 'Services: API',
          fingerprint: 'service-scope:fingerprint',
          createdAt: request.timestamp,
          expiresAt: null,
          userRequired: false,
          requestKind: 'SERVICE_SCOPE' as const,
          owner: 'MONITOR' as const,
          escalationReason: null,
          escalatedAt: null,
          decision: null,
          applicationFailure: null,
        };
        // An escalated Service scope request is dropped from the machine; the Run's card holds it.
        const pendingIntervention = owner === 'MONITOR' ? held : null;
        const stateStore = {
          findByInstanceId: vi.fn(async () => ({
            snapshot: { context: { pendingIntervention, queuedInterventions: [] } },
          })),
        } as unknown as TaskMonitorStateStore;

        return new TaskMonitorServiceScopeAdmission(
          {} as unknown as TaskMonitorStateMachineInputAdapter,
          stateStore,
          NOOP_LOGGER,
        );
      };
      const restoredRun = (admission: TaskMonitorServiceScopeAdmission | null) => {
        const fetchImpl = scopeFetch();
        const harness = makeHarness({
          fetchImpl,
          taskMonitorId: 'task-monitor-1',
          taskMonitorServiceScopeAdmission: () => admission,
        });
        vi.spyOn(harness.run.serviceScope, 'resumeAfterServiceScopeApproval').mockResolvedValue(
          undefined,
        );
        return { ...harness, fetchImpl };
      };
      const personAnswer = { ...decision('approve'), reason: null };
      const monitorAnswer = { requestId: request.id, decision: 'approve' as const, reason: null };

      it('keeps a request the monitor still holds with the monitor, so only it can settle it', async () => {
        const { run, fetchImpl } = restoredRun(machineRecord('MONITOR'));

        await expect(run.serviceScopeCoordinator.decide(personAnswer)).resolves.toEqual({
          outcome: 'dropped',
          reason: 'service_scope_request_owned_by_monitor',
        });
        expect(grantCalls(fetchImpl)).toHaveLength(0);

        await expect(
          run.serviceScopeCoordinator.decideByMonitor(monitorAnswer),
        ).resolves.toMatchObject({ outcome: 'delivered' });
        expect(grantCalls(fetchImpl)).toHaveLength(1);
        expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
      });

      it('gives a request already handed to the person only to the person', async () => {
        const { run, fetchImpl } = restoredRun(machineRecord('GONE'));

        await expect(run.serviceScopeCoordinator.decideByMonitor(monitorAnswer)).resolves.toEqual({
          outcome: 'dropped',
          reason: 'service_scope_request_owned_by_person',
        });
        expect(grantCalls(fetchImpl)).toHaveLength(0);

        await expect(run.serviceScopeCoordinator.decide(personAnswer)).resolves.toMatchObject({
          outcome: 'delivered',
        });
        expect(grantCalls(fetchImpl)).toHaveLength(1);
      });
    });
  });

  it('keeps a Run without a Task Monitor awaiting human approval', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [{ id: 'svc-2', name: 'API' }] }),
    ) as unknown as typeof fetch;
    const { run, broadcaster } = makeHarness({ fetchImpl, withoutPendingRequest: true });

    await requestApi(run);

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
              'This conversation needs access to project Services: Payments API, Customer Portal. User review is required before repository changes continue.',
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

  it('promotes the first approved Service when the session has no launch Service', async () => {
    const { run, fetchImpl, runStore } = makeHarness({ serviceless: true });
    vi.spyOn(run.serviceScope, 'resumeAfterServiceScopeApproval').mockResolvedValue(undefined);

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'delivered',
      callbackType: 'service_scope_decision',
    });

    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://api.example.test/api/v1/organizations/org-1/projects/proj-1/agent-sessions/run-1/service-grants',
      expect.objectContaining({
        body: JSON.stringify({
          machineId: 'machine-1',
          serviceIds: ['svc-1', 'svc-2'],
          launchServiceId: 'svc-1',
        }),
      }),
    );
    expect(runStore.updateRunServices).toHaveBeenCalledWith('run-1', {
      services: [
        { id: 'svc-1', path: '/tmp' },
        { id: 'svc-2', path: '/tmp' },
      ],
      launchServiceId: 'svc-1',
    });
  });

  it('leaves a session with no launch Service unchanged on denial', async () => {
    const { run, fetchImpl, runStore } = makeHarness({ serviceless: true });

    await run.serviceScopeCoordinator.decide(decision('deny'));

    expect(run.session.services).toEqual([]);
    expect(run.session.launchServiceId).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runStore.updateRunServices).not.toHaveBeenCalled();
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
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
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

  it('refuses a denial once the platform has granted access, leaving the card to finish applying it', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;
    const { run } = makeHarness({
      fetchImpl,
      servicePersistenceFailure: new Error('local Run persistence failed'),
    });
    await run.serviceScopeCoordinator.decide(decision('approve'));

    const denied = await run.serviceScopeCoordinator.decide(decision('deny'));

    expect(denied).toMatchObject({ outcome: 'failed' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(true);
    expect(run.serviceScope.hasServiceScopeContinuation()).toBe(true);
  });

  it('settles a missing verified machine binding before calling the platform', async () => {
    const { run, fetchImpl, poster } = makeHarness({ machineId: null });

    await expect(run.serviceScopeCoordinator.decide(decision('approve'))).resolves.toEqual({
      outcome: 'failed',
      reason: 'Approved Service scope requires a verified machine binding.',
    });

    // The browser only sees the settled message, so the reason must ride on it.
    const settledPayloads = JSON.stringify(vi.mocked(poster.complete).mock.calls);
    expect(settledPayloads).toContain(
      '"failureReason":"Approved Service scope requires a verified machine binding."',
    );

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
