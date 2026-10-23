import { describe, expect, it, vi } from 'vitest';
import { ActivePlatformToolCatalog } from './catalog';
import { PlatformMcpForwarder } from './forwarder';
import { PlatformMcpProxySession, type JsonRpcRequest } from './session';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import type { ServerLogger } from '../../server/logger';

const makeLogger = (): { logger: ServerLogger; warn: ReturnType<typeof vi.fn> } => {
  const warn = vi.fn();
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as ServerLogger;
  return { logger, warn };
};

const makeForwarder = (forward: PlatformMcpForwarder['forward']): PlatformMcpForwarder => {
  const forwarder = new PlatformMcpForwarder({
    oauthClient: createTestOAuthClient(),
    logger: makeLogger().logger,
    fetchImpl: vi.fn<typeof fetch>(),
    endpointUrl: 'https://api.test/mcp',
  });
  vi.spyOn(forwarder, 'forward').mockImplementation(forward);
  return forwarder;
};

const makeSession = (forward: PlatformMcpForwarder['forward'], logger?: ServerLogger) =>
  new PlatformMcpProxySession(
    {
      runId: 'run-1',
      turnId: 'turn-1',
      context: { projectId: 'project-1' },
      catalog: new ActivePlatformToolCatalog({
        useCase: 'general',
        additionalTools: ['create_design_doc'],
      }),
      activeHandlerPromptType: 'entity_conversation',
      active: true,
      ...(logger ? { logger } : {}),
    },
    makeForwarder(forward),
  );

const finalizeRequest = (id: number): JsonRpcRequest => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name: 'finalize_proposal_group',
    arguments: { groupContext: { groupId: 'group-1', expectedRevision: 3 } },
  },
});

const snapshotResult = (members: Array<{ memberId: string; prerequisiteMemberIds: string[] }>) => ({
  content: [{ type: 'text', text: 'snapshot' }],
  structuredContent: { members },
});

describe('PlatformMcpProxySession', () => {
  it('negotiates a supported client protocol version', async () => {
    const proxy = makeSession(vi.fn<PlatformMcpForwarder['forward']>());

    const result = await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    });

    expect(result.body).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
  });

  it('does not send a JSON-RPC response to the initialized notification', async () => {
    const proxy = makeSession(vi.fn<PlatformMcpForwarder['forward']>());

    const result = await proxy.handle({
      jsonrpc: '2.0',
      id: null,
      method: 'notifications/initialized',
    });

    expect(result).toEqual({ statusCode: 202 });
  });

  it('offers its latest supported protocol version when the requested version is unsupported', async () => {
    const proxy = makeSession(vi.fn<PlatformMcpForwarder['forward']>());

    const result = await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01', capabilities: {} },
    });

    expect(result.body).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
  });

  it('rejects initialize without the required protocol version', async () => {
    const proxy = makeSession(vi.fn<PlatformMcpForwarder['forward']>());

    const result = await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { capabilities: {} },
    });

    expect(result.body).toMatchObject({ error: { code: -32602 } });
  });

  it('filters tools/list to the active catalog', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          { name: 'get_context', inputSchema: { type: 'object' } },
          { name: 'create_work_item', inputSchema: { type: 'object' } },
          { name: 'not_active', inputSchema: { type: 'object' } },
        ],
      },
    });
    const proxy = makeSession(forward);

    const result = await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(result.body).toMatchObject({
      result: {
        tools: [{ name: 'get_context' }, { name: 'create_work_item' }],
      },
    });
  });

  it('normalizes tools/list to canonical MCP fields', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'get_context',
            title: 'Context',
            description: 'Read context',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
            _meta: { platform: 'heyhey' },
            icons: [{ src: 'https://example.test/context.png' }],
            execution: { taskSupport: 'forbidden' },
            unsupportedExtension: 'not part of the MCP tool contract',
          },
        ],
        nextCursor: null,
        unsupportedResultExtension: true,
      },
    });
    const proxy = makeSession(forward);

    const result = await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(result.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'get_context',
            description: 'Read context',
            inputSchema: { type: 'object' },
          },
        ],
      },
    });
  });

  it('preserves tool fields supported by the negotiated protocol version', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'get_context',
            title: 'Context',
            description: 'Read context',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
            _meta: { platform: 'heyhey' },
            icons: [{ src: 'https://example.test/context.png' }],
            execution: { taskSupport: 'forbidden' },
          },
        ],
        _meta: { requestId: 'request-1' },
      },
    });
    const proxy = makeSession(forward);
    await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });

    const result = await proxy.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(result.body).toMatchObject({
      result: {
        tools: [
          {
            name: 'get_context',
            title: 'Context',
            outputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
            _meta: { platform: 'heyhey' },
            icons: [{ src: 'https://example.test/context.png' }],
            execution: { taskSupport: 'forbidden' },
          },
        ],
        _meta: { requestId: 'request-1' },
      },
    });
  });

  it('preserves the upstream semantic-guidance description and generated schemas', async () => {
    const semanticGuidanceTool = {
      name: 'get_work_item_type_guidance_batch',
      description: 'Read purpose-specific guidance for 1–10 distinct work-item types.',
      inputSchema: {
        type: 'object',
        properties: {
          typeKeys: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
          },
          purpose: { enum: ['semantic', 'maintenance'] },
          focalTypeKey: { type: 'string' },
        },
        required: ['typeKeys'],
      },
      outputSchema: {
        type: 'object',
        properties: { results: { type: 'array', items: { type: 'object' } } },
        required: ['results'],
      },
    };
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [semanticGuidanceTool] },
    });
    const proxy = makeSession(forward);
    await proxy.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {} },
    });

    const result = await proxy.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(result.body).toMatchObject({ result: { tools: [semanticGuidanceTool] } });
  });

  it('omits malformed active tools from tools/list and logs their count', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{ name: 'get_context', inputSchema: null }],
      },
    });
    const { logger, warn } = makeLogger();
    const proxy = makeSession(forward, logger);

    await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.tools_list.empty_filtered_surface',
      expect.objectContaining({
        invalidActiveToolCount: 1,
        invalidActiveTools: ['get_context'],
      }),
    );
  });

  it('logs when upstream discovery exposes none of the active tools', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{ name: 'not_active', inputSchema: { type: 'object' } }],
      },
    });
    const { logger, warn } = makeLogger();
    const proxy = makeSession(forward, logger);

    await proxy.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(warn).toHaveBeenCalledWith(
      'local.platform_mcp_proxy.tools_list.empty_filtered_surface',
      expect.objectContaining({
        runId: 'run-1',
        turnId: 'turn-1',
        promptType: 'entity_conversation',
        upstreamToolCount: 1,
        filteredToolCount: 0,
        activeCatalogToolCount: expect.any(Number),
        missingActiveTools: expect.arrayContaining(['get_context']),
      }),
    );
  });

  it('rejects non-active tools without forwarding the call', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>();
    const proxy = makeSession(forward);
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'not_active', arguments: {} },
    };

    const result = await proxy.handle(request);

    expect(forward).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      result: {
        isError: true,
      },
    });
    expect(JSON.stringify(result.body)).toContain('tool-surface mismatch');
  });

  it('forwards active tool calls with MCP-local short names', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'ok' }] },
    });
    const proxy = makeSession(forward);

    await proxy.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'mcp__heyhey-platform__get_context', arguments: {} },
    });

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { name: 'get_context', arguments: {} },
      }),
      { projectId: 'project-1' },
    );
  });

  it('forwards delete_proposal through the active general catalog', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue({
      jsonrpc: '2.0',
      id: 4,
      result: { content: [{ type: 'text', text: '{"deleted":true}' }] },
    });
    const proxy = makeSession(forward);

    await proxy.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'mcp__heyhey-platform__delete_proposal',
        arguments: { proposalId: '11111111-1111-4111-8111-111111111111' },
      },
    });

    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          name: 'delete_proposal',
          arguments: { proposalId: '11111111-1111-4111-8111-111111111111' },
        },
      }),
      { projectId: 'project-1' },
    );
  });

  it('forwards authoring proof arguments unchanged and preserves the structured result', async () => {
    const response = {
      jsonrpc: '2.0' as const,
      id: 10,
      result: {
        content: [{ type: 'text', text: 'guidance' }],
        structuredContent: {
          guidance: 'topology rules',
          authoringRootProof: 'heyhey-authoring-root-v1',
          guidanceToken: 'gtg-standard-project',
        },
      },
    };
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue(response);
    const proxy = makeSession(forward);
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'mcp__heyhey-platform__get_tool_guidance',
        arguments: {
          toolName: 'create_work_item',
          workItemType: 'STANDARD',
          authoringRootProof: 'heyhey-authoring-root-v1',
          guidanceToken: 'gtg-standard-project',
        },
      },
    };

    await expect(proxy.handle(request)).resolves.toEqual({
      statusCode: 200,
      body: response,
    });
    expect(forward).toHaveBeenCalledWith(
      {
        ...request,
        params: {
          ...request.params,
          name: 'get_tool_guidance',
        },
      },
      { projectId: 'project-1' },
    );
  });

  it.each([
    { typeKeys: ['STANDARD'], purpose: 'semantic', focalTypeKey: 'FEATURE' },
    { typeKeys: ['STANDARD', 'BUG'], purpose: 'maintenance' },
  ])(
    'forwards batch guidance arguments unchanged and preserves ordered results: %j',
    async (arguments_) => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 11,
        result: {
          content: [{ type: 'text', text: 'contextual guidance' }],
          structuredContent: {
            results: arguments_.typeKeys.map((typeKey) =>
              arguments_.purpose === 'maintenance'
                ? { typeKey, name: typeKey }
                : { typeKey, name: typeKey, overview: 'Implementation work', examples: [] },
            ),
          },
        },
      };
      const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValue(response);
      const proxy = makeSession(forward);
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'mcp__heyhey-platform__get_work_item_type_guidance_batch',
          arguments: arguments_,
        },
      };

      await expect(proxy.handle(request)).resolves.toEqual({ statusCode: 200, body: response });
      expect(forward).toHaveBeenCalledWith(
        {
          ...request,
          params: { ...request.params, name: 'get_work_item_type_guidance_batch' },
        },
        { projectId: 'project-1' },
      );
    },
  );

  it('rejects finalization when the authoring snapshot has fewer than two members', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValueOnce({
      jsonrpc: '2.0',
      id: 4,
      result: snapshotResult([{ memberId: 'member-1', prerequisiteMemberIds: [] }]),
    });
    const proxy = makeSession(forward);

    const result = await proxy.handle(finalizeRequest(4));

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_proposal_group_authoring_snapshot',
          arguments: { groupId: 'group-1' },
        },
      },
      { projectId: 'project-1' },
    );
    expect(result.body).toMatchObject({
      result: {
        isError: true,
      },
    });
    expect(JSON.stringify(result.body)).toContain('at least two members');
  });

  it('rejects finalization when no member has a group-local prerequisite', async () => {
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValueOnce({
      jsonrpc: '2.0',
      id: 5,
      result: snapshotResult([
        { memberId: 'member-1', prerequisiteMemberIds: [] },
        { memberId: 'member-2', prerequisiteMemberIds: ['outside-group'] },
      ]),
    });
    const proxy = makeSession(forward);

    const result = await proxy.handle(finalizeRequest(5));

    expect(forward).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({
      result: {
        isError: true,
      },
    });
    expect(JSON.stringify(result.body)).toContain(
      'group-local proposal-level enactment prerequisite',
    );
  });

  it('forwards eligible finalization unchanged after inspecting the snapshot', async () => {
    const finalizationResponse = {
      jsonrpc: '2.0' as const,
      id: 6,
      result: { content: [{ type: 'text', text: 'finalized' }] },
    };
    const forward = vi
      .fn<PlatformMcpForwarder['forward']>()
      .mockResolvedValueOnce({
        jsonrpc: '2.0',
        id: 6,
        result: snapshotResult([
          { memberId: 'member-1', prerequisiteMemberIds: [] },
          { memberId: 'member-2', prerequisiteMemberIds: ['member-1'] },
        ]),
      })
      .mockResolvedValueOnce(finalizationResponse);
    const proxy = makeSession(forward);
    const request = finalizeRequest(6);

    const result = await proxy.handle(request);

    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenNthCalledWith(2, request, { projectId: 'project-1' });
    expect(result).toEqual({ statusCode: 200, body: finalizationResponse });
  });

  it('propagates a snapshot JSON-RPC error without forwarding finalization', async () => {
    const snapshotError = {
      jsonrpc: '2.0' as const,
      id: 7,
      error: { code: -32000, message: 'snapshot failed' },
    };
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValueOnce(snapshotError);
    const proxy = makeSession(forward);

    const result = await proxy.handle(finalizeRequest(7));

    expect(forward).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ statusCode: 200, body: snapshotError });
  });

  it('propagates a snapshot MCP error without forwarding finalization', async () => {
    const snapshotError = {
      jsonrpc: '2.0' as const,
      id: 8,
      result: {
        content: [{ type: 'text', text: 'snapshot unavailable' }],
        isError: true,
      },
    };
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockResolvedValueOnce(snapshotError);
    const proxy = makeSession(forward);

    const result = await proxy.handle(finalizeRequest(8));

    expect(forward).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ statusCode: 200, body: snapshotError });
  });

  it('propagates a snapshot transport failure without forwarding finalization', async () => {
    const transportError = new Error('snapshot transport failed');
    const forward = vi.fn<PlatformMcpForwarder['forward']>().mockRejectedValueOnce(transportError);
    const proxy = makeSession(forward);

    await expect(proxy.handle(finalizeRequest(9))).rejects.toBe(transportError);
    expect(forward).toHaveBeenCalledTimes(1);
  });
});
