import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import { EffectRunner } from './effect-runner';
import { effectOutcomeIngressId } from './outcome-event';
import { MachineRegistry } from './registry';
import {
  MachineStateStore,
  MachineStateStoreCompatibilityError,
  type StoredMachineInstance,
} from './state-store';
import type {
  ClaimedEffect,
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineLogic,
  MachineSnapshot,
  MachineState,
  SettledEffect,
} from './types';
import type { EffectRunResult } from './effect-runner';

export interface MachineRecoveryResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
> {
  readonly snapshots: readonly MachineSnapshot<TMachineType, TState, TContext>[];
}

/** Restores durable machines and drains only policy-authorized restart work. */
export class MachineRecovery<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  private restoration: Promise<MachineRecoveryResult<TMachineType, TState, TContext>> | null = null;

  public constructor(
    private readonly store: MachineStateStore<TMachineType, TState, TContext, TEffect, TOutcome>,
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
    private readonly effectRunner: EffectRunner<
      TMachineType,
      TState,
      TEvent,
      TContext,
      TLogic,
      TEffect,
      TOutcome,
      TVerifiedInput
    >,
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}

  public restore(): Promise<MachineRecoveryResult<TMachineType, TState, TContext>> {
    this.restoration ??= this.restoreOnce().catch((error: unknown) => {
      this.restoration = null;
      throw error;
    });
    return this.restoration;
  }

  private async restoreOnce(): Promise<MachineRecoveryResult<TMachineType, TState, TContext>> {
    this.logger.debug('state_machine.recovery.started');
    let instances: readonly StoredMachineInstance<
      TMachineType,
      TState,
      TContext,
      TEffect,
      TOutcome
    >[];
    try {
      ({ instances } = await this.store.recoverInstances());
    } catch (error) {
      if (error instanceof MachineStateStoreCompatibilityError) {
        this.logger.error('state_machine.recovery.compatibility_failed', {
          ...error.diagnostic,
          commandDeliveryAvailable: false,
        });
      }
      throw error;
    }
    for (const instance of instances) {
      this.registry.requireDefinition(instance.snapshot.identity.machineType);
    }
    await Promise.all(instances.map((instance) => this.restoreInstance(instance)));
    this.logger.info('state_machine.recovery.completed', {
      instanceCount: instances.length,
    });
    return { snapshots: instances.map((instance) => instance.snapshot) };
  }

  private async restoreInstance(
    instance: StoredMachineInstance<TMachineType, TState, TContext, TEffect, TOutcome>,
  ): Promise<void> {
    const { identity, revision, state } = instance.snapshot;
    this.logger.debug('state_machine.recovery.instance_started', {
      machineType: identity.machineType,
      instanceId: identity.instanceId,
      revision,
      state,
      effectCount: instance.effects.length,
    });

    let current = instance;
    for (;;) {
      const effect = current.effects.find(
        (candidate) =>
          candidate.status !== 'settled' ||
          !current.acceptedIngress.has(effectOutcomeIngressId(candidate.effectId)),
      );
      if (!effect) break;
      if (effect.status === 'settled') {
        const settled: SettledEffect<TMachineType, TEffect, TOutcome> = {
          ...effect,
          identity,
          status: 'settled',
        };
        this.assertRecovered(await this.effectRunner.recoverSettled(settled), effect.effectId);
      } else if (effect.status === 'committed') {
        this.effectRunner.requireHandler(effect.effect.type);
        this.assertRecovered(
          await this.effectRunner.recoverCommitted(identity.instanceId, effect.effectId),
          effect.effectId,
        );
      } else {
        this.effectRunner.requireHandler(effect.effect.type);
        const claimed: ClaimedEffect<TMachineType, TEffect> = {
          ...effect,
          identity,
          status: 'claimed',
        };
        this.assertRecovered(await this.effectRunner.recoverClaimed(claimed), effect.effectId);
      }
      const reloaded = await this.store.findByInstanceId(identity.instanceId);
      if (!reloaded) {
        throw new Error(`Machine instance ${identity.instanceId} disappeared during recovery.`);
      }
      current = reloaded;
    }
    this.logger.debug('state_machine.recovery.instance_completed', {
      machineType: identity.machineType,
      instanceId: identity.instanceId,
      revision,
    });
  }

  private assertRecovered(
    result: EffectRunResult<TMachineType, TState, TContext, TEffect, TOutcome>,
    effectId: string,
  ): void {
    if (result.status === 'idle') {
      throw new Error(`Effect ${effectId} could not be recovered because claims are stopped.`);
    }
    if (result.admission.status === 'rejected') {
      throw new Error(
        `Effect ${effectId} outcome was rejected during recovery: ${result.admission.reason}`,
      );
    }
  }
}
