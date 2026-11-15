/**
 * Run end-to-end tests for the handler-span report-emission contract.
 *
 * Reports are evaluated per *handler span* — the contiguous run of turns
 * under a single prompt-type handler — not per turn. The span finalizes on
 * handler swap or on `cleanup()` / `stop()`. A miss logs a warn; nothing
 * blocks the user-visible message.
 *
 * Driving the fake runner mutates Run state during `run()` (appending
 * report-chain entries, marking touched files); the assertions check
 * whether the warn fires at the right moment.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { makeCreateReportProxy } from '../agents/submission-tools/create-report-proxy.test-support';
import type { SubmissionToolDeclaration } from '../agents/submission-tools/types';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { ReportAudience, ReportType } from '../shared/api/index';
import { SessionRole, LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { RunnerContext } from './runners/types';
import type { Runner } from '../turn/turn';
import type { ReportChainEntry } from './types';

// --- Handler stubs ---------------------------------------------------------

const requiredHandler: PromptTypeHandler<unknown> = {
  id: 'startup_session',
  promptType: 'startup_session',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated',
  sessionRole: SessionRole.Implementation,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [
    {
      reportType: ReportType.SessionSummary,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
  ],
  buildPrompt: () => 'required-handler system prompt',
};

const otherRequiredHandler: PromptTypeHandler<unknown> = {
  id: 'feature_sync_analyze',
  promptType: 'feature_sync_analyze',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  sessionRole: SessionRole.Implementation,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [
    {
      reportType: ReportType.FeatureSync,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
  ],
  buildPrompt: () => 'analyze handler system prompt',
};

const freeFormHandler: PromptTypeHandler<unknown> = {
  id: 'free_form',
  promptType: 'free_form',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  sessionRole: SessionRole.Implementation,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  requiresChangedFileReporting: true,
  buildPrompt: () => 'free-form system prompt',
};

const codingFreeformHandler: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  sessionRole: SessionRole.Implementation,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  requiresChangedFileReporting: true,
  buildPrompt: () => 'coding-freeform system prompt',
};

const quickHandler: PromptTypeHandler<unknown> = {
  id: 'quick',
  promptType: 'quick',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  sessionRole: SessionRole.Implementation,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  requiresChangedFileReporting: true,
  buildPrompt: () => 'quick system prompt',
};

const getHandler = (promptType: string | undefined): PromptTypeHandler<unknown> | undefined => {
  if (promptType === 'startup_session') return requiredHandler;
  if (promptType === 'feature_sync_analyze') return otherRequiredHandler;
  if (promptType === 'free_form') return freeFormHandler;
  if (promptType === 'coding_freeform') return codingFreeformHandler;
  if (promptType === 'quick') return quickHandler;
  return undefined;
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

// --- Fixtures --------------------------------------------------------------

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'prov-existing',
    provider_conversation_id: 'conv-existing',
    status: 'idle',
    serviceId: null,
    services: [{ id: 'svc-1', path: testRepo() }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    promptType: null,
    ...overrides,
  }) as unknown as AgenticSession;

const makeRunArgs = (overrides?: Partial<RunArgs>): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
  hasProviderSession: true,
  ...overrides,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'appendFileChangeFacts').mockResolvedValue(undefined);
  vi.spyOn(store, 'appendDurableEvent').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeCollaborators = (
  pickRunner: (ctx: RunnerContext) => Runner,
  poster?: RunCollaborators['poster'],
  baseSubmissionTools?: SubmissionToolDeclaration[],
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: poster ?? makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(getHandler),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  ...(baseSubmissionTools ? { baseSubmissionTools } : {}),
  logger: {
    trace: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeInput = (
  promptType:
    | 'startup_session'
    | 'feature_sync_analyze'
    | 'free_form'
    | 'coding_freeform'
    | 'quick',
): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerMessageId: null,
  }) as unknown as InternalRunPromptRequest;

const assistantCompleteMessage = (summary: string) => ({
  event: {
    source: 'provider' as const,
    eventType: 'agent_output',
    timestamp: '2026-01-01T00:00:00.000Z',
    sessionId: 'prov-existing',
    agentId: 'claude',
    payload: { messageType: 'assistant', taskComplete: true, summary },
  },
});

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const makeChainEntry = (overrides?: Partial<ReportChainEntry>): ReportChainEntry => ({
  createdAt: '2026-04-26T01:00:00.000Z',
  phase: 'startup_session',
  reportId: 'rep-1',
  reportType: 'SESSION_SUMMARY',
  summary: 'span-emitted summary',
  audience: 'EXTERNAL',
  ...overrides,
});

const findWarn = (collaborators: RunCollaborators, event: string): { args: unknown[] } | null => {
  const warnLogger = collaborators.logger.warn as ReturnType<typeof vi.fn>;
  const call = warnLogger.mock.calls.find((c) => c[0] === event);
  return call ? { args: call } : null;
};

const makeCreateReportTool = () => {
  const proxy = makeCreateReportProxy();
  vi.mocked(proxy.create).mockResolvedValue({ reportId: 'implement-report-1', content: [] });
  return { tool: new CreateReportTool(proxy), execute: vi.mocked(proxy.create) };
};

let repo: string | null = null;
/** One git repository for the Service, so recorded edits carry real evidence. */
const testRepo = (): string => {
  if (repo === null) {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-report-enforcement-')));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'readme\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'init'],
      { cwd: repo },
    );
  }
  return repo;
};

afterAll(() => {
  if (repo !== null) fs.rmSync(repo, { recursive: true, force: true });
});

/** Writes a file and records it as the provider's confirmed edit for the active Turn. */
const recordEdit = async (run: Run, file: string): Promise<void> => {
  const absolutePath = path.join(testRepo(), file);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${file} ${Math.random()}\n`);
  await run.recordFileChanges({
    runId: 'run-1',
    provider: 'claude',
    providerSessionId: 'prov-existing',
    providerThreadId: null,
    providerTurnId: null,
    paths: [absolutePath],
    occurredAt: new Date().toISOString(),
    providerPatch: null,
  });
};

// --- Tests -----------------------------------------------------------------

describe('Run handler-span report-emission contract', () => {
  it('does not warn when the span emits its required report and the run cleans up', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => ({
      run: async () => {
        ctx.run.appendReportChainEntry(makeChainEntry());
      },
    });

    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('startup_session'));
    await drainMicrotasks();
    run.cleanup();

    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('does not warn on conversational mid-turns that defer reports — only finalizes at run-end', async () => {
    // Multi-turn span where the agent first asks the user a clarifying
    // question (no reports), then on a later turn writes the required
    // report. Pre-fix: the first turn hard-failed. Now: the first turn is
    // silent, and the span only checks at run-end.
    let turnIndex = 0;
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => ({
      run: async () => {
        if (turnIndex === 1) {
          // Second turn writes the report.
          ctx.run.appendReportChainEntry(makeChainEntry({ reportType: 'FEATURE_SYNC' }));
        }
        turnIndex += 1;
      },
    });

    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('feature_sync_analyze'));
    await drainMicrotasks();
    // No warn yet — the span is still open.
    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();

    await run.handleMessage(makeInput('feature_sync_analyze'));
    await drainMicrotasks();
    run.cleanup();

    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('warns at run-end when a span never emitted its required report', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({
      run: async () => {
        // Runner returns cleanly but produces no report entries.
      },
    });

    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('startup_session'));
    await drainMicrotasks();
    // No warn yet — span still open.
    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();

    run.cleanup();

    const warn = findWarn(collaborators, 'runtime.handler_span.report_contract_missed');
    expect(warn).not.toBeNull();
    expect(warn!.args[1]).toMatchObject({
      runId: 'run-1',
      promptType: 'startup_session',
      reason: 'run-end',
      mode: 'required-variants',
      missingReportTypes: ['SESSION_SUMMARY'],
    });
  });

  it("warns at handler-swap with the prior handler's missing variants", async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({
      run: async () => {
        // No reports written by either handler.
      },
    });

    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('startup_session'));
    await drainMicrotasks();
    // Swap handlers — the first span should finalize and warn.
    await run.handleMessage(makeInput('feature_sync_analyze'));
    await drainMicrotasks();

    const warnLogger = collaborators.logger.warn as ReturnType<typeof vi.fn>;
    const calls = warnLogger.mock.calls.filter(
      (c) => c[0] === 'runtime.handler_span.report_contract_missed',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({
      promptType: 'startup_session',
      reason: 'handler-swap',
      mode: 'required-variants',
      missingReportTypes: ['SESSION_SUMMARY'],
    });

    // Second span hasn't finalized yet — clean up the run and confirm the
    // second warn fires for the analyze handler.
    run.cleanup();
    const callsAfterCleanup = warnLogger.mock.calls.filter(
      (c) => c[0] === 'runtime.handler_span.report_contract_missed',
    );
    expect(callsAfterCleanup).toHaveLength(2);
    expect(callsAfterCleanup[1]![1]).toMatchObject({
      promptType: 'feature_sync_analyze',
      reason: 'run-end',
      missingReportTypes: ['FEATURE_SYNC'],
    });
  });

  it('does not warn for a free-form span that made no changes', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({
      run: async () => {
        // No-op turn, no touched files, no reports.
      },
    });

    const collaborators = makeCollaborators(pickRunner);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('free_form'));
    await drainMicrotasks();
    run.cleanup();

    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('emits an IMPLEMENT report at turn-end for a free-form span that touched files', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => ({
      run: async () => {
        await recordEdit(ctx.run, 'src/foo.ts');
      },
    });

    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(pickRunner, undefined, [tool]);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('free_form'));
    await run.awaitIdle();
    run.cleanup();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      args: {
        reportType: ReportType.Implement,
        payload: {
          reportType: ReportType.Implement,
          filesChanged: ['src/foo.ts'],
        },
      },
    });
    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('does not emit an IMPLEMENT report for a free-form span that made no file changes', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({
      run: async () => {
        // Discussion-only Open turn.
      },
    });

    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(pickRunner, undefined, [tool]);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('free_form'));
    await drainMicrotasks();
    run.cleanup();

    expect(execute).not.toHaveBeenCalled();
    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('emits an IMPLEMENT report for coding_freeform changed files', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => ({
      run: async () => {
        await recordEdit(ctx.run, 'src/coding.ts');
      },
    });

    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(pickRunner, undefined, [tool]);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('coding_freeform'));
    await run.awaitIdle();
    run.cleanup();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      args: {
        payload: {
          filesChanged: ['src/coding.ts'],
        },
      },
    });
  });

  it('attaches the automatic IMPLEMENT report to the final Message snapshot', async () => {
    const poster = makePoster();
    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(
      (ctx) => ({
        run: async () => {
          await recordEdit(ctx.run, 'src/completion.ts');
          ctx.run.onAgentOutput(assistantCompleteMessage('All done.'));
        },
      }),
      poster,
      [tool],
    );
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('free_form'));
    await drainMicrotasks();
    await run.awaitIdle();

    expect(execute).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: expect.objectContaining({ reportIds: ['implement-report-1'] }),
      }),
    );
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
      (poster.createOutOfBand as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it('does not let an existing non-IMPLEMENT snapshot suppress a later changed-workspace report', async () => {
    let releaseRunner!: () => void;
    let markRunnerStarted!: () => void;
    const runnerStarted = new Promise<void>((resolve) => {
      markRunnerStarted = resolve;
    });
    const runnerReleased = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(
      () => ({
        run: async () => {
          markRunnerStarted();
          await runnerReleased;
        },
      }),
      undefined,
      [tool],
    );
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('free_form'));
    await runnerStarted;

    const turn = run.activeTurn;
    expect(turn).not.toBeNull();
    run.appendReportChainEntry(makeChainEntry({ reportId: 'session-report' }));
    expect(turn!.snapshotCompletionArtifactIds(run.readReportIdsForTurn(turn!.turnId))).toEqual({
      proposalIds: [],
      reportIds: ['session-report'],
    });
    await recordEdit(run, 'src/late.ts');

    await run.prepareTurnCompletionArtifacts(turn!);

    expect(execute).toHaveBeenCalledOnce();
    releaseRunner();
    await run.awaitIdle();
  });

  it('emits an IMPLEMENT report at turn-end for a Task Only span that touched files', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = (ctx) => ({
      run: async () => {
        await recordEdit(ctx.run, 'src/task-only.ts');
      },
    });

    const { tool, execute } = makeCreateReportTool();
    const collaborators = makeCollaborators(pickRunner, undefined, [tool]);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('quick'));
    await run.awaitIdle();
    run.cleanup();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      args: {
        reportType: ReportType.Implement,
        payload: {
          reportType: ReportType.Implement,
          summary: expect.stringContaining('Task Only completed the requested work'),
          filesChanged: ['src/task-only.ts'],
        },
      },
    });
    expect(findWarn(collaborators, 'runtime.handler_span.report_contract_missed')).toBeNull();
  });

  it('does not surface enforcement to the user — no processing message gets a failure body', async () => {
    const pickRunner: (ctx: RunnerContext) => Runner = () => ({
      run: async () => {
        // Required report is never written.
      },
    });

    const poster = makePoster();
    const collaborators = makeCollaborators(pickRunner, poster);
    const run = new Run(makeRunArgs(), collaborators);

    await run.handleMessage(makeInput('startup_session'));
    await drainMicrotasks();
    run.cleanup();

    // The poster should not have been used to inject a contract-failure
    // message. (Other completes from the runner path may fire, but none
    // with the old "Turn did not emit required reports" body.)
    const completeMock = poster.complete as ReturnType<typeof vi.fn>;
    for (const call of completeMock.mock.calls) {
      const body = call[3] as { data?: { response?: string } } | undefined;
      const response = body?.data?.response ?? '';
      expect(response).not.toMatch(/did not emit required reports/i);
      expect(response).not.toMatch(/touched files but emitted no report/i);
    }
  });
});
