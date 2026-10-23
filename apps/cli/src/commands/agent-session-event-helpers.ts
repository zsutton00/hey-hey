import type { AgenticSessionEvent } from '../session/index';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const coerceNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readAssistantSummaryFromEvent = (event: AgenticSessionEvent): string | null => {
  if (event.event_type !== 'agent_output') {
    return null;
  }
  if (!event.payload || !isObject(event.payload)) {
    return null;
  }

  const messageType = coerceNonEmptyString(event.payload['messageType']);
  if (messageType !== 'assistant') {
    return null;
  }

  return coerceNonEmptyString(event.payload['summary']);
};

const readAssistantSummaryFromRunEvent = (
  event: AgenticSessionEvent,
  runId: string,
): string | null => {
  if (event.run_id !== runId) {
    return null;
  }

  return readAssistantSummaryFromEvent(event);
};

export const extractLatestAssistantResponseText = (
  events: AgenticSessionEvent[],
  baselineEventCount: number,
): string | null => {
  const startIndex = Math.max(0, baselineEventCount);
  for (let index = events.length - 1; index >= startIndex; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }

    const summary = readAssistantSummaryFromEvent(event);
    if (summary) {
      return summary;
    }
  }

  return null;
};

const extractLatestAssistantResponseTextForRun = (
  events: AgenticSessionEvent[],
  runId: string,
): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }

    const summary = readAssistantSummaryFromRunEvent(event, runId);
    if (summary) {
      return summary;
    }
  }

  return null;
};
