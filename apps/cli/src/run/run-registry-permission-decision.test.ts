import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputAdmissionOwner } from '../server/input-admission/input-admission-owner';
import { InputAdmissionLifecycle } from '../server/input-admission/admission-lifecycle';
import type { RunFollowUpAdmission } from '../server/input-admission/input-admission-payload';
import { NOOP_LOGGER } from '../server/logger';
import type {
  LocalRunPromptRequest,
  SendMessageOptions,
} from '../shared/agent-bridge-contract/contract';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';
import { RunRegistry } from './run-registry';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type { RepoMappingStore } from '../repo/index';
import type {
  AgentSessionRunner,
  PermissionDecisionDispatchArgs,
} from '../agents/providers/session-runner';
import type { PermissionDecisionRoutingInput } from '../agents/permission-response-routing';
import type { RunEventPublisher } from '../server/run-event-publisher';
import type { SystemMessageData } from '../shared/api/index';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';

const makeSession = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude' as const,
    provider_session_id: 'sess-1',
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1', agentSessionId: 'run-1' },
    events: [],
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('note-msg-1'),
  });

const makeCollaborators = (
  broadcaster: RunEventPublisher = makeBroadcaster(),
): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster,
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
  logger: {
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeRegistry = (collaborators: RunCollaborators): RunRegistry =>
  new RunRegistry({
    runCollaborators: collaborators,
    submissionToolRegistry: collaborators.submissionToolRegistry,
    sessionRunnerFacade: createTestSessionRunnerFacade(),
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });

const routingInput = (
  overrides?: Partial<PermissionDecisionRoutingInput>,
): PermissionDecisionRoutingInput => ({
  runId: 'run-1',
  sessionId: 'sess-1',
  requestId: 'req-1',
  agentType: 'claude',
  decision: 'approve',
  reason: null,
  idempotencyToken: 'idem-1',
  deciderUserId: 'user-1',
  ...overrides,
});

describe('RunRegistry.classifyPermissionDecisionOwner', () => {
  it('classifies a pending Service-scope request before Task Monitor ownership', async () => {
    const registry = makeRegistry(makeCollaborators());
    const run = registry.create(makeRunArgs());
    vi.spyOn(run.serviceScope, 'getServiceScopeRequest').mockReturnValue({} as never);

    await expect(
      registry.classifyPermissionDecisionOwner('run-1', 'req-1', 'idem-1', 'task-monitor-1'),
    ).resolves.toEqual({ kind: 'service_scope' });
  });

  it('classifies a pending Review file-scope request before Task Monitor ownership', async () => {
    const registry = makeRegistry(makeCollaborators());
    const run = registry.create(makeRunArgs());
    vi.spyOn(run, 'hasReviewFileScopeRequestRecord').mockReturnValue(true);

    await expect(
      registry.classifyPermissionDecisionOwner('run-1', 'req-1', 'idem-1', 'task-monitor-1'),
    ).resolves.toEqual({ kind: 'review_file_scope' });
  });

  it.each(['service', 'review'] as const)(
    'keeps a settled %s scope request out of provider and Task Monitor handling',
    async (scope) => {
      const collaborators = makeCollaborators();
      const registry = makeRegistry(collaborators);
      const run = registry.create(makeRunArgs());
      if (scope === 'service') {
        vi.spyOn(run.serviceScope, 'isServiceScopeRequestSettled').mockReturnValue(true);
      } else {
        vi.spyOn(run, 'isReviewFileScopeRequestSettled').mockReturnValue(true);
      }

      await expect(
        registry.classifyPermissionDecisionOwner('run-1', 'req-1', 'idem-1', 'task-monitor-1'),
      ).resolves.toEqual({ kind: 'settled_specialized_request' });
    },
  );

  it('keeps a durably settled specialized request out of Task Monitor handling after restore', async () => {
    const collaborators = makeCollaborators();
    vi.spyOn(collaborators.runStore, 'hasIdempotencyToken').mockResolvedValue(true);
    const registry = makeRegistry(collaborators);
    registry.create(makeRunArgs());

    await expect(
      registry.classifyPermissionDecisionOwner('run-1', 'req-1', 'idem-1', 'task-monitor-1'),
    ).resolves.toEqual({ kind: 'settled_specialized_request' });
  });

  it('classifies an otherwise generic Task Monitor permission as an intervention', async () => {
    const collaborators = makeCollaborators();
    vi.spyOn(collaborators.runStore, 'hasIdempotencyToken').mockResolvedValue(false);
    const registry = makeRegistry(collaborators);
    registry.create(makeRunArgs());

    await expect(
      registry.classifyPermissionDecisionOwner('run-1', 'req-1', 'idem-1', 'task-monitor-1'),
    ).resolves.toEqual({
      kind: 'task_monitor_intervention',
      taskMonitorId: 'task-monitor-1',
    });
  });
});

describe('RunRegistry.submitPermissionDecision', () => {
  const permissionMessageData = { type: 'QUESTIONS' } as SystemMessageData;

  it('routes a signed Review file-scope decision before provider permission dispatch', async () => {
    const collaborators = makeCollaborators();
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    vi.spyOn(run, 'hasReviewFileScopeRequestRecord').mockReturnValue(true);
    const submit = vi.spyOn(run, 'submitReviewFileScopeDecision').mockResolvedValue({
      outcome: 'dropped',
      reason: 'legacy_review_file_scope_reconciled',
    });

    await expect(registry.submitPermissionDecision('run-1', routingInput())).resolves.toEqual({
      outcome: 'dropped',
      reason: 'legacy_review_file_scope_reconciled',
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'approve',
        idempotencyToken: 'idem-1',
      }),
    );
  });

  it('recovers a persisted permission presentation when the provider runner is gone', async () => {
    const operationEvents: string[] = [];
    const broadcaster = makeBroadcaster({
      emitAgentSessionCurrentStateObservation: ({ currentState }) =>
        operationEvents.push(`state:${currentState}`),
    });
    const collaborators = makeCollaborators(broadcaster);
    const poster = makePoster();
    collaborators.poster = poster;
    vi.mocked(poster.complete).mockImplementation(async () => {
      operationEvents.push('complete');
    });
    vi.mocked(poster.createOutOfBand).mockImplementation(async () => {
      operationEvents.push('notice');
      return 'notice-message-1';
    });
    vi.mocked(collaborators.runFollowUpAdmission.admit).mockImplementation(async () => {
      operationEvents.push('retry_admitted');
      return { replayed: false };
    });
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    run.recordPermissionRequestMessage('req-1', 'permission-msg-1', permissionMessageData);
    run.observeProviderPhase('awaiting_approval');

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'dropped', reason: 'stale_permission_recovered' });
    expect(poster.complete).toHaveBeenCalledOnce();
    expect(poster.complete).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'permission-msg-1',
      { status: 'completed' },
      null,
    );
    expect(operationEvents).toEqual([
      'state:AWAITING_APPROVAL',
      'state:IDLE',
      'complete',
      'retry_admitted',
      'notice',
    ]);
    expect(collaborators.runFollowUpAdmission.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        stableKey: 'permission-recovery:req-1',
        runId: 'run-1',
        agentSessionId: 'run-1',
        userId: 'user-1',
        payload: expect.objectContaining({
          kind: 'run_follow_up',
          agentInput: expect.objectContaining({ promptType: 'coding_freeform' }),
        }),
      }),
    );
    const notice = vi.mocked(poster.createOutOfBand).mock.calls[0]![0];
    expect(notice.dto).toMatchObject({
      type: 'SYSTEM',
      data: { type: 'AGENT', response: expect.stringContaining('ask again') },
    });
  });

  it('does not admit a second retry when the same stale decision is delivered twice', async () => {
    const collaborators = makeCollaborators();
    const poster = makePoster();
    collaborators.poster = poster;
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    run.recordPermissionRequestMessage('req-1', 'permission-msg-1', permissionMessageData);

    const first = await registry.submitPermissionDecision('run-1', routingInput());
    const second = await registry.submitPermissionDecision('run-1', routingInput());

    expect(first).toEqual({ outcome: 'dropped', reason: 'stale_permission_recovered' });
    expect(second).toEqual({ outcome: 'dropped', reason: 'stale_permission_already_settled' });
    expect(poster.complete).toHaveBeenCalledOnce();
    expect(collaborators.runFollowUpAdmission.admit).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
  });

  it('clears the stale phase when recovering a presentation rehydrated after restart', async () => {
    const broadcaster = makeBroadcaster();
    const collaborators = makeCollaborators(broadcaster);
    const poster = makePoster();
    collaborators.poster = poster;
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const registry = makeRegistry(collaborators);
    const run = registry.create(
      makeRunArgs({
        session: {
          ...makeSession(),
          permissionRequestPresentations: [{ requestId: 'req-1', messageId: 'permission-msg-1' }],
        },
      }),
    );

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'dropped', reason: 'stale_permission_recovered' });
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'IDLE' }),
    );
  });

  it('removes the durable presentation when the decision-recorded event wins the race', async () => {
    const collaborators = makeCollaborators();
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    run.recordPermissionRequestMessage('req-1', 'permission-msg-1', permissionMessageData);

    run.forgetPermissionRequestMessage('req-1');

    expect(run.session.permissionRequestPresentations).toEqual([]);
    expect(collaborators.runStore.updateRunPermissionRequestPresentations).toHaveBeenLastCalledWith(
      'run-1',
      [],
    );
  });

  it('translates a provider stale result into Run-owned recovery without invoking a callback', async () => {
    const collaborators = makeCollaborators();
    const poster = makePoster();
    collaborators.poster = poster;
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    run.recordPermissionRequestMessage('req-1', 'permission-msg-1', permissionMessageData);
    const submit = vi.fn().mockResolvedValue({
      delivered: false,
      outcome: 'stale',
      reason: 'request_not_found',
    });
    run.setRunner({
      run: async () => {},
      submitPermissionDecision: submit,
    } as unknown as AgentSessionRunner);

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'dropped', reason: 'stale_permission_recovered' });
    // The old provider waiter is asked exactly once and never resolved again by recovery.
    expect(submit).toHaveBeenCalledOnce();
    expect(collaborators.runFollowUpAdmission.admit).toHaveBeenCalledOnce();
  });

  it('delivers the translated dispatch to the bound runner and reports the callback type', async () => {
    const registry = makeRegistry(makeCollaborators());
    const run = registry.create(makeRunArgs());
    const submit = vi.fn(async (_args: PermissionDecisionDispatchArgs) => ({
      delivered: true as const,
      callbackType: 'claude_control_response' as const,
    }));
    run.setRunner({
      run: async () => {},
      submitPermissionDecision: submit,
    } as unknown as AgentSessionRunner);

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'delivered', callbackType: 'claude_control_response' });
    expect(submit).toHaveBeenCalledTimes(1);
    const args = submit.mock.calls[0]![0];
    expect(args.session).toBe(run.session);
    expect(args.dispatch.agentType).toBe('claude');
    expect(args.dispatch.callbackPayload).toMatchObject({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req-1' },
    });
  });

  it('emits thinking after a delivered permission decision while awaiting approval', async () => {
    const broadcaster = makeBroadcaster();
    const registry = makeRegistry(makeCollaborators(broadcaster));
    const run = registry.create(makeRunArgs());
    const submit = vi.fn(async (_args: PermissionDecisionDispatchArgs) => ({
      delivered: true as const,
      callbackType: 'claude_control_response' as const,
    }));
    run.setRunner({
      run: async () => {},
      submitPermissionDecision: submit,
    } as unknown as AgentSessionRunner);
    run.onAgentOutput({
      event: {
        source: 'local',
        eventType: 'processing_status',
        timestamp: '2026-07-01T00:00:00.000Z',
        sessionId: null,
        agentId: 'test-runner',
        payload: {
          kind: 'loading.update',
          loadingText: 'Waiting for permission...',
          phase: 'awaiting_approval',
        },
      },
    });
    await run.drainInFlightDispatch(100);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'AWAITING_APPROVAL' }),
    );
    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mockClear();

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'delivered', callbackType: 'claude_control_response' });
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledOnce();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'THINKING' }),
    );
  });

  it('does not emit thinking after delivery when the Run is not awaiting approval', async () => {
    const broadcaster = makeBroadcaster();
    const registry = makeRegistry(makeCollaborators(broadcaster));
    const run = registry.create(makeRunArgs());
    const submit = vi.fn(async (_args: PermissionDecisionDispatchArgs) => ({
      delivered: true as const,
      callbackType: 'claude_control_response' as const,
    }));
    run.setRunner({
      run: async () => {},
      submitPermissionDecision: submit,
    } as unknown as AgentSessionRunner);

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'delivered', callbackType: 'claude_control_response' });
    expect(broadcaster.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalled();
  });

  it('drops with no_run_registered when no Run is registered for the runId', async () => {
    const registry = makeRegistry(makeCollaborators());

    const result = await registry.submitPermissionDecision(
      'absent',
      routingInput({ runId: 'absent' }),
    );

    expect(result).toEqual({ outcome: 'dropped', reason: 'no_run_registered' });
  });

  it('drops with no_runner_bound when the Run has no runner bound yet', async () => {
    const registry = makeRegistry(makeCollaborators());
    registry.create(makeRunArgs());

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'dropped', reason: 'no_runner_bound' });
  });

  it('reports failed with the error message when the runner throws', async () => {
    const registry = makeRegistry(makeCollaborators());
    const run = registry.create(makeRunArgs());
    run.setRunner({
      run: async () => {},
      submitPermissionDecision: async () => {
        throw new Error('runner exploded');
      },
    } as unknown as AgentSessionRunner);

    const result = await registry.submitPermissionDecision('run-1', routingInput());

    expect(result).toEqual({ outcome: 'failed', reason: 'runner exploded' });
  });
});

/**
 * Restart path end to end through the durable input queue. A message the CLI posts itself
 * (`createOutOfBand`, `stamp: null`) never returns as a signed `user_message` trigger — that
 * trigger requires a platform-issued source message identity — so recovery must admit the retry
 * locally rather than post a USER message and wait for an echo.
 */
describe('stale permission recovery after CLI restart', () => {
  const ids = {
    runId: randomUUID(),
    organizationId: randomUUID(),
    projectId: randomUUID(),
    machineId: randomUUID(),
    userId: randomUUID(),
  };

  const setup = async (directory: string) => {
    const collaborators = makeCollaborators();
    vi.spyOn(collaborators.runStore, 'updateRunPermissionRequestPresentations').mockResolvedValue(
      {} as AgenticSession,
    );
    const turnInputs: string[] = [];
    let registry: RunRegistry | null = null;
    const sent: LocalRunPromptRequest[] = [];
    const lifecycleFor = (owner: InputAdmissionOwner) =>
      new InputAdmissionLifecycle(
        owner,
        {
          sendSystemMessage: async (
            runId: string,
            request: LocalRunPromptRequest,
            options: SendMessageOptions,
          ) => {
            // The queue hands one admitted input to the Run as one fresh Turn.
            sent.push(request);
            const turn = options.admittedInput!;
            await turn.onStarted();
            turnInputs.push(turn.turnId);
            // The action still needs approval, so the fresh Turn raises a new request.
            registry!.get(runId)!.recordPermissionRequestMessage('req-2', 'permission-msg-2', {
              type: 'QUESTIONS',
            } as SystemMessageData);
            await turn.onSettled({
              turnId: turn.turnId,
              terminalOutcome: 'COMPLETED',
              completedAssistantMessageId: null,
              reports: [],
            });
          },
        } as never,
        { canAcceptDurableInput: () => true, get: () => null } as never,
        {
          loadCurrentMachineId: async () => ids.machineId,
          loadMachineCredential: async () => 'credential',
        } as never,
        'http://localhost',
        NOOP_LOGGER,
        () => true,
        {} as never,
      );
    const paths = {
      directory: join(directory, 'inputs'),
      legacyStoreFile: join(directory, 'inputs.json'),
    };
    let lifecycle = lifecycleFor(new InputAdmissionOwner(paths, NOOP_LOGGER));
    collaborators.runFollowUpAdmission = {
      admit: (input) => lifecycle.admit(input),
      durableInputReady: (runId) => lifecycle.durableInputReady(runId),
    } satisfies RunFollowUpAdmission;
    registry = makeRegistry(collaborators);
    // Rehydrated after restart: a persisted presentation, no provider runner bound.
    const run = registry.create(
      makeRunArgs({
        runId: ids.runId,
        organizationId: ids.organizationId,
        projectId: ids.projectId,
        session: {
          ...makeSession(),
          agentic_session_id: ids.runId,
          contextMetadata: {
            organizationId: ids.organizationId,
            projectId: ids.projectId,
            agentSessionId: ids.runId,
          },
          permissionRequestPresentations: [{ requestId: 'req-1', messageId: 'permission-msg-1' }],
        } as AgenticSession,
      }),
    );
    return {
      collaborators,
      registry,
      run,
      turnInputs,
      sent,
      restartAdmission: () => {
        lifecycle = lifecycleFor(new InputAdmissionOwner(paths, NOOP_LOGGER));
        return lifecycle;
      },
    };
  };

  it('starts exactly one fresh Turn per approval click, across a repeated click and a restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'permission-recovery-'));
    try {
      const f = await setup(directory);
      const click = () =>
        f.registry.submitPermissionDecision(
          ids.runId,
          routingInput({ runId: ids.runId, deciderUserId: ids.userId }),
        );

      expect(await click()).toEqual({ outcome: 'dropped', reason: 'stale_permission_recovered' });
      await vi.waitFor(() => expect(f.turnInputs).toHaveLength(1));

      expect(f.sent).toHaveLength(1);
      expect(f.sent[0]).toMatchObject({
        promptType: 'coding_freeform',
        payload: { userMessage: expect.stringContaining('retry the blocked action') },
      });
      expect(f.run.session.permissionRequestPresentations).toEqual([
        expect.objectContaining({ requestId: 'req-2' }),
      ]);
      const posted = vi
        .mocked(f.collaborators.poster.createOutOfBand)
        .mock.calls.map(([call]) => call.dto.type);
      expect(posted).not.toContain('USER');

      expect(await click()).toEqual({
        outcome: 'dropped',
        reason: 'stale_permission_already_settled',
      });
      const restarted = f.restartAdmission();
      await expect(
        restarted.admit({
          stableKey: 'permission-recovery:req-1',
          agentSessionId: ids.runId,
          runId: ids.runId,
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          userId: ids.userId,
          payload: {
            kind: 'run_follow_up',
            origin: 'permission_recovery',
            requestId: 'req-1',
            agentInput: {
              promptType: 'coding_freeform',
              userMessage:
                'Please retry the blocked action now. If permission is still required, request it again.',
            },
          },
        }),
      ).resolves.toEqual({ replayed: true });
      await restarted.advance(ids.runId);
      expect(f.turnInputs).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
