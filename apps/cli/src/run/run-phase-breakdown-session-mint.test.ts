/**
 * Coverage for the plan-shaping phase-breakdown loop's per-Turn provider
 * session lifecycle.
 *
 * The `plan_shaping_phase_breakdown` handler declares
 * `providerSessionLifetime: 'turn'`: every phase-breakdown Turn mints a
 * fresh SDK session and discards it at `Turn.end()`. The loop runs one
 * Turn per journey step, and each step is investigated against real code
 * from a clean session — inter-phase continuity is carried explicitly by
 * the `priorPhases` slice on the trigger payload, not by an accumulated
 * SDK transcript. So no iteration ever resumes; every one mints.
 *
 * These tests drive `Run` end-to-end through the *real* runner picker and
 * the real `NewSessionRunner` / `ResumeRunner` — only the SDK boundary
 * (`sessionRunner.runPrompt` / `sessionRunner.resumeSession`) and the
 * prompt resolver are stubbed. A `runPrompt` call is a fresh SDK session
 * (one synthetic id per call); a `resumeSession` call reuses the persisted
 * one. The loop is correct iff `runPrompt` fires once per iteration and
 * `resumeSession` never fires.
 *
 * The paired visual-preview → phase-breakdown case asserts the handler swap
 * still mints, and that every later phase-breakdown iteration also mints
 * rather than resuming the swap's session.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunOwnership,
  createTestRunStore,
  createRunTestOAuthClient,
  createTestSessionRunnerFacade,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type {
  AgentRunResult,
  AgentSessionRunner,
  ResumeArgs,
  RunPromptArgs,
} from '../agents/providers/session-runner';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { submitPhaseBreakdownTool } from '../agents/plan-shaping/submission-tools';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import { LocalAgentEndpoint } from '../server/local-base-url';

// Two `provider_session` handlers keyed to the real plan-shaping
// promptTypes. The Run looks the handler up by `input.promptType`, and the
// handler-swap discard compares the in-memory handler-span promptType
// against the incoming one — so the promptType strings must match the
// values the loop actually carries.
//
// `visualPreviewHandler` is a Run-lifetime `'inherit'` handler (no
// `providerSessionStart`, no `providerSessionLifetime`): its session survives
// its own Turn.
// `phaseBreakdownHandler` declares `providerSessionStart: 'fresh'` (its
// submission-tool surface differs from visual-preview's and cannot be carried
// into a resumed session) and `providerSessionLifetime: 'turn'` (each
// iteration discards the session at Turn end and mints fresh on the next).
const visualPreviewHandler: PromptTypeHandler<unknown> = {
  id: 'plan_shaping_visual_preview',
  promptType: 'plan_shaping_visual_preview',
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'visual-preview system prompt',
};

const phaseBreakdownHandler: PromptTypeHandler<unknown> = {
  id: 'plan_shaping_phase_breakdown',
  promptType: 'plan_shaping_phase_breakdown',
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  providerSessionStart: 'fresh',
  providerSessionLifetime: 'turn',
  reports: [],
  submissionTools: [submitPhaseBreakdownTool],
  buildPrompt: () => 'phase-breakdown system prompt',
};

// The resolver itself is exercised by resolve-prompt.test.ts; here it only
// needs to hand back a non-empty prompt so `NewSessionRunner` does not
// reject the turn.
vi.mock('./resolve-prompt', () => ({
  resolvePrompt: async () => ({
    resolvedPrompt: 'resolved prompt',
    startingMessage: undefined,
    sessionContext: undefined,
    preparedPayload: undefined,
    isSubagentOwned: false,
    consumedPreviousProviderSession: false,
  }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

const makeSession = (overrides?: Partial<AgenticSession>): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
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

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunTriggerContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunProviderIdentity').mockResolvedValue(makeSession());
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

type RunPromptFn = (args: RunPromptArgs) => Promise<AgentRunResult>;
type ResumeSessionFn = (args: ResumeArgs) => Promise<AgentRunResult>;

/**
 * Build a Run wired to the *real* runner picker. `runPrompt` mints a fresh
 * SDK session (one synthetic id per call); `resumeSession` reuses the
 * persisted one. Counting the two calls is how each test asserts whether
 * an iteration minted or resumed. The collaborators `logger` is returned
 * so tests can read the per-Turn discard log lines.
 */
const makeRun = (
  sessionRunnerOverrides?: Partial<AgentSessionRunner>,
): {
  run: Run;
  runPrompt: ReturnType<typeof vi.fn<RunPromptFn>>;
  resumeSession: ReturnType<typeof vi.fn<ResumeSessionFn>>;
  logger: RunCollaborators['logger'];
  submissionToolRegistry: SubmissionToolRegistry;
} => {
  let mintCount = 0;
  const runPrompt = vi.fn<RunPromptFn>().mockImplementation(async () => {
    mintCount += 1;
    return {
      providerSessionId: `sdk-session-${mintCount}`,
      providerConversationId: null,
      errorCount: 0,
    };
  });
  const resumeSession = vi.fn<ResumeSessionFn>().mockResolvedValue({
    providerSessionId: 'sdk-session-resumed',
    providerConversationId: null,
    errorCount: 0,
  });

  const logger = makeLogger();
  const ownership = createTestRunOwnership((promptType) => {
    if (promptType === 'plan_shaping_visual_preview') return visualPreviewHandler;
    if (promptType === 'plan_shaping_phase_breakdown') return phaseBreakdownHandler;
    return undefined;
  });
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt,
    resumeSession,
    ...sessionRunnerOverrides,
  } as AgentSessionRunner);
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    oauthClient: createRunTestOAuthClient(),
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
  });

  const collaborators: RunCollaborators = {
    runStore: makeRunStore(),
    repoStore: createTestRepoMappingStore(),
    poster: makePoster(),
    broadcaster: makeBroadcaster(),
    ...ownership,
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker,
    logger,
  };

  const run = new Run(makeRunArgs(), collaborators);
  return {
    run,
    runPrompt,
    resumeSession,
    logger,
    submissionToolRegistry: ownership.submissionToolRegistry,
  };
};

interface ExternalAgentContext {
  externalAgentNodeId: string;
  triggerMessageId: string;
}

const makeInput = (
  promptType: 'plan_shaping_visual_preview' | 'plan_shaping_phase_breakdown',
  externalAgentContext?: ExternalAgentContext,
): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerContext: externalAgentContext
      ? {
          externalAgentNodeId: externalAgentContext.externalAgentNodeId,
          triggerMessageId: externalAgentContext.triggerMessageId,
        }
      : null,
  }) as unknown as InternalRunPromptRequest;

/** Drive one full Turn and wait for the Run to settle back to idle. */
const runTurn = async (
  run: Run,
  promptType: 'plan_shaping_visual_preview' | 'plan_shaping_phase_breakdown',
  externalAgentContext?: ExternalAgentContext,
): Promise<void> => {
  await run.handleMessage(makeInput(promptType, externalAgentContext));
  for (let i = 0; i < 100 && run.isProcessing; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (run.isProcessing) {
    throw new Error(`Turn for "${promptType}" did not settle`);
  }
};

/**
 * The `discardedProviderSessionId` carried by each per-Turn discard log
 * line, in Turn order. Every entry is the SDK session that was live for
 * exactly one phase-breakdown Turn before it was discarded.
 */
const discardedPerTurnSessionIds = (logger: RunCollaborators['logger']): Array<string | null> => {
  const info = logger.info as ReturnType<typeof vi.fn>;
  return info.mock.calls
    .filter((call) => call[0] === 'local.run.provider_session.discarded_per_turn')
    .map(
      (call) =>
        (call[1] as { discardedProviderSessionId: string | null }).discardedProviderSessionId,
    );
};

/** The `decision` value of each provider-session decision log line, in order. */
const providerSessionDecisions = (logger: RunCollaborators['logger']): string[] => {
  const info = logger.info as ReturnType<typeof vi.fn>;
  return info.mock.calls
    .filter((call) => call[0] === 'local.run.provider_session.decision')
    .map((call) => (call[1] as { decision: string }).decision);
};

describe('phase-breakdown loop mints a fresh provider session per iteration', () => {
  it('calls runPrompt once per iteration and never resumes', async () => {
    const { run, runPrompt, resumeSession } = makeRun();

    // Four consecutive phase-breakdown Turns — one per journey step.
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');

    // One fresh SDK session per iteration; nothing is ever resumed.
    expect(runPrompt).toHaveBeenCalledTimes(4);
    expect(resumeSession).not.toHaveBeenCalled();
    // The last iteration's session was discarded at its Turn end too.
    expect(run.hasProviderSession).toBe(false);
    expect(run.session.provider_session_id).toBeNull();
  });

  it('mints a distinct provider session id for every iteration', async () => {
    const { run, logger } = makeRun();

    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');

    // Each Turn ran on its own freshly-minted session, discarded at Turn
    // end — so the discarded ids are four distinct values, not one reused
    // across the loop.
    const discarded = discardedPerTurnSessionIds(logger);
    expect(discarded).toEqual(['sdk-session-1', 'sdk-session-2', 'sdk-session-3', 'sdk-session-4']);
    expect(new Set(discarded).size).toBe(4);
  });

  it('labels every iteration a per-turn mint, never a first-turn mint', async () => {
    const { run, logger } = makeRun();

    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');

    // A per-Turn-lifetime handler re-enters every Turn with no provider
    // session — but the decision log distinguishes that re-mint from a
    // Run's genuine first-turn mint.
    expect(providerSessionDecisions(logger)).toEqual([
      'per-turn-mint',
      'per-turn-mint',
      'per-turn-mint',
    ]);
  });
});

describe('visual-preview → phase-breakdown mints on the swap and every iteration after', () => {
  it('mints for visual-preview, mints on the swap, and mints each later iteration', async () => {
    const { run, runPrompt, resumeSession } = makeRun();

    // Real loop shape: a visual-preview Turn opens the session, then the
    // phase-breakdown loop runs.
    await runTurn(run, 'plan_shaping_visual_preview');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');

    // visual-preview mint + handler-swap mint + two per-Turn re-mints = four
    // fresh sessions; nothing resumes.
    expect(runPrompt).toHaveBeenCalledTimes(4);
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('keeps the visual-preview session for its own turn, discards it on the swap', async () => {
    const { run, runPrompt } = makeRun();

    await runTurn(run, 'plan_shaping_visual_preview');
    // visual-preview is a Run-lifetime handler — its session survives its
    // own Turn and would be resumed by another visual-preview Turn.
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('sdk-session-1');

    await runTurn(run, 'plan_shaping_phase_breakdown');
    // The swap into phase-breakdown minted a fresh session (phase-breakdown
    // declares `providerSessionStart: 'fresh'` because it needs its own
    // submission-tool surface); the per-Turn lifetime then discarded that
    // session at Turn end.
    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(run.hasProviderSession).toBe(false);
    expect(run.session.provider_session_id).toBeNull();
  });

  it('labels the visual-preview first mint and the phase-breakdown agent transition', async () => {
    const { run, logger } = makeRun();

    await runTurn(run, 'plan_shaping_visual_preview');
    await runTurn(run, 'plan_shaping_phase_breakdown');
    await runTurn(run, 'plan_shaping_phase_breakdown');

    expect(providerSessionDecisions(logger)).toEqual([
      'first-turn-mint',
      'agent-transition-mint',
      'per-turn-mint',
    ]);
  });
});

describe('submit_phase_breakdown terminates a freshly minted phase-breakdown turn', () => {
  it('wires the Run-scoped submit_phase_breakdown tool on a freshly minted turn', async () => {
    const { run, runPrompt, resumeSession, submissionToolRegistry } = makeRun();

    // A phase-breakdown Turn carrying EXTERNAL_AGENT context — the shape a
    // real workflow trigger arrives with so the action submission tool is
    // routable.
    await runTurn(run, 'plan_shaping_phase_breakdown', {
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
    });

    // The Turn ran on a freshly minted session, never a resume.
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(resumeSession).not.toHaveBeenCalled();

    // `submit_phase_breakdown` is wired into the Run-scoped submission-tool
    // registry — the agent's only sanctioned way to terminate the Turn.
    const registration = submissionToolRegistry.getByRunId('run-1');
    expect(registration).not.toBeNull();
    expect(registration?.tools.map((tool) => tool.name)).toContain('submit_phase_breakdown');
    expect(registration?.token).toBeTruthy();
    expect(registration?.externalAgentNodeId).toBe('node-1');
    expect(registration?.triggerMessageId).toBe('trigger-1');

    // The Turn terminated cleanly — the Run is back to idle, its per-Turn
    // session discarded.
    expect(run.isProcessing).toBe(false);
    expect(run.hasProviderSession).toBe(false);
  });
});

describe('per-turn discard awaits the runner before the next queued turn starts', () => {
  it('does not call runPrompt for a queued Turn until runner.discardSession resolves', async () => {
    // Regression guard: `onTurnEnded` used to fire-and-forget
    // `runner.discardSession()` before `drainQueue()`. The next queued Turn
    // could then call `client.query()` while the SDK client's `disconnect()`
    // was still in flight, throwing `Session already active.` The fix awaits
    // the discard; this test verifies the ordering.
    const events: string[] = [];
    let releaseDiscard: () => void = () => {};
    const discardGate = new Promise<void>((resolve) => {
      releaseDiscard = resolve;
    });

    const { run, runPrompt } = makeRun({
      discardSession: vi.fn(async () => {
        events.push('discard:start');
        await discardGate;
        events.push('discard:end');
      }),
    });

    const originalRunPrompt = runPrompt.getMockImplementation();
    if (!originalRunPrompt) throw new Error('expected default runPrompt impl');
    runPrompt.mockImplementation(async (args) => {
      events.push(`runPrompt:${String(runPrompt.mock.calls.length)}`);
      return originalRunPrompt(args);
    });

    // First Turn starts; wait for the actual provider invocation because the
    // Run resolves its workspace asynchronously before constructing the Turn.
    const firstTurn = run.handleMessage(makeInput('plan_shaping_phase_breakdown'));
    await vi.waitFor(() => expect(runPrompt).toHaveBeenCalledTimes(1));
    const secondTurn = run.handleMessage(makeInput('plan_shaping_phase_breakdown'));

    // Spin until the first Turn enters discard.
    for (let i = 0; i < 100 && !events.includes('discard:start'); i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(events).toContain('discard:start');

    // Give the event loop ample ticks. With the fix, runPrompt:2 cannot
    // fire because the discard is awaited; without the fix, drainQueue
    // races past the in-flight discard and the queued Turn's runPrompt
    // leaks in.
    for (let i = 0; i < 50; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(events).toEqual(['runPrompt:1', 'discard:start']);

    // Release the discard; the queued Turn now starts. `_processing` flips
    // briefly to false between Turns, so don't poll on it — wait until the
    // events we care about are in.
    releaseDiscard();
    await Promise.all([firstTurn, secondTurn]);
    for (let i = 0; i < 200 && !events.includes('runPrompt:2'); i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(events.slice(0, 4)).toEqual([
      'runPrompt:1',
      'discard:start',
      'discard:end',
      'runPrompt:2',
    ]);
  });
});
