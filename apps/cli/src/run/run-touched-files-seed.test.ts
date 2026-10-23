import { makeTestTurn } from './handlers/__test-utils';
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
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunStore } from '../run-store/run-store';
import type { RepoMappingStore } from '../repo/index';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    services: [{ id: 'svc-1', path: '/abs/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
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

interface RunStoreOverrides {
  getTouchedFiles?: RunStore['getTouchedFiles'];
  getFileChangeFacts?: RunStore['getFileChangeFacts'];
  appendFileChangeFacts?: RunStore['appendFileChangeFacts'];
  replaceFileChangeFacts?: RunStore['replaceFileChangeFacts'];
}

const makeRunStore = (overrides: RunStoreOverrides): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'getTouchedFiles').mockImplementation(
    overrides.getTouchedFiles ?? (async () => []),
  );
  vi.spyOn(store, 'getFileChangeFacts').mockImplementation(
    overrides.getFileChangeFacts ?? (async () => []),
  );
  vi.spyOn(store, 'appendFileChangeFacts').mockImplementation(
    overrides.appendFileChangeFacts ?? (async () => undefined),
  );
  vi.spyOn(store, 'replaceFileChangeFacts').mockImplementation(
    overrides.replaceFileChangeFacts ?? (async () => undefined),
  );
  return store;
};

const makeCollaborators = (runStore: RunStoreOverrides): RunCollaborators => ({
  runStore: makeRunStore(runStore),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
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

describe('Run touched-files seed', () => {
  it('rehydrates canonical facts and their persisted projection on construction', async () => {
    const persisted = ['/abs/repo/src/foo.ts', '/abs/repo/src/bar.ts'];
    const getTouchedFiles = vi.fn().mockResolvedValue(persisted);
    const getFileChangeFacts = vi.fn().mockResolvedValue([
      {
        factId: 'fact-1',
        runId: 'run-1',
        turnId: 'turn-1',
        provider: 'claude',
        providerSessionId: 'prov-1',
        providerThreadId: null,
        providerTurnId: null,
        serviceId: 'svc-1',
        repoRelativePath: 'src/foo.ts',
        occurredAt: '2026-01-01T00:00:00.000Z',
        evidence: { kind: 'baseline', diff: 'patch', baselineContent: null, postContent: 'foo' },
      },
    ]);

    const run = new Run(makeRunArgs(), makeCollaborators({ getTouchedFiles, getFileChangeFacts }));

    await run.ensureSeeded();

    // The set is read from the store with the Run's own id and rehydrated.
    expect(getTouchedFiles).toHaveBeenCalledWith('run-1');
    expect(run.getRunLifetimeTouchedFiles()).toEqual(persisted);
    expect(run.getFileChangeProjection()).toEqual([
      { serviceId: 'svc-1', repoRelativePath: 'src/foo.ts' },
    ]);
  });

  it('seeds an empty set when nothing was persisted', async () => {
    const getTouchedFiles = vi.fn().mockResolvedValue([]);
    const getFileChangeFacts = vi.fn().mockResolvedValue([]);

    const run = new Run(makeRunArgs(), makeCollaborators({ getTouchedFiles, getFileChangeFacts }));

    await run.ensureSeeded();

    expect(run.getRunLifetimeTouchedFiles()).toEqual([]);
  });

  it('logs a warning and leaves the set empty when the store read rejects', async () => {
    const getTouchedFiles = vi.fn().mockRejectedValue(new Error('boom'));
    const getFileChangeFacts = vi.fn().mockResolvedValue([]);
    const collaborators = makeCollaborators({ getTouchedFiles, getFileChangeFacts });

    const run = new Run(makeRunArgs(), collaborators);

    await run.ensureSeeded();

    expect(run.getRunLifetimeTouchedFiles()).toEqual([]);
    expect(collaborators.logger.warn).toHaveBeenCalledWith(
      'local.run.file_change_facts.seed_failed',
      expect.objectContaining({ runId: 'run-1', error: 'boom' }),
    );
  });

  it('rejects Codex file changes whose native thread or turn does not match', async () => {
    const appendFileChangeFacts = vi.fn().mockResolvedValue(undefined);
    const run = new Run(
      makeRunArgs({
        provider: 'codex',
        session: makeSession({
          provider: 'codex',
          provider_session_id: 'provider-1',
          provider_conversation_id: 'thread-1',
        }),
      }),
      makeCollaborators({ appendFileChangeFacts }),
    );
    await run.ensureSeeded();
    run.setActiveTurn(makeTestTurn(undefined, 'turn-1'));

    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'thread/started',
        timestamp: '2026-01-01T00:00:00.000Z',
        sessionId: 'provider-1',
        agentId: 'codex',
        payload: {
          messageType: 'provider_event',
          routing: { thread_id: 'thread-1' },
        },
      },
    });
    run.onAgentOutput({
      event: {
        source: 'provider',
        eventType: 'turn/started',
        timestamp: '2026-01-01T00:00:01.000Z',
        sessionId: 'provider-1',
        agentId: 'codex',
        payload: {
          messageType: 'provider_event',
          routing: { thread_id: 'thread-1', turn_id: 'provider-turn-1' },
        },
      },
    });

    await run.recordFileChanges({
      runId: 'run-1',
      provider: 'codex',
      providerSessionId: 'provider-1',
      providerThreadId: 'thread-other',
      providerTurnId: 'provider-turn-1',
      paths: ['src/a.ts'],
      occurredAt: '2026-01-01T00:00:02.000Z',
      providerPatch: 'patch',
    });

    expect(appendFileChangeFacts).not.toHaveBeenCalled();
  });
});
