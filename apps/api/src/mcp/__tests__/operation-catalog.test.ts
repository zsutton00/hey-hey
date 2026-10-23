import { McpOperationCatalogEntry } from '../../generated';
import {
  getMcpOperationCatalogEntry,
  listMcpOperationCatalogEntries,
  mcpOperationCatalog,
} from '../operation-catalog';
import { MCP_OPERATION_INPUT_SCHEMA_ID } from '../schemas/mcp-operation-input.schema';

describe('mcp operation catalog', () => {
  it('binds operation entries to the canonical input schema', () => {
    const entries = listMcpOperationCatalogEntries();

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.inputSchema).toBe(MCP_OPERATION_INPUT_SCHEMA_ID);
    }
  });

  it('includes at least one project-scoped propose operation', () => {
    const entry = getMcpOperationCatalogEntry('search_work_items');

    expect(entry.phaseSupport).toEqual([
      McpOperationCatalogEntry.PhaseSupportEnum.Propose,
    ]);
    expect(entry.requiredScope).toContain(
      McpOperationCatalogEntry.RequiredScopeEnum.ProjectId,
    );
    expect(entry.outputSchema).toBe('/schemas/mcp/propose-output/v1.0.0');
  });

  it('exposes stable operation IDs', () => {
    expect(Object.keys(mcpOperationCatalog)).toContain('search_work_items');
  });
});
