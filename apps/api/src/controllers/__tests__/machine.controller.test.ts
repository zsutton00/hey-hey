import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MachineController } from '../machine.controller';
import { ServerSigningKeyService } from '../../core/server-signing/server-signing-key.service';
import { MachinePresenceService } from '../../core/websockets/machine-presence.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import {
  AuthenticatedMachine,
  MachinePairingService,
} from '../../services/machine-pairing/machine-pairing.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MachineSecurityEventService } from '../../services/machine-security-events/machine-security-event.service';
import { MachineExecutionReadinessService } from '../../services/machine-pairing/machine-execution-readiness.service';
import { CurrentControllerMachineEligibilityService } from '../../services/machine-pairing/current-controller-machine-eligibility.service';
import { ControllerBrowserBindingService } from '../../services/controller-authorization/controller-browser-binding.service';
import { MachineId, UserId } from '../../types';
import { MachineSecurityEventType } from '../../generated';
import { Request } from 'express';
import * as TestUtils from '../../utils/testUtils';
import {
  LegacyMachinePairingRetiredException,
  PairingAttemptsExceededException,
  PairingCodeAlreadyUsedException,
  PairingCodeExpiredException,
} from '../../common/exceptions/pairing.exceptions';

const { testIds } = TestUtils;

const TEST_USER: AuthenticatedUser = {
  userId: testIds.user as UserId,
  email: 'tester@example.com',
} as AuthenticatedUser;

const TEST_MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const TEST_CONTROLLER_INSTALLATION_ID = '00000000-0000-4000-8000-000000000099';
const TEST_REQUEST = {
  cookies: { hey_hey_controller_binding: 'secret' },
} as unknown as Request;

const TEST_SERVER_PUBLIC_KEY_BASE64 =
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

describe('MachineController', () => {
  let controller: MachineController;
  let service: jest.Mocked<MachinePairingService>;
  let serverSigningKeyService: jest.Mocked<ServerSigningKeyService>;
  let presenceService: jest.Mocked<
    Pick<MachinePresenceService, 'isPresent' | 'getBindings'>
  >;
  const readinessService = {
    resolve: jest.fn().mockImplementation(({ machineId }) =>
      Promise.resolve({
        machineId,
        authorizationProtocolVersion: 2,
        executionReadiness: 'READY',
      }),
    ),
  };
  const controllerEligibilityService = {
    resolveMany: jest
      .fn()
      .mockImplementation(({ machineIds }: { machineIds: MachineId[] }) =>
        Promise.resolve(
          new Map(machineIds.map((machineId) => [machineId, 'ELIGIBLE'])),
        ),
      ),
    resolveSelectableCredentialIds: jest.fn().mockResolvedValue(new Map()),
  };
  const controllerBrowserBindingService = {
    resolveInventory: jest.fn().mockResolvedValue({
      hasIdentity: true,
      bindings: [
        {
          machineId: TEST_MACHINE_ID,
          controllerCredentialPublicId: 'selected-credential',
          controllerInstallationId: TEST_CONTROLLER_INSTALLATION_ID,
        },
      ],
    }),
  };
  // Pick the two methods the controller calls. Typing the mock as the full
  // class would make `expect(securityEventService.method)` trip
  // @typescript-eslint/unbound-method; the Pick keeps the assertions clean.
  let securityEventService: jest.Mocked<
    Pick<MachineSecurityEventService, 'recordEvents' | 'listEvents'>
  >;

  beforeEach(async () => {
    service = {
      createMachineEnrollment: jest.fn(),
      issuePairingCode: jest.fn(),
      registerMachine: jest.fn(),
      listMachines: jest.fn(),
      revokeMachine: jest.fn(),
      getPairingCodeStatus: jest.fn(),
      authenticateMachineCredential: jest.fn(),
      rotateMachineKey: jest.fn(),
    } as unknown as jest.Mocked<MachinePairingService>;

    serverSigningKeyService = {
      getPublicKeyBase64: jest
        .fn()
        .mockReturnValue(TEST_SERVER_PUBLIC_KEY_BASE64),
      getPublicKey: jest.fn(),
      getPrivateKey: jest.fn(),
    } as unknown as jest.Mocked<ServerSigningKeyService>;

    presenceService = {
      isPresent: jest.fn(),
      getBindings: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<MachinePresenceService, 'isPresent' | 'getBindings'>
    >;

    securityEventService = {
      recordEvents: jest.fn(),
      listEvents: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<MachineSecurityEventService, 'recordEvents' | 'listEvents'>
    >;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MachineController],
      providers: [
        { provide: MachinePairingService, useValue: service },
        {
          provide: MachineExecutionReadinessService,
          useValue: readinessService,
        },
        {
          provide: CurrentControllerMachineEligibilityService,
          useValue: controllerEligibilityService,
        },
        {
          provide: ControllerBrowserBindingService,
          useValue: controllerBrowserBindingService,
        },
        {
          provide: ServerSigningKeyService,
          useValue: serverSigningKeyService,
        },
        {
          provide: MachineSecurityEventService,
          useValue: securityEventService,
        },
        {
          provide: MachinePresenceService,
          useValue: presenceService,
        },
        {
          provide: WebsocketGateway,
          useValue: { pingMachine: jest.fn() },
        },
      ],
    }).compile();

    controller = moduleRef.get(MachineController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /machines/enrollments', () => {
    const body = {
      machinePublicKey:
        '-----BEGIN PUBLIC KEY-----\nvalid\n-----END PUBLIC KEY-----',
      machineName: 'test-machine',
      osFamily: 'macos' as const,
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2 as const,
    };

    it('passes the generated request and normalized source address without user context', async () => {
      const response = {
        enrollmentId: '00000000-0000-4000-8000-000000000002',
        machineId: TEST_MACHINE_ID,
        deviceSecret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        userCode: 'BCDFG-HJKLM',
        expiresAt: '2026-08-11T18:05:00.000Z',
        pollingIntervalSeconds: 5,
      };
      service.createMachineEnrollment.mockResolvedValue(response);

      const result = await controller.createMachineEnrollment(body, {
        ip: '::ffff:192.0.2.10',
      } as Request);

      expect(service.createMachineEnrollment).toHaveBeenCalledWith(
        body,
        '192.0.2.10',
      );
      expect(result).toEqual(response);
    });
  });

  describe('POST /machines/pairing-codes', () => {
    it('returns the id, short code and expiresAt, scoped to the calling user', async () => {
      const expiresAt = new Date('2026-05-17T12:05:00.000Z');
      service.issuePairingCode.mockResolvedValue({
        id: 'f0b1c2d3-4e5f-4071-8123-456789abcdef',
        code: '123-456-789',
        expiresAt,
      });

      const result = await controller.issuePairingCode(TEST_USER);

      expect(service.issuePairingCode).toHaveBeenCalledWith(TEST_USER.userId);
      expect(result).toEqual({
        id: 'f0b1c2d3-4e5f-4071-8123-456789abcdef',
        code: '123-456-789',
        expiresAt: expiresAt.toISOString(),
      });
    });

    it('propagates the stable retired outcome', async () => {
      service.issuePairingCode.mockRejectedValue(
        new LegacyMachinePairingRetiredException(),
      );

      await expect(
        controller.issuePairingCode(TEST_USER),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'LEGACY_MACHINE_PAIRING_RETIRED',
        }),
      });
    });
  });

  describe('GET /machines/pairing-codes/:id', () => {
    const CODE_ID = 'f0b1c2d3-4e5f-4071-8123-456789abcdef';

    it('delegates to the service with the caller userId and code id and returns the claimed status', async () => {
      service.getPairingCodeStatus.mockResolvedValue({
        state: 'claimed',
        machineId: TEST_MACHINE_ID,
        label: 'zac-macbook',
      });

      const result = await controller.getPairingCodeStatus(CODE_ID, TEST_USER);

      expect(service.getPairingCodeStatus).toHaveBeenCalledWith(
        TEST_USER.userId,
        CODE_ID,
      );
      expect(result).toEqual({
        state: 'claimed',
        machineId: TEST_MACHINE_ID,
        label: 'zac-macbook',
      });
    });

    it('returns a pending status with null machine fields', async () => {
      service.getPairingCodeStatus.mockResolvedValue({
        state: 'pending',
        machineId: null,
        label: null,
      });

      const result = await controller.getPairingCodeStatus(CODE_ID, TEST_USER);

      expect(result).toEqual({
        state: 'pending',
        machineId: null,
        label: null,
      });
    });

    it('propagates NotFoundException so Nest maps an unknown or unowned code to 404', async () => {
      service.getPairingCodeStatus.mockRejectedValue(
        new NotFoundException(`Pairing code ${CODE_ID} not found`),
      );

      let thrown: NotFoundException | undefined;
      try {
        await controller.getPairingCodeStatus(CODE_ID, TEST_USER);
      } catch (err) {
        thrown = err as NotFoundException;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(thrown!.getStatus()).toBe(404);
    });

    it('propagates the stable retired outcome before polling lookup', async () => {
      service.getPairingCodeStatus.mockRejectedValue(
        new LegacyMachinePairingRetiredException(),
      );

      await expect(
        controller.getPairingCodeStatus(CODE_ID, TEST_USER),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'LEGACY_MACHINE_PAIRING_RETIRED',
        }),
      });
    });
  });

  describe('POST /machines/register', () => {
    const body = {
      publicKey: 'PEM-PUBLIC-KEY',
      machineId: TEST_MACHINE_ID,
      pairingCode: '123-456-789',
    };

    it('binds publicKey+machineId to the user and returns a machine-scoped token distinct from a JWT', async () => {
      service.registerMachine.mockResolvedValue({
        machineId: TEST_MACHINE_ID,
        token: 'mch_AAAAbbbbCCCC',
      });

      const result = await controller.registerMachine(body, TEST_USER);

      expect(service.registerMachine).toHaveBeenCalledWith({
        pairingCode: body.pairingCode,
        publicKey: body.publicKey,
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER.userId,
      });
      expect(result).toEqual({
        machineId: TEST_MACHINE_ID,
        token: 'mch_AAAAbbbbCCCC',
        serverSigningPublicKey: TEST_SERVER_PUBLIC_KEY_BASE64,
      });
      expect(result.token.startsWith('eyJ')).toBe(false);
    });

    it('delivers a non-empty base64 server signing public key at pairing', async () => {
      service.registerMachine.mockResolvedValue({
        machineId: TEST_MACHINE_ID,
        token: 'mch_AAAAbbbbCCCC',
      });

      const result = await controller.registerMachine(body, TEST_USER);

      expect(serverSigningKeyService.getPublicKeyBase64).toHaveBeenCalledTimes(
        1,
      );
      expect(result.serverSigningPublicKey).toBe(TEST_SERVER_PUBLIC_KEY_BASE64);
      expect(result.serverSigningPublicKey.length).toBeGreaterThan(0);
      expect(/^[A-Za-z0-9+/=]+$/.test(result.serverSigningPublicKey)).toBe(
        true,
      );
    });

    it('never leaks the server signing private key in the response or via the controller path', async () => {
      service.registerMachine.mockResolvedValue({
        machineId: TEST_MACHINE_ID,
        token: 'mch_AAAAbbbbCCCC',
      });

      const result = await controller.registerMachine(body, TEST_USER);

      // The only key-service method the controller touches is the public-key
      // reader; the private-key accessor must never be called.
      expect(serverSigningKeyService.getPrivateKey).not.toHaveBeenCalled();

      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/-----BEGIN PRIVATE KEY-----/);
      expect(serialized).not.toMatch(/-----BEGIN ED25519 PRIVATE KEY-----/);
      expect(serialized.toLowerCase()).not.toContain('privatekey');
      expect(Object.keys(result)).not.toContain('privateKey');
      expect(Object.keys(result)).not.toContain('serverSigningPrivateKey');
    });

    it('propagates PairingCodeExpiredException (410, PAIRING_CODE_EXPIRED)', async () => {
      service.registerMachine.mockRejectedValue(
        new PairingCodeExpiredException(),
      );

      let thrown: PairingCodeExpiredException | undefined;
      try {
        await controller.registerMachine(body, TEST_USER);
      } catch (err) {
        thrown = err as PairingCodeExpiredException;
      }
      expect(thrown).toBeInstanceOf(PairingCodeExpiredException);
      expect(thrown!.getStatus()).toBe(410);
      const payload = thrown!.getResponse() as { code: string };
      expect(payload.code).toBe('PAIRING_CODE_EXPIRED');
    });

    it('propagates PairingCodeAlreadyUsedException (409, PAIRING_CODE_ALREADY_USED)', async () => {
      service.registerMachine.mockRejectedValue(
        new PairingCodeAlreadyUsedException(),
      );

      let thrown: PairingCodeAlreadyUsedException | undefined;
      try {
        await controller.registerMachine(body, TEST_USER);
      } catch (err) {
        thrown = err as PairingCodeAlreadyUsedException;
      }
      expect(thrown).toBeInstanceOf(PairingCodeAlreadyUsedException);
      expect(thrown!.getStatus()).toBe(409);
      const payload = thrown!.getResponse() as { code: string };
      expect(payload.code).toBe('PAIRING_CODE_ALREADY_USED');
    });

    it('propagates PairingAttemptsExceededException (429, PAIRING_ATTEMPTS_EXCEEDED) carrying retryAfterSeconds', async () => {
      service.registerMachine.mockRejectedValue(
        new PairingAttemptsExceededException(600),
      );

      let thrown: PairingAttemptsExceededException | undefined;
      try {
        await controller.registerMachine(body, TEST_USER);
      } catch (err) {
        thrown = err as PairingAttemptsExceededException;
      }
      expect(thrown).toBeInstanceOf(PairingAttemptsExceededException);
      expect(thrown!.getStatus()).toBe(429);
      const payload = thrown!.getResponse() as {
        code: string;
        retryAfterSeconds: number;
      };
      expect(payload.code).toBe('PAIRING_ATTEMPTS_EXCEEDED');
      expect(payload.retryAfterSeconds).toBe(600);
    });

    it('propagates the stable retired outcome before registration can write', async () => {
      service.registerMachine.mockRejectedValue(
        new LegacyMachinePairingRetiredException(),
      );

      await expect(
        controller.registerMachine(body, TEST_USER),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'LEGACY_MACHINE_PAIRING_RETIRED',
        }),
      });
    });
  });

  describe('GET /machines', () => {
    it('delegates to the service with the caller userId and returns ISO-formatted timestamps', async () => {
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      const lastSeen = new Date('2026-05-12T11:00:00.000Z');
      service.listMachines.mockResolvedValue([
        {
          machineId: TEST_MACHINE_ID,
          name: 'Laptop',
          pairedAt,
          lastSeen,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent.mockResolvedValue(false);

      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(service.listMachines).toHaveBeenCalledWith(TEST_USER.userId);
      expect(result).toEqual({
        machines: [
          {
            machineId: TEST_MACHINE_ID,
            name: 'Laptop',
            pairedAt: pairedAt.toISOString(),
            lastSeen: lastSeen.toISOString(),
            revokedAt: null,
            authorizationProtocolVersion: 2,
            executionReadiness: 'READY',
            currentControllerEligibility: 'ELIGIBLE',
            currentControllerCredentialId: 'selected-credential',
            active: false,
            bindings: null,
          },
        ],
      });
    });

    it('serializes a null lastSeen as null without crashing', async () => {
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      service.listMachines.mockResolvedValue([
        {
          machineId: TEST_MACHINE_ID,
          name: 'Laptop',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent.mockResolvedValue(false);

      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(result.machines[0]!.lastSeen).toBeNull();
      expect(result.machines[0]!.pairedAt).toBe(pairedAt.toISOString());
    });

    it('returns context-free inventory without resolving controller eligibility', async () => {
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      service.listMachines.mockResolvedValue([
        {
          machineId: TEST_MACHINE_ID,
          name: 'Laptop',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent.mockResolvedValue(false);

      controllerBrowserBindingService.resolveInventory.mockResolvedValueOnce({
        hasIdentity: false,
        bindings: [],
      });
      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(controllerEligibilityService.resolveMany).not.toHaveBeenCalled();
      expect(result.machines[0]!.currentControllerEligibility).toBeNull();
    });

    it.each([
      ['missing', false, [], null, null],
      ['not enrolled', true, [], 'NOT_ENROLLED', null],
      [
        'revoked',
        true,
        [
          {
            machineId: TEST_MACHINE_ID,
            revoked: true,
            controllerCredentialPublicId: 'revoked',
          },
        ],
        'REVOKED',
        null,
      ],
      [
        'eligible',
        true,
        [
          {
            machineId: TEST_MACHINE_ID,
            revoked: false,
            controllerCredentialPublicId: 'chosen',
          },
        ],
        'ELIGIBLE',
        'chosen',
      ],
      [
        'ambiguous',
        true,
        [
          { machineId: TEST_MACHINE_ID, controllerCredentialPublicId: 'first' },
          {
            machineId: TEST_MACHINE_ID,
            controllerCredentialPublicId: 'second',
          },
        ],
        'AMBIGUOUS',
        null,
      ],
    ])(
      'preserves the %s controller relationship independently of connectivity',
      async (_name, hasIdentity, bindings, state, credentialId) => {
        service.listMachines.mockResolvedValue([
          {
            machineId: TEST_MACHINE_ID,
            name: 'Linux',
            pairedAt: new Date(),
            lastSeen: null,
            revokedAt: null,
            authorizationProtocolVersion: 2,
          },
        ]);
        presenceService.isPresent.mockResolvedValue(false);
        controllerBrowserBindingService.resolveInventory.mockResolvedValueOnce({
          hasIdentity,
          bindings,
        });
        const result = await controller.listMachines(TEST_USER, TEST_REQUEST);
        expect(result.machines[0]).toMatchObject({
          active: false,
          currentControllerEligibility: state,
          currentControllerCredentialId: credentialId,
        });
      },
    );

    it('includes repo bindings for an active machine', async () => {
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      const bindings = [
        {
          serviceId: 'svc-1',
          repositoryPath: '/home/user/project-a',
          createdAt: '2026-05-10T10:00:00.000Z',
          updatedAt: '2026-05-10T10:00:00.000Z',
        },
        {
          serviceId: 'svc-2',
          repositoryPath: '/home/user/project-b',
          createdAt: '2026-05-10T10:00:00.000Z',
          updatedAt: '2026-05-10T10:00:00.000Z',
        },
      ];
      service.listMachines.mockResolvedValue([
        {
          machineId: TEST_MACHINE_ID,
          name: 'Laptop',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent.mockResolvedValue(true);
      presenceService.getBindings.mockResolvedValue({
        bindings,
        organizationId: 'org-1',
        sourcingSocketId: 'socket-1',
      });

      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(presenceService.isPresent).toHaveBeenCalledWith(TEST_MACHINE_ID);
      expect(presenceService.getBindings).toHaveBeenCalledWith(TEST_MACHINE_ID);
      expect(result.machines[0]).toMatchObject({
        active: true,
        bindings,
      });
    });

    it('returns active: false and bindings: null for an inactive machine', async () => {
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      service.listMachines.mockResolvedValue([
        {
          machineId: TEST_MACHINE_ID,
          name: 'Desktop',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent.mockResolvedValue(false);

      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(presenceService.getBindings).not.toHaveBeenCalled();
      expect(result.machines[0]).toMatchObject({
        active: false,
        bindings: null,
      });
    });

    it('handles a mixed list of active and inactive machines', async () => {
      const MACHINE_A = '00000000-0000-4000-8000-000000000001' as MachineId;
      const MACHINE_B = '00000000-0000-4000-8000-000000000002' as MachineId;
      const pairedAt = new Date('2026-05-10T10:00:00.000Z');
      const bindings = [
        {
          serviceId: 'svc-1',
          repositoryPath: '/home/user/repo',
          createdAt: '2026-05-10T10:00:00.000Z',
          updatedAt: '2026-05-10T10:00:00.000Z',
        },
      ];

      service.listMachines.mockResolvedValue([
        {
          machineId: MACHINE_A,
          name: 'Active',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
        {
          machineId: MACHINE_B,
          name: 'Inactive',
          pairedAt,
          lastSeen: null,
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]);
      presenceService.isPresent
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      presenceService.getBindings.mockResolvedValue({
        bindings,
        organizationId: 'org-1',
        sourcingSocketId: 'socket-1',
      });

      const result = await controller.listMachines(TEST_USER, TEST_REQUEST);

      expect(result.machines).toHaveLength(2);
      expect(result.machines[0]).toMatchObject({
        machineId: MACHINE_A,
        active: true,
        bindings,
      });
      expect(result.machines[1]).toMatchObject({
        machineId: MACHINE_B,
        active: false,
        bindings: null,
      });
      expect(presenceService.getBindings).toHaveBeenCalledTimes(1);
      expect(presenceService.getBindings).toHaveBeenCalledWith(MACHINE_A);
    });
  });

  describe('DELETE /machines/:machineId', () => {
    it('delegates to the service with both ids and returns void', async () => {
      service.revokeMachine.mockResolvedValue(undefined);

      const result = await controller.revokeMachine(TEST_MACHINE_ID, TEST_USER);

      expect(service.revokeMachine).toHaveBeenCalledWith(
        TEST_USER.userId,
        TEST_MACHINE_ID,
      );
      expect(result).toBeUndefined();
    });

    it('propagates NotFoundException from the service so Nest maps it to 404', async () => {
      service.revokeMachine.mockRejectedValue(
        new NotFoundException(`Machine ${TEST_MACHINE_ID} not found`),
      );

      let thrown: NotFoundException | undefined;
      try {
        await controller.revokeMachine(TEST_MACHINE_ID, TEST_USER);
      } catch (err) {
        thrown = err as NotFoundException;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(thrown!.getStatus()).toBe(404);
    });
  });

  describe('POST /machines/:machineId/key-rotations', () => {
    const CURRENT_MACHINE: AuthenticatedMachine = {
      machineId: TEST_MACHINE_ID,
      userId: testIds.user as UserId,
    };

    it('rotates the key for the credential-authenticated machine and returns an ISO rotatedAt', async () => {
      const rotatedAt = new Date('2026-06-14T12:05:00.000Z');
      service.rotateMachineKey.mockResolvedValue({
        machineId: TEST_MACHINE_ID,
        rotatedAt,
      });

      const result = await controller.rotateMachineKey(
        TEST_MACHINE_ID,
        { newPublicKey: 'NEW-PEM' },
        CURRENT_MACHINE,
      );

      expect(service.rotateMachineKey).toHaveBeenCalledWith(
        TEST_MACHINE_ID,
        'NEW-PEM',
      );
      expect(result).toEqual({
        machineId: TEST_MACHINE_ID,
        rotatedAt: rotatedAt.toISOString(),
      });
    });

    it('rejects when the credential machine does not match the path machine', async () => {
      const OTHER_MACHINE = '00000000-0000-4000-8000-0000000000ff' as MachineId;

      let thrown: UnauthorizedException | undefined;
      try {
        await controller.rotateMachineKey(
          OTHER_MACHINE,
          { newPublicKey: 'NEW-PEM' },
          CURRENT_MACHINE,
        );
      } catch (err) {
        thrown = err as UnauthorizedException;
      }
      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect(service.rotateMachineKey).not.toHaveBeenCalled();
    });
  });

  describe('POST /machines/:machineId/security-events', () => {
    const CURRENT_MACHINE: AuthenticatedMachine = {
      machineId: TEST_MACHINE_ID,
      userId: testIds.user as UserId,
    };

    const body = {
      events: [
        {
          id: '0f9c4d2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
          eventType: MachineSecurityEventType.SignatureFailure,
          occurredAt: '2026-06-14T12:00:00.000Z',
          detail: 'bad signature',
        },
      ],
    };

    it('records the reported events for the credential-authenticated machine', async () => {
      const persisted = [
        {
          id: body.events[0]!.id,
          machineId: TEST_MACHINE_ID,
          eventType: MachineSecurityEventType.SignatureFailure,
          occurredAt: '2026-06-14T12:00:00.000Z',
          detail: 'bad signature',
          metadata: null,
        },
      ];
      securityEventService.recordEvents.mockResolvedValue(persisted);

      const result = await controller.reportMachineSecurityEvents(
        TEST_MACHINE_ID,
        body,
        CURRENT_MACHINE,
      );

      expect(securityEventService.recordEvents).toHaveBeenCalledWith({
        machineId: TEST_MACHINE_ID,
        userId: CURRENT_MACHINE.userId,
        events: [
          {
            id: body.events[0]!.id,
            eventType: MachineSecurityEventType.SignatureFailure,
            occurredAt: '2026-06-14T12:00:00.000Z',
            detail: 'bad signature',
            metadata: null,
          },
        ],
      });
      expect(result).toEqual({ events: persisted });
    });

    it('rejects when the credential machine does not match the path machine', async () => {
      const OTHER_MACHINE = '00000000-0000-4000-8000-0000000000ff' as MachineId;

      let thrown: UnauthorizedException | undefined;
      try {
        await controller.reportMachineSecurityEvents(
          OTHER_MACHINE,
          body,
          CURRENT_MACHINE,
        );
      } catch (err) {
        thrown = err as UnauthorizedException;
      }
      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect(securityEventService.recordEvents).not.toHaveBeenCalled();
    });
  });

  describe('GET /machines/:machineId/security-events', () => {
    it('delegates to the service scoped to the caller and returns the feed', async () => {
      const feed = [
        {
          id: 'newer',
          machineId: TEST_MACHINE_ID,
          eventType: MachineSecurityEventType.RateLimitTrip,
          occurredAt: '2026-06-14T12:00:00.000Z',
          detail: null,
          metadata: null,
        },
      ];
      securityEventService.listEvents.mockResolvedValue(feed);

      const result = await controller.listMachineSecurityEvents(
        TEST_MACHINE_ID,
        TEST_USER,
      );

      expect(securityEventService.listEvents).toHaveBeenCalledWith({
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER.userId,
      });
      expect(result).toEqual({ events: feed });
    });

    it('propagates NotFoundException so Nest maps an unowned machine to 404', async () => {
      securityEventService.listEvents.mockRejectedValue(
        new NotFoundException(`Machine ${TEST_MACHINE_ID} not found`),
      );

      let thrown: NotFoundException | undefined;
      try {
        await controller.listMachineSecurityEvents(TEST_MACHINE_ID, TEST_USER);
      } catch (err) {
        thrown = err as NotFoundException;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(thrown!.getStatus()).toBe(404);
    });
  });
});
