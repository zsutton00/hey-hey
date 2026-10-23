import type { ServerLogger } from '../logger';
import type { RunStore } from '../../run-store';

interface ResolvedConversationRun {
  status: 'resolved';
  runId: string;
  conversationId: string;
  agentSessionId: string;
}

export type ConversationRunResolution =
  | ResolvedConversationRun
  | { status: 'temporarily_unavailable'; reason: string }
  | { status: 'rejected'; reason: string }
  | { status: 'rejected'; reason: 'service_folder_not_bound'; serviceIds: string[] };

/** The Services a conversation's failed start was missing folders for, when it failed that way. */
export type StartFailureLookup = (
  conversationId: string,
  agentSessionId: string | undefined,
) => Promise<string[] | null>;

/** Shared identity decision for conversation admission and dispatch. */
export class ConversationRunResolver {
  public constructor(
    private readonly runStore: RunStore,
    private readonly logger?: ServerLogger,
    private readonly unboundServicesOfFailedStart?: StartFailureLookup,
  ) {}

  public resolveForDispatch(
    conversationId: string,
  ):
    | { status: 'resolved'; runId: string; conversationId: string }
    | { status: 'temporarily_unavailable'; reason: string } {
    const runId = this.runStore.lookupByConversationId(conversationId);
    return runId
      ? { status: 'resolved', runId, conversationId }
      : { status: 'temporarily_unavailable', reason: 'conversation_binding_not_available' };
  }

  public async resolve(
    conversationId: string,
    expectedAgentSessionId?: string,
    logger = this.logger,
  ): Promise<ConversationRunResolution> {
    const started = performance.now();
    const fields = { conversationId, agentSessionId: expectedAgentSessionId };
    logger?.debug('trigger-admission.run_lookup.started', fields);
    try {
      const result = await this.resolveIdentity(conversationId, expectedAgentSessionId);
      logger?.debug('trigger-admission.run_lookup.completed', {
        ...fields,
        elapsedMs: performance.now() - started,
        status: result.status,
        ...(result.status === 'resolved' ? { runId: result.runId } : { reason: result.reason }),
      });
      return result;
    } catch (error) {
      logger?.debug('trigger-admission.run_lookup.failed', {
        ...fields,
        elapsedMs: performance.now() - started,
      });
      throw error;
    }
  }

  private async resolveIdentity(
    conversationId: string,
    expectedAgentSessionId?: string,
  ): Promise<ConversationRunResolution> {
    const indexed = this.resolveForDispatch(conversationId);
    const indexedRunId = indexed.status === 'resolved' ? indexed.runId : null;
    if (indexedRunId) {
      const indexedRun = await this.runStore.getRunMetadata(indexedRunId);
      if (!indexedRun) {
        return { status: 'temporarily_unavailable', reason: 'indexed_run_not_available' };
      }
      const agentSessionId = indexedRun.contextMetadata.agentSessionId;
      if (expectedAgentSessionId && agentSessionId !== expectedAgentSessionId) {
        return { status: 'rejected', reason: 'agent_session_mismatch' };
      }
      return {
        status: 'resolved',
        runId: indexedRunId,
        conversationId,
        agentSessionId,
      };
    }

    const expectedRunId = expectedAgentSessionId
      ? this.runStore.lookupByAgentSessionId(expectedAgentSessionId)
      : undefined;
    if (!expectedAgentSessionId || !expectedRunId) {
      // No Run exists to bind. If the start already ended failed for a missing folder, nothing
      // will ever create one, so the follow-up is refused rather than left to retry.
      const unboundServiceIds = await this.unboundServicesOfFailedStart?.(
        conversationId,
        expectedAgentSessionId,
      );
      if (unboundServiceIds)
        return {
          status: 'rejected',
          reason: 'service_folder_not_bound',
          serviceIds: unboundServiceIds,
        };
      return {
        status: 'temporarily_unavailable',
        reason: expectedAgentSessionId
          ? 'agent_session_run_not_available'
          : 'conversation_binding_not_available',
      };
    }
    const expectedRun = await this.runStore.getRunMetadata(expectedRunId);
    if (!expectedRun) {
      return { status: 'temporarily_unavailable', reason: 'agent_session_run_not_available' };
    }
    return expectedRun.conversationId === conversationId
      ? {
          status: 'resolved',
          runId: expectedRunId,
          conversationId,
          agentSessionId: expectedAgentSessionId,
        }
      : { status: 'rejected', reason: 'agent_session_conversation_mismatch' };
  }
}
