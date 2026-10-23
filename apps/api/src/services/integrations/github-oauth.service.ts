import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface GitHubOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
  tokenType?: string;
}

export interface GitHubOAuthStatePayload {
  integrationId: string;
  organizationId: string;
  projectId: string;
  nonce: string;
  issuedAt: number;
}

@Injectable()
export class GitHubOAuthService {
  private readonly authorizeUrl = 'https://github.com/login/oauth/authorize';
  private readonly tokenUrl = 'https://github.com/login/oauth/access_token';
  private readonly stateTtlMs = 10 * 60 * 1000;

  buildAuthorizeUrl(params: {
    state: string;
    redirectUri: string;
    scope: string;
  }): string {
    const clientId = this.getClientId();
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  buildState(payload: Omit<GitHubOAuthStatePayload, 'nonce' | 'issuedAt'>): {
    state: string;
    nonce: string;
  } {
    const nonce = crypto.randomBytes(16).toString('hex');
    const fullPayload: GitHubOAuthStatePayload = {
      ...payload,
      nonce,
      issuedAt: Date.now(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString(
      'base64url',
    );
    const signature = this.signState(encodedPayload);
    return {
      state: `${encodedPayload}.${signature}`,
      nonce,
    };
  }

  parseState(state: string): GitHubOAuthStatePayload {
    const [encodedPayload, signature] = state.split('.');
    if (!encodedPayload || !signature) {
      throw new Error('Invalid OAuth state format');
    }

    const expectedSignature = this.signState(encodedPayload);
    const signatureBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid OAuth state signature');
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as GitHubOAuthStatePayload;

    if (Date.now() - payload.issuedAt > this.stateTtlMs) {
      throw new Error('OAuth state has expired');
    }

    return payload;
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<GitHubOAuthTokenResponse> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });

    const payload = (await response.json()) as
      | {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          refresh_token_expires_in?: number;
          scope?: string;
          token_type?: string;
          error?: string;
          error_description?: string;
        }
      | undefined;

    if (!response.ok || payload?.error || !payload?.access_token) {
      const message =
        payload?.error_description ||
        payload?.error ||
        `GitHub OAuth failed with status ${response.status}`;
      throw new Error(message);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      refreshTokenExpiresIn: payload.refresh_token_expires_in,
      scope: payload.scope,
      tokenType: payload.token_type,
    };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<GitHubOAuthTokenResponse> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const payload = (await response.json()) as
      | {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          refresh_token_expires_in?: number;
          scope?: string;
          token_type?: string;
          error?: string;
          error_description?: string;
        }
      | undefined;

    if (!response.ok || payload?.error || !payload?.access_token) {
      const message =
        payload?.error_description ||
        payload?.error ||
        `GitHub token refresh failed with status ${response.status}`;
      throw new Error(message);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      refreshTokenExpiresIn: payload.refresh_token_expires_in,
      scope: payload.scope,
      tokenType: payload.token_type,
    };
  }

  private signState(encodedPayload: string): string {
    return crypto
      .createHmac('sha256', this.getClientSecret())
      .update(encodedPayload)
      .digest('base64url');
  }

  private getClientId(): string {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new Error('GITHUB_CLIENT_ID is required');
    }
    return clientId;
  }

  private getClientSecret(): string {
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error('GITHUB_CLIENT_SECRET is required');
    }
    return clientSecret;
  }
}
