import { describe, expect, it, vi } from 'vitest';
import { ReportType } from '../../shared/api';
import type { AssistantCompleteEvent } from '../../run/types';
import { createOnCompleteTestDeps } from '../prompt-type-handler.test-support';
import { makeCreateReportProxy } from '../submission-tools/create-report-proxy.test-support';
import { SessionMonitorHandler } from './session-monitor.handler';

const event = (summary: object | string): AssistantCompleteEvent => ({
  kind: 'assistant_complete',
  runId: 'monitor-run',
  source: 'provider',
  eventType: 'assistant_complete',
  timestamp: '2026-07-31T00:00:00.000Z',
  sessionId: 'provider-session',
  agentId: 'session-monitor',
  payload: {},
  summary: typeof summary === 'string' ? summary : JSON.stringify(summary),
});

const context = {
  runId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  projectId: '00000000-0000-4000-8000-000000000003',
  conversationId: '00000000-0000-4000-8000-000000000004',
  messageId: '00000000-0000-4000-8000-000000000005',
  stamp: null,
};

const harness = (hasPendingWorkflow = true) => {
  const createReportProxy = makeCreateReportProxy();
  vi.mocked(createReportProxy.create).mockResolvedValue({
    content: [],
    reportId: 'deferral-report',
  });
  const deps = createOnCompleteTestDeps();
  deps.fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { evidenceMessageId: '00000000-0000-4000-8000-000000000009' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  ) as typeof fetch;
  const result = deps.sessionMonitorEvaluationStore.begin(context.runId, {
    targetSessionId: '00000000-0000-4000-8000-000000000006',
    targetConversationId: '00000000-0000-4000-8000-000000000007',
    turnId: 'settled-turn',
    completedAssistantContent: 'Choose one.',
    reports: [
      { reportId: '00000000-0000-4000-8000-000000000008', reportType: ReportType.DecisionNeeded },
      { reportId: '00000000-0000-4000-8000-00000000000a', reportType: ReportType.Plan },
    ],
    workflow: hasPendingWorkflow
      ? {
          state: 'agent-pending',
          promptType: 'plan_shaping_finalize',
          nodeId: 'external-agent-node',
          triggerMessageId: '00000000-0000-4000-8000-00000000000b',
        }
      : {
          state: 'live-non-agent',
          promptType: null,
          nodeId: null,
          triggerMessageId: null,
        },
    availableActions: [],
  });
  return { handler: new SessionMonitorHandler(createReportProxy), createReportProxy, deps, result };
};

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('SessionMonitorHandler', () => {
  it('persists deferral Report and Message before resolving handled', async () => {
    const { handler, createReportProxy, deps, result } = harness(false);
    const reportPersistence = deferred<{
      content: never[];
      reportId: string;
    }>();
    vi.mocked(createReportProxy.create).mockReturnValue(reportPersistence.promise);
    const completion = handler.onComplete!(
      event({
        disposition: 'DEFER',
        content: 'I need you to choose the canonical option.',
        reasoning: 'The settled Turn presents two equally supported choices.',
      }),
      context,
      deps,
    );

    let dispositionSettled = false;
    void result.finally(() => {
      dispositionSettled = true;
    });
    await vi.waitFor(() => expect(createReportProxy.create).toHaveBeenCalledOnce());
    expect(dispositionSettled).toBe(false);
    expect(deps.fetchImpl).not.toHaveBeenCalled();

    reportPersistence.resolve({
      content: [],
      reportId: 'deferral-report',
    });
    await completion;

    await expect(result).resolves.toEqual({ status: 'HANDLED', outcome: 'DEFERRED' });
    expect(createReportProxy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          reportType: ReportType.SessionMonitorDeferral,
          payload: expect.objectContaining({
            assessedTurnId: 'settled-turn',
            assessedReportIds: [
              '00000000-0000-4000-8000-000000000008',
              '00000000-0000-4000-8000-00000000000a',
            ],
          }),
        }),
      }),
    );
    expect(deps.fetchImpl).toHaveBeenCalledOnce();
    const [, request] = vi.mocked(deps.fetchImpl).mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).not.toEqual(
      expect.objectContaining({
        workflowNodeId: expect.anything(),
        pendingTriggerMessageId: expect.anything(),
      }),
    );
  });

  it('posts continuation before resolving handled', async () => {
    const { handler, deps, result } = harness();
    const messagePersistence = deferred<Response>();
    vi.mocked(deps.fetchImpl).mockReturnValue(messagePersistence.promise);
    const completion = handler.onComplete!(
      event({
        disposition: 'CONTINUE',
        content: 'I can answer this and keep the plan moving.',
        continuationCompletion: { response: 'Use the first option.' },
      }),
      context,
      deps,
    );

    let dispositionSettled = false;
    void result.finally(() => {
      dispositionSettled = true;
    });
    await vi.waitFor(() => expect(deps.fetchImpl).toHaveBeenCalledOnce());
    expect(dispositionSettled).toBe(false);

    messagePersistence.resolve(
      new Response(
        JSON.stringify({
          data: { evidenceMessageId: '00000000-0000-4000-8000-000000000009' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await completion;

    await expect(result).resolves.toEqual({ status: 'HANDLED', outcome: 'CONTINUED' });
    expect(deps.fetchImpl).toHaveBeenCalledOnce();
  });

  it('resolves invalid output as failed', async () => {
    const { handler, deps, result } = harness();
    await handler.onComplete!(event('not json'), context, deps);
    await expect(result).resolves.toEqual({
      status: 'FAILED',
      reason: 'SESSION_MONITOR_DECISION_INVALID',
    });
  });

  it('resolves durable effect failure as failed', async () => {
    const { handler, deps, result } = harness();
    const messagePersistence = deferred<Response>();
    vi.mocked(deps.fetchImpl).mockReturnValue(messagePersistence.promise);
    const completion = handler.onComplete!(
      event({
        disposition: 'CONTINUE',
        content: 'Continuing.',
        continuationCompletion: { response: 'Proceed.' },
      }),
      context,
      deps,
    );
    await vi.waitFor(() => expect(deps.fetchImpl).toHaveBeenCalledOnce());
    messagePersistence.reject(new Error('post failed'));
    await completion;
    await expect(result).resolves.toEqual({
      status: 'FAILED',
      reason: 'SESSION_MONITOR_EFFECT_FAILED',
    });
  });
});
