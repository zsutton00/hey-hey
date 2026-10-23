import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../state-machine';
import { NOOP_LOGGER } from './logger';
import {
  createFirstLaunchFixture,
  drainDurableTaskMonitorWork,
  MONITOR_ID,
  NOW,
  type FirstLaunchOwners,
} from './task-monitor-first-launch.integration.test-support';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import { TaskMonitorSettlementMachineAdapter } from './task-monitor-settlement-machine-adapter';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const RUN_ID = 'a1000000-0000-4000-8000-000000000001';
const USER_ID = 'a2000000-0000-4000-8000-000000000002';
const directories: string[] = [];

const reconstruct = async (owners: FirstLaunchOwners) => {
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
  await new MachineRecovery(store, registry, runner).restore();
  return {
    store,
    runner,
    adapter: new TaskMonitorStateMachineInputAdapter(
      new AddressedMachineAdmission(registry),
      NOOP_LOGGER,
      store,
    ),
  };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

useTestCapabilityCatalog();

describe('Task Monitor durable finish machine', () => {
  it.each([
    ['approve', 'APPROVE'],
    ['deny', 'DENY'],
  ] as const)(
    'settles one matching %s result and restart does not repeat the provider response',
    async (providerDecision, resolution) => {
      const { owners, activeRunAgentSessionId } = await createFirstLaunchFixture();
      directories.push(owners.dataDir);
      const interventionId = 'a3000000-0000-4000-8000-000000000003';
      const providerActionId = 'a4000000-0000-4000-8000-000000000004';
      const providerSessionId = 'a5000000-0000-4000-8000-000000000005';
      vi.spyOn(owners.messagePoster, 'createOutOfBand').mockResolvedValue(
        'a6000000-0000-4000-8000-000000000006',
      );

      await owners.taskMonitorStateMachineInputAdapter.admitVerified({
        source: 'PROVIDER_INTERVENTION',
        identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
        ingressId: `provider-action:${RUN_ID}:${providerActionId}`,
        taskMonitorId: MONITOR_ID,
        interventionId,
        providerActionId,
        providerSessionId,
        runId: RUN_ID,
        agentSessionId: activeRunAgentSessionId,
        action: 'exec',
        target: 'pnpm test',
        fingerprint: 'sha256:finish-machine',
        createdAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
      });
      await drainDurableTaskMonitorWork(owners.effectRunner);

      vi.spyOn(owners.runRegistry, 'get').mockReturnValue({
        agentSessionId: activeRunAgentSessionId,
        provider: 'codex',
      } as never);
      const submit = vi.spyOn(owners.runRegistry, 'submitPermissionDecision').mockResolvedValue({
        outcome: 'delivered',
        callbackType: 'codex_exec_approval_response',
      });
      const result = await owners.taskMonitorStateMachineInputAdapter.admitPermissionDecision({
        taskMonitorId: MONITOR_ID,
        runId: RUN_ID,
        providerActionId,
        providerSessionId,
        decision: providerDecision,
        decidedAt: new Date(NOW).toISOString(),
        userId: USER_ID,
        authenticatedAt: new Date(NOW).toISOString(),
        ingressId: `a7000000-0000-4000-8000-00000000000${resolution === 'APPROVE' ? '7' : '8'}`,
      });
      expect(result).toMatchObject({ status: 'accepted' });
      await drainDurableTaskMonitorWork(owners.effectRunner);
      expect(submit).toHaveBeenCalledOnce();
      expect(submit).toHaveBeenCalledWith(
        RUN_ID,
        expect.objectContaining({
          decision: resolution === 'APPROVE' ? 'approve' : 'deny',
          requestId: providerActionId,
        }),
      );

      const restarted = await reconstruct(owners);
      await drainDurableTaskMonitorWork(restarted.runner);
      expect(submit).toHaveBeenCalledOnce();
      await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
        snapshot: {
          state: { RUNNING: { intervention: 'CLEAR', work: 'OBSERVING_RUN' } },
          context: { pendingIntervention: null },
        },
      });
    },
  );

  it.each([
    ['SUPERVISION_CONTINUES_OBSERVING', { RUNNING: { work: 'OBSERVING_RUN' } }],
    ['SUPERVISION_HALTED', 'HALTED'],
    ['SUPERVISION_COMPLETED', 'COMPLETED'],
  ] as const)(
    'admits one settled Run and commits before the %s owner result',
    async (outcomeType, expectedState) => {
      const { owners, activeRunAgentSessionId } = await createFirstLaunchFixture();
      directories.push(owners.dataDir);
      vi.spyOn(owners.infrastructure.runStore, 'lookupByAgentSessionId').mockReturnValue(RUN_ID);
      const supervision = vi
        .spyOn(
          owners.monitorRuntime.taskMonitorMachineOwner.settledRunEvaluationEffectHandler,
          'execute',
        )
        .mockImplementation(async (effect) => {
          const stored = await owners.machineStore.findByInstanceId(MONITOR_ID);
          expect(stored?.snapshot.state).toMatchObject({ RUNNING: { work: 'EVALUATING_RUN' } });
          expect(
            stored?.effects.some(
              (candidate) =>
                candidate.effect.type === 'EVALUATE_TASK_MONITOR_SETTLED_RUN' &&
                candidate.status === 'claimed',
            ),
          ).toBe(true);
          const common = {
            taskMonitorId: effect.taskMonitorId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
          };
          return {
            status: 'succeeded',
            outcome:
              outcomeType === 'SUPERVISION_HALTED'
                ? { type: outcomeType, ...common, reason: 'Explicit halt.' }
                : { type: outcomeType, ...common },
          } as never;
        });
      const settlement = new TaskMonitorSettlementMachineAdapter(
        {
          readAgentSession: vi.fn().mockResolvedValue({
            autoDecide: false,
            conversationId: 'a8000000-0000-4000-8000-000000000008',
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              model: 'gpt-5.6',
              taskMonitorId: MONITOR_ID,
            },
          }),
        } as never,
        owners.infrastructure.runStore,
        owners.machineStore,
        owners.taskMonitorStateMachineInputAdapter,
        NOOP_LOGGER,
      );
      const settledTurn = {
        kind: 'settled_turn' as const,
        agentSessionId: activeRunAgentSessionId,
        turnId: 'a9000000-0000-4000-8000-000000000009',
        promptType: 'quick',
        terminalOutcome: 'COMPLETED' as const,
        completedAssistantMessageId: null,
        reports: [],
        settledAt: new Date(NOW).toISOString(),
      };

      await settlement.invoke(settledTurn as never, {} as never);
      await drainDurableTaskMonitorWork(owners.effectRunner);
      await settlement.invoke(settledTurn as never, {} as never);
      await drainDurableTaskMonitorWork(owners.effectRunner);

      expect(supervision).toHaveBeenCalledOnce();
      const stored = await owners.machineStore.findByInstanceId(MONITOR_ID);
      if (typeof expectedState === 'string') {
        expect(stored?.snapshot.state).toBe(expectedState);
      } else {
        expect(stored?.snapshot.state).toMatchObject(expectedState);
      }
    },
  );
});
