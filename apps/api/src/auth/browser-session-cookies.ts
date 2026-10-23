import { CookieOptions, Request, Response } from 'express';
import { EstablishedBrowserSession } from './services/browser-session.service';
import { BrowserSessionRequestMetadata } from './browser-session.types';

export const ACCESS_COOKIE_NAME = 'accessToken';
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const AUTH_ROUTE_PREFIX = '/api/v1/auth';
const BROWSER_REFRESH_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const MAX_IP_ADDRESS_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 512;

export function cookieAttributes(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path,
  };
}

export function requiredExpiresIn(
  expiresIn: number | undefined,
  errorMessage: string,
): number {
  if (
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error(errorMessage);
  }

  return expiresIn;
}

/** Sets the ordinary browser session cookies for an established session. */
export function setBrowserSessionCookies(
  response: Response,
  session: EstablishedBrowserSession,
): void {
  if ('status' in session.response) {
    response.clearCookie(ACCESS_COOKIE_NAME, cookieAttributes('/'));
    response.clearCookie(REFRESH_COOKIE_NAME, cookieAttributes('/'));
    response.cookie(REFRESH_COOKIE_NAME, session.refreshSecret, {
      ...cookieAttributes(AUTH_ROUTE_PREFIX),
      maxAge: BROWSER_REFRESH_TTL_MILLISECONDS,
    });
    return;
  }
  const expiresIn = requiredExpiresIn(
    session.response.expiresIn,
    'Browser access-token expiry is missing or invalid',
  );

  response.cookie(ACCESS_COOKIE_NAME, session.response.accessToken, {
    ...cookieAttributes('/'),
    maxAge: expiresIn * 1000,
  });
  response.cookie(REFRESH_COOKIE_NAME, session.refreshSecret, {
    ...cookieAttributes(AUTH_ROUTE_PREFIX),
    maxAge: BROWSER_REFRESH_TTL_MILLISECONDS,
  });
}

export function browserSessionRequestMetadata(
  request: Request,
): BrowserSessionRequestMetadata {
  const userAgent = request.headers['user-agent'];
  const ipAddress = request.ip?.trim().slice(0, MAX_IP_ADDRESS_LENGTH);
  const boundedUserAgent =
    typeof userAgent === 'string'
      ? userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH)
      : undefined;

  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(boundedUserAgent ? { userAgent: boundedUserAgent } : {}),
  };
}
