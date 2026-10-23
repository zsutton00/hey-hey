import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';

import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineRuntime,
  type TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import type { MonitorCommandBody1 as MonitorCommandBody } from '../shared/agent-bridge-contract/generated/api';
import {
  defineMachine,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
  type MachineIdentity,
} from '../state-machine';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';

const temporaryDirectories: string[] = [];

const command = (): MonitorCommandBody => ({
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
      taskId: '50000000-0000-4000-8000-000000000005',
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
    },
  },
});

const createHarness = async (): Promise<{
  adapter: TaskMonitorStateMachineInputAdapter;
  registry: TaskMonitorMachineRegistry;
}> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-machine-adapter-'));
  temporaryDirectories.push(directory);
  const store: TaskMonitorStateStore = new MachineStateStore(
    path.join(directory, 'machines.json'),
    taskMonitorStateStoreCodec,
  );
  const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store);
  const registry: TaskMonitorMachineRegistry = new MachineRegistry(runtime);
  registry.register(createTaskMonitorDefinition());
  return {
    adapter: new TaskMonitorStateMachineInputAdapter(
      new AddressedMachineAdmission(registry),
      undefined,
      store,
    ),
    registry,
  };
};

type CollaborationState = 'waiting' | 'joined';
type CollaborationEvent = { readonly type: 'JOIN'; readonly participantId: string };
interface CollaborationContext {
  readonly participantId: string | null;
}
type CollaborationEffect = { readonly type: 'ANNOUNCE_JOIN'; readonly participantId: string };
type CollaborationOutcome = { readonly type: 'ANNOUNCED'; readonly participantId: string };
interface VerifiedCollaborationInput {
  readonly eventId: string;
  readonly sessionId: string;
  readonly participantId: string;
}

const collaborationMachine = setup({
  types: {
    context: {} as CollaborationContext,
    events: {} as CollaborationEvent,
    input: {} as MachineIdentity<'COLLABORATION'>,
  },
}).createMachine({
  context: { participantId: null },
  initial: 'waiting',
  states: {
    waiting: {
      on: {
        JOIN: {
          target: 'joined',
          actions: assign({ participantId: ({ event }) => event.participantId }),
        },
      },
    },
    joined: {},
  },
});

const createCollaborationAdmission = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-collaboration-admission-'));
  temporaryDirectories.push(directory);
  const store = new MachineStateStore<
    'COLLABORATION',
    CollaborationState,
    CollaborationContext,
    CollaborationEffect,
    CollaborationOutcome
  >(path.join(directory, 'machines.json'), {
    decodeMachineType: (value) => z.literal('COLLABORATION').parse(value),
    decodeState: (value) => z.enum(['waiting', 'joined']).parse(value),
    decodeContext: (value) => z.object({ participantId: z.string().nullable() }).parse(value),
    decodeEffect: (value) =>
      z.object({ type: z.literal('ANNOUNCE_JOIN'), participantId: z.string() }).parse(value),
    decodeOutcome: (value) =>
      z.object({ type: z.literal('ANNOUNCED'), participantId: z.string() }).parse(value),
  });
  const runtime = new MachineRuntime<
    'COLLABORATION',
    CollaborationState,
    CollaborationEvent,
    CollaborationContext,
    typeof collaborationMachine,
    CollaborationEffect,
    CollaborationOutcome,
    VerifiedCollaborationInput
  >(store);
  const registry = new MachineRegistry(runtime);
  registry.register(
    defineMachine<
      'COLLABORATION',
      CollaborationState,
      CollaborationEvent,
      CollaborationContext,
      typeof collaborationMachine,
      CollaborationEffect,
      CollaborationOutcome,
      VerifiedCollaborationInput
    >({
      machineType: 'COLLABORATION',
      payloadCompatibility: { currentSchemaVersion: 1, migrations: new Map() },
      machine: collaborationMachine,
      createInitialInput: (identity) => identity,
      readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
      toXStateEvent: (event) => event,
      admitVerifiedInput: (input: VerifiedCollaborationInput) => ({
        status: 'admitted',
        identity: { machineType: 'COLLABORATION', instanceId: input.sessionId },
        ingressId: input.eventId,
        event: { type: 'JOIN', participantId: input.participantId },
      }),
      effectFromAction: () => null,
      outcomeToEvent: ({ outcome }) => ({
        type: 'JOIN',
        participantId: outcome.participantId,
      }),
    }),
  );
  return new AddressedMachineAdmission(registry);
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('TaskMonitorStateMachineInputAdapter', () => {
  it('makes one admission request and acknowledges first acceptance and durable replay', async () => {
    const input = command();
    const { adapter, registry } = await createHarness();
    const admit = vi.spyOn(registry, 'admit');

    await expect(adapter.admit(input)).resolves.toEqual({
      status: 'ADMITTED',
      commandId: input.commandId,
      replayed: false,
    });
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledWith(
      {
        machineType: input.target.workItemType,
        instanceId: input.target.workItemId,
      },
      input.commandId,
      input,
    );

    admit.mockClear();
    await expect(adapter.admit(input)).resolves.toEqual({
      status: 'ADMITTED',
      commandId: input.commandId,
      replayed: true,
    });
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('converts a definition rejection into the existing typed acknowledgement', async () => {
    const input: MonitorCommandBody = {
      ...command(),
      command: { cause: 'PAUSE' },
    };
    const { adapter, registry } = await createHarness();
    const admit = vi.spyOn(registry, 'admit');

    await expect(adapter.admit(input)).resolves.toEqual({
      status: 'REJECTED',
      commandId: input.commandId,
      stage: 'ADMISSION',
      reason: 'INVALID_LIFECYCLE',
      message: 'Event PAUSE is not accepted from the current state.',
    });
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('returns a typed rejection for an unknown addressed machine type', async () => {
    const valid = command();
    const input = {
      ...valid,
      target: { workItemType: 'UNKNOWN_MACHINE', workItemId: valid.target.workItemId },
    } as unknown as MonitorCommandBody;
    const { adapter, registry } = await createHarness();
    const admit = vi.spyOn(registry, 'admit');

    await expect(adapter.admit(input)).resolves.toMatchObject({
      status: 'REJECTED',
      commandId: input.commandId,
      stage: 'ADMISSION',
      reason: 'ROUTE_REJECTED',
    });
    expect(admit).toHaveBeenCalledTimes(1);
  });
});

describe('AddressedMachineAdmission', () => {
  it('admits a collaboration-shaped customer without Task Monitor transport types', async () => {
    const admission = await createCollaborationAdmission();
    const verifiedInput: VerifiedCollaborationInput = {
      eventId: 'collaboration-event-1',
      sessionId: 'collaboration-session-1',
      participantId: 'participant-1',
    };

    await expect(
      admission.admit({
        identity: {
          machineType: 'COLLABORATION',
          instanceId: verifiedInput.sessionId,
        },
        ingressId: verifiedInput.eventId,
        verifiedInput,
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      ingressId: verifiedInput.eventId,
      snapshot: {
        state: 'joined',
        context: { participantId: verifiedInput.participantId },
      },
    });
  });

  it('rejects addressed machine and ingress identities that customer mapping does not match', async () => {
    const admission = await createCollaborationAdmission();
    const verifiedInput: VerifiedCollaborationInput = {
      eventId: 'collaboration-event-1',
      sessionId: 'collaboration-session-1',
      participantId: 'participant-1',
    };

    await expect(
      admission.admit({
        identity: { machineType: 'COLLABORATION', instanceId: 'different-session' },
        ingressId: verifiedInput.eventId,
        verifiedInput,
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'identity_mismatch' });
    await expect(
      admission.admit({
        identity: { machineType: 'COLLABORATION', instanceId: verifiedInput.sessionId },
        ingressId: 'different-event',
        verifiedInput,
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'ingress_identity_mismatch' });
  });
});
