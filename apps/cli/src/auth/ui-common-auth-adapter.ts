import type {
  AccessToken,
  ApiAuthAdapter,
} from '../../../../packages/ui-common/src/clients/shared';
import type { OAuthClient } from './index';

const toAccessToken = (token: string | null): AccessToken | null => token as AccessToken | null;

export const createUiCommonAuthAdapter = (oauthClient: OAuthClient): ApiAuthAdapter => ({
  getAccessToken(): AccessToken | null {
    // Runtime attaches the current token to requests. Returning null here
    // avoids async credential reads during adapter initialization.
    return null;
  },

  async refreshAccessToken(): Promise<AccessToken | null> {
    const result = await oauthClient.getAccessToken({ forceRefresh: true });
    if (!result.success) {
      return null;
    }
    return toAccessToken(result.data);
  },

  onAuthChanged(listener: (token: AccessToken | null) => void): () => void {
    return oauthClient.onAuthChanged((token) => {
      listener(toAccessToken(token));
    });
  },

  onUnauthorized(): void {
    void oauthClient.clearSession();
  },
});
