import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import { ActivePlatformToolCatalog } from './catalog';
import { PlatformMcpForwarder } from './forwarder';
import { PlatformMcpProxySession, type JsonRpcRequest, type JsonValue } from './session';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import type { ServerLogger } from '../../server/logger';
import { planShapingVisualPreviewHandler } from '../plan-shaping/visual-preview.handler';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const OWN_DRAFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWN_APPROVED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REUSED_DRAFT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type StoredProposal = { id: string; status: string; conversationId: string };

const silentLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as ServerLogger;

/** Stands in for the platform MCP endpoint, holding proposals across calls. */
const fakePlatformApi = (proposals: StoredProposal[]): typeof fetch => {
  const store = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const toolResult = (structuredContent: JsonValue) => ({
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  });
  const notFound = { isError: true, content: [{ type: 'text', text: 'Proposal not found' }] };

  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as JsonRpcRequest;
    const name = request.params?.['name'];
    const args = request.params?.['arguments'] as { proposalId: string };
    const proposal = store.get(args.proposalId);

    let result: JsonValue = notFound;
    if (proposal && name === 'get_proposal') {
      result = toolResult(proposal);
    }
    if (proposal && name === 'delete_proposal') {
      store.delete(proposal.id);
      result = toolResult({ deleted: true, proposalId: proposal.id });
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
      status: 200,
    });
  });
};

const visualPreviewSession = (fetchImpl: typeof fetch) =>
  new PlatformMcpProxySession(
    {
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1', conversationId: CONVERSATION_ID },
      catalog: new ActivePlatformToolCatalog({
        ...(planShapingVisualPreviewHandler.mcpToolUseCase
          ? { useCase: planShapingVisualPreviewHandler.mcpToolUseCase }
          : {}),
        additionalTools: planShapingVisualPreviewHandler.additionalAllowedTools ?? [],
      }),
      activeHandlerPromptType: LocalPromptType.PlanShapingVisualPreview,
      active: true,
      logger: silentLogger(),
    },
    new PlatformMcpForwarder({
      oauthClient: createTestOAuthClient(),
      logger: silentLogger(),
      fetchImpl,
      endpointUrl: 'https://api.test/mcp',
    }),
  );

const call = (name: string, proposalId: string): JsonRpcRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: { proposalId } },
});

describe('visual-preview proposal deletion', () => {
  const proposals: StoredProposal[] = [
    { id: OWN_DRAFT, status: 'DRAFT', conversationId: CONVERSATION_ID },
    { id: OWN_APPROVED, status: 'APPROVED', conversationId: CONVERSATION_ID },
    { id: REUSED_DRAFT, status: 'DRAFT', conversationId: OTHER_CONVERSATION_ID },
  ];

  it('deletes a draft this conversation proposed', async () => {
    const session = visualPreviewSession(fakePlatformApi(proposals));

    const deleted = await session.handle(call('delete_proposal', OWN_DRAFT));
    const lookup = await session.handle(call('get_proposal', OWN_DRAFT));

    expect(deleted.body).toMatchObject({ result: { structuredContent: { deleted: true } } });
    expect(lookup.body).toMatchObject({ result: { isError: true } });
  });

  it.each([
    ['a reused draft from another conversation', REUSED_DRAFT, OTHER_CONVERSATION_ID],
    ['an approved visual', OWN_APPROVED, CONVERSATION_ID],
  ])('refuses to delete %s and leaves it in its conversation', async (_case, id, owner) => {
    const session = visualPreviewSession(fakePlatformApi(proposals));

    const refused = await session.handle(call('delete_proposal', id));
    const lookup = await session.handle(call('get_proposal', id));

    expect(refused.body).toMatchObject({ result: { isError: true } });
    expect(lookup.body).toMatchObject({
      result: { structuredContent: { id, conversationId: owner } },
    });
  });
});
