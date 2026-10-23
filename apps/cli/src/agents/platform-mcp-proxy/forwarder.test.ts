import { describe, expect, it, vi } from 'vitest';
import { PlatformMcpForwarder } from './forwarder';
import type { ServerLogger } from '../../server/logger';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';

const TEST_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' +
  btoa(JSON.stringify({ sub: 'user-1', organizationId: 'org-123' })) +
  '.fake-signature';

describe('PlatformMcpForwarder', () => {
  it('preserves auth and run context headers when forwarding', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { status: 200 }),
      );
    const forwarder = new PlatformMcpForwarder({
      oauthClient: createProviderTestOAuthClient({ success: true, data: TEST_TOKEN }),
      logger: {
        trace: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as ServerLogger,
      fetchImpl,
      endpointUrl: 'https://heyhey.dev/mcp',
    });

    await forwarder.forward(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_context' } },
      {
        projectId: 'project-1',
        conversationId: 'conversation-1',
        serviceId: 'service-1',
        serviceIds: ['service-1', 'service-2'],
        agentSessionId: 'agent-session-1',
      },
    );

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TEST_TOKEN}`,
      'X-Organization-ID': 'org-123',
      'X-Project-ID': 'project-1',
      'X-Conversation-ID': 'conversation-1',
      'X-Service-ID': 'service-1',
      'X-Service-IDs': 'service-1,service-2',
      'X-Agent-Session-ID': 'agent-session-1',
    });
  });

  it('forwards root and scoped proof arguments and preserves structured guidance results', async () => {
    const responseBody = {
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [{ type: 'text', text: 'specific guidance' }],
        structuredContent: {
          guidance: 'topology rules',
          authoringRootProof: 'heyhey-authoring-root-v1',
          guidanceToken: 'gtg-standard-project',
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    const forwarder = new PlatformMcpForwarder({
      oauthClient: createProviderTestOAuthClient({ success: true, data: TEST_TOKEN }),
      logger: {
        trace: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as ServerLogger,
      fetchImpl,
      endpointUrl: 'https://heyhey.dev/mcp',
    });
    const request = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_tool_guidance',
        arguments: {
          toolName: 'create_work_item',
          workItemType: 'STANDARD',
          authoringRootProof: 'heyhey-authoring-root-v1',
          guidanceToken: 'gtg-standard-project',
        },
      },
    };

    await expect(forwarder.forward(request, { projectId: 'project-1' })).resolves.toEqual(
      responseBody,
    );
    expect(JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))).toEqual(request);
  });
});
