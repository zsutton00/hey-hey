import { describe, expect, it } from 'vitest';
import { buildPlatformMcpProxyMcpConfig } from './mcp-config';

describe('buildPlatformMcpProxyMcpConfig', () => {
  it('points heyhey-platform at the local scoped proxy endpoint', () => {
    const result = buildPlatformMcpProxyMcpConfig({
      mount: {
        runId: 'run-1',
        turnId: 'turn-1',
        token: 'proxy-token',
        allowedTools: ['mcp__heyhey-platform__get_context'],
      },
      cliBaseUrl: 'http://127.0.0.1:3847/',
    });

    expect(result.serverName).toBe('heyhey-platform');
    expect(result.mcpServers).toEqual({
      'heyhey-platform': {
        type: 'http',
        url: 'http://127.0.0.1:3847/mcp/platform/run-1/turn-1/proxy-token',
      },
    });
    expect(result.allowedTools).toEqual(['mcp__heyhey-platform__get_context']);
  });
});
