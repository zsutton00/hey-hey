import type { WorkTrackerImportRequest } from '../../shared/agent-bridge-contract/generated/api';

// Official provider endpoints: https://linear.app/docs/mcp and
// https://atlassian.github.io/atlassian-mcp-server/
export function buildWorkTrackerConnectionInstructions(
  payload: Pick<WorkTrackerImportRequest, 'source' | 'provider'>,
): string {
  const name = payload.source === 'jira' ? 'atlassian' : 'linear';
  const url =
    payload.source === 'jira' ? 'https://mcp.atlassian.com/v2/mcp' : 'https://mcp.linear.app/mcp';
  const command =
    payload.provider === 'claude'
      ? `claude mcp add --transport http --scope user ${name} ${url}`
      : `codex mcp add ${name} --url ${url}`;
  const authentication =
    payload.provider === 'claude'
      ? 'Open Claude Code and use /mcp to authenticate in your browser.'
      : `If authentication is still needed, run codex mcp login ${name} and sign in in your browser.`;
  return [
    `Connect ${payload.source === 'jira' ? 'Jira' : 'Linear'} on your paired machine:`,
    '```sh',
    command,
    '```',
    authentication,
    'This adds the connection to your runtime user configuration. Run it yourself, or explicitly ask your agent to run it. Never share credentials with Hey Hey.',
    'Confirm the connection in the import journey when ready. Import will start a fresh provider session and check access again.',
  ].join('\n');
}
