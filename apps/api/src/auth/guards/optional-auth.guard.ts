import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that attempts JWT authentication but never blocks.
 *
 * If a valid Bearer token is present, `request.user` is populated as usual.
 * If the token is missing, expired, or invalid, the request continues
 * unauthenticated (`request.user` remains undefined).
 *
 * Use this on endpoints that need to work without auth (e.g. MCP tool
 * discovery) but benefit from auth when available (e.g. MCP tool execution).
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const hasAuth = Boolean(request.headers?.authorization);

    if (!hasAuth) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      this.logger.debug(
        `[OptionalAuthGuard] Auth attempted but failed: ${err?.message || 'no user resolved'}`,
      );
      return undefined as TUser;
    }
    return user;
  }
}
