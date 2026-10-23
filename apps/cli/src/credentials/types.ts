export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
  scope?: string[];
  tokenType?: string;
  issuedAt?: string;
}

export interface StoredAccessCredential {
  accessToken: string;
  expiresAt: string;
  scope?: string[];
  tokenType?: string;
  issuedAt?: string;
}

export interface StoredRefreshCredential {
  refreshToken: string;
  issuedAt?: string;
}
