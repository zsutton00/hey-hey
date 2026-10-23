import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import type { MachineDefinition } from './definition';
import { MachineRuntime } from './runtime';
import type {
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineIdentity,
  MachineLogic,
  MachineState,
  RuntimeEventResult,
} from './types';

export class DuplicateMachineDefinitionError extends Error {
  public constructor(machineType: string) {
    super(`Machine definition ${machineType} is already registered.`);
    this.name = 'DuplicateMachineDefinitionError';
  }
}

/** Owns supported definitions and routes verified addressed inputs into the runtime. */
export class MachineRegistry<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  private readonly definitions = new Map<
    TMachineType,
    MachineDefinition<
      TMachineType,
      TState,
      TEvent,
      TContext,
      TLogic,
      TEffect,
      TOutcome,
      TVerifiedInput
    >
  >();
  private readonly runtime: MachineRuntime<
    TMachineType,
    TState,
    TEvent,
    TContext,
    TLogic,
    TEffect,
    TOutcome,
    TVerifiedInput
  >;
  private readonly logger: ServerLogger;

  public constructor(
    runtime: MachineRuntime<
      TMachineType,
      TState,
      TEvent,
      TContext,
      TLogic,
      TEffect,
      TOutcome,
      TVerifiedInput
    >,
    logger: ServerLogger = NOOP_LOGGER,
  ) {
    this.runtime = runtime;
    this.logger = logger;
  }

  public register(
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
  ): void {
    if (this.definitions.has(definition.machineType)) {
      this.logger.debug('state_machine.registry.registration.duplicate', {
        machineType: definition.machineType,
      });
      throw new DuplicateMachineDefinitionError(definition.machineType);
    }
    this.definitions.set(definition.machineType, definition);
    this.logger.debug('state_machine.registry.registration.completed', {
      machineType: definition.machineType,
    });
  }

  public requireDefinition(
    machineType: TMachineType,
  ): MachineDefinition<
    TMachineType,
    TState,
    TEvent,
    TContext,
    TLogic,
    TEffect,
    TOutcome,
    TVerifiedInput
  > {
    const definition = this.definitions.get(machineType);
    if (!definition) {
      throw new Error(`Machine definition ${machineType} is not registered.`);
    }
    return definition;
  }

  public async admit(
    identity: MachineIdentity<TMachineType>,
    ingressId: string,
    input: TVerifiedInput,
  ): Promise<RuntimeEventResult<TMachineType, TState, TContext, TEffect>> {
    const { machineType } = identity;
    const definition = this.definitions.get(machineType);
    if (!definition) {
      this.logger.debug('state_machine.registry.admission.unknown_definition', { machineType });
      return {
        status: 'rejected',
        code: 'unknown_machine_type',
        reason: `Machine type ${machineType} is not registered.`,
      };
    }

    const admission = definition.admitVerifiedInput(input);
    if (admission.status === 'rejected') {
      this.logger.debug('state_machine.registry.admission.input_rejected', {
        machineType,
        reason: admission.reason,
      });
      return { status: 'rejected', code: 'input_rejected', reason: admission.reason };
    }
    if (
      admission.identity.machineType !== identity.machineType ||
      admission.identity.instanceId !== identity.instanceId
    ) {
      this.logger.debug('state_machine.registry.admission.identity_mismatch', {
        addressedMachineType: identity.machineType,
        addressedInstanceId: identity.instanceId,
        admittedMachineType: admission.identity.machineType,
        admittedInstanceId: admission.identity.instanceId,
      });
      return {
        status: 'rejected',
        code: 'identity_mismatch',
        reason: `Definition ${machineType} mapped input to ${admission.identity.machineType}/${admission.identity.instanceId}, not the addressed ${identity.machineType}/${identity.instanceId}.`,
      };
    }

    if (admission.ingressId !== ingressId) {
      this.logger.debug('state_machine.registry.admission.ingress_identity_mismatch', {
        machineType,
        instanceId: identity.instanceId,
        addressedIngressId: ingressId,
        admittedIngressId: admission.ingressId,
      });
      return {
        status: 'rejected',
        code: 'ingress_identity_mismatch',
        reason: `Definition ${machineType} mapped input to ingress ${admission.ingressId}, not the addressed ingress ${ingressId}.`,
      };
    }

    return this.runtime.admit(definition, admission);
  }
}
