/**
 * Coverage for the daily-session loop's per-Turn provider session lifecycle.
 *
 * The `daily_session` handler declares `providerSessionLifetime: 'turn'`:
 * every firing mints a fresh SDK session and discards it at `Turn.end()`,
 * while the single per-project platform session (`agentic_session_id`,
 * `conversationId`) is reused across firings. No firing ever resumes; every
 * one mints.
 *
 * These tests drive `Run` end-to-end through the *real* runner picker and
 * the real `NewSessionRunner` / `ResumeRunner` — only the SDK boundary
 * (`sessionRunner.runPrompt` / `sessionRunner.resumeSession`) and the
 * prompt resolver are stubbed. A `runPrompt` call is a fresh SDK session
 * (one synthetic id per call); a `resumeSession` call reuses the persisted
 * one. The loop is correct iff `runPrompt` fires once per firing and
 * `resumeSession` never fires.
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
import {
  AgentSessionRunnerError,
  type AgentRunResult,
  type AgentSessionRunner,
  type ResumeArgs,
  type RunPromptArgs,
} from '../agents/providers/session-runner';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import { LocalAgentEndpoint } from '../server/local-base-url';

// A `provider_session` handler keyed to the real `daily_session` promptType
// so the Run can look the handler up by `input.promptType`. Matches the
// real handler's session-shape declarations: `providerSessionLifetime:
// 'turn'`, no `providerSessionStart`, no `submissionTools`.
const dailySessionStub: PromptTypeHandler<unknown> = {
  id: 'daily_session',
  promptType: 'daily_session',
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  providerSessionLifetime: 'turn',
  reports: [],
  buildPrompt: () => 'daily-session system prompt',
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
 * a firing minted or resumed. The collaborators `logger` is returned so
 * tests can read the per-Turn discard log lines.
 */
const makeRun = (overrides?: {
  runPrompt?: RunPromptFn;
  provider?: 'claude' | 'codex';
}): {
  run: Run;
  runPrompt: ReturnType<typeof vi.fn<RunPromptFn>>;
  resumeSession: ReturnType<typeof vi.fn<ResumeSessionFn>>;
  logger: RunCollaborators['logger'];
} => {
  let mintCount = 0;
  const runPrompt = vi.fn<RunPromptFn>().mockImplementation(
    overrides?.runPrompt ??
      (async () => {
        mintCount += 1;
        return {
          providerSessionId: `sdk-session-${mintCount}`,
          providerConversationId: null,
          errorCount: 0,
        };
      }),
  );
  const resumeSession = vi.fn<ResumeSessionFn>().mockResolvedValue({
    providerSessionId: 'sdk-session-resumed',
    providerConversationId: null,
    errorCount: 0,
  });

  const logger = makeLogger();
  const ownership = createTestRunOwnership((promptType) =>
    promptType === 'daily_session' ? dailySessionStub : undefined,
  );
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt,
    resumeSession,
  } as unknown as AgentSessionRunner);
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

  const run = new Run(makeRunArgs({ provider: overrides?.provider ?? 'claude' }), collaborators);
  return { run, runPrompt, resumeSession, logger };
};

const makeInput = (): InternalRunPromptRequest =>
  ({
    promptType: 'daily_session',
    payload: { promptType: 'daily_session', userMessage: 'go' },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as unknown as InternalRunPromptRequest;

/** Drive one full Turn and wait for the Run to settle back to idle. */
const runTurn = async (run: Run): Promise<void> => {
  await run.handleMessage(makeInput());
  for (let i = 0; i < 100 && run.isProcessing; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (run.isProcessing) {
    throw new Error('Turn for "daily_session" did not settle');
  }
};

/**
 * The `discardedProviderSessionId` carried by each per-Turn discard log
 * line, in Turn order. Every entry is the SDK session that was live for
 * exactly one daily-session firing before it was discarded.
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

describe('daily_session loop mints a fresh provider session per firing on a single Run', () => {
  it('calls runPrompt once per firing and never resumes, leaving no provider session after the last firing', async () => {
    const { run, runPrompt, resumeSession } = makeRun();

    await runTurn(run);
    await runTurn(run);

    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(resumeSession).not.toHaveBeenCalled();
    expect(run.hasProviderSession).toBe(false);
    expect(run.session.provider_session_id).toBeNull();
  });

  it('mints a distinct provider session id for every firing', async () => {
    const { run, logger } = makeRun();

    await runTurn(run);
    await runTurn(run);

    expect(discardedPerTurnSessionIds(logger)).toEqual(['sdk-session-1', 'sdk-session-2']);
  });

  it('labels every firing a per-turn mint and keeps the project session unchanged', async () => {
    const { run, logger } = makeRun();

    await runTurn(run);
    await runTurn(run);

    expect(providerSessionDecisions(logger)).toEqual(['per-turn-mint', 'per-turn-mint']);
    expect(run.session.agentic_session_id).toBe('run-1');
    expect(run.conversationId).toBe('conv-1');
  });

  it('mints fresh again after a capacity failure instead of resuming the failed firing', async () => {
    let calls = 0;
    const { run, runPrompt, resumeSession } = makeRun({
      provider: 'codex',
      runPrompt: async () => {
        calls += 1;
        if (calls === 1) {
          throw new AgentSessionRunnerError(
            'MODEL_CAPACITY',
            'Codex is temporarily at capacity for the selected model. Please retry.',
          );
        }
        return {
          providerSessionId: 'sdk-session-after-retry',
          providerConversationId: null,
          errorCount: 0,
        };
      },
    });

    await runTurn(run);
    await runTurn(run);

    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(resumeSession).not.toHaveBeenCalled();
    expect(run.hasProviderSession).toBe(false);
  });
});
