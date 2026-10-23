import {
  requestorContextSchema,
  type RequestorContext,
} from 'src/mcp/tools/requestor-context';
import type { ConversationId, OrganizationId, UserId } from 'src/types';

/**
 * Build a RequestorContext for proposals authored from inside a flow node,
 * stamped `source: 'agent'`. Mirrors `extractRequestorContext` (the MCP-tool
 * stamper) and `buildUserRequestorContext` (the HTTP controller stamper).
 *
 * Flow nodes drive LLM-generated proposals on the user's behalf without an
 * inbound HTTP request to read headers from, so the stamp is built from the
 * `FlowContext.core` block. The `toolName` is the calling node's id, which
 * surfaces in proposal audit logs the same way an MCP tool name would.
 */
export function buildFlowRequestorContext(args: {
  organizationId: OrganizationId;
  userId: UserId;
  conversationId: ConversationId;
  nodeId: string;
}): RequestorContext {
  const raw: RequestorContext = {
    userId: args.userId,
    organizationId: args.organizationId,
    toolName: args.nodeId,
    timestamp: new Date().toISOString(),
    source: 'agent',
    conversationId: args.conversationId,
  };

  return requestorContextSchema.parse(raw);
}
