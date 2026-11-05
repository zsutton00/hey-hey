import { SessionTokenUsageReader } from '../../provider-usage/session-token-usage';
import type { TokenUsage } from '../../session/types';
import { WorkflowAboutReader } from '../submission-tools/search-messages-proxy';
import type { MessagePosterApiClient } from '../../run/types';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { MessagePoster } from '../../run/message-poster';
import { NOOP_LOGGER } from '../../server/logger';
/** @vitest-environment node */

import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi
    .fn()
    .mockResolvedValue({ sourcePath: '/tmp/cfg.json', warnings: [] }),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

const startSessionMock = vi.fn();
let permissionRequestHandler:
  | ((toolName: string, input: unknown) => Promise<Record<string, unknown>>)
  | null = null;
let providerEventHandler: ((event: Record<string, unknown>) => void) | null = null;

// The Claude SDK is the process boundary: the real runner decides which tools
// a Run is offered and what its permission handler allows.
vi.mock('../../agent-runtime/index', async () => {
  const actual = await vi.importActual<typeof import('../../agent-runtime/index')>(
    '../../agent-runtime/index',
  );
  return {
    ...actual,
    ClaudeCodeSdkClient: class {
      startSession(...args: unknown[]) {
        return startSessionMock(...args);
      }
      getSessionId() {
        return null;
      }
      async disconnect() {}
      onPermissionRequest(handler: NonNullable<typeof permissionRequestHandler>) {
        permissionRequestHandler = handler;
      }
      onEvent(handler: typeof providerEventHandler) {
        providerEventHandler = handler;
      }
    },
  };
});

vi.mock('../prompts/session-start-context', () => ({
  readSessionStartContext: () =>
    Promise.resolve({ workItemTypeDefinitions: [], intentFirst: false, maturity: 'ESTABLISHED' }),
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

const nativeReports = new WeakMap<RunStore, Map<string, unknown>>();
let nativeSessionSequence = 0;
const recordProviderUsage = async (
  store: RunStore,
  runId: string,
  usage: Partial<TokenUsage>,
): Promise<void> => {
  const sessionId = `native-session-${String(++nativeSessionSequence)}`;
  const reports = nativeReports.get(store);
  if (!reports) {
    throw new Error('Native report fixture is missing.');
  }
  reports.set(sessionId, {
    sessionId,
    totalCost: NATIVE_SESSION_COST_USD,
    ...(usage.inputTokens != null ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens != null ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cacheReadInputTokens != null ? { cacheReadTokens: usage.cacheReadInputTokens } : {}),
    ...(usage.cacheCreationInputTokens != null
      ? { cacheCreationTokens: usage.cacheCreationInputTokens }
      : {}),
  });
  await store.updateRunProviderIdentity(runId, {
    providerSessionId: sessionId,
    providerSessionAgentId:
      (await store.getRunMetadata(runId))?.startedPromptTypes?.at(-1) ?? 'agent_search',
  });
  // Live telemetry may disagree; it only supplies the budget monitor.
  await store.setRunTokenUsage(runId, {
    ...usage,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
  });
};

const NATIVE_SESSION_COST_USD = 1.25;

/** ccusage is the boundary: it answers from the same native records as token usage. */
const executionFor = (store: RunStore): EvalAttemptExecution =>
  new EvalAttemptExecution(
    NOOP_LOGGER,
    new SessionCostReader(NOOP_LOGGER, () =>
      Promise.resolve(
        JSON.stringify({ sessions: [...(nativeReports.get(store)?.values() ?? [])] }),
      ),
    ),
  );

const storeAt = (baseDir: string): RunStore => {
  const runsDir = path.join(baseDir, 'runs');
  const reports = new Map<string, unknown>();
  const store = new RunStore({
    sessionTokenUsageReader: new SessionTokenUsageReader(() =>
      Promise.resolve(JSON.stringify({ sessions: [...reports.values()] })),
    ),
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  nativeReports.set(store, reports);
  return store;
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
  const runPrompt = vi.fn<
    (...args: unknown[]) => Promise<{
      providerSessionId: string | null;
      providerConversationId: string | null;
      errorCount: number;
    }>
  >(() =>
    Promise.resolve({ providerSessionId: null, providerConversationId: null, errorCount: 0 }),
  );
  const projectModeBundleMaterializer = new ProjectModeBundleMaterializer();
  const postMessage = vi.fn(() => Promise.resolve({ id: 'message' }));
  const updateMessage = vi.fn<MessagePosterApiClient['updateMessage']>(() => Promise.resolve({}));
  const execution = executionFor(runStore);
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
    sessionRunner: {
      runPrompt: async (...args) => {
        const result = await runPrompt(...args);
        return {
          ...result,
          providerSessionId:
            (await runStore.getRunMetadata(AGENT_SESSION_ID))?.provider_session_id ?? null,
        };
      },
      resumeSession: runPrompt,
    },
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
import { SessionCostReader } from '../../provider-usage/session-cost';
import type {
  EvalRecordedAttempt,
  EvalResolvedExecution,
  EvalTargetHandlerKey,
} from '@hey-hey/contracts/api/models';
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
      expect(result.researchMeasurements).toBeUndefined();
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

    it.each([true, false])('preserves research before handoff (reported=%s)', async (reported) => {
      const { runPrompt, runStore, execution } = await makeHarness();
      runPrompt.mockImplementationOnce(async () => {
        if (reported) {
          await recordProviderUsage(runStore, AGENT_SESSION_ID, {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: null,
            cacheAvailability: 'partial',
          });
        }
        return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
      });
      runPrompt.mockImplementationOnce(async () => {
        await recordProviderUsage(runStore, AGENT_SESSION_ID, {
          inputTokens: 300,
          outputTokens: 40,
          cacheReadInputTokens: 9000,
          cacheCreationInputTokens: null,
          cacheAvailability: 'partial',
        });
        return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
      });
      const result = await execution.execute(
        coordinator,
        attempt('entity_conversation', { projectAssistantPrepares: true }),
        { signal: new AbortController().signal },
      );
      expect(runPrompt).toHaveBeenCalledTimes(2);
      expect(result.usage).toMatchObject({
        inputTokens: 300,
        outputTokens: 40,
        cacheReadInputTokens: 9000,
      });
      const preparation = result.researchMeasurements?.[0];
      expect(preparation?.inputTokens).toBe(reported ? 100 : undefined);
      expect(preparation?.outputTokens).toBe(reported ? 20 : undefined);
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
    const execution = executionFor(runStore);
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
      await recordProviderUsage(runStore, AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const execution = executionFor(runStore);
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
    const execution = executionFor(runStore);
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
        await recordProviderUsage(runStore, AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
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
      const execution = executionFor(runStore);
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
      await recordProviderUsage(runStore, AGENT_SESSION_ID, { inputTokens: 11, outputTokens: 2 });
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
  it('reads standalone research usage after its active provider identity is discarded', async () => {
    const h = await makeHarness();
    h.runPrompt.mockImplementationOnce(async () => {
      await recordProviderUsage(h.runStore, AGENT_SESSION_ID, {
        inputTokens: 120,
        outputTokens: 8,
        cacheReadInputTokens: 500000,
      });
      await h.runStore.appendRunMemo(AGENT_SESSION_ID, {
        source: 'project_assistant',
        content: 'Saved research.',
        writtenAt: new Date().toISOString(),
      });
      return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
    });
    const result = await h.execution.execute(coordinator, attempt('project_assistant'), {
      signal: new AbortController().signal,
    });
    expect((await h.runStore.getRunMetadata(AGENT_SESSION_ID))?.provider_session_id).toBeNull();
    expect(result.researchMeasurements?.[0]?.inputTokens).toBeUndefined();
    expect(result.researchMeasurements?.[0]?.outputTokens).toBeUndefined();
    expect(result.usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 8,
      cacheReadInputTokens: 500000,
    });
  });

  it.each([true, false])(
    'uses the same native source with research preparation=%s',
    async (prepares) => {
      const h = await makeHarness();
      if (prepares) {
        h.runPrompt.mockImplementationOnce(async () => {
          await recordProviderUsage(h.runStore, AGENT_SESSION_ID, {
            inputTokens: 30,
            outputTokens: 3,
          });
          return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
        });
      }
      h.runPrompt.mockImplementationOnce(async () => {
        await recordProviderUsage(h.runStore, AGENT_SESSION_ID, {
          inputTokens: 120,
          outputTokens: 8,
          cacheReadInputTokens: 500000,
        });
        await h.runStore.setRunTokenUsage(AGENT_SESSION_ID, {
          inputTokens: prepares ? 14000 : 400000,
          outputTokens: 1,
        });
        return { providerSessionId: null, providerConversationId: null, errorCount: 0 };
      });
      const result = await h.execution.execute(
        coordinator,
        attempt('entity_conversation', { projectAssistantPrepares: prepares }),
        { signal: new AbortController().signal },
      );
      expect(result.usage).toMatchObject({
        inputTokens: 120,
        outputTokens: 8,
        cacheReadInputTokens: 500000,
      });
    },
  );

  it.each(['claude', 'codex'] as const)(
    'keeps %s fresh and cached input separate after settlement',
    async (provider) => {
      const h = await makeHarness();
      const recorded = attempt('agent_search');
      recorded.configuration.target.provider = provider;
      h.runPrompt.mockImplementationOnce(async () => {
        await recordProviderUsage(h.runStore, recorded.targetSessionId, {
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
      expect(usage?.cost).toEqual({ state: 'available', amount: 1.25, currency: 'USD' });
      expect(measurements?.some((entry) => entry.scope === 'JUDGE')).toBe(false);
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
      await recordProviderUsage(h.runStore, AGENT_SESSION_ID, {
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

describe('free-form coding attempt bound to a workspace directory', () => {
  it('starts on the request with no plan, edits only inside its directory, and cannot change the live graph', async () => {
    const { realpath } = await import('node:fs/promises');
    const { ClaudeAgentSessionRunner } = await import('../providers/claude/session-runner-claude');
    const { RunWorkspaceWriteBoundary } = await import('../workspace-write-boundary');
    const { resolveRunWorkspace } = await import('../run-scope');
    const { filterInertPlatformTools } = await import('../../run/inert-execution-policy');
    const { LocalAgentEndpoint } = await import('../../server/local-base-url');
    const { SubmissionToolRegistry } = await import('../submission-tools/registry');
    const { ToolRuleStore } = await import('../../session/tool-rules');
    const { createProviderTestRepoMappingStore } =
      await import('../providers/provider-owner.test-support');

    const harness = await makeHarness();
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'heyhey-workspace-')));
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'heyhey-outside-')));
    tempDirs.push(directory, outside);

    // 1. The attempt starts the free-form handler directly on the request.
    const { buildEvalFirstTurn } = await import('./eval-handler-launch');
    const firstTurn = buildEvalFirstTurn(
      executionOf('free_form', false),
      'Add a greeting file.',
      ENTITY,
    );
    const created = await harness.service.createRun({
      context: { projectId: 'project-1', provider: 'claude' },
      contextMetadata: coordinator.contextMetadata,
      conversationId: CONVERSATION_ID,
      attachments: [],
      stagedBrowserTab: null,
      inert: true,
      workspaceBinding: { serviceId: 'workspace-service', directory },
      // As an attempt does: Project Assistant never prepares a free-form coding case.
      config: {
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'claude-test',
        projectAssistant: {
          enabled: false,
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          allowUpdateProposals: false,
        },
      },
      payload: firstTurn.payload,
    });
    expect(created.status).toBe('started');
    const run = await harness.runStore.getRunMetadata(AGENT_SESSION_ID);
    expect(run).toMatchObject({
      inert: true,
      workspaceBound: true,
      launchServiceId: 'workspace-service',
      services: [{ id: 'workspace-service', path: directory }],
      startedPromptTypes: ['free_form'],
    });
    expect(JSON.stringify(harness.runPrompt.mock.calls)).toContain('Add a greeting file.');

    // 2. The real Claude runner, given that Run, offers file-writing built-ins
    // but no shell, and only inside the bound directory.
    const localAgentEndpoint = new LocalAgentEndpoint();
    localAgentEndpoint.set('http://127.0.0.1:9999');
    const toolRuleStore = new ToolRuleStore(path.join(harness.baseDir, 'tool-rules.json'));
    const repoStore = createProviderTestRepoMappingStore(directory);
    const session = run!;
    const workspace = await resolveRunWorkspace({ session, repoStore });
    if (!workspace.ok) {
      throw new Error(workspace.message);
    }
    const boundary = await RunWorkspaceWriteBoundary.create(workspace);
    startSessionMock.mockResolvedValue({
      ok: true,
      subtype: 'success',
      numTurns: 1,
      sessionId: null,
    });
    const platformTools = filterInertPlatformTools(['get_context', 'create_edge', 'delete_hint']);
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry: new SubmissionToolRegistry(),
      toolRuleStore,
      runStore: harness.runStore,
      repoStore,
    });
    const runPromise = runner.runPrompt({
      session,
      prompt: 'Add a greeting file.',
      workspace,
      workspaceWriteBoundary: boundary,
      platformMcpProxyMount: {
        runId: AGENT_SESSION_ID,
        turnId: 'turn-1',
        token: 'proxy-token',
        allowedTools: platformTools.map((name) => `mcp__heyhey-platform__${name}`),
      },
    });
    await vi.waitFor(() => expect(permissionRequestHandler).not.toBeNull());

    const startConfig = startSessionMock.mock.calls[0]?.[0] as {
      builtinTools: string[];
      cwd: string;
    };
    expect(startConfig.cwd).toBe(directory);
    expect(startConfig.builtinTools).toEqual(
      expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']),
    );
    expect(startConfig.builtinTools).not.toContain('Bash');

    const handler = permissionRequestHandler!;
    // The mocked SDK client stands in for Claude's own tool execution: it runs
    // a tool call only when the real permission handler allowed it, and then
    // applies it to the path the real write boundary resolved.
    const runWrite = async (toolInput: {
      file_path: string;
      content: string;
    }): Promise<'allowed' | 'denied'> => {
      const decision = await handler('Write', toolInput);
      if (decision['behavior'] !== 'allow') {
        return 'denied';
      }
      const resolved = decision['updatedInput'] as { file_path: string; content: string };
      await writeFile(resolved.file_path, resolved.content);
      return 'allowed';
    };

    await expect(
      runWrite({ file_path: path.join(directory, 'greeting.txt'), content: 'hello' }),
    ).resolves.toBe('allowed');
    expect(await readFile(path.join(directory, 'greeting.txt'), 'utf8')).toBe('hello');

    // A relative path resolves inside the bound directory, not the process cwd.
    await expect(runWrite({ file_path: 'nested.txt', content: 'relative' })).resolves.toBe(
      'allowed',
    );
    expect(await readFile(path.join(directory, 'nested.txt'), 'utf8')).toBe('relative');

    // Absolute path outside, relative escape, and a symlink out of the directory are all refused.
    await symlink(outside, path.join(directory, 'escape'));
    for (const toolInput of [
      { file_path: path.join(outside, 'abs.txt'), content: 'no' },
      { file_path: '../' + path.basename(outside) + '/rel.txt', content: 'no' },
      { file_path: 'escape/link.txt', content: 'no' },
    ]) {
      await expect(runWrite(toolInput)).resolves.toBe('denied');
    }
    await expect(
      handler('Edit', { file_path: path.join(outside, 'x.txt'), old_string: 'a', new_string: 'b' }),
    ).resolves.toMatchObject({ behavior: 'deny' });
    await expect(
      handler('MultiEdit', { file_path: path.join(outside, 'm.txt'), edits: [] }),
    ).resolves.toMatchObject({ behavior: 'deny' });
    // Nothing was created outside the bound directory.
    expect(await readdir(outside)).toEqual([]);

    await expect(handler('Bash', { command: 'touch x' })).resolves.toMatchObject({
      behavior: 'deny',
    });
    for (const graphWrite of ['create_edge', 'delete_hint', 'update_edge']) {
      await expect(handler(`mcp__heyhey-platform__${graphWrite}`, {})).resolves.toMatchObject({
        behavior: 'deny',
      });
    }

    providerEventHandler?.({ type: 'result' });
    await runPromise;
    await boundary.dispose();
  });
});
