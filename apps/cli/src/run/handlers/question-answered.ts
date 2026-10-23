/**
 * Handler: question_answered
 *
 * Writes the person's answers and the answer time into the original question
 * message's field payload and completes the message, so the field renders as
 * answered across page reloads.
 */

import { MessageStatus } from '../../shared/api/index';
import type { SystemMessageData, UIElement } from '../../shared/api/index';
import type { AgentQuestionPayload } from '../../shared/api/generated/api';
import type { QuestionAnsweredEvent, HandlerDeps } from '../types';
import type { Run } from '../run';
import { AGENT_QUESTION_UI_ELEMENT_PREFIX } from './agent-question';

export const handleQuestionAnswered = async (
  event: QuestionAnsweredEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  const entry = ctx.getQuestionMessage(event.requestId);
  if (!entry) {
    deps.logger.warn('local.handler.question_answered.no_message_entry', {
      runId: ctx.runId,
      requestId: event.requestId,
    });
    return;
  }

  const updatedUiElements: UIElement[] | undefined = entry.data.uiElements?.map((el) => {
    if (typeof el.id === 'string' && el.id.startsWith(AGENT_QUESTION_UI_ELEMENT_PREFIX)) {
      const updatedPayload = {
        ...(el.payload as AgentQuestionPayload),
        answers: event.answers,
        answeredAt: event.answeredAt,
      };
      return { ...el, payload: updatedPayload };
    }
    return el;
  });

  const updatedData: SystemMessageData = {
    ...entry.data,
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
    ctx.forgetQuestionMessage(event.requestId);
  } catch (error) {
    deps.logger.error('local.handler.question_answered.update_failed', {
      runId: ctx.runId,
      requestId: event.requestId,
      messageId: entry.messageId,
      error,
    });
  }
};
