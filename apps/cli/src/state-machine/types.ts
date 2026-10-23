import type {
  AnyStateMachine,
  ContextFrom,
  EventFromLogic,
  ExecutableActionsFrom,
  InputFrom,
  StateFrom,
  EventObject,
  StateValue,
} from 'xstate';

export type MachineState = StateValue;

export type MachineEvent = EventObject;

export type EffectDeclaration = EventObject;

export type EffectOutcome = EventObject;

export type MachineLogic = AnyStateMachine;

export type MachineLogicState<TLogic extends MachineLogic> =
  StateFrom<TLogic> extends {
    readonly value: infer TState extends MachineState;
  }
    ? TState
    : never;

type MachineLogicContext<TLogic extends MachineLogic> = ContextFrom<TLogic>;

type MachineLogicEvent<TLogic extends MachineLogic> = EventFromLogic<TLogic>;

export type MachineLogicInput<TLogic extends MachineLogic> = InputFrom<TLogic>;

export type MachineLogicAction<TLogic extends MachineLogic> = ExecutableActionsFrom<TLogic>;

export interface MachineIdentity<TMachineType extends string = string> {
  readonly machineType: TMachineType;
  readonly instanceId: string;
}

export interface AddressedMachineAdmissionInput<TMachineType extends string, TVerifiedInput> {
  readonly identity: MachineIdentity<TMachineType>;
  readonly ingressId: string;
  readonly verifiedInput: TVerifiedInput;
}

export interface InitialMachineInstance<TState extends MachineState, TContext extends object> {
  readonly state: TState;
  readonly context: TContext;
}

export interface MachineSnapshot<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
> extends InitialMachineInstance<TState, TContext> {
  readonly identity: MachineIdentity<TMachineType>;
  readonly revision: number;
}

interface TransitionRequest<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEvent extends MachineEvent,
> {
  readonly snapshot: MachineSnapshot<TMachineType, TState, TContext>;
  readonly event: TEvent;
}

interface LegalTransition<
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> {
  readonly state: TState;
  readonly context: TContext;
  readonly effects: readonly TEffect[];
}

type TransitionResult<
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> =
  | {
      readonly status: 'accepted';
      readonly transition: LegalTransition<TState, TContext, TEffect>;
    }
  | {
      readonly status: 'rejected';
      readonly reason: string;
    };

export interface AdmittedEvent<TMachineType extends string, TEvent extends MachineEvent> {
  readonly status: 'admitted';
  readonly identity: MachineIdentity<TMachineType>;
  readonly ingressId: string;
  readonly event: TEvent;
}

export type EffectSettlementStatus = 'succeeded' | 'failed' | 'cancelled' | 'uncertain';

export interface EffectSettlement<TOutcome extends EffectOutcome> {
  readonly status: EffectSettlementStatus;
  readonly outcome: TOutcome;
}

interface EffectRecordBase<TEffect extends EffectDeclaration> {
  readonly effectId: string;
  readonly revision: number;
  readonly effect: TEffect;
}

export type CommittedEffect<
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> = EffectRecordBase<TEffect> &
  (
    | { readonly status: 'committed' }
    | { readonly status: 'claimed' }
    | {
        readonly status: 'settled';
        readonly settlement: EffectSettlement<TOutcome>;
      }
  );

export type ClaimedEffect<
  TMachineType extends string,
  TEffect extends EffectDeclaration,
> = EffectRecordBase<TEffect> & {
  readonly identity: MachineIdentity<TMachineType>;
  readonly status: 'claimed';
};

export type SettledEffect<
  TMachineType extends string,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> = EffectRecordBase<TEffect> & {
  readonly identity: MachineIdentity<TMachineType>;
  readonly status: 'settled';
  readonly settlement: EffectSettlement<TOutcome>;
};

export interface AcceptedEventResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> {
  readonly status: 'accepted';
  readonly ingressId: string;
  readonly snapshot: MachineSnapshot<TMachineType, TState, TContext>;
  readonly effects: readonly TEffect[];
}

export interface ReplayedEventResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> {
  readonly status: 'replayed';
  readonly ingressId: string;
  readonly snapshot: MachineSnapshot<TMachineType, TState, TContext>;
  readonly effects: readonly TEffect[];
}

export type RuntimeRejectionCode =
  | 'unknown_machine_type'
  | 'identity_mismatch'
  | 'ingress_identity_mismatch'
  | 'input_rejected'
  | 'unsupported_initial_event'
  | 'transition_rejected';

interface RuntimeRejection {
  readonly status: 'rejected';
  readonly code: RuntimeRejectionCode;
  readonly reason: string;
}

export type RuntimeEventResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> =
  | AcceptedEventResult<TMachineType, TState, TContext, TEffect>
  | ReplayedEventResult<TMachineType, TState, TContext, TEffect>
  | RuntimeRejection;

interface RejectedInput {
  readonly status: 'rejected';
  readonly reason: string;
}

export type AdmissionResult<TMachineType extends string, TEvent extends MachineEvent> =
  | AdmittedEvent<TMachineType, TEvent>
  | RejectedInput;

interface EffectOutcomeArguments<
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> {
  readonly effect: TEffect;
  readonly outcome: TOutcome;
}

export type OutcomeEventMapper<
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TEvent extends MachineEvent,
> = (arguments_: EffectOutcomeArguments<TEffect, TOutcome>) => TEvent;
