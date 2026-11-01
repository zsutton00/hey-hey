import { describe, expect, it, vi } from 'vitest';
import { ReportType } from '../shared/api/generated/api';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { NOOP_LOGGER } from '../server/logger';
import {
  TaskMonitorManagedTurnRuntime,
  type SettledTurnMonitorEvent,
} from '../server/task-monitor-managed-turn-runtime';
import type { PassThroughSubmissionToolDeclaration } from '../agents/submission-tools/types';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import { Turn } from '../turn/turn';
import { createTestRun } from './run.test-support';

const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const TURN_ID = '40000000-0000-4000-8000-000000000004';

const managedRuntime = (): TaskMonitorManagedTurnRuntime =>
  new TaskMonitorManagedTurnRuntime(NOOP_LOGGER);

describe('settled Turn monitor publication', () => {
  it('awaits durable settlement admission before a managed Turn finishes and never duplicates it', async () => {
    const runtime = managedRuntime();
    const received: SettledTurnMonitorEvent[] = [];
    runtime.subscribe((event) => {
      received.push(event);
    });
    let releaseDurableAdmission: () => void = () => undefined;
    const durableAdmissionBarrier = new Promise<void>((resolve) => {
      releaseDurableAdmission = resolve;
    });
    const durableAdmission = vi.fn(async () => durableAdmissionBarrier);
    runtime.subscribe(durableAdmission);
    const createReportTool: PassThroughSubmissionToolDeclaration = {
      kind: 'pass_through',
      name: 'create_report',
      description: 'Persist automatic implementation evidence.',
      inputSchema: {},
      execute: vi.fn(async ({ run }) => {
        run.appendReportChainEntry({
          createdAt: '2026-07-31T00:00:00.000Z',
          phase: LocalPromptType.CodingFreeform,
          reportId: 'automatic-implement-report',
          reportType: ReportType.Implement,
          summary: 'Automatic implementation evidence.',
          audience: 'EXTERNAL',
        });
        return { content: [] };
      }),
    };
    const run = createTestRun(
      { runId: SESSION_ID, skipProjectAssistant: true },
      { taskMonitorManagedTurnRuntime: runtime, baseSubmissionTools: [createReportTool] },
    );
    Object.assign(run.session, {
      services: [{ id: 'service-1', path: '/workspace' }],
      launchServiceId: 'service-1',
    });
    const handler = {
      id: LocalPromptType.CodingFreeform,
      promptType: LocalPromptType.CodingFreeform,
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'gated_and_clarifiable',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: () => '',
    } as PromptTypeHandler<unknown>;
    const turn = new Turn({
    effectiveRole: 'implementation',
      turnId: TURN_ID,
      runId: SESSION_ID,
      resolvedPrompt: '',
      handler,
      externalAgentNodeId: null,
      triggerMessageId: null,
      runner: {
        run: async () => {
          turn.recordCompletedAssistantMessage('completed-assistant-message');
          run.recordTouchedFile('src/changed.ts');
        },
      },
      platformMcpProxy: null,
      abortController: new AbortController(),
      effectiveModel: null,
      effectiveReasoningEffort: null,
      logger: NOOP_LOGGER,
      owner: run,
    });
    (
      run as unknown as { _reportChainStartByTurn: Map<string, number> }
    )._reportChainStartByTurn.set(TURN_ID, 0);
    run.activeTurn = turn;

    await turn.begin();
    let originatingOperationFinished = false;
    const originatingOperation = turn.run().then(() => {
      originatingOperationFinished = true;
    });
    await vi.waitFor(() => expect(durableAdmission).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(originatingOperationFinished).toBe(false);
    releaseDurableAdmission();
    await originatingOperation;

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      agentSessionId: run.session.agentic_session_id,
      turnId: TURN_ID,
      promptType: LocalPromptType.CodingFreeform,
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: 'completed-assistant-message',
      reports: [{ reportId: 'automatic-implement-report', reportType: ReportType.Implement }],
    });
    const { kind: _kind, ...replayedSettlement } = received[0]!;
    await runtime.publishSettledTurn(replayedSettlement);
    expect(durableAdmission).toHaveBeenCalledOnce();
  });

  it('deduplicates replayed publication by Turn identity', async () => {
    const runtime = managedRuntime();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const input = {
      agentSessionId: SESSION_ID,
      turnId: TURN_ID,
      promptType: LocalPromptType.Quick,
      terminalOutcome: 'COMPLETED' as const,
      completedAssistantMessageId: 'completed-assistant-message',
      reports: [],
      settledAt: '2026-07-31T00:00:00.000Z',
    };

    const first = await runtime.publishSettledTurn(input);
    const replay = await runtime.publishSettledTurn({
      ...input,
      settledAt: '2026-07-31T00:00:01.000Z',
    });

    expect(replay).toBe(first);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('retries a publication whose durable listener failed before commit', async () => {
    const runtime = managedRuntime();
    const listener = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('durable admission failed'))
      .mockResolvedValue(undefined);
    runtime.subscribe(listener);
    const input = {
      agentSessionId: SESSION_ID,
      turnId: TURN_ID,
      promptType: LocalPromptType.Quick,
      terminalOutcome: 'COMPLETED' as const,
      completedAssistantMessageId: 'completed-assistant-message',
      reports: [],
      settledAt: '2026-07-31T00:00:00.000Z',
    };

    await expect(runtime.publishSettledTurn(input)).rejects.toThrow('durable admission failed');
    await expect(runtime.publishSettledTurn(input)).resolves.toMatchObject({ turnId: TURN_ID });
    await runtime.publishSettledTurn(input);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each(['FAILED', 'ABORTED'] as const)(
    'represents %s settlement without an assistant Message or Report',
    async (terminalOutcome) => {
      const event = await managedRuntime().publishSettledTurn({
        agentSessionId: SESSION_ID,
        turnId: TURN_ID,
        promptType: LocalPromptType.Quick,
        terminalOutcome,
        completedAssistantMessageId: null,
        reports: [],
        settledAt: '2026-07-31T00:00:00.000Z',
      });

      expect(event).toMatchObject({
        terminalOutcome,
        completedAssistantMessageId: null,
        reports: [],
      });
    },
  );
});
