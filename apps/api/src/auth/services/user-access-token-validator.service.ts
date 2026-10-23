import { Injectable } from '@nestjs/common';
import { OrganizationRole } from '../../generated';
import { UserService } from '../../services/user.service';
import { OrganizationId, UserId } from '../../types';
import type { AuthenticatedUser, JwtPayload } from '../strategies/jwt.strategy';
import { JwtKeysService } from './jwt-keys.service';
import { AccountEntitlementService } from '../../services/account-entitlement.service';
import { DemoSandboxActivityService } from '../../services/demo-sandbox/demo-sandbox-activity.service';

export interface ValidatedBrowserAccessContext extends AuthenticatedUser {
  expiresAt: Date;
  sessionId?: string;
  authorizationVersion?: number;
}

@Injectable()
export class UserAccessTokenValidatorService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtKeysService: JwtKeysService,
    private readonly accountEntitlementService: AccountEntitlementService,
    private readonly demoSandboxActivity: DemoSandboxActivityService,
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

    return {
      ...user,
      expiresAt,
      ...(payload.sid !== undefined ? { sessionId: payload.sid } : {}),
      ...(payload.authz_version !== undefined
        ? { authorizationVersion: payload.authz_version }
        : {}),
    };
  }

  async validate(
    payload: JwtPayload,
    options: { recordDemoActivity?: boolean } = {},
  ): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new Error('Token subject is missing');
    }

    // Legacy browser access tokens have no purpose claim. Keep accepting them
    // until the browser-session cutover makes token_use mandatory, but reject
    // every currently scoped credential.
    if (payload.type) {
      throw new Error('Scoped token cannot be used for authentication');
    }

    if (this.jwtKeysService.isSystemSubject(payload.sub)) {
      throw new Error('System token cannot authenticate a browser user');
    }

    const userId = payload.sub as UserId;
    const user = await this.userService.findForAuthentication(userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
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
    };
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
