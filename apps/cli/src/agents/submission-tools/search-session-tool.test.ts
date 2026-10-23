import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSessionTool } from './search-session-tool';
import { SearchMessagesProxy, WorkflowAboutReader } from './search-messages-proxy';
import { SubmissionToolAuth } from './submission-tool-auth';
import type { SearchConversationMessagesResponseDto } from '../../shared/api/generated/api';
import { createTestRun } from '../../run/run.test-support';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

const makeRun = (overrides?: Partial<{ conversationId: string; projectId: string }>) =>
  createTestRun({
    conversationId: overrides?.conversationId ?? 'conv-1',
    projectId: overrides?.projectId ?? 'proj-1',
  });

const rows: SearchConversationMessagesResponseDto[] = [
  {
    conversationId: 'conv-9',
    conversationTitle: 'Earlier goal chat',
    messageId: 'msg-9',
    snippet: 'we decided to ship the API first',
    createdAt: '2026-06-01T00:00:00.000Z',
    type: 'USER' as SearchConversationMessagesResponseDto['type'],
  },
];

const searchMessages = vi.spyOn(SearchMessagesProxy.prototype, 'search');
const readWorkflowAbout = vi.spyOn(WorkflowAboutReader.prototype, 'read');

const makeTool = (): SearchSessionTool => {
  const auth = new SubmissionToolAuth(createProviderTestOAuthClient());
  return new SearchSessionTool(
    { auth, apiBaseUrl: 'https://api.test/v1' },
    new WorkflowAboutReader({ auth, apiBaseUrl: 'https://api.test/v1' }),
  );
};

describe('createSearchSessionTool', () => {
  beforeEach(() => {
    searchMessages.mockReset();
    readWorkflowAbout.mockReset();
  });

  it('declares a pass-through tool named search_session with a query/limit schema', () => {
    const tool = makeTool();

    expect(tool.kind).toBe('pass_through');
    expect(tool.name).toBe('search_session');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2 },
        limit: { type: 'number', maximum: 50 },
      },
    });
  });

  it('derives workflowAboutId/workflowAboutType from the active conversation and forwards query+limit verbatim', async () => {
    readWorkflowAbout.mockResolvedValue({
      workflowAboutId: 'goal-1',
      workflowAboutType: 'goal',
    });
    searchMessages.mockResolvedValue(rows);

    const tool = makeTool();

    await tool.execute({
      runId: 'run-1',
      args: { query: 'shipping decision', limit: 5 },
      run: makeRun(),
    });

    expect(readWorkflowAbout).toHaveBeenCalledWith({
      projectId: 'proj-1',
      conversationId: 'conv-1',
    });
    expect(searchMessages).toHaveBeenCalledWith({
      projectId: 'proj-1',
      workflowAboutId: 'goal-1',
      workflowAboutType: 'goal',
      query: 'shipping decision',
      limit: 5,
    });
  });

  it('defaults limit to 20 when omitted and returns the rows as a single MCP text block', async () => {
    readWorkflowAbout.mockResolvedValue({
      workflowAboutId: 'goal-1',
      workflowAboutType: 'goal',
    });
    searchMessages.mockResolvedValue(rows);

    const tool = makeTool();

    const result = await tool.execute({
      runId: 'run-1',
      args: { query: 'shipping decision' },
      run: makeRun(),
    });

    expect(searchMessages).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify([
          {
            conversationId: 'conv-9',
            conversationTitle: 'Earlier goal chat',
            messageId: 'msg-9',
            snippet: 'we decided to ship the API first',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ]),
      },
    ]);
  });

  it('throws when the active conversation is not attached to a workflow-about entity', async () => {
    readWorkflowAbout.mockResolvedValue({
      workflowAboutId: null,
      workflowAboutType: null,
    });

    const tool = makeTool();

    await expect(
      tool.execute({ runId: 'run-1', args: { query: 'anything' }, run: makeRun() }),
    ).rejects.toThrow(/entity conversation/);
    expect(searchMessages).not.toHaveBeenCalled();
  });

  it('throws when ctx.run is absent — the tool cannot resolve a conversation without a Run', async () => {
    const tool = makeTool();

    await expect(tool.execute({ runId: 'run-1', args: { query: 'anything' } })).rejects.toThrow(
      /ctx\.run is required/,
    );
    expect(readWorkflowAbout).not.toHaveBeenCalled();
    expect(searchMessages).not.toHaveBeenCalled();
  });
});
