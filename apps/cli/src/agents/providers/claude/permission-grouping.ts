import { formatPermissionInputSummary, summarizePermissionInput } from './permission-input-summary';

const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Tools whose pending requests share one card. Each names the input fields
 * that say what a request is for; a request without them falls back to the
 * generic input summary.
 *
 * `SandboxNetworkAccess` input was not available when this list was written:
 * `host` is the expected field, and the summary fallback covers any other
 * shape until real `coalesce_decision` logs confirm it.
 */
const GROUPED_PERMISSION_TOOLS: Readonly<Record<string, { descriptiveFields: readonly string[] }>> =
  {
    WebSearch: { descriptiveFields: ['query'] },
    SandboxNetworkAccess: { descriptiveFields: ['host'] },
  };

export function isGroupedPermissionTool(toolName: string): boolean {
  return Object.hasOwn(GROUPED_PERMISSION_TOOLS, toolName);
}

/** What one grouped request is for, shown as a row on the shared card. */
export function describeGroupedPermissionRequest(
  toolName: string,
  input: Readonly<Record<string, unknown>> | null,
): string {
  const fields = GROUPED_PERMISSION_TOOLS[toolName]?.descriptiveFields ?? [];
  const values = fields
    .map((field) => input?.[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  const description =
    values.length > 0
      ? values.join(', ')
      : (formatPermissionInputSummary(summarizePermissionInput(input)) ??
        `Permission requested for tool: ${toolName}`);

  return description.length > MAX_DESCRIPTION_LENGTH
    ? `${description.slice(0, MAX_DESCRIPTION_LENGTH)}…`
    : description;
}
