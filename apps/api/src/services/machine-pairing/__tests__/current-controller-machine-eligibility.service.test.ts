import { CurrentControllerMachineEligibilityState } from '../../../generated';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineId, UserId } from '../../../types';
import { CurrentControllerMachineEligibilityService } from '../current-controller-machine-eligibility.service';

describe('CurrentControllerMachineEligibilityService', () => {
  const machineA = '00000000-0000-4000-8000-000000000001' as MachineId;
  const machineB = '00000000-0000-4000-8000-000000000002' as MachineId;
  const machineC = '00000000-0000-4000-8000-000000000003' as MachineId;
  const userId = '00000000-0000-4000-8000-000000000010' as UserId;
  const controllerInstallationId = '00000000-0000-4000-8000-000000000099';

  it('classifies active, revoked, and missing bindings independently per machine', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { machineId: machineA, revokedAt: null },
      { machineId: machineB, revokedAt: new Date() },
    ]);
    const service = new CurrentControllerMachineEligibilityService({
      db: { machineControllerCredential: { findMany } },
    } as unknown as PrismaService);

    const result = await service.resolveMany({
      machineIds: [machineA, machineB, machineC],
      userId,
      controllerInstallationId,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        machineId: { in: [machineA, machineB, machineC] },
        userId,
        controllerInstallationId,
      },
      select: { machineId: true, revokedAt: true },
    });
    expect(result.get(machineA)).toBe(
      CurrentControllerMachineEligibilityState.Eligible,
    );
    expect(result.get(machineB)).toBe(
      CurrentControllerMachineEligibilityState.Revoked,
    );
    expect(result.get(machineC)).toBe(
      CurrentControllerMachineEligibilityState.NotEnrolled,
    );
  });

  it('prefers an active credential when an older credential was revoked', async () => {
    const service = new CurrentControllerMachineEligibilityService({
      db: {
        machineControllerCredential: {
          findMany: jest.fn().mockResolvedValue([
            { machineId: machineA, revokedAt: new Date() },
            { machineId: machineA, revokedAt: null },
          ]),
        },
      },
    } as unknown as PrismaService);

    const result = await service.resolveMany({
      machineIds: [machineA],
      userId,
      controllerInstallationId,
    });

    expect(result.get(machineA)).toBe(
      CurrentControllerMachineEligibilityState.Eligible,
    );
  });
});
