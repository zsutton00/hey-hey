import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
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
import { TaskMonitorDecisionStore } from '../agents/task-monitor/task-monitor-decision-store';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../state-machine';
import { TaskMonitorCoordinatorRunner } from './monitors/runner';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import {
  createFirstLaunchFixture,
  drainDurableTaskMonitorWork,
  MONITOR_ID,
  NOW,
  type FirstLaunchOwners,
} from './task-monitor-first-launch.integration.test-support';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const RUN_ID = 'c0000000-0000-4000-8000-00000000000c';
const PROVIDER_SESSION_ID = 'codex-session-1';
const COORDINATOR_RUN_ID = 'coordinator-permission-run';
const FIVE_MINUTES = 5 * 60_000;

const requests = {
  first: {
    interventionId: '31000000-0000-4000-8000-000000000031',
    providerActionId: 'codex-action-write',
    target: 'src/example.ts',
  },
  second: {
    interventionId: '32000000-0000-4000-8000-000000000032',
    providerActionId: 'codex-action-deploy',
    target: 'pnpm deploy',
  },
} as const;
type RequestName = keyof typeof requests;

const temporaryDirectories: string[] = [];
let clock = NOW;

const admitRequest = (
  adapter: TaskMonitorStateMachineInputAdapter,
  name: RequestName,
  agentSessionId: string,
) =>
  adapter.admitVerified({
    source: 'PROVIDER_INTERVENTION',
    identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
    ingressId: `provider-action:${RUN_ID}:${requests[name].providerActionId}`,
    taskMonitorId: MONITOR_ID,
    interventionId: requests[name].interventionId,
    providerActionId: requests[name].providerActionId,
    providerSessionId: PROVIDER_SESSION_ID,
    runId: RUN_ID,
    agentSessionId,
    action: 'exec',
    target: requests[name].target,
    fingerprint: `sha256:${name}`,
    createdAt: new Date(NOW).toISOString(),
    expiresAt: null,
  });

/** A new process over the same durable files: fresh store, runtime, effect runner and recovery. */
const restart = async (owners: FirstLaunchOwners) => {
  const store = new MachineStateStore<
    string,
    TaskMonitorMachineState,
    TaskMonitorMachineContext,
    TaskMonitorMachineEffect,
    TaskMonitorMachineEffectOutcome
  >(path.join(owners.dataDir, 'state-machines', 'snapshots.json'), taskMonitorStateStoreCodec);
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
  const runner = new EffectRunner(
    store,
    runtime,
    registry,
    owners.monitorRuntime.taskMonitorEffectHandlers,
  );
  const adapter = new TaskMonitorStateMachineInputAdapter(
    new AddressedMachineAdmission(registry),
    undefined,
    store,
  );
  const deadlines = owners.monitorRuntime.taskMonitorMachineOwner.effectHandler.permissionDeadline;
  deadlines.dispose();
  deadlines.connectInput(adapter);
  await deadlines.rearm(store);
  await new MachineRecovery(store, registry, runner).restore();

  return { store, runner, adapter };
};

/** Starts the interrupted ruling's effect, as a process does just before it dies. */
const interruptRuling = async (owners: FirstLaunchOwners) => {
  const stored = await owners.machineStore.findByInstanceId(MONITOR_ID);
  const ruling = stored?.effects.find(
    (effect) => effect.effect.type === 'DECIDE_TASK_MONITOR_PERMISSION',
  );
  if (!ruling) {
    throw new Error('The admitted request did not commit a ruling.');
  }
  await owners.machineStore.claimEffect(MONITOR_ID, ruling.effectId);
};

/** Cards that show a request to a person, among everything posted to the conversation. */
const interventionCards = (post: { mock: { calls: readonly (readonly unknown[])[] } }) =>
  post.mock.calls.filter(
    ([input]) =>
      (input as { dto: { data?: { type?: string } } }).dto.data?.type ===
      'TASK_MONITOR_INTERVENTION',
  );

/** A coordinator turn that never answers, as when the monitor agent stalls. */
const neverAnswers = () => new Promise<never>(() => undefined);

const setUp = async () => {
  const fixture = await createFirstLaunchFixture();
  const { owners, activeRunAgentSessionId } = fixture;
  temporaryDirectories.push(owners.dataDir);
  const post = vi
    .spyOn(owners.messagePoster, 'createOutOfBand')
    .mockResolvedValue('24000000-0000-4000-8000-000000000024');
  vi.spyOn(owners.runRegistry, 'get').mockReturnValue({
    agentSessionId: activeRunAgentSessionId,
    provider: 'codex',
  } as never);
  const submit = vi.spyOn(owners.runRegistry, 'submitPermissionDecision');
  const ruling = vi
    .spyOn(TaskMonitorCoordinatorRunner.prototype, 'runTaskMonitor')
    .mockResolvedValue({
      runId: COORDINATOR_RUN_ID,
      coordinatorAgentSessionId: COORDINATOR_RUN_ID,
    });

  return { owners, activeRunAgentSessionId, post, submit, ruling };
};

beforeEach(() => {
  clock = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

useTestCapabilityCatalog();

describe('Task Monitor permission requests across a restart', () => {
  it('resumes an interrupted ruling at once and settles a timely one unattended', async () => {
    const { owners, activeRunAgentSessionId, post, submit, ruling } = await setUp();
    // The first process dies with the ruling started and unfinished.
    await expect(
      admitRequest(owners.taskMonitorStateMachineInputAdapter, 'first', activeRunAgentSessionId),
    ).resolves.toMatchObject({ status: 'accepted' });
    await interruptRuling(owners);
    ruling.mockClear();

    clock = NOW + 60_000;
    vi.spyOn(TaskMonitorDecisionStore.prototype, 'wait').mockResolvedValue({
      status: 'DECISION',
      decision: { action: 'APPROVE_PERMISSION', rationale: 'The Task edits this file.' },
    } as never);
    submit.mockResolvedValue({
      outcome: 'delivered',
      callbackType: 'codex_exec_approval_response',
    });

    const restarted = await restart(owners);
    await drainDurableTaskMonitorWork(restarted.runner);

    expect(ruling).toHaveBeenCalledOnce();
    expect(ruling.mock.calls[0]?.[0]).toMatchObject({
      cause: 'PERMISSION_REQUEST',
      coordinatorAttemptId: expect.stringContaining(':resumed:'),
      monitoredPermissionRequest: {
        providerActionId: requests.first.providerActionId,
        createdAt: new Date(NOW).toISOString(),
      },
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        requestId: requests.first.providerActionId,
        decision: 'approve',
      }),
    );
    expect(interventionCards(post)).toHaveLength(0);
    await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { intervention: 'CLEAR' } },
        context: { pendingIntervention: null },
      },
    });
  });

  it('hands an overdue request to the person exactly once after a restart', async () => {
    const { owners, activeRunAgentSessionId, post, submit } = await setUp();
    await admitRequest(
      owners.taskMonitorStateMachineInputAdapter,
      'first',
      activeRunAgentSessionId,
    );
    await interruptRuling(owners);

    // The process comes back after the due time; the resumed ruling gets no answer in time.
    clock = NOW + FIVE_MINUTES + 60_000;
    vi.spyOn(TaskMonitorDecisionStore.prototype, 'wait').mockReturnValue(neverAnswers());

    const restarted = await restart(owners);
    await drainDurableTaskMonitorWork(restarted.runner);
    await vi.waitFor(async () => {
      const stored = await restarted.store.findByInstanceId(MONITOR_ID);
      expect(stored?.snapshot.context.pendingIntervention?.owner).toBe('HUMAN');
    });
    await drainDurableTaskMonitorWork(restarted.runner);

    expect(interventionCards(post)).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
    const stored = await restarted.store.findByInstanceId(MONITOR_ID);
    expect(stored?.snapshot).toMatchObject({
      state: { RUNNING: { intervention: 'PENDING' } },
      context: {
        pendingIntervention: {
          interventionId: requests.first.interventionId,
          owner: 'HUMAN',
          decision: null,
        },
      },
    });
    // Nothing is left for the effect queue to re-run: every outcome was accepted.
    expect(stored?.effects.every((effect) => effect.status === 'settled')).toBe(true);
  });
});

describe('Task Monitor permission request whose answer cannot be delivered', () => {
  it.each([
    ['failed', 'provider callback returned 500'],
    ['uncertain', 'transport connection closed before the callback answered'],
  ] as const)(
    'keeps the %s outcome, never resends it, and leaves the other request answerable',
    async (_kind, reason) => {
      const { owners, activeRunAgentSessionId, post, submit } = await setUp();
      const rulings = [
        { action: 'APPROVE_PERMISSION', rationale: 'The Task edits this file.' },
        { action: 'ESCALATE_PERMISSION', rationale: 'Deploying needs a person.' },
      ];
      vi.spyOn(TaskMonitorDecisionStore.prototype, 'wait').mockImplementation(() =>
        Promise.resolve({ status: 'DECISION', decision: rulings.shift() } as never),
      );
      submit
        .mockResolvedValueOnce({ outcome: 'failed', reason })
        .mockResolvedValue({ outcome: 'delivered', callbackType: 'codex_exec_approval_response' });

      const adapter = owners.taskMonitorStateMachineInputAdapter;
      await admitRequest(adapter, 'first', activeRunAgentSessionId);
      await admitRequest(adapter, 'second', activeRunAgentSessionId);
      await drainDurableTaskMonitorWork(owners.effectRunner);

      const afterFailure = await owners.machineStore.findByInstanceId(MONITOR_ID);
      expect(afterFailure?.snapshot.context).toMatchObject({
        undeliveredInterventions: [
          {
            interventionId: requests.first.interventionId,
            decision: { resolution: 'APPROVE' },
            applicationFailure: reason,
          },
        ],
        pendingIntervention: {
          interventionId: requests.second.interventionId,
          owner: 'HUMAN',
        },
      });
      expect(interventionCards(post)).toHaveLength(1);

      const answer = (providerActionId: string, ingressId: string) =>
        adapter.admitPermissionDecision({
          taskMonitorId: MONITOR_ID,
          runId: RUN_ID,
          providerActionId,
          providerSessionId: PROVIDER_SESSION_ID,
          decision: 'approve',
          decidedAt: new Date(clock).toISOString(),
          userId: 'user-1',
          authenticatedAt: new Date(clock).toISOString(),
          ingressId,
        });

      // The undelivered request stays settled: a person's answer never reaches the provider.
      await expect(answer(requests.first.providerActionId, 'answer-first')).resolves.toMatchObject({
        status: 'rejected',
        disposition: { result: 'ALREADY_DECIDED', decidedBy: 'TASK_MONITOR' },
      });

      owners.effectRunner.startLiveProcessing();
      clock += 1_000;
      await expect(
        answer(requests.second.providerActionId, 'answer-second'),
      ).resolves.toMatchObject({ status: 'accepted', disposition: { result: 'APPLIED' } });
      await expect(
        answer(requests.second.providerActionId, 'answer-second-again'),
      ).resolves.toMatchObject({
        status: 'rejected',
        disposition: { result: 'ALREADY_DECIDED', decidedBy: 'PERSON' },
      });

      const delivered = submit.mock.calls.map(([, input]) => input.requestId);
      expect(delivered).toEqual([
        requests.first.providerActionId,
        requests.second.providerActionId,
      ]);
      await expect(owners.machineStore.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
        snapshot: {
          state: { RUNNING: { intervention: 'CLEAR' } },
          context: { pendingIntervention: null },
        },
      });
    },
  );
});
