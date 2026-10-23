import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../logger';
import { OperationTimelineRegistry } from './operation-timeline';

describe('OperationTimelineRegistry', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the first timestamp for each mark and resolves turn aliases', () => {
    let now = 10;
    const logger = { ...NOOP_LOGGER, info: vi.fn() };
    const timeline = new OperationTimelineRegistry(logger, () => now);
    timeline.register({
      key: 'operation-1',
      keyKind: 'operation',
      receivedAt: '2026-09-29T00:00:00.000Z',
      origin: now,
    });

    now = 20;
    timeline.mark('operation-1', 'verified');
    now = 30;
    timeline.mark('operation-1', 'verified');
    timeline.aliasTurnId('operation-1', 'turn-1');
    timeline.mark('turn-1', 'pickedUp');
    timeline.recordDuration('turn-1', 'workspaceMs', 2);
    timeline.recordDuration('operation-1', 'workspaceMs', 3);

    timeline.emit('turn-1', 'provider_output');

    expect(logger.info).toHaveBeenCalledWith(
      'agent_operation.timeline',
      expect.objectContaining({
        key: 'operation-1',
        turnId: 'turn-1',
        marks: { received: 0, verified: 10, pickedUp: 20 },
        durations: { workspaceMs: 5 },
      }),
    );
  });

  it('emits once and removes both key and turn aliases', () => {
    const logger = { ...NOOP_LOGGER, info: vi.fn() };
    const timeline = new OperationTimelineRegistry(logger, () => 1);
    timeline.register({
      key: 'operation-2',
      keyKind: 'operation',
      receivedAt: '2026-09-29T00:00:00.000Z',
      origin: 1,
    });
    timeline.aliasTurnId('operation-2', 'turn-2');

    timeline.emit('turn-2', 'rejected');
    timeline.emit('operation-2', 'failed');

    expect(logger.info).toHaveBeenCalledOnce();
    expect(timeline.has('operation-2')).toBe(false);
    expect(timeline.has('turn-2')).toBe(false);
  });

  it('evicts an entry that has not emitted after ten minutes', () => {
    vi.useFakeTimers();
    const timeline = new OperationTimelineRegistry(NOOP_LOGGER);
    timeline.register({
      key: 'operation-3',
      keyKind: 'trigger_message',
      receivedAt: '2026-09-29T00:00:00.000Z',
      origin: performance.now(),
    });

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(timeline.has('operation-3')).toBe(false);
  });
});
