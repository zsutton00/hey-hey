import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handleProcessingStatus } from './processing-status';
import { makeDeps, makeTestRun } from './__test-utils';
import type { LocalAgentOutputEvent, ProcessingStatusEvent } from '../types';

const makeRawProcessingStatus = (fields: Record<string, string>): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'local',
  eventType: 'processing_status',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: null,
  agentId: null,
  payload: fields,
});

describe('processing_status end-to-end', () => {
  it('normalizes to ProcessingStatusEvent with typed fields', () => {
    const event = normalizeEvent(
      makeRawProcessingStatus({
        loadingText: 'Thinking...',
        toolName: 'read_file',
        toolPhase: 'running',
      }),
      'claude',
    );
    expect(event.kind).toBe('processing_status');
    const typed = event as ProcessingStatusEvent;
    expect(typed.loadingText).toBe('Thinking...');
    expect(typed.toolName).toBe('read_file');
    expect(typed.toolPhase).toBe('running');
  });

  it('normalizes every conversation phase contract value when present', () => {
    const phases = ['starting', 'thinking', 'writing', 'awaiting_approval', 'idle'] as const;

    for (const phase of phases) {
      const event = normalizeEvent(
        makeRawProcessingStatus({ loadingText: 'Phase update', phase }),
        'claude',
      ) as ProcessingStatusEvent;
      expect(event.phase).toBe(phase);
    }
  });

  it('omits phase field when not present', () => {
    const event = normalizeEvent(
      makeRawProcessingStatus({ loadingText: 'Thinking...' }),
      'claude',
    ) as ProcessingStatusEvent;
    expect(event.phase).toBeUndefined();
  });

  it('emits conversation phase upstream when event.phase is set', () => {
    const event = normalizeEvent(
      makeRawProcessingStatus({ loadingText: 'Starting...', phase: 'starting' }),
      'claude',
    ) as ProcessingStatusEvent;
    const deps = makeDeps();
    const ctx = makeTestRun();

    handleProcessingStatus(event, ctx, deps);

    expect(ctx.observeProviderPhase).toHaveBeenCalledOnce();
    expect(ctx.observeProviderPhase).toHaveBeenCalledWith('starting');
  });

  it('does not emit conversation phase when event.phase is absent', () => {
    const event = normalizeEvent(
      makeRawProcessingStatus({ loadingText: 'Thinking...' }),
      'claude',
    ) as ProcessingStatusEvent;
    const deps = makeDeps();
    const ctx = makeTestRun();

    handleProcessingStatus(event, ctx, deps);

    expect(ctx.observeProviderPhase).not.toHaveBeenCalled();
  });
});
