// Sortable base62 position keys. The alphabet is in ASCII order, so plain
// string comparison (and the "C" collation on the position columns) is
// presentation order. Generated keys never end in '0', which guarantees a key
// always exists strictly between any two distinct keys.

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;

export const MAX_POSITION_KEY_LENGTH = 64;

const digit = (key: string, index: number): number =>
  ALPHABET.indexOf(key.charAt(index));

export const comparePositionKeys = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** A key strictly between `lower` and `upper`; null bounds are open. */
export function positionKeyBetween(
  lower: string | null,
  upper: string | null,
): string {
  const a = lower ?? '';
  let b = upper;
  if (b !== null && a >= b) {
    throw new Error(`Position bounds out of order: '${a}' >= '${b}'`);
  }
  let prefix = '';
  for (let index = 0; ; index++) {
    const lowerDigit = index < a.length ? digit(a, index) : 0;
    const upperDigit = b !== null && index < b.length ? digit(b, index) : BASE;
    if (lowerDigit === upperDigit) {
      prefix += ALPHABET.charAt(lowerDigit);
      continue;
    }
    const middle = Math.floor((lowerDigit + upperDigit) / 2);
    if (middle > lowerDigit) {
      return prefix + ALPHABET.charAt(middle);
    }
    // Adjacent digits: keep the lower digit and search above the rest of
    // `lower` with no upper bound.
    prefix += ALPHABET.charAt(lowerDigit);
    b = null;
  }
}

/**
 * The next key after `last` for appends. Increments the rightmost
 * non-maximal digit so repeated appends grow keys slowly.
 */
export function positionKeyAfter(last: string | null): string {
  if (last === null) {
    return ALPHABET.charAt(Math.floor(BASE / 2));
  }
  for (let index = last.length - 1; index >= 0; index--) {
    const value = digit(last, index);
    if (value < BASE - 1) {
      return last.slice(0, index) + ALPHABET.charAt(value + 1);
    }
  }
  return last + ALPHABET.charAt(Math.floor(BASE / 2));
}

/** `count` evenly spaced ascending keys, used for imports and rebalancing. */
export function evenlySpacedPositionKeys(count: number): string[] {
  let width = 1;
  while (BASE ** width < (count + 1) * 2) width++;
  const space = BASE ** width;
  const keys: string[] = [];
  for (let index = 0; index < count; index++) {
    let value = Math.floor(((index + 1) * space) / (count + 1));
    if (value % BASE === 0) value += 1;
    let key = '';
    for (let place = 0; place < width; place++) {
      key = ALPHABET.charAt(value % BASE) + key;
      value = Math.floor(value / BASE);
    }
    keys.push(key);
  }
  return keys;
}
