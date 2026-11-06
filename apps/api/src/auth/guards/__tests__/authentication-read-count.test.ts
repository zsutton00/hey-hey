import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { Reflector } from '@nestjs/core';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { FlexibleAuthGuard } from '../flexible-auth.guard';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { JwtStrategy } from '../../strategies/jwt.strategy';
import { ApiKeyStrategy } from '../../strategies/api-key.strategy';
import { ApiKeyService } from '../../../services/api-key.service';
import { createMockPrismaService } from '../../../utils/testUtils';
import { UserAccessTokenValidatorService } from '../../services/user-access-token-validator.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import {
  AccountAccessStatus,
  AccountSubscriptionType,
  ApiKeyType,
  OrganizationRole,
} from '@prisma/client';

describe('authentication read counts across existing guards', () => {
  it('authenticates once per request when the route guard follows the global guard', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const findForAuthentication = jest.fn().mockResolvedValue({
      email: 'fixture@example.com',
      name: 'Fixture',
      isActive: true,
      isDevAdmin: false,
      devAdminMode: false,
      memberships: [
        {
          organizationId: 'organization-1',
          role: OrganizationRole.MEMBER,
          isActive: true,
        },
      ],
    });
    const entitlements = jest.fn().mockResolvedValue([
      {
        organizationId: 'organization-1',
        subscriptionType: AccountSubscriptionType.BETA,
        accessStatus: AccountAccessStatus.ACTIVE,
        accessThroughAt: null,
        paidThroughAt: null,
        revision: 1,
      },
    ]);
    const lifecycles = jest.fn().mockResolvedValue([]);
    const keys = {
      getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
      isSystemSubject: () => false,
    };
    const validator = new UserAccessTokenValidatorService(
      { findForAuthentication } as never,
      keys as never,
      new AccountEntitlementService({
        accountEntitlement: { findMany: entitlements },
        organizationAccountLifecycle: { findMany: lifecycles },
      } as never),
      { recordActivity: jest.fn() } as never,
      {} as never,
      {
        issuer: 'https://hosted.test/api',
        browserAudience: 'https://hosted.test',
        oauthAudience: 'https://hosted.test:oauth',
      } as never,
    );
    new JwtStrategy({} as never, keys as never, validator);
    const request = {
      method: 'GET',
      url: '/api/v1/debug/auth-read-count',
      headers: {
        authorization: `Bearer ${sign({ sub: 'user-1', token_use: 'oauth_access', currentOrgId: 'organization-1' }, privateKey, { algorithm: 'RS256', expiresIn: 60, issuer: 'https://hosted.test/api', audience: 'https://hosted.test:oauth' })}`,
      },
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const globalGuard = new FlexibleAuthGuard(new Reflector());
    const routeGuard = new JwtAuthGuard(new Reflector());
    await expect(globalGuard.canActivate(context)).resolves.toBe(true);
    expect(findForAuthentication).toHaveBeenCalledTimes(1);
    expect(routeGuard.canActivate(context)).toBe(true);
    expect(findForAuthentication).toHaveBeenCalledTimes(1);
    expect(entitlements).toHaveBeenCalledTimes(1);
    expect(lifecycles).toHaveBeenCalledTimes(1);

    const nextRequest = { ...request, user: undefined };
    const nextContext = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => nextRequest,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    await expect(globalGuard.canActivate(nextContext)).resolves.toBe(true);
    expect(routeGuard.canActivate(nextContext)).toBe(true);
    expect(findForAuthentication).toHaveBeenCalledTimes(2);
    expect(entitlements).toHaveBeenCalledTimes(2);
    expect(lifecycles).toHaveBeenCalledTimes(2);
  });

  it('rejects a valid API-key-only request on a JWT-only route after global authentication', async () => {
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    new JwtStrategy(
      new ConfigService(),
      {
        getPublicKey: () => publicKey.export({ type: 'spki', format: 'pem' }),
      } as never,
      {} as never,
    );
    const apiKey = 'hh_authentication_guard_test_key';
    const prisma = createMockPrismaService();
    prisma.db.apiKey.findFirst.mockResolvedValue({
      id: 'api-key-1',
      organizationId: 'organization-1',
      createdBy: 'user-1',
      name: 'Fixture',
      keyType: ApiKeyType.INTERNAL,
      keyHash: await hash(apiKey, 4),
      scopes: ['read:projects'],
      expiresAt: null,
    });
    new ApiKeyStrategy(new ApiKeyService(prisma as never, new ConfigService()));
    const request = {
      method: 'GET',
      url: '/api/v1/debug/auth-read-count',
      headers: { 'x-api-key': apiKey },
      ip: '127.0.0.1',
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const globalGuard = new FlexibleAuthGuard(new Reflector());
    const routeGuard = new JwtAuthGuard(new Reflector());

    await expect(globalGuard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('user.authType', 'api-key');
    await expect(routeGuard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
