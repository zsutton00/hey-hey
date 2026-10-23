/**
 * Minimal RFC 8785 (JSON Canonicalization Scheme) serializer.
 *
 * The signed-trigger envelope contract requires the server signer and the
 * CLI verifier to canonicalize the same bytes: the envelope with `signature`
 * removed, serialized with JCS. JCS pins object key ordering (lexicographic
 * by UTF-16 code unit), number formatting (ECMAScript `Number.prototype.toString`),
 * and string escaping so both sides produce identical bytes.
 *
 * Inputs are restricted to JSON-compatible values; arrays preserve order,
 * objects are key-sorted. Throws on non-finite numbers (NaN/Infinity have no
 * JSON form) or unsupported types — those are bugs upstream, not values to
 * normalize away.
 */
export const canonicalizeJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalizeJson: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalizeJson: unsupported value type ${typeof value}`);
};
