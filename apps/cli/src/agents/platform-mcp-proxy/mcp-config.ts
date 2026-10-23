import { MCP_SERVER_NAME } from '../mcp-server-config';
import type { PlatformMcpProxyMount } from './turn-proxy';

export interface PlatformMcpProxyConfig {
  serverName: string;
  serverEntry: { type: 'http'; url: string };
  mcpServers: Record<string, { type: 'http'; url: string }>;
  allowedTools: string[];
}

export interface BuildPlatformMcpProxyConfigInput {
  mount: PlatformMcpProxyMount;
  cliBaseUrl: string;
}

export const buildPlatformMcpProxyMcpConfig = (
  input: BuildPlatformMcpProxyConfigInput,
): PlatformMcpProxyConfig => {
  const baseUrl = input.cliBaseUrl.replace(/\/$/u, '');
  const { runId, turnId, token, allowedTools } = input.mount;
  const url = `${baseUrl}/mcp/platform/${encodeURIComponent(runId)}/${encodeURIComponent(turnId)}/${encodeURIComponent(token)}`;
  return {
    serverName: MCP_SERVER_NAME,
    serverEntry: { type: 'http', url },
    mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url } },
    allowedTools: Array.from(new Set(allowedTools)),
  };
};
