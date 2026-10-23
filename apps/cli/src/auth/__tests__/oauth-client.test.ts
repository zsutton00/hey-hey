import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type OAuthCredential } from '../../credentials/store';
import { OAuthClient } from '../oauth-client';

const DEFAULT_KEY = 'heyhey:oauth:heyhey.dev';
const LOCAL_KEY = 'heyhey:oauth:localhost:3000';
const PROFILE_KEY = 'heyhey:oauth:localhost:3000:e2e';

const mockCredentialStore = (): CredentialStore => {
  const store = new Map<string, OAuthCredential>();
  const credentialStore = new CredentialStore();
  vi.spyOn(credentialStore, 'store').mockImplementation(
    async (key: string, credential: OAuthCredential) => {
      store.set(key, credential);
    },
  );
  vi.spyOn(credentialStore, 'retrieve').mockImplementation(async (key: string) => {
    return store.get(key) || null;
  });
  vi.spyOn(credentialStore, 'update').mockImplementation(
    async (key: string, credential: OAuthCredential) => {
      store.set(key, credential);
    },
  );
  vi.spyOn(credentialStore, 'delete').mockImplementation(async (key: string) => {
    store.delete(key);
  });
  return credentialStore;
};

const mockFreshCredential = (): OAuthCredential => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  scope: ['read', 'write'],
  tokenType: 'Bearer',
});

const mockExpiredCredential = (): OAuthCredential => ({
  accessToken: 'expired-access',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() - 1000).toISOString(),
  scope: ['read', 'write'],
  tokenType: 'Bearer',
});

describe('OAuthClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('isAuthenticated', () => {
    it('returns true when credential exists', async () => {
      const credentialStore = mockCredentialStore();
      await credentialStore.store(DEFAULT_KEY, mockFreshCredential());

      const client = new OAuthClient({ credentialStore });
      const result = await client.isAuthenticated();

      expect(result).toBe(true);
    });

    it('returns false when no credential exists', async () => {
      const credentialStore = mockCredentialStore();
      const client = new OAuthClient({ credentialStore });
      const result = await client.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('returns access token when valid', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockFreshCredential();
      await credentialStore.store(DEFAULT_KEY, credential);

      const client = new OAuthClient({ credentialStore });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('access-token');
      }
    });

    it('forces token refresh when requested', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockFreshCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'forced-refresh-access',
          refresh_token: 'forced-refresh-token',
          expires_in: 3600,
          scope: 'read write',
          token_type: 'Bearer',
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken({ forceRefresh: true });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('forced-refresh-access');
      }
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(credentialStore.update).toHaveBeenCalledWith(
        LOCAL_KEY,
        expect.objectContaining({
          accessToken: 'forced-refresh-access',
          refreshToken: 'forced-refresh-token',
        }),
      );
    });

    it('returns refresh error when forced token refresh fails', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockFreshCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Refresh token revoked',
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken({ forceRefresh: true });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Refresh token revoked');
      }
      expect(credentialStore.update).not.toHaveBeenCalled();
    });

    it('returns error when not authenticated', async () => {
      const credentialStore = mockCredentialStore();
      const client = new OAuthClient({ credentialStore });
      const result = await client.getAccessToken();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Not authenticated');
      }
    });

    it('refreshes token when expired', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockExpiredCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'read write',
          token_type: 'Bearer',
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('new-access');
      }
      expect(credentialStore.update).toHaveBeenCalledWith(
        LOCAL_KEY,
        expect.objectContaining({
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        }),
      );
    });

    it('returns error when refresh fails', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockExpiredCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Refresh token expired',
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Refresh token expired');
      }
    });

    it('preserves existing refresh token when response omits it', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockExpiredCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          expires_in: 3600,
          scope: 'read write',
          token_type: 'Bearer',
          // refresh_token is omitted
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('new-access');
      }
      expect(credentialStore.update).toHaveBeenCalledWith(
        LOCAL_KEY,
        expect.objectContaining({
          accessToken: 'new-access',
          refreshToken: 'refresh-token', // Preserved from original
        }),
      );
    });

    it('returns error when refresh token is missing on expired credentials', async () => {
      const credentialStore = mockCredentialStore();
      const credential: OAuthCredential = {
        accessToken: 'expired-access',
        refreshToken: '', // No refresh token
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: ['read', 'write'],
        tokenType: 'Bearer',
      };
      await credentialStore.store(DEFAULT_KEY, credential);

      const client = new OAuthClient({ credentialStore });
      const result = await client.getAccessToken();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('no refresh token available');
      }
    });

    it('handles missing scope in token response', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockExpiredCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          // scope is omitted
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('new-access');
      }
      expect(credentialStore.update).toHaveBeenCalledWith(
        LOCAL_KEY,
        expect.objectContaining({
          accessToken: 'new-access',
          scope: [], // Defaults to empty array
        }),
      );
    });
  });

  describe('HEYHEY_PROFILE namespacing', () => {
    beforeEach(() => {
      vi.stubEnv('HEYHEY_PROFILE', 'e2e');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('retrieve reads from the profile-scoped key', async () => {
      const credentialStore = mockCredentialStore();
      await credentialStore.store(PROFILE_KEY, mockFreshCredential());

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('access-token');
      }
      expect(credentialStore.retrieve).toHaveBeenCalledWith(PROFILE_KEY);
    });

    it('update writes to the profile-scoped key on refresh', async () => {
      const credentialStore = mockCredentialStore();
      await credentialStore.store(PROFILE_KEY, mockExpiredCredential());

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'profile-refresh-access',
          refresh_token: 'profile-refresh-token',
          expires_in: 3600,
          scope: 'read write',
          token_type: 'Bearer',
        }),
      });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.getAccessToken();

      expect(result.success).toBe(true);
      expect(credentialStore.update).toHaveBeenCalledWith(
        PROFILE_KEY,
        expect.objectContaining({ accessToken: 'profile-refresh-access' }),
      );
    });

    it('delete removes the profile-scoped key on logout', async () => {
      const credentialStore = mockCredentialStore();
      await credentialStore.store(PROFILE_KEY, mockFreshCredential());

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.logout();

      expect(result.success).toBe(true);
      expect(credentialStore.delete).toHaveBeenCalledWith(PROFILE_KEY);
    });

    it('store writes the profile-scoped key without touching the un-profiled key', async () => {
      const credentialStore = mockCredentialStore();
      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });

      // The un-profiled LOCAL_KEY holds a separate account; the profile run
      // must not read or overwrite it.
      await credentialStore.store(LOCAL_KEY, mockFreshCredential());
      const isAuthed = await client.isAuthenticated();

      expect(isAuthed).toBe(false);
      expect(credentialStore.retrieve).toHaveBeenCalledWith(PROFILE_KEY);
      expect(credentialStore.retrieve).not.toHaveBeenCalledWith(LOCAL_KEY);
    });
  });

  describe('logout', () => {
    it('revokes token and deletes credential', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockFreshCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
        })
        .mockResolvedValueOnce({
          ok: true,
        });

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.logout();

      expect(result.success).toBe(true);
      expect(credentialStore.delete).toHaveBeenCalledWith(LOCAL_KEY);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:3000/api/oauth/revoke',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/api/oauth/revoke',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('succeeds even when no credential exists', async () => {
      const credentialStore = mockCredentialStore();
      const client = new OAuthClient({ credentialStore });
      const result = await client.logout();

      expect(result.success).toBe(true);
    });

    it('returns error when revocation fails', async () => {
      const credentialStore = mockCredentialStore();
      const credential = mockFreshCredential();
      await credentialStore.store(LOCAL_KEY, credential);

      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const client = new OAuthClient({
        credentialStore,
        config: { baseUrl: 'http://localhost:3000' },
      });
      const result = await client.logout();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Network error');
      }
    });
  });
});
