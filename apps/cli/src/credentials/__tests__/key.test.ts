import { describe, expect, it } from 'vitest';

import { computeStoreKey } from '../key';

describe('computeStoreKey', () => {
  it('produces deterministic keys', () => {
    const key1 = computeStoreKey('server', { type: 'oauth', url: 'https://example.test' });
    const key2 = computeStoreKey('server', { type: 'oauth', url: 'https://example.test' });
    expect(key1).toBe(key2);
  });

  it('changes with different payload', () => {
    const key1 = computeStoreKey('server', { type: 'oauth', url: 'https://example.test' });
    const key2 = computeStoreKey('server', { type: 'oauth', url: 'https://example.test/other' });
    expect(key1).not.toBe(key2);
  });
});
