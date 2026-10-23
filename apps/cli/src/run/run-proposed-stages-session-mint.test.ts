/**
 * Coverage for `plan_shaping_proposed_stages`'s `providerSessionStart: 'fresh'`
 * declaration.
 *
 * The `plan_from_design_doc` workflow drives `feature_sync_analyze` first,
 * which pins the SDK session to the feature-sync `allowedTools` surface.
 * When the workflow rotates to `plan_shaping_proposed_stages`, that surface
 * does not cover the plan-shaping authoring tools or the
 * `submit_proposed_stages_ready` submission tool — so the handler must mint a new SDK
 * session at Turn start rather than ride on whatever the analyze handler
 * left behind.
 *
 * These tests drive `Run` end-to-end through the *real* runner picker. The
 * `runPrompt` mock counts SDK session mints; `resumeSession` counts
 * inherit-and-resume. The proposed-stages Turn is correct iff `runPrompt`
 * fires for the swap (not `resumeSession`), the new mint carries the
 * plan-shaping authoring tools as `additionalAllowedTools`, the run's
 * persisted `provider_session_id` is null'd through the store so a CLI
 * process bounce before the next Turn cannot resurrect the discarded
 * session, and the run-scoped submission registry exposes `submit_proposed_stages_ready`.
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
import {
  PLAN_SHAPING_ALLOWED_TOOLS,
  planShapingProposedStagesHandler,
} from '../agents/plan-shaping/proposed-stages.handler';
import type { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import type { RepoMappingStore } from '../repo/index';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';
import { LocalAgentEndpoint } from '../server/local-base-url';

// `feature_sync_analyze` stands in for the upstream feature-sync handler the
// `plan_from_design_doc` workflow opens with. It is Run-lifetime
// `'inherit'`-Start (no `providerSessionStart`, no `providerSessionLifetime`)
// so its session would normally survive into the next Turn — the
// proposed-stages `'fresh'` declaration is what overrides that.
const featureSyncAnalyzeHandler: PromptTypeHandler<unknown> = {
  id: 'feature_sync_analyze',
  promptType: 'feature_sync_analyze',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'feature-sync-analyze system prompt',
};

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

const makeRunStore = () => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunTriggerContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  const updateRunProviderIdentity = vi
    .spyOn(store, 'updateRunProviderIdentity')
    .mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return { store, updateRunProviderIdentity };
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

const makeRun = (
  sessionOverrides?: Partial<AgenticSession>,
): {
  run: Run;
  runPrompt: ReturnType<typeof vi.fn<RunPromptFn>>;
  resumeSession: ReturnType<typeof vi.fn<ResumeSessionFn>>;
  logger: RunCollaborators['logger'];
  updateRunProviderIdentity: ReturnType<typeof vi.fn>;
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
    if (promptType === 'feature_sync_analyze') return featureSyncAnalyzeHandler;
    if (promptType === 'plan_shaping_proposed_stages') {
      return planShapingProposedStagesHandler as unknown as PromptTypeHandler<unknown>;
    }
    return undefined;
  });
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

  const { store: runStore, updateRunProviderIdentity } = makeRunStore();
  const collaborators: RunCollaborators = {
    runStore,
    repoStore: createTestRepoMappingStore(),
    poster: makePoster(),
    broadcaster: makeBroadcaster(),
    ...ownership,
    handlerDeps: {} as unknown as PromptTypeHandlerDeps,
    runnerPicker,
    logger,
  };

  const run = new Run(makeRunArgs({ session: makeSession(sessionOverrides) }), collaborators);
  return {
    run,
    runPrompt,
    resumeSession,
    logger,
    updateRunProviderIdentity,
    submissionToolRegistry: ownership.submissionToolRegistry,
  };
};

const makeInput = (
  promptType: 'feature_sync_analyze' | 'plan_shaping_proposed_stages',
  externalAgentContext?: { externalAgentNodeId: string; triggerMessageId: string },
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

const runTurn = async (
  run: Run,
  promptType: 'feature_sync_analyze' | 'plan_shaping_proposed_stages',
  externalAgentContext?: { externalAgentNodeId: string; triggerMessageId: string },
): Promise<void> => {
  await run.handleMessage(makeInput(promptType, externalAgentContext));
  for (let i = 0; i < 100 && run.isProcessing; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (run.isProcessing) {
    throw new Error(`Turn for "${promptType}" did not settle`);
  }
};

const providerSessionDecisions = (
  logger: RunCollaborators['logger'],
): Array<{ decision: string; providerSessionStart: string }> => {
  const info = logger.info as ReturnType<typeof vi.fn>;
  return info.mock.calls
    .filter((call) => call[0] === 'local.run.provider_session.decision')
    .map((call) => ({
      decision: (call[1] as { decision: string }).decision,
      providerSessionStart: (call[1] as { providerSessionStart: string }).providerSessionStart,
    }));
};

describe('plan_shaping_proposed_stages mints a fresh provider session on workflow handoff', () => {
  it('discards the upstream feature-sync session and mints fresh for proposed-stages', async () => {
    const { run, runPrompt, resumeSession } = makeRun();

    await runTurn(run, 'feature_sync_analyze');
    // The analyze Turn opened a Run-lifetime session that an `'inherit'`-Start
    // handler would resume. proposed-stages must NOT resume it.
    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(run.hasProviderSession).toBe(true);
    expect(run.session.provider_session_id).toBe('sdk-session-1');

    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    // The swap into proposed-stages forced a new mint via the `'fresh'`
    // declaration; the resumeSession path is never taken.
    expect(runPrompt).toHaveBeenCalledTimes(2);
    expect(resumeSession).not.toHaveBeenCalled();
    expect(run.session.provider_session_id).toBe('sdk-session-2');
  });

  it('mints the proposed-stages session with the plan-shaping allowedTools surface', async () => {
    const { run, runPrompt } = makeRun();

    await runTurn(run, 'feature_sync_analyze');
    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    const proposedStagesCall = runPrompt.mock.calls[1]?.[0];
    expect(proposedStagesCall).toBeDefined();
    expect(proposedStagesCall?.additionalAllowedTools).toEqual(PLAN_SHAPING_ALLOWED_TOOLS);
    expect(proposedStagesCall?.mcpToolUseCase).toBe('plan_shaping');
  });

  it('exposes submit_proposed_stages_ready on the Run-scoped submission registry for the proposed-stages turn', async () => {
    const { run, submissionToolRegistry } = makeRun();

    await runTurn(run, 'feature_sync_analyze');
    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    const registration = submissionToolRegistry.getByRunId('run-1');
    expect(registration).not.toBeNull();
    expect(registration?.tools.map((tool) => tool.name)).toContain('submit_proposed_stages_ready');
    expect(registration?.externalAgentNodeId).toBe('plan-shaping-node');
  });

  it('labels the agent transition and records the explicit fresh-start override', async () => {
    const { run, logger } = makeRun();

    await runTurn(run, 'feature_sync_analyze');
    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    expect(providerSessionDecisions(logger)).toEqual([
      { decision: 'first-turn-mint', providerSessionStart: 'inherit' },
      { decision: 'agent-transition-mint', providerSessionStart: 'fresh' },
    ]);
  });

  it('persists the discard so a CLI process bounce cannot resurrect the analyze session', async () => {
    const { run, updateRunProviderIdentity } = makeRun();

    await runTurn(run, 'feature_sync_analyze');
    expect(updateRunProviderIdentity).not.toHaveBeenCalled();

    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    // The discard wrote null to the persisted store — without this, a CLI
    // process bounce between the two Turns would rehydrate from disk and
    // resurrect the analyze session id.
    expect(updateRunProviderIdentity).toHaveBeenCalledWith('run-1', {
      providerSessionId: null,
      providerConversationId: null,
    });
  });
});

describe('a rehydrated Run that lost its in-memory state still mints for proposed-stages', () => {
  it('mints rather than resuming when the rehydrated session carries no provider_session_id', async () => {
    // Simulate the post-bounce state: the store-side discard already cleared
    // provider_session_id, so the rehydrated Run starts with no session.
    // proposed-stages' `'fresh'` declaration means it mints regardless, but
    // this test guards against a regression where rehydration with a null
    // session id and no in-memory swap-detect would mistakenly resume.
    const { run, runPrompt, resumeSession } = makeRun();

    await runTurn(run, 'plan_shaping_proposed_stages', {
      externalAgentNodeId: 'plan-shaping-node',
      triggerMessageId: 'trigger-1',
    });

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(resumeSession).not.toHaveBeenCalled();
    const proposedStagesCall = runPrompt.mock.calls[0]?.[0];
    expect(proposedStagesCall?.additionalAllowedTools).toEqual(PLAN_SHAPING_ALLOWED_TOOLS);
  });
});
