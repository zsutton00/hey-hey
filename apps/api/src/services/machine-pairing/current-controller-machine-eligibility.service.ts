import { Injectable } from '@nestjs/common';
import { CurrentControllerMachineEligibilityState } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { MachineId, UserId } from '../../types';

@Injectable()
export class CurrentControllerMachineEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMany(params: {
    machineIds: readonly MachineId[];
    userId: UserId;
    controllerInstallationId: string;
  }): Promise<Map<MachineId, CurrentControllerMachineEligibilityState>> {
    const result = new Map<MachineId, CurrentControllerMachineEligibilityState>(
      params.machineIds.map((machineId) => [
        machineId,
        CurrentControllerMachineEligibilityState.NotEnrolled,
      ]),
    );
    if (params.machineIds.length === 0) return result;

    const credentials =
      await this.prisma.db.machineControllerCredential.findMany({
        where: {
          machineId: { in: [...params.machineIds] },
          userId: params.userId,
          controllerInstallationId: params.controllerInstallationId,
        },
        select: { machineId: true, revokedAt: true },
      });

    for (const credential of credentials) {
      const machineId = credential.machineId as MachineId;
      if (!credential.revokedAt) {
        result.set(
          machineId,
          CurrentControllerMachineEligibilityState.Eligible,
        );
      } else if (
        result.get(machineId) !==
        CurrentControllerMachineEligibilityState.Eligible
      ) {
        result.set(machineId, CurrentControllerMachineEligibilityState.Revoked);
      }
    }

    return result;
  }

  async resolveSelectableCredentialIds(params: {
    machineIds: readonly MachineId[];
    userId: UserId;
    boundControllerCredentialId?: string;
  }): Promise<Map<MachineId, string | null>> {
    const result = new Map<MachineId, string | null>(
      params.machineIds.map((machineId) => [machineId, null]),
    );
    if (params.machineIds.length === 0) return result;

    const credentials =
      await this.prisma.db.machineControllerCredential.findMany({
        where: {
          machineId: { in: [...params.machineIds] },
          userId: params.userId,
          revokedAt: null,
          controllerInstallationId: { not: null },
        },
        select: { id: true, credentialId: true, machineId: true },
      });
    const byMachine = new Map<MachineId, typeof credentials>();
    for (const credential of credentials) {
      const machineId = credential.machineId as MachineId;
      byMachine.set(machineId, [
        ...(byMachine.get(machineId) ?? []),
        credential,
      ]);
    }
    for (const machineId of params.machineIds) {
      const candidates = byMachine.get(machineId) ?? [];
      const bound = params.boundControllerCredentialId
        ? candidates.find(
            (credential) =>
              credential.id === params.boundControllerCredentialId,
          )
        : undefined;
      if (bound) {
        result.set(machineId, bound.credentialId);
      } else if (candidates.length === 1) {
        result.set(machineId, candidates[0]!.credentialId);
      }
    }
    return result;
  }
}
