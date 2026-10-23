import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtKeysService } from '../../services/jwt-keys.service';
import { UserAccessTokenValidatorService } from '../../services/user-access-token-validator.service';
import { JwtStrategy } from '../jwt.strategy';
import { OrganizationId } from '../../../types';

describe('JwtStrategy', () => {
  it('delegates protected HTTP user-token validation to the shared validator', async () => {
    const jwtKeysService = {
      getPublicKey: jest.fn().mockReturnValue('public-key'),
      isSystemSubject: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<JwtKeysService>;
    const userAccessTokenValidator = {
      validate: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    } as unknown as jest.Mocked<UserAccessTokenValidatorService>;
    const strategy = new JwtStrategy(
      {} as ConfigService,
      jwtKeysService,
      userAccessTokenValidator,
    );
    const payload = {
      sub: 'user-1',
      currentOrgId: 'org-1' as OrganizationId,
    };

    await expect(
      strategy.validate(
        { path: '/api/v1/projects' } as unknown as Request,
        payload,
      ),
    ).resolves.toEqual({
      userId: 'user-1',
    });
    expect(userAccessTokenValidator.validate).toHaveBeenCalledWith(payload, {
      recordDemoActivity: true,
    });
  });

  it('does not count the demo sandbox status read as activity', async () => {
    const userAccessTokenValidator = {
      validate: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    } as unknown as jest.Mocked<UserAccessTokenValidatorService>;
    const strategy = new JwtStrategy(
      {} as ConfigService,
      {
        getPublicKey: jest.fn().mockReturnValue('key'),
        isSystemSubject: jest.fn().mockReturnValue(false),
      } as unknown as JwtKeysService,
      userAccessTokenValidator,
    );
    const payload = { sub: 'user-1', currentOrgId: 'org-1' as OrganizationId };

    await strategy.validate(
      { path: '/api/v1/demo-sandboxes/current' } as unknown as Request,
      payload,
    );

    expect(userAccessTokenValidator.validate).toHaveBeenCalledWith(payload, {
      recordDemoActivity: false,
    });
  });
});
