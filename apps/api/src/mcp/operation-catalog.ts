import {
  McpOperationCatalogEntry,
  McpProposeOutputSchemaId,
} from '../generated';
import { MCP_OPERATION_INPUT_SCHEMA_ID } from './schemas/mcp-operation-input.schema';

export const mcpOperationCatalog = {
  search_work_items: {
    operationId: 'search_work_items',
    version: McpOperationCatalogEntry.VersionEnum.V1,
    status: McpOperationCatalogEntry.StatusEnum.Active,
    phaseSupport: [McpOperationCatalogEntry.PhaseSupportEnum.Propose],
    summary: 'Search across multiple tasks and initiatives.',
    intents: ['search_work_items'],
    requiredScope: [McpOperationCatalogEntry.RequiredScopeEnum.ProjectId],
    inputSchema: MCP_OPERATION_INPUT_SCHEMA_ID,
    outputSchema: McpProposeOutputSchemaId.SchemasMcpProposeOutputV100,
  } satisfies McpOperationCatalogEntry,
} as const;

export type McpOperationId = keyof typeof mcpOperationCatalog;

export function getMcpOperationCatalogEntry(
  operationId: McpOperationId,
): McpOperationCatalogEntry {
  return mcpOperationCatalog[operationId];
}

export function listMcpOperationCatalogEntries(): McpOperationCatalogEntry[] {
  return Object.values(mcpOperationCatalog);
}
