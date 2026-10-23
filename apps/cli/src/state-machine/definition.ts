import type {
  AdmissionResult,
  EffectDeclaration,
  EffectOutcome,
  InitialMachineInstance,
  MachineEvent,
  MachineIdentity,
  MachineLogic,
  MachineLogicAction,
  MachineLogicInput,
  MachineState,
  OutcomeEventMapper,
} from './types';
import type { JsonValue } from '../durable-data';

export interface MachinePayloadCompatibility {
  readonly currentSchemaVersion: number;
  readonly migrations: ReadonlyMap<number, (payload: JsonValue) => JsonValue>;
}

export interface MachineDefinition<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  readonly machineType: TMachineType;
  readonly payloadCompatibility: MachinePayloadCompatibility;
  readonly machine: TLogic;
  readonly createInitialInput: (
    identity: MachineIdentity<TMachineType>,
  ) => MachineLogicInput<TLogic>;
  readonly readSnapshot: (
    snapshot: import('xstate').StateFrom<TLogic>,
  ) => InitialMachineInstance<TState, TContext>;
  readonly toXStateEvent: (event: TEvent) => import('xstate').EventFromLogic<TLogic>;
  readonly admitVerifiedInput: (input: TVerifiedInput) => AdmissionResult<TMachineType, TEvent>;
  readonly effectFromAction: (action: MachineLogicAction<TLogic>) => TEffect | null;
  readonly outcomeToEvent: OutcomeEventMapper<TEffect, TOutcome, TEvent>;
}

export const defineMachine = <
  const TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
>(
  definition: MachineDefinition<
    TMachineType,
    TState,
    TEvent,
    TContext,
    TLogic,
    TEffect,
    TOutcome,
    TVerifiedInput
  >,
): MachineDefinition<
  TMachineType,
  TState,
  TEvent,
  TContext,
  TLogic,
  TEffect,
  TOutcome,
  TVerifiedInput
> => definition;
