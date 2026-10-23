import { vi } from 'vitest';
import { CredentialStore } from '../credentials/store';
import { OAuthClient } from './oauth-client';

export const createTestOAuthClient = (
  result: Awaited<ReturnType<OAuthClient['getAccessToken']>> = {
    success: true,
    data: 'access-token',
  },
): OAuthClient => {
  const oauthClient = new OAuthClient({ credentialStore: new CredentialStore() });
  vi.spyOn(oauthClient, 'getAccessToken').mockResolvedValue(result);
  return oauthClient;
};
