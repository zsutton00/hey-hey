import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import { RunWorktreeCollisionError } from '../agents/run-scope';
import type {
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorInput,
} from '../agents/task-monitor/state-machine/events';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineLogic,
  type TaskMonitorMachineState,
} from '../agents/task-monitor/state-machine/machine';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
  type EffectHandler,
  type EffectHandlers,
} from '../state-machine';
import { TaskMonitorStartRuntime } from './task-monitor-start';
import { NOOP_LOGGER } from './logger';
import { TaskMonitorLaunchFailureAdapter } from './task-monitor-launch-failure-adapter';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';
import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';
import {
  COORDINATOR_CONVERSATION_ID,
  COORDINATOR_SESSION_ID,
  CONVERSATION_ID as FIXTURE_CONVERSATION_ID,
  CREATED_AGENT_SESSION_ID as FIXTURE_AGENT_SESSION_ID,
  createFirstLaunchFixture,
  drainDurableTaskMonitorWork,
  FIRST_START_COMMAND_ID,
  firstStartCommand,
  ORIGINAL_GUIDANCE,
} from './task-monitor-first-launch.integration.test-support';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const MONITOR_ID = '30000000-0000-4000-8000-000000000003';
const DEPENDENCY_ID = '40000000-0000-4000-8000-000000000004';
const TASK_ID = '50000000-0000-4000-8000-000000000005';
const CONVERSATION_ID = '60000000-0000-4000-8000-000000000006';
const MACHINE_ID = '70000000-0000-4000-8000-000000000007';

const temporaryDirectories: string[] = [];

const launch = {
  taskMonitorId: MONITOR_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  authorityCommandId: '80000000-0000-4000-8000-000000000008',
  taskId: TASK_ID,
  taskTitle: 'Implement durable launch',
  taskType: 'STANDARD',
  taskDescription: 'Exercise the durable launch path.',
  taskAcceptanceCriteria: 'The launch is observed exactly once.',
  cursor: 0,
  method: 'quick' as const,
  provider: 'codex' as const,
  model: 'gpt-6-sol',
  reasoningEffort: 'high' as const,
  serviceIds: ['service-a'],
  userGuidance: null,
  planGuidance: null,
  executionOrder: [TASK_ID],
  dependsOnTaskIds: [DEPENDENCY_ID],
  terminalPolicy: { mode: 'AGENT_DECIDES' as const },
};

const creatingSessionContext: TaskMonitorMachineContext = {
  taskMonitorId: MONITOR_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  authorityCommandId: '80000000-0000-4000-8000-000000000008',
  requestedLaunchConfig: {
    taskId: TASK_ID,
    method: 'quick',
    provider: 'codex',
    model: 'gpt-6-sol',
    reasoningEffort: 'high',
  },
  executionPlan: [
    {
      taskId: TASK_ID,
      dependsOnTaskIds: [DEPENDENCY_ID],
      method: 'quick',
      provider: 'codex',
      model: 'gpt-6-sol',
      reasoningEffort: 'high',
      agentSessionId: null,
    },
  ],
  cursor: 0,
  selectedTaskId: TASK_ID,
  userGuidance: null,
  worktree: null,
  terminalPolicy: { mode: 'AGENT_DECIDES' },
  launch,
  agentSessionId: null,
  activeRunAgentSessionId: null,
  conversationId: null,
  coordinatorConversationId: null,
  pendingIntervention: null,
  settledRun: null,
  reviewRequest: null,
  input: { queuedMessageIds: [], active: null },
  failureReason: null,
};

const createDurableOwners = (
  filePath: string,
  handlers: EffectHandlers<TaskMonitorMachineEffect, TaskMonitorMachineEffectOutcome>,
) => {
  const store = new MachineStateStore<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineContext,
    TaskMonitorMachineEffect,
    TaskMonitorMachineEffectOutcome
  >(filePath, taskMonitorStateStoreCodec);
  const runtime = new MachineRuntime<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineEvent,
    TaskMonitorMachineContext,
    TaskMonitorMachineLogic,
    TaskMonitorMachineEffect,
    TaskMonitorMachineEffectOutcome,
    VerifiedTaskMonitorInput
  >(store);
  const registry = new MachineRegistry(runtime);
  registry.register(createTaskMonitorDefinition());
  const runner = new EffectRunner(store, runtime, registry, handlers);
  return { store, recovery: new MachineRecovery(store, registry, runner) };
};

const command = (commandId = '80000000-0000-4000-8000-000000000008') => ({
  version: 1 as const,
  kind: 'task_monitor_command' as const,
  commandId,
  createdAt: '2026-08-08T00:00:00.000Z',
  expiresAt: '2026-08-08T00:15:00.000Z',
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  target: { workItemType: 'TASK_MONITOR' as const, workItemId: MONITOR_ID },
  command: {
    cause: 'START' as const,
    launchConfig: {
      taskId: TASK_ID,
      method: 'quick' as const,
      provider: 'codex' as const,
      model: 'gpt-6-sol',
      reasoningEffort: 'high' as const,
    },
    userMessage: 'Implement the selected Task.',
  },
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

useTestCapabilityCatalog();

describe('Task Monitor durable START machine', () => {
  it('retries one persisted selected session through CONTINUE without creating another session', async () => {
    const fixture = await createFirstLaunchFixture({ failFirstRunStart: true });
    const { owners } = fixture;
    temporaryDirectories.push(owners.dataDir);
    expect(fixture.stored.snapshot).toMatchObject({
      state: { RUNNING: { work: 'RETRYABLE_LAUNCH' } },
      context: {
        agentSessionId: FIXTURE_AGENT_SESSION_ID,
        conversationId: FIXTURE_CONVERSATION_ID,
        retryableLaunch: {
          taskId: TASK_ID,
          cursor: 0,
          agentSessionId: FIXTURE_AGENT_SESSION_ID,
          conversationId: FIXTURE_CONVERSATION_ID,
          failedOperation: 'RUN_START',
        },
      },
    });

    const continueCommand = {
      ...firstStartCommand(),
      commandId: 'e0000000-0000-4000-8000-00000000000e',
      command: { cause: 'CONTINUE' as const },
    };
    await expect(
      owners.taskMonitorStateMachineInputAdapter.admit(continueCommand),
    ).resolves.toEqual({
      status: 'ADMITTED',
      commandId: continueCommand.commandId,
      replayed: false,
    });
    await drainDurableTaskMonitorWork(owners.effectRunner);
    const recovered = await owners.machineStore.findByInstanceId(MONITOR_ID);
    expect(recovered?.snapshot).toMatchObject({
      state: { RUNNING: { work: 'OBSERVING_RUN' } },
      context: {
        agentSessionId: FIXTURE_AGENT_SESSION_ID,
        activeRunAgentSessionId: FIXTURE_AGENT_SESSION_ID,
        retryableLaunch: null,
      },
    });
    expect(fixture.createAgentSession).toHaveBeenCalledOnce();
    expect(fixture.createConversation).toHaveBeenCalledOnce();
    expect(fixture.startRun).toHaveBeenCalledOnce();

    await expect(
      owners.taskMonitorStateMachineInputAdapter.admit(continueCommand),
    ).resolves.toEqual({
      status: 'ADMITTED',
      commandId: continueCommand.commandId,
      replayed: true,
    });
    await drainDurableTaskMonitorWork(owners.effectRunner);
    expect(fixture.createAgentSession).toHaveBeenCalledOnce();
    expect(fixture.startRun).toHaveBeenCalledOnce();
  });

  it('holds a checked-out-branch collision and retries the same session after Start', async () => {
    const fixture = await createFirstLaunchFixture();
    const { owners } = fixture;
    temporaryDirectories.push(owners.dataDir);
    const launchFailureRuntime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
    const launchFailureAdapter = new TaskMonitorLaunchFailureAdapter(
      launchFailureRuntime,
      owners.machineStore,
      owners.taskMonitorStateMachineInputAdapter,
      NOOP_LOGGER,
    );
    launchFailureAdapter.start();
    vi.spyOn(
      owners.infrastructure.apiRuntime.clients.conversationsApi,
      'getMessages',
    ).mockResolvedValue({
      data: { data: [] },
    } as never);
    vi.spyOn(owners.infrastructure.runStore, 'lookupByAgentSessionId').mockReturnValue(null);
    vi.spyOn(owners.messagePoster, 'createOutOfBand').mockResolvedValue('launch-recovery-message');

    const failure = new RunWorktreeCollisionError({
      serviceId: 'service-a',
      repositoryPath: '/repos/service-a',
      branch: 'feature/task-monitor',
      authority: 'TASK_MONITOR',
    }).failure;
    await launchFailureRuntime.publishLaunchFailure({
      taskMonitorId: MONITOR_ID,
      taskId: TASK_ID,
      runId: COORDINATOR_SESSION_ID,
      agentSessionId: FIXTURE_AGENT_SESSION_ID,
      conversationId: FIXTURE_CONVERSATION_ID,
      failure,
    });
    await drainDurableTaskMonitorWork(owners.effectRunner);

    const held = await owners.machineStore.findByInstanceId(MONITOR_ID);
    expect(held?.snapshot).toMatchObject({
      state: { RUNNING: { control: 'PAUSED', work: 'RETRYABLE_LAUNCH' } },
      context: {
        agentSessionId: FIXTURE_AGENT_SESSION_ID,
        activeRunAgentSessionId: null,
        conversationId: FIXTURE_CONVERSATION_ID,
        retryableLaunch: {
          agentSessionId: FIXTURE_AGENT_SESSION_ID,
          conversationId: FIXTURE_CONVERSATION_ID,
          failure,
        },
      },
    });

    const initialStartCommand = firstStartCommand();
    if (initialStartCommand.command.cause !== 'START') {
      throw new Error('Expected the first-launch fixture command to be START.');
    }
    const retryCommand = {
      ...initialStartCommand,
      commandId: 'e1000000-0000-4000-8000-00000000000e',
      command: {
        cause: 'START' as const,
        launchConfig: initialStartCommand.command.launchConfig,
        userMessage: ORIGINAL_GUIDANCE,
      },
    };
    await expect(owners.taskMonitorStateMachineInputAdapter.admit(retryCommand)).resolves.toEqual({
      status: 'ADMITTED',
      commandId: retryCommand.commandId,
      replayed: false,
    });
    await drainDurableTaskMonitorWork(owners.effectRunner);

    const recovered = await owners.machineStore.findByInstanceId(MONITOR_ID);
    expect(recovered?.snapshot).toMatchObject({
      state: { RUNNING: { control: 'ACTIVE', work: 'OBSERVING_RUN' } },
      context: {
        agentSessionId: FIXTURE_AGENT_SESSION_ID,
        activeRunAgentSessionId: FIXTURE_AGENT_SESSION_ID,
        conversationId: FIXTURE_CONVERSATION_ID,
        retryableLaunch: null,
      },
    });
    expect(fixture.createAgentSession).toHaveBeenCalledOnce();
    expect(fixture.createConversation).toHaveBeenCalledOnce();
    expect(fixture.startRun).toHaveBeenCalledTimes(2);
    launchFailureAdapter.dispose();
  });

  it('commits every checkpoint before one launch and collapses duplicate and competing work', async () => {
    const fixture = await createFirstLaunchFixture();
    const { owners } = fixture;
    temporaryDirectories.push(owners.dataDir);

    expect(fixture.acknowledgement).toEqual({
      status: 'ADMITTED',
      commandId: FIRST_START_COMMAND_ID,
      replayed: false,
    });
    expect(fixture.stored.snapshot).toMatchObject({
      state: { RUNNING: { work: 'OBSERVING_RUN' } },
      context: {
        taskMonitorId: MONITOR_ID,
        selectedTaskId: TASK_ID,
        userGuidance: ORIGINAL_GUIDANCE,
        agentSessionId: expect.any(String),
        conversationId: expect.any(String),
      },
    });
    expect(fixture.observedEffects).toEqual([
      'LOAD_TASK_MONITOR',
      'COORDINATE_TASK_MONITOR_WORK',
      'VALIDATE_TASK_MONITOR_LAUNCH',
      'CREATE_TASK_MONITOR_AGENT_SESSION',
      'CREATE_TASK_MONITOR_CONVERSATION',
      'PERSIST_TASK_MONITOR_LAUNCH',
      'START_TASK_MONITOR_RUN',
      'PROJECT_TASK_MONITOR_STARTED',
    ]);
    expect(fixture.createAgentSession).toHaveBeenCalledOnce();
    expect(fixture.createConversation).toHaveBeenCalledOnce();
    expect(fixture.startRun).toHaveBeenCalledOnce();
    expect(fixture.persistLaunch).toHaveBeenCalledOnce();
    expect(fixture.persistLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        planIndex: 0,
        agentSessionId: fixture.activeRunAgentSessionId,
      }),
    );
    expect(fixture.persistedAgentSessionId).toBe(fixture.activeRunAgentSessionId);
    expect(fixture.projectStarted).toHaveBeenCalledOnce();
    expect(fixture.projectStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        postMessageRequest: expect.objectContaining({
          conversationId: COORDINATOR_CONVERSATION_ID,
        }),
      }),
    );

    await expect(
      owners.taskMonitorStateMachineInputAdapter.admit(firstStartCommand()),
    ).resolves.toEqual({
      status: 'ADMITTED',
      commandId: FIRST_START_COMMAND_ID,
      replayed: true,
    });
    await Promise.all([owners.effectRunner.runNext(), owners.effectRunner.runNext()]);
    expect(fixture.createAgentSession).toHaveBeenCalledOnce();
    expect(fixture.createConversation).toHaveBeenCalledOnce();
    expect(fixture.startRun).toHaveBeenCalledOnce();
    expect(fixture.projectStarted).toHaveBeenCalledOnce();
    expect(await owners.machineStore.listInstances()).toHaveLength(1);
  });

  it('reconstructs a durably settled launch failure into launch judgment', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-monitor-settled-failure-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'machines.json');
    const first = createDurableOwners(filePath, {});
    await first.store.commit({
      expectedRevision: null,
      eventType: 'TEST_SETUP',
      priorRevision: 0,
      priorState: 'ABSENT',
      result: {
        status: 'accepted',
        ingressId: command().commandId,
        snapshot: {
          identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
          revision: 1,
          state: {
            RUNNING: {
              control: 'ACTIVE',
              work: 'CREATING_AGENT_SESSION',
              intervention: 'CLEAR',
              input: 'WAITING_FOR_INPUT',
            },
          },
          context: creatingSessionContext,
        },
        effects: [{ type: 'CREATE_TASK_MONITOR_AGENT_SESSION', launch }],
      },
    });
    const stored = await first.store.findByInstanceId(MONITOR_ID);
    const effectId = stored?.effects[0]?.effectId;
    if (!effectId) throw new Error('Expected the committed Agent Session effect.');
    await first.store.claimEffect(MONITOR_ID, effectId);
    await first.store.settleEffect(effectId, {
      status: 'failed',
      outcome: {
        type: 'LAUNCH_OPERATION_FAILED',
        taskMonitorId: MONITOR_ID,
        taskId: TASK_ID,
        operation: 'AGENT_SESSION_CREATION',
        reason: 'Platform rejected the launch.',
      },
    });

    const restarted = createDurableOwners(filePath, {});
    await restarted.recovery.restore();
    await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { work: 'LAUNCH_JUDGMENT' } },
        context: { failureReason: 'Platform rejected the launch.' },
      },
      effects: [{ status: 'settled', settlement: { status: 'failed' } }],
    });
  });

  it('reconstructs uncertainty through operation-specific reconciliation without re-executing create', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-monitor-uncertain-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'machines.json');
    const first = createDurableOwners(filePath, {});
    await first.store.commit({
      expectedRevision: null,
      eventType: 'TEST_SETUP',
      priorRevision: 0,
      priorState: 'ABSENT',
      result: {
        status: 'accepted',
        ingressId: command().commandId,
        snapshot: {
          identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
          revision: 1,
          state: {
            RUNNING: {
              control: 'ACTIVE',
              work: 'CREATING_AGENT_SESSION',
              intervention: 'CLEAR',
              input: 'WAITING_FOR_INPUT',
            },
          },
          context: creatingSessionContext,
        },
        effects: [{ type: 'CREATE_TASK_MONITOR_AGENT_SESSION', launch }],
      },
    });
    const stored = await first.store.findByInstanceId(MONITOR_ID);
    const effectId = stored?.effects[0]?.effectId;
    if (!effectId) throw new Error('Expected the committed Agent Session effect.');
    await first.store.claimEffect(MONITOR_ID, effectId);
    await first.store.settleEffect(effectId, {
      status: 'uncertain',
      outcome: {
        type: 'LAUNCH_OPERATION_UNCERTAIN',
        taskMonitorId: MONITOR_ID,
        taskId: TASK_ID,
        cursor: 0,
        operation: 'AGENT_SESSION_CREATION',
        agentSessionId: effectId,
        reason: 'Connection ended after dispatch.',
      },
    });

    const createHandler = vi.fn();
    const reconciliation: EffectHandler<TaskMonitorMachineEffect, TaskMonitorMachineEffectOutcome> =
      {
        recovery: { strategy: 'retry' },
        execute: async (effect) => {
          expect(effect).toMatchObject({
            type: 'RECONCILE_TASK_MONITOR_LAUNCH',
            operation: 'AGENT_SESSION_CREATION',
            agentSessionId: effectId,
          });
          return {
            status: 'failed',
            outcome: {
              type: 'RECONCILIATION_FAILED',
              taskMonitorId: MONITOR_ID,
              taskId: TASK_ID,
              cursor: 0,
              operation: 'AGENT_SESSION_CREATION',
              reason: 'Canonical lookup was unavailable.',
            },
          };
        },
      };
    const restarted = createDurableOwners(filePath, {
      CREATE_TASK_MONITOR_AGENT_SESSION: {
        recovery: { strategy: 'retry' },
        execute: createHandler,
      },
      RECONCILE_TASK_MONITOR_LAUNCH: reconciliation,
    });
    await restarted.recovery.restore();
    expect(createHandler).not.toHaveBeenCalled();
    await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { work: 'LAUNCH_JUDGMENT' } },
        context: { agentSessionId: effectId },
      },
      effects: [
        { status: 'settled', settlement: { status: 'uncertain' } },
        {
          effect: {
            type: 'RECONCILE_TASK_MONITOR_LAUNCH',
            operation: 'AGENT_SESSION_CREATION',
          },
          status: 'settled',
        },
      ],
    });
  });
});
