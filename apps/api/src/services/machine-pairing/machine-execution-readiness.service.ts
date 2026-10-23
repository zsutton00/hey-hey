import { Injectable } from '@nestjs/common';
import { MachinePresenceService } from '../../core/websockets/machine-presence.service';
import {
  AuthorizationProtocolVersion,
  MachineExecutionReadinessState,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { MachineId, OrganizationId, UserId } from '../../types';

export interface MachineExecutionReadiness {
  machineId: MachineId;
  authorizationProtocolVersion: AuthorizationProtocolVersion;
  executionReadiness: MachineExecutionReadinessState;
}

@Injectable()
export class MachineExecutionReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly machinePresenceService: MachinePresenceService,
  ) {}

  async resolve(params: {
    machineId: MachineId;
    userId: UserId;
    organizationId?: OrganizationId;
  }): Promise<MachineExecutionReadiness | null> {
    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: params.machineId,
        userId: params.userId,
        ...(params.organizationId
          ? { organizationId: params.organizationId }
          : {}),
      },
      select: {
        id: true,
        authorizationProtocolVersion: true,
        authorizationState: true,
        revokedAt: true,
        controllerCredentials: { select: { revokedAt: true } },
      },
    });
    if (!machine) return null;

    const authorizationProtocolVersion: AuthorizationProtocolVersion =
      machine.authorizationProtocolVersion === 2 ? 2 : 1;
    let executionReadiness: MachineExecutionReadinessState;
    if (machine.revokedAt) {
      executionReadiness = MachineExecutionReadinessState.MachineRevoked;
    } else if (authorizationProtocolVersion !== 2) {
      executionReadiness = MachineExecutionReadinessState.LegacyProtocol;
    } else if (machine.authorizationState !== 'READY') {
      executionReadiness =
        MachineExecutionReadinessState.ControllerEnrollmentRequired;
    } else if (machine.controllerCredentials.length === 0) {
      executionReadiness =
        MachineExecutionReadinessState.ControllerEnrollmentRequired;
    } else if (
      machine.controllerCredentials.every((credential) => credential.revokedAt)
    ) {
      executionReadiness = MachineExecutionReadinessState.ControllerRevoked;
    } else if (
      !(await this.machinePresenceService.isPresent(machine.id as MachineId))
    ) {
      executionReadiness = MachineExecutionReadinessState.Disconnected;
    } else {
      executionReadiness = MachineExecutionReadinessState.Ready;
    }

    return {
      machineId: machine.id as MachineId,
      authorizationProtocolVersion,
      executionReadiness,
    };
  }
}
