import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import { validateTaskMonitorLaunchEffect } from '../agents/task-monitor/state-machine/effects';
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
import type { TaskMonitorExternalCommand1 as TaskMonitorExternalCommand } from '../shared/agent-bridge-contract/generated/api';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../state-machine';
import { LocalAgentService } from './local-agent-service';
import { RunReadRestoreCoordinator } from './restore-persisted-runs';
import {
  createFirstLaunchFixture,
  CONVERSATION_ID,
  drainDurableTaskMonitorWork,
  executionPlan,
  FIRST_TASK_ID,
  MACHINE_ID,
  MONITOR_ID,
  NOW,
  ORGANIZATION_ID,
  ORIGINAL_GUIDANCE,
  PROJECT_ID,
  SECOND_TASK_ID,
  type FirstLaunchOwners,
} from './task-monitor-first-launch.integration.test-support';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import { TriggerFrameRouter } from './trigger-verification/dispatch';
import { canonicalizeJson } from './trigger-verification/jcs';
import { TriggerVerifier } from './trigger-verification/verify';
import type { HostActionAdmission } from './controller-authorization/host-action-admission';
import { AdmittedHostAction } from './controller-authorization/types';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

const USER_ID = 'b0000000-0000-4000-8000-00000000000b';
const RUN_ID = 'c0000000-0000-4000-8000-00000000000c';
const REPLACEMENT_GUIDANCE = 'Apply the replacement guidance to the next unstarted Task.';
const INTERVENTION_ID = '21000000-0000-4000-8000-000000000021';
const PROVIDER_ACTION_ID = 'codex-action-1';
const PROVIDER_SESSION_ID = 'codex-session-1';
const INTERVENTION_FINGERPRINT = 'sha256:durable-exact-action';

class TestTaskMonitorCapability extends AdmittedHostAction {
  public constructor() {
    super('TASK_MONITOR_START', 'test-authorization', 'test-nonce');
  }
}

const TEST_TASK_MONITOR_CAPABILITY = new TestTaskMonitorCapability();

const temporaryDirectories: string[] = [];

interface SigningKeys {
  privateKey: crypto.KeyObject;
  rawPublicKey: Buffer;
}

const generateSigningKeys = (): SigningKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { privateKey, rawPublicKey: spki.subarray(12) };
};

const buildSignedFrame = ({
  commandId,
  nonce,
  command,
  privateKey,
  monitorId = MONITOR_ID,
}: {
  commandId: string;
  nonce: string;
  command: TaskMonitorExternalCommand;
  privateKey: crypto.KeyObject;
  monitorId?: string;
}) => {
  const isReduction =
    command.cause === 'PAUSE' || command.cause === 'STOP' || command.cause === 'HALT';
  const isAuthorityNeutral =
    command.cause === 'GUIDANCE_CHANGED' || command.cause === 'HUMAN_DECISION';
  const event = {
    version: 2 as const,
    kind: isReduction
      ? ('task_monitor_authority_reduction' as const)
      : isAuthorityNeutral
        ? ('task_monitor_authority_neutral' as const)
        : ('task_monitor_command' as const),
    commandId,
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    target: { workItemType: 'TASK_MONITOR', workItemId: monitorId },
    command,
  };
  const unsigned = {
    protocolVersion: 2 as const,
    ...(!isReduction && !isAuthorityNeutral
      ? {
          authorization: {
            kind: 'bounded_grant' as const,
            grantId: '90000000-0000-4000-8000-000000000009',
          },
        }
      : {}),
    event,
    machineId: MACHINE_ID,
    userId: USER_ID,
    nonce,
    timestampMs: NOW,
  };
  const signature = crypto
    .sign(null, Buffer.from(canonicalizeJson(unsigned), 'utf8'), privateKey)
    .toString('base64');
  return {
    type: 'trigger.monitor_command',
    timestamp: new Date(NOW).toISOString(),
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    envelope: { ...unsigned, signature },
  };
};

const createVerifiedBoundary = (
  owners: FirstLaunchOwners,
  adapter: TaskMonitorStateMachineInputAdapter,
  keys: SigningKeys,
) =>
  new TriggerFrameRouter({
    servicesApi: {
      getService: async () => ({ data: { data: { name: 'Test Service' } } }),
    } as never,
    verifier: new TriggerVerifier({
      serverSigningPublicKey: keys.rawPublicKey,
      expectedMachineId: MACHINE_ID,
      expectedUserId: USER_ID,
      now: () => NOW,
      logger: owners.infrastructure.logger,
    }),
    machinesApi: owners.infrastructure.apiRuntime.clients.machines,
    keyPairStore: owners.infrastructure.keyPairStore,
    runStore: owners.infrastructure.runStore,
    agentService: owners.agentService,
    promptTypeRegistry,
    runRegistry: owners.runRegistry,
    runRestoreCoordinator: new RunReadRestoreCoordinator({
      runStore: owners.infrastructure.runStore,
      runRegistry: owners.runRegistry,
      logger: owners.infrastructure.logger,
    }),
    permissionDecisionAuditFilePath: path.join(owners.dataDir, 'permission-decisions.audit.jsonl'),
    taskMonitorStateMachineInputAdapter: adapter,
    hostActionAdmission: {
      admit: vi.fn().mockResolvedValue({
        admitted: true,
        authorizationId: 'test-authorization',
        capability: TEST_TASK_MONITOR_CAPABILITY,
      }),
      admitReduction: vi.fn().mockResolvedValue({
        admitted: true,
        authorizationId: 'test-authorization',
        capability: TEST_TASK_MONITOR_CAPABILITY,
      }),
    } as unknown as HostActionAdmission,
    dropSurfacing: {
      poster: owners.messagePoster,
      projectContext: owners.infrastructure.monitorProjectContext,
      initialMachineId: MACHINE_ID,
    },
    logger: owners.infrastructure.logger,
  });

const humanDecisionCommand = (
  overrides: Partial<Extract<TaskMonitorExternalCommand, { cause: 'HUMAN_DECISION' }>> = {},
): Extract<TaskMonitorExternalCommand, { cause: 'HUMAN_DECISION' }> => ({
  cause: 'HUMAN_DECISION',
  interventionId: INTERVENTION_ID,
  providerActionId: PROVIDER_ACTION_ID,
  runId: RUN_ID,
  agentSessionId: overrides.agentSessionId ?? '',
  fingerprint: INTERVENTION_FINGERPRINT,
  resolution: 'APPROVE',
  human: {
    userId: USER_ID,
    authenticatedAt: new Date(NOW).toISOString(),
  },
  ...overrides,
});

const commitPendingIntervention = async (
  owners: FirstLaunchOwners,
  activeRunAgentSessionId: string,
  timestamps: { createdAtMs: number; expiresAtMs: number } = {
    createdAtMs: NOW,
    expiresAtMs: NOW + 5 * 60_000,
  },
) => {
  await expect(
    owners.taskMonitorStateMachineInputAdapter.admitVerified({
      source: 'PROVIDER_INTERVENTION',
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      ingressId: `provider-action:${RUN_ID}:${PROVIDER_ACTION_ID}`,
      taskMonitorId: MONITOR_ID,
      interventionId: INTERVENTION_ID,
      providerActionId: PROVIDER_ACTION_ID,
      providerSessionId: PROVIDER_SESSION_ID,
      runId: RUN_ID,
      agentSessionId: activeRunAgentSessionId,
      action: 'exec',
      target: 'pnpm test',
      fingerprint: INTERVENTION_FINGERPRINT,
      createdAt: new Date(timestamps.createdAtMs).toISOString(),
      expiresAt: new Date(timestamps.expiresAtMs).toISOString(),
    }),
  ).resolves.toMatchObject({ status: 'accepted' });
  await drainDurableTaskMonitorWork(owners.effectRunner);
};

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
      undefined,
      store,
    ),
  };
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

useTestCapabilityCatalog();

describe('Task Monitor durable active-Run controls', () => {
  it('commits an exact action before a signed human decision delivers through the provider owner', async () => {
    const { owners, activeRunAgentSessionId } = await createFirstLaunchFixture();
    const projectIntervention = vi
      .spyOn(owners.messagePoster, 'createOutOfBand')
      .mockResolvedValue('24000000-0000-4000-8000-000000000024');

    await commitPendingIntervention(owners, activeRunAgentSessionId);
    expect(projectIntervention).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        dto: expect.objectContaining({
          data: expect.objectContaining({
            type: 'TASK_MONITOR_INTERVENTION',
            interventionId: INTERVENTION_ID,
          }),
        }),
      }),
    );

    const submitPermissionDecision = vi
      .spyOn(owners.runRegistry, 'submitPermissionDecision')
      .mockResolvedValue({
        outcome: 'delivered',
        callbackType: 'codex_exec_approval_response',
      });
    vi.spyOn(owners.runRegistry, 'get').mockReturnValue({
      agentSessionId: activeRunAgentSessionId,
      provider: 'codex',
    } as never);
    const keys = generateSigningKeys();
    const reconstructed = await reconstruct(owners);
    const boundary = createVerifiedBoundary(owners, reconstructed.adapter, keys);
    const commandId = '22000000-0000-4000-8000-000000000022';
    const decision = () =>
      buildSignedFrame({
        commandId,
        nonce: crypto.randomUUID(),
        command: humanDecisionCommand({ agentSessionId: activeRunAgentSessionId }),
        privateKey: keys.privateKey,
      });

    await expect(
      Promise.all([
        boundary.handleMonitorCommand(decision()),
        boundary.handleMonitorCommand(decision()),
      ]),
    ).resolves.toEqual([
      { status: 'ADMITTED', commandId, replayed: false },
      { status: 'ADMITTED', commandId, replayed: true },
    ]);

    expect(submitPermissionDecision).not.toHaveBeenCalled();
    const admitted = await reconstructed.store.findByInstanceId(MONITOR_ID);
    expect(admitted).toMatchObject({
      snapshot: {
        state: { RUNNING: { intervention: 'APPLYING_DECISION' } },
        context: {
          pendingIntervention: {
            interventionId: INTERVENTION_ID,
            decision: { resolution: 'APPROVE' },
          },
        },
      },
    });
    expect(
      admitted?.effects.some(
        (effect) =>
          effect.effect.type === 'APPLY_TASK_MONITOR_DECISION' && effect.status === 'committed',
      ),
    ).toBe(true);
    await drainDurableTaskMonitorWork(reconstructed.runner);

    expect(submitPermissionDecision).toHaveBeenCalledOnce();
    expect(submitPermissionDecision).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({
        requestId: PROVIDER_ACTION_ID,
        sessionId: PROVIDER_SESSION_ID,
        decision: 'approve',
        idempotencyToken: expect.any(String),
      }),
    );
    await expect(reconstructed.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { intervention: 'CLEAR' } },
        context: { pendingIntervention: null },
      },
    });

    await expect(boundary.handleMonitorCommand(decision())).resolves.toEqual({
      status: 'ADMITTED',
      commandId,
      replayed: true,
    });
    expect(submitPermissionDecision).toHaveBeenCalledOnce();
  });

  it('keeps expired, mismatched, replaced, and settled decisions inert at the signed boundary', async () => {
    const { owners, activeRunAgentSessionId } = await createFirstLaunchFixture();
    await commitPendingIntervention(owners, activeRunAgentSessionId);
    const keys = generateSigningKeys();
    const reconstructed = await reconstruct(owners);
    const boundary = createVerifiedBoundary(owners, reconstructed.adapter, keys);
    const submitPermissionDecision = vi.spyOn(owners.runRegistry, 'submitPermissionDecision');
    const before = await reconstructed.store.findByInstanceId(MONITOR_ID);
    const invalidCommands: Array<{
      id: string;
      overrides: Partial<Extract<TaskMonitorExternalCommand, { cause: 'HUMAN_DECISION' }>>;
    }> = [
      {
        id: '25000000-0000-4000-8000-000000000025',
        overrides: { interventionId: '26000000-0000-4000-8000-000000000026' },
      },
      {
        id: '27000000-0000-4000-8000-000000000027',
        overrides: { providerActionId: 'other-action' },
      },
      {
        id: '28000000-0000-4000-8000-000000000028',
        overrides: { runId: '29000000-0000-4000-8000-000000000029' },
      },
      {
        id: '2a000000-0000-4000-8000-00000000002a',
        overrides: { agentSessionId: '2b000000-0000-4000-8000-00000000002b' },
      },
      {
        id: '2c000000-0000-4000-8000-00000000002c',
        overrides: { fingerprint: 'sha256:other' },
      },
    ];

    for (const [index, candidate] of invalidCommands.entries()) {
      await expect(
        boundary.handleMonitorCommand(
          buildSignedFrame({
            commandId: candidate.id,
            nonce: crypto.randomUUID(),
            command: humanDecisionCommand({
              agentSessionId: activeRunAgentSessionId,
              ...candidate.overrides,
            }),
            privateKey: keys.privateKey,
          }),
        ),
      ).resolves.toMatchObject({ status: 'REJECTED', reason: 'INVALID_LIFECYCLE' });
      const after = await reconstructed.store.findByInstanceId(MONITOR_ID);
      expect(after?.snapshot).toEqual(before?.snapshot);
      expect(after?.acceptedIngress).toEqual(before?.acceptedIngress);
      expect(after?.effects).toEqual(before?.effects);
      expect(after?.transitionHistory).toHaveLength(
        (before?.transitionHistory.length ?? 0) + index + 1,
      );
      expect(after?.transitionHistory.at(-1)).toMatchObject({
        ingressId: candidate.id,
        eventType: 'HUMAN_DECISION',
        disposition: { status: 'no_transition' },
      });
    }

    await expect(
      reconstructed.adapter.admitVerified({
        source: 'PROVIDER_INTERVENTION',
        identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
        ingressId: 'provider-action:replacement',
        taskMonitorId: MONITOR_ID,
        interventionId: '2e000000-0000-4000-8000-00000000002e',
        providerActionId: 'replacement-action',
        providerSessionId: 'replacement-session',
        runId: RUN_ID,
        agentSessionId: activeRunAgentSessionId,
        action: 'exec',
        target: 'pnpm build',
        fingerprint: 'sha256:replacement',
        createdAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'transition_rejected' });
    const afterReplacement = await reconstructed.store.findByInstanceId(MONITOR_ID);
    expect(afterReplacement?.snapshot).toEqual(before?.snapshot);
    expect(afterReplacement?.acceptedIngress).toEqual(before?.acceptedIngress);
    expect(afterReplacement?.effects).toEqual(before?.effects);
    expect(afterReplacement?.transitionHistory.at(-1)).toMatchObject({
      ingressId: 'provider-action:replacement',
      eventType: 'EXACT_ACTION_REQUIRED',
      disposition: { status: 'no_transition' },
    });
    expect(submitPermissionDecision).not.toHaveBeenCalled();

    await expect(
      reconstructed.adapter.admitVerified({
        source: 'EXECUTION_TURN_RELEASED',
        identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
        ingressId: 'execution-turn:settled',
        phase: 'IMPLEMENTATION',
        taskMonitorId: MONITOR_ID,
        runId: RUN_ID,
        agentSessionId: activeRunAgentSessionId,
        turnId: '2f000000-0000-4000-8000-00000000002f',
        settledAt: new Date(NOW + 1_000).toISOString(),
        terminalOutcome: 'COMPLETED',
        completedAssistantMessageId: null,
        reports: [],
      }),
    ).resolves.toMatchObject({ status: 'accepted' });
    await expect(
      boundary.handleMonitorCommand(
        buildSignedFrame({
          commandId: '30000000-0000-4000-8000-000000000030',
          nonce: crypto.randomUUID(),
          command: humanDecisionCommand({ agentSessionId: activeRunAgentSessionId }),
          privateKey: keys.privateKey,
        }),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED', reason: 'INVALID_LIFECYCLE' });
    expect(submitPermissionDecision).not.toHaveBeenCalled();
  });

  it('rejects an expired intervention decision after reconstruction without provider work', async () => {
    const { owners, activeRunAgentSessionId } = await createFirstLaunchFixture();
    await commitPendingIntervention(owners, activeRunAgentSessionId, {
      createdAtMs: NOW - 10 * 60_000,
      expiresAtMs: NOW - 5 * 60_000,
    });
    const keys = generateSigningKeys();
    const reconstructed = await reconstruct(owners);
    const boundary = createVerifiedBoundary(owners, reconstructed.adapter, keys);
    const submitPermissionDecision = vi.spyOn(owners.runRegistry, 'submitPermissionDecision');
    const before = await reconstructed.store.findByInstanceId(MONITOR_ID);

    await expect(
      boundary.handleMonitorCommand(
        buildSignedFrame({
          commandId: '2d000000-0000-4000-8000-00000000002d',
          nonce: crypto.randomUUID(),
          command: humanDecisionCommand({ agentSessionId: activeRunAgentSessionId }),
          privateKey: keys.privateKey,
        }),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED', reason: 'INVALID_LIFECYCLE' });
    const after = await reconstructed.store.findByInstanceId(MONITOR_ID);
    expect(after?.snapshot).toEqual(before?.snapshot);
    expect(after?.acceptedIngress).toEqual(before?.acceptedIngress);
    expect(after?.effects).toEqual(before?.effects);
    expect(after?.transitionHistory).toHaveLength((before?.transitionHistory.length ?? 0) + 1);
    expect(after?.transitionHistory.at(-1)).toMatchObject({
      ingressId: '2d000000-0000-4000-8000-00000000002d',
      eventType: 'HUMAN_DECISION',
      disposition: { status: 'no_transition' },
    });
    expect(submitPermissionDecision).not.toHaveBeenCalled();
  });

  it('persists signed pause and replacement guidance across reconstruction without relaunching', async () => {
    const { owners, startRun, taskStatuses, persistMonitorStatus } = await createFirstLaunchFixture(
      { bypassResumeCoordination: true },
    );
    const keys = generateSigningKeys();
    let boundary = createVerifiedBoundary(owners, owners.taskMonitorStateMachineInputAdapter, keys);
    const stopRun = vi.spyOn(LocalAgentService.prototype, 'stopRun');
    const pauseId = 'e0000000-0000-4000-8000-00000000000e';
    const pause = () =>
      buildSignedFrame({
        commandId: pauseId,
        nonce: crypto.randomUUID(),
        command: { cause: 'PAUSE' },
        privateKey: keys.privateKey,
      });
    await expect(boundary.handleMonitorCommand(pause())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: pauseId,
      replayed: false,
    });
    await expect(boundary.handleMonitorCommand(pause())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: pauseId,
      replayed: true,
    });
    expect(persistMonitorStatus).not.toHaveBeenCalled();
    await expect(owners.machineStore.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: { state: { RUNNING: { control: 'PAUSING' } } },
      effects: expect.arrayContaining([
        expect.objectContaining({
          status: 'committed',
          effect: expect.objectContaining({
            type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
            status: 'ON_HOLD',
          }),
        }),
      ]),
    });

    let restarted = await reconstruct(owners);
    expect(persistMonitorStatus).toHaveBeenCalledTimes(1);
    expect(persistMonitorStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ON_HOLD' }),
    );
    boundary = createVerifiedBoundary(owners, restarted.adapter, keys);
    const guidanceId = '11000000-0000-4000-8000-000000000011';
    const guidance = () =>
      buildSignedFrame({
        commandId: guidanceId,
        nonce: crypto.randomUUID(),
        command: { cause: 'GUIDANCE_CHANGED', guidance: REPLACEMENT_GUIDANCE },
        privateKey: keys.privateKey,
      });
    await expect(boundary.handleMonitorCommand(guidance())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: guidanceId,
      replayed: false,
    });
    await expect(boundary.handleMonitorCommand(guidance())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: guidanceId,
      replayed: true,
    });
    await drainDurableTaskMonitorWork(restarted.runner);

    await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { control: 'PAUSED', work: 'OBSERVING_RUN' } },
        context: {
          userGuidance: REPLACEMENT_GUIDANCE,
          launch: { taskId: FIRST_TASK_ID, userGuidance: ORIGINAL_GUIDANCE },
        },
      },
    });
    expect(startRun).toHaveBeenCalledOnce();

    restarted = await reconstruct(owners);
    boundary = createVerifiedBoundary(owners, restarted.adapter, keys);
    const resumeId = '12000000-0000-4000-8000-000000000012';
    const resume = () =>
      buildSignedFrame({
        commandId: resumeId,
        nonce: crypto.randomUUID(),
        command: { cause: 'RESUME' },
        privateKey: keys.privateKey,
      });
    await expect(boundary.handleMonitorCommand(resume())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: resumeId,
      replayed: false,
    });
    await expect(boundary.handleMonitorCommand(resume())).resolves.toEqual({
      status: 'ADMITTED',
      commandId: resumeId,
      replayed: true,
    });
    expect(persistMonitorStatus).toHaveBeenCalledTimes(1);
    await expect(restarted.store.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: { state: { RUNNING: { control: 'RESUMING' } } },
      effects: expect.arrayContaining([
        expect.objectContaining({
          status: 'committed',
          effect: expect.objectContaining({
            type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
            status: 'ACTIVE',
          }),
        }),
      ]),
    });
    await drainDurableTaskMonitorWork(restarted.runner);
    expect(persistMonitorStatus).toHaveBeenCalledTimes(2);
    expect(persistMonitorStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ACTIVE' }),
    );
    expect(startRun).toHaveBeenCalledOnce();
    expect(stopRun).not.toHaveBeenCalled();
    const resumed = await restarted.store.findByInstanceId(MONITOR_ID);
    expect(resumed).toMatchObject({
      snapshot: {
        state: { RUNNING: { control: 'ACTIVE', work: 'OBSERVING_RUN' } },
        context: { userGuidance: REPLACEMENT_GUIDANCE },
      },
    });

    taskStatuses.set(FIRST_TASK_ID, 'COMPLETED');
    const nextLaunch =
      await owners.monitorRuntime.taskMonitorMachineOwner.launchValidationEffectHandler.execute(
        validateTaskMonitorLaunchEffect(resumed!.snapshot.context, {
          type: 'WORK_SELECTED',
          taskMonitorId: MONITOR_ID,
          taskId: SECOND_TASK_ID,
          cursor: 1,
        }),
      );
    expect(nextLaunch).toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_VALIDATED',
        taskId: SECOND_TASK_ID,
        launch: { taskId: SECOND_TASK_ID, userGuidance: REPLACEMENT_GUIDANCE },
      },
    });
  });

  it('commits HALTED before one delegated interruption and rejects stale or terminal work', async () => {
    const { owners, activeRunAgentSessionId, startRun } = await createFirstLaunchFixture();
    const keys = generateSigningKeys();
    const boundary = createVerifiedBoundary(
      owners,
      owners.taskMonitorStateMachineInputAdapter,
      keys,
    );
    vi.spyOn(owners.infrastructure.runStore, 'lookupByAgentSessionId').mockImplementation(
      (agentSessionId) => (agentSessionId === activeRunAgentSessionId ? RUN_ID : null),
    );
    const haltMonitor = vi
      .spyOn(owners.monitorRuntime.taskMonitorMachineOwner.runtime, 'haltMonitor')
      .mockImplementation(async () => {
        const stored = await owners.machineStore.findByInstanceId(MONITOR_ID);
        expect(stored?.snapshot.state).toBe('HALTED');
        expect(
          stored?.effects.some(
            (effect) =>
              effect.effect.type === 'HALT_TASK_MONITOR_CONTROL' && effect.status === 'claimed',
          ),
        ).toBe(true);
        return { status: 'halted' };
      });
    const stopRun = vi
      .spyOn(LocalAgentService.prototype, 'stopRun')
      .mockImplementation(async () => {
        expect(haltMonitor).toHaveBeenCalledOnce();
      });
    const stopId = '13000000-0000-4000-8000-000000000013';
    const stop = () =>
      buildSignedFrame({
        commandId: stopId,
        nonce: crypto.randomUUID(),
        command: { cause: 'STOP' },
        privateKey: keys.privateKey,
      });
    await expect(
      Promise.all([boundary.handleMonitorCommand(stop()), boundary.handleMonitorCommand(stop())]),
    ).resolves.toEqual([
      { status: 'ADMITTED', commandId: stopId, replayed: false },
      { status: 'ADMITTED', commandId: stopId, replayed: true },
    ]);
    await drainDurableTaskMonitorWork(owners.effectRunner);
    expect(haltMonitor).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledWith(RUN_ID);
    expect(startRun).toHaveBeenCalledOnce();

    const terminalCommands: Array<{ id: string; command: TaskMonitorExternalCommand }> = [
      { id: '14000000-0000-4000-8000-000000000014', command: { cause: 'PAUSE' } },
      {
        id: '15000000-0000-4000-8000-000000000015',
        command: { cause: 'GUIDANCE_CHANGED', guidance: 'Too late.' },
      },
      { id: '16000000-0000-4000-8000-000000000016', command: { cause: 'STOP' } },
    ];
    for (const candidate of terminalCommands) {
      await expect(
        boundary.handleMonitorCommand(
          buildSignedFrame({
            commandId: candidate.id,
            nonce: crypto.randomUUID(),
            command: candidate.command,
            privateKey: keys.privateKey,
          }),
        ),
      ).resolves.toMatchObject({ status: 'REJECTED', reason: 'INVALID_LIFECYCLE' });
    }
    expect(haltMonitor).toHaveBeenCalledOnce();
    expect(stopRun).toHaveBeenCalledOnce();
    const halted = await owners.machineStore.findByInstanceId(MONITOR_ID);
    expect(halted?.snapshot.state).toBe('HALTED');
    expect(
      halted?.effects.filter((effect) => effect.effect.type === 'HALT_TASK_MONITOR_CONTROL'),
    ).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({ type: 'HALT_TASK_MONITOR_CONTROL' }),
        status: 'settled',
      }),
    ]);
  });

  it('serializes legal and stale controls without creating mismatched work', async () => {
    const { owners, startRun } = await createFirstLaunchFixture();
    const keys = generateSigningKeys();
    const boundary = createVerifiedBoundary(
      owners,
      owners.taskMonitorStateMachineInputAdapter,
      keys,
    );
    const race = [
      {
        commandId: '17000000-0000-4000-8000-000000000017',
        command: { cause: 'PAUSE' } as const,
      },
      {
        commandId: '18000000-0000-4000-8000-000000000018',
        command: { cause: 'GUIDANCE_CHANGED', guidance: REPLACEMENT_GUIDANCE } as const,
      },
    ];
    await expect(
      Promise.all(
        race.map((candidate) =>
          boundary.handleMonitorCommand(
            buildSignedFrame({
              ...candidate,
              nonce: crypto.randomUUID(),
              privateKey: keys.privateKey,
            }),
          ),
        ),
      ),
    ).resolves.toEqual([
      { status: 'ADMITTED', commandId: race[0]!.commandId, replayed: false },
      { status: 'ADMITTED', commandId: race[1]!.commandId, replayed: false },
    ]);

    const retryPauseId = '19000000-0000-4000-8000-000000000019';
    await expect(
      boundary.handleMonitorCommand(
        buildSignedFrame({
          commandId: retryPauseId,
          nonce: crypto.randomUUID(),
          command: { cause: 'PAUSE' },
          privateKey: keys.privateKey,
        }),
      ),
    ).resolves.toEqual({ status: 'ADMITTED', commandId: retryPauseId, replayed: false });
    const otherMonitorId = '1a000000-0000-4000-8000-00000000001a';
    await expect(
      boundary.handleMonitorCommand(
        buildSignedFrame({
          commandId: '1b000000-0000-4000-8000-00000000001b',
          nonce: crypto.randomUUID(),
          command: { cause: 'RESUME' },
          privateKey: keys.privateKey,
          monitorId: otherMonitorId,
        }),
      ),
    ).resolves.toMatchObject({ status: 'REJECTED', reason: 'INVALID_LIFECYCLE' });
    expect(await owners.machineStore.findByInstanceId(otherMonitorId)).toBeNull();
    expect(startRun).toHaveBeenCalledOnce();
    await expect(owners.machineStore.findByInstanceId(MONITOR_ID)).resolves.toMatchObject({
      snapshot: {
        state: { RUNNING: { control: 'PAUSING', work: 'OBSERVING_RUN' } },
        context: {
          userGuidance: REPLACEMENT_GUIDANCE,
          launch: { userGuidance: ORIGINAL_GUIDANCE },
        },
      },
    });
  });
});
