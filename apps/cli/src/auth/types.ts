export interface OAuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackPort: number;
  timeoutMs: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string[];
  tokenType: 'Bearer';
  issuedAt?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: 'Bearer';
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

export type OAuthResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: unknown };
