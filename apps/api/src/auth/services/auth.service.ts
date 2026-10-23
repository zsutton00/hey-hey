import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OrganizationId, UserId } from 'src/types';
import {
  AuthResponseDto,
  AccountDefaultOrganizationDto,
  BrowserAuthResponseDto,
  ChangeCurrentPasswordDto,
  ChangePasswordDto,
  LoginDto,
  OrganizationRole,
  PasswordChangeRequiredDto,
  PasswordRecoveryAcknowledgementDto,
  PasswordRecoveryRequestDto,
  RegisterDto,
} from '../../generated';
import { OrganizationService } from '../../services/organization.service';
import { UserService } from '../../services/user.service';
import { ApiKeyService } from '../../services/api-key.service';
import { JwtPayload, AuthenticatedUser } from '../strategies/jwt.strategy';
import { ApiKeyAuthenticatedUser } from '../strategies/api-key.strategy';
import { JWKSResponse, JwtKeysService } from './jwt-keys.service';
import {
  BrowserSessionService,
  EstablishedBrowserSession,
} from './browser-session.service';
import { BrowserSessionRequestMetadata } from '../browser-session.types';
import { PasswordChangeCredentialService } from './password-change-credential.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../services/email.service';
import { PasswordRecoveryThrottleService } from './password-recovery-throttle.service';
import { PasswordChangeCredentialKind } from '../password-change-credential.types';

export const PASSWORD_RECOVERY_ACKNOWLEDGEMENT =
  'If an eligible account exists, recovery instructions will be sent.' as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private organizationService: OrganizationService,
    private jwtKeysService: JwtKeysService,
    private apiKeyService: ApiKeyService,
    private browserSessionService: BrowserSessionService,
    private passwordChangeCredentialService: PasswordChangeCredentialService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private passwordRecoveryThrottleService: PasswordRecoveryThrottleService,
  ) {}

  getAccountDefaultOrganization(
    accessToken: string | undefined,
  ): Promise<AccountDefaultOrganizationDto> {
    return this.browserSessionService.accountDefaultOrganization(accessToken);
  }

  setAccountDefaultOrganization(
    accessToken: string | undefined,
    organizationId: OrganizationId,
  ): Promise<AccountDefaultOrganizationDto> {
    return this.browserSessionService.accountDefaultOrganization(
      accessToken,
      organizationId,
    );
  }

  /**
   * Generate access + refresh tokens for a given user ID.
   * Preserved for OAuth and other non-browser consumers.
   */
  async generateTokensForUserId(userId: UserId): Promise<AuthResponseDto> {
    const user = await this.userService.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const userWithOrgs =
      await this.userService.getUserWithOrganizations(userId);
    const orgMemberships = [
      ...(await this.organizationService.getUserMemberships(userId)),
    ].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );

    const payload: JwtPayload = {
      sub: userId,
      email: user.email,
      name: user.name,
      currentOrgId:
        userWithOrgs.currentOrganizationId || orgMemberships[0]?.organizationId,
      orgMemberships: orgMemberships.map((m) => ({
        orgId: m.organizationId,
        role: m.role,
      })),
      isDevAdmin: user.isDevAdmin || false,
      devAdminMode: user.devAdminMode || false,
      iat: Math.floor(Date.now() / 1000),
    };

    const accessToken = this.jwtKeysService.signToken(payload, {
      expiresIn: '24h',
    });
    const refreshToken = this.jwtKeysService.signToken(
      { sub: userId, type: 'refresh' },
      { expiresIn: '7d' },
    );

    return {
      user: userWithOrgs,
      accessToken,
      refreshToken,
      expiresIn: 60 * 60 * 24,
    };
  }

  async login(
    loginDto: LoginDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession | PasswordChangeRequiredDto> {
    const user = await this.userService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.userService.validatePassword(
      user,
      loginDto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.userService.updateLastLogin(user.id);

    if (user.mustChangePassword) {
      this.logger.log('Password change required at browser sign-in', {
        userId: user.id,
      });
      const passwordChangeToken =
        await this.passwordChangeCredentialService.issue(
          user.id,
          PasswordChangeCredentialKind.RequiredChange,
          requestMetadata,
        );
      return {
        mustChangePassword: true,
        passwordChangeToken,
      } satisfies PasswordChangeRequiredDto;
    }

    const userWithOrgs = await this.userService.getUserWithOrganizations(
      user.id,
    );
    const orgMemberships = [
      ...(await this.organizationService.getUserMemberships(user.id)),
    ].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );

    this.logger.log('Normal browser sign-in accepted', {
      userId: user.id,
    });

    return this.browserSessionService.establish(
      {
        userId: user.id,
        user: userWithOrgs,
        claims: {
          email: user.email,
          name: user.name,
          orgMemberships: orgMemberships.map((membership) => ({
            orgId: membership.organizationId,
            role: membership.role,
          })),
          isDevAdmin: user.isDevAdmin || false,
          devAdminMode: user.devAdminMode || false,
        },
      },
      requestMetadata,
    );
  }

  async initiatePasswordRecovery(
    dto: PasswordRecoveryRequestDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<PasswordRecoveryAcknowledgementDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const throttle = await this.passwordRecoveryThrottleService.check(
      normalizedEmail,
      requestMetadata.ipAddress,
    );
    const user = await this.userService.findByEmail(normalizedEmail);

    await this.passwordRecoveryThrottleService.performEquivalentCostWork(
      user?.passwordHash,
    );

    if (throttle.allowed && user?.isActive) {
      try {
        const recoveryCredential =
          await this.passwordChangeCredentialService.issue(
            user.id as UserId,
            PasswordChangeCredentialKind.AccountRecovery,
            requestMetadata,
          );
        void this.emailService
          .sendPasswordRecoveryEmail({
            to: user.email,
            name: user.name,
            recoveryCredential,
          })
          .then(() => {
            this.logger.log('Password recovery delivery submitted', {
              outcome: 'submitted',
            });
          })
          .catch(() => {
            this.logger.warn('Password recovery delivery unavailable', {
              outcome: 'delivery_unavailable',
            });
          });
        this.logger.log('Password recovery initiation accepted', {
          outcome: 'eligible',
        });
      } catch {
        this.logger.warn('Password recovery initiation accepted', {
          outcome: 'issuance_unavailable',
        });
      }
    } else {
      this.logger.log('Password recovery initiation accepted', {
        outcome: throttle.allowed ? 'ineligible' : 'throttled',
      });
    }

    return { message: PASSWORD_RECOVERY_ACKNOWLEDGEMENT };
  }

  async changePassword(
    dto: ChangePasswordDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    if (!dto.newPassword || dto.newPassword.length < 8) {
      throw new BadRequestException(
        'New password must be at least 8 characters',
      );
    }

    return this.passwordChangeCredentialService.complete(
      dto.passwordChangeToken,
      dto.newPassword,
      requestMetadata,
    );
  }

  async changeCurrentPassword(
    userId: UserId,
    dto: ChangeCurrentPasswordDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    if (dto.newPassword.length < 8) {
      throw new BadRequestException(
        'New password must be at least 8 characters',
      );
    }

    const committed = await this.prisma.db.$transaction(async (tx) => {
      const user = await this.userService.replaceCurrentPasswordInTransaction(
        tx,
        userId,
        dto.currentPassword,
        dto.newPassword,
      );
      const memberships = user.memberships as Array<{
        organizationId: string;
        role: OrganizationRole;
        organization: { id: string };
      }>;
      const orderedMemberships = [...memberships].sort((left, right) =>
        left.organizationId.localeCompare(right.organizationId),
      );
      const userResponse = {
        id: user.id as UserId,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        currentOrganizationId: null,
      } satisfies BrowserAuthResponseDto['user'];

      const revocation =
        await this.browserSessionService.revokeAllForUserInTransaction(
          tx,
          userId,
          new Date(),
          'password_replaced',
        );
      const session = await this.browserSessionService.establishInTransaction(
        tx,
        {
          userId,
          user: userResponse,
          claims: {
            email: user.email,
            name: user.name,
            orgMemberships: orderedMemberships.map((membership) => ({
              orgId: membership.organizationId,
              role: membership.role,
            })),
            isDevAdmin: user.isDevAdmin,
            devAdminMode: user.devAdminMode,
          },
        },
        requestMetadata,
      );

      return { session, revocation };
    });

    this.browserSessionService.invalidateRevokedSessions(
      committed.revocation.revokedSessionIds,
    );
    return committed.session;
  }

  async logout(
    presentedRefreshSecret: string | undefined,
    accessToken: string | undefined,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<void> {
    await this.browserSessionService.logout({
      presentedRefreshSecret,
      accessToken,
      requestMetadata,
    });
  }

  async register(
    registerDto: RegisterDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    const existingUser = await this.userService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = await this.userService.create(registerDto);
    const userId = user.id as UserId;
    await this.userService.updateLastLogin(userId);

    const userWithOrgs =
      await this.userService.getUserWithOrganizations(userId);
    const orgMemberships = [
      ...(await this.organizationService.getUserMemberships(userId)),
    ].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );

    return this.browserSessionService.establish(
      {
        userId,
        user: userWithOrgs,
        claims: {
          email: user.email,
          name: user.name,
          orgMemberships: orgMemberships.map((membership) => ({
            orgId: membership.organizationId,
            role: membership.role,
          })),
          isDevAdmin: user.isDevAdmin || false,
          devAdminMode: user.devAdminMode || false,
        },
      },
      requestMetadata,
    );
  }

  async refreshToken(
    presentedSecret: string,
    requestMetadata: BrowserSessionRequestMetadata,
    requestedOrganizationId?: OrganizationId,
  ): Promise<EstablishedBrowserSession> {
    try {
      const result = await this.browserSessionService.refresh({
        presentedSecret,
        requestMetadata,
        requestedOrganizationId,
      });

      if (result.status !== 'rotated') {
        throw new UnauthorizedException('Browser session is not authenticated');
      }

      return {
        response: result.response,
        refreshSecret: result.refreshSecret,
        sessionId: result.sessionId,
        familyId: result.familyId,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Unexpected error during browser session refresh', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  /**
   * Validate JWT token for external services
   */
  async validateTokenForExternalService(
    token: string,
  ): Promise<{ valid: boolean; payload?: JwtPayload; error?: string }> {
    try {
      // Verify and decode the token
      const payload = this.jwtKeysService.verifyToken(token) as JwtPayload;

      if (!payload.sub) {
        return {
          valid: false,
          error: 'Token missing subject',
        };
      }

      const isSystemToken = this.jwtKeysService.isSystemSubject(payload.sub);

      // Additional validation: check if user still exists and is active
      if (!isSystemToken) {
        const user = await this.userService.findById(payload.sub as UserId);
        if (!user || !user.isActive) {
          return {
            valid: false,
            error: 'User not found or inactive',
          };
        }
      }

      // Return the validated payload
      return {
        valid: true,
        payload: {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          currentOrgId: payload.currentOrgId,
          orgMemberships: payload.orgMemberships,
          isDevAdmin: payload.isDevAdmin,
          devAdminMode: payload.devAdminMode,
          iat: payload.iat,
          exp: payload.exp,
        },
      };
    } catch (error) {
      let errorMessage = 'Invalid token';

      if (error instanceof Error) {
        if (error.name === 'TokenExpiredError') {
          errorMessage = 'Token expired';
        } else if (error.name === 'JsonWebTokenError') {
          errorMessage = 'Malformed token';
        }
      }

      return {
        valid: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Toggle dev-admin mode for users with dev-admin privileges
   */
  async toggleDevAdminMode(userId: UserId): Promise<AuthResponseDto> {
    const user = await this.userService.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (!user.isDevAdmin) {
      throw new ForbiddenException('User does not have dev-admin privileges');
    }

    // Toggle the dev-admin mode
    const newDevAdminMode = !user.devAdminMode;
    await this.userService.updateDevAdminMode(userId, newDevAdminMode);

    // Get updated user with organizations
    const userWithOrgs =
      await this.userService.getUserWithOrganizations(userId);
    const orgMemberships =
      await this.organizationService.getUserMemberships(userId);

    // Generate new JWT with updated dev-admin mode
    const payload: JwtPayload = {
      sub: userId,
      email: user.email,
      name: user.name,
      currentOrgId:
        userWithOrgs.currentOrganizationId || orgMemberships[0]?.organizationId,
      orgMemberships: orgMemberships.map((m) => ({
        orgId: m.organizationId,
        role: m.role,
      })),
      isDevAdmin: user.isDevAdmin,
      devAdminMode: newDevAdminMode,
      iat: Math.floor(Date.now() / 1000),
    };

    const accessToken = this.jwtKeysService.signToken(payload, {
      expiresIn: '24h',
    });
    const refreshToken = this.jwtKeysService.signToken(
      { sub: userId, type: 'refresh' },
      { expiresIn: '7d' },
    );

    const authResponse: AuthResponseDto = {
      user: userWithOrgs,
      accessToken,
      refreshToken,
      expiresIn: 60 * 60 * 24, // 24 hours in seconds
    };

    return authResponse;
  }

  /**
   * Get JSON Web Key Set (JWKS) for external token validation
   */
  async getJwks(): Promise<JWKSResponse> {
    return this.jwtKeysService.getJwks();
  }

  /**
   * Extract JWT from request headers or cookies
   * Supports both Authorization Bearer header and HTTP-only cookie
   */
  extractJwtFromRequest(request: {
    headers?: Record<string, unknown>;
    cookies?: Record<string, unknown>;
  }): string | null {
    const headers = request.headers || {};

    // Check Authorization header
    const authHeader = headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // Skip API keys (they start with hh_)
      if (!token.startsWith('hh_')) {
        return token;
      }
    }

    // Fallback to cookie
    const cookies = request.cookies || {};
    const accessToken = cookies.accessToken;
    if (typeof accessToken === 'string') {
      return accessToken;
    }

    return null;
  }

  /**
   * Check if a JWT subject is a system subject
   */
  isSystemSubject(subject?: string | null): boolean {
    return this.jwtKeysService.isSystemSubject(subject);
  }

  /**
   * Get client IP from request
   */
  private getClientIp(request: {
    headers?: Record<string, unknown>;
    socket?: { remoteAddress?: string };
  }): string {
    const headers = request.headers || {};
    const xForwardedFor = headers['x-forwarded-for'];

    if (typeof xForwardedFor === 'string') {
      const first = xForwardedFor.split(',')[0];
      return first ? first.trim() : 'unknown';
    }
    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      const first = xForwardedFor[0];
      if (typeof first === 'string' && first.length > 0) {
        const firstEntry = first.split(',')[0];
        return firstEntry ? firstEntry.trim() : 'unknown';
      }
    }

    return request.socket?.remoteAddress || 'unknown';
  }

  /**
   * Authenticate request using JWT or API key
   * Tries JWT first, falls back to API key
   */
  async authenticateRequest(request: {
    headers?: Record<string, unknown>;
    cookies?: Record<string, unknown>;
    url?: string;
    socket?: { remoteAddress?: string };
  }): Promise<AuthenticatedUser | ApiKeyAuthenticatedUser> {
    // Get client IP for API key validation
    const clientIp = this.getClientIp(request);

    // Try JWT first (most common)
    const jwtToken = this.extractJwtFromRequest(request);
    if (jwtToken) {
      const result = await this.validateTokenForExternalService(jwtToken);
      if (result.valid && result.payload) {
        // Convert to AuthenticatedUser format
        const userId = result.payload.sub as UserId;
        return {
          userId,
          email: result.payload.email || '',
          name: result.payload.name || '',
          currentOrgId: result.payload.currentOrgId || ('' as OrganizationId),
          orgMemberships: result.payload.orgMemberships || [],
          isDevAdmin: result.payload.isDevAdmin || false,
          devAdminMode: result.payload.devAdminMode || false,
          isSystemUser: this.jwtKeysService.isSystemSubject(result.payload.sub),
          systemSubject: this.jwtKeysService.isSystemSubject(result.payload.sub)
            ? result.payload.sub
            : undefined,
        };
      }
    }

    // Try API key
    const apiKey = this.apiKeyService.extractApiKeyFromRequest(request);
    if (apiKey) {
      const validatedKey = await this.apiKeyService.validateApiKey(
        apiKey,
        clientIp,
      );
      return {
        userId: validatedKey.createdBy,
        organizationId: validatedKey.organizationId,
        scopes: validatedKey.scopes,
        apiKeyId: validatedKey.id,
        apiKeyName: validatedKey.name,
        authType: 'api-key' as const,
      };
    }

    throw new UnauthorizedException(
      'No valid authentication credentials found',
    );
  }
}
