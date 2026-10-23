import type { MachineDefinition } from './definition';
import type {
  AdmittedEvent,
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineLogic,
  MachineState,
  SettledEffect,
} from './types';

export const effectOutcomeIngressId = (effectId: string): string => `effect-outcome:${effectId}`;

/** Maps one durable internal settlement into the customer definition's closed event. */
export const toOutcomeEvent = <
  TMachineType extends string,
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
  settledEffect: SettledEffect<TMachineType, TEffect, TOutcome>,
): AdmittedEvent<TMachineType, TEvent> => ({
  status: 'admitted',
  identity: settledEffect.identity,
  ingressId: effectOutcomeIngressId(settledEffect.effectId),
  event: definition.outcomeToEvent({
    effect: settledEffect.effect,
    outcome: settledEffect.settlement.outcome,
  }),
});
