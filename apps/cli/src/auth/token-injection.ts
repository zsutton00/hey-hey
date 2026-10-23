import { CredentialStore } from '../credentials/store';
import type { OAuthCredential } from '../credentials/types';
import { getActiveCredentialKey } from './oauth-client';
import { base64UrlDecode } from './token-utils';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export type TokenValidationResult = { valid: true } | { valid: false; error: string };

const decodeSegment = (segment: string): unknown => {
  const json = base64UrlDecode(segment);
  if (json === null) {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/**
 * Parse-only validation of an injected JWT before any credential is written:
 * three dot-separated segments, decodable header carrying `typ`/`alg`, a
 * decodable object payload, and — when present — a non-expired numeric `exp`.
 * A missing `exp` is allowed (callers supply expiry explicitly). This never
 * verifies the signature; it only rejects input that cannot be a usable token.
 */
export const validateInjectedToken = (token: string): TokenValidationResult => {
  if (!token || token.trim().length === 0) {
    return { valid: false, error: 'Token is empty.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      error: 'Token is not a well-formed JWT (expected three dot-separated segments).',
    };
  }
  const [headerPart, payloadPart] = parts;
  if (!headerPart || !payloadPart) {
    return { valid: false, error: 'Token has an empty header or payload segment.' };
  }

  const header = decodeSegment(headerPart);
  if (!isRecord(header) || typeof header['typ'] !== 'string' || typeof header['alg'] !== 'string') {
    return { valid: false, error: 'Token header is missing a typ/alg field.' };
  }

  const payload = decodeSegment(payloadPart);
  if (!isRecord(payload)) {
    return { valid: false, error: 'Token payload is not a decodable JSON object.' };
  }

  const exp = payload['exp'];
  if (exp !== undefined) {
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      return { valid: false, error: 'Token exp claim is malformed.' };
    }
    if (exp * 1000 <= Date.now()) {
      return { valid: false, error: 'Token is expired.' };
    }
  }

  return { valid: true };
};

const readExpiresAtFromToken = (token: string): string | null => {
  const parts = token.split('.');
  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }
  const payload = decodeSegment(payloadPart);
  if (!isRecord(payload)) {
    return null;
  }
  const exp = payload['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null;
  }
  return new Date(exp * 1000).toISOString();
};

export interface InjectedCredentialInput {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/**
 * Build an OAuthCredential from a pre-minted token. `expiresAt` is taken from
 * the explicit value when supplied, otherwise derived from the JWT `exp` claim.
 * When no refresh token is supplied the credential is access-only, matching
 * what the browser flow persists when the server omits a refresh token.
 */
export const buildInjectedCredential = (input: InjectedCredentialInput): OAuthCredential => {
  const expiresAt = input.expiresAt ?? readExpiresAtFromToken(input.accessToken);
  if (!expiresAt) {
    throw new Error(
      'Cannot determine token expiry: the token has no exp claim and no explicit expiry was provided.',
    );
  }

  return {
    accessToken: input.accessToken,
    expiresAt,
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
    tokenType: 'Bearer',
    issuedAt: new Date().toISOString(),
  };
};

export interface SeedCredentialOptions {
  credentialStore?: CredentialStore;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Seed a credential from `HEYHEY_ACCESS_TOKEN` (with optional
 * `HEYHEY_REFRESH_TOKEN` / `HEYHEY_TOKEN_EXPIRES_AT`) under the active key, but
 * only when nothing is already stored there — an existing credential is never
 * overwritten. Best-effort: a missing env var is a silent no-op and a malformed
 * token is logged and skipped rather than crashing the entry point. Returns
 * true only when a new credential was written.
 */
export const seedCredentialFromEnvIfAbsent = async (
  options: SeedCredentialOptions = {},
): Promise<boolean> => {
  const env = options.env ?? process.env;
  const accessToken = env['HEYHEY_ACCESS_TOKEN'];
  if (!accessToken) {
    return false;
  }

  const log = options.log ?? ((message: string) => console.warn(message));

  const validation = validateInjectedToken(accessToken);
  if (!validation.valid) {
    log(`Ignoring HEYHEY_ACCESS_TOKEN: ${validation.error}`);
    return false;
  }

  const credentialStore = options.credentialStore ?? new CredentialStore();
  const key = getActiveCredentialKey();

  const existing = await credentialStore.retrieve(key);
  if (existing) {
    return false;
  }

  try {
    const credential = buildInjectedCredential({
      accessToken,
      ...(env['HEYHEY_REFRESH_TOKEN'] ? { refreshToken: env['HEYHEY_REFRESH_TOKEN'] } : {}),
      ...(env['HEYHEY_TOKEN_EXPIRES_AT'] ? { expiresAt: env['HEYHEY_TOKEN_EXPIRES_AT'] } : {}),
    });
    await credentialStore.store(key, credential);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Ignoring HEYHEY_ACCESS_TOKEN: ${message}`);
    return false;
  }
};
