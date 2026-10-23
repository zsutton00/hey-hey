import { FlowUserMessage } from '../types/flow-internal.types';
import {
  CreateUserMessage,
  MessageRecordDto,
  MessageResponseDto,
  SystemMessageData,
  SystemMessageResponseType,
} from '../generated';
import { hasUiElements } from './type-checks';

/**
 * Utility for extracting user message content from various formats
 * Handles both direct messages and UI element responses
 */
export class MessageContentExtractor {
  /**
   * Extract user message content from FlowUserMessage
   * @param userMessage - The user message from workflow signal
   * @param parentSystemMessage - Optional parent system message for context
   * @returns Formatted message content string
   */
  static extractMessageContent(
    userMessage:
      | FlowUserMessage
      | MessageRecordDto
      | MessageResponseDto
      | CreateUserMessage,
    parentSystemMessage?: SystemMessageData,
  ): string {
    const messageData = userMessage.data;

    if (messageData !== null && messageData !== undefined) {
      // Handle string messages directly
      if (typeof messageData === 'string') {
        return (messageData as string).trim();
      }

      // Handle object messages as UI element responses
      if (typeof messageData === 'object' && messageData !== null) {
        const fieldResponses = this.extractUIFieldResponses(
          messageData as Record<string, unknown>,
        );

        const parent =
          parentSystemMessage ||
          (userMessage as MessageResponseDto).parentMessage?.data;
        if (parent) {
          if (parent.type === SystemMessageResponseType.Noop) {
            return '';
          }
          // Include context about what questions were answered
          return this.formatWithContext(
            fieldResponses,
            parent as SystemMessageData,
          );
        }

        return this.formatFieldResponses(fieldResponses);
      }
    }

    // Fallback for unexpected formats
    return '[Unable to extract message content]';
  }

  /**
   * Extract field responses from UI element data
   * @param messageData - Object containing field responses
   * @returns Array of field name/value pairs
   */
  private static extractUIFieldResponses(
    messageData: Record<string, unknown>,
  ): Array<{ fieldName: string; value: string }> {
    const responses: Array<{ fieldName: string; value: string }> = [];

    for (const [fieldName, value] of Object.entries(messageData)) {
      if (value !== null && value !== undefined && value !== '') {
        const stringValue =
          typeof value === 'string' ? value : JSON.stringify(value);

        responses.push({
          fieldName,
          value: stringValue.trim(),
        });
      }
    }

    return responses;
  }

  /**
   * Format field responses as a simple message
   * @param fieldResponses - Array of field responses
   * @returns Formatted message string
   */
  private static formatFieldResponses(
    fieldResponses: Array<{ fieldName: string; value: string }>,
  ): string {
    if (fieldResponses.length === 0) {
      return '[No response provided]';
    }

    if (fieldResponses.length === 1) {
      // Single response - just return the value
      const first = fieldResponses[0];
      if (!first) {
        return '[No response provided]';
      }
      return first.value;
    }

    // Multiple responses - format as list
    return fieldResponses
      .map(({ fieldName, value }) => `${fieldName}: ${value}`)
      .join('\n');
  }

  /**
   * Format field responses with context from parent system message
   * @param fieldResponses - Array of field responses
   * @param parentSystemMessage - Parent system message for context
   * @returns Formatted conversation exchange
   */
  private static formatWithContext(
    fieldResponses: Array<{ fieldName: string; value: string }>,
    parentSystemMessage: SystemMessageData,
  ): string {
    // Extract questions from parent message UI elements
    const questions =
      this.extractQuestionsFromSystemMessage(parentSystemMessage);

    if (questions.length === 0) {
      return this.formatFieldResponses(fieldResponses);
    }

    // Match responses to questions where possible
    const exchanges: string[] = [];

    for (const response of fieldResponses) {
      const matchingQuestion = questions.find(
        (q) => q.fieldName === response.fieldName,
      );

      if (matchingQuestion) {
        exchanges.push(`Q: ${matchingQuestion.label}\nA: ${response.value}`);
      } else {
        exchanges.push(`${response.fieldName}: ${response.value}`);
      }
    }

    return exchanges.join('\n\n');
  }

  /**
   * Extract questions from system message UI elements
   * @param systemMessage - System message containing UI elements
   * @returns Array of questions with field names and labels
   */
  private static extractQuestionsFromSystemMessage(
    systemMessage: SystemMessageData,
  ): Array<{ fieldName: string; label: string }> {
    const questions: Array<{ fieldName: string; label: string }> = [];

    if (!hasUiElements(systemMessage)) {
      return questions;
    }

    for (const element of systemMessage.uiElements) {
      if (
        typeof element === 'object' &&
        element !== null &&
        'id' in element &&
        'label' in element
      ) {
        const uiElement = element as { id: string; label: string };
        questions.push({
          fieldName: uiElement.id,
          label: uiElement.label,
        });
      }
    }

    return questions;
  }
}
