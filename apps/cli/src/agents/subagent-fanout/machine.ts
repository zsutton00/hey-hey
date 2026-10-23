import { z } from 'zod/v4';
import { assign, enqueueActions, setup } from 'xstate';

import {
  defineMachine,
  type MachineDefinition,
  type MachineIdentity,
  type MachineLogicState,
  type MachineRegistry,
  type MachineRuntime,
  type MachineStateStore,
  type MachineStateStoreCodec,
} from '../../state-machine';

export const SUBAGENT_FANOUT_MACHINE_TYPE = 'SUBAGENT_FANOUT' as const;
export const MAX_SUBAGENT_OBJECTIVES = 5;

const childOutcomeSchema = z.enum(['succeeded', 'failed', 'cancelled', 'interrupted']);
export type SubagentChildOutcome = z.infer<typeof childOutcomeSchema>;

const childSchema = z
  .object({
    index: z.number().int().nonnegative(),
    objective: z.string().min(1),
    outcome: childOutcomeSchema.optional(),
    outputText: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
type SubagentFanoutChild = z.infer<typeof childSchema>;

const contextSchema = z
  .object({
    parentRunId: z.string().min(1).nullable(),
    parentTurnId: z.string().min(1).nullable(),
    children: z.array(childSchema),
  })
  .strict();
export type SubagentFanoutContext = z.infer<typeof contextSchema>;

const childSettledSchema = z
  .object({
    type: z.literal('child_settled'),
    index: z.number().int().nonnegative(),
    outcome: childOutcomeSchema,
    outputText: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const runChildEffectSchema = z
  .object({
    type: z.literal('run_child'),
    index: z.number().int().nonnegative(),
    objective: z.string().min(1),
  })
  .strict();

/** The outcome of one `run_child` effect; it re-enters unchanged as `child_settled`. */
export type SubagentFanoutOutcome = z.infer<typeof childSettledSchema>;
export type SubagentFanoutEffect = z.infer<typeof runChildEffectSchema>;

interface SubagentFanoutStartEvent {
  readonly type: 'start';
  readonly parentRunId: string;
  readonly parentTurnId: string | null;
  readonly children: ReadonlyArray<{ readonly index: number; readonly objective: string }>;
}

export type SubagentFanoutEvent = SubagentFanoutStartEvent | SubagentFanoutOutcome;

/** A start request the run_subagents tool has already validated. */
export interface VerifiedSubagentFanoutStart {
  readonly instanceId: string;
  readonly parentRunId: string;
  readonly parentTurnId: string | null;
  readonly objectives: readonly string[];
}

export const subagentFanoutStartIngressId = (instanceId: string): string => `start:${instanceId}`;

const subagentFanoutMachine = setup({
  types: {
    context: {} as SubagentFanoutContext,
    events: {} as SubagentFanoutEvent,
    input: {} as MachineIdentity,
  },
  actions: {
    runChild: (arguments_, params: SubagentFanoutEffect) => {
      void arguments_;
      void params;
    },
  },
  guards: {
    hasAdmissibleChildren: ({ event }) =>
      event.type === 'start' &&
      event.children.length > 0 &&
      event.children.length <= MAX_SUBAGENT_OBJECTIVES,
    matchesRunningChild: ({ context, event }) =>
      event.type === 'child_settled' &&
      context.children.some((child) => child.index === event.index && child.outcome === undefined),
    allChildrenSettled: ({ context }) =>
      context.children.every((child) => child.outcome !== undefined),
  },
}).createMachine({
  id: 'subagentFanout',
  context: { parentRunId: null, parentTurnId: null, children: [] },
  initial: 'pending',
  states: {
    pending: {
      on: {
        start: {
          guard: 'hasAdmissibleChildren',
          target: 'running',
          actions: [
            assign(({ event }) => ({
              parentRunId: event.parentRunId,
              parentTurnId: event.parentTurnId,
              children: event.children.map(({ index, objective }) => ({ index, objective })),
            })),
            enqueueActions(({ event, enqueue }) => {
              for (const { index, objective } of event.children) {
                enqueue({ type: 'runChild', params: { type: 'run_child', index, objective } });
              }
            }),
          ],
        },
      },
    },
    running: {
      always: { guard: 'allChildrenSettled', target: 'settled' },
      on: {
        child_settled: {
          guard: 'matchesRunningChild',
          actions: assign({
            children: ({ context, event }) =>
              context.children.map((child) =>
                child.index === event.index
                  ? {
                      ...child,
                      outcome: event.outcome,
                      ...(event.outputText !== undefined ? { outputText: event.outputText } : {}),
                      ...(event.reason !== undefined ? { reason: event.reason } : {}),
                    }
                  : child,
              ),
          }),
        },
      },
    },
    settled: {},
  },
});

export type SubagentFanoutMachineLogic = typeof subagentFanoutMachine;
export type SubagentFanoutState = MachineLogicState<SubagentFanoutMachineLogic>;

const stateSchema = z.enum(['pending', 'running', 'settled']);

export type SubagentFanoutDefinition = MachineDefinition<
  typeof SUBAGENT_FANOUT_MACHINE_TYPE,
  SubagentFanoutState,
  SubagentFanoutEvent,
  SubagentFanoutContext,
  SubagentFanoutMachineLogic,
  SubagentFanoutEffect,
  SubagentFanoutOutcome,
  VerifiedSubagentFanoutStart
>;

export type SubagentFanoutStateStore = MachineStateStore<
  typeof SUBAGENT_FANOUT_MACHINE_TYPE,
  SubagentFanoutState,
  SubagentFanoutContext,
  SubagentFanoutEffect,
  SubagentFanoutOutcome
>;

export type SubagentFanoutMachineRuntime = MachineRuntime<
  typeof SUBAGENT_FANOUT_MACHINE_TYPE,
  SubagentFanoutState,
  SubagentFanoutEvent,
  SubagentFanoutContext,
  SubagentFanoutMachineLogic,
  SubagentFanoutEffect,
  SubagentFanoutOutcome,
  VerifiedSubagentFanoutStart
>;

export type SubagentFanoutMachineRegistry = MachineRegistry<
  typeof SUBAGENT_FANOUT_MACHINE_TYPE,
  SubagentFanoutState,
  SubagentFanoutEvent,
  SubagentFanoutContext,
  SubagentFanoutMachineLogic,
  SubagentFanoutEffect,
  SubagentFanoutOutcome,
  VerifiedSubagentFanoutStart
>;

const subagentFanoutPayloadCompatibility = {
  currentSchemaVersion: 1,
  migrations: new Map(),
} as const;

export const createSubagentFanoutDefinition = (): SubagentFanoutDefinition =>
  defineMachine<
    typeof SUBAGENT_FANOUT_MACHINE_TYPE,
    SubagentFanoutState,
    SubagentFanoutEvent,
    SubagentFanoutContext,
    SubagentFanoutMachineLogic,
    SubagentFanoutEffect,
    SubagentFanoutOutcome,
    VerifiedSubagentFanoutStart
  >({
    machineType: SUBAGENT_FANOUT_MACHINE_TYPE,
    payloadCompatibility: subagentFanoutPayloadCompatibility,
    machine: subagentFanoutMachine,
    createInitialInput: (identity) => identity,
    readSnapshot: (snapshot) => ({ state: snapshot.value, context: snapshot.context }),
    toXStateEvent: (event) => event,
    admitVerifiedInput: (input) => {
      if (input.objectives.length === 0 || input.objectives.length > MAX_SUBAGENT_OBJECTIVES) {
        return {
          status: 'rejected',
          reason: `A subagent fan-out takes 1–${String(MAX_SUBAGENT_OBJECTIVES)} objectives.`,
        };
      }
      return {
        status: 'admitted',
        identity: { machineType: SUBAGENT_FANOUT_MACHINE_TYPE, instanceId: input.instanceId },
        ingressId: subagentFanoutStartIngressId(input.instanceId),
        event: {
          type: 'start',
          parentRunId: input.parentRunId,
          parentTurnId: input.parentTurnId,
          children: input.objectives.map((objective, index) => ({ index, objective })),
        },
      };
    },
    effectFromAction: (action) =>
      action.type === 'runChild' ? runChildEffectSchema.parse(action.params) : null,
    outcomeToEvent: ({ outcome }) => outcome,
  });

export const subagentFanoutStateStoreCodec: MachineStateStoreCodec<
  typeof SUBAGENT_FANOUT_MACHINE_TYPE,
  SubagentFanoutState,
  SubagentFanoutContext,
  SubagentFanoutEffect,
  SubagentFanoutOutcome
> = {
  decodeMachineType: (value) => z.literal(SUBAGENT_FANOUT_MACHINE_TYPE).parse(value),
  decodeState: (value) => stateSchema.parse(value),
  decodeContext: (value) => contextSchema.parse(value),
  decodeEffect: (value) => runChildEffectSchema.parse(value),
  decodeOutcome: (value) => childSettledSchema.parse(value),
  isCompletedState: (value) => value === 'settled',
  payloadCompatibility: (machineType) => {
    z.literal(SUBAGENT_FANOUT_MACHINE_TYPE).parse(machineType);
    return subagentFanoutPayloadCompatibility;
  },
};
