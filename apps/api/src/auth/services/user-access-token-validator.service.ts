import { Injectable } from '@nestjs/common';
import { OrganizationRole } from '@hey-hey/contracts/api/models';
import { UserService } from '../../services/user.service';
import { OrganizationId, UserId } from '../../types';
import type { AuthenticatedUser, JwtPayload } from '../strategies/jwt.strategy';
import { JwtKeysService } from './jwt-keys.service';
import { AccountEntitlementService } from '../../services/account-entitlement.service';
import { DemoSandboxActivityService } from '../../services/demo-sandbox/demo-sandbox-activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BROWSER_ACCESS_TOKEN_USE,
  CredentialProfileService,
  OAUTH_ACCESS_TOKEN_USE,
} from '../credential-profile';

export interface ValidatedBrowserAccessContext extends AuthenticatedUser {
  expiresAt: Date;
}

type CredentialBinding =
  | { kind: 'browser'; sessionId: string; authorizationVersion: number }
  | { kind: 'oauth' };

@Injectable()
export class UserAccessTokenValidatorService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtKeysService: JwtKeysService,
    private readonly accountEntitlementService: AccountEntitlementService,
    private readonly demoSandboxActivity: DemoSandboxActivityService,
    private readonly prisma: PrismaService,
    private readonly credentialProfile: CredentialProfileService,
  ) {}

  async verifyAndValidate(
    token: string,
  ): Promise<ValidatedBrowserAccessContext> {
    const payload = this.jwtKeysService.verifyToken(token) as JwtPayload;
    const user = await this.validate(payload);

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new Error('Token expiration is missing');
    }

    const expiresAt = new Date(payload.exp * 1000);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error('Token expiration is invalid');
    }

    return { ...user, expiresAt };
  }

  async validate(
    payload: JwtPayload,
    options: { recordDemoActivity?: boolean } = {},
  ): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new Error('Token subject is missing');
    }

    if (payload.type) {
      throw new Error('Scoped token cannot be used for authentication');
    }

    if (this.jwtKeysService.isSystemSubject(payload.sub)) {
      throw new Error('System token cannot authenticate a browser user');
    }

    const binding = this.credentialBinding(payload);
    const userId = payload.sub as UserId;
    const user = await this.userService.findForAuthentication(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    if (binding.kind === 'browser') {
      await this.assertBrowserSessionCurrent(
        userId,
        binding,
        user.authorizationRevision,
      );
    }

    const { currentOrgId } = this.extractOrgContext(payload);
    const activeMemberships =
      user.memberships?.filter((membership) => membership.isActive) ?? [];
    const authorizedOrganizationIds =
      await this.accountEntitlementService.getAuthorizedOrganizationIds(
        activeMemberships.map(
          (membership) => membership.organizationId as OrganizationId,
        ),
      );
    const hasCurrentMembership = activeMemberships.some(
      (membership) =>
        membership.organizationId === currentOrgId &&
        authorizedOrganizationIds.has(currentOrgId),
    );
    if (!hasCurrentMembership) {
      throw new Error('Not authorized');
    }

    if (user.isDemoUser && options.recordDemoActivity !== false) {
      // Observes the request only; it never feeds an authorization decision.
      void this.demoSandboxActivity.recordActivity(userId);
    }

    return {
      userId,
      email: payload.email ?? user.email,
      name: payload.name ?? user.name,
      currentOrgId,
      orgMemberships: activeMemberships
        .filter((membership) =>
          authorizedOrganizationIds.has(
            membership.organizationId as OrganizationId,
          ),
        )
        .map((membership) => ({
          orgId: membership.organizationId,
          role: membership.role as OrganizationRole,
        })),
      isDevAdmin: payload.isDevAdmin ?? user.isDevAdmin ?? false,
      devAdminMode: payload.devAdminMode ?? user.devAdminMode ?? false,
      ...(payload.isLocalAccount === true ? { isLocalAccount: true } : {}),
      ...(binding.kind === 'browser'
        ? {
            browserSessionId: binding.sessionId,
            authorizationVersion: binding.authorizationVersion,
          }
        : {}),
    };
  }

  /**
   * Accept only credentials issued for this deployment's profile: browser
   * access bound to a session and authorization revision, or native OAuth
   * access. Unscoped legacy tokens and other deployments' tokens are rejected
   * even when correctly signed.
   */
  private credentialBinding(payload: JwtPayload): CredentialBinding {
    if (payload.iss !== this.credentialProfile.issuer) {
      throw new Error('Token issuer does not match this deployment');
    }

    if (payload.token_use === BROWSER_ACCESS_TOKEN_USE) {
      if (
        !audienceMatches(payload.aud, this.credentialProfile.browserAudience)
      ) {
        throw new Error('Token audience does not match this deployment');
      }
      if (typeof payload.sid !== 'string' || payload.sid.length === 0) {
        throw new Error('Browser token is missing its session binding');
      }
      if (
        !Number.isSafeInteger(payload.authz_version) ||
        (payload.authz_version as number) < 0
      ) {
        throw new Error('Browser token is missing its authorization revision');
      }
      return {
        kind: 'browser',
        sessionId: payload.sid,
        authorizationVersion: payload.authz_version as number,
      };
    }

    if (payload.token_use === OAUTH_ACCESS_TOKEN_USE) {
      if (!audienceMatches(payload.aud, this.credentialProfile.oauthAudience)) {
        throw new Error('Token audience does not match this deployment');
      }
      return { kind: 'oauth' };
    }

    throw new Error('Token purpose is not accepted');
  }

  private async assertBrowserSessionCurrent(
    userId: UserId,
    binding: { sessionId: string; authorizationVersion: number },
    currentAuthorizationRevision: number,
  ): Promise<void> {
    if (binding.authorizationVersion !== currentAuthorizationRevision) {
      throw new Error('Browser session authorization is out of date');
    }

    const session = await this.prisma.db.browserSessionFamily.findUnique({
      where: { sessionId: binding.sessionId },
      select: {
        userId: true,
        revokedAt: true,
        inactivityExpiresAt: true,
        absoluteExpiresAt: true,
      },
    });
    const now = Date.now();
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.inactivityExpiresAt.getTime() <= now ||
      session.absoluteExpiresAt.getTime() <= now
    ) {
      throw new Error('Browser session is no longer active');
    }
  }

  private extractOrgContext(payload: JwtPayload): {
    currentOrgId: OrganizationId;
    orgMemberships: {
      orgId: string;
      role: OrganizationRole;
    }[];
  } {
    const memberships =
      payload.orgMemberships && payload.orgMemberships.length > 0
        ? payload.orgMemberships
        : [];

    const currentOrgId =
      payload.currentOrgId || (memberships[0]?.orgId as OrganizationId);

    if (!currentOrgId) {
      throw new Error('Token missing organization context');
    }

    const normalizedMemberships =
      memberships.length > 0
        ? memberships
        : [
            {
              orgId: currentOrgId,
              role: OrganizationRole.Member,
            },
          ];

    return {
      currentOrgId,
      orgMemberships: normalizedMemberships,
    };
  }
}

function audienceMatches(
  audience: string | string[] | undefined,
  expected: string,
): boolean {
  return Array.isArray(audience)
    ? audience.length === 1 && audience[0] === expected
    : audience === expected;
}
