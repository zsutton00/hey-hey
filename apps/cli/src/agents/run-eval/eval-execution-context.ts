import type { JsonValue } from '../platform-mcp-proxy/session';

/**
 * Run-scoped identity of one eval attempt. Present on every child launched for
 * that attempt; its presence is what narrows the child's capabilities. The
 * child reaches the platform as the attempt's target session, which is how
 * the API recognises what it writes as eval output.
 */
export interface EvalExecutionContext {
  readonly attemptId: string;
  readonly targetSessionId: string;
  readonly targetConversationId: string;
}

/**
 * Platform tools that change the live project directly, bypassing proposals.
 */
const DIRECT_MUTATION_TOOLS = [
  'create_edge',
  'update_edge',
  'delete_edge',
  'create_implementation_hint',
  'edit_implementation_hint',
  'delete_implementation_hint',
  'update_proposal',
  'delete_proposal',
] as const;

const WITHHELD_TOOLS: ReadonlySet<string> = new Set(DIRECT_MUTATION_TOOLS);

/** Drop every tool an eval attempt may not use from a short-name allowlist. */
export const withholdEvalMutationTools = (shortNames: readonly string[]): string[] =>
  shortNames.filter((name) => !WITHHELD_TOOLS.has(name));

export const isEvalWithheldTool = (shortName: string): boolean => WITHHELD_TOOLS.has(shortName);

const EVAL_REPORT_TYPES: ReadonlySet<string> = new Set([
  'EVAL_RUN',
  'EVAL_ATTEMPT',
  'EVAL_HUMAN_REVIEW',
]);

const isJsonObject = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEvalReport = (value: JsonValue): boolean => {
  if (!isJsonObject(value)) return false;
  const reportType = value['reportType'];
  if (typeof reportType === 'string' && EVAL_REPORT_TYPES.has(reportType)) return true;
  const payload = value['payload'];
  return payload !== undefined && isJsonObject(payload) && isEvalReport(payload);
};

/**
 * Remove eval run, attempt and human-review reports, and anything nested in
 * them, from a JSON value. Returns null when the value itself is one.
 */
const stripEvalReports = (value: JsonValue): JsonValue | null => {
  if (isEvalReport(value)) return null;
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const kept = stripEvalReports(entry);
      return kept === null ? [] : [kept];
    });
  }
  if (isJsonObject(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const kept = stripEvalReports(entry);
      result[key] = kept;
    }
    return result;
  }
  return value;
};

const EVAL_REPORT_HIDDEN = 'Report not found.';

/**
 * Filter a platform `tools/call` result for an eval target. Text content that
 * carries JSON is parsed, filtered and re-serialised; structured content is
 * filtered in place. A result that is itself an eval report becomes a
 * not-found error, so the target cannot tell it exists.
 */
export const filterEvalReportsFromToolResult = (result: JsonValue): JsonValue => {
  if (!isJsonObject(result)) return result;
  let hidden = false;
  const filtered: Record<string, JsonValue> = { ...result };
  const structured = result['structuredContent'];
  if (structured !== undefined) {
    const kept = stripEvalReports(structured);
    if (kept === null) hidden = true;
    else filtered['structuredContent'] = kept;
  }
  const content = result['content'];
  if (Array.isArray(content)) {
    filtered['content'] = content.map((block) => {
      if (!isJsonObject(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
        return block;
      }
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(block['text']) as JsonValue;
      } catch {
        return block;
      }
      const kept = stripEvalReports(parsed);
      if (kept === null) {
        hidden = true;
        return block;
      }
      return { ...block, text: JSON.stringify(kept) };
    });
  }
  if (hidden) {
    return { isError: true, content: [{ type: 'text', text: EVAL_REPORT_HIDDEN }] };
  }
  return filtered;
};
