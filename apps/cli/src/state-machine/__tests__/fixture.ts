import path from 'node:path';
import { z } from 'zod/v4';
import { assign, setup } from 'xstate';

import {
  defineMachine,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
  type MachineIdentity,
  type MachinePayloadCompatibility,
} from '../index';

export type TestState = 'idle' | 'working' | 'done';
export type TestEvent =
  | { type: 'START'; itemId: string }
  | { type: 'FINISH'; itemId: string }
  | { type: 'UNSUPPORTED' };
export interface TestContext {
  readonly transitions: number;
}
export type TestEffect = { type: 'DO_WORK'; itemId: string } | { type: 'REPORT_DONE' };
export type TestOutcome =
  | { readonly type: 'SUCCEEDED'; readonly itemId: string }
  | { readonly type: 'FAILED'; readonly reason: string }
  | { readonly type: 'CANCELLED'; readonly reason: string }
  | { readonly type: 'UNCERTAIN'; readonly reason: string };
export interface TestInput {
  readonly commandId: string;
  readonly instanceId: string;
  readonly event: TestEvent;
  readonly admittedMachineType?: string;
  readonly rejectInput?: boolean;
}

const testStateSchema = z.enum(['idle', 'working', 'done']);
const testContextSchema = z.object({ transitions: z.number().int().nonnegative() });
const testEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DO_WORK'), itemId: z.string() }),
  z.object({ type: z.literal('REPORT_DONE') }),
]);
const testOutcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SUCCEEDED'), itemId: z.string() }),
  z.object({ type: z.literal('FAILED'), reason: z.string() }),
  z.object({ type: z.literal('CANCELLED'), reason: z.string() }),
  z.object({ type: z.literal('UNCERTAIN'), reason: z.string() }),
]);

export const createDefinition = (
  machineType: string,
  onTransition: () => void = () => undefined,
  finishEffects: readonly TestEffect[] = [{ type: 'REPORT_DONE' }],
  payloadCompatibility: MachinePayloadCompatibility = {
    currentSchemaVersion: 1,
    migrations: new Map(),
  },
) => {
  const machine = setup({
    types: {
      context: {} as TestContext,
      events: {} as TestEvent,
      input: {} as MachineIdentity,
    },
    actions: {
      declareEffect: (arguments_, params: TestEffect) => {
        void arguments_;
        void params;
      },
    },
    guards: {
      allowed: () => {
        onTransition();
        return true;
      },
    },
  }).createMachine({
    context: { transitions: 0 },
    initial: 'idle',
    states: {
      idle: {
        on: {
          START: {
            guard: 'allowed',
            target: 'working',
            actions: [
              assign({ transitions: ({ context }) => context.transitions + 1 }),
              {
                type: 'declareEffect',
                params: ({ event }) => ({ type: 'DO_WORK', itemId: event.itemId }),
              },
            ],
          },
        },
      },
      working: {
        on: {
          FINISH: {
            guard: 'allowed',
            target: 'done',
            actions: [
              assign({ transitions: ({ context }) => context.transitions + 1 }),
              ...finishEffects.map((effect) => ({
                type: 'declareEffect' as const,
                params: effect,
              })),
            ],
          },
        },
      },
      done: {},
    },
  });

  return defineMachine<
    string,
    TestState,
    TestEvent,
    TestContext,
    typeof machine,
    TestEffect,
    TestOutcome,
    TestInput
  >({
    machineType,
    payloadCompatibility,
    machine,
    createInitialInput: (identity) => identity,
    readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
    toXStateEvent: (event) => event,
    admitVerifiedInput: (input: TestInput) =>
      input.rejectInput
        ? { status: 'rejected', reason: 'Verified input is unsupported.' }
        : {
            status: 'admitted',
            identity: {
              machineType: input.admittedMachineType ?? machineType,
              instanceId: input.instanceId,
            },
            ingressId: input.commandId,
            event: input.event,
          },
    effectFromAction: (action) => (action.type === 'declareEffect' ? action.params : null),
    outcomeToEvent: () => ({ type: 'FINISH', itemId: 'outcome-item' }),
  });
};

type TestDefinition = ReturnType<typeof createDefinition>;

export const createHarness = (
  directory: string,
  definitions: readonly TestDefinition[] = [createDefinition('example')],
): {
  store: MachineStateStore<string, TestState, TestContext, TestEffect, TestOutcome>;
  runtime: MachineRuntime<
    string,
    TestState,
    TestEvent,
    TestContext,
    TestDefinition['machine'],
    TestEffect,
    TestOutcome,
    TestInput
  >;
  registry: MachineRegistry<
    string,
    TestState,
    TestEvent,
    TestContext,
    TestDefinition['machine'],
    TestEffect,
    TestOutcome,
    TestInput
  >;
  filePath: string;
} => {
  const filePath = path.join(directory, 'machines.json');
  const store = new MachineStateStore(filePath, {
    decodeMachineType: (value) => value,
    decodeState: (value) => testStateSchema.parse(value),
    decodeContext: (value) => testContextSchema.parse(value),
    decodeEffect: (value) => testEffectSchema.parse(value),
    decodeOutcome: (value) => testOutcomeSchema.parse(value),
    isCompletedState: (value) => value === 'done',
    payloadCompatibility: (machineType) => {
      const definition = definitions.find((candidate) => candidate.machineType === machineType);
      return (
        definition?.payloadCompatibility ?? {
          currentSchemaVersion: 1,
          migrations: new Map(),
        }
      );
    },
  });
  const runtime = new MachineRuntime<
    string,
    TestState,
    TestEvent,
    TestContext,
    TestDefinition['machine'],
    TestEffect,
    TestOutcome,
    TestInput
  >(store);
  const registry = new MachineRegistry(runtime);
  for (const definition of definitions) {
    registry.register(definition);
  }
  return { store, runtime, registry, filePath };
};

export const startInput = (commandId: string, instanceId = 'instance-1'): TestInput => ({
  commandId,
  instanceId,
  event: { type: 'START', itemId: 'item-1' },
});
