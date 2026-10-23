import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';
import { ApiKeyAuthenticatedUser } from '../strategies/api-key.strategy';

export type FlexibleAuthenticatedUser =
  | AuthenticatedUser
  | ApiKeyAuthenticatedUser;

/**
 * Decorator to extract the current authenticated user from either JWT or API key authentication
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FlexibleAuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as FlexibleAuthenticatedUser;
  },
);

/**
 * Decorator specifically for API key authenticated users
 */
export const CurrentApiKeyUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyAuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.authType !== 'api-key') {
      throw new Error('This endpoint requires API key authentication');
    }

    return user as ApiKeyAuthenticatedUser;
  },
);

/**
 * Type guard to check if user is JWT authenticated
 */
export function isJwtUser(
  user: FlexibleAuthenticatedUser,
): user is AuthenticatedUser {
  return !('authType' in user) || user.authType !== 'api-key';
}

/**
 * Type guard to check if user is API key authenticated
 */
export function isApiKeyUser(
  user: FlexibleAuthenticatedUser,
): user is ApiKeyAuthenticatedUser {
  return 'authType' in user && user.authType === 'api-key';
}
