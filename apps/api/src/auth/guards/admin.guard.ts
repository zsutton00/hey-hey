import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

type PlatformAdminRequest = {
  user?: AuthenticatedUser;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
};

type PlatformAdminBasis = 'allowlist' | 'loopback_development';

/**
 * The single platform-admin decision: the authenticated user's ID is in the
 * ADMIN_USER_IDS allowlist (comma-separated env var), or has explicitly
 * enabled development-admin claims on a direct loopback request.
 *
 * `isPlatformAdmin` exposes the same decision to the browser so it shows
 * admin surfaces to exactly the people this guard admits.
 *
 * Designed to be replaced later with a proper role-based check.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly adminUserIds: Set<string>;
  private readonly isDevelopment: boolean;

  constructor(private configService: ConfigService) {
    const raw = this.configService.get<string>('ADMIN_USER_IDS') || '';
    this.adminUserIds = new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const nodeEnv = this.configService.get<string>('NODE_ENV')?.trim();
    this.isDevelopment = nodeEnv === 'development';

    this.logger.log(`Initialized with ${this.adminUserIds.size} admin user(s)`);
    if (this.isDevelopment) {
      this.logger.warn(
        'Development mode allows explicit development administrators from a direct loopback peer to access admin endpoints',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PlatformAdminRequest>();
    const user = request.user;

    if (!user) {
      this.logger.warn({
        event: 'platform_admin_authorization_rejected',
        reason: 'authentication_missing',
      });
      throw new ForbiddenException('Authentication required');
    }

    const basis = this.resolveBasis(request, user);
    if (!basis) {
      this.logger.warn({
        event: 'platform_admin_authorization_rejected',
        userId: user.userId,
        reason: 'admin_permission_missing',
      });
      throw new ForbiddenException('Admin access required');
    }

    this.logger.log({
      event: 'platform_admin_authorization_allowed',
      userId: user.userId,
      basis,
    });

    return true;
  }

  isPlatformAdmin(request: PlatformAdminRequest): boolean {
    return request.user
      ? this.resolveBasis(request, request.user) !== null
      : false;
  }

  private resolveBasis(
    request: PlatformAdminRequest,
    user: AuthenticatedUser,
  ): PlatformAdminBasis | null {
    if (this.adminUserIds.has(user.userId)) return 'allowlist';
    const isLoopbackDevelopmentUser =
      this.isDevelopment &&
      user.isDevAdmin === true &&
      user.devAdminMode === true &&
      this.isLoopbackAddress(request.socket?.remoteAddress) &&
      !this.hasForwardingHeaders(request.headers);
    return isLoopbackDevelopmentUser ? 'loopback_development' : null;
  }

  private isLoopbackAddress(address: string | undefined): boolean {
    if (!address) return false;
    return (
      address === '::1' ||
      address.startsWith('127.') ||
      address.startsWith('::ffff:127.')
    );
  }

  private hasForwardingHeaders(
    headers: Record<string, string | string[] | undefined> | undefined,
  ): boolean {
    if (!headers) return false;
    return Boolean(
      headers.forwarded || headers['x-forwarded-for'] || headers['x-real-ip'],
    );
  }
}
