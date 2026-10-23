/** JSON value accepted by the RFC 8785 JSON Canonicalization Scheme. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/**
 * Serialize a JSON value using RFC 8785 ordering and ECMAScript number/string
 * serialization. The enrollment and registry signatures must use these exact
 * bytes; ordinary JSON.stringify is not sufficient because object insertion
 * order is not part of the wire contract.
 */
export const canonicalizeJson = (value: CanonicalJsonValue): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalizeJson: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => {
      const child = value[key];
      if (child === undefined) throw new Error('canonicalizeJson: undefined object value');
      return `${JSON.stringify(key)}:${canonicalizeJson(child)}`;
    })
    .join(',')}}`;
};

const toCanonicalJsonValue = (value: unknown): CanonicalJsonValue => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalizeJson: non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toCanonicalJsonValue(child)]),
    );
  }
  throw new Error(`canonicalizeJson: unsupported ${typeof value} value`);
};

/** Canonicalize a generated DTO after validating its complete JSON value tree. */
export const canonicalizeJsonObject = (value: object): string =>
  canonicalizeJson(toCanonicalJsonValue(value));
