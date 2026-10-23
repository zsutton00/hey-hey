import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollingDispatchSource } from './dispatch-source';
import type { ServerLogger } from './logger';

afterEach(() => {
  vi.useRealTimers();
});

const createSource = (poll: () => Promise<string | null>) => {
  const logger = { warn: vi.fn() };
  const source = new PollingDispatchSource({
    intervalMs: 5_000,
    poll,
    logger: logger as unknown as ServerLogger,
    failureEvent: 'test.poll_failed',
  });
  return { source, logger };
};

describe('PollingDispatchSource', () => {
  it('polls on subscribe and then every interval until disposed', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async () => 'work');
    const onWork = vi.fn(async () => undefined);
    const subscription = createSource(poll).source.subscribe(onWork);

    await vi.advanceTimersByTimeAsync(0);
    expect(onWork).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onWork).toHaveBeenCalledTimes(2);
    expect(onWork).toHaveBeenLastCalledWith('work');

    subscription.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the previous poll is still delivering', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const poll = vi.fn(async () => 'work');
    const onWork = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const subscription = createSource(poll).source.subscribe(onWork);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(2);
    subscription.dispose();
  });

  it('delivers nothing for an empty poll and logs failures without stopping', async () => {
    vi.useFakeTimers();
    const poll = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('api down'))
      .mockResolvedValue('work');
    const onWork = vi.fn(async () => undefined);
    const { source, logger } = createSource(poll);
    const subscription = source.subscribe(onWork);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(logger.warn).toHaveBeenCalledWith('test.poll_failed', { error: 'api down' });
    expect(onWork).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
});
