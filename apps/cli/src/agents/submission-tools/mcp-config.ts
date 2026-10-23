/**
 * Builds the `mcpServers` entry + `allowedTools` list for a handler's
 * submission tools. Wired into the Claude session runner so the agent sees
 * the tools as `mcp__heyhey-submission-tools__<tool-name>`.
 */

import type { SubmissionToolDeclaration } from './types';

const SUBMISSION_TOOLS_MCP_NAME = 'heyhey-submission-tools';

export interface SubmissionToolsMcpConfig {
  serverName: string;
  serverEntry: { type: 'http'; url: string };
  allowedTools: string[];
}

export interface BuildSubmissionToolsMcpConfigInput {
  /** Token returned by `submissionToolRegistry.register`. */
  token: string;
  /**
   * Base URL of the local HTTP server hosting the MCP endpoint. Typically
   * `http://127.0.0.1:<cliPort>`.
   */
  cliBaseUrl: string;
  tools: ReadonlyArray<SubmissionToolDeclaration>;
}

export const buildSubmissionToolsMcpConfig = (
  input: BuildSubmissionToolsMcpConfigInput,
): SubmissionToolsMcpConfig => {
  const url = `${input.cliBaseUrl.replace(/\/$/u, '')}/mcp/submission-tools/${input.token}`;
  return {
    serverName: SUBMISSION_TOOLS_MCP_NAME,
    serverEntry: { type: 'http', url },
    allowedTools: input.tools.map((tool) => `mcp__${SUBMISSION_TOOLS_MCP_NAME}__${tool.name}`),
  };
};

const SUBMISSION_TOOLS_MCP_SERVER_NAME = SUBMISSION_TOOLS_MCP_NAME;
