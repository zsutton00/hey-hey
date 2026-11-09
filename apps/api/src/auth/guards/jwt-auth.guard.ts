import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  FlexibleAuthenticatedUser,
  isJwtUser,
} from '../decorators/current-api-user.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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

    // The global FlexibleAuthGuard already authenticated this request. Reuse
    // its JWT user instead of repeating the user, membership and entitlement
    // reads. API-key users still fall through so JWT-only routes reject them.
    const request = context.switchToHttp().getRequest();
    const authenticatedUser: FlexibleAuthenticatedUser | undefined =
      request.user;
    if (authenticatedUser && isJwtUser(authenticatedUser)) {
      return true;
    }

    return super.canActivate(context);
  }
}
