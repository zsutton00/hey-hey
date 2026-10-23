import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { TaskMonitorDecisionStore } from '../../task-monitor-decision-store';
import { NOOP_LOGGER } from '../../../../server/logger';
import {
  createTestPlatformAuthContext,
  createTestPlatformWebSocketManager,
} from '../../../../server/monitors/test-owners.test-support';
import { createTestOAuthClient } from '../../../../server/__tests__/helpers/test-oauth-client';
import { PlatformAuthContext } from '../../../../server/platform-auth-context';
import { MonitorProjectContext } from '../../../../server/monitors/project-context';
import { AgentSessionReader } from '../../../../server/monitors/agent-session-reader';
import { RunStore } from '../../../../run-store/run-store';
import { TaskMonitorManagedTurnRuntime } from '../../../../server/task-monitor-managed-turn-runtime';
import { TaskMonitorCoordinatorRunner } from '../../../../server/monitors/runner';
import { createTestKeyPairStore } from '../../../../credentials/keypair.test-support';
import type { EffectExecutionIdentity } from '../../../../state-machine';
import type {
  DeliverTaskMonitorReviewEffect,
  EvaluateTaskMonitorSettledRunEffect,
} from '../effects';
import {
  TaskMonitorReviewDeliveryEffectHandler,
  TaskMonitorSettledRunEvaluationEffectHandler,
  type TaskMonitorSettledRunEvaluationEffectHandlerDependencies,
} from '../supervision-effect-handlers';
import { LocalPromptType } from '../../../../shared/agent-bridge-contract/generated/api';
import { TaskMonitorReviewMode, WorkStatus } from '../../../../shared/api/generated/api';
import type { LocalTaskMonitorCoordinatorDecision } from '../../../../shared/agent-bridge-contract/generated/api';

const effect: EvaluateTaskMonitorSettledRunEffect = {
  type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  authorityCommandId: '35000000-0000-4000-8000-000000000003',
  runId: 'run-1',
  agentSessionId: '40000000-0000-4000-8000-000000000004',
  settledAt: '2026-08-09T12:00:00.000Z',
  outcome: 'COMPLETED',
  turnId: 'turn-1',
  promptType: 'task',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: null,
  reports: [],
  reviewRequestId: null,
};

const execution: EffectExecutionIdentity = {
  machineType: 'TASK_MONITOR',
  instanceId: effect.taskMonitorId,
  effectId: 'effect-1',
};

const dependencies = (
  authContext: TaskMonitorSettledRunEvaluationEffectHandlerDependencies['authContext'],
): TaskMonitorSettledRunEvaluationEffectHandlerDependencies => ({
  apiBaseUrl: 'https://api.test',
  fetchImpl: vi.fn(),
  authContext,
  agentSessionReader: { readAgentSession: vi.fn() } as never,
  agentService: {} as never,
  runStore: {} as never,
  messagePoster: {} as never,
  keyPairStore: createTestKeyPairStore(),
  decisionStore: new TaskMonitorDecisionStore(
    NOOP_LOGGER,
    new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
  ),
  taskMonitorStartRuntime: {} as never,
  coordinatorRunner: Object.create(
    TaskMonitorCoordinatorRunner.prototype,
  ) as TaskMonitorCoordinatorRunner,
  logger: NOOP_LOGGER,
});

describe('Task Monitor settled-Run evaluation', () => {
  it('does not call canonical owners when authenticated scope is stale', async () => {
    const input = dependencies(createTestPlatformAuthContext(null));
    const readAgentSession = vi.spyOn(input.agentSessionReader, 'readAgentSession');
    const handler = new TaskMonitorSettledRunEvaluationEffectHandler(input);

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'OUTCOME_JUDGMENT_REQUIRED' },
    });
    expect(readAgentSession).not.toHaveBeenCalled();
  });

  it('reconciles a claimed evaluation as uncertain without repeating owner work', async () => {
    const input = dependencies(createTestPlatformAuthContext(null));
    const handler = new TaskMonitorSettledRunEvaluationEffectHandler(input);

    vi.spyOn(input.coordinatorRunner, 'reconcileRejectedAttempt').mockResolvedValue(null);
    await expect(handler.recovery.reconcile(effect, execution)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: {
        type: 'OUTCOME_JUDGMENT_REQUIRED',
        taskMonitorId: effect.taskMonitorId,
      },
    });
    expect(input.fetchImpl).not.toHaveBeenCalled();
  });

  it('reconciles a durably recorded rejected attempt into the same invalid outcome without relaunching', async () => {
    const input = dependencies(createTestPlatformAuthContext(null));
    vi.spyOn(input.coordinatorRunner, 'reconcileRejectedAttempt').mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_JSON', message: 'Malformed output.' },
    });
    const handler = new TaskMonitorSettledRunEvaluationEffectHandler(input);
    await expect(handler.recovery.reconcile(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'COORDINATOR_DECISION_INVALID',
        attemptId: execution.effectId,
        evaluation: effect,
        failure: { code: 'INVALID_JSON', message: 'Malformed output.', issues: [] },
      },
    });
    expect(input.fetchImpl).not.toHaveBeenCalled();
  });

  const auth = {
    accessToken: 'token',
    userId: '70000000-0000-4000-8000-000000000007',
    organizationId: effect.organizationId,
    projectId: effect.projectId,
  };

  const decisionHarness = async (
    mode: TaskMonitorReviewMode,
    decision: LocalTaskMonitorCoordinatorDecision,
    overrides: Partial<
      Pick<
        TaskMonitorSettledRunEvaluationEffectHandlerDependencies,
        'authContext' | 'agentSessionReader'
      >
    > = {},
  ) => {
    const input = dependencies(createTestPlatformAuthContext(auth));
    const machineId = 'a0000000-0000-4000-8000-00000000000a';
    const keyPairStore = createTestKeyPairStore({ currentMachineId: machineId });
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    await keyPairStore.storePrivateKey(
      machineId,
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    await keyPairStore.storeMachineCredential(machineId, 'machine-credential');
    const executionEntry = {
      taskId: '80000000-0000-4000-8000-000000000008',
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5',
        reasoningEffort: 'high',
      },
      agentSessionId: effect.agentSessionId,
    };
    const monitor = {
      status: WorkStatus.Active,
      definition: {
        cursor: 0,
        executionPlan: [executionEntry],
        launchPolicy: {
          worktree: undefined,
          terminalSupervision: { mode },
        },
      },
    };
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({
              data: { messageId: 'b0000000-0000-4000-8000-00000000000b' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        : init?.method === 'PATCH'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ status: WorkStatus.Completed }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
    );
    const completeMonitor = vi.fn().mockResolvedValue(undefined);
    const haltMonitor = vi.fn().mockResolvedValue(undefined);
    const createOutOfBand = vi.fn().mockResolvedValue({});
    const runTaskMonitor = vi.fn().mockResolvedValue({ runId: 'coordinator-run-1' });
    const wait = vi.fn().mockResolvedValue({ status: 'DECISION', decision });
    const configured: TaskMonitorSettledRunEvaluationEffectHandlerDependencies = {
      ...input,
      fetchImpl: fetchImpl as never,
      keyPairStore,
      agentSessionReader: {
        readAgentSession: vi.fn().mockResolvedValue({
          conversationId: 'coding-conversation-1',
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            taskMonitorId: effect.taskMonitorId,
          },
        }),
      } as never,
      agentService: {
        readAssistantMessage: vi.fn(),
        stopRun: vi.fn().mockResolvedValue(undefined),
      } as never,
      runStore: {
        getRun: vi.fn().mockResolvedValue({
          conversationId: 'coordinator-conversation-1',
          provider_session_id: null,
        }),
        lookupByAgentSessionId: vi.fn().mockReturnValue(null),
      } as never,
      messagePoster: { createOutOfBand } as never,
      decisionStore: { wait } as never,
      taskMonitorStartRuntime: {
        readMonitor: vi.fn().mockResolvedValue(monitor),
        completeMonitor,
        haltMonitor,
      } as never,
      coordinatorRunner: { runTaskMonitor } as never,
      ...overrides,
    };
    return {
      handler: new TaskMonitorSettledRunEvaluationEffectHandler(configured),
      fetchImpl,
      completeMonitor,
      haltMonitor,
      createOutOfBand,
      runTaskMonitor,
    };
  };

  it('authenticates and reads the settled session in the durable effect project after learning another project', async () => {
    const unrelatedProjectId = 'c0000000-0000-4000-8000-00000000000c';
    const projectContext = new MonitorProjectContext({
      runStore: new RunStore(),
      platformWebSocketManager: createTestPlatformWebSocketManager(),
      logger: NOOP_LOGGER,
    });
    projectContext.learn(unrelatedProjectId);
    const token = `header.${Buffer.from(
      JSON.stringify({ organizationId: effect.organizationId, sub: auth.userId }),
    ).toString('base64url')}.signature`;
    const authContext = new PlatformAuthContext(
      createTestOAuthClient({ getAccessToken: async () => ({ success: true, data: token }) }),
      projectContext,
      NOOP_LOGGER,
    );
    const resolveAuth = vi.spyOn(authContext, 'resolve');
    const sessionFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            autoDecide: true,
            conversationId: 'coding-conversation-1',
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              model: 'gpt-5',
              taskMonitorId: effect.taskMonitorId,
            },
          },
        }),
        { status: 200 },
      ),
    );
    const agentSessionReader = new AgentSessionReader({
      apiBaseUrl: 'https://api.test',
      authProvider: authContext,
      fetchImpl: sessionFetch,
      logger: NOOP_LOGGER,
    });
    const { handler, runTaskMonitor } = await decisionHarness(
      TaskMonitorReviewMode.AgentDecides,
      { action: 'WAIT', rationale: 'More evidence is still arriving.' },
      { authContext, agentSessionReader },
    );

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'SUPERVISION_CONTINUES_OBSERVING' },
    });
    expect(resolveAuth.mock.calls).toEqual([[effect.projectId], [effect.projectId]]);
    expect(sessionFetch).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/organizations/${effect.organizationId}/projects/${effect.projectId}/agent-sessions/${effect.agentSessionId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    expect(runTaskMonitor).toHaveBeenCalledWith(expect.anything(), { ...auth, accessToken: token });
    expect(projectContext.currentProjectId).toBe(unrelatedProjectId);
  });

  it('rejects required-Review acceptance before canonical owner mutations', async () => {
    const { handler, fetchImpl, completeMonitor, createOutOfBand } = await decisionHarness(
      TaskMonitorReviewMode.RequireReview,
      { action: 'ACCEPT_TASK', rationale: 'The Task is complete.' },
    );

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'OUTCOME_JUDGMENT_REQUIRED',
        reason: 'Task acceptance requires a successful Review bound to the current selected work.',
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(completeMonitor).not.toHaveBeenCalled();
    expect(createOutOfBand).not.toHaveBeenCalled();
  });

  it.each([
    {
      mode: TaskMonitorReviewMode.AgentDecides,
      acceptedEffect: effect,
      label: 'allows evidence-supported direct acceptance under AGENT_DECIDES',
    },
    {
      mode: TaskMonitorReviewMode.RequireReview,
      acceptedEffect: {
        ...effect,
        promptType: LocalPromptType.CodeReview,
        reviewRequestId: '90000000-0000-4000-8000-000000000009',
      },
      label: 'allows required-Review acceptance after successful bound Review',
    },
  ] as const)('$label', async ({ mode, acceptedEffect }) => {
    const { handler, fetchImpl, completeMonitor } = await decisionHarness(mode, {
      action: 'ACCEPT_TASK',
      rationale: 'The Task is complete.',
    });

    await expect(handler.execute(acceptedEffect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'SUPERVISION_COMPLETED' },
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(completeMonitor).toHaveBeenCalledTimes(1);
  });

  it('does not treat an unsuccessful bound Review as acceptance authority', async () => {
    const { handler, fetchImpl } = await decisionHarness(TaskMonitorReviewMode.RequireReview, {
      action: 'ACCEPT_TASK',
      rationale: 'The Task is complete.',
    });

    await expect(
      handler.execute(
        {
          ...effect,
          promptType: LocalPromptType.CodeReview,
          terminalOutcome: 'FAILED',
          reviewRequestId: '90000000-0000-4000-8000-000000000009',
        },
        execution,
      ),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'REQUEST_REVIEW', rationale: 'Review is warranted.' }, 'REVIEW_REQUEST_COMMITTED'],
    [
      {
        action: 'REQUEST_CHANGES',
        rationale: 'More implementation is needed.',
        guidance: 'Address the remaining behavior.',
      },
      'SUPERVISION_CONTINUES_OBSERVING',
    ],
    [
      { action: 'WAIT', rationale: 'More evidence is still arriving.' },
      'SUPERVISION_CONTINUES_OBSERVING',
    ],
    [
      {
        action: 'REQUEST_JUDGMENT',
        rationale: 'A product decision is required.',
        guidance: 'Decide whether the compatibility trade-off is acceptable.',
      },
      'OUTCOME_JUDGMENT_REQUIRED',
    ],
    [
      {
        action: 'HALT',
        rationale: 'The selected work cannot proceed.',
        failureContext: 'A required external dependency is unavailable.',
      },
      'SUPERVISION_HALTED',
    ],
  ] as const)('keeps %s available before required Review', async (decision, expectedOutcome) => {
    const { handler } = await decisionHarness(
      TaskMonitorReviewMode.RequireReview,
      decision as LocalTaskMonitorCoordinatorDecision,
    );

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: expectedOutcome },
    });
  });
});

describe('Task Monitor Review delivery', () => {
  const reviewEffect: DeliverTaskMonitorReviewEffect = {
    type: 'DELIVER_TASK_MONITOR_REVIEW',
    taskMonitorId: effect.taskMonitorId,
    organizationId: effect.organizationId,
    projectId: effect.projectId,
    runId: effect.runId,
    agentSessionId: effect.agentSessionId,
    requestId: '50000000-0000-4000-8000-000000000005',
    coordinatorRunId: '60000000-0000-4000-8000-000000000006',
    rationale: 'Independent Review is warranted.',
  };
  const auth = {
    accessToken: 'token',
    userId: '70000000-0000-4000-8000-000000000007',
    organizationId: effect.organizationId,
    projectId: effect.projectId,
  };

  const deliveryDependencies = (targetPromptType: string | null) => {
    const base = dependencies(createTestPlatformAuthContext(auth));
    const sendMessage = vi.fn().mockResolvedValue({});
    const createOutOfBand = vi.fn().mockResolvedValue({});
    const input: TaskMonitorSettledRunEvaluationEffectHandlerDependencies = {
      ...base,
      agentService: { sendSystemMessage: sendMessage } as never,
      messagePoster: { createOutOfBand } as never,
      runStore: {
        getRun: vi.fn(async (runId: string) =>
          runId === reviewEffect.coordinatorRunId
            ? { conversationId: 'coordinator-conversation', provider_session_id: null }
            : targetPromptType === null
              ? null
              : { promptType: targetPromptType },
        ),
      } as never,
    };
    return { input, sendMessage, createOutOfBand };
  };

  it('publishes requesting and awaiting around one accepted Review request', async () => {
    const { input, sendMessage, createOutOfBand } = deliveryDependencies('implement');
    const handler = new TaskMonitorReviewDeliveryEffectHandler(input);

    await expect(handler.execute(reviewEffect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'REVIEW_REQUEST_ACCEPTED', requestId: reviewEffect.requestId },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(createOutOfBand.mock.calls.map(([message]) => message.dto.data.outcome)).toEqual([
      'REQUESTING_REVIEW',
      'AWAITING_REVIEW',
    ]);
  });

  it('reconstructs accepted claimed work without sending a duplicate request', async () => {
    const { input, sendMessage, createOutOfBand } = deliveryDependencies(
      LocalPromptType.CodeReview,
    );
    const handler = new TaskMonitorReviewDeliveryEffectHandler(input);

    await expect(handler.recovery.reconcile(reviewEffect)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'REVIEW_REQUEST_ACCEPTED' },
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createOutOfBand.mock.calls.map(([message]) => message.dto.data.outcome)).toEqual([
      'REVIEW_REQUEST_RECONCILING',
      'AWAITING_REVIEW',
    ]);
  });

  it('uses human judgment only when claimed delivery cannot be reconciled', async () => {
    const { input, createOutOfBand } = deliveryDependencies(null);
    const handler = new TaskMonitorReviewDeliveryEffectHandler(input);

    await expect(handler.recovery.reconcile(reviewEffect)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { type: 'REVIEW_REQUEST_FAILED', ambiguous: true },
    });
    expect(createOutOfBand.mock.calls.map(([message]) => message.dto.data.outcome)).toEqual([
      'REVIEW_REQUEST_RECONCILING',
      'REVIEW_RECOVERY_JUDGMENT_REQUIRED',
    ]);
  });
});
