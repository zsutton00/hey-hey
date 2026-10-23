import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard extends AuthGuard('api-key') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
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
    _context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Valid API key required');
    }

    // Ensure it's an API key authenticated user
    if (typeof user === 'object' && user !== null && 'authType' in user) {
      const userWithType = user as { authType?: string };
      if (!userWithType.authType || userWithType.authType !== 'api-key') {
        throw new UnauthorizedException('API key authentication required');
      }
    } else {
      throw new UnauthorizedException('API key authentication required');
    }

    return user;
  }
}

/**
 * Decorator to check if the current API key has required scopes
 */
export const RequireScopes = (scopes: string[]) => {
  return (
    _target: unknown,
    _propertyName: string,
    descriptor: PropertyDescriptor,
  ) => {
    const method = descriptor.value;
    descriptor.value = function (...args: unknown[]) {
      const request = args.find(
        (arg): arg is { user?: { authType?: string; scopes?: string[] } } =>
          typeof arg === 'object' && arg !== null && 'user' in arg,
      );

      if (request?.user?.authType === 'api-key') {
        const userScopes = request.user.scopes || [];
        const hasRequiredScopes = scopes.every(
          (scope) =>
            userScopes.includes(scope) || userScopes.includes('admin:org'),
        );

        if (!hasRequiredScopes) {
          throw new ForbiddenException(`Required scopes: ${scopes.join(', ')}`);
        }
      }
      return method.apply(this, args);
    };
  };
};
