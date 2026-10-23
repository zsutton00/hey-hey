import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SearchMessagesProxy,
  WorkflowAboutReader,
  SearchMessagesProxyError,
  type GetConversationApiClient,
  type SearchMessagesApiClient,
} from './search-messages-proxy';
import { SubmissionToolAuth } from './submission-tool-auth';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

// A token whose JWT payload carries the org claim `extractOrganizationIdFromToken`
// reads. We feed a real token rather than mocking the auth module — mocking it
// is unreliable here because this module transitively imports the generated API
// client, which the global test setup loads (with the real auth module) first.
const tokenWithOrg = (org: string): string =>
  `x.${Buffer.from(JSON.stringify({ organizationId: org })).toString('base64url')}.y`;
const TOKEN = tokenWithOrg('org-42');

const makeAuth = (token: string): SubmissionToolAuth =>
  new SubmissionToolAuth(createProviderTestOAuthClient({ success: true, data: token }));

const okSearch = (rows: unknown): SearchMessagesApiClient => ({
  searchConversationMessages: vi.fn().mockResolvedValue({
    data: { data: rows },
  }),
});

describe('SearchMessagesProxy', () => {
  afterEach(() => vi.clearAllMocks());

  it('drives the generated client with org+project+workflowAbout+query+limit and returns validated rows', async () => {
    const rows = [
      {
        conversationId: 'conv-9',
        conversationTitle: 'Earlier goal chat',
        messageId: 'msg-9',
        snippet: 'we shipped the API first',
        createdAt: '2026-06-01T00:00:00.000Z',
        type: 'USER',
      },
    ];
    const client = okSearch(rows);

    const proxy = new SearchMessagesProxy({
      auth: makeAuth(TOKEN),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => client,
    });

    const result = await proxy.search({
      projectId: 'proj-1',
      workflowAboutId: 'goal-1',
      workflowAboutType: 'goal',
      query: 'API',
      limit: 5,
    });

    expect(client.searchConversationMessages).toHaveBeenCalledWith({
      organizationId: 'org-42',
      projectId: 'proj-1',
      workflowAboutId: 'goal-1',
      workflowAboutType: 'goal',
      query: 'API',
      limit: 5,
    });
    expect(result).toEqual(rows);
  });

  it('returns an empty array when the response carries no rows', async () => {
    const client: SearchMessagesApiClient = {
      searchConversationMessages: vi.fn().mockResolvedValue({ data: {} }),
    };
    const proxy = new SearchMessagesProxy({
      auth: makeAuth(TOKEN),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => client,
    });

    await expect(
      proxy.search({
        projectId: 'proj-1',
        workflowAboutId: 'goal-1',
        workflowAboutType: 'goal',
        query: 'API',
      }),
    ).resolves.toEqual([]);
  });

  it('throws MISSING_ORGANIZATION_ID when the token carries no org', async () => {
    const proxy = new SearchMessagesProxy({
      auth: makeAuth('not-a-jwt'),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => okSearch([]),
    });

    await expect(
      proxy.search({
        projectId: 'proj-1',
        workflowAboutId: 'goal-1',
        workflowAboutType: 'goal',
        query: 'API',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_ORGANIZATION_ID' });
  });

  it('throws INVALID_RESPONSE when a row is missing required fields', async () => {
    const proxy = new SearchMessagesProxy({
      auth: makeAuth(TOKEN),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => okSearch([{ conversationId: 'conv-9' }]),
    });

    await expect(
      proxy.search({
        projectId: 'proj-1',
        workflowAboutId: 'goal-1',
        workflowAboutType: 'goal',
        query: 'API',
      }),
    ).rejects.toBeInstanceOf(SearchMessagesProxyError);
  });
});

describe('WorkflowAboutReader', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads workflowAboutId/workflowAboutType off the generated getConversation client', async () => {
    const getConversation = vi.fn().mockResolvedValue({
      data: { data: { id: 'conv-1', workflowAboutId: 'goal-1', workflowAboutType: 'goal' } },
    });
    const client: GetConversationApiClient = { getConversation };

    const reader = new WorkflowAboutReader({
      auth: makeAuth(TOKEN),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => client,
    });

    const about = await reader.read({ projectId: 'proj-1', conversationId: 'conv-1' });

    expect(getConversation).toHaveBeenCalledWith({
      organizationId: 'org-42',
      projectId: 'proj-1',
      conversationId: 'conv-1',
    });
    expect(about).toEqual({ workflowAboutId: 'goal-1', workflowAboutType: 'goal' });
  });

  it('returns nulls when the conversation has no workflow-about attachment', async () => {
    const client: GetConversationApiClient = {
      getConversation: vi.fn().mockResolvedValue({ data: { data: { id: 'conv-1' } } }),
    };
    const reader = new WorkflowAboutReader({
      auth: makeAuth(TOKEN),
      apiBaseUrl: 'http://localhost/api/v1',
      createClient: () => client,
    });

    await expect(reader.read({ projectId: 'proj-1', conversationId: 'conv-1' })).resolves.toEqual({
      workflowAboutId: null,
      workflowAboutType: null,
    });
  });
});
