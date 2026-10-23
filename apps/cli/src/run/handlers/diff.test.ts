import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleDiff } from './diff';
import { makeDeps, makeTestRun } from './__test-utils';
import type { DiffEvent, LocalAgentOutputEvent } from '../types';

const providerDiff = (input: {
  provider: 'claude' | 'codex' | 'opencode';
  providerEventType: string;
  files: string[];
  authority: 'confirmed' | 'provisional' | 'diagnostic';
  toolUseId?: string;
}): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'file_diff_detected',
  timestamp: '2026-01-01T00:00:00.000Z',
  sessionId: 'provider-session-1',
  agentId: input.provider,
  payload: {
    messageType: 'provider_event',
    eventType: input.providerEventType,
    routing: { thread_id: 'thread-1', turn_id: 'provider-turn-1' },
    ...(input.toolUseId
      ? {
          all_tool_use_blocks: [
            {
              id: input.toolUseId,
              tool_name: 'Write',
              input: { file_path: input.files[0], content: 'new' },
            },
          ],
        }
      : {}),
    canonical_event: {
      diff: {
        files: input.files,
        diff_blob: 'provider patch',
        delivery_mode: input.authority === 'diagnostic' ? 'batch' : 'incremental',
        attribution_authority: input.authority,
      },
    },
  },
});

describe('handleDiff', () => {
  it('records only confirmed provider file-change evidence', async () => {
    const raw = providerDiff({
      provider: 'codex',
      providerEventType: 'item/completed',
      files: ['src/a.ts'],
      authority: 'confirmed',
    });
    const event = normalizeEvent(raw, 'codex') as DiffEvent;
    const ctx = makeTestRun({ provider: 'codex' });

    await handleDiff(event, ctx, makeDeps());

    expect(ctx.recordFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        provider: 'codex',
        paths: ['src/a.ts'],
        providerThreadId: 'thread-1',
        providerTurnId: 'provider-turn-1',
      }),
    );
    expect(ctx.recordTouchedFile).not.toHaveBeenCalled();
  });

  it('stages Claude Write intent without creating membership', async () => {
    const raw = providerDiff({
      provider: 'claude',
      providerEventType: 'assistant',
      files: ['src/a.ts'],
      authority: 'provisional',
      toolUseId: 'tool-1',
    });
    const event = normalizeEvent(raw, 'claude') as DiffEvent;
    const ctx = makeTestRun();

    await handleDiff(event, ctx, makeDeps());

    expect(ctx.stageFileChanges).toHaveBeenCalledWith([
      expect.objectContaining({ toolUseId: 'tool-1' }),
    ]);
    expect(ctx.recordFileChanges).not.toHaveBeenCalled();
    expect(ctx.pendingDiffs.size).toBe(1);
  });

  it('keeps repository-wide batch snapshots diagnostic', async () => {
    const raw = providerDiff({
      provider: 'codex',
      providerEventType: 'turn/diff/updated',
      files: ['src/unrelated.ts'],
      authority: 'diagnostic',
    });
    const event = normalizeEvent(raw, 'codex') as DiffEvent;
    const ctx = makeTestRun({ provider: 'codex' });

    await handleDiff(event, ctx, makeDeps());

    expect(event.files).toEqual([]);
    expect(ctx.recordFileChanges).not.toHaveBeenCalled();
  });

  it('does not let permission events confirm staged membership', async () => {
    const raw = providerDiff({
      provider: 'claude',
      providerEventType: 'assistant',
      files: ['src/a.ts'],
      authority: 'provisional',
      toolUseId: 'tool-1',
    });
    const event = normalizeEvent(raw, 'claude') as DiffEvent;
    const ctx = makeTestRun();
    await handleDiff(event, ctx, makeDeps());

    expect(ctx.recordFileChanges).not.toHaveBeenCalled();
  });
});
