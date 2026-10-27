import { isRecord } from '../provider-event-normalization-core';

/** Classify only recognized expected outcomes; unknown failures remain errors. */
export const toolResultLogLevel = (
  toolName: string | null,
  toolUseId: string,
  text: string | null,
  event: Record<string, unknown>,
): 'warn' | 'error' => {
  const message = event['message'];
  const content = isRecord(message) ? message['content'] : null;
  const block = Array.isArray(content)
    ? content.find((entry) => isRecord(entry) && entry['tool_use_id'] === toolUseId)
    : null;
  // SDK metadata belongs to the single result on this user event.
  const resultCount = Array.isArray(content)
    ? content.filter((entry) => isRecord(entry) && entry['type'] === 'tool_result').length
    : 0;
  const metadata = resultCount === 1 ? event['tool_use_result'] : null;
  for (const candidate of [block, metadata]) {
    if (!isRecord(candidate)) continue;
    const structured = candidate['structuredContent'];
    if (
      candidate['non_execution_kind'] === 'user_denied' ||
      candidate['non_execution_kind'] === 'permission_denied' ||
      candidate['permission_decision'] === 'reject' ||
      candidate['status'] === 'correctable_rejection' ||
      (isRecord(structured) && structured['status'] === 'correctable_rejection')
    )
      return 'warn';
  }
  // Claude may flatten MCP structured results into text. Keep fallbacks narrow
  // and restricted to our admission boundary, never arbitrary MCP failures.
  if (/^mcp__heyhey-(?:platform|submission-tools)__/.test(toolName ?? '')) {
    if (text?.trimStart().startsWith('{')) {
      try {
        const decoded: unknown = JSON.parse(text);
        if (isRecord(decoded)) {
          const structured = decoded['structuredContent'];
          if (
            decoded['status'] === 'correctable_rejection' ||
            (isRecord(structured) && structured['status'] === 'correctable_rejection')
          )
            return 'warn';
        }
      } catch {
        // Non-JSON error text is classified by the narrow fallbacks below.
      }
    }
    if (
      /^(?:Invalid parameters:|\w+ input did not match its declared schema\.|\w+ requires authoringRootProof\b)/.test(
        text ?? '',
      )
    )
      return 'warn';
  }
  if (toolName === 'Bash' && /^Exit code [1-9]\d*\b/m.test(text ?? '')) return 'warn';
  return 'error';
};
