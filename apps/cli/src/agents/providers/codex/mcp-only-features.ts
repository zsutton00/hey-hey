export const CODEX_MCP_ONLY_FEATURE_OVERRIDES: Readonly<Record<string, boolean>> = {
  shell_tool: false,
  unified_exec: false,
  unified_exec_tty: false,
  view_image: false,
  sleep_tool: false,
  code_mode: false,
  code_mode_host: false,
  code_mode_only: false,
  standalone_web_search: false,
  web_search_request: false,
  web_search_cached: false,
  apps: false,
  plugins: false,
  computer_use: false,
  collab: false,
  multi_agent_v2: false,
  memory_tool: false,
  external_agent_memory_import: false,
};

/**
 * Overrides for a workspace-bound inert Run: every MCP-only restriction stays
 * except the shell, which the workspace-write sandbox confines to the bound
 * directory.
 */
export const CODEX_WORKSPACE_SHELL_FEATURE_OVERRIDES: Readonly<Record<string, boolean>> = {
  ...CODEX_MCP_ONLY_FEATURE_OVERRIDES,
  shell_tool: true,
  unified_exec: true,
  unified_exec_tty: true,
};
