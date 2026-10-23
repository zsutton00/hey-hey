import { isEmpty } from 'lodash';
import { MessageStatus } from 'src/constants/message-status.constants';
import { MessageResponseDto, SystemMessageData } from 'src/generated';
import { MessageQueryResult, MessageWithRelations } from 'src/services/types';
import {
  hasUiElements,
  isAgentsSystemMessageData,
  isQuestionSystemMessageData,
} from './type-checks';

export class MessageResponseUtil {
  private static isStreamingReady(data: SystemMessageData): boolean {
    const rootReady = (data as { streamingReady?: boolean }).streamingReady;
    if (rootReady === true) {
      return true;
    }

    const uiHintsReady = (data as { uiHints?: { streamingReady?: boolean } })
      ?.uiHints?.streamingReady;
    if (uiHintsReady === true) {
      return true;
    }

    const streamingConfig = (
      data as { streaming?: { ready?: boolean; sessionId?: string } }
    ).streaming;
    if (!streamingConfig) {
      return false;
    }

    if (streamingConfig.ready === true) {
      return true;
    }

    return typeof streamingConfig.sessionId === 'string';
  }

  /**
   * Determines if a system message is awaiting a response from the user.
   * A message is awaiting response if:
   * 1. It has no responses yet (isEmpty check)
   * 2. It has questions in its data
   *
   * @param responses - Array of response messages (can be undefined/null)
   * @param systemData - The system message data containing potential questions
   * @returns boolean indicating if the message is awaiting a response
   */
  static isAwaitingResponse(
    responses:
      | MessageResponseDto[]
      | MessageWithRelations[]
      | MessageQueryResult[]
      | undefined
      | null,
    systemData: SystemMessageData,
    status: MessageStatus,
  ): boolean {
    if (status === MessageStatus.Failed) {
      return false;
    }
    if (!isEmpty(responses)) {
      return false;
    }
    if (
      status === MessageStatus.SystemProcessing &&
      isAgentsSystemMessageData(systemData)
    ) {
      return false;
    }

    return !!(
      !isQuestionSystemMessageData(systemData) || hasUiElements(systemData)
    );
  }

  static determineMessageStatus(
    responseData: SystemMessageData,
  ): MessageStatus {
    if (MessageResponseUtil.isStreamingReady(responseData)) {
      return MessageStatus.StreamingReady;
    }

    if (isQuestionSystemMessageData(responseData)) {
      if (hasUiElements(responseData)) {
        return MessageStatus.Open;
      }
    }
    return MessageStatus.Completed;
  }
}
