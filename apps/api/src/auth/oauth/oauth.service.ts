import * as crypto from 'crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UserId } from 'src/types';
import { UserService } from '../../services/user.service';
import { AuthService } from '../services/auth.service';
import { JwtKeysService } from '../services/jwt-keys.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  REDIS_PREFIX_AUTH_CODE,
  REDIS_PREFIX_REVOKED,
  AUTH_CODE_TTL_SECONDS,
  REVOKED_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_EXPIRES_IN,
  REDIRECT_URI_PATTERN,
} from './oauth.constants';
import type {
  OAuthTokenResponse,
  OAuthErrorResponse,
  StoredAuthorizationCode,
} from './oauth.types';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly jwtKeysService: JwtKeysService,
    private readonly redisService: RedisService,
  ) {}

  validateClient(
    clientId: string,
    clientSecret?: string,
  ): OAuthErrorResponse | null {
    if (clientId !== OAUTH_CLIENT_ID) {
      return { error: 'invalid_client', error_description: 'Unknown client' };
    }
    if (clientSecret !== undefined) {
      const expected = Buffer.from(OAUTH_CLIENT_SECRET);
      const actual = Buffer.from(clientSecret);
      if (
        expected.length !== actual.length ||
        !crypto.timingSafeEqual(expected, actual)
      ) {
        return {
          error: 'invalid_client',
          error_description: 'Bad client secret',
        };
      }
    }
    return null;
  }

  validateRedirectUri(redirectUri: string): OAuthErrorResponse | null {
    if (!REDIRECT_URI_PATTERN.test(redirectUri)) {
      return {
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri',
      };
    }
    return null;
  }

  async authenticateUser(
    email: string,
    password: string,
  ): Promise<UserId | null> {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.isActive) {
      return null;
    }

    const valid = await this.userService.validatePassword(user, password);
    if (!valid) {
      return null;
    }

    return user.id;
  }

  async generateAuthorizationCode(
    userId: string,
    clientId: string,
    redirectUri: string,
    scope: string,
    state: string,
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString('hex');

    const stored: StoredAuthorizationCode = {
      userId,
      clientId,
      redirectUri,
      scope,
      state,
      createdAt: Date.now(),
    };

    const redis = this.redisService.getClient();
    await redis.set(
      `${REDIS_PREFIX_AUTH_CODE}${code}`,
      JSON.stringify(stored),
      'EX',
      AUTH_CODE_TTL_SECONDS,
    );

    return code;
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    clientId: string,
  ): Promise<OAuthTokenResponse | OAuthErrorResponse> {
    const redis = this.redisService.getClient();
    const key = `${REDIS_PREFIX_AUTH_CODE}${code}`;

    const raw = await redis.get(key);
    if (!raw) {
      return {
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      };
    }

    // Single-use: delete immediately
    await redis.del(key);

    const stored: StoredAuthorizationCode = JSON.parse(raw);

    if (stored.clientId !== clientId) {
      return {
        error: 'invalid_grant',
        error_description: 'Client mismatch',
      };
    }

    if (stored.redirectUri !== redirectUri) {
      return {
        error: 'invalid_grant',
        error_description: 'Redirect URI mismatch',
      };
    }

    try {
      const authResponse = await this.authService.generateTokensForUserId(
        stored.userId as UserId,
      );

      return {
        access_token: authResponse.accessToken,
        refresh_token: authResponse.refreshToken,
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
        scope: stored.scope,
        token_type: 'Bearer',
      };
    } catch (error) {
      this.logger.error('Token generation failed during code exchange', error);
      return {
        error: 'server_error',
        error_description: 'Failed to generate tokens',
      };
    }
  }

  async refreshOAuthToken(
    refreshToken: string,
  ): Promise<OAuthTokenResponse | OAuthErrorResponse> {
    try {
      const normalizedRefreshToken = this.normalizeRefreshToken(refreshToken);
      if (!normalizedRefreshToken) {
        return {
          error: 'invalid_grant',
          error_description: 'Invalid refresh token',
        };
      }

      const payload = this.jwtKeysService.verifyToken(normalizedRefreshToken);

      if (payload.type !== 'refresh' || !payload.sub) {
        return {
          error: 'invalid_grant',
          error_description: 'Invalid refresh token',
        };
      }

      // Check if token is revoked
      const revoked = await this.isTokenRevoked(normalizedRefreshToken);
      if (revoked) {
        return {
          error: 'invalid_grant',
          error_description: 'Token has been revoked',
        };
      }

      const authResponse = await this.authService.generateTokensForUserId(
        payload.sub as UserId,
      );

      return {
        access_token: authResponse.accessToken,
        refresh_token: authResponse.refreshToken,
        expires_in: ACCESS_TOKEN_EXPIRES_IN,
        scope: 'read write',
        token_type: 'Bearer',
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        (error instanceof Error &&
          (error.name === 'TokenExpiredError' ||
            error.name === 'JsonWebTokenError' ||
            error.name === 'NotBeforeError'))
      ) {
        return {
          error: 'invalid_grant',
          error_description: 'Refresh token is invalid or expired',
        };
      }
      this.logger.error('Unexpected error during token refresh', error);
      return {
        error: 'server_error',
        error_description: 'Failed to refresh token',
      };
    }
  }

  async revokeToken(token: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const redis = this.redisService.getClient();
    await redis.set(
      `${REDIS_PREFIX_REVOKED}${hash}`,
      '1',
      'EX',
      REVOKED_TOKEN_TTL_SECONDS,
    );
  }

  private normalizeRefreshToken(token: string): string | null {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return null;
    }

    if (!trimmedToken.toLowerCase().startsWith('bearer ')) {
      return trimmedToken;
    }

    const withoutPrefix = trimmedToken.slice('bearer '.length).trim();
    return withoutPrefix.length > 0 ? withoutPrefix : null;
  }

  private async isTokenRevoked(token: string): Promise<boolean> {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const redis = this.redisService.getClient();
    const result = await redis.get(`${REDIS_PREFIX_REVOKED}${hash}`);
    return result !== null;
  }
}
