import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventContextManager } from '../../core/events/observable-event.context';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { OrganizationId, ProjectId } from '../../types';

@Injectable()
export class EventContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    const eventContextManager = EventContextManager.getInstance();
    const headers = request.headers as Record<string, string>;
    const propagated = eventContextManager.extractFromHeaders(headers);
    const projectId =
      (request.params?.projectId as string | undefined) || propagated.projectId;

    // Create initial event context with user information
    const eventContext = eventContextManager.createInitialContext(
      'HTTP',
      `${request.method} ${request.url}`,
      {
        ...propagated,
        userId: user?.userId,
        organizationId:
          (request.params?.organizationId as OrganizationId) ||
          user?.currentOrgId,
        projectId: projectId as ProjectId | undefined,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      },
    );

    // Run the request within the event context
    return new Observable((subscriber) => {
      eventContextManager
        .runWithContext(eventContext, async () => {
          return new Promise<void>((resolve, reject) => {
            next.handle().subscribe({
              next: (value) => {
                subscriber.next(value);
              },
              error: (err) => {
                subscriber.error(err);
                reject(err as Error);
              },
              complete: () => {
                subscriber.complete();
                resolve();
              },
            });
          });
        })
        .catch((error) => {
          subscriber.error(error);
        });
    });
  }
}
