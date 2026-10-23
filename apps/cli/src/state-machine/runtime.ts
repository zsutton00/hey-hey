import {
  initialTransition,
  transition as evaluateXStateTransition,
  type SnapshotFrom,
  type StateFrom,
} from 'xstate';

import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import type { MachineDefinition } from './definition';
import { MachineStateStore } from './state-store';
import type {
  AcceptedEventResult,
  AdmittedEvent,
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineLogic,
  MachineLogicAction,
  MachineSnapshot,
  MachineState,
  ReplayedEventResult,
  RuntimeEventResult,
} from './types';

/** Serializes and durably commits pure state-machine transitions. */
export class MachineRuntime<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  private readonly store: MachineStateStore<TMachineType, TState, TContext, TEffect, TOutcome>;
  private readonly logger: ServerLogger;
  private readonly instanceTails = new Map<string, Promise<void>>();
  private readonly effectsCommittedListeners = new Set<() => void>();
  private readonly allTransitionCommittedListeners = new Set<
    (snapshot: MachineSnapshot<TMachineType, TState, TContext>) => void
  >();
  private readonly transitionCommittedListeners = new Map<
    string,
    Set<(snapshot: MachineSnapshot<TMachineType, TState, TContext>) => void>
  >();

  public constructor(
    store: MachineStateStore<TMachineType, TState, TContext, TEffect, TOutcome>,
    logger: ServerLogger = NOOP_LOGGER,
  ) {
    this.store = store;
    this.logger = logger;
  }

  public async admit(
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
    admitted: AdmittedEvent<TMachineType, TEvent>,
  ): Promise<RuntimeEventResult<TMachineType, TState, TContext, TEffect>> {
    this.logger.debug('state_machine.runtime.admission.received', {
      machineType: admitted.identity.machineType,
      instanceId: admitted.identity.instanceId,
      ingressId: admitted.ingressId,
      eventType: admitted.event.type,
    });

    return this.runSerial(admitted.identity.instanceId, async () => {
      const stored = await this.store.findByInstanceId(admitted.identity.instanceId);
      if (stored && stored.snapshot.identity.machineType !== admitted.identity.machineType) {
        this.logger.debug('state_machine.runtime.admission.identity_mismatch', {
          requestedMachineType: admitted.identity.machineType,
          persistedMachineType: stored.snapshot.identity.machineType,
          instanceId: admitted.identity.instanceId,
          ingressId: admitted.ingressId,
        });
        return {
          status: 'rejected',
          code: 'identity_mismatch',
          reason: `Machine instance ${admitted.identity.instanceId} belongs to ${stored.snapshot.identity.machineType}, not ${admitted.identity.machineType}.`,
        };
      }

      const previous = stored?.acceptedIngress.get(admitted.ingressId);
      if (previous) {
        const replay: ReplayedEventResult<TMachineType, TState, TContext, TEffect> = {
          status: 'replayed',
          ingressId: previous.ingressId,
          snapshot: previous.snapshot,
          effects: previous.effects,
        };
        this.logger.debug('state_machine.runtime.admission.replayed', {
          machineType: admitted.identity.machineType,
          instanceId: admitted.identity.instanceId,
          ingressId: admitted.ingressId,
          revision: previous.snapshot.revision,
          effectCount: previous.effects.length,
        });
        return replay;
      }
      const previousNoTransition = stored?.transitionHistory.find(
        ({ ingressId, disposition }) =>
          ingressId === admitted.ingressId && disposition.status === 'no_transition',
      );
      if (previousNoTransition?.disposition.status === 'no_transition') {
        this.logger.debug('state_machine.runtime.admission.no_transition_replayed', {
          machineType: admitted.identity.machineType,
          instanceId: admitted.identity.instanceId,
          ingressId: admitted.ingressId,
          revision: previousNoTransition.revision,
        });
        return {
          status: 'rejected',
          code: 'transition_rejected',
          reason: previousNoTransition.disposition.reason,
        };
      }

      let initialSnapshot: StateFrom<TLogic>;
      let initialActions: MachineLogicAction<TLogic>[];
      if (stored) {
        initialSnapshot = definition.machine.resolveState({
          value: stored.snapshot.state,
          context: stored.snapshot.context,
        }) as StateFrom<TLogic>;
        initialActions = [];
      } else {
        const [createdSnapshot, createdActions] = initialTransition(
          definition.machine,
          definition.createInitialInput(admitted.identity),
        );
        initialSnapshot = createdSnapshot;
        initialActions = createdActions;
      }
      const snapshot: MachineSnapshot<TMachineType, TState, TContext> = stored?.snapshot ?? {
        identity: admitted.identity,
        revision: 0,
        ...definition.readSnapshot(initialSnapshot),
      };

      this.logger.debug('state_machine.runtime.transition.evaluating', {
        machineType: admitted.identity.machineType,
        instanceId: admitted.identity.instanceId,
        ingressId: admitted.ingressId,
        currentRevision: snapshot.revision,
        isInitialEvent: stored === null,
      });
      const xstateEvent = definition.toXStateEvent(admitted.event);
      const [evaluatedSnapshot, transitionActions] = evaluateXStateTransition(
        definition.machine,
        initialSnapshot as SnapshotFrom<TLogic>,
        xstateEvent,
      );
      const nextXStateSnapshot = evaluatedSnapshot as StateFrom<TLogic>;
      const transitionChangedSnapshot = nextXStateSnapshot !== initialSnapshot;
      const candidateTransitions =
        transitionChangedSnapshot || transitionActions.length > 0
          ? [true]
          : definition.machine.getTransitionData(initialSnapshot, xstateEvent);
      if (candidateTransitions.length === 0) {
        const code = stored ? 'transition_rejected' : 'unsupported_initial_event';
        const reason = `Event ${admitted.event.type} is not accepted from the current state.`;
        this.logger.debug('state_machine.runtime.transition.rejected', {
          machineType: admitted.identity.machineType,
          instanceId: admitted.identity.instanceId,
          ingressId: admitted.ingressId,
          code,
          reason,
        });
        if (stored) {
          await this.store.recordNoTransition({
            expectedRevision: snapshot.revision,
            identity: admitted.identity,
            ingressId: admitted.ingressId,
            eventType: admitted.event.type,
            snapshot,
            reason,
          });
          this.logger.debug('state_machine.runtime.transition.no_transition_recorded', {
            machineType: admitted.identity.machineType,
            instanceId: admitted.identity.instanceId,
            ingressId: admitted.ingressId,
            revision: snapshot.revision,
          });
        }
        return { status: 'rejected', code, reason };
      }

      const effects = [...initialActions, ...transitionActions].flatMap((action) => {
        const effect = definition.effectFromAction(action);
        return effect === null ? [] : [effect];
      });

      const nextSnapshot: MachineSnapshot<TMachineType, TState, TContext> = {
        identity: admitted.identity,
        revision: snapshot.revision + 1,
        ...definition.readSnapshot(nextXStateSnapshot),
      };
      const accepted: AcceptedEventResult<TMachineType, TState, TContext, TEffect> = {
        status: 'accepted',
        ingressId: admitted.ingressId,
        snapshot: nextSnapshot,
        effects,
      };

      this.logger.debug('state_machine.runtime.commit.started', {
        machineType: admitted.identity.machineType,
        instanceId: admitted.identity.instanceId,
        ingressId: admitted.ingressId,
        expectedRevision: stored?.snapshot.revision ?? null,
        nextRevision: nextSnapshot.revision,
        effectCount: accepted.effects.length,
      });
      await this.store.commit({
        expectedRevision: stored?.snapshot.revision ?? null,
        eventType: admitted.event.type,
        priorRevision: snapshot.revision,
        priorState: snapshot.state,
        result: accepted,
      });
      this.logger.debug('state_machine.runtime.commit.completed', {
        machineType: admitted.identity.machineType,
        instanceId: admitted.identity.instanceId,
        ingressId: admitted.ingressId,
        revision: nextSnapshot.revision,
        effectCount: accepted.effects.length,
      });
      for (const listener of [
        ...this.allTransitionCommittedListeners,
        ...(this.transitionCommittedListeners.get(admitted.identity.instanceId) ?? []),
      ]) {
        listener(nextSnapshot);
      }
      if (accepted.effects.length > 0) {
        for (const listener of this.effectsCommittedListeners) listener();
      }
      return accepted;
    });
  }

  public onEffectsCommitted(listener: () => void): () => void {
    this.effectsCommittedListeners.add(listener);
    return () => {
      this.effectsCommittedListeners.delete(listener);
    };
  }

  /** Observes durable commits; null subscribes to every instance. */
  public onTransitionCommitted(
    instanceId: string | null,
    listener: (snapshot: MachineSnapshot<TMachineType, TState, TContext>) => void,
  ): () => void {
    if (instanceId === null) {
      this.allTransitionCommittedListeners.add(listener);
      return () => {
        this.allTransitionCommittedListeners.delete(listener);
      };
    }
    let listeners = this.transitionCommittedListeners.get(instanceId);
    if (!listeners) {
      listeners = new Set();
      this.transitionCommittedListeners.set(instanceId, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.transitionCommittedListeners.get(instanceId);
      current?.delete(listener);
      if (current?.size === 0) this.transitionCommittedListeners.delete(instanceId);
    };
  }

  private async runSerial<T>(instanceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.instanceTails.get(instanceId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.instanceTails.set(instanceId, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.instanceTails.get(instanceId) === current) {
        this.instanceTails.delete(instanceId);
      }
    }
  }
}
