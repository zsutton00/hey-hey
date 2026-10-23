import type { Request } from 'express';
import {
  requestorContextSchema,
  type RequestorContext,
} from 'src/mcp/tools/requestor-context';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import type { OrganizationId } from 'src/types';

/**
 * Build a RequestorContext for the user proposal-create boundary, always
 * stamped `source: 'user'`. Mirrors `extractRequestorContext` (the agent-path
 * stamper) but is driven by the controller's authenticated user rather than
 * the MCP AuthContext shape — the two boundaries must not share code below
 * the stamping point so a user-session call can never produce a proposal
 * with `source: 'agent'`.
 */
export function buildUserRequestorContext(
  user: AuthenticatedUser,
  organizationId: OrganizationId,
  request: Request,
  routeName: string,
): RequestorContext {
  const conversationId = request.headers['x-conversation-id'] as
    | string
    | undefined;
  const serviceId = request.headers['x-service-id'] as string | undefined;
  const userAgent = request.headers['user-agent'];

  const raw: RequestorContext = {
    userId: user.userId,
    organizationId,
    toolName: routeName,
    timestamp: new Date().toISOString(),
    source: 'user',
    ...(conversationId ? { conversationId } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(userAgent ? { userAgent: String(userAgent).slice(0, 500) } : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };

  return requestorContextSchema.parse(raw);
}
