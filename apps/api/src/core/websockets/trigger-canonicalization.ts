/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 *
 * Signed trigger envelopes are only verifiable if the server signer and the
 * CLI verifier canonicalize byte-identical input. JCS fixes the three things
 * plain JSON leaves free:
 *   1. object member ordering — lexicographic by UTF-16 code unit,
 *   2. number formatting — the ECMAScript Number-to-String algorithm,
 *   3. string escaping — minimal (short escapes for the five named control
 *      characters, `\u00xx` for the rest, every other code point literal).
 *
 * V8's `JSON.stringify` already satisfies (2) and (3) exactly, so the only
 * gap this serializer closes is (1): it sorts object keys before emitting
 * and delegates primitives and strings to `JSON.stringify`.
 *
 * The signed message is the UTF-8 encoding of the canonicalization of the
 * envelope with `signature` removed — i.e. `{ event, machineId, userId,
 * nonce, timestampMs }`. See `SignedEnvelopeFields` in the OpenAPI spec for
 * the full contract.
 */
export function canonicalizeJcs(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      // RFC 8785 forbids NaN/Infinity; surfacing rather than silently
      // emitting `null` keeps a malformed body from being signed.
      throw new Error('Cannot canonicalize a non-finite number');
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // `undefined` array slots serialize as `null`, matching JSON semantics.
    return `[${value.map((item) => serialize(item ?? null)).join(',')}]`;
  }

  if (type === 'object') {
    // String `<`/`>` comparison in JS is by UTF-16 code unit — exactly the
    // ordering RFC 8785 mandates. `undefined`-valued members are dropped,
    // matching how `JSON.stringify` omits them.
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, memberValue]) => memberValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${members
      .map(
        ([key, memberValue]) =>
          `${JSON.stringify(key)}:${serialize(memberValue)}`,
      )
      .join(',')}}`;
  }

  throw new Error(`Cannot canonicalize value of type ${type}`);
}
