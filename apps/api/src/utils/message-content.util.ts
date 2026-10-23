import { SystemMessageData, UserMessageData } from '../generated';
import { UserMessageExtractor } from './user-message-extractor';

/**
 * Message `data` shapes this extractor accepts. Covers the spec-typed message
 * data unions plus the partial-update shape, so callers pass their already
 * typed `data` straight through instead of widening to a `Record` bag.
 */
export type MessageDataForContent =
  | SystemMessageData
  | Partial<SystemMessageData>
  | UserMessageData;

export function getContentFromMessageData(
  type: 'USER' | 'SYSTEM',
  data: MessageDataForContent | undefined,
): string | null {
  if (!data) {
    return null;
  }

  if (type === 'USER') {
    const content = UserMessageExtractor.extractContentFromData(
      data as UserMessageData,
      '',
    ).trim();
    return content.length ? content : null;
  }

  const response = (data as { response?: unknown }).response;
  if (typeof response === 'string' && response.trim().length) {
    return response.trim();
  }

  const message = (data as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim().length) {
    return message.trim();
  }

  return null;
}
