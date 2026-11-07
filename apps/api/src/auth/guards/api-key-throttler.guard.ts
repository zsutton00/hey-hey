import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyAuthenticatedUser } from '../strategies/api-key.strategy';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

type ThrottleRequestUser =
  | (Partial<AuthenticatedUser> & { systemSubject?: string })
  | Partial<ApiKeyAuthenticatedUser>;

export function isGlobalRateLimitingEnabled(
  deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT,
): boolean {
  return deploymentEnvironment?.trim().toLowerCase() === 'production';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getThrottleActorKey(user: unknown): string | null {
  if (!isRecord(user)) {
    return null;
  }

  if (typeof user.systemSubject === 'string' && user.systemSubject.length > 0) {
    return `system:${user.systemSubject}`;
  }

  if (typeof user.userId === 'string' && user.userId.length > 0) {
    return `user:${user.userId}`;
  }

  if (typeof user.apiKeyId === 'string' && user.apiKeyId.length > 0) {
    return `api-key:${user.apiKeyId}`;
  }

  return null;
}

@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  private readonly graphqlDecisions = new WeakMap<object, Promise<boolean>>();

  /**
   * A GraphQL query runs this guard once per root field. The limit counts
   * requests, so the first field decides for the whole request and the other
   * fields share its outcome.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'graphql') {
      return super.canActivate(context);
    }

    const { req } = this.getRequestResponse(context);
    const decision =
      this.graphqlDecisions.get(req) ?? super.canActivate(context);
    this.graphqlDecisions.set(req, decision);

    return decision;
  }

  protected getRequestResponse(context: ExecutionContext) {
    if (context.getType() !== 'graphql') {
      return super.getRequestResponse(context);
    }

    const { req, res } = GqlExecutionContext.create(context).getContext();

    return { req, res };
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const actorKey = getThrottleActorKey(req.user as ThrottleRequestUser);

    if (actorKey) {
      return actorKey;
    }

    return super.getTracker(req);
  }
}
