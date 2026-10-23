import { describe, expect, it, vi } from 'vitest';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';
import type { TaskMonitorPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import { TaskMonitorLifecycleCause } from '../../shared/agent-bridge-contract/generated/api';
import type { OnCompleteDeps } from '../prompt-type-handler';
import {
  createOnCompleteTestDeps,
  createPromptTypeHandlerTestDeps,
} from '../prompt-type-handler.test-support';
import { TaskMonitorDecisionStore } from './task-monitor-decision-store';
import { TaskMonitorManagedTurnRuntime } from '../../server/task-monitor-managed-turn-runtime';
import { taskMonitorHandler } from './task-monitor.handler';

vi.mock('./task-monitor-evidence', () => ({
  loadTaskMonitorCanonicalEvidence: vi.fn(async () => ({
    monitor: {
      id: 'monitor-1',
      status: 'ACTIVE',
      executionStatus: 'RUNNING',
      cursor: 0,
      reviewMode: 'AGENT_DECIDES',
      launch: {
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5',
        reasoningEffort: 'high',
      },
    },
    planGuidance: null,
    selectedTask: {
      executionIndex: 0,
      id: 'task-1',
      title: 'Selected Task',
      type: 'STANDARD',
      status: 'ACTIVE',
      sections: [],
      featureHierarchy: [],
      contracts: [],
    },
    remainingWork: [],
    selectedSession: null,
    releasedTurn: null,
    reports: [],
  })),
}));

const createDecisionStore = () =>
  new TaskMonitorDecisionStore(NOOP_LOGGER, new TaskMonitorManagedTurnRuntime(NOOP_LOGGER));

const makeEvent = (summary: string): AssistantCompleteEvent => ({
  kind: 'assistant_complete',
  runId: 'run-1',
  source: 'provider',
  eventType: 'assistant_complete',
  timestamp: '2026-07-23T00:00:00.000Z',
  sessionId: 'provider-session-1',
  agentId: 'task-monitor-coordinator',
  payload: {},
  summary,
});

const makeLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

const makeDeps = (): OnCompleteDeps =>
  createOnCompleteTestDeps({
    fetchImpl: vi.fn() as unknown as typeof fetch,
    apiBaseUrl: 'http://localhost:3000',
    logger: makeLogger(),
  });

const context = {
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  stamp: null,
};

const makeRun = (): AgenticSession => ({
  agentic_session_id: 'run-1',
  entity: null,
  services: [],
  provider: 'codex',
  provider_session_id: 'provider-session-1',
  provider_conversation_id: null,
  status: 'idle',
  conversationId: 'conversation-1',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  events: [],
  contextMetadata: {
    capturedAt: '2026-07-23T00:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'project-1',
    agentSessionId: 'agent-session-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
});

const settledTurn = {
  turnId: 'settled-turn-1',
  promptType: 'coding_freeform',
  terminalOutcome: 'COMPLETED' as const,
  completedAssistantMessage: null,
  reports: [],
};

describe('taskMonitorHandler', () => {
  const conversationPayload = {
    promptType: 'task_monitor' as const,
    mode: 'CONVERSATION' as const,
    taskMonitorId: 'monitor-1',
    conversationId: 'conversation-1',
    sourceMessageId: 'user-message-1',
    userMessage: 'What is the current progress?',
  };

  it('returns ordinary prose for canonical conversation input without publishing a decision', async () => {
    const event = makeEvent('The selected work is still running and no judgment is needed.');
    expect(taskMonitorHandler.validateCompletion!(event, conversationPayload)).toEqual({
      ok: true,
    });
    expect(taskMonitorHandler.transformCompletionOutput!(event, conversationPayload)).toMatchObject(
      {
        data: { response: event.summary },
      },
    );
    const taskMonitorDecisionStore = createDecisionStore();
    const publish = vi.spyOn(taskMonitorDecisionStore, 'publish');
    await taskMonitorHandler.onComplete!(
      event,
      { ...context, payload: conversationPayload },
      { ...makeDeps(), taskMonitorDecisionStore },
    );
    expect(publish).not.toHaveBeenCalled();
  });
  it('owns its service-scope guidance instead of receiving the generic service-less note', () => {
    expect(taskMonitorHandler.omitServiceContextNote).toBe(true);
  });
  it('keeps provider reasoning continuity while enforcing a read-only session', () => {
    expect(taskMonitorHandler).toMatchObject({
      id: 'task-monitor-coordinator',
      runnerKind: 'provider_session',
      readOnlyFilesystem: true,
      mcpToolUseCase: 'task_monitor',
      builtinTools: [],
    });
    expect(taskMonitorHandler.providerSessionLifetime).toBeUndefined();
    expect(taskMonitorHandler.prepare).toBeTypeOf('function');
  });

  it('accepts resolved judgment with prior settled-Turn evidence and binds Message correlation', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const payload: TaskMonitorPromptPayload = {
      monitorId: 'monitor-1',
      cause: 'JUDGMENT_RESOLVED',
      correlationId: 'judgment-request-1',
      judgment: {
        requestMessageId: 'judgment-request-1',
        label: 'Your judgment',
        conclusion: 'Proceed with the safer behavior.',
      },
      settledTurn,
    };

    await expect(taskMonitorHandler.prepare!(makeRun(), payload, deps)).resolves.toMatchObject({
      payload,
    });
    expect(deps.taskMonitorDecisionStore.bind).toHaveBeenCalledWith('run-1', 'judgment-request-1');
  });

  it('keeps settled-Turn correlation validation for ordinary continuation', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const payload: TaskMonitorPromptPayload = {
      monitorId: 'monitor-1',
      cause: 'CONTINUE',
      correlationId: 'different-correlation-1',
      settledTurn,
    };

    await expect(taskMonitorHandler.prepare!(makeRun(), payload, deps)).rejects.toThrow(
      'Task Monitor continuation requires matching settled Turn evidence.',
    );
    expect(deps.taskMonitorDecisionStore.bind).not.toHaveBeenCalled();
  });

  it('cannot build a decision prompt before canonical evidence is loaded', () => {
    expect(() =>
      taskMonitorHandler.buildPrompt({
        monitorId: '11111111-1111-4111-8111-111111111111',
        cause: TaskMonitorLifecycleCause.Resume,
        correlationId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toThrow('requires freshly loaded canonical evidence');
  });

  it('validates the generated discriminated decision before a completion message exists', () => {
    expect(
      taskMonitorHandler.validateCompletion!(
        makeEvent(
          JSON.stringify({
            action: 'ACCEPT_TASK',
            rationale: 'The canonical evidence supports accepting the selected Task.',
          }),
        ),
      ),
    ).toEqual({ ok: true });

    expect(taskMonitorHandler.validateCompletion!(makeEvent('WAIT'))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_JSON' },
    });
  });

  it('publishes invalid output through the pre-completion handler without posting a Message', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };
    const validation = taskMonitorHandler.validateCompletion!(makeEvent('WAIT'));

    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error('Expected Task Monitor completion validation to fail.');

    await taskMonitorHandler.onInvalidCompletion!(
      makeEvent('WAIT'),
      {
        runId: context.runId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        conversationId: context.conversationId,
        stamp: context.stamp,
      },
      deps,
      validation.error,
    );

    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toEqual({
      status: 'INVALID',
      reason: expect.stringContaining('not one complete JSON'),
      failure: {
        code: 'INVALID_JSON',
        message: expect.stringContaining('not one complete JSON'),
        issues: [],
      },
    });
  });

  it('keeps the coordinator completion neutral until the requested operation succeeds', () => {
    expect(
      taskMonitorHandler.transformCompletionOutput!(
        makeEvent(
          JSON.stringify({
            action: 'REQUEST_CHANGES',
            rationale: 'The canonical implementation evidence leaves one check unresolved.',
            guidance: 'Run the focused check and report the canonical result.',
          }),
        ),
      ),
    ).toEqual({
      data: {
        type: 'AGENT',
        response: 'Applying the Task Monitor decision through canonical owners.',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      },
    });
  });

  it('releases requested changes to lifecycle effects after completion persistence', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };

    await taskMonitorHandler.onComplete!(
      makeEvent(
        JSON.stringify({
          action: 'REQUEST_CHANGES',
          rationale: 'The canonical implementation evidence leaves one check unresolved.',
          guidance: 'Run the focused check and report the canonical result.',
        }),
      ),
      context,
      deps,
    );

    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith('task_monitor.coordinator.decision.accepted', {
      runId: 'run-1',
      action: 'REQUEST_CHANGES',
    });
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toEqual({
      status: 'DECISION',
      decision: {
        action: 'REQUEST_CHANGES',
        rationale: 'The canonical implementation evidence leaves one check unresolved.',
        guidance: 'Run the focused check and report the canonical result.',
      },
    });
  });

  it('does not publish acceptance before lifecycle application', () => {
    expect(
      taskMonitorHandler.transformCompletionOutput!(
        makeEvent(
          JSON.stringify({
            action: 'ACCEPT_TASK',
            rationale: 'The selected Task is fulfilled by canonical evidence.',
          }),
        ),
      ),
    ).toEqual({
      data: {
        type: 'AGENT',
        response: 'Applying the Task Monitor decision through canonical owners.',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      },
    });
  });

  it('releases acceptance without posting a second message', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };

    await taskMonitorHandler.onComplete!(
      makeEvent(
        JSON.stringify({
          action: 'ACCEPT_TASK',
          rationale: 'The selected Task is fulfilled by canonical evidence.',
        }),
      ),
      context,
      deps,
    );

    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toMatchObject({
      status: 'DECISION',
      decision: { action: 'ACCEPT_TASK' },
    });
  });

  it('releases a repeated persisted completion exactly once', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };
    const event = makeEvent(
      JSON.stringify({ action: 'ACCEPT_TASK', rationale: 'Canonical evidence is complete.' }),
    );

    await taskMonitorHandler.onComplete!(event, context, deps);
    await taskMonitorHandler.onComplete!(event, context, deps);

    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toMatchObject({
      status: 'DECISION',
    });
  });

  it('releases reused coordinator turns independently', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };

    taskMonitorDecisionStore.bind('run-1', 'report-1');
    await taskMonitorHandler.onComplete!(
      makeEvent(JSON.stringify({ action: 'ACCEPT_TASK', rationale: 'First result.' })),
      context,
      deps,
    );
    taskMonitorDecisionStore.bind('run-1', 'report-2');
    await taskMonitorHandler.onComplete!(
      makeEvent(
        JSON.stringify({
          action: 'REQUEST_CHANGES',
          rationale: 'Second result.',
          guidance: 'Address the second result.',
        }),
      ),
      context,
      deps,
    );

    expect(deps.poster.createOutOfBand).not.toHaveBeenCalled();
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toMatchObject({
      status: 'DECISION',
      decision: { action: 'REQUEST_CHANGES' },
    });
  });

  it('turns malformed output into a bounded no-effect failure', async () => {
    const taskMonitorDecisionStore = createDecisionStore();
    const deps = { ...makeDeps(), taskMonitorDecisionStore };

    await taskMonitorHandler.onComplete!(makeEvent('WAIT'), context, deps);

    expect(deps.poster.update).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'task_monitor.coordinator.decision.rejected',
      expect.objectContaining({
        runId: 'run-1',
        code: 'INVALID_JSON',
      }),
    );
    await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toEqual({
      status: 'INVALID',
      reason: expect.stringContaining('not one complete JSON'),
      failure: {
        code: 'INVALID_JSON',
        message: expect.stringContaining('not one complete JSON'),
        issues: [],
      },
    });
  });
});

it('persists rejected output before resolving the attempt and ignores stale completion receipts', async () => {
  const taskMonitorDecisionStore = createDecisionStore();
  const deps = { ...makeDeps(), taskMonitorDecisionStore };
  const persist = vi
    .spyOn(deps.runStore, 'updateRunSessionContext')
    .mockImplementation(async () => makeRun());
  const publish = vi.spyOn(taskMonitorDecisionStore, 'publish');
  taskMonitorDecisionStore.bind('run-1', 'released-turn', 'attempt-1');
  const ctx = {
    ...context,
    payload: {
      monitorId: 'monitor-1',
      cause: 'CONTINUE',
      correlationId: 'released-turn',
      coordinatorAttemptId: 'attempt-1',
    },
  };
  await taskMonitorHandler.onInvalidCompletion!(makeEvent('bad JSON'), ctx, deps, {
    code: 'INVALID_JSON',
    message: 'Invalid JSON.',
    issues: ['Expected one object.'],
  });
  expect(persist).toHaveBeenCalledWith('run-1', {
    taskMonitorCoordinatorReceipt: { attemptId: 'attempt-1', output: 'bad JSON' },
  });
  expect(persist.mock.invocationCallOrder[0]!).toBeLessThan(publish.mock.invocationCallOrder[0]!);
  await expect(taskMonitorDecisionStore.wait('run-1')).resolves.toMatchObject({
    status: 'INVALID',
    failure: { code: 'INVALID_JSON', issues: ['Expected one object.'] },
  });
  taskMonitorDecisionStore.bind('run-1', 'released-turn', 'attempt-2');
  await taskMonitorHandler.onInvalidCompletion!(makeEvent('stale JSON'), ctx, deps, {
    code: 'INVALID_JSON',
    message: 'Stale.',
  });
  expect(persist).toHaveBeenCalledTimes(1);
});
