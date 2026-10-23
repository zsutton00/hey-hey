import { describe, expect, it } from 'vitest';
import type { ProviderEventNormalizationConfig } from '../provider-event-normalization';
import { mapCodexEvent } from './codex-event-mapper';

const baseConfig: ProviderEventNormalizationConfig = {
  validationMode: 'strict',
  maxDiffBlobBytes: 4096,
  trackTools: false,
};

const invoke = (overrides: {
  eventType: string;
  rawEvent: Record<string, unknown>;
  sessionId?: string | null;
  agentId?: string | null;
  timestamp?: string;
}) =>
  mapCodexEvent({
    provider: 'codex',
    runId: 'run-codex-1',
    eventType: overrides.eventType,
    timestamp: overrides.timestamp ?? '2026-06-17T00:00:00.000Z',
    sessionId: overrides.sessionId ?? null,
    agentId: overrides.agentId ?? null,
    rawEvent: overrides.rawEvent,
    config: baseConfig,
  });

describe('codex-event-mapper', () => {
  it('builds the canonical envelope with provider, event_type, timestamp, agent_id, and routing', () => {
    const result = invoke({
      eventType: 'thread/started',
      rawEvent: {
        thread: { id: 'thread-1', sessionId: 'session-1' },
      },
      agentId: 'agent-x',
      timestamp: '2026-06-17T01:02:03.000Z',
    });

    expect(result.payload).toMatchObject({
      messageType: 'provider_event',
      provider: 'codex',
      eventType: 'thread/started',
      timestamp: '2026-06-17T01:02:03.000Z',
      session_id: 'session-1',
      agent_id: 'agent-x',
      canonical_event: {
        schema_version: 1,
        provider: 'codex',
        event_type: 'thread/started',
        timestamp: '2026-06-17T01:02:03.000Z',
        session_id: 'session-1',
        agent_id: 'agent-x',
        routing: { run_id: 'run-codex-1', session_id: 'session-1' },
      },
    });
    expect(result.payload['raw_event']).toEqual({
      thread: { id: 'thread-1', sessionId: 'session-1' },
    });
    expect(result.resolvedEventType).toBe('thread/started');
  });

  it('extracts session id and thread id from thread/started nested thread object', () => {
    const result = invoke({
      eventType: 'thread/started',
      rawEvent: {
        thread: { id: 'thread-abc', sessionId: 'session-xyz' },
      },
      sessionId: null,
    });

    expect(result.payload['session_id']).toBe('session-xyz');
    expect((result.payload['canonical_event'] as Record<string, unknown>)['session_id']).toBe(
      'session-xyz',
    );
    expect((result.payload['routing'] as Record<string, unknown>)['thread_id']).toBe('thread-abc');
    expect(
      (
        (result.payload['canonical_event'] as Record<string, unknown>)['routing'] as Record<
          string,
          unknown
        >
      )['thread_id'],
    ).toBe('thread-abc');
  });

  it('does not coerce a session id when a non-thread/started notification carries none', () => {
    const result = invoke({
      eventType: 'turn/started',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1' } },
      sessionId: null,
    });

    expect(result.payload['session_id']).toBeNull();
    expect((result.payload['canonical_event'] as Record<string, unknown>)['session_id']).toBeNull();
  });

  it('falls back to the input sessionId when the notification carries none', () => {
    const result = invoke({
      eventType: 'turn/started',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1' } },
      sessionId: 'fallback-session',
    });

    expect(result.payload['session_id']).toBe('fallback-session');
  });

  it('routes turn_id from turn.id on turn/started', () => {
    const result = invoke({
      eventType: 'turn/started',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-99' } },
    });

    expect((result.payload['routing'] as Record<string, unknown>)['turn_id']).toBe('turn-99');
    expect(
      (
        (result.payload['canonical_event'] as Record<string, unknown>)['routing'] as Record<
          string,
          unknown
        >
      )['turn_id'],
    ).toBe('turn-99');
  });

  it('routes turn_id from turnId on item/started', () => {
    const result = invoke({
      eventType: 'item/started',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-42',
        item: { id: 'item-1', type: 'agentMessage' },
        startedAtMs: 1000,
      },
    });

    expect((result.payload['routing'] as Record<string, unknown>)['turn_id']).toBe('turn-42');
  });

  it('routes item_id from item.id on item/started', () => {
    const result = invoke({
      eventType: 'item/started',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'item-abc', type: 'agentMessage' },
        startedAtMs: 1000,
      },
    });

    expect((result.payload['routing'] as Record<string, unknown>)['item_id']).toBe('item-abc');
  });

  it('routes item_id from itemId on item/agentMessage/delta', () => {
    const result = invoke({
      eventType: 'item/agentMessage/delta',
      rawEvent: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-delta', delta: 'Hello' },
    });

    expect((result.payload['routing'] as Record<string, unknown>)['item_id']).toBe('item-delta');
  });

  it('passes through thread/tokenUsage/updated with raw payload preserved', () => {
    const rawEvent = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    const result = invoke({ eventType: 'thread/tokenUsage/updated', rawEvent });

    expect(result.payload['canonical_event_type']).toBe('unknown');
    expect(result.payload['raw_event']).toEqual(rawEvent);
    expect(result.resolvedEventType).toBe('thread/tokenUsage/updated');
  });

  it('yields the unknown-canonical fallback for unrecognized methods', () => {
    const result = invoke({
      eventType: 'something/brand/new',
      rawEvent: { foo: 'bar' },
    });

    expect(result.diagnostics.canonicalEventType).toBe('unknown');
    expect(result.payload['canonical_event_type']).toBe('unknown');
    expect(result.diagnostics.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('unrecognized codex event type')]),
    );
    expect(result.resolvedEventType).toBe('something/brand/new');
  });

  it('dispatches over representative ServerNotification methods without throwing', () => {
    const methods = [
      'thread/started',
      'turn/started',
      'turn/completed',
      'item/started',
      'item/completed',
      'item/agentMessage/delta',
      'item/plan/delta',
      'thread/tokenUsage/updated',
      'thread/compacted',
      'error',
      'unknown/method',
    ];
    for (const eventType of methods) {
      const result = invoke({ eventType, rawEvent: { type: eventType } });
      expect(result.payload['eventType']).toBe(eventType);
    }
  });

  it('maps thread/started to a canonical status event without inventing identity', () => {
    const result = invoke({
      eventType: 'thread/started',
      rawEvent: { thread: { id: 'thread-1', sessionId: 'session-1' } },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.payload['canonical_event_type']).toBe('status');
    expect(result.assistantText).toBeUndefined();
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.isTerminal).toBeUndefined();
    expect(result.payload['session_id']).toBe('session-1');
    expect((result.payload['routing'] as Record<string, unknown>)['thread_id']).toBe('thread-1');
  });

  it('maps turn/started to a non-terminal status event', () => {
    const result = invoke({
      eventType: 'turn/started',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.isTerminal).toBeUndefined();
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('turn_started');
  });

  it('maps turn/completed (status=completed) to a terminal status event', () => {
    const result = invoke({
      eventType: 'turn/completed',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    });
    expect(result.isTerminal).toBe(true);
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('complete');
  });

  it('maps turn/completed (status=interrupted) to a terminal aborted status event', () => {
    const result = invoke({
      eventType: 'turn/completed',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
    });
    expect(result.isTerminal).toBe(true);
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('aborted');
  });

  it('maps turn/completed (status=failed) to a terminal failed status event', () => {
    const result = invoke({
      eventType: 'turn/completed',
      rawEvent: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed' } },
    });
    expect(result.isTerminal).toBe(true);
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('failed');
  });

  it('maps thread/compacted to a non-terminal status event with compact_boundary state', () => {
    const result = invoke({
      eventType: 'thread/compacted',
      rawEvent: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.payload['canonical_event_type']).toBe('status');
    expect(result.isTerminal).toBeUndefined();
    expect(result.assistantText).toBeUndefined();
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.resolvedEventType).toBe('thread/compacted');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect(canonical['status']).toEqual({
      state: 'compact_boundary',
      phase: null,
      code: null,
      message: null,
    });
  });

  it('routes thread/compacted identity from native thread_id / turn_id params', () => {
    const result = invoke({
      eventType: 'thread/compacted',
      rawEvent: { threadId: 'thread-abc', turnId: 'turn-xyz' },
    });
    const routing = result.payload['routing'] as Record<string, unknown>;
    expect(routing['thread_id']).toBe('thread-abc');
    expect(routing['turn_id']).toBe('turn-xyz');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const canonicalRouting = canonical['routing'] as Record<string, unknown>;
    expect(canonicalRouting['thread_id']).toBe('thread-abc');
    expect(canonicalRouting['turn_id']).toBe('turn-xyz');
  });

  it('does not invent a session id on thread/compacted when none is carried', () => {
    const result = invoke({
      eventType: 'thread/compacted',
      rawEvent: { threadId: 'thread-1', turnId: 'turn-1' },
      sessionId: null,
    });
    expect(result.payload['session_id']).toBeNull();
    expect((result.payload['canonical_event'] as Record<string, unknown>)['session_id']).toBeNull();
  });

  it('emits assistantTextDelta on item/agentMessage/delta', () => {
    const result = invoke({
      eventType: 'item/agentMessage/delta',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'Hello, ',
      },
    });
    expect(result.assistantTextDelta).toBe('Hello, ');
    expect(result.assistantText).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('assistant');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe('Hello, ');
  });

  it('emits assistantTextDelta on item/plan/delta with native routing preserved', () => {
    const rawEvent = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'plan-item-1',
      delta: '1. Inspect mapper\n',
    };
    const result = invoke({
      eventType: 'item/plan/delta',
      rawEvent,
    });

    expect(result.assistantTextDelta).toBe('1. Inspect mapper\n');
    expect(result.assistantText).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('agent_output_delta');
    expect(result.payload['raw_event']).toEqual(rawEvent);
    expect((result.payload['routing'] as Record<string, unknown>)['thread_id']).toBe('thread-1');
    expect((result.payload['routing'] as Record<string, unknown>)['turn_id']).toBe('turn-1');
    expect((result.payload['routing'] as Record<string, unknown>)['item_id']).toBe('plan-item-1');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('assistant');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe('1. Inspect mapper\n');
  });

  it('keeps empty item/plan/delta as assistant status without placeholder output', () => {
    const result = invoke({
      eventType: 'item/plan/delta',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'plan-item-empty',
        delta: '',
      },
    });

    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.assistantText).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['message']).toBeNull();
  });

  it('flushes assistantText on item/completed with agentMessage details', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 1000,
        item: {
          type: 'agentMessage',
          id: 'item-1',
          text: 'Hello, world!',
          phase: null,
          memoryCitation: null,
        },
      },
    });
    expect(result.assistantText).toEqual({
      kind: 'text',
      text: 'Hello, world!',
      isFinal: true,
    });
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
  });

  it('flushes assistantText on completed plan items with native routing preserved', () => {
    const rawEvent = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      completedAtMs: 1000,
      item: {
        type: 'plan',
        id: 'plan-item-1',
        text: '1. Inspect mapper\n2. Add coverage',
      },
    };
    const result = invoke({
      eventType: 'item/completed',
      rawEvent,
    });

    expect(result.assistantText).toEqual({
      kind: 'text',
      text: '1. Inspect mapper\n2. Add coverage',
      isFinal: true,
    });
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('agent_message');
    expect(result.payload['raw_event']).toEqual(rawEvent);
    expect((result.payload['routing'] as Record<string, unknown>)['thread_id']).toBe('thread-1');
    expect((result.payload['routing'] as Record<string, unknown>)['turn_id']).toBe('turn-1');
    expect((result.payload['routing'] as Record<string, unknown>)['item_id']).toBe('plan-item-1');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('assistant');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe(
      '1. Inspect mapper\n2. Add coverage',
    );
  });

  it('reads completed plan text from string-array plan content', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'plan',
          id: 'plan-item-array',
          content: ['1. Inspect mapper', '2. Add coverage'],
        },
      },
    });

    expect(result.assistantText).toEqual({
      kind: 'text',
      text: '1. Inspect mapper\n2. Add coverage',
      isFinal: true,
    });
  });

  it('keeps malformed completed plan items as assistant status without placeholder output', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'plan',
          id: 'plan-item-malformed',
          content: [{ step: 'not a string' }],
        },
      },
    });

    expect(result.assistantText).toBeUndefined();
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('assistant');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBeNull();
  });

  it('emits status state=reasoning for reasoning text deltas without flushing assistantText', () => {
    const result = invoke({
      eventType: 'item/reasoning/textDelta',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'I should...',
        contentIndex: 0,
      },
    });
    expect(result.assistantText).toBeUndefined();
    expect(result.assistantTextDelta).toBeUndefined();
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('reasoning');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe('I should...');
  });

  it('emits status state=reasoning for reasoning summary text deltas', () => {
    const result = invoke({
      eventType: 'item/reasoning/summaryTextDelta',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'Summary chunk',
        summaryIndex: 0,
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('reasoning');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe('Summary chunk');
  });

  it('flushes assistantText with kind=reasoning on item/completed for reasoning', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        completedAtMs: 1000,
        item: {
          type: 'reasoning',
          id: 'item-1',
          content: ['First line.', 'Second line.'],
          summary: ['Brief summary.'],
        },
      },
    });
    expect(result.assistantText).toEqual({
      kind: 'reasoning',
      text: 'First line.\nSecond line.\nBrief summary.',
      isFinal: true,
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('reasoning');
  });

  it('emits an all_tool_use_blocks entry on item/started for commandExecution', () => {
    const result = invoke({
      eventType: 'item/started',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'item-1',
          command: 'ls -la',
          cwd: '/tmp',
        },
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const blocks = result.payload['all_tool_use_blocks'] as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'item-1',
      tool_name: 'shell',
      input: { command: 'ls -la', cwd: '/tmp' },
    });
    expect(result.resolvedEventType).toBe('tool_use');
  });

  it('emits an all_tool_result_blocks entry on item/completed for commandExecution', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'item-1',
          command: 'ls',
          cwd: '/tmp',
          status: 'completed',
          aggregatedOutput: 'file-a\nfile-b\n',
          exitCode: 0,
        },
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    const results = result.payload['all_tool_result_blocks'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      tool_use_id: 'item-1',
      is_error: false,
      content_text: 'file-a\nfile-b\n',
    });
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('completed');
  });

  it('marks tool result as error when exit_code is non-zero', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'item-1',
          command: 'false',
          cwd: '/tmp',
          status: 'completed',
          aggregatedOutput: '',
          exitCode: 1,
        },
      },
    });
    const results = result.payload['all_tool_result_blocks'] as Array<Record<string, unknown>>;
    expect(results[0]?.['is_error']).toBe(true);
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('failed');
  });

  it('marks tool result as error when status is failed', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'item-1',
          command: 'cat /missing',
          cwd: '/tmp',
          status: 'failed',
          aggregatedOutput: 'No such file',
          exitCode: null,
        },
      },
    });
    const results = result.payload['all_tool_result_blocks'] as Array<Record<string, unknown>>;
    expect(results[0]?.['is_error']).toBe(true);
  });

  it('maps item/commandExecution/outputDelta to a tool-progress processing_status', () => {
    const result = invoke({
      eventType: 'item/commandExecution/outputDelta',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        chunk: 'partial output\n',
        stream: 'stdout',
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('processing_status');
    expect(result.payload['kind']).toBe('tool.progress');
    expect(result.payload['toolName']).toBe('shell');
    expect(result.payload['toolPhase']).toBe('stdout');
    expect((result.payload['routing'] as Record<string, unknown>)['item_id']).toBe('item-1');
  });

  it('maps mcpToolCall item/started + item/completed through the tool-use lifecycle', () => {
    const started = invoke({
      eventType: 'item/started',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-mcp-1',
          server: 'heyhey-platform',
          tool: 'get_context',
          arguments: { entityId: 'abc', entityType: 'TASK' },
        },
      },
    });
    const useBlocks = started.payload['all_tool_use_blocks'] as Array<Record<string, unknown>>;
    expect(useBlocks).toHaveLength(1);
    expect(useBlocks[0]).toMatchObject({
      id: 'item-mcp-1',
      tool_name: 'heyhey-platform/get_context',
      input: { entityId: 'abc', entityType: 'TASK' },
    });

    const completed = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-mcp-1',
          server: 'heyhey-platform',
          tool: 'get_context',
          status: 'completed',
          result: { ok: true },
        },
      },
    });
    const resultBlocks = completed.payload['all_tool_result_blocks'] as Array<
      Record<string, unknown>
    >;
    expect(resultBlocks).toHaveLength(1);
    expect(resultBlocks[0]).toMatchObject({
      tool_use_id: 'item-mcp-1',
      is_error: false,
    });
    expect(resultBlocks[0]?.['content_text']).toBe(JSON.stringify({ ok: true }));
  });

  it('maps item/completed with fileChange to a canonical diff event', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'fileChange',
          id: 'item-file-1',
          status: 'completed',
          changes: [
            { path: 'src/a.ts', kind: 'modified' },
            { path: 'src/b.ts', kind: 'added' },
          ],
        },
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('diff');
    expect(result.resolvedEventType).toBe('file_diff_detected');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonical['diff'] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diff['delivery_mode']).toBe('incremental');
    expect(diff['attribution_authority']).toBe('confirmed');
    expect(result.payload['files']).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('keeps failed fileChange completions diagnostic', () => {
    const result = invoke({
      eventType: 'item/completed',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'fileChange',
          id: 'item-file-failed',
          status: 'failed',
          changes: [{ path: 'src/a.ts', kind: 'modified' }],
        },
      },
    });
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonical['diff'] as Record<string, unknown>;
    expect(diff['attribution_authority']).toBe('diagnostic');
  });

  it('maps turn/diff/updated to a canonical batch diff with files parsed from headers', () => {
    const unifiedDiff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/bar.ts b/src/bar.ts',
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');

    const result = invoke({
      eventType: 'turn/diff/updated',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        unified_diff: unifiedDiff,
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('diff');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonical['diff'] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(diff['delivery_mode']).toBe('batch');
    expect(diff['attribution_authority']).toBe('diagnostic');
    expect(diff['diff_blob']).toBe(unifiedDiff);
    const truncation = diff['truncation'] as Record<string, unknown>;
    expect(truncation['truncated']).toBe(false);
  });

  it('maps turn/diff/updated raw diff to canonical files when files are empty', () => {
    const rawDiff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/bar.ts b/src/bar.ts',
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');

    const result = invoke({
      eventType: 'turn/diff/updated',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        files: [],
        diff: rawDiff,
      },
    });

    expect(result.diagnostics.canonicalEventType).toBe('diff');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonical['diff'] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(diff['delivery_mode']).toBe('batch');
    expect(diff['attribution_authority']).toBe('diagnostic');
    expect(diff['diff_blob']).toBe(rawDiff);
  });

  it('truncates turn/diff/updated unified_diff to maxDiffBlobBytes', () => {
    const filler = 'x'.repeat(8192);
    const unifiedDiff = `--- a/big.ts\n+++ b/big.ts\n@@ -1 +1 @@\n+${filler}\n`;
    const result = mapCodexEvent({
      provider: 'codex',
      runId: 'run-codex-1',
      eventType: 'turn/diff/updated',
      timestamp: '2026-06-17T00:00:00.000Z',
      sessionId: 'session-1',
      agentId: null,
      rawEvent: { threadId: 'thread-1', turnId: 'turn-1', unified_diff: unifiedDiff },
      config: { ...baseConfig, maxDiffBlobBytes: 1024 },
    });
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonical['diff'] as Record<string, unknown>;
    const truncation = diff['truncation'] as Record<string, unknown>;
    expect(truncation['truncated']).toBe(true);
    expect(truncation['overflow']).toBe(true);
    expect(truncation['max_size_bytes']).toBe(1024);
    expect(Buffer.byteLength(diff['diff_blob'] as string, 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('maps item/commandExecution/requestApproval to a command_execution permission_request', () => {
    const result = invoke({
      eventType: 'item/commandExecution/requestApproval',
      rawEvent: {
        id: 'req-1',
        params: { command: 'ls -la', cwd: '/tmp', reason: 'needs listing' },
      },
      sessionId: 'session-abc',
    });
    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['permission_request'] as Record<string, unknown>)['id']).toBe('req-1');
    expect((canonical['permission_request'] as Record<string, unknown>)['permission_type']).toBe(
      'command_execution',
    );
    expect(canonical['permission_request']).toMatchObject({
      action: 'exec',
      target: 'ls -la',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe('req-1');
    expect(pr['id']).toBe('req-1');
    expect(pr['permission_type']).toBe('command_execution');
    expect(pr['agent_type']).toBe('codex');
    expect(pr['agent_id']).toBe('codex');
    expect(pr['session_id']).toBe('session-abc');
    expect(result.payload['command']).toBe('ls -la');
    expect(result.payload['cwd']).toBe('/tmp');
  });

  it('derives a stable exact-action fingerprint independent of parameter key order', () => {
    const first = invoke({
      eventType: 'item/commandExecution/requestApproval',
      rawEvent: {
        id: 'req-stable',
        params: { command: ['pnpm', 'test'], cwd: '/workspace' },
      },
      sessionId: 'session-abc',
    });
    const replay = invoke({
      eventType: 'item/commandExecution/requestApproval',
      rawEvent: {
        id: 'req-stable',
        params: { cwd: '/workspace', command: ['pnpm', 'test'] },
      },
      sessionId: 'session-abc',
    });

    const firstRequest = (first.payload['canonical_event'] as Record<string, unknown>)[
      'permission_request'
    ] as Record<string, unknown>;
    const replayRequest = (replay.payload['canonical_event'] as Record<string, unknown>)[
      'permission_request'
    ] as Record<string, unknown>;
    expect(replayRequest['fingerprint']).toBe(firstRequest['fingerprint']);
  });

  it('maps item/fileChange/requestApproval to a file_change permission_request', () => {
    const result = invoke({
      eventType: 'item/fileChange/requestApproval',
      rawEvent: { id: 'req-2', params: { grantRoot: '/project', reason: 'apply patch' } },
      sessionId: 'session-abc',
    });
    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe('req-2');
    expect(pr['permission_type']).toBe('file_change');
    expect(pr['agent_type']).toBe('codex');
    expect((result.payload['canonical_event'] as Record<string, unknown>)['permission_request']).toMatchObject({
      action: 'apply_patch',
      target: '/project',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('maps item/permissions/requestApproval to a command_execution permission_request', () => {
    const result = invoke({
      eventType: 'item/permissions/requestApproval',
      rawEvent: { id: 'req-3', params: { cwd: '/workspace', reason: null, permissions: {} } },
      sessionId: 'session-abc',
    });
    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe('req-3');
    expect(pr['permission_type']).toBe('command_execution');
    expect(pr['agent_type']).toBe('codex');
    expect(result.payload['cwd']).toBe('/workspace');
    expect((result.payload['canonical_event'] as Record<string, unknown>)['permission_request']).toMatchObject({
      action: 'grant_permissions',
      target: '/workspace {}',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('maps execCommandApproval to a command_execution permission_request with command as array', () => {
    const result = invoke({
      eventType: 'execCommandApproval',
      rawEvent: {
        id: 42,
        params: {
          command: ['git', 'commit', '-m', 'msg'],
          cwd: '/repo',
          approvalId: null,
          reason: 'commit',
        },
      },
      sessionId: 'session-abc',
    });
    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe(42);
    expect(pr['id']).toBe('42');
    expect(pr['permission_type']).toBe('command_execution');
    expect(pr['agent_type']).toBe('codex');
    expect(Array.isArray(result.payload['command'])).toBe(true);
    expect(result.payload['command']).toEqual(['git', 'commit', '-m', 'msg']);
    expect((result.payload['canonical_event'] as Record<string, unknown>)['permission_request']).toMatchObject({
      action: 'exec',
      target: 'git commit -m msg',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('maps applyPatchApproval to a file_change permission_request with changes', () => {
    const fileChanges = { 'src/a.ts': { type: 'update', unified_diff: '--- old\n+++ new' } };
    const result = invoke({
      eventType: 'applyPatchApproval',
      rawEvent: { id: 'req-5', params: { fileChanges, grantRoot: null } },
      sessionId: 'session-abc',
    });
    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe('req-5');
    expect(pr['permission_type']).toBe('file_change');
    expect(pr['agent_type']).toBe('codex');
    expect(result.payload['changes']).toEqual(fileChanges);
    expect((result.payload['canonical_event'] as Record<string, unknown>)['permission_request']).toMatchObject({
      action: 'apply_patch',
      target: 'src/a.ts',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('maps mcpServer/elicitation/request tool approvals to an MCP tool permission_request', () => {
    const result = invoke({
      eventType: 'mcpServer/elicitation/request',
      rawEvent: {
        id: 9,
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow this request?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_name: 'get_context',
            tool_params: { entityId: 'task-1' },
          },
          requestedSchema: { type: 'object', properties: {} },
        },
      },
      sessionId: 'session-abc',
    });

    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.resolvedEventType).toBe('permission_request_detected');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['requestId']).toBe(9);
    expect(pr['id']).toBe('9');
    expect(pr['permission_type']).toBe('mcp__heyhey-platform__get_context');
    expect(pr['agent_type']).toBe('codex');
    expect(result.payload['tool_name']).toBe('mcp__heyhey-platform__get_context');
    expect(result.payload['tool_input']).toEqual({ entityId: 'task-1' });
    expect((result.payload['canonical_event'] as Record<string, unknown>)['permission_request']).toMatchObject({
      action: 'mcp_tool_call',
      target: 'mcp__heyhey-platform__get_context',
      created_at: '2026-06-17T00:00:00.000Z',
      expires_at: '2026-06-17T00:05:00.000Z',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it('maps message-only mcpServer/elicitation/request tool approvals to an MCP tool permission_request', () => {
    const result = invoke({
      eventType: 'mcpServer/elicitation/request',
      rawEvent: {
        id: 12,
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow the heyhey-platform MCP server to run tool "get_edges"?',
          requestedSchema: { type: 'object', properties: {} },
        },
      },
      sessionId: 'session-abc',
    });

    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['permission_type']).toBe('mcp__heyhey-platform__get_edges');
    expect(result.payload['tool_name']).toBe('mcp__heyhey-platform__get_edges');
    expect((result.payload['enrichment_metadata'] as Record<string, unknown>)['reason']).toBe(
      'Allow the heyhey-platform MCP server to run tool "get_edges"?',
    );
  });

  it('maps nested mcpServer/elicitation/request payloads to an MCP tool permission_request', () => {
    const result = invoke({
      eventType: 'mcpServer/elicitation/request',
      rawEvent: {
        id: 'nested-1',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          request: {
            mode: 'form',
            message: 'Allow this request?',
            _meta: {
              codex_approval_kind: 'mcp_tool_call',
              tool_name: 'unified_search',
              tool_params: { query: 'abc' },
            },
            requestedSchema: { type: 'object', properties: {} },
          },
        },
      },
      sessionId: 'session-abc',
    });

    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.diagnostics.success).toBe(true);
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['permission_type']).toBe('mcp__heyhey-platform__unified_search');
    expect(result.payload['tool_input']).toEqual({ query: 'abc' });
  });

  it('maps malformed mcpServer/elicitation/request to a permission_request with validation errors', () => {
    const result = invoke({
      eventType: 'mcpServer/elicitation/request',
      rawEvent: {
        params: {
          serverName: 'external-server',
          message: 'Provide extra input.',
        },
      },
      sessionId: 'session-abc',
    });

    expect(result.diagnostics.canonicalEventType).toBe('permission_request');
    expect(result.diagnostics.success).toBe(false);
    expect(result.diagnostics.errors).toContain('permission_request.id is required');
    const pr = result.payload['permission_request'] as Record<string, unknown>;
    expect(pr['permission_type']).toBe('mcp_elicitation');
  });

  it('maps error notification to a canonical status error event reading error.message', () => {
    const result = invoke({
      eventType: 'error',
      rawEvent: {
        error: { message: 'something went wrong', codexErrorInfo: {} },
        willRetry: false,
      },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('error');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('error');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe(
      'something went wrong',
    );
  });

  it('maps warning notification to a canonical status warning event', () => {
    const result = invoke({
      eventType: 'warning',
      rawEvent: { threadId: 'thread-1', message: 'rate limit approaching' },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('warning');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('warning');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe(
      'rate limit approaching',
    );
  });

  it('maps guardianWarning notification to a canonical status warning event', () => {
    const result = invoke({
      eventType: 'guardianWarning',
      rawEvent: { threadId: 'thread-1', message: 'policy violation detected' },
    });
    expect(result.diagnostics.canonicalEventType).toBe('status');
    expect(result.resolvedEventType).toBe('guardianWarning');
    const canonical = result.payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['status'] as Record<string, unknown>)['state']).toBe('warning');
    expect((canonical['status'] as Record<string, unknown>)['message']).toBe(
      'policy violation detected',
    );
  });
});
