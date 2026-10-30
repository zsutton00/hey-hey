import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildMcpEndpointUrl,
  buildMcpServerConfig,
  CODING_MCP_TOOLS,
  GENERAL_MCP_TOOLS,
  HINT_READ_MCP_TOOLS,
  HINT_WRITE_MCP_TOOLS,
  PLANNING_MCP_TOOLS,
  PLAN_SHAPING_MCP_TOOLS,
  PROPOSAL_GROUP_MCP_TOOLS,
  PROJECT_ASSISTANT_EDGE_MCP_TOOLS,
  PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
  PROJECT_REPORT_MCP_TOOLS,
  PROJECT_REPORT_SECTION_MCP_TOOLS,
  RESEARCH_MCP_TOOLS,
  REPOSITORY_PLACEMENT_MCP_TOOLS,
  SESSION_MONITOR_MCP_TOOLS,
  TASK_MONITOR_MCP_TOOLS,
  resolveMcpEndpointUrl,
  resolveMcpToolNames,
  type McpSessionContext,
} from './mcp-server-config';
import { featureSyncAnalyzeHandler } from './feature-sync/analyze.handler';
import { featureSyncIterateHandler } from './feature-sync/iterate.handler';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../auth/oauth-client.test-support';

const createMockOAuthClient = (
  result: { success: true; data: string } | { success: false; error: string },
) => createProviderTestOAuthClient(result);

// Minimal JWT with organizationId claim for testing.
// Payload: { "sub": "user-1", "organizationId": "org-123" }
const HINT_TOOLS = [...HINT_WRITE_MCP_TOOLS, ...HINT_READ_MCP_TOOLS];

const TEST_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' +
  btoa(JSON.stringify({ sub: 'user-1', organizationId: 'org-123' })) +
  '.fake-signature';

// Token without organizationId claim.
const TOKEN_NO_ORG =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' +
  btoa(JSON.stringify({ sub: 'user-2' })) +
  '.fake-signature';

describe('buildMcpEndpointUrl', () => {
  it('appends /mcp to the bare host', () => {
    expect(buildMcpEndpointUrl('http://localhost:3000')).toBe('http://localhost:3000/mcp');
  });

  it('strips a trailing slash before appending /mcp', () => {
    expect(buildMcpEndpointUrl('https://heyhey.dev/')).toBe('https://heyhey.dev/mcp');
  });

  it('does NOT inject the REST /api/v1 prefix (MCP lives at the root)', () => {
    expect(buildMcpEndpointUrl('https://heyhey.dev')).not.toContain('/api/v1');
  });
});

describe('resolveMcpEndpointUrl', () => {
  const original = process.env['HEYHEY_API_URL'];
  afterEach(() => {
    if (original === undefined) delete process.env['HEYHEY_API_URL'];
    else process.env['HEYHEY_API_URL'] = original;
  });

  it('builds the endpoint from HEYHEY_API_URL (e.g. --local sets localhost)', () => {
    process.env['HEYHEY_API_URL'] = 'http://localhost:3000';
    expect(resolveMcpEndpointUrl()).toBe('http://localhost:3000/mcp');
  });

  it('falls back to the production host when HEYHEY_API_URL is unset', () => {
    delete process.env['HEYHEY_API_URL'];
    expect(resolveMcpEndpointUrl()).toBe('https://heyhey.dev/mcp');
  });
});

describe('buildMcpServerConfig', () => {
  const originalEnv = process.env['HEYHEY_API_URL'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['HEYHEY_API_URL'] = originalEnv;
    } else {
      delete process.env['HEYHEY_API_URL'];
    }
  });

  it('gives project_report the report schema plus read-only graph tools and no authoring', () => {
    const expected = [
      'get_report_schema',
      'get_full_entity',
      'get_context',
      'get_edges',
      'unified_search',
      'task_search',
      'search_features',
      'list_reports_by_entity',
      'get_report_body',
    ];
    expect(PROJECT_REPORT_MCP_TOOLS).toEqual(expected);
    expect(resolveMcpToolNames({ useCase: 'project_report' })).toEqual(expected);
    expect(
      PROJECT_REPORT_MCP_TOOLS.filter((tool) => /^(create|edit|delete|update)_/u.test(tool)),
    ).toEqual([]);
  });

  it('gives report section children the report graph reads without the report schema', () => {
    expect(PROJECT_REPORT_SECTION_MCP_TOOLS).toEqual(
      PROJECT_REPORT_MCP_TOOLS.filter((tool) => tool !== 'get_report_schema'),
    );
  });

  it('returns mcpServers with auth and context headers', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      projectId: 'proj-456',
      conversationId: 'conv-789',
    };

    const result = await buildMcpServerConfig(client, context);

    expect(result.mcpServers).toEqual({
      'heyhey-platform': {
        type: 'http',
        url: 'https://heyhey.dev/mcp',
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          'X-Organization-ID': 'org-123',
          'X-Project-ID': 'proj-456',
          'X-Conversation-ID': 'conv-789',
        },
      },
    });
  });

  it('never emits an X-Message-ID header (proposals anchor to a server-minted carrier)', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      projectId: 'proj-456',
      conversationId: 'conv-789',
      serviceId: 'svc-001',
      agentSessionId: '00000000-0000-4000-8000-000000000030',
    };

    const result = await buildMcpServerConfig(client, context);

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, unknown>;
    expect(headers).not.toHaveProperty('X-Message-ID');
  });

  it('returns allowedTools with mcp__ prefixed tool names only', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(client, {});

    expect(result.allowedTools).toEqual(
      [...CODING_MCP_TOOLS, ...HINT_TOOLS].map((tool) => `mcp__heyhey-platform__${tool}`),
    );
    expect(result.allowedTools).toContain('mcp__heyhey-platform__get_feature_sync_context');
    // AskUserQuestion is banned across all agents; it must not appear in the allowlist.
    expect(result.allowedTools).not.toContain('AskUserQuestion');
  });

  it('limits repository placement to bounded read-only Feature discovery', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(
      client,
      {},
      {
        useCase: 'repository_placement',
      },
    );

    expect(REPOSITORY_PLACEMENT_MCP_TOOLS).toEqual(['unified_search', 'get_context']);
    expect(result.allowedTools).toEqual([
      'mcp__heyhey-platform__unified_search',
      'mcp__heyhey-platform__get_context',
    ]);
  });

  it('omits X-Organization-ID when token has no org claim', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TOKEN_NO_ORG });

    const result = await buildMcpServerConfig(client, {});

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN_NO_ORG}`);
    expect(headers).not.toHaveProperty('X-Organization-ID');
  });

  it('omits optional context headers when not provided', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(client, {});

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers).not.toHaveProperty('X-Project-ID');
    expect(headers).not.toHaveProperty('X-Conversation-ID');
    expect(headers).not.toHaveProperty('X-Plan-ID');
    expect(headers).not.toHaveProperty('X-Design-Doc-ID');
    expect(headers).not.toHaveProperty('X-Service-ID');
    expect(headers).not.toHaveProperty('X-Service-IDs');
    expect(headers).not.toHaveProperty('X-Agent-Session-ID');
  });

  it('includes planId and designDocId headers when provided', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      projectId: 'proj-456',
      planId: 'plan-001',
      designDocId: 'dd-002',
    };

    const result = await buildMcpServerConfig(client, context);

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['X-Plan-ID']).toBe('plan-001');
    expect(headers['X-Design-Doc-ID']).toBe('dd-002');
  });

  it('includes X-Service-ID header when serviceId is provided', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      projectId: 'proj-456',
      serviceId: 'svc-001',
    };

    const result = await buildMcpServerConfig(client, context);

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['X-Service-ID']).toBe('svc-001');
  });

  it('includes the complete authorized Service scope without replacing the launch anchor', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      projectId: 'proj-456',
      serviceId: 'svc-001',
      serviceIds: ['svc-001', 'svc-002'],
    };

    const result = await buildMcpServerConfig(client, context);

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['X-Service-ID']).toBe('svc-001');
    expect(headers['X-Service-IDs']).toBe('svc-001,svc-002');
  });

  it('includes X-Agent-Session-ID header when agentSessionId is provided', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
    const context: McpSessionContext = {
      agentSessionId: '00000000-0000-4000-8000-000000000030',
    };

    const result = await buildMcpServerConfig(client, context);

    const headers = (result.mcpServers['heyhey-platform'] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(headers['X-Agent-Session-ID']).toBe('00000000-0000-4000-8000-000000000030');
  });

  it('throws when getAccessToken fails', async () => {
    const client = createMockOAuthClient({ success: false, error: 'Session expired' });

    await expect(buildMcpServerConfig(client, {})).rejects.toThrow(
      'Cannot configure MCP server: Session expired',
    );
  });

  it('strips trailing slash from API URL', async () => {
    process.env['HEYHEY_API_URL'] = 'https://heyhey.dev/';
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(client, {});

    const server = result.mcpServers['heyhey-platform'] as Record<string, unknown>;
    expect(server['url']).toBe('https://heyhey.dev/mcp');
  });

  it('uses default URL when HEYHEY_API_URL is not set', async () => {
    delete process.env['HEYHEY_API_URL'];
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(client, {});

    const server = result.mcpServers['heyhey-platform'] as Record<string, unknown>;
    expect(server['url']).toBe('https://heyhey.dev/mcp');
  });

  it('appends handler-contributed additionalTools to allowedTools with the mcp__heyhey-platform__ prefix', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(
      client,
      {},
      {
        additionalTools: ['create_stage', 'move_step'],
      },
    );

    expect(result.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__heyhey-platform__create_stage',
        'mcp__heyhey-platform__move_step',
      ]),
    );
    // Every entry is an MCP tool prefixed exactly once; no bare names leak through.
    for (const tool of result.allowedTools) {
      expect(tool.startsWith('mcp__heyhey-platform__')).toBe(true);
      expect(tool.startsWith('mcp__heyhey-platform__mcp__')).toBe(false);
    }
  });

  it('adds authoring guidance when a plan-shaping handler contributes topology mutations', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(
      client,
      {},
      {
        useCase: 'plan_shaping',
        additionalTools: ['create_stage', 'create_steps'],
      },
    );

    expect(result.allowedTools).toContain('mcp__heyhey-platform__get_authoring_guidance');
  });

  it('deduplicates when additionalTools overlap with the base list', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(
      client,
      {},
      {
        additionalTools: ['get_context', 'create_stage'],
      },
    );

    const occurrences = result.allowedTools.filter(
      (tool) => tool === 'mcp__heyhey-platform__get_context',
    ).length;
    expect(occurrences).toBe(1);
    expect(result.allowedTools).toContain('mcp__heyhey-platform__create_stage');
  });

  describe('proposal-group authoring lifecycle', () => {
    it('exposes the complete lifecycle to coding and general sessions', () => {
      for (const tool of PROPOSAL_GROUP_MCP_TOOLS) {
        expect(CODING_MCP_TOOLS).toContain(tool);
        expect(GENERAL_MCP_TOOLS).toContain(tool);
      }
    });

    it('does not widen planning, plan-shaping, research, or monitor catalogs', () => {
      for (const tool of PROPOSAL_GROUP_MCP_TOOLS) {
        expect(PLANNING_MCP_TOOLS).not.toContain(tool);
        expect(PLAN_SHAPING_MCP_TOOLS).not.toContain(tool);
        expect(RESEARCH_MCP_TOOLS).not.toContain(tool);
        expect(SESSION_MONITOR_MCP_TOOLS).not.toContain(tool);
        expect(TASK_MONITOR_MCP_TOOLS).not.toContain(tool);
      }
    });
  });

  describe('design-doc proposal tools', () => {
    const DESIGN_DOC_PROPOSAL_TOOLS = ['create_design_doc', 'edit_design_doc'] as const;

    it('exposes both tools to coding and general sessions', () => {
      for (const tool of DESIGN_DOC_PROPOSAL_TOOLS) {
        expect(CODING_MCP_TOOLS).toContain(tool);
        expect(GENERAL_MCP_TOOLS).toContain(tool);
      }
    });

    it('gives Feature Sync analyze and iterate the design-doc tools without plan creation', () => {
      for (const handler of [featureSyncAnalyzeHandler, featureSyncIterateHandler]) {
        const tools =
          handler.mcpToolUseCase === undefined
            ? resolveMcpToolNames()
            : resolveMcpToolNames({ useCase: handler.mcpToolUseCase });

        for (const tool of DESIGN_DOC_PROPOSAL_TOOLS) {
          expect(tools).toContain(tool);
        }
        expect(tools).not.toContain('create_plan');
      }
    });

    it('keeps both tools out of the planning tool set', () => {
      for (const tool of DESIGN_DOC_PROPOSAL_TOOLS) {
        expect(PLANNING_MCP_TOOLS).not.toContain(tool);
      }
    });
  });

  describe('proposal record deletion', () => {
    it('exposes delete_proposal to coding and general sessions only', async () => {
      expect(CODING_MCP_TOOLS).toContain('delete_proposal');
      expect(GENERAL_MCP_TOOLS).toContain('delete_proposal');
      expect(PLANNING_MCP_TOOLS).not.toContain('delete_proposal');
      expect(PLAN_SHAPING_MCP_TOOLS).not.toContain('delete_proposal');
      expect(RESEARCH_MCP_TOOLS).not.toContain('delete_proposal');
      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('delete_proposal');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('delete_proposal');

      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
      const result = await buildMcpServerConfig(client, {}, { useCase: 'general' });

      expect(result.allowedTools).toContain('mcp__heyhey-platform__delete_proposal');
    });
  });

  describe('shared topology authoring guidance', () => {
    it('exposes the generic guidance read to coding and general sessions', () => {
      expect(CODING_MCP_TOOLS).toContain('get_authoring_guidance');
      expect(GENERAL_MCP_TOOLS).toContain('get_authoring_guidance');
    });

    it('keeps the generic guidance read out of non-authoring surfaces', () => {
      expect(PLANNING_MCP_TOOLS).not.toContain('get_authoring_guidance');
      expect(PLAN_SHAPING_MCP_TOOLS).toContain('get_authoring_guidance');
      expect(RESEARCH_MCP_TOOLS).not.toContain('get_authoring_guidance');
      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('get_authoring_guidance');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('get_authoring_guidance');
    });
  });

  describe('planning use case', () => {
    const PROPOSAL_AND_EDGE_MUTATIONS = [
      'create_work_item',
      'edit_work_item',
      'update_proposal',
      'create_edge',
      'update_edge',
      'delete_edge',
    ] as const;

    it('strips every proposal-mutating and edge tool from the base list', () => {
      for (const tool of PROPOSAL_AND_EDGE_MUTATIONS) {
        expect(CODING_MCP_TOOLS).toContain(tool);
        expect(PLANNING_MCP_TOOLS).not.toContain(tool);
      }
    });

    it('keeps read, search, and report tools', () => {
      for (const tool of [
        'get_context',
        'get_full_entity',
        'get_diagram',
        'get_proposal',
        'get_report_body',
        'get_report_schema',
        'unified_search',
        'search_implementation_hints',
        'list_features',
      ]) {
        expect(PLANNING_MCP_TOOLS).toContain(tool);
      }
    });

    it('keeps implementation-hint tools so the planner can record what it learns', () => {
      for (const tool of [
        'create_implementation_hint',
        'edit_implementation_hint',
        'delete_implementation_hint',
      ]) {
        expect(PLANNING_MCP_TOOLS).toContain(tool);
      }
    });

    it('resolves the planning allowlist with read/report tools and without any mutation tool', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'planning' });

      expect(result.allowedTools).toEqual(
        [...PLANNING_MCP_TOOLS, ...HINT_TOOLS].map((tool) => `mcp__heyhey-platform__${tool}`),
      );
      expect(result.allowedTools).toContain('mcp__heyhey-platform__get_report_schema');
      expect(result.allowedTools).not.toContain('mcp__heyhey-platform__create_report');
      for (const tool of PROPOSAL_AND_EDGE_MUTATIONS) {
        expect(result.allowedTools).not.toContain(`mcp__heyhey-platform__${tool}`);
      }
    });
  });

  describe('plan_shaping use case', () => {
    it('adds edit_plan only when a handler explicitly grants it', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const base = await buildMcpServerConfig(client, {}, { useCase: 'plan_shaping' });
      const scoped = await buildMcpServerConfig(
        client,
        {},
        {
          useCase: 'plan_shaping',
          additionalTools: ['edit_plan'],
        },
      );

      expect(base.allowedTools).not.toContain('mcp__heyhey-platform__edit_plan');
      expect(scoped.allowedTools).toContain('mcp__heyhey-platform__edit_plan');
      expect(CODING_MCP_TOOLS).not.toContain('edit_plan');
      expect(GENERAL_MCP_TOOLS).not.toContain('edit_plan');
      expect(PLANNING_MCP_TOOLS).not.toContain('edit_plan');
      expect(RESEARCH_MCP_TOOLS).not.toContain('edit_plan');
    });

    it('resolves to exactly the read-only plan-shaping base', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'plan_shaping' });

      expect(result.allowedTools).toEqual(
        PLAN_SHAPING_MCP_TOOLS.map((tool) => `mcp__heyhey-platform__${tool}`),
      );
    });

    it('excludes the platform create_report and the coding mutation toolkit', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'plan_shaping' });

      // The platform create_report must NOT be in the base — that collision is
      // what left phase-breakdown's report chain empty and made the submission
      // gate reject every submission. Phase-breakdown adds nothing, so its
      // surface is exactly this base: the chain-appending wrapper is then the
      // only create_report it can reach.
      expect(result.allowedTools).not.toContain('mcp__heyhey-platform__create_report');
      for (const tool of ['create_work_item', 'create_step', 'edit_work_item', 'create_edge']) {
        expect(result.allowedTools).not.toContain(`mcp__heyhey-platform__${tool}`);
      }
    });
  });

  describe('research use case', () => {
    it('resolves to exactly the read-only platform tools plus the hint tools, qualified', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'research' });

      expect(result.allowedTools).toEqual(
        [
          'get_context',
          'get_edges',
          'get_full_entity',
          'get_diagram',
          'get_work_item_type_guidance_batch',
          'unified_search',
          'search_features',
          'task_search',
          'search_design_docs',
          'search_implementation_hints',
          ...HINT_TOOLS,
        ].map((tool) => `mcp__heyhey-platform__${tool}`),
      );
      expect(RESEARCH_MCP_TOOLS).toHaveLength(10);
    });

    it('contains no mutation, edge, proposal, report, or creation tool names', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'research' });

      const forbidden = [
        'create_work_item',
        'edit_work_item',
        'create_step',
        'update_step',
        'create_plan',
        'create_edge',
        'update_edge',
        'delete_edge',
        'update_proposal',
        'get_proposal',
        'create_report',
        'create_implementation_hint',
        'edit_implementation_hint',
        'delete_implementation_hint',
      ];
      for (const tool of forbidden) {
        expect(result.allowedTools).not.toContain(`mcp__heyhey-platform__${tool}`);
      }
    });
  });

  describe('workflow reads', () => {
    it('exposes get_diagram to structural read surfaces but not monitor surfaces', () => {
      for (const tools of [
        CODING_MCP_TOOLS,
        GENERAL_MCP_TOOLS,
        PLANNING_MCP_TOOLS,
        PLAN_SHAPING_MCP_TOOLS,
        RESEARCH_MCP_TOOLS,
      ]) {
        expect(tools).toContain('get_diagram');
      }

      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('get_diagram');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('get_diagram');
    });
  });

  describe('contextual work-item type guidance', () => {
    it('is exposed to every structural and read-capable surface', () => {
      for (const tools of [
        CODING_MCP_TOOLS,
        GENERAL_MCP_TOOLS,
        PLANNING_MCP_TOOLS,
        PLAN_SHAPING_MCP_TOOLS,
        RESEARCH_MCP_TOOLS,
      ]) {
        expect(tools).not.toContain('get_work_item_type_guidance');
        expect(tools).toContain('get_work_item_type_guidance_batch');
      }
    });

    it('stays out of session-monitor and task-monitor surfaces', () => {
      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('get_work_item_type_guidance');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('get_work_item_type_guidance');
      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('get_work_item_type_guidance_batch');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('get_work_item_type_guidance_batch');
    });
  });

  describe('task_monitor use case', () => {
    it('exposes no platform tools because canonical evidence is preloaded', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'task_monitor' });

      expect(result.allowedTools).toEqual([]);
      expect(TASK_MONITOR_MCP_TOOLS).toEqual([]);
    });

    it('excludes every mutation and lifecycle side channel', () => {
      for (const tool of [
        'create_work_item',
        'edit_work_item',
        'create_edge',
        'update_edge',
        'delete_edge',
        'create_report',
        'create_implementation_hint',
        'edit_implementation_hint',
        'delete_implementation_hint',
        'start_agent_session',
        'update_agent_session',
      ]) {
        expect(TASK_MONITOR_MCP_TOOLS).not.toContain(tool);
      }
    });
  });

  describe('work-item type reads and mutations (conversation surfaces only)', () => {
    const conversationTools = [
      'create_work_item_type',
      'get_work_item_type',
      'edit_work_item_type',
    ] as const;

    it('belongs to the general use case and not the coding base list', () => {
      for (const tool of conversationTools) {
        expect(GENERAL_MCP_TOOLS).toContain(tool);
        expect(CODING_MCP_TOOLS).not.toContain(tool);
      }
    });

    it('resolves into the general allowlist, qualified', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {}, { useCase: 'general' });

      for (const tool of conversationTools) {
        expect(result.allowedTools).toContain(`mcp__heyhey-platform__${tool}`);
      }
    });

    it('is absent from the default coding allowlist', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      const result = await buildMcpServerConfig(client, {});

      for (const tool of conversationTools) {
        expect(result.allowedTools).not.toContain(`mcp__heyhey-platform__${tool}`);
      }
    });

    it('stays out of every non-general use case that should not have it', async () => {
      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

      // The submit tool is a conversation-surface capability only. Drafting a
      // custom type from a planning, plan-shaping, research, or session-monitor
      // turn must be impossible — those handlers never run the `general` base.
      for (const useCase of [
        'planning',
        'plan_shaping',
        'research',
        'session_monitor',
        'task_monitor',
      ] as const) {
        const result = await buildMcpServerConfig(client, {}, { useCase });
        for (const tool of conversationTools) {
          expect(result.allowedTools).not.toContain(`mcp__heyhey-platform__${tool}`);
        }
      }
    });
  });

  describe('Plan intake tool scoping', () => {
    it('exposes create_plan only to general conversations', async () => {
      expect(GENERAL_MCP_TOOLS).toContain('create_plan');
      expect(CODING_MCP_TOOLS).not.toContain('create_plan');
      expect(PLANNING_MCP_TOOLS).not.toContain('create_plan');
      expect(PLAN_SHAPING_MCP_TOOLS).not.toContain('create_plan');
      expect(RESEARCH_MCP_TOOLS).not.toContain('create_plan');
      expect(SESSION_MONITOR_MCP_TOOLS).not.toContain('create_plan');
      expect(TASK_MONITOR_MCP_TOOLS).not.toContain('create_plan');

      const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });
      const general = await buildMcpServerConfig(client, {}, { useCase: 'general' });
      expect(general.allowedTools).toContain('mcp__heyhey-platform__create_plan');

      for (const useCase of [
        undefined,
        'planning',
        'plan_shaping',
        'research',
        'session_monitor',
        'task_monitor',
      ] as const) {
        const result = await buildMcpServerConfig(
          client,
          {},
          useCase === undefined ? {} : { useCase },
        );
        expect(result.allowedTools).not.toContain('mcp__heyhey-platform__create_plan');
      }
    });
  });

  it('excludes plan-shaping tools from the global allowlist by default', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(client, {});

    const planShapingQualified = [
      'create_stage',
      'update_stage',
      'delete_stage',
      'reorder_stages',
      'create_step',
      'update_step',
      'delete_step',
      'move_step',
    ].map((tool) => `mcp__heyhey-platform__${tool}`);
    for (const tool of planShapingQualified) {
      expect(result.allowedTools).not.toContain(tool);
    }
  });

  it('keeps Project Assistant gated mutation bundles out of the research base surface', () => {
    for (const tool of [
      ...PROJECT_ASSISTANT_EDGE_MCP_TOOLS,
      PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
      PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
      PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
    ]) {
      expect(RESEARCH_MCP_TOOLS).not.toContain(tool);
    }
  });

  it('allows Project Assistant gated tools to be merged through additionalTools only', async () => {
    const client = createMockOAuthClient({ success: true, data: TEST_TOKEN });

    const result = await buildMcpServerConfig(
      client,
      {},
      {
        useCase: 'research',
        additionalTools: [
          ...PROJECT_ASSISTANT_EDGE_MCP_TOOLS,
          PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
          PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
          PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
        ],
      },
    );

    expect(result.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__heyhey-platform__create_edge',
        'mcp__heyhey-platform__delete_edge',
        'mcp__heyhey-platform__get_tool_guidance',
        'mcp__heyhey-platform__get_authoring_guidance',
        'mcp__heyhey-platform__create_work_item',
        'mcp__heyhey-platform__edit_work_item',
      ]),
    );
  });
});
