import { describe, expect, it } from 'vitest';
import { buildBrowserToolsMcpConfig, BROWSER_ALLOWED_TOOLS } from './mcp-config';
describe('browser MCP config', () => {
  it('uses one CLI-owned server and tool vocabulary for every provider', () => {
    const config = buildBrowserToolsMcpConfig(
      { runId: 'a', projectId: 'p', turnId: 't', token: 'test-capability' },
      'http://127.0.0.1:1234/',
    );
    expect(config.serverName).toBe('heyhey-browser');
    expect(config.serverEntry).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:1234/mcp/browser-tools/test-capability',
    });
    expect(config.allowedTools).toBe(BROWSER_ALLOWED_TOOLS);
    expect(config.allowedTools).toHaveLength(9);
  });
});
