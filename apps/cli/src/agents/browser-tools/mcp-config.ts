import { BROWSER_TOOLS } from '../../browser/browser-tool-schemas';
import type { BrowserMcpMount } from './browser-mcp-access';
import { HEY_HEY_BROWSER_SERVER, qualifyHeyHeyToolName } from '../hey-hey-tool-pre-approval';
export const BROWSER_MCP_SERVER_NAME = HEY_HEY_BROWSER_SERVER;
export const BROWSER_ALLOWED_TOOLS = BROWSER_TOOLS.map((tool) =>
  qualifyHeyHeyToolName(HEY_HEY_BROWSER_SERVER, tool.name),
);
export const buildBrowserToolsMcpConfig = (mount: BrowserMcpMount, cliBaseUrl: string) => ({
  serverName: BROWSER_MCP_SERVER_NAME,
  serverEntry: {
    type: 'http' as const,
    url: `${cliBaseUrl.replace(/\/$/u, '')}/mcp/browser-tools/${mount.token}`,
  },
  allowedTools: BROWSER_ALLOWED_TOOLS,
});
