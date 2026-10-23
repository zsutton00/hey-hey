import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CorsConfig } from '../config/cors.config';
import { CONTROLLER_BINDING_COOKIE_NAMES } from '../../services/controller-authorization/controller-binding-cookie.service';

@Injectable()
export class ControllerBindingOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const isCookieAuthenticated =
      typeof cookies?.accessToken === 'string' ||
      CONTROLLER_BINDING_COOKIE_NAMES.some(
        (name) => typeof cookies?.[name] === 'string',
      );

    if (!isCookieAuthenticated) return true;
    const origin = request.get('origin');
    if (!CorsConfig.isBrowserOriginAllowed(origin)) {
      throw new ForbiddenException('Browser origin is not allowed');
    }
    return true;
  }
}
