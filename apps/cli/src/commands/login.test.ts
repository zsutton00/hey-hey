import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type OAuthCredential } from '../credentials/store';

// One shared in-memory credential store, used both as the (mocked) store the
// login command writes through and as the explicit store the OAuth client reads
// back from — so the assertion exercises a real write→read round-trip.
const memory = new Map<string, OAuthCredential>();
const sharedStore = new CredentialStore();
const installSharedStoreSpies = (): void => {
  vi.spyOn(sharedStore, 'store').mockImplementation((key: string, credential: OAuthCredential) => {
    memory.set(key, credential);
    return Promise.resolve();
  });
  vi.spyOn(sharedStore, 'retrieve').mockImplementation((key: string) =>
    Promise.resolve(memory.get(key) ?? null),
  );
  vi.spyOn(sharedStore, 'update').mockImplementation((key: string, credential: OAuthCredential) => {
    memory.set(key, credential);
    return Promise.resolve();
  });
  vi.spyOn(sharedStore, 'delete').mockImplementation((key: string) => {
    memory.delete(key);
    return Promise.resolve();
  });
};

vi.mock('open', () => ({ default: vi.fn() }));

import open from 'open';
import { OAuthClient } from '../auth/index';
import { runLoginCommand } from './login';

const ACTIVE_KEY = 'heyhey:oauth:heyhey.dev';

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const makeJwt = (payload: Record<string, unknown>): string =>
  `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url(payload)}.signature`;

const futureExp = (): number => Math.floor(Date.now() / 1000) + 3600;

describe('runLoginCommand --token', () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
    installSharedStoreSpies();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the injected token under the active key and reads it back via the OAuth client', async () => {
    const token = makeJwt({ exp: futureExp(), sub: 'user-1' });

    await expect(
      runLoginCommand(['--token', token, '--refresh-token', 'refresh-1'], {
        credentialStore: sharedStore,
      }),
    ).resolves.toBe(true);

    expect(memory.get(ACTIVE_KEY)?.accessToken).toBe(token);
    expect(memory.get(ACTIVE_KEY)?.refreshToken).toBe('refresh-1');
    expect(open).not.toHaveBeenCalled();

    const client = new OAuthClient({ credentialStore: sharedStore });
    const result = await client.getAccessToken();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(token);
    }
  });

  it('honors an explicit --expires-at', async () => {
    const token = makeJwt({ exp: futureExp() });
    const expiresAt = new Date(Date.now() + 7200 * 1000).toISOString();

    await expect(
      runLoginCommand(['--token', token, '--expires-at', expiresAt], {
        credentialStore: sharedStore,
      }),
    ).resolves.toBe(true);

    expect(memory.get(ACTIVE_KEY)?.expiresAt).toBe(expiresAt);
  });

  it('rejects a missing token value and writes nothing', async () => {
    await expect(runLoginCommand(['--token'], { credentialStore: sharedStore })).resolves.toBe(
      false,
    );
    expect(memory.size).toBe(0);
  });

  it('rejects a non-JWT token and writes nothing', async () => {
    await expect(
      runLoginCommand(['--token', 'not-a-jwt'], { credentialStore: sharedStore }),
    ).resolves.toBe(false);
    expect(memory.size).toBe(0);
  });

  it('rejects an expired token and writes nothing', async () => {
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });

    await expect(
      runLoginCommand(['--token', expired], { credentialStore: sharedStore }),
    ).resolves.toBe(false);
    expect(memory.size).toBe(0);
  });
});

describe('runLoginCommand --force', () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
    installSharedStoreSpies();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the active profile credential before starting browser login', async () => {
    memory.set(ACTIVE_KEY, {
      accessToken: makeJwt({ exp: futureExp() }),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const oauthClient = {
      isAuthenticated: vi.fn().mockResolvedValue(false),
      login: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    } as unknown as OAuthClient;

    await expect(
      runLoginCommand(['--force'], { credentialStore: sharedStore, oauthClient }),
    ).resolves.toBe(true);

    expect(sharedStore.delete).toHaveBeenCalledWith(ACTIVE_KEY);
    expect(memory.has(ACTIVE_KEY)).toBe(false);
    expect(oauthClient.login).toHaveBeenCalledOnce();
  });
});
