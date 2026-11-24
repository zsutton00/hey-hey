import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { McpSessionContext } from '../mcp-server-config';
import type { ServerLogger } from '../../server/logger';
import type { PlatformMcpForwarder } from './forwarder';
import { readMcpPayload } from './proposal-group-finalization-guard';
import type { JsonObject, JsonRpcRequest, JsonRpcResponse, JsonValue } from './session';

/**
 * Handlers whose agents may delete only the drafts their own conversation
 * proposed. The visual-preview agent drops visuals by deleting their
 * proposals, but a reused proposal from another conversation, or an approved
 * one, belongs to someone else's review and must survive being dropped.
 */
const OWN_DRAFT_DELETION_PROMPT_TYPES: ReadonlySet<string> = new Set([
  LocalPromptType.PlanShapingVisualPreview,
]);

export const deletionLimitedToOwnDrafts = (promptType: string): boolean =>
  OWN_DRAFT_DELETION_PROMPT_TYPES.has(promptType);

interface ProposalOwnership {
  status: string;
  conversationId: string | null;
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readProposalId = (request: JsonRpcRequest): string | null => {
  const args = request.params?.['arguments'];
  if (!isObject(args)) {
    return null;
  }

  const proposalId = args['proposalId'];
  return typeof proposalId === 'string' && proposalId.length > 0 ? proposalId : null;
};

const readOwnership = (result: JsonValue): ProposalOwnership | null => {
  const payload = readMcpPayload(result);
  if (!isObject(payload) || typeof payload['status'] !== 'string') {
    return null;
  }

  const conversationId = payload['conversationId'];
  return {
    status: payload['status'],
    conversationId: typeof conversationId === 'string' ? conversationId : null,
  };
};

const isMcpError = (result: JsonValue): boolean => isObject(result) && result['isError'] === true;

const reject = (id: JsonRpcRequest['id'], text: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result: {
    content: [{ type: 'text', text }],
    isError: true,
  },
});

/**
 * Lets `delete_proposal` through only for a proposal this conversation created
 * that is not APPROVED. Anything else is refused before it reaches the API, so
 * dropping a reused or approved visual only leaves it out of the set.
 */
export class OwnDraftDeletionGuard {
  constructor(
    private readonly forwarder: PlatformMcpForwarder,
    private readonly context: McpSessionContext,
    private readonly logger: ServerLogger | undefined,
  ) {}

  async inspect(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const proposalId = readProposalId(request);
    if (!proposalId) {
      return null;
    }

    const conversationId = this.context.conversationId;
    if (!conversationId) {
      this.logger?.warn('local.platform_mcp_proxy.own_draft_deletion.refused', {
        proposalId,
        reason: 'no_active_conversation',
      });
      return reject(
        request.id,
        'This turn has no conversation, so it cannot delete proposals. Leave the visual out of the set instead.',
      );
    }

    const lookup = await this.forwarder.forward(
      {
        jsonrpc: '2.0',
        id: request.id,
        method: 'tools/call',
        params: { name: 'get_proposal', arguments: { proposalId } },
      },
      this.context,
    );
    if ('error' in lookup || isMcpError(lookup.result)) {
      this.logger?.debug('local.platform_mcp_proxy.own_draft_deletion.lookup_failed', {
        proposalId,
        upstreamError: 'error' in lookup ? lookup.error.message : 'mcp_error',
      });
      return lookup;
    }

    const ownership = readOwnership(lookup.result);
    if (!ownership) {
      this.logger?.warn('local.platform_mcp_proxy.own_draft_deletion.refused', {
        proposalId,
        reason: 'unreadable_proposal',
      });
      return reject(
        request.id,
        `Could not confirm who owns proposal ${proposalId}, so it was not deleted. Leave the visual out of the set instead.`,
      );
    }

    if (ownership.conversationId !== conversationId) {
      this.logger?.info('local.platform_mcp_proxy.own_draft_deletion.refused', {
        proposalId,
        reason: 'other_conversation',
        ownerConversationId: ownership.conversationId,
        conversationId,
      });
      return reject(
        request.id,
        `Proposal ${proposalId} was proposed in another conversation and is not yours to delete. To drop this visual, leave it out of the set.`,
      );
    }

    if (ownership.status === 'APPROVED') {
      this.logger?.info('local.platform_mcp_proxy.own_draft_deletion.refused', {
        proposalId,
        reason: 'approved',
      });
      return reject(
        request.id,
        `Proposal ${proposalId} is APPROVED and is already a Mockup or Diagram. To drop this visual, leave it out of the set.`,
      );
    }

    return null;
  }
}
