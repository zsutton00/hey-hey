import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkItemTypeMonitorKind } from '@hey-hey/contracts/api/models';
import { TaskMonitorKind, taskMonitorKindConfiguration } from '../../kinds/task-monitor-kind';
import {
  directResultKind,
  fetchServingMonitorKinds,
  nodeResultPayload,
  shippedTaskMonitorKind,
  type ServedNodeResult,
} from '../../kinds/task-monitor-kind.test-support';
import { TaskMonitorNodeResultReader } from '../../kinds/task-monitor-node-result-reader';
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
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import { TaskMonitorReviewMode, WorkStatus } from '@hey-hey/contracts/api/models';
import type { LocalTaskMonitorCoordinatorDecision } from '@hey-hey/contracts/agent-bridge';

const effect: EvaluateTaskMonitorSettledRunEffect = {
  type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
  kindKey: 'task',
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
    > & {
      kind?: WorkItemTypeMonitorKind;
      remainingNodes?: readonly { taskId: string; agentSessionId: string | null }[];
      nodeResults?: readonly ServedNodeResult[];
    } = {},
  ) => {
    const {
      kind: kindConfiguration,
      remainingNodes = [],
      nodeResults = [],
      ...handlerOverrides
    } = overrides;
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
        kind: 'task',
        cursor: 0,
        executionPlan: [
          executionEntry,
          ...remainingNodes.map((node) => ({ ...executionEntry, ...node })),
        ],
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
          : new Response(
              JSON.stringify(
                String(_input).includes('/work-item-types/')
                  ? {
                      data: {
                        definition: {
                          statuses: [
                            { name: 'ACTIVE', meaning: 'IN_PROGRESS' },
                            {
                              name: 'COMPLETED',
                              meaning: 'FINISHED',
                              completionBehavior: 'COMPLETED',
                            },
                          ],
                        },
                      },
                    }
                  : { data: { type: 'STANDARD', status: WorkStatus.Completed } },
              ),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
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
        kindFor: vi.fn(() =>
          Promise.resolve(
            new TaskMonitorKind(
              {
                runtime: {} as never,
                authContext: createTestPlatformAuthContext(null, 'token'),
                apiBaseUrl: 'https://api.test',
                fetchImpl: fetchImpl as never,
                logger: NOOP_LOGGER,
                results: new TaskMonitorNodeResultReader({
                  apiBaseUrl: 'https://api.test',
                  fetchImpl: fetchServingMonitorKinds({}, fetchImpl as never, nodeResults),
                  authContext: createTestPlatformAuthContext(null, 'token'),
                  logger: NOOP_LOGGER,
                }),
              },
              taskMonitorKindConfiguration(
                (kindConfiguration ?? shippedTaskMonitorKind()).key,
                kindConfiguration ?? shippedTaskMonitorKind(),
              ),
            ),
          ),
        ),
      } as never,
      coordinatorRunner: { runTaskMonitor } as never,
      ...handlerOverrides,
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

  it.each(['REJECTED', 'UNCHANGED'] as const)(
    'does not advance an incomplete Task when Work Items completion is %s',
    async (completion) => {
      const { handler, fetchImpl, completeMonitor } = await decisionHarness(
        TaskMonitorReviewMode.AgentDecides,
        {
          action: 'ACCEPT_TASK',
          rationale: 'The evidence supports requesting canonical completion.',
        },
      );
      const defaultResponse = fetchImpl.getMockImplementation()!;
      fetchImpl.mockImplementation(async (input, init) => {
        const url = String(input);
        if (!url.includes('/work-items/')) {
          return defaultResponse(input, init);
        }
        if (init?.method === 'PATCH') {
          return new Response(null, { status: completion === 'REJECTED' ? 400 : 204 });
        }
        return Response.json({ data: { type: 'STANDARD', status: WorkStatus.Verifying } });
      });
      await expect(handler.execute(effect, execution)).resolves.toMatchObject({
        status: 'failed',
        outcome: { type: 'OUTCOME_JUDGMENT_REQUIRED' },
      });
      expect(completeMonitor).not.toHaveBeenCalled();
      const itemWrites = fetchImpl.mock.calls.filter(
        ([url, init]) => String(url).includes('/work-items/') && init?.method === 'PATCH',
      );
      expect(itemWrites).toHaveLength(1);
      expect(JSON.parse(String(itemWrites[0]![1]!.body))).toMatchObject({
        status: WorkStatus.Completed,
      });
    },
  );

  describe('direct acceptance from a configured normalized-result kind', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const settledNode = '80000000-0000-4000-8000-000000000008';
    const nextNode = 'd0000000-0000-4000-8000-00000000000d';
    const nextSession = 'e0000000-0000-4000-8000-00000000000e';
    const turnReport = 'f0000000-0000-4000-8000-00000000000f';
    const earlierReport = 'f1000000-0000-4000-8000-0000000000f1';
    const settledWithResult: EvaluateTaskMonitorSettledRunEffect = {
      ...effect,
      reports: [{ reportId: turnReport, reportType: 'MONITOR_NODE_RESULT' }],
    };
    const turnResult = (payload: unknown): ServedNodeResult => ({
      reportId: turnReport,
      agentSessionId: effect.agentSessionId,
      payload,
    });

    it.each([
      { remainingNodes: [], outcome: 'SUPERVISION_COMPLETED', completes: 1 },
      {
        remainingNodes: [{ taskId: nextNode, agentSessionId: null }],
        outcome: 'COORDINATION_CONTINUES',
        completes: 0,
      },
      {
        remainingNodes: [{ taskId: nextNode, agentSessionId: nextSession }],
        outcome: 'SUPERVISION_COMPLETED',
        completes: 1,
      },
    ])(
      'accepts the settled node from its Turn result with no coordinator run or status change ($outcome)',
      async ({ remainingNodes, outcome, completes }) => {
        const {
          handler,
          fetchImpl,
          runTaskMonitor,
          createOutOfBand,
          completeMonitor,
          haltMonitor,
        } = await decisionHarness(
          TaskMonitorReviewMode.RequireReview,
          { action: 'WAIT', rationale: 'unused' },
          {
            kind: directResultKind(),
            remainingNodes,
            nodeResults: [
              turnResult(nodeResultPayload(settledNode, 'ACCEPTED')),
              {
                reportId: crypto.randomUUID(),
                agentSessionId: nextSession,
                payload: nodeResultPayload(nextNode, 'ACCEPTED'),
              },
            ],
          },
        );

        await expect(handler.execute(settledWithResult, execution)).resolves.toMatchObject({
          status: 'succeeded',
          outcome: { type: outcome },
        });
        expect(runTaskMonitor).not.toHaveBeenCalled();
        expect(createOutOfBand).not.toHaveBeenCalled();
        expect(completeMonitor).toHaveBeenCalledTimes(completes);
        expect(haltMonitor).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalledWith(
          expect.stringContaining('/work-items/'),
          expect.objectContaining({ method: 'PATCH' }),
        );
      },
    );

    it.each([
      {
        case: 'a failed result',
        nodeResults: [
          turnResult(nodeResultPayload(settledNode, 'FAILED', 'Requirement check 3 failed.')),
        ],
        reason: 'Requirement check 3 failed.',
      },
      {
        case: 'a result for another node',
        nodeResults: [turnResult(nodeResultPayload(nextNode, 'ACCEPTED'))],
        reason: `No valid MONITOR_NODE_RESULT report for node ${settledNode}`,
      },
      {
        case: 'an accepted result left by an earlier Turn',
        nodeResults: [
          {
            reportId: earlierReport,
            agentSessionId: effect.agentSessionId,
            payload: nodeResultPayload(settledNode, 'ACCEPTED'),
          },
        ],
        reason: 'in the settled Turn',
      },
      {
        case: 'a malformed result',
        nodeResults: [
          turnResult({ ...nodeResultPayload(settledNode, 'ACCEPTED'), outcome: 'PASS' }),
        ],
        reason: `No valid MONITOR_NODE_RESULT report for node ${settledNode}`,
      },
      { case: 'no result', nodeResults: [], reason: 'No valid MONITOR_NODE_RESULT report' },
    ])(
      'halts with the reason and starts no coordinator run on $case',
      async ({ nodeResults, reason }) => {
        const { handler, runTaskMonitor, completeMonitor, haltMonitor } = await decisionHarness(
          TaskMonitorReviewMode.AgentDecides,
          { action: 'WAIT', rationale: 'unused' },
          { kind: directResultKind(), nodeResults },
        );

        await expect(handler.execute(settledWithResult, execution)).resolves.toMatchObject({
          status: 'succeeded',
          outcome: { type: 'SUPERVISION_HALTED', reason: expect.stringContaining(reason) },
        });
        expect(runTaskMonitor).not.toHaveBeenCalled();
        expect(completeMonitor).not.toHaveBeenCalled();
        expect(haltMonitor).toHaveBeenCalledWith(
          expect.objectContaining({
            monitorId: effect.taskMonitorId,
            failureContext: expect.stringContaining(reason),
          }),
        );
      },
    );

    it('keeps the shipped Task kind on coordinator supervision', async () => {
      const read = vi.spyOn(TaskMonitorNodeResultReader.prototype, 'read');
      const { handler, runTaskMonitor } = await decisionHarness(
        TaskMonitorReviewMode.AgentDecides,
        { action: 'WAIT', rationale: 'Still working.' },
      );

      await handler.execute(effect, execution);

      expect(runTaskMonitor).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
    });
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
