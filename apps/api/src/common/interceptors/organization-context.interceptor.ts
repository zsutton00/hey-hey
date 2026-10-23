import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

@Injectable()
export class OrganizationContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    // Extract organization ID from params, body, or query
    let organizationId: string | undefined;

    // Check params first (most common in REST APIs)
    if (request.params?.organizationId) {
      organizationId = request.params.organizationId;
    }
    // Check body for POST/PUT requests
    else if (request.body?.organizationId) {
      organizationId = request.body.organizationId;
    }
    // Check query params
    else if (request.query?.organizationId) {
      organizationId = request.query.organizationId;
    }
    // For authenticated users, use their first organization if no explicit org ID
    else if (user?.orgMemberships?.[0]?.orgId) {
      organizationId = user.orgMemberships[0].orgId;
    }

    if (organizationId) {
      // Validate that the user has access to this organization
      if (user && user.orgMemberships) {
        const hasAccess = user.orgMemberships.some(
          (membership) => membership.orgId === organizationId,
        );

        if (!hasAccess && !user.isDevAdmin) {
          // Let the OrganizationGuard handle the access denial
          // We just don't set the context if user doesn't have access
        } else {
          // Set the organization context in the database session
          return from(this.setOrganizationContext(organizationId, next)).pipe(
            switchMap((result) => result),
          );
        }
      }
    }

    // If no organization context, proceed without setting it
    return next.handle();
  }

  private async setOrganizationContext(
    organizationId: string,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    // Execute the SET command to establish organization context BEFORE handling the request
    try {
      // Using Postgres set_config() because SET does not allow parameter placeholders ($1)
      // This keeps the query safe and avoids syntax errors while still leveraging SQL parameterization.
      await this.prisma
        .$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true);`;
    } catch (error) {
      // Log error but don't fail the request
      console.error('Failed to set organization context:', error);
    }

    return next.handle();
  }
}
