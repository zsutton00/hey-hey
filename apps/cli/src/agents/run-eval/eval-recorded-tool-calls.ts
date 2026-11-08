import type { EvalRecordedToolCall, EvalRecordedToolCalls } from '@hey-hey/contracts/api/models';
import type { RunToolCall } from '../../run-store/run-store';

export const MAX_RECORDED_TOOL_CALLS = 200;
export const MAX_RECORDED_ARGUMENT_CHARS = 2_000;

export const UNAVAILABLE_TOOL_CALLS = {
  state: 'UNAVAILABLE',
  calls: [],
} satisfies EvalRecordedToolCalls;

const toRecordedCall = (call: RunToolCall): EvalRecordedToolCall => {
  const serialized = call.input === undefined ? undefined : JSON.stringify(call.input);
  const truncated = serialized !== undefined && serialized.length > MAX_RECORDED_ARGUMENT_CHARS;

  return {
    toolName: call.toolName,
    origin: 'RUN_OBSERVED',
    truncated,
    ...(serialized !== undefined
      ? { arguments: truncated ? serialized.slice(0, MAX_RECORDED_ARGUMENT_CHARS) : serialized }
      : {}),
  };
};

/**
 * The attempt's tool calls as saved on its record. Calls the Run did not retain
 * are unavailable, never an empty list.
 */
export const recordToolCalls = (
  calls: readonly RunToolCall[] | undefined,
): EvalRecordedToolCalls => {
  if (!calls || calls.length === 0) {
    return UNAVAILABLE_TOOL_CALLS;
  }
  const kept = calls.slice(0, MAX_RECORDED_TOOL_CALLS).map(toRecordedCall);
  const omitted = calls.length - kept.length;

  return {
    state: 'COLLECTED',
    calls: kept,
    ...(omitted > 0 ? { omittedCalls: omitted } : {}),
  };
};

/** The calls rendered as judge evidence. */
export const toolCallsEvidenceText = (recorded: EvalRecordedToolCalls | undefined): string => {
  if (!recorded || recorded.state === 'UNAVAILABLE') {
    return 'Tool calls are unavailable for this attempt. This does not mean the agent made none.';
  }
  const lines = recorded.calls.map((call, index) => {
    const note = call.truncated ? ' [arguments cut]' : '';

    return `${index + 1}. ${call.toolName}(${call.arguments ?? ''})${note}`;
  });
  const omitted = recorded.omittedCalls ? [`[${recorded.omittedCalls} further calls omitted]`] : [];

  return [...lines, ...omitted].join('\n');
};
