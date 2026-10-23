import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { FlexibleAuthGuard } from '../flexible-auth.guard';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { JwtStrategy } from '../../strategies/jwt.strategy';
import { UserAccessTokenValidatorService } from '../../services/user-access-token-validator.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import {
  AccountAccessStatus,
  AccountSubscriptionType,
  OrganizationRole,
} from '@prisma/client';

describe('authentication read counts across existing guards', () => {
  it('performs fresh authentication reads for both global and route guards on one request', async () => {
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
    );
    new JwtStrategy({} as never, keys as never, validator);
    const request = {
      method: 'GET',
      url: '/api/v1/debug/auth-read-count',
      headers: {
        authorization: `Bearer ${sign({ sub: 'user-1', currentOrgId: 'organization-1' }, privateKey, { algorithm: 'RS256', expiresIn: 60 })}`,
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
    await expect(routeGuard.canActivate(context)).resolves.toBe(true);
    expect(findForAuthentication).toHaveBeenCalledTimes(2);
    expect(entitlements).toHaveBeenCalledTimes(2);
    expect(lifecycles).toHaveBeenCalledTimes(2);
  });
});
