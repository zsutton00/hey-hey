import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type { RunStore } from '../run-store/run-store';
import type { RepoMappingStore } from '../repo/index';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import {
  AgentSessionRunnerError,
  type AgentSessionRunner,
} from '../agents/providers/session-runner';
import { MessageStatus, SystemMessageDataTypeEnum } from '../shared/api/index';
import type { RunEventPublisher } from '../server/run-event-publisher';

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

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'provider' as const,
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
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
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('note-msg-1'),
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

const makeCollaborators = (
  opts: {
    broadcaster?: RunEventPublisher;
    pickRunner?: (ctx: RunnerContext) => Runner;
  } = {},
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: opts.broadcaster ?? makeBroadcaster(),
  ...createTestRunOwnership(() => handlerStub),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(opts.pickRunner),
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

const makeRunnerWithCompact = (compact: () => Promise<void> = async () => {}): AgentSessionRunner =>
  ({ run: async () => {}, compact }) as unknown as AgentSessionRunner;

const responsesFrom = (poster: RunCollaborators['poster']): string[] => {
  const mock = poster.createOutOfBand as unknown as ReturnType<typeof vi.fn>;
  return mock.mock.calls.map((args) => {
    const [first] = args as [{ dto: { data: { response: string } } }];
    return first.dto.data.response;
  });
};

describe('Run.compact', () => {
  it('posts Starting then Finished on success, in order', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);

    const order: string[] = [];
    (collaborators.poster.createOutOfBand as ReturnType<typeof vi.fn>).mockImplementation(
      (args) => {
        order.push(`post:${(args as { dto: { data: { response: string } } }).dto.data.response}`);
        return Promise.resolve('note-msg');
      },
    );
    const compactSpy = vi.fn().mockImplementation(() => {
      order.push('compact');
      return Promise.resolve();
    });
    run.setRunner(makeRunnerWithCompact(compactSpy));

    await run.compaction.compact();

    expect(order).toEqual(['post:Starting compact…', 'compact', 'post:Finished compact…']);
    expect(compactSpy).toHaveBeenCalledTimes(1);
  });

  it('posts Starting and Finished as out-of-band Completed AGENT messages', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner(makeRunnerWithCompact());

    await run.compaction.compact();

    const mock = collaborators.poster.createOutOfBand as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);
    for (const call of mock.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          dto: expect.objectContaining({
            status: MessageStatus.Completed,
            data: expect.objectContaining({
              type: SystemMessageDataTypeEnum.Agent,
            }),
          }),
          stamp: null,
        }),
      );
    }
  });

  it('posts Starting then "Compact failed: <reason>" and rethrows when runner.compact throws', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    const failure = new AgentSessionRunnerError('RUN_FAILED', 'sdk timeout');
    run.setRunner(makeRunnerWithCompact(() => Promise.reject(failure)));

    await expect(run.compaction.compact()).rejects.toBe(failure);

    expect(responsesFrom(collaborators.poster)).toEqual([
      'Starting compact…',
      'Compact failed: sdk timeout',
    ]);
  });

  it('stringifies a non-Error throw into the failure reason', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner(makeRunnerWithCompact(() => Promise.reject('boom')));

    await expect(run.compaction.compact()).rejects.toBe('boom');

    expect(responsesFrom(collaborators.poster)).toEqual([
      'Starting compact…',
      'Compact failed: boom',
    ]);
  });

  it('throws NOT_SUPPORTED and posts nothing when no runner is bound', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);

    await expect(run.compaction.compact()).rejects.toSatisfy(
      (e: unknown) => e instanceof AgentSessionRunnerError && e.code === 'NOT_SUPPORTED',
    );
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
  });

  it('throws NOT_SUPPORTED and posts nothing when the bound runner has no compact()', async () => {
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), collaborators);
    run.setRunner({ run: async () => {} } as unknown as AgentSessionRunner);

    await expect(run.compaction.compact()).rejects.toSatisfy(
      (e: unknown) => e instanceof AgentSessionRunnerError && e.code === 'NOT_SUPPORTED',
    );
    expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
  });

  describe('deferred mid-Turn request', () => {
    // Helper: build a Run with a pausing runner that signals when it starts.
    const makeControlledTurn = (compactImpl: () => Promise<void>) => {
      let signalRunning!: () => void;
      let signalFinish!: () => void;
      const runnerRunning = new Promise<void>((r) => {
        signalRunning = r;
      });
      const runnerFinish = new Promise<void>((r) => {
        signalFinish = r;
      });

      const collaborators = makeCollaborators({
        pickRunner: () => ({
          run: async () => {
            signalRunning(); // turn is now in-flight
            await runnerFinish;
          },
        }),
      });
      const run = new Run(
        makeRunArgs({ hasProviderSession: true, skipProjectAssistant: true }),
        collaborators,
      );
      run.setRunner(makeRunnerWithCompact(compactImpl));

      return { run, collaborators, runnerRunning, signalFinish };
    };

    it('does not reject and resolves after the turn ends', async () => {
      const compactImpl = vi.fn().mockResolvedValue(undefined);
      const { run, runnerRunning, signalFinish } = makeControlledTurn(compactImpl);

      void run.handleMessage(makeInput());
      // Wait until the runner is executing — _processing is definitely true.
      await runnerRunning;

      const compactDone = run.compaction.compact();

      // Let the turn finish, which drains pending compact.
      signalFinish();
      await run.awaitIdle();

      await expect(compactDone).resolves.toBeUndefined();
      expect(compactImpl).toHaveBeenCalledTimes(1);
    });

    it('two concurrent mid-Turn callers both settle from a single runner.compact invocation', async () => {
      const compactImpl = vi.fn().mockResolvedValue(undefined);
      const { run, runnerRunning, signalFinish } = makeControlledTurn(compactImpl);

      void run.handleMessage(makeInput());
      await runnerRunning;

      const first = run.compaction.compact({ silent: true });
      const second = run.compaction.compact();

      signalFinish();
      await run.awaitIdle();

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      // Only one actual runner.compact invocation despite two waiters.
      expect(compactImpl).toHaveBeenCalledTimes(1);
    });

    it('non-silent caller overrides silent when coalescing — notes are posted', async () => {
      const compactImpl = vi.fn().mockResolvedValue(undefined);
      const { run, collaborators, runnerRunning, signalFinish } = makeControlledTurn(compactImpl);

      void run.handleMessage(makeInput());
      await runnerRunning;

      // Silent caller joins first, non-silent second.
      const silent = run.compaction.compact({ silent: true });
      const nonSilent = run.compaction.compact();

      signalFinish();
      await run.awaitIdle();
      await silent;
      await nonSilent;

      // Non-silent flag should win — Starting/Finished notes posted.
      expect(collaborators.poster.createOutOfBand).toHaveBeenCalled();
      expect(compactImpl).toHaveBeenCalledTimes(1);
    });

    it('above-threshold watcher and a pending external request invoke runner.compact exactly once', async () => {
      const compactImpl = vi.fn().mockResolvedValue(undefined);
      let signalRunning!: () => void;
      let signalFinish!: () => void;
      const runnerRunning = new Promise<void>((r) => {
        signalRunning = r;
      });
      const runnerFinish = new Promise<void>((r) => {
        signalFinish = r;
      });

      const collaborators = makeCollaborators({
        pickRunner: () => ({
          run: async () => {
            signalRunning();
            await runnerFinish;
          },
        }),
      });
      const run = new Run(
        makeRunArgs({
          hasProviderSession: true,
          skipProjectAssistant: true,
          autoCompact: { enabled: true, threshold: 150_000 },
        }),
        collaborators,
      );
      const agentRunner = {
        run: async () => {},
        compact: compactImpl,
        getContextUsage: vi.fn().mockResolvedValue({ totalTokens: 200_000 }),
      } as unknown as AgentSessionRunner;
      run.setRunner(agentRunner);

      void run.handleMessage(makeInput());
      await runnerRunning;

      // External compact request arrives mid-turn.
      const externalCompact = run.compaction.compact();

      signalFinish();
      await run.awaitIdle();

      await expect(externalCompact).resolves.toBeUndefined();
      // Deferred external compact fires; watcher sees deferredCompactFired and skips.
      expect(compactImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('silent mode', () => {
    it('suppresses all out-of-band notes on success', async () => {
      const collaborators = makeCollaborators();
      const run = new Run(makeRunArgs(), collaborators);
      const compactSpy = vi.fn().mockResolvedValue(undefined);
      run.setRunner(makeRunnerWithCompact(compactSpy));

      await run.compaction.compact({ silent: true });

      expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
      expect(compactSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses all out-of-band notes and still rethrows on failure', async () => {
      const collaborators = makeCollaborators();
      const run = new Run(makeRunArgs(), collaborators);
      const failure = new AgentSessionRunnerError('RUN_FAILED', 'sdk timeout');
      run.setRunner(makeRunnerWithCompact(() => Promise.reject(failure)));

      await expect(run.compaction.compact({ silent: true })).rejects.toBe(failure);

      expect(collaborators.poster.createOutOfBand).not.toHaveBeenCalled();
    });
  });
});
