import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transition } from 'xstate';
import { createNoopMessagePoster } from './__tests__/helpers/test-run-registry';
import { TaskMonitorInterventionProjectionEffectHandler } from '../agents/task-monitor/state-machine/intervention-effect-handlers';
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
      outstandingPermissions: [],
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

  describe('a request that waits on the user', () => {
    const INTERVENTION_ID = '90000000-0000-4000-8000-000000000009';
    const RUN_ID = '50000000-0000-4000-8000-000000000005';
    const exactAction = {
      type: 'EXACT_ACTION_REQUIRED' as const,
      taskMonitorId: MONITOR_ID,
      interventionId: INTERVENTION_ID,
      providerActionId: 'provider-action-1',
      providerSessionId: 'provider-session-1',
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      action: 'exec',
      target: 'pnpm deploy',
      fingerprint: 'sha256:exact-action',
      createdAt: '2026-08-07T00:00:00.000Z',
      expiresAt: null,
    };
    const ESCALATION_REASON = 'The monitor could not tell whether deploying is part of this Task.';

    const observing = () =>
      resolve({ control: 'ACTIVE', work: 'OBSERVING_RUN', intervention: 'CLEAR' });

    /** What a restarted CLI holds: the persisted snapshot decoded through the real store codec. */
    const reconstructed = (state: ResolvedState) => {
      const persisted = JSON.parse(JSON.stringify({ value: state.value, context: state.context }));
      return {
        state: taskMonitorStateStoreCodec.decodeState(persisted.value),
        context: taskMonitorStateStoreCodec.decodeContext(persisted.context),
      };
    };

    const projectReconstructed = (state: ResolvedState) =>
      taskMonitorStateProjection({
        identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
        revision: 2,
        ...reconstructed(state),
      });

    it('is not a pending judgment while the monitor is still deciding it', () => {
      const [deciding] = transition(definition.machine, observing(), exactAction);

      expect(project(deciding).execution.intervention).toBe('PENDING');
      expect(project(deciding).pendingJudgment).toBeUndefined();
      expect(projectReconstructed(deciding).pendingJudgment).toBeUndefined();
    });

    it('publishes the human handoff with its reason and how to answer, once the monitor escalates', async () => {
      const [deciding] = transition(definition.machine, observing(), exactAction);
      const [escalated, actions] = transition(definition.machine, deciding, {
        type: 'MONITOR_PERMISSION_ESCALATED',
        taskMonitorId: MONITOR_ID,
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
        reason: ESCALATION_REASON,
      });
      const expected = {
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        action: 'exec',
        target: 'pnpm deploy',
        fingerprint: 'sha256:exact-action',
        reason: ESCALATION_REASON,
        answer: { command: 'HUMAN_DECISION', choices: ['APPROVE', 'DENY'] },
      };

      expect(project(deciding).outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, answerable: false },
      ]);
      expect(project(escalated).outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, answerable: true },
      ]);
      expect(project(escalated).execution.intervention).toBe('PENDING');
      expect(project(escalated).pendingJudgment).toEqual(expected);
      expect(project(escalated).failure).toBeUndefined();
      const effect = actions
        .flatMap((action) => definition.effectFromAction(action) ?? [])
        .find((item) => item.type === 'PROJECT_TASK_MONITOR_INTERVENTION');
      if (!effect) {
        throw new Error('Expected the handoff to post the intervention');
      }
      const poster = createNoopMessagePoster();
      vi.mocked(poster.createOutOfBand).mockRejectedValue(new Error('Conversation unavailable'));
      const handler = new TaskMonitorInterventionProjectionEffectHandler(poster, NOOP_LOGGER);
      const failed = await handler.execute(effect, {
        machineType: 'TASK_MONITOR',
        instanceId: MONITOR_ID,
        effectId: 'post-card',
      });
      expect(failed.outcome.type).toBe('INTERVENTION_PROJECTION_FAILED');
      const [postFailed] = transition(definition.machine, escalated, failed.outcome);
      expect(projectReconstructed(postFailed).pendingJudgment).toEqual(expected);
      expect(projectReconstructed(postFailed).outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, owner: 'HUMAN', answerable: true },
      ]);
    });

    it('publishes a queued handoff as answerable while the monitor decides the front request', () => {
      const [front] = transition(definition.machine, observing(), exactAction);
      const second = {
        ...exactAction,
        interventionId: '90000000-0000-4000-8000-000000000007',
        providerActionId: 'provider-action-2',
      };
      const [queued] = transition(definition.machine, front, second);
      const [handedOver] = transition(definition.machine, queued, {
        type: 'MONITOR_PERMISSION_ESCALATED',
        taskMonitorId: MONITOR_ID,
        interventionId: second.interventionId,
        providerActionId: second.providerActionId,
        reason: ESCALATION_REASON,
      });
      expect(projectReconstructed(handedOver).outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, owner: 'MONITOR', answerable: false },
        { interventionId: second.interventionId, owner: 'HUMAN', answerable: true },
      ]);
    });

    it('publishes both protected requests as immediately answerable after reconstruction', () => {
      const [first] = transition(definition.machine, observing(), {
        ...exactAction,
        userRequired: true,
      });
      const second = {
        ...exactAction,
        interventionId: '90000000-0000-4000-8000-000000000007',
        providerActionId: 'provider-action-2',
        userRequired: true,
      };
      const [both] = transition(definition.machine, first, second);
      expect(projectReconstructed(both).outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, owner: 'HUMAN', answerable: true },
        {
          interventionId: second.interventionId,
          owner: 'HUMAN',
          answerable: true,
          reason: expect.stringContaining('USER_REQUIRED'),
        },
      ]);
    });

    it('keeps the human handoff answerable when a stopped monitor is restored', () => {
      const [deciding] = transition(definition.machine, observing(), exactAction);
      const [stopped] = transition(definition.machine, deciding, {
        type: 'STOP',
        taskMonitorId: MONITOR_ID,
      });
      const snapshot = projectReconstructed(stopped);
      expect(snapshot.pendingJudgment).toMatchObject({ interventionId: INTERVENTION_ID });
      expect(snapshot.outstandingPermissions).toMatchObject([
        { interventionId: INTERVENTION_ID, answerable: true },
      ]);
    });

    it('publishes a USER_REQUIRED request as the user’s from the start', () => {
      const [handedOver] = transition(definition.machine, observing(), {
        ...exactAction,
        userRequired: true,
      });

      expect(projectReconstructed(handedOver).pendingJudgment).toMatchObject({
        interventionId: INTERVENTION_ID,
        reason: expect.stringContaining('USER_REQUIRED'),
      });
    });

    it('treats a request persisted before the monitor decided requests as the user’s', () => {
      const legacy = resolve(
        { control: 'ACTIVE', work: 'OBSERVING_RUN', intervention: 'PENDING' },
        {
          pendingIntervention: {
            interventionId: INTERVENTION_ID,
            providerActionId: 'provider-action-1',
            providerSessionId: 'provider-session-1',
            runId: RUN_ID,
            agentSessionId: SESSION_ID,
            action: 'exec',
            target: 'pnpm deploy',
            fingerprint: 'sha256:exact-action',
            createdAt: '2026-08-07T00:00:00.000Z',
            expiresAt: null,
            decision: null,
            applicationFailure: null,
          },
        },
      );

      expect(projectReconstructed(legacy).pendingJudgment).toMatchObject({
        interventionId: INTERVENTION_ID,
        answer: { command: 'HUMAN_DECISION' },
      });
    });

    it('stops publishing the judgment once the request is answered', () => {
      const [pending] = transition(definition.machine, observing(), {
        ...exactAction,
        userRequired: true,
      });
      const [answered] = transition(definition.machine, pending, {
        type: 'HUMAN_DECISION',
        taskMonitorId: MONITOR_ID,
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        fingerprint: 'sha256:exact-action',
        resolution: 'APPROVE',
        providerDecision: 'approve',
        decidedAt: '2026-08-07T00:01:00.000Z',
        human: {
          userId: '90000000-0000-4000-8000-0000000000aa',
          authenticatedAt: '2026-08-07T00:00:30.000Z',
        },
      });

      expect(project(answered).pendingJudgment).toBeUndefined();
      expect(project(answered).outstandingPermissions).toEqual([]);
    });
  });

  it('publishes a pending coordinator judgment as its own outcome, not a failure', () => {
    const waiting = resolve(
      { control: 'ACTIVE', work: 'OUTCOME_JUDGMENT', intervention: 'CLEAR' },
      {
        pendingJudgment: {
          request: 'Ask the user to approve the schema change.',
          requestMessageId: 'question-1',
        },
      },
    );
    const projection = project(waiting);

    expect(projection.failure).toBeUndefined();
    expect(projection.pendingJudgment).toEqual({
      request: 'Ask the user to approve the schema change.',
      guidance: expect.stringContaining('Reply'),
    });
  });

  it('publishes a failed supervision operation as a failure with no pending judgment', () => {
    const failed = resolve(
      { control: 'ACTIVE', work: 'SUPERVISION_FAILED', intervention: 'CLEAR' },
      { failureReason: 'Task Monitor coordinator Run could not be started.' },
    );
    const projection = project(failed);

    expect(projection.pendingJudgment).toBeUndefined();
    expect(projection.failure).toMatchObject({
      code: 'OPERATION_FAILED',
      cause: 'Task Monitor coordinator Run could not be started.',
    });
  });

  describe('coordinator recovery request after exhausted corrections', () => {
    type Recovery = NonNullable<TaskMonitorMachineContext['coordinatorRecovery']>;
    const recovery: Recovery = {
      evaluation: undefined as never,
      correctionAttempt: 2,
      pendingCorrection: false,
      failure: { code: 'INVALID_JSON', message: 'Bad JSON', issues: [] },
      requestId: 'attempt-2',
      requestMessageId: null,
      conversationId: null,
      deliveryFailure: null,
    };
    const waiting = (coordinatorRecovery: Recovery) =>
      project(
        resolve(
          { control: 'ACTIVE', work: 'OUTCOME_JUDGMENT', intervention: 'CLEAR' },
          { failureReason: 'Bad JSON', coordinatorRecovery },
        ),
      );

    it('publishes the posted request next to the underlying validation failure', () => {
      const projection = waiting({
        ...recovery,
        requestMessageId: 'canonical-request',
        conversationId: 'conversation-1',
      });

      expect(projection.failure).toMatchObject({
        cause: expect.stringContaining('INVALID_JSON: Bad JSON'),
        correctiveGuidance: expect.stringContaining('Please provide guidance'),
      });
      expect(projection.pendingJudgment).toEqual({
        request: expect.stringContaining('INVALID_JSON: Bad JSON'),
        guidance: expect.stringContaining('Reply'),
      });
    });

    it('does not direct the user to a request whose delivery failed', () => {
      const projection = waiting({ ...recovery, deliveryFailure: 'Conversation unavailable.' });

      expect(projection.pendingJudgment).toBeUndefined();
      expect(projection.failure).toMatchObject({
        cause: expect.stringContaining('Conversation unavailable.'),
        correctiveGuidance: expect.stringContaining('nothing to answer'),
      });
    });

    it('does not direct the user to a request that is still being posted', () => {
      const projection = waiting(recovery);

      expect(projection.pendingJudgment).toBeUndefined();
      expect(projection.failure?.correctiveGuidance).toContain('nothing to answer');
    });
  });

  it('never advertises lifecycle actions once ended', () => {
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
      outstandingPermissions: [],
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

const startPublication = async (
  platform: ScriptedPlatform,
  logger: ServerLogger = NOOP_LOGGER,
  seed: (storeFile: string) => Promise<void> = async () => undefined,
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-task-monitor-publication-'));
  temporaryDirectories.push(directory);
  await seed(path.join(directory, 'machines.json'));
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
        kindKey: 'task',
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

describe('upgrading a monitor already waiting on the platform', () => {
  const REASON = 'Approve adding the place columns?';
  const OLD_REVISION = 2;
  const waitingState = {
    RUNNING: {
      control: 'ACTIVE',
      work: 'OUTCOME_JUDGMENT',
      intervention: 'CLEAR',
      input: 'WAITING_FOR_INPUT',
    },
  };

  /** The store the previous CLI left: a posted question parked as a failure. */
  const seedLegacyWaitingMonitor = async (storeFile: string) => {
    const legacyContext = JSON.parse(
      JSON.stringify({ ...context, failureReason: REASON, coordinatorRecovery: null }),
    ) as object;
    await fs.writeFile(
      storeFile,
      JSON.stringify({
        schemaVersion: 2,
        writerApplicationVersion: 'legacy-test',
        instances: [
          {
            identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
            revision: OLD_REVISION,
            state: waitingState,
            context: legacyContext,
            acceptedIngress: [
              {
                ingressId: 'effect-outcome:effect-1',
                revision: OLD_REVISION,
                state: waitingState,
                context: legacyContext,
                effects: [],
              },
            ],
            effects: [
              {
                effectId: 'effect-1',
                revision: 1,
                effect: {
                  type: 'DELIVER_TASK_MONITOR_REVIEW',
                  taskMonitorId: MONITOR_ID,
                  organizationId: context.organizationId,
                  projectId: context.projectId,
                  runId: 'run-1',
                  agentSessionId: SESSION_ID,
                  requestId: 'request-1',
                  coordinatorRunId: 'coordinator-run-1',
                  rationale: 'Review is warranted.',
                },
                execution: {
                  status: 'settled',
                  settlement: {
                    status: 'succeeded',
                    outcome: {
                      type: 'OUTCOME_JUDGMENT_REQUIRED',
                      taskMonitorId: MONITOR_ID,
                      runId: 'run-1',
                      agentSessionId: SESSION_ID,
                      reason: REASON,
                    },
                  },
                },
              },
            ],
            payloadSchemaVersion: 2,
          },
        ],
      }),
      'utf8',
    );
  };

  /** The platform's rule: a newer source revision replaces the state, the same one only proves freshness. */
  const platformHoldingOldFailure = () => {
    const platform = new ScriptedPlatform();
    const held = {
      sourceRevision: OLD_REVISION,
      projection: {
        failure: { code: 'OPERATION_FAILED', cause: REASON },
      } as WorkItemExecutionStateObservation['state']['projection'] | undefined,
    };
    platform.answers.push(
      ...Array.from({ length: 4 }, () => (observation: WorkItemExecutionStateObservation) => {
        if (observation.sourceRevision <= held.sourceRevision) {
          return {
            kind: 'RECEIPT' as const,
            receipt: {
              workItemId: observation.workItemId,
              sourceRevision: observation.sourceRevision,
              outcome: 'DUPLICATE' as const,
            },
          };
        }
        held.sourceRevision = observation.sourceRevision;
        held.projection = observation.state.projection;
        return accepted(observation);
      }),
    );
    return { platform, held };
  };

  it('replaces the stored failure card on reconnect without any user action', async () => {
    const { platform, held } = platformHoldingOldFailure();
    const { publication } = await startPublication(platform, NOOP_LOGGER, seedLegacyWaitingMonitor);

    await publication.replay();

    expect(platform.sent.map(({ sourceRevision }) => sourceRevision)).toEqual([OLD_REVISION + 1]);
    expect(held.sourceRevision).toBe(OLD_REVISION + 1);
    expect(held.projection).toMatchObject({ pendingJudgment: { request: REASON } });
    expect(held.projection).not.toHaveProperty('failure');
  });

  it('still treats a repeat of the same committed revision as a duplicate', async () => {
    const { platform, held } = platformHoldingOldFailure();
    const { publication } = await startPublication(platform, NOOP_LOGGER, seedLegacyWaitingMonitor);

    await publication.replay();
    await publication.replay();

    expect(platform.sent.map(({ sourceRevision }) => sourceRevision)).toEqual([
      OLD_REVISION + 1,
      OLD_REVISION + 1,
    ]);
    expect(held.sourceRevision).toBe(OLD_REVISION + 1);
  });
});
