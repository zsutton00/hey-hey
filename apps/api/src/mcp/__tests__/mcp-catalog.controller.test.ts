import { McpCatalogController } from '../mcp-catalog.controller';
import {
  unifiedSearchParameters,
  taskSearchParameters,
  planSearchParameters,
  getHelpNodeOutput,
  getHelpNodeParameters,
  helpSearchOutput,
  helpSearchParameters,
  searchResultOutput,
} from '../tools/search-tools.provider';
import { getDiagramParameters } from '../tools/get-diagram-tools.provider';
import {
  EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION,
  editWorkItemTypeParameters,
} from '../tools/work-item-type-proposal-tools.provider';
import {
  deleteProposalOutput,
  deleteProposalParameters,
} from '../tools/proposal-tools.provider';
import type {
  McpRegistryDiscoveryService,
  DiscoveredCapability,
  ToolMetadata,
} from '@rekog/mcp-nest';

function mockTool(
  name: string,
  description: string,
): DiscoveredCapability<ToolMetadata> {
  const parametersMap: Record<string, unknown> = {
    unified_search: unifiedSearchParameters,
    task_search: taskSearchParameters,
    plan_search: planSearchParameters,
    search_help: helpSearchParameters,
    get_help_node: getHelpNodeParameters,
    get_diagram: getDiagramParameters,
    edit_work_item_type: editWorkItemTypeParameters,
    delete_proposal: deleteProposalParameters,
  };
  const outputSchemaMap: Record<string, unknown> = {
    search_help: helpSearchOutput,
    get_help_node: getHelpNodeOutput,
  };

  return {
    type: 'tool',
    metadata: {
      name,
      description,
      parameters: parametersMap[name] as ToolMetadata['parameters'],
      outputSchema:
        (outputSchemaMap[name] as ToolMetadata['outputSchema']) ??
        searchResultOutput,
    },
    providerClass: class {},
    methodName: 'handle',
  };
}

function mockRegistry(
  tools: DiscoveredCapability<ToolMetadata>[],
): McpRegistryDiscoveryService {
  return {
    getMcpModuleIds: () => ['test-module'],
    getTools: () => tools,
  } as unknown as McpRegistryDiscoveryService;
}

const SEARCH_TOOLS = [
  mockTool('unified_search', 'Search across all content types'),
  mockTool('task_search', 'Search for tasks within a project'),
  mockTool('plan_search', 'Search for plans within a project'),
  mockTool('search_help', 'Search the global published Help corpus'),
  mockTool('get_help_node', 'Open one canonical published Help node'),
];

const REGISTERED_TOOLS = [
  ...SEARCH_TOOLS,
  mockTool('get_report_schema', 'Read report payload schemas'),
  mockTool('edit_work_item_type', EDIT_WORK_ITEM_TYPE_TOOL_DESCRIPTION),
  {
    ...mockTool('delete_proposal', 'Delete a proposal record'),
    metadata: {
      ...mockTool('delete_proposal', 'Delete a proposal record').metadata,
      outputSchema: deleteProposalOutput,
    },
  },
  {
    ...mockTool('get_diagram', 'Read one Diagram as compact text'),
    metadata: {
      name: 'get_diagram',
      description: 'Read one Diagram as compact text',
      parameters: getDiagramParameters,
    },
  },
];

describe('McpCatalogController', () => {
  it('returns all registered tools with count', () => {
    const controller = new McpCatalogController(mockRegistry(REGISTERED_TOOLS));
    const result = controller.getToolCatalog();

    expect(result.tools).toHaveLength(9);
    expect(result.count).toBe(9);
  });

  it('includes tool metadata with schemas', () => {
    const controller = new McpCatalogController(mockRegistry(SEARCH_TOOLS));
    const { tools } = controller.getToolCatalog();

    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.isActive).toBe(true);
    }
  });

  it('exposes search tools and the read-only report schema tool', () => {
    const controller = new McpCatalogController(mockRegistry(REGISTERED_TOOLS));
    const { tools } = controller.getToolCatalog();
    const names = tools.map((t) => t.name);

    expect(names).toContain('unified_search');
    expect(names).toContain('task_search');
    expect(names).toContain('plan_search');
    expect(names).toContain('search_help');
    expect(names).toContain('get_help_node');
    expect(names).toContain('get_report_schema');
    expect(names).toContain('get_diagram');
    expect(names).toContain('edit_work_item_type');
    expect(names).toContain('delete_proposal');

    const deleteTool = tools.find((tool) => tool.name === 'delete_proposal');
    expect(deleteTool?.inputSchema?.properties).toHaveProperty('proposalId');
    expect(deleteTool?.outputSchema?.properties).toHaveProperty('deleted');
  });

  it('exposes global Help contracts without project or organization scope', () => {
    const controller = new McpCatalogController(mockRegistry(SEARCH_TOOLS));
    const { tools } = controller.getToolCatalog();
    const searchHelp = tools.find((tool) => tool.name === 'search_help');
    const getHelpNode = tools.find((tool) => tool.name === 'get_help_node');

    expect(searchHelp?.inputSchema?.properties).toHaveProperty('query');
    expect(searchHelp?.inputSchema?.properties).toHaveProperty('limit');
    expect(searchHelp?.inputSchema?.properties).not.toHaveProperty(
      'organizationId',
    );
    expect(searchHelp?.inputSchema?.properties).not.toHaveProperty('projectId');
    expect(searchHelp?.outputSchema?.properties).toHaveProperty('results');

    expect(getHelpNode?.inputSchema?.properties).toHaveProperty('idOrSlugPath');
    expect(getHelpNode?.inputSchema?.properties).not.toHaveProperty(
      'organizationId',
    );
    expect(getHelpNode?.inputSchema?.properties).not.toHaveProperty(
      'projectId',
    );
    expect(getHelpNode?.outputSchema?.properties).toHaveProperty('body');
    expect(getHelpNode?.outputSchema?.properties).toHaveProperty('demos');
  });

  it('exposes the project-owned complete-definition edit contract', () => {
    const controller = new McpCatalogController(mockRegistry(REGISTERED_TOOLS));
    const editTool = controller
      .getToolCatalog()
      .tools.find((tool) => tool.name === 'edit_work_item_type');

    expect(editTool?.description).toContain(
      'CANONICAL, CANONICAL_OVERRIDE, or PROJECT_CUSTOM',
    );
    expect(editTool?.inputSchema?.properties).toHaveProperty('typeKey');
    expect(editTool?.inputSchema?.properties).toHaveProperty('definition');
    expect(editTool?.inputSchema?.properties).toHaveProperty(
      'acknowledgeCanonicalCustomization',
    );
  });

  it('does not expose create_report in the registered catalog', () => {
    const controller = new McpCatalogController(mockRegistry(REGISTERED_TOOLS));
    const { tools } = controller.getToolCatalog();
    const names = tools.map((t) => t.name);

    expect(names).not.toContain('create_report');
  });

  it('converts Zod schemas to JSON Schema format', () => {
    const controller = new McpCatalogController(mockRegistry(SEARCH_TOOLS));
    const { tools } = controller.getToolCatalog();
    const unified = tools.find((t) => t.name === 'unified_search');

    expect(unified?.inputSchema).toHaveProperty('type');
    expect(unified?.inputSchema).toHaveProperty('properties');
    expect(
      (unified?.inputSchema as Record<string, unknown>).properties,
    ).toHaveProperty('query');
  });

  it('returns empty tools when registry is absent', () => {
    const controller = new McpCatalogController();
    const result = controller.getToolCatalog();

    expect(result.tools).toEqual([]);
    expect(result.count).toBe(0);
  });
});
