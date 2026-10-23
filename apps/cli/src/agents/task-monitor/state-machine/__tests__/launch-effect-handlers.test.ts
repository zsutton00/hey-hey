import crypto from 'node:crypto';
import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import { describe, expect, it, vi } from 'vitest';

import { createTestKeyPairStore } from '../../../../credentials/keypair.test-support';
import { RunStore } from '../../../../run-store';
import { NOOP_LOGGER } from '../../../../server/logger';
import type { TaskMonitorLaunchFailureRuntime } from '../../../../server/task-monitor-launch-failure-runtime';
import { RunWorktreeCollisionError } from '../../../run-scope';
import { canonicalizeJsonObject } from '../../../../shared/canonical-json';
import type {
  AgentSessionsApiCreateAgentSessionRequest,
  SubmitTaskMonitorRunEffectRequestDto,
} from '../../../../shared/api/generated/api';
import type { TaskMonitorLaunchDeclaration } from '../context';
import {
  TaskMonitorAgentSessionEffectHandler,
  TaskMonitorConversationEffectHandler,
  TaskMonitorRunEffectHandler,
} from '../launch-effect-handlers';
import { TaskMonitorLaunchReconciliationEffectHandler } from '../monitor-effect-handlers';
import type { TaskMonitorStartRuntime } from '../../../../server/task-monitor-start';

const AGENT_SESSION_ID = '60000000-0000-4000-8000-000000000006';
const CONVERSATION_ID = '70000000-0000-4000-8000-000000000007';
const EFFECT_ID = '80000000-0000-4000-8000-000000000008';
const MACHINE_ID = '90000000-0000-4000-8000-000000000009';
const COMMAND_ID = 'a0000000-0000-4000-8000-00000000000a';

const launch: TaskMonitorLaunchDeclaration = {
  taskMonitorId: '30000000-0000-4000-8000-000000000003',
  organizationId: '10000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000002',
  taskId: '40000000-0000-4000-8000-000000000004',
  taskTitle: 'Selected task',
  taskType: 'STANDARD',
  taskDescription: 'Implement selected work.',
  taskAcceptanceCriteria: 'The selected work is complete.',
  cursor: 0,
  method: 'quick',
  provider: 'codex',
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  fastMode: false,
  serviceIds: ['50000000-0000-4000-8000-000000000005'],
  worktree: { enabled: true, branch: 'feature/task-monitor-launch' },
  userGuidance: 'Keep the change focused.',
  planGuidance: null,
  executionOrder: ['40000000-0000-4000-8000-000000000004'],
  dependsOnTaskIds: [],
  terminalPolicy: { mode: 'AGENT_DECIDES' },
  authorityCommandId: COMMAND_ID,
};

const execution = {
  machineType: 'TASK_MONITOR',
  instanceId: launch.taskMonitorId,
  effectId: EFFECT_ID,
};
const createMachineKeyPairStore = async () => {
  const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  await keyPairStore.storePrivateKey(
    MACHINE_ID,
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  await keyPairStore.storeMachineCredential(MACHINE_ID, 'machine-credential');
  return keyPairStore;
};

describe('Task Monitor launch effect handlers', () => {
  it.each([
    { status: 'NOT_STARTED', runId: null, outcome: 'LAUNCH_RETRY_ADMITTED' },
    { status: 'IN_PROGRESS', runId: null, outcome: 'LAUNCH_RETRY_REJECTED' },
    { status: 'NOT_STARTED', runId: 'run-1', outcome: 'LAUNCH_RETRY_REJECTED' },
    { status: 'COMPLETED', runId: null, outcome: 'LAUNCH_RETRY_REJECTED' },
    { status: 'ERRORED', runId: null, outcome: 'LAUNCH_RETRY_REJECTED' },
  ] as const)(
    'canonically admits retry for session status $status and run $runId',
    async ({ status, runId, outcome }) => {
      const runtime = {
        readMonitor: vi.fn().mockResolvedValue({
          status: 'ACTIVE',
          definition: {
            cursor: launch.cursor,
            executionPlan: [{ taskId: launch.taskId, agentSessionId: AGENT_SESSION_ID }],
          },
        }),
      } as never as TaskMonitorStartRuntime;
      const apiRuntime = {
        clients: {
          agentSessions: {
            getAgentSession: vi.fn().mockResolvedValue({
              data: {
                data: {
                  id: AGENT_SESSION_ID,
                  conversationId: CONVERSATION_ID,
                  status,
                },
              },
            }),
          },
        },
      } as never as ApiRuntime;
      const runStore = new RunStore();
      vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue(runId);
      const handler = new TaskMonitorLaunchReconciliationEffectHandler(
        runtime,
        apiRuntime,
        runStore,
        NOOP_LOGGER,
      );

      await expect(
        handler.execute({
          type: 'RECONCILE_TASK_MONITOR_LAUNCH',
          taskMonitorId: launch.taskMonitorId,
          organizationId: launch.organizationId,
          projectId: launch.projectId,
          taskId: launch.taskId,
          cursor: launch.cursor,
          operation: 'RUN_START',
          agentSessionId: AGENT_SESSION_ID,
          conversationId: CONVERSATION_ID,
          retry: {
            taskId: launch.taskId,
            cursor: launch.cursor,
            agentSessionId: AGENT_SESSION_ID,
            conversationId: CONVERSATION_ID,
            failedOperation: 'RUN_START',
            failureReason: 'Initial dispatch failed.',
          },
        }),
      ).resolves.toMatchObject({ outcome: { type: outcome } });
    },
  );

  it('reactivates ON_HOLD before retrying the retained session after a workspace collision', async () => {
    const persistMonitorActive = vi
      .fn()
      .mockImplementation(({ monitor }) => Promise.resolve({ ...monitor, status: 'ACTIVE' }));
    const runtime = {
      readMonitor: vi.fn().mockResolvedValue({
        status: 'ON_HOLD',
        definition: {
          cursor: launch.cursor,
          executionPlan: [{ taskId: launch.taskId, agentSessionId: AGENT_SESSION_ID }],
        },
      }),
      persistMonitorActive,
    } as never as TaskMonitorStartRuntime;
    const apiRuntime = {
      clients: {
        agentSessions: {
          getAgentSession: vi.fn().mockResolvedValue({
            data: {
              data: {
                id: AGENT_SESSION_ID,
                conversationId: CONVERSATION_ID,
                status: 'NOT_STARTED',
              },
            },
          }),
        },
      },
    } as never as ApiRuntime;
    const runStore = new RunStore();
    vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue('local-run-id');
    vi.spyOn(runStore, 'getRun').mockResolvedValue({
      agentic_session_id: 'local-run-id',
      status: 'idle',
    } as never);
    const clearLaunchFailures = vi.fn();
    const handler = new TaskMonitorLaunchReconciliationEffectHandler(
      runtime,
      apiRuntime,
      runStore,
      NOOP_LOGGER,
      { clearLaunchFailures } as never as TaskMonitorLaunchFailureRuntime,
    );
    const failure = new RunWorktreeCollisionError({
      serviceId: launch.serviceIds[0]!,
      repositoryPath: '/repos/service-a',
      branch: launch.worktree?.branch ?? 'feature/task-monitor-launch',
      authority: 'TASK_MONITOR',
    }).failure;

    const result = await handler.execute({
      type: 'RECONCILE_TASK_MONITOR_LAUNCH',
      taskMonitorId: launch.taskMonitorId,
      organizationId: launch.organizationId,
      projectId: launch.projectId,
      taskId: launch.taskId,
      cursor: launch.cursor,
      operation: 'RUN_START',
      agentSessionId: AGENT_SESSION_ID,
      conversationId: CONVERSATION_ID,
      retry: {
        taskId: launch.taskId,
        cursor: launch.cursor,
        agentSessionId: AGENT_SESSION_ID,
        conversationId: CONVERSATION_ID,
        failedOperation: 'RUN_START',
        failureReason: failure.message,
        failure,
      },
    });
    expect(result).toEqual({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_RETRY_ADMITTED',
        taskMonitorId: launch.taskMonitorId,
        taskId: launch.taskId,
        cursor: launch.cursor,
        agentSessionId: AGENT_SESSION_ID,
        conversationId: CONVERSATION_ID,
      },
    });
    expect(persistMonitorActive).toHaveBeenCalledWith(
      expect.objectContaining({ monitor: expect.objectContaining({ status: 'ON_HOLD' }) }),
    );
    expect(clearLaunchFailures).toHaveBeenCalledWith({
      taskMonitorId: launch.taskMonitorId,
      agentSessionId: AGENT_SESSION_ID,
    });
  });

  it('does not reactivate an ON_HOLD monitor before validating retry identity', async () => {
    const persistMonitorActive = vi.fn();
    const runtime = {
      readMonitor: vi.fn().mockResolvedValue({
        status: 'ON_HOLD',
        definition: {
          cursor: launch.cursor + 1,
          executionPlan: [{ taskId: launch.taskId, agentSessionId: AGENT_SESSION_ID }],
        },
      }),
      persistMonitorActive,
    } as never as TaskMonitorStartRuntime;
    const apiRuntime = {
      clients: {
        agentSessions: {
          getAgentSession: vi.fn(),
        },
      },
    } as never as ApiRuntime;
    const runStore = new RunStore();
    const handler = new TaskMonitorLaunchReconciliationEffectHandler(
      runtime,
      apiRuntime,
      runStore,
      NOOP_LOGGER,
    );
    const failure = new RunWorktreeCollisionError({
      serviceId: launch.serviceIds[0]!,
      repositoryPath: '/repos/service-a',
      branch: launch.worktree?.branch ?? 'feature/task-monitor-launch',
      authority: 'TASK_MONITOR',
    }).failure;

    await expect(
      handler.execute({
        type: 'RECONCILE_TASK_MONITOR_LAUNCH',
        taskMonitorId: launch.taskMonitorId,
        organizationId: launch.organizationId,
        projectId: launch.projectId,
        taskId: launch.taskId,
        cursor: launch.cursor,
        operation: 'RUN_START',
        agentSessionId: AGENT_SESSION_ID,
        conversationId: CONVERSATION_ID,
        retry: {
          taskId: launch.taskId,
          cursor: launch.cursor,
          agentSessionId: AGENT_SESSION_ID,
          conversationId: CONVERSATION_ID,
          failedOperation: 'RUN_START',
          failureReason: failure.message,
          failure,
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'LAUNCH_RETRY_REJECTED',
        reason: 'Canonical Task Monitor cursor no longer matches the retryable launch.',
      },
    });
    expect(persistMonitorActive).not.toHaveBeenCalled();
  });

  it('stores the canonical Agent Session identity returned by the platform', async () => {
    const create = vi.fn((request: AgentSessionsApiCreateAgentSessionRequest) => {
      void request;
      return Promise.resolve({ data: { data: { id: AGENT_SESSION_ID } } });
    });
    const apiRuntime = {
      clients: {
        agentSessions: {
          createAgentSession: create,
        },
      },
    } as never as ApiRuntime;

    await expect(
      new TaskMonitorAgentSessionEffectHandler(apiRuntime, NOOP_LOGGER).execute(
        { type: 'CREATE_TASK_MONITOR_AGENT_SESSION', launch },
        execution,
      ),
    ).resolves.toEqual({
      status: 'succeeded',
      outcome: {
        type: 'AGENT_SESSION_CREATED',
        taskMonitorId: launch.taskMonitorId,
        taskId: launch.taskId,
        agentSessionId: AGENT_SESSION_ID,
      },
    });
    expect(create.mock.calls[0]?.[0].createAgentSessionDto).toMatchObject({
      autoDecide: true,
      entityId: launch.taskId,
      serviceIds: launch.serviceIds,
      launchServiceId: launch.serviceIds[0],
      provider: launch.provider,
      config: {
        type: 'CODING_SESSION',
        version: 'v2',
        method: launch.method,
        model: launch.model,
        effort: launch.reasoningEffort,
        fastMode: false,
        taskMonitorId: launch.taskMonitorId,
        worktree: launch.worktree?.branch,
      },
    });
    expect(create.mock.calls[0]?.[0].createAgentSessionDto).not.toHaveProperty('agentSessionId');
  });

  it('discovers the canonical Conversation before attempting creation', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { data: { id: AGENT_SESSION_ID, conversationId: CONVERSATION_ID } },
    });
    const createConversation = vi.fn();
    const apiRuntime = {
      clients: {
        agentSessions: {
          getAgentSession: getSession,
          createAgentSessionConversation: createConversation,
        },
      },
    } as never as ApiRuntime;

    await expect(
      new TaskMonitorConversationEffectHandler(apiRuntime, NOOP_LOGGER).execute({
        type: 'CREATE_TASK_MONITOR_CONVERSATION',
        launch,
        agentSessionId: AGENT_SESSION_ID,
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'CONVERSATION_CREATED', conversationId: CONVERSATION_ID },
    });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('dispatches the committed Run with method payload, metadata, and unchanged user guidance', async () => {
    const request = vi.fn();
    const fetchMock = vi.fn(async (_url: string, requestInit?: RequestInit) => {
      const body = requestInit?.body;
      if (typeof body !== 'string') throw new Error('Expected a serialized machine-effect body.');
      const requestBody = JSON.parse(body) as SubmitTaskMonitorRunEffectRequestDto;
      expect(requestInit?.headers).toEqual({
        Authorization: 'Bearer machine-credential',
        'Content-Type': 'application/json',
      });
      expect(requestBody.proof.bodySha256).toBe(
        crypto
          .createHash('sha256')
          .update(canonicalizeJsonObject({ run: requestBody.run }), 'utf8')
          .digest('hex'),
      );
      return new Response(
        JSON.stringify({
          success: true,
          data: { dispatched: true, triggerMessageId: 'message-1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const apiRuntime = {
      baseUrl: 'http://localhost/api/v1',
      transport: { request },
    } as never as ApiRuntime;
    const runStore = new RunStore();
    const handler = new TaskMonitorRunEffectHandler(
      apiRuntime,
      fetchImpl,
      await createMachineKeyPairStore(),
      runStore,
      NOOP_LOGGER,
    );

    await expect(
      handler.execute(
        {
          type: 'START_TASK_MONITOR_RUN',
          launch,
          agentSessionId: AGENT_SESSION_ID,
          conversationId: CONVERSATION_ID,
        },
        execution,
      ),
    ).resolves.toMatchObject({ status: 'succeeded', outcome: { type: 'RUN_STARTED' } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected the Task Monitor run request.');
    const requestData = JSON.parse(requestBody) as SubmitTaskMonitorRunEffectRequestDto;
    expect(requestData).toBeDefined();
    if (!requestData) throw new Error('Expected the Task Monitor run request.');
    expect(requestData.run).toMatchObject({
      attachments: [],
      handlerPromptType: 'quick',
      provider: launch.provider,
      model: launch.model,
      reasoningEffort: launch.reasoningEffort,
      fastMode: false,
      agentSessionId: AGENT_SESSION_ID,
      machineId: MACHINE_ID,
      worktree: launch.worktree,
      payload: {
        promptType: 'quick',
        entity: { entityType: 'TASK', entityId: launch.taskId },
        userMessage: 'Keep the change focused.',
      },
      contextMetadata: { taskMonitorId: launch.taskMonitorId },
    });
    expect(requestData.run.payload).not.toHaveProperty('startupInput');
    expect(requestData).not.toHaveProperty('authorization');
    expect(requestData.proof).toMatchObject({
      operationId: 'submitTaskMonitorRunEffect',
      effectId: EFFECT_ID,
      organizationId: launch.organizationId,
    });
  });

  it('reports an uncertain dispatch and reconciles read-only through the Run owner', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const apiRuntime = {
      baseUrl: 'http://localhost/api/v1',
      transport: { request: vi.fn() },
    } as never as ApiRuntime;
    const runStore = new RunStore();
    vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue('local-run-id');
    const handler = new TaskMonitorRunEffectHandler(
      apiRuntime,
      fetchImpl,
      await createMachineKeyPairStore(),
      runStore,
      NOOP_LOGGER,
    );
    const effect = {
      type: 'START_TASK_MONITOR_RUN' as const,
      launch,
      agentSessionId: AGENT_SESSION_ID,
      conversationId: CONVERSATION_ID,
    };

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { type: 'LAUNCH_OPERATION_UNCERTAIN', operation: 'RUN_START' },
    });
    await expect(handler.recovery.reconcile(effect)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'RUN_STARTED', agentSessionId: AGENT_SESSION_ID },
    });
  });

  it('does not retry a machine-authenticated 401 through the OAuth transport', async () => {
    const request = vi.fn();
    const fetchMock = vi.fn(async () => new Response('unknown token', { status: 401 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const apiRuntime = {
      baseUrl: 'http://localhost/api/v1',
      transport: { request },
    } as never as ApiRuntime;
    const handler = new TaskMonitorRunEffectHandler(
      apiRuntime,
      fetchImpl,
      await createMachineKeyPairStore(),
      new RunStore(),
      NOOP_LOGGER,
    );

    await expect(
      handler.execute(
        {
          type: 'START_TASK_MONITOR_RUN',
          launch,
          agentSessionId: AGENT_SESSION_ID,
          conversationId: CONVERSATION_ID,
        },
        execution,
      ),
    ).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { operation: 'RUN_START' },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });
});
