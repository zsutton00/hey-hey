/**
 * Handler: permission_decision_recorded
 *
 * Updates the original permission-request SYSTEM message with the user's
 * decision and transitions its status to Completed. The message was posted
 * open at request time; the decision is written into the uiElement payload
 * so the UI can render the chosen button as selected across page reloads.
 */

import { MessageStatus } from '../../shared/api/index';
import type { SystemMessageData, UIElement } from '../../shared/api/index';
import type { AgentRequestPermissionPayload } from '../../shared/api/index';
import type { PermissionDecisionRecordedEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

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

  const existingData = entry.data as SystemMessageData;

  const updatedUiElements: UIElement[] | undefined = existingData.uiElements?.map((el) => {
    if (typeof el.id === 'string' && el.id.startsWith('agent-request-permission:')) {
      const existing = el.payload as AgentRequestPermissionPayload | undefined;
      const updatedPayload: AgentRequestPermissionPayload = {
        ...(existing ?? {
          responseType: 'agent_request_permission_v1' as const,
          permissionRequest: {} as AgentRequestPermissionPayload['permissionRequest'],
        }),
        decision: event.decision,
        decidedAt: event.decidedAt,
      };
      return { ...el, payload: updatedPayload } as UIElement;
    }
    return el;
  });

  const updatedData: SystemMessageData = {
    ...existingData,
    ...(updatedUiElements !== undefined ? { uiElements: updatedUiElements } : {}),
  };

  try {
    await deps.poster.complete(
      ctx.organizationId,
      ctx.projectId,
      entry.messageId,
      { status: MessageStatus.Completed, data: updatedData },
      null,
    );
    ctx.forgetPermissionRequestMessage(event.requestId);
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
