/**
 * Latest-Turn tool calls for the remote read: a live projection of the bounded
 * session activity history, fitted under a response budget. Nothing here is
 * stored; the result exists only for the response that carries it.
 */

import type {
  CliReadToolCall,
  CliReadToolCallText,
  CliReadToolCallsLatestTurnAvailable,
} from '../shared/agent-bridge-contract/generated/api';
import type {
  BoundedText,
  RunActivitySnapshot,
  SessionActivityEntry,
  SessionToolEntry,
} from './session-activity-source';

/** Whole serialized result stays below the shared acknowledgement limit with room for the response envelope. */
export const MAX_TOOL_CALLS_RESULT_BYTES = 800_000;

/** Detail text caps tried from most to least generous when the result is over budget. */
const DETAIL_CAPS_BYTES = [8 * 1024, 2 * 1024, 512, 128, 0] as const;

const MAX_SUMMARY_LENGTH = 160;
/** Argument names that best describe a call, in preference order. */
const SUMMARY_ARGUMENT_KEYS = [
  'command',
  'cmd',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
] as const;

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const isToolEntry = (entry: SessionActivityEntry): entry is SessionToolEntry =>
  entry.kind === 'tool';

/** The active Turn, else the Turn of the newest activity. Null when the Run has neither. */
const selectLatestTurnId = (
  activeTurnId: string | null,
  entries: readonly SessionActivityEntry[],
): string | null => activeTurnId ?? entries.at(-1)?.turnId ?? null;

const argumentHint = (input: BoundedText | null): string | null => {
  if (!input) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    // Cut-off arguments are not valid JSON; the summary then names the tool alone.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  for (const key of SUMMARY_ARGUMENT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
};

const summarize = (entry: SessionToolEntry): string => {
  const name = entry.toolName ?? 'Tool call';
  const hint = argumentHint(entry.input);
  const line = (hint ? `${name}: ${hint}` : name).replace(/\s+/gu, ' ').trim();
  return line.length > MAX_SUMMARY_LENGTH ? `${line.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : line;
};

const toText = (text: BoundedText): CliReadToolCallText => ({
  text: text.text,
  truncated: text.truncatedBytes > 0,
});

const toCall = (entry: SessionToolEntry): CliReadToolCall => ({
  entryId: entry.entryId,
  toolUseId: entry.toolUseId,
  toolName: entry.toolName,
  summary: summarize(entry),
  status: entry.status,
  exitCode: entry.exitCode,
  lane: {
    subagentTurnId: entry.lane.subagentTurnId,
    providerThreadId: entry.lane.providerThreadId,
    parentToolUseId: entry.lane.parentToolUseId,
  },
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
  detail: {
    input: entry.input ? toText(entry.input) : null,
    output:
      entry.output.text === '' && entry.output.truncatedBytes === 0 ? null : toText(entry.output),
    result: entry.result ? toText(entry.result) : null,
  },
});

/** Cuts at a character boundary so the kept text never ends or starts in a broken sequence. */
const cutBytes = (text: string, maxBytes: number, keep: 'start' | 'end'): string => {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  return keep === 'start'
    ? bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/u, '')
    : bytes
        .subarray(bytes.length - maxBytes)
        .toString('utf8')
        .replace(/^�/u, '');
};

const capText = (
  text: CliReadToolCallText | null,
  capBytes: number,
  keep: 'start' | 'end',
): CliReadToolCallText | null => {
  if (!text || utf8Bytes(text.text) <= capBytes) return text;
  return { text: cutBytes(text.text, capBytes, keep), truncated: true };
};

const withDetailCap = (calls: readonly CliReadToolCall[], capBytes: number): CliReadToolCall[] =>
  calls.map((call) => ({
    ...call,
    detail: {
      input: capText(call.detail.input, capBytes, 'start'),
      // Streamed output keeps its most recent text, as the activity history does.
      output: capText(call.detail.output, capBytes, 'end'),
      result: capText(call.detail.result, capBytes, 'start'),
    },
  }));

const sizeOf = (result: CliReadToolCallsLatestTurnAvailable): number =>
  utf8Bytes(JSON.stringify(result));

/**
 * Fits the complete serialized result under `budgetBytes`: detail is trimmed
 * first (most generous cap that fits), then the earliest calls are dropped and
 * counted. Summaries are never cut.
 */
export const fitToolCallsToBudget = (
  result: CliReadToolCallsLatestTurnAvailable,
  budgetBytes: number,
): CliReadToolCallsLatestTurnAvailable => {
  if (sizeOf(result) <= budgetBytes) return result;

  const fitWithCaps = (
    calls: readonly CliReadToolCall[],
    omitted: number,
  ): CliReadToolCallsLatestTurnAvailable | null => {
    for (const cap of DETAIL_CAPS_BYTES) {
      const candidate = {
        ...result,
        toolCalls: withDetailCap(calls, cap),
        omittedEarlierCount: result.omittedEarlierCount + omitted,
      };
      if (sizeOf(candidate) <= budgetBytes) return candidate;
    }
    return null;
  };

  const all = result.toolCalls;
  const withAllCalls = fitWithCaps(all, 0);
  if (withAllCalls) return withAllCalls;

  // Size only shrinks as earlier calls are dropped, so the smallest fitting drop count is found by bisection.
  let low = 1;
  let high = all.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fitWithCaps(all.slice(middle), middle) !== null) high = middle;
    else low = middle + 1;
  }
  const fitted = fitWithCaps(all.slice(low), low);
  if (!fitted) {
    // Even an empty list cannot carry the envelope: the budget itself is unusable.
    throw new Error('The tool-call result cannot fit the response budget.');
  }
  return fitted;
};

export interface LatestTurnToolCallsInput {
  readonly runId: string;
  /** The Run's active Turn, when one is running. */
  readonly activeTurnId: string | null;
  /** The Run's activity, or null when nothing was captured for it. */
  readonly activity: RunActivitySnapshot | null;
  readonly budgetBytes?: number;
}

export const projectLatestTurnToolCalls = (
  input: LatestTurnToolCallsInput,
): CliReadToolCallsLatestTurnAvailable => {
  const entries = input.activity?.entries ?? [];
  const turnId = selectLatestTurnId(input.activeTurnId, entries);
  const toolCalls = entries
    .filter(isToolEntry)
    .filter((entry) => entry.turnId === turnId)
    .map(toCall);
  return fitToolCallsToBudget(
    {
      state: 'available',
      runId: input.runId,
      turnId,
      toolCalls,
      omittedEarlierCount: 0,
      evictedCount: input.activity?.gap.evictedCount ?? 0,
    },
    input.budgetBytes ?? MAX_TOOL_CALLS_RESULT_BYTES,
  );
};
