import { retainProviderTestUsage } from '../provider-owner.test-support';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { ServerLogger } from '../../../server/logger';
import type { AgenticSession } from '../../../session/index';
import { ClaudeAgentSessionRunner } from './session-runner-claude';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { ToolRuleStore } from '../../../session/tool-rules';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import type { AgentRunResult, RunPromptArgs } from '../session-runner';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';
import * as userMcpConfig from './user-mcp-config';

// ---------------------------------------------------------------------------
// Turn-outcome tests for the Claude runner.
//
// Each test drives raw Claude stream-json events through the runner's live
// event handler and then asserts everything the Run reads back once the
// handler has finished: the resolved result or the mapped failure, the
// assistant output delivered live and in what order, the durable events
// persisted and in what order, the run status transitions, and the
// diagnostics logged. Nothing here asserts on the runner's internal turn
// variables, so the tests survive the handler moving into its own module.
//
// The fake ClaudeCodeSdkClient mirrors the one in session-runner-claude.test.ts:
// lifecycle calls delegate to vi.fns, and `onEvent` captures the handler so a
// test can emit events while the session promise is in flight.
// ---------------------------------------------------------------------------

const loadUserMcpConfigMock = vi.spyOn(userMcpConfig, 'loadClaudeUserMcpConfig');

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();
const toolRuleStoreDirectory = mkdtempSync(join(tmpdir(), 'hey-hey-claude-outcome-rules-'));
const toolRuleStore = new ToolRuleStore(join(toolRuleStoreDirectory, 'tool-rules.json'));
vi.spyOn(toolRuleStore, 'load').mockReturnValue([]);
vi.spyOn(toolRuleStore, 'save').mockImplementation(() => undefined);

afterAll(() => {
  rmSync(toolRuleStoreDirectory, { recursive: true, force: true });
});

const CLAUDE_TURN_SUCCESS = {
  ok: true,
  subtype: 'success',
  numTurns: 1,
  sessionId: 'provider-session-1',
} as const;

const startSessionMock = vi.fn();
const continueSessionMock = vi.fn();
const getSessionIdMock = vi.fn();
const disconnectMock = vi.fn();
let eventHandler: ((event: Record<string, unknown>) => void) | null = null;

vi.mock('../../../agent-runtime/index', async () => {
  const actual = await vi.importActual<typeof import('../../../agent-runtime/index')>(
    '../../../agent-runtime/index',
  );
  return {
    ...actual,
    ClaudeCodeSdkClient: class {
      startSession(...args: Parameters<typeof startSessionMock>) {
        return startSessionMock(...args);
      }
      continueSession(...args: Parameters<typeof continueSessionMock>) {
        return continueSessionMock(...args);
      }
      getSessionId() {
        return getSessionIdMock();
      }
      getContextUsage() {
        return Promise.reject(new Error('not used'));
      }
      getUsage() {
        return Promise.reject(new Error('not used'));
      }
      connectForControl() {
        return Promise.resolve();
      }
      compact() {
        return Promise.resolve();
      }
      async disconnect() {
        disconnectMock();
        getSessionIdMock.mockReturnValue(null);
      }
      onPermissionRequest() {}
      onEvent(handler: ((event: Record<string, unknown>) => void) | null) {
        eventHandler = handler;
      }
    },
  };
});

const emitClaudeEvent = (event: Record<string, unknown>): void => {
  eventHandler?.(event);
};

const waitForEventHandler = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(eventHandler).not.toBeNull();
  });
};

const assistantEvent = (
  text: string,
  usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 },
): Record<string, unknown> => ({
  type: 'assistant',
  session_id: 'provider-session-1',
  message: { content: [{ type: 'text', text }], usage },
});

const resultEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  session_id: 'provider-session-1',
  usage: { input_tokens: 100, output_tokens: 40 },
  ...overrides,
});

const createContextMetadata = (): AgenticSession['contextMetadata'] => ({
  capturedAt: '2026-02-20T00:00:00.000Z',
  organizationId: 'org-1',
  projectId: 'project-1',
  agentSessionId: 'agent-session-1',
  launchPlanId: 'plan-1',
  launchStepId: 'step-1',
  task: {
    id: 'task-1',
    name: 'Task one',
    type: 'STANDARD' as const,
    organizationId: 'org-1',
    projectId: 'project-1',
    initiativeId: 'initiative-1',
    status: 'ACTIVE' as const,
    source: 'user' as const,
  },
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession => {
  const base: AgenticSession = {
    entity: null,
    agentic_session_id: 'agentic-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'claude',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    provider_session_agent_id: 'test-agent',
    status: 'idle',
    contextMetadata: createContextMetadata(),
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    conversationId: 'conv-1',
    events: [],
  };
  return {
    ...base,
    ...overrides,
    contextMetadata: overrides.contextMetadata ?? base.contextMetadata,
    events: overrides.events ?? base.events,
  };
};

const makeRunStore = (): RunStore => createProviderTestRunStore(makeSession);
const makeRepoStore = (): RepoMappingStore => createProviderTestRepoMappingStore();

const makeLogger = (): { logger: ServerLogger; calls: Array<[string, string, unknown]> } => {
  const calls: Array<[string, string, unknown]> = [];
  const level = (name: string) =>
    vi.fn((event: string, fields?: unknown) => {
      calls.push([name, event, fields]);
    });
  let logger!: ServerLogger;
  logger = {
    trace: level('trace'),
    debug: level('debug'),
    info: level('info'),
    warn: level('warn'),
    error: level('error'),
    child: vi.fn<ServerLogger['child']>(() => logger),
  };
  return { logger, calls };
};

// ----- the turn outcome the Run reads back -----------------------------------

interface LiveEvent {
  source: string;
  eventType: string;
  sessionId: string | null;
  payload: Record<string, unknown>;
}

interface TurnOutcome {
  result: AgentRunResult | null;
  failure: { code: string; message: string } | null;
  // Assistant output delivered to the Run, in delivery order.
  liveAssistant: Array<{ summary: string; taskComplete: boolean }>;
  liveEvents: LiveEvent[];
  processingPhases: string[];
  runStatusEvents: string[];
  // Every durable event appended to the run store, in append order, as
  // `actor:event_type[:messageType[:detail]]`.
  persisted: string[];
  runCompleted: Record<string, unknown> | null;
  statuses: string[];
  identityWrites: Array<Record<string, unknown>>;
  tokenUsageWrites: Array<Record<string, unknown>>;
  resultUsageWrites: Array<Record<string, unknown>>;
  logs: Array<[string, string, unknown]>;
  logFields: (event: string) => Record<string, unknown> | null;
}

const describePersistedEvent = (event: {
  actor: string;
  event_type: string;
  payload?: Record<string, unknown>;
}): string => {
  const base = `${event.actor}:${event.event_type}`;
  if (event.event_type !== 'agent_output' || !event.payload) return base;
  const messageType = String(event.payload['messageType']);
  if (messageType === 'provider_event')
    return `${base}:provider_event:${event.payload['eventType']}`;
  if (messageType === 'assistant') return `${base}:assistant:${event.payload['summary']}`;
  return `${base}:${messageType}`;
};

interface TurnHarness {
  runner: ClaudeAgentSessionRunner;
  runStore: RunStore;
  onAgentOutput: ReturnType<typeof vi.fn>;
  logs: Array<[string, string, unknown]>;
}

const makeHarness = (
  agentOutputOwner?: ReturnType<typeof createProviderTestAgentOutputOwner>,
): TurnHarness => {
  const runStore = makeRunStore();
  const onAgentOutput = vi.fn();
  const { logger, calls } = makeLogger();
  const owner = agentOutputOwner ?? createProviderTestAgentOutputOwner(onAgentOutput);
  if (agentOutputOwner) vi.mocked(agentOutputOwner.onAgentOutput).mockImplementation(onAgentOutput);
  const runner = new ClaudeAgentSessionRunner({
    localAgentEndpoint,
    submissionToolRegistry,
    toolRuleStore,
    runStore,
    repoStore: makeRepoStore(),
    agentOutputOwner: owner,
    logger,
  });
  return { runner, runStore, onAgentOutput, logs: calls };
};

const readOutcome = async (
  harness: TurnHarness,
  run: Promise<AgentRunResult>,
): Promise<TurnOutcome> => {
  let result: AgentRunResult | null = null;
  let failure: TurnOutcome['failure'] = null;
  try {
    result = await run;
  } catch (error) {
    const record = error as { code?: unknown; message?: unknown };
    failure = { code: String(record.code), message: String(record.message) };
  }
  const liveEvents = (harness.onAgentOutput.mock.calls as [{ event: LiveEvent }][]).map(
    ([call]) => call.event,
  );
  const liveAssistant = liveEvents
    .filter(
      (event) => event.eventType === 'agent_output' && event.payload['messageType'] === 'assistant',
    )
    .map((event) => ({
      summary: String(event.payload['summary']),
      taskComplete: event.payload['taskComplete'] === true,
    }));
  const processing = liveEvents.filter((event) => event.eventType === 'processing_status');
  const appended = vi.mocked(harness.runStore.appendEvent).mock.calls.map(([, event]) => event);
  const runCompleted =
    (appended.find((event) => event.event_type === 'run_completed')?.payload as
      | Record<string, unknown>
      | undefined) ?? null;
  return {
    result,
    failure,
    liveAssistant,
    liveEvents,
    processingPhases: processing
      .map((event) => event.payload['phase'])
      .filter((phase): phase is string => typeof phase === 'string'),
    runStatusEvents: processing
      .filter((event) => event.payload['kind'] === 'run.status')
      .map((event) => String(event.payload['status'])),
    persisted: appended.map((event) =>
      describePersistedEvent(event as Parameters<typeof describePersistedEvent>[0]),
    ),
    runCompleted,
    statuses: vi.mocked(harness.runStore.updateRunStatus).mock.calls.map(([, status]) => status),
    identityWrites: vi
      .mocked(harness.runStore.updateRunProviderIdentity)
      .mock.calls.map(([, identity]) => identity as Record<string, unknown>),
    tokenUsageWrites: vi
      .mocked(harness.runStore.updateRunTokenUsage)
      .mock.calls.map(([, usage]) => usage as Record<string, unknown>),
    resultUsageWrites: vi
      .mocked(harness.runStore.setRunTokenUsage)
      .mock.calls.map(([, usage]) => usage as Record<string, unknown>),
    logs: harness.logs,
    logFields: (event) => {
      const entry = harness.logs.filter(([, name]) => name === event).at(-1);
      return entry ? (entry[2] as Record<string, unknown>) : null;
    },
  };
};

// Start a turn, wait until the runner is listening for events, then hand the
// event handler to the test so it can play the provider stream.
const startTurn = (
  harness: TurnHarness,
  args: Partial<RunPromptArgs> = {},
): { run: Promise<AgentRunResult>; ready: Promise<void> } => {
  const run = harness.runner.runPrompt({
    session: makeSession(),
    prompt: 'Do the work.',
    ...args,
  });
  // Keep an unhandled rejection from surfacing while the test is still emitting.
  run.catch(() => undefined);
  return { run, ready: waitForEventHandler() };
};

describe('Claude turn outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadUserMcpConfigMock.mockResolvedValue({ mcpServers: {}, serverNames: [], allowedTools: [] });
    eventHandler = null;
    startSessionMock.mockImplementation(async () => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      return CLAUDE_TURN_SUCCESS;
    });
    continueSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
    getSessionIdMock.mockReturnValue(null);
    localAgentEndpoint.set('http://127.0.0.1:9999');
    submissionToolRegistry.clearAll();
  });

  it('completes a turn, delivers superseded assistant messages immediately and finalizes the last', async () => {
    const harness = makeHarness();
    await retainProviderTestUsage(harness.runStore, makeSession());
    const { run, ready } = startTurn(harness);
    await ready;
    emitClaudeEvent(assistantEvent('First answer.'));
    emitClaudeEvent({ type: 'tool_use', session_id: 'provider-session-1' });
    emitClaudeEvent(assistantEvent('Second answer.', { input_tokens: 20, output_tokens: 8 }));
    emitClaudeEvent(resultEvent());
    const outcome = await readOutcome(harness, run);

    await vi.waitFor(async () => {
      expect(
        (await harness.runStore.getRunResult(makeSession().agentic_session_id))?.usage,
      ).toMatchObject({ inputTokens: 100, outputTokens: 40 });
    });
    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'provider-session-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.liveAssistant).toEqual([
      { summary: 'First answer.', taskComplete: false },
      { summary: 'Second answer.', taskComplete: true },
    ]);
    expect(outcome.processingPhases).toEqual([
      'starting',
      'thinking',
      'writing',
      'thinking',
      'writing',
    ]);
    expect(outcome.runStatusEvents).toEqual(['complete']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:assistant',
      'agent:agent_output:assistant:First answer.',
      'agent:agent_output:provider_event:tool_use',
      'agent:agent_output:provider_event:assistant',
      'agent:agent_output:assistant:Second answer.',
      'agent:agent_output:provider_event:result',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      provider_session_id: 'provider-session-1',
      provider_conversation_id: null,
      errorCount: 0,
    });
    expect(outcome.statuses).toEqual(['running', 'complete']);
    // Identity is written eagerly from the first event and again at completion.
    expect(outcome.identityWrites).toEqual([
      { providerSessionId: 'provider-session-1', providerSessionAgentId: 'test-agent' },
      {
        providerSessionId: 'provider-session-1',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      },
    ]);
    expect(outcome.tokenUsageWrites).toEqual([
      { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      { inputTokens: 20, outputTokens: 8, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);
    expect(outcome.resultUsageWrites).toEqual([
      { inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ]);
    expect(outcome.logFields('local.runner.claude.run_prompt.succeeded')).toMatchObject({
      providerSessionId: 'provider-session-1',
      providerConversationId: null,
      durationMs: expect.any(Number),
    });
    expect(outcome.logFields('local.runner.claude.event.normalization')).toMatchObject({
      eventType: 'result',
      normalizationSuccessCount: 4,
      normalizationFailureCount: 0,
      // The bare tool_use event has no canonical shape: it counts as a schema
      // mismatch in permissive mode without being a failure.
      normalizationSchemaMismatchCount: 1,
    });
    expect(outcome.logFields('local.runner.claude.events_done.settled')).not.toBeNull();
    expect(outcome.logFields('local.runner.claude.run_prompt.failed')).toBeNull();
  });

  it('completes a turn that produced no assistant output', async () => {
    const harness = makeHarness();
    const { run, ready } = startTurn(harness);
    await ready;
    emitClaudeEvent(resultEvent());
    const outcome = await readOutcome(harness, run);

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'provider-session-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.liveAssistant).toEqual([]);
    expect(outcome.processingPhases).toEqual(['starting', 'thinking']);
    expect(outcome.runStatusEvents).toEqual(['complete']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:result',
      'system:run_completed',
    ]);
    expect(outcome.statuses).toEqual(['running', 'complete']);
    expect(outcome.runCompleted).toMatchObject({ errorCount: 0 });
  });

  it('fails the turn when the result reports an error, yet finalizes the buffered output and keeps the session resumable', async () => {
    startSessionMock.mockImplementation(async () => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      return {
        ok: false,
        subtype: 'error_max_turns',
        numTurns: 12,
        sessionId: 'provider-session-1',
        errors: [],
        errorText: 'Reached maximum number of turns (12)',
      };
    });
    const harness = makeHarness();
    const { run, ready } = startTurn(harness);
    await ready;
    emitClaudeEvent(assistantEvent('Partial work.'));
    emitClaudeEvent(resultEvent({ subtype: 'error_max_turns', is_error: true }));
    const outcome = await readOutcome(harness, run);

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({
      code: 'RUN_FAILED',
      message: 'Claude run failed: Reached maximum number of turns (12)',
    });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Partial work.', taskComplete: true }]);
    expect(outcome.runStatusEvents).toEqual(['complete']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:assistant',
      'agent:agent_output:assistant:Partial work.',
      'agent:agent_output:provider_event:result',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      error: 'Claude run failed: Reached maximum number of turns (12)',
      code: 'RUN_FAILED',
    });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(outcome.identityWrites).toContainEqual({
      providerSessionId: 'provider-session-1',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });
    expect(outcome.logFields('local.runner.claude.run_prompt.failed')).toMatchObject({
      error: expect.objectContaining({ code: 'RUN_FAILED' }),
    });
    expect(outcome.logFields('local.runner.claude.run_prompt.succeeded')).toBeNull();
  });

  it('reports a model-capacity rejection as an ordinary run failure', async () => {
    startSessionMock.mockImplementation(async () => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      return {
        ok: false,
        subtype: 'error_during_execution',
        numTurns: 1,
        sessionId: 'provider-session-1',
        errors: ['Selected model is at capacity.'],
        errorText: 'Selected model is at capacity.',
      };
    });
    const harness = makeHarness();
    const { run, ready } = startTurn(harness);
    await ready;
    emitClaudeEvent(resultEvent({ subtype: 'error_during_execution', is_error: true }));
    const outcome = await readOutcome(harness, run);

    expect(outcome.failure).toEqual({
      code: 'RUN_FAILED',
      message: 'Claude run failed: Selected model is at capacity.',
    });
    expect(outcome.runCompleted).toMatchObject({ code: 'RUN_FAILED' });
    expect(outcome.statuses).toEqual(['running', 'idle']);
  });

  it('fails the turn when the provider process drops before a result', async () => {
    const dropProcess = { reject: (_error: Error): void => undefined };
    startSessionMock.mockImplementation(() => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      return new Promise((_resolve, reject) => {
        dropProcess.reject = reject;
      });
    });
    const harness = makeHarness();
    const { run, ready } = startTurn(harness);
    await ready;
    emitClaudeEvent(assistantEvent('Partial work.'));
    dropProcess.reject(new Error('Claude process exited with code 1'));
    const outcome = await readOutcome(harness, run);

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({
      code: 'RUN_FAILED',
      message: 'Claude process exited with code 1',
    });
    // No result ever arrived, so the buffered output is never finalized.
    expect(outcome.liveAssistant).toEqual([]);
    expect(outcome.runStatusEvents).toEqual([]);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:assistant',
      'agent:agent_output:assistant:Partial work.',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      error: 'Claude process exited with code 1',
      code: 'RUN_FAILED',
    });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(outcome.logFields('local.runner.claude.session_promise.rejected')).toMatchObject({
      error: expect.objectContaining({ message: 'Claude process exited with code 1' }),
    });
    expect(outcome.logFields('local.runner.claude.run_prompt.failed')).toMatchObject({
      error: expect.objectContaining({ code: 'RUN_FAILED' }),
    });
  });

  it('reports a canceled turn as a failed run when the provider aborts', async () => {
    const controller = new AbortController();
    startSessionMock.mockImplementation(async () => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      controller.abort();
      throw new Error('Aborted');
    });
    const harness = makeHarness();
    const { run } = startTurn(harness, { signal: controller.signal });
    const outcome = await readOutcome(harness, run);

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: 'Aborted' });
    expect(outcome.runCompleted).toEqual({ mode: 'prompt', error: 'Aborted', code: 'RUN_FAILED' });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    for (const event of ['run_prompt.failed', 'session_promise.rejected', 'events_done.rejected']) {
      expect(outcome.logFields(`local.runner.claude.${event}`)).toBeNull();
    }
  });

  it('settles a canceled turn as a failed run even when the provider never sends a result', async () => {
    const controller = new AbortController();
    const harness = makeHarness();
    const { run, ready } = startTurn(harness, { signal: controller.signal });
    await ready;
    emitClaudeEvent(assistantEvent('Still working.'));
    controller.abort();
    const outcome = await readOutcome(harness, run);

    expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: 'Aborted' });
    expect(outcome.liveAssistant).toEqual([]);
    expect(outcome.runCompleted).toEqual({ mode: 'prompt', error: 'Aborted', code: 'RUN_FAILED' });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    for (const event of ['run_prompt.failed', 'session_promise.rejected', 'events_done.rejected']) {
      expect(outcome.logFields(`local.runner.claude.${event}`)).toBeNull();
    }
  });

  it('resolves a Service-scope cancellation quietly without a completion record', async () => {
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    const controller = agentOutputOwner.createAbortController();
    await agentOutputOwner.serviceScope.pauseForServiceScopeRequest('scope-request-1', 'automatic');
    agentOutputOwner.serviceScope.settleServiceScopeRequest('scope-request-1');
    agentOutputOwner.serviceScope.settleServiceScopeApprovalWait('scope-request-1', 'starting');
    startSessionMock.mockImplementation(async () => {
      getSessionIdMock.mockReturnValue('provider-session-1');
      throw new Error('Aborted');
    });
    const harness = makeHarness(agentOutputOwner);
    const { run } = startTurn(harness, { signal: controller.signal });
    const outcome = await readOutcome(harness, run);

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'provider-session-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.runCompleted).toBeNull();
    expect(outcome.persisted).toEqual(['app:run_started']);
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(
      outcome.logFields('local.runner.claude.run_prompt.aborted_for_service_scope'),
    ).toMatchObject({ providerSessionId: 'provider-session-1' });
    expect(outcome.logFields('local.runner.claude.run_prompt.failed')).toBeNull();
  });

  it('records a strict-mode normalization failure in the diagnostics without failing the turn', async () => {
    const previousMode = process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = 'strict';
    try {
      const harness = makeHarness();
      const { run, ready } = startTurn(harness);
      await ready;
      emitClaudeEvent({ type: 'permission_request', session_id: 'provider-session-1' });
      emitClaudeEvent(resultEvent());
      const outcome = await readOutcome(harness, run);

      expect(outcome.failure).toBeNull();
      expect(outcome.statuses).toEqual(['running', 'complete']);
      const normalizationLogs = outcome.logs.filter(
        ([, event]) => event === 'local.runner.claude.event.normalization',
      );
      expect(normalizationLogs.map(([level]) => level)).toEqual(['warn', 'trace']);
      expect(normalizationLogs.at(-1)?.[2]).toMatchObject({
        normalizationSuccessCount: 1,
        normalizationFailureCount: 1,
      });
    } finally {
      if (previousMode === undefined)
        delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
      else process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = previousMode;
    }
  });
});
