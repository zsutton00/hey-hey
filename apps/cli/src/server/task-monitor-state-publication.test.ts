import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transition } from 'xstate';
import type {
  WorkItemExecutionStateObservation,
  WorkItemExecutionStateObservationReceipt,
} from '@hey-hey/contracts/api/models';
import {
  TaskMonitorStatePublication,
  taskMonitorStateProjection,
} from './task-monitor-state-publication';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import type { PlatformWebSocketManager, WorkItemExecutionStateReport } from './platform-ws';
import type { KeyPairStore } from '../credentials';
import { MachineRegistry, MachineRuntime, MachineStateStore } from '../state-machine';
import type {
  MonitorCommandBody1 as MonitorCommandBody,
  TaskMonitorLaunchConfig,
} from '@hey-hey/contracts/agent-bridge';
import { RunWorktreeCollisionError } from '../agents/run-scope';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRuntime,
  type TaskMonitorMachineState,
  type TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';

const MONITOR_ID = '40000000-0000-4000-8000-000000000004';
const TASK_ID = '60000000-0000-4000-8000-000000000006';
const SESSION_ID = '70000000-0000-4000-8000-000000000007';
const CONVERSATION_ID = '80000000-0000-4000-8000-000000000008';
const MACHINE_ID = '20000000-0000-4000-8000-0000000000aa';
const launchConfig = {
  taskId: TASK_ID,
  method: 'quick',
  provider: 'codex',
  model: 'gpt-5.6',
  reasoningEffort: 'high',
  fastMode: true,
} satisfies TaskMonitorLaunchConfig;

/** A populated monitor two selected tasks into a run, on its first task. */
const context: TaskMonitorMachineContext = {
  taskMonitorId: MONITOR_ID,
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  authorityCommandId: '10000000-0000-4000-8000-000000000001',
  requestedLaunchConfig: {
    taskId: TASK_ID,
    method: 'quick',
    provider: 'codex',
    model: 'gpt-5.6',
    reasoningEffort: 'high',
  },
  executionPlan: [
    {
      taskId: TASK_ID,
      dependsOnTaskIds: [],
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      agentSessionId: SESSION_ID,
    },
    {
      taskId: '60000000-0000-4000-8000-000000000016',
      dependsOnTaskIds: [TASK_ID],
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      agentSessionId: null,
    },
  ],
  cursor: 0,
  selectedTaskId: TASK_ID,
  userGuidance: 'Keep the public API stable.',
  worktree: null,
  terminalPolicy: { mode: 'AGENT_DECIDES' },
  // The validated launch of the first selected task, as STARTING_RUN holds it.
  launch: {
    taskMonitorId: MONITOR_ID,
    organizationId: '20000000-0000-4000-8000-000000000002',
    projectId: '30000000-0000-4000-8000-000000000003',
    taskId: TASK_ID,
    taskTitle: 'Publish monitor state',
    taskType: 'STANDARD',
    taskDescription: 'Deliver committed state to browsers.',
    taskAcceptanceCriteria: '- Browsers receive committed state.',
    cursor: 0,
    method: 'quick',
    provider: 'codex',
    model: 'gpt-5.6',
    reasoningEffort: 'high',
    serviceIds: ['90000000-0000-4000-8000-000000000009'],
    userGuidance: 'Keep the public API stable.',
    planGuidance: null,
    executionOrder: [TASK_ID, '60000000-0000-4000-8000-000000000016'],
    dependsOnTaskIds: [],
    terminalPolicy: { mode: 'AGENT_DECIDES' },
  },
  agentSessionId: SESSION_ID,
  activeRunAgentSessionId: SESSION_ID,
  conversationId: CONVERSATION_ID,
  retryableLaunch: null,
  coordinatorConversationId: null,
  pendingIntervention: null,
  settledRun: null,
  reviewRequest: null,
  input: { queuedMessageIds: [], active: null },
  failureReason: null,
};

const definition = createTaskMonitorDefinition();

const startCommand: MonitorCommandBody = {
  version: 1,
  kind: 'task_monitor_command',
  commandId: '10000000-0000-4000-8000-000000000001',
  createdAt: '2026-08-07T00:00:00.000Z',
  expiresAt: '2026-08-07T00:15:00.000Z',
  organizationId: context.organizationId!,
  projectId: context.projectId!,
  target: { workItemType: 'TASK_MONITOR', workItemId: MONITOR_ID },
  command: {
    cause: 'START',
    launchConfig,
    userMessage: 'Begin selected work.',
  },
};
type ResolvedState = ReturnType<typeof definition.machine.resolveState>;

const resolve = (
  running: Omit<Extract<TaskMonitorMachineState, { RUNNING: unknown }>['RUNNING'], 'input'>,
  overrides: Partial<TaskMonitorMachineContext> = {},
): ResolvedState =>
  definition.machine.resolveState({
    value: { RUNNING: { ...running, input: 'WAITING_FOR_INPUT' } },
    context: { ...context, ...overrides },
  });

const project = (state: ResolvedState, revision = 1) =>
  taskMonitorStateProjection({
    identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
    revision,
    state: state.value as TaskMonitorMachineState,
    context: state.context as TaskMonitorMachineContext,
  });

const commandEvent = (command: 'START' | 'RESUME' | 'PAUSE' | 'STOP') =>
  command === 'START'
    ? {
        type: 'START' as const,
        commandId: '10000000-0000-4000-8000-000000000002',
        taskMonitorId: MONITOR_ID,
        organizationId: context.organizationId!,
        projectId: context.projectId!,
        launchConfig,
      }
    : { type: command, taskMonitorId: MONITOR_ID };

/** Whether the committed machine would act on this lifecycle command. */
const admits = (state: ResolvedState, command: 'START' | 'RESUME' | 'PAUSE' | 'STOP') => {
  const [next] = transition(definition.machine, state, commandEvent(command));
  return JSON.stringify(next.value) !== JSON.stringify(state.value);
};

const collision = new RunWorktreeCollisionError({
  serviceId: '90000000-0000-4000-8000-000000000009',
  repositoryPath: '/repos/service-a',
  branch: 'feature/task-monitor',
  authority: 'TASK_MONITOR',
}).failure;

describe('committed Task Monitor state projection', () => {
  it('keeps a launch collision’s own cause and correction, and advertises the retry the machine admits', () => {
    const starting = resolve({ control: 'ACTIVE', work: 'STARTING_RUN', intervention: 'CLEAR' });
    const [failed] = transition(definition.machine, starting, {
      type: 'LAUNCH_FAILURE_REPORTED',
      taskMonitorId: MONITOR_ID,
      taskId: TASK_ID,
      cursor: 0,
      agentSessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      failure: collision,
    });

    const projection = project(failed);
    expect(projection).toEqual({
      execution: {
        lifecycle: 'RUNNING',
        control: 'PAUSING',
        work: 'RETRYABLE_LAUNCH',
        intervention: 'CLEAR',
      },
      failure: {
        code: 'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY',
        cause: collision.message,
        correctiveGuidance: collision.correctiveAction,
      },
      availableActions: [
        { kind: 'STOP', command: 'STOP' },
        { kind: 'RETRYABLE_RECOVERY', command: 'START' },
      ],
    });
    for (const { command } of projection.availableActions) {
      expect(admits(failed, command)).toBe(true);
    }

    // The corrected retry is admitted and the failure resolves on that commit.
    const [admitting] = transition(definition.machine, failed, commandEvent('START'));
    const [retrying] = transition(definition.machine, admitting, {
      type: 'LAUNCH_RETRY_ADMITTED',
      taskMonitorId: MONITOR_ID,
      taskId: TASK_ID,
      cursor: 0,
      agentSessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(project(retrying)).toMatchObject({
      execution: { work: 'STARTING_RUN' },
      availableActions: expect.arrayContaining([{ kind: 'STOP', command: 'STOP' }]),
    });
    expect(project(retrying).failure).toBeUndefined();
  });

  it('gives an unclassified retryable launch guidance that names the admitted retry', () => {
    const failed = resolve(
      { control: 'ACTIVE', work: 'RETRYABLE_LAUNCH', intervention: 'CLEAR' },
      {
        failureReason: 'Run start timed out.',
        retryableLaunch: {
          taskId: TASK_ID,
          cursor: 0,
          agentSessionId: SESSION_ID,
          conversationId: CONVERSATION_ID,
          failedOperation: 'RUN_START',
          failureReason: 'Run start timed out.',
        },
      },
    );

    const projection = project(failed);
    expect(projection.failure).toEqual({
      code: 'OPERATION_FAILED',
      cause: 'Run start timed out.',
      correctiveGuidance: expect.stringContaining('Start the monitor to retry'),
    });
    expect(projection.availableActions).toEqual([
      { kind: 'STOP', command: 'STOP' },
      { kind: 'PAUSE', command: 'PAUSE' },
      { kind: 'RETRYABLE_RECOVERY', command: 'START' },
    ]);
    for (const { command } of projection.availableActions) {
      expect(admits(failed, command)).toBe(true);
    }
  });

  it('advertises exactly the control commands each region admits, across pause and resume', () => {
    const cases = [
      resolve({ control: 'ACTIVE', work: 'OBSERVING_RUN', intervention: 'CLEAR' }),
      resolve({ control: 'PAUSED', work: 'AWAITING_REVIEW', intervention: 'CLEAR' }),
      resolve({ control: 'RESUMING', work: 'OBSERVING_RUN', intervention: 'PENDING' }),
    ];

    for (const state of cases) {
      const advertised = project(state).availableActions.map(({ command }) => command);
      for (const command of advertised) {
        expect(admits(state, command)).toBe(true);
      }
      // A pause is never advertised where it would be ignored.
      expect(advertised.includes('PAUSE')).toBe(admits(state, 'PAUSE'));
    }
    expect(project(cases[1]!).availableActions).toEqual([
      { kind: 'STOP', command: 'STOP' },
      { kind: 'PAUSED_CONTINUATION', command: 'RESUME' },
    ]);
    // The intervention region is carried independently of control and work.
    expect(project(cases[2]!).execution).toMatchObject({
      control: 'RESUMING',
      intervention: 'PENDING',
    });
  });

  it('keeps a coordinator failure visible and never advertises lifecycle actions once ended', () => {
    const judgment = resolve(
      { control: 'ACTIVE', work: 'OUTCOME_JUDGMENT', intervention: 'CLEAR' },
      {
        failureReason: 'Bad JSON',
        coordinatorRecovery: {
          correctionAttempt: 2,
          failure: { code: 'INVALID_JSON', message: 'Bad JSON', issues: [] },
          deliveryFailure: 'Conversation unavailable.',
        } as never,
      },
    );
    expect(project(judgment).failure).toMatchObject({
      cause: expect.stringContaining('Conversation unavailable.'),
      correctiveGuidance: expect.stringContaining('Please provide guidance'),
    });

    const halted = taskMonitorStateProjection({
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      revision: 9,
      state: 'HALTED',
      context: { ...context, failureReason: 'Stopped after repeated launch failures.' },
    });
    expect(halted.availableActions).toEqual([]);
    expect(halted.failure).toEqual({
      code: 'OPERATION_FAILED',
      cause: 'Stopped after repeated launch failures.',
      correctiveGuidance: expect.not.stringContaining('stop the monitor'),
    });
    // Kind-neutral completion: no Task-specific lifecycle is inferred.
    expect(
      taskMonitorStateProjection({
        identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
        revision: 10,
        state: 'COMPLETED',
        context: { ...context, executionPlan: [], selectedTaskId: null, cursor: null },
      }),
    ).toEqual({
      execution: { lifecycle: 'COMPLETED', control: null, work: null, intervention: null },
      availableActions: [],
    });
  });
});

/** The platform socket seam with scripted receipts. */
class ScriptedPlatform {
  readonly sent: WorkItemExecutionStateObservation[] = [];
  readonly answers: Array<
    | WorkItemExecutionStateReport
    | ((observation: WorkItemExecutionStateObservation) => WorkItemExecutionStateReport)
  > = [];
  private reconnect: (() => void) | undefined;

  readonly socket = {
    reportWorkItemExecutionStateObservation: vi.fn(
      async (observation: WorkItemExecutionStateObservation) => {
        this.sent.push(observation);
        const answer = this.answers.shift() ?? accepted(observation);
        return typeof answer === 'function' ? answer(observation) : answer;
      },
    ),
    onReconnect: vi.fn((callback: () => void) => {
      this.reconnect = callback;
      return () => undefined;
    }),
  };

  reconnected(): void {
    this.reconnect?.();
  }
}

const accepted = (
  observation: WorkItemExecutionStateObservation,
): WorkItemExecutionStateReport => ({
  kind: 'RECEIPT',
  receipt: {
    workItemId: observation.workItemId,
    sourceRevision: observation.sourceRevision,
    outcome: 'ACCEPTED',
    revision: observation.sourceRevision,
  } satisfies WorkItemExecutionStateObservationReceipt,
});

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

const startPublication = async (platform: ScriptedPlatform, logger: ServerLogger = NOOP_LOGGER) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-task-monitor-publication-'));
  temporaryDirectories.push(directory);
  const store: TaskMonitorStateStore = new MachineStateStore(
    path.join(directory, 'machines.json'),
    taskMonitorStateStoreCodec,
  );
  const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store);
  const publication = new TaskMonitorStatePublication(
    runtime,
    store,
    platform.socket as unknown as PlatformWebSocketManager,
    { loadCurrentMachineId: vi.fn(async () => MACHINE_ID) } as unknown as KeyPairStore,
    logger,
  );

  return { store, runtime, publication };
};

const snapshotAt = (state: ResolvedState, revision: number, instanceId = MONITOR_ID) => ({
  identity: { machineType: 'TASK_MONITOR', instanceId },
  revision,
  state: state.value as TaskMonitorMachineState,
  context: { ...(state.context as TaskMonitorMachineContext), taskMonitorId: instanceId },
});

describe('Task Monitor state publication through the shared seam', () => {
  const running = resolve({ control: 'ACTIVE', work: 'OBSERVING_RUN', intervention: 'CLEAR' });
  const paused = resolve({ control: 'PAUSED', work: 'AWAITING_REVIEW', intervention: 'CLEAR' });

  it('addresses the canonical monitor, owning machine and committed revision, with the complete projection', async () => {
    const platform = new ScriptedPlatform();
    const { publication } = await startPublication(platform);

    await publication.publish(snapshotAt(running, 4));

    expect(platform.sent).toEqual([
      {
        workItemId: MONITOR_ID,
        machineId: MACHINE_ID,
        sourceRevision: 4,
        state: { type: 'TASK_MONITOR', projection: project(running) },
      },
    ]);
    publication.dispose();
  });

  it('resends a report the platform could not decide on, and sends a newer commit instead of a superseded one', async () => {
    vi.useFakeTimers();
    const platform = new ScriptedPlatform();
    platform.answers.push(
      { kind: 'NO_RECEIPT', reason: 'operation has timed out' },
      (observation) => ({
        kind: 'RECEIPT',
        receipt: {
          workItemId: observation.workItemId,
          sourceRevision: observation.sourceRevision,
          outcome: 'RECEIVE_FAILED',
        },
      }),
    );
    const { publication } = await startPublication(platform);

    const delivered = publication.publish(snapshotAt(running, 4));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(platform.sent.map(({ sourceRevision }) => sourceRevision)).toEqual([4, 4]);

    // While backing off, the monitor commits again: the newer state goes now.
    void publication.publish(snapshotAt(paused, 5));
    await vi.advanceTimersByTimeAsync(0);
    await delivered;
    expect(platform.sent.map(({ sourceRevision }) => sourceRevision)).toEqual([4, 4, 5]);
    expect(platform.sent.at(-1)?.state.projection).toEqual(project(paused));
    publication.dispose();
  });

  it('stops on a permanent rejection with its specific cause, without delaying other monitors', async () => {
    const platform = new ScriptedPlatform();
    const errors: Array<[string, Record<string, unknown> | undefined]> = [];
    const logger = Object.assign(Object.create(NOOP_LOGGER) as ServerLogger, {
      error: (message: string, fields?: Record<string, unknown>) => {
        errors.push([message, fields]);
      },
    });
    platform.answers.push((observation) => ({
      kind: 'RECEIPT',
      receipt: {
        workItemId: observation.workItemId,
        sourceRevision: observation.sourceRevision,
        outcome: 'REJECTED',
        code: 'OWNER_CONFLICT',
      },
    }));
    const { publication } = await startPublication(platform, logger);
    const other = '40000000-0000-4000-8000-000000000044';

    await Promise.all([
      publication.publish(snapshotAt(running, 4)),
      publication.publish(snapshotAt(paused, 2, other)),
    ]);

    expect(platform.sent.map(({ workItemId }) => workItemId)).toEqual([MONITOR_ID, other]);
    expect(errors).toEqual([
      [
        'task_monitor.state.publication.rejected',
        { taskMonitorId: MONITOR_ID, sourceRevision: 4, code: 'OWNER_CONFLICT' },
      ],
    ]);
    publication.dispose();
  });

  it('publishes every committed transition from the runtime and replays durable state after reconnect', async () => {
    const platform = new ScriptedPlatform();
    const { publication, runtime, store } = await startPublication(platform);
    const registry = new MachineRegistry(runtime);
    registry.register(definition);
    const identity = { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID };

    // Start, load and stop commit three revisions; none needs a Run, Agent
    // Session or conversation for the publisher to report it.
    await registry.admit(identity, startCommand.commandId, startCommand);
    await runtime.admit(definition, {
      status: 'admitted',
      identity,
      ingressId: 'effect-outcome:MONITOR_LOADED',
      event: {
        type: 'MONITOR_LOADED',
        taskMonitorId: MONITOR_ID,
        organizationId: context.organizationId!,
        projectId: context.projectId!,
        executionPlan: context.executionPlan,
        cursor: 0,
        worktree: null,
        terminalPolicy: { mode: 'AGENT_DECIDES' },
      },
    });
    platform.answers.push({ kind: 'SKIPPED' });
    await runtime.admit(definition, {
      status: 'admitted',
      identity,
      ingressId: 'stop-1',
      event: { type: 'STOP', taskMonitorId: MONITOR_ID },
    });
    await vi.waitFor(() => expect(platform.sent).toHaveLength(3));
    expect(
      platform.sent.map(({ sourceRevision, state }) => [
        sourceRevision,
        state.projection.execution.lifecycle,
        state.projection.execution.work,
      ]),
    ).toEqual([
      [1, 'RUNNING', 'LOADING_MONITOR'],
      [2, 'RUNNING', 'COORDINATING'],
      [3, 'HALTED', null],
    ]);

    // The halted report was skipped while disconnected; reconnect replays the
    // durable snapshot unchanged, revision included.
    platform.reconnected();
    await vi.waitFor(() => expect(platform.sent).toHaveLength(4));
    const stored = await store.findByInstanceId(MONITOR_ID);
    expect(platform.sent[3]).toEqual(platform.sent[2]);
    expect(platform.sent[3]?.sourceRevision).toBe(stored?.snapshot.revision);
    publication.dispose();
  });
});
