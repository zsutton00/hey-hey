import { describe, expect, it } from 'vitest';
import { ActivePlatformToolCatalog } from './catalog';

describe('ActivePlatformToolCatalog', () => {
  it('builds one active platform tool set from use case plus explicit extras', () => {
    const catalog = new ActivePlatformToolCatalog({
      useCase: 'research',
      additionalTools: ['get_report_schema', 'get_context'],
    });

    expect(catalog.shortNames).toContain('unified_search');
    expect(catalog.shortNames).toContain('get_report_schema');
    expect(catalog.shortNames.filter((name) => name === 'get_context')).toHaveLength(1);
    expect(catalog.qualifiedNames).toContain('mcp__heyhey-platform__get_report_schema');
  });

  it('matches both provider-qualified and MCP-local tool names', () => {
    const catalog = new ActivePlatformToolCatalog({ additionalTools: ['get_context'] });

    expect(catalog.has('get_context')).toBe(true);
    expect(catalog.has('mcp__heyhey-platform__get_context')).toBe(true);
    expect(catalog.normalize('mcp__heyhey-platform__get_context')).toBe('get_context');
  });
});

