import { HEY_HEY_PLATFORM_SERVER, qualifyHeyHeyToolName } from '../hey-hey-tool-pre-approval';
import { MCP_SERVER_NAME } from '../mcp-server-config';
import type { PlatformMcpProxyMount } from './turn-proxy';

/** Schema lookup served only on the compact catalog (`?catalog=compact`). */
export const PLATFORM_SCHEMA_LOOKUP_TOOL = 'describe_platform_tool';

export interface PlatformMcpProxyConfig {
  serverName: string;
  serverEntry: { type: 'http'; url: string };
  mcpServers: Record<string, { type: 'http'; url: string }>;
  allowedTools: string[];
}

export interface BuildPlatformMcpProxyConfigInput {
  mount: PlatformMcpProxyMount;
  cliBaseUrl: string;
  /**
   * Serve the compact catalog: tools are listed without schemas and the schema lookup tool is
   * added. The lookup then belongs to this mount's allowed tools like any other tool.
   */
  compact?: boolean;
}

export const buildPlatformMcpProxyMcpConfig = (
  input: BuildPlatformMcpProxyConfigInput,
): PlatformMcpProxyConfig => {
  const baseUrl = input.cliBaseUrl.replace(/\/$/u, '');
  const { runId, turnId, token, allowedTools } = input.mount;
  const path = `${baseUrl}/mcp/platform/${encodeURIComponent(runId)}/${encodeURIComponent(turnId)}/${encodeURIComponent(token)}`;
  const url = input.compact ? `${path}?catalog=compact` : path;
  const tools = input.compact
    ? [...allowedTools, qualifyHeyHeyToolName(HEY_HEY_PLATFORM_SERVER, PLATFORM_SCHEMA_LOOKUP_TOOL)]
    : allowedTools;
  return {
    serverName: MCP_SERVER_NAME,
    serverEntry: { type: 'http', url },
    mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url } },
    allowedTools: Array.from(new Set(tools)),
  };
};
