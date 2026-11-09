const MAX_VALUE_LENGTH = 120;

// Fields that carry file or message bodies. Only their length is reported so
// logs and cards never echo document contents.
const BODY_FIELDS: ReadonlySet<string> = new Set([
  'content',
  'new_string',
  'old_string',
  'prompt',
  'text',
]);

/**
 * Safe, bounded view of a tool-permission input: scalar fields only, long
 * strings truncated, body fields reduced to their length. Used for diagnostic
 * logs and for permission cards whose tool has no command or path to show.
 */
export function summarizePermissionInput(
  input: Readonly<Record<string, unknown>> | null,
): Record<string, string | number | boolean> {
  const summary: Record<string, string | number | boolean> = {};
  if (!input) {
    return summary;
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      summary[key] = BODY_FIELDS.has(key)
        ? `<${value.length} chars>`
        : value.length > MAX_VALUE_LENGTH
          ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
          : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
    } else if (Array.isArray(value)) {
      summary[key] = `<array of ${value.length}>`;
    } else if (value !== null && typeof value === 'object') {
      summary[key] = '<object>';
    }
  }

  return summary;
}

export function formatPermissionInputSummary(
  summary: Readonly<Record<string, string | number | boolean>>,
): string | null {
  const parts = Object.entries(summary).map(([key, value]) => `${key}=${String(value)}`);

  return parts.length > 0 ? parts.join(', ') : null;
}
