import { afterEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from './debounce';

describe('Debouncer', () => {
  afterEach(() => vi.useRealTimers());

  it('admits the first fire for a key and suppresses repeats within the cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const debouncer = new Debouncer();

    expect(debouncer.shouldTrigger('k', 1000)).toBe(true);
    vi.setSystemTime(500);
    expect(debouncer.shouldTrigger('k', 1000)).toBe(false);
    vi.setSystemTime(1000);
    expect(debouncer.shouldTrigger('k', 1000)).toBe(true);
  });

  it('tracks keys independently', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const debouncer = new Debouncer();

    expect(debouncer.shouldTrigger('a', 1000)).toBe(true);
    expect(debouncer.shouldTrigger('b', 1000)).toBe(true);
  });

  it('forgets entries older than maxAge on cleanup', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const debouncer = new Debouncer();

    debouncer.shouldTrigger('k', 10_000);
    vi.setSystemTime(400_000);
    debouncer.cleanup(300_000);
    // The stale entry was dropped, so the same key fires again immediately.
    expect(debouncer.shouldTrigger('k', 10_000)).toBe(true);
  });
});
