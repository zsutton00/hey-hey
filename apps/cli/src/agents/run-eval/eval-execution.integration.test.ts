import { WorkflowAboutReader } from '../submission-tools/search-messages-proxy';
import type { MessagePosterApiClient } from '../../run/types';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { MessagePoster } from '../../run/message-poster';
import { NOOP_LOGGER } from '../../server/logger';
/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi
    .fn()
    .mockResolvedValue({ sourcePath: '/tmp/cfg.json', warnings: [] }),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

import { ProjectModeBundleMaterializer } from '../project-mode';
import { RunStore } from '../../run-store/run-store';
import { createTestRepoMappingStore } from '../../run/run.test-support';
import type { StartRunTriggerPayload } from '../../server/conversation-dispatch/trigger-payload-schemas';
import { createTestOAuthClient } from '../../server/__tests__/helpers/test-oauth-client';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from '../../server/__tests__/helpers/test-run-registry';
import { LocalAgentService } from '../../server/local-agent-service';
import { SETTLED_CATALOG_AVAILABILITY } from '../../test-support/capability-catalog';

// Creation and output boundaries use ordinary Runs with persisted metadata.

const AGENT_SESSION_ID = '3a8dd90c-f85e-4efc-a9c0-6fb3c58f0741';
const CONVERSATION_ID = 'conv-provider-switch';
const ENTITY = { entityType: 'TASK' as const, entityId: '9cb94de8-c331-41aa-911e-1c50508a302f' };

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const storeAt = (baseDir: string): RunStore => {
  const runsDir = path.join(baseDir, 'runs');
  return new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
};

const makeHarness = async () => {
  vi.spyOn(WorkflowAboutReader.prototype, 'read').mockResolvedValue({
    workflowAboutId: ENTITY.entityId,
    workflowAboutType: 'TASK',
  });
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-provider-switch-'));
  tempDirs.push(baseDir);
  const runStore = storeAt(baseDir);
  await runStore.initialize();
  const runPrompt = vi.fn(() =>
    Promise.resolve({ providerSessionId: null, providerConversationId: null, errorCount: 0 }),
  );
  const projectModeBundleMaterializer = new ProjectModeBundleMaterializer();
  const postMessage = vi.fn(() => Promise.resolve({ id: 'message' }));
  const updateMessage = vi.fn<MessagePosterApiClient['updateMessage']>(() => Promise.resolve({}));
  const execution = new EvalAttemptExecution(NOOP_LOGGER);
  const wiring = createTestRunRegistryWiring({
    handlerDeps: createPromptTypeHandlerTestDeps({
      runStore,
      evalAttemptExecution: execution,
      fetchImpl: () => Promise.resolve(Response.json({ data: [] })),
    }),
    poster: new MessagePoster({
      apiClient: { postMessage, updateMessage },
      logger: NOOP_LOGGER,
      dataDir: baseDir,
    }),
    runStore,
    sessionRunner: { runPrompt, resumeSession: runPrompt },
    oauthClient: createTestOAuthClient({
      getAccessToken: vi.fn(() => Promise.resolve({ success: true as const, data: 'test-token' })),
    }),
    projectModeBundleMaterializer,
  });
  const service = new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    runStore,
    repoStore: createTestRepoMappingStore(),
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: wiring.workflowsApi,
    messagesApi: wiring.messagesApi,
    projectModeBundleMaterializer,
  });
  execution.bind(service, runStore);
  return { baseDir, runStore, service, runPrompt, wiring, postMessage, updateMessage, execution };
};

const startRunPayload = (overrides: Partial<StartRunTriggerPayload>): StartRunTriggerPayload =>
  ({
    agentSessionId: AGENT_SESSION_ID,
    workflowName: 'coding_session',
    provider: 'claude',
    model: 'claude-test',
    contextMetadata: {
      capturedAt: '2026-10-06T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: AGENT_SESSION_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
    payload: { promptType: 'workflow_kickoff', entity: ENTITY, userMessage: 'Start' },
    ...overrides,
  }) as unknown as StartRunTriggerPayload;

import { EvalAttemptExecution } from './eval-attempt-execution';
import type {
  EvalRecordedAttempt,
  EvalResolvedExecution,
  EvalTargetHandlerKey,
} from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';

const executionOf = (
  handler: EvalTargetHandlerKey,
  projectAssistantPrepares: boolean,
): EvalResolvedExecution =>
  handler === 'project_assistant'
    ? {
        handler,
        consumerHandler: 'entity_conversation',
        projectAssistantPrepares: false,
        assessedOutput: 'RESEARCH_REPORT',
      }
    : { handler, projectAssistantPrepares, assessedOutput: 'HANDLER_REPLY' };

const attempt = (
  handler: EvalTargetHandlerKey,
  options: { projectAssistantPrepares?: boolean; focalItemType?: 'TASK' | 'PROJECT' } = {},
): EvalRecordedAttempt => ({
  attemptId: '33333333-3333-4333-8333-333333333333',
  execution: executionOf(handler, options.projectAssistantPrepares ?? false),
  targetSessionId: AGENT_SESSION_ID,
  targetConversationId: CONVERSATION_ID,
  configuration: {
    id: 'configuration',
    target: {
      provider: 'claude',
      model: 'claude-test',
      reasoningEffort: 'high',
    },
  },
  caseInput: {
    id: 'case',
    evalCaseId: 'eval-case',
    title: 'Review',
    target: {
      targetHandler: handler,
      ...(handler === 'project_assistant'
        ? { consumerHandler: 'entity_conversation' as const }
        : {}),
      focalItemId: ENTITY.entityId,
      focalItemType: options.focalItemType ?? 'TASK',
      initiatingRequest: 'Review this item.',
      situation: 'SECRET-SITUATION',
    },
    grading: { checks: [], rubric: [], expectations: 'SECRET-EXPECTATIONS' },
  },
});
/** Saves research and a different completion note, as a research turn does. */
const finishWith = async (
  h: Awaited<ReturnType<typeof makeHarness>>,
  { research, finalMessage }: { research?: string; finalMessage: string },
): Promise<void> => {
  h.runPrompt.mockImplementationOnce(async () => {
    const turnId = (await h.runStore.getRunMetadata(AGENT_SESSION_ID))?.latestTurn?.turnId;
    if (research !== undefined) {
      await h.runStore.appendRunMemo(AGENT_SESSION_ID, {
        source: 'project_assistant',
        content: research,
        writtenAt: new Date().toISOString(),
      });
    }
    await h.runStore.updateRunFinalAssistantMessage(AGENT_SESSION_ID, {
      turnId: turnId ?? '',
      messageId: 'final',
      text: finalMessage,
      committedAt: new Date().toISOString(),
    });
    return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
  });
};

const coordinator = { contextMetadata: startRunPayload({}).contextMetadata } as AgenticSession;

describe('eval attempts through ordinary Runs', () => {
  it.each(['agent_search', 'entity_conversation', 'project_assistant'] as const)(
    'creates and prepares the actual %s handler',
    async (handler) => {
      const harness = await makeHarness();
      const { runStore, runPrompt, wiring, postMessage, execution } = harness;
      if (handler === 'project_assistant') {
        await finishWith(harness, { research: 'Saved research.', finalMessage: 'Done.' });
      }
      const result = await execution.execute(coordinator, attempt(handler), {
        signal: new AbortController().signal,
      });
      expect(result.preparationMeasurements?.[0]?.scope).toBe('TARGET_PREPARATION');
      expect(result.preparationMeasurements?.[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(runPrompt).toHaveBeenCalledOnce();
      expect(JSON.stringify(runPrompt.mock.calls)).not.toContain('SECRET-');
      expect(wiring.runRegistry.get(AGENT_SESSION_ID)?.session).toMatchObject({
        inert: true,
        conversationId: CONVERSATION_ID,
        model: 'claude-test',
        reasoningEffort: 'high',
      });
      expect((await runStore.getRunMetadata(AGENT_SESSION_ID))?.latestTurn?.state).toBe('settled');
      expect(JSON.stringify(postMessage.mock.calls)).not.toContain('SECRET-');
      if (handler === 'project_assistant') {
        expect(JSON.stringify(runPrompt.mock.calls)).toContain('project_assistant');
      }
    },
  );

  describe('run-level handler choice', () => {
    /** The prompts the provider actually ran, in order. */
    const promptsRun = (runPrompt: ReturnType<typeof vi.fn>): readonly string[] =>
      runPrompt.mock.calls.map(
        ([args]) => (args as import('../providers/session-runner').RunPromptArgs).prompt,
      );

    it('runs research alone for Project Assistant alone, starting no answering handler', async () => {
      const harness = await makeHarness();
      const { runStore, runPrompt, execution } = harness;
      await finishWith(harness, { research: 'Saved research.', finalMessage: 'Done.' });
      await execution.execute(coordinator, attempt('project_assistant'), {
        signal: new AbortController().signal,
      });
      expect(runPrompt).toHaveBeenCalledOnce();
      expect((await runStore.getRunMetadata(AGENT_SESSION_ID))?.startedPromptTypes).toEqual([
        'project_assistant',
      ]);
    });

    it('has Project Assistant research first and hand off to the chosen handler when it prepares', async () => {
      const { runPrompt, execution } = await makeHarness();
      await execution.execute(
        coordinator,
        attempt('entity_conversation', { projectAssistantPrepares: true }),
        { signal: new AbortController().signal },
      );
      expect(runPrompt).toHaveBeenCalledTimes(2);
      const [research, answer] = promptsRun(runPrompt);
      // Research is told which handler it prepares and quotes the unchanged request for it.
      expect(research).toContain('queued for the "entity_conversation" handler');
      expect(research).toContain('> Review this item.');
      expect(answer).not.toContain('queued for the "entity_conversation" handler');
    });

    it('runs the chosen handler without Project Assistant when preparation is off', async () => {
      const { runPrompt, execution } = await makeHarness();
      await execution.execute(coordinator, attempt('entity_conversation'), {
        signal: new AbortController().signal,
      });
      expect(runPrompt).toHaveBeenCalledOnce();
      expect(promptsRun(runPrompt)[0]).not.toContain(
        'queued for the "entity_conversation" handler',
      );
    });

    describe('which output is judged', () => {
      it('judges the saved research, not the completion note, for Project Assistant alone', async () => {
        const harness = await makeHarness();
        await finishWith(harness, {
          research: 'FULL-RESEARCH-REPORT',
          finalMessage: 'Done, report saved.',
        });
        const result = await harness.execution.execute(coordinator, attempt('project_assistant'), {
          signal: new AbortController().signal,
        });
        expect(result).toMatchObject({
          assistantCompleted: true,
          outputText: 'FULL-RESEARCH-REPORT',
        });
      });

      it('judges the handler reply, not the research, when a handler answers', async () => {
        const harness = await makeHarness();
        await finishWith(harness, {
          research: 'FULL-RESEARCH-REPORT',
          finalMessage: 'The handler answer.',
        });
        const result = await harness.execution.execute(
          coordinator,
          attempt('entity_conversation'),
          {
            signal: new AbortController().signal,
          },
        );
        expect(result).toMatchObject({ outputText: 'The handler answer.' });
      });

      it('fails the attempt when research ended without saving a report', async () => {
        const harness = await makeHarness();
        await finishWith(harness, { finalMessage: 'Here is what I found.' });
        await expect(
          harness.execution.execute(coordinator, attempt('project_assistant'), {
            signal: new AbortController().signal,
          }),
        ).rejects.toThrow(/research ended without saving a research report/);
      });
    });

    it('fails only the attempt whose handler cannot start as the first agent, with the reason', async () => {
      const { runPrompt, execution } = await makeHarness();
      // Feature sync declares it needs a Service folder, which attempts do not have.
      await expect(
        execution.execute(coordinator, attempt('feature_sync_analyze'), {
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/feature_sync_analyze failed before producing an answer/);
      expect(runPrompt).not.toHaveBeenCalled();
    });

    it('refuses a handler that analyzes a work item when the case has none', async () => {
      const { runPrompt, execution } = await makeHarness();
      await expect(
        execution.execute(
          coordinator,
          attempt('feature_sync_analyze', { focalItemType: 'PROJECT' }),
          { signal: new AbortController().signal },
        ),
      ).rejects.toThrow(/feature_sync_analyze cannot start as the first agent/);
      expect(runPrompt).not.toHaveBeenCalled();
    });
  });

  it('does not start an attempt cancelled before creation', async () => {
    const { service, runStore, runPrompt } = await makeHarness();
    const execution = new EvalAttemptExecution(NOOP_LOGGER);
    execution.bind(service, runStore);
    const controller = new AbortController();
    controller.abort();
    const result = await execution.execute(coordinator, attempt('agent_search'), {
      signal: controller.signal,
    });
    expect(result.assistantCompleted).toBe(false);
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it('preserves measured usage when a final total exceeds the token limit', async () => {
    const { service, runStore, runPrompt } = await makeHarness();
    runPrompt.mockImplementationOnce(async () => {
      await runStore.updateRunTokenUsage(AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const execution = new EvalAttemptExecution(NOOP_LOGGER);
    execution.bind(service, runStore);
    const onTokenLimit = vi.fn();
    const result = await execution.execute(coordinator, attempt('agent_search'), {
      signal: new AbortController().signal,
      tokenBudget: 10,
      onTokenLimit,
    });
    expect(result).toMatchObject({
      assistantCompleted: false,
      budgetExhausted: true,
      usage: { inputTokens: 11, outputTokens: 2 },
    });
    expect(onTokenLimit).toHaveBeenCalledOnce();
  });
});

describe('eval startup and execution cancellation', () => {
  it('cancels during materialization without dispatching an orphan first input', async () => {
    const { service, runStore, runPrompt } = await makeHarness();
    const original = service.createRun.bind(service);
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(service, 'createRun').mockImplementation(async (request) => {
      await pending;
      return original(request);
    });
    const controller = new AbortController();
    const execution = new EvalAttemptExecution(NOOP_LOGGER);
    execution.bind(service, runStore);
    const result = execution.execute(coordinator, attempt('agent_search'), {
      signal: controller.signal,
    });
    controller.abort();
    release();
    expect(await result).toMatchObject({ assistantCompleted: false, usage: {} });
    expect(runPrompt).not.toHaveBeenCalled();
    expect(await runStore.getRunMetadata(AGENT_SESSION_ID)).toMatchObject({ inert: true });
  });

  it.each(['USER', 'TOKEN_LIMIT'] as const)(
    'stops the active Run for %s and retains usage',
    async (reason) => {
      const { service, runStore, runPrompt, wiring } = await makeHarness();
      const controller = new AbortController();
      let started = (): void => undefined;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      runPrompt.mockImplementationOnce(async (...args: unknown[]) => {
        const input = args[0] as import('../providers/session-runner').RunPromptArgs;
        await runStore.updateRunTokenUsage(AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
        for (const providerSessionId of ['attempt-first', 'attempt-rotated']) {
          await runStore.appendRunProviderSessionHistory(AGENT_SESSION_ID, {
            providerSessionId,
            providerConversationId: null,
            providerSessionAgentId: 'agent_search',
            observedAt: new Date().toISOString(),
          });
        }
        started();
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            resolve();
            return;
          }
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
      });
      const execution = new EvalAttemptExecution(NOOP_LOGGER);
      execution.bind(service, runStore);
      const onTokenLimit = vi.fn(() => controller.abort());
      const onProviderSessionIds = vi.fn(async () => undefined);
      const running = execution.execute(coordinator, attempt('agent_search'), {
        signal: controller.signal,
        onProviderSessionIds,
        ...(reason === 'TOKEN_LIMIT' ? { tokenBudget: 10, onTokenLimit } : {}),
      });
      await entered;
      if (reason === 'USER') {
        controller.abort();
      }
      const result = await running;
      expect(result).toMatchObject({
        assistantCompleted: false,
        budgetExhausted: reason === 'TOKEN_LIMIT',
        usage: { inputTokens: 11, outputTokens: 2 },
      });
      expect(onProviderSessionIds).toHaveBeenCalledWith(['attempt-first', 'attempt-rotated']);
      expect(wiring.runRegistry.get(AGENT_SESSION_ID)?.isProcessing).toBe(false);
    },
  );
});

import { runEvalAttempts, type EvalAttemptPatch } from './eval-runner';

it.each(['USER', 'TOKEN_LIMIT'] as const)(
  'keeps the first %s reason when cancellation races final token settlement',
  async (firstReason) => {
    const { runStore, runPrompt, execution } = await makeHarness();
    const controller = new AbortController();
    runPrompt.mockImplementationOnce(async () => {
      await runStore.updateRunTokenUsage(AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
      if (firstReason === 'USER') {
        controller.abort();
      }
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const patches: EvalAttemptPatch[] = [];
    const judge = vi.fn();
    await runEvalAttempts(
      {
        attempts: [attempt('agent_search')],
        settings: { maxConcurrentAttempts: 1, attemptTokenLimit: 10 },
        signal: controller.signal,
      },
      {
        now: () => new Date(),
        recorder: {
          setRunStatus: () => Promise.resolve(),
          updateAttempt: (_id, patch) => {
            patches.push(patch);
            return Promise.resolve();
          },
        },
        async launchTarget(recorded, options) {
          const result = await execution.execute(coordinator, recorded, options);
          controller.abort();
          return result;
        },
        judge,
      },
    );
    expect(patches.at(-1)).toMatchObject({
      status: 'STOPPED',
      stopReason: firstReason,
    });
    expect(
      patches.at(-1)?.measurements?.find(({ scope }) => scope === 'TARGET_HANDLER'),
    ).toMatchObject({ inputTokens: 11, outputTokens: 2 });
    expect(judge).not.toHaveBeenCalled();
  },
);

describe('settled eval usage evidence', () => {
  it.each(['claude', 'codex', 'opencode'] as const)(
    'keeps %s fresh and cached input separate after settlement',
    async (provider) => {
      const h = await makeHarness();
      const recorded = attempt('agent_search');
      recorded.configuration.target.provider = provider;
      h.runPrompt.mockImplementationOnce(async () => {
        await h.runStore.setRunTokenUsage(recorded.targetSessionId, {
          inputTokens: 120,
          outputTokens: 8,
          cacheReadInputTokens: 500000,
          cacheCreationInputTokens: provider === 'codex' ? null : 0,
          cacheAvailability: provider === 'codex' ? 'partial' : 'reported',
        });
        const turn = (await h.runStore.getRunMetadata(recorded.targetSessionId))?.latestTurn;
        if (!turn) {
          throw new Error('The attempt has no active turn.');
        }
        await h.runStore.updateRunFinalAssistantMessage(recorded.targetSessionId, {
          turnId: turn.turnId,
          messageId: 'answer',
          text: 'Measured answer.',
          committedAt: new Date().toISOString(),
        });
        return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
      });
      const patches: EvalAttemptPatch[] = [];
      await runEvalAttempts(
        {
          attempts: [recorded],
          settings: { maxConcurrentAttempts: 1 },
          signal: new AbortController().signal,
        },
        {
          now: () => new Date(),
          recorder: {
            setRunStatus: async () => undefined,
            updateAttempt: async (_id, patch) => {
              patches.push(patch);
            },
          },
          launchTarget: (item, options) => h.execution.execute(coordinator, item, options),
          judge: async () => ({
            assessment: {
              checkResults: [],
              recognition: { recognized: true, explanation: 'Measured.' },
              quality: [],
              createdAt: new Date().toISOString(),
            },
            usage: { inputTokens: 17, outputTokens: 3 },
            elapsedMs: 1,
          }),
        },
      );
      expect(patches.at(-1)?.error).toBeUndefined();
      expect(patches.at(-1)?.status).toBe('COMPLETED');
      const measurements = patches.at(-1)?.measurements;
      const usage = measurements?.find((entry) => entry.scope === 'TARGET_HANDLER');
      expect(usage).toMatchObject({
        inputTokens: 120,
        outputTokens: 8,
        cacheReadInputTokens: 500000,
      });
      expect(measurements?.find((entry) => entry.scope === 'JUDGE')).toMatchObject({
        inputTokens: 17,
        outputTokens: 3,
      });
      if (provider === 'codex') {
        expect(usage).not.toHaveProperty('cacheCreationInputTokens');
      } else {
        expect(usage?.cacheCreationInputTokens).toBe(0);
      }
    },
  );

  it('retains output when fresh input is unavailable', async () => {
    const h = await makeHarness();
    h.runPrompt.mockImplementationOnce(async () => {
      await h.runStore.setRunTokenUsage(AGENT_SESSION_ID, {
        inputTokens: null,
        outputTokens: 8,
        cacheReadInputTokens: 500000,
        cacheAvailability: 'partial',
      });
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const result = await h.execution.execute(coordinator, attempt('agent_search'), {
      signal: new AbortController().signal,
      tokenBudget: 1,
    });
    expect(result.usage).not.toHaveProperty('inputTokens');
    expect(result.usage.outputTokens).toBe(8);
    expect(result.budgetExhausted).toBe(false);
  });

  it('isolates an unreadable result from a concurrent sibling attempt', async () => {
    const h = await makeHarness();
    const first = attempt('agent_search');
    const second = {
      ...attempt('agent_search'),
      targetSessionId: '44444444-4444-4444-8444-444444444444',
      targetConversationId: 'sibling-conversation',
    };
    const read = h.runStore.getRunResult.bind(h.runStore);
    vi.spyOn(h.runStore, 'getRunResult').mockImplementation((id) =>
      id === first.targetSessionId ? Promise.reject(new Error('Unreadable usage')) : read(id),
    );
    const results = await Promise.allSettled(
      [first, second].map((item) =>
        h.execution.execute(coordinator, item, { signal: new AbortController().signal }),
      ),
    );
    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('token measurements are unavailable'),
      }),
    });
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { assistantCompleted: true } });
  });
});
