import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class FlexibleAuthGuard extends AuthGuard(['jwt', 'api-key']) {
  private readonly logger = new Logger(FlexibleAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest();
    const handler = context.getHandler();
    const klass = context.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      klass,
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest();

    // If there's an error or no user, throw unauthorized
    if (err || !user) {
      const userAgent = request.headers?.['user-agent'] ?? 'unknown';
      const ip =
        request.headers?.['x-forwarded-for'] ??
        request.ip ??
        request.socket?.remoteAddress ??
        'unknown';
      this.logger.error(
        `[FlexibleAuthGuard] Authentication failed for ${request.method} ${request.url} - Error: ${err?.message || 'No user'} - IP: ${ip} - UA: ${userAgent}`,
      );
      throw new UnauthorizedException('Authentication required');
    }

    if (!(request.url as string).startsWith('/api/v1/debug')) {
      this.logger.debug(
        `[FlexibleAuthGuard] Authentication successful for ${request.method} ${request.url}`,
      );
    }

    return user;
  }
}
