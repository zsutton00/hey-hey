import { describe, expect, it } from 'vitest';

import { TriggerRateLimiter } from '../rate-limiter';

describe('TriggerRateLimiter', () => {
  it('passes through steady-state consumption below the refill rate', () => {
    let nowMs = 0;
    const limiter = new TriggerRateLimiter({
      capacity: 10,
      refillPerSecond: 5,
      now: () => nowMs,
    });

    // Drain the initial capacity.
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);

    // Wait one second — 5 tokens replenished, so 5 should pass.
    nowMs += 1000;
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it('denies after a burst exceeds capacity', () => {
    let nowMs = 0;
    const limiter = new TriggerRateLimiter({
      capacity: 3,
      refillPerSecond: 1,
      now: () => nowMs,
    });

    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('refills tokens over time and caps at capacity', () => {
    let nowMs = 0;
    const limiter = new TriggerRateLimiter({
      capacity: 4,
      refillPerSecond: 2,
      now: () => nowMs,
    });

    // Drain.
    for (let i = 0; i < 4; i += 1) limiter.tryConsume();
    expect(limiter.tryConsume()).toBe(false);

    // 500ms → 1 token at 2/sec.
    nowMs += 500;
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);

    // Long idle window — bucket should refill but never exceed capacity.
    nowMs += 60_000;
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);
  });
});
