import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assign, setup } from 'xstate';

import {
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

type OperationState =
  | 'idle'
  | 'awaiting_outcome'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'uncertain';
type OperationOutcome =
  | { readonly type: 'SUCCEEDED'; readonly result: string }
  | { readonly type: 'FAILED'; readonly reason: string }
  | { readonly type: 'CANCELLED'; readonly reason: string }
  | { readonly type: 'UNCERTAIN'; readonly reason: string };
type OperationEvent =
  | { readonly type: 'START'; readonly operationId: string }
  | { readonly type: 'OUTCOME'; readonly outcome: OperationOutcome };
interface OperationContext {
  readonly operationId: string | null;
  readonly outcome: OperationOutcome | null;
}
interface OperationEffect {
  readonly type: 'EXECUTE';
  readonly operationId: string;
}
interface OperationInput {
  readonly commandId: string;
  readonly instanceId: string;
  readonly event: OperationEvent;
}

const operationStateSchema = z.enum([
  'idle',
  'awaiting_outcome',
  'succeeded',
  'failed',
  'cancelled',
  'uncertain',
]);
const operationOutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SUCCEEDED'), result: z.string() }),
  z.object({ type: z.literal('FAILED'), reason: z.string() }),
  z.object({ type: z.literal('CANCELLED'), reason: z.string() }),
  z.object({ type: z.literal('UNCERTAIN'), reason: z.string() }),
]);
const operationContextSchema = z.object({
  operationId: z.string().nullable(),
  outcome: operationOutcomeSchema.nullable(),
});
const operationEffectSchema = z.object({
  type: z.literal('EXECUTE'),
  operationId: z.string(),
});

const operationMachine = setup({
  types: {
    context: {} as OperationContext,
    events: {} as OperationEvent,
    input: {} as MachineIdentity<'outcome-lifecycle'>,
  },
  actions: {
    declareEffect: (arguments_, params: OperationEffect) => {
      void arguments_;
      void params;
    },
  },
}).createMachine({
  context: { operationId: null, outcome: null },
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: {
          target: 'awaiting_outcome',
          actions: [
            assign({ operationId: ({ event }) => event.operationId }),
            {
              type: 'declareEffect',
              params: ({ event }) => ({ type: 'EXECUTE', operationId: event.operationId }),
            },
          ],
        },
      },
    },
    awaiting_outcome: {
      on: {
        OUTCOME: [
          {
            guard: ({ event }) => event.outcome.type === 'SUCCEEDED',
            target: 'succeeded',
            actions: assign({ outcome: ({ event }) => event.outcome }),
          },
          {
            guard: ({ event }) => event.outcome.type === 'FAILED',
            target: 'failed',
            actions: assign({ outcome: ({ event }) => event.outcome }),
          },
          {
            guard: ({ event }) => event.outcome.type === 'CANCELLED',
            target: 'cancelled',
            actions: assign({ outcome: ({ event }) => event.outcome }),
          },
          {
            guard: ({ event }) => event.outcome.type === 'UNCERTAIN',
            target: 'uncertain',
            actions: assign({ outcome: ({ event }) => event.outcome }),
          },
        ],
      },
    },
    succeeded: {},
    failed: {},
    cancelled: {},
    uncertain: {},
  },
});

const createDefinition = (): MachineDefinition<
  'outcome-lifecycle',
  OperationState,
  OperationEvent,
  OperationContext,
  typeof operationMachine,
  OperationEffect,
  OperationOutcome,
  OperationInput
> =>
  defineMachine<
    'outcome-lifecycle',
    OperationState,
    OperationEvent,
    OperationContext,
    typeof operationMachine,
    OperationEffect,
    OperationOutcome,
    OperationInput
  >({
    machineType: 'outcome-lifecycle',
    payloadCompatibility: { currentSchemaVersion: 1, migrations: new Map() },
    machine: operationMachine,
    createInitialInput: (identity) => identity,
    readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
    toXStateEvent: (event) => event,
    admitVerifiedInput: (input: OperationInput) => ({
      status: 'admitted',
      identity: { machineType: 'outcome-lifecycle', instanceId: input.instanceId },
      ingressId: input.commandId,
      event: input.event,
    }),
    effectFromAction: (action) => (action.type === 'declareEffect' ? action.params : null),
    outcomeToEvent: ({ outcome }) => ({ type: 'OUTCOME', outcome }),
  });

const createHarness = (directory: string, definition = createDefinition()) => {
  const store = new MachineStateStore<
    'outcome-lifecycle',
    OperationState,
    OperationContext,
    OperationEffect,
    OperationOutcome
  >(path.join(directory, 'machines.json'), {
    decodeMachineType: (value) => z.literal('outcome-lifecycle').parse(value),
    decodeState: (value) => operationStateSchema.parse(value),
    decodeContext: (value) => operationContextSchema.parse(value),
    decodeEffect: (value) => operationEffectSchema.parse(value),
    decodeOutcome: (value) => operationOutcomeSchema.parse(value),
  });
  const runtime = new MachineRuntime<
    'outcome-lifecycle',
    OperationState,
    OperationEvent,
    OperationContext,
    typeof operationMachine,
    OperationEffect,
    OperationOutcome,
    OperationInput
  >(store);
  const registry = new MachineRegistry(runtime);
  registry.register(definition);
  return { store, runtime, registry };
};

const identity = { machineType: 'outcome-lifecycle' as const, instanceId: 'operation-instance' };
const startInput: OperationInput = {
  commandId: 'start-operation',
  instanceId: identity.instanceId,
  event: { type: 'START', operationId: 'operation-1' },
};
const retryingHandler = (execute: EffectHandler<OperationEffect, OperationOutcome>['execute']) => ({
  execute,
  recovery: { strategy: 'retry' as const },
});

const successfulSettlement: EffectSettlement<OperationOutcome> = {
  status: 'succeeded',
  outcome: { type: 'SUCCEEDED', result: 'result-1' },
};

const scenarios: readonly {
  readonly name: string;
  readonly state: OperationState;
  readonly settlement: EffectSettlement<OperationOutcome>;
}[] = [
  {
    name: 'success',
    state: 'succeeded',
    settlement: successfulSettlement,
  },
  {
    name: 'settled failure',
    state: 'failed',
    settlement: { status: 'failed', outcome: { type: 'FAILED', reason: 'operation rejected' } },
  },
  {
    name: 'cancellation',
    state: 'cancelled',
    settlement: {
      status: 'cancelled',
      outcome: { type: 'CANCELLED', reason: 'operation cancelled' },
    },
  },
  {
    name: 'uncertainty',
    state: 'uncertain',
    settlement: {
      status: 'uncertain',
      outcome: { type: 'UNCERTAIN', reason: 'completion could not be confirmed' },
    },
  },
];

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-outcome-lifecycle-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('durable outcome lifecycle', () => {
  it.each(scenarios)(
    'commits, executes, settles, and re-enters a $name outcome exactly once',
    async ({ state, settlement }) => {
      const directory = await createTemporaryDirectory();
      const harness = createHarness(directory);
      const statusesSeenByHandler: string[] = [];
      const handler = vi.fn(async () => {
        const stored = await harness.store.findByInstanceId(identity.instanceId);
        statusesSeenByHandler.push(stored?.effects[0]?.status ?? 'missing');
        return settlement;
      });
      const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
        EXECUTE: retryingHandler(handler),
      });

      const admitted = await harness.registry.admit(identity, startInput.commandId, startInput);

      expect(admitted).toMatchObject({
        status: 'accepted',
        snapshot: {
          revision: 1,
          state: 'awaiting_outcome',
          context: { operationId: 'operation-1', outcome: null },
        },
        effects: [{ type: 'EXECUTE', operationId: 'operation-1' }],
      });
      expect(handler).not.toHaveBeenCalled();
      await expect(harness.store.findByInstanceId(identity.instanceId)).resolves.toMatchObject({
        snapshot: { revision: 1, state: 'awaiting_outcome' },
        effects: [{ status: 'committed' }],
      });

      const originalAdmit = harness.runtime.admit.bind(harness.runtime);
      const settledBeforeOutcomeTransition: boolean[] = [];
      vi.spyOn(harness.runtime, 'admit').mockImplementation(async (definition, event) => {
        const stored = await harness.store.findByInstanceId(event.identity.instanceId);
        settledBeforeOutcomeTransition.push(stored?.effects[0]?.status === 'settled');
        return originalAdmit(definition, event);
      });

      const completed = await runner.runNext();

      expect(completed).toMatchObject({
        status: 'completed',
        effect: { status: 'settled', settlement },
        admission: {
          status: 'accepted',
          snapshot: {
            revision: 2,
            state,
            context: { operationId: 'operation-1', outcome: settlement.outcome },
          },
          effects: [],
        },
      });
      expect(statusesSeenByHandler).toEqual(['claimed']);
      expect(settledBeforeOutcomeTransition).toEqual([true]);
      expect(handler).toHaveBeenCalledOnce();
      await expect(harness.store.findByInstanceId(identity.instanceId)).resolves.toMatchObject({
        snapshot: {
          revision: 2,
          state,
          context: { operationId: 'operation-1', outcome: settlement.outcome },
        },
        effects: [{ status: 'settled', settlement }],
      });

      if (completed.status !== 'completed') throw new Error('Expected a completed effect.');
      await expect(runner.recoverSettled(completed.effect)).resolves.toMatchObject({
        status: 'completed',
        admission: { status: 'replayed', snapshot: { revision: 2, state } },
      });
      await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it('atomically claims concurrent deliveries and invokes the handler once', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    let releaseHandler = (): void => undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler = vi.fn(async () => {
      await handlerGate;
      return successfulSettlement;
    });
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      EXECUTE: retryingHandler(handler),
    });
    await harness.registry.admit(identity, startInput.commandId, startInput);

    const firstDelivery = runner.runNext();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
    releaseHandler();
    await expect(firstDelivery).resolves.toMatchObject({
      status: 'completed',
      admission: { status: 'accepted', snapshot: { revision: 2, state: 'succeeded' } },
    });
    await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each(scenarios)(
    'reconstructs a settled $name outcome without repeating external work',
    async ({ state, settlement }) => {
      const directory = await createTemporaryDirectory();
      const beforeRestart = createHarness(directory);
      await beforeRestart.registry.admit(identity, startInput.commandId, startInput);
      const claimed = await beforeRestart.store.claimNextCommittedEffect();
      if (!claimed) throw new Error('Expected a committed effect.');
      await beforeRestart.store.settleEffect(claimed.effectId, settlement);

      const executeAfterRestart = vi.fn(() => Promise.resolve(settlement));
      const reconstructed = createHarness(directory);
      const runner = new EffectRunner(
        reconstructed.store,
        reconstructed.runtime,
        reconstructed.registry,
        { EXECUTE: retryingHandler(executeAfterRestart) },
      );
      const recovery = new MachineRecovery(reconstructed.store, reconstructed.registry, runner);

      await recovery.restore();
      await recovery.restore();

      expect(executeAfterRestart).not.toHaveBeenCalled();
      await expect(
        reconstructed.store.findByInstanceId(identity.instanceId),
      ).resolves.toMatchObject({
        snapshot: {
          revision: 2,
          state,
          context: { operationId: 'operation-1', outcome: settlement.outcome },
        },
        effects: [{ status: 'settled', settlement }],
      });
      await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
    },
  );
});
