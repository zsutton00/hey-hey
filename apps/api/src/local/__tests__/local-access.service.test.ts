import { UnauthorizedException } from '@nestjs/common';
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
});
