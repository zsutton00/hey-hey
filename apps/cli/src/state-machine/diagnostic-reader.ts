import { effectOutcomeIngressId } from './outcome-event';
import type { MachineStateStore } from './state-store';
import type {
  EffectDeclaration,
  EffectOutcome,
  EffectSettlementStatus,
  MachineIdentity,
  MachineState,
} from './types';

interface MachineDiagnosticEffect {
  readonly effectId: string;
  readonly declaredRevision: number;
  readonly effectType: string;
  readonly status: 'committed' | 'claimed' | 'settled';
  readonly settlementStatus: EffectSettlementStatus | null;
  readonly outcomeType: string | null;
  readonly outcomeAdmission: 'not_settled' | 'pending' | 'applied';
}

interface MachineDiagnosticTransition<TStateProjection extends object> {
  readonly sequence: number;
  readonly ingressId: string;
  readonly eventType: string | null;
  readonly priorRevision: number;
  readonly revision: number;
  readonly priorState: TStateProjection | null;
  readonly disposition: 'transition_committed' | 'no_transition';
  readonly reason: string | null;
  readonly committedNextState: TStateProjection | null;
  readonly effects: readonly MachineDiagnosticEffect[];
  readonly evidence: 'complete' | 'legacy_partial';
}

export interface MachineDiagnosticView<
  TMachineType extends string,
  TStateProjection extends object,
  TCorrelation extends object,
> {
  readonly identity: MachineIdentity<TMachineType>;
  readonly currentRevision: number;
  readonly currentState: TStateProjection;
  readonly selectedWorkCorrelation: TCorrelation;
  readonly pendingEffects: readonly MachineDiagnosticEffect[];
  readonly transitionHistory: readonly MachineDiagnosticTransition<TStateProjection>[];
}

/** Builds a read-only, payload-minimized view over one durable machine instance. */
export class MachineDiagnosticReader<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TStateProjection extends object,
  TCorrelation extends object,
> {
  public constructor(
    private readonly store: MachineStateStore<TMachineType, TState, TContext, TEffect, TOutcome>,
    private readonly projectState: (state: TState) => TStateProjection,
    private readonly projectCorrelation: (context: TContext) => TCorrelation,
  ) {}

  public async inspect(
    instanceId: string,
  ): Promise<MachineDiagnosticView<TMachineType, TStateProjection, TCorrelation> | null> {
    const stored = await this.store.findByInstanceId(instanceId);
    if (!stored) return null;

    const effects = stored.effects.map((effect): MachineDiagnosticEffect => {
      const outcomeWasAdmitted = stored.acceptedIngress.has(
        effectOutcomeIngressId(effect.effectId),
      );
      return {
        effectId: effect.effectId,
        declaredRevision: effect.revision,
        effectType: effect.effect.type,
        status: effect.status,
        settlementStatus: effect.status === 'settled' ? effect.settlement.status : null,
        outcomeType: effect.status === 'settled' ? effect.settlement.outcome.type : null,
        outcomeAdmission:
          effect.status !== 'settled' ? 'not_settled' : outcomeWasAdmitted ? 'applied' : 'pending',
      };
    });
    const effectById = new Map(effects.map((effect) => [effect.effectId, effect]));

    return {
      identity: stored.snapshot.identity,
      currentRevision: stored.snapshot.revision,
      currentState: this.projectState(stored.snapshot.state),
      selectedWorkCorrelation: this.projectCorrelation(stored.snapshot.context),
      pendingEffects: effects.filter(({ outcomeAdmission }) => outcomeAdmission !== 'applied'),
      transitionHistory: stored.transitionHistory.map((transition) => {
        const committed = transition.disposition.status === 'committed';
        return {
          sequence: transition.sequence,
          ingressId: transition.ingressId,
          eventType: transition.eventType,
          priorRevision: transition.priorRevision,
          revision: transition.revision,
          priorState:
            transition.priorState === null ? null : this.projectState(transition.priorState),
          disposition: committed ? 'transition_committed' : 'no_transition',
          reason: committed ? null : transition.disposition.reason,
          committedNextState:
            transition.nextState === null ? null : this.projectState(transition.nextState),
          effects: committed
            ? transition.disposition.effectIds.flatMap((effectId) => {
                const effect = effectById.get(effectId);
                return effect ? [effect] : [];
              })
            : [],
          evidence: transition.evidence,
        };
      }),
    };
  }
}
