import { EventContextManager } from '../core/events/observable-event.context';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { GraphQLRequestContext } from './graphql-request-context';

/**
 * Runs a nested field resolver with the authenticated viewer in the event
 * context. EventContextInterceptor establishes that context around root query
 * fields only, and nested fields execute after the root handler has returned,
 * so reads that depend on the viewer (such as proposal approval eligibility)
 * would otherwise see no user.
 */
export function runAsViewer<T>(
  { req }: GraphQLRequestContext,
  operation: () => Promise<T>,
): Promise<T> {
  const manager = EventContextManager.getInstance();
  const user = req.user as AuthenticatedUser | undefined;
  const context = manager.createInitialContext(
    'GRAPHQL',
    `${req.method} ${req.url}`,
    {
      userId: user?.userId,
      organizationId: req.params?.organizationId as never,
      projectId: req.params?.projectId as never,
    },
  );

  return manager.runWithContext(context, operation);
}
