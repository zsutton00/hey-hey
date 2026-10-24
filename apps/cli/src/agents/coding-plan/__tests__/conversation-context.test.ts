import { describe, expect, it } from 'vitest';
import { renderCodingPlanConversation } from '../conversation-context';

describe('planning conversation recovery', () => {
  it('preserves valid context and replies when a historical issue is unreadable', () => {
    const text = renderCodingPlanConversation([
      {
        id: 'issue',
        type: 'SYSTEM',
        data: { uiElements: [{ type: 'coding_plan_discrepancy', payload: {} }] },
      },
      {
        id: 'reply',
        type: 'USER',
        data: { agentInput: { userMessage: 'Retain keyboard access.' } },
      },
      {
        id: 'reviewed',
        type: 'SYSTEM',
        data: {
          uiElements: [
            {
              type: 'coding_plan_version',
              payload: {
                responseType: 'coding_plan_version_v1',
                markdown:
                  'Keep ordinary replies and explicit approval. Preserve the current session.',
                requiredServiceIds: ['a8fb6fbb-5747-4480-89e3-fc4a43ab7745'],
              },
            },
          ],
        },
      },
    ]);
    expect(text).toContain('Retain keyboard access.');
    expect(text).toContain('Keep ordinary replies and explicit approval.');
    expect(text).toContain('persisted evidence is invalid');
  });
});

it('recovers all ordered planner and user discussion, deduplicating threaded copies', async () => {
  const { fetchCodingPlanConversation } = await import('../conversation-context');
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `message-${String(index).padStart(2, '0')}`,
    createdAt: '2026-10-24T01:00:00Z',
    type: index % 2 ? 'SYSTEM' : 'USER',
    data:
      index % 2
        ? { response: `Planner explanation ${index}: keep earlier choices.` }
        : { agentInput: { userMessage: `User point ${index}.` } },
  }));
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: [{ ...rows[24], responses: [rows[1]] }, ...rows.slice(0, 24).reverse()],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  const messages = await fetchCodingPlanConversation(
    {
      contextMetadata: { organizationId: 'org', projectId: 'project' },
      conversationId: 'conversation',
    } as import('../../../session/types').AgenticSession,
    {
      auth: { getAccessToken: async () => 'test-token' },
      apiBaseUrl: 'https://example.test',
      fetchImpl,
    } as unknown as import('../../prompt-type-handler').PromptTypeHandlerDeps,
  );
  expect(messages.map((message) => message.id)).toEqual(rows.map((row) => row.id));
  const discussion = renderCodingPlanConversation(messages);
  expect(discussion).toContain('Planner explanation 1: keep earlier choices.');
  expect(discussion).toContain('User point 24.');
  expect(discussion.indexOf('User point 0.')).toBeLessThan(
    discussion.indexOf('Planner explanation 1:'),
  );
});
