import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtKeysService } from '../services/jwt-keys.service';
import { OrganizationRole } from '../../generated';
import { Request } from 'express';
import { OrganizationId, UserId } from 'src/types';
import { UserAccessTokenValidatorService } from '../services/user-access-token-validator.service';
import { DEMO_SANDBOX_STATUS_PATH } from '../../services/demo-sandbox/demo-sandbox.constants';

export interface JwtPayload {
  sub: string; // userId or system subject
  type?: string; // Token purpose — 'refresh', 'password_change', etc.
  token_use?: string; // Closed credential purpose used by browser access tokens
  email?: string;
  name?: string; // User's display name
  currentOrgId?: OrganizationId; // User's active org
  orgMemberships?: {
    orgId: string;
    role: OrganizationRole;
  }[];
  // Developer admin capabilities
  isDevAdmin?: boolean;
  devAdminMode?: boolean; // Whether user is currently in dev-admin mode
  sid?: string; // Browser session binding, added by the browser-session cutover
  authz_version?: number; // Current authorization revision binding
  jti?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number; // Optional since we let JWT service handle expiration
}

export interface AuthenticatedUser {
  userId: UserId;
  email: string;
  name: string; // User's display name
  currentOrgId: OrganizationId;
  orgMemberships: {
    orgId: string;
    role: OrganizationRole;
  }[];
  // Developer admin capabilities
  isDevAdmin: boolean;
  devAdminMode: boolean;
  isSystemUser?: boolean;
  systemSubject?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    _configService: ConfigService,
    private jwtKeysService: JwtKeysService,
    private userAccessTokenValidator: UserAccessTokenValidatorService,
  ) {
    super({
      jwtFromRequest: JwtStrategy.extractJwtFromRequest.bind(JwtStrategy),
      ignoreExpiration: false,
      secretOrKey: jwtKeysService.getPublicKey(),
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  /**
   * Custom JWT extractor that checks Authorization header first, then falls back to HTTP-only cookie
   */
  private static extractJwtFromRequest(request: Request): string | null {
    // First, try to extract from Authorization header (Bearer token)
    const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    if (fromHeader) {
      return fromHeader;
    }

    // Fallback to HTTP-only cookie
    return (request.cookies?.accessToken as string) || null;
  }

  async validate(
    request: Request,
    payload: JwtPayload,
  ): Promise<AuthenticatedUser> {
    if (
      payload.sub &&
      !payload.type &&
      this.jwtKeysService.isSystemSubject(payload.sub)
    ) {
      return this.buildSystemUser(payload);
    }

    return this.userAccessTokenValidator.validate(payload, {
      recordDemoActivity: request.path !== DEMO_SANDBOX_STATUS_PATH,
    });
  }

  private buildSystemUser(payload: JwtPayload): AuthenticatedUser {
    const { currentOrgId, orgMemberships } = this.extractOrgContext(payload);

    return {
      userId: this.jwtKeysService.getSystemUserId(),
      email: payload.email ?? 'system@internal.local',
      name: payload.name ?? 'System Token',
      currentOrgId,
      orgMemberships,
      isDevAdmin: payload.isDevAdmin ?? false,
      devAdminMode: payload.devAdminMode ?? false,
      isSystemUser: true,
      systemSubject: payload.sub,
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
