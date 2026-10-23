import { z } from 'zod';
import type { Request } from 'express';
import type { AuthContext } from './mcp-tool.utils';

/**
 * Zod schema for the requestor context embedded in proposal payloads.
 * Captures identity + request-origin metadata for traceability.
 */
export const requestorContextSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().uuid(),
  toolName: z.string().min(1),
  timestamp: z.string().datetime(),
  source: z.enum(['user', 'agent']),
  conversationId: z.string().min(1).optional(),
  serviceId: z.string().uuid().optional(),
  userAgent: z.string().max(500).optional(),
  ipAddress: z.string().ip().optional(),
});

export type RequestorContext = z.infer<typeof requestorContextSchema>;

/**
 * Extract and validate requestor context from an authenticated MCP
 * tool invocation. The result is safe to embed directly into a
 * proposal's `requestorContext` JSON field.
 *
 * conversationId resolution order:
 *   1. Explicit parameter (caller override)
 *   2. X-Conversation-ID request header (set by hey-hey-agents)
 */
export function extractRequestorContext(
  auth: AuthContext,
  request: Request,
  toolName: string,
  conversationId?: string,
): RequestorContext {
  const resolvedConversationId =
    conversationId ??
    (request.headers['x-conversation-id'] as string | undefined);

  const resolvedServiceId = request.headers['x-service-id'] as
    | string
    | undefined;

  const raw: RequestorContext = {
    userId: auth.user.userId,
    organizationId: auth.organizationId,
    toolName,
    timestamp: new Date().toISOString(),
    source: 'agent',
    ...(resolvedConversationId
      ? { conversationId: resolvedConversationId }
      : {}),
    ...(resolvedServiceId ? { serviceId: resolvedServiceId } : {}),
    ...(request.headers['user-agent']
      ? {
          userAgent: String(request.headers['user-agent']).slice(0, 500),
        }
      : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };

  return requestorContextSchema.parse(raw);
}
