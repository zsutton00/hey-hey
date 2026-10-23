import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

@Injectable()
export class DevAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (!user.isDevAdmin || !user.devAdminMode) {
      throw new ForbiddenException('Dev-admin mode required');
    }

    return true;
  }
}
