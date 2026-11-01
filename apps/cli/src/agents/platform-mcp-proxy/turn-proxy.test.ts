import { describe, expect, it, vi } from 'vitest';

import { ActivePlatformToolCatalog } from './catalog';
import { PlatformMcpForwarder } from './forwarder';
import { TurnPlatformMcpProxy } from './turn-proxy';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import { NOOP_LOGGER } from '../../server/logger';

const makeForwarder = (forward: PlatformMcpForwarder['forward']): PlatformMcpForwarder => {
  const forwarder = new PlatformMcpForwarder({
    oauthClient: createTestOAuthClient(),
    logger: NOOP_LOGGER,
    fetchImpl: vi.fn<typeof fetch>(),
    endpointUrl: 'https://api.test/mcp',
  });
  vi.spyOn(forwarder, 'forward').mockImplementation(forward);
  return forwarder;
};

describe('TurnPlatformMcpProxy', () => {
  it('exposes a provider mount derived from the turn-owned proxy', () => {
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['get_context'] }),
      activeHandlerPromptType: 'entity_conversation',
    });

    expect(proxy.mount).toMatchObject({
      runId: 'run-1',
      turnId: 'turn-1',
      token: proxy.token,
      allowedTools: expect.arrayContaining(['mcp__heyhey-platform__get_context']),
    });
    expect(proxy.matches({ turnId: 'turn-1', token: proxy.token })).toBe(true);
  });

  it('rejects calls after the owning turn closes it', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>();
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['get_context'] }),
      activeHandlerPromptType: 'entity_conversation',
    });

    proxy.close();
    const result = await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_context', arguments: {} },
      },
      makeForwarder(forward),
    );

    expect(forward).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ result: { isError: true } });
  });

  it('retains protocol negotiation across turn-scoped HTTP requests', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'get_context',
            title: 'Context',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
          },
        ],
      },
    });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['get_context'] }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const forwarder = makeForwarder(forward);

    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      },
      forwarder,
    );
    const result = await proxy.handleJsonRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      forwarder,
    );

    expect(result.body).toMatchObject({
      result: { tools: [{ title: 'Context', outputSchema: { type: 'object' } }] },
    });
  });

  it('observes canonical identities from successful Proposal-authoring calls', async () => {
    const proposalId = '11111111-1111-4111-8111-111111111111';
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ proposalId }) }],
      },
    });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['create_work_item'] }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const observer = vi.fn();
    proxy.setProposalIdentityObserver(observer);

    const response = await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_work_item', arguments: {} },
      },
      makeForwarder(forward),
    );

    expect(observer).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledWith(proposalId);
    expect(response.body).toMatchObject({ result: { content: [{ type: 'text' }] } });
  });

  it('observes an existing grouped update and removes it if its member is removed', async () => {
    const proposalId = '11111111-1111-4111-8111-111111111111';
    const memberId = '22222222-2222-4222-8222-222222222222';
    const result = { id: proposalId, status: 'DRAFT', groupedAuthoring: { member: { memberId } } };
    const forward = vi
      .fn<PlatformMcpForwarder['forward']>()
      .mockResolvedValueOnce({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } })
      .mockResolvedValueOnce({ jsonrpc: '2.0', id: 2, result: { structuredContent: {} } });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({
        additionalTools: ['update_proposal', 'remove_proposal_group_member'],
      }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const added = vi.fn();
    const removed = vi.fn();
    proxy.setProposalIdentityObserver(added);
    proxy.setProposalRemovalObserver(removed);
    const forwarder = makeForwarder(forward);
    const response = await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'update_proposal', arguments: {} },
      },
      forwarder,
    );
    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'remove_proposal_group_member', arguments: { memberId } },
      },
      forwarder,
    );
    expect(response.body).toEqual({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } });
    expect(added).toHaveBeenCalledWith(proposalId);
    expect(removed).toHaveBeenCalledWith(proposalId);
  });

  it('observes every proposal from a reorder_stages batch response in creation order', async () => {
    const proposalIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ proposalIds }) }],
        structuredContent: { proposalIds },
      },
    });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['reorder_stages'] }),
      activeHandlerPromptType: 'plan_shaping_proposed_stages',
    });
    const observer = vi.fn();
    proxy.setProposalIdentityObserver(observer);

    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'reorder_stages', arguments: {} },
      },
      makeForwarder(forward),
    );

    expect(observer.mock.calls).toEqual(proposalIds.map((proposalId) => [proposalId]));
  });

  it('observes the proposal from a propose_future_revision response and returns it unchanged', async () => {
    const proposalId = '11111111-1111-4111-8111-111111111111';
    const futureId = '33333333-3333-4333-8333-333333333333';
    const output = {
      status: 'proposed',
      proposalId,
      futureId,
      operation: 'REVISE',
      targetEntityType: 'TASK',
      targetEntityId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-10-22T08:00:00.000Z',
    };
    const forwarded = {
      jsonrpc: '2.0' as const,
      id: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      },
    };
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue(forwarded);
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({ additionalTools: ['propose_future_revision'] }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const observer = vi.fn();
    proxy.setProposalIdentityObserver(observer);

    const response = await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'propose_future_revision', arguments: {} },
      },
      makeForwarder(forward),
    );

    expect(observer.mock.calls).toEqual([[proposalId]]);
    expect(response.body).toEqual(forwarded);
  });

  it('observes successful removal of a grouped Proposal created on the Turn', async () => {
    const proposalId = '11111111-1111-4111-8111-111111111111';
    const memberId = '22222222-2222-4222-8222-222222222222';
    const forward = vi
      .fn<PlatformMcpForwarder['forward']>()
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 1,
        result: {
          structuredContent: {
            proposalId,
            groupedAuthoring: { member: { memberId } },
          },
        },
      })
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 2,
        result: { structuredContent: { lifecycle: 'BUILDING', members: [] } },
      });
    const proxy = new TurnPlatformMcpProxy({
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({
        additionalTools: ['create_work_item', 'remove_proposal_group_member'],
      }),
      activeHandlerPromptType: 'entity_conversation',
    });
    const createdObserver = vi.fn();
    const removedObserver = vi.fn();
    proxy.setProposalIdentityObserver(createdObserver);
    proxy.setProposalRemovalObserver(removedObserver);
    const forwarder = makeForwarder(forward);

    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_work_item', arguments: {} },
      },
      forwarder,
    );
    await proxy.handleJsonRpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'remove_proposal_group_member', arguments: { memberId } },
      },
      forwarder,
    );

    expect(createdObserver).toHaveBeenCalledWith(proposalId);
    expect(removedObserver).toHaveBeenCalledWith(proposalId);
  });
});
