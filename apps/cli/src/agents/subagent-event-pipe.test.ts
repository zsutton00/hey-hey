import { describe, expect, it } from 'vitest';
import type { AgentOutputMessage } from './agent-event-stream';
import { emitNormalizedSubagentEvent } from './subagent-event-pipe';

const config = { validationMode: 'strict' as const, maxDiffBlobBytes: 4096, trackTools: false };

describe('emitNormalizedSubagentEvent', () => {
  it('forwards Claude subagent file intent with correlation identity intact', () => {
    const emitted: AgentOutputMessage[] = [];
    emitNormalizedSubagentEvent({
      runId: 'run-1',
      agentId: 'subagent-1',
      onAgentOutput: (message) => emitted.push(message),
      config,
      rawEvent: {
        type: 'assistant',
        session_id: 'subagent-provider-session',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Write',
              input: { file_path: 'src/a.ts', content: 'a' },
            },
          ],
        },
      },
    });

    const event = emitted[0]?.event;
    expect(event?.eventType).toBe('file_diff_detected');
    expect(event?.sessionId).toBe('subagent-provider-session');
    const payload = event?.payload ?? {};
    const canonical = payload['canonical_event'] as Record<string, unknown>;
    expect((canonical['diff'] as Record<string, unknown>)['attribution_authority']).toBe(
      'provisional',
    );
  });

  it('forwards correlated tool results so the parent Run can confirm or discard intent', () => {
    const emitted: AgentOutputMessage[] = [];
    emitNormalizedSubagentEvent({
      runId: 'run-1',
      agentId: 'subagent-1',
      onAgentOutput: (message) => emitted.push(message),
      config,
      rawEvent: {
        type: 'user',
        session_id: 'subagent-provider-session',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: 'ok' }],
        },
      },
    });

    const payload = emitted[0]?.event.payload ?? {};
    expect(payload['all_tool_result_blocks']).toEqual([
      expect.objectContaining({ tool_use_id: 'tool-1', is_error: false }),
    ]);
  });
});
