import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  ParseUUIDPipe,
} from '@nestjs/common';

/**
 * Scope path params that the OpenAPI spec declares as `format: uuid`.
 */
export const SCOPE_PATH_PARAMS = ['organizationId', 'projectId'] as const;

const uuidPipes = new Map(
  SCOPE_PATH_PARAMS.map((name) => [
    name,
    new ParseUUIDPipe({
      exceptionFactory: (error) =>
        new BadRequestException(`Path parameter "${name}": ${error}`),
    }),
  ]),
);

/**
 * Enforces the declared uuid format of organization/project path params
 * before any access guard runs. Nest runs guards before pipes, so without
 * this a malformed id (e.g. a client placeholder) reaches OrganizationGuard /
 * ProjectAccessGuard and surfaces as a misleading 403 instead of a 400.
 *
 * Registered as a global guard immediately after FlexibleAuthGuard, so
 * unauthenticated requests still get 401 first. Well-formed ids pass through
 * unchanged and keep the normal membership denial.
 */
@Injectable()
export class ScopePathParamsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const params: Record<string, unknown> | undefined = context
      .switchToHttp()
      .getRequest()?.params;
    if (!params) return true;
    for (const name of SCOPE_PATH_PARAMS) {
      const value = params[name];
      if (value === undefined) continue;
      await uuidPipes
        .get(name)!
        .transform(value as string, { type: 'param', data: name });
    }
    return true;
  }
}
