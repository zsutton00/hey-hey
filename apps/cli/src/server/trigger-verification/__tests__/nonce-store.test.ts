import { describe, expect, it } from 'vitest';

import { NonceStore } from '../nonce-store';

describe('NonceStore', () => {
  it('records a fresh nonce and rejects a replay within the TTL', () => {
    let now = 1000;
    const store = new NonceStore({ ttlMs: 30_000, now: () => now });

    expect(store.recordIfFresh('n1')).toBe(true);
    expect(store.recordIfFresh('n1')).toBe(false);

    now += 1000;
    expect(store.recordIfFresh('n1')).toBe(false);
  });

  it('allows the same nonce again once its TTL has expired', () => {
    let now = 1000;
    const store = new NonceStore({ ttlMs: 30_000, now: () => now });

    store.recordIfFresh('n1');
    now += 30_001;
    expect(store.recordIfFresh('n1')).toBe(true);
  });

  it('treats different nonces as independent', () => {
    const store = new NonceStore({ ttlMs: 30_000 });
    expect(store.recordIfFresh('a')).toBe(true);
    expect(store.recordIfFresh('b')).toBe(true);
    expect(store.recordIfFresh('a')).toBe(false);
  });
});
