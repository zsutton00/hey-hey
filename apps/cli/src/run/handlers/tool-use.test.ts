import { describe, expect, it, vi } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleToolResult, handleToolUse } from './tool-use';
import { makeDeps, makeTestRun } from './__test-utils';
import type { LocalAgentOutputEvent, ToolResultEvent, ToolUseEvent } from '../types';

const toolEvent = (input: {
  provider: 'claude' | 'opencode';
  eventType: string;
  isError: boolean;
  includeUse: boolean;
}): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: input.eventType,
  timestamp: '2026-01-01T00:00:00.000Z',
  sessionId: 'provider-session-1',
  agentId: input.provider,
  payload: {
    messageType: 'provider_event',
    routing: { turn_id: 'provider-turn-1' },
    ...(input.includeUse
      ? {
          all_tool_use_blocks: [
            { id: 'tool-1', tool_name: 'write', input: { file_path: 'src/a.ts' } },
          ],
        }
      : {}),
    all_tool_result_blocks: [
      { tool_use_id: 'tool-1', is_error: input.isError, content_text: 'result' },
    ],
  },
});

describe('file-changing tool results', () => {
  it('confirms correlated successful Claude intent', async () => {
    const event = normalizeEvent(
      toolEvent({ provider: 'claude', eventType: 'user', isError: false, includeUse: false }),
      'claude',
    ) as ToolResultEvent;
    const confirmStagedFileChange = vi.fn().mockResolvedValue(undefined);
    const ctx = makeTestRun({ confirmStagedFileChange });

    await handleToolResult(event, ctx, makeDeps());

    expect(confirmStagedFileChange).toHaveBeenCalledWith(
      expect.objectContaining({ toolUseId: 'tool-1', isError: false }),
    );
  });

  it('passes failed Claude results through correlation so the stage is discarded', async () => {
    const event = normalizeEvent(
      toolEvent({ provider: 'claude', eventType: 'user', isError: true, includeUse: false }),
      'claude',
    ) as ToolResultEvent;
    const confirmStagedFileChange = vi.fn().mockResolvedValue(undefined);
    const ctx = makeTestRun({ confirmStagedFileChange });
    await handleToolResult(event, ctx, makeDeps());
    expect(confirmStagedFileChange).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true }),
    );
  });

  it('records successful completed OpenCode file tools directly', async () => {
    const event = normalizeEvent(
      toolEvent({
        provider: 'opencode',
        eventType: 'tool_use',
        isError: false,
        includeUse: true,
      }),
      'opencode',
    ) as ToolUseEvent;
    const recordFileChanges = vi.fn().mockResolvedValue(undefined);
    const ctx = makeTestRun({ provider: 'opencode', recordFileChanges });

    await handleToolUse(event, ctx, makeDeps());

    expect(recordFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'opencode', paths: ['src/a.ts'] }),
    );
  });
});
