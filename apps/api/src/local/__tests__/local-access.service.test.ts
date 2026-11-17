import { ConfigService } from '@nestjs/config';
import { LocalAuthController } from '../local-auth.controller';
import { UnauthorizedException } from '@nestjs/common';
import { createMockPrismaService } from '../../utils/testUtils';
import { UserId } from '../../types';
import { LocalAccessService } from '../local-access.service';

const SECRET = 'installation-secret';

describe('LocalAccessService', () => {
  const previous = {
    deployment: process.env.DEPLOYMENT_ENVIRONMENT,
    local: process.env.HEYHEY_LOCAL_APPLICATION,
    secret: process.env.LOCAL_INSTALLATION_SECRET,
  };
  let userService: { createLocalBootstrapUser: jest.Mock };
  let authService: { generateTokensForUserId: jest.Mock };
  let service: LocalAccessService;

  const configureDeployment = (deployment: string) => {
    process.env.DEPLOYMENT_ENVIRONMENT = deployment;
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    process.env.LOCAL_INSTALLATION_SECRET = SECRET;
  };

  beforeEach(() => {
    userService = {
      createLocalBootstrapUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    authService = {
      generateTokensForUserId: jest
        .fn()
        .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    };
    service = new LocalAccessService(
      userService as never,
      {} as never,
      authService as never,
      {} as never,
      {} as never,
      { getClient: jest.fn() } as never,
      {} as never,
      {} as never,
    );
  });

  afterEach(() => {
    for (const [key, value] of [
      ['DEPLOYMENT_ENVIRONMENT', previous.deployment],
      ['HEYHEY_LOCAL_APPLICATION', previous.local],
      ['LOCAL_INSTALLATION_SECRET', previous.secret],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('does not issue local handoffs to hosted deployments', async () => {
    configureDeployment('production');

    await expect(service.createLocalHandoff(SECRET)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects local bootstrap without the installation secret', async () => {
    configureDeployment('local');

    await expect(
      service.createLocalHandoff('unrelated-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userService.createLocalBootstrapUser).not.toHaveBeenCalled();
  });

  it('issues local CLI credentials only to the holder of the installation secret', async () => {
    configureDeployment('local');

    await expect(
      service.issueLocalCliCredentials('unrelated-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.generateTokensForUserId).not.toHaveBeenCalled();

    await expect(service.issueLocalCliCredentials(SECRET)).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 60 * 60 * 24,
    });
  });
  describe('following the exact local enrollment', () => {
    const userId = 'user-1' as UserId;
    const enrollmentId = 'enrollment-1';
    const pendingMachineEnrollment = { findFirst: jest.fn() };
    const machine = { findMany: jest.fn() };
    const connectionExists = jest.fn();
    let db: ReturnType<typeof createMockPrismaService>['db'];

    beforeEach(() => {
      configureDeployment('local');
      db = createMockPrismaService().db;
      connectionExists.mockResolvedValue(1);
      machine.findMany.mockResolvedValue([
        {
          id: 'machine-1',
          authorizationProtocolVersion: 2,
          authorizationState: 'READY',
          controllerCredentials: [{ revokedAt: null }],
        },
      ]);
      service = new LocalAccessService(
        {
          findForAuthentication: async () => ({
            email: 'local-' + 'a'.repeat(64) + '@local.invalid',
            name: 'Person',
          }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {
          db: {
            ...db,
            organizationMember: {
              findFirstOrThrow: async () => ({ organizationId: 'org-1' }),
            },
            pendingMachineEnrollment,
            machine,
          },
        } as never,
        { getClient: () => ({ exists: connectionExists }) } as never,
        {
          findDefault: async () => 'project-1',
          findUnfinished: async () => null,
        } as never,
        {} as never,
      );
    });

    it.each([
      ['AWAITING_MACHINE_CONFIRMATION', 60_000, 'WAITING', false],
      ['REJECTED', 60_000, 'REJECTED', false],
      ['AWAITING_MACHINE_CONFIRMATION', -1, 'EXPIRED', false],
      ['ACTIVE', -1, 'ACTIVE', true],
      ['CONSUMED', 60_000, 'ACTIVE', true],
      ['CONSUMED', -1, 'ACTIVE', true],
    ])(
      'reports %s without confusing presence with completed pairing',
      async (state, remaining, pairingState, machineConnected) => {
        pendingMachineEnrollment.findFirst.mockResolvedValue({
          state,
          machineId: 'machine-1',
          expiresAt: new Date(Date.now() + Number(remaining)),
        });
        await expect(
          service.getLocalStatus(userId, enrollmentId),
        ).resolves.toMatchObject({ pairingState, machineConnected });
        expect(pendingMachineEnrollment.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: enrollmentId,
              claimantUserId: userId,
              claimantOrganizationId: 'org-1',
            },
          }),
        );
        expect(machine.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              userId,
              organizationId: 'org-1',
              revokedAt: null,
              id: 'machine-1',
            },
          }),
        );
      },
    );

    it('waits for a live connection after successful activation', async () => {
      pendingMachineEnrollment.findFirst.mockResolvedValue({
        state: 'CONSUMED',
        machineId: 'machine-1',
        expiresAt: new Date(Date.now() - 1),
      });
      connectionExists.mockResolvedValue(0);

      await expect(
        service.getLocalStatus(userId, enrollmentId),
      ).resolves.toMatchObject({
        pairingState: 'ACTIVE',
        machineConnected: false,
        executionReady: false,
      });
    });

    it('rejects malformed enrollment input with a specific error code', async () => {
      const controller = new LocalAuthController(
        service,
        {} as never,
        new ConfigService({ ACCOUNT_PASSKEY_ORIGIN: 'http://localhost:3850' }),
      );
      await expect(
        controller.getLocalStatus({ userId } as never, 'not-an-id'),
      ).rejects.toMatchObject({
        response: { code: 'LOCAL_ENROLLMENT_ID_INVALID' },
      });
    });

    it('does not expose unknown or other-account enrollments or use another connected machine', async () => {
      pendingMachineEnrollment.findFirst.mockResolvedValue(null);
      machine.findMany.mockClear();
      await expect(
        service.getLocalStatus(userId, enrollmentId),
      ).resolves.toMatchObject({
        pairingState: 'UNAVAILABLE',
        machineConnected: false,
        executionReady: false,
      });
      expect(machine.findMany).not.toHaveBeenCalled();
    });
  });
});
