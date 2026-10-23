import { BadRequestException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { ConversationId, MessageId, ProjectId } from '../types';

export interface ConversationMessageHistoryCursor {
  version: 1;
  projectId: ProjectId;
  conversationId: ConversationId;
  createdAt: string;
  id: MessageId;
}

export class ConversationMessageHistoryCursorError extends BadRequestException {
  constructor() {
    super('historyCursor is invalid for this project conversation');
  }
}

export const encodeConversationMessageHistoryCursor = (
  cursor: ConversationMessageHistoryCursor,
): string => Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeConversationMessageHistoryCursor = (params: {
  cursor: string;
  projectId: ProjectId;
  conversationId: ConversationId;
}): ConversationMessageHistoryCursor => {
  if (!/^[A-Za-z0-9_-]+$/.test(params.cursor)) {
    throw new ConversationMessageHistoryCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(params.cursor, 'base64url').toString('utf8'),
    );
  } catch {
    throw new ConversationMessageHistoryCursorError();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConversationMessageHistoryCursorError();
  }

  const cursor = parsed as Partial<ConversationMessageHistoryCursor>;
  if (
    cursor.version !== 1 ||
    cursor.projectId !== params.projectId ||
    cursor.conversationId !== params.conversationId ||
    typeof cursor.createdAt !== 'string' ||
    Number.isNaN(Date.parse(cursor.createdAt)) ||
    new Date(cursor.createdAt).toISOString() !== cursor.createdAt ||
    typeof cursor.id !== 'string' ||
    !isUuid(cursor.id)
  ) {
    throw new ConversationMessageHistoryCursorError();
  }

  return cursor as ConversationMessageHistoryCursor;
};
