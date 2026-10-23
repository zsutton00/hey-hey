export interface OAuthAuthorizeQuery {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
}

export interface OAuthLoginBody {
  email: string;
  password: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
}

export interface OAuthTokenBody {
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  redirect_uri?: string;
  client_id: string;
  client_secret: string;
  refresh_token?: string;
}

export interface OAuthRevokeBody {
  token: string;
  client_id: string;
  client_secret: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: 'Bearer';
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

export interface StoredAuthorizationCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  createdAt: number;
}
