/**
 * Standard termination suffix appended to EXTERNAL_AGENT prompt-handler
 * system prompts. Tool-enforced termination: each turn must end in either a
 * submission-tool call or a user-facing question. Concrete handlers append
 * this string at the end of their `buildPrompt` output so the policy is
 * uniform across handlers.
 */
const SUBMISSION_TOOL_TERMINATION_INSTRUCTION =
  'End each turn by calling one of the submission tools (the only legal ' +
  'completion paths) or by asking the user a clarifying question. ' +
  'Submission tools appear in your catalog as ' +
  '`mcp__heyhey-submission-tools__<name>` — bare names in this prompt map ' +
  'to those. If your environment supports deferred tool discovery, search for ' +
  'that exact prefix before reporting a missing tool. If discovery still does ' +
  'not expose the required tool, stop and report it; do not invent an ' +
  'alternative. No freeform JSON or narrative-only completions.';

/**
 * Append the termination instruction onto an arbitrary system-prompt
 * string. Handlers that opt into this helper get consistent wording with no
 * extra trailing whitespace.
 */
export const withSubmissionToolTerminationSuffix = (systemPrompt: string): string => {
  const trimmed = systemPrompt.replace(/\s+$/u, '');
  return `${trimmed}\n\n${SUBMISSION_TOOL_TERMINATION_INSTRUCTION}\n`;
};
