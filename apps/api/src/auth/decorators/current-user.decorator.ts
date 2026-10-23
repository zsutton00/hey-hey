import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

type AuthenticatedUserKey = keyof AuthenticatedUser;

/**
 * A custom parameter decorator to extract the authenticated user or a specific property of the user from the request.
 *
 * This decorator uses function overloads and generics for enhanced type safety:
 *
 * @example
 * // 1. Get the entire AuthenticatedUser object.
 * // The 'user' parameter will be correctly typed as AuthenticatedUser.
 * login(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * @example
 * // 2. Get a specific property from the AuthenticatedUser object.
 * // The 'userId' parameter will be correctly typed as UserId (string).
 * findData(@CurrentUser('userId') userId: UserId) { ... }
 *
 * @example
 * // 3. This will now correctly show a type error.
 * // You cannot assign the full AuthenticatedUser object to a parameter expecting a UserId.
 * findData(@CurrentUser() userId: UserId) { ... } // <-- Type Error!
 *
 * @param data - (Optional) The key of the user property to extract.
 */
export const CurrentUser: {
  (): ParameterDecorator;
  <K extends AuthenticatedUserKey>(data: K): ParameterDecorator;
} = createParamDecorator(
  (
    data: AuthenticatedUserKey | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[AuthenticatedUserKey] => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    return data ? user?.[data] : user;
  },
);

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.params.organizationId;
  },
);

export const UserRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    const organizationId = request.params.organizationId;

    if (!user || !organizationId) {
      return undefined;
    }

    const membership = user.orgMemberships.find(
      (m) => m.orgId === organizationId,
    );

    return membership?.role;
  },
);

/**
 * Extract the raw JWT token from the request
 * Checks Authorization header first, then falls back to accessToken cookie
 */
export const AuthToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();

    // Check Authorization header first
    const authHeader = request.headers?.authorization as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Fallback to HTTP-only cookie
    return (request.cookies?.accessToken as string) || null;
  },
);
