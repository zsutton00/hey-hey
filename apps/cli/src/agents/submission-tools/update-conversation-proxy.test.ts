import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmissionToolAuth } from './submission-tool-auth';
import { UpdateConversationProxy, UpdateConversationProxyError } from './update-conversation-proxy';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

vi.mock('../../auth/index', () => ({
  extractOrganizationIdFromToken: (token: string) =>
    token.startsWith('token-with-org:') ? token.split(':')[1] : null,
}));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeAuth = (token: string): SubmissionToolAuth =>
  new SubmissionToolAuth(createProviderTestOAuthClient({ success: true, data: token }));

describe('UpdateConversationProxy', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GETs the current version, PATCHes with expectedVersion+title, and returns the platform title', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 7 } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: 'conv-1', title: 'Renamed Conversation' } }),
      );

    const proxy = new UpdateConversationProxy({
      auth: makeAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await proxy.update({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      title: 'Renamed Conversation',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [getUrl, getInit] = fetchImpl.mock.calls[0]!;
    expect(getUrl).toBe(
      'http://localhost:3000/api/v1/organizations/org-42/projects/proj-1/conversations/conv-1',
    );
    expect(getInit).toMatchObject({ method: 'GET' });
    expect(getInit.headers).toMatchObject({
      Authorization: 'Bearer token-with-org:org-42',
      'X-Organization-ID': 'org-42',
      'X-Project-ID': 'proj-1',
      'X-Agent-Session-ID': 'run-1',
      'X-Conversation-ID': 'conv-1',
    });

    const [patchUrl, patchInit] = fetchImpl.mock.calls[1]!;
    expect(patchUrl).toBe(getUrl);
    expect(patchInit).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(patchInit.body as string)).toEqual({
      expectedVersion: 7,
      title: 'Renamed Conversation',
    });

    expect(result.conversationId).toBe('conv-1');
    expect(result.title).toBe('Renamed Conversation');
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 'conv-1', title: 'Renamed Conversation' }) },
    ]);
  });

  it('refetches and retries once on a 409 version conflict', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'version conflict' }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 8 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', title: 'Retry Wins' } }));

    const proxy = new UpdateConversationProxy({
      auth: makeAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await proxy.update({
      runId: 'run-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      title: 'Retry Wins',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body as string)).toEqual({
      expectedVersion: 7,
      title: 'Retry Wins',
    });
    expect(JSON.parse(fetchImpl.mock.calls[3]![1].body as string)).toEqual({
      expectedVersion: 8,
      title: 'Retry Wins',
    });
    expect(result.title).toBe('Retry Wins');
  });

  it('surfaces VERSION_CONFLICT when a second 409 happens after the retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'conflict' }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 8 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'conflict again' }, 409));

    const proxy = new UpdateConversationProxy({
      auth: makeAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      proxy.update({
        runId: 'run-1',
        conversationId: 'conv-1',
        projectId: 'proj-1',
        title: 'Doomed',
      }),
    ).rejects.toMatchObject({
      name: 'UpdateConversationProxyError',
      code: 'VERSION_CONFLICT',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws TOOL_ERROR when the PATCH returns a non-2xx, non-409 status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'conv-1', version: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

    const proxy = new UpdateConversationProxy({
      auth: makeAuth('token-with-org:org-42'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      proxy.update({
        runId: 'run-1',
        conversationId: 'conv-1',
        projectId: 'proj-1',
        title: 'Server Fail',
      }),
    ).rejects.toMatchObject({
      name: 'UpdateConversationProxyError',
      code: 'TOOL_ERROR',
    });
  });

  it('throws MISSING_ORGANIZATION_ID when the token carries no org', async () => {
    const fetchImpl = vi.fn();

    const proxy = new UpdateConversationProxy({
      auth: makeAuth('token-no-org'),
      apiBaseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      proxy.update({
        runId: 'run-1',
        conversationId: 'conv-1',
        projectId: 'proj-1',
        title: 'No Org',
      }),
    ).rejects.toBeInstanceOf(UpdateConversationProxyError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
