import { describe, expect, it, vi } from 'vitest';
import { CredentialStore, type OAuthCredential } from '../../credentials/store';
import {
  buildInjectedCredential,
  seedCredentialFromEnvIfAbsent,
  validateInjectedToken,
} from '../token-injection';

const ACTIVE_KEY = 'heyhey:oauth:heyhey.dev';

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const makeJwt = (
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { typ: 'JWT', alg: 'HS256' },
): string => `${b64url(header)}.${b64url(payload)}.signature`;

const futureExp = (): number => Math.floor(Date.now() / 1000) + 3600;

const memoryStore = (
  seed: Record<string, OAuthCredential> = {},
): CredentialStore & { map: Map<string, OAuthCredential> } => {
  const map = new Map<string, OAuthCredential>(Object.entries(seed));
  const store = Object.assign(new CredentialStore(), { map });
  vi.spyOn(store, 'store').mockImplementation((key: string, credential: OAuthCredential) => {
    map.set(key, credential);
    return Promise.resolve();
  });
  vi.spyOn(store, 'retrieve').mockImplementation((key: string) =>
    Promise.resolve(map.get(key) ?? null),
  );
  return store;
};

describe('validateInjectedToken', () => {
  it('accepts a well-formed token with a future exp', () => {
    expect(validateInjectedToken(makeJwt({ exp: futureExp() }))).toEqual({ valid: true });
  });

  it('accepts a token without an exp claim', () => {
    expect(validateInjectedToken(makeJwt({ sub: 'user-1' }))).toEqual({ valid: true });
  });

  it('rejects an empty token', () => {
    const result = validateInjectedToken('   ');
    expect(result.valid).toBe(false);
  });

  it('rejects input that is not three segments', () => {
    const result = validateInjectedToken('not-a-jwt');
    expect(result.valid).toBe(false);
  });

  it('rejects a header missing typ/alg', () => {
    const result = validateInjectedToken(makeJwt({ exp: futureExp() }, { kid: 'k1' }));
    expect(result.valid).toBe(false);
  });

  it('rejects a token whose exp is in the past', () => {
    const result = validateInjectedToken(makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('expired');
    }
  });
});

describe('buildInjectedCredential', () => {
  it('derives expiresAt from the JWT exp when not supplied', () => {
    const exp = futureExp();
    const credential = buildInjectedCredential({ accessToken: makeJwt({ exp }) });

    expect(credential.expiresAt).toBe(new Date(exp * 1000).toISOString());
    expect(credential.tokenType).toBe('Bearer');
    expect(credential.refreshToken).toBeUndefined();
  });

  it('prefers an explicit expiresAt over the exp claim', () => {
    const explicit = new Date(Date.now() + 7200 * 1000).toISOString();
    const credential = buildInjectedCredential({
      accessToken: makeJwt({ exp: futureExp() }),
      expiresAt: explicit,
    });

    expect(credential.expiresAt).toBe(explicit);
  });

  it('persists a refresh token when supplied', () => {
    const credential = buildInjectedCredential({
      accessToken: makeJwt({ exp: futureExp() }),
      refreshToken: 'refresh-1',
    });

    expect(credential.refreshToken).toBe('refresh-1');
  });

  it('throws when expiry cannot be determined', () => {
    expect(() => buildInjectedCredential({ accessToken: makeJwt({ sub: 'user-1' }) })).toThrow(
      /expiry/,
    );
  });
});

describe('seedCredentialFromEnvIfAbsent', () => {
  it('is a no-op when HEYHEY_ACCESS_TOKEN is unset', async () => {
    const store = memoryStore();

    await expect(seedCredentialFromEnvIfAbsent({ credentialStore: store, env: {} })).resolves.toBe(
      false,
    );
    expect(store.map.size).toBe(0);
  });

  it('writes a credential under the active key when none is stored', async () => {
    const store = memoryStore();
    const token = makeJwt({ exp: futureExp() });

    await expect(
      seedCredentialFromEnvIfAbsent({
        credentialStore: store,
        env: { HEYHEY_ACCESS_TOKEN: token, HEYHEY_REFRESH_TOKEN: 'refresh-1' },
      }),
    ).resolves.toBe(true);

    const stored = store.map.get(ACTIVE_KEY);
    expect(stored?.accessToken).toBe(token);
    expect(stored?.refreshToken).toBe('refresh-1');
  });

  it('never overwrites an existing credential', async () => {
    const existing: OAuthCredential = {
      accessToken: 'pre-existing',
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    const store = memoryStore({ [ACTIVE_KEY]: existing });

    await expect(
      seedCredentialFromEnvIfAbsent({
        credentialStore: store,
        env: { HEYHEY_ACCESS_TOKEN: makeJwt({ exp: futureExp() }) },
      }),
    ).resolves.toBe(false);

    expect(store.map.get(ACTIVE_KEY)).toBe(existing);
  });

  it('skips and logs when the env token is malformed, writing nothing', async () => {
    const store = memoryStore();
    const log = vi.fn();

    await expect(
      seedCredentialFromEnvIfAbsent({
        credentialStore: store,
        env: { HEYHEY_ACCESS_TOKEN: 'not-a-jwt' },
        log,
      }),
    ).resolves.toBe(false);

    expect(store.map.size).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Ignoring HEYHEY_ACCESS_TOKEN'));
  });
});
