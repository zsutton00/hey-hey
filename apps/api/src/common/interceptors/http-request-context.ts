import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request, Response } from 'express';

export interface InterceptedHttp {
  request: Request;
  response: Response;
}

/**
 * The HTTP request and response an interceptor should attribute work to, or
 * `null` when it has none to read.
 *
 * REST handlers read them directly. A GraphQL query rides on an HTTP request
 * that the access middleware already signed in; its context is established
 * around each root query field only. Nested field resolvers run inside the
 * root field's request, and wrapping every list item would repeat per-item
 * database and logging work.
 */
export function resolveInterceptedHttp(
  context: ExecutionContext,
): InterceptedHttp | null {
  if (context.getType() === 'http') {
    const http = context.switchToHttp();

    return { request: http.getRequest(), response: http.getResponse() };
  }

  if (context.getType<string>() !== 'graphql') {
    return null;
  }

  const gql = GqlExecutionContext.create(context);
  const isRootField = gql.getInfo().parentType.name === 'Query';

  if (!isRootField) {
    return null;
  }

  const { req, res } = gql.getContext<{ req: Request; res: Response }>();

  return { request: req, response: res };
}
