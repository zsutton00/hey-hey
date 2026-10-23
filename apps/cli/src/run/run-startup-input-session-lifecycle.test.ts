import { describe, expect, it, vi } from 'vitest';
import {
  createRunTestOAuthClient,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunStore,
  createTestSessionRunnerFacade,
} from './run.test-support';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandlerDeps,
} from '../agents/prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../agents/prompt-type-handler.test-support';
import type {
  AgentRunResult,
  AgentSessionRunner,
  ResumeArgs,
  RunPromptArgs,
} from '../agents/providers/session-runner';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunnerPicker } from './runners/pick-runner';

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: async () => {},
}));

type Provider = 'claude' | 'codex' | 'opencode';
type RunPromptFn = (args: RunPromptArgs) => Promise<AgentRunResult>;
type ResumeSessionFn = (args: ResumeArgs) => Promise<AgentRunResult>;

const retainedMemo = {
  source: 'project_assistant',
  content: 'RETAINED PROJECT ASSISTANT RESEARCH',
  writtenAt: '2026-09-15T07:25:41.851Z',
} as const;

const startupPromptInput: AgentStartupPromptInputResult = {
  startupInput: {
    task: {
      title: 'LEGACY TASK JSON',
      taskType: 'STANDARD',
      description: 'LEGACY TASK DESCRIPTION',
    },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: 'task-1' },
    entity: {} as never,
    context: {} as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: 'CURRENT ENTITY CONTEXT',
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'revision-1',
      revisionNumber: 1,
    },
  },
};

const makeSession = (provider: Provider): AgenticSession =>
  ({
    entity: { entityType: 'TASK', entityId: 'task-1' },
    agentic_session_id: 'run-1',
    provider,
    provider_session_id: null,
    provider_conversation_id: null,
    provider_session_agent_id: null,
    status: 'idle',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    events: [],
  }) as unknown as AgenticSession;

const makeRunStore = (provider: Provider): RunStore => {
  const store = createTestRunStore();
  const session = makeSession(provider);
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(session);
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(session);
  vi.spyOn(store, 'updateRunTriggerContext').mockResolvedValue(session);
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(session);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(session);
  vi.spyOn(store, 'updateRunProviderIdentity').mockResolvedValue(session);
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeInput = (promptType: string): InternalRunPromptRequest =>
  ({
    promptType,
    payload: { promptType, userMessage: `input for ${promptType}` },
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const runTurn = async (run: Run, promptType: string): Promise<void> => {
  await run.handleMessage(makeInput(promptType));
  await run.awaitIdle();
};

const makeRuntime = (provider: Provider, options: { persistedProviderSession?: boolean } = {}) => {
  let mintCount = 0;
  const runPrompt = vi.fn<RunPromptFn>().mockImplementation(async () => {
    mintCount += 1;
    return {
      providerSessionId: `provider-session-${mintCount}`,
      providerConversationId: null,
      errorCount: 0,
    };
  });
  const resumeSession = vi.fn<ResumeSessionFn>().mockResolvedValue({
    providerSessionId: 'provider-session-resumed',
    providerConversationId: null,
    errorCount: 0,
  });
  const discardSession = vi.fn().mockResolvedValue(undefined);
  const sessionRunnerFacade = createTestSessionRunnerFacade({
    runPrompt,
    resumeSession,
    discardSession,
    getContextUsage: vi.fn(),
  } as unknown as AgentSessionRunner);
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];
  let projectionCount = 0;
  const startupResolve = vi.fn().mockImplementation(async () => {
    projectionCount += 1;
    return {
      ...startupPromptInput,
      renderedInput: `CURRENT ENTITY CONTEXT ${projectionCount}`,
    };
  });
  const registeredHandlers = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const ownership = createTestRunOwnership((promptType) => registeredHandlers.get(promptType));
  const handlerDeps = createPromptTypeHandlerTestDeps({
    startupPromptInput: {
      resolve: startupResolve,
    } as unknown as PromptTypeHandlerDeps['startupPromptInput'],
    auth: createPromptTypeHandlerTestAuth('lifecycle-test-token'),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
    logger,
  });
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    oauthClient: createRunTestOAuthClient(),
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: new LocalAgentEndpoint(),
  });
  const session = makeSession(provider);
  if (options.persistedProviderSession) {
    session.provider_session_id = 'persisted-provider-session';
    session.provider_session_agent_id = 'coding_freeform';
    session.promptType = 'coding_freeform';
  }
  const args: RunArgs = {
    runId: 'run-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    provider,
    session,
    hasProviderSession: options.persistedProviderSession === true,
  };
  const collaborators: RunCollaborators = {
    runStore: makeRunStore(provider),
    repoStore: createTestRepoMappingStore(),
    poster: createTestMessagePoster(),
    broadcaster: createTestRunEventPublisher(),
    ...ownership,
    handlerDeps,
    runnerPicker,
    logger,
  };

  const run = new Run(args, collaborators);
  run.appendMemo(retainedMemo);

  return {
    run,
    runPrompt,
    resumeSession,
    startupResolve,
    logger,
  };
};

describe.each<Provider>(['claude', 'codex', 'opencode'])(
  '%s startup input provider-session lifecycle',
  (provider) => {
    it('delivers fresh context on every mint and remint while resumes stay turn-only', async () => {
      const { run, runPrompt, resumeSession, startupResolve, logger } = makeRuntime(provider);

      await runTurn(run, 'coding_freeform');
      await runTurn(run, 'coding_freeform');
      await runTurn(run, 'coding_freeform');
      await runTurn(run, 'research');
      await runTurn(run, 'quick');
      await runTurn(run, 'daily_session');
      await runTurn(run, 'daily_session');

      expect(startupResolve).toHaveBeenCalledTimes(5);
      for (const call of startupResolve.mock.calls.slice(1)) {
        expect(call[1]).toEqual({ cachedTemplate: startupPromptInput.template });
      }
      expect(runPrompt).toHaveBeenCalledTimes(5);
      expect(resumeSession).toHaveBeenCalledTimes(2);

      for (const [index, call] of runPrompt.mock.calls.entries()) {
        const prompt = call[0].prompt;
        const expectedProjection = `CURRENT ENTITY CONTEXT ${index + 1}`;
        expect(prompt.startsWith(`${expectedProjection}\n\n---\n\n`)).toBe(true);
        expect(prompt.match(/CURRENT ENTITY CONTEXT/g)).toHaveLength(1);
        expect(prompt.indexOf(expectedProjection)).toBeLessThan(prompt.indexOf('input for '));
        expect(prompt).not.toContain('LEGACY TASK JSON');
        expect(prompt).not.toContain('LEGACY TASK DESCRIPTION');
        expect(prompt).not.toContain('## Task Context');
        expect(prompt).not.toContain('## Startup Context');
        expect(prompt).toContain('## Context from prior phases');
        expect(prompt).toContain(retainedMemo.content);
        expect(prompt.match(/RETAINED PROJECT ASSISTANT RESEARCH/g)).toHaveLength(1);
      }
      for (const call of resumeSession.mock.calls) {
        expect(call[0].prompt).not.toContain('CURRENT ENTITY CONTEXT');
        expect(call[0].prompt).not.toContain('## Context from prior phases');
        expect(call[0].prompt).not.toContain(retainedMemo.content);
        expect(call[0].prompt).toContain('input for coding_freeform');
      }

      const decisions = (logger.info as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => call[0] === 'local.run.provider_session.decision')
        .map((call) => (call[1] as { decision: string }).decision);
      expect(decisions).toEqual([
        'first-turn-mint',
        'resume',
        'resume',
        'agent-transition-mint',
        'agent-transition-mint',
        'agent-transition-mint',
        'per-turn-mint',
      ]);
    });

    it('does not reinject retained memos when an idle-evicted provider session is restored', async () => {
      const { run, runPrompt, resumeSession, logger } = makeRuntime(provider, {
        persistedProviderSession: true,
      });

      await runTurn(run, 'coding_freeform');

      expect(runPrompt).not.toHaveBeenCalled();
      expect(resumeSession).toHaveBeenCalledTimes(1);
      expect(resumeSession.mock.calls[0]?.[0].prompt).toContain('input for coding_freeform');
      expect(resumeSession.mock.calls[0]?.[0].prompt).not.toContain('## Context from prior phases');
      expect(resumeSession.mock.calls[0]?.[0].prompt).not.toContain(retainedMemo.content);

      const decisions = (logger.info as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => call[0] === 'local.run.provider_session.decision')
        .map((call) => (call[1] as { decision: string }).decision);
      expect(decisions).toEqual(['resume']);
    });
  },
);
