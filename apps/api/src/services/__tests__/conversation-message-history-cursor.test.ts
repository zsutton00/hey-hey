import {
  ConversationMessageHistoryCursorError,
  decodeConversationMessageHistoryCursor,
  encodeConversationMessageHistoryCursor,
} from '../conversation-message-history-cursor';
import type { ConversationId, MessageId, ProjectId } from '../../types';

describe('conversation Message history cursor', () => {
  const projectId = '11111111-1111-4111-8111-111111111111' as ProjectId;
  const conversationId =
    '22222222-2222-4222-8222-222222222222' as ConversationId;
  const id = '33333333-3333-4333-8333-333333333333' as MessageId;

  it('round-trips a cursor bound to its project and conversation', () => {
    const encoded = encodeConversationMessageHistoryCursor({
      version: 1,
      projectId,
      conversationId,
      createdAt: '2026-09-21T00:00:00.000Z',
      id,
    });

    expect(
      decodeConversationMessageHistoryCursor({
        cursor: encoded,
        projectId,
        conversationId,
      }),
    ).toEqual({
      version: 1,
      projectId,
      conversationId,
      createdAt: '2026-09-21T00:00:00.000Z',
      id,
    });
  });

  it.each([
    'not base64!',
    Buffer.from('{broken', 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ version: 1 }), 'utf8').toString('base64url'),
  ])('rejects malformed cursor %s', (cursor) => {
    expect(() =>
      decodeConversationMessageHistoryCursor({
        cursor,
        projectId,
        conversationId,
      }),
    ).toThrow(ConversationMessageHistoryCursorError);
  });

  it('rejects a cursor from another project or conversation', () => {
    const cursor = encodeConversationMessageHistoryCursor({
      version: 1,
      projectId,
      conversationId,
      createdAt: '2026-09-21T00:00:00.000Z',
      id,
    });

    expect(() =>
      decodeConversationMessageHistoryCursor({
        cursor,
        projectId: '44444444-4444-4444-8444-444444444444' as ProjectId,
        conversationId,
      }),
    ).toThrow(ConversationMessageHistoryCursorError);
    expect(() =>
      decodeConversationMessageHistoryCursor({
        cursor,
        projectId,
        conversationId:
          '55555555-5555-4555-8555-555555555555' as ConversationId,
      }),
    ).toThrow(ConversationMessageHistoryCursorError);
  });
});
