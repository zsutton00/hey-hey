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
import type { RepoMappingStore } from '../repo/index';
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
  resolvePrompt: async () => ({
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
  validateResolvedPromptReferences: async () => {},
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
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'free_form',
    payload: { promptType: 'free_form', userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerMessageId: null,
  }) as unknown as InternalRunPromptRequest;

// Build a minimal AgentSessionRunner with controllable getContextUsage / compact.
// The Turn.Runner returned by pickRunner is separate (it just runs the turn body);
// this AgentSessionRunner is set on the Run via run.setRunner() and is what
// maybeAutoCompact reads for token counts and compaction.
const makeAgentSessionRunner = (opts: {
  totalTokens?: number;
  compact?: () => Promise<void>;
  getContextUsageError?: Error;
}): AgentSessionRunner => {
  const getContextUsage = opts.getContextUsageError
    ? vi.fn().mockRejectedValue(opts.getContextUsageError)
    : vi
        .fn()
        .mockResolvedValue({ totalTokens: opts.totalTokens ?? 0 } as unknown as LocalContextData);

  const runner: Record<string, unknown> = { run: async () => {}, getContextUsage };
  if (opts.compact !== undefined) {
    runner['compact'] = vi.fn().mockImplementation(opts.compact);
  }
  return runner as unknown as AgentSessionRunner;
};

// --- Tests ---

describe('Run between-turns auto-compact watcher', () => {
  it('calls compact() exactly once when totalTokens exceeds the threshold', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 150_001, compact: compactImpl });

    const collaborators = makeCollaborators(() => ({ run: async () => {} }));
    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      collaborators,
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(compactImpl).toHaveBeenCalledTimes(1);
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('does not call compact() when autoCompact is disabled', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 200_000, compact: compactImpl });

    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: false } }),
      makeCollaborators(() => ({ run: async () => {} })),
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(compactImpl).not.toHaveBeenCalled();
  });

  it('does not call compact() when autoCompact is absent', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 200_000, compact: compactImpl });

    const run = new Run(
      makeRunArgs(),
      makeCollaborators(() => ({ run: async () => {} })),
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(compactImpl).not.toHaveBeenCalled();
  });

  it('does not call compact() when totalTokens is at or below the threshold', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 150_000, compact: compactImpl });

    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      makeCollaborators(() => ({ run: async () => {} })),
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    await run.awaitIdle();

    expect(compactImpl).not.toHaveBeenCalled();
  });

  it('degrades silently when getContextUsage() throws NOT_SUPPORTED', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({
      compact: compactImpl,
      getContextUsageError: new AgentSessionRunnerError('NOT_SUPPORTED', 'no live session'),
    });

    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      makeCollaborators(() => ({ run: async () => {} })),
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    // awaitIdle resolving without throwing confirms turn-end did not surface the error
    await expect(run.awaitIdle()).resolves.toBeUndefined();
    expect(compactImpl).not.toHaveBeenCalled();
  });

  it('degrades silently when the runner has no compact() (NOT_SUPPORTED from Run.compact)', async () => {
    // No compact method → Run.compact() throws NOT_SUPPORTED; watcher must swallow it
    const agentRunner = makeAgentSessionRunner({ totalTokens: 200_000 });

    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      makeCollaborators(() => ({ run: async () => {} })),
    );
    run.setRunner(agentRunner);

    await run.handleMessage(makeInput());
    await expect(run.awaitIdle()).resolves.toBeUndefined();
  });

  it('defense-in-depth: watcher skips when pending compact is set', async () => {
    // maybeAutoCompact() short-circuits when pending compact !== null so a
    // deferred external request and the watcher never both fire at the same
    // boundary. Validate the guard by wiring up an above-threshold runner,
    // enqueuing a mid-turn compact, and confirming runner.compact runs once.
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 200_000, compact: compactImpl });

    let signalRunning!: () => void;
    let signalFinish!: () => void;
    const runnerRunning = new Promise<void>((r) => {
      signalRunning = r;
    });
    const runnerFinish = new Promise<void>((r) => {
      signalFinish = r;
    });

    const collaborators = makeCollaborators(() => ({
      run: async () => {
        signalRunning();
        await runnerFinish;
      },
    }));
    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      collaborators,
    );
    run.setRunner(agentRunner);

    void run.handleMessage(makeInput());
    // Wait until the runner is executing — _processing is definitely true.
    await runnerRunning;

    const externalCompact = run.compaction.compact();

    signalFinish();
    await run.awaitIdle();
    await expect(externalCompact).resolves.toBeUndefined();

    // Deferred compact ran at turn-end; watcher saw deferredCompactFired and skipped.
    expect(compactImpl).toHaveBeenCalledTimes(1);
  });

  it('coalescing regression: pending external request prevents watcher double-trigger', async () => {
    const compactImpl = vi.fn().mockResolvedValue(undefined);
    const agentRunner = makeAgentSessionRunner({ totalTokens: 200_000, compact: compactImpl });

    let signalRunning!: () => void;
    let signalFinish!: () => void;
    const runnerRunning = new Promise<void>((r) => {
      signalRunning = r;
    });
    const runnerFinish = new Promise<void>((r) => {
      signalFinish = r;
    });

    const collaborators = makeCollaborators(() => ({
      run: async () => {
        signalRunning();
        await runnerFinish;
      },
    }));
    const run = new Run(
      makeRunArgs({ autoCompact: { enabled: true, threshold: 150_000 } }),
      collaborators,
    );
    run.setRunner(agentRunner);

    void run.handleMessage(makeInput());
    // Wait until the runner is executing — _processing is definitely true.
    await runnerRunning;

    // Two external callers coalesce onto the same deferred entry.
    const first = run.compaction.compact();
    const second = run.compaction.compact({ silent: true });

    signalFinish();
    await run.awaitIdle();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    // One runner.compact invocation total — deferred drain fires it; watcher
    // sees deferredCompactFired and skips.
    expect(compactImpl).toHaveBeenCalledTimes(1);
  });
});
