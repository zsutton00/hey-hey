import { OAuthClient } from '../../../auth';
import { CredentialStore } from '../../../credentials/store';
import { vi } from 'vitest';

export interface TestOAuthClientOverrides {
  getAccessToken?: OAuthClient['getAccessToken'];
  isAuthenticated?: OAuthClient['isAuthenticated'];
  login?: OAuthClient['login'];
  logout?: OAuthClient['logout'];
}

/** Real OAuth owner with its keychain boundary and public behavior controlled by spies. */
export const createTestOAuthClient = (overrides: TestOAuthClientOverrides = {}): OAuthClient => {
  const credentials = new Map<string, Awaited<ReturnType<CredentialStore['retrieve']>>>();
  const credentialStore = new CredentialStore();
  vi.spyOn(credentialStore, 'retrieve').mockImplementation(async (key) => {
    return credentials.get(key) ?? null;
  });
  vi.spyOn(credentialStore, 'store').mockImplementation(async (key, credential) => {
    credentials.set(key, credential);
  });
  vi.spyOn(credentialStore, 'update').mockImplementation(async (key, credential) => {
    credentials.set(key, credential);
  });
  vi.spyOn(credentialStore, 'delete').mockImplementation(async (key) => {
    credentials.delete(key);
  });

  const client = new OAuthClient({
    config: { baseUrl: 'https://oauth.server-test' },
    credentialStore,
  });
  vi.spyOn(client, 'getAccessToken').mockImplementation(
    overrides.getAccessToken ??
      (async () => ({
        success: false,
        error: 'Test OAuth token boundary was called unexpectedly.',
      })),
  );
  vi.spyOn(client, 'isAuthenticated').mockImplementation(
    overrides.isAuthenticated ?? (async () => false),
  );
  vi.spyOn(client, 'login').mockImplementation(
    overrides.login ??
      (async () => ({ success: false, error: 'Test OAuth login was called unexpectedly.' })),
  );
  vi.spyOn(client, 'logout').mockImplementation(
    overrides.logout ??
      (async () => ({ success: false, error: 'Test OAuth logout was called unexpectedly.' })),
  );
  return client;
};
