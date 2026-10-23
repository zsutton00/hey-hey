import {
  evenlySpacedPositionKeys,
  positionKeyAfter,
  positionKeyBetween,
} from '../open-items-position';

const VALID = /^[0-9A-Za-z]{1,64}$/;

describe('Open Items position keys', () => {
  it('appends in ascending order with slowly growing keys', () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let index = 0; index < 1000; index++) {
      last = positionKeyAfter(last);
      keys.push(last);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => VALID.test(key))).toBe(true);
  });

  it('finds a key strictly between any two keys, including open bounds', () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      [null, 'V'],
      ['V', null],
      ['V', 'W'],
      ['Vz', 'W'],
      ['0001', '01'],
      ['z', null],
    ];
    for (const [lower, upper] of cases) {
      const key = positionKeyBetween(lower, upper);
      expect(VALID.test(key)).toBe(true);
      if (lower !== null) expect(key > lower).toBe(true);
      if (upper !== null) expect(key < upper).toBe(true);
      expect(key.endsWith('0')).toBe(false);
    }
  });

  it('rejects out-of-order bounds', () => {
    expect(() => positionKeyBetween('W', 'V')).toThrow();
  });

  it('spaces keys evenly in ascending order', () => {
    for (const count of [0, 1, 2, 61, 62, 1000]) {
      const keys = evenlySpacedPositionKeys(count);
      expect(keys).toHaveLength(count);
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(count);
      expect(keys.every((key) => VALID.test(key) && !key.endsWith('0'))).toBe(
        true,
      );
    }
  });
});
