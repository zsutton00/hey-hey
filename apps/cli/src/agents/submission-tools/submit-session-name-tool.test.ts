import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmitSessionNameTool } from './submit-session-name-tool';
import { SubmissionToolAuth } from './submission-tool-auth';
import { UpdateConversationProxy } from './update-conversation-proxy';
import { createTestRun } from '../../run/run.test-support';
import type { SubmissionToolMcpContent } from './types';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

const makeRun = (overrides?: Partial<{ conversationId: string; projectId: string }>) =>
  createTestRun({
    conversationId: overrides?.conversationId ?? 'conv-test',
    projectId: overrides?.projectId ?? 'proj-test',
  });

const makeProxyContent = (title: string): SubmissionToolMcpContent[] => [
  { type: 'text', text: JSON.stringify({ id: 'conv-test', title }) },
];

const updateConversation = vi.spyOn(UpdateConversationProxy.prototype, 'update');

const makeTool = (): SubmitSessionNameTool =>
  new SubmitSessionNameTool({
    auth: new SubmissionToolAuth(createProviderTestOAuthClient()),
    apiBaseUrl: 'https://api.test/v1',
    fetchImpl: vi.fn() as typeof fetch,
  });

describe('createSubmitSessionNameTool', () => {
  beforeEach(() => {
    updateConversation.mockReset();
  });

  it('declares a pass-through tool with the submit_session_name name and a 3-80 char input schema', () => {
    const tool = makeTool();

    expect(tool.kind).toBe('pass_through');
    expect(tool.name).toBe('submit_session_name');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 80 },
      },
    });
  });

  it('forwards the run conversationId/projectId and returns the proxy content verbatim', async () => {
    const content = makeProxyContent('Goal Conversation Prompt');
    updateConversation.mockResolvedValue({
      content,
      conversationId: 'conv-test',
      title: 'Goal Conversation Prompt',
    });

    const tool = makeTool();
    const run = makeRun();

    const result = await tool.execute({
      runId: 'run-xyz',
      args: { name: 'Goal Conversation Prompt' },
      run,
    });

    expect(updateConversation).toHaveBeenCalledWith({
      runId: 'run-xyz',
      conversationId: 'conv-test',
      projectId: 'proj-test',
      title: 'Goal Conversation Prompt',
    });
    expect(result.content).toBe(content);
  });

  it('rejects a name shorter than 3 characters', async () => {
    const tool = makeTool();
    const run = makeRun();

    await expect(tool.execute({ runId: 'run-1', args: { name: 'ab' }, run })).rejects.toThrow(
      /3-80 characters/,
    );
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 80 characters', async () => {
    const tool = makeTool();
    const run = makeRun();
    const tooLong = 'x'.repeat(81);

    await expect(tool.execute({ runId: 'run-1', args: { name: tooLong }, run })).rejects.toThrow(
      /3-80 characters/,
    );
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it('throws when ctx.run is absent — pass-through tools cannot resolve a conversation without a Run', async () => {
    const tool = makeTool();

    await expect(tool.execute({ runId: 'run-1', args: { name: 'Some Topic' } })).rejects.toThrow(
      /ctx\.run is required/,
    );
    expect(updateConversation).not.toHaveBeenCalled();
  });

  it('surfaces a proxy version-conflict error without retrying inside the tool', async () => {
    // The proxy itself handles a single 409 refetch+retry; if it surfaces a
    // VERSION_CONFLICT the tool propagates it rather than wrapping it.
    const conflict = Object.assign(new Error('conflict on retry'), {
      name: 'UpdateConversationProxyError',
      code: 'VERSION_CONFLICT',
    });
    updateConversation.mockRejectedValue(conflict);
    const tool = makeTool();
    const run = makeRun();

    await expect(
      tool.execute({ runId: 'run-1', args: { name: 'Conflict Topic' }, run }),
    ).rejects.toThrow(/conflict on retry/);
    expect(updateConversation).toHaveBeenCalledTimes(1);
  });
});
