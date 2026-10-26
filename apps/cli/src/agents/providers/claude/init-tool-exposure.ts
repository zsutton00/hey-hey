import { isMintedUserMcpTool } from './user-mcp-config';
import { isRecord } from '../provider-event-normalization-core';

/**
 * Diagnostic for the "platform MCP tools appear unavailable to the agent"
 * problem. The platform MCP server connects fine, but Claude Code's auto
 * tool-search can DEFER MCP tools behind ToolSearch once the total tool count
 * is high — deferred tools are NOT in the `system/init` `tools` catalog, so the
 * agent reports them as missing. This compares the tools we requested via
 * `--allowedTools` against the init catalog the SDK actually exposed, so the
 * deferred set is visible per-run in the logs.
 */
export const summarizeClaudeInitToolExposure = (
  initEvent: Record<string, unknown>,
  requestedAllowedTools: readonly string[] | undefined,
  userServerNames: readonly string[],
): Record<string, unknown> => {
  const exposedTools = Array.isArray(initEvent['tools'])
    ? (initEvent['tools'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const exposedSet = new Set(exposedTools);
  const mcpServers = Array.isArray(initEvent['mcp_servers'])
    ? (initEvent['mcp_servers'] as unknown[])
        .map((s) => (isRecord(s) ? { name: s['name'], status: s['status'] } : null))
        .filter((s): s is { name: unknown; status: unknown } => s !== null)
    : [];
  const requested = requestedAllowedTools ?? [];
  const serverRules = userServerNames.map((name) => `mcp__${name}`);
  const requestedMcp = requested.filter((t) => t.startsWith('mcp__') && !serverRules.includes(t));
  const exposedMcp = exposedTools.filter(
    (t) => requestedMcp.includes(t) || isMintedUserMcpTool(t, userServerNames),
  );
  const deferredMcp = requestedMcp.filter((t) => !exposedSet.has(t));
  return {
    enableToolSearchEnv: process.env['ENABLE_TOOL_SEARCH'] ?? '<unset>',
    exposedToolCount: exposedTools.length,
    requestedMcpToolCount: requestedMcp.length,
    requestedMcpServerRuleCount: serverRules.length,
    uncoveredMcpServerRules: userServerNames
      .filter((name) => !exposedTools.some((tool) => isMintedUserMcpTool(tool, [name])))
      .map((name) => `mcp__${name}`),
    exposedMcpToolCount: exposedMcp.length,
    deferredMcpToolCount: deferredMcp.length,
    deferredMcpTools: deferredMcp,
    delegationRequested: requested.includes('Agent'),
    delegationExposed: exposedSet.has('Agent'),
    exposedResearchTools: exposedTools.filter((tool) =>
      ['Read', 'Glob', 'Grep', 'Agent'].includes(tool),
    ),
    mcpServers,
  };
};
