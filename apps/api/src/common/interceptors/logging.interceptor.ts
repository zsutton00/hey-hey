import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { CustomLoggerService } from '../logger/logger.service';
import { v4 as uuidv4 } from 'uuid';
import { createNamespace, getNamespace } from 'cls-hooked';
import { NO_LOGGING_KEY } from '../decorators/no-logging.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { hostname } from 'node:os';

function getErrorStatus(error: unknown): number {
  if (error && typeof error === 'object') {
    const candidate = error as {
      getStatus?: () => unknown;
      status?: unknown;
      statusCode?: unknown;
    };

    if (typeof candidate.getStatus === 'function') {
      const status = candidate.getStatus();
      if (typeof status === 'number') {
        return status;
      }
    }

    if (typeof candidate.status === 'number') {
      return candidate.status;
    }

    if (typeof candidate.statusCode === 'number') {
      return candidate.statusCode;
    }
  }

  return 500;
}

function getHttpErrorLogContext(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};

  const candidate = error as { getResponse?: () => unknown };
  if (typeof candidate.getResponse !== 'function') return {};

  const response = candidate.getResponse();
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return {};
  }

  const payload = response as Record<string, unknown>;
  const projection =
    payload.projection &&
    typeof payload.projection === 'object' &&
    !Array.isArray(payload.projection)
      ? (payload.projection as Record<string, unknown>)
      : undefined;
  const diagnostic =
    payload.diagnostic &&
    typeof payload.diagnostic === 'object' &&
    !Array.isArray(payload.diagnostic)
      ? (payload.diagnostic as Record<string, unknown>)
      : undefined;
  const issues = Array.isArray(payload.errors)
    ? payload.errors
    : Array.isArray(projection?.issues)
      ? projection.issues
      : Array.isArray(diagnostic?.issues)
        ? diagnostic.issues
        : undefined;

  return {
    ...(typeof payload.code === 'string' ? { errorCode: payload.code } : {}),
    ...(issues ? { issues } : {}),
  };
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly namespace = 'request-context';

  constructor(
    private readonly logger: CustomLoggerService,
    private readonly reflector: Reflector,
  ) {
    // Create namespace if it doesn't exist
    try {
      getNamespace(this.namespace) || createNamespace(this.namespace);
    } catch (error) {
      // Ignore if already exists
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check if logging is disabled for this endpoint
    const noLogging = this.reflector.getAllAndOverride<boolean>(
      NO_LOGGING_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const startTime = Date.now();
    const requestId = (request.headers['x-request-id'] as string) || uuidv4();
    const correlationId =
      (request.headers['x-correlation-id'] as string) || requestId;
    const method = request.method;
    const path = request.path;

    // Set correlation ID in response header
    response.setHeader('x-correlation-id', correlationId);
    response.setHeader('x-request-id', requestId);
    request.headers['x-correlation-id'] = correlationId;
    request.headers['x-request-id'] = requestId;

    // Attribute requests to the authenticated principal and route, never
    // client-supplied identity headers.
    const user = request.user as AuthenticatedUser | undefined;
    const userId = user?.userId;
    const organizationId = request.params?.organizationId;
    const projectId =
      request.params?.projectId ??
      (context.getClass()?.name === 'ProjectController'
        ? request.params?.id
        : undefined);
    const agentSessionId = request.headers['x-agent-session-id'] as string;

    const requestContext = {
      correlationId,
      requestId,
      userId,
      organizationId,
      projectId,
      agentSessionId,
      method,
      path,
      authenticatedOrganizationId: user?.currentOrgId,
      routeOrganizationId: organizationId,
      routeProjectId: projectId,
      apiInstance: hostname(),
      requestHost: request.hostname,
    };

    // Run the request in the CLS namespace
    const namespace = getNamespace(this.namespace);

    return new Observable((observer) => {
      if (namespace) {
        namespace.run(() => {
          namespace.set('context', requestContext);

          next
            .handle()
            .pipe(
              tap({
                next: () => {
                  if (!noLogging) {
                    const responseTime = Date.now() - startTime;
                    this.logger.logRequest(
                      method,
                      path,
                      response.statusCode,
                      responseTime,
                    );
                  }
                },
                error: (error) => {
                  if (!noLogging) {
                    const responseTime = Date.now() - startTime;
                    this.logger.logRequest(
                      method,
                      path,
                      getErrorStatus(error),
                      responseTime,
                    );
                    this.logger.logError(error as Error, {
                      ...requestContext,
                      ...getHttpErrorLogContext(error),
                    });
                  }
                },
              }),
            )
            .subscribe(observer);
        });
      } else {
        // Fallback without namespace
        next
          .handle()
          .pipe(
            tap({
              next: () => {
                if (!noLogging) {
                  const responseTime = Date.now() - startTime;
                  this.logger.logRequest(
                    method,
                    path,
                    response.statusCode,
                    responseTime,
                  );
                }
              },
              error: (error) => {
                if (!noLogging) {
                  const responseTime = Date.now() - startTime;
                  this.logger.logRequest(
                    method,
                    path,
                    getErrorStatus(error),
                    responseTime,
                  );
                  this.logger.logError(error as Error, {
                    ...requestContext,
                    ...getHttpErrorLogContext(error),
                  });
                }
              },
            }),
          )
          .subscribe(observer);
      }
    });
  }
}
