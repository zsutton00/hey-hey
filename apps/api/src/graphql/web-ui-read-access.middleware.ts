import {
  CanActivate,
  Injectable,
  MethodNotAllowedException,
  NestMiddleware,
} from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { NextFunction, Request, Response } from 'express';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { ScopePathParamsGuard } from '../auth/guards/scope-path-params.guard';

/**
 * Sign-in and project access for the GraphQL endpoint, decided before Apollo
 * sees the request. Every request is checked, whatever it contains: an
 * anonymous `{ __typename }`, a malformed query or a mutation gets the same
 * 401/403/400 as the equivalent REST read, and a resolver added later is
 * protected without opting in.
 *
 * Runs the REST read guards unchanged, in the REST order, against the HTTP
 * request. A rejection is thrown as an HttpException, so the global exception
 * filters answer with the REST status and error body.
 */
@Injectable()
export class WebUiReadAccessMiddleware implements NestMiddleware {
  constructor(
    private readonly flexibleAuth: FlexibleAuthGuard,
    private readonly scopePathParams: ScopePathParamsGuard,
    private readonly jwtAuth: JwtAuthGuard,
    private readonly organization: OrganizationGuard,
    private readonly projectAccess: ProjectAccessGuard,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Thrown, not passed to next(): Nest routes a middleware's thrown errors
    // through the global exception filters, which is what gives the REST body.
    await this.assertAccess(req, res);

    next();
  }

  private async assertAccess(req: Request, res: Response): Promise<void> {
    const context = new ExecutionContextHost(
      [req, res, undefined],
      WebUiReadAccessMiddleware,
      this.use,
    );

    await this.run(this.flexibleAuth, context);
    await this.scopePathParams.canActivate(context);
    await this.run(this.jwtAuth, context);
    await this.organization.canActivate(context);
    await this.projectAccess.canActivate(context);

    // The endpoint is POST-only (see the Decision); Apollo would also answer GET.
    if (req.method !== 'POST') {
      throw new MethodNotAllowedException('GraphQL requires POST');
    }
  }

  private async run(
    guard: CanActivate,
    context: ExecutionContextHost,
  ): Promise<void> {
    // Passport-backed guards answer with a Promise; the Observable arm of
    // CanActivate's return type never occurs for them.
    await (guard.canActivate(context) as boolean | Promise<boolean>);
  }
}
