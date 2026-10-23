import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONTROLLER_BROWSER_IDENTITY_TTL_MS } from './controller-browser-binding.service';

export const CONTROLLER_BINDING_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? '__Host-hey_hey_controller_binding'
    : 'hey_hey_controller_binding';

export const CONTROLLER_BINDING_COOKIE_NAMES = [
  '__Host-hey_hey_controller_binding',
  'hey_hey_controller_binding',
] as const;

export const readControllerBindingSecret = (
  request: Request | undefined,
): string | undefined => {
  const cookies = request?.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[CONTROLLER_BINDING_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

@Injectable()
export class ControllerBindingCookieService {
  set(response: Response, secret: string, expiresAt: Date): void {
    const identityExpiresAt = new Date(
      Math.max(
        expiresAt.getTime(),
        Date.now() + CONTROLLER_BROWSER_IDENTITY_TTL_MS,
      ),
    );
    response.cookie(CONTROLLER_BINDING_COOKIE_NAME, secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: identityExpiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(CONTROLLER_BINDING_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }
}
