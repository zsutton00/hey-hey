import type { AgentProviderId } from '../providers/provider-config';

const SUBMISSION_TOOL_SERVER = 'heyhey-submission-tools';

/**
 * How each provider's catalog shows the submission tools. Codex rewrites
 * hyphens in MCP server names to underscores and has no deferred tool
 * discovery, so it must be told to list its catalog instead of searching.
 */
const SUBMISSION_TOOL_DISCOVERY: Record<AgentProviderId | 'unknown', string> = {
  claude:
    `The submission tools appear in your catalog as ` +
    `\`mcp__${SUBMISSION_TOOL_SERVER}__<name>\`. If they are deferred, load them ` +
    `with tool search before reporting one missing.`,
  codex:
    `The submission tools appear in your catalog as ` +
    `\`mcp__${SUBMISSION_TOOL_SERVER.replaceAll('-', '_')}__<name>\` ` +
    `(Codex rewrites hyphens in server names to underscores). List your full ` +
    `tool catalog and match the bare name before reporting one missing.`,
  unknown:
    `The submission tools appear in your catalog under the ` +
    `\`${SUBMISSION_TOOL_SERVER}\` server, as ` +
    `\`mcp__${SUBMISSION_TOOL_SERVER}__<name>\` or, where hyphens in server ` +
    `names become underscores, \`mcp__${SUBMISSION_TOOL_SERVER.replaceAll('-', '_')}__<name>\`. ` +
    `Match on the bare name, and list your full tool catalog if search finds nothing.`,
  opencode:
    `The submission tools appear in your catalog under the ` +
    `\`${SUBMISSION_TOOL_SERVER}\` server. List your full tool catalog and ` +
    `match the bare name before reporting one missing.`,
};

/**
 * Standard termination suffix appended to EXTERNAL_AGENT prompt-handler
 * system prompts. Tool-enforced termination: each turn must end in either a
 * submission-tool call or a user-facing question. Concrete handlers append
 * this string at the end of their `buildPrompt` output so the policy is
 * uniform across handlers.
 */
const submissionToolTerminationInstruction = (provider: AgentProviderId | undefined): string =>
  'End each turn by calling one of the submission tools (the only legal ' +
  'completion paths) or by asking the user a clarifying question. ' +
  'Submission tools are identified by their bare name (as used in this ' +
  `prompt). ${SUBMISSION_TOOL_DISCOVERY[provider ?? 'unknown']} If the required tool still ` +
  'is not exposed, stop and report it; do not invent an alternative. No ' +
  'freeform JSON or narrative-only completions.';

/**
 * Append the termination instruction onto an arbitrary system-prompt
 * string. Handlers that opt into this helper get consistent wording with no
 * extra trailing whitespace.
 */
export const withSubmissionToolTerminationSuffix = (
  systemPrompt: string,
  provider: AgentProviderId | undefined,
): string => {
  const trimmed = systemPrompt.replace(/\s+$/u, '');
  return `${trimmed}\n\n${submissionToolTerminationInstruction(provider)}\n`;
};
