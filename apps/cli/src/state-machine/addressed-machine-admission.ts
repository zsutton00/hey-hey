import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import type { MachineRegistry } from './registry';
import type {
  AddressedMachineAdmissionInput,
  EffectDeclaration,
  EffectOutcome,
  MachineEvent,
  MachineLogic,
  MachineState,
  RuntimeEventResult,
} from './types';

/** Owns transport-neutral, explicitly addressed admission into a durable machine registry. */
export class AddressedMachineAdmission<
  TMachineType extends string,
  TState extends MachineState,
  TEvent extends MachineEvent,
  TContext extends object,
  TLogic extends MachineLogic,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
  TVerifiedInput,
> {
  public constructor(
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
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}

  public async admit(
    input: AddressedMachineAdmissionInput<TMachineType, TVerifiedInput>,
  ): Promise<RuntimeEventResult<TMachineType, TState, TContext, TEffect>> {
    this.logger.debug('state_machine.addressed_admission.started', {
      machineType: input.identity.machineType,
      instanceId: input.identity.instanceId,
      ingressId: input.ingressId,
    });
    const result = await this.registry.admit(input.identity, input.ingressId, input.verifiedInput);
    this.logger.debug('state_machine.addressed_admission.completed', {
      machineType: input.identity.machineType,
      instanceId: input.identity.instanceId,
      ingressId: input.ingressId,
      status: result.status,
      ...(result.status === 'rejected' ? { code: result.code } : {}),
    });
    return result;
  }
}
