import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { AgentSessionRunner } from '../agents/providers/session-runner';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';

// Bypass resolver / registry / reference validator so handleMessage can drive
// Run end-to-end without REST or subagent overhead.

const handlerStub: PromptTypeHandler<unknown> = {
  id: 'free_form',
  promptType: 'free_form',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'unused',
};

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: () =>
    Promise.resolve({
      resolvedPrompt: 'resolved',
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

// --- Fixtures ---

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
    },
    events: [],
    promptType: null,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  hasProviderSession: true,
  skipProjectAssistant: true,
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunTriggerContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getTouchedFiles').mockResolvedValue([]);
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (pickRunner: (ctx: RunnerContext) => Runner): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(() => handlerStub),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: {
    trace: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
});

const makeInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'free_form',
    payload: { promptType: 'free_form', userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerMessageId: null,
  }) as unknown as InternalRunPromptRequest;

// Build an AgentSessionRunner whose context reading can change after compaction,
// with a resume-path spy so tests can prove the turn-end read never resumes.
const makeAgentSessionRunner = (opts: {
  readings?: number[];
  compact?: boolean;
  getContextUsageError?: Error;
  maxTokens?: number;
}) => {
  const readings = [...(opts.readings ?? [0])];
  const getContextUsage = opts.getContextUsageError
    ? vi.fn().mockRejectedValue(opts.getContextUsageError)
    : vi.fn(() => {
        const totalTokens = (readings.length > 1 ? readings.shift() : readings[0]) ?? 0;
        return Promise.resolve({
          totalTokens,
          maxTokens: opts.maxTokens ?? 0,
        } as unknown as LocalContextData);
      });
  const getContextUsageByResume = vi.fn();
  const runner: Record<string, unknown> = {
    run: () => Promise.resolve(),
    getContextUsage,
    getContextUsageByResume,
  };
  if (opts.compact) runner['compact'] = vi.fn().mockResolvedValue(undefined);
  return {
    runner: runner as unknown as AgentSessionRunner,
    getContextUsage,
    getContextUsageByResume,
  };
};

// Real sessions record each confirmed provider session in history under its
// owning handler; the turn-end read targets the latest context-counted entry.
// A bare id is a legacy entry with no owning handler, which counts.
const makeSessionWithHistory = (
  ...entries: Array<string | [providerSessionId: string, providerSessionAgentId: string]>
): AgenticSession => ({
  ...makeSession(),
  provider_session_history: entries.map((entry) => {
    const [providerSessionId, providerSessionAgentId] =
      typeof entry === 'string' ? [entry, null] : entry;
    return {
      providerSessionId,
      providerConversationId: null,
      providerSessionAgentId,
      observedAt: '2026-10-05T00:00:00.000Z',
    };
  }),
});

const runOneTurn = async (
  agentRunner: AgentSessionRunner,
  args: Partial<RunArgs> = {},
  session: AgenticSession = makeSessionWithHistory('prov-1'),
) => {
  const emit = vi.fn();
  const collaborators = {
    ...makeCollaborators(() => ({ run: () => Promise.resolve() })),
    broadcaster: createTestRunEventPublisher({ emitAgentSessionContextSizeObservation: emit }),
  };
  const run = new Run(makeRunArgs({ session, ...args }), collaborators);
  run.setRunner(agentRunner);
  await run.handleMessage(makeInput());
  await expect(run.awaitIdle()).resolves.toBeUndefined();
  return emit;
};

describe('Run turn-end context size publication', () => {
  it('publishes the latest provider session context size after a normal turn', async () => {
    const { runner, getContextUsage } = makeAgentSessionRunner({ readings: [42_000] });

    const emit = await runOneTurn(runner);

    expect(getContextUsage).toHaveBeenCalledWith('prov-1');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: 'agent-session-1',
        runId: 'run-1',
        providerSessionId: 'prov-1',
        totalTokens: 42_000,
      }),
    );
  });

  it('publishes the model context window when the provider reports one', async () => {
    const { runner } = makeAgentSessionRunner({ readings: [42_000], maxTokens: 258_000 });

    const emit = await runOneTurn(runner);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 42_000, maxTokens: 258_000 }),
    );
  });

  it('omits the context window when the provider reports none', async () => {
    const { runner } = makeAgentSessionRunner({ readings: [42_000], maxTokens: 0 });

    const emit = await runOneTurn(runner);

    expect(emit.mock.calls[0]?.[0]).not.toHaveProperty('maxTokens');
  });

  it('targets the last provider_session_history entry when present', async () => {
    const { runner, getContextUsage } = makeAgentSessionRunner({ readings: [10] });
    const emit = await runOneTurn(runner, {}, makeSessionWithHistory('prov-old', 'prov-latest'));

    expect(getContextUsage).toHaveBeenCalledWith('prov-latest');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'prov-latest', totalTokens: 10 }),
    );
  });

  it.each([
    ['Review', 'code_review'],
    ['commit', 'commit'],
    ['final assessment', 'final_assessment'],
  ])(
    'keeps the previous counted session after a %s session joins history',
    async (_label, agentId) => {
      const { runner, getContextUsage } = makeAgentSessionRunner({ readings: [10] });
      const emit = await runOneTurn(
        runner,
        {},
        makeSessionWithHistory(['prov-1', 'free_form'], ['one-off-session', agentId]),
      );

      expect(getContextUsage).toHaveBeenCalledWith('prov-1');
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ providerSessionId: 'prov-1', totalTokens: 10 }),
      );
    },
  );

  it('publishes the coding plan reading captured before its session disconnected', async () => {
    const codingPlanHandler: PromptTypeHandler<unknown> = {
      id: 'startup_session',
      promptType: 'startup_session',
      service: 'required',
      launchEntity: 'required',
      implementationReadiness: 'gated',
      runnerKind: 'subagent',
      providerSessionCountsForContext: true,
      subagentConfig: { mcpAllowedTools: [], builtinAllowedTools: [], adapterId: 'coding-plan' },
      reports: [],
      buildPrompt: () => 'unused',
    };
    const session = makeSessionWithHistory(['prov-1', 'free_form']);
    const runStore = makeRunStore();
    const appendHistory = vi
      .spyOn(runStore, 'appendRunProviderSessionHistory')
      .mockImplementation((_runId, entry) => {
        session.provider_session_history = [...(session.provider_session_history ?? []), entry];
        return Promise.resolve({ ...session });
      });
    const emitContextSize = vi.fn();
    const emitProviderIdentity = vi.fn();
    const { runner: liveRunner, getContextUsage } = makeAgentSessionRunner({ readings: [99] });
    const pickRunner = (ctx: RunnerContext): Runner => ({
      run: () => {
        const turnId = ctx.turnId;
        if (!turnId) throw new Error('Expected a Turn id.');
        ctx.run.onActiveTurnAgentOutput(turnId, {
          event: {
            source: 'provider',
            eventType: 'system',
            timestamp: '2026-10-05T00:00:01.000Z',
            sessionId: 'plan-session',
            agentId: 'claude',
            payload: { messageType: 'provider_event' },
          },
        });
        ctx.run.compaction.recordSubagentContextReading(turnId, {
          providerSessionId: 'plan-session',
          usage: { totalTokens: 7_000, maxTokens: 200_000 } as unknown as LocalContextData,
        });
        return Promise.resolve();
      },
    });
    const run = new Run(makeRunArgs({ session }), {
      ...makeCollaborators(pickRunner),
      ...createTestRunOwnership(() => codingPlanHandler),
      runStore,
      broadcaster: createTestRunEventPublisher({
        emitAgentSessionContextSizeObservation: emitContextSize,
        emitProviderIdentity,
      }),
    });
    run.setRunner(liveRunner);

    await run.handleMessage({
      ...makeInput(),
      promptType: 'startup_session',
      payload: { promptType: 'startup_session' },
    } as unknown as InternalRunPromptRequest);
    await expect(run.awaitIdle()).resolves.toBeUndefined();

    expect(appendHistory).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        providerSessionId: 'plan-session',
        providerSessionAgentId: 'startup_session',
      }),
    );
    expect(getContextUsage).not.toHaveBeenCalled();
    expect(emitContextSize).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'plan-session',
        totalTokens: 7_000,
        maxTokens: 200_000,
      }),
    );
    // The coding plan never becomes the Run's session or announced identity.
    expect(run.providerSessionId).toBe('prov-1');
    expect(emitProviderIdentity).not.toHaveBeenCalled();
  });

  it('publishes the post-compaction value when auto-compact fires', async () => {
    const { runner } = makeAgentSessionRunner({ readings: [200_000, 30_000], compact: true });

    const emit = await runOneTurn(runner, {
      autoCompact: { enabled: true, threshold: 150_000 },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 30_000 }));
  });

  it.each(['NOT_SUPPORTED', 'NO_ACTIVE_SESSION'] as const)(
    'skips without throwing when the runner reports %s',
    async (code) => {
      const { runner } = makeAgentSessionRunner({
        getContextUsageError: new AgentSessionRunnerError(code, 'unavailable'),
      });

      const emit = await runOneTurn(runner);

      expect(emit).not.toHaveBeenCalled();
    },
  );

  it('never reads through the resume path, so no provider is started', async () => {
    const { runner, getContextUsageByResume } = makeAgentSessionRunner({
      getContextUsageError: new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'idle'),
    });

    await runOneTurn(runner);

    expect(getContextUsageByResume).not.toHaveBeenCalled();
  });

  it('finishes the turn when auto-compaction has no context snapshot', async () => {
    const { runner } = makeAgentSessionRunner({
      getContextUsageError: new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'no snapshot'),
    });
    const emit = await runOneTurn(runner, {
      autoCompact: { enabled: true, threshold: 150_000 },
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('drains queued turns despite a failed context read', async () => {
    const { runner } = makeAgentSessionRunner({
      getContextUsageError: new AgentSessionRunnerError('NO_ACTIVE_SESSION', 'no snapshot'),
    });
    const executeTurn = vi.fn(async () => {});
    const run = new Run(
      makeRunArgs({
        session: makeSessionWithHistory('prov-1'),
        autoCompact: { enabled: true, threshold: 150_000 },
      }),
      makeCollaborators(() => ({ run: executeTurn })),
    );
    run.setRunner(runner);
    await Promise.all([run.handleMessage(makeInput()), run.handleMessage(makeInput())]);
    await expect(run.awaitIdle()).resolves.toBeUndefined();
    expect(executeTurn).toHaveBeenCalledTimes(2);
  });
});
