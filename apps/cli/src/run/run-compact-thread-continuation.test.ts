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
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';

// The capstone end-to-end test for the "long conversations survive" stage:
// the between-turns auto-compact watcher, the silent flag, the message queue,
// and drainQueue must compose so a turn enqueued *during* an automatic compact
// resumes losslessly on the other side — same thread, no user-visible notes.
//
// Bypass resolver / registry / reference validator so Run drives end-to-end
// without REST or subagent overhead (mirrors run-compact-watcher.test.ts).

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
  autoCompact: { enabled: true, threshold: 150_000 },
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

const responsesFrom = (poster: RunCollaborators['poster']): string[] => {
  const mock = poster.createOutOfBand as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls.map((args) => {
    const [first] = args as [{ dto: { data: { response: string } } }];
    return first.dto.data.response;
  });
};

// --- Tests ---

describe('Run thread continuation across an automatic compact', () => {
  it('enqueues a turn during a silent auto-compact and drains it losslessly afterward', async () => {
    // Records the interleaving of turn bodies and the compact across the whole
    // sequence, so the order assertion proves the second turn cannot start
    // until compact resolves.
    const order: string[] = [];
    let turnCount = 0;

    // The compact stub blocks on a promise the test controls, so the test can
    // enqueue a fresh turn while compaction is genuinely in flight.
    let signalCompactRunning!: () => void;
    let signalCompactFinish!: () => void;
    const compactRunning = new Promise<void>((r) => {
      signalCompactRunning = r;
    });
    const compactFinish = new Promise<void>((r) => {
      signalCompactFinish = r;
    });
    const compactImpl = vi.fn().mockImplementation(async () => {
      order.push('compact-start');
      signalCompactRunning();
      await compactFinish;
      order.push('compact-end');
    });

    // getContextUsage is read at every turn boundary. Above threshold once (so
    // the first turn-end fires compact), then below (so the second turn-end is
    // a no-op) — mirrors a real compact lowering the token count.
    const getContextUsage = vi
      .fn()
      .mockResolvedValueOnce({ totalTokens: 200_000 } as unknown as LocalContextData)
      .mockResolvedValue({ totalTokens: 0 } as unknown as LocalContextData);

    const agentRunner = {
      run: async () => {},
      compact: compactImpl,
      getContextUsage,
    } as unknown as AgentSessionRunner;

    const collaborators = makeCollaborators(() => ({
      run: async () => {
        order.push(`turn-run-${++turnCount}`);
      },
    }));
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner(agentRunner);

    // Turn 1: float it — startTurn fire-and-forgets the turn body, and the
    // compact happens inside the awaited onTurnEnded chain.
    void run.handleMessage(makeInput());

    // Sync to the exact moment compaction is in flight.
    await compactRunning;

    // The thread continues here: enqueue a fresh user message *during* the
    // compact. Use enqueue() directly, not handleMessage — onTurnEnded already
    // cleared _processing before maybeAutoCompact ran, so handleMessage would
    // start a turn immediately instead of queueing it behind the compact.
    run.enqueue(makeInput());

    // Other side of the compaction: let it finish and drain.
    signalCompactFinish();
    await run.awaitIdle();

    // Compaction happened exactly once, and silently.
    expect(compactImpl).toHaveBeenCalledTimes(1);
    const responses = responsesFrom(collaborators.poster);
    expect(responses).not.toContain('Starting compact…');
    expect(responses).not.toContain('Finished compact…');
    expect(responses.some((r) => r.startsWith('Compact failed'))).toBe(false);
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();

    // The enqueued turn ran exactly once, strictly after compact resolved.
    expect(turnCount).toBe(2);
    expect(order).toEqual(['turn-run-1', 'compact-start', 'compact-end', 'turn-run-2']);

    // Same thread, not a restart: both turn-ends read the same bound runner,
    // which still backs the Run after the second turn.
    expect(getContextUsage).toHaveBeenCalledTimes(2);
    expect(run.runner).toBe(agentRunner);
  });

  it('below threshold: the watcher does not fire and a turn enqueued mid-turn drains normally', async () => {
    const order: string[] = [];
    let turnCount = 0;

    const compactImpl = vi.fn().mockResolvedValue(undefined);
    // Stays at the threshold (not above) for every boundary — the watcher must
    // never fire.
    const getContextUsage = vi
      .fn()
      .mockResolvedValue({ totalTokens: 150_000 } as unknown as LocalContextData);

    const agentRunner = {
      run: async () => {},
      compact: compactImpl,
      getContextUsage,
    } as unknown as AgentSessionRunner;

    // Pause the first turn body so a fresh message can be enqueued while a turn
    // is genuinely in flight — exercising the same queue-drain path as the
    // positive case, but with no compact in the middle.
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
        const n = ++turnCount;
        order.push(`turn-run-${n}`);
        if (n === 1) {
          signalRunning();
          await runnerFinish;
        }
      },
    }));
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner(agentRunner);

    void run.handleMessage(makeInput());
    // First turn body is now in flight (_processing is true).
    await runnerRunning;

    // Enqueue a fresh turn while the first turn is still running.
    run.enqueue(makeInput());

    signalFinish();
    await run.awaitIdle();

    expect(compactImpl).not.toHaveBeenCalled();
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
    expect(order).toEqual(['turn-run-1', 'turn-run-2']);
    expect(getContextUsage).toHaveBeenCalledTimes(2);
    expect(run.runner).toBe(agentRunner);
  });
});
