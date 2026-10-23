import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunOwnership,
  createTestRunStore,
  createRunTestOAuthClient,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { AgentSessionRunner } from '../agents/providers/session-runner';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import type { Runner } from '../turn/turn';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunRegistry } from './run-registry';
import { RunnerPicker } from './runners/pick-runner';
import { ResumeRunner } from './runners/resume-runner';
import type { RunnerContext } from './runners/types';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';

const handler: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'system prompt',
};

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: () =>
    Promise.resolve({
      resolvedPrompt: 'resolved prompt',
      startingMessage: undefined,
      sessionContext: undefined,
      preparedPayload: undefined,
      isSubagentOwned: false,
      consumedPreviousProviderSession: false,
      promptTypeChanged: false,
    }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: () => Promise.resolve(),
}));

const makeSession = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'provider-session-1',
    provider_conversation_id: null,
    provider_session_agent_id: 'coding_freeform',
    status: 'ACTIVE',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    promptType: 'coding_freeform',
  }) as unknown as AgenticSession;

const makeRunArgs = (session: AgenticSession = makeSession()): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session,
  hasProviderSession: true,
  skipProjectAssistant: true,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('message-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeSessionRunner = (
  discardSession?: AgentSessionRunner['discardSession'],
): AgentSessionRunner => ({
  runPrompt: vi.fn(),
  resumeSession: vi.fn(),
  promptOnce: vi.fn(),
  getContextUsage: vi.fn(),
  ...(discardSession ? { discardSession } : {}),
});

const makeCollaborators = (
  pickRunner: (ctx: RunnerContext) => Runner = () => ({ run: () => Promise.resolve() }),
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership((promptType) =>
    promptType === 'coding_freeform' ? handler : undefined,
  ),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: makeLogger(),
});

const makeRegistry = (
  collaborators: RunCollaborators,
  inactivityTimeoutMs = 0,
  forgetRun: (runId: string) => void = vi.fn(),
  runLifecycleEvents: RunLifecycleEvents = new RunLifecycleEvents(),
): RunRegistry => {
  const sessionRunnerFacade = createTestSessionRunnerFacade();
  vi.mocked(sessionRunnerFacade.forgetRun).mockImplementation(forgetRun);
  return new RunRegistry({
    runCollaborators: collaborators,
    submissionToolRegistry: collaborators.submissionToolRegistry,
    sessionRunnerFacade,
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents,
    ...(inactivityTimeoutMs > 0 ? { inactivityTimeoutMs } : {}),
  });
};

const makeInput = (): InternalRunPromptRequest => ({
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: 'continue' },
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

const finishOneTurn = async (run: Run): Promise<void> => {
  await run.handleMessage(makeInput());
  await run.awaitIdle();
};

describe('Run idle reaping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases and evicts an idle Run while preserving resumable provider identity', async () => {
    const session = makeSession();
    const collaborators = makeCollaborators();
    const registry = makeRegistry(collaborators, 1_000);
    const run = registry.create(makeRunArgs(session));
    const discardSession = vi.fn().mockResolvedValue(undefined);
    run.setRunner(makeSessionRunner(discardSession));

    await finishOneTurn(run);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(discardSession).toHaveBeenCalledOnce();
    expect(registry.get(run.runId)).toBeNull();
    expect(session.provider_session_id).toBe('provider-session-1');
    expect(session.status).toBe('ACTIVE');

    const replacement = registry.create(makeRunArgs(session));
    expect(replacement).not.toBe(run);
    expect(replacement.hasProviderSession).toBe(true);

    const runner = makeSessionRunner();
    const picker = new RunnerPicker({
      sessionRunnerFacade: createTestSessionRunnerFacade(runner),
      oauthClient: createRunTestOAuthClient(),
      logger: makeLogger(),
      runChangedFilesReader: createTestRunChangedFilesReader(),
      submissionToolRegistry: collaborators.submissionToolRegistry,
      localAgentEndpoint: new LocalAgentEndpoint(),
    });
    const picked = picker.pick({
      run: replacement,
      handler,
      resolvedPrompt: 'next turn',
      input: makeInput(),
      cwd: '/tmp',
      effectiveModel: null,
      effectiveReasoningEffort: null,
      priorReports: [],
    });
    expect(picked).toBeInstanceOf(ResumeRunner);
  });

  it('cancels the timer for new work and starts a fresh interval after that turn ends', async () => {
    let turnNumber = 0;
    let finishSecondTurn!: () => void;
    const secondTurn = new Promise<void>((resolve) => {
      finishSecondTurn = resolve;
    });
    const collaborators = makeCollaborators(() => ({
      run: async () => {
        turnNumber += 1;
        if (turnNumber === 2) await secondTurn;
      },
    }));
    const registry = makeRegistry(collaborators, 1_000);
    const run = registry.create(makeRunArgs());
    const discardSession = vi.fn().mockResolvedValue(undefined);
    run.setRunner(makeSessionRunner(discardSession));

    await finishOneTurn(run);
    await vi.advanceTimersByTimeAsync(900);

    await run.handleMessage(makeInput());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run.isProcessing).toBe(true);
    expect(discardSession).not.toHaveBeenCalled();
    expect(registry.get(run.runId)).toBe(run);

    finishSecondTurn();
    await run.awaitIdle();
    await vi.advanceTimersByTimeAsync(999);
    expect(discardSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(discardSession).toHaveBeenCalledOnce();
  });

  it('waits for provider release and keeps the Run when new work arrives during reaping', async () => {
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let turnCount = 0;
    const collaborators = makeCollaborators(() => ({
      run: () => {
        turnCount += 1;
        return Promise.resolve();
      },
    }));
    const registry = makeRegistry(collaborators, 1_000);
    const run = registry.create(makeRunArgs());
    const discardSession = vi.fn(() => providerRelease);
    run.setRunner(makeSessionRunner(discardSession));

    await finishOneTurn(run);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(registry.get(run.runId)).toBe(run);

    const nextMessage = run.handleMessage(makeInput());
    await vi.advanceTimersByTimeAsync(0);
    expect(turnCount).toBe(1);

    releaseProvider();
    await nextMessage;
    await run.awaitIdle();

    expect(turnCount).toBe(2);
    expect(registry.get(run.runId)).toBe(run);
    expect(discardSession).toHaveBeenCalledOnce();
  });

  it('keeps the Run registered and retries later when provider release fails', async () => {
    const collaborators = makeCollaborators();
    const forgetRun = vi.fn();
    const registry = makeRegistry(collaborators, 1_000, forgetRun);
    const run = registry.create(makeRunArgs());
    const discardSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('disconnect failed'))
      .mockResolvedValueOnce(undefined);
    run.setRunner(makeSessionRunner(discardSession));

    await finishOneTurn(run);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(registry.get(run.runId)).toBe(run);
    expect(forgetRun).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(registry.get(run.runId)).toBeNull();
    expect(forgetRun).toHaveBeenCalledOnce();
    expect(discardSession).toHaveBeenCalledTimes(2);
  });

  it('does not reap a Run after stop or cleanup', async () => {
    const stopRegistry = makeRegistry(makeCollaborators(), 1_000);
    const stoppedRun = stopRegistry.create(makeRunArgs());
    const stoppedDiscard = vi.fn().mockResolvedValue(undefined);
    stoppedRun.setRunner(makeSessionRunner(stoppedDiscard));
    await finishOneTurn(stoppedRun);
    await stoppedRun.stop();

    const cleanupRegistry = makeRegistry(makeCollaborators(), 1_000);
    const cleanedRun = cleanupRegistry.create(makeRunArgs());
    const cleanedDiscard = vi.fn().mockResolvedValue(undefined);
    cleanedRun.setRunner(makeSessionRunner(cleanedDiscard));
    await finishOneTurn(cleanedRun);
    cleanedRun.cleanup();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(stoppedDiscard).not.toHaveBeenCalled();
    expect(cleanedDiscard).not.toHaveBeenCalled();
  });

  it('logs an error and keeps the Run registered when discard is unsupported', async () => {
    const collaborators = makeCollaborators();
    const errorLog = vi.spyOn(collaborators.logger, 'error');
    const registry = makeRegistry(collaborators, 1_000);
    const run = registry.create(makeRunArgs());
    run.setRunner(makeSessionRunner());

    await finishOneTurn(run);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(registry.get(run.runId)).toBe(run);
    expect(errorLog).toHaveBeenCalledWith(
      'local.run.idle_reap.discard_session_unsupported',
      expect.objectContaining({ runId: run.runId, provider: 'claude' }),
    );
  });

  it('publishes registration and removal for registry-owned lifecycle transitions', () => {
    const lifecycle = new RunLifecycleEvents();
    const registered: string[] = [];
    const removed: string[] = [];
    lifecycle.onRunRegistered((runId) => registered.push(runId));
    const causes: string[] = [];
    lifecycle.onRunRemoved((runId, cause) => {
      removed.push(runId);
      causes.push(cause);
    });
    const registry = makeRegistry(makeCollaborators(), 0, vi.fn(), lifecycle);

    const removedRun = registry.create(makeRunArgs());
    expect(registered).toEqual(['run-1']);
    expect(registry.remove('run-1', removedRun)).toBe(true);
    expect(removed).toEqual(['run-1']);
    expect(registry.remove('run-1', removedRun)).toBe(false);
    expect(removed).toEqual(['run-1']);

    const evictedRun = registry.create(makeRunArgs());
    expect(registry.claimAndEvict(evictedRun)).toBe(true);
    expect(removed).toEqual(['run-1', 'run-1']);

    registry.create({
      ...makeRunArgs(),
      runId: 'run-2',
      session: {
        ...makeSession(),
        agentic_session_id: 'run-2',
        contextMetadata: { ...makeSession().contextMetadata, agentSessionId: 'run-2' },
      },
    });
    registry.dispose();
    expect(removed).toEqual(['run-1', 'run-1', 'run-2']);
    expect(causes).toEqual(['permanent', 'idle', 'permanent']);
    registry.dispose();
    expect(removed).toEqual(['run-1', 'run-1', 'run-2']);
  });
});
