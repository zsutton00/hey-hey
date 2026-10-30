import type { Response } from 'express';
import { cookieAttributes } from '../../auth/browser-session-cookies';
import {
  DEMO_BINDING_COOKIE_MAX_AGE_MILLISECONDS,
  DEMO_BINDING_COOKIE_NAME,
} from './demo-sandbox.constants';

export function setDemoBindingCookie(
  response: Response,
  bindingSecret: string,
): void {
  response.cookie(DEMO_BINDING_COOKIE_NAME, bindingSecret, {
    ...cookieAttributes('/'),
    maxAge: DEMO_BINDING_COOKIE_MAX_AGE_MILLISECONDS,
  });
}

/**
 * Makes this browser forget its demo. Resume signs a browser straight back in
 * to the sandbox its binding names, so any real sign-in or sign-out must drop it.
 */
export function clearDemoBindingCookie(response: Response): void {
  response.clearCookie(DEMO_BINDING_COOKIE_NAME, cookieAttributes('/'));
}
