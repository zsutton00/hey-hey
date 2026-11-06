import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Purpose claim carried by browser-session access tokens. */
export const BROWSER_ACCESS_TOKEN_USE = 'access';
/** Purpose claim carried by native OAuth (CLI) access tokens. */
export const OAUTH_ACCESS_TOKEN_USE = 'oauth_access';

/**
 * The deployment's trust context for user credentials. Browser and native
 * OAuth access tokens are issued with this issuer and their own audience, and
 * only tokens matching this deployment's profile are accepted. Values come
 * from explicit configuration, never from request Host headers, and must be
 * identical across replicas of one deployment.
 */
@Injectable()
export class CredentialProfileService {
  readonly issuer: string;
  readonly browserAudience: string;
  readonly oauthAudience: string;

  constructor(configService: ConfigService) {
    this.issuer = requiredValue(configService, 'BROWSER_TOKEN_ISSUER');
    this.browserAudience = requiredValue(
      configService,
      'BROWSER_TOKEN_AUDIENCE',
    );
    this.oauthAudience = `${this.browserAudience}:oauth`;
  }
}

function requiredValue(configService: ConfigService, key: string): string {
  const value = configService.get<string>(key)?.trim();
  if (!value) {
    throw new Error(`${key} must be configured`);
  }
  return value;
}
