import { UnauthorizedException } from '@nestjs/common';
import { ControllerManagementService } from '../controller-management.service';
import {
  ControllerManagementMachineRevokedException,
  ControllerManagementWrongOwnerException,
} from '../../../common/exceptions/controller-management.exceptions';
import { MachineId, UserId } from '../../../types';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const USER_ID = '00000000-0000-4000-8000-000000000002' as UserId;
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000003' as UserId;
const CONTROLLER_ROW_ID = '00000000-0000-4000-8000-000000000004';
const CONTROLLER_ID = 'controller_1';

const makeController = (overrides: Record<string, unknown> = {}) => ({
  id: CONTROLLER_ROW_ID,
  credentialId: CONTROLLER_ID,
  credentialPublicKeyX: Buffer.alloc(32, 1),
  credentialPublicKeyY: Buffer.alloc(32, 2),
  controllerLabel: 'Browser passkey',
  credentialFingerprint: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  createdAt: new Date('2026-08-16T10:00:00.000Z'),
  lastUsedAt: null,
  credentialBackupEligible: true,
  credentialBackupState: false,
  revokedAt: null as Date | null,
  ...overrides,
});

const makeMachine = (controller = makeController()) => ({
  id: MACHINE_ID,
  userId: USER_ID,
  organizationId: '00000000-0000-4000-8000-000000000005',
  publicKey: 'machine-public-key',
  authorizationProtocolVersion: 2,
  authorizationState: 'READY' as const,
  revokedAt: null as Date | null,
  controllerCredentials: [controller],
});

describe('ControllerManagementService', () => {
  it('returns only generated controller disclosure fields for an owned machine', async () => {
    const machine = makeMachine();
    const prisma = {
      db: {
        machine: {
          findUnique: jest.fn().mockResolvedValue(machine),
        },
      },
    };
    const readiness = {
      resolve: jest.fn().mockResolvedValue({
        machineId: MACHINE_ID,
        authorizationProtocolVersion: 2,
        executionReadiness: 'READY',
      }),
    };
    const service = new ControllerManagementService(
      prisma as never,
      {} as never,
      readiness as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listMachineControllers(USER_ID, MACHINE_ID),
    ).resolves.toEqual({
      machineId: MACHINE_ID,
      authorizationProtocolVersion: 2,
      enrollmentState: 'READY',
      executionReadiness: 'READY',
      controllers: [
        {
          credentialId: CONTROLLER_ID,
          controllerCredentialPublicKey: {
            kty: 'EC',
            crv: 'P-256',
            x: Buffer.alloc(32, 1).toString('base64url'),
            y: Buffer.alloc(32, 2).toString('base64url'),
          },
          label: 'Browser passkey',
          fingerprint: 'abcdef0123456789',
          createdAt: '2026-08-16T10:00:00.000Z',
          lastUsedAt: null,
          backupEligible: true,
          backupState: false,
          revocationState: 'ACTIVE',
          revokedAt: null,
        },
      ],
    });
  });

  it('fails closed for a substituted account owner and a revoked machine', async () => {
    const machine = makeMachine();
    const prisma = {
      db: {
        machine: {
          findUnique: jest.fn().mockResolvedValue(machine),
        },
      },
    };
    const service = new ControllerManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listMachineControllers(OTHER_USER_ID, MACHINE_ID),
    ).rejects.toBeInstanceOf(ControllerManagementWrongOwnerException);

    machine.revokedAt = new Date();
    await expect(
      service.listMachineControllers(USER_ID, MACHINE_ID),
    ).rejects.toBeInstanceOf(ControllerManagementMachineRevokedException);
  });

  it('requires the gateway-issued machine proof challenge and rejects replay', async () => {
    const machine = makeMachine();
    const challenge = Buffer.alloc(32, 7).toString('base64');
    const proof = {
      machineId: MACHINE_ID,
      challenge,
      signature: Buffer.alloc(64, 8).toString('base64'),
    };
    const challengeService = {
      verifyChallengeSignature: jest.fn().mockReturnValue(true),
      consumeControllerProofChallenge: jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false),
    };
    const prisma = {
      db: {
        machine: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({
              userId: USER_ID,
              publicKey: machine.publicKey,
              revokedAt: null,
            })
            .mockResolvedValue(machine),
        },
      },
    };
    const service = new ControllerManagementService(
      prisma as never,
      {
        createExistingMachineControllerEnrollment: jest.fn().mockResolvedValue({
          enrollmentId: '00000000-0000-4000-8000-000000000007',
          machineId: MACHINE_ID,
          deviceSecret: 'device-secret',
          userCode: 'BCDFG-HJKLM',
          expiresAt: '2026-08-17T00:05:00.000Z',
          pollingIntervalSeconds: 5,
        }),
      } as never,
      {} as never,
      challengeService as never,
      {} as never,
      {} as never,
    );

    const params = {
      machineId: MACHINE_ID,
      machine: { machineId: MACHINE_ID, userId: USER_ID },
      input: { authorizationProtocolVersion: 2 as const, machineProof: proof },
      sourceAddress: '192.0.2.10',
    };

    await expect(
      service.createExistingMachineControllerEnrollment(params),
    ).resolves.toMatchObject({ machineId: MACHINE_ID });
    await expect(
      service.createExistingMachineControllerEnrollment(params),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(challengeService.consumeControllerProofChallenge).toHaveBeenCalledTimes(
      2,
    );
  });

  it('returns revoked controller credential IDs as a JSON array', async () => {
    const machine = makeMachine(
      makeController({ revokedAt: new Date('2026-08-18T00:00:00.000Z') }),
    );
    const challenge = Buffer.alloc(32, 7).toString('base64');
    const challengeService = {
      verifyChallengeSignature: jest.fn().mockReturnValue(true),
      consumeControllerProofChallenge: jest.fn().mockReturnValue(true),
    };
    const prisma = {
      db: {
        machine: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({
              userId: USER_ID,
              publicKey: machine.publicKey,
              revokedAt: null,
            })
            .mockResolvedValue(machine),
        },
      },
    };
    const readiness = {
      resolve: jest.fn().mockResolvedValue({
        machineId: MACHINE_ID,
        authorizationProtocolVersion: 2,
        executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED',
      }),
    };
    const service = new ControllerManagementService(
      prisma as never,
      {} as never,
      readiness as never,
      challengeService as never,
      {} as never,
      {} as never,
    );
    const debugLog = jest
      .spyOn((service as any).logger, 'debug')
      .mockImplementation();

    const result = await service.reconcileMachineControllers({
      machineId: MACHINE_ID,
      machine: { machineId: MACHINE_ID, userId: USER_ID },
      input: {
        authorizationProtocolVersion: 2,
        machineProof: {
          machineId: MACHINE_ID,
          challenge,
          signature: Buffer.alloc(64, 8).toString('base64'),
        },
        knownControllerCredentialIds: [CONTROLLER_ID],
      },
    });

    expect(result.revokedControllerCredentialIds).toEqual([CONTROLLER_ID]);
    expect(
      JSON.parse(JSON.stringify(result)).revokedControllerCredentialIds,
    ).toEqual([CONTROLLER_ID]);
    expect(debugLog).toHaveBeenCalledWith(
      'Controller authority reconciliation request received',
      expect.objectContaining({
        knownControllerCredentialIdsRuntimeType: 'array',
        knownControllerCredentialIdCount: 1,
        knownControllerCredentialIds: [CONTROLLER_ID],
      }),
    );
    expect(debugLog).toHaveBeenCalledWith(
      'Controller authority reconciliation response prepared',
      expect.objectContaining({
        executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED',
        revokedControllerCredentialIdsRuntimeType: 'array',
        revokedControllerCredentialIdCount: 1,
        revokedControllerCredentialIds: [CONTROLLER_ID],
      }),
    );
  });

  it('revokes the controller and grants in one transaction, then addresses one reduction frame', async () => {
    const controller = makeController();
    const machine = makeMachine(controller);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      machine: {
        findUnique: jest.fn().mockResolvedValue(machine),
        updateMany: jest.fn(),
      },
      machineControllerCredential: {
        findFirst: jest.fn().mockResolvedValue(controller),
        updateMany: jest.fn().mockImplementation(({ data }) => {
          controller.revokedAt = data.revokedAt;
          return { count: 1 };
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      executionGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      db: {
        machine: {
          findUnique: jest.fn().mockResolvedValue(machine),
        },
        $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const readiness = {
      resolve: jest.fn().mockResolvedValue({
        machineId: MACHINE_ID,
        authorizationProtocolVersion: 2,
        executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED',
      }),
    };
    const signer = {
      signControllerRevocationReduction: jest.fn().mockReturnValue({
        machineId: MACHINE_ID,
        userId: USER_ID,
        controllerCredentialId: CONTROLLER_ID,
        nonce: '00000000-0000-4000-8000-000000000006',
        timestampMs: Date.now(),
        protocolVersion: 2,
        event: {},
        signature: Buffer.alloc(64).toString('base64'),
      }),
    };
    const gateway = {
      emitAuthorityReductionWithAck: jest.fn().mockResolvedValue({
        status: 'APPLIED',
        nonce: '00000000-0000-4000-8000-000000000006',
      }),
    };
    const service = new ControllerManagementService(
      prisma as never,
      {} as never,
      readiness as never,
      {} as never,
      signer as never,
      gateway as never,
    );

    const result = await service.revokeMachineController(
      USER_ID,
      MACHINE_ID,
      CONTROLLER_ID,
    );

    expect(tx.machineControllerCredential.findFirst).toHaveBeenCalledWith({
      where: {
        credentialId: CONTROLLER_ID,
        machineId: MACHINE_ID,
        userId: USER_ID,
      },
      select: { id: true, credentialId: true, revokedAt: true },
    });
    expect(tx.machineControllerCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CONTROLLER_ROW_ID, revokedAt: null },
      }),
    );
    expect(tx.executionGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { controllerCredentialId: CONTROLLER_ROW_ID, revokedAt: null },
      }),
    );
    expect(gateway.emitAuthorityReductionWithAck).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.authority_reduction',
        organizationId: machine.organizationId,
        envelope: expect.objectContaining({
          controllerCredentialId: CONTROLLER_ID,
        }),
      }),
      5_000,
    );
    expect(result).toMatchObject({
      outcome: 'REVOKED',
      machineId: MACHINE_ID,
      controllerCredentialId: CONTROLLER_ID,
      executionReadiness: 'CONTROLLER_ENROLLMENT_REQUIRED',
    });
  });
});
