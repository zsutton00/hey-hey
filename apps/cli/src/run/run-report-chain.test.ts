import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunnerPicker,
  createTestTaskReportChainReader,
} from './run.test-support';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { resolvePrompt } from './resolve-prompt';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestRunStore,
} from '../agents/prompt-type-handler.test-support';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { ReportChainEntry } from './types';

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

const makeTaskRunArgs = (): RunArgs =>
  makeRunArgs({
    session: makeSession({
      entity: { entityType: 'TASK', entityId: 'task-1' },
      contextMetadata: {
        organizationId: 'org-1',
        projectId: 'proj-1',
        task: { id: 'stale-context-task' },
      } as AgenticSession['contextMetadata'],
    }),
  });

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeCollaborators = (): RunCollaborators => {
  const runStore = createPromptTypeHandlerTestRunStore();
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];
  return {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: makePoster(),
    broadcaster: makeBroadcaster(),
    ...createTestRunOwnership(),
    handlerDeps: createPromptTypeHandlerTestDeps({ runStore, logger }),
    runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
    logger,
  };
};

const makeEntry = (overrides?: Partial<ReportChainEntry>): ReportChainEntry => ({
  createdAt: '2026-04-26T01:00:00.000Z',
  phase: 'startup_session',
  reportId: 'rep-1',
  reportType: 'SESSION_SUMMARY',
  summary: 'first summary',
  audience: 'EXTERNAL',
  ...overrides,
});

describe('Run.readReportChain', () => {
  it('starts empty on a fresh Run', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    expect(run.readReportChain()).toEqual([]);
  });

  it('projects only identities appended during the requested Turn', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());
    run.appendReportChainEntry(makeEntry({ reportId: 'before-turn' }));
    (
      run as unknown as { _reportChainStartByTurn: Map<string, number> }
    )._reportChainStartByTurn.set('turn-1', 1);
    run.appendReportChainEntry(makeEntry({ reportId: 'turn-report-1' }));
    run.appendReportChainEntry(makeEntry({ reportId: 'turn-report-2' }));

    expect(run.readReportIdsForTurn('turn-1')).toEqual(['turn-report-1', 'turn-report-2']);
    expect(run.readReportIdsForTurn('missing-turn')).toEqual([]);
  });
});

describe('Run.appendReportChainEntry', () => {
  it('returns appended entries in insertion order', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());

    const first = makeEntry({ reportId: 'rep-1', summary: 'first' });
    const second = makeEntry({
      reportId: 'rep-2',
      summary: 'second',
      phase: 'plan_execution',
      createdAt: '2026-04-26T02:00:00.000Z',
    });

    run.appendReportChainEntry(first);
    run.appendReportChainEntry(second);

    const chain = run.readReportChain();
    expect(chain).toHaveLength(2);
    expect(chain[0]?.reportId).toBe('rep-1');
    expect(chain[1]?.reportId).toBe('rep-2');
    expect(chain[0]?.summary).toBe('first');
    expect(chain[1]?.summary).toBe('second');
  });

  it('keeps both entries when the same phase is re-entered', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());

    run.appendReportChainEntry(
      makeEntry({ reportId: 'rep-a', summary: 'first pass', phase: 'startup_session' }),
    );
    run.appendReportChainEntry(
      makeEntry({
        reportId: 'rep-b',
        summary: 'second pass',
        phase: 'startup_session',
        createdAt: '2026-04-26T03:00:00.000Z',
      }),
    );

    const chain = run.readReportChain();
    expect(chain).toHaveLength(2);
    expect(chain.map((e) => e.reportId)).toEqual(['rep-a', 'rep-b']);
    expect(chain.map((e) => e.summary)).toEqual(['first pass', 'second pass']);
  });

  it('does not let callers mutate the returned array or its entries', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());

    run.appendReportChainEntry(makeEntry({ reportId: 'rep-1', summary: 'original' }));

    const snapshot = run.readReportChain();

    // Mutating the returned array does not affect subsequent reads.
    (snapshot as ReportChainEntry[]).push(makeEntry({ reportId: 'rep-evil' }));
    expect(run.readReportChain()).toHaveLength(1);
    expect(run.readReportChain()[0]?.reportId).toBe('rep-1');

    // Mutating an entry returned from the snapshot is rejected (frozen).
    const entry = snapshot[0]!;
    expect(() => {
      (entry as { summary: string }).summary = 'tampered';
    }).toThrow();
    expect(run.readReportChain()[0]?.summary).toBe('original');
  });

  it('snapshots taken before further appends are not extended in place', () => {
    const run = new Run(makeRunArgs(), makeCollaborators());

    run.appendReportChainEntry(makeEntry({ reportId: 'rep-1' }));
    const earlySnapshot = run.readReportChain();

    run.appendReportChainEntry(
      makeEntry({ reportId: 'rep-2', createdAt: '2026-04-26T04:00:00.000Z' }),
    );

    expect(earlySnapshot).toHaveLength(1);
    expect(earlySnapshot[0]?.reportId).toBe('rep-1');
    expect(run.readReportChain()).toHaveLength(2);
  });
});

describe('Run.appendMemo', () => {
  it('logs runId, source, and content length on every append and persists through the run store', () => {
    const runStore = createPromptTypeHandlerTestRunStore();
    const appendRunMemo = vi.spyOn(runStore, 'appendRunMemo').mockResolvedValue(makeSession());
    const collaborators = {
      ...makeCollaborators(),
      runStore,
    };
    const run = new Run(makeRunArgs(), collaborators);

    run.appendMemo({
      source: 'project_assistant',
      content: 'frame + analysis',
      writtenAt: '2026-04-26T01:00:00.000Z',
    });

    expect(collaborators.logger.info).toHaveBeenCalledWith(
      'local.run.append_memo',
      expect.objectContaining({
        runId: 'run-1',
        source: 'project_assistant',
        contentLength: 'frame + analysis'.length,
      }),
    );
    expect(appendRunMemo).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ source: 'project_assistant' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Run.readReportChain → resolvePrompt: A→B→A re-entry path
//
// Verifies that when the same phase is re-entered after a different phase,
// resolvePrompt — fed the Run's chain snapshot — surfaces both prior entries
// (in insertion order) so the A-on-second-entry agent can read its own
// first-entry report.
// ---------------------------------------------------------------------------

type TestPromptType = NonNullable<InternalRunPromptRequest['promptType']>;
const asPromptType = (s: string): TestPromptType => s as TestPromptType;

const registeredPromptTypes: string[] = [];
const registeredHandlers = new Map<string, PromptTypeHandler<unknown>>();

const registerHandler = (
  promptType: string,
  handler: Pick<PromptTypeHandler<unknown>, 'buildPrompt'>,
): void => {
  registeredHandlers.set(promptType, {
    promptType,
    ...handler,
  } as PromptTypeHandler<unknown>);
  registeredPromptTypes.push(promptType);
};

afterEach(() => {
  for (const promptType of registeredPromptTypes) {
    registeredHandlers.delete(promptType);
  }
  registeredPromptTypes.length = 0;
});

const makeHandlerDeps = (): PromptTypeHandlerDeps => {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn((): unknown => logger),
  } as unknown as PromptTypeHandlerDeps['logger'];

  return createPromptTypeHandlerTestDeps({
    fetchImpl: (() => Promise.resolve(new Response())) as typeof fetch,
    apiBaseUrl: 'http://localhost',
    logger,
  });
};

describe('Run report chain seed', () => {
  const seedEntry = (overrides: Partial<ReportChainEntry>): ReportChainEntry => ({
    createdAt: '2026-04-01T00:00:00.000Z',
    phase: 'seeded' as ReportChainEntry['phase'],
    reportId: 'seed-1',
    reportType: 'IMPLEMENT' as ReportChainEntry['reportType'],
    summary: 'seed summary',
    audience: 'EXTERNAL',
    ...overrides,
  });

  it('does not invoke the fetcher when taskId is null', async () => {
    const fetcher = vi.fn();
    const collaborators = makeCollaborators();
    const run = new Run(makeRunArgs(), {
      ...collaborators,
      taskReportChainReader: createTestTaskReportChainReader(fetcher),
    });

    // Flush any pending microtasks so a buggy implementation has a chance to call.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetcher).not.toHaveBeenCalled();
    expect(run.readReportChain()).toEqual([]);
  });

  it('seeds the chain with fetched entries before the first handleMessage resolves', async () => {
    const entries = [
      seedEntry({ reportId: 'seed-a', summary: 'first' }),
      seedEntry({
        reportId: 'seed-b',
        summary: 'second',
        createdAt: '2026-04-02T00:00:00.000Z',
      }),
    ];
    const fetcher = vi.fn().mockResolvedValue(entries);
    const collaborators = makeCollaborators();
    const run = new Run(makeTaskRunArgs(), {
      ...collaborators,
      taskReportChainReader: createTestTaskReportChainReader(fetcher),
    });

    expect(fetcher).toHaveBeenCalledWith('task-1');

    // The handleMessage gate awaits the seed promise. Force enqueue mode by
    // marking the Run busy so handleMessage returns without firing a turn.
    run.isProcessing = true;
    await run.handleMessage({
      promptType: asPromptType('coding_freeform'),
      payload: { promptType: asPromptType('coding_freeform'), userMessage: 'noop' },
      references: { resolved: [], unresolved: [] },
    } as unknown as InternalRunPromptRequest);

    const chain = run.readReportChain();
    expect(chain).toHaveLength(2);
    expect(chain.map((e) => e.reportId)).toEqual(['seed-a', 'seed-b']);
    expect(chain.map((e) => e.summary)).toEqual(['first', 'second']);
  });

  it('appends live entries after seeded ones in insertion order', async () => {
    const seeded = [seedEntry({ reportId: 'seed-a' })];
    const fetcher = vi.fn().mockResolvedValue(seeded);
    const collaborators = makeCollaborators();
    const run = new Run(makeTaskRunArgs(), {
      ...collaborators,
      taskReportChainReader: createTestTaskReportChainReader(fetcher),
    });

    run.isProcessing = true;
    await run.handleMessage({
      promptType: asPromptType('coding_freeform'),
      payload: { promptType: asPromptType('coding_freeform'), userMessage: 'noop' },
      references: { resolved: [], unresolved: [] },
    } as unknown as InternalRunPromptRequest);

    run.appendReportChainEntry(
      makeEntry({
        reportId: 'live-1',
        summary: 'in-run',
        createdAt: '2026-04-26T05:00:00.000Z',
      }),
    );

    const chain = run.readReportChain();
    expect(chain.map((e) => e.reportId)).toEqual(['seed-a', 'live-1']);
  });

  it('logs a warning and leaves the chain empty when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'];
    const collaborators = { ...makeCollaborators(), logger };
    const run = new Run(makeTaskRunArgs(), {
      ...collaborators,
      taskReportChainReader: createTestTaskReportChainReader(fetcher),
    });

    run.isProcessing = true;
    await run.handleMessage({
      promptType: asPromptType('coding_freeform'),
      payload: { promptType: asPromptType('coding_freeform'), userMessage: 'noop' },
      references: { resolved: [], unresolved: [] },
    } as unknown as InternalRunPromptRequest);

    expect(run.readReportChain()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'local.run.report_chain.seed_failed',
      expect.objectContaining({ taskId: 'task-1', error: 'boom' }),
    );

    // Run still accepts subsequent appends after a seed failure.
    run.appendReportChainEntry(makeEntry({ reportId: 'live-after-failure' }));
    expect(run.readReportChain().map((e) => e.reportId)).toEqual(['live-after-failure']);
  });
});

describe('Run.readReportChain → resolvePrompt — A→B→A re-entry', () => {
  it('renders both prior phases in insertion order when a third A turn is resolved', async () => {
    const PHASE_A = 'rrc_phase_a';
    const PHASE_B = 'rrc_phase_b';

    registerHandler(PHASE_A, { buildPrompt: () => 'A_SYSTEM' });
    registerHandler(PHASE_B, { buildPrompt: () => 'B_SYSTEM' });
    const handlerA = registeredHandlers.get(PHASE_A)!;

    const run = new Run(makeRunArgs(), makeCollaborators());

    // First A turn produced this report; B's turn produced the second.
    run.appendReportChainEntry(
      makeEntry({
        reportId: 'rep-a1',
        phase: asPromptType(PHASE_A) as ReportChainEntry['phase'],
        summary: 'A first-pass body',
        createdAt: '2026-04-26T01:00:00.000Z',
      }),
    );
    run.appendReportChainEntry(
      makeEntry({
        reportId: 'rep-b1',
        phase: asPromptType(PHASE_B) as ReportChainEntry['phase'],
        summary: 'B body',
        createdAt: '2026-04-26T02:00:00.000Z',
      }),
    );

    const session: AgenticSession = makeSession();

    const result = await resolvePrompt({
      handler: handlerA,
      run: session,
      runState: {
        currentPromptType: PHASE_B,
        isFirstTurn: false,
        previousProviderSession: null,
        reportChain: run.readReportChain(),
        memos: [],
        startedPromptTypes: new Set(),
      },
      input: {
        promptType: asPromptType(PHASE_A),
        payload: { promptType: asPromptType(PHASE_A), userMessage: 're-entering A' },
        references: { resolved: [], unresolved: [] },
      } as unknown as InternalRunPromptRequest,
      handlerDeps: makeHandlerDeps(),
      turnId: 'turn-1',
      abortSignal: () => undefined,
      recentUserReplies: [],
      triggerParentMessageId: null,
    });

    const resolved = result.resolvedPrompt ?? '';
    expect(resolved).toContain('## Prior reports on this task');
    expect(resolved).toContain('rep-a1');
    expect(resolved).toContain('rep-b1');
    expect(resolved).toContain('A first-pass body');
    expect(resolved).toContain('B body');

    const aIdx = resolved.indexOf('rep-a1');
    const bIdx = resolved.indexOf('rep-b1');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });
});
