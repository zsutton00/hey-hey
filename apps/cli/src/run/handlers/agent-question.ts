/**
 * Handler: agent_question
 *
 * Posts an `AskUserQuestion` call as a SYSTEM message carrying the interactive
 * question field, then opens the Awaiting Approval pause. The pause opens only
 * after the message is posted so the person is never shown a wait with nothing
 * to answer.
 */

import { ExtendedUIFieldType } from '../../shared/api/generated/api';
import { MessageType, MessageStatus, SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { SystemMessageData } from '../../shared/api/index';
import type { AgentQuestionEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const AGENT_QUESTION_UI_ELEMENT_PREFIX = 'agent-question:';

export const handleAgentQuestion = async (
  event: AgentQuestionEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  const { question } = event;
  const data: SystemMessageData = {
    type: SystemMessageDataTypeEnum.Questions,
    title: 'Question',
    response: question.questions.map((entry) => entry.question).join('\n\n'),
    detectedIntent: 'agent_question',
    intentConfidence: 1,
    ragEnabled: false,
    uiElements: [
      {
        id: `${AGENT_QUESTION_UI_ELEMENT_PREFIX}${event.requestId}`,
        type: ExtendedUIFieldType.AgentQuestion,
        label: 'Question',
        payload: question,
      },
    ],
    triggerNotification: true,
  };

  try {
    const messageId = await deps.poster.createOutOfBand({
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      conversationId: ctx.conversationId,
      dto: {
        type: MessageType.System,
        status: MessageStatus.Open,
        projectId: ctx.projectId,
        data,
      },
      stamp: null,
    });
    ctx.recordQuestionMessage(event.requestId, messageId, data);
    ctx.observeProviderPhase('awaiting_approval');
  } catch (error) {
    deps.logger.error('local.handler.agent_question.post_failed', {
      runId: ctx.runId,
      requestId: event.requestId,
      error,
    });
  }
};
