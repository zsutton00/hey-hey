import { BROWSER_TOOLS } from '../../browser/browser-tool-schemas';
import type { BrowserMcpMount } from './browser-mcp-access';
export const BROWSER_MCP_SERVER_NAME = 'heyhey-browser';
export const BROWSER_ALLOWED_TOOLS = BROWSER_TOOLS.map(
  (tool) => `mcp__${BROWSER_MCP_SERVER_NAME}__${tool.name}`,
);
export const buildBrowserToolsMcpConfig = (mount: BrowserMcpMount, cliBaseUrl: string) => ({
  serverName: BROWSER_MCP_SERVER_NAME,
  serverEntry: {
    type: 'http' as const,
    url: `${cliBaseUrl.replace(/\/$/u, '')}/mcp/browser-tools/${mount.token}`,
  },
  allowedTools: BROWSER_ALLOWED_TOOLS,
});
