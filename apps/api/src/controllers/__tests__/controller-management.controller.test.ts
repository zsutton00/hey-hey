import { ControllerManagementController } from '../controller-management.controller';
import { MachineId, UserId } from '../../types';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const USER_ID = '00000000-0000-4000-8000-000000000002' as UserId;
const CONTROLLER_ID = 'controller_1';

describe('ControllerManagementController', () => {
  it('keeps the machine-authenticated enrollment boundary thin and path-bound', async () => {
    const service = {
      createExistingMachineControllerEnrollment: jest
        .fn()
        .mockResolvedValue({ machineId: MACHINE_ID }),
    };
    const controller = new ControllerManagementController(service as never);
    const machine = { machineId: MACHINE_ID, userId: USER_ID };
    const body = {
      authorizationProtocolVersion: 2 as const,
      machineProof: {
        machineId: MACHINE_ID,
        challenge: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
        signature:
          'YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI=',
      },
    };
    const request = { ip: '192.0.2.10' };

    await expect(
      controller.createExistingMachineControllerEnrollment(
        MACHINE_ID,
        body,
        machine,
        request as never,
      ),
    ).resolves.toEqual({ machineId: MACHINE_ID });
    expect(
      service.createExistingMachineControllerEnrollment,
    ).toHaveBeenCalledWith({
      machineId: MACHINE_ID,
      machine,
      input: body,
      sourceAddress: request.ip,
    });
  });

  it('passes account identity to inventory and authority-reducing revocation', async () => {
    const service = {
      listMachineControllers: jest.fn().mockResolvedValue({ controllers: [] }),
      revokeMachineController: jest
        .fn()
        .mockResolvedValue({ outcome: 'REVOKED' }),
    };
    const controller = new ControllerManagementController(service as never);

    await controller.listMachineControllers(MACHINE_ID, USER_ID);
    await controller.revokeMachineController(
      MACHINE_ID,
      CONTROLLER_ID,
      USER_ID,
    );

    expect(service.listMachineControllers).toHaveBeenCalledWith(
      USER_ID,
      MACHINE_ID,
    );
    expect(service.revokeMachineController).toHaveBeenCalledWith(
      USER_ID,
      MACHINE_ID,
      CONTROLLER_ID,
    );
  });
});
