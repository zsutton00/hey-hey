import crypto from 'node:crypto';
import { vi } from 'vitest';

import type { TaskMonitorMachineEffect } from '../agents/task-monitor/state-machine/events';
import type { MonitorCommandBody1 as MonitorCommandBody } from '../shared/agent-bridge-contract/generated/api';
import { TaskMonitorStartRuntime } from './task-monitor-start';
import { TaskMonitorCoordinatorRunner } from './monitors/runner';
import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';

export const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
export const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
export const MONITOR_ID = '30000000-0000-4000-8000-000000000003';
const DEPENDENCY_ID = '40000000-0000-4000-8000-000000000004';
export const FIRST_TASK_ID = '50000000-0000-4000-8000-000000000005';
export const SECOND_TASK_ID = '60000000-0000-4000-8000-000000000006';
export const CONVERSATION_ID = '70000000-0000-4000-8000-000000000007';
export const COORDINATOR_SESSION_ID = '80000000-0000-4000-8000-000000000008';
export const COORDINATOR_CONVERSATION_ID = '90000000-0000-4000-8000-000000000009';
export const MACHINE_ID = 'a0000000-0000-4000-8000-00000000000a';
export const CREATED_AGENT_SESSION_ID = 'b0000000-0000-4000-8000-00000000000b';
export const FIRST_START_COMMAND_ID = 'd0000000-0000-4000-8000-00000000000d';
export const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
export const ORIGINAL_GUIDANCE = 'Keep the active Run on its original input.';

export const executionPlan = [
  {
    taskId: FIRST_TASK_ID,
    dependsOnTaskIds: [DEPENDENCY_ID],
    method: 'quick' as const,
    provider: 'codex' as const,
    model: 'gpt-6-sol',
    reasoningEffort: 'high' as const,
    agentSessionId: null,
  },
  {
    taskId: SECOND_TASK_ID,
    dependsOnTaskIds: [FIRST_TASK_ID],
    method: 'quick' as const,
    provider: 'codex' as const,
    model: 'gpt-6-sol',
    reasoningEffort: 'high' as const,
    agentSessionId: null,
  },
];

export type FirstLaunchOwners = ReturnType<typeof createTestLocalAgentServerRuntimeOwners>;

export const drainDurableTaskMonitorWork = async (
  runner: FirstLaunchOwners['effectRunner'],
): Promise<void> => {
  for (let index = 0; index < 20; index += 1) {
    const results = await Promise.all([runner.runNext(), runner.runNext()]);
    if (results.every((result) => result.status === 'idle')) return;
  }
  throw new Error('Task Monitor effects did not drain.');
};

export const firstStartCommand = (): MonitorCommandBody => ({
  version: 1,
  kind: 'task_monitor_command',
  commandId: FIRST_START_COMMAND_ID,
  createdAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 60_000).toISOString(),
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  target: { workItemType: 'TASK_MONITOR', workItemId: MONITOR_ID },
  command: {
    cause: 'START',
    launchConfig: {
      taskId: FIRST_TASK_ID,
      method: 'quick',
      provider: 'codex',
      model: 'gpt-6-sol',
      reasoningEffort: 'high',
    },
    userMessage: ORIGINAL_GUIDANCE,
  },
});

/** Reusable first-launch vertical slice; callers own assertions and cleanup. */
export const createFirstLaunchFixture = async (
  options: {
    readonly failFirstRunStart?: boolean;
    readonly bypassResumeCoordination?: boolean;
  } = {},
) => {
  let monitorStatus = 'BACKLOG';
  let monitorCursor = 0;
  let persistedAgentSessionId: string | null = null;
  const taskStatuses = new Map([
    [DEPENDENCY_ID, 'COMPLETED'],
    [FIRST_TASK_ID, 'NOT_STARTED'],
    [SECOND_TASK_ID, 'NOT_STARTED'],
  ]);
  const monitor = () => ({
    id: MONITOR_ID,
    name: 'Durable supervision monitor',
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    status: monitorStatus,
    definition: {
      executionPlan: executionPlan.map((entry, index) => ({
        taskId: entry.taskId,
        dependsOnTaskIds: entry.dependsOnTaskIds,
        launchConfiguration: {
          method: entry.method,
          provider: entry.provider,
          model: entry.model,
          reasoningEffort: entry.reasoningEffort,
        },
        agentSessionId: index === monitorCursor ? persistedAgentSessionId : entry.agentSessionId,
      })),
      launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' as const } },
      cursor: monitorCursor,
      status: 'NOT_STARTED' as const,
    },
  });
  const task = (taskId: string) => ({
    id: taskId,
    name:
      taskId === SECOND_TASK_ID ? 'Implement the next durable step' : 'Implement durable launch',
    type: 'STANDARD',
    description: 'Exercise the durable Task Monitor path.',
    acceptanceCriteria: 'The operation is observed exactly once.',
    status: taskStatuses.get(taskId) ?? 'NOT_STARTED',
    serviceIds: ['service-a'],
  });

  vi.spyOn(TaskMonitorStartRuntime.prototype, 'readMonitor').mockImplementation(() =>
    Promise.resolve(monitor() as never),
  );
  vi.spyOn(TaskMonitorStartRuntime.prototype, 'readTask').mockImplementation(({ taskId }) =>
    Promise.resolve(task(taskId)),
  );
  vi.spyOn(TaskMonitorStartRuntime.prototype, 'resolvePlanContext').mockResolvedValue(null);
  vi.spyOn(TaskMonitorStartRuntime.prototype, 'persistTaskActive').mockImplementation(
    async ({ task: selected }) => {
      taskStatuses.set(selected.id, 'ACTIVE');
      return { ...selected, status: 'ACTIVE' };
    },
  );
  vi.spyOn(TaskMonitorStartRuntime.prototype, 'persistCursor').mockImplementation(
    async ({ cursor }) => {
      monitorCursor = cursor;
      return monitor() as never;
    },
  );
  vi.spyOn(TaskMonitorStartRuntime.prototype, 'persistMonitorActive').mockImplementation(
    async () => {
      monitorStatus = 'ACTIVE';
      return monitor() as never;
    },
  );
  const persistMonitorStatus = vi
    .spyOn(TaskMonitorStartRuntime.prototype, 'persistMonitorStatus')
    .mockImplementation(async ({ status }) => {
      monitorStatus = status;
      return monitor() as never;
    });
  const persistLaunch = vi
    .spyOn(TaskMonitorStartRuntime.prototype, 'persistLaunch')
    .mockImplementation(async ({ planIndex, agentSessionId }) => {
      if (planIndex !== monitorCursor) throw new Error('Unexpected launch persistence cursor.');
      persistedAgentSessionId = agentSessionId;
      return monitor() as never;
    });
  vi.spyOn(TaskMonitorCoordinatorRunner.prototype, 'ensureTaskMonitorRun').mockResolvedValue({
    runId: COORDINATOR_SESSION_ID,
    coordinatorAgentSessionId: COORDINATOR_SESSION_ID,
  });

  const startRun = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { dispatched: true, triggerMessageId: 'run-trigger' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const owners = createTestLocalAgentServerRuntimeOwners({
    fetchImpl: startRun as unknown as typeof fetch,
  });
  if (options.failFirstRunStart) {
    vi.spyOn(owners.infrastructure.runStore, 'lookupByAgentSessionId').mockReturnValue(null);
  }
  vi.spyOn(owners.infrastructure.apiRuntime.transport, 'request').mockResolvedValue({
    data: { success: true },
  } as never);
  const machineId = vi.spyOn(owners.infrastructure.keyPairStore, 'loadCurrentMachineId');
  if (options.failFirstRunStart) machineId.mockResolvedValueOnce(null);
  machineId.mockResolvedValue(MACHINE_ID);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  vi.spyOn(owners.infrastructure.keyPairStore, 'loadPrivateKey').mockResolvedValue(
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  vi.spyOn(owners.infrastructure.keyPairStore, 'loadMachineCredential').mockResolvedValue(
    'machine-credential',
  );
  vi.spyOn(owners.infrastructure.platformAuthContext, 'resolve').mockResolvedValue({
    accessToken: 'test-access-token',
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    userId: 'user-1',
  });
  const grantIssuedAt = Date.now();
  vi.spyOn(owners.infrastructure.executionGrantStore, 'list').mockResolvedValue([
    {
      grantId: 'first-launch-grant',
      organizationId: ORGANIZATION_ID,
      userId: 'user-1',
      machineId: MACHINE_ID,
      revoked: false,
      suspended: false,
      terminal: false,
      allowedActionTypes: ['CONVERSATION_TRIGGER'],
      allowedActionCategories: ['CONVERSATION'],
      issuedAtMs: grantIssuedAt,
      effectiveExpiresAtMs: grantIssuedAt + 5 * 60 * 1_000,
    } as never,
  ]);
  vi.spyOn(owners.infrastructure.executionGrantStore, 'admit').mockResolvedValue({} as never);
  const createAgentSession = vi
    .spyOn(owners.infrastructure.apiRuntime.clients.agentSessions, 'createAgentSession')
    .mockResolvedValue({ data: { data: { id: CREATED_AGENT_SESSION_ID } } } as never);
  let conversationCreated = false;
  vi.spyOn(
    owners.infrastructure.apiRuntime.clients.agentSessions,
    'getAgentSession',
  ).mockImplementation(() =>
    Promise.resolve({
      data: {
        data: {
          id: CREATED_AGENT_SESSION_ID,
          conversationId: conversationCreated ? CONVERSATION_ID : null,
          status: 'NOT_STARTED',
        },
      },
    } as never),
  );
  const createConversation = vi
    .spyOn(owners.infrastructure.apiRuntime.clients.agentSessions, 'createAgentSessionConversation')
    .mockImplementation(() => {
      conversationCreated = true;
      return Promise.resolve({
        data: { data: { conversation: { id: CONVERSATION_ID } } },
      } as never);
    });
  const projectStarted = vi
    .spyOn(owners.infrastructure.apiRuntime.clients.conversationsApi, 'postMessage')
    .mockResolvedValue({ data: { success: true } } as never);
  vi.spyOn(
    owners.infrastructure.apiRuntime.clients.agentSessions,
    'resolveWorkItemCoordinator',
  ).mockResolvedValue({
    data: {
      data: {
        agentSession: {
          id: COORDINATOR_SESSION_ID,
          conversationId: COORDINATOR_CONVERSATION_ID,
        },
      },
    },
  } as never);
  const observedEffects: TaskMonitorMachineEffect['type'][] = [];
  const execute = owners.monitorRuntime.taskMonitorMachineEffectHandler.execute.bind(
    owners.monitorRuntime.taskMonitorMachineEffectHandler,
  );
  vi.spyOn(owners.monitorRuntime.taskMonitorMachineEffectHandler, 'execute').mockImplementation(
    async (effect, execution) => {
      observedEffects.push((effect as TaskMonitorMachineEffect).type);
      if (
        options.bypassResumeCoordination &&
        effect.type === 'COORDINATE_TASK_MONITOR_WORK' &&
        effect.cause === 'RESUME'
      ) {
        const agentSessionId = effect.coordination?.activeRunAgentSessionId;
        if (!agentSessionId) {
          throw new Error('Resume fixture lost its active Agent Session identity.');
        }
        return {
          status: 'succeeded',
          outcome: {
            type: 'SUPERVISION_CONTINUES_OBSERVING',
            taskMonitorId: effect.taskMonitorId,
            runId: effect.coordination?.activeRunId ?? 'resume-coordinator-run',
            agentSessionId,
          },
        };
      }
      return execute(effect, execution);
    },
  );

  const acknowledgement =
    await owners.taskMonitorStateMachineInputAdapter.admit(firstStartCommand());
  await drainDurableTaskMonitorWork(owners.effectRunner);
  const stored = await owners.machineStore.findByInstanceId(MONITOR_ID);
  if (!stored) {
    throw new Error('First-launch fixture did not persist its Task Monitor machine.');
  }
  if (!options.failFirstRunStart && stored.snapshot.context.activeRunAgentSessionId === null) {
    throw new Error('First-launch fixture did not reach an active Run.');
  }
  const activeRunAgentSessionId = options.failFirstRunStart
    ? CREATED_AGENT_SESSION_ID
    : stored.snapshot.context.activeRunAgentSessionId;
  if (activeRunAgentSessionId === null) {
    throw new Error('First-launch fixture lost its launched Agent Session identity.');
  }
  return {
    owners,
    acknowledgement,
    stored,
    taskStatuses,
    createAgentSession,
    createConversation,
    startRun,
    persistLaunch,
    persistMonitorStatus,
    projectStarted,
    observedEffects,
    persistedAgentSessionId,
    activeRunAgentSessionId,
  };
};
