/**
 * Turn-level integration tests for the real `RunnerPicker`.
 *
 * Builds a full context bag using the concrete picker
 * and wires it into a Turn so we assert end-to-end that the right runner
 * is picked for each (handler.runnerKind, run.hasProviderSession)
 * combination. The provider session runner is stubbed so no real SDK is
 * involved.
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
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../run.test-support';

import { Run, type RunArgs, type RunCollaborators } from '../run';
import { Turn } from '../../turn/turn';
import { RunnerPicker } from './pick-runner';
import type { RunnerContext } from './types';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type {
  AgentSessionRunner,
  AgentRunResult,
  ResumeArgs,
  RunPromptArgs,
} from '../../agents/providers/session-runner';
import { LocalAgentEndpoint } from '../../server/local-base-url';

const makeSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
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
    createOutOfBand: vi.fn().mockResolvedValue('opener-msg-1'),
  });

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeCollaborators = (): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(),
  logger: makeLogger(),
});

const makeInput = (payload?: unknown): InternalRunPromptRequest =>
  ({
    promptType: 'coding_freeform',
    payload: payload ?? { promptType: 'coding_freeform', userMessage: 'text' },
    references: { resolved: [], unresolved: [] },
    triggerMessageId: null,
  }) as unknown as InternalRunPromptRequest;

type RunPromptFn = (args: RunPromptArgs) => Promise<AgentRunResult>;
type ResumeSessionFn = (args: ResumeArgs) => Promise<AgentRunResult>;

interface WireArgs {
  handler: PromptTypeHandler<unknown>;
  hasProviderSession?: boolean;
  sessionRunner?: {
    runPrompt?: ReturnType<typeof vi.fn<RunPromptFn>>;
    resumeSession?: ReturnType<typeof vi.fn<ResumeSessionFn>>;
  };
}

const wire = (args: WireArgs) => {
  const runPrompt: ReturnType<typeof vi.fn<RunPromptFn>> =
    args.sessionRunner?.runPrompt ??
    vi.fn<RunPromptFn>().mockResolvedValue({
      providerSessionId: 'new-session',
      providerConversationId: 'new-conv',
      errorCount: 0,
    });
  const resumeSession: ReturnType<typeof vi.fn<ResumeSessionFn>> =
    args.sessionRunner?.resumeSession ??
    vi.fn<ResumeSessionFn>().mockResolvedValue({
      providerSessionId: 'sess',
      providerConversationId: 'conv',
      errorCount: 0,
    });

  const sessionRunner = {
    runPrompt,
    resumeSession,
    promptOnce: vi.fn(),
    getContextUsage: vi.fn(),
  } as AgentSessionRunner;
  const ownership = createTestRunOwnership();
  const picker = new RunnerPicker({
    sessionRunnerFacade: createTestSessionRunnerFacade(sessionRunner),
    oauthClient: createRunTestOAuthClient({ success: true, data: 'token' }),
    logger: makeLogger(),
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
  });

  const run = new Run(
    makeRunArgs({
      ...(args.hasProviderSession !== undefined
        ? { hasProviderSession: args.hasProviderSession }
        : {}),
    }),
    makeCollaborators(),
  );

  const ctx: RunnerContext = {
    run,
    handler: args.handler,
    resolvedPrompt: 'resolved',
    input: makeInput(args.handler.promptType === 'commit' ? {} : undefined),
    cwd: '/tmp/test-cwd',
    effectiveModel: null,
    effectiveReasoningEffort: null,
    priorReports: [],
  };

  const runner = picker.pick(ctx);
  vi.spyOn(run, 'onTurnRunnerCompleted').mockResolvedValue(undefined);
  vi.spyOn(run, 'onTurnEnded').mockResolvedValue(undefined);
  const turn = new Turn({
    effectiveRole: 'implementation',
    turnId: 'turn-test-1',
    runId: run.runId,
    resolvedPrompt: ctx.resolvedPrompt,
    handler: ctx.handler,
    externalAgentNodeId: null,
    triggerMessageId: null,
    runner,
    platformMcpProxy: null,
    abortController: new AbortController(),
    effectiveModel: null,
    effectiveReasoningEffort: null,
    logger: makeLogger(),
    owner: run,
  });

  return { run, turn, runPrompt, resumeSession };
};

describe('Turn.run() with real pickRunner', () => {
  it('routes a provider-session handler with an existing session to ResumeRunner', async () => {
    const handler: PromptTypeHandler<unknown> = {
      id: 'entity_conversation',
      promptType: 'entity_conversation',
      service: 'optional',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => 'system prompt',
    };

    const { turn, runPrompt, resumeSession } = wire({
      handler,
      hasProviderSession: true,
    });

    await turn.begin();
    await turn.run();

    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(runPrompt).not.toHaveBeenCalled();
    expect(turn.phase).toBe('ended');
  });

  it('routes a provider-session handler with no session to NewSessionRunner and flips hasProviderSession', async () => {
    const handler: PromptTypeHandler<unknown> = {
      id: 'entity_conversation',
      promptType: 'entity_conversation',
      service: 'optional',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => 'system prompt',
    };

    const { run, turn, runPrompt, resumeSession } = wire({
      handler,
      hasProviderSession: false,
    });

    expect(run.hasProviderSession).toBe(false);

    await turn.begin();
    await turn.run();

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(resumeSession).not.toHaveBeenCalled();
    expect(run.hasProviderSession).toBe(true);
    expect(turn.phase).toBe('ended');
  });
});
