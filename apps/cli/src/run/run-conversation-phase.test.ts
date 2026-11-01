import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { AgentStartupPromptInputError } from '../commands/agent-startup-prompt-input';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import { Turn, type Runner } from '../turn/turn';
import type { RunEventPublisher } from '../server/run-event-publisher';
import { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import type { AgentSessionServiceScopeRequest } from '../shared/api/generated/api';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'run-1',
    },
    events: [],
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  skipProjectAssistant: true,
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'getTouchedFiles').mockResolvedValue([]);
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunProviderIdentity').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunProjectAssistantDone').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  return store;
};

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeCollaborators = (
  pickRunner: (ctx: RunnerContext) => Runner,
  broadcaster: RunEventPublisher = makeBroadcaster(),
  poster = makePoster(),
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster,
  broadcaster,
  ...createTestRunOwnership(),
  handlerDeps: {
    auth: { getAccessToken: vi.fn(async () => 'access-token') },
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: vi.fn(async () =>
      Response.json({ data: [{ id: 'svc-2', name: 'Additional Service' }] }),
    ),
  } as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: makeLogger(),
});

const makeInput = (
  promptType: LocalPromptType = LocalPromptType.CodingFreeform,
): InternalRunPromptRequest => ({
  promptType,
  payload: { promptType, userMessage: 'do work' } as NonNullable<
    InternalRunPromptRequest['payload']
  >,
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

const emitStarting = (ctx: RunnerContext): void => {
  ctx.run.onAgentOutput({
    event: {
      source: 'local',
      eventType: 'processing_status',
      timestamp: '2026-07-01T00:00:00.000Z',
      sessionId: null,
      agentId: 'test-runner',
      payload: { kind: 'loading.update', loadingText: 'Starting...', phase: 'starting' },
    },
  });
};

const makeServiceScopeRequest = (id = 'scope-request-1'): AgentSessionServiceScopeRequest => ({
  id,
  runId: 'run-1',
  sessionId: 'run-1',
  agentId: 'coding_freeform',
  agentType: 'claude',
  timestamp: '2026-07-01T00:00:00.000Z',
  idempotencyToken: `token-${id}`,
  currentServiceIds: ['svc-1'],
  requestedServiceIds: ['svc-1', 'svc-2'],
  reason: 'The work spans both Services.',
});

describe('Run Agent Session current-state replay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records starting as the current phase, replays it, and clears through idle', async () => {
    vi.useFakeTimers();
    let finishRunner!: () => void;
    const runnerBlocked = new Promise<void>((resolve) => {
      finishRunner = resolve;
    });
    const broadcaster = makeBroadcaster();
    const pickRunner = (ctx: RunnerContext): Runner => ({
      run: async () => {
        emitStarting(ctx);
        await runnerBlocked;
      },
    });
    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner, broadcaster));

    const handleMessagePromise = run.handleMessage(makeInput());
    await vi.waitFor(() => {
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSessionId: 'run-1',
          currentState: 'STARTING',
          observedAt: expect.any(String),
        }),
      );
    });

    run.emitCurrentStateIfActive();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'STARTING' }),
    );

    vi.advanceTimersByTime(10_000);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'STARTING' }),
    );

    finishRunner();
    await handleMessagePromise;
    await run.awaitIdle();

    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentSessionId: 'run-1', currentState: 'IDLE' }),
    );

    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mockClear();
    run.emitCurrentStateIfActive();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalled();
  });

  it('publishes starting while prompt resolution is pending', async () => {
    let resolvePreparation!: () => void;
    const preparationPending = new Promise<void>((resolve) => {
      resolvePreparation = resolve;
    });
    const broadcaster = makeBroadcaster();
    const collaborators = makeCollaborators(() => ({ run: async () => {} }), broadcaster);
    const run = new Run(makeRunArgs(), collaborators);
    const originalResolve = (
      run as unknown as {
        resolveTurnInputs: (
          input: InternalRunPromptRequest,
          turnId: string,
        ) => Promise<{ ctx: RunnerContext; platformMcpProxy: null }>;
      }
    ).resolveTurnInputs.bind(run);
    const resolveTurnInputs = vi.spyOn(
      run as unknown as {
        resolveTurnInputs: (
          input: InternalRunPromptRequest,
          turnId: string,
        ) => Promise<{ ctx: RunnerContext; platformMcpProxy: null }>;
      },
      'resolveTurnInputs',
    );
    resolveTurnInputs.mockImplementation(async (input, turnId) => {
      await preparationPending;
      return originalResolve(input, turnId);
    });

    const message = run.handleMessage(makeInput());
    await vi.waitFor(() => {
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
        expect.objectContaining({ currentState: 'STARTING' }),
      );
    });
    expect(resolveTurnInputs).toHaveBeenCalledOnce();
    expect(run.activeTurn).toBeNull();

    resolvePreparation();
    await message;
    await run.awaitIdle();
  });

  it('clears starting when prompt resolution fails before Turn start', async () => {
    const broadcaster = makeBroadcaster();
    const pickRunner = vi.fn<RunCollaborators['runnerPicker']['pick']>(() => ({
      run: async () => {},
    }));
    const collaborators = makeCollaborators(pickRunner, broadcaster);
    vi.mocked(collaborators.promptTypeRegistry.get).mockReturnValue(undefined);
    const run = new Run(makeRunArgs(), collaborators);

    await expect(
      run.handleMessage(makeInput('unregistered_prompt_type' as LocalPromptType)),
    ).resolves.toBeUndefined();

    expect(pickRunner).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
        .mock.calls.map(([observation]) => observation.currentState),
    ).toEqual(['STARTING', 'IDLE']);
  });

  it('clears starting when preparation is cancelled', async () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(() => ({ run: async () => {} }), broadcaster),
    );
    let resolvePreparation!: () => void;
    vi.spyOn(
      run as unknown as {
        resolveTurnInputs: () => Promise<{ ctx: RunnerContext; platformMcpProxy: null }>;
      },
      'resolveTurnInputs',
    ).mockReturnValue(
      new Promise<{ ctx: RunnerContext; platformMcpProxy: null }>((resolve) => {
        resolvePreparation = () =>
          resolve({
            ctx: {} as RunnerContext,
            platformMcpProxy: null,
          });
      }),
    );

    const message = run.handleMessage(makeInput());
    await vi.waitFor(() => expect(run.isProcessing).toBe(true));
    run.abort();

    expect(run.isProcessing).toBe(false);
    expect(run.activeTurn).toBeNull();
    expect(
      vi
        .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
        .mock.calls.map(([observation]) => observation.currentState),
    ).toEqual(['STARTING', 'IDLE']);

    resolvePreparation();
    await message;
    expect(run.activeTurn).toBeNull();
  });

  it('records a handler as started on its first Turn only, however many Turns it starts', async () => {
    const collaborators = makeCollaborators(() => ({ run: async () => {} }));
    const recordStarted = vi.spyOn(collaborators.runStore, 'recordRunStartedPromptType');
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput());
    await run.awaitIdle();
    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(recordStarted).toHaveBeenCalledTimes(1);
    expect(recordStarted).toHaveBeenCalledWith('run-1', LocalPromptType.CodingFreeform);
  });

  it('clears starting when Turn begin fails', async () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(() => ({ run: async () => {} }), broadcaster),
    );
    vi.spyOn(Turn.prototype, 'begin').mockRejectedValueOnce(new Error('begin failed'));

    await expect(run.handleMessage(makeInput())).resolves.toBeUndefined();

    expect(run.isProcessing).toBe(false);
    expect(run.activeTurn).toBeNull();
    expect(
      vi
        .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
        .mock.calls.map(([observation]) => observation.currentState),
    ).toEqual(['STARTING', 'IDLE']);
  });

  it('posts a concise startup-context failure and stays idle without creating a Turn', async () => {
    const broadcaster = makeBroadcaster();
    const poster = makePoster();
    const pickRunner = vi.fn<RunCollaborators['runnerPicker']['pick']>(() => ({
      run: async () => {},
    }));
    const startupPromptInput = {
      resolve: vi
        .fn()
        .mockRejectedValue(
          new AgentStartupPromptInputError(
            'authoritative entity Context unavailable',
            'entity_context_loader',
          ),
        ),
    };
    const collaborators = makeCollaborators(pickRunner, broadcaster, poster);
    collaborators.handlerDeps = {
      startupPromptInput,
    } as unknown as PromptTypeHandlerDeps;
    const run = new Run(
      makeRunArgs({
        session: {
          ...makeSession(),
          entity: { entityType: 'TASK', entityId: 'task-1' },
        } as AgenticSession,
      }),
      collaborators,
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(startupPromptInput.resolve).toHaveBeenCalledTimes(1);
    expect(pickRunner).not.toHaveBeenCalled();
    expect(run.activeTurn).toBeNull();
    expect(run.isProcessing).toBe(false);
    expect(run.hasProviderSession).toBe(false);
    expect(poster.postFailureMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STARTUP_FAILED' }),
    );
  });

  it('drops messages queued behind a failed first-turn startup instead of retrying the failed boundary', async () => {
    const broadcaster = makeBroadcaster();
    const poster = makePoster();
    const pickRunner = vi.fn<RunCollaborators['runnerPicker']['pick']>(() => ({
      run: async () => {},
    }));
    let rejectStartup!: (reason?: unknown) => void;
    const startupResolution = new Promise<never>((_resolve, reject) => {
      rejectStartup = reject;
    });
    const startupPromptInput = {
      resolve: vi.fn().mockReturnValue(startupResolution),
    };
    const collaborators = makeCollaborators(pickRunner, broadcaster, poster);
    collaborators.handlerDeps = {
      startupPromptInput,
    } as unknown as PromptTypeHandlerDeps;
    const run = new Run(
      makeRunArgs({
        session: {
          ...makeSession(),
          entity: { entityType: 'TASK', entityId: 'task-1' },
        } as AgenticSession,
      }),
      collaborators,
    );

    const firstMessage = run.handleMessage(makeInput());
    await vi.waitFor(() => expect(startupPromptInput.resolve).toHaveBeenCalledTimes(1));
    const queuedMessage = run.handleMessage(makeInput());

    rejectStartup(
      new AgentStartupPromptInputError(
        'authoritative entity Context unavailable',
        'entity_context_loader',
      ),
    );
    await firstMessage;
    await queuedMessage;
    await run.awaitIdle();

    expect(startupPromptInput.resolve).toHaveBeenCalledTimes(1);
    expect(pickRunner).not.toHaveBeenCalled();
    expect(run.queueLength).toBe(0);
    expect(poster.postFailureMessage).toHaveBeenCalledTimes(1);
  });

  it('maps provider activity to ordered Agent Session states and refreshes heartbeat observations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    let finishRunner!: () => void;
    const runnerBlocked = new Promise<void>((resolve) => {
      finishRunner = resolve;
    });
    const broadcaster = makeBroadcaster();
    const pickRunner = (ctx: RunnerContext): Runner => ({
      run: async () => {
        for (const phase of ['thinking', 'writing'] as const) {
          ctx.run.onAgentOutput({
            event: {
              source: 'local',
              eventType: 'processing_status',
              timestamp: new Date().toISOString(),
              sessionId: null,
              agentId: 'test-runner',
              payload: { kind: 'loading.update', loadingText: phase, phase },
            },
          });
        }
        await runnerBlocked;
      },
    });
    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner, broadcaster));

    const handleMessagePromise = run.handleMessage(makeInput());
    await vi.waitFor(() => {
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledTimes(3);
    });

    const observations = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map(([observation]) => observation);
    expect(observations.map(({ currentState }) => currentState)).toEqual([
      'STARTING',
      'THINKING',
      'WRITING',
    ]);
    expect(observations.every(({ agentSessionId }) => agentSessionId === 'run-1')).toBe(true);

    vi.advanceTimersByTime(10_000);
    const heartbeat = vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock
      .lastCall?.[0];
    expect(heartbeat).toMatchObject({ agentSessionId: 'run-1', currentState: 'WRITING' });
    expect(heartbeat?.observedAt).not.toBe(observations.at(-1)?.observedAt);

    finishRunner();
    await handleMessagePromise;
    await run.awaitIdle();

    expect(
      vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock.lastCall?.[0],
    ).toMatchObject({ agentSessionId: 'run-1', currentState: 'IDLE' });
  });

  it('publishes IDLE when runtime cleanup interrupts an active observation', () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(() => ({ run: async () => {} }), broadcaster),
    );

    run.observeProviderPhase('thinking');
    run.cleanup();

    expect(
      vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock.lastCall?.[0],
    ).toMatchObject({ agentSessionId: 'run-1', currentState: 'IDLE' });
  });

  it('keeps the exact posted Service-scope request awaiting approval after its work stops', async () => {
    const broadcaster = makeBroadcaster();
    const poster = makePoster();
    const pickRunner = (ctx: RunnerContext): Runner => ({
      run: async () => {
        await ctx.run.serviceScopeCoordinator.request({
          serviceIds: ['svc-2'],
          reason: 'The work spans both Services.',
        });
      },
    });
    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner, broadcaster, poster));

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    const postedAt = vi.mocked(poster.createOutOfBand).mock.invocationCallOrder[0]!;
    const awaitingCall = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.findIndex(([observation]) => observation.currentState === 'AWAITING_APPROVAL');
    expect(awaitingCall).toBeGreaterThanOrEqual(0);
    expect(postedAt).toBeLessThan(
      vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock.invocationCallOrder[
        awaitingCall
      ]!,
    );
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );
    expect(broadcaster.emitAgentSessionCurrentStateObservation).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
    expect(run.serviceScope.isServiceScopeApprovalPauseActive()).toBe(true);
  });

  it('rehydrates an open typed Service-scope presentation without inspecting message text', () => {
    const request = makeServiceScopeRequest();
    const broadcaster = makeBroadcaster();
    const session = {
      ...makeSession(),
      serviceScopeRequestPresentations: [{ request, messageId: 'scope-message-1' }],
    };

    const run = new Run(
      makeRunArgs({ session }),
      makeCollaborators(() => ({ run: async () => {} }), broadcaster),
    );

    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );
    expect(run.serviceScope.settleServiceScopeApprovalWait('different-request', 'idle')).toBe(
      false,
    );
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );
    expect(run.serviceScope.settleServiceScopeApprovalWait(request.id, 'idle')).toBe(true);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
    expect(run.serviceScope.isServiceScopeApprovalPauseActive()).toBe(false);
  });

  it('holds PLAN_READY after both plan and terminal assistant evidence and replaces it when a new turn starts', async () => {
    let finishFirstTurn!: () => void;
    const firstTurnBlocked = new Promise<void>((resolve) => {
      finishFirstTurn = resolve;
    });
    let turnCount = 0;
    const broadcaster = makeBroadcaster();
    const pickRunner = (ctx: RunnerContext): Runner => ({
      run: async () => {
        turnCount += 1;
        if (turnCount === 1) {
          ctx.run.observeProviderPhase('writing');
          ctx.run.observePersistedPlanReady('report-plan');
          ctx.run.observeFinalAssistantMessageCommitted(ctx.run.activeTurn!.turnId, 'message-plan');
          ctx.run.observeProviderPhase('writing');
          await firstTurnBlocked;
        }
      },
    });
    const run = new Run(makeRunArgs(), makeCollaborators(pickRunner, broadcaster));

    const firstTurn = run.handleMessage(makeInput());
    await vi.waitFor(() => {
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentState: 'PLAN_READY' }),
      );
    });
    finishFirstTurn();
    await firstTurn;
    await run.awaitIdle();

    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'PLAN_READY' }),
    );
    expect(broadcaster.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    const states = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map(([observation]) => observation.currentState);
    const finalPlanReadyIndex = states.lastIndexOf('PLAN_READY');
    expect(states.slice(finalPlanReadyIndex + 1)).toEqual(['STARTING', 'IDLE']);
  });

  it('reports a stopped execution once even when provider abort throws', async () => {
    const poster = makePoster();
    let started = false;
    const run = new Run(
      makeRunArgs(),
      makeCollaborators(
        () => ({
          run: async (signal) => {
            started = true;
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(new Error('provider stopped')), {
                once: true,
              }),
            );
          },
        }),
        makeBroadcaster(),
        poster,
      ),
    );
    await run.handleMessage(makeInput());
    await vi.waitFor(() => expect(started).toBe(true));
    run.abort();
    await run.awaitIdle();
    expect(poster.postFailureMessage).toHaveBeenCalledOnce();
    expect(poster.postFailureMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STOPPED' }),
    );
    expect(run.activeTurn).toBeNull();
    run.cleanup();
  });

  it('does not report a Turn paused for Service approval as stopped', async () => {
    const poster = makePoster();
    let run: Run;
    const started = new Promise<void>((resolve) => {
      run = new Run(
        makeRunArgs(),
        makeCollaborators(
          () => ({
            run: async (signal) => {
              resolve();
              await new Promise<void>((_resolve, reject) =>
                signal.addEventListener('abort', () => reject(new Error('Aborted')), {
                  once: true,
                }),
              );
            },
          }),
          makeBroadcaster(),
          poster,
        ),
      );
    });
    await run!.handleMessage(makeInput());
    await started;
    await run!.serviceScope.pauseForServiceScopeRequest('scope-request-1', 'human');
    await run!.awaitIdle();
    expect(poster.postFailureMessage).not.toHaveBeenCalled();
    run!.cleanup();
  });

  it.each([
    [
      'MODEL_CAPACITY',
      new AgentSessionRunnerError('MODEL_CAPACITY', 'private capacity diagnostic'),
    ],
    ['EXECUTION_FAILED', new Error('private execution diagnostic')],
    [
      'AUTHORIZATION_REJECTED',
      new AgentSessionRunnerError('MISSING_CREDENTIAL', 'private credential diagnostic'),
    ],
  ] as const)(
    'reports %s once, returns to idle, and accepts a later retry',
    async (reason, failure) => {
      const broadcaster = makeBroadcaster();
      const poster = makePoster();
      let runs = 0;
      const pickRunner = (): Runner => ({
        run: async () => {
          runs += 1;
          if (runs === 1) {
            throw failure;
          }
        },
      });
      const run = new Run(
        makeRunArgs({ provider: 'codex' }),
        makeCollaborators(pickRunner, broadcaster, poster),
      );

      await run.handleMessage(makeInput());
      await run.awaitIdle();

      expect(poster.postFailureMessage).toHaveBeenCalledOnce();
      expect(poster.postFailureMessage).toHaveBeenCalledWith(expect.objectContaining({ reason }));
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
        expect.objectContaining({ agentSessionId: 'run-1', currentState: 'IDLE' }),
      );

      await run.handleMessage(makeInput());
      await run.awaitIdle();

      expect(runs).toBe(2);
      expect(poster.postFailureMessage).toHaveBeenCalledTimes(1);
      expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
        expect.objectContaining({ agentSessionId: 'run-1', currentState: 'IDLE' }),
      );
    },
  );
});

describe('Run decided-proposal notices', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const approvedCreate = {
    status: 'APPROVED',
    action: 'CREATE',
    targetEntityId: 'task-9',
    targetEntityType: 'TASK',
  };

  const makeHarness = () => {
    const prompts: string[] = [];
    const collaborators = makeCollaborators((ctx) => ({
      run: async () => {
        prompts.push(ctx.resolvedPrompt);
      },
    }));
    collaborators.proposalStatusReader = {
      lookupProposal: vi.fn(async () => approvedCreate),
      lookupEntityTitle: vi.fn(async () => 'Fix the thing'),
    };
    const run = new Run(makeRunArgs(), collaborators);
    run.proposalTracker.record('p-1');
    return { run, prompts };
  };

  const notice =
    'Proposal p-1 was approved by the user and created @[task:task-9|Fix the thing]; reference that item, not the proposal.';

  it('adds the notice to the next prompt once', async () => {
    const { run, prompts } = makeHarness();

    await run.handleMessage(makeInput());
    await run.awaitIdle();
    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(prompts[0]).toContain(notice);
    expect(prompts[1]).not.toContain('Proposal p-1');
  });

  it('keeps the notice when the Turn fails to begin', async () => {
    const { run, prompts } = makeHarness();
    vi.spyOn(Turn.prototype, 'begin').mockRejectedValueOnce(new Error('begin failed'));

    await expect(run.handleMessage(makeInput())).resolves.toBeUndefined();
    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(notice);
  });
});
