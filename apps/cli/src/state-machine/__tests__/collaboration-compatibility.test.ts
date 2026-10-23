import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';

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
} from '../index';

type CompatibilityState =
  | 'admission'
  | 'dispatch'
  | 'waiting'
  | 'result_ready'
  | 'delivered'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'expired';

type CompatibilityEvent =
  | { readonly type: 'ADMIT'; readonly accepted: boolean; readonly requestId: string }
  | { readonly type: 'DISPATCHED'; readonly requestId: string }
  | { readonly type: 'RESULT_READY'; readonly result: string }
  | { readonly type: 'DELIVER' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'FAIL'; readonly reason: string }
  | { readonly type: 'EXPIRE' };

interface CompatibilityContext {
  readonly requestId: string | null;
  readonly result: string | null;
  readonly failureReason: string | null;
}

interface CompatibilityEffect {
  readonly type: 'DISPATCH_REQUEST';
  readonly requestId: string;
}

type CompatibilityOutcome =
  | { readonly type: 'DISPATCH_ACCEPTED'; readonly requestId: string }
  | { readonly type: 'DISPATCH_FAILED'; readonly reason: string };

interface CompatibilityInput {
  readonly ingressId: string;
  readonly instanceId: string;
  readonly event: CompatibilityEvent;
}

const compatibilityStateSchema = z.enum([
  'admission',
  'dispatch',
  'waiting',
  'result_ready',
  'delivered',
  'rejected',
  'cancelled',
  'failed',
  'expired',
]);
const compatibilityContextSchema = z.object({
  requestId: z.string().nullable(),
  result: z.string().nullable(),
  failureReason: z.string().nullable(),
});
const compatibilityEffectSchema = z.object({
  type: z.literal('DISPATCH_REQUEST'),
  requestId: z.string(),
});
const compatibilityOutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DISPATCH_ACCEPTED'), requestId: z.string() }),
  z.object({ type: z.literal('DISPATCH_FAILED'), reason: z.string() }),
]);

const compatibilityMachine = setup({
  types: {
    context: {} as CompatibilityContext,
    events: {} as CompatibilityEvent,
    input: {} as MachineIdentity<'compatibility-fixture'>,
  },
  actions: {
    declareEffect: (arguments_, params: CompatibilityEffect) => {
      void arguments_;
      void params;
    },
  },
  guards: {
    accepted: ({ event }) => event.type === 'ADMIT' && event.accepted,
  },
}).createMachine({
  context: { requestId: null, result: null, failureReason: null },
  initial: 'admission',
  states: {
    admission: {
      on: {
        ADMIT: [
          {
            guard: 'accepted',
            target: 'dispatch',
            actions: [
              assign({ requestId: ({ event }) => event.requestId }),
              {
                type: 'declareEffect',
                params: ({ event }) => ({
                  type: 'DISPATCH_REQUEST',
                  requestId: event.requestId,
                }),
              },
            ],
          },
          { target: 'rejected' },
        ],
      },
    },
    dispatch: {
      on: {
        DISPATCHED: { target: 'waiting' },
        CANCEL: { target: 'cancelled' },
        FAIL: {
          target: 'failed',
          actions: assign({ failureReason: ({ event }) => event.reason }),
        },
      },
    },
    waiting: {
      on: {
        RESULT_READY: {
          target: 'result_ready',
          actions: assign({ result: ({ event }) => event.result }),
        },
        CANCEL: { target: 'cancelled' },
        FAIL: {
          target: 'failed',
          actions: assign({ failureReason: ({ event }) => event.reason }),
        },
        EXPIRE: { target: 'expired' },
      },
    },
    result_ready: {
      on: {
        DELIVER: { target: 'delivered' },
        CANCEL: { target: 'cancelled' },
        FAIL: {
          target: 'failed',
          actions: assign({ failureReason: ({ event }) => event.reason }),
        },
        EXPIRE: { target: 'expired' },
      },
    },
    delivered: {},
    rejected: {},
    cancelled: {},
    failed: {},
    expired: {},
  },
});

type CompatibilityDefinition = MachineDefinition<
  'compatibility-fixture',
  CompatibilityState,
  CompatibilityEvent,
  CompatibilityContext,
  typeof compatibilityMachine,
  CompatibilityEffect,
  CompatibilityOutcome,
  CompatibilityInput
>;

const definition: CompatibilityDefinition = defineMachine({
  payloadCompatibility: { currentSchemaVersion: 1, migrations: new Map() },
  machineType: 'compatibility-fixture',
  machine: compatibilityMachine,
  createInitialInput: (identity) => identity,
  readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
  toXStateEvent: (event) => event,
  admitVerifiedInput: (input) => ({
    status: 'admitted',
    identity: { machineType: 'compatibility-fixture', instanceId: input.instanceId },
    ingressId: input.ingressId,
    event: input.event,
  }),
  effectFromAction: (action) => (action.type === 'declareEffect' ? action.params : null),
  outcomeToEvent: ({ outcome }) =>
    outcome.type === 'DISPATCH_ACCEPTED'
      ? { type: 'DISPATCHED', requestId: outcome.requestId }
      : { type: 'FAIL', reason: outcome.reason },
});

const createHarness = (directory: string) => {
  const store = new MachineStateStore<
    'compatibility-fixture',
    CompatibilityState,
    CompatibilityContext,
    CompatibilityEffect,
    CompatibilityOutcome
  >(path.join(directory, 'machines.json'), {
    decodeMachineType: (value) => z.literal('compatibility-fixture').parse(value),
    decodeState: (value) => compatibilityStateSchema.parse(value),
    decodeContext: (value) => compatibilityContextSchema.parse(value),
    decodeEffect: (value) => compatibilityEffectSchema.parse(value),
    decodeOutcome: (value) => compatibilityOutcomeSchema.parse(value),
  });
  const runtime = new MachineRuntime<
    'compatibility-fixture',
    CompatibilityState,
    CompatibilityEvent,
    CompatibilityContext,
    typeof compatibilityMachine,
    CompatibilityEffect,
    CompatibilityOutcome,
    CompatibilityInput
  >(store);
  const registry = new MachineRegistry(runtime);
  registry.register(definition);
  const admission = new AddressedMachineAdmission(registry);
  return { store, runtime, registry, admission };
};

const identity = (instanceId: string): MachineIdentity<'compatibility-fixture'> => ({
  machineType: 'compatibility-fixture',
  instanceId,
});

const input = (
  instanceId: string,
  ingressId: string,
  event: CompatibilityEvent,
): CompatibilityInput => ({ instanceId, ingressId, event });

const settlement: EffectSettlement<CompatibilityOutcome> = {
  status: 'succeeded',
  outcome: { type: 'DISPATCH_ACCEPTED', requestId: 'request-1' },
};

const retrying = (
  execute: EffectHandler<CompatibilityEffect, CompatibilityOutcome>['execute'],
) => ({ execute, recovery: { strategy: 'retry' as const } });

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-compatibility-machine-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('test-only collaboration-shaped runtime compatibility', () => {
  it('models the closed lifecycle and keeps asynchronous dispatch outside transition evaluation', async () => {
    expect(Object.keys(compatibilityMachine.config.states!)).toEqual([
      'admission',
      'dispatch',
      'waiting',
      'result_ready',
      'delivered',
      'rejected',
      'cancelled',
      'failed',
      'expired',
    ]);

    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const execute = vi.fn(() => Promise.resolve(settlement));
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      DISPATCH_REQUEST: retrying(execute),
    });

    const admitted = await harness.admission.admit({
      identity: identity('delivery'),
      ingressId: 'admit-delivery',
      verifiedInput: input('delivery', 'admit-delivery', {
        type: 'ADMIT',
        accepted: true,
        requestId: 'request-1',
      }),
    });

    expect(admitted).toMatchObject({
      status: 'accepted',
      snapshot: { revision: 1, state: 'dispatch' },
      effects: [{ type: 'DISPATCH_REQUEST', requestId: 'request-1' }],
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(harness.store.findByInstanceId('delivery')).resolves.toMatchObject({
      effects: [{ status: 'committed' }],
    });

    await expect(runner.runNext()).resolves.toMatchObject({
      status: 'completed',
      admission: { status: 'accepted', snapshot: { revision: 2, state: 'waiting' } },
    });
    expect(execute).toHaveBeenCalledOnce();

    await expect(
      harness.admission.admit({
        identity: identity('delivery'),
        ingressId: 'result-delivery',
        verifiedInput: input('delivery', 'result-delivery', {
          type: 'RESULT_READY',
          result: 'assembled-result',
        }),
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: {
        revision: 3,
        state: 'result_ready',
        context: { result: 'assembled-result' },
      },
    });
    await expect(
      harness.admission.admit({
        identity: identity('delivery'),
        ingressId: 'deliver-result',
        verifiedInput: input('delivery', 'deliver-result', { type: 'DELIVER' }),
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      snapshot: { revision: 4, state: 'delivered' },
    });

    const branchCases: readonly {
      readonly instanceId: string;
      readonly events: readonly CompatibilityEvent[];
      readonly expectedState: CompatibilityState;
    }[] = [
      {
        instanceId: 'rejection',
        events: [{ type: 'ADMIT', accepted: false, requestId: 'request-rejected' }],
        expectedState: 'rejected',
      },
      {
        instanceId: 'cancellation',
        events: [
          { type: 'ADMIT', accepted: true, requestId: 'request-cancelled' },
          { type: 'CANCEL' },
        ],
        expectedState: 'cancelled',
      },
      {
        instanceId: 'failure',
        events: [
          { type: 'ADMIT', accepted: true, requestId: 'request-failed' },
          { type: 'FAIL', reason: 'dispatch failed' },
        ],
        expectedState: 'failed',
      },
      {
        instanceId: 'expiry',
        events: [
          { type: 'ADMIT', accepted: true, requestId: 'request-expired' },
          { type: 'DISPATCHED', requestId: 'request-expired' },
          { type: 'EXPIRE' },
        ],
        expectedState: 'expired',
      },
    ];

    for (const branch of branchCases) {
      for (const [index, event] of branch.events.entries()) {
        const ingressId = `${branch.instanceId}-${index}`;
        await harness.admission.admit({
          identity: identity(branch.instanceId),
          ingressId,
          verifiedInput: input(branch.instanceId, ingressId, event),
        });
      }
      await expect(harness.store.findByInstanceId(branch.instanceId)).resolves.toMatchObject({
        snapshot: { state: branch.expectedState },
      });
    }
  });

  it('reconstructs unsettled dispatch work through the registered recovery policy', async () => {
    const directory = await createTemporaryDirectory();
    const beforeRestart = createHarness(directory);
    await beforeRestart.admission.admit({
      identity: identity('unsettled'),
      ingressId: 'admit-unsettled',
      verifiedInput: input('unsettled', 'admit-unsettled', {
        type: 'ADMIT',
        accepted: true,
        requestId: 'request-1',
      }),
    });

    const executeAfterRestart = vi.fn(() => Promise.resolve(settlement));
    const reconstructed = createHarness(directory);
    const runner = new EffectRunner(
      reconstructed.store,
      reconstructed.runtime,
      reconstructed.registry,
      { DISPATCH_REQUEST: retrying(executeAfterRestart) },
    );

    await new MachineRecovery(reconstructed.store, reconstructed.registry, runner).restore();

    expect(executeAfterRestart).toHaveBeenCalledOnce();
    await expect(reconstructed.store.findByInstanceId('unsettled')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'waiting' },
      effects: [{ status: 'settled', settlement }],
    });
  });

  it('reconstructs settled dispatch work without repeating the external operation', async () => {
    const directory = await createTemporaryDirectory();
    const beforeRestart = createHarness(directory);
    await beforeRestart.admission.admit({
      identity: identity('settled'),
      ingressId: 'admit-settled',
      verifiedInput: input('settled', 'admit-settled', {
        type: 'ADMIT',
        accepted: true,
        requestId: 'request-1',
      }),
    });
    const claimed = await beforeRestart.store.claimNextCommittedEffect();
    if (!claimed) throw new Error('Expected a committed dispatch effect.');
    await beforeRestart.store.settleEffect(claimed.effectId, settlement);

    const executeAfterRestart = vi.fn(() => Promise.resolve(settlement));
    const reconstructed = createHarness(directory);
    const runner = new EffectRunner(
      reconstructed.store,
      reconstructed.runtime,
      reconstructed.registry,
      { DISPATCH_REQUEST: retrying(executeAfterRestart) },
    );
    const recovery = new MachineRecovery(reconstructed.store, reconstructed.registry, runner);

    await recovery.restore();
    await recovery.restore();

    expect(executeAfterRestart).not.toHaveBeenCalled();
    await expect(reconstructed.store.findByInstanceId('settled')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'waiting' },
      effects: [{ status: 'settled', settlement }],
    });
  });

  it('keeps customer names and customer-specific executors out of reusable production modules', async () => {
    const productionDirectory = path.resolve('src/state-machine');
    const entries = await fs.readdir(productionDirectory, { withFileTypes: true });
    const productionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));
    const productionSources = await Promise.all(
      productionFiles.map(async (entry) => ({
        name: entry.name,
        source: await fs.readFile(path.join(productionDirectory, entry.name), 'utf8'),
      })),
    );

    expect(productionSources.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/collaboration|task.?monitor/i)]),
    );
    for (const { source } of productionSources) {
      expect(source).not.toMatch(/collaboration|task.?monitor/i);
    }
  });
});
