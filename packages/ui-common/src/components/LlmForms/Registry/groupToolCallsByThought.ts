import type { CliReadToolCall } from "../../../api";

/**
 * Places each tool call after the latest thought that began at or before the
 * call's start, so calls read in time order between the narration. Calls with
 * no earlier timestamped thought go after the first thought; calls whose time
 * can't be compared go after the last thought.
 */
export const groupToolCallsByThought = (
  thoughtTimestamps: readonly (string | null)[],
  toolCalls: readonly CliReadToolCall[],
): CliReadToolCall[][] => {
  const groups = thoughtTimestamps.map((): CliReadToolCall[] => []);
  if (groups.length === 0) return groups;
  const lastIndex = groups.length - 1;
  const thoughtTimes = thoughtTimestamps.map((timestamp) =>
    timestamp === null ? Number.NaN : Date.parse(timestamp),
  );
  for (const call of toolCalls) {
    const callTime = Date.parse(call.createdAt);
    if (Number.isNaN(callTime)) {
      groups[lastIndex].push(call);
      continue;
    }
    let index = 0;
    thoughtTimes.forEach((thoughtTime, thoughtIndex) => {
      if (!Number.isNaN(thoughtTime) && thoughtTime <= callTime) {
        index = thoughtIndex;
      }
    });
    groups[index].push(call);
  }
  return groups;
};
