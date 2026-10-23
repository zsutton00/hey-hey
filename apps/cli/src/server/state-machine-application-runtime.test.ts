import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';
import { z } from 'zod/v4';

import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type {
  TaskMonitorMachineEffect,
  TaskMonitorMachineEffectOutcome,
  TaskMonitorMachineEvent,
  VerifiedTaskMonitorCommand,
  VerifiedTaskMonitorInput,
} from '../agents/task-monitor/state-machine/events';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineLogic,
  type TaskMonitorMachineState,
} from '../agents/task-monitor/state-machine/machine';
import {
  AddressedMachineAdmission,
  defineMachine,
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
  type EffectHandler,
  type EffectSettlement,
  type MachineDefinition,
  type MachineIdentity,
  type MachineStateStoreCodec,
} from '../state-machine';
import { NOOP_LOGGER } from './logger';
import { LocalAgentInfrastructure } from './local-agent-infrastructure';
import { MonitorApplicationRuntime } from './monitor-application-runtime';
import { MonitorEventSourceRuntime } from './monitor-event-source-runtime';
import { PlatformApplicationRuntime } from './platform-application-runtime';
import { RunApplicationRuntime } from './run-application-runtime';
import { hostMachine, StateMachineApplicationRuntime } from './state-machine-application-runtime';
import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';
import { TaskMonitorStartRuntime } from './task-monitor-start';
import type { TaskMonitorStartMonitor } from './task-monitor-start';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const temporaryDirectories: string[] = [];

const emptyLoadedMonitor = (monitorId: string): TaskMonitorStartMonitor => ({
  id: monitorId,
  name: 'Empty monitor',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  status: 'ACTIVE',
  definition: {
    executionPlan: [],
    launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' as const } },
    cursor: 0,
  },
});

type FixtureState = 'idle' | 'dispatched' | 'acknowledged' | 'failed';

type FixtureEvent =
  | { readonly type: 'DISPATCH'; readonly requestId: string }
  | { readonly type: 'ACKNOWLEDGED' }
  | { readonly type: 'FAIL'; readonly reason: string };

interface FixtureContext {
  readonly requestId: string | null;
}

interface FixtureEffect {
  readonly type: 'SEND_REQUEST';
  readonly requestId: string;
}

type FixtureOutcome =
  | { readonly type: 'REQUEST_ACKNOWLEDGED' }
  | { readonly type: 'REQUEST_FAILED'; readonly reason: string };

interface FixtureInput {
  readonly ingressId: string;
  readonly instanceId: string;
  readonly event: FixtureEvent;
}

const fixtureMachine = setup({
  types: {
    context: {} as FixtureContext,
    events: {} as FixtureEvent,
    input: {} as MachineIdentity<'hosted-fixture'>,
  },
  actions: {
    declareEffect: (arguments_, params: FixtureEffect) => {
      void arguments_;
      void params;
    },
  },
}).createMachine({
  context: { requestId: null },
  initial: 'idle',
  states: {
    idle: {
      on: {
        DISPATCH: {
          target: 'dispatched',
          actions: [
            assign({ requestId: ({ event }) => event.requestId }),
            {
              type: 'declareEffect',
              params: ({ event }) => ({ type: 'SEND_REQUEST', requestId: event.requestId }),
            },
          ],
        },
      },
    },
    dispatched: {
      on: {
        ACKNOWLEDGED: { target: 'acknowledged' },
        FAIL: { target: 'failed' },
      },
    },
    acknowledged: {},
    failed: {},
  },
});

const fixtureDefinition: MachineDefinition<
  'hosted-fixture',
  FixtureState,
  FixtureEvent,
  FixtureContext,
  typeof fixtureMachine,
  FixtureEffect,
  FixtureOutcome,
  FixtureInput
> = defineMachine({
  payloadCompatibility: { currentSchemaVersion: 1, migrations: new Map() },
  machineType: 'hosted-fixture',
  machine: fixtureMachine,
  createInitialInput: (identity) => identity,
  readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
  toXStateEvent: (event) => event,
  admitVerifiedInput: (input) => ({
    status: 'admitted',
    identity: { machineType: 'hosted-fixture', instanceId: input.instanceId },
    ingressId: input.ingressId,
    event: input.event,
  }),
  effectFromAction: (action) => (action.type === 'declareEffect' ? action.params : null),
  outcomeToEvent: ({ outcome }) =>
    outcome.type === 'REQUEST_ACKNOWLEDGED'
      ? { type: 'ACKNOWLEDGED' }
      : { type: 'FAIL', reason: outcome.reason },
});

const fixtureCodec: MachineStateStoreCodec<
  'hosted-fixture',
  FixtureState,
  FixtureContext,
  FixtureEffect,
  FixtureOutcome
> = {
  decodeMachineType: (value) => z.literal('hosted-fixture').parse(value),
  decodeState: (value) => z.enum(['idle', 'dispatched', 'acknowledged', 'failed']).parse(value),
  decodeContext: (value) => z.object({ requestId: z.string().nullable() }).parse(value),
  decodeEffect: (value) =>
    z.object({ type: z.literal('SEND_REQUEST'), requestId: z.string() }).parse(value),
  decodeOutcome: (value) =>
    z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('REQUEST_ACKNOWLEDGED') }),
        z.object({ type: z.literal('REQUEST_FAILED'), reason: z.string() }),
      ])
      .parse(value),
};

const createTaskMonitorStack = (directory: string) => {
  const store = new MachineStateStore(
    path.join(directory, 'snapshots.json'),
    taskMonitorStateStoreCodec,
  );
  const machineRuntime = new MachineRuntime<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineEvent,
    TaskMonitorMachineContext,
    TaskMonitorMachineLogic,
    TaskMonitorMachineEffect,
    TaskMonitorMachineEffectOutcome,
    VerifiedTaskMonitorInput
  >(store);
  const registry = new MachineRegistry(machineRuntime);
  registry.register(createTaskMonitorDefinition());
  const effectRunner = new EffectRunner(store, machineRuntime, registry, {});
  const recovery = new MachineRecovery(store, registry, effectRunner);
  return { effectRunner, recovery, store };
};

const createFixtureStack = (
  directory: string,
  execute: EffectHandler<FixtureEffect, FixtureOutcome>['execute'],
) => {
  const store = new MachineStateStore(path.join(directory, 'fixture-snapshots.json'), fixtureCodec);
  const machineRuntime = new MachineRuntime<
    'hosted-fixture',
    FixtureState,
    FixtureEvent,
    FixtureContext,
    typeof fixtureMachine,
    FixtureEffect,
    FixtureOutcome,
    FixtureInput
  >(store);
  const registry = new MachineRegistry(machineRuntime);
  registry.register(fixtureDefinition);
  const effectRunner = new EffectRunner(store, machineRuntime, registry, {
    SEND_REQUEST: { execute, recovery: { strategy: 'retry' } },
  });
  const recovery = new MachineRecovery(store, registry, effectRunner);
  const admission = new AddressedMachineAdmission(registry);
  const dispatch = (instanceId: string) =>
    admission.admit({
      identity: { machineType: 'hosted-fixture', instanceId },
      ingressId: `dispatch-${instanceId}`,
      verifiedInput: {
        instanceId,
        ingressId: `dispatch-${instanceId}`,
        event: { type: 'DISPATCH', requestId: `request-${instanceId}` },
      },
    });
  return { dispatch, effectRunner, recovery, store };
};

const acknowledged = (): Promise<EffectSettlement<FixtureOutcome>> =>
  Promise.resolve({ status: 'succeeded', outcome: { type: 'REQUEST_ACKNOWLEDGED' } });

const createOwners = async (
  options: {
    directory?: string;
    execute?: EffectHandler<FixtureEffect, FixtureOutcome>['execute'];
    fixtureOptional?: boolean;
  } = {},
) => {
  let directory = options.directory;
  if (!directory) {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-state-machine-app-'));
    temporaryDirectories.push(directory);
  }
  const execute = vi.fn(options.execute ?? acknowledged);
  const taskMonitor = createTaskMonitorStack(directory);
  const fixture = createFixtureStack(directory, execute);
  const application = new StateMachineApplicationRuntime(
    [
      hostMachine('task-monitor', taskMonitor.recovery, taskMonitor.effectRunner),
      {
        ...hostMachine('hosted-fixture', fixture.recovery, fixture.effectRunner),
        optional: options.fixtureOptional ?? false,
      },
    ],
    NOOP_LOGGER,
  );
  return { application, directory, execute, fixture, taskMonitor };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

useTestCapabilityCatalog();

describe('StateMachineApplicationRuntime', () => {
  it('restores production monitor loads through settlement and admits stored outcomes without repeating them', async () => {
    const owners = createTestLocalAgentServerRuntimeOwners();
    temporaryDirectories.push(owners.dataDir);
    const readMonitor = vi
      .spyOn(TaskMonitorStartRuntime.prototype, 'readMonitor')
      .mockImplementation(({ monitorId }) => Promise.resolve(emptyLoadedMonitor(monitorId)));
    const command = (commandId: string, monitorId: string): VerifiedTaskMonitorCommand => ({
      version: 1,
      kind: 'task_monitor_command',
      commandId,
      createdAt: '2026-08-07T00:00:00.000Z',
      expiresAt: '2026-08-07T00:15:00.000Z',
      organizationId: '20000000-0000-4000-8000-000000000002',
      projectId: '30000000-0000-4000-8000-000000000003',
      target: { workItemType: 'TASK_MONITOR', workItemId: monitorId },
      command: {
        cause: 'START',
        launchConfig: {
          taskId: '70000000-0000-4000-8000-000000000007',
          method: 'quick',
          provider: 'codex',
          model: 'gpt-5.6',
          reasoningEffort: 'high',
        },
      },
    });
    const committedMonitorId = '40000000-0000-4000-8000-000000000004';
    const settledMonitorId = '50000000-0000-4000-8000-000000000005';
    await owners.taskMonitorStateMachineInputAdapter.admit(
      command('10000000-0000-4000-8000-000000000001', committedMonitorId),
    );
    await owners.taskMonitorStateMachineInputAdapter.admit(
      command('10000000-0000-4000-8000-000000000006', settledMonitorId),
    );
    const storedSettled = await owners.machineStore.findByInstanceId(settledMonitorId);
    const settledEffectId = storedSettled?.effects[0]?.effectId;
    if (!settledEffectId) throw new Error('Expected a persisted monitor-load effect.');
    await owners.machineStore.claimEffect(settledMonitorId, settledEffectId);
    await owners.machineStore.settleEffect(settledEffectId, {
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_LOADED',
        taskMonitorId: settledMonitorId,
        organizationId: '20000000-0000-4000-8000-000000000002',
        projectId: '30000000-0000-4000-8000-000000000003',
        executionPlan: [],
        cursor: 0,
        worktree: null,
        terminalPolicy: { mode: 'AGENT_DECIDES' },
      },
    });

    await owners.stateMachineRuntime.start();

    expect(readMonitor).toHaveBeenCalledOnce();
    expect(readMonitor).toHaveBeenCalledWith({
      monitorId: committedMonitorId,
      organizationId: '20000000-0000-4000-8000-000000000002',
      projectId: '30000000-0000-4000-8000-000000000003',
    });
    for (const monitorId of [committedMonitorId, settledMonitorId]) {
      const restored = await owners.machineStore.findByInstanceId(monitorId);
      expect(restored).toMatchObject({
        snapshot: {
          revision: 3,
          state: 'COMPLETED',
        },
        effects: [{ status: 'settled' }, { status: 'settled' }],
      });
      expect(
        [...(restored?.acceptedIngress.keys() ?? [])].filter((ingressId) =>
          ingressId.startsWith('effect-outcome:'),
        ),
      ).toHaveLength(2);
    }

    await owners.stateMachineRuntime.start();
    expect(readMonitor).toHaveBeenCalledOnce();

    const liveMonitorId = '60000000-0000-4000-8000-000000000006';
    await owners.taskMonitorStateMachineInputAdapter.admit(
      command('10000000-0000-4000-8000-000000000007', liveMonitorId),
    );
    await vi.waitFor(async () => {
      await expect(owners.machineStore.findByInstanceId(liveMonitorId)).resolves.toMatchObject({
        snapshot: {
          revision: 3,
          state: 'COMPLETED',
        },
        effects: [{ status: 'settled' }, { status: 'settled' }],
      });
    });
    expect(readMonitor).toHaveBeenCalledTimes(2);
    await owners.applicationLifecycle.dispose();
  });

  it('awaits restoration and performs repeated starts only once', async () => {
    const owners = await createOwners();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restore = vi
      .spyOn(owners.taskMonitor.recovery, 'restore')
      .mockImplementation(async () => {
        await gate;
        return { snapshots: [] };
      });

    const first = owners.application.start();
    const second = owners.application.start();
    expect(restore).toHaveBeenCalledOnce();
    let started = false;
    void first.then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(restore).toHaveBeenCalledOnce();
  });

  it('propagates restoration failure so command delivery cannot start', async () => {
    const owners = await createOwners();
    vi.spyOn(owners.taskMonitor.recovery, 'restore').mockRejectedValue(
      new Error('invalid durable snapshot'),
    );

    await expect(owners.application.start()).rejects.toThrow('invalid durable snapshot');
  });

  it('restores and runs each machine’s committed effects from its own store', async () => {
    const first = await createOwners();
    await first.fixture.dispatch('fixture-1');
    await expect(first.fixture.store.findByInstanceId('fixture-1')).resolves.toMatchObject({
      snapshot: { revision: 1, state: 'dispatched' },
      effects: [{ status: 'committed' }],
    });
    first.application.dispose();

    const restarted = await createOwners({ directory: first.directory });
    const taskMonitorRestore = vi.spyOn(restarted.taskMonitor.recovery, 'restore');
    const fixtureRestore = vi.spyOn(restarted.fixture.recovery, 'restore');

    await restarted.application.start();

    expect(restarted.execute).toHaveBeenCalledOnce();
    await expect(restarted.fixture.store.findByInstanceId('fixture-1')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'acknowledged' },
      effects: [{ status: 'settled' }],
    });
    await expect(taskMonitorRestore.mock.results[0]?.value).resolves.toEqual({ snapshots: [] });
    await expect(fixtureRestore.mock.results[0]?.value).resolves.toMatchObject({
      snapshots: [{ identity: { machineType: 'hosted-fixture', instanceId: 'fixture-1' } }],
    });

    await restarted.fixture.dispatch('fixture-2');
    await vi.waitFor(async () => {
      await expect(restarted.fixture.store.findByInstanceId('fixture-2')).resolves.toMatchObject({
        snapshot: { state: 'acknowledged' },
        effects: [{ status: 'settled' }],
      });
    });
    restarted.application.dispose();
  });

  it('keeps started machines live when another machine fails and retries only the failed one', async () => {
    const owners = await createOwners();
    const taskMonitorRestore = vi.spyOn(owners.taskMonitor.recovery, 'restore');
    const taskMonitorLive = vi.spyOn(owners.taskMonitor.effectRunner, 'startLiveProcessing');
    const fixtureRestore = vi
      .spyOn(owners.fixture.recovery, 'restore')
      .mockRejectedValueOnce(new Error('fixture store incompatible'));
    const fixtureLive = vi.spyOn(owners.fixture.effectRunner, 'startLiveProcessing');

    await expect(owners.application.start()).rejects.toThrow('fixture store incompatible');
    expect(taskMonitorLive).toHaveBeenCalledOnce();
    expect(fixtureLive).not.toHaveBeenCalled();

    await owners.application.start();
    expect(taskMonitorRestore).toHaveBeenCalledOnce();
    expect(taskMonitorLive).toHaveBeenCalledOnce();
    expect(fixtureRestore).toHaveBeenCalledTimes(2);
    expect(fixtureLive).toHaveBeenCalledOnce();
    owners.application.dispose();
  });

  it('starts without an optional machine that fails to restore and retries it on the next start', async () => {
    const owners = await createOwners({ fixtureOptional: true });
    const taskMonitorLive = vi.spyOn(owners.taskMonitor.effectRunner, 'startLiveProcessing');
    const fixtureRestore = vi
      .spyOn(owners.fixture.recovery, 'restore')
      .mockRejectedValueOnce(new Error('fixture store incompatible'));
    const fixtureLive = vi.spyOn(owners.fixture.effectRunner, 'startLiveProcessing');

    await expect(owners.application.start()).resolves.toBeUndefined();
    expect(taskMonitorLive).toHaveBeenCalledOnce();
    expect(fixtureLive).not.toHaveBeenCalled();

    await owners.application.start();
    expect(fixtureRestore).toHaveBeenCalledTimes(2);
    expect(fixtureLive).toHaveBeenCalledOnce();
    expect(taskMonitorLive).toHaveBeenCalledOnce();
    owners.application.dispose();
  });

  it('still fails start when a required machine fails alongside an optional one', async () => {
    const owners = await createOwners({ fixtureOptional: true });
    vi.spyOn(owners.taskMonitor.recovery, 'restore').mockRejectedValueOnce(new Error('required'));
    vi.spyOn(owners.fixture.recovery, 'restore').mockRejectedValueOnce(new Error('optional'));

    await expect(owners.application.start()).rejects.toThrow('required');
  });

  it('reports every failing machine when several fail to restore', async () => {
    const owners = await createOwners();
    vi.spyOn(owners.taskMonitor.recovery, 'restore').mockRejectedValueOnce(new Error('first'));
    vi.spyOn(owners.fixture.recovery, 'restore').mockRejectedValueOnce(new Error('second'));

    const failure = await owners.application.start().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
  });

  it('never starts a machine’s live processing before its own restoration resolves', async () => {
    const owners = await createOwners();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(owners.fixture.recovery, 'restore').mockImplementation(async () => {
      await gate;
      return { snapshots: [] };
    });
    const taskMonitorLive = vi.spyOn(owners.taskMonitor.effectRunner, 'startLiveProcessing');
    const fixtureLive = vi.spyOn(owners.fixture.effectRunner, 'startLiveProcessing');

    const started = owners.application.start();
    await vi.waitFor(() => {
      expect(taskMonitorLive).toHaveBeenCalledOnce();
    });
    expect(fixtureLive).not.toHaveBeenCalled();

    release();
    await started;
    expect(fixtureLive).toHaveBeenCalledOnce();
    owners.application.dispose();
  });

  it('suppresses live processing for a machine whose restoration finishes after disposal', async () => {
    const owners = await createOwners();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(owners.fixture.recovery, 'restore').mockImplementation(async () => {
      await gate;
      return { snapshots: [] };
    });
    const fixtureLive = vi.spyOn(owners.fixture.effectRunner, 'startLiveProcessing');

    const started = owners.application.start();
    owners.application.dispose();
    release();

    await expect(started).rejects.toThrow('has been disposed');
    expect(fixtureLive).not.toHaveBeenCalled();
  });

  it('keeps Task Monitor names out of the application runtime and reusable state machine modules', async () => {
    const productionDirectory = path.resolve('src/state-machine');
    const entries = await fs.readdir(productionDirectory, { withFileTypes: true });
    const sourcePaths = [
      path.resolve('src/server/state-machine-application-runtime.ts'),
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => path.join(productionDirectory, entry.name)),
    ];

    for (const sourcePath of sourcePaths) {
      expect(path.basename(sourcePath)).not.toMatch(/task.?monitor/i);
      await expect(fs.readFile(sourcePath, 'utf8')).resolves.not.toMatch(/task.?monitor/i);
    }
  });

  it('stops new claims during shutdown without erasing durable snapshots', async () => {
    const owners = await createOwners();
    await owners.fixture.dispatch('fixture-1');
    await owners.taskMonitor.store.commit({
      expectedRevision: null,
      eventType: 'TEST_SETUP',
      priorRevision: 0,
      priorState: 'ABSENT',
      result: {
        status: 'accepted',
        ingressId: 'command-1',
        snapshot: {
          identity: { machineType: 'TASK_MONITOR', instanceId: 'monitor-1' },
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
            taskMonitorId: 'monitor-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
            requestedLaunchConfig: {
              taskId: 'task-1',
              method: 'quick',
              provider: 'codex',
              model: 'gpt-5',
              reasoningEffort: 'high',
            },
            executionPlan: [],
            cursor: null,
            selectedTaskId: null,
            userGuidance: null,
            worktree: null,
            terminalPolicy: null,
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
          },
        },
        effects: [
          {
            type: 'LOAD_TASK_MONITOR',
            taskMonitorId: 'monitor-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
            requestedLaunchConfig: {
              taskId: 'task-1',
              method: 'quick',
              provider: 'codex',
              model: 'gpt-5',
              reasoningEffort: 'high',
            },
          },
        ],
      },
    });

    owners.application.dispose();

    await expect(owners.taskMonitor.effectRunner.runNext()).resolves.toEqual({ status: 'idle' });
    await expect(owners.taskMonitor.store.findByInstanceId('monitor-1')).resolves.toMatchObject({
      snapshot: { revision: 1 },
      effects: [{ status: 'committed' }],
    });
    await expect(owners.fixture.effectRunner.runNext()).resolves.toEqual({ status: 'idle' });
    await expect(owners.fixture.store.findByInstanceId('fixture-1')).resolves.toMatchObject({
      snapshot: { revision: 1 },
      effects: [{ status: 'committed' }],
    });
    expect(owners.execute).not.toHaveBeenCalled();
    await expect(owners.application.start()).rejects.toThrow('has been disposed');
  });

  it('disposes command delivery before claims and then downstream owners in dependency order', async () => {
    const platform = vi.spyOn(PlatformApplicationRuntime.prototype, 'dispose');
    const stateMachines = vi.spyOn(StateMachineApplicationRuntime.prototype, 'dispose');
    const monitors = vi.spyOn(MonitorApplicationRuntime.prototype, 'dispose');
    const monitorEvents = vi.spyOn(MonitorEventSourceRuntime.prototype, 'dispose');
    const runs = vi.spyOn(RunApplicationRuntime.prototype, 'dispose');
    const infrastructure = vi.spyOn(LocalAgentInfrastructure.prototype, 'dispose');
    const owners = createTestLocalAgentServerRuntimeOwners();

    await owners.applicationLifecycle.dispose();

    const order = [
      platform.mock.invocationCallOrder[0],
      stateMachines.mock.invocationCallOrder[0],
      monitors.mock.invocationCallOrder[0],
      monitorEvents.mock.invocationCallOrder[0],
      runs.mock.invocationCallOrder[0],
      infrastructure.mock.invocationCallOrder[0],
    ];
    expect(order.every((call) => call !== undefined)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => Number(left) - Number(right)));
  });
});
