import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from '../run/run.test-support';
import { Run, type RunArgs, type RunCollaborators } from '../run/run';
import type { AgenticSession, PreviousProviderSession } from '../session/types';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunStore } from '../run-store/run-store';

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    serviceId: 'svc-1',
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

interface RunStoreSpy {
  store: RunStore;
  updateRunPreviousProviderSession: ReturnType<typeof vi.fn>;
}

const makeRunStoreSpy = (
  options: { rejectClear?: boolean; rejectWrite?: boolean } = {},
): RunStoreSpy => {
  const updateRunPreviousProviderSession = vi.fn(
    async (_runId: string, summary: PreviousProviderSession | null) => {
      if (summary === null && options.rejectClear) throw new Error('clear failed');
      if (summary !== null && options.rejectWrite) throw new Error('write failed');
      return makeSession({ previousProviderSession: summary });
    },
  );
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockImplementation(
    updateRunPreviousProviderSession,
  );
  return {
    updateRunPreviousProviderSession,
    store,
  };
};

const makeCollaborators = (runStore: RunStore): RunCollaborators => ({
  runStore,
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

describe('Run.recordPreviousProviderSession', () => {
  it('updates run.session.previousProviderSession in memory and fires the run-store update', async () => {
    const spy = makeRunStoreSpy();
    const run = new Run(makeRunArgs(), makeCollaborators(spy.store));

    const summary: PreviousProviderSession = {
      promptType: 'startup_session',
      lastMessage: '## Prior plan',
      completedAt: '2026-04-26T01:00:00.000Z',
    };

    run.recordPreviousProviderSession(summary);
    expect(run.session.previousProviderSession).toEqual(summary);

    // fire-and-forget — let the microtask flush
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spy.updateRunPreviousProviderSession).toHaveBeenCalledWith('run-1', summary);
  });
});

describe('Run.consumePreviousProviderSession', () => {
  it('returns the prior value, clears it in memory, and persists null', async () => {
    const summary: PreviousProviderSession = {
      promptType: 'startup_session',
      lastMessage: '## Prior plan',
      completedAt: '2026-04-26T01:00:00.000Z',
    };
    const spy = makeRunStoreSpy();
    const run = new Run(
      makeRunArgs({ session: makeSession({ previousProviderSession: summary }) }),
      makeCollaborators(spy.store),
    );

    const consumed = await run.consumePreviousProviderSession();

    expect(consumed).toEqual(summary);
    expect(run.session.previousProviderSession).toBeNull();
    expect(spy.updateRunPreviousProviderSession).toHaveBeenCalledWith('run-1', null);
  });

  it('returns null and skips persistence when nothing is recorded', async () => {
    const spy = makeRunStoreSpy();
    const run = new Run(makeRunArgs(), makeCollaborators(spy.store));

    const consumed = await run.consumePreviousProviderSession();
    expect(consumed).toBeNull();
    expect(spy.updateRunPreviousProviderSession).not.toHaveBeenCalled();
  });
});
