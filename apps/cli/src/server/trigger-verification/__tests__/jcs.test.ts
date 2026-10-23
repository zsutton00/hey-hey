import { describe, expect, it } from 'vitest';

import { canonicalizeJson } from '../jcs';

describe('canonicalizeJson', () => {
  it('sorts object keys lexicographically', () => {
    const out = canonicalizeJson({ b: 1, a: 2, c: 3 });
    expect(out).toBe('{"a":2,"b":1,"c":3}');
  });

  it('preserves array order', () => {
    expect(canonicalizeJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes primitives JSON-style', () => {
    expect(canonicalizeJson(null)).toBe('null');
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson(false)).toBe('false');
    expect(canonicalizeJson('hello')).toBe('"hello"');
    expect(canonicalizeJson(42)).toBe('42');
  });

  it('canonicalizes nested structures with sorted keys', () => {
    const out = canonicalizeJson({
      outer: { z: 1, a: { y: 2, x: 3 } },
      list: [{ b: 1, a: 2 }],
    });
    expect(out).toBe('{"list":[{"a":2,"b":1}],"outer":{"a":{"x":3,"y":2},"z":1}}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow();
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow();
  });
});
