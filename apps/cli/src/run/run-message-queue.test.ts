import { describe, expect, it, vi } from 'vitest';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import { NOOP_LOGGER } from '../server/logger';
import { OperationTimelineRegistry } from '../server/input-admission/operation-timeline';
import { AgentStartupPromptInputError } from '../commands/agent-startup-prompt-input';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import { Run, type RunArgs, type RunCollaborators } from './run';
import {
  resolvePromptText,
  type InternalRunPromptRequest,
  type ProjectAssistantConfig,
} from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { freeFormHandler } from '../agents/coding-conversation';
import type { RepoMappingStore } from '../repo/index';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type { ProjectAssistantPromptPayload } from '../agents/project-assistant/project-assistant.handler';
import { OpenItemsTriageHandler } from '../agents/open-items-triage/open-items-triage.handler';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
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
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const entityConversationHandler: PromptTypeHandler<unknown> = {
  id: 'entity_conversation',
  promptType: LocalPromptType.EntityConversation,
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'none',
  },
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => '',
};

const makeCollaborators = (
  getHandler?: (promptType: string | undefined) => PromptTypeHandler<unknown> | undefined,
): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(getHandler),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeInput = (prompt: string): InternalRunPromptRequest => ({
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: prompt },
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

describe('Run message queue', () => {
  it('keeps triage PROJECT identity through first turn, follow-ups and reconstruction without research bootstrap', async () => {
    const handler = new OpenItemsTriageHandler();
    const collaborators = makeCollaborators((type) =>
      type === handler.promptType ? handler : undefined,
    );
    const session: AgenticSession = {
      ...makeSession(),
      entity: { entityType: 'PROJECT', entityId: '11111111-1111-4111-8111-111111111111' },
      projectAssistantDone: false,
    };
    for (const rebuilt of [false, true]) {
      const run = new Run(
        makeRunArgs({ session: rebuilt ? structuredClone(session) : session }),
        collaborators,
      );
      const startTurn = vi
        .spyOn(
          run as unknown as { startTurn(input: InternalRunPromptRequest): Promise<void> },
          'startTurn',
        )
        .mockResolvedValue(undefined);
      for (const requestKind of ['freshPass', 'followUp'] as const) {
        const input: InternalRunPromptRequest = {
          promptType: LocalPromptType.OpenItemsTriage,
          payload: { projectId: session.entity!.entityId, requestKind, userMessage: 'Review this' },
          references: { resolved: [], unresolved: [] },
          triggerContext: null,
        };
        await run.handleMessage(input);
        expect(startTurn).toHaveBeenLastCalledWith(input);
        expect(run.entity).toEqual(session.entity);
      }
      expect(startTurn).toHaveBeenCalledTimes(2);
      run.cleanup();
    }
  });

  it.each([
    new Error('temporary network failure'),
    new AgentStartupPromptInputError('template service unavailable', 'effective_template_read'),
  ])('preserves durable admission after retryable preparation failure: %s', async (error) => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    const resolve = vi
      .spyOn(
        run as unknown as {
          resolveTurnInputs: () => Promise<never>;
        },
        'resolveTurnInputs',
      )
      .mockRejectedValue(error);
    const admittedInput = {
      turnId: 'selected-turn',
      onStarted: vi.fn(),
      onRejected: vi.fn(),
      onSettled: vi.fn(),
    };
    try {
      await expect(run.handleMessage(makeInput('retry me'), { admittedInput })).rejects.toBe(error);
      await expect(run.handleMessage(makeInput('retry me'), { admittedInput })).rejects.toBe(error);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(admittedInput.onRejected).not.toHaveBeenCalled();
      expect(admittedInput.onStarted).not.toHaveBeenCalled();
      expect(run.isProcessing).toBe(false);
      expect(collaborators.runnerPicker.pick).not.toHaveBeenCalled();
    } finally {
      run.cleanup();
    }
  });

  it('posts a conversation message when a queued message fails to start', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    run.enqueue(makeInput('queued work'));
    vi.spyOn(
      run as unknown as { startTurn: (input: InternalRunPromptRequest) => Promise<void> },
      'startTurn',
    ).mockRejectedValue(new Error('workspace changed'));
    try {
      await (run as unknown as { drainQueue: () => Promise<void> }).drainQueue();

      expect(collaborators.poster.createOutOfBand).toHaveBeenCalledWith(
        expect.objectContaining({
          dto: expect.objectContaining({
            data: expect.objectContaining({
              response: 'I could not start your queued message. Please try sending it again.',
            }),
          }),
        }),
      );
      expect(run.queueLength).toBe(0);
      expect(run.isProcessing).toBe(false);
    } finally {
      run.cleanup();
    }
  });

  it('terminally rejects definitive invalid input before execution', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const error = new LocalAgentApiError('INVALID_REQUEST', 'Invalid prompt payload', 400);
    vi.spyOn(
      run as unknown as {
        resolveTurnInputs: () => Promise<never>;
      },
      'resolveTurnInputs',
    ).mockRejectedValue(error);
    const admittedInput = {
      turnId: 'selected-turn',
      onStarted: vi.fn(),
      onRejected: vi.fn(),
      onSettled: vi.fn(),
    };
    try {
      await expect(run.handleMessage(makeInput('invalid'), { admittedInput })).rejects.toBe(error);
      expect(admittedInput.onRejected).toHaveBeenCalledOnce();
      expect(admittedInput.onStarted).not.toHaveBeenCalled();
    } finally {
      run.cleanup();
    }
  });

  it('starts with isProcessing=false and empty queue', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    expect(run.isProcessing).toBe(false);
    expect(run.queueLength).toBe(0);
  });

  it('enqueue adds messages and returns position', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const pos1 = run.enqueue(makeInput('first'));
    const pos2 = run.enqueue(makeInput('second'));
    expect(pos1).toBe(1);
    expect(pos2).toBe(2);
    expect(run.queueLength).toBe(2);
  });

  it('dequeue returns messages in FIFO order', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.enqueue(makeInput('first'));
    run.enqueue(makeInput('second'));

    const msg1 = run.dequeue();
    expect(msg1 ? resolvePromptText(msg1) : null).toBe('first');
    expect(run.queueLength).toBe(1);

    const msg2 = run.dequeue();
    expect(msg2 ? resolvePromptText(msg2) : null).toBe('second');
    expect(run.queueLength).toBe(0);
  });

  it('dequeue returns undefined when queue is empty', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    expect(run.dequeue()).toBeUndefined();
  });

  it('clearQueue empties the queue', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.enqueue(makeInput('a'));
    run.enqueue(makeInput('b'));
    run.clearQueue();
    expect(run.queueLength).toBe(0);
    expect(run.dequeue()).toBeUndefined();
  });

  it('cleanup clears the queue and resets isProcessing', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.isProcessing = true;
    run.enqueue(makeInput('orphan'));
    run.cleanup();
    expect(run.isProcessing).toBe(false);
    expect(run.queueLength).toBe(0);
  });

  it('isProcessing can be toggled', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.isProcessing = true;
    expect(run.isProcessing).toBe(true);
    run.isProcessing = false;
    expect(run.isProcessing).toBe(false);
  });

  it('queues later messages while a foreground child holds the Run', async () => {
    const collaborators = makeCollaborators(() => freeFormHandler);
    const run = new Run(makeRunArgs(), collaborators);
    run.holdForSubagent('interaction-1');
    await run.handleMessage(makeInput('later work'));
    expect(run.queueLength).toBe(1);
    expect(collaborators.runnerPicker.pick).not.toHaveBeenCalled();
    run.cleanup();
  });

  it('never opens Service-scope approval for a typed Service mention; the API admits it', async () => {
    const referencedServiceId = '22222222-2222-4222-8222-222222222222';
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs({ session: makeSession() }), collaborators);
    run.isProcessing = true;

    await run.handleMessage(makeInput(`Inspect @[service:${referencedServiceId}|Payments API].`), {
      sourceUserMessageId: 'message-1',
    });

    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(run.session.serviceScopeContinuation).toBeUndefined();
    expect(run.queueLength).toBe(1);
  });

  it('queues an authenticated message immediately when its referenced Service is already in scope', async () => {
    const currentServiceId = '11111111-1111-4111-8111-111111111111';
    const referencedServiceId = '22222222-2222-4222-8222-222222222222';
    const collaborators = makeCollaborators();
    const run = new Run(
      makeRunArgs({
        session: {
          ...makeSession(),
          services: [
            { id: currentServiceId, path: '/workspace/current' },
            { id: referencedServiceId, path: '/workspace/payments' },
          ],
          launchServiceId: currentServiceId,
        },
      }),
      collaborators,
    );
    run.isProcessing = true;

    await run.handleMessage(makeInput(`Inspect @[service:${referencedServiceId}|Payments API].`), {
      sourceUserMessageId: 'message-2',
    });

    expect(run.serviceScope.hasPendingServiceScopeRequest()).toBe(false);
    expect(run.session.serviceScopeContinuation).toBeUndefined();
    expect(run.queueLength).toBe(1);
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
  });
});

describe('Run Project Assistant handoff', () => {
  const makeParticipatingSession = (
    taskType = 'STANDARD',
    projectAssistant?: ProjectAssistantConfig,
    configType: 'CODING_SESSION' | 'ENTITY_CONVERSATION' = 'CODING_SESSION',
    disableCodexSystemPrompt?: boolean,
  ): AgenticSession =>
    ({
      ...makeSession(),
      ...(projectAssistant !== undefined || configType === 'ENTITY_CONVERSATION'
        ? {
            config:
              configType === 'CODING_SESSION'
                ? {
                    type: 'CODING_SESSION',
                    version: 'v2',
                    model: 'claude-opus-4-7',
                    ...(projectAssistant !== undefined ? { projectAssistant } : {}),
                  }
                : {
                    type: 'ENTITY_CONVERSATION',
                    version: 'v1',
                    model: 'claude-opus-4-7',
                    ...(projectAssistant !== undefined ? { projectAssistant } : {}),
                    ...(disableCodexSystemPrompt === undefined ? {} : { disableCodexSystemPrompt }),
                  },
          }
        : {}),
      entity: { entityType: 'TASK', entityId: 'task-1' },
      contextMetadata: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        task: {
          id: 'task-1',
          name: 'Task one',
          type: taskType,
          sections: [],
        },
      },
    }) as unknown as AgenticSession;

  const makeParticipatingInput = (): InternalRunPromptRequest =>
    ({
      promptType: LocalPromptType.FreeForm,
      payload: {
        userMessage: 'Please implement this exactly.\nThen run the tests.',
      },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    }) as unknown as InternalRunPromptRequest;

  const makeEntityConversationInput = (): InternalRunPromptRequest =>
    ({
      promptType: LocalPromptType.EntityConversation,
      payload: {
        userMessage: 'Please explain this entity clearly.',
      },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    }) as unknown as InternalRunPromptRequest;

  const buildProjectAssistantHarness = (
    skipProjectAssistant = false,
    projectAssistant?: ProjectAssistantConfig,
    promptType: LocalPromptType = LocalPromptType.FreeForm,
    configType: 'CODING_SESSION' | 'ENTITY_CONVERSATION' = 'CODING_SESSION',
    disableCodexSystemPrompt?: boolean,
    operationTimeline?: OperationTimelineRegistry,
  ) => {
    const runStore = createTestRunStore();
    const updateRunProjectAssistantDone = vi
      .spyOn(runStore, 'updateRunProjectAssistantDone')
      .mockResolvedValue(
        makeParticipatingSession(
          'STANDARD',
          projectAssistant,
          configType,
          disableCodexSystemPrompt,
        ),
      );
    const collaborators = makeCollaborators((requestedPromptType) => {
      if (requestedPromptType === promptType) {
        return promptType === LocalPromptType.EntityConversation
          ? entityConversationHandler
          : freeFormHandler;
      }
      return undefined;
    });
    if (operationTimeline) collaborators.operationTimeline = operationTimeline;
    collaborators.runStore = runStore;
    const run = new Run(
      makeRunArgs({
        session: makeParticipatingSession(
          'STANDARD',
          projectAssistant,
          configType,
          disableCodexSystemPrompt,
        ),
        skipProjectAssistant,
      }),
      collaborators,
    );
    const startTurn = vi
      .spyOn(
        run as unknown as { startTurn: (input: InternalRunPromptRequest) => Promise<void> },
        'startTurn',
      )
      .mockResolvedValue(undefined);
    return { run, startTurn, updateRunProjectAssistantDone, collaborators };
  };

  it('does not run the bootstrap Turn until the admitted input start is projected', async () => {
    const h = buildProjectAssistantHarness();
    h.startTurn.mockRestore();
    vi.spyOn(h.collaborators.runStore, 'updateRunPromptType').mockResolvedValue(
      makeParticipatingSession('STANDARD'),
    );
    vi.spyOn(
      h.run as unknown as {
        resolveTurnInputs: (
          input: InternalRunPromptRequest,
          turnId: string,
        ) => Promise<{
          ctx: RunnerContext;
          platformMcpProxy: null;
          browserAnnotationIds: readonly string[];
          proposalNotices: { lines: readonly string[]; proposalIds: readonly string[] };
        }>;
      },
      'resolveTurnInputs',
    ).mockImplementation(async (input, turnId) => ({
      ctx: {
        run: h.run,
        turnId,
        handler: freeFormHandler,
        resolvedPrompt: 'test prompt',
        input,
        cwd: '/tmp/repo',
        effectiveModel: null,
        effectiveReasoningEffort: null,
        priorReports: [],
      } as RunnerContext,
      platformMcpProxy: null,
      browserAnnotationIds: [],
      proposalNotices: { lines: [], proposalIds: [] },
    }));
    const runnerRun = vi.fn(async () => undefined);
    vi.mocked(h.collaborators.runnerPicker.pick).mockImplementation(() => ({ run: runnerRun }));
    let accept: () => void = () => {};
    const admittedInput = {
      turnId: 'admitted-user-turn',
      onStarted: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            accept = resolve;
          }),
      ),
      onRejected: vi.fn(),
      onSettled: vi.fn(),
    };
    try {
      const handled = h.run.handleMessage(makeParticipatingInput(), { admittedInput });
      await vi.waitFor(() => expect(admittedInput.onStarted).toHaveBeenCalledOnce());
      expect(h.collaborators.runnerPicker.pick).toHaveBeenCalledOnce();
      expect(runnerRun).not.toHaveBeenCalled();
      accept();
      await handled;
      await vi.waitFor(() => expect(runnerRun).toHaveBeenCalledOnce());
    } finally {
      await h.run.awaitIdle();
      h.run.cleanup();
    }
  });

  it('keeps bootstrap timing separate from the admitted user turn', async () => {
    const logger = { ...NOOP_LOGGER, info: vi.fn() };
    const timeline = new OperationTimelineRegistry(logger);
    timeline.register({
      key: 'operation-project-assistant',
      keyKind: 'operation',
      receivedAt: new Date().toISOString(),
      origin: performance.now(),
    });
    timeline.aliasTurnId('operation-project-assistant', 'admitted-user-turn');
    const h = buildProjectAssistantHarness(
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      timeline,
    );
    vi.spyOn(h.collaborators.runStore, 'updateRunPromptType').mockResolvedValue(
      makeParticipatingSession('STANDARD'),
    );
    const admittedInput = {
      turnId: 'admitted-user-turn',
      onStarted: vi.fn(),
      onRejected: vi.fn(),
      onSettled: vi.fn(),
    };

    await h.run.handleMessage(makeParticipatingInput(), { admittedInput });
    expect(timeline.hasMark('admitted-user-turn', 'bootstrapStarted')).toBe(true);
    expect(timeline.hasMark('admitted-user-turn', 'startingEmitted')).toBe(false);

    h.startTurn.mockRestore();
    vi.spyOn(
      h.run as unknown as {
        resolveTurnInputs: (
          input: InternalRunPromptRequest,
          turnId: string,
        ) => Promise<{
          ctx: RunnerContext;
          platformMcpProxy: null;
          browserAnnotationIds: readonly string[];
          proposalNotices: { lines: readonly string[]; proposalIds: readonly string[] };
        }>;
      },
      'resolveTurnInputs',
    ).mockImplementation(async (input, turnId) => ({
      ctx: {
        run: h.run,
        turnId,
        handler: freeFormHandler,
        resolvedPrompt: 'test prompt',
        input,
        cwd: '/tmp/repo',
        effectiveModel: null,
        effectiveReasoningEffort: null,
        priorReports: [],
      } as RunnerContext,
      platformMcpProxy: null,
      browserAnnotationIds: [],
      proposalNotices: { lines: [], proposalIds: [] },
    }));
    const queuedInput = h.run.dequeue();
    expect(queuedInput).toBeDefined();
    await h.run.handleMessage(queuedInput!);
    await h.run.awaitIdle();

    const timelineLog = logger.info.mock.calls.find(
      ([event]) => event === 'agent_operation.timeline',
    );
    expect(timelineLog?.[1]).toMatchObject({
      key: 'operation-project-assistant',
      turnId: 'admitted-user-turn',
      projectAssistant: true,
      outcome: 'no_provider_output',
      marks: expect.objectContaining({
        bootstrapStarted: expect.any(Number),
        bootstrapEnded: expect.any(Number),
        startingEmitted: expect.any(Number),
      }),
    });
    expect(timelineLog?.[1].marks).not.toHaveProperty('firstProviderEvent');
    const marks = timelineLog?.[1].marks as Record<string, number>;
    expect(marks['startingEmitted']).toBeDefined();
    expect(marks['turnInputsResolved']).toBeDefined();
    expect(marks['startingEmitted']!).toBeLessThanOrEqual(marks['turnInputsResolved']!);
    h.run.cleanup();
  });

  it('quotes the original request into Project Assistant while queueing the unchanged request for its named consumer', async () => {
    const h = buildProjectAssistantHarness();
    const original = makeParticipatingInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    expect(h.updateRunProjectAssistantDone.mock.invocationCallOrder[0]).toBeLessThan(
      h.startTurn.mock.invocationCallOrder[0]!,
    );
    const bootstrap = h.startTurn.mock.calls[0]![0];
    expect(bootstrap.promptType).toBe(LocalPromptType.ProjectAssistant);
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.userMessage).toBe('Please implement this exactly.\nThen run the tests.');
    expect(payload.projectAssistantHandoff).toEqual({
      consumerHandlerId: 'free_form',
      policy: {
        allowEdgeUpdates: false,
        notifyDiscrepancies: false,
        workItemProposalMode: 'all',
      },
    });
    expect(payload.entity).toEqual({ entityType: 'TASK', entityId: 'task-1' });
    expect(payload).not.toHaveProperty('startupInput');
    expect(h.run.dequeue()).toBe(original);
  });

  it('keeps the persisted Run identity on the Project Assistant bootstrap payload', async () => {
    const h = buildProjectAssistantHarness();
    h.run.session = makeParticipatingSession('GOAL');

    await h.run.handleMessage(makeParticipatingInput());

    const bootstrap = h.startTurn.mock.calls[0]![0];
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.entity).toEqual({ entityType: 'TASK', entityId: 'task-1' });
    expect(payload).not.toHaveProperty('startupInput');
  });

  it('does not rerun bootstrap on duplicate delivery after the marker is set', async () => {
    const h = buildProjectAssistantHarness();
    const original = makeParticipatingInput();

    await h.run.handleMessage(original);
    h.run.dequeue();
    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    expect(h.startTurn).toHaveBeenCalledTimes(2);
    expect(h.startTurn.mock.calls[1]![0]).toBe(original);
  });

  it('does not rerun bootstrap when a reconstructed Run carries the persisted marker', async () => {
    const h = buildProjectAssistantHarness(true);
    const original = makeParticipatingInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).not.toHaveBeenCalled();
    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
  });

  it('starts the main handler directly when Project Assistant is explicitly disabled', async () => {
    const h = buildProjectAssistantHarness(
      false,
      { enabled: false },
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
    );
    const original = makeEntityConversationInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledWith('run-1', true);
    expect(h.updateRunProjectAssistantDone.mock.invocationCallOrder[0]).toBeLessThan(
      h.startTurn.mock.invocationCallOrder[0]!,
    );
    expect(h.run.session.projectAssistantDone).toBe(true);
    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
  });

  it('does not dispatch an explicitly disabled request when marker persistence fails', async () => {
    const h = buildProjectAssistantHarness(
      false,
      { enabled: false },
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
    );
    const persistenceError = new Error('marker persistence failed');
    h.updateRunProjectAssistantDone.mockRejectedValueOnce(persistenceError);

    await expect(h.run.handleMessage(makeEntityConversationInput())).rejects.toBe(persistenceError);

    expect(h.run.session.projectAssistantDone).not.toBe(true);
    expect(h.startTurn).not.toHaveBeenCalled();
  });

  it('preserves the Entity Conversation handler ceiling when config is omitted', async () => {
    const h = buildProjectAssistantHarness(
      false,
      undefined,
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
    );
    const original = makeEntityConversationInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    const bootstrap = h.startTurn.mock.calls[0]![0];
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff.policy).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
    expect(h.run.dequeue()).toBe(original);
  });

  it('runs Project Assistant when the Codex system-prompt pilot is enabled', async () => {
    const h = buildProjectAssistantHarness(
      false,
      undefined,
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
      true,
    );
    const original = makeEntityConversationInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    const bootstrap = h.startTurn.mock.calls[0]![0];
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff.policy).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
    expect(h.run.dequeue()).toBe(original);
  });

  it('preserves the Entity Conversation handler ceiling when config enables Project Assistant', async () => {
    const h = buildProjectAssistantHarness(
      false,
      { enabled: true },
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
    );
    const original = makeEntityConversationInput();

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    const bootstrap = h.startTurn.mock.calls[0]![0];
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff.policy).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
    expect(h.run.dequeue()).toBe(original);
  });

  it('does not rerun or repersist Project Assistant after a disabled Entity Conversation delivery', async () => {
    const h = buildProjectAssistantHarness(
      false,
      { enabled: false },
      LocalPromptType.EntityConversation,
      'ENTITY_CONVERSATION',
    );
    const original = makeEntityConversationInput();

    await h.run.handleMessage(original);
    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    expect(h.startTurn).toHaveBeenCalledTimes(2);
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
    expect(h.startTurn.mock.calls[1]![0]).toBe(original);
  });

  it('runs Project Assistant while independently disabling proposal updates', async () => {
    const h = buildProjectAssistantHarness(false, { allowUpdateProposals: false });

    await h.run.handleMessage(makeParticipatingInput());

    expect(h.updateRunProjectAssistantDone).toHaveBeenCalledOnce();
    const bootstrap = h.startTurn.mock.calls[0]![0];
    const payload = bootstrap.payload as unknown as ProjectAssistantPromptPayload;
    expect(payload.projectAssistantHandoff.policy).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    });
  });

  it('starts an unconfigured handler directly', async () => {
    const h = buildProjectAssistantHarness();
    const original: InternalRunPromptRequest = {
      promptType: LocalPromptType.CodingFreeform,
      payload: { promptType: LocalPromptType.CodingFreeform, userMessage: 'raw request' },
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    };

    await h.run.handleMessage(original);

    expect(h.updateRunProjectAssistantDone).not.toHaveBeenCalled();
    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.startTurn.mock.calls[0]![0]).toBe(original);
  });
});

describe('Run queue drain coalescing', () => {
  const buildHarness = () => {
    const poster = makePoster();
    const broadcaster = createTestRunEventPublisher();
    const logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const pickRunner = vi.fn(() => ({ run: () => Promise.resolve() })) as unknown as (
      ctx: RunnerContext,
    ) => Runner;
    const collaborators: RunCollaborators = {
      runStore: createTestRunStore(),
      repoStore: createTestRepoMappingStore(),
      poster,
      broadcaster,
      ...createTestRunOwnership(),
      handlerDeps: {} as unknown as PromptTypeHandlerDeps,
      runnerPicker: createTestRunnerPicker(pickRunner),
      logger: logger as unknown as RunCollaborators['logger'],
    };
    const run = new Run(makeRunArgs(), collaborators);
    // Spy `startTurn` so the drain decision is observable without dragging in
    // the full prompt-resolution / message-posting machinery.
    const startTurn = vi
      .spyOn(
        run as unknown as { startTurn: (i: InternalRunPromptRequest) => Promise<void> },
        'startTurn',
      )
      .mockResolvedValue(undefined);
    const drain = () => (run as unknown as { drainQueue: () => Promise<void> }).drainQueue();
    return { run, poster, broadcaster, logger, startTurn, drain };
  };

  /**
   * Regression: a duplicate create_run for the same agent session queued two
   * payload-only startup requests (`userMessage: ""` plus the real prompt
   * material in `payload.startupInput`). The coalesce path joined their text,
   * skipped both items because `!""` is true, returned without starting a
   * turn, and the run idled silently after the project_assistant turn. The fix falls back to
   * running the head as a single turn with its payload intact when no text
   * survived joining, so the handler's buildPrompt still has startupInput to
   * work with.
   */
  it('a coalesced batch of payload-only items runs head as a single turn instead of dropping silently', async () => {
    const h = buildHarness();
    const startupPayload = {
      promptType: 'coding_freeform',
      userMessage: '',
      startupInput: { task: { id: 'task-1' } },
    };
    const makePayloadOnly = (): InternalRunPromptRequest => ({
      promptType: 'coding_freeform',
      payload: startupPayload as unknown as NonNullable<InternalRunPromptRequest['payload']>,
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
    });
    h.run.enqueue(makePayloadOnly());
    h.run.enqueue(makePayloadOnly());

    await h.drain();

    expect(h.startTurn).toHaveBeenCalledTimes(1);
    const dispatched = h.startTurn.mock.calls[0]?.[0] as InternalRunPromptRequest | undefined;
    expect(dispatched?.payload).toBe(startupPayload);
    expect(dispatched ? resolvePromptText(dispatched) : null).toBe('');
    expect(h.logger.info).toHaveBeenCalledWith(
      'local.run.drain.coalesced.no_text_falling_back_to_single',
      expect.objectContaining({ promptType: 'coding_freeform', droppedDuplicateCount: 1 }),
    );
  });
});
