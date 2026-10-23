import { UserMessageData } from '../generated';
import { FlowUserMessage } from '../types/flow-internal.types';

/**
 * Utility for extracting message content from FlowUserMessage objects
 */
export class UserMessageExtractor {
  /**
   * Extracts the primary message content from a FlowUserMessage by delegating
   * to `extractContentFromData` on its `data` field.
   *
   * @param userMessage - The user message to extract content from
   * @param defaultValue - Default value when no content is found (default: '[No message content]')
   * @returns The extracted message content
   */
  static extractContent(
    userMessage?: FlowUserMessage,
    defaultValue: string = '[No message content]',
  ): string {
    return this.extractContentFromData(userMessage?.data, defaultValue);
  }

  /**
   * Extracts the primary message content from a USER message's typed `data`.
   * Tries multiple strategies to find meaningful content:
   * 0. Nested `agentInput.userMessage` (the typed dispatch envelope's text slot)
   * 1. Direct message field
   * 2. Comment field
   * 3. Feedback field
   * 4. Fields containing 'message', 'response', or 'input' keywords
   * 5. First meaningful string value
   *
   * Strategy 0 takes precedence because, once a submission carries a typed
   * `agentInput` envelope, that envelope's `userMessage` slot is the canonical
   * dispatch text — the freeform `round{N}_` bag at the `data` root is no longer
   * where the dispatch text lives. The generic field-scan in strategies 4–5
   * cannot reach it: `agentInput` is an object, not a top-level string.
   *
   * Takes the spec-typed `UserMessageData` directly so callers that hold typed
   * message data need not synthesize a full `FlowUserMessage` wrapper.
   *
   * @param data - The USER message data to extract content from
   * @param defaultValue - Default value when no content is found (default: '[No message content]')
   * @returns The extracted message content
   */
  static extractContentFromData(
    data: UserMessageData | undefined,
    defaultValue: string = '[No message content]',
  ): string {
    if (!data) {
      return defaultValue;
    }

    // Strategy 0: Nested typed dispatch envelope. `userMessage` lives on the
    // shared `UserMessageDataBase`, so it is present on every `agentInput` arm
    // and reads type-safely across the union without narrowing.
    const agentInputMessage = data.agentInput?.userMessage;
    if (typeof agentInputMessage === 'string' && agentInputMessage.trim()) {
      return agentInputMessage.trim();
    }

    // Strategy 1: Check direct message field
    if (data.message && typeof data.message === 'string') {
      return data.message.trim();
    }

    // Strategy 2: Check comment field
    if (data.comment && typeof data.comment === 'string') {
      return data.comment.trim();
    }

    // Strategy 3: Check feedback field
    if (data.feedback && typeof data.feedback === 'string') {
      return data.feedback.trim();
    }

    // Strategy 4: Look for fields with message-related keywords
    const messageKeywords = ['message', 'response', 'input', 'text', 'content'];
    for (const [key, value] of Object.entries(data)) {
      if (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        messageKeywords.some((keyword) => key.toLowerCase().includes(keyword))
      ) {
        return value.trim();
      }
    }

    // Strategy 5: Find first meaningful string value
    for (const value of Object.values(data)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return defaultValue;
  }

  /**
   * Checks if a FlowUserMessage has any meaningful content
   * @param userMessage - The user message to check
   * @returns True if the message has content, false otherwise
   */
  static hasContent(userMessage?: FlowUserMessage): boolean {
    const content = this.extractContent(userMessage, '');
    return content.length > 0;
  }

  /**
   * Extracts all available string content from a FlowUserMessage
   * Useful for debugging or comprehensive content analysis
   * @param userMessage - The user message to extract from
   * @returns Object mapping field names to their string content
   */
  static extractAllContent(
    userMessage?: FlowUserMessage,
  ): Record<string, string> {
    if (!userMessage?.data) {
      return {};
    }

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(userMessage.data)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        result[key] = value.trim();
      }
    }

    return result;
  }
}
