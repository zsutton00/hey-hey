import crypto from 'node:crypto';
import open from 'open';
import { CredentialStore, type OAuthCredential } from '../credentials/store';
import { OAuthCallbackServer } from './callback-server';
import type {
  OAuthConfig,
  OAuthErrorResponse,
  OAuthResult,
  OAuthTokenResponse,
  OAuthTokens,
} from './types';

const resolveDefaultBaseUrl = (): string => process.env['HEYHEY_API_URL'] ?? 'https://heyhey.dev';

const getDefaultConfig = (): Partial<OAuthConfig> => ({
  baseUrl: resolveDefaultBaseUrl(),
  clientId: 'heyhey-cli-placeholder',
  clientSecret: 'heyhey-secret-placeholder',
  scopes: ['read', 'write'],
  callbackPort: 0,
  timeoutMs: 300_000,
});

export const credentialKeyForBaseUrl = (baseUrl: string): string => {
  const profile = process.env['HEYHEY_PROFILE'];
  const profileSuffix = profile ? `:${profile}` : '';
  try {
    const host = new URL(baseUrl).host;
    return `heyhey:oauth:${host}${profileSuffix}`;
  } catch {
    return `heyhey:oauth:default${profileSuffix}`;
  }
};

/**
 * The credential-store key the OAuth client uses for the current backend host
 * and `HEYHEY_PROFILE`. Login (token injection) and the env-seed hook derive
 * the key through this helper so the browser and injected paths stay
 * byte-identical with what `OAuthClient` reads back.
 */
export const getActiveCredentialKey = (): string =>
  credentialKeyForBaseUrl(resolveDefaultBaseUrl());

const REFRESH_SKEW_MS = 30_000;
const SESSION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

type AuthChangeListener = (token: string | null) => void;

const isSessionExpired = (issuedAt?: string): boolean => {
  if (!issuedAt) {
    return false;
  }
  const issuedAtMs = new Date(issuedAt).getTime();
  return Date.now() - issuedAtMs > SESSION_TIMEOUT_MS;
};

export interface OAuthClientOptions {
  config?: Partial<OAuthConfig>;
  credentialStore?: CredentialStore;
}

const isRecord = (value: object | null): value is Record<string, string | number> =>
  value !== null && typeof value === 'object';

const readOptionalString = (value: object | null, key: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
};

const toOAuthErrorResponse = (value: object | null): OAuthErrorResponse | null => {
  const error = readOptionalString(value, 'error');
  if (!error) {
    return null;
  }
  const errorDescription = readOptionalString(value, 'error_description');
  return {
    error,
    ...(errorDescription ? { error_description: errorDescription } : {}),
  };
};

const toOAuthTokenResponse = (value: object | null): OAuthTokenResponse | null => {
  if (!isRecord(value)) {
    return null;
  }

  const accessToken = value['access_token'];
  const expiresIn = value['expires_in'];
  const tokenType = value['token_type'];
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0 ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    tokenType !== 'Bearer'
  ) {
    return null;
  }

  const refreshToken = value['refresh_token'];
  const scope = value['scope'];
  return {
    access_token: accessToken,
    ...(typeof refreshToken === 'string' ? { refresh_token: refreshToken } : {}),
    expires_in: expiresIn,
    ...(typeof scope === 'string' ? { scope } : {}),
    token_type: 'Bearer',
  };
};

const computeExpiresAt = (expiresIn: number): string => {
  const expiresAtMs = Date.now() + expiresIn * 1000;
  return new Date(expiresAtMs).toISOString();
};

const isExpiringSoon = (expiresAt: string): boolean => {
  const expiryMs = new Date(expiresAt).getTime();
  return Date.now() + REFRESH_SKEW_MS >= expiryMs;
};

const toOAuthCredential = (tokens: OAuthTokens): OAuthCredential => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  expiresAt: tokens.expiresAt,
  scope: tokens.scope,
  tokenType: tokens.tokenType,
  ...(tokens.issuedAt ? { issuedAt: tokens.issuedAt } : {}),
});

const fromOAuthCredential = (credential: OAuthCredential): OAuthTokens => ({
  accessToken: credential.accessToken,
  refreshToken: credential.refreshToken ?? '',
  expiresAt: credential.expiresAt,
  scope: credential.scope ?? [],
  tokenType: 'Bearer',
  ...(credential.issuedAt ? { issuedAt: credential.issuedAt } : {}),
});

export class OAuthClient {
  private readonly authChangeListeners = new Set<AuthChangeListener>();

  private readonly config: OAuthConfig;
  private readonly credentialKey: string;
  private readonly credentialStore: CredentialStore;

  constructor(options: OAuthClientOptions = {}) {
    const mergedConfig = { ...getDefaultConfig(), ...options.config };
    this.config = {
      baseUrl: mergedConfig.baseUrl ?? 'https://heyhey.dev',
      clientId: mergedConfig.clientId ?? 'heyhey-cli-placeholder',
      clientSecret: mergedConfig.clientSecret ?? 'heyhey-secret-placeholder',
      scopes: mergedConfig.scopes ?? ['read', 'write'],
      callbackPort: mergedConfig.callbackPort ?? 0,
      timeoutMs: mergedConfig.timeoutMs ?? 300_000,
    };
    this.credentialKey = credentialKeyForBaseUrl(this.config.baseUrl);
    this.credentialStore = options.credentialStore ?? new CredentialStore();
  }

  private notifyAuthChange(token: string | null): void {
    this.authChangeListeners.forEach((listener) => {
      try {
        listener(token);
      } catch {
        // Best-effort notifications only.
      }
    });
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<OAuthResult<OAuthTokens>> {
    try {
      const tokenUrl = `${this.config.baseUrl}/api/oauth/token`;
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const payload: object | null = await response.json();
        const error = toOAuthErrorResponse(payload);
        return {
          success: false,
          error: error?.error_description ?? error?.error ?? 'Token exchange failed',
        };
      }

      const payload: object | null = await response.json();
      const tokenResponse = toOAuthTokenResponse(payload);
      if (!tokenResponse) {
        return {
          success: false,
          error: 'Token exchange returned an invalid payload.',
        };
      }
      const tokens: OAuthTokens = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token ?? '',
        expiresAt: computeExpiresAt(tokenResponse.expires_in),
        scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : [],
        tokenType: 'Bearer',
        issuedAt: new Date().toISOString(),
      };

      return { success: true, data: tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during token exchange',
        details: error,
      };
    }
  }

  private async refreshAccessToken(
    refreshToken: string,
    existingRefreshToken: string,
  ): Promise<OAuthResult<OAuthTokens>> {
    try {
      const tokenUrl = `${this.config.baseUrl}/api/oauth/token`;
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const payload: object | null = await response.json();
        const error = toOAuthErrorResponse(payload);
        return {
          success: false,
          error: error?.error_description ?? error?.error ?? 'Token refresh failed',
        };
      }

      const payload: object | null = await response.json();
      const tokenResponse = toOAuthTokenResponse(payload);
      if (!tokenResponse) {
        return {
          success: false,
          error: 'Token refresh returned an invalid payload.',
        };
      }
      const tokens: OAuthTokens = {
        accessToken: tokenResponse.access_token,
        // Preserve existing refresh token if response omits it
        refreshToken: tokenResponse.refresh_token ?? existingRefreshToken,
        expiresAt: computeExpiresAt(tokenResponse.expires_in),
        scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : [],
        tokenType: 'Bearer',
        issuedAt: new Date().toISOString(),
      };

      return { success: true, data: tokens };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during token refresh',
        details: error,
      };
    }
  }

  private async revokeToken(token: string): Promise<OAuthResult<void>> {
    try {
      const revokeUrl = `${this.config.baseUrl}/api/oauth/revoke`;
      const body = new URLSearchParams({
        token,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Token revocation failed with status ${String(response.status)}`,
        };
      }

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during token revocation',
        details: error,
      };
    }
  }

  async login(): Promise<OAuthResult<void>> {
    let server: OAuthCallbackServer | undefined;
    try {
      server = new OAuthCallbackServer(this.config.callbackPort);
      await server.start();
      const redirectUri = `http://127.0.0.1:${String(server.port)}/callback`;

      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = new URL(`${this.config.baseUrl}/api/oauth/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', this.config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', this.config.scopes.join(' '));
      authUrl.searchParams.set('state', state);

      const authUrlString = authUrl.toString();
      console.log(`Opening browser to authorize Hey Hey CLI...\n${authUrlString}\n`);

      await open(authUrlString);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('OAuth flow timed out'));
        }, this.config.timeoutMs);
      });

      const callbackResult = await Promise.race([server.waitForCallback(), timeoutPromise]);

      if (callbackResult.state !== state) {
        return { success: false, error: 'CSRF state mismatch' };
      }

      const tokenResult = await this.exchangeCodeForTokens(callbackResult.code, redirectUri);
      if (!tokenResult.success) {
        return tokenResult;
      }

      await this.credentialStore.store(this.credentialKey, toOAuthCredential(tokenResult.data));
      this.notifyAuthChange(tokenResult.data.accessToken);

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during login',
        details: error,
      };
    } finally {
      if (server) {
        server.close();
      }
    }
  }

  async logout(): Promise<OAuthResult<void>> {
    try {
      const credential = await this.credentialStore.retrieve(this.credentialKey);
      if (credential) {
        // Revoke access token
        const accessRevokeResult = await this.revokeToken(credential.accessToken);
        if (!accessRevokeResult.success) {
          return accessRevokeResult;
        }

        // Revoke refresh token if present
        if (credential.refreshToken) {
          const refreshRevokeResult = await this.revokeToken(credential.refreshToken);
          if (!refreshRevokeResult.success) {
            return refreshRevokeResult;
          }
        }

        await this.credentialStore.delete(this.credentialKey);
        this.notifyAuthChange(null);
      }
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during logout',
        details: error,
      };
    }
  }

  async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<OAuthResult<string>> {
    try {
      const forceRefresh = options.forceRefresh === true;
      const credential = await this.credentialStore.retrieve(this.credentialKey);
      if (!credential) {
        return { success: false, error: 'Not authenticated. Please login first.' };
      }

      const tokens = fromOAuthCredential(credential);
      if (isSessionExpired(tokens.issuedAt)) {
        await this.credentialStore.delete(this.credentialKey);
        this.notifyAuthChange(null);
        return {
          success: false,
          error: 'Session expired after 30 days. Please login again.',
        };
      }

      if (forceRefresh || isExpiringSoon(tokens.expiresAt)) {
        if (!tokens.refreshToken) {
          return {
            success: false,
            error: 'Token expired and no refresh token available. Please login again.',
          };
        }

        const refreshResult = await this.refreshAccessToken(
          tokens.refreshToken,
          tokens.refreshToken,
        );
        if (!refreshResult.success) {
          return refreshResult;
        }

        await this.credentialStore.update(
          this.credentialKey,
          toOAuthCredential(refreshResult.data),
        );
        this.notifyAuthChange(refreshResult.data.accessToken);
        return { success: true, data: refreshResult.data.accessToken };
      }

      this.notifyAuthChange(tokens.accessToken);
      return { success: true, data: tokens.accessToken };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting access token',
        details: error,
      };
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const result = await this.getAccessToken();
      return result.success;
    } catch {
      return false;
    }
  }

  async clearSession(): Promise<void> {
    try {
      await this.credentialStore.delete(this.credentialKey);
    } catch {
      // Ignore to ensure unauthorized flow is resilient.
    } finally {
      this.notifyAuthChange(null);
    }
  }

  onAuthChanged(listener: AuthChangeListener): () => void {
    this.authChangeListeners.add(listener);
    return () => this.authChangeListeners.delete(listener);
  }
}
