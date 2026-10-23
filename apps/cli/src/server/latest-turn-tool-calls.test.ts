import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_CALLS_RESULT_BYTES,
  fitToolCallsToBudget,
  projectLatestTurnToolCalls,
} from './latest-turn-tool-calls';
import type {
  BoundedText,
  RunActivitySnapshot,
  SessionActivityEntry,
  SessionActivityLane,
  SessionToolEntry,
} from './session-activity-source';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_LANE: SessionActivityLane = {
  subagentTurnId: null,
  providerThreadId: null,
  parentToolUseId: null,
};
const text = (value: string, truncatedBytes = 0): BoundedText => ({ text: value, truncatedBytes });

let nextSeq = 1;
const tool = (overrides: Partial<SessionToolEntry> = {}): SessionToolEntry => {
  const seq = nextSeq++;
  return {
    kind: 'tool',
    entryId: `1:${String(seq)}`,
    seq,
    lane: ROOT_LANE,
    turnId: 'turn-1',
    providerTurnId: null,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:01.000Z',
    toolUseId: `tool-${String(seq)}`,
    toolName: 'Bash',
    input: text(JSON.stringify({ command: 'ls' })),
    status: 'completed',
    output: text(''),
    result: text('ok'),
    exitCode: null,
    ...overrides,
  };
};

const narration = (turnId: string | null): SessionActivityEntry => {
  const seq = nextSeq++;
  return {
    kind: 'narration',
    entryId: `1:${String(seq)}`,
    seq,
    lane: ROOT_LANE,
    turnId,
    providerTurnId: null,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    text: text('thinking'),
    open: false,
  };
};

const activity = (entries: SessionActivityEntry[], evictedCount = 0): RunActivitySnapshot => ({
  runId: RUN_ID,
  runInstanceId: 1,
  entries,
  gap: { evictedCount, throughSeq: evictedCount > 0 ? evictedCount : null },
});

const project = (
  entries: SessionActivityEntry[],
  activeTurnId: string | null = null,
  budgetBytes?: number,
) =>
  projectLatestTurnToolCalls({
    runId: RUN_ID,
    activeTurnId,
    activity: activity(entries),
    ...(budgetBytes === undefined ? {} : { budgetBytes }),
  });

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('projectLatestTurnToolCalls', () => {
  it('returns the latest Turn tool calls in order, without narration or earlier Turns', () => {
    const first = tool({ turnId: 'turn-1', toolUseId: 'old' });
    const a = tool({ turnId: 'turn-2', toolUseId: 'a' });
    const b = tool({
      turnId: 'turn-2',
      toolUseId: 'b',
      toolName: 'Read',
      input: text('{"file_path":"/x.ts"}'),
    });

    const result = project([first, narration('turn-2'), a, b]);

    expect(result.turnId).toBe('turn-2');
    expect(result.toolCalls.map((call) => call.toolUseId)).toEqual(['a', 'b']);
    expect(result.toolCalls[0]?.summary).toBe('Bash: ls');
    expect(result.toolCalls[1]?.summary).toBe('Read: /x.ts');
  });

  it('prefers the active Turn over older activity, even before it has tool calls', () => {
    const result = project([tool({ turnId: 'turn-1' })], 'turn-2');

    expect(result.turnId).toBe('turn-2');
    expect(result.toolCalls).toEqual([]);
  });

  it('falls back to the newest Turn with activity when no Turn is active', () => {
    const result = project([
      tool({ turnId: 'turn-1' }),
      tool({ turnId: 'turn-3', toolUseId: 'new' }),
    ]);

    expect(result.turnId).toBe('turn-3');
    expect(result.toolCalls.map((call) => call.toolUseId)).toEqual(['new']);
  });

  it('returns an empty list when the Run has no captured activity', () => {
    const result = projectLatestTurnToolCalls({
      runId: RUN_ID,
      activeTurnId: null,
      activity: null,
    });

    expect(result).toMatchObject({ turnId: null, toolCalls: [], evictedCount: 0 });
  });

  it('keeps subagent lanes distinct even with equal tool ids', () => {
    const root = tool({ toolUseId: 'same' });
    const sub = tool({
      toolUseId: 'same',
      lane: { subagentTurnId: 'sub-1', providerThreadId: null, parentToolUseId: 'task-1' },
    });

    const result = project([root, sub]);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]?.lane.subagentTurnId).toBeNull();
    expect(result.toolCalls[1]?.lane).toEqual({
      subagentTurnId: 'sub-1',
      providerThreadId: null,
      parentToolUseId: 'task-1',
    });
  });

  it('summarizes calls missing a tool name or arguments without inventing either', () => {
    const noName = tool({ toolName: null, input: null });
    const cutArgs = tool({ toolName: 'Edit', input: text('{"file_path":"/a', 400) });

    const result = project([noName, cutArgs]);

    expect(result.toolCalls[0]).toMatchObject({
      toolName: null,
      summary: 'Tool call',
      detail: { input: null },
    });
    expect(result.toolCalls[1]?.summary).toBe('Edit');
    expect(result.toolCalls[1]?.detail.input).toEqual({
      text: '{"file_path":"/a',
      truncated: true,
    });
  });

  it('marks source truncation and reports the history gap', () => {
    const result = projectLatestTurnToolCalls({
      runId: RUN_ID,
      activeTurnId: null,
      activity: activity([tool({ result: text('partial', 12), output: text('tail', 3) })], 7),
    });

    expect(result.evictedCount).toBe(7);
    expect(result.toolCalls[0]?.detail.result).toEqual({ text: 'partial', truncated: true });
    expect(result.toolCalls[0]?.detail.output).toEqual({ text: 'tail', truncated: true });
  });

  it('bounds one-line summaries', () => {
    const result = project([
      tool({ input: text(JSON.stringify({ command: `echo ${'x'.repeat(500)}\n  done` })) }),
    ]);

    const summary = result.toolCalls[0]?.summary ?? '';
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).not.toContain('\n');
  });
});

describe('fitToolCallsToBudget', () => {
  // Quotes, backslashes and newlines expand when serialized, so only a serialized-size check is honest.
  const escapeHeavy = (length: number): string =>
    '"\\\n'.repeat(Math.ceil(length / 3)).slice(0, length);

  const heavyCalls = (count: number, detailBytes: number) =>
    Array.from({ length: count }, (_, index) =>
      tool({
        toolUseId: `call-${String(index)}`,
        input: text(escapeHeavy(detailBytes)),
        output: text(escapeHeavy(detailBytes)),
        result: text(escapeHeavy(detailBytes)),
      }),
    );

  it('leaves a result that already fits untouched', () => {
    const result = project([tool()]);

    expect(fitToolCallsToBudget(result, MAX_TOOL_CALLS_RESULT_BYTES)).toBe(result);
  });

  it('trims detail first, keeping every call and marking the cut', () => {
    const result = project(heavyCalls(10, 16_000), null, 10_000_000);
    const budget = 60_000;

    const fitted = fitToolCallsToBudget(result, budget);

    expect(size(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted.toolCalls).toHaveLength(10);
    expect(fitted.omittedEarlierCount).toBe(0);
    expect(fitted.toolCalls[0]?.detail.result?.truncated).toBe(true);
    expect(fitted.toolCalls.every((call) => call.summary.length > 0)).toBe(true);
  });

  it('drops the earliest calls and counts them once detail alone cannot fit', () => {
    const result = project(heavyCalls(40, 16_000), null, 10_000_000);
    const budget = 8_000;

    const fitted = fitToolCallsToBudget(result, budget);

    expect(size(fitted)).toBeLessThanOrEqual(budget);
    expect(fitted.omittedEarlierCount).toBeGreaterThan(0);
    expect(fitted.toolCalls.length + fitted.omittedEarlierCount).toBe(40);
    expect(fitted.toolCalls.at(-1)?.toolUseId).toBe('call-39');
    expect(fitted.toolCalls[0]?.toolUseId).toBe(`call-${String(fitted.omittedEarlierCount)}`);
  });

  it('never exceeds the production budget for a full history of large calls', () => {
    const fitted = project(heavyCalls(400, 16_000));

    expect(size(fitted)).toBeLessThanOrEqual(MAX_TOOL_CALLS_RESULT_BYTES);
  });

  it('fails loudly when not even an empty result fits', () => {
    const result = project(heavyCalls(2, 100), null, 10_000_000);

    expect(() => fitToolCallsToBudget(result, 10)).toThrow(/cannot fit/);
  });
});
