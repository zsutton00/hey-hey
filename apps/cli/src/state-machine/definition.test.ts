import { describe, expect, expectTypeOf, it } from 'vitest';
import { assign, initialTransition, setup, transition } from 'xstate';

import { defineMachine, type AdmissionResult, type MachineIdentity } from './index';

type ExampleState = 'idle' | 'working' | 'done';
type ExampleEvent =
  | { type: 'START'; itemId: string }
  | { type: 'WORK_FINISHED'; itemId: string }
  | { type: 'WORK_FAILED'; message: string };
interface ExampleContext {
  readonly completedItemId: string | null;
}
interface ExampleEffect {
  type: 'DO_WORK';
  itemId: string;
}
type ExampleOutcome = { type: 'SUCCEEDED'; itemId: string } | { type: 'FAILED'; message: string };
interface VerifiedExampleInput {
  readonly commandId: string;
  readonly instanceId: string;
  readonly itemId: string;
}

const exampleMachine = setup({
  types: {
    context: {} as ExampleContext,
    events: {} as ExampleEvent,
    input: {} as MachineIdentity<'example'>,
  },
  actions: {
    declareEffect: (arguments_, params: ExampleEffect) => {
      void arguments_;
      void params;
    },
  },
  guards: {
    canStart: ({ context }) => context.completedItemId === null,
  },
}).createMachine({
  context: { completedItemId: null },
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: {
          guard: 'canStart',
          target: 'working',
          actions: {
            type: 'declareEffect',
            params: ({ event }) => ({ type: 'DO_WORK', itemId: event.itemId }),
          },
        },
      },
    },
    working: {
      on: {
        WORK_FINISHED: {
          target: 'done',
          actions: assign({ completedItemId: ({ event }) => event.itemId }),
        },
      },
    },
    done: {},
  },
});

const definition = defineMachine<
  'example',
  ExampleState,
  ExampleEvent,
  ExampleContext,
  typeof exampleMachine,
  ExampleEffect,
  ExampleOutcome,
  VerifiedExampleInput
>({
  machineType: 'example',
  payloadCompatibility: { currentSchemaVersion: 1, migrations: new Map() },
  machine: exampleMachine,
  createInitialInput: (identity) => identity,
  readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
  toXStateEvent: (event) => event,
  admitVerifiedInput: (input: VerifiedExampleInput) => ({
    status: 'admitted',
    identity: { machineType: 'example', instanceId: input.instanceId },
    ingressId: input.commandId,
    event: { type: 'START', itemId: input.itemId },
  }),
  effectFromAction: (action) => (action.type === 'declareEffect' ? action.params : null),
  outcomeToEvent: ({ outcome }) =>
    outcome.type === 'SUCCEEDED'
      ? { type: 'WORK_FINISHED', itemId: outcome.itemId }
      : { type: 'WORK_FAILED', message: outcome.message },
});

describe('defineMachine', () => {
  it('preserves the customer-owned event and transition types', () => {
    const admission = definition.admitVerifiedInput({
      commandId: 'command-1',
      instanceId: 'instance-1',
      itemId: 'item-1',
    });

    expect(admission).toEqual({
      status: 'admitted',
      identity: { machineType: 'example', instanceId: 'instance-1' },
      ingressId: 'command-1',
      event: { type: 'START', itemId: 'item-1' },
    });
    expectTypeOf(admission).toEqualTypeOf<AdmissionResult<'example', ExampleEvent>>();

    if (admission.status !== 'admitted') {
      throw new Error('Expected the verified input to be admitted');
    }

    const [initial] = initialTransition(
      definition.machine,
      definition.createInitialInput(admission.identity),
    );
    const [next, actions] = transition(definition.machine, initial, admission.event);

    expect({
      state: next.value,
      context: next.context,
      effects: actions.flatMap((action) => {
        const effect = definition.effectFromAction(action);
        return effect === null ? [] : [effect];
      }),
    }).toEqual({
      state: 'working',
      context: { completedItemId: null },
      effects: [{ type: 'DO_WORK', itemId: 'item-1' }],
    });
  });

  it('maps a closed effect outcome back into a closed machine event', () => {
    expect(
      definition.outcomeToEvent({
        effect: { type: 'DO_WORK', itemId: 'item-1' },
        outcome: { type: 'SUCCEEDED', itemId: 'item-1' },
      }),
    ).toEqual({ type: 'WORK_FINISHED', itemId: 'item-1' });
  });
});
