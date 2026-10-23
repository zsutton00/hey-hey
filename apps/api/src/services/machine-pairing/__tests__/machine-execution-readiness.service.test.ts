import { MachineExecutionReadinessState } from '../../../generated';
import { MachineId, UserId } from '../../../types';
import { MachineExecutionReadinessService } from '../machine-execution-readiness.service';

const machineId = '11111111-1111-4111-8111-111111111111' as MachineId;
const userId = '22222222-2222-4222-8222-222222222222' as UserId;

describe('MachineExecutionReadinessService', () => {
  const findFirst = jest.fn();
  const isPresent = jest.fn();
  const service = new MachineExecutionReadinessService(
    { db: { machine: { findFirst } } } as never,
    { isPresent } as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    isPresent.mockResolvedValue(true);
  });

  it.each([
    [
      'legacy protocol',
      { authorizationProtocolVersion: 1, revokedAt: null, credentials: [] },
      MachineExecutionReadinessState.LegacyProtocol,
    ],
    [
      'controller enrollment required',
      { authorizationProtocolVersion: 2, revokedAt: null, credentials: [] },
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
    ],
    [
      'controller revoked',
      {
        authorizationProtocolVersion: 2,
        revokedAt: null,
        credentials: [{ revokedAt: new Date() }],
      },
      MachineExecutionReadinessState.ControllerRevoked,
    ],
    [
      'machine revoked',
      {
        authorizationProtocolVersion: 2,
        revokedAt: new Date(),
        credentials: [{ revokedAt: null }],
      },
      MachineExecutionReadinessState.MachineRevoked,
    ],
  ])('derives %s from durable state', async (_label, row, expected) => {
    findFirst.mockResolvedValue({
      id: machineId,
      authorizationProtocolVersion: row.authorizationProtocolVersion,
      authorizationState: 'READY',
      revokedAt: row.revokedAt,
      controllerCredentials: row.credentials,
    });

    await expect(service.resolve({ machineId, userId })).resolves.toEqual({
      machineId,
      authorizationProtocolVersion:
        row.authorizationProtocolVersion === 2 ? 2 : 1,
      executionReadiness: expected,
    });
  });

  it.each([
    [false, MachineExecutionReadinessState.Disconnected],
    [true, MachineExecutionReadinessState.Ready],
  ])('derives presence=%s', async (present, expected) => {
    findFirst.mockResolvedValue({
      id: machineId,
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
      revokedAt: null,
      controllerCredentials: [{ revokedAt: null }],
    });
    isPresent.mockResolvedValue(present);

    await expect(service.resolve({ machineId, userId })).resolves.toEqual({
      machineId,
      authorizationProtocolVersion: 2,
      executionReadiness: expected,
    });
  });

  it.each(['LEGACY', 'CONTROLLER_ENROLLMENT_REQUIRED'])(
    'does not report READY while persisted authorization state is %s',
    async (authorizationState) => {
      findFirst.mockResolvedValue({
        id: machineId,
        authorizationProtocolVersion: 2,
        authorizationState,
        revokedAt: null,
        controllerCredentials: [{ revokedAt: null }],
      });

      await expect(service.resolve({ machineId, userId })).resolves.toEqual({
        machineId,
        authorizationProtocolVersion: 2,
        executionReadiness:
          MachineExecutionReadinessState.ControllerEnrollmentRequired,
      });
      expect(isPresent).not.toHaveBeenCalled();
    },
  );
});
