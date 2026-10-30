import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRun,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { AgentOutputMessage } from '../agents/agent-event-stream';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunnerContext } from './runners/types';
import { Turn, type Runner } from '../turn/turn';
import type { RepoMappingStore } from '../repo/index';
import type { ServerLogger } from '../server/logger';
import type { RunEventPublisher } from '../server/run-event-publisher';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'provider' as const,
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

const makeAgentOutput = (): AgentOutputMessage => ({
  event: {
    source: 'local',
    eventType: 'assistant_delta',
    timestamp: new Date().toISOString(),
    sessionId: null,
    agentId: null,
    payload: { text: 'hello' },
  },
});

describe('Run abort', () => {
  it('starts without an abort controller', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    expect(run.abortSignal).toBeUndefined();
    expect(run.isAborted).toBe(false);
  });

  it('createAbortController returns a controller and exposes the signal', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const controller = run.createAbortController();
    expect(controller).toBeInstanceOf(AbortController);
    expect(run.abortSignal).toBe(controller.signal);
    expect(run.isAborted).toBe(false);
  });

  it('abort() fires the signal', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.createAbortController();
    run.abort();
    expect(run.isAborted).toBe(true);
    expect(run.abortSignal?.aborted).toBe(true);
  });

  it('resetAbort() clears the controller for next turn', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.createAbortController();
    run.abort();
    run.resetAbort();
    expect(run.abortSignal).toBeUndefined();
    expect(run.isAborted).toBe(false);
  });

  it('cleanup resets abort controller', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.createAbortController();
    run.abort();
    run.cleanup();
    expect(run.isAborted).toBe(false);
    expect(run.abortSignal).toBeUndefined();
  });

  it('createAbortController replaces previous controller', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const first = run.createAbortController();
    const second = run.createAbortController();
    expect(first).not.toBe(second);
    expect(run.abortSignal).toBe(second.signal);
  });

  it('onAgentOutput drops events after abort', () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(makeRunArgs(), makeCollaborators(broadcaster));
    run.createAbortController();
    run.abort();

    run.onAgentOutput(makeAgentOutput());

    expect(broadcaster.publishAgentOutput).not.toHaveBeenCalled();
  });

  it('onAgentOutput dispatches events when not aborted', () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(makeRunArgs(), makeCollaborators(broadcaster));
    run.createAbortController();

    run.onAgentOutput(makeAgentOutput());

    expect(broadcaster.publishAgentOutput).toHaveBeenCalledTimes(1);
  });

  it('new prompt can be processed after abort + reset', () => {
    const broadcaster = makeBroadcaster();
    const run = new Run(makeRunArgs(), makeCollaborators(broadcaster));

    run.createAbortController();
    run.abort();
    run.resetAbort();

    run.createAbortController();
    run.onAgentOutput(makeAgentOutput());

    expect(broadcaster.publishAgentOutput).toHaveBeenCalledTimes(1);
  });
});

const makeStubHandler = (): PromptTypeHandler<unknown> =>
  ({
    promptType: 'coding_freeform',
    runnerKind: 'provider_session',
    buildPrompt: () => '',
  }) as unknown as PromptTypeHandler<unknown>;

const makeTurn = (): Turn =>
  new Turn({
    effectiveRole: 'implementation',
    turnId: 'turn-1',
    runId: 'run-1',
    resolvedPrompt: '',
    handler: makeStubHandler(),
    externalAgentNodeId: null,
    triggerMessageId: null,
    runner: { run: async () => {} },
    platformMcpProxy: null,
    abortController: new AbortController(),
    effectiveModel: null,
    effectiveReasoningEffort: null,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as ServerLogger,
    owner: createTestRun(),
  });

describe('Run.stop', () => {
  it('unregisters submission tools whether or not a turn is active', async () => {
    const broadcaster = makeBroadcaster();
    const idleCollaborators = makeCollaborators(broadcaster);
    const idleRun = new Run(makeRunArgs(), idleCollaborators);
    const unregisterSpy = vi.spyOn(idleCollaborators.submissionToolRegistry, 'unregisterByRunId');

    await idleRun.stop();

    expect(unregisterSpy).toHaveBeenCalledWith('run-1');

    unregisterSpy.mockClear();

    const activeCollaborators = makeCollaborators(broadcaster);
    const activeRun = new Run(makeRunArgs(), activeCollaborators);
    unregisterSpy.mockRestore();
    const activeUnregisterSpy = vi.spyOn(
      activeCollaborators.submissionToolRegistry,
      'unregisterByRunId',
    );
    activeRun.createAbortController();
    activeRun.setActiveTurn(makeTurn());

    await activeRun.stop();

    expect(activeUnregisterSpy).toHaveBeenCalledWith('run-1');

    activeUnregisterSpy.mockRestore();
  });

  it('aborts the active controller and clears the abort signal aborted state', async () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    const controller = run.createAbortController();
    run.setActiveTurn(makeTurn());

    await run.stop();

    expect(controller.signal.aborted).toBe(true);
    expect(run.isAborted).toBe(true);
  });
});
