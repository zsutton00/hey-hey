import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import { toOutcomeEvent } from './outcome-event';
import { MachineRegistry } from './registry';
import { MachineRuntime } from './runtime';
import { MachineStateStore } from './state-store';
import type {
  ClaimedEffect,
  EffectDeclaration,
  EffectOutcome,
  EffectSettlement,
  MachineEvent,
  MachineLogic,
  MachineState,
  RuntimeEventResult,
  SettledEffect,
} from './types';

type EffectRecoveryPolicy<TEffect extends EffectDeclaration, TOutcome extends EffectOutcome> =
  | { readonly strategy: 'retry' }
  | {
      readonly strategy: 'reconcile';
      readonly reconcile: (
        effect: TEffect,
        execution: EffectExecutionIdentity,
      ) => Promise<EffectSettlement<TOutcome>>;
    };

export interface EffectExecutionIdentity {
  readonly machineType: string;
  readonly instanceId: string;
  readonly effectId: string;
}

export interface EffectHandler<TEffect extends EffectDeclaration, TOutcome extends EffectOutcome> {
  readonly execute: (
    effect: TEffect,
    execution: EffectExecutionIdentity,
  ) => Promise<EffectSettlement<TOutcome>>;
  readonly recovery: EffectRecoveryPolicy<TEffect, TOutcome>;
}

export type EffectHandlers<
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> = Readonly<Record<string, EffectHandler<TEffect, TOutcome>>>;

export type EffectRunResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'completed';
      readonly effect: SettledEffect<TMachineType, TEffect, TOutcome>;
      readonly admission: RuntimeEventResult<TMachineType, TState, TContext, TEffect>;
    };

export interface EffectRunnerOptions {
  /** Committed effects executed at once during live processing; defaults to strictly serial. */
  readonly maxConcurrentEffects?: number;
}

/** Owns committed-effect execution, durable settlement, and serialized outcome re-entry. */
export class EffectRunner<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  private acceptingClaims = true;
  private activeDrains = 0;
  private commitGeneration = 0;
  private readonly maxConcurrentEffects: number;
  private stopListeningForEffects: (() => void) | null = null;

  public constructor(
    private readonly store: MachineStateStore<TMachineType, TState, TContext, TEffect, TOutcome>,
    private readonly runtime: MachineRuntime<
      TMachineType,
      TState,
      TEvent,
      TContext,
      TLogic,
      TEffect,
      TOutcome,
      TVerifiedInput
    >,
    private readonly registry: MachineRegistry<
      TMachineType,
      TState,
      TEvent,
      TContext,
      TLogic,
      TEffect,
      TOutcome,
      TVerifiedInput
    >,
    private readonly handlers: EffectHandlers<TEffect, TOutcome>,
    private readonly logger: ServerLogger = NOOP_LOGGER,
    options: EffectRunnerOptions = {},
  ) {
    this.maxConcurrentEffects = Math.max(1, options.maxConcurrentEffects ?? 1);
  }

  public startLiveProcessing(): void {
    if (!this.acceptingClaims) {
      throw new Error('EffectRunner cannot start live processing after claims are stopped.');
    }
    if (this.stopListeningForEffects) return;
    this.stopListeningForEffects = this.runtime.onEffectsCommitted(() => {
      this.commitGeneration += 1;
      while (this.activeDrains < this.maxConcurrentEffects) this.startDrain();
    });
    this.logger.debug('state_machine.effect.live_processing.started', {
      maxConcurrentEffects: this.maxConcurrentEffects,
    });
  }

  public async runNext(): Promise<
    EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>
  > {
    this.logger.debug('state_machine.effect.selection.started');
    const awaitingAdmission = await this.store.findNextSettledEffectAwaitingOutcomeAdmission();
    if (awaitingAdmission) {
      this.logger.debug('state_machine.effect.outcome_reentry.recovered', {
        machineType: awaitingAdmission.identity.machineType,
        instanceId: awaitingAdmission.identity.instanceId,
        effectId: awaitingAdmission.effectId,
        settlementStatus: awaitingAdmission.settlement.status,
      });
      return this.admitOutcome(awaitingAdmission);
    }

    if (!this.acceptingClaims) {
      this.logger.debug('state_machine.effect.selection.stopped');
      return { status: 'idle' };
    }
    const claimed = await this.store.claimNextCommittedEffect(() => this.acceptingClaims);
    if (!claimed) {
      this.logger.debug('state_machine.effect.selection.empty');
      return { status: 'idle' };
    }

    this.logger.debug('state_machine.effect.claim.completed', {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
      effectType: claimed.effect.type,
      revision: claimed.revision,
    });
    const handler = this.handlers[claimed.effect.type];
    if (!handler) {
      throw new Error(`Effect handler ${claimed.effect.type} is not registered.`);
    }
    this.logger.debug('state_machine.effect.handler.started', {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
      effectType: claimed.effect.type,
    });
    let settlement: EffectSettlement<TOutcome>;
    try {
      settlement = await handler.execute(claimed.effect, this.executionIdentity(claimed));
    } catch (error) {
      this.logger.error('state_machine.effect.handler.failed', {
        machineType: claimed.identity.machineType,
        instanceId: claimed.identity.instanceId,
        effectId: claimed.effectId,
        effectType: claimed.effect.type,
        error,
      });
      throw error;
    }
    this.logger.debug('state_machine.effect.handler.completed', {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
      effectType: claimed.effect.type,
      settlementStatus: settlement.status,
      outcomeType: settlement.outcome.type,
    });

    this.logger.debug('state_machine.effect.settlement.started', {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
      settlementStatus: settlement.status,
    });
    const settled = await this.store.settleEffect(claimed.effectId, settlement);
    this.logger.debug('state_machine.effect.settlement.completed', {
      machineType: settled.identity.machineType,
      instanceId: settled.identity.instanceId,
      effectId: settled.effectId,
      settlementStatus: settled.settlement.status,
    });

    return this.admitOutcome(settled);
  }

  public stopClaiming(): void {
    if (!this.acceptingClaims) return;
    this.acceptingClaims = false;
    this.stopListeningForEffects?.();
    this.stopListeningForEffects = null;
    this.logger.debug('state_machine.effect.claims.stopped');
  }

  public async recoverCommitted(
    instanceId: string,
    effectId: string,
  ): Promise<EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>> {
    if (!this.acceptingClaims) return { status: 'idle' };
    const claimed = await this.store.claimEffect(instanceId, effectId, () => this.acceptingClaims);
    if (!claimed) return { status: 'idle' };
    return this.executeClaimed(claimed, false);
  }

  public async recoverClaimed(
    claimed: ClaimedEffect<TMachineType, TEffect>,
  ): Promise<EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>> {
    if (!this.acceptingClaims) return { status: 'idle' };
    return this.executeClaimed(claimed, true);
  }

  public async recoverSettled(
    settled: SettledEffect<TMachineType, TEffect, TOutcome>,
  ): Promise<EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>> {
    return this.admitOutcome(settled);
  }

  public requireHandler(effectType: string): EffectHandler<TEffect, TOutcome> {
    const handler = this.handlers[effectType];
    if (!handler) {
      throw new Error(`Effect handler ${effectType} is not registered.`);
    }
    return handler;
  }

  private startDrain(): void {
    this.activeDrains += 1;
    const progress = { generation: this.commitGeneration };
    void this.drainCommittedEffects(progress)
      .catch((error: unknown) => {
        this.logger.error('state_machine.effect.live_drain.failed', { error });
      })
      .then(() => {
        this.activeDrains -= 1;
        // A commit that landed after this drain's last selection — during a failed
        // selection, or between its final idle check and this release — saw the
        // slot still taken and started no drain; give it one now.
        if (
          this.acceptingClaims &&
          this.stopListeningForEffects &&
          progress.generation !== this.commitGeneration
        ) {
          this.startDrain();
        }
      });
  }

  private async drainCommittedEffects(progress: { generation: number }): Promise<void> {
    for (;;) {
      // A commit observed while this drain found nothing means new work may
      // have landed after its selection; look again rather than exit.
      progress.generation = this.commitGeneration;
      const result = await this.runNext();
      if (result.status === 'idle') {
        if (progress.generation === this.commitGeneration || !this.acceptingClaims) return;
        continue;
      }
      if (result.admission.status === 'rejected') {
        throw new Error(
          `Durable effect outcome admission was rejected for ${result.effect.identity.machineType}/${result.effect.identity.instanceId}/${result.effect.effectId}: ${result.admission.code} — ${result.admission.reason}`,
        );
      }
    }
  }

  private async executeClaimed(
    claimed: ClaimedEffect<TMachineType, TEffect>,
    recoveringClaim: boolean,
  ): Promise<EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>> {
    const handler = this.requireHandler(claimed.effect.type);
    const recovery = handler.recovery;
    this.logger.debug('state_machine.effect.recovery.handler_started', {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
      effectType: claimed.effect.type,
      strategy: recovery.strategy,
      recoveringClaim,
    });
    const settlement =
      recoveringClaim && recovery.strategy === 'reconcile'
        ? await recovery.reconcile(claimed.effect, this.executionIdentity(claimed))
        : await handler.execute(claimed.effect, this.executionIdentity(claimed));
    const settled = await this.store.settleEffect(claimed.effectId, settlement);
    return this.admitOutcome(settled);
  }

  private async admitOutcome(
    settled: SettledEffect<TMachineType, TEffect, TOutcome>,
  ): Promise<EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>> {
    const definition = this.registry.requireDefinition(settled.identity.machineType);
    const outcomeEvent = toOutcomeEvent(definition, settled);
    this.logger.debug('state_machine.effect.outcome_reentry.started', {
      machineType: settled.identity.machineType,
      instanceId: settled.identity.instanceId,
      effectId: settled.effectId,
      eventType: outcomeEvent.event.type,
    });
    const admission = await this.runtime.admit(definition, outcomeEvent);
    this.logger.debug('state_machine.effect.outcome_reentry.completed', {
      machineType: settled.identity.machineType,
      instanceId: settled.identity.instanceId,
      effectId: settled.effectId,
      eventType: outcomeEvent.event.type,
      admissionStatus: admission.status,
    });
    return { status: 'completed', effect: settled, admission };
  }

  private executionIdentity(
    claimed: ClaimedEffect<TMachineType, TEffect>,
  ): EffectExecutionIdentity {
    return {
      machineType: claimed.identity.machineType,
      instanceId: claimed.identity.instanceId,
      effectId: claimed.effectId,
    };
  }
}
