/**
 * Handler: permission_decision_recorded
 *
 * Updates the original permission-request SYSTEM message with the user's
 * decision and transitions its status to Completed. The message was posted
 * open at request time; the decision is written into the uiElement payload
 * so the UI can render the chosen button as selected across page reloads.
 * A grouped card holds one decision per row and completes once every row is
 * decided.
 */

import { MessageStatus } from '../../shared/api/index';
import type { PermissionDecisionRecordedEvent, HandlerDeps } from '../types';
import type { Run } from '../run';
import { updateCardPayload } from './permission-card-payload';

export const handlePermissionDecisionRecorded = async (
  event: PermissionDecisionRecordedEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  const entry = ctx.getPermissionRequestMessage(event.requestId);
  if (!entry) {
    deps.logger.warn('local.handler.permission_decision_recorded.no_message_entry', {
      runId: ctx.runId,
      requestId: event.requestId,
      decision: event.decision,
    });
    return;
  }

  if (!entry.data) {
    deps.logger.warn('local.handler.permission_decision_recorded.message_data_missing', {
      runId: ctx.runId,
      requestId: event.requestId,
      messageId: entry.messageId,
      decision: event.decision,
    });
    return;
  }

  let allDecided = true;
  let rowRequestIds: string[] = [];
  const updatedData = updateCardPayload(entry.data, (payload) => {
    const rows = payload.groupedRequests?.map((row) =>
      row.requestId === event.requestId
        ? { ...row, decision: event.decision, decidedAt: event.decidedAt }
        : row,
    );
    allDecided = rows ? rows.every((row) => row.decision != null) : true;
    rowRequestIds = rows?.map((row) => row.requestId) ?? [];

    // The top-level decision keeps describing the card's first request.
    const describesDecidedRequest = payload.permissionRequest.id === event.requestId;

    return {
      ...payload,
      ...(describesDecidedRequest ? { decision: event.decision, decidedAt: event.decidedAt } : {}),
      ...(rows ? { groupedRequests: rows } : {}),
    };
  });
  entry.data = updatedData;

  try {
    if (allDecided) {
      await deps.poster.complete(
        ctx.organizationId,
        ctx.projectId,
        entry.messageId,
        { status: MessageStatus.Completed, data: updatedData },
        null,
      );
      for (const requestId of new Set([event.requestId, ...rowRequestIds])) {
        ctx.forgetPermissionRequestMessage(requestId);
      }
    } else {
      await deps.poster.update(
        ctx.organizationId,
        ctx.projectId,
        entry.messageId,
        { data: updatedData },
        null,
      );
      ctx.forgetPermissionRequestMessage(event.requestId);
    }
  } catch (error) {
    deps.logger.error('local.handler.permission_decision_recorded.update_failed', {
      runId: ctx.runId,
      requestId: event.requestId,
      messageId: entry.messageId,
      decision: event.decision,
      error,
    });
  }
};
