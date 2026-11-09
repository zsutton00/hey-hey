/**
 * Handler: permission_group_item_added
 *
 * A same-tool permission request arrived while a card for that tool was still
 * open. Adds it as a row on the card's message instead of posting a new card.
 * The new request id shares the card's in-memory entry so later decisions for
 * any row update the one message.
 */

import type { AgentRequestPermissionPayload } from '../../shared/api/index';
import type { PermissionGroupItemAddedEvent, HandlerDeps } from '../types';
import type { Run } from '../run';
import { updateCardPayload } from './permission-card-payload';

/** Longest a joining request waits for its card's message to be posted. */
const CARD_POST_WAIT_MS = 15_000;

export const handlePermissionGroupItemAdded = async (
  event: PermissionGroupItemAddedEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  // The card's own post may still be in flight, or its event not yet handled.
  await ctx.whenPermissionRequestMessageRecorded(event.cardRequestId, CARD_POST_WAIT_MS);
  const entry = ctx.getPermissionRequestMessage(event.cardRequestId);
  if (!entry?.data) {
    deps.logger.warn('local.handler.permission_group_item_added.card_not_found', {
      runId: ctx.runId,
      cardRequestId: event.cardRequestId,
      requestId: event.requestId,
    });
    return;
  }

  const updatedData = updateCardPayload(entry.data, (payload) => {
    const rows = payload.groupedRequests ?? [
      {
        requestId: event.cardRequestId,
        description: event.cardDescription,
        decision: payload.decision ?? null,
        decidedAt: payload.decidedAt ?? null,
      },
    ];

    return {
      ...payload,
      groupedRequests: [
        ...rows,
        {
          requestId: event.requestId,
          description: event.description,
          decision: null,
          decidedAt: null,
        },
      ],
    } satisfies AgentRequestPermissionPayload;
  });

  entry.data = updatedData;
  ctx.joinPermissionRequestMessage(event.requestId, entry);

  try {
    await deps.poster.update(
      ctx.organizationId,
      ctx.projectId,
      entry.messageId,
      { data: updatedData },
      null,
    );
  } catch (error) {
    deps.logger.error('local.handler.permission_group_item_added.update_failed', {
      runId: ctx.runId,
      cardRequestId: event.cardRequestId,
      requestId: event.requestId,
      messageId: entry.messageId,
      error,
    });
  }
};
