import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { ServerLogger } from '../../../server/logger';
import type { AgenticSession } from '../../../session/index';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import { CAPACITY_RETRY_MESSAGE, CodexAgentSessionRunner } from './session-runner-codex';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import type { SubmissionToolDeclaration } from '../../submission-tools/types';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import type { AgentRunResult, RunPromptArgs } from '../session-runner';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';

// ---------------------------------------------------------------------------
// Turn-outcome tests for the Codex runner.
//
// Each test drives raw Codex app-server notifications and ServerRequests
// through the runner's live handlers and then asserts everything the Run reads
// back once the handlers have finished: the resolved result or the mapped
// failure, the assistant output delivered live and in what order, the durable
// events persisted and in what order, the run status transitions, and the
// diagnostics logged. Nothing here asserts on the runner's internal turn
// variables, so the tests survive the handlers moving into their own module.
//
// The fake CodexSdkClient mirrors the one in session-runner-codex.test.ts:
// lifecycle calls delegate to vi.fns whose implementation a test fills in, and
// `thread/started` is what surfaces the native thread id through
// getSessionId(), exactly as the real client does.
// ---------------------------------------------------------------------------

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();

interface SdkServerRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

let sdkEventHandler:
  | ((event: { method: string; params?: Record<string, unknown> }) => void)
  | null = null;
let sdkServerRequestHandler: ((request: SdkServerRequest) => void) | null = null;
let sdkRootThreadId: string | null = null;
let sdkRootTurnId: string | null = null;
const sdkStartSessionMock = vi.fn();
const sdkResumeSessionMock = vi.fn();
const sdkDisconnectMock = vi.fn();
const sdkGetSessionIdMock = vi.fn();
const sdkSubmitClientResponseMock = vi.fn();

vi.mock('@hey-hey/ui-common/agents', async () => {
  const actual = await vi.importActual<typeof import('@hey-hey/ui-common/agents')>(
    '@hey-hey/ui-common/agents',
  );
  return {
    ...actual,
    CodexSdkClient: class {
      startSession(...args: Parameters<typeof sdkStartSessionMock>) {
        return sdkStartSessionMock(...args);
      }
      resumeSession(...args: Parameters<typeof sdkResumeSessionMock>) {
        return sdkResumeSessionMock(...args);
      }
      onEvent(
        handler: ((event: { method: string; params?: Record<string, unknown> }) => void) | null,
      ) {
        sdkEventHandler = handler;
      }
      onServerRequest(handler: ((request: SdkServerRequest) => void) | null) {
        sdkServerRequestHandler = handler;
      }
      getSessionId() {
        return sdkGetSessionIdMock();
      }
      getRootTurnIdentity() {
        return sdkRootThreadId && sdkRootTurnId
          ? { threadId: sdkRootThreadId, turnId: sdkRootTurnId }
          : null;
      }
      disconnect(...args: Parameters<typeof sdkDisconnectMock>) {
        return sdkDisconnectMock(...args);
      }
      compact() {
        return Promise.resolve();
      }
      getContextUsage() {
        return Promise.reject(new Error('not used'));
      }
      getContextUsageByResume() {
        return Promise.reject(new Error('not used'));
      }
      submitClientResponse(...args: Parameters<typeof sdkSubmitClientResponseMock>) {
        return sdkSubmitClientResponseMock(...args);
      }
    },
  };
});

const isTestRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Feed a raw Codex ServerNotification into the runner's live event handler.
// `thread/started` captures the root thread; later events are routed to the
// root turn unless the test supplies its own threadId/turnId.
const emitSdkEvent = (method: string, params: Record<string, unknown> = {}): void => {
  if (method === 'thread/started') {
    const thread = (params as { thread?: { id?: unknown } }).thread;
    if (typeof thread?.id === 'string' && sdkRootThreadId === null) {
      sdkRootThreadId = thread.id;
      sdkRootTurnId = 'codex-root-turn-1';
      sdkGetSessionIdMock.mockReturnValue(thread.id);
    }
  }
  const nestedTurn = isTestRecord(params['turn']) ? params['turn'] : null;
  if (method === 'turn/started') {
    const startedThreadId = typeof params['threadId'] === 'string' ? params['threadId'] : null;
    const startedTurnId =
      typeof params['turnId'] === 'string'
        ? params['turnId']
        : typeof nestedTurn?.['id'] === 'string'
          ? nestedTurn['id']
          : null;
    if (startedThreadId === sdkRootThreadId && startedTurnId) {
      sdkRootTurnId = startedTurnId;
    }
  }
  const routedTurnId =
    typeof params['turnId'] === 'string'
      ? params['turnId']
      : typeof nestedTurn?.['id'] === 'string'
        ? nestedTurn['id']
        : sdkRootTurnId;
  const routedParams =
    method === 'thread/started' || sdkRootThreadId === null || sdkRootTurnId === null
      ? params
      : {
          threadId: sdkRootThreadId,
          turnId: routedTurnId,
          ...params,
          ...(method === 'turn/started' || method === 'turn/completed'
            ? { turn: { id: routedTurnId, ...(nestedTurn ?? {}) } }
            : {}),
        };
  sdkEventHandler?.({ method, params: routedParams });
};

const emitSdkServerRequest = (request: SdkServerRequest): void => {
  sdkServerRequestHandler?.(request);
};

const threadStarted = (): void =>
  emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
const agentMessage = (text: string): void =>
  emitSdkEvent('item/completed', { item: { type: 'agentMessage', text } });
const turnCompleted = (status = 'completed'): void =>
  emitSdkEvent('turn/completed', { turn: { status } });

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const createDeferred = (): Deferred => {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  if (!resolve) throw new Error('Failed to construct deferred promise.');
  return { promise, resolve };
};

const settlePersistQueue = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const fakeSubmissionTool: SubmissionToolDeclaration = {
  name: 'create_report',
  description: 'Submit the report.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async () => ({ action: 'CREATE_REPORT' }),
};

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
    provider: 'codex',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    provider_session_agent_id: 'test-agent',
    status: 'idle',
    conversationId: 'conv-1',
    contextMetadata: createContextMetadata(),
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
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
const makeRepoStore = (): RepoMappingStore => createProviderTestRepoMappingStore('/tmp/repo');

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
  payload: Record<string, unknown>;
}

interface TurnOutcome {
  result: AgentRunResult | null;
  failure: { code: string; message: string } | null;
  // Assistant output delivered to the Run, in delivery order.
  liveAssistant: Array<{ summary: string; taskComplete: boolean }>;
  liveEvents: LiveEvent[];
  processingPhases: string[];
  // Every durable event appended to the run store, in append order, as
  // `actor:event_type[:messageType[:detail]]`.
  persisted: string[];
  persistedJson: string;
  runCompleted: Record<string, unknown> | null;
  statuses: string[];
  identityWrites: Array<Record<string, unknown>>;
  logs: Array<[string, string, unknown]>;
  logFields: (event: string) => Record<string, unknown> | null;
  disconnects: number;
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
  if (messageType === 'permission_decision_ui') {
    return `${base}:permission_decision_ui:${event.payload['requestId']}:${event.payload['decision']}`;
  }
  return `${base}:${messageType}`;
};

const readOutcome = async (input: {
  run: Promise<AgentRunResult>;
  runStore: RunStore;
  onAgentOutput: ReturnType<typeof vi.fn>;
  logs: Array<[string, string, unknown]>;
}): Promise<TurnOutcome> => {
  let result: AgentRunResult | null = null;
  let failure: TurnOutcome['failure'] = null;
  try {
    result = await input.run;
  } catch (error) {
    const record = error as { code?: unknown; message?: unknown };
    failure = { code: String(record.code), message: String(record.message) };
  }
  const liveEvents = (input.onAgentOutput.mock.calls as [{ event: LiveEvent }][]).map(
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
  const processingPhases = liveEvents
    .filter((event) => event.eventType === 'processing_status')
    .map((event) => event.payload['phase'])
    .filter((phase): phase is string => typeof phase === 'string');
  const appended = vi.mocked(input.runStore.appendEvent).mock.calls.map(([, event]) => event);
  const runCompleted =
    (appended.find((event) => event.event_type === 'run_completed')?.payload as
      | Record<string, unknown>
      | undefined) ?? null;
  return {
    result,
    failure,
    liveAssistant,
    liveEvents,
    processingPhases,
    persisted: appended.map((event) =>
      describePersistedEvent(event as Parameters<typeof describePersistedEvent>[0]),
    ),
    persistedJson: JSON.stringify(appended),
    runCompleted,
    statuses: vi.mocked(input.runStore.updateRunStatus).mock.calls.map(([, status]) => status),
    identityWrites: vi
      .mocked(input.runStore.updateRunProviderIdentity)
      .mock.calls.map(([, identity]) => identity as Record<string, unknown>),
    logs: input.logs,
    logFields: (event) => {
      const entry = input.logs.filter(([, name]) => name === event).at(-1);
      return entry ? (entry[2] as Record<string, unknown>) : null;
    },
    disconnects: sdkDisconnectMock.mock.calls.length,
  };
};

const runTurn = async (
  provider: () => Promise<void> | void,
  args: Partial<RunPromptArgs> & {
    agentOutputOwner?: ReturnType<typeof createProviderTestAgentOutputOwner>;
  } = {},
): Promise<TurnOutcome> => {
  sdkStartSessionMock.mockImplementation(provider);
  sdkResumeSessionMock.mockImplementation(provider);
  const runStore = makeRunStore();
  const onAgentOutput = vi.fn();
  const { logger, calls } = makeLogger();
  const { agentOutputOwner, ...runArgs } = args;
  const runner = new CodexAgentSessionRunner({
    localAgentEndpoint,
    submissionToolRegistry,
    runStore,
    repoStore: makeRepoStore(),
    agentOutputOwner: agentOutputOwner ?? createProviderTestAgentOutputOwner(onAgentOutput),
    logger,
  });
  if (agentOutputOwner) vi.mocked(agentOutputOwner.onAgentOutput).mockImplementation(onAgentOutput);
  const run = runner.runPrompt({ session: makeSession(), prompt: 'Do the work.', ...runArgs });
  return readOutcome({ run, runStore, onAgentOutput, logs: calls });
};

describe('Codex turn outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkEventHandler = null;
    sdkServerRequestHandler = null;
    sdkRootThreadId = null;
    sdkRootTurnId = null;
    sdkDisconnectMock.mockResolvedValue(undefined);
    sdkGetSessionIdMock.mockReturnValue(null);
    sdkSubmitClientResponseMock.mockReturnValue(undefined);
    submissionToolRegistry.clearAll();
    localAgentEndpoint.clear();
  });

  it('completes a turn with streamed deltas and a final assistant message', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkEvent('item/agentMessage/delta', { delta: 'Partial ' });
      emitSdkEvent('item/agentMessage/delta', { delta: 'answer.' });
      agentMessage('Done.');
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Done.', taskComplete: true }]);
    expect(outcome.processingPhases).toEqual(['starting', 'thinking', 'writing']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:item/agentMessage/delta',
      'agent:agent_output:provider_event:item/agentMessage/delta',
      'agent:agent_output:provider_event:item/completed',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      provider_session_id: 'codex-thread-1',
      provider_conversation_id: null,
      errorCount: 0,
    });
    expect(outcome.statuses).toEqual(['running', 'complete']);
    // Identity is written eagerly from thread/started and again at completion.
    expect(outcome.identityWrites).toEqual([
      {
        providerSessionId: 'codex-thread-1',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      },
      {
        providerSessionId: 'codex-thread-1',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      },
    ]);
    expect(outcome.logFields('local.runner.codex.run_prompt.succeeded')).toMatchObject({
      providerSessionId: 'codex-thread-1',
      streamEventCount: 5,
      assistantMessageCount: 1,
      errorCount: 0,
      lastStreamEventType: 'turn/completed',
      firstStreamEventAtMs: expect.any(Number),
      firstAssistantEventAtMs: expect.any(Number),
    });
    expect(outcome.logFields('local.runner.codex.event.normalization')).toMatchObject({
      normalizationSuccessCount: 5,
      normalizationFailureCount: 0,
      normalizationSchemaMismatchCount: 0,
    });
    expect(outcome.logFields('local.runner.codex.run_prompt.no_assistant_output')).toBeNull();
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toBeNull();
    expect(outcome.disconnects).toBe(1);
  });

  it('delivers each superseded assistant message immediately and finalizes only the last', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      agentMessage('First answer.');
      agentMessage('Second answer.');
      agentMessage('Third answer.');
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.liveAssistant).toEqual([
      { summary: 'First answer.', taskComplete: false },
      { summary: 'Second answer.', taskComplete: false },
      { summary: 'Third answer.', taskComplete: true },
    ]);
    expect(outcome.logFields('local.runner.codex.run_prompt.succeeded')).toMatchObject({
      assistantMessageCount: 3,
    });
  });

  it('flushes streamed text that never became a final message, yet counts the turn as having no assistant output', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkEvent('item/agentMessage/delta', { delta: 'Partial ' });
      emitSdkEvent('item/agentMessage/delta', { delta: 'answer.' });
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toMatchObject({ errorCount: 0 });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Partial answer.', taskComplete: true }]);
    expect(outcome.logFields('local.runner.codex.run_prompt.succeeded')).toMatchObject({
      assistantMessageCount: 0,
    });
    expect(outcome.logFields('local.runner.codex.run_prompt.no_assistant_output')).toMatchObject({
      mode: 'prompt',
      streamEventCount: 4,
    });
  });

  it('completes a turn that produced no assistant output', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.liveAssistant).toEqual([]);
    expect(outcome.processingPhases).toEqual(['starting', 'thinking']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.statuses).toEqual(['running', 'complete']);
    expect(outcome.logFields('local.runner.codex.run_prompt.no_assistant_output')).toMatchObject({
      sessionId: 'agentic-1',
      mode: 'prompt',
      streamEventCount: 2,
      streamEventTypeSummary: { 'thread/started': 1, 'turn/completed': 1 },
    });
  });

  it('fails the turn on a non-retryable provider error, keeps the first failure message, and still finalizes buffered output', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      agentMessage('Partial work.');
      emitSdkEvent('error', { error: { message: 'First failure.' }, willRetry: false });
      emitSdkEvent('turn/completed', {
        turn: { status: 'failed', error: { message: 'Second failure.' } },
      });
    });

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: 'First failure.' });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Partial work.', taskComplete: true }]);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:item/completed',
      'agent:agent_output:provider_event:error',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      provider_session_id: 'codex-thread-1',
      provider_conversation_id: null,
      error: 'First failure.',
      code: 'RUN_FAILED',
    });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    // Identity is written eagerly from thread/started and again on failure.
    expect(outcome.identityWrites).toEqual([
      {
        providerSessionId: 'codex-thread-1',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      },
      {
        providerSessionId: 'codex-thread-1',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      },
    ]);
    const providerFailures = outcome.logs.filter(
      ([, event]) => event === 'local.runner.codex.provider_turn.failed',
    );
    expect(providerFailures).toHaveLength(1);
    expect(providerFailures[0]?.[2]).toMatchObject({ eventType: 'error', error: 'First failure.' });
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toMatchObject({
      error: expect.objectContaining({ code: 'RUN_FAILED', message: 'First failure.' }),
    });
    expect(outcome.logFields('local.runner.codex.run_prompt.succeeded')).toBeNull();
    expect(outcome.disconnects).toBe(1);
  });

  it.each([
    ['a nested error message', { message: 'Turn failed upstream.' }, 'Turn failed upstream.'],
    ['no error message', undefined, 'Codex provider turn failed.'],
  ])(
    'fails the turn when completion reports failed with %s',
    async (_label, error, expectedMessage) => {
      const outcome = await runTurn(() => {
        threadStarted();
        emitSdkEvent('turn/completed', { turn: { status: 'failed', ...(error ? { error } : {}) } });
      });

      expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: expectedMessage });
      expect(outcome.runCompleted).toMatchObject({ error: expectedMessage, code: 'RUN_FAILED' });
      expect(outcome.statuses).toEqual(['running', 'idle']);
    },
  );

  it('ignores a retryable provider error and completes the turn', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkEvent('error', { error: { message: 'Transient upstream error.' }, willRetry: true });
      agentMessage('Recovered.');
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toMatchObject({ errorCount: 0 });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Recovered.', taskComplete: true }]);
    expect(outcome.statuses).toEqual(['running', 'complete']);
    expect(outcome.logFields('local.runner.codex.provider_turn.failed')).toBeNull();
    expect(outcome.persisted).toContain('agent:agent_output:provider_event:error');
  });

  it('classifies a model-capacity rejection and keeps the raw diagnostic out of persisted and live output', async () => {
    const rawFailure = 'Selected model gpt-5-codex is at capacity. trace=private-123';
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkEvent('error', {
        error: { message: JSON.stringify({ error: { message: rawFailure } }) },
        willRetry: false,
      });
      emitSdkEvent('turn/completed', {
        turn: { status: 'failed', error: { message: rawFailure } },
      });
    });

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({ code: 'MODEL_CAPACITY', message: CAPACITY_RETRY_MESSAGE });
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      provider_session_id: 'codex-thread-1',
      provider_conversation_id: null,
      error: CAPACITY_RETRY_MESSAGE,
      code: 'MODEL_CAPACITY',
    });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:error',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.persistedJson).not.toContain(rawFailure);
    expect(outcome.persistedJson).toContain(CAPACITY_RETRY_MESSAGE);
    expect(JSON.stringify(outcome.liveEvents)).not.toContain(rawFailure);
    expect(JSON.stringify(outcome.liveEvents)).toContain(CAPACITY_RETRY_MESSAGE);
    expect(outcome.logFields('local.runner.codex.provider_turn.failed')).toMatchObject({
      error: rawFailure,
    });
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toMatchObject({
      rawProviderErrorMessage: rawFailure,
      error: expect.objectContaining({ code: 'MODEL_CAPACITY' }),
    });
  });

  it('classifies a model-capacity rejection raised by the client itself', async () => {
    const rawFailure = 'Selected model gpt-5-codex is at capacity. trace=private-456';
    const outcome = await runTurn(() => {
      threadStarted();
      throw new Error(rawFailure);
    });

    expect(outcome.failure).toEqual({ code: 'MODEL_CAPACITY', message: CAPACITY_RETRY_MESSAGE });
    expect(outcome.runCompleted).toMatchObject({
      error: CAPACITY_RETRY_MESSAGE,
      code: 'MODEL_CAPACITY',
    });
    expect(JSON.stringify(outcome.liveEvents)).not.toContain(rawFailure);
    expect(outcome.persistedJson).not.toContain(rawFailure);
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toMatchObject({
      rawProviderErrorMessage: rawFailure,
    });
  });

  it('fails the turn when the provider disconnects mid-turn and keeps the thread resumable', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      agentMessage('Partial work.');
      throw new Error('Disconnected');
    });

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: 'Disconnected' });
    // The provider never reached a terminal event, so buffered output is lost.
    expect(outcome.liveAssistant).toEqual([]);
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:item/completed',
      'system:run_completed',
    ]);
    expect(outcome.runCompleted).toEqual({
      mode: 'prompt',
      provider_session_id: 'codex-thread-1',
      provider_conversation_id: null,
      error: 'Disconnected',
      code: 'RUN_FAILED',
    });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(outcome.identityWrites).toHaveLength(2);
    expect(outcome.identityWrites[1]).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toMatchObject({
      error: expect.objectContaining({ code: 'RUN_FAILED', message: 'Disconnected' }),
    });
    expect(outcome.disconnects).toBe(1);
  });

  it('reports a canceled turn as a failed run', async () => {
    const controller = new AbortController();
    const outcome = await runTurn(
      () => {
        threadStarted();
        controller.abort();
        throw new Error('Aborted');
      },
      { signal: controller.signal },
    );

    expect(outcome.result).toBeNull();
    expect(outcome.failure).toEqual({ code: 'RUN_FAILED', message: 'Aborted' });
    expect(outcome.runCompleted).toMatchObject({ error: 'Aborted', code: 'RUN_FAILED' });
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toMatchObject({
      error: expect.objectContaining({ code: 'RUN_FAILED' }),
    });
  });

  it('resolves a Service-scope cancellation quietly without a completion record', async () => {
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    const controller = agentOutputOwner.createAbortController();
    await agentOutputOwner.serviceScope.pauseForServiceScopeRequest('scope-request-1', 'automatic');
    agentOutputOwner.serviceScope.settleServiceScopeRequest('scope-request-1');
    agentOutputOwner.serviceScope.settleServiceScopeApprovalWait('scope-request-1', 'starting');
    const outcome = await runTurn(
      () => {
        threadStarted();
        throw new Error('Aborted');
      },
      { signal: controller.signal, agentOutputOwner },
    );

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(outcome.runCompleted).toBeNull();
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
    ]);
    expect(outcome.statuses).toEqual(['running', 'idle']);
    expect(
      outcome.logFields('local.runner.codex.run_prompt.aborted_for_service_scope'),
    ).toMatchObject({ providerSessionId: 'codex-thread-1' });
    expect(outcome.logFields('local.runner.codex.run_prompt.failed')).toBeNull();
  });

  it('completes an interrupted turn as a success with its output finalized', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      agentMessage('Stopping here.');
      turnCompleted('interrupted');
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toMatchObject({ errorCount: 0 });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Stopping here.', taskComplete: true }]);
    expect(outcome.statuses).toEqual(['running', 'complete']);
    const completedEvent = outcome.liveEvents.find((event) => event.eventType === 'turn/completed');
    expect(completedEvent?.payload).toMatchObject({
      canonical_event: { status: { state: 'aborted' } },
    });
  });

  it('keeps child-thread failures and output out of the root turn result', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkEvent('turn/started', { threadId: 'codex-thread-1', turn: { id: 'root-turn-1' } });
      emitSdkEvent('item/completed', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        item: { type: 'agentMessage', text: 'Child finding.' },
      });
      emitSdkEvent('error', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        error: { message: 'Child research failed.' },
        willRetry: false,
      });
      emitSdkEvent('turn/completed', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        turn: { id: 'child-turn-1', status: 'failed' },
      });
      emitSdkEvent('item/completed', {
        threadId: 'codex-thread-1',
        turnId: 'root-turn-1',
        item: { type: 'agentMessage', text: 'Root synthesis.' },
      });
      emitSdkEvent('turn/completed', {
        threadId: 'codex-thread-1',
        turnId: 'root-turn-1',
        turn: { id: 'root-turn-1', status: 'completed' },
      });
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toMatchObject({ errorCount: 0 });
    expect(outcome.liveAssistant).toEqual([{ summary: 'Root synthesis.', taskComplete: true }]);
    expect(outcome.statuses).toEqual(['running', 'complete']);
    expect(outcome.logFields('local.runner.codex.provider_turn.failed')).toBeNull();
    expect(outcome.logFields('local.runner.codex.run_prompt.succeeded')).toMatchObject({
      streamEventCount: 7,
      assistantMessageCount: 1,
    });
    // Child telemetry is still persisted and delivered live, just not finalized.
    expect(
      outcome.persisted.filter((entry) => entry.endsWith('provider_event:item/completed')),
    ).toHaveLength(2);
    expect(JSON.stringify(outcome.liveEvents)).toContain('Child finding.');
  });
});

describe('Codex permission and elicitation requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkEventHandler = null;
    sdkServerRequestHandler = null;
    sdkRootThreadId = null;
    sdkRootTurnId = null;
    sdkDisconnectMock.mockResolvedValue(undefined);
    sdkGetSessionIdMock.mockReturnValue(null);
    sdkSubmitClientResponseMock.mockReturnValue(undefined);
    submissionToolRegistry.clearAll();
    localAgentEndpoint.clear();
  });

  const commandApproval = (id: number): SdkServerRequest => ({
    id,
    method: 'item/commandExecution/requestApproval',
    params: { command: ['pnpm', 'test'], cwd: '/tmp/repo' },
  });

  const elicitation = (id: number, serverName: string, toolName: string): SdkServerRequest => ({
    id,
    method: 'mcpServer/elicitation/request',
    params: {
      threadId: 'codex-thread-1',
      turnId: 'codex-root-turn-1',
      serverName,
      mode: 'form',
      message: `Allow the ${serverName} MCP server to run tool "${toolName}"?`,
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: toolName, tool_params: {} },
      requestedSchema: { type: 'object', properties: {} },
    },
  });

  it('approves a command under skipPermissions and records the automatic decision', async () => {
    const outcome = await runTurn(
      () => {
        threadStarted();
        emitSdkServerRequest(commandApproval(42));
        agentMessage('Ran the tests.');
        turnCompleted();
      },
      { skipPermissions: true },
    );

    expect(outcome.failure).toBeNull();
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledTimes(1);
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(42, { decision: 'acceptForSession' });
    expect(outcome.liveEvents.map((event) => event.eventType)).not.toContain(
      'permission_request_detected',
    );
    const autoApproved = outcome.liveEvents.find(
      (event) => event.eventType === 'permission_auto_approved',
    );
    expect(autoApproved).toMatchObject({
      source: 'local',
      payload: {
        messageType: 'permission_auto_approved',
        agent_type: 'codex',
        permission_type: 'command_execution',
        raw_request_id: 42,
        decision: 'session_authorization',
      },
    });
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:item/commandExecution/requestApproval',
      'system:agent_output:permission_decision_ui:42:allow_always',
      'agent:agent_output:provider_event:item/completed',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.logFields('local.runner.codex.permission_request.auto_approved')).toMatchObject({
      rawRequestId: 42,
      permissionType: 'command_execution',
      decision: 'session_authorization',
    });
  });

  it.each([
    ['approve', { decision: 'accept' }],
    ['always_approve', { decision: 'acceptForSession' }],
    ['deny', { decision: 'decline' }],
  ] as const)(
    'queues a command approval for the user and relays a %s decision',
    async (decision, expectedResponse) => {
      const turn = createDeferred();
      const started = createDeferred();
      sdkStartSessionMock.mockImplementation(() => {
        threadStarted();
        emitSdkServerRequest(commandApproval(7));
        started.resolve();
        return turn.promise;
      });
      const runStore = makeRunStore();
      const onAgentOutput = vi.fn();
      const { logger, calls } = makeLogger();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore,
        repoStore: makeRepoStore(),
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
        logger,
      });
      const session = makeSession();
      const run = runner.runPrompt({ session, prompt: 'Run the tests.' });
      await started.promise;
      // The user decides after the request has been written durably.
      await settlePersistQueue();

      // Nothing is answered until the user decides; the request is live and durable.
      expect(sdkSubmitClientResponseMock).not.toHaveBeenCalled();
      const liveRequest = (onAgentOutput.mock.calls as [{ event: LiveEvent }][])
        .map(([call]) => call.event)
        .find((event) => event.eventType === 'permission_request_detected');
      expect(liveRequest).toMatchObject({
        source: 'provider',
        payload: {
          canonical_event_type: 'permission_request',
          canonical_event: {
            permission_request: { id: '7', permission_type: 'command_execution' },
          },
        },
      });
      expect(
        calls.find(([, event]) => event === 'local.runner.codex.permission_request.queued')?.[2],
      ).toMatchObject({
        requestId: '7',
        rawRequestId: 7,
        kind: 'approval',
        permissionType: 'command_execution',
        resolvedEventType: 'permission_request_detected',
      });

      const dispatch = translatePermissionDecisionToDispatch({
        runId: session.agentic_session_id,
        sessionId: 'codex-thread-1',
        requestId: '7',
        agentType: 'codex',
        decision,
        reason: null,
        idempotencyToken: '7',
        deciderUserId: 'user-1',
      });
      await expect(runner.submitPermissionDecision({ session, dispatch })).resolves.toEqual({
        delivered: true,
        callbackType: 'codex_exec_approval_response',
      });
      expect(sdkSubmitClientResponseMock).toHaveBeenCalledTimes(1);
      expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(7, expectedResponse);

      agentMessage('Finished.');
      turnCompleted();
      turn.resolve();
      const outcome = await readOutcome({ run, runStore, onAgentOutput, logs: calls });

      expect(outcome.failure).toBeNull();
      expect(outcome.result).toMatchObject({ errorCount: 0 });
      expect(outcome.persisted).toEqual([
        'app:run_started',
        'agent:agent_output:provider_event:thread/started',
        'agent:agent_output:provider_event:item/commandExecution/requestApproval',
        `app:agent_output:permission_decision_ui:7:${decision}`,
        'agent:agent_output:provider_event:item/completed',
        'agent:agent_output:provider_event:turn/completed',
        'system:run_completed',
      ]);
      expect(outcome.liveEvents).toContainEqual(
        expect.objectContaining({
          eventType: 'permission_decision_submitted',
          payload: expect.objectContaining({ decision, request_id: '7' }),
        }),
      );
      // A decided request is no longer pending once the turn ends.
      await expect(runner.submitPermissionDecision({ session, dispatch })).resolves.toEqual({
        delivered: false,
        outcome: 'stale',
        reason: 'request_not_found',
      });
    },
  );

  it('auto-approves a pre-approved submission-tool elicitation and records the decision', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool],
    });
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkServerRequest(elicitation(13, 'heyhey-submission-tools', 'create_report'));
      agentMessage('Report submitted.');
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledTimes(1);
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(13, {
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });
    expect(outcome.liveEvents.map((event) => event.eventType)).not.toContain(
      'permission_request_detected',
    );
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:mcpServer/elicitation/request',
      'system:agent_output:permission_decision_ui:13:allow',
      'agent:agent_output:provider_event:item/completed',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(outcome.logFields('local.runner.codex.mcp_elicitation.auto_approved')).toMatchObject({
      rawRequestId: 13,
      serverName: 'heyhey-submission-tools',
      toolName: 'create_report',
      qualifiedToolName: 'mcp__heyhey-submission-tools__create_report',
    });
  });

  it('declines a Hey Hey elicitation outside the active tool surface and records the denial', async () => {
    const outcome = await runTurn(() => {
      threadStarted();
      emitSdkServerRequest(elicitation(12, 'heyhey-platform', 'get_edges'));
      turnCompleted();
    });

    expect(outcome.failure).toBeNull();
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledTimes(1);
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(12, {
      action: 'decline',
      content: {
        classification: 'tool_surface_mismatch',
        message: expect.stringContaining('not a user rejection'),
      },
      _meta: { classification: 'tool_surface_mismatch', reason: 'inactive_tool_surface' },
    });
    expect(outcome.liveEvents.map((event) => event.eventType)).not.toContain(
      'permission_request_detected',
    );
    expect(outcome.persisted).toEqual([
      'app:run_started',
      'agent:agent_output:provider_event:thread/started',
      'agent:agent_output:provider_event:mcpServer/elicitation/request',
      'system:agent_output:permission_decision_ui:12:deny',
      'agent:agent_output:provider_event:turn/completed',
      'system:run_completed',
    ]);
    expect(
      outcome.logFields('local.runner.codex.mcp_elicitation.tool_surface_mismatch'),
    ).toMatchObject({
      rawRequestId: 12,
      serverName: 'heyhey-platform',
      toolName: 'get_edges',
      availability: 'server_not_mounted',
    });
  });

  it.each([
    ['approve', { action: 'accept', content: null, _meta: null }],
    ['always_approve', { action: 'accept', content: null, _meta: { persist: 'always' } }],
    ['deny', { action: 'decline', content: null, _meta: null }],
  ] as const)(
    'queues an external elicitation for the user and relays a %s decision',
    async (decision, expectedResponse) => {
      const turn = createDeferred();
      const started = createDeferred();
      sdkStartSessionMock.mockImplementation(() => {
        threadStarted();
        emitSdkServerRequest(elicitation(11, 'external-server', 'lookup'));
        started.resolve();
        return turn.promise;
      });
      const runStore = makeRunStore();
      const onAgentOutput = vi.fn();
      const { logger, calls } = makeLogger();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore,
        repoStore: makeRepoStore(),
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
        logger,
      });
      const session = makeSession();
      const run = runner.runPrompt({ session, prompt: 'Look it up.' });
      await started.promise;
      // The user decides after the request has been written durably.
      await settlePersistQueue();

      expect(sdkSubmitClientResponseMock).not.toHaveBeenCalled();
      const liveRequest = (onAgentOutput.mock.calls as [{ event: LiveEvent }][])
        .map(([call]) => call.event)
        .find((event) => event.eventType === 'permission_request_detected');
      expect(liveRequest).toMatchObject({
        payload: {
          canonical_event: {
            permission_request: { id: '11', permission_type: 'mcp__external-server__lookup' },
          },
        },
      });
      expect(
        calls.find(([, event]) => event === 'local.runner.codex.permission_request.queued')?.[2],
      ).toMatchObject({
        requestId: '11',
        kind: 'mcp_elicitation',
        permissionType: null,
        mcpServerName: 'external-server',
      });

      const dispatch = translatePermissionDecisionToDispatch({
        runId: session.agentic_session_id,
        sessionId: 'codex-thread-1',
        requestId: '11',
        agentType: 'codex',
        decision,
        reason: null,
        idempotencyToken: '11',
        deciderUserId: 'user-1',
      });
      await expect(runner.submitPermissionDecision({ session, dispatch })).resolves.toEqual({
        delivered: true,
        callbackType: 'codex_exec_approval_response',
      });
      expect(sdkSubmitClientResponseMock).toHaveBeenCalledTimes(1);
      expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(11, expectedResponse);

      turnCompleted();
      turn.resolve();
      const outcome = await readOutcome({ run, runStore, onAgentOutput, logs: calls });

      expect(outcome.failure).toBeNull();
      expect(outcome.persisted).toEqual([
        'app:run_started',
        'agent:agent_output:provider_event:thread/started',
        'agent:agent_output:provider_event:mcpServer/elicitation/request',
        `app:agent_output:permission_decision_ui:11:${decision}`,
        'agent:agent_output:provider_event:turn/completed',
        'system:run_completed',
      ]);
    },
  );
});
