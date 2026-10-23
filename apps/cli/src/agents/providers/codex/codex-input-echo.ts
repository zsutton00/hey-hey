import type { CodexSdkEvent } from '@hey-hey/ui-common/agents';

type EventParams = NonNullable<CodexSdkEvent['params']>;

const isRecord = (value: EventParams[string]): value is EventParams =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutUserItems = (turn: EventParams): EventParams => ({
  ...turn,
  ...(Array.isArray(turn['items'])
    ? { items: turn['items'].filter((item) => !isRecord(item) || item['type'] !== 'userMessage') }
    : {}),
});

/** Input echoes also occur in turn snapshots and replayed thread history. */
export function withoutCodexInputEcho(event: CodexSdkEvent): CodexSdkEvent | null {
  const params = event.params;
  if (!params) return event;
  if (isRecord(params['item']) && params['item']['type'] === 'userMessage') return null;
  const turn = params['turn'];
  const thread = params['thread'];
  return {
    ...event,
    params: {
      ...params,
      ...(isRecord(turn) ? { turn: withoutUserItems(turn) } : {}),
      ...(isRecord(thread) && Array.isArray(thread['turns'])
        ? {
            thread: {
              ...thread,
              turns: thread['turns'].map((entry) =>
                isRecord(entry) ? withoutUserItems(entry) : entry,
              ),
            },
          }
        : {}),
    },
  };
}
