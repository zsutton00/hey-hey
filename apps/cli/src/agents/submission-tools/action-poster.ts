/**
 * Posts the agent-authored completion message for an EXTERNAL_AGENT
 * submission-tool call.
 *
 * This module submits the requested action through the typed machine-effect
 * boundary. The API resolves the active workflow binding and authors the
 * executable SYSTEM message.
 */

import type { ServerLogger } from '../../server/logger';
import { MessagePoster } from '../../run/message-poster';
import type { MessageStamp } from '../../run/types';
import type { SubmissionToolAction } from './types';

export interface PostSubmissionActionInput {
  /** Stable identity assigned by the Run when it records the terminal outcome. */
  effectId: string;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  /**
   * Id of the EXTERNAL_AGENT node this submission completes. Becomes
   * `completesExternalAgentNode.nodeId` on the posted message — the
   * server-side bridge uses it to match the paused flow execution before
   * signaling. Required; a submission tool with no node id cannot produce
   * a server-routable completion.
   */
  externalAgentNodeId: string;
  /**
   * Id of the originating trigger message (`data.triggersAgent`) this
   * completion closes. Becomes
   * `completesExternalAgentNode.completesTriggerMessageId` on the posted
   * message. Required by the workflow contract — pending-work derivation
   * over the conversation log depends on every completion back-referencing
   * its trigger. Callers that cannot supply one must not register
   * submission tools for the turn.
   */
  triggerMessageId: string;
  action: SubmissionToolAction;
  /**
   * User-facing text to post as the message `response`. Empty by default —
   * submission events are system-level flow transitions, not narrative the
   * user needs to read. The previous "Submitted <toolName>" default leaked
   * internal tool names into the UI.
   */
  userFacingResponse?: string;
  /**
   * When true, appends an `AgentHidden` UI element so the renderer suppresses
   * the completion bubble. The `completesExternalAgentNode` envelope is
   * unchanged — the workflow engine still advances the node normally.
   * Mutually exclusive with a non-empty `userFacingResponse`.
   */
  hidden?: boolean;
  /**
   * Passive provenance forwarded as typed completion input. The API authors
   * the persisted message and executable envelope. `null` when the caller has
   * no active Turn provenance.
   */
  stamp: MessageStamp | null;
}

/**
 * Emit a `warn`-level event when an outgoing submission completion's
 * declared `externalAgentNodeId` differs from the Run's currently-stamped
 * value. Greppable as a single signal across all sites that author
 * `completesExternalAgentNode` envelopes (in-turn submission tools and the
 * assistant-complete pending-completion path).
 */
export const warnOnExternalAgentNodeIdMismatch = (
  logger: ServerLogger,
  args: {
    site: string;
    runId: string;
    declaredNodeId: string | null;
    runStampedNodeId: string | null;
    triggerMessageId: string | null;
    action?: string | undefined;
  },
): void => {
  if (args.declaredNodeId === args.runStampedNodeId) return;
  logger.warn('local.submission.external_agent_node_id_mismatch', {
    site: args.site,
    runId: args.runId,
    declaredNodeId: args.declaredNodeId,
    runStampedNodeId: args.runStampedNodeId,
    triggerMessageId: args.triggerMessageId,
    ...(args.action !== undefined ? { action: args.action } : {}),
  });
};

export class SubmissionActionPoster {
  public constructor(private readonly poster: MessagePoster) {}

  public async post(input: PostSubmissionActionInput): Promise<string> {
    return this.poster.submitExternalAgentCompletion({
      organizationId: input.organizationId,
      projectId: input.projectId,
      agentSessionId: input.agentSessionId,
      effectId: input.effectId,
      request: {
        conversationId: input.conversationId,
        workflowNodeId: input.externalAgentNodeId,
        pendingTriggerMessageId: input.triggerMessageId,
        action: input.action.action,
        ...(input.action.payload !== undefined ? { payload: input.action.payload } : {}),
        ...(input.userFacingResponse !== undefined ? { response: input.userFacingResponse } : {}),
        ...(input.hidden === true ? { hidden: true } : {}),
        ...(input.stamp?.providerSessionId
          ? { providerSessionId: input.stamp.providerSessionId }
          : {}),
        ...(input.stamp?.promptHandler ? { promptHandler: input.stamp.promptHandler } : {}),
      },
    });
  }
}
