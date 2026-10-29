import type { JsonValue } from '../platform-mcp-proxy/session';

/**
 * Run-scoped identity of one eval attempt. Present on every child launched for
 * that attempt; its presence is what narrows the child's capabilities. The
 * target session preserves evidence attribution; durable Run metadata owns
 * inertness and the CLI stamps it at shared output boundaries.
 */
export interface EvalExecutionContext {
  readonly attemptId: string;
  readonly targetSessionId: string;
  readonly targetConversationId: string;
  readonly tokenBudget?: EvalTokenBudget;
}

/** One user-set budget shared by the target and all of its research children. */
export class EvalTokenBudget {
  private readonly controller = new AbortController();
  private readonly counts = new Map<string, number>();
  private exhausted = false;

  public constructor(
    private readonly limit: number,
    parent: AbortSignal,
  ) {
    if (parent.aborted) this.controller.abort(parent.reason);
    parent.addEventListener('abort', () => this.controller.abort(parent.reason), {
      once: true,
      signal: this.controller.signal,
    });
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }
  public get isExhausted(): boolean {
    return this.exhausted;
  }

  public record(childId: string, cumulativeTokens: number): void {
    this.counts.set(childId, Math.max(this.counts.get(childId) ?? 0, cumulativeTokens));
    if (
      !this.exhausted &&
      [...this.counts.values()].reduce((sum, tokens) => sum + tokens, 0) > this.limit
    ) {
      this.exhausted = true;
      this.controller.abort(new Error('Eval attempt token budget exhausted.'));
    }
  }
}

export { filterInertPlatformTools as withholdEvalMutationTools } from '../../run/inert-execution-policy';
import { isInertPlatformToolAllowed } from '../../run/inert-execution-policy';

export const isEvalWithheldTool = (shortName: string): boolean =>
  !isInertPlatformToolAllowed(shortName);

const EVAL_REPORT_TYPES: ReadonlySet<string> = new Set([
  'EVAL_RUN',
  'EVAL_ATTEMPT',
  'EVAL_HUMAN_REVIEW',
]);

const isJsonObject = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEvalReport = (value: JsonValue): boolean => {
  if (!isJsonObject(value)) return false;
  if (value['ragEnabled'] === false) return true;
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
