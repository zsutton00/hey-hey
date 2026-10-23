export const OAUTH_CLIENT_ID = 'heyhey-cli-placeholder';
export const OAUTH_CLIENT_SECRET = 'heyhey-secret-placeholder';

export const REDIS_PREFIX_AUTH_CODE = 'oauth:code:';
export const REDIS_PREFIX_REVOKED = 'oauth:revoked:';

export const AUTH_CODE_TTL_SECONDS = 300; // 5 minutes
export const REVOKED_TOKEN_TTL_SECONDS = 604800; // 7 days

export const ACCESS_TOKEN_EXPIRES_IN = 60 * 60 * 24; // 24 hours
export const ACCESS_TOKEN_JWT_EXPIRES = '24h';
export const REFRESH_TOKEN_JWT_EXPIRES = '7d';

export const REDIRECT_URI_PATTERN = /^http:\/\/127\.0\.0\.1:\d+\/callback$/;
