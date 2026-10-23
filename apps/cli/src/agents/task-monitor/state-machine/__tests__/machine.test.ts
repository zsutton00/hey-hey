import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { transition } from 'xstate';

import { MachineRegistry, MachineRuntime, MachineStateStore } from '../../../../state-machine';
import type { MonitorCommandBody1 as MonitorCommandBody } from '../../../../shared/agent-bridge-contract/generated/api';
import { RunWorktreeCollisionError } from '../../../run-scope';
import type { TaskMonitorMachineContext } from '../context';
import { haltTaskMonitorControlEffect } from '../effects';
import {
  appendConversationMessage,
  claimConversationMessage,
  settleConversationMessage,
  storeConversationTurn,
} from '../input';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineRuntime,
  type TaskMonitorStateStore,
} from '../machine';

const temporaryDirectories: string[] = [];

const FIRST_TASK_ID = '60000000-0000-4000-8000-000000000006';
const executionPlan = [
  {
    taskId: FIRST_TASK_ID,
    dependsOnTaskIds: [],
    method: 'quick' as const,
    provider: 'codex' as const,
    model: 'gpt-5.6',
    reasoningEffort: 'high' as const,
    agentSessionId: null,
  },
];

const startCommand = (): MonitorCommandBody => ({
  version: 1,
  kind: 'task_monitor_command',
  commandId: '10000000-0000-4000-8000-000000000001',
  createdAt: '2026-08-07T00:00:00.000Z',
  expiresAt: '2026-08-07T00:15:00.000Z',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  target: {
    workItemType: 'TASK_MONITOR',
    workItemId: '40000000-0000-4000-8000-000000000004',
  },
  command: {
    cause: 'START',
    launchConfig: {
      taskId: FIRST_TASK_ID,
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      fastMode: true,
    },
    userMessage: 'Begin selected work.',
  },
});

const controlCommand = (
  command: MonitorCommandBody['command'],
  commandId: string,
): MonitorCommandBody => ({ ...startCommand(), commandId, command });

const createHarness = async (): Promise<{
  directory: string;
  store: TaskMonitorStateStore;
  registry: TaskMonitorMachineRegistry;
  runtime: TaskMonitorMachineRuntime;
}> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-task-monitor-machine-'));
  temporaryDirectories.push(directory);
  const store: TaskMonitorStateStore = new MachineStateStore(
    path.join(directory, 'machines.json'),
    taskMonitorStateStoreCodec,
  );
  const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store);
  const registry: TaskMonitorMachineRegistry = new MachineRegistry(runtime);
  registry.register(createTaskMonitorDefinition());
  return { directory, store, registry, runtime };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('Task Monitor machine definition', () => {
  it('decodes legacy Review policy throughout persisted machine records', () => {
    const context = taskMonitorStateStoreCodec.decodeContext({
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      requestedLaunchConfig: null,
      executionPlan: [],
      cursor: 0,
      selectedTaskId: null,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'SKIP_REVIEW' },
      launch: null,
      agentSessionId: null,
      activeRunAgentSessionId: null,
      conversationId: null,
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    });
    const effect = taskMonitorStateStoreCodec.decodeEffect({
      type: 'VALIDATE_TASK_MONITOR_LAUNCH',
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      requestedLaunchConfig: {
        taskId: FIRST_TASK_ID,
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.6',
        reasoningEffort: 'high',
      },
      executionPlan: [],
      cursor: 0,
      taskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'SKIP_REVIEW' },
    });
    const outcome = taskMonitorStateStoreCodec.decodeOutcome({
      type: 'MONITOR_LOADED',
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      executionPlan: [],
      cursor: 0,
      worktree: null,
      terminalPolicy: { mode: 'SKIP_REVIEW' },
    });

    expect(context).toMatchObject({
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      reviewRequest: null,
    });
    expect(effect).toMatchObject({ terminalPolicy: { mode: 'AGENT_DECIDES' } });
    expect(outcome).toMatchObject({ terminalPolicy: { mode: 'AGENT_DECIDES' } });
  });

  it('migrates legacy PlanStep guidance to its launch Task identity in durable snapshots', async () => {
    const { directory, store } = await createHarness();
    const legacyLaunch = {
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      taskId: FIRST_TASK_ID,
      taskTitle: 'Legacy task',
      taskType: 'STANDARD',
      taskDescription: 'A task from before the guidance contract change.',
      taskAcceptanceCriteria: null,
      cursor: 0,
      method: 'plan',
      provider: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      serviceIds: [],
      worktree: undefined,
      userGuidance: null,
      planGuidance: {
        plan: { id: 'plan-1', title: 'Legacy plan', outcome: 'Legacy outcome' },
        stage: { id: 'stage-1', title: 'Legacy stage' },
        step: { id: 'step-1', title: 'Legacy step', rationale: 'Retired explanation.' },
      },
      executionOrder: [FIRST_TASK_ID],
      dependsOnTaskIds: [],
      terminalPolicy: { mode: 'AGENT_DECIDES' },
    };
    await fs.writeFile(
      path.join(directory, 'machines.json'),
      JSON.stringify({
        schemaVersion: 2,
        writerApplicationVersion: 'legacy-test',
        instances: [
          {
            identity: { machineType: 'TASK_MONITOR', instanceId: 'task-monitor-1' },
            revision: 1,
            state: 'ABSENT',
            context: {
              taskMonitorId: 'task-monitor-1',
              organizationId: 'organization-1',
              projectId: 'project-1',
              requestedLaunchConfig: null,
              executionPlan: [],
              cursor: 0,
              selectedTaskId: null,
              userGuidance: null,
              worktree: null,
              terminalPolicy: { mode: 'AGENT_DECIDES' },
              launch: legacyLaunch,
              agentSessionId: null,
              activeRunAgentSessionId: null,
              conversationId: null,
              coordinatorConversationId: null,
              pendingIntervention: null,
              settledRun: null,
              input: { queuedMessageIds: [], active: null },
              failureReason: null,
            },
            acceptedIngress: [],
            effects: [
              {
                effectId: 'effect-1',
                revision: 1,
                effect: {
                  type: 'DELIVER_TASK_MONITOR_REVIEW',
                  taskMonitorId: 'task-monitor-1',
                  organizationId: 'organization-1',
                  projectId: 'project-1',
                  runId: 'run-1',
                  agentSessionId: 'session-1',
                  requestId: 'request-1',
                  coordinatorRunId: 'coordinator-run-1',
                  rationale: 'Unrelated review rationale must remain intact.',
                },
                execution: { status: 'committed' },
              },
            ],
            payloadSchemaVersion: 1,
          },
        ],
      }),
      'utf8',
    );

    const restored = await store.findByInstanceId('task-monitor-1');

    expect(restored?.snapshot.context.launch?.planGuidance?.step).toEqual({
      id: FIRST_TASK_ID,
      title: 'Legacy step',
    });
    const promoted = JSON.parse(
      await fs.readFile(path.join(directory, 'machines.json'), 'utf8'),
    ) as {
      instances: Array<{
        payloadSchemaVersion: number;
        context: { launch: { planGuidance: { step: Record<string, unknown> } } };
      }>;
    };
    expect(promoted.instances[0]?.payloadSchemaVersion).toBe(2);
    expect(promoted.instances[0]?.context.launch.planGuidance.step).not.toHaveProperty('rationale');
    expect(restored?.effects[0]?.effect).toMatchObject({
      type: 'DELIVER_TASK_MONITOR_REVIEW',
      rationale: 'Unrelated review rationale must remain intact.',
    });
  });

  it('migrates only stored launch locations and preserves unrelated guidance-shaped content', () => {
    const migrate = taskMonitorStateStoreCodec
      .payloadCompatibility?.('TASK_MONITOR')
      ?.migrations.get(1);
    if (!migrate) throw new Error('Missing Task Monitor v1 migration');
    const guidance = { step: { id: 'legacy-step', title: 'Step', rationale: 'Legacy rationale' } };
    const launch = { taskId: FIRST_TASK_ID, planGuidance: guidance };
    const currentLaunch = {
      taskId: FIRST_TASK_ID,
      planGuidance: { step: { id: FIRST_TASK_ID, title: 'Step' } },
    };
    const payload = {
      context: { launch, metadata: { planGuidance: guidance } },
      acceptedIngress: [{ context: { launch }, effects: [{ launch }] }],
      effects: [
        {
          effect: { launch },
          execution: { status: 'settled', settlement: { outcome: { launch } } },
        },
      ],
    };
    expect(migrate(payload)).toEqual({
      context: { launch: currentLaunch, metadata: { planGuidance: guidance } },
      acceptedIngress: [
        { context: { launch: currentLaunch }, effects: [{ launch: currentLaunch }] },
      ],
      effects: [
        {
          effect: { launch: currentLaunch },
          execution: { status: 'settled', settlement: { outcome: { launch: currentLaunch } } },
        },
      ],
    });
    expect(launch.planGuidance.step).toEqual({
      id: 'legacy-step',
      title: 'Step',
      rationale: 'Legacy rationale',
    });
  });

  it('refuses legacy guidance migration without an authoritative launch Task ID', () => {
    const migrate = taskMonitorStateStoreCodec
      .payloadCompatibility?.('TASK_MONITOR')
      ?.migrations.get(1);
    if (!migrate) throw new Error('Missing Task Monitor v1 migration');
    expect(() =>
      migrate({
        context: { launch: { planGuidance: { step: { id: 'legacy-step', rationale: 'Reason' } } } },
      }),
    ).toThrow('requires its launch Task ID');
  });

  it('defaults persisted settled-Run Review binding to absent for legacy records', () => {
    const settledRun = {
      runId: 'run-1',
      agentSessionId: 'session-1',
      settledAt: '2026-08-08T12:10:00.000Z',
      outcome: 'COMPLETED',
      turnId: 'turn-1',
      promptType: 'task',
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [],
    };
    const context = taskMonitorStateStoreCodec.decodeContext({
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      requestedLaunchConfig: null,
      executionPlan: [],
      cursor: 0,
      selectedTaskId: null,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: null,
      activeRunAgentSessionId: null,
      conversationId: null,
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    });
    const effect = taskMonitorStateStoreCodec.decodeEffect({
      type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
      taskMonitorId: 'task-monitor-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      ...settledRun,
    });

    expect(context.settledRun?.reviewRequestId).toBeNull();
    expect(effect).toMatchObject({ reviewRequestId: null });
  });

  it('maps verified canonical conversation input without accepting producer prompt routing', () => {
    const taskMonitorId = startCommand().target.workItemId;
    expect(
      createTaskMonitorDefinition().admitVerifiedInput({
        source: 'CONVERSATION_MESSAGE',
        identity: { machineType: 'TASK_MONITOR', instanceId: taskMonitorId },
        ingressId: 'conversation-message:user-message-1',
        taskMonitorId,
        organizationId: startCommand().organizationId,
        projectId: startCommand().projectId,
        conversationId: 'conversation-1',
        messageId: 'user-message-1',
      }),
    ).toMatchObject({
      status: 'admitted',
      event: {
        type: 'CONVERSATION_MESSAGE_RECEIVED',
        taskMonitorId,
        messageId: 'user-message-1',
      },
    });
  });

  it('keeps canonical Message identities FIFO and duplicate-free through settlement', () => {
    const command = startCommand();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      requestedLaunchConfig: null,
      executionPlan: [],
      cursor: 0,
      selectedTaskId: null,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: 'agent-session-1',
      activeRunAgentSessionId: 'agent-session-1',
      conversationId: 'conversation-1',
      coordinatorConversationId: 'conversation-1',
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const first = {
      type: 'CONVERSATION_MESSAGE_RECEIVED',
      taskMonitorId: context.taskMonitorId,
      messageId: 'message-1',
      organizationId: command.organizationId,
      projectId: command.projectId,
      conversationId: 'conversation-1',
    } as const;
    const second = { ...first, messageId: 'message-2' };
    const claimed = { ...context, input: claimConversationMessage(context, first.messageId) };
    const queuedOnce = appendConversationMessage(claimed, second);
    const queuedTwice = appendConversationMessage({ ...claimed, input: queuedOnce }, second);
    const started = storeConversationTurn(
      { ...claimed, input: queuedTwice },
      {
        type: 'CONVERSATION_TURN_STARTED',
        taskMonitorId: context.taskMonitorId,
        messageId: 'message-1',
        runId: 'run-1',
        turnId: 'turn-1',
      },
    );
    const settled = settleConversationMessage(
      { ...claimed, input: started },
      {
        type: 'CONVERSATION_RESPONSE_PERSISTED',
        taskMonitorId: context.taskMonitorId,
        messageId: 'message-1',
        runId: 'run-1',
        turnId: 'turn-1',
        assistantMessageId: 'assistant-1',
      },
    );

    expect(queuedTwice.queuedMessageIds).toEqual(['message-2']);
    expect(started.active).toMatchObject({ runId: 'run-1', turnId: 'turn-1' });
    expect(settled).toEqual({ queuedMessageIds: ['message-2'], active: null });
  });

  it('advances the durable input region while paused work remains independently observable', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      requestedLaunchConfig: null,
      executionPlan: [],
      cursor: 0,
      selectedTaskId: null,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: 'agent-session-1',
      activeRunAgentSessionId: 'agent-session-1',
      conversationId: 'implementation-conversation-1',
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'PAUSED',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [reading, actions] = transition(definition.machine, paused, {
      type: 'CONVERSATION_MESSAGE_RECEIVED',
      taskMonitorId: context.taskMonitorId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      conversationId: 'coordinator-conversation-1',
      messageId: 'message-1',
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(reading.value).toEqual({
      RUNNING: {
        control: 'PAUSED',
        work: 'OBSERVING_RUN',
        intervention: 'CLEAR',
        input: 'READING_INPUT',
      },
    });
    expect(reading.context.coordinatorConversationId).toBe('coordinator-conversation-1');
    expect(reading.context.input.active).toMatchObject({ messageId: 'message-1' });
    expect(effects).toEqual([
      {
        type: 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE',
        taskMonitorId: context.taskMonitorId,
        organizationId: command.organizationId,
        projectId: command.projectId,
        conversationId: 'coordinator-conversation-1',
        messageId: 'message-1',
      },
    ]);
  });
  it('preserves every typed continuation owner when decoding a durable outcome', () => {
    const outcome = {
      type: 'SUPERVISION_CONTINUES_OBSERVING',
      taskMonitorId: '30000000-0000-4000-8000-000000000003',
      runId: '40000000-0000-4000-8000-000000000004',
      agentSessionId: '50000000-0000-4000-8000-000000000005',
      nextAgentSessionId: '60000000-0000-4000-8000-000000000006',
      nextConversationId: '70000000-0000-4000-8000-000000000007',
    } as const;

    expect(taskMonitorStateStoreCodec.decodeOutcome(outcome)).toEqual(outcome);
  });

  it('addresses an in-flight Run start by its recorded launch Agent Session on stop', () => {
    const command = startCommand();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      requestedLaunchConfig:
        command.command.cause === 'START' ? command.command.launchConfig : null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: '70000000-0000-4000-8000-000000000007',
      activeRunAgentSessionId: null,
      conversationId: '80000000-0000-4000-8000-000000000008',
      coordinatorConversationId: '90000000-0000-4000-8000-000000000009',
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };

    expect(
      haltTaskMonitorControlEffect(context, {
        type: 'STOP',
        taskMonitorId: command.target.workItemId,
      }),
    ).toMatchObject({
      type: 'HALT_TASK_MONITOR_CONTROL',
      activeRunAgentSessionId: context.agentSessionId,
    });
  });

  it('maps verified Start into one closed event with separate machine and ingress identities', () => {
    const command = startCommand();
    const admission = createTaskMonitorDefinition().admitVerifiedInput(command);

    expect(admission).toEqual({
      status: 'admitted',
      identity: {
        machineType: 'TASK_MONITOR',
        instanceId: command.target.workItemId,
      },
      ingressId: command.commandId,
      event: {
        type: 'START',
        commandId: command.commandId,
        taskMonitorId: command.target.workItemId,
        organizationId: command.organizationId,
        projectId: command.projectId,
        launchConfig: command.command.cause === 'START' ? command.command.launchConfig : undefined,
        userMessage: 'Begin selected work.',
      },
    });
  });

  it.each([
    { command: { cause: 'PAUSE' } as const, expected: { type: 'PAUSE' } },
    { command: { cause: 'CONTINUE' } as const, expected: { type: 'CONTINUE' } },
    { command: { cause: 'RESUME' } as const, expected: { type: 'RESUME' } },
    {
      command: { cause: 'GUIDANCE_CHANGED', guidance: 'Coordinate the next task safely.' } as const,
      expected: { type: 'GUIDANCE_CHANGED', guidance: 'Coordinate the next task safely.' },
    },
    { command: { cause: 'STOP' } as const, expected: { type: 'STOP' } },
  ])('maps $command.cause with monitor and transport identities', ({ command, expected }) => {
    const input = controlCommand(command, '17000000-0000-4000-8000-000000000007');

    expect(createTaskMonitorDefinition().admitVerifiedInput(input)).toMatchObject({
      status: 'admitted',
      identity: {
        machineType: 'TASK_MONITOR',
        instanceId: input.target.workItemId,
      },
      ingressId: input.commandId,
      event: {
        ...expected,
        taskMonitorId: input.target.workItemId,
      },
    });
  });

  it('records a failed linked Run start and admits only an explicit retry effect', () => {
    const command = startCommand();
    const launch = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      taskId: FIRST_TASK_ID,
      taskTitle: 'First task',
      taskType: 'STANDARD',
      taskDescription: 'Implement first task.',
      taskAcceptanceCriteria: null,
      cursor: 0,
      method: 'quick' as const,
      provider: 'codex' as const,
      model: 'gpt-5.6',
      reasoningEffort: 'high' as const,
      serviceIds: ['service-1'],
      userGuidance: null,
      planGuidance: null,
      executionOrder: [FIRST_TASK_ID],
      dependsOnTaskIds: [],
      terminalPolicy: { mode: 'AGENT_DECIDES' as const },
      authorityCommandId: command.commandId,
    };
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      requestedLaunchConfig:
        command.command.cause === 'START' ? command.command.launchConfig : null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch,
      agentSessionId: '70000000-0000-4000-8000-000000000007',
      activeRunAgentSessionId: null,
      conversationId: '80000000-0000-4000-8000-000000000008',
      retryableLaunch: null,
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const definition = createTaskMonitorDefinition();
    const starting = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'STARTING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [retryable] = transition(definition.machine, starting, {
      type: 'LAUNCH_OPERATION_FAILED',
      taskMonitorId: context.taskMonitorId,
      taskId: FIRST_TASK_ID,
      operation: 'RUN_START',
      reason: 'Run dispatch was rejected.',
    });
    expect(retryable.value).toMatchObject({ RUNNING: { work: 'RETRYABLE_LAUNCH' } });
    expect(retryable.context.retryableLaunch).toEqual({
      taskId: FIRST_TASK_ID,
      cursor: 0,
      agentSessionId: context.agentSessionId!,
      conversationId: context.conversationId!,
      failedOperation: 'RUN_START',
      failureReason: 'Run dispatch was rejected.',
    });

    const [admitting, actions] = transition(definition.machine, retryable, {
      type: 'CONTINUE',
      taskMonitorId: context.taskMonitorId,
    });
    expect(admitting.value).toMatchObject({ RUNNING: { work: 'ADMITTING_LAUNCH_RETRY' } });
    expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([
      {
        type: 'RECONCILE_TASK_MONITOR_LAUNCH',
        taskMonitorId: context.taskMonitorId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        taskId: FIRST_TASK_ID,
        cursor: 0,
        operation: 'RUN_START',
        agentSessionId: context.agentSessionId,
        conversationId: context.conversationId,
        retry: retryable.context.retryableLaunch,
      },
    ]);

    const reconcilingConversation = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'RECONCILING_CONVERSATION_CREATION',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: { ...context, conversationId: null },
    });
    const [persisting, persistenceActions] = transition(
      definition.machine,
      reconcilingConversation,
      {
        type: 'OPERATION_FOUND',
        taskMonitorId: context.taskMonitorId,
        taskId: FIRST_TASK_ID,
        cursor: 0,
        operation: 'CONVERSATION_CREATION',
        agentSessionId: context.agentSessionId ?? undefined,
        conversationId: context.conversationId ?? undefined,
      },
    );
    expect(persisting.value).toMatchObject({ RUNNING: { work: 'PERSISTING_LAUNCH' } });
    expect(
      persistenceActions.flatMap((action) => definition.effectFromAction(action) ?? []),
    ).toEqual([
      {
        type: 'PERSIST_TASK_MONITOR_LAUNCH',
        taskMonitorId: context.taskMonitorId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        taskId: FIRST_TASK_ID,
        cursor: 0,
        agentSessionId: context.agentSessionId,
      },
    ]);

    const reconcilingRun = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'RECONCILING_RUN_START',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [projecting, projectionActions] = transition(definition.machine, reconcilingRun, {
      type: 'OPERATION_FOUND',
      taskMonitorId: context.taskMonitorId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
      operation: 'RUN_START',
      agentSessionId: context.agentSessionId ?? undefined,
      conversationId: context.conversationId ?? undefined,
    });
    expect(projecting.value).toMatchObject({ RUNNING: { work: 'PROJECTING_STARTED' } });
    expect(projecting.context.activeRunAgentSessionId).toBe(context.agentSessionId);
    expect(
      projectionActions.flatMap((action) => definition.effectFromAction(action) ?? []),
    ).toEqual([
      {
        type: 'PROJECT_TASK_MONITOR_STARTED',
        taskMonitorId: context.taskMonitorId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        taskId: FIRST_TASK_ID,
        taskTitle: launch.taskTitle,
      },
    ]);
  });

  it('maps a generated resolved judgment into the durable machine event', () => {
    const judgment = {
      requestMessageId: 'judgment-request-1',
      label: 'Your judgment',
      conclusion: 'The completed work looks correct.',
    };
    const input = controlCommand(
      { cause: 'JUDGMENT_RESOLVED', judgment },
      '18000000-0000-4000-8000-000000000008',
    );

    expect(createTaskMonitorDefinition().admitVerifiedInput(input)).toEqual({
      status: 'admitted',
      identity: {
        machineType: 'TASK_MONITOR',
        instanceId: input.target.workItemId,
      },
      ingressId: input.commandId,
      event: {
        type: 'JUDGMENT_RESOLVED',
        taskMonitorId: input.target.workItemId,
        judgment,
      },
    });
  });

  it('turns a matching pre-Turn collision into retryable launch with ON_HOLD projection', () => {
    const command = startCommand();
    const collision = new RunWorktreeCollisionError({
      serviceId: '90000000-0000-4000-8000-000000000009',
      repositoryPath: '/repos/service-a',
      branch: 'feature/task-monitor',
      authority: 'TASK_MONITOR',
    }).failure;
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      requestedLaunchConfig:
        command.command.cause === 'START' ? command.command.launchConfig : null,
      executionPlan: [
        {
          ...executionPlan[0]!,
          agentSessionId: '70000000-0000-4000-8000-000000000007',
        },
      ],
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: '70000000-0000-4000-8000-000000000007',
      activeRunAgentSessionId: '70000000-0000-4000-8000-000000000007',
      conversationId: '80000000-0000-4000-8000-000000000008',
      retryableLaunch: null,
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const definition = createTaskMonitorDefinition();
    const starting = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'STARTING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const event = {
      type: 'LAUNCH_FAILURE_REPORTED' as const,
      taskMonitorId: context.taskMonitorId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
      agentSessionId: context.agentSessionId!,
      conversationId: context.conversationId!,
      failure: collision,
    };

    const [retryable, actions] = transition(definition.machine, starting, event);
    const effects = actions.flatMap((action) => definition.effectFromAction(action) ?? []);
    expect(retryable.value).toEqual({
      RUNNING: {
        control: 'PAUSING',
        work: 'RETRYABLE_LAUNCH',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(retryable.context).toMatchObject({
      activeRunAgentSessionId: null,
      failureReason: collision.message,
      retryableLaunch: {
        taskId: FIRST_TASK_ID,
        cursor: 0,
        agentSessionId: context.agentSessionId,
        conversationId: context.conversationId,
        failedOperation: 'RUN_START',
        failureReason: collision.message,
        failure: collision,
      },
    });
    expect(effects).toEqual(
      expect.arrayContaining([
        {
          type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
          taskMonitorId: context.taskMonitorId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          status: 'ON_HOLD',
        },
        {
          type: 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY',
          taskMonitorId: context.taskMonitorId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          taskId: FIRST_TASK_ID,
          agentSessionId: context.agentSessionId,
          conversationId: context.conversationId,
          failure: collision,
        },
      ]),
    );

    const [duplicate, duplicateActions] = transition(definition.machine, retryable, event);
    expect(duplicate.value).toEqual(retryable.value);
    expect(duplicateActions).toEqual([]);

    const resuming = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'RESUMING',
          work: 'STARTING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [retryableWhileResuming, resumingActions] = transition(
      definition.machine,
      resuming,
      event,
    );
    const resumingEffects = resumingActions.flatMap(
      (action) => definition.effectFromAction(action) ?? [],
    );
    expect(retryableWhileResuming.value).toEqual({
      RUNNING: {
        control: 'PAUSING',
        work: 'RETRYABLE_LAUNCH',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(resumingEffects).toEqual(
      expect.arrayContaining([
        {
          type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
          taskMonitorId: context.taskMonitorId,
          organizationId: context.organizationId,
          projectId: context.projectId,
          status: 'ON_HOLD',
        },
      ]),
    );
    const [staleActiveProjection] = transition(definition.machine, retryableWhileResuming, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: context.taskMonitorId,
      status: 'ACTIVE',
    });
    expect(staleActiveProjection.value).toEqual(retryableWhileResuming.value);
    const [pausedAfterCollision] = transition(definition.machine, retryableWhileResuming, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: context.taskMonitorId,
      status: 'ON_HOLD',
    });
    expect(pausedAfterCollision.value).toEqual({
      RUNNING: {
        control: 'PAUSED',
        work: 'RETRYABLE_LAUNCH',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
  });

  it('durably admits Start at revision one with coordination identities and one load effect', async () => {
    const command = startCommand();
    const { registry, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };

    const accepted = await registry.admit(identity, command.commandId, command);
    const replayed = await registry.admit(identity, command.commandId, command);

    expect(accepted).toEqual({
      status: 'accepted',
      ingressId: command.commandId,
      snapshot: {
        identity,
        revision: 1,
        state: {
          RUNNING: {
            control: 'ACTIVE',
            work: 'LOADING_MONITOR',
            intervention: 'CLEAR',
            input: 'WAITING_FOR_INPUT',
          },
        },
        context: {
          taskMonitorId: command.target.workItemId,
          organizationId: command.organizationId,
          projectId: command.projectId,
          authorityCommandId: command.commandId,
          requestedLaunchConfig:
            command.command.cause === 'START' ? command.command.launchConfig : null,
          executionPlan: [],
          cursor: null,
          selectedTaskId: null,
          userGuidance: 'Begin selected work.',
          worktree: null,
          terminalPolicy: null,
          launch: null,
          agentSessionId: null,
          activeRunAgentSessionId: null,
          conversationId: null,
          retryableLaunch: null,
          coordinatorConversationId: null,
          pendingIntervention: null,
          settledRun: null,
          reviewRequest: null,
          input: { queuedMessageIds: [], active: null },
          failureReason: null,
        },
      },
      effects: [
        {
          type: 'LOAD_TASK_MONITOR',
          taskMonitorId: command.target.workItemId,
          organizationId: command.organizationId,
          projectId: command.projectId,
          requestedLaunchConfig:
            command.command.cause === 'START' ? command.command.launchConfig : undefined,
        },
      ],
    });
    expect(replayed).toMatchObject({
      status: 'replayed',
      ingressId: command.commandId,
      snapshot: { revision: 1 },
    });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: { revision: 1 },
      acceptedIngress: new Map([[command.commandId, expect.any(Object)]]),
      effects: [{ revision: 1, effect: { type: 'LOAD_TASK_MONITOR' } }],
    });
  });

  it('stores a matching load projection and immediately declares coordination', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    await registry.admit(identity, command.commandId, command);

    const result = await runtime.admit(createTaskMonitorDefinition(), {
      status: 'admitted',
      identity,
      ingressId: 'effect-outcome:MONITOR_LOADED',
      event: {
        type: 'MONITOR_LOADED',
        taskMonitorId: command.target.workItemId,
        organizationId: command.organizationId,
        projectId: command.projectId,
        executionPlan,
        cursor: 0,
        worktree: null,
        terminalPolicy: { mode: 'AGENT_DECIDES' },
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      snapshot: {
        revision: 2,
        state: { RUNNING: { work: 'COORDINATING' } },
        context: {
          executionPlan,
          cursor: 0,
          terminalPolicy: { mode: 'AGENT_DECIDES' },
        },
      },
      effects: [
        {
          type: 'COORDINATE_TASK_MONITOR_WORK',
          taskMonitorId: command.target.workItemId,
          executionPlan,
          cursor: 0,
        },
      ],
    });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: { revision: 2, state: { RUNNING: { work: 'COORDINATING' } } },
    });
  });

  it('settles a matching load failure without declaring launch work', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    await registry.admit(identity, command.commandId, command);

    const result = await runtime.admit(createTaskMonitorDefinition(), {
      status: 'admitted',
      identity,
      ingressId: 'effect-outcome:MONITOR_LOAD_FAILED',
      event: {
        type: 'MONITOR_LOAD_FAILED',
        taskMonitorId: command.target.workItemId,
        reason: 'The monitor could not be loaded.',
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      snapshot: {
        revision: 2,
        state: { RUNNING: { work: 'MONITOR_LOAD_FAILED' } },
        context: { failureReason: 'The monitor could not be loaded.' },
      },
      effects: [],
    });
  });

  it('retains one validated launch while paused and declares session creation only after continuation', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    await registry.admit(identity, command.commandId, command);
    const admit = (
      ingressId: string,
      event: Parameters<TaskMonitorMachineRuntime['admit']>[1]['event'],
    ) =>
      runtime.admit(createTaskMonitorDefinition(), {
        status: 'admitted',
        identity,
        ingressId,
        event,
      });
    await admit('loaded', {
      type: 'MONITOR_LOADED',
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      executionPlan,
      cursor: 0,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
    });
    const pause = controlCommand({ cause: 'PAUSE' }, '11000000-0000-4000-8000-000000000001');
    await expect(registry.admit(identity, pause.commandId, pause)).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        state: {
          RUNNING: {
            control: 'PAUSING',
            work: 'COORDINATING',
            intervention: 'CLEAR',
            input: 'WAITING_FOR_INPUT',
          },
        },
      },
      effects: [
        {
          type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
          taskMonitorId: command.target.workItemId,
          organizationId: command.organizationId,
          projectId: command.projectId,
          status: 'ON_HOLD',
        },
      ],
    });
    await admit('selected', {
      type: 'WORK_SELECTED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
    });
    const launch = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      taskId: FIRST_TASK_ID,
      taskTitle: 'First task',
      taskType: 'STANDARD',
      taskDescription: 'Implement first task.',
      taskAcceptanceCriteria: null,
      cursor: 0,
      method: 'quick' as const,
      provider: 'codex' as const,
      model: 'gpt-5.6',
      reasoningEffort: 'high' as const,
      serviceIds: ['service-1'],
      userGuidance: 'Begin selected work.',
      planGuidance: null,
      executionOrder: [FIRST_TASK_ID],
      dependsOnTaskIds: [],
      terminalPolicy: { mode: 'AGENT_DECIDES' as const },
    };

    const validated = await admit('validated', {
      type: 'LAUNCH_VALIDATED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
      launch,
    });
    expect(validated).toMatchObject({
      status: 'accepted',
      snapshot: {
        state: { RUNNING: { control: 'PAUSING', work: 'LAUNCH_READY' } },
        context: { launch },
      },
      effects: [],
    });

    const guidance = controlCommand(
      { cause: 'GUIDANCE_CHANGED', guidance: 'Use the revised future coordination.' },
      '12000000-0000-4000-8000-000000000002',
    );
    await expect(registry.admit(identity, guidance.commandId, guidance)).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        state: {
          RUNNING: {
            control: 'PAUSING',
            work: 'LAUNCH_READY',
            intervention: 'CLEAR',
            input: 'WAITING_FOR_INPUT',
          },
        },
        context: {
          userGuidance: 'Use the revised future coordination.',
          launch,
        },
      },
      effects: [],
    });

    await admit('paused-status-projected', {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: command.target.workItemId,
      status: 'ON_HOLD',
    });
    const continued = await admit('continued', {
      type: 'CONTINUE',
      taskMonitorId: command.target.workItemId,
    });
    expect(continued).toMatchObject({
      status: 'accepted',
      snapshot: {
        state: { RUNNING: { control: 'RESUMING', work: 'LAUNCH_READY' } },
      },
      effects: [
        {
          type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
          taskMonitorId: command.target.workItemId,
          organizationId: command.organizationId,
          projectId: command.projectId,
          status: 'ACTIVE',
        },
      ],
    });

    const statusProjected = await admit('active-status-projected', {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: command.target.workItemId,
      status: 'ACTIVE',
    });
    expect(statusProjected).toMatchObject({
      status: 'accepted',
      snapshot: {
        state: { RUNNING: { control: 'ACTIVE', work: 'CREATING_AGENT_SESSION' } },
      },
      effects: [{ type: 'CREATE_TASK_MONITOR_AGENT_SESSION', launch }],
    });

    const sessionCreated = await admit('session-created', {
      type: 'AGENT_SESSION_CREATED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      agentSessionId: '60000000-0000-4000-8000-000000000006',
    });
    expect(sessionCreated).toMatchObject({
      snapshot: {
        state: { RUNNING: { work: 'CREATING_CONVERSATION' } },
        context: { agentSessionId: '60000000-0000-4000-8000-000000000006' },
      },
      effects: [
        {
          type: 'CREATE_TASK_MONITOR_CONVERSATION',
          agentSessionId: '60000000-0000-4000-8000-000000000006',
          launch,
        },
      ],
    });

    const conversationCreated = await admit('conversation-created', {
      type: 'CONVERSATION_CREATED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      agentSessionId: '60000000-0000-4000-8000-000000000006',
      conversationId: '70000000-0000-4000-8000-000000000007',
    });
    expect(conversationCreated).toMatchObject({
      snapshot: { state: { RUNNING: { work: 'PERSISTING_LAUNCH' } } },
      effects: [
        {
          type: 'PERSIST_TASK_MONITOR_LAUNCH',
          taskMonitorId: command.target.workItemId,
          taskId: FIRST_TASK_ID,
          cursor: 0,
          agentSessionId: '60000000-0000-4000-8000-000000000006',
        },
      ],
    });

    const launchPersisted = await admit('launch-persisted', {
      type: 'TASK_MONITOR_LAUNCH_PERSISTED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      agentSessionId: '60000000-0000-4000-8000-000000000006',
    });
    expect(launchPersisted).toMatchObject({
      snapshot: { state: { RUNNING: { work: 'STARTING_RUN' } } },
      effects: [
        {
          type: 'START_TASK_MONITOR_RUN',
          agentSessionId: '60000000-0000-4000-8000-000000000006',
          conversationId: '70000000-0000-4000-8000-000000000007',
          launch,
        },
      ],
    });

    const runStarted = await admit('run-started', {
      type: 'RUN_STARTED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      agentSessionId: '60000000-0000-4000-8000-000000000006',
      conversationId: '70000000-0000-4000-8000-000000000007',
    });
    expect(runStarted).toMatchObject({
      snapshot: {
        state: { RUNNING: { work: 'PROJECTING_STARTED' } },
        context: {
          activeRunAgentSessionId: '60000000-0000-4000-8000-000000000006',
        },
      },
      effects: [
        {
          type: 'PROJECT_TASK_MONITOR_STARTED',
          taskMonitorId: command.target.workItemId,
          taskId: FIRST_TASK_ID,
          taskTitle: launch.taskTitle,
        },
      ],
    });

    const projected = await admit('started-projected', {
      type: 'TASK_STARTED_PROJECTED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
    });
    expect(projected).toMatchObject({
      snapshot: { state: { RUNNING: { work: 'OBSERVING_RUN' } } },
      effects: [],
    });

    const observationPause = controlCommand(
      { cause: 'PAUSE' },
      '14000000-0000-4000-8000-000000000004',
    );
    await expect(
      registry.admit(identity, observationPause.commandId, observationPause),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        state: {
          RUNNING: {
            control: 'PAUSING',
            work: 'OBSERVING_RUN',
            intervention: 'CLEAR',
            input: 'WAITING_FOR_INPUT',
          },
        },
        context: {
          activeRunAgentSessionId: '60000000-0000-4000-8000-000000000006',
        },
      },
      effects: [
        {
          type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
          taskMonitorId: command.target.workItemId,
          organizationId: command.organizationId,
          projectId: command.projectId,
          status: 'ON_HOLD',
        },
      ],
    });

    const stop = controlCommand({ cause: 'STOP' }, '15000000-0000-4000-8000-000000000005');
    const stopped = await registry.admit(identity, stop.commandId, stop);
    const replayedStop = await registry.admit(identity, stop.commandId, stop);
    if (stopped.status !== 'accepted') throw new Error('Expected STOP to be accepted.');
    expect(stopped).toMatchObject({
      status: 'accepted',
      snapshot: { state: 'HALTED' },
      effects: [
        {
          type: 'HALT_TASK_MONITOR_CONTROL',
          taskMonitorId: command.target.workItemId,
          activeRunAgentSessionId: '60000000-0000-4000-8000-000000000006',
        },
      ],
    });
    expect(replayedStop).toMatchObject({
      status: 'replayed',
      snapshot: { revision: stopped.snapshot.revision },
    });

    const terminalPause = controlCommand(
      { cause: 'PAUSE' },
      '16000000-0000-4000-8000-000000000006',
    );
    await expect(
      registry.admit(identity, terminalPause.commandId, terminalPause),
    ).resolves.toMatchObject({ status: 'rejected', code: 'transition_rejected' });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: { revision: stopped.snapshot.revision },
    });

    await expect(
      admit('effect-outcome:stop-succeeded', {
        type: 'TASK_MONITOR_STOP_SUCCEEDED',
        taskMonitorId: command.target.workItemId,
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: { state: 'HALTED', revision: stopped.snapshot.revision + 1 },
      effects: [],
    });
  });

  it('keeps PAUSING retryable, idempotent, and reversible before projection settles', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    const admit = (
      ingressId: string,
      event: Parameters<TaskMonitorMachineRuntime['admit']>[1]['event'],
    ) =>
      runtime.admit(createTaskMonitorDefinition(), {
        status: 'admitted',
        identity,
        ingressId,
        event,
      });

    await registry.admit(identity, command.commandId, command);
    await admit('loaded', {
      type: 'MONITOR_LOADED',
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      executionPlan,
      cursor: 0,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
    });

    const pause = controlCommand({ cause: 'PAUSE' }, '19000000-0000-4000-8000-000000000009');
    await expect(registry.admit(identity, pause.commandId, pause)).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        state: { RUNNING: { control: 'PAUSING', work: 'COORDINATING' } },
      },
      effects: [{ type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS', status: 'ON_HOLD' }],
    });
    await expect(registry.admit(identity, pause.commandId, pause)).resolves.toMatchObject({
      status: 'replayed',
      snapshot: { state: { RUNNING: { control: 'PAUSING' } } },
    });

    const projectionFailures = [
      {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED' as const,
        reason: 'canonical owner rejected the projection',
      },
      {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED' as const,
        reason: 'projection request cancelled',
      },
      {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN' as const,
        reason: 'projection response was lost',
      },
    ];
    for (const [index, failure] of projectionFailures.entries()) {
      await expect(
        admit(`projection-failure-${index}`, {
          ...failure,
          taskMonitorId: command.target.workItemId,
          status: 'ON_HOLD',
        }),
      ).resolves.toMatchObject({
        status: 'accepted',
        snapshot: {
          state: { RUNNING: { control: 'PAUSING', work: 'COORDINATING' } },
          context: { failureReason: failure.reason },
        },
      });
    }

    const retryPause = controlCommand({ cause: 'PAUSE' }, '1a000000-0000-4000-8000-00000000000a');
    await expect(registry.admit(identity, retryPause.commandId, retryPause)).resolves.toMatchObject(
      {
        status: 'accepted',
        snapshot: { state: { RUNNING: { control: 'PAUSING' } } },
        effects: [{ type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS', status: 'ON_HOLD' }],
      },
    );

    const resume = controlCommand({ cause: 'RESUME' }, '1b000000-0000-4000-8000-00000000000b');
    await expect(registry.admit(identity, resume.commandId, resume)).resolves.toMatchObject({
      status: 'accepted',
      snapshot: { state: { RUNNING: { control: 'RESUMING', work: 'COORDINATING' } } },
      effects: [{ type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS', status: 'ACTIVE' }],
    });

    const stored = await store.findByInstanceId(command.target.workItemId);
    expect(
      stored?.effects.filter(({ effect }) => effect.type === 'PROJECT_TASK_MONITOR_CONTROL_STATUS'),
    ).toHaveLength(3);
  });

  it('settles only a matching ON_HOLD projection and restores PAUSED across restart', async () => {
    const command = startCommand();
    const { directory, registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    const admit = (
      ingressId: string,
      event: Parameters<TaskMonitorMachineRuntime['admit']>[1]['event'],
    ) =>
      runtime.admit(createTaskMonitorDefinition(), {
        status: 'admitted',
        identity,
        ingressId,
        event,
      });

    await registry.admit(identity, command.commandId, command);
    await admit('loaded', {
      type: 'MONITOR_LOADED',
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      executionPlan,
      cursor: 0,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
    });
    const pause = controlCommand({ cause: 'PAUSE' }, '1c000000-0000-4000-8000-00000000000c');
    await registry.admit(identity, pause.commandId, pause);

    const committedPause = (await store.findByInstanceId(command.target.workItemId))?.effects.find(
      ({ effect, status }) =>
        status === 'committed' && effect.type === 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
    );
    if (!committedPause || committedPause.status !== 'committed') {
      throw new Error('Expected a committed Task Monitor pause projection.');
    }
    await store.claimEffect(command.target.workItemId, committedPause.effectId);
    await store.settleEffect(committedPause.effectId, {
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
        taskMonitorId: command.target.workItemId,
        status: 'ON_HOLD',
      },
    });

    await expect(
      admit('wrong-projection-status', {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
        taskMonitorId: command.target.workItemId,
        status: 'ACTIVE',
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: { state: { RUNNING: { control: 'PAUSING' } } },
    });
    await expect(
      admit('on-hold-projection', {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
        taskMonitorId: command.target.workItemId,
        status: 'ON_HOLD',
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: { state: { RUNNING: { control: 'PAUSED' } } },
    });

    const restartedStore: TaskMonitorStateStore = new MachineStateStore(
      path.join(directory, 'machines.json'),
      taskMonitorStateStoreCodec,
    );
    const restartedRuntime: TaskMonitorMachineRuntime = new MachineRuntime(restartedStore);
    const restartedRegistry: TaskMonitorMachineRegistry = new MachineRegistry(restartedRuntime);
    restartedRegistry.register(createTaskMonitorDefinition());
    const restored = await restartedStore.findByInstanceId(command.target.workItemId);
    expect(restored).toMatchObject({
      snapshot: { state: { RUNNING: { control: 'PAUSED' } } },
    });
    const restoredPauseProjection = restored?.effects.find(
      ({ effect }) => effect.type === 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
    );
    expect(restoredPauseProjection).toMatchObject({
      status: 'settled',
      effect: { type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS', status: 'ON_HOLD' },
      settlement: {
        status: 'succeeded',
        outcome: {
          type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
          status: 'ON_HOLD',
        },
      },
    });
    await expect(restartedRegistry.admit(identity, pause.commandId, pause)).resolves.toMatchObject({
      status: 'replayed',
      snapshot: { state: { RUNNING: { control: 'PAUSING' } } },
    });

    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: { state: { RUNNING: { control: 'PAUSED' } } },
    });
  });

  it('routes uncertainty to the named operation reconciliation and rejects stale outcomes', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    await registry.admit(identity, command.commandId, command);
    const admit = (
      ingressId: string,
      event: Parameters<TaskMonitorMachineRuntime['admit']>[1]['event'],
    ) =>
      runtime.admit(createTaskMonitorDefinition(), {
        status: 'admitted',
        identity,
        ingressId,
        event,
      });
    await admit('loaded', {
      type: 'MONITOR_LOADED',
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      executionPlan,
      cursor: 0,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
    });
    await admit('selected', {
      type: 'WORK_SELECTED',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
    });

    const uncertain = await admit('uncertain', {
      type: 'LAUNCH_VALIDATION_UNCERTAIN',
      taskMonitorId: command.target.workItemId,
      taskId: FIRST_TASK_ID,
      cursor: 0,
      operation: 'MONITOR_PROJECTION',
      reason: 'connection reset',
    });
    expect(uncertain).toMatchObject({
      status: 'accepted',
      snapshot: { state: { RUNNING: { work: 'RECONCILING_MONITOR_PROJECTION' } } },
      effects: [
        {
          type: 'RECONCILE_TASK_MONITOR_LAUNCH',
          operation: 'MONITOR_PROJECTION',
          taskId: FIRST_TASK_ID,
        },
      ],
    });

    await expect(
      admit('stale-reconciliation', {
        type: 'OPERATION_FOUND',
        taskMonitorId: command.target.workItemId,
        taskId: '70000000-0000-4000-8000-000000000007',
        cursor: 0,
        operation: 'MONITOR_PROJECTION',
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'transition_rejected' });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: {
        revision: 4,
        state: { RUNNING: { work: 'RECONCILING_MONITOR_PROJECTION' } },
      },
    });
  });

  it('uses the XState guard to reject an outcome addressed to another instance', async () => {
    const command = startCommand();
    const { registry, runtime, store } = await createHarness();
    const identity = {
      machineType: command.target.workItemType,
      instanceId: command.target.workItemId,
    };
    await registry.admit(identity, command.commandId, command);

    await expect(
      runtime.admit(createTaskMonitorDefinition(), {
        status: 'admitted',
        identity,
        ingressId: 'effect-outcome:wrong-instance',
        event: {
          type: 'MONITOR_LOADED',
          taskMonitorId: '50000000-0000-4000-8000-000000000005',
          organizationId: command.organizationId,
          projectId: command.projectId,
          executionPlan,
          cursor: 0,
          worktree: null,
          terminalPolicy: { mode: 'AGENT_DECIDES' },
        },
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'transition_rejected' });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toMatchObject({
      snapshot: { revision: 1, state: { RUNNING: { work: 'LOADING_MONITOR' } } },
    });
  });

  it('rejects unknown machine types and mismatched addressed instances without persistence', async () => {
    const command = startCommand();
    const { registry, store } = await createHarness();

    await expect(
      registry.admit(
        { machineType: 'UNKNOWN_MACHINE', instanceId: command.target.workItemId },
        command.commandId,
        command,
      ),
    ).resolves.toMatchObject({ status: 'rejected', code: 'unknown_machine_type' });
    await expect(
      registry.admit(
        { machineType: 'TASK_MONITOR', instanceId: '50000000-0000-4000-8000-000000000005' },
        command.commandId,
        command,
      ),
    ).resolves.toMatchObject({ status: 'rejected', code: 'identity_mismatch' });
    await expect(store.findByInstanceId(command.target.workItemId)).resolves.toBeNull();
    await expect(
      store.findByInstanceId('50000000-0000-4000-8000-000000000005'),
    ).resolves.toBeNull();
  });

  it('schedules Resume reconciliation after the ACTIVE projection without requiring stale Run evidence', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
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
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'RESUMING',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [resumed, actions] = transition(definition.machine, paused, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: context.taskMonitorId,
      status: 'ACTIVE',
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(resumed.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'COORDINATING',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toEqual([
      expect.objectContaining({
        type: 'COORDINATE_TASK_MONITOR_WORK',
        cause: 'RESUME',
        correlationId: context.coordinationCorrelationId,
        cursor: 0,
        coordination: expect.objectContaining({ work: 'COORDINATING' }),
      }),
    ]);
  });

  it('does not schedule Resume reconciliation for a non-ACTIVE projection', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
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
    const resuming = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'RESUMING',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [next, actions] = transition(definition.machine, resuming, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: context.taskMonitorId,
      status: 'ON_HOLD',
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(next.value).toEqual({
      RUNNING: {
        control: 'PAUSED',
        work: 'OBSERVING_RUN',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toEqual([]);
  });

  it('ignores coordination outcomes from a different selected Agent Session', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: '90000000-0000-4000-8000-000000000009',
      activeRunAgentSessionId: '90000000-0000-4000-8000-000000000009',
      conversationId: 'a0000000-0000-4000-8000-00000000000a',
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const coordinating = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'COORDINATING',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [next] = transition(definition.machine, coordinating, {
      type: 'COORDINATION_CONTINUES',
      taskMonitorId: context.taskMonitorId,
      runId: 'b0000000-0000-4000-8000-00000000000b',
      agentSessionId: 'c0000000-0000-4000-8000-00000000000c',
    });

    expect(next.value).toEqual(coordinating.value);
  });

  it('commits and delivers a coordinated Review without settled Run evidence', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const activeRunAgentSessionId = '90000000-0000-4000-8000-000000000009';
    const committedRunId = 'b0000000-0000-4000-8000-00000000000b';
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: activeRunAgentSessionId,
      activeRunAgentSessionId,
      conversationId: 'a0000000-0000-4000-8000-00000000000a',
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const coordinating = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'COORDINATING',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const committed = {
      type: 'REVIEW_REQUEST_COMMITTED' as const,
      taskMonitorId: context.taskMonitorId,
      runId: committedRunId,
      agentSessionId: activeRunAgentSessionId,
      requestId: 'c0000000-0000-4000-8000-00000000000c',
      coordinatorRunId: 'd0000000-0000-4000-8000-00000000000d',
      rationale: 'Fresh canonical evidence requires Review.',
    };
    const [next, actions] = transition(definition.machine, coordinating, committed);
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'REQUESTING_REVIEW',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(next.context.reviewRequest).toMatchObject({
      requestId: committed.requestId,
      coordinatorRunId: committed.coordinatorRunId,
      agentSessionId: activeRunAgentSessionId,
    });
    expect(effects).toEqual([
      {
        type: 'DELIVER_TASK_MONITOR_REVIEW',
        taskMonitorId: context.taskMonitorId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        runId: committedRunId,
        agentSessionId: activeRunAgentSessionId,
        requestId: committed.requestId,
        coordinatorRunId: committed.coordinatorRunId,
        rationale: committed.rationale,
      },
    ]);
  });

  it('clears a consumed Resume admission before ordinary Continue', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: '90000000-0000-4000-8000-000000000009',
      activeRunAgentSessionId: '90000000-0000-4000-8000-000000000009',
      conversationId: 'a0000000-0000-4000-8000-00000000000a',
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: null,
    };
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'PAUSED',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [resuming] = transition(definition.machine, paused, {
      type: 'CONTINUE',
      taskMonitorId: context.taskMonitorId,
    });
    const [active, actions] = transition(definition.machine, resuming, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: context.taskMonitorId,
      status: 'ACTIVE',
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(active.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'OBSERVING_RUN',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(active.context.coordinationCause).toBeNull();
    expect(active.context.coordinationCorrelationId).toBeNull();
    expect(effects).toEqual([]);
  });

  it('re-enters coordination when an interrupted active Resume is judged', () => {
    const command = startCommand();
    const definition = createTaskMonitorDefinition();
    const context: TaskMonitorMachineContext = {
      taskMonitorId: command.target.workItemId,
      organizationId: command.organizationId,
      projectId: command.projectId,
      authorityCommandId: command.commandId,
      coordinationCause: 'RESUME',
      coordinationCorrelationId: '80000000-0000-4000-8000-000000000008',
      requestedLaunchConfig: null,
      executionPlan,
      cursor: 0,
      selectedTaskId: FIRST_TASK_ID,
      userGuidance: null,
      worktree: null,
      terminalPolicy: { mode: 'AGENT_DECIDES' },
      launch: null,
      agentSessionId: '90000000-0000-4000-8000-000000000009',
      activeRunAgentSessionId: '90000000-0000-4000-8000-000000000009',
      conversationId: 'a0000000-0000-4000-8000-00000000000a',
      coordinatorConversationId: null,
      pendingIntervention: null,
      settledRun: null,
      reviewRequest: null,
      input: { queuedMessageIds: [], active: null },
      failureReason: 'The previous Resume delivery was interrupted.',
    };
    const judgment = {
      requestMessageId: 'b0000000-0000-4000-8000-00000000000b',
      label: 'Resume judgment',
      conclusion: 'Reconcile the current run again.',
    };
    const judgmentState = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'OUTCOME_JUDGMENT',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context,
    });
    const [next, actions] = transition(definition.machine, judgmentState, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: context.taskMonitorId,
      judgment,
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect ? [effect] : [];
    });

    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'COORDINATING',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toEqual([
      expect.objectContaining({
        type: 'COORDINATE_TASK_MONITOR_WORK',
        cause: 'JUDGMENT_RESOLVED',
        correlationId: judgment.requestMessageId,
        cursor: 0,
        judgment,
      }),
    ]);
  });
});
