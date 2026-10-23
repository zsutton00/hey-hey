import { Injectable, Logger } from '@nestjs/common';
import { FlowExecutionStatus } from '@prisma/client';
import { AgentSystemMessageData } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';

/**
 * One open SYSTEM trigger eligible for reconnect recovery, read directly from
 * the `pending_open_trigger` store (one row per eligible trigger, keyed by
 * userId). Carries the routing context the trigger-emitter needs to sign and
 * address a `trigger.conversation` frame without re-querying the AgentSession.
 */
export interface OpenTriggerForUser {
  conversationId: ConversationId;
  messageId: MessageId;
  organizationId: OrganizationId;
  projectId: ProjectId;
}

// Authenticate-time re-fan is transient-reconnect recovery, NOT session
// retention: only triggers emitted within this window are re-published when a
// CLI authenticates. A brief disconnect resumes genuinely in-flight work,
// while a stale session (e.g. a half-finished run from days ago) is not
// spontaneously resurrected on every reconnect. `created_at` reflects
// trigger-emit time (the backfill stamped `message.created_at`; live inserts
// default to now), so it is a faithful age signal for this bound.
//
// This is a deliberate staleness STOPGAP. The principled model — re-fan only
// genuinely-undelivered triggers (recipientCount=0 at emit) and let the user
// resume an old session by opening it rather than having authenticate push it
// — belongs with the re-fan orchestration, not this resolver.
export const REFAN_TRIGGER_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Resolves the open SYSTEM trigger message awaiting completion under the
 * EXTERNAL_AGENT node a conversation is currently paused on.
 *
 * Pending = (SYSTEM messages with `data.triggersAgent` for the current node)
 *           − (messages whose `data.completesExternalAgentNode.completesTriggerMessageId`
 *              references one of those triggers).
 *
 * Mirrors the projection the CLI runs locally so consumers of
 * `getConversationPromptType` can fetch trigger context fresh from the
 * authoritative server-side source instead of caching it.
 */
@Injectable()
export class PendingTriggerService {
  private readonly logger = new Logger(PendingTriggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveLatestOpenTriggerForConversation(
    conversationId: ConversationId,
  ): Promise<{ triggerMessageId: MessageId | null }> {
    const row = await this.prisma.db.pendingOpenTrigger.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { messageId: true },
    });
    return {
      triggerMessageId: (row?.messageId as MessageId | undefined) ?? null,
    };
  }

  async resolvePendingTriggerForNode(
    conversationId: ConversationId,
    currentNodeId: string,
  ): Promise<{ triggerMessageId: MessageId | null }> {
    const messages = await this.prisma.db.message.findMany({
      where: { conversationId, type: 'SYSTEM', ...TIMELINE_MESSAGE_WHERE },
      select: { id: true, data: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const triggersForNode: Array<{ id: string; createdAt: Date }> = [];
    const completedTriggerIds = new Set<string>();

    for (const message of messages) {
      // These are all SYSTEM rows; the SYSTEM-AGENT data shape declares both
      // `triggersAgent` and `completesExternalAgentNode`, so reading them off
      // the typed value preserves the structural projection without bag casts.
      const data = message.data as AgentSystemMessageData | undefined;

      const triggersAgent = data?.triggersAgent;
      if (
        triggersAgent &&
        !('operationId' in triggersAgent) &&
        typeof triggersAgent.nodeId === 'string' &&
        triggersAgent.nodeId === currentNodeId
      ) {
        triggersForNode.push({
          id: message.id,
          createdAt: timelineCreatedAt(message),
        });
      }

      const completion = data?.completesExternalAgentNode;
      if (
        completion &&
        typeof completion.completesTriggerMessageId === 'string' &&
        completion.completesTriggerMessageId.length > 0
      ) {
        completedTriggerIds.add(completion.completesTriggerMessageId);
      }
    }

    const survivors = triggersForNode.filter(
      (trigger) => !completedTriggerIds.has(trigger.id),
    );

    const [first, ...rest] = survivors;
    if (!first) {
      return { triggerMessageId: null };
    }

    if (rest.length === 0) {
      return { triggerMessageId: first.id as MessageId };
    }

    // Invariant: a node should have at most one open trigger at a time. Tolerate
    // multi-survivor by deterministically picking the most recent (createdAt
    // desc, id desc tiebreak) and surfacing the anomaly via a warn log so
    // operators can investigate.
    const sorted = [first, ...rest].sort((a, b) => {
      const createdAtDelta = b.createdAt.getTime() - a.createdAt.getTime();
      if (createdAtDelta !== 0) return createdAtDelta;
      return b.id.localeCompare(a.id);
    });
    const winner = sorted[0]!;

    this.logger.warn(
      `Multiple pending triggers for conversation=${conversationId} node=${currentNodeId}: ${sorted
        .map((t) => t.id)
        .join(',')}; returning most recent ${winner.id}`,
    );

    return { triggerMessageId: winner.id as MessageId };
  }

  /**
   * Return every open SYSTEM trigger a user has awaiting completion, read
   * directly from the `pending_open_trigger` store. The store is maintained
   * from the message log by `MessageService.addMessage` (insert on trigger,
   * delete on completion) and explicitly pruned when an initial start-run
   * dispatch receives a negative acknowledgement. A row exists here iff the
   * trigger remains eligible for reconnect delivery — the projection is
   * already materialized and needs no recomputation at read time.
   *
   * One row is returned per open trigger (every open trigger is the recipient
   * of its own re-fan frame), carrying the routing context the
   * trigger-emitter needs to sign and address a `trigger.conversation` frame.
   * Runtime is bounded by the count of the user's open triggers, not by the
   * number of recent AgentSession rows.
   *
   * Triggers older than `REFAN_TRIGGER_FRESHNESS_WINDOW_MS` are excluded: this
   * read drives authenticate-time re-fan, which is transient-reconnect
   * recovery rather than session retention, so a stale session is not
   * resurrected on every reconnect. The per-node resolver above is NOT
   * age-gated — it serves actively-open conversations.
   */
  async resolveOpenTriggersForUser(
    userId: UserId,
  ): Promise<OpenTriggerForUser[]> {
    const freshnessCutoff = new Date(
      Date.now() - REFAN_TRIGGER_FRESHNESS_WINDOW_MS,
    );
    const rows = await this.prisma.db.pendingOpenTrigger.findMany({
      where: { userId, createdAt: { gte: freshnessCutoff } },
      select: {
        conversationId: true,
        messageId: true,
        organizationId: true,
        projectId: true,
      },
    });

    const inputCount = rows.length;

    if (inputCount === 0) {
      this.logger.log(
        `resolveOpenTriggersForUser userId=${userId} inputRows=0 droppedNoExecution=0 droppedNodeMismatch=0 surviving=0 freshnessCutoff=${freshnessCutoff.toISOString()} windowMs=${REFAN_TRIGGER_FRESHNESS_WINDOW_MS}`,
      );
      return [];
    }

    // Gate each row against the live workflow position so an orphan row
    // (workflow has since advanced past the node the trigger named) does not
    // get re-fanned. We do NOT inject FlowExecutionService — it depends on
    // this service, so going through it would form a cycle. Reading
    // FlowExecution directly off prisma here keeps the dependency one-way and
    // mirrors the predicate of findActiveByConversation: resumable=true plus
    // status ∈ {STARTED, IN_PROGRESS, PAUSED, COMPLETED} ("a caller can still
    // drive this forward", including wound-down-but-resumable workflows).
    const conversationIds = Array.from(
      new Set(rows.map((row) => row.conversationId)),
    );
    const messageIds = rows.map((row) => row.messageId);

    const [executions, messages] = await Promise.all([
      this.prisma.db.flowExecution.findMany({
        where: {
          conversationId: { in: conversationIds },
          resumable: true,
          status: {
            in: [
              FlowExecutionStatus.STARTED,
              FlowExecutionStatus.IN_PROGRESS,
              FlowExecutionStatus.PAUSED,
              FlowExecutionStatus.COMPLETED,
            ],
          },
        },
        select: {
          conversationId: true,
          currentNode: true,
          startedAt: true,
        },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.db.message.findMany({
        where: { id: { in: messageIds }, type: 'SYSTEM' },
        select: { id: true, data: true },
      }),
    ]);

    const currentNodeByConversation = new Map<string, string | null>();
    for (const execution of executions) {
      if (!execution.conversationId) continue;
      // findMany returned rows newest-first; keep the first we see per
      // conversation so wound-down/older rows do not clobber the live one.
      if (currentNodeByConversation.has(execution.conversationId)) continue;
      currentNodeByConversation.set(
        execution.conversationId,
        execution.currentNode,
      );
    }

    const triggerNodeByMessageId = new Map<string, string | null>();
    for (const message of messages) {
      const data = message.data as AgentSystemMessageData | undefined;
      const nodeId = data?.triggersAgent?.nodeId;
      triggerNodeByMessageId.set(
        message.id,
        data?.triggersAgent && 'operationId' in data.triggersAgent
          ? null
          : typeof nodeId === 'string'
            ? nodeId
            : null,
      );
    }

    let droppedNoExecution = 0;
    let droppedNodeMismatch = 0;
    const results: OpenTriggerForUser[] = [];
    for (const row of rows) {
      const currentNode = currentNodeByConversation.get(row.conversationId);
      if (currentNode === undefined) {
        droppedNoExecution += 1;
        continue;
      }
      const triggerNode = triggerNodeByMessageId.get(row.messageId) ?? null;
      if (!currentNode || !triggerNode || currentNode !== triggerNode) {
        droppedNodeMismatch += 1;
        continue;
      }
      results.push({
        conversationId: row.conversationId as ConversationId,
        messageId: row.messageId as MessageId,
        organizationId: row.organizationId as OrganizationId,
        projectId: row.projectId as ProjectId,
      });
    }

    this.logger.log(
      `resolveOpenTriggersForUser userId=${userId} inputRows=${inputCount} droppedNoExecution=${droppedNoExecution} droppedNodeMismatch=${droppedNodeMismatch} surviving=${results.length} freshnessCutoff=${freshnessCutoff.toISOString()} windowMs=${REFAN_TRIGGER_FRESHNESS_WINDOW_MS}`,
    );
    return results;
  }
}
