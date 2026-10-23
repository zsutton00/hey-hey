import type { OAuthClient } from './oauth-client';

export type AccountLogoutResult =
  | { readonly outcome: 'signed-out' }
  | { readonly outcome: 'not-signed-in' }
  | { readonly outcome: 'failed'; readonly message: string };

/**
 * Signs the account out through the OAuth owner. Only account tokens are
 * revoked; machine credentials and local controller authority are untouched.
 * The OAuth owner's auth-change notification is what withdraws
 * account-derived session metadata.
 */
export const logOutAccount = async (
  oauthClient: Pick<OAuthClient, 'isAuthenticated' | 'logout'>,
): Promise<AccountLogoutResult> => {
  try {
    if (!(await oauthClient.isAuthenticated())) return { outcome: 'not-signed-in' };
    const result = await oauthClient.logout();
    return result.success
      ? { outcome: 'signed-out' }
      : { outcome: 'failed', message: result.error };
  } catch (error) {
    return {
      outcome: 'failed',
      message: error instanceof Error ? error.message : 'Unknown logout error',
    };
  }
};
